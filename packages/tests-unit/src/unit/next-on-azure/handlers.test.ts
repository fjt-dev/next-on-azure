import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../next-on-azure/src/runtime",
);
const req = createRequire(import.meta.url);

const notFound = () => Object.assign(new Error("not found"), { statusCode: 404 });

function fakeStorage() {
  const blobs = new Map<string, string>();
  const rows = new Map<string, Record<string, unknown>>();
  const container = {
    getBlockBlobClient: (name: string) => ({
      async downloadToBuffer() {
        const body = blobs.get(name);
        if (body === undefined) throw notFound();
        return Buffer.from(body);
      },
      async upload(body: string) {
        blobs.set(name, body);
      },
    }),
  };
  const table = {
    async getEntity(pk: string, rk: string) {
      const row = rows.get(`${pk}|${rk}`);
      if (!row) throw notFound();
      return { ...row };
    },
    async upsertEntity(entity: { partitionKey: string; rowKey: string }) {
      rows.set(`${entity.partitionKey}|${entity.rowKey}`, { ...entity });
    },
  };
  return { blobs, rows, container, table };
}

/** Fresh copies of the CommonJS modules, wired to a fake storage. */
function load(file: string) {
  for (const key of Object.keys(req.cache)) if (key.startsWith(runtime)) delete req.cache[key];
  const storage = fakeStorage();
  req(path.join(runtime, "azure-storage.cjs")).setClientsForTest({
    container: storage.container,
    table: storage.table,
  });
  return { module: req(path.join(runtime, file)), storage };
}

beforeEach(() => {
  vi.stubEnv("NEXT_BUILD_ID", "build-1");
  vi.stubEnv("NEXT_PHASE", "");
});
afterEach(() => vi.unstubAllEnvs());

const packageDir = path.resolve(runtime, "../..");

/** A build output as `next build` leaves it: app/hello.{html,meta,rsc}, an hour old. */
function buildOutput(parent: string) {
  const serverDistDir = fs.mkdtempSync(path.join(parent, ".tmp-build-"));
  fs.mkdirSync(path.join(serverDistDir, "app"), { recursive: true });
  fs.writeFileSync(path.join(serverDistDir, "app/hello.html"), "<h1>built</h1>");
  fs.writeFileSync(
    path.join(serverDistDir, "app/hello.meta"),
    JSON.stringify({ status: 200, headers: { "x-next-cache-tags": "_N_T_/hello,tag-a" } }),
  );
  fs.writeFileSync(path.join(serverDistDir, "app/hello.rsc"), "rsc-bytes");
  const old = new Date(Date.now() - 3_600_000);
  for (const f of ["hello.html", "hello.meta", "hello.rsc"]) {
    fs.utimesSync(path.join(serverDistDir, "app", f), old, old);
  }
  return serverDistDir;
}

