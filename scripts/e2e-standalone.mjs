// Runs the HTTP E2E suite against examples/standalone (next-on-azure, ADR-0016/0017): packages the
// example for the local machine, starts Azurite and the Functions host, runs the `remote` project of
// tests-e2e against http://localhost:7071, and stops everything. Set LOCAL_STACK_LOG_DIR to keep the
// host output (CI uploads it when the run fails).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = "http://localhost:7071";

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  return r.status ?? 1;
}

if (run("pnpm", ["--filter", "example-standalone", "run", "standalone"]) !== 0) process.exit(1);

const logDir = process.env.LOCAL_STACK_LOG_DIR;
if (logDir) fs.mkdirSync(logDir, { recursive: true });
const log = logDir ? fs.openSync(path.join(logDir, "standalone-local.log"), "a") : "inherit";
const stack = spawn("node", ["scripts/standalone-local.mjs"], {
  cwd: root,
  stdio: ["ignore", log, log],
});
let stackExited = false;
stack.on("exit", () => {
  stackExited = true;
});
const stop = () => {
  if (!stackExited) stack.kill("SIGINT");
};
process.on("exit", stop);

// Ready when the slow Suspense route answers: it only exists once the Next.js server runs.
let ready = false;
for (let i = 0; i < 120 && !ready && !stackExited; i++) {
  try {
    const res = await fetch(`${url}/slow`, { signal: AbortSignal.timeout(15_000) });
    ready = res.status < 500;
  } catch {
    // not up yet
  }
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) {
  console.error("The standalone stack did not answer within two minutes.");
  stop();
  process.exit(1);
}

const status = run(
  "pnpm",
  ["--filter", "tests-e2e", "exec", "vitest", "run", "--project", "remote"],
  {
    E2E_BASE_URL: url,
    E2E_TARGET: "standalone",
  },
);
stop();
process.exit(status);
