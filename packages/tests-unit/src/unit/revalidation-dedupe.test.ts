import { describe, expect, it } from "vitest";
import {
  claimRevalidation,
  dedupeRowKey,
} from "../../../open-next-azure/src/overrides/revalidation-dedupe.js";
import { fakeTable } from "../fakes.js";

const WINDOW = 60_000;
const claim = (
  table: ReturnType<typeof fakeTable>,
  over: { version?: string; now?: number; url?: string; host?: string; windowMs?: number } = {},
) =>
  claimRevalidation(table.client as never, {
    partitionKey: "dedupe-b1",
    host: over.host ?? "www.example.com",
    url: over.url ?? "/isr",
    version: over.version ?? "etag-1",
    now: over.now ?? 10_000,
    windowMs: over.windowMs ?? WINDOW,
  });

describe("dedupeRowKey", () => {
  it("is a short, key-safe hash that differs per host and url", () => {
    const a = dedupeRowKey("www.example.com", "/blog/a?x=1#y\\z");
    expect(a).toMatch(/^[0-9a-f]{40}$/); // no / \ # ? and a fixed length, however long the url
    expect(dedupeRowKey("www.example.com", `/${"x".repeat(5000)}`)).toMatch(/^[0-9a-f]{40}$/);
    expect(dedupeRowKey("other.example.com", "/blog/a?x=1#y\\z")).not.toBe(a);
    expect(dedupeRowKey("www.example.com", "/blog/b")).not.toBe(
      dedupeRowKey("www.example.com", "/blog/a"),
    );
  });

  it("does not confuse host and url boundaries", () => {
    expect(dedupeRowKey("a.com", "b/c")).not.toBe(dedupeRowKey("a.comb", "/c"));
  });
});

describe("claimRevalidation", () => {
  it("the first request for a page version gets the claim", async () => {
    expect(await claim(fakeTable())).toBe(true);
  });

  it("later requests for the same version inside the window do not (this is the stampede fix)", async () => {
    const table = fakeTable();
    expect(await claim(table, { now: 10_000 })).toBe(true);
    expect(await claim(table, { now: 10_001 })).toBe(false);
    expect(await claim(table, { now: 10_000 + WINDOW - 1 })).toBe(false);
  });

  it("claims again once the window has passed, in case the first message was lost", async () => {
    const table = fakeTable();
    expect(await claim(table, { now: 10_000 })).toBe(true);
    expect(await claim(table, { now: 10_000 + WINDOW })).toBe(true);
    expect(await claim(table, { now: 10_000 + WINDOW + 1 })).toBe(false); // and then holds again
  });

  it("claims at once when the page was regenerated meanwhile (a new version, i.e. a new ETag)", async () => {
    const table = fakeTable();
    expect(await claim(table, { version: "etag-1", now: 10_000 })).toBe(true);
    expect(await claim(table, { version: "etag-1", now: 10_100 })).toBe(false);
    expect(await claim(table, { version: "etag-2", now: 10_200 })).toBe(true);
  });

  describe("an unknown version (empty string) decides by the window alone", () => {
    it("a request without a version is held back by a claim that has one", async () => {
      const table = fakeTable();
      expect(await claim(table, { version: "etag-1", now: 10_000 })).toBe(true);
      expect(await claim(table, { version: "", now: 10_100 })).toBe(false);
    });

    it("and the other way round", async () => {
      const table = fakeTable();
      expect(await claim(table, { version: "", now: 10_000 })).toBe(true);
      expect(await claim(table, { version: "etag-1", now: 10_100 })).toBe(false);
    });

    it("requests that alternate between a known and an unknown version do not take turns winning", async () => {
      // The failure seen on Azure: the same page reported lastModified 0 to some requests and 1 to others.
      const table = fakeTable();
      const versions = ["", "etag-1", "", "etag-1", "", "", "etag-1", ""];
      const wins = [];
      for (const [i, version] of versions.entries())
        wins.push(await claim(table, { version, now: 10_000 + i }));
      expect(wins.filter(Boolean)).toHaveLength(1);
    });

    it("still claims again after the window", async () => {
      const table = fakeTable();
      await claim(table, { version: "", now: 10_000 });
      expect(await claim(table, { version: "", now: 10_000 + WINDOW })).toBe(true);
    });
  });

  it("keeps pages apart", async () => {
    const table = fakeTable();
    expect(await claim(table, { url: "/a" })).toBe(true);
    expect(await claim(table, { url: "/b" })).toBe(true);
    expect(await claim(table, { url: "/a" })).toBe(false);
    expect(await claim(table, { host: "other.example.com", url: "/a" })).toBe(true);
  });

  it("with many requests at the same time exactly one gets the claim", async () => {
    const table = fakeTable();
    const results = await Promise.all(Array.from({ length: 50 }, () => claim(table)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("with many requests racing to replace an expired claim exactly one wins", async () => {
    const table = fakeTable();
    await claim(table, { now: 10_000 });
    const later = 10_000 + WINDOW + 5;
    const results = await Promise.all(
      Array.from({ length: 50 }, () => claim(table, { now: later })),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("a window of 0 disables the dedupe", async () => {
    const table = fakeTable();
    expect(await claim(table, { windowMs: 0, now: 10_000 })).toBe(true);
    expect(await claim(table, { windowMs: 0, now: 10_000 })).toBe(true);
    expect(table.rows.size).toBe(0); // and nothing is stored
  });

  it("stores the version and the claim time", async () => {
    const table = fakeTable();
    await claim(table, { version: "etag-9", now: 9999 });
    const [row] = [...table.rows.values()];
    expect(row).toMatchObject({ partitionKey: "dedupe-b1", version: "etag-9", claimedAt: 9999 });
  });

  it("does not hide storage errors other than 'not found' / 'already exists' / 'changed'", async () => {
    const table = fakeTable();
    table.client.getEntity = async () => {
      throw Object.assign(new Error("denied"), { statusCode: 403 });
    };
    await expect(claim(table)).rejects.toThrow("denied");
  });

  it("treats a row that vanished between read and update as a lost race, not an error", async () => {
    const table = fakeTable();
    await claim(table, { now: 10_000 });
    const real = table.client.updateEntity.bind(table.client);
    table.client.updateEntity = async (...args: Parameters<typeof real>) => {
      table.rows.clear(); // deleted by someone else after we read it
      return real(...args);
    };
    expect(await claim(table, { now: 10_000 + WINDOW + 1 })).toBe(false);
  });
});
