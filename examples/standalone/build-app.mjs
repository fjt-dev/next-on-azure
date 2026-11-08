// Packages the standalone build as one Function app in .azure-app (spike, ADR-0016).
import fs from "node:fs";
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
const links = findSymlinks(out);
if (links.length) throw new Error(`symbolic links left: ${links.slice(0, 3).join(", ")}`);
console.log("packaged .azure-app");
