# Caching and revalidation

> Local behavior was verified with Azurite. End-to-end behavior on Azure is **unverified**.

Next.js stores three kinds of data in its incremental cache: pre-rendered pages (HTML, RSC payload, JSON), `fetch` results and composable cache entries. This package maps them as follows.

## Layers

| Layer | Storage | Written by |
| --- | --- | --- |
| Pre-rendered pages from `next build` | Blob `cache` container | `opennext-azure deploy` uploads `.open-next/cache` |
| Pages and data regenerated at runtime | Blob `cache` container | The incremental cache override |
| Tag revalidation state | Table `tagcache` | The tag cache override, on `revalidateTag` / `revalidatePath` |
| Deferred revalidation work | Storage Queue `revalidation` | The queue override |

## Reading a cached page

1. The incremental cache override downloads `<buildId>/<key>.<ext>` from Blob. A missing blob (404) is a cache miss.
2. The tag cache override checks whether any tag of the entry was revalidated after the entry's `lastModified` (Blob `Last-Modified`).
3. If a tag is stale (but not expired), the entry is served and a background revalidation is requested.

## Time-based ISR (`revalidate = N`)

1. A request arrives after the entry is older than `N` seconds.
2. The server serves the stale entry immediately and sends `{ host, url, lastModified, eTag }` to the queue.
3. The `revalidation` app receives the message and issues a `HEAD` request to `https://<host><url>` with the preview-mode revalidation header and `x-isr: 1`.
4. The server regenerates the page and writes it to Blob. The next request gets the fresh page.
5. If the response is not `REVALIDATED` (or not 200/307/308/404), the message fails, is retried up to 3 times and then goes to `revalidation-poison`.

## On-demand revalidation

`revalidateTag("posts")` writes one row to the tag table. Pages are not deleted; readers compare the row's `revalidatedAt` with the entry's `lastModified`, so revalidation is O(tags) writes and O(tags) reads per cached read, with results memoized per request.

This `nextMode` design does not support automatic CDN invalidation, because paths cannot be derived from a tag. Front Door does not cache the server route, so this has no visible effect today.

## Known limitations

- Storage Queues cannot deduplicate messages. A hot stale page can enqueue several revalidations; they are idempotent but each costs a render.
- `getLastRevalidated` is not supported (it returns `0`), same as the DynamoDB `nextMode` implementation.
- Tag lookups use one point read per tag. Pages with hundreds of tags will be slow; batching is a possible optimization.
