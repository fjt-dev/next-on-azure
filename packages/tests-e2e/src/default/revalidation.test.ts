import { describe, expect, it } from "vitest";
import { eventually, header, hostLog, request, sleep, timestampIn } from "../http.js";

const consumerRuns = () =>
  (hostLog().match(/Executed 'Functions\.revalidation' \(Succeeded/g) ?? []).length;

describe("ISR through the revalidation queue (B1, B2)", () => {
  it("serves a stale page, then regenerates it through the queue trigger", async () => {
    const first = await request("/isr");
    const firstStamp = timestampIn(first.text);
    expect(firstStamp).toBeDefined();

    await sleep(6500); // /isr has revalidate = 5
    const runsBefore = consumerRuns();

    const stale = await request("/isr");
    expect(header(stale, "x-nextjs-cache")).toBe("STALE");
    expect(timestampIn(stale.text)).toBe(firstStamp); // the stale page is served immediately

    // The queue consumer must run and succeed: it only does if the server answered its HEAD request
    // with the "revalidated" header (otherwise the converter throws and the message is retried).
    await eventually(async () => consumerRuns() > runsBefore, 20_000);

    const fresh = await eventually(async () => {
      const res = await request("/isr");
      return timestampIn(res.text) !== firstStamp ? res : false;
    });
    expect(timestampIn(fresh.text)).not.toBe(firstStamp);
    expect(["HIT", "STALE"]).toContain(header(fresh, "x-nextjs-cache"));
  });

  it("does not leave failed revalidations behind", async () => {
    expect(hostLog()).not.toMatch(/Executed 'Functions\.revalidation' \(Failed/);
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
