import { Readable } from "node:stream";

/** In-memory stand-ins for the parts of the Azure SDKs the overrides use. */

type Blob = {
  body: Buffer;
  contentType?: string;
  lastModified: Date;
  metadata?: Record<string, string>;
};

export function fakeBlobService() {
  const store = new Map<string, Blob>(); // "container/name" -> blob
  const downloads: { container: string; name: string; offset?: number; count?: number }[] = [];
  const uploads: { container: string; name: string; contentType?: string }[] = [];

  const service = {
    getContainerClient(container: string) {
      return {
        getBlockBlobClient(name: string) {
          const key = `${container}/${name}`;
          return {
            async download(offset?: number, count?: number) {
              downloads.push({ container, name, offset, count });
              const blob = store.get(key);
              if (!blob) throw Object.assign(new Error("BlobNotFound"), { statusCode: 404 });
              const start = offset ?? 0;
              const slice = blob.body.subarray(
                start,
                count === undefined ? undefined : start + count,
              );
              return {
                readableStreamBody: Readable.from([slice]),
                lastModified: blob.lastModified,
                contentType: blob.contentType,
                metadata: blob.metadata,
                cacheControl: "public, max-age=60",
              };
            },
            async upload(
              body: string | Buffer,
              _length: number,
              options?: {
                blobHTTPHeaders?: { blobContentType?: string };
                metadata?: Record<string, string>;
              },
            ) {
              const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
              const contentType = options?.blobHTTPHeaders?.blobContentType;
              uploads.push({ container, name, contentType });
              store.set(key, {
                body: buf,
                contentType,
                lastModified: new Date(),
                metadata: options?.metadata,
              });
            },
            async deleteIfExists() {
              store.delete(key);
            },
          };
        },
      };
    },
  };

  return {
    service,
    store,
    downloads,
    uploads,
    put(container: string, name: string, body: string | Buffer, contentType?: string) {
      store.set(`${container}/${name}`, {
        body: Buffer.isBuffer(body) ? body : Buffer.from(body),
        contentType,
        lastModified: new Date(),
      });
    },
  };
}

type Entity = { partitionKey: string; rowKey: string; [k: string]: unknown };

export function fakeTable() {
  const rows = new Map<string, Entity & { etag: string }>();
  const upserts: { entity: Entity; mode: unknown }[] = [];
  let version = 0;
  const key = (pk: string, rk: string) => `${pk}|${rk}`;
  const error = (statusCode: number, name: string) =>
    Object.assign(new Error(name), { statusCode });

  const client = {
    async getEntity(partitionKey: string, rowKey: string) {
      const row = rows.get(key(partitionKey, rowKey));
      if (!row) throw error(404, "ResourceNotFound");
      return { ...row };
    },
    queries: [] as string[],
    /** Like the service, more than 15 comparisons in a filter is a 400. Understands `PartitionKey eq` and `RowKey eq`. */
    async *listEntities(options?: { queryOptions?: { filter?: string } }) {
      const filter = options?.queryOptions?.filter ?? "";
      client.queries.push(filter);
      const comparisons = filter.match(/\b(eq|ne|gt|ge|lt|le)\b/g)?.length ?? 0;
      if (comparisons > 15) throw error(400, "InvalidInput");
      const partition = /PartitionKey eq '([^']*)'/.exec(filter)?.[1];
      const keys = [...filter.matchAll(/RowKey eq '([^']*)'/g)].map((m) => m[1]);
      for (const row of rows.values()) {
        if (partition !== undefined && row.partitionKey !== partition) continue;
        if (keys.length > 0 && !keys.includes(row.rowKey)) continue;
        yield { ...row };
      }
    },
    async upsertEntity(entity: Entity, mode: unknown) {
      upserts.push({ entity, mode });
      rows.set(key(entity.partitionKey, entity.rowKey), { ...entity, etag: `W/"${++version}"` });
    },
    /** Like Table Storage: 409 when the row exists. */
    async createEntity(entity: Entity) {
      const k = key(entity.partitionKey, entity.rowKey);
      if (rows.has(k)) throw error(409, "EntityAlreadyExists");
      rows.set(k, { ...entity, etag: `W/"${++version}"` });
    },
    /** Like Table Storage: 412 when the ETag no longer matches, 404 when the row is gone. */
    async updateEntity(entity: Entity, _mode: unknown, options?: { etag?: string }) {
      const k = key(entity.partitionKey, entity.rowKey);
      const current = rows.get(k);
      if (!current) throw error(404, "ResourceNotFound");
      if (options?.etag && options.etag !== current.etag) {
        throw error(412, "UpdateConditionNotSatisfied");
      }
      rows.set(k, { ...entity, etag: `W/"${++version}"` });
    },
  };
  return { client, rows, upserts };
}

export function fakeQueue() {
  const sent: string[] = [];
  const gate: { wait?: Promise<void> } = {};
  const client = {
    async sendMessage(text: string) {
      if (gate.wait) await gate.wait;
      sent.push(text);
    },
  };
  return { client, sent, gate };
}
