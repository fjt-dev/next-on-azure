# Incremental cache

The incremental cache `azure-blob` stores pre-rendered pages, `fetch` results and Composable Caching (`'use cache'`) entries in the Blob container `cache` (`CACHE_CONTAINER_NAME`).

The layout is the same as the S3 override of `@opennextjs/aws`:

| Entry | Blob name |
| --- | --- |
| Page, RSC payload, JSON | `[prefix/]<buildId>/<key>.cache` |
| Composable cache | `[prefix/]<buildId>/<key>.composable` |
| `fetch` result | `[prefix/]__fetch/<buildId>/<key>` |

`prefix` is `CACHE_BLOB_PREFIX`. A missing blob (404) is a cache miss.

Blob `Last-Modified` has one-second resolution, but the tag cache compares it with millisecond revalidation times. So the write time is also stored in milliseconds as blob metadata (`writtenatms`) and preferred when present; blobs without it, such as the prerendered cache uploaded at deploy time, fall back to `Last-Modified`.

`deploy` uploads `.open-next/cache` to this container. See [Caching and revalidation](../../inner_workings/caching.md).
