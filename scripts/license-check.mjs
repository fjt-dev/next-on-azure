#!/usr/bin/env node
// Fails when a production dependency of the published package uses a license outside the allow-list.
// Two licenses are accepted as known exceptions (docs/contribute/supply_chain.md): they come from
// the peer dependency `next` (sharp's libvips, caniuse-lite data), which the user installs, not
// from code that this package contains or depends on directly.
import { execFileSync } from "node:child_process";

const allowed = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"]);
// By package name, so a new package with such a license still fails.
const peerExceptions = (name) => name.startsWith("@img/sharp-libvips-") || name === "caniuse-lite";

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
for (const filter of ["opennextjs-azure", undefined]) {
  const label = filter ? "package" : "workspace";
  for (const [license, pkgs] of Object.entries(list(filter))) {
    if (allowed.has(license)) continue;
    const bad = pkgs.map((p) => p.name).filter((name) => !peerExceptions(name));
    if (bad.length > 0) problems.push(`${label}: ${license}: ${bad.join(", ")}`);
  }
}
if (problems.length > 0) {
  console.error(`License check failed:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Licenses are within the allow-list.");
