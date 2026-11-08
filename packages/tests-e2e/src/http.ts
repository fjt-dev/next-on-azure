import http from "node:http";
import https from "node:https";
import { inject } from "vitest";

export type Chunk = { atMs: number; text: string };
export type Response = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text: string;
  /** Body chunks with the time (ms since the request was sent) each one arrived. */
  chunks: Chunk[];
  /** Time to the response headers, in ms. */
  headersAtMs: number;
  totalMs: number;
};

/**
 * HTTP(S) request to the app under test. Not fetch, because chunk timing is needed to prove
 * streaming. A deployment has a certificate from a public CA; plain http is for an app started on
 * loopback (see scripts/e2e-standalone.mjs).
 */
export function request(
  pathAndQuery: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const base = new URL(inject("baseUrl"));
  const plain = base.protocol === "http:";
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const req = (plain ? http : https).request(
      {
        host: base.hostname,
        port: base.port || (plain ? 80 : 443),
        path: pathAndQuery,
        method: options.method ?? "GET",
        // A known length avoids chunked uploads, which the Functions Core Tools host over plain http never answers.
        headers: {
          ...(options.body !== undefined
            ? { "content-length": String(Buffer.byteLength(options.body)) }
            : {}),
          ...options.headers,
        },
      },
      (res) => {
        const headersAtMs = performance.now() - started;
        const chunks: Chunk[] = [];
        const parts: Buffer[] = [];
        res.on("data", (d: Buffer) => {
          parts.push(d);
          chunks.push({ atMs: performance.now() - started, text: d.toString("utf8") });
        });
        res.on("end", () => {
          const body = Buffer.concat(parts);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            text: body.toString("utf8"),
            chunks,
            headersAtMs,
            totalMs: performance.now() - started,
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

export const header = (r: Response, name: string) => {
  const v = r.headers[name.toLowerCase()];
  return Array.isArray(v) ? v.join(", ") : v;
};

/**
 * Cache status of a page: Next.js sets `x-nextjs-cache`.
 */
export const cacheStatus = (r: Response) => header(r, "x-nextjs-cache");

/**
 * A page that is not stale: the first answer of a time-based ISR test must be a page that is still
 * within its revalidate window. After a deployment whose routes were primed, or when other tests ran
 * for a few seconds, the first answer can already be STALE and start a regeneration of its own.
 */
export async function freshPage(pathAndQuery: string, timeoutMs = 30_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(pathAndQuery);
    if (cacheStatus(res) !== "STALE" || Date.now() > deadline) return res;
    await sleep(1000);
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls until `check` returns a truthy value or the timeout passes. */
export async function eventually<T>(
  check: () => Promise<T | false | undefined>,
  timeoutMs = 20_000,
  everyMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await sleep(everyMs);
  }
}

/** The ISO timestamp rendered by the example pages (`isr`, `tagged`). */
export const timestampIn = (html: string) => /20\d\d-\d\d-\d\dT[\d:.]+Z/.exec(html)?.[0];

/** false when the target is a deployed app: its host log is not a local file. */
