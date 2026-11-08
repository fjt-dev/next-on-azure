import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Adds what Next.js needs to run on one Azure Function (ADR-0016, ADR-0017):
 *
 *   // next.config.mjs
 *   import { withAzure } from "next-on-azure/config";
 *   export default withAzure({ ...your config });
 *
 * - `output: "standalone"`: the build output the package is made from.
 * - `cacheHandler` and `cacheHandlers`: the incremental cache and `'use cache'` on Blob and Table
 *   Storage. Next.js 16 moved `cacheHandlers` out of `experimental`; the right place is chosen from
 *   the installed version.
 * - `cacheMaxMemorySize: 0`: no per-instance memory cache, every instance sees the same state.
 * - `compress: false`: the Functions front end compresses; a compressed body would break the forward.
 * - `images.maximumDiskCacheSize: 0` and `experimental.isrFlushToDisk: false`: the app directory is
 *   read-only on Azure, a write there fails with EACCES.
 */

// biome-ignore lint/suspicious/noExplicitAny: a Next.js config has no type this package can import.
type NextConfig = Record<string, any>;

const runtime = (file: string) => fileURLToPath(new URL(`./runtime/${file}`, import.meta.url));

/** The major version of the `next` that the app resolves, or undefined if it cannot be read. */
export function nextMajor(cwd = process.cwd()): number | undefined {
  try {
    const manifest = createRequire(path.join(cwd, "package.json"))("next/package.json") as {
      version?: string;
    };
    const major = Number(manifest.version?.split(".")[0]);
    return Number.isInteger(major) ? major : undefined;
  } catch {
    return undefined;
  }
}

export function withAzure(
  config: NextConfig = {},
  options: { nextMajor?: number } = {},
): NextConfig {
  const major = options.nextMajor ?? nextMajor();
  const handlers = runtime("cache-handlers.cjs");
  const out: NextConfig = {
    ...config,
    output: "standalone",
    compress: false,
    cacheHandler: config.cacheHandler ?? runtime("cache-handler.cjs"),
    cacheMaxMemorySize: 0,
    images: { ...config.images, maximumDiskCacheSize: 0 },
    experimental: { ...config.experimental, isrFlushToDisk: false },
  };
  if (major !== undefined && major >= 16) {
    out.cacheHandlers = { default: handlers, ...config.cacheHandlers };
  } else {
    out.experimental.cacheHandlers = { default: handlers, ...config.experimental?.cacheHandlers };
  }
  return out;
}
