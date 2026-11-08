import fs from "node:fs";
import path from "node:path";

/**
 * Requests every route that `next build` prerendered, so that its page is rendered once and stored in
 * the cache (Blob) before visitors arrive. With a custom cache handler Next.js does not read the
 * build's prerendered files: without this step each page is rendered on its first request after a
 * deployment (ADR-0016).
 */
export type PrimeResult = { routes: number; failed: number; ms: number };

export function prerenderedRoutes(appDir = process.cwd()): string[] {
  const file = path.join(appDir, ".next/prerender-manifest.json");
  if (!fs.existsSync(file)) throw new Error(`${file} not found. Run "next build" first.`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as {
    routes?: Record<string, unknown>;
  };
  return Object.keys(manifest.routes ?? {}).filter((route) => route !== "/_not-found");
}

export async function prime(
  baseUrl: string,
  options: {
    appDir?: string;
    concurrency?: number;
    fetch?: typeof fetch;
    log?: (line: string) => void;
  } = {},
): Promise<PrimeResult> {
  const doFetch = options.fetch ?? fetch;
  const log = options.log ?? console.log;
  const routes = prerenderedRoutes(options.appDir);
  const queue = [...routes];
  const started = performance.now();
  let failed = 0;
  await Promise.all(
    Array.from({ length: options.concurrency ?? 4 }, async () => {
      for (let route = queue.shift(); route !== undefined; route = queue.shift()) {
        try {
          const res = await doFetch(new URL(route, baseUrl), { redirect: "manual" });
          await res.arrayBuffer();
          if (res.status >= 400) failed++;
          log(`${res.status} ${(res.headers.get("x-nextjs-cache") ?? "-").padEnd(5)} ${route}`);
        } catch (error) {
          failed++;
          log(`ERR   ${route}: ${(error as Error).message}`);
        }
      }
    }),
  );
  return { routes: routes.length, failed, ms: performance.now() - started };
}
