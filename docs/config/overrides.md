# Overrides

OpenNext lets you replace each platform-specific piece of the runtime with an *override*. This package provides the Azure implementations. Each is imported from `opennext-adapter-azure/overrides/<name>.js` in `open-next.config.ts` (see [Get started](../get_started.md)).

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

## Authentication

All overrides use the same logic (`clients.ts`):

1. If `AZURE_STORAGE_CONNECTION_STRING` is set (local development with Azurite), it is used.
2. Otherwise the account named by `AZURE_STORAGE_ACCOUNT_NAME` is addressed over HTTPS with `DefaultAzureCredential`, which resolves to the managed identity in Azure.

## Environment variables

The Bicep template sets these on the Function apps.

| Variable | Default | Used by |
| --- | --- | --- |
| `AZURE_STORAGE_ACCOUNT_NAME` | none (required unless a connection string is set) | all |
| `AZURE_STORAGE_CONNECTION_STRING` | none | all, local development only |
| `CACHE_CONTAINER_NAME` | `cache` | incremental cache |
| `CACHE_BLOB_PREFIX` | empty | incremental cache |
| `ASSETS_CONTAINER_NAME` | `assets` | image loader, asset resolver |
| `ASSETS_BLOB_PREFIX` | empty | image loader, asset resolver |
| `ASSETS_MANIFEST_PATH` | set by the generated `main.mjs` to `server/assets-manifest.json` | asset resolver |
| `FRONT_DOOR_ID` | none (no check) | wrapper: rejects requests whose `X-Azure-FDID` differs |
| `WAIT_UNTIL_MODE` | `hold` | wrapper: `hold` keeps the response open until deferred work (`after()`, queue enqueue) has settled; `detach` ends the response at once and lets the work run on. See [ADR-0006](../plan/decisions.md#adr-0006-waituntil-via-response-stream) for the Azure measurements. Set it through the Bicep parameter, not with `az` (the next deploy would remove it) |
| `CACHE_TABLE_NAME` | `tagcache` | tag cache |
| `REVALIDATION_QUEUE_NAME` | `revalidation` | queue, revalidation trigger |
| `REVALIDATION_DEDUPE_SECONDS` | `60` | queue: how long a request that found a page stale holds the right to enqueue its revalidation (0 = off). See [Queue behavior](#queue-behavior) |
| `OPEN_NEXT_BUILD_ID` | set by OpenNext at build time | all caches (key prefix) |
| `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` | `104857600` | Functions host (request bodies, Server Actions) |

## Asset resolver

Serves `/_next/static/*` and `public/` files. `opennext-azure package` writes `assets-manifest.json` (path, size, content type, SHA-1 based ETag for every file in `.open-next/assets`, except OpenNext's internal `BUILD_ID`). Only listed paths are served, by exact match; everything else goes on to Next.js, so metadata routes such as `robots` or `sitemap` that the server renders are never shadowed. Behavior:

| Request | Response |
| --- | --- |
| `GET` / `HEAD` of a listed path | 200 with `content-type`, `etag`, `content-length`, `accept-ranges: bytes` |
| `_next/static/*` | `cache-control: public, max-age=31536000, immutable` |
| other files | `cache-control: public, max-age=0, must-revalidate` |
| `If-None-Match` matching the ETag | 304 |
| `Range: bytes=a-b` (single range) | 206 with `content-range`; an unsatisfiable range gives 416 |
| other methods, unlisted paths | passed on to Next.js |

If a listed file is missing in storage the resolver logs the inconsistency and lets Next.js answer.

## Wrapper and converter

The wrapper returns a function that you register with `app.http`. The generated `main.mjs` does this for you (one registration per bundle: `server` on `{*path}`, `image` on `_next/image`, and the queue trigger):

```js
app.setup({ enableHttpStream: true });
const server = await load("server"); // chdir into the bundle, then import it
app.http("server", { methods, authLevel: "anonymous", route: "{*path}", handler: server });
```

When `FRONT_DOOR_ID` is set the wrapper answers 403 before doing anything else if `X-Azure-FDID` is missing or different.

`host.json` sets `routePrefix` to an empty string so Next.js routes are served from `/` instead of `/api`.

The converter reads the public host from `x-forwarded-host` (set by Front Door) and the client address from `x-azure-clientip` or `x-forwarded-for`.

## Tag cache layout

| Column | Value |
| --- | --- |
| `PartitionKey` | `OPEN_NEXT_BUILD_ID` |
| `RowKey` | base64url of the tag (Table Storage forbids `/ \ # ?` in keys) |
| `revalidatedAt` | epoch ms of the last `revalidateTag` |
| `stale`, `expire` | optional epoch ms for stale-while-revalidate semantics |

Entries are written on demand. Nothing needs to be seeded at deploy time.

## Queue behavior

Messages are plain JSON (`{ host, url, lastModified, eTag }`), so `host.json` sets `extensions.queues.messageEncoding` to `none`. Storage Queues have no deduplication or message groups, so `MessageDeduplicationId` and `MessageGroupId` are ignored. **Deduplication.** Before enqueueing, a request must win a claim on the page: a row in the tag table (partition `dedupe-<build id>`) created or replaced with optimistic concurrency, so one message per page and window however many requests find it stale ([ADR-0010](../plan/decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group)). The page version is the ETag of the cached content; a regeneration with new content allows the next claim at once. Without a known version only `REVALIDATION_DEDUPE_SECONDS` decides. If the claim cannot be made (storage error) the message is enqueued anyway.

A failed revalidation throws, the host retries up to `maxDequeueCount` (3), and then moves the message to the `revalidation-poison` queue.

## Writing your own override

Any OpenNext override can be replaced independently. For example, to use Cosmos DB for tags, implement the `NextModeTagCache` interface from `@opennextjs/aws/types/overrides` and point `override.tagCache` at it. See the [OpenNext custom overrides guide](https://opennext.js.org/aws/config/custom_overrides).
