import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Spike (ADR-0016): the Next.js server runs as it is; only the cache is replaced.
export default {
  output: "standalone",
  // The workspace root, so that the files pnpm links into node_modules are traced and copied.
  outputFileTracingRoot: path.join(here, "../.."),
  cacheHandler: path.join(here, "cache-handler.cjs"),
  compress: false, // the Functions host and a CDN compress; a compressed body would break the forward
  cacheMaxMemorySize: 0, // no per-instance memory cache: every instance sees the same state
  experimental: {
    useCache: true,
    cacheHandlers: { default: path.join(here, "cache-handlers.cjs") },
  },
};
