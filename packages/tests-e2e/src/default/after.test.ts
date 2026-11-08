import { describe, expect, it } from "vitest";
import { request } from "../http.js";

// The entry holds the response stream open until deferred work is done (WAIT_UNTIL_MODE=hold, the
// default). /api/after does 2 s of work after it has answered.
describe("after() / waitUntil (B7)", () => {
  it("runs the deferred work to completion", async () => {
    const res = await request("/api/after");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ responded: true });
  });

  it("makes the client wait for the deferred work", async () => {
    const res = await request("/api/after");
    expect(res.headersAtMs).toBeLessThan(1500);
    expect(res.totalMs).toBeGreaterThan(1800); // 2 s of deferred work
  });
});
