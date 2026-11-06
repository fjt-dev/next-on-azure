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

async function anyEntity(tags: string[], predicate: (e: TagEntity) => boolean): Promise<boolean> {
  const store = globalThis.__openNextAls?.getStore();
  const cache: Map<string, TagEntity | null> | undefined =
    store?.requestCache?.getOrCreate("azure-table:tags");
  const entities = await Promise.all(
    tags.map(async (tag) => {
      if (cache?.has(tag)) return cache.get(tag) ?? null;
      const entity = await getEntity(tag);
      cache?.set(tag, entity);
      return entity;
    }),
  );
  return entities.some((e) => e && predicate(e));
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
