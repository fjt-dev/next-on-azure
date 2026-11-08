import { describe, expect, it } from "vitest";
import { request } from "../http.js";

describe("an error after the first byte", () => {
  // /api/stream-error sends "partial" and then breaks its stream. The client must not wait for the
  // platform's timeout: the response ends at that point (a shortened body; the failure is logged).
  it("ends the response instead of leaving the client waiting", async () => {
    const res = await request("/api/stream-error");
    expect(res.status).toBe(200);
    expect(res.text).toBe("partial");
    expect(res.totalMs).toBeLessThan(10_000);
  });
});
