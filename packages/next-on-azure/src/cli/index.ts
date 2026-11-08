#!/usr/bin/env node
import { deploy } from "./deploy.js";
import { packageApp } from "./package-app.js";
import { prime } from "./prime.js";

/**
 * next-on-azure package [--target azure|local] [--allow-unsupported-next]
 *     Turns the standalone build (.next/standalone) into one deployable Function app (.next-azure/app.zip).
 * next-on-azure deploy -g <rg> -n <name> [-l <location>] [--front-door] [--always-ready <n>] ...
 *     Provisions the resources (Bicep), deploys the zip, waits for the app and primes the cache. Costs money.
 * next-on-azure prime <url>
 *     Requests every prerendered route once, so that the pages are in the cache before visitors come.
 *
 * Run `next build` first, with withAzure() from next-on-azure/config in next.config.
 */
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "package") {
    const target = rest.includes("--target") ? rest[rest.indexOf("--target") + 1] : "azure";
    if (target !== "azure" && target !== "local")
      throw new Error('--target must be "azure" or "local"');
    packageApp({ target, allowUnsupportedNext: rest.includes("--allow-unsupported-next") });
  } else if (cmd === "deploy") {
    await deploy(rest);
  } else if (cmd === "prime") {
    if (!rest[0]) throw new Error("usage: next-on-azure prime <url>");
    const result = await prime(rest[0]);
    console.log(
      `primed ${result.routes} routes in ${(result.ms / 1000).toFixed(1)} s, ${result.failed} failed`,
    );
    process.exitCode = result.failed > 0 ? 1 : 0;
  } else {
    console.log("usage: next-on-azure <package|deploy|prime>");
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
