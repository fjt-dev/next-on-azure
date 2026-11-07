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
- Tags are read one entity per tag, cached per request. The official `nextMode` implementation batches the reads; a page with many tags makes many Table requests here.
- Automatic CDN invalidation does not apply: paths cannot be derived from a tag, and Front Door caches only `/_next/static/*`.
