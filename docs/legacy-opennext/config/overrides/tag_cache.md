# Tag cache

The tag cache `azure-table` is an OpenNext `nextMode` tag cache backed by the Table `tagcache` (`CACHE_TABLE_NAME`). `revalidateTag` and `revalidatePath` write one row per tag; pages are not deleted. A reader compares the row's `revalidatedAt` with the entry's last-modified time.

| Column | Value |
| --- | --- |
| `PartitionKey` | `OPEN_NEXT_BUILD_ID` |
| `RowKey` | base64url of the tag (Table Storage forbids `/ \ # ? ` in keys) |
| `revalidatedAt` | epoch ms of the last `revalidateTag` |
| `stale`, `expire` | optional epoch ms for stale-while-revalidate semantics |

Entries are written on demand. Nothing needs to be seeded at deploy time.

Limits:

- `getLastRevalidated` is not supported (it returns `0`), like the DynamoDB `nextMode` implementation.
- Tags are read in batches: a single tag is a point read, several tags are one query per 14 row keys (Table Storage allows 15 comparisons in a `$filter`, one is the partition key), in parallel and cached per request, absent tags included. There is no limit on the number of tags. Verified (local): unit tests and Azurite with 40 tags. Whether it is faster than point reads on Azure is not measured.
- Automatic CDN invalidation does not apply: paths cannot be derived from a tag, and Front Door caches only `/_next/static/*`.
