import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertNoSymlinks,
  assertSharpForAzure,
  copyBundle,
  entrypoint,
  hostJson,
  packageApp,
  zipDirectory,
} from "../../../open-next-azure/src/cli/package-app.js";

type BundleSet = Parameters<typeof entrypoint>[0];

describe("entrypoint", () => {
  const all = ["server", "image", "revalidation"] as const;

  it("loads server last so it keeps its directory as cwd (ADR-0009)", () => {
    const code = entrypoint([...all]);
    const order = ['load("image")', 'load("revalidation")', 'load("server")'].map((s) =>
      code.indexOf(s),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("changes directory before each import", () => {
    const code = entrypoint([...all]);
    expect(code.indexOf("process.chdir")).toBeLessThan(code.indexOf("await import"));
  });

  it("registers the three functions on the right routes", () => {
    const code = entrypoint([...all]);
    expect(code).toContain('route: "_next/image"');
    expect(code).toContain('route: "{*path}"');
    expect(code).toContain('app.storageQueue("revalidation"');
    expect(code).toContain("enableHttpStream: true");
    expect(code).toContain('authLevel: "anonymous"');
  });

  it("tells the asset resolver where its manifest is, without relying on cwd", () => {
    expect(entrypoint([...all])).toContain(
      'process.env.ASSETS_MANIFEST_PATH ??= path.join(root, "server", "assets-manifest.json")',
    );
  });

  it("omits bundles that were not built", () => {
    const code = entrypoint(["server"]);
    expect(code).not.toContain("_next/image");
    expect(code).not.toContain("storageQueue");
    expect(code).toContain('load("server")');
  });

  it("is valid ES module syntax", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-syntax-"));
    try {
      for (const set of [["server"], ["server", "image"], [...all]] as BundleSet[]) {
        const file = path.join(dir, "main.mjs");
        fs.writeFileSync(file, entrypoint(set));
        const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
        expect(r.stderr).toBe("");
        expect(r.status).toBe(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("hostJson", () => {
  const host = hostJson();
  it("uses the extension bundle so queue triggers are registered", () => {
    expect(host.extensionBundle).toEqual({
      id: "Microsoft.Azure.Functions.ExtensionBundle",
      version: "[4.*, 5.0.0)",
    });
  });
  it("serves routes from / and reads plain JSON queue messages with 3 attempts", () => {
    expect(host.extensions.http.routePrefix).toBe("");
    expect(host.extensions.queues).toEqual({ messageEncoding: "none", maxDequeueCount: 3 });
  });
});

describe("hostJson telemetry", () => {
  it("samples telemetry like the platform default and never samples requests", () => {
    expect(hostJson().logging.applicationInsights.samplingSettings).toEqual({
      isEnabled: true,
      excludedTypes: "Request",
    });
  });
});

describe("assertSharpForAzure", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharp-test-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mk = (...p: string[]) =>
    fs.mkdirSync(path.join(dir, "node_modules", ...p), { recursive: true });

  it("passes when sharp is not part of the bundle", () => {
    expect(() => assertSharpForAzure(dir)).not.toThrow();
  });

  it("refuses sharp without any native binary (B11: it would silently serve unresized images)", () => {
    mk("sharp");
    expect(() => assertSharpForAzure(dir)).toThrow(/sharp-linux-x64.*sharp-libvips-linux-x64/s);
    expect(() => assertSharpForAzure(dir)).toThrow(/libc: "glibc"/);
  });

  it("refuses sharp with only one of the two Linux packages", () => {
    mk("sharp");
    mk("@img", "sharp-linux-x64");
    expect(() => assertSharpForAzure(dir)).toThrow(/sharp-libvips-linux-x64/);
  });

  it("refuses sharp built for another platform", () => {
    mk("sharp");
    mk("@img", "sharp-darwin-arm64");
    expect(() => assertSharpForAzure(dir)).toThrow();
  });

  it("passes with both Linux x64 packages", () => {
    mk("sharp");
    mk("@img", "sharp-linux-x64");
    mk("@img", "sharp-libvips-linux-x64");
    expect(() => assertSharpForAzure(dir)).not.toThrow();
  });
});

describe("packageApp", () => {
  it("refuses an unsupported Next.js version before it touches the output directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "old-next-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.mkdirSync(path.join(root, "node_modules", "next"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", "next", "package.json"),
      JSON.stringify({ name: "next", version: "14.2.5" }),
    );
    fs.mkdirSync(path.join(root, ".open-next", "server-functions", "default"), { recursive: true });
    const out = path.join(root, "out");
    fs.mkdirSync(out);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    try {
      expect(() => packageApp({ openNextDir: path.join(root, ".open-next"), outDir: out })).toThrow(
        /Next\.js 14\.2\.5 is not supported/,
      );
      expect(fs.existsSync(out)).toBe(true); // not removed
    } finally {
      cwd.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails with a clear message when open-next build was not run", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-build-"));
    try {
      expect(() => packageApp({ openNextDir: empty, outDir: path.join(empty, "out") })).toThrow(
        /open-next build/,
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("zipDirectory (the artifact that is deployed)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // pnpm layout: node_modules/next is a link to .pnpm/next/node_modules/next, whose dependency
  // (styled-jsx) is a sibling in .pnpm/next/node_modules. Zipping the link targets breaks that.
  function buildPnpmLikeTree(root: string) {
    const store = path.join(root, "node_modules/.pnpm/next@1/node_modules");
    fs.mkdirSync(path.join(store, "next"), { recursive: true });
    fs.mkdirSync(path.join(store, "styled-jsx"), { recursive: true });
    fs.writeFileSync(path.join(store, "next/index.js"), "module.exports = require('styled-jsx');");
    fs.writeFileSync(path.join(store, "styled-jsx/index.js"), "module.exports = 'ok';");
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.symlinkSync(".pnpm/next@1/node_modules/next", path.join(root, "node_modules/next"));
  }

  it("keeps symbolic links as links, so a pnpm node_modules still resolves after unzipping", () => {
    const src = path.join(dir, "src");
    buildPnpmLikeTree(src);
    const zip = path.join(dir, "app.zip");
    zipDirectory(src, zip);

    const out = path.join(dir, "out");
    fs.mkdirSync(out);
    const unzip = spawnSync("unzip", ["-q", zip, "-d", out], { encoding: "utf8" });
    expect(unzip.status).toBe(0);

    expect(fs.lstatSync(path.join(out, "node_modules/next")).isSymbolicLink()).toBe(true);
    const run = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(require(require.resolve('next', { paths: [process.cwd()] })))"],
      { cwd: path.join(out, "node_modules/.."), encoding: "utf8" },
    );
    // `next` requires its sibling `styled-jsx` through the real path of the link.
    expect(run.stdout).toBe("ok");
  });
});

describe("assertNoSymlinks", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nosymlink-test-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("passes for a tree of plain files and directories", () => {
    fs.mkdirSync(path.join(dir, "a/b"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a/b/c.txt"), "x");
    expect(() => assertNoSymlinks(dir)).not.toThrow();
  });

  it("refuses a tree with a symbolic link and names it", () => {
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(dir, "real"));
    fs.symlinkSync("../real", path.join(dir, "node_modules/linked"));
    expect(() => assertNoSymlinks(dir)).toThrow(/1 symbolic link.*node_modules\/linked/s);
  });
});

describe("copyBundle", () => {
  it("keeps relative symbolic links relative, so the copy does not point back into the source", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "copybundle-test-"));
    try {
      const src = path.join(base, "src");
      fs.mkdirSync(path.join(src, "real"), { recursive: true });
      fs.writeFileSync(path.join(src, "real/file.txt"), "x");
      fs.symlinkSync("real", path.join(src, "link"));

      const dest = path.join(base, "dest");
      copyBundle(src, dest);

      expect(fs.readlinkSync(path.join(dest, "link"))).toBe("real");
      fs.rmSync(src, { recursive: true, force: true });
      expect(fs.readFileSync(path.join(dest, "link/file.txt"), "utf8")).toBe("x"); // source gone
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
