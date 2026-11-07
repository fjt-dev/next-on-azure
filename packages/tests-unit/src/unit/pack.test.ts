import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkgDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../open-next-azure",
);
const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  exports: Record<string, { default: string; types: string }>;
};

let files: string[];

// Needs `dist`: the `test` task depends on the build of the packages.
beforeAll(() => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  files = (JSON.parse(out)[0].files as { path: string }[]).map((f) => f.path);
}, 60_000);

describe("npm package contents", () => {
  it("contains the CLI entry, the Bicep template and the files npm requires", () => {
    const entry = manifest.bin["opennext-azure"]?.replace(/^\.\//, "");
    expect(files).toContain(entry);
    expect(files).toEqual(
      expect.arrayContaining([
        "package.json",
        "README.md",
        "LICENSE",
        "infra/main.bicep",
        "open-next.config.example.ts",
      ]),
    );
  });

  it("starts the CLI with a node shebang", () => {
    const entry = manifest.bin["opennext-azure"] as string;
    expect(
      fs.readFileSync(path.join(pkgDir, entry), "utf8").startsWith("#!/usr/bin/env node"),
    ).toBe(true);
  });

  it("ships a LICENSE identical to the one at the repository root", () => {
    const root = fs.readFileSync(path.join(pkgDir, "../../LICENSE"), "utf8");
    expect(fs.readFileSync(path.join(pkgDir, "LICENSE"), "utf8")).toBe(root);
  });

  it("contains every override the exports map points to, with its types", () => {
    const overrides = files.filter((f) => /^dist\/overrides\/[^/]+\.js$/.test(f));
    expect(overrides.length).toBeGreaterThan(0);
    for (const file of overrides) expect(files).toContain(file.replace(/\.js$/, ".d.ts"));
    expect(Object.keys(manifest.exports)).toEqual(["./overrides/*.js"]);
  });

  it("does not contain sources, tests, source maps or dependencies", () => {
    const bad = files.filter(
      (f) =>
        f.startsWith("src/") ||
        f.startsWith("node_modules/") ||
        f.endsWith(".map") ||
        f.endsWith("tsconfig.json") ||
        /\.(test|spec)\./.test(f) ||
        f.startsWith(".") ||
        f.endsWith(".tsbuildinfo"),
    );
    expect(bad).toEqual([]);
  });

  it("only contains files from dist, infra and the known top-level files", () => {
    const top = new Set(["package.json", "README.md", "LICENSE", "open-next.config.example.ts"]);
    const unexpected = files.filter(
      (f) => !f.startsWith("dist/") && !f.startsWith("infra/") && !top.has(f),
    );
    expect(unexpected).toEqual([]);
  });
});
