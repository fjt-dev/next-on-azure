import fs from "node:fs";
import path from "node:path";

/**
 * Turns a pnpm `node_modules` (a virtual store of real packages plus symbolic links) into a plain
 * tree without any symbolic link.
 *
 * Why: Azure Functions (Flex Consumption) does not keep symbolic links of a deployed package, so a
 * pnpm layout fails at startup ("Cannot find package 'next'"). Zipping the link targets instead does
 * not help either: Node resolves a package's dependencies from its real path, and a copy placed at a
 * new location has lost its siblings ("Cannot find module 'styled-jsx/package.json'").
 *
 * How: every package is copied to the top level of `node_modules` (one version per name, the one the
 * application itself links to, otherwise the highest). A dependency whose required version is not the
 * one Node would find from a package's location is copied into that package's own `node_modules`
 * (the layout npm produces for conflicting versions). Then the store and all remaining links go.
 *
 * Packages that are the same name and version are treated as the same package, so pnpm's peer
 * dependency variants of one version are collapsed into one copy.
 */

type Pkg = {
  name: string;
  version: string;
  /** Real directory inside the pnpm store. */
  dir: string;
  /** Dependency name -> the store package pnpm linked for it. */
  deps: Map<string, Pkg>;
};

export type FlattenResult = {
  /** false when there was no pnpm store to flatten */
  flattened: boolean;
  packages: number;
  /** copies placed inside another package because of a version conflict */
  nested: number;
};

const MAX_NESTING = 12;

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return undefined;
  }
};

function readJson(file: string): { name?: string; version?: string } | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Entries of a `node_modules` directory as package names (scopes expanded), flagging links. */
function entriesOf(nodeModules: string): { name: string; dir: string; link: boolean }[] {
  const out: { name: string; dir: string; link: boolean }[] = [];
  if (!fs.existsSync(nodeModules)) return out;
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .bin, .pnpm, .package-lock.json, ...
    const full = path.join(nodeModules, entry.name);
    if (entry.name.startsWith("@") && !entry.isSymbolicLink()) {
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        const subFull = path.join(full, sub.name);
        out.push({ name: `${entry.name}/${sub.name}`, dir: subFull, link: sub.isSymbolicLink() });
      }
    } else {
      out.push({ name: entry.name, dir: full, link: entry.isSymbolicLink() });
    }
  }
  return out;
}

/** -1, 0, 1 for dotted versions; prerelease tags only break ties. */
function compareVersions(a: string, b: string): number {
  const num = (v: string) =>
    v
      .split("-")[0]
      ?.split(".")
      .map((n) => Number.parseInt(n, 10) || 0) ?? [];
  const [x, y] = [num(a), num(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return a === b ? 0 : a.includes("-") ? -1 : b.includes("-") ? 1 : 0;
}

/** All `node_modules` directories under `root`, not entering the pnpm store or following links. */
function findNodeModulesDirs(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === ".pnpm") continue;
      const full = path.join(dir, entry.name);
      if (entry.name === "node_modules") {
        found.push(full);
        // packages of this node_modules may hold nested node_modules of their own
      }
      walk(full);
    }
  };
  walk(root);
  return found;
}

function buildIndex(store: string): Map<string, Pkg> {
  const byDir = new Map<string, Pkg>();
  const ids = fs
    .readdirSync(store, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "node_modules");

  // First pass: the real package of every store entry.
  for (const id of ids) {
    const nodeModules = path.join(store, id.name, "node_modules");
    for (const entry of entriesOf(nodeModules)) {
      if (entry.link) continue;
      const json = readJson(path.join(entry.dir, "package.json"));
      const dir = real(entry.dir);
      if (!dir) continue;
      byDir.set(dir, {
        name: json?.name ?? entry.name,
        version: json?.version ?? "0.0.0",
        dir,
        deps: new Map(),
      });
    }
  }
  // Second pass: what each package was linked to.
  for (const id of ids) {
    const nodeModules = path.join(store, id.name, "node_modules");
    const entries = entriesOf(nodeModules);
    const self = entries.filter((e) => !e.link).map((e) => byDir.get(real(e.dir) ?? ""));
    for (const entry of entries) {
      if (!entry.link) continue;
      const target = byDir.get(real(entry.dir) ?? "");
      if (!target) continue;
      for (const pkg of self) pkg?.deps.set(entry.name, target);
    }
  }
  return byDir;
}

