import { describe, expect, it } from "vitest";
import {
  cacheStatus,
  eventually,
  freshPage,
  hasHostLog,
  hostLog,
  request,
  sleep,
  timestampIn,
} from "../http.js";

const consumerRuns = () =>
  (hostLog().match(/Executed 'Functions\.revalidation' \(Succeeded/g) ?? []).length;

describe("ISR through the revalidation queue (B1, B2)", () => {
  it("serves a stale page, then regenerates it through the queue trigger", async () => {
    const first = await freshPage("/isr");
    const firstStamp = timestampIn(first.text);
    expect(firstStamp).toBeDefined();

    await sleep(6500); // /isr has revalidate = 5
    const runsBefore = hasHostLog() ? consumerRuns() : 0;

    const stale = await request("/isr");
    expect(cacheStatus(stale)).toBe("STALE");
    expect(timestampIn(stale.text)).toBe(firstStamp); // the stale page is served immediately

    // The queue consumer must run and succeed: it only does if the server answered its HEAD request
    // with the "revalidated" header (otherwise the converter throws and the message is retried).
    if (hasHostLog()) await eventually(async () => consumerRuns() > runsBefore, 20_000);

    // Remote: the consumer polls with backoff (up to 60 s by default), so wait longer.
    const fresh = await eventually(
      async () => {
        const res = await request("/isr");
        return timestampIn(res.text) !== firstStamp ? res : false;
      },
      hasHostLog() ? 20_000 : 150_000,
      hasHostLog() ? 500 : 3000,
    );
    expect(timestampIn(fresh.text)).not.toBe(firstStamp);
    expect(["HIT", "STALE"]).toContain(cacheStatus(fresh));
  });

  it.skipIf(!hasHostLog())("does not leave failed revalidations behind", async () => {
    expect(hostLog()).not.toMatch(/Executed 'Functions\.revalidation' \(Failed/);
  });
});

describe("ISR stampede (ADR-0010)", () => {
  it.skipIf(!hasHostLog())(
    "30 simultaneous requests for a stale page cause one regeneration, not thirty",
    async () => {
      await request("/isr");
      await sleep(6500); // /isr has revalidate = 5, so it is stale now
      const before = consumerRuns();

      const responses = await Promise.all(Array.from({ length: 30 }, () => request("/isr")));
      expect(responses.every((r) => r.status === 200)).toBe(true);

      const stamp = timestampIn(responses[0]?.text ?? "");
      await eventually(async () => {
        const r = await request("/isr");
        return timestampIn(r.text) !== stamp ? r : false;
      });
      await sleep(3000); // let any extra message be consumed before counting

      const runs = consumerRuns() - before;
      // Without the dedupe every one of the 30 requests adds a message and a regeneration.
      expect(runs).toBeGreaterThanOrEqual(1);
      expect(runs).toBeLessThanOrEqual(2);
    },
  );
});

describe("on-demand revalidation (revalidateTag)", () => {
  it("keeps a cached value until the tag is revalidated, then renders a new one", async () => {
    const a = timestampIn((await request("/tagged")).text);
    const b = timestampIn((await request("/tagged")).text);
    expect(a).toBeDefined();
    expect(b).toBe(a);

    const post = await request("/api/revalidate", { method: "POST" });
    expect(post.status).toBe(200);
    expect(JSON.parse(post.text)).toEqual({ revalidated: true });

    const c = timestampIn((await request("/tagged")).text);
    expect(c).not.toBe(a);
    expect(timestampIn((await request("/tagged")).text)).toBe(c); // and the new value is cached again
  });
});

describe("'use cache' (Composable Caching)", () => {
  it("keeps a cached function result until its tag is revalidated", async () => {
    const a = timestampIn((await request("/use-cache")).text);
    expect(a).toBeDefined();
    expect(timestampIn((await request("/use-cache")).text)).toBe(a);

    const post = await request("/api/revalidate-use-cache", { method: "POST" });
    expect(post.status).toBe(200);

    const c = timestampIn((await request("/use-cache")).text);
    expect(c).not.toBe(a);
    expect(timestampIn((await request("/use-cache")).text)).toBe(c);
  });
});
