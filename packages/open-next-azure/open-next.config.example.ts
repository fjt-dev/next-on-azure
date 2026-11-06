// Example open-next.config.ts for a Next.js app deployed with opennextjs-azure.
import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

const config = {
  default: {
    override: {
      wrapper: () => import("opennextjs-azure/overrides/wrapper.js").then((m) => m.default),
      converter: () => import("opennextjs-azure/overrides/converter.js").then((m) => m.default),
      incrementalCache: () =>
        import("opennextjs-azure/overrides/incremental-cache.js").then((m) => m.default),
      tagCache: () => import("opennextjs-azure/overrides/tag-cache.js").then((m) => m.default),
      queue: () => import("opennextjs-azure/overrides/queue.js").then((m) => m.default),
    },
  },
  middleware: {
    external: false,
    // Serves /_next/static and public files from Blob Storage (exact paths from assets-manifest.json).
    assetResolver: () =>
      import("opennextjs-azure/overrides/asset-resolver.js").then((m) => m.default),
  },
  imageOptimization: {
    override: {
      wrapper: () => import("opennextjs-azure/overrides/wrapper.js").then((m) => m.default),
      converter: () => import("opennextjs-azure/overrides/converter.js").then((m) => m.default),
    },
    loader: () => import("opennextjs-azure/overrides/image-loader.js").then((m) => m.default),
    install: { packages: ["sharp@0.33.5"], os: "linux", arch: "x64", libc: "glibc" },
  },
  revalidate: {
    override: {
      wrapper: () =>
        import("opennextjs-azure/overrides/revalidate.js").then((m) => m.revalidateWrapper),
      converter: () =>
        import("opennextjs-azure/overrides/revalidate.js").then((m) => m.revalidateConverter),
    },
  },
} satisfies OpenNextConfig;

export default config;
