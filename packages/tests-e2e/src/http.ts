import fs from "node:fs";
import https from "node:https";
import path from "node:path";
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
 * HTTPS request that trusts exactly the certificate created for this stack run, so TLS is verified
 * instead of switched off. Not fetch, because chunk timing is needed to prove streaming.
 */
export function request(
  pathAndQuery: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const base = new URL(inject("baseUrl"));
  const ca = fs.readFileSync(path.join(inject("runDir"), "cert.pem"));
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: base.hostname,
        port: base.port,
        path: pathAndQuery,
        method: options.method ?? "GET",
        headers: options.headers,
        ca,
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

/** All lines of the Function host log of this run. */
export function hostLog(): string {
  return fs.readFileSync(path.join(inject("runDir"), "app.log"), "utf8");
}
