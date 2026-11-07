# Configuration

OpenNext is configured with an `open-next.config.ts` file next to your `next.config.js`. It exports an object that satisfies the `OpenNextConfig` interface from `@opennextjs/aws`. This adapter provides the Azure implementations of the platform-specific parts, called *overrides*. Each one is imported from `opennext-adapter-azure/overrides/<name>.js`.

- [Simple example](./simple_example.md): a complete `open-next.config.ts` for Azure
- [Reference](./reference.md): authentication and every environment variable
- Overrides, one page each: [Wrapper](./overrides/wrapper.md), [Converter](./overrides/converter.md), [Incremental cache](./overrides/incremental_cache.md), [Tag cache](./overrides/tag_cache.md), [Revalidation queue](./overrides/queue.md), [Image loader](./overrides/image_loader.md), [Asset resolver](./overrides/asset_resolver.md), [Revalidation](./overrides/revalidate.md)

## Overrides at a glance

| Override | Module | OpenNext slot | Azure service |
| --- | --- | --- | --- |
| Wrapper | `wrapper.js` | `override.wrapper` | Functions v4 HTTP trigger with streaming |
| Converter | `converter.js` | `override.converter` | `HttpRequest` to `InternalEvent` |
| Incremental cache | `incremental-cache.js` | `override.incrementalCache` | Blob Storage |
| Tag cache | `tag-cache.js` | `override.tagCache` | Table Storage (`nextMode`) |
| Queue | `queue.js` | `override.queue` | Storage Queue |
| Asset resolver | `asset-resolver.js` | `middleware.assetResolver` | Blob Storage + manifest |
| Image loader | `image-loader.js` | `imageOptimization.loader` | Blob Storage |
| Revalidation wrapper | `revalidate.js` (`revalidateWrapper`) | `revalidate.override.wrapper` | Queue trigger |
| Revalidation converter | `revalidate.js` (`revalidateConverter`) | `revalidate.override.converter` | Queue message |

## Writing your own override

Any OpenNext override can be replaced independently. For example, to use Cosmos DB for tags, implement the `NextModeTagCache` interface from `@opennextjs/aws/types/overrides` and point `override.tagCache` at it. See the [OpenNext custom overrides guide](https://opennext.js.org/aws/config/custom_overrides).
