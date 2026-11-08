// Packages the standalone build as one Function app in .azure-app (spike, ADR-0016).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, ".azure-app");
const standalone = path.join(here, ".next/standalone");
// With the workspace root as tracing root the app sits at the same relative path inside standalone.
const appSub = path.relative(path.join(here, "../.."), here);
const pkg = path.join(here, "../../packages/open-next-azure/dist");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(standalone, path.join(out, "standalone"), { recursive: true, verbatimSymlinks: true });
// Azure drops symbolic links in a package, so the pnpm layout is turned into a plain tree.
const { flattenPnpmNodeModules, removeShims, findSymlinks } = await import(
  path.join(pkg, "cli/flatten-node-modules.js")
);
const flat = flattenPnpmNodeModules(path.join(out, "standalone"));
console.log("flattened:", JSON.stringify(flat));
removeShims(path.join(out, "standalone"));
fs.cpSync(path.join(here, ".next/static"), path.join(out, "standalone", appSub, ".next/static"), {
  recursive: true,
});
fs.cpSync(path.join(here, "public"), path.join(out, "standalone", appSub, "public"), {
  recursive: true,
});

// Next.js inlines the cache handler path relative to the dist directory ("../cache-handler.cjs") and
// copies the file itself, so nothing needs patching as long as the working directory is the app.
// The cache handler modules are copied next to server.js by Next.js only when traced; make sure all are there.
for (const f of ["cache-handler.cjs", "cache-handlers.cjs", "azure-storage.cjs"]) {
  fs.copyFileSync(path.join(here, f), path.join(out, "standalone", appSub, f));
}
fs.writeFileSync(
  path.join(out, "main.mjs"),
  fs.readFileSync(path.join(here, "main.mjs"), "utf8").replace("__APP_SUB__", appSub),
);
fs.copyFileSync(path.join(pkg, "overrides/cookies.js"), path.join(out, "cookies.mjs"));
const { hostJson } = await import(path.join(pkg, "cli/package-app.js"));
fs.writeFileSync(path.join(out, "host.json"), JSON.stringify(hostJson(), null, 2));
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify(
    {
      name: "standalone-app",
      type: "module",
      main: "main.mjs",
      dependencies: { "@azure/functions": "^4.7.0" },
    },
    null,
    2,
  ),
);
// File tracing does not copy all files of sharp (Next.js 16 loads `dist/index.cjs` dynamically, and
// the traced copy lacks it: the image optimizer then silently returns the original image). Copy the
// whole package, resolved the way Next.js resolves it.
{
  const requireFromNext = createRequire(
    createRequire(import.meta.url).resolve("next/package.json"),
  );
  let sharpDir;
  try {
    // sharp does not export its package.json: start at its entry point and go up to the package.
    sharpDir = path.dirname(requireFromNext.resolve("sharp"));
    while (!fs.existsSync(path.join(sharpDir, "package.json"))) sharpDir = path.dirname(sharpDir);
  } catch {
    // sharp is optional; without it Next.js serves images unoptimized, and so does this package.
  }
  const target = path.join(out, "standalone/node_modules/sharp");
  if (sharpDir && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true });
    fs.cpSync(sharpDir, target, { recursive: true, dereference: true });
    console.log("sharp: complete package copied");
  }
}

// For Azure (Linux x64) the build machine's sharp binaries are replaced: `node build-app.mjs --linux`.
if (process.argv.includes("--linux")) {
  const nmImg = path.join(out, "standalone/node_modules/@img");
  const sharpPkg = path.join(out, "standalone/node_modules/sharp/package.json");
  if (fs.existsSync(sharpPkg)) {
    const version = JSON.parse(fs.readFileSync(sharpPkg, "utf8")).version;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sharp-linux-"));
    const r = spawnSync(
      "npm",
      [
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
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error("npm install of the Linux sharp binaries failed");
    for (const d of fs.readdirSync(nmImg))
      if (/^sharp(-libvips)?-(darwin|win32|linuxmusl|linux-arm)/.test(d))
        fs.rmSync(path.join(nmImg, d), { recursive: true });
    for (const d of ["sharp-linux-x64", "sharp-libvips-linux-x64"]) {
      const from = path.join(tmp, "node_modules/@img", d);
      if (!fs.existsSync(from)) throw new Error(`@img/${d} was not installed`);
      fs.cpSync(from, path.join(nmImg, d), { recursive: true });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("sharp: Linux x64 binaries for", version);
  }
}

const links = findSymlinks(out);
if (links.length) throw new Error(`symbolic links left: ${links.slice(0, 3).join(", ")}`);
console.log("packaged .azure-app");
