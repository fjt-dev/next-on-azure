import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.github/workflows",
);
// Comments are dropped: they are allowed to name what is forbidden.
const read = (name: string) =>
  fs
    .readFileSync(path.join(dir, name), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml"));

// Rules from docs/contribute/ci.md. Textual checks: a workflow that breaks one of them hands cloud
// credentials, or a write token, to code that should not have them.
describe("GitHub workflows", () => {
  it("pin every action to a full commit SHA", () => {
    for (const file of files) {
      for (const [, ref] of read(file).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        expect(ref, `${file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("never use pull_request_target or workflow_run", () => {
    for (const file of files)
      expect(read(file), file).not.toMatch(/pull_request_target|workflow_run/);
  });

  it("grant id-token: write only to the Azure E2E workflow", () => {
    for (const file of files.filter((f) => f !== "azure-e2e.yml")) {
      expect(read(file), file).not.toMatch(/id-token/);
    }
    expect(read("azure-e2e.yml")).toMatch(/id-token: write/);
  });

  it("run the Azure E2E workflow only on demand or on a schedule, never for pull requests", () => {
    const text = read("azure-e2e.yml");
    expect(text).toMatch(/workflow_dispatch:/);
    expect(text).not.toMatch(/^\s*pull_request:/m);
    expect(text).not.toMatch(/^\s*push:/m);
  });

  it("delete the Azure resources even when the run fails, and keep no secret", () => {
    const text = read("azure-e2e.yml");
    expect(text).toMatch(/if: always\(\)\n\s+run: az group delete/);
    expect(text).toMatch(/cleanup:/);
    expect(text).not.toMatch(/secrets\./);
  });
});
