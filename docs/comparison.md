# Comparison

## OpenNext (AWS, Cloudflare)

The first design of this project was an OpenNext adapter ([Legacy](./legacy-opennext/README.md)). This one does not use `@opennextjs/aws` ([ADR-0016](./plan/decisions.md)).

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
