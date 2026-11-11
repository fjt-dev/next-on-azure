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

// What `next build` prerendered is on disk (.next/server/app and .next/server/pages). Next.js reads it
// itself with its FileSystemCache; a custom handler is asked instead, so on a miss in Blob it is read
// from the build output the same way, and no instance has to render a built page first. Needed for
// routes without a fallback (`dynamicParams = false`): Next.js does not render a page that is not in the
// cache for them and answers 404. Only the kinds that `next build` prerenders; `fetch` entries are not.
const BUILT_KINDS = new Set(["APP_PAGE", "APP_ROUTE", "PAGES"]);
const FILE_CACHE = "next/dist/server/lib/incremental-cache/file-system-cache";

module.exports = class AzureCacheHandler {
  constructor(options) {
    this.options = options;
    this.buildId = readBuildId(options.serverDistDir);
  }

  blobName(key) {
    return `${this.buildId}/${sha(key)}.json`;
  }

  /** Next.js's own reader of the build output, made from the Next.js that the app runs; null when it cannot be found. */
  fileCache() {
    if (this.builtCache !== undefined) return this.builtCache;
    try {
      const resolveFrom = require("module").createRequire(
        require("path").join(this.options.serverDistDir, "noop.js"),
      );
      const FileSystemCache = resolveFrom(FILE_CACHE).default;
      // No memory cache and no writes: only reads of what the build wrote.
      this.builtCache = new FileSystemCache({
        ...this.options,
        maxMemoryCacheSize: 0,
        flushToDisk: false,
      });
    } catch {
      this.builtCache = null;
    }
    return this.builtCache;
  }

  async readBuildOutput(key, ctx) {
    if (!BUILT_KINDS.has(ctx.kind)) return null;
    const cache = this.fileCache();
    if (!cache) return null;
    try {
      return (await cache.get(key, ctx)) ?? null;
    } catch {
      return null;
    }
  }

  async get(key, ctx = {}) {
    if (inBuild()) return null;
    const { container, table } = await getClients();
    let entry;
    try {
      const res = await container.getBlockBlobClient(this.blobName(key)).downloadToBuffer();
      entry = JSON.parse(res.toString("utf8"), reviver);
    } catch (e) {
      if (e.statusCode !== 404) throw e;
      entry = await this.readBuildOutput(key, ctx);
      if (!entry) return null;
    }
    // Pages and route handlers carry their tags in a response header, fetch entries next to the value.
    const headerTags = entry.value?.headers?.["x-next-cache-tags"];
    const tags = [
      ...new Set([
        ...(entry.tags ?? (typeof headerTags === "string" ? headerTags.split(",") : [])),
        ...(ctx.softTags ?? []),
        ...(ctx.tags ?? []),
      ]),
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
