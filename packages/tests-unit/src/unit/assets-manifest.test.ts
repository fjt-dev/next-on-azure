import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAssetsManifest,
  contentTypeFor,
} from "../../../open-next-azure/src/cli/assets-manifest.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string | Buffer) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe("buildAssetsManifest", () => {
  it("lists nested files with POSIX keys, size and content type", () => {
    write("_next/static/chunks/app.js", "console.log(1)");
    write("favicon.ico", Buffer.from([0, 1, 2, 3]));
    write("robots-image.png", "x");

    const m = buildAssetsManifest(dir);

    expect(m.version).toBe(1);
    expect(Object.keys(m.files).sort()).toEqual([
      "_next/static/chunks/app.js",
      "favicon.ico",
      "robots-image.png",
    ]);
    expect(m.files["_next/static/chunks/app.js"]).toMatchObject({
      size: 14,
      contentType: "text/javascript; charset=utf-8",
    });
    expect(m.files["favicon.ico"]?.contentType).toBe("image/x-icon");
    expect(m.files["favicon.ico"]?.size).toBe(4);
  });

  it("never lists OpenNext's internal BUILD_ID", () => {
    write("BUILD_ID", "abc");
    write("a.txt", "a");
    expect(Object.keys(buildAssetsManifest(dir).files)).toEqual(["a.txt"]);
  });

  it("gives equal content the same ETag and different content a different one", () => {
    write("a.txt", "same");
    write("b.txt", "same");
    write("c.txt", "different");
    const { files } = buildAssetsManifest(dir);
    expect(files["a.txt"]?.etag).toBe(files["b.txt"]?.etag);
    expect(files["a.txt"]?.etag).not.toBe(files["c.txt"]?.etag);
    expect(files["a.txt"]?.etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
  });

  it("returns an empty file list for an empty directory", () => {
    expect(buildAssetsManifest(dir).files).toEqual({});
  });
});

describe("contentTypeFor", () => {
  it.each([
    ["a.css", "text/css; charset=utf-8"],
    ["a.woff2", "font/woff2"],
    ["a.WEBP", "image/webp"],
    ["a.svg", "image/svg+xml"],
    ["a.unknown", "application/octet-stream"],
    ["noext", "application/octet-stream"],
  ])("%s -> %s", (file, expected) => {
    expect(contentTypeFor(file)).toBe(expected);
  });
});
