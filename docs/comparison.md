# Comparison

## OpenNext (AWS, Cloudflare)

This project started as an OpenNext adapter (its first design is in [Legacy](./legacy-opennext/README.md)) and moved to a design without `@opennextjs/aws` ([ADR-0016](./plan/decisions.md)). The reason is the maintainer's decision; the technical difference is below.

| | OpenNext (`@opennextjs/aws`) | next-on-azure |
| --- | --- | --- |
| How Next.js runs | The build output is re-bundled; OpenNext's own server code does routing, middleware, caching and image optimization, and the platform is reached through *overrides* | Next.js's own standalone server runs as it is, inside the Function; only storage and the entry are Azure-specific |
| Supported Next.js versions | what OpenNext declares | the `next` peer range of this package (inherited, not re-derived) |
| Storage interfaces | OpenNext's overrides (incremental cache, tag cache, queue, ...) | Next.js's `cacheHandler` and `cacheHandlers` |
| ISR | regenerated through a queue consumer | regenerated in the same process; no queue |
| Static files | an asset resolver serving from Blob with a manifest | served by the Next.js server from the package |
| Images | OpenNext's image adapter (missing source image: 500, mapped to 404) | Next.js's optimizer (missing source image: 400 on Next.js 15) |
| Function splitting, external middleware, edge runtime | supported on AWS and Cloudflare | not supported |
| Package size (same example app) | 31.2 MB zip, three bundles | 17.7 MB zip, one |
| First request after about 11 minutes idle | 4.1 to 4.5 s (earlier measurement, other package) | 2.4 s (one sample) |

Differences that come from Next.js's own server: the `Cache-Control` of `public/` files, `application/javascript` as the JS content type, weak `ETag`s on static files, and 400 for a missing source image. The shared HTTP test suite accepts these when `E2E_TARGET=standalone`.

## The Next.js Adapter API

The Adapter API (`adapterPath`, `onBuildComplete`) is a build-time interface, stable since Next.js 16.2 (read through a research agent in [ADR-0012](./plan/decisions.md), not by the maintainer). This package does not use it: `standalone` and the cache handler options exist on Next.js 15 and 16, and they were enough. Using it on 16.2 and later for the packaging step is an open option.

## What this project does that is Azure-specific

Identity-based access without shared keys, a Bicep template for one Flex Consumption app, the `after()` hold with its measured background ([Azure notes](./inner_workings/azure_notes.md), item 18), priming after a deployment, flattening of the pnpm layout, and an Azure E2E run from CI with automatic teardown (`.github/workflows/azure-e2e.yml`, still written for the OpenNext-based package).
