import { describe, expect, it } from "vitest";
import { cacheStatus, eventually, freshPage, request, sleep, timestampIn } from "../http.js";

describe("time-based ISR", () => {
  it("serves a stale page at once, then the regenerated one", async () => {
    const first = await freshPage("/isr");
    const firstStamp = timestampIn(first.text);
    expect(firstStamp).toBeDefined();

    await sleep(6500); // /isr has revalidate = 5

    const stale = await request("/isr");
    expect(cacheStatus(stale)).toBe("STALE");
    expect(timestampIn(stale.text)).toBe(firstStamp); // the stale page is served immediately

    // The regeneration runs in the same process, after the stale answer.
    const fresh = await eventually(
      async () => {
        const res = await request("/isr");
        return timestampIn(res.text) !== firstStamp ? res : false;
      },
      30_000,
      500,
    );
    expect(timestampIn(fresh.text)).not.toBe(firstStamp);
    expect(["HIT", "STALE"]).toContain(cacheStatus(fresh));
  });
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
