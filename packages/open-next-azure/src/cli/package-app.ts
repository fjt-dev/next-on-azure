import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssetsManifest } from "./assets-manifest.js";
import { findSymlinks, flattenPnpmNodeModules, removeShims } from "./flatten-node-modules.js";

/**
 * Builds the single Function app described in ADR-0009 from an OpenNext build:
 *
 *   app/
 *     main.mjs  host.json  package.json  node_modules/   (Azure Functions entry + Azure SDKs)
 *     server/   image/   revalidation/                    (the OpenNext bundles, untouched)
 *     server/assets-manifest.json                         (what the asset resolver may serve)
 */

/** Bundle name -> directory inside `.open-next`. */
const BUNDLES = {
  server: "server-functions/default",
  image: "image-optimization-function",
  revalidation: "revalidation-function",
} as const;
type BundleName = keyof typeof BUNDLES;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function run(cmd: string, args: string[], cwd?: string) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  }
}

/**
 * The generated Functions entry point.
 *
 * Each OpenNext bundle expects its own directory as the working directory: the revalidation adapter
 * reads ./prerender-manifest.json at import time and Next.js resolves .next relative to it. So the
 * entry changes directory before importing each bundle, and loads `server` last so that the server
 * keeps its directory as the working directory at runtime. See ADR-0009.
 */
export function entrypoint(bundles: BundleName[]): string {
  const has = (b: BundleName) => bundles.includes(b);
  const lines = [
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'import { app } from "@azure/functions";',
    "",
    "app.setup({ enableHttpStream: true });",
    `const methods = ${JSON.stringify(HTTP_METHODS)};`,
    "const root = path.dirname(fileURLToPath(import.meta.url));",
    "",
    "// In a monorepo OpenNext nests the app inside the server bundle, so the runtime cwd is not the",
    "// bundle root. Tell the asset resolver exactly where its manifest is.",
    'process.env.ASSETS_MANIFEST_PATH ??= path.join(root, "server", "assets-manifest.json");',
    "",
    "async function load(name) {",
    "  process.chdir(path.join(root, name));",
    "  return (await import(`./${name}/index.mjs`)).handler;",
    "}",
    "",
  ];
  if (has("image")) lines.push('const image = await load("image");');
  if (has("revalidation")) lines.push('const revalidation = await load("revalidation");');
  lines.push('const server = await load("server"); // last: keeps its directory as cwd', "");
  if (has("image")) {
    lines.push(
      'app.http("image", { methods, authLevel: "anonymous", route: "_next/image", handler: image });',
    );
  }
  lines.push(
    'app.http("server", { methods, authLevel: "anonymous", route: "{*path}", handler: server });',
  );
  if (has("revalidation")) {
    lines.push(
      'app.storageQueue("revalidation", {',
      '  queueName: process.env.REVALIDATION_QUEUE_NAME ?? "revalidation",',
      '  connection: "AzureWebJobsStorage",',
      "  handler: revalidation,",
      "});",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function hostJson() {
  return {
    version: "2.0",
    // Non-.NET apps get trigger/binding extensions (queue trigger) from the extension bundle.
    extensionBundle: {
      id: "Microsoft.Azure.Functions.ExtensionBundle",
      version: "[4.*, 5.0.0)",
    },
    extensions: {
      // Empty prefix so Next.js routes are served from "/" instead of "/api"
      http: { routePrefix: "" },
      // The revalidation override enqueues plain JSON (not base64)
      queues: { messageEncoding: "none", maxDequeueCount: 3 },
    },
    // The platform default: telemetry is sampled, requests are not (every request stays visible).
    // Full, unsampled telemetry costs more with traffic; `deploy --full-telemetry` turns the
    // sampling off with an app setting (see main.bicep).
    logging: {
      applicationInsights: { samplingSettings: { isEnabled: true, excludedTypes: "Request" } },
    },
  };
}

/** Azure runtime dependencies, pinned to the ranges this package was built with. */
function runtimeDeps(): Record<string, string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const own = JSON.parse(fs.readFileSync(path.resolve(here, "../../package.json"), "utf8"));
  return own.dependencies as Record<string, string>;
}

/** Installs the Azure SDKs once, at the app root, where every bundle resolves them from. */
function installRuntimeDeps(appDir: string) {
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], appDir);
}

/**
 * Azure Functions on Linux needs sharp's linux-x64 glibc native binaries. Without them sharp fails
 * to load and the image optimizer silently serves the original, unresized image. Refuse to package that.
 */
