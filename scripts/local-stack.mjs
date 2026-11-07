#!/usr/bin/env node
// Local stack for the packaged Function app: Azurite + Azure Functions Core Tools over HTTPS.
//
//   node scripts/local-stack.mjs [--dir <.open-next-azure dir>]
//
// Starts Azurite (blob 10000, queue 10001, table 10002), then the single Function app
// (server, /_next/image and the revalidation queue trigger) on https://localhost:7071.
// HTTPS is required because ISR revalidation fetches `https://<host>` (see docs/contribute/testing.md, B14).
// A self-signed certificate is created for this run and deleted on exit.
// Stop with Ctrl+C.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const appsDir = path.resolve(
  flag("--dir") ?? path.join(root, "examples/app-router/.open-next-azure"),
);

const bin = (name) => path.join(root, "node_modules/.bin", name);
const func = path.join(root, "node_modules/azure-functions-core-tools/bin/func");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opennext-azure-local-"));
const children = [];

function log(msg) {
  console.log(`[local-stack] ${msg}`);
}

// Set LOCAL_STACK_LOG_DIR to keep the host logs after the run (the temp directory is deleted on
// exit). CI uses it to upload the logs of a failed run.
function saveLogs() {
  const dest = process.env.LOCAL_STACK_LOG_DIR;
  if (!dest || !fs.existsSync(tmp)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(tmp)) {
    if (f.endsWith(".log")) fs.copyFileSync(path.join(tmp, f), path.join(dest, f));
  }
}

// Every child runs in its own process group (detached), so stopping the group also stops what the
// child spawned (Core Tools starts a host and a worker).
function stopChildren() {
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
}

function cleanup() {
  stopChildren();
  saveLogs();
  fs.rmSync(tmp, { recursive: true, force: true });
  log("stopped, certificate and temp files deleted");
}

// Whatever ends this process (a signal, an error in this script, a child that cannot start), the
// children, the certificate and the temp files must not stay behind. A leaked Azurite would hold
// the storage ports and make the next run fail.
process.on("exit", () => {
  stopChildren();
  saveLogs();
  fs.rmSync(tmp, { recursive: true, force: true });
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}
process.on("uncaughtException", (error) => {
  console.error("[local-stack] fatal:", error);
  process.exit(1); // the exit handler above stops the children
});
process.on("unhandledRejection", (error) => {
  console.error("[local-stack] fatal:", error);
  process.exit(1);
});

function start(name, cmd, cmdArgs, opts = {}) {
  const out = fs.openSync(path.join(tmp, `${name}.log`), "a");
  const child = spawn(cmd, cmdArgs, { detached: true, stdio: ["ignore", out, out], ...opts });
  children.push(child);
  child.on("error", (error) => {
    console.error(`[local-stack] could not start ${name}:`, error.message);
    process.exit(1);
  });
  child.on("exit", (code) => log(`${name} exited (${code})`));
  return child;
}

// Any HTTP response counts as "up"; the certificate is this run's own, so it is not verified here.
const probe = (url) =>
  new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : null;
    const req = lib
      ? lib.get(url, { rejectUnauthorized: false }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
      : fetch(url).then((r) => resolve(r.status), reject);
    if (lib) req.on("error", reject);
  });

