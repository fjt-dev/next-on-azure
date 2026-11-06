import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { InternalEvent, InternalResult } from "@opennextjs/aws/types/open-next";
import type { AssetResolver } from "@opennextjs/aws/types/overrides";
import { getBlobService } from "./clients.js";

/**
 * Serves static files (`/_next/static/*`, `public/*`) from Blob Storage.
 *
 * Only paths listed in `assets-manifest.json` are served (exact match). The manifest is written by
 * `opennext-azure package` into the server bundle directory and located through
 * `ASSETS_MANIFEST_PATH`, which the generated entry point sets (the runtime cwd is not reliable:
 * in a monorepo OpenNext nests the app inside the bundle). It is read once per instance. Supports `HEAD`, conditional requests (`If-None-Match`)
 * and a single byte range.
 *
 * Every asset request is a function execution; put a CDN in front for large sites.
 */
type Entry = { size: number; contentType: string; etag: string };

let manifest: Map<string, Entry> | undefined;

function loadManifest(): Map<string, Entry> {
  if (manifest) return manifest;
  const file = process.env.ASSETS_MANIFEST_PATH ?? path.join(process.cwd(), "assets-manifest.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      files: Record<string, Entry>;
    };
    manifest = new Map(Object.entries(parsed.files));
  } catch (e) {
    console.error(`Static assets will not be served: cannot read ${file}`, e);
    manifest = new Map();
  }
  return manifest;
}

const empty = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

function result(
  statusCode: number,
  headers: Record<string, string>,
  body: ReadableStream<Uint8Array> = empty(),
): InternalResult {
  return {
    type: "core",
    statusCode,
    headers,
    body: body as unknown as InternalResult["body"],
    isBase64Encoded: false,
  };
}

/** Parses a single `bytes=start-end` / `bytes=start-` / `bytes=-suffix` range. */
function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | "invalid" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // not a single byte range: ignore the header and send everything
  const [, a, b] = m;
  let start: number;
  let end: number;
  if (a === "" && b === "") return null;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

const assetResolver: AssetResolver = {
  name: "azure-blob-manifest",

  async maybeGetAssetResult(event: InternalEvent) {
    if (event.method !== "GET" && event.method !== "HEAD") return undefined;

    let key: string;
    try {
      key = decodeURIComponent(event.rawPath).replace(/^\/+/, "");
    } catch {
      return undefined;
    }
    const entry = loadManifest().get(key);
    if (!entry) return undefined;

    const headers: Record<string, string> = {
      "content-type": entry.contentType,
      etag: entry.etag,
      "accept-ranges": "bytes",
      // Build output under _next/static is content-hashed; everything else may change per deploy.
      "cache-control": key.startsWith("_next/static/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    };

    const ifNoneMatch = event.headers["if-none-match"];
    if (ifNoneMatch?.split(",").some((t) => t.trim() === entry.etag || t.trim() === "*")) {
      return result(304, headers);
    }

    let status = 200;
    let offset = 0;
    let count = entry.size;
    const rangeHeader = event.headers.range;
    if (rangeHeader && entry.size > 0) {
      const range = parseRange(rangeHeader, entry.size);
      if (range === "invalid") {
        return result(416, { "content-range": `bytes */${entry.size}` });
      }
      if (range) {
        status = 206;
        offset = range.start;
        count = range.end - range.start + 1;
        headers["content-range"] = `bytes ${range.start}-${range.end}/${entry.size}`;
      }
    }
    headers["content-length"] = String(count);

    if (event.method === "HEAD") return result(status, headers);

    const prefix = (process.env.ASSETS_BLOB_PREFIX ?? "").replace(/^\/|\/$/g, "");
    const name = [prefix, key].filter(Boolean).join("/");
    try {
      const container = (await getBlobService()).getContainerClient(
        process.env.ASSETS_CONTAINER_NAME ?? "assets",
      );
      const download = await container.getBlockBlobClient(name).download(offset, count);
      if (!download.readableStreamBody) throw new Error("empty body");
      const body = Readable.toWeb(
        download.readableStreamBody as Readable,
      ) as ReadableStream<Uint8Array>;
      return result(status, headers, body);
    } catch (e) {
      // Listed in the manifest but not in storage: the deployment is inconsistent. Let Next.js answer.
      console.error(`Asset ${name} is in the manifest but could not be read`, e);
      return undefined;
    }
  },
};

export default assetResolver;
