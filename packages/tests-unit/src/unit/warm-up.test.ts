import { describe, expect, it } from "vitest";
import { warmUp } from "../../../open-next-azure/src/cli/warm-up.js";

const clock = () => {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
};

describe("warmUp", () => {
  it("succeeds on the first answer below 500, including 403 and 404", async () => {
    for (const status of [200, 304, 403, 404]) {
      const c = clock();
      const r = await warmUp("https://x/", { fetch: async () => ({ status }), ...c });
      expect(r).toMatchObject({ ok: true, status, attempts: 1 });
    }
  });

  it("retries after a 5xx and after a network error, then succeeds", async () => {
    const c = clock();
    const answers: (number | Error)[] = [503, new Error("ECONNRESET"), 200];
    const r = await warmUp("https://x/", {
      fetch: async () => {
        const a = answers.shift();
        if (a instanceof Error) throw a;
        return { status: a ?? 200 };
      },
      delayMs: 1000,
      ...c,
    });
    expect(r).toMatchObject({ ok: true, status: 200, attempts: 3, ms: 2000 });
  });

  it("gives up after the total timeout and reports the last error", async () => {
    const c = clock();
    const r = await warmUp("https://x/", {
      fetch: async () => ({ status: 502 }),
      timeoutMs: 10_000,
      delayMs: 3000,
      ...c,
    });
    expect(r).toMatchObject({ ok: false, lastError: "HTTP 502" });
    expect(r.attempts).toBe(4);
  });
});
