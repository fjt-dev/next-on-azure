// Example open-next.config.ts for a Next.js app deployed with opennext-adapter-azure.
import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

const config = {
  default: {
    override: {
      wrapper: () => import("opennext-adapter-azure/overrides/wrapper.js").then((m) => m.default),
      converter: () =>
        import("opennext-adapter-azure/overrides/converter.js").then((m) => m.default),
      incrementalCache: () =>
        import("opennext-adapter-azure/overrides/incremental-cache.js").then((m) => m.default),
      tagCache: () =>
        import("opennext-adapter-azure/overrides/tag-cache.js").then((m) => m.default),
      queue: () => import("opennext-adapter-azure/overrides/queue.js").then((m) => m.default),
    },
  },
  middleware: {
    external: false,
    // Serves /_next/static and public files from Blob Storage (exact paths from assets-manifest.json).
    assetResolver: () =>
      import("opennext-adapter-azure/overrides/asset-resolver.js").then((m) => m.default),
  },
  imageOptimization: {
    override: {
      wrapper: () => import("opennext-adapter-azure/overrides/wrapper.js").then((m) => m.default),
      converter: () =>
        import("opennext-adapter-azure/overrides/converter.js").then((m) => m.default),
    },
    loader: () => import("opennext-adapter-azure/overrides/image-loader.js").then((m) => m.default),
    install: { packages: ["sharp@0.33.5"], os: "linux", arch: "x64", libc: "glibc" },
  },
  revalidate: {
    override: {
      wrapper: () =>
        import("opennext-adapter-azure/overrides/revalidate.js").then((m) => m.revalidateWrapper),
      converter: () =>
        import("opennext-adapter-azure/overrides/revalidate.js").then((m) => m.revalidateConverter),
    },
  },
} satisfies OpenNextConfig;

export default config;
