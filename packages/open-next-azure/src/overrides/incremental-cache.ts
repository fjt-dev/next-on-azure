import type { IncrementalCache } from "@opennextjs/aws/types/overrides";
import { getBlobService } from "./clients.js";

/** Blob layout mirrors the S3 override: [__fetch/]<buildId>/<key>[.<ext>] */
function blobName(key: string, type: string): string {
  const buildId = process.env.OPEN_NEXT_BUILD_ID ?? "";
  const prefix = process.env.CACHE_BLOB_PREFIX ?? "";
  const path = type === "fetch" ? `__fetch/${buildId}/${key}` : `${buildId}/${key}.${type}`;
  return [prefix, path].filter(Boolean).join("/");
}

/**
 * Blob `Last-Modified` has one-second resolution, but the tag cache compares it with millisecond
 * revalidation times. A page written within the same second as a `revalidateTag` would look older
 * than the revalidation and be rendered again on every request until the second ends. So the write
 * time is also stored in milliseconds as blob metadata and preferred when present. Blobs without it
 * (for example the prerendered cache uploaded at deploy time) fall back to `Last-Modified`.
 */
const WRITTEN_AT_MS = "writtenatms";

const container = async () =>
  (await getBlobService()).getContainerClient(process.env.CACHE_CONTAINER_NAME ?? "cache");

const incrementalCache: IncrementalCache = {
  name: "azure-blob",

  async get(key, cacheType) {
    const blob = (await container()).getBlockBlobClient(blobName(key, cacheType ?? "cache"));
    try {
      const res = await blob.download();
      const text = await streamToString(res.readableStreamBody);
      const writtenAt = Number(res.metadata?.[WRITTEN_AT_MS]);
      return {
        value: JSON.parse(text),
        lastModified:
          Number.isFinite(writtenAt) && writtenAt > 0 ? writtenAt : res.lastModified?.getTime(),
      };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return null;
      throw e;
    }
  },

  async set(key, value, cacheType) {
    const body = JSON.stringify(value);
    await (await container())
      .getBlockBlobClient(blobName(key, cacheType ?? "cache"))
      .upload(body, Buffer.byteLength(body), {
        blobHTTPHeaders: { blobContentType: "application/json" },
        metadata: { [WRITTEN_AT_MS]: String(Date.now()) },
      });
  },

  async delete(key) {
    await (await container()).getBlockBlobClient(blobName(key, "cache")).deleteIfExists();
  },
};

async function streamToString(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

export default incrementalCache;