function copyPackage(pkg: Pkg, dest: string) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(pkg.dir, dest, { recursive: true, dereference: true, force: true });
}

/** The version Node would find for `name` when code inside `pkgDir` requires it, or undefined. */
function resolvedVersion(pkgDir: string, name: string): string | undefined {
  const candidates = [path.join(pkgDir, "node_modules", name)];
  for (let dir = path.dirname(pkgDir); ; dir = path.dirname(dir)) {
    candidates.push(
      path.basename(dir) === "node_modules"
        ? path.join(dir, name)
        : path.join(dir, "node_modules", name),
    );
    if (dir === path.dirname(dir)) break;
  }
  for (const candidate of candidates) {
    const json = readJson(path.join(candidate, "package.json"));
    if (json?.version) return json.version;
  }
  return undefined;
}

export function flattenPnpmNodeModules(bundleDir: string): FlattenResult {
  const nm = path.join(bundleDir, "node_modules");
  const store = path.join(nm, ".pnpm");
  if (!fs.existsSync(store)) return { flattened: false, packages: 0, nested: 0 };

  const byDir = buildIndex(store);

  // Every link from outside the store into it is a dependency of the application itself.
  type Root = { nodeModules: string; name: string; pkg: Pkg };
  const roots: Root[] = [];
  for (const nodeModules of [nm, ...findNodeModulesDirs(bundleDir).filter((d) => d !== nm)]) {
    for (const entry of entriesOf(nodeModules)) {
      if (!entry.link) continue;
      const pkg = byDir.get(real(entry.dir) ?? "");
      if (pkg) roots.push({ nodeModules, name: entry.name, pkg });
    }
  }

  // One version per name at the top level: what the application links to, otherwise the highest.
  const top = new Map<string, Pkg>();
  const pinned = new Set(roots.map((r) => r.name));
  for (const root of roots.filter((r) => r.nodeModules === nm)) top.set(root.name, root.pkg);
  for (const root of roots) if (!top.has(root.name)) top.set(root.name, root.pkg);
  for (const pkg of byDir.values()) {
    const current = top.get(pkg.name);
    if (!current || (!pinned.has(pkg.name) && compareVersions(pkg.version, current.version) > 0)) {
      top.set(pkg.name, pkg);
    }
  }

  // Remove every link that points into the store (they are replaced by copies below).
  for (const root of roots) fs.rmSync(path.join(root.nodeModules, root.name), { force: true });

  const queue: { dest: string; pkg: Pkg }[] = [];
  let packages = 0;
  let nested = 0;
  const place = (pkg: Pkg, dest: string, isNested: boolean) => {
    copyPackage(pkg, dest);
    queue.push({ dest, pkg });
    packages += 1;
    if (isNested) nested += 1;
  };

  for (const [name, pkg] of top) place(pkg, path.join(nm, name), false);

  // Application roots outside the top level (a monorepo app inside the bundle): the top-level copy
  // serves them when it is the same version, otherwise that app gets its own copy.
  for (const root of roots) {
    if (root.nodeModules === nm) continue;
    const fromApp = path.join(path.dirname(root.nodeModules), "_");
    if (resolvedVersion(fromApp, root.name) !== root.pkg.version) {
      place(root.pkg, path.join(root.nodeModules, root.name), true);
    }
  }

  while (queue.length > 0) {
    const { dest, pkg } = queue.shift() as { dest: string; pkg: Pkg };
    if (dest.split(`${path.sep}node_modules${path.sep}`).length > MAX_NESTING) continue;
    for (const [depName, dep] of pkg.deps) {
      if (resolvedVersion(dest, depName) === dep.version) continue;
      place(dep, path.join(dest, "node_modules", depName), true);
    }
  }

  fs.rmSync(store, { recursive: true, force: true });
  removeShims(bundleDir);
  return { flattened: true, packages, nested };
}

/** `.bin` directories only hold command shims (links); nothing at runtime needs them. */
export function removeShims(root: string) {
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === ".bin") fs.rmSync(full, { recursive: true, force: true });
      else walk(full);
    }
  };
  walk(root);
}

/** Paths of every symbolic link below `root`. */
export function findSymlinks(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) found.push(full);
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found;
}