describe("cache-handler reads the build output when Blob has no entry", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const make = () => {
    const serverDistDir = buildOutput(packageDir);
    dirs.push(serverDistDir);
    // The Next.js of the package finds its own file-system cache class from serverDistDir; the options are
    // those that Next.js hands to a cache handler.
    const nextFs = createRequire(path.join(packageDir, "noop.js"))(
      "next/dist/server/lib/node-fs-methods",
    ).nodeFs;
    const { module: Handler, storage } = load("cache-handler.cjs");
    const handler = new Handler({
      serverDistDir,
      fs: nextFs,
      flushToDisk: false,
      revalidatedTags: [],
      maxMemoryCacheSize: 0,
      dev: false,
    });
    return { handler, storage };
  };

  it("returns the built page of a miss, with its Buffers", async () => {
    const { handler, storage } = make();
    const entry = await handler.get("/hello", { kind: "APP_PAGE" });
    expect(entry.value.kind).toBe("APP_PAGE");
    expect(entry.value.html).toBe("<h1>built</h1>");
    expect(Buffer.from(entry.value.rscData).toString()).toBe("rsc-bytes");
    expect(entry.lastModified).toBeLessThan(Date.now() - 3_000_000);
    expect(storage.blobs.size).toBe(0); // reading the build output writes nothing
  });

  it("prefers an entry in Blob, and does not look for kinds that the build does not make", async () => {
    const { handler } = make();
    await handler.set("/hello", { kind: "APP_PAGE", html: "<h1>regenerated</h1>" }, { tags: [] });
    expect((await handler.get("/hello", { kind: "APP_PAGE" })).value.html).toBe(
      "<h1>regenerated</h1>",
    );
    // The build makes no entry of the fetch kind, even for a key that is a built page.
    const { handler: other } = make();
    expect(await other.get("/hello", { kind: "FETCH", tags: [] })).toBeNull();
    expect(await handler.get("/nope", { kind: "APP_PAGE" })).toBeNull();
  });

  it("drops the built page when a tag of its x-next-cache-tags header was revalidated after the build", async () => {
    const { handler } = make();
    expect(await handler.get("/hello", { kind: "APP_PAGE" })).not.toBeNull();
    await handler.revalidateTag("tag-a");
    expect(await handler.get("/hello", { kind: "APP_PAGE" })).toBeNull();
  });

  it("is a miss, not an error, when Next.js cannot be found from the build directory", async () => {
    const { handler } = make();
    // Under pnpm NODE_PATH makes Next.js resolvable from anywhere: make the lookup fail instead.
    const spy = vi.spyOn(req("module"), "createRequire").mockImplementation(() => {
      throw new Error("cannot find next");
    });
    try {
      expect(await handler.get("/hello", { kind: "APP_PAGE" })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("cache-handler (incremental cache)", () => {
  const make = () => {
    const { module: Handler, storage } = load("cache-handler.cjs");
    return { handler: new Handler({}), storage };
  };

  it("stores an entry and reads it back, keeping Buffers and Maps", async () => {
    const { handler } = make();
    const value = {
      kind: "APP_PAGE",
      html: "<p>x</p>",
      rscData: Buffer.from("rsc-bytes"),
      segmentData: new Map([["/a", Buffer.from("seg")]]),
    };
    await handler.set("/page", value, { tags: [] });
    const entry = await handler.get("/page", {});
    expect(entry.value.html).toBe("<p>x</p>");
    expect(Buffer.isBuffer(entry.value.rscData)).toBe(true);
    expect(entry.value.rscData.toString()).toBe("rsc-bytes");
    expect(entry.value.segmentData).toBeInstanceOf(Map);
    expect(entry.value.segmentData.get("/a").toString()).toBe("seg");
    expect(typeof entry.lastModified).toBe("number");
  });

  it("is a miss for an unknown key and does not hide other storage errors", async () => {
    const { handler, storage } = make();
    expect(await handler.get("/nope", {})).toBeNull();
    storage.container.getBlockBlobClient = () => ({
      downloadToBuffer: async () => {
        throw Object.assign(new Error("boom"), { statusCode: 500 });
      },
      upload: async () => undefined,
    });
    await expect(handler.get("/x", {})).rejects.toThrow("boom");
  });

  it("keeps entries of different builds apart", async () => {
    const { handler, storage } = make();
    await handler.set("/page", { kind: "X" }, { tags: [] });
    vi.stubEnv("NEXT_BUILD_ID", "build-2");
    const { module: Other } = load("cache-handler.cjs");
    // Same storage object is not shared by load(); check the blob name instead.
    expect([...storage.blobs.keys()][0]).toMatch(/^build-1\/[0-9a-f]{64}\.json$/);
    expect(new Other({}).buildId).toBe("build-2");
  });

  it("drops an entry whose tag was revalidated after it was written", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const { handler } = make();
    await handler.set("/page", { kind: "X" }, { tags: ["posts"] });
    expect(await handler.get("/page", {})).not.toBeNull();
    vi.setSystemTime(20_000);
    await handler.revalidateTag("posts");
    expect(await handler.get("/page", {})).toBeNull();
    vi.useRealTimers();
  });

  it("does not drop an entry that was written after the revalidation", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const { handler } = make();
    await handler.revalidateTag(["posts"]);
    vi.setSystemTime(20_000);
    await handler.set("/page", { kind: "X" }, { tags: ["posts"] });
    expect(await handler.get("/page", {})).not.toBeNull();
    vi.useRealTimers();
  });

  it("takes the tags of a page from the x-next-cache-tags header", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const { handler } = make();
    await handler.set(
      "/p",
      { kind: "APP_PAGE", headers: { "x-next-cache-tags": "_N_T_/p,a" } },
      {},
    );
    vi.setSystemTime(20_000);
    await handler.revalidateTag("a");
    expect(await handler.get("/p", {})).toBeNull();
    vi.useRealTimers();
  });

  it("also checks the soft tags of the request", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const { handler } = make();
    await handler.set("/p", { kind: "X" }, { tags: [] });
    vi.setSystemTime(20_000);
    await handler.revalidateTag("_N_T_/layout");
    expect(await handler.get("/p", { softTags: ["_N_T_/layout"] })).toBeNull();
    expect(await handler.get("/p", { softTags: ["_N_T_/other"] })).not.toBeNull();
    vi.useRealTimers();
  });

  it("does nothing while next build runs (no storage account then)", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const { handler, storage } = make();
    await handler.set("/page", { kind: "X" }, { tags: ["t"] });
    await handler.revalidateTag("t");
    expect(await handler.get("/page", {})).toBeNull();
    expect(storage.blobs.size).toBe(0);
    expect(storage.rows.size).toBe(0);
  });
});

