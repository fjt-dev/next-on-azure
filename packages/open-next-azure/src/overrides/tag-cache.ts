import type {} from "@opennextjs/aws/types/global";
import type { NextModeTagCache } from "@opennextjs/aws/types/overrides";
import { getTableClient } from "./clients.js";

/**
 * Tag cache on Azure Table Storage ("nextMode": one entity per revalidated tag).
 *
 *   PartitionKey = OPEN_NEXT_BUILD_ID, RowKey = base64url(tag)
 *   revalidatedAt / stale / expire = epoch ms
 *
 * Table Storage forbids / \ # ? in keys, hence the base64url encoding.
 */
const table = () => getTableClient(process.env.CACHE_TABLE_NAME ?? "tagcache");
const partition = () => process.env.OPEN_NEXT_BUILD_ID ?? "default";
const rowKey = (tag: string) => Buffer.from(tag).toString("base64url");

type TagEntity = { revalidatedAt?: number; stale?: number; expire?: number };

async function getEntity(tag: string): Promise<TagEntity | null> {
  try {
    return (await (await table()).getEntity<TagEntity>(partition(), rowKey(tag))) as TagEntity;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) return null;
    throw e;
  }
}

/**
 * Table Storage allows at most 15 discrete comparisons in one `$filter`. One is the partition key,
 * so a query can ask for 14 row keys.
 */
export const MAX_KEYS_PER_QUERY = 14;

/** Reads several tags with as few requests as possible: one query per 14 tags instead of one request per tag. */
async function getEntities(tags: string[]): Promise<Map<string, TagEntity | null>> {
  const found = new Map<string, TagEntity | null>();
  if (tags.length === 1) {
    found.set(tags[0] as string, await getEntity(tags[0] as string));
    return found;
  }
  const client = await table();
  const byRowKey = new Map(tags.map((tag) => [rowKey(tag), tag]));
  const rowKeys = [...byRowKey.keys()];
  const groups: string[][] = [];
  for (let i = 0; i < rowKeys.length; i += MAX_KEYS_PER_QUERY) {
    groups.push(rowKeys.slice(i, i + MAX_KEYS_PER_QUERY));
  }
  // base64url holds no quote characters, so the keys need no escaping in the filter.
  await Promise.all(
    groups.map(async (group) => {
      const filter = `PartitionKey eq '${partition()}' and (${group.map((k) => `RowKey eq '${k}'`).join(" or ")})`;
      for await (const entity of client.listEntities<TagEntity>({ queryOptions: { filter } })) {
        const tag = byRowKey.get(entity.rowKey as string);
        if (tag !== undefined) found.set(tag, entity as TagEntity);
      }
    }),
  );
  for (const tag of tags) if (!found.has(tag)) found.set(tag, null);
  return found;
}

async function anyEntity(tags: string[], predicate: (e: TagEntity) => boolean): Promise<boolean> {
  const store = globalThis.__openNextAls?.getStore();
  const cache: Map<string, TagEntity | null> | undefined =
    store?.requestCache?.getOrCreate("azure-table:tags");
  const unique = [...new Set(tags)];
  const missing = unique.filter((tag) => !cache?.has(tag));
  const fetched =
    missing.length > 0 ? await getEntities(missing) : new Map<string, TagEntity | null>();
  for (const [tag, entity] of fetched) cache?.set(tag, entity);
  return unique.some((tag) => {
    const entity = fetched.has(tag) ? fetched.get(tag) : cache?.get(tag);
    return !!entity && predicate(entity);
  });
}

const tagCache: NextModeTagCache = {
  name: "azure-table",
  mode: "nextMode",

  // Not supported (same as the DynamoDB nextMode implementation).
  getLastRevalidated: async () => 0,

  async hasBeenRevalidated(tags, lastModified) {
    if (globalThis.openNextConfig?.dangerous?.disableTagCache) return false;
    if (tags.length === 0) return false;
    const now = Date.now();
    const last = lastModified ?? 0;
    return anyEntity(tags, (e) => {
      if (e.expire && e.expire <= now && e.expire > last) return true;
      return (e.revalidatedAt ?? 0) > last;
    });
  },

  async isStale(tags, lastModified) {
    if (globalThis.openNextConfig?.dangerous?.disableTagCache) return false;
    if (tags.length === 0) return false;
    const last = lastModified ?? 0;
    return anyEntity(tags, (e) => !!e.stale && (e.revalidatedAt ?? 0) > last && e.stale >= last);
  },

  async writeTags(tags) {
    if (globalThis.openNextConfig?.dangerous?.disableTagCache) return;
    const now = Date.now();
    await Promise.all(
      tags.map((t) => {
        const tag = typeof t === "string" ? t : t.tag;
        return table().then((tbl) =>
          tbl.upsertEntity(
            {
              partitionKey: partition(),
              rowKey: rowKey(tag),
              revalidatedAt: now,
              ...(typeof t === "string" || t.stale === undefined ? {} : { stale: t.stale }),
              ...(typeof t === "string" || t.expire === undefined ? {} : { expire: t.expire }),
            },
            "Replace",
          ),
        );
      }),
    );
  },
};

export default tagCache;
