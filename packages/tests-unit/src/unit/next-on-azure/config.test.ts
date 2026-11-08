import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nextMajor, withAzure } from "../../../../next-on-azure/src/config.js";

describe("withAzure", () => {
  it("sets what Next.js needs to run on one Function", () => {
    const config = withAzure({}, { nextMajor: 15 });
    expect(config.output).toBe("standalone");
    expect(config.compress).toBe(false);
    expect(config.cacheMaxMemorySize).toBe(0);
    expect(config.images.maximumDiskCacheSize).toBe(0);
    expect(config.experimental.isrFlushToDisk).toBe(false);
    expect(config.cacheHandler).toMatch(/runtime\/cache-handler\.cjs$/);
  });

  it("puts cacheHandlers under experimental before Next.js 16 and at the top from 16", () => {
    const v15 = withAzure({}, { nextMajor: 15 });
    expect(v15.experimental.cacheHandlers.default).toMatch(/cache-handlers\.cjs$/);
    expect(v15.cacheHandlers).toBeUndefined();
    const v16 = withAzure({}, { nextMajor: 16 });
    expect(v16.cacheHandlers.default).toMatch(/cache-handlers\.cjs$/);
    expect(v16.experimental.cacheHandlers).toBeUndefined();
  });

  it("keeps the app's own settings and lets it add cache handlers", () => {
    const config = withAzure(
      {
        reactStrictMode: true,
        images: { remotePatterns: [{ hostname: "example.com" }] },
        experimental: { useCache: true, cacheHandlers: { remote: "/own.cjs" } },
      },
      { nextMajor: 15 },
    );
    expect(config.reactStrictMode).toBe(true);
    expect(config.images.remotePatterns).toEqual([{ hostname: "example.com" }]);
    expect(config.experimental.useCache).toBe(true);
    expect(config.experimental.cacheHandlers.remote).toBe("/own.cjs");
    expect(config.experimental.cacheHandlers.default).toMatch(/cache-handlers\.cjs$/);
  });

  it("keeps an incremental cache handler that the app set itself", () => {
    expect(withAzure({ cacheHandler: "/own-handler.cjs" }, { nextMajor: 15 }).cacheHandler).toBe(
      "/own-handler.cjs",
    );
  });

  it("does not change the object it is given", () => {
    const input = { experimental: { useCache: true } };
    withAzure(input, { nextMajor: 15 });
    expect(input).toEqual({ experimental: { useCache: true } });
  });

  it("reads the Next.js major of the app, and nothing from an unreadable version", () => {
    const app = (version: string) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "major-"));
      fs.writeFileSync(path.join(dir, "package.json"), "{}");
      fs.mkdirSync(path.join(dir, "node_modules/next"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "node_modules/next/package.json"),
        JSON.stringify({ name: "next", version }),
      );
      return dir;
    };
    expect(nextMajor(app("16.4.5"))).toBe(16);
    expect(nextMajor(app("15.5.29"))).toBe(15);
    expect(nextMajor(app("unreadable"))).toBeUndefined();
  });
});
