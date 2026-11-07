import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
// @ts-expect-error plain ES module without types
const { scanLine } = (await import(path.join(root, "scripts/secret-rules.mjs"))) as {
  scanLine: (line: string) => string[];
};

// Samples are assembled from pieces so this file does not trip the scanner itself.
const sample = (...parts: string[]) => parts.join("");

describe("secret rules", () => {
  it.each([
    ["private key", sample("-----BEGIN ", "RSA PRIVATE KEY-----")],
    ["Azure storage account key", sample("AccountKey=", "A".repeat(86), "==")],
    ["GitHub token", sample("gh", "p_", "a".repeat(36))],
    ["AWS access key id", sample("AKIA", "ABCDEFGHIJKLMNOP")],
    [
      "JSON web token",
      sample("ey", "J", "a".repeat(12), ".ey", "J", "b".repeat(12), ".", "c".repeat(12)),
    ],
    ["password assignment", sample('password = "', "x".repeat(16), '"')],
  ])("flags a %s", (_name, line) => {
    expect(scanLine(line).length).toBeGreaterThan(0);
  });

  it("does not flag ordinary text, ids or placeholders", () => {
    for (const line of [
      "AZURE_CLIENT_ID: c90787be-986b-40e0-9692-d1b0ea1df22a",
      "const password = process.env.PASSWORD;",
      'password: "${{ secrets.X }}"',
      "Use AccountKey=<key> in the connection string",
    ]) {
      expect(scanLine(line), line).toEqual([]);
    }
  });

  it("finds nothing in the files tracked by git", () => {
    const out = execFileSync("node", ["scripts/secret-scan.mjs"], { cwd: root, encoding: "utf8" });
    expect(out).toContain("No secrets found");
  });
});
