"use strict";
// Incremental cache for Next.js on Azure (spike): entries in Blob Storage, tag state in Table Storage.
// Next.js calls this class for pages, route handlers and fetch results (`cacheHandler` option).
const { getClients, rowKey, sha, readBuildId, inBuild } = require("./azure-storage.cjs");

// Cache values hold Buffers and Maps, which JSON cannot carry.
const replacer = (_k, v) => {
  if (v && v.type === "Buffer" && Array.isArray(v.data))
    return { $buffer: Buffer.from(v.data).toString("base64") };
  if (v instanceof Map) return { $map: [...v.entries()] };
  return v;
};
const reviver = (_k, v) => {
  if (v && typeof v === "object") {
    if (typeof v.$buffer === "string") return Buffer.from(v.$buffer, "base64");
    if (Array.isArray(v.$map)) return new Map(v.$map);
  }
  return v;
};

module.exports = class AzureCacheHandler {
  constructor(options) {
    this.buildId = readBuildId(options.serverDistDir);
  }

  blobName(key) {
    return `${this.buildId}/${sha(key)}.json`;
  }

  async get(key, ctx = {}) {
    if (inBuild()) return null;
    const { container, table } = await getClients();
    let text;
    try {
      const res = await container.getBlockBlobClient(this.blobName(key)).downloadToBuffer();
      text = res.toString("utf8");
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw e;
    }
    const entry = JSON.parse(text, reviver);
    const tags = [
      ...new Set([...(entry.tags ?? []), ...(ctx.softTags ?? []), ...(ctx.tags ?? [])]),
    ];
    for (const tag of tags) {
      try {
        const row = await table.getEntity(this.buildId, rowKey(tag));
        if ((row.revalidatedAt ?? 0) > entry.lastModified) return null;
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
    }
    return { lastModified: entry.lastModified, value: entry.value };
  }

  async set(key, data, ctx = {}) {
    if (inBuild()) return;
    const { container } = await getClients();
    // Fetch entries carry their tags in the context; pages and route handlers in a response header.
    const headerTags = data?.headers?.["x-next-cache-tags"];
    const tags =
      ctx.tags ?? data?.tags ?? (typeof headerTags === "string" ? headerTags.split(",") : []);
    const entry = { lastModified: Date.now(), value: data, tags };
    const body = JSON.stringify(entry, replacer);
    await container.getBlockBlobClient(this.blobName(key)).upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
  }

  async revalidateTag(tags) {
    if (inBuild()) return;
    const { table } = await getClients();
    const list = Array.isArray(tags) ? tags : [tags];
    const now = Date.now();
    await Promise.all(
      list.map((tag) =>
        table.upsertEntity(
          { partitionKey: this.buildId, rowKey: rowKey(tag), revalidatedAt: now },
          "Replace",
        ),
      ),
    );
  }

  resetRequestCache() {}
};
