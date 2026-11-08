import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkgDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../next-on-azure",
);
const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  exports: Record<string, string | { default: string }>;
};

let files: string[];

// Needs `dist`: the `test` task depends on the build of the packages.
beforeAll(() => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  files = (JSON.parse(out)[0].files as { path: string }[]).map((f) => f.path);
});

describe("npm pack contents of next-on-azure", () => {
  it("contains the Bicep template, the CLI, the config helper and every runtime file", () => {
    for (const file of [
      "infra/main.bicep",
      "dist/cli/index.js",
      "dist/config.js",
      "dist/runtime/cache-handler.cjs",
      "dist/runtime/cache-handlers.cjs",
      "dist/runtime/azure-storage.cjs",
      "dist/runtime/entry.mjs",
      "dist/runtime/front-door.mjs",
      "dist/runtime/cookies.js",
    ]) {
      expect(files, `${file} missing from the package`).toContain(file);
    }
  });

  it("every file named by the bin and exports fields is in the package", () => {
    const targets = [
      ...Object.values(manifest.bin),
      ...Object.values(manifest.exports).flatMap((e) =>
        typeof e === "string" ? [e] : [e.default],
      ),
    ].map((t) => t.replace(/^\.\//, ""));
    for (const target of targets) expect(files, `${target} missing`).toContain(target);
  });

  it("ships no sources, tests or local settings", () => {
    expect(
      files.filter((f) => /^src\//.test(f) || /\.test\./.test(f) || /local\.settings/.test(f)),
    ).toEqual([]);
  });
});
