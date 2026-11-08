/**
 * After a deployment the first request is the slowest one (measured up to 25.7 s: the instance
 * fetches the package and starts the host). `deploy` makes that request itself, so a visitor does
 * not, and it reports how long the app took to answer.
 *
 * Any answer below 500 counts as "up": a 403 from the Front Door check or a 404 still proves that
 * the Function host and the app code are running.
 */
export type WarmUpOptions = {
  fetch?: (url: string, init: { signal: AbortSignal }) => Promise<{ status: number }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Give up after this many ms in total. */
  timeoutMs?: number;
  /** Per attempt. */
  attemptTimeoutMs?: number;
  delayMs?: number;
};

export type WarmUpResult =
  | { ok: true; status: number; attempts: number; ms: number }
  | { ok: false; attempts: number; ms: number; lastError: string };

export async function warmUp(url: string, options: WarmUpOptions = {}): Promise<WarmUpResult> {
  const doFetch = options.fetch ?? ((u, init) => fetch(u, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 60_000;
  const delayMs = options.delayMs ?? 5_000;

  const started = now();
  let attempts = 0;
  let lastError = "no attempt";
  while (now() - started < timeoutMs) {
    attempts += 1;
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(attemptTimeoutMs) });
      if (res.status < 500) return { ok: true, status: res.status, attempts, ms: now() - started };
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await sleep(delayMs);
  }
  return { ok: false, attempts, ms: now() - started, lastError };
}
