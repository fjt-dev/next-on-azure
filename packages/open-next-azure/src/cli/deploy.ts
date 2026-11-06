import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./package-app.js";

function azOut(args: string[]): string {
  const r = spawnSync("az", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function option(argv: string[], flag: string, short?: string): string | undefined {
  const i = argv.findIndex((a) => a === flag || (short !== undefined && a === short));
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * opennext-azure deploy -g <rg> -n <name> [-l <location>] [--front-door] [--wait-until hold|detach] [--revalidation-always-ready <n>]
 *
 * Creates the infrastructure with Bicep, uploads static assets and the prerender cache, and
 * deploys `.open-next-azure/app.zip`. Creates billable resources; see docs/contribute/azure_runs.md.
 */
export function deploy(argv: string[]) {
  const rg = option(argv, "--resource-group", "-g");
  const name = option(argv, "--name", "-n");
  const location = option(argv, "--location", "-l");
  const frontDoor = argv.includes("--front-door");
  const revalidationAlwaysReady = Number(option(argv, "--revalidation-always-ready") ?? "0");
  if (!Number.isInteger(revalidationAlwaysReady) || revalidationAlwaysReady < 0) {
    throw new Error("--revalidation-always-ready must be a non-negative integer");
  }
  const waitUntilMode = option(argv, "--wait-until") ?? "hold";
  if (waitUntilMode !== "hold" && waitUntilMode !== "detach") {
    throw new Error('--wait-until must be "hold" or "detach"');
  }
  if (!rg || !name) {
    throw new Error(
      "usage: opennext-azure deploy -g <rg> -n <name> [-l <location>] [--front-door] [--wait-until hold|detach] [--revalidation-always-ready <n>]",
    );
  }
  const zip = path.resolve(".open-next-azure", "app.zip");
  if (!fs.existsSync(zip)) throw new Error(`${zip} not found. Run "opennext-azure package" first.`);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const bicep = path.resolve(here, "../../infra/main.bicep");

  if (location) run("az", ["group", "create", "-n", rg, "-l", location, "-o", "none"]);

  // The signed-in identity uploads static files with its Azure AD login, so it needs a data role.
  // An empty id simply skips the role assignment.
  let deployerId = "";
  try {
    deployerId = azOut(["ad", "signed-in-user", "show", "--query", "id", "-o", "tsv"]);
  } catch {
    console.warn(
      "Could not read the signed-in user's object id; no Blob data role is assigned, the upload may fail.",
    );
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
      `revalidationAlwaysReady=${revalidationAlwaysReady}`,
      `deployerPrincipalId=${deployerId}`,
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
    run("az", [
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
    ]);
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
}
