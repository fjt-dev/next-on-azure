// Installs the packed package the way a user does, with npm or Yarn 1, into a clean copy of
// examples/standalone, builds and packages it, and runs the HTTP suite against it on Azurite and the
// Functions host (scripts/e2e-standalone.mjs --app). Needs `pnpm install && pnpm build` first.
//   node scripts/install-test.mjs npm|yarn [--next <version>]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manager = process.argv[2];
if (manager !== "npm" && manager !== "yarn") {
  console.error("usage: node scripts/install-test.mjs npm|yarn [--next <version>]");
  process.exit(2);
}
const nextArg = process.argv.indexOf("--next");

const catalog = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
const pinned = (name) => new RegExp(`^  ${name}: (\\S+)`, "m").exec(catalog)?.[1];
const versions = {
  next: nextArg >= 0 ? process.argv[nextArg + 1] : pinned("next"),
  react: pinned("react"),
  "react-dom": pinned("react-dom"),
};

function run(cmd, args, cwd, env = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`failed (${r.status}): ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));

run("pnpm", ["--filter", "next-on-azure", "pack", "--pack-destination", tmp], root);
const tarball = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
if (!tarball) throw new Error("pnpm pack made no tarball");

const app = path.join(tmp, "app");
fs.cpSync(path.join(root, "examples/standalone"), app, {
  recursive: true,
  filter: (src) => !/(^|[\\/])(node_modules|\.next|\.next-azure)$/.test(src),
});
fs.writeFileSync(
  path.join(app, "package.json"),
  JSON.stringify(
    {
      name: "install-test",
      private: true,
      type: "module",
      dependencies: { ...versions, "next-on-azure": `file:${path.join(tmp, tarball)}` },
    },
    null,
    2,
  ),
);

if (manager === "npm") run("npm", ["install", "--no-audit", "--no-fund"], app);
else run("npx", ["--yes", "yarn@1.22.22", "install"], app);

const env = { NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
run("npx", ["next", "build"], app, env);
run("npx", ["next-on-azure", "package", "--target", "local"], app, env);
run("node", ["scripts/e2e-standalone.mjs", "--app", path.join(app, ".next-azure/app")], root);
console.log(`install test passed: ${manager}, Next.js ${versions.next}`);
