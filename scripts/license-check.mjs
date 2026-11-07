#!/usr/bin/env node
// Fails when a production dependency of the published package uses a license outside the allow-list.
// The example app is checked against a second, documented list of known exceptions (see
// docs/contribute/supply_chain.md): they end up in the app zip of a user, not in our package.
import { execFileSync } from "node:child_process";

const allowed = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"]);
const exampleExceptions = new Set(["LGPL-3.0-or-later", "CC-BY-4.0"]);

const list = (filter) =>
  JSON.parse(
    execFileSync(
      "pnpm",
      ["licenses", "list", "--prod", "--json", ...(filter ? ["--filter", filter] : [])],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  );

const problems = [];
for (const [license, pkgs] of Object.entries(list("opennextjs-azure"))) {
  if (!allowed.has(license))
    problems.push(`package: ${license}: ${pkgs.map((p) => p.name).join(", ")}`);
}
for (const [license, pkgs] of Object.entries(list())) {
  if (!allowed.has(license) && !exampleExceptions.has(license)) {
    problems.push(`workspace: ${license}: ${pkgs.map((p) => p.name).join(", ")}`);
  }
}
if (problems.length > 0) {
  console.error(`License check failed:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Licenses are within the allow-list.");