async function waitFor(url, label, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await probe(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${label} did not become ready; see ${tmp}`);
}

// 0. Functions Core Tools. Its postinstall downloads a zip and unpacks it with extract-zip, which
// stopped halfway on Node 26 (only a few files appeared and no error was reported). If the binary
// is missing, unpack the zip it downloaded with the system `unzip`.
function ensureFunc() {
  if (fs.existsSync(func)) return;
  const binDir = path.dirname(func);
  const zip = fs.existsSync(binDir)
    ? fs.readdirSync(binDir).find((f) => /^Azure\.Functions\.Cli\..+\.zip$/.test(f))
    : undefined;
  if (!zip) {
    throw new Error(
      [
        `Azure Functions Core Tools are missing (${func}).`,
        'Run "pnpm install" and make sure the azure-functions-core-tools build script is allowed',
        "in pnpm-workspace.yaml.",
      ].join(" "),
    );
  }
  log(`${path.basename(func)} is missing; unpacking ${zip} with unzip`);
  sh2("unzip", ["-qo", path.join(binDir, zip), "-d", binDir]);
  fs.chmodSync(func, 0o755);
}
ensureFunc();

// 1. Certificate (valid 1 day, deleted on exit)
const pw = "local";
const sh = (cmd, a) => {
  const r = spawnSync(cmd, a, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
};
sh("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-days",
  "1",
  "-subj",
  "/CN=localhost",
  "-addext",
  "subjectAltName=DNS:localhost,IP:127.0.0.1",
  "-keyout",
  path.join(tmp, "key.pem"),
  "-out",
  path.join(tmp, "cert.pem"),
]);
sh("openssl", [
  "pkcs12",
  "-export",
  "-out",
  path.join(tmp, "cert.pfx"),
  "-inkey",
  path.join(tmp, "key.pem"),
  "-in",
  path.join(tmp, "cert.pem"),
  "-passout",
  `pass:${pw}`,
]);

// 2. Azurite
fs.mkdirSync(path.join(tmp, "azurite"));
start("azurite", bin("azurite"), [
  "--silent",
  "--location",
  path.join(tmp, "azurite"),
  "--skipApiVersionCheck",
]);
await waitFor("http://127.0.0.1:10000/", "azurite");

const cs = "UseDevelopmentStorage=true;";
const require = createRequire(path.join(root, "packages/open-next-azure/package.json"));
const { BlobServiceClient } = require("@azure/storage-blob");
const { TableServiceClient } = require("@azure/data-tables");
const { QueueServiceClient } = require("@azure/storage-queue");
const { contentTypeFor } = await import(
  path.join(root, "packages/open-next-azure/dist/cli/assets-manifest.js")
);
for (const c of ["cache", "assets"])
  await BlobServiceClient.fromConnectionString(cs).getContainerClient(c).createIfNotExists();
await TableServiceClient.fromConnectionString(cs, { allowInsecureConnection: true })
  .createTable("tagcache")
  .catch((e) => {
    if (e.statusCode !== 409) throw e;
  });
for (const q of ["revalidation", "revalidation-poison"])
  await QueueServiceClient.fromConnectionString(cs).getQueueClient(q).createIfNotExists();
// Upload build output the same way `opennext-azure deploy` does: assets -> assets, cache -> cache.
async function uploadDir(container, dir) {
  if (!fs.existsSync(dir)) return 0;
  const client = BlobServiceClient.fromConnectionString(cs).getContainerClient(container);
  let n = 0;
  const walk = async (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        await client
          .getBlockBlobClient(path.relative(dir, full).split(path.sep).join("/"))
          .uploadFile(full, {
            blobHTTPHeaders: { blobContentType: contentTypeFor(full) },
          });
        n++;
      }
    }
  };
  await walk(dir);
  return n;
}
const openNextDir = path.join(appsDir, "..", ".open-next");
const nAssets = await uploadDir("assets", path.join(openNextDir, "assets"));
const nCache = await uploadDir("cache", path.join(openNextDir, "cache"));
log(
  `azurite ready: containers cache/assets, table tagcache, queue revalidation (uploaded ${nAssets} assets, ${nCache} cache files)`,
);

// 3. Function app
const port = 7071;
const env = {
  ...process.env,
  FUNCTIONS_WORKER_RUNTIME: "node",
  AzureWebJobsStorage: cs,
  AZURE_STORAGE_CONNECTION_STRING: cs,
  CACHE_CONTAINER_NAME: "cache",
  ASSETS_CONTAINER_NAME: "assets",
  CACHE_TABLE_NAME: "tagcache",
  REVALIDATION_QUEUE_NAME: "revalidation",
  OPENNEXT_STATIC_ETAG: "true",
  FUNCTIONS_REQUEST_BODY_SIZE_LIMIT: "104857600",
  // The revalidation trigger calls https://localhost:7071; trust only this run's certificate.
  NODE_EXTRA_CA_CERTS: path.join(tmp, "cert.pem"),
};

function sh2(cmd, a, cwd) {
  const r = spawnSync(cmd, a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed: ${r.stderr}`);
}

// The packaged app contains Linux x64 sharp binaries (what Azure needs). On any other host
// (for example macOS) run a temporary copy with sharp binaries for this machine instead.
function localAppDir(src) {
  if (process.platform === "linux" && process.arch === "x64") return src;
  const copy = path.join(tmp, "app-local");
  fs.cpSync(src, copy, { recursive: true });
  const stage = path.join(tmp, "sharp-stage");
  fs.mkdirSync(stage);
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify({ name: "stage", private: true }),
  );
  sh2("npm", ["install", "--no-audit", "--no-fund", "sharp@0.33.5"], stage);
  const target = path.join(copy, "image/node_modules/@img");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(stage, "node_modules/@img"), target, { recursive: true });
  log(`app runs from a local copy with sharp for ${process.platform}-${process.arch}`);
  return copy;
}

// Run what `deploy` uploads: the zip, unpacked (symbolic links preserved), not the directory it was
// made from. Running the directory hid a deployment failure: the zip had lost the pnpm symlinks.
const zipFile = path.join(appsDir, "app.zip");
let packaged = path.join(appsDir, "app");
if (fs.existsSync(zipFile)) {
  packaged = path.join(tmp, "app-from-zip");
  fs.mkdirSync(packaged);
  sh2("unzip", ["-q", zipFile, "-d", packaged]);
  log(`running the unpacked ${path.basename(zipFile)}`);
} else if (!fs.existsSync(packaged)) {
  throw new Error(
    `${zipFile} not found. Run "pnpm --filter example-app-router run package" first.`,
  );
}
const cwd = fs.existsSync(path.join(packaged, "image/node_modules/sharp"))
  ? localAppDir(packaged)
  : packaged;
start(
  "app",
  func,
  [
    "start",
    "--port",
    String(port),
    "--useHttps",
    "--cert",
    path.join(tmp, "cert.pfx"),
    "--password",
    pw,
  ],
  { cwd, env },
);
await waitFor(`https://localhost:${port}/admin/host/status`, "app");
log("ready");
log(`app: https://localhost:${port}   (server, /_next/image, revalidation queue trigger)`);
log(`logs: ${tmp}/*.log   (stop with Ctrl+C)`);
setInterval(() => {}, 1 << 30);
