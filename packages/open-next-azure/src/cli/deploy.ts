import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./package-app.js";

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Like run(), but keeps stderr so the error text can be inspected. */
function runCapturingErrors(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${r.stderr}`);
}

/** A new role assignment takes minutes to reach the data plane; retry only authorization errors. */
function withRoleRetry(action: () => void, attempts = 10, waitMs = 30_000) {
  for (let i = 1; ; i++) {
    try {
      return action();
    } catch (error) {
      const text = String((error as Error).message);
      const authorization = /AuthorizationPermissionMismatch|AuthorizationFailure|403/.test(text);
      if (!authorization || i >= attempts) throw error;
      console.warn(`Role assignment not effective yet (attempt ${i}/${attempts}); waiting 30 s.`);
      sleepSync(waitMs);
    }
  }
}

function azOut(args: string[]): string {
  const r = spawnSync("az", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function option(argv: string[], flag: string, short?: string): string | undefined {
  const i = argv.findIndex((a) => a === flag || (short !== undefined && a === short));
  return i >= 0 ? argv[i + 1] : undefined;
}

function integerOption(
  argv: string[],
  flag: string,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  const raw = option(argv, flag);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${flag} must be an integer from ${min}${max === Number.MAX_SAFE_INTEGER ? "" : ` to ${max}`}`,
    );
  }
  return value;
}

/**
 * opennext-azure deploy -g <rg> -n <name> [-l <location>] [--front-door] [--wait-until hold|detach]
 *   [--always-ready <n>] [--revalidation-always-ready <n>] [--revalidation-dedupe-seconds <n>]
 *   [--revalidation-polling-seconds <1-60>] [--alert-queue-backlog <messages>]
 *   [--deployer-principal-id <object id>] [--deployer-principal-type User|ServicePrincipal|Group] [--output-file <path>]
 *
 * Creates the infrastructure with Bicep, uploads static assets and the prerender cache, and
 * deploys `.open-next-azure/app.zip`. Creates billable resources; see docs/contribute/azure_runs.md.
 */
export function deploy(argv: string[]) {
  const rg = option(argv, "--resource-group", "-g");
  const name = option(argv, "--name", "-n");
  const location = option(argv, "--location", "-l");
  const frontDoor = argv.includes("--front-door");
  const alwaysReady = integerOption(argv, "--always-ready", 0, 0);
  const revalidationAlwaysReady = Number(option(argv, "--revalidation-always-ready") ?? "0");
  if (!Number.isInteger(revalidationAlwaysReady) || revalidationAlwaysReady < 0) {
    throw new Error("--revalidation-always-ready must be a non-negative integer");
  }
  const dedupeSeconds = integerOption(argv, "--revalidation-dedupe-seconds", 60, 0);
  const pollingSeconds = integerOption(argv, "--revalidation-polling-seconds", 60, 1, 60);
  const backlogAlert = integerOption(argv, "--alert-queue-backlog", 0, 0);
  const waitUntilMode = option(argv, "--wait-until") ?? "hold";
  if (waitUntilMode !== "hold" && waitUntilMode !== "detach") {
    throw new Error('--wait-until must be "hold" or "detach"');
  }
  if (!rg || !name) {
    throw new Error(
      "usage: opennext-azure deploy -g <rg> -n <name> [-l <location>] [--front-door] [options, see docs/get_started.md]",
    );
  }
  const zip = path.resolve(".open-next-azure", "app.zip");
  if (!fs.existsSync(zip)) throw new Error(`${zip} not found. Run "opennext-azure package" first.`);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const bicep = path.resolve(here, "../../infra/main.bicep");

  if (location) run("az", ["group", "create", "-n", rg, "-l", location, "-o", "none"]);

  // The identity that runs this command uploads static files with its Azure AD login, so it needs
  // a data role. A service principal (CI) cannot be looked up as a "signed-in user": pass its
  // object id with --deployer-principal-id. An empty id simply skips the role assignment.
  const deployerType = option(argv, "--deployer-principal-type") ?? "User";
  if (!["User", "ServicePrincipal", "Group"].includes(deployerType)) {
    throw new Error("--deployer-principal-type must be User, ServicePrincipal or Group");
  }
  let deployerId = option(argv, "--deployer-principal-id") ?? "";
  if (!deployerId) {
    try {
      deployerId = azOut(["ad", "signed-in-user", "show", "--query", "id", "-o", "tsv"]);
    } catch {
      console.warn(
        "Could not read the signed-in user's object id; no Blob data role is assigned, the upload may fail.",
      );
    }
  }

  const outputs = JSON.parse(
    azOut([
      "deployment",
      "group",
      "create",
      "-g",
      rg,
      "-f",
      bicep,
      "-p",
      `name=${name}`,
      `frontDoor=${frontDoor}`,
      `waitUntilMode=${waitUntilMode}`,
      `revalidationDedupeSeconds=${dedupeSeconds}`,
      `revalidationPollingSeconds=${pollingSeconds}`,
      `queueBacklogAlertThreshold=${backlogAlert}`,
      `alwaysReadyInstances=${alwaysReady}`,
      `revalidationAlwaysReady=${revalidationAlwaysReady}`,
      `deployerPrincipalId=${deployerId}`,
      `deployerPrincipalType=${deployerType}`,
      "--query",
      "properties.outputs",
      "-o",
      "json",
    ]),
  );
  const v = (k: string) => outputs[k].value as string;

  // Static assets and the pre-rendered ISR cache. Uses the signed-in user's Azure AD identity
  // (needs Storage Blob Data Contributor on the storage account).
  const upload = (container: string, dir: string) =>
    withRoleRetry(() =>
      runCapturingErrors("az", [
        "storage",
        "blob",
        "upload-batch",
        "--account-name",
        v("storageAccountName"),
        "--auth-mode",
        "login",
        "-d",
        container,
        "-s",
        dir,
        "--overwrite",
      ]),
    );
  upload("assets", path.join(".open-next", "assets"));
  if (fs.existsSync(".open-next/cache")) upload("cache", ".open-next/cache");

  run("az", [
    "functionapp",
    "deployment",
    "source",
    "config-zip",
    "-g",
    rg,
    "-n",
    v("appName"),
    "--src",
    zip,
  ]);
  console.log(`\nDeployed: ${v("url")}`);

  const outputFile = option(argv, "--output-file");
  if (outputFile) {
    fs.writeFileSync(
      outputFile,
      `${JSON.stringify(
        {
          url: v("url"),
          appName: v("appName"),
          storageAccountName: v("storageAccountName"),
          resourceGroup: rg,
        },
        null,
        2,
      )}\n`,
    );
  }
}
