import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./package-app.js";
import { prime } from "./prime.js";
import { warmUp } from "./warm-up.js";

function azOut(args: string[]): string {
  const r = spawnSync("az", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

export function option(argv: string[], flag: string, short?: string): string | undefined {
  const i = argv.findIndex((a) => a === flag || (short !== undefined && a === short));
  return i >= 0 ? argv[i + 1] : undefined;
}

export function integerOption(
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

/** The parameters of main.bicep that the command line sets, in `name=value` form. */
export function bicepParameters(argv: string[]): string[] {
  const name = option(argv, "--name", "-n");
  if (!name) throw new Error("--name is required");
  const waitUntilMode = option(argv, "--wait-until") ?? "hold";
  if (waitUntilMode !== "hold" && waitUntilMode !== "detach") {
    throw new Error('--wait-until must be "hold" or "detach"');
  }
  const parameters = [
    `name=${name}`,
    `frontDoor=${argv.includes("--front-door")}`,
    `waitUntilMode=${waitUntilMode}`,
    `alwaysReadyInstances=${integerOption(argv, "--always-ready", 0, 0)}`,
    `fullTelemetry=${argv.includes("--full-telemetry")}`,
  ];
  // Cost settings are passed only when given: main.bicep holds the defaults.
  const memory = option(argv, "--memory");
  if (memory !== undefined) {
    if (!["512", "2048", "4096"].includes(memory)) {
      throw new Error("--memory must be 512, 2048 or 4096 (MB)");
    }
    parameters.push(`instanceMemoryMB=${memory}`);
  }
  if (option(argv, "--max-instances") !== undefined) {
    parameters.push(`maximumInstanceCount=${integerOption(argv, "--max-instances", 20, 1, 1000)}`);
  }
  if (option(argv, "--cache-retention-days") !== undefined) {
    parameters.push(
      `cacheRetentionDays=${integerOption(argv, "--cache-retention-days", 30, 0, 36500)}`,
    );
  }
  return parameters;
}

/**
 * next-on-azure deploy -g <rg> -n <name> [-l <location>] [--front-door] [--wait-until hold|detach]
 *   [--always-ready <n>] [--memory 512|2048|4096] [--max-instances <n>] [--cache-retention-days <n>]
 *   [--full-telemetry] [--no-warm-up] [--no-prime] [--output-file <path>]
 *
 * Creates the infrastructure with Bicep, deploys `.next-azure/app.zip`, waits for the first answer
 * and requests every prerendered route once. Creates billable resources; see
 * docs/contribute/azure_runs.md.
 */
export async function deploy(argv: string[]) {
  const rg = option(argv, "--resource-group", "-g");
  const location = option(argv, "--location", "-l");
  if (!rg) {
    throw new Error(
      "usage: next-on-azure deploy -g <rg> -n <name> [-l <location>] [--front-door] [options]",
    );
  }
  const parameters = bicepParameters(argv);
  const zip = path.resolve(".next-azure", "app.zip");
  if (!fs.existsSync(zip)) throw new Error(`${zip} not found. Run "next-on-azure package" first.`);
  const bicep = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../infra/main.bicep",
  );

  if (location) run("az", ["group", "create", "-n", rg, "-l", location, "-o", "none"]);
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
      ...parameters,
      "--query",
      "properties.outputs",
      "-o",
      "json",
    ]),
  );
  const v = (k: string) => outputs[k].value as string;

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

  if (!argv.includes("--no-warm-up")) {
    console.log("Waiting for the first response (the slowest request after a deployment)...");
    const warm = await warmUp(`${v("url")}/`);
    if (warm.ok) {
      console.log(
        `The app answered with HTTP ${warm.status} after ${(warm.ms / 1000).toFixed(1)} s (${warm.attempts} attempt${warm.attempts === 1 ? "" : "s"}).`,
      );
      if (!argv.includes("--no-prime")) {
        const result = await prime(v("url"));
        console.log(
          `Primed ${result.routes} prerendered routes in ${(result.ms / 1000).toFixed(1)} s, ${result.failed} failed.`,
        );
      }
    } else {
      console.warn(
        `The app did not answer within ${(warm.ms / 1000).toFixed(0)} s (last: ${warm.lastError}). The deployment itself succeeded; check the app in the portal.`,
      );
    }
  }

  const outputFile = option(argv, "--output-file");
  if (outputFile) {
    fs.writeFileSync(
      outputFile,
      `${JSON.stringify({ url: v("url"), appName: v("appName"), storageAccountName: v("storageAccountName"), resourceGroup: rg }, null, 2)}\n`,
    );
  }
}
