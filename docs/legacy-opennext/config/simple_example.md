# Simple example

A complete `open-next.config.ts` for a Next.js app on Azure. The same file ships with the package as `open-next.config.example.ts`.

```ts
import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

const config = {
  default: {
    override: {
      wrapper: () => import("opennext-adapter-azure/overrides/wrapper.js").then((m) => m.default),
      converter: () => import("opennext-adapter-azure/overrides/converter.js").then((m) => m.default),
      incrementalCache: () => import("opennext-adapter-azure/overrides/incremental-cache.js").then((m) => m.default),
      tagCache: () => import("opennext-adapter-azure/overrides/tag-cache.js").then((m) => m.default),
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
      converter: () => import("opennext-adapter-azure/overrides/converter.js").then((m) => m.default),
    },
    loader: () => import("opennext-adapter-azure/overrides/image-loader.js").then((m) => m.default),
    install: { packages: ["sharp@0.33.5"], os: "linux", arch: "x64", libc: "glibc" },
  },
  revalidate: {
    override: {
      wrapper: () => import("opennext-adapter-azure/overrides/revalidate.js").then((m) => m.revalidateWrapper),
      converter: () => import("opennext-adapter-azure/overrides/revalidate.js").then((m) => m.revalidateConverter),
    },
  },
} satisfies OpenNextConfig;

export default config;
```

What each part does:

- `default.override` replaces the server entrypoint and the caches. See [Wrapper](./overrides/wrapper.md), [Converter](./overrides/converter.md), [Incremental cache](./overrides/incremental_cache.md), [Tag cache](./overrides/tag_cache.md) and [Revalidation queue](./overrides/queue.md).
- `middleware.external: false` keeps middleware inside the server function. The [Asset resolver](./overrides/asset_resolver.md) serves `/_next/static/*` and `public/` files from Blob Storage.
- `imageOptimization` runs the image function with the [Image loader](./overrides/image_loader.md). `install` makes `sharp` for Linux x64 part of the bundle.
- `revalidate` handles queue messages that regenerate stale pages. See [Revalidation](./overrides/revalidate.md).

Next: [Reference](./reference.md).
