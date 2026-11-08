import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prerenderedRoutes, prime } from "../../../../next-on-azure/src/cli/prime.js";

function app(routes: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prime-"));
  fs.mkdirSync(path.join(dir, ".next"));
  fs.writeFileSync(
    path.join(dir, ".next/prerender-manifest.json"),
    JSON.stringify({ routes: Object.fromEntries(routes.map((r) => [r, {}])) }),
  );
  return dir;
}
const response = (status: number, cache = "MISS") =>
  ({
    status,
    headers: new Headers({ "x-nextjs-cache": cache }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }) as Response;

describe("prerenderedRoutes", () => {
  it("lists the prerendered routes without the not-found page", () => {
    expect(prerenderedRoutes(app(["/", "/_not-found", "/blog/a"]))).toEqual(["/", "/blog/a"]);
  });
  it("explains what to do when the build is missing", () => {
    expect(() => prerenderedRoutes(fs.mkdtempSync(path.join(os.tmpdir(), "none-")))).toThrow(
      /next build/,
    );
  });
});

describe("prime", () => {
  it("requests every route once with the base URL and counts failures", async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (url: URL | string) => {
      seen.push(String(url));
      return String(url).endsWith("/bad") ? response(500) : response(200);
    });
    const lines: string[] = [];
    const result = await prime("https://f.net", {
      appDir: app(["/a", "/b", "/bad"]),
      fetch: fetcher as never,
      log: (l) => lines.push(l),
    });
    expect(seen.sort()).toEqual(["https://f.net/a", "https://f.net/b", "https://f.net/bad"]);
    expect(result).toMatchObject({ routes: 3, failed: 1 });
    expect(lines.some((l) => l.startsWith("500") && l.endsWith("/bad"))).toBe(true);
  });

  it("counts a network error as a failure and goes on", async () => {
    const fetcher = vi.fn(async (url: URL | string) => {
      if (String(url).endsWith("/x")) throw new Error("connection refused");
      return response(200);
    });
    const result = await prime("https://f.net", {
      appDir: app(["/x", "/y"]),
      fetch: fetcher as never,
      log: () => undefined,
    });
    expect(result).toMatchObject({ routes: 2, failed: 1 });
  });
});
