import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actionsKeyMessage, checkActionsKey } from "./actions-key.js";
import { findSymlinks, flattenPnpmNodeModules, removeShims } from "./flatten-node-modules.js";
import { assertSupportedNext } from "./next-version.js";

/**
 * Builds the Function app from a Next.js standalone build (ADR-0016, ADR-0017):
 *
 *   .next-azure/app/
 *     main.mjs  cookies.mjs  host.json  package.json  node_modules/   (Functions entry, @azure/functions)
 *     standalone/<app>/   server.js  .next/static  public  cache handlers  node_modules/ (flattened)
 *   .next-azure/app.zip
 */

const runtimeDir = () => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runtime");

export function run(cmd: string, args: string[], cwd?: string) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}

export function hostJson() {
  return {
    version: "2.0",
    // Only an HTTP trigger is used, so no extension bundle is needed.
    extensions: {
      // Empty prefix so Next.js routes are served from "/" instead of "/api"
      http: { routePrefix: "" },
    },
    // The platform default: telemetry is sampled, requests are not (every request stays visible).
    logging: {
      applicationInsights: { samplingSettings: { isEnabled: true, excludedTypes: "Request" } },
    },
  };
}

/**
 * The directory inside `.next/standalone` that holds `server.js`. In a monorepo Next.js nests the
 * app under its path relative to the workspace root (`examples/app`), otherwise it is the top.
 */
export function findAppDir(standaloneDir: string, depth = 6): string | undefined {
  if (fs.existsSync(path.join(standaloneDir, "server.js"))) return "";
  if (depth <= 0) return undefined;
  for (const entry of fs.readdirSync(standaloneDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".next") continue;
    const found = findAppDir(path.join(standaloneDir, entry.name), depth - 1);
    if (found !== undefined) return path.join(entry.name, found);
  }
  return undefined;
}

/** The Functions entry with the location of the Next.js server filled in. */
export function entrypoint(appSub: string): string {
  const template = fs.readFileSync(path.join(runtimeDir(), "entry.mjs"), "utf8");
  if (!template.includes("__APP_SUB__"))
    throw new Error("entry.mjs has no __APP_SUB__ placeholder");
  return template.replace("__APP_SUB__", appSub.split(path.sep).join("/"));
}

/**
 * File tracing does not copy all files of sharp (Next.js 16 loads `dist/index.cjs` dynamically, and the
 * traced copy lacks it: the image optimizer then silently returns the original image). Copy the whole
 * package, resolved the way Next.js resolves it. Returns true if sharp is part of the app.
 */
export function copyCompleteSharp(appRoot: string, targetNodeModules: string): boolean {
  const target = path.join(targetNodeModules, "sharp");
  if (!fs.existsSync(target)) return false;
  let dir: string;
  try {
    const fromNext = createRequire(
      createRequire(path.join(appRoot, "package.json")).resolve("next/package.json"),
    );
    // sharp does not export its package.json: start at its entry point and go up to the package.
    dir = path.dirname(fromNext.resolve("sharp"));
    while (!fs.existsSync(path.join(dir, "package.json"))) dir = path.dirname(dir);
  } catch {
    return true; // the traced copy stays
  }
  fs.rmSync(target, { recursive: true });
  fs.cpSync(dir, target, { recursive: true, dereference: true });
  return true;
}

