import { describe, expect, it } from "vitest";
import { eventually, hostLog, request } from "../http.js";

// ADR-0006: the wrapper holds the response stream open until deferred work is done. These tests
// pin down the CURRENT behaviour. The latency assertion is expected to change when ADR-0006 is
// superseded after the Azure measurement; update it together with the ADR.
describe("after() / waitUntil (B7)", () => {
  it("runs the deferred work to completion", async () => {
    const res = await request("/api/after");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ responded: true });
    await eventually(async () => /AFTER_DONE/.test(hostLog()));
  });

  it("currently makes the client wait for the deferred work (known cost of ADR-0006)", async () => {
    const res = await request("/api/after");
    expect(res.headersAtMs).toBeLessThan(1500);
    expect(res.totalMs).toBeGreaterThan(1800); // 2 s of deferred work
  });
});
