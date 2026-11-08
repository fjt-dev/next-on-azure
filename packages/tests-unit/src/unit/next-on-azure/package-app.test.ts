import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoSymlinks,
  entrypoint,
  findAppDir,
  hostJson,
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

describe("assertNoSymlinks", () => {
  it("accepts a plain tree and refuses a link, naming it", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "a"), "");
    expect(() => assertNoSymlinks(dir)).not.toThrow();
    fs.symlinkSync(path.join(dir, "a"), path.join(dir, "link"));
    expect(() => assertNoSymlinks(dir)).toThrow(/symbolic link.*link/s);
  });
});
