import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONNECTION_STRING } from "./azurite.js";

// The cache handlers of next-on-azure against the real Azure SDKs and Azurite.
const NAMES = { container: "noa-cache", table: "noatagcache" };
const runtime = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../next-on-azure/src/runtime",
);
const req = createRequire(import.meta.url);

beforeAll(async () => {
  vi.stubEnv("AZURE_STORAGE_CONNECTION_STRING", CONNECTION_STRING);
  vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "");
  vi.stubEnv("CACHE_CONTAINER_NAME", NAMES.container);
  vi.stubEnv("CACHE_TABLE_NAME", NAMES.table);
  vi.stubEnv("NEXT_BUILD_ID", "noa-build");
  vi.stubEnv("NEXT_PHASE", "");
  await BlobServiceClient.fromConnectionString(CONNECTION_STRING)
    .getContainerClient(NAMES.container)
    .createIfNotExists();
  await TableServiceClient.fromConnectionString(CONNECTION_STRING, {
    allowInsecureConnection: true,
  }).createTable(NAMES.table);
});
afterAll(() => vi.unstubAllEnvs());

describe("incremental cache handler on Blob and Table Storage", () => {
  it("round-trips an entry with Buffers and Maps, and a missing key is a miss (real 404)", async () => {
    const Handler = req(path.join(runtime, "cache-handler.cjs"));
    const handler = new Handler({});
    expect(await handler.get("/it/missing", {})).toBeNull();
    await handler.set(
      "/it/page",
      {
        kind: "APP_PAGE",
        html: "<p>x</p>",
        rscData: Buffer.from("rsc"),
        segmentData: new Map([["/a", Buffer.from("s")]]),
      },
      { tags: ["it-tag"] },
    );
    const got = await handler.get("/it/page", {});
    expect(got.value.html).toBe("<p>x</p>");
    expect(got.value.rscData.toString()).toBe("rsc");
    expect(got.value.segmentData.get("/a").toString()).toBe("s");
  });

  it("drops the entry after its tag was revalidated; tags with forbidden key characters work", async () => {
    const Handler = req(path.join(runtime, "cache-handler.cjs"));
    const handler = new Handler({});
    const tag = "_N_T_/blog/a?x=1#frag\\back";
    await handler.set("/it/tagged", { kind: "X" }, { tags: [tag] });
    expect(await handler.get("/it/tagged", {})).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    await handler.revalidateTag(tag);
    expect(await handler.get("/it/tagged", {})).toBeNull();
  });
});

describe("'use cache' handler on Blob and Table Storage", () => {
  const stream = (text: string) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
  const read = async (s: ReadableStream<Uint8Array>) => {
    const parts: Buffer[] = [];
    const reader = s.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts).toString();
  };

  it("stores a stream, returns it, and loses it when its tag expires", async () => {
    const handler = req(path.join(runtime, "cache-handlers.cjs"));
    const timestamp = Date.now();
    await handler.set(
      "it-key",
      Promise.resolve({
        value: stream("hello"),
        tags: ["it-use-cache"],
        stale: 1,
        timestamp,
        expire: 60,
        revalidate: 60,
      }),
    );
    const got = await handler.get("it-key", []);
    expect(await read(got.value)).toBe("hello");
    expect(got.timestamp).toBe(timestamp);

    expect(await handler.get("it-missing", [])).toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    await handler.expireTags("it-use-cache");
    expect(await handler.get("it-key", [])).toBeUndefined();
    expect(await handler.getExpiration("it-use-cache")).toBeGreaterThan(timestamp);
  });
});