const stream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
const readText = async (s: ReadableStream<Uint8Array>) =>
  new TextDecoder().decode(Buffer.concat(await collect(s)));
async function collect(s: ReadableStream<Uint8Array>) {
  const parts: Buffer[] = [];
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return parts;
}
const entry = (over: Record<string, unknown> = {}) => ({
  value: stream("cached-value"),
  tags: ["posts"],
  stale: 300,
  timestamp: Date.now(),
  expire: 86_400,
  revalidate: 3_600,
  ...over,
});

describe("cache-handlers ('use cache')", () => {
  const make = () => load("cache-handlers.cjs").module;

  it("stores a streamed entry and returns its bytes and metadata", async () => {
    const handler = make();
    const original = entry();
    await handler.set("k", Promise.resolve(original));
    const got = await handler.get("k", []);
    expect(await readText(got.value)).toBe("cached-value");
    expect(got).toMatchObject({ tags: ["posts"], stale: 300, expire: 86_400, revalidate: 3_600 });
    expect(got.timestamp).toBe(original.timestamp);
  });

  it("leaves the stream given to Next.js readable after storing it", async () => {
    const handler = make();
    const e = entry();
    await handler.set("k", Promise.resolve(e));
    expect(await readText(e.value)).toBe("cached-value");
  });

  it("is undefined for an unknown key and for an entry past its revalidate time", async () => {
    const handler = make();
    expect(await handler.get("nope", [])).toBeUndefined();
    await handler.set("old", Promise.resolve(entry({ timestamp: Date.now() - 7_200_000 })));
    expect(await handler.get("old", [])).toBeUndefined();
  });

  it("is undefined after its tag or a soft tag was expired", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const handler = make();
    await handler.set("k", Promise.resolve(entry({ timestamp: 10_000 })));
    expect(await handler.get("k", [])).toBeDefined();
    vi.setSystemTime(20_000);
    await handler.expireTags("posts");
    expect(await handler.get("k", [])).toBeUndefined();
    await handler.set("s", Promise.resolve(entry({ tags: [], timestamp: 20_000 })));
    vi.setSystemTime(30_000);
    await handler.expireTags("_N_T_/x");
    expect(await handler.get("s", ["_N_T_/x"])).toBeUndefined();
    vi.useRealTimers();
  });

  it("reports the latest expiry of the tags, 0 for none", async () => {
    vi.useFakeTimers({ now: 5_000 });
    const handler = make();
    expect(await handler.getExpiration("a", "b")).toBe(0);
    await handler.expireTags("a");
    vi.setSystemTime(9_000);
    await handler.expireTags("b");
    expect(await handler.getExpiration("a", "b")).toBe(9_000);
    expect(await handler.getExpiration("a")).toBe(5_000);
    vi.useRealTimers();
  });

  it("makes a get wait for a set of the same key that is still running", async () => {
    const handler = make();
    let release: (value: ReturnType<typeof entry>) => void = () => undefined;
    const pending = new Promise<ReturnType<typeof entry>>((resolve) => {
      release = resolve;
    });
    const setting = handler.set("k", pending);
    const getting = handler.get("k", []);
    release(entry());
    await setting;
    expect(await readText((await getting).value)).toBe("cached-value");
  });

  it("does nothing while next build runs", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const { module: handler, storage } = load("cache-handlers.cjs");
    await handler.set("k", Promise.resolve(entry()));
    await handler.expireTags("posts");
    expect(await handler.get("k", [])).toBeUndefined();
    expect(await handler.getExpiration("posts")).toBe(0);
    expect(storage.blobs.size).toBe(0);
  });
});
