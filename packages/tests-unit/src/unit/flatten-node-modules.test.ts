import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findSymlinks,
  flattenPnpmNodeModules,
} from "../../../open-next-azure/src/cli/flatten-node-modules.js";

let bundle: string;
beforeEach(() => {
  bundle = fs.mkdtempSync(path.join(os.tmpdir(), "flatten-test-"));
});
afterEach(() => fs.rmSync(bundle, { recursive: true, force: true }));

const store = () => path.join(bundle, "node_modules/.pnpm");

/** A real package inside the pnpm store. */
function storePackage(name: string, version: string, code: string) {
  const dir = path.join(store(), `${name.replace("/", "+")}@${version}`, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version, main: "index.js" }),
  );
  fs.writeFileSync(path.join(dir, "index.js"), code);
  return dir;
}

/** The sibling link pnpm puts next to a package for each of its dependencies. */
function linkDependency(of: string, ofVersion: string, dep: string, depVersion: string) {
  const storeId = (n: string, v: string) => `${n.replace("/", "+")}@${v}`;
  const link = path.join(store(), storeId(of, ofVersion), "node_modules", dep);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(
    path.relative(
      path.dirname(link),
      path.join(store(), storeId(dep, depVersion), "node_modules", dep),
    ),
    link,
  );
}

/** A link from an application `node_modules` into the store. */
function linkRoot(nodeModules: string, name: string, version: string) {
  const link = path.join(nodeModules, name);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  const target = path.join(store(), `${name.replace("/", "+")}@${version}`, "node_modules", name);
  fs.symlinkSync(path.relative(path.dirname(link), target), link);
}

/** Mirrors the failure seen on Azure: next -> styled-jsx -> react as siblings in the store. */
function buildTree() {
  storePackage("react", "19.0.0", "module.exports = 'react19';");
  storePackage("react", "18.0.0", "module.exports = 'react18';");
  storePackage("styled-jsx", "5.0.0", "module.exports = 'styled-jsx+' + require('react');");
  storePackage(
    "next",
    "1.0.0",
    "module.exports = 'next>' + require('styled-jsx') + '|' + require('react');",
  );
  storePackage("old-lib", "1.0.0", "module.exports = 'old-lib>' + require('react');");
  storePackage("@scope/util", "2.0.0", "module.exports = 'util>' + require('react');");

  linkDependency("next", "1.0.0", "styled-jsx", "5.0.0");
  linkDependency("next", "1.0.0", "react", "19.0.0");
  linkDependency("styled-jsx", "5.0.0", "react", "19.0.0");
  linkDependency("old-lib", "1.0.0", "react", "18.0.0"); // a conflicting version
  linkDependency("@scope/util", "2.0.0", "react", "19.0.0");

  const nm = path.join(bundle, "node_modules");
  for (const [name, version] of [
    ["next", "1.0.0"],
    ["react", "19.0.0"],
    ["old-lib", "1.0.0"],
    ["@scope/util", "2.0.0"],
  ] as const) {
    linkRoot(nm, name, version);
  }
  // pnpm command shims and a monorepo app nested in the bundle with links of its own
  fs.mkdirSync(path.join(nm, ".bin"), { recursive: true });
  fs.symlinkSync("../next/index.js", path.join(nm, ".bin/next"));
  linkRoot(path.join(bundle, "examples/app/node_modules"), "next", "1.0.0");
  linkRoot(path.join(bundle, "examples/app/node_modules"), "react", "19.0.0");
}

function requireFrom(dir: string, request: string) {
  const r = spawnSync(
    process.execPath,
    ["-e", `process.stdout.write(String(require(${JSON.stringify(request)})))`],
    {
      cwd: dir,
      encoding: "utf8",
    },
  );
  return { out: r.stdout, err: r.stderr, status: r.status };
}

describe("the tree before flattening (documents the failure)", () => {
  it("has symbolic links, which Azure Functions does not keep", () => {
    buildTree();
    expect(findSymlinks(bundle).length).toBeGreaterThan(5);
  });
});

describe("flattenPnpmNodeModules", () => {
  it("leaves no symbolic link and no pnpm store", () => {
    buildTree();
    const result = flattenPnpmNodeModules(bundle);
    expect(result.flattened).toBe(true);
    expect(findSymlinks(bundle)).toEqual([]);
    expect(fs.existsSync(store())).toBe(false);
    expect(fs.existsSync(path.join(bundle, "node_modules/.bin"))).toBe(false);
  });

  it("resolves the chain that failed on Azure: app -> next -> styled-jsx -> react", () => {
    buildTree();
    flattenPnpmNodeModules(bundle);
    // from the nested monorepo app, whose own links were removed
    const r = requireFrom(path.join(bundle, "examples/app"), "next");
    expect(r.err).toBe("");
    expect(r.out).toBe("next>styled-jsx+react19|react19");
  });

  it("keeps a conflicting version of a dependency inside its dependent only", () => {
    buildTree();
    const result = flattenPnpmNodeModules(bundle);
    expect(requireFrom(path.join(bundle, "examples/app"), "old-lib").out).toBe("old-lib>react18");
    expect(requireFrom(path.join(bundle, "examples/app"), "react").out).toBe("react19");
    expect(fs.existsSync(path.join(bundle, "node_modules/old-lib/node_modules/react"))).toBe(true);
    expect(result.nested).toBeGreaterThanOrEqual(1);
  });

  it("handles scoped packages", () => {
    buildTree();
    flattenPnpmNodeModules(bundle);
    expect(requireFrom(path.join(bundle, "examples/app"), "@scope/util").out).toBe("util>react19");
  });

  it("copies real files, not links to the store", () => {
    buildTree();
    flattenPnpmNodeModules(bundle);
    const stat = fs.lstatSync(path.join(bundle, "node_modules/next"));
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
  });

  it("does nothing for a node_modules that is not a pnpm layout", () => {
    fs.mkdirSync(path.join(bundle, "node_modules/left-pad"), { recursive: true });
    fs.writeFileSync(
      path.join(bundle, "node_modules/left-pad/package.json"),
      '{"name":"left-pad","version":"1.0.0"}',
    );
    expect(flattenPnpmNodeModules(bundle)).toEqual({ flattened: false, packages: 0, nested: 0 });
    expect(fs.existsSync(path.join(bundle, "node_modules/left-pad/package.json"))).toBe(true);
  });

  it("works when the bundle has no node_modules at all", () => {
    expect(flattenPnpmNodeModules(bundle).flattened).toBe(false);
  });
});
