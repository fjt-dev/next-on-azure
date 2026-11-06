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
  const rows = new Map<string, Entity>();
  const upserts: { entity: Entity; mode: unknown }[] = [];
  const client = {
    async getEntity(partitionKey: string, rowKey: string) {
      const row = rows.get(`${partitionKey}|${rowKey}`);
      if (!row) throw Object.assign(new Error("ResourceNotFound"), { statusCode: 404 });
      return row;
    },
    async upsertEntity(entity: Entity, mode: unknown) {
      upserts.push({ entity, mode });
      rows.set(`${entity.partitionKey}|${entity.rowKey}`, entity);
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
