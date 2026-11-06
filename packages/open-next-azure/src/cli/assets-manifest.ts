import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Manifest of the static files uploaded to the `assets` container.
 *
 * The asset resolver serves only paths listed here (exact match), so a request can never reach a
 * blob that was not part of the build, and metadata routes such as `robots` or `sitemap` that
 * Next.js renders on the server are not shadowed by a name pattern.
 */
export type AssetsManifest = {
  version: 1;
  files: Record<string, { size: number; contentType: string; etag: string }>;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Files OpenNext puts next to the assets for its own tooling; never served to clients. */
const INTERNAL_FILES = new Set(["BUILD_ID"]);

/** Walks `dir` and describes every file; keys are POSIX paths relative to `dir`. */
export function buildAssetsManifest(dir: string): AssetsManifest {
  const files: AssetsManifest["files"] = {};
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const body = fs.readFileSync(full);
      const key = path.relative(dir, full).split(path.sep).join("/");
      if (INTERNAL_FILES.has(key)) continue;
      files[key] = {
        size: body.length,
        contentType: contentTypeFor(key),
        etag: `"${createHash("sha1").update(body).digest("base64url")}"`,
      };
    }
  };
  walk(dir);
  return { version: 1, files };
}
