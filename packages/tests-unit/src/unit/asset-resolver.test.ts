import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBlobService } from "../fakes.js";
import { readAll } from "../helpers.js";

vi.mock("../../../open-next-azure/src/overrides/clients.js", () => ({
  getBlobService: vi.fn(),
  getTableClient: vi.fn(),
  getQueueClient: vi.fn(),
}));

const JS = "console.log('hello asset')"; // 25 bytes
const JS_ETAG = '"js-etag"';

let tmp: string;
let blobs: ReturnType<typeof fakeBlobService>;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asset-resolver-"));
  const manifest = {
    version: 1,
    files: {
      "_next/static/chunks/app.js": {
        size: JS.length,
        contentType: "text/javascript; charset=utf-8",
        etag: JS_ETAG,
      },
      "favicon.ico": { size: 4, contentType: "image/x-icon", etag: '"ico"' },
      "docs/a b.txt": { size: 2, contentType: "text/plain; charset=utf-8", etag: '"ab"' },
    },
  };
  fs.writeFileSync(path.join(tmp, "assets-manifest.json"), JSON.stringify(manifest));
  vi.stubEnv("ASSETS_MANIFEST_PATH", path.join(tmp, "assets-manifest.json"));
  blobs = fakeBlobService();
  blobs.put("assets", "_next/static/chunks/app.js", JS);
  blobs.put("assets", "favicon.ico", Buffer.from([1, 2, 3, 4]));
  blobs.put("assets", "docs/a b.txt", "ab");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function load() {
  vi.resetModules(); // the resolver caches its manifest per module instance
  const { getBlobService } = await import("../../../open-next-azure/src/overrides/clients.js");
  vi.mocked(getBlobService).mockResolvedValue(blobs.service as never);
  return (await import("../../../open-next-azure/src/overrides/asset-resolver.js")).default;
}

const ev = (rawPath: string, method = "GET", headers: Record<string, string> = {}) =>
  ({
    type: "core",
    method,
    rawPath,
    headers,
    url: `https://h${rawPath}`,
    query: {},
    cookies: {},
    remoteAddress: "::1",
    body: Buffer.alloc(0),
  }) as never;

const find = async (r: Awaited<ReturnType<typeof load>>, e: never) => r.maybeGetAssetResult?.(e);