export function assertSharpForAzure(imageDir: string) {
  const nm = path.join(imageDir, "node_modules");
  if (!fs.existsSync(path.join(nm, "sharp"))) return;
  const missing = ["sharp-linux-x64", "sharp-libvips-linux-x64"].filter(
    (n) => !fs.existsSync(path.join(nm, "@img", n)),
  );
  if (missing.length > 0) {
    throw new Error(
      [
        `The image bundle has sharp but is missing @img/${missing.join(", @img/")} (Linux x64 glibc).`,
        'Set install: { packages: ["sharp@0.33.5"], os: "linux", arch: "x64", libc: "glibc" }',
        "under imageOptimization in open-next.config.ts and run open-next build again.",
      ].join("\n"),
    );
  }
}

/**
 * Zips `dir` into `zipFile`. `-y` keeps symbolic links as links. pnpm builds node_modules out of
 * symlinks and Node resolves a package's dependencies relative to its real path; zipping the link
 * targets instead (the default) copies each package to a new place where its siblings are missing,
 * and the app fails to start with "Cannot find module" (seen on Azure, see the work log).
 */
export function zipDirectory(dir: string, zipFile: string) {
  run("zip", ["-qry", zipFile, "."], dir);
}

/**
 * A deployed package must not contain symbolic links: Azure Functions (Flex Consumption) drops
 * them, which surfaced as "Cannot find package" at startup. Better to stop here than to deploy.
 */
export function assertNoSymlinks(dir: string) {
  const links = findSymlinks(dir);
  if (links.length > 0) {
    const shown = links.slice(0, 5).map((l) => `  ${path.relative(dir, l)}`);
    throw new Error(
      [
        `The package still contains ${links.length} symbolic link(s); Azure Functions would drop them:`,
        ...shown,
        links.length > shown.length ? "  ..." : "",
        "Install with a hoisted node_modules (for pnpm: node-linker=hoisted) or report this layout.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

/**
 * Copies an OpenNext bundle keeping symbolic links as they are. `fs.cpSync` rewrites a relative link
 * to an absolute path into the *source* tree by default, which silently ties the copy to the machine
 * it was built on (the links then pointed into `.open-next/` on the build machine) and hides the
 * pnpm store from the flattening step.
 */
export function copyBundle(from: string, to: string) {
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

export type PackageResult = { appDir: string; zip: string; bundles: BundleName[] };

export function packageApp({
  openNextDir = ".open-next",
  outDir = ".open-next-azure",
} = {}): PackageResult {
  if (!fs.existsSync(path.join(openNextDir, BUNDLES.server))) {
    throw new Error(`${openNextDir}/${BUNDLES.server} not found. Run "npx open-next build" first.`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  const appDir = path.join(outDir, "app");
  fs.mkdirSync(appDir, { recursive: true });

  const bundles: BundleName[] = [];
  for (const name of Object.keys(BUNDLES) as BundleName[]) {
    const from = path.join(openNextDir, BUNDLES[name]);
    if (!fs.existsSync(from)) {
      console.warn(`skip ${name}: ${from} not found`);
      continue;
    }
    copyBundle(from, path.join(appDir, name));
    bundles.push(name);
  }

  // The asset resolver reads this from the server directory (the runtime cwd).
  const assetsDir = path.join(openNextDir, "assets");
  if (fs.existsSync(assetsDir)) {
    const manifest = buildAssetsManifest(assetsDir);
    fs.writeFileSync(path.join(appDir, "server", "assets-manifest.json"), JSON.stringify(manifest));
    console.log(`assets manifest: ${Object.keys(manifest.files).length} files`);
  } else {
    console.warn(`no ${assetsDir}; static files will not be served`);
  }

  // Azure Functions (Flex Consumption) does not keep symbolic links of a deployed package, and a
  // pnpm node_modules is made of them. Turn it into a plain tree (see flatten-node-modules.ts).
  for (const name of bundles) {
    const result = flattenPnpmNodeModules(path.join(appDir, name));
    if (result.flattened) {
      console.log(
        `flattened pnpm node_modules of ${name}: ${result.packages} packages (${result.nested} nested for version conflicts)`,
      );
    }
  }

  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "opennext-azure-app",
        private: true,
        type: "module",
        main: "main.mjs",
        dependencies: runtimeDeps(),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(appDir, "main.mjs"), entrypoint(bundles));
  fs.writeFileSync(path.join(appDir, "host.json"), JSON.stringify(hostJson(), null, 2));
  installRuntimeDeps(appDir);
  removeShims(appDir);
  assertNoSymlinks(appDir);
  if (bundles.includes("image")) assertSharpForAzure(path.join(appDir, "image"));

  const zip = path.resolve(outDir, "app.zip");
  zipDirectory(appDir, zip);
  console.log(`packaged ${bundles.join(", ")} -> ${path.join(outDir, "app.zip")}`);
  return { appDir, zip, bundles };
}
