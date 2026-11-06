import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBlobService } from "../fakes.js";

vi.mock("../../../open-next-azure/src/overrides/clients.js", () => ({
  getBlobService: vi.fn(),
  getTableClient: vi.fn(),
  getQueueClient: vi.fn(),
}));

let blobs: ReturnType<typeof fakeBlobService>;

async function load() {
  vi.resetModules();
  const { getBlobService } = await import("../../../open-next-azure/src/overrides/clients.js");
  vi.mocked(getBlobService).mockResolvedValue(blobs.service as never);
  return (await import("../../../open-next-azure/src/overrides/incremental-cache.js")).default;
}

beforeEach(() => {
  blobs = fakeBlobService();
  vi.stubEnv("OPEN_NEXT_BUILD_ID", "b1");
});
afterEach(() => vi.unstubAllEnvs());

const page = { type: "app", html: "<p>hi</p>", rsc: "rsc" } as never;

describe("blob names", () => {
  it("uses <buildId>/<key>.<type> for pages and __fetch/<buildId>/<key> for fetch entries", async () => {
    const cache = await load();
    await cache.set("blog/a", page, "cache");
    await cache.set("abc123", { kind: "FETCH", data: {} } as never, "fetch");
    expect([...blobs.store.keys()].sort()).toEqual([
      "cache/__fetch/b1/abc123",
      "cache/b1/blog/a.cache",
    ]);
  });

  it("applies the optional prefix and container", async () => {
    vi.stubEnv("CACHE_BLOB_PREFIX", "env1");
    vi.stubEnv("CACHE_CONTAINER_NAME", "isr");
    const cache = await load();
    await cache.set("k", page, "cache");
    expect([...blobs.store.keys()]).toEqual(["isr/env1/b1/k.cache"]);
  });

  it("defaults to the cache type", async () => {
    const cache = await load();
    await cache.set("k", page);
    expect([...blobs.store.keys()]).toEqual(["cache/b1/k.cache"]);
  });
});

describe("get / set / delete", () => {
  it("round-trips a value and reports the blob's last-modified time", async () => {
    const cache = await load();
    const before = Date.now();
    await cache.set("blog/a", page, "cache");
    const got = await cache.get("blog/a", "cache");
    expect(got?.value).toEqual(page);
    expect(got?.lastModified).toBeGreaterThanOrEqual(before - 1000);
    expect(got?.lastModified).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("reports the write time in milliseconds, not Blob's one-second Last-Modified", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_123 });
    try {
      const cache = await load();
      await cache.set("k", page);
      // Blob's own Last-Modified is the same moment truncated to the second.
      const stored = blobs.store.get("cache/b1/k.cache");
      if (stored) stored.lastModified = new Date(1_700_000_000_000);
      expect((await cache.get("k", "cache"))?.lastModified).toBe(1_700_000_000_123);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to Last-Modified for blobs without the metadata (prerendered cache from deploy)", async () => {
    const cache = await load();
    blobs.put("cache", "b1/pre.cache", JSON.stringify(page));
    const stored = blobs.store.get("cache/b1/pre.cache");
    if (stored) stored.lastModified = new Date(1_650_000_000_000);
    expect((await cache.get("pre", "cache"))?.lastModified).toBe(1_650_000_000_000);
  });

  it("ignores unusable metadata", async () => {
    const cache = await load();
    blobs.put("cache", "b1/bad.cache", JSON.stringify(page));
    const stored = blobs.store.get("cache/b1/bad.cache");
    if (stored) {
      stored.metadata = { writtenatms: "not-a-number" };
      stored.lastModified = new Date(1_650_000_000_000);
    }
    expect((await cache.get("bad", "cache"))?.lastModified).toBe(1_650_000_000_000);
  });

  it("stores JSON with a JSON content type", async () => {
    const cache = await load();
    await cache.set("k", page);
    expect(blobs.uploads[0]?.contentType).toBe("application/json");
  });

  it("returns null for a missing entry", async () => {
    expect(await (await load()).get("missing", "cache")).toBeNull();
  });

  it("does not hide storage errors other than 404", async () => {
    const cache = await load();
    const failing = {
      ...blobs.service,
      getContainerClient: () => ({
        getBlockBlobClient: () => ({
          download: async () => {
            throw Object.assign(new Error("denied"), { statusCode: 403 });
          },
        }),
      }),
    };
    const { getBlobService } = await import("../../../open-next-azure/src/overrides/clients.js");
    vi.mocked(getBlobService).mockResolvedValue(failing as never);
    await expect(cache.get("k", "cache")).rejects.toThrow("denied");
  });

  it("deletes the cache entry, and tolerates deleting a missing one", async () => {
    const cache = await load();
    await cache.set("k", page);
    await cache.delete("k");
    expect(blobs.store.size).toBe(0);
    await expect(cache.delete("k")).resolves.toBeUndefined();
  });

  it("keeps build ids isolated", async () => {
    const cache = await load();
    await cache.set("k", page);
    vi.stubEnv("OPEN_NEXT_BUILD_ID", "b2");
    expect(await cache.get("k", "cache")).toBeNull();
  });
});
