# Reference

## Authentication

All overrides use the same logic (`clients.ts`):

1. If `AZURE_STORAGE_CONNECTION_STRING` is set (local development with Azurite), it is used.
2. Otherwise the account named by `AZURE_STORAGE_ACCOUNT_NAME` is addressed over HTTPS with `DefaultAzureCredential`, which resolves to the managed identity in Azure.

## Environment variables

The Bicep template sets these on the Function app.

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
| `REVALIDATION_DEDUPE_SECONDS` | `60` | queue: how long a request that found a page stale holds the right to enqueue its revalidation (0 = off). See [Revalidation queue](./overrides/queue.md) |
| `OPENNEXT_STATIC_ETAG` | `true` in the Bicep template | image adapter: ETag and `304` for optimized images ([ADR-0014](../plan/decisions.md)) |
| `OPEN_NEXT_BUILD_ID` | set by OpenNext at build time | all caches (key prefix) |
| `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` | `104857600` | Functions host (request bodies, Server Actions) |
| `OPEN_NEXT_DEBUG` | unset | OpenNext build: verbose logs, no minification, source maps. Set before the build, never in production |

## CLI

| Command | Effect |
| --- | --- |
| `opennext-azure package` | Turns `.open-next/` into `.open-next-azure/app.zip`, one Function app |
| `opennext-azure deploy` | Deploys the Bicep template, uploads assets and cache, deploys the zip. Flags are listed in [Get started](../get_started.md#4-deploy) |
