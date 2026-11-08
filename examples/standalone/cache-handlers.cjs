"use strict";
// `'use cache'` handler (CacheHandlerV2) on Blob and Table Storage (spike, ADR-0016).
// Entries are streams; they are stored as one JSON document with the value in base64.
const { getClients, rowKey, sha, readBuildId, inBuild } = require("./azure-storage.cjs");

const buildId = readBuildId();
const blobName = (key) => `use-cache/${buildId}/${sha(key)}.json`;
const pending = new Map();

async function readAll(stream) {
  const parts = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

async function expirationOf(table, tags) {
  let latest = 0;
  await Promise.all(
    tags.map(async (tag) => {
      try {
        const row = await table.getEntity(buildId, rowKey(tag));
        latest = Math.max(latest, row.revalidatedAt ?? 0);
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
    }),
  );
  return latest;
}

module.exports = {
  async get(cacheKey, softTags) {
    if (inBuild()) return undefined;
    if (pending.has(cacheKey)) await pending.get(cacheKey);
    const { container, table } = await getClients();
    let doc;
    try {
      doc = JSON.parse(
        (await container.getBlockBlobClient(blobName(cacheKey)).downloadToBuffer()).toString(
          "utf8",
        ),
      );
    } catch (e) {
      if (e.statusCode === 404) return undefined;
      throw e;
    }
    if (Date.now() > doc.timestamp + doc.revalidate * 1000) return undefined;
    if ((await expirationOf(table, [...doc.tags, ...softTags])) > doc.timestamp) return undefined;
    const bytes = Buffer.from(doc.value, "base64");
    return {
      value: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes));
          controller.close();
        },
      }),
      tags: doc.tags,
      stale: doc.stale,
      timestamp: doc.timestamp,
      expire: doc.expire,
      revalidate: doc.revalidate,
    };
  },

  async set(cacheKey, pendingEntry) {
    if (inBuild()) {
      await pendingEntry;
      return;
    }
    let done;
    pending.set(cacheKey, new Promise((resolve) => (done = resolve)));
    try {
      const entry = await pendingEntry;
      const [forNext, forStore] = entry.value.tee();
      entry.value = forNext;
      const bytes = await readAll(forStore);
      const body = JSON.stringify({
        value: bytes.toString("base64"),
        tags: entry.tags,
        stale: entry.stale,
        timestamp: entry.timestamp,
        expire: entry.expire,
        revalidate: entry.revalidate,
      });
      const { container } = await getClients();
      await container.getBlockBlobClient(blobName(cacheKey)).upload(body, Buffer.byteLength(body), {
        blobHTTPHeaders: { blobContentType: "application/json" },
      });
    } finally {
      pending.delete(cacheKey);
      done();
    }
  },

  async refreshTags() {},

  async getExpiration(...tags) {
    if (inBuild()) return 0;
    const { table } = await getClients();
    return expirationOf(table, tags);
  },

  async expireTags(...tags) {
    if (inBuild()) return;
    const { table } = await getClients();
    const now = Date.now();
    await Promise.all(
      tags.map((tag) =>
        table.upsertEntity(
          { partitionKey: buildId, rowKey: rowKey(tag), revalidatedAt: now },
          "Replace",
        ),
      ),
    );
  },
};
