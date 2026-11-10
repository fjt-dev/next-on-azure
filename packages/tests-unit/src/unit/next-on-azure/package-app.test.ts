import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertHasNodeModules,
  assertNoSymlinks,
  entrypoint,
  findAppDir,
  hostJson,
  repointRuntimePaths,
} from "../../../../next-on-azure/src/cli/package-app.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "noa-"));

describe("findAppDir", () => {
  it("is empty when server.js is at the top", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "server.js"), "");
    expect(findAppDir(dir)).toBe("");
  });

  it("finds the app below its path in a monorepo, skipping node_modules and .next", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules/x/server.js"), "");
    fs.mkdirSync(path.join(dir, "apps/web/.next"), { recursive: true });
    fs.writeFileSync(path.join(dir, "apps/web/server.js"), "");
    expect(findAppDir(dir)).toBe(path.join("apps", "web"));
  });

  it("is undefined when there is no server.js", () => {
    expect(findAppDir(tmp())).toBeUndefined();
  });
});

describe("entrypoint", () => {
  it("fills in the location of the Next.js server, with forward slashes", () => {
    const text = entrypoint(path.join("apps", "web"));
    expect(text).toContain('"standalone", "apps/web"');
    expect(text).not.toContain("__APP_SUB__");
  });

  it("registers one HTTP function on every route with streaming enabled", () => {
    const text = entrypoint("");
    expect(text).toContain("enableHttpStream: true");
    expect(text).toContain('route: "{*path}"');
    expect(text).toContain('app.http("server"');
  });

  it("forwards with node:http, hands over waitUntil, and does not forward x-forwarded-proto", () => {
    const text = entrypoint("");
    expect(text).toContain('from "node:http"');
    expect(text).toContain('Symbol.for("@next/request-context")');
    expect(text).toContain('delete headers["x-forwarded-proto"]');
  });
});

describe("hostJson", () => {
  it("serves Next.js routes from / and needs no extension bundle", () => {
    const host = hostJson();
    expect(host.extensions.http.routePrefix).toBe("");
    expect(host).not.toHaveProperty("extensionBundle");
  });

  it("samples telemetry but keeps every request", () => {
    expect(hostJson().logging.applicationInsights.samplingSettings).toEqual({
      isEnabled: true,
      excludedTypes: "Request",
    });
  });
});

describe("assertHasNodeModules", () => {
  it("accepts a build with node_modules and refuses one without (Yarn Plug'n'Play), naming the fix", () => {
    const dir = tmp();
    expect(() => assertHasNodeModules(dir)).toThrow(/nodeLinker: node-modules/);
    fs.mkdirSync(path.join(dir, "node_modules"));
    expect(() => assertHasNodeModules(dir)).not.toThrow();
  });
});

describe("assertNoSymlinks", () => {
  it("accepts a plain tree and refuses a link, naming it", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "a"), "");
    expect(() => assertNoSymlinks(dir)).not.toThrow();
    fs.symlinkSync(path.join(dir, "a"), path.join(dir, "link"));
    expect(() => assertNoSymlinks(dir)).toThrow(/symbolic link.*link/s);
  });
});

describe("a response that fails after its first byte", () => {
  it("ends the stream instead of erroring it, and logs the failure", () => {
    const text = entrypoint("");
    expect(text).toMatch(
      /catch \(error\) \{\s*console\.error\([^)]*after it had started[^)]*\);\s*controller\.close\(\);/,
    );
  });
});

describe("Front Door check of the entry", () => {
  const text = entrypoint("");
  it("is part of the handler and answers 403 before the Next.js server starts", () => {
    expect(text).toContain("isFrontDoorRequestAllowed(process.env.FRONT_DOOR_ID");
    expect(text.indexOf("status: 403")).toBeLessThan(text.indexOf("await start();"));
  });
});

describe("repointRuntimePaths", () => {
  const id = "next-on-azure@file+vendor+x.tgz_next@15.5.29_abc";
  const store = `../node_modules/.pnpm/${id}/node_modules/next-on-azure/dist/runtime`;

  function app(appSub: string) {
    const dir = tmp();
    const server = path.join(dir, appSub);
    fs.mkdirSync(path.join(server, ".next"), { recursive: true });
    const config = JSON.stringify({
      cacheHandler: `${store}/cache-handler.cjs`,
      cacheHandlers: { default: `${store}/cache-handlers.cjs` },
    });
    fs.writeFileSync(path.join(server, "server.js"), `const nextConfig = ${config};`);
    fs.writeFileSync(
      path.join(server, ".next/required-server-files.json"),
      JSON.stringify({ config: JSON.parse(config) }),
    );
    return { dir, server };
  }
  const flattened = (dir: string) => {
    const runtime = path.join(dir, "node_modules/next-on-azure/dist/runtime");
    fs.mkdirSync(runtime, { recursive: true });
    for (const f of ["cache-handler.cjs", "cache-handlers.cjs"])
      fs.writeFileSync(path.join(runtime, f), "");
  };

  it("points the handler paths at the flattened copy, in both files, for a top-level app", () => {
    const { dir, server } = app("");
    flattened(dir);
    expect(repointRuntimePaths(dir, "")).toBe(4);
    const text = fs.readFileSync(path.join(server, "server.js"), "utf8");
    expect(text).toContain('"../node_modules/next-on-azure/dist/runtime/cache-handler.cjs"');
    expect(text).not.toContain(".pnpm");
    expect(
      fs.readFileSync(path.join(server, ".next/required-server-files.json"), "utf8"),
    ).not.toContain(".pnpm");
    // The new path resolves from the dist directory.
    expect(
      fs.existsSync(
        path.resolve(
          server,
          ".next",
          "../node_modules/next-on-azure/dist/runtime/cache-handler.cjs",
        ),
      ),
    ).toBe(true);
  });

  it("computes the path from the dist directory of a nested (monorepo) app", () => {
    const { dir, server } = app("apps/web");
    flattened(dir);
    repointRuntimePaths(dir, "apps/web");
    const text = fs.readFileSync(path.join(server, "server.js"), "utf8");
    const value = /"cacheHandler":"([^"]+)"/.exec(text)?.[1] ?? "";
    expect(fs.existsSync(path.resolve(server, ".next", value))).toBe(true);
  });

  it("leaves a path alone when its file exists, and when there is no flattened copy", () => {
    const { dir } = app("");
    expect(repointRuntimePaths(dir, "")).toBe(0); // nothing flattened: kept as it is
    fs.mkdirSync(
      path.join(dir, `node_modules/.pnpm/${id}/node_modules/next-on-azure/dist/runtime`),
      { recursive: true },
    );
    for (const f of ["cache-handler.cjs", "cache-handlers.cjs"]) {
      fs.writeFileSync(
        path.join(dir, `node_modules/.pnpm/${id}/node_modules/next-on-azure/dist/runtime`, f),
        "",
      );
    }
    flattened(dir);
    expect(repointRuntimePaths(dir, "")).toBe(0); // the original files still exist: kept
  });
});
