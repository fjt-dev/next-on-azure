#!/usr/bin/env node
// Looks for credentials in the repository. No third-party binary: patterns are listed here.
//   node scripts/secret-scan.mjs            tracked files
//   node scripts/secret-scan.mjs --history  every line ever added on any branch (needs full clone)
// Prints file:line and the rule, never the matched value. Exit code 1 when something is found.
import { execFileSync, spawn } from "node:child_process";
import readline from "node:readline";

import { scanLine } from "./secret-rules.mjs";

const skip = /(?:^|\/)(?:pnpm-lock\.yaml|.*\.(?:png|jpg|ico|zip|woff2?))$/;
const findings = [];

if (process.argv.includes("--history")) {
  const git = spawn("git", ["log", "--all", "-p", "--no-color", "--format=commit %H", "-U0"]);
  let commit = "";
  let file = "";
  const rl = readline.createInterface({ input: git.stdout });
  for await (const line of rl) {
    if (line.startsWith("commit ")) commit = line.slice(7, 19);
    else if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !skip.test(file)) {
      for (const rule of scanLine(line)) findings.push(`${commit} ${file}: ${rule}`);
    }
  }
} else {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f && !skip.test(f));
  const { readFileSync } = await import("node:fs");
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    text.split("\n").forEach((line, i) => {
      for (const rule of scanLine(line)) findings.push(`${file}:${i + 1}: ${rule}`);
    });
  }
}

if (findings.length > 0) {
  console.error(`Possible secrets found (${findings.length}):\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("No secrets found.");