/** Replaces the sharp binaries of the build machine by the Linux x64 glibc ones Azure Functions runs on. */
export function installLinuxSharp(targetNodeModules: string) {
  const img = path.join(targetNodeModules, "@img");
  const manifest = path.join(targetNodeModules, "sharp/package.json");
  if (!fs.existsSync(manifest)) return;
  const version = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { version: string }).version;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sharp-linux-"));
  try {
    run("npm", [
      "install",
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "--os=linux",
      "--cpu=x64",
      "--libc=glibc",
      "--prefix",
      tmp,
      `sharp@${version}`,
    ]);
    fs.mkdirSync(img, { recursive: true });
    for (const d of fs.readdirSync(img)) {
      if (/^sharp(-libvips)?-(darwin|win32|linuxmusl|linux-arm)/.test(d))
        fs.rmSync(path.join(img, d), { recursive: true });
    }
    for (const d of ["sharp-linux-x64", "sharp-libvips-linux-x64"]) {
      const from = path.join(tmp, "node_modules/@img", d);
      if (!fs.existsSync(from)) throw new Error(`@img/${d} was not installed`);
      fs.cpSync(from, path.join(img, d), { recursive: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function assertNoSymlinks(dir: string) {
  const links = findSymlinks(dir);
  if (links.length > 0) {
    const shown = links.slice(0, 5).map((l) => `  ${path.relative(dir, l)}`);
    throw new Error(
      `The package still contains ${links.length} symbolic link(s); Azure Functions would drop them:\n${shown.join("\n")}`,
    );
  }
}

export type PackageOptions = {
  /** The Next.js app (default: the working directory). */
  appRoot?: string;
  outDir?: string;
  /** `azure` (default) packs the Linux x64 sharp binaries; `local` keeps the build machine's. */
  target?: "azure" | "local";
  allowUnsupportedNext?: boolean;
};
export type PackageResult = { appDir: string; zip: string; appSub: string };

export function packageApp(options: PackageOptions = {}): PackageResult {
  const appRoot = path.resolve(options.appRoot ?? process.cwd());
  const standalone = path.join(appRoot, ".next/standalone");
  if (!fs.existsSync(standalone)) {
    throw new Error(
      `${standalone} not found. Run "next build" first, with \`output: "standalone"\` (use withAzure() from next-on-azure/config).`,
    );
  }
  assertSupportedNext(appRoot, { allowUnsupported: options.allowUnsupportedNext });
  const keyMessage = actionsKeyMessage(checkActionsKey(path.join(appRoot, ".next/server")));
  if (keyMessage) console.warn(`Warning: ${keyMessage}`);

  const appSub = findAppDir(standalone);
  if (appSub === undefined) throw new Error(`No server.js found below ${standalone}.`);

  const outDir = path.resolve(appRoot, options.outDir ?? ".next-azure");
  const appDir = path.join(outDir, "app");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  // Azure drops symbolic links in a package, so the pnpm layout is turned into a plain tree.
  const target = path.join(appDir, "standalone");
  fs.cpSync(standalone, target, { recursive: true, verbatimSymlinks: true });
  const flat = flattenPnpmNodeModules(target);
  if (flat.flattened)
    console.log(`flattened pnpm node_modules: ${flat.packages} packages (${flat.nested} nested)`);
  removeShims(target);

  const server = path.join(target, appSub);
  fs.cpSync(path.join(appRoot, ".next/static"), path.join(server, ".next/static"), {
    recursive: true,
  });
  if (fs.existsSync(path.join(appRoot, "public"))) {
    fs.cpSync(path.join(appRoot, "public"), path.join(server, "public"), { recursive: true });
  }

  const nodeModules = path.join(target, "node_modules");
  if (copyCompleteSharp(appRoot, nodeModules) && (options.target ?? "azure") === "azure") {
    installLinuxSharp(nodeModules);
  }

  fs.writeFileSync(path.join(appDir, "main.mjs"), entrypoint(appSub));
  fs.copyFileSync(path.join(runtimeDir(), "cookies.js"), path.join(appDir, "cookies.mjs"));
  fs.copyFileSync(path.join(runtimeDir(), "front-door.mjs"), path.join(appDir, "front-door.mjs"));
  fs.writeFileSync(path.join(appDir, "host.json"), JSON.stringify(hostJson(), null, 2));
  const own = JSON.parse(
    fs.readFileSync(path.resolve(runtimeDir(), "../../package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
  };
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "next-on-azure-app",
        type: "module",
        main: "main.mjs",
        dependencies: { "@azure/functions": own.dependencies["@azure/functions"] },
      },
      null,
      2,
    ),
  );
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], appDir);
  assertNoSymlinks(appDir);

  const zip = path.join(outDir, "app.zip");
  run("zip", ["-qry", zip, "."], appDir);
  console.log(`packaged -> ${path.relative(process.cwd(), zip) || zip}`);
  return { appDir, zip, appSub };
}
