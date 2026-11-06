import { describe, expect, it } from "vitest";
import { request } from "../http.js";

describe("streaming (B6)", () => {
  it("sends the shell immediately and the Suspense content later, in separate chunks", async () => {
    const res = await request("/slow");
    expect(res.status).toBe(200);

    const early = res.chunks.find((c) => c.text.includes("early content"));
    const late = res.chunks.find((c) => c.text.includes("late content"));
    expect(early, "early content must be streamed").toBeDefined();
    expect(late, "late content must be streamed").toBeDefined();

    expect(early?.atMs).toBeLessThan(1500);
    expect((late?.atMs ?? 0) - (early?.atMs ?? 0)).toBeGreaterThan(2000); // the page waits 3 s
    expect(res.headersAtMs).toBeLessThan(1500); // headers do not wait for the slow part
    expect(res.totalMs).toBeGreaterThan(2500);
  });
});