describe("serving a listed file", () => {
  it("returns the blob with manifest headers and an immutable cache for _next/static", async () => {
    const r = await load();
    const res = await find(r, ev("/_next/static/chunks/app.js"));
    expect(res?.statusCode).toBe(200);
    expect(res?.headers).toMatchObject({
      "content-type": "text/javascript; charset=utf-8",
      etag: JS_ETAG,
      "accept-ranges": "bytes",
      "content-length": String(JS.length),
      "cache-control": "public, max-age=31536000, immutable",
    });
    expect(await readAll(res?.body as never)).toBe(JS);
  });

  it("revalidates files outside _next/static", async () => {
    const res = await find(await load(), ev("/favicon.ico"));
    expect(res?.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  it("decodes percent-encoded paths before the manifest lookup", async () => {
    const res = await find(await load(), ev("/docs/a%20b.txt"));
    expect(res?.statusCode).toBe(200);
    expect(await readAll(res?.body as never)).toBe("ab");
  });

  it("honours the blob prefix", async () => {
    vi.stubEnv("ASSETS_BLOB_PREFIX", "/v1/");
    blobs.put("assets", "v1/favicon.ico", Buffer.from([9, 9, 9, 9]));
    const res = await find(await load(), ev("/favicon.ico"));
    expect(blobs.downloads.at(-1)?.name).toBe("v1/favicon.ico");
    expect(res?.statusCode).toBe(200);
  });

  it("uses the configured container", async () => {
    vi.stubEnv("ASSETS_CONTAINER_NAME", "static");
    blobs.put("static", "favicon.ico", Buffer.from([1, 1, 1, 1]));
    await find(await load(), ev("/favicon.ico"));
    expect(blobs.downloads.at(-1)?.container).toBe("static");
  });
});

describe("what is not served", () => {
  it.each([
    ["an unlisted path", "/_next/static/nope.js", "GET"],
    ["a path outside the manifest", "/BUILD_ID", "GET"],
    ["a prefix of a listed path", "/_next/static/chunks", "GET"],
    ["POST", "/favicon.ico", "POST"],
    ["PUT", "/favicon.ico", "PUT"],
    ["a malformed percent sequence", "/%E0%A4%A", "GET"],
  ])("%s -> left to Next.js", async (_name, rawPath, method) => {
    expect(await find(await load(), ev(rawPath, method))).toBeUndefined();
    expect(blobs.downloads).toHaveLength(0);
  });

  it("serves nothing when the manifest cannot be read, and says why", async () => {
    vi.stubEnv("ASSETS_MANIFEST_PATH", path.join(tmp, "missing.json"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await find(await load(), ev("/favicon.ico"))).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Static assets will not be served"),
      expect.anything(),
    );
  });

  it("falls back to Next.js when a listed file is missing from storage", async () => {
    blobs.store.delete("assets/favicon.ico");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await find(await load(), ev("/favicon.ico"))).toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe("HEAD and conditional requests", () => {
  it("answers HEAD with the headers and no body, without reading the blob", async () => {
    const res = await find(await load(), ev("/_next/static/chunks/app.js", "HEAD"));
    expect(res?.statusCode).toBe(200);
    expect(res?.headers["content-length"]).toBe(String(JS.length));
    expect(await readAll(res?.body as never)).toBe("");
    expect(blobs.downloads).toHaveLength(0);
  });

  it("answers 304 for a matching ETag without reading the blob", async () => {
    const res = await find(
      await load(),
      ev("/_next/static/chunks/app.js", "GET", { "if-none-match": JS_ETAG }),
    );
    expect(res?.statusCode).toBe(304);
    expect(res?.headers.etag).toBe(JS_ETAG);
    expect(await readAll(res?.body as never)).toBe("");
    expect(blobs.downloads).toHaveLength(0);
  });

  it("matches an ETag inside a list, and *", async () => {
    const r = await load();
    expect(
      (await find(r, ev("/favicon.ico", "GET", { "if-none-match": '"x", "ico"' })))?.statusCode,
    ).toBe(304);
    expect((await find(r, ev("/favicon.ico", "GET", { "if-none-match": "*" })))?.statusCode).toBe(
      304,
    );
  });

  it("sends the file again for a different ETag", async () => {
    const res = await find(await load(), ev("/favicon.ico", "GET", { "if-none-match": '"stale"' }));
    expect(res?.statusCode).toBe(200);
  });
});

describe("byte ranges", () => {
  const range = async (value: string) =>
    find(await load(), ev("/_next/static/chunks/app.js", "GET", { range: value }));

  it("serves a bounded range as 206 and asks the blob for exactly that range", async () => {
    const res = await range("bytes=0-6");
    expect(res?.statusCode).toBe(206);
    expect(res?.headers["content-range"]).toBe(`bytes 0-6/${JS.length}`);
    expect(res?.headers["content-length"]).toBe("7");
    expect(await readAll(res?.body as never)).toBe(JS.slice(0, 7));
    expect(blobs.downloads.at(-1)).toMatchObject({ offset: 0, count: 7 });
  });

  it("serves an open-ended range", async () => {
    const res = await range("bytes=20-");
    expect(res?.statusCode).toBe(206);
    expect(await readAll(res?.body as never)).toBe(JS.slice(20));
  });

  it("serves a suffix range", async () => {
    const res = await range("bytes=-5");
    expect(res?.headers["content-range"]).toBe(
      `bytes ${JS.length - 5}-${JS.length - 1}/${JS.length}`,
    );
    expect(await readAll(res?.body as never)).toBe(JS.slice(-5));
  });

  it("clamps an end beyond the file size", async () => {
    const res = await range("bytes=20-9999");
    expect(res?.statusCode).toBe(206);
    expect(res?.headers["content-range"]).toBe(`bytes 20-${JS.length - 1}/${JS.length}`);
  });

  it.each(["bytes=9999-", "bytes=10-5", "bytes=-0"])("answers 416 for %s", async (value) => {
    const res = await range(value);
    expect(res?.statusCode).toBe(416);
    expect(res?.headers["content-range"]).toBe(`bytes */${JS.length}`);
  });

  it.each(["bytes=0-1,5-6", "items=0-1", "garbage", "bytes=-"])(
    "ignores the unsupported header %j and sends everything",
    async (value) => {
      const res = await range(value);
      expect(res?.statusCode).toBe(200);
      expect(await readAll(res?.body as never)).toBe(JS);
    },
  );
});
