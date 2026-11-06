import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeTable } from "../fakes.js";

vi.mock("../../../open-next-azure/src/overrides/clients.js", () => ({
  getBlobService: vi.fn(),
  getTableClient: vi.fn(),
  getQueueClient: vi.fn(),
}));

let table: ReturnType<typeof fakeTable>;
const g = globalThis as unknown as Record<string, unknown>;

async function load() {
  vi.resetModules();
  const { getTableClient } = await import("../../../open-next-azure/src/overrides/clients.js");
  vi.mocked(getTableClient).mockResolvedValue(table.client as never);
  return (await import("../../../open-next-azure/src/overrides/tag-cache.js")).default;
}

beforeEach(() => {
  table = fakeTable();
  g.openNextConfig = {};
  g.__openNextAls = undefined;
  vi.stubEnv("OPEN_NEXT_BUILD_ID", "build-1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("storage layout (B4)", () => {
  it("is a nextMode tag cache", async () => {
    const cache = await load();
    expect(cache.mode).toBe("nextMode");
    expect(cache.name).toBe("azure-table");
  });

  it("partitions by build id and base64url-encodes the tag, so forbidden key characters never appear", async () => {
    const cache = await load();
    const tag = "_N_T_/blog/a?x=1#frag\\back\u0007";
    await cache.writeTags([tag]);

    const [{ entity, mode }] = table.upserts;
    expect(entity.partitionKey).toBe("build-1");
    expect(entity.rowKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(entity.rowKey).not.toMatch(/[/\\#?]/);
    expect(Buffer.from(entity.rowKey, "base64url").toString()).toBe(tag); // reversible
    expect(mode).toBe("Replace");
  });

  it("keeps different build ids apart", async () => {
    const cache = await load();
    await cache.writeTags(["t"]);
    vi.stubEnv("OPEN_NEXT_BUILD_ID", "build-2");
    expect(await cache.hasBeenRevalidated(["t"], 0)).toBe(false);
  });

  it("stores stale and expire only when given", async () => {
    const cache = await load();
    await cache.writeTags(["plain", { tag: "soft", stale: 111, expire: 222 }, { tag: "bare" }]);
    const by = Object.fromEntries(
      table.upserts.map((u) => [Buffer.from(u.entity.rowKey, "base64url").toString(), u.entity]),
    );
    expect(by.plain).not.toHaveProperty("stale");
    expect(by.plain).not.toHaveProperty("expire");
    expect(by.soft).toMatchObject({ stale: 111, expire: 222 });
    expect(by.bare).not.toHaveProperty("stale");
    expect(typeof by.plain?.revalidatedAt).toBe("number");
  });
});

describe("hasBeenRevalidated", () => {
  it("is false for a tag that was never revalidated and for an empty list", async () => {
    const cache = await load();
    expect(await cache.hasBeenRevalidated(["nope"], 0)).toBe(false);
    expect(await cache.hasBeenRevalidated([], 0)).toBe(false);
  });

  it("is true for pages generated before the revalidation, false for pages generated after", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const cache = await load();
    await cache.writeTags(["posts"]);
    expect(await cache.hasBeenRevalidated(["posts"], 9_000)).toBe(true);
    expect(await cache.hasBeenRevalidated(["posts"], 10_000)).toBe(false);
    expect(await cache.hasBeenRevalidated(["posts"], 11_000)).toBe(false);
  });

  it("is true when any one of several tags was revalidated", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const cache = await load();
    await cache.writeTags(["b"]);
    expect(await cache.hasBeenRevalidated(["a", "b", "c"], 0)).toBe(true);
  });

  it("treats a passed expire time as revalidated, but a future one as not yet", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const cache = await load();
    await cache.writeTags([{ tag: "soon", expire: 20_000 }]);
    // revalidatedAt (10_000) is not newer than the page (10_000) and the expiry is in the future
    expect(await cache.hasBeenRevalidated(["soon"], 10_000)).toBe(false);
    vi.setSystemTime(25_000);
    expect(await cache.hasBeenRevalidated(["soon"], 10_000)).toBe(true);
  });

  it("memoizes lookups for the duration of one request", async () => {
    const lookups = vi.spyOn(table.client, "getEntity");
    const cacheMap = new Map<string, unknown>();
    g.__openNextAls = { getStore: () => ({ requestCache: { getOrCreate: () => cacheMap } }) };
    const cache = await load();
    await cache.hasBeenRevalidated(["x"], 0);
    await cache.hasBeenRevalidated(["x"], 0);
    expect(lookups).toHaveBeenCalledTimes(1);
  });

  it("does not hide storage failures other than 'not found'", async () => {
    vi.spyOn(table.client, "getEntity").mockRejectedValue(
      Object.assign(new Error("boom"), { statusCode: 500 }),
    );
    const cache = await load();
    await expect(cache.hasBeenRevalidated(["x"], 0)).rejects.toThrow("boom");
  });
});

describe("isStale", () => {
  it("is true only for a soft-revalidated tag that is newer than the page", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const cache = await load();
    await cache.writeTags([{ tag: "soft", stale: 20_000 }, "hard"]);
    expect(await cache.isStale?.(["soft"], 9_000)).toBe(true);
    expect(await cache.isStale?.(["hard"], 9_000)).toBe(false); // no stale window
    expect(await cache.isStale?.(["soft"], 10_000)).toBe(false); // page generated after revalidation
    expect(await cache.isStale?.([], 0)).toBe(false);
  });
});

describe("when the tag cache is disabled", () => {
  it("reports nothing and writes nothing", async () => {
    g.openNextConfig = { dangerous: { disableTagCache: true } };
    const cache = await load();
    await cache.writeTags(["t"]);
    expect(table.upserts).toHaveLength(0);
    expect(await cache.hasBeenRevalidated(["t"], 0)).toBe(false);
    expect(await cache.isStale?.(["t"], 0)).toBe(false);
  });
});

describe("getLastRevalidated", () => {
  it("is unsupported and returns 0 (same as the DynamoDB nextMode implementation)", async () => {
    expect(await (await load()).getLastRevalidated(["a"])).toBe(0);
  });
});
