# Configuration

## `withAzure()`

```js
import { withAzure } from "next-on-azure/config";
export default withAzure({ /* your Next.js configuration */ });
```

It returns your configuration with these changes. The app's own values for `images`, `experimental` and `cacheHandlers` are kept and extended; an incremental `cacheHandler` that the app sets itself is kept.

| Setting | Value | Why |
| --- | --- | --- |
| `output` | `"standalone"` | the build output the package is made from |
| `cacheHandler` | `next-on-azure/cache-handler` | incremental cache, `fetch` cache and `revalidateTag` on Blob and Table Storage |
| `cacheHandlers.default` (`experimental.cacheHandlers` before Next.js 16) | `next-on-azure/cache-handlers` | `'use cache'` on Blob and Table Storage; the place is chosen from the installed Next.js version |
| `cacheMaxMemorySize` | `0` | no per-instance memory cache: every instance sees the same state |
| `compress` | `false` | the Functions front end compresses; a compressed body would break the forward |
| `images.maximumDiskCacheSize`, `experimental.isrFlushToDisk` | `0`, `false` | the app directory is read-only on Azure: a write there fails with `EACCES` |

## Environment variables

The [Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/overview?wt.mc_id=studentamb_679600) template sets these on the Function app.

| Variable | Default | Used by |
| --- | --- | --- |
| `AZURE_STORAGE_ACCOUNT_NAME` | none (required unless a connection string is set) | cache handlers |
| `AZURE_STORAGE_CONNECTION_STRING` | none | cache handlers, local development with [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite?wt.mc_id=studentamb_679600) only |
| `CACHE_CONTAINER_NAME` | `cache` | incremental cache and `'use cache'` entries |
| `CACHE_TABLE_NAME` | `tagcache` | tag state |
| `NEXT_BUILD_ID` | the build id in `.next/BUILD_ID` | prefix of every key: entries of an older build are never read by a newer one |
| `WAIT_UNTIL_MODE` | `hold` | entry: `hold` keeps the response open until deferred work is done; `detach` ends it at once |
| `WAIT_UNTIL_MAX_SECONDS` | `220` | entry: the longest a response is held |
| `FRONT_DOOR_ID` | none (no check) | entry: answers 403 when `X-Azure-FDID` differs |
| `NEXT_INTERNAL_PORT` | `3000` | entry: loopback port of the Next.js server |
| `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` | `104857600` | Functions host (request bodies, Server Actions) |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | none | set at **build** time, not on the app: see [Get started](./get_started.md) |

## Authentication

The cache handlers use `AZURE_STORAGE_CONNECTION_STRING` when it is set (Azurite); otherwise they address the account named by `AZURE_STORAGE_ACCOUNT_NAME` over HTTPS with `DefaultAzureCredential`, which resolves to the managed identity in Azure.

## CLI

| Command | Effect |
| --- | --- |
| `next-on-azure package [--target azure\|local] [--allow-unsupported-next]` | Turns `.next/standalone` into `.next-azure/app.zip`. Refuses a Next.js version outside the supported range, warns about a missing or different Server Actions key. |
| `next-on-azure deploy -g <rg> -n <name> [-l <location>] [options]` | Provisions with Bicep, deploys the zip, waits for the app, primes the cache. Flags: [Get started](./get_started.md#3-deploy). |
| `next-on-azure prime <url>` | Requests every prerendered route once. |
