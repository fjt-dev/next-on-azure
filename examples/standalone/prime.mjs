// Requests every route that `next build` prerendered, so that its page is rendered once and stored in
// the cache (Blob) before visitors arrive. Next.js does not read the build's prerendered files when a
// custom cache handler is set: without this step each page is rendered on its first request after a
// deployment (ADR-0016). Usage: node prime.mjs <base url>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2];
if (!base) {
  console.error("usage: node prime.mjs <base url>");
  process.exit(1);
}
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), ".next/prerender-manifest.json"),
    "utf8",
  ),
);
const routes = Object.keys(manifest.routes).filter((r) => r !== "/_not-found");
const started = performance.now();
let failed = 0;
const queue = [...routes];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let route = queue.shift(); route !== undefined; route = queue.shift()) {
      const res = await fetch(new URL(route, base), { redirect: "manual" });
      await res.arrayBuffer();
      const cache = res.headers.get("x-nextjs-cache") ?? "-";
      if (res.status >= 400) failed++;
      console.log(`${res.status} ${cache.padEnd(5)} ${route}`);
    }
  }),
);
console.log(
  `primed ${routes.length} routes in ${((performance.now() - started) / 1000).toFixed(1)} s, ${failed} failed`,
);
process.exit(failed > 0 ? 1 : 0);
