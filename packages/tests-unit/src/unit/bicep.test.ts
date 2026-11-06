import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bicep = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../open-next-azure/infra/main.bicep",
  ),
  "utf8",
);

/**
 * Azure built-in role definition ids, as returned by `az role definition list --name <role>` on a
 * real subscription (2026-11-06). A wrong id passes `az bicep build`, `az deployment group
 * validate` and `what-if`, and only fails during the real deployment (RoleDefinitionDoesNotExist),
 * which is how the Table Data Contributor id typo was found.
 */
const BUILT_IN_ROLES: Record<string, string> = {
  blobOwner: "b7e6dc6d-f1e8-4753-8033-0f276bb0955b", // Storage Blob Data Owner
  blobContributor: "ba92f5b4-2d11-453d-a403-e96b0029c9fe", // Storage Blob Data Contributor
  queueContributor: "974c5e8b-45b9-4653-ba55-5f855dd0fb88", // Storage Queue Data Contributor
  tableContributor: "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3", // Storage Table Data Contributor
};

describe("main.bicep role definition ids", () => {
  it.each(Object.entries(BUILT_IN_ROLES))("%s uses the real built-in id", (name, id) => {
    const match = new RegExp(`${name}:\\s*'([^']+)'`).exec(bicep);
    expect(match?.[1], `${name} not found in main.bicep`).toBe(id);
  });

  it("only references roles that this test knows about", () => {
    const used = [...bicep.matchAll(/roles\.(\w+)/g)].map((m) => m[1] as string);
    for (const role of new Set(used)) expect(Object.keys(BUILT_IN_ROLES)).toContain(role);
  });
});

describe("main.bicep metric alert", () => {
  // Azure Monitor accepts only these windows for QueueMessageCount (an hourly metric). A shorter one
  // passes `az deployment group validate` and `what-if` and fails the real deployment with
  // "Evaluation window size must be one of [PT1H, PT6H, PT12H, P1D]".
  const allowed = ["PT1H", "PT6H", "PT12H", "P1D"];

  it("uses a window the QueueMessageCount metric accepts", () => {
    const window = /windowSize:\s*'([^']+)'/.exec(bicep)?.[1];
    expect(allowed).toContain(window);
  });

  it("evaluates at least as often as its window is long", () => {
    const minutes = (iso: string) =>
      iso.startsWith("P1D")
        ? 1440
        : Number(/PT(\d+)([HM])/.exec(iso)?.[1]) * (iso.endsWith("H") ? 60 : 1);
    const frequency = /evaluationFrequency:\s*'([^']+)'/.exec(bicep)?.[1] ?? "";
    const window = /windowSize:\s*'([^']+)'/.exec(bicep)?.[1] ?? "";
    expect(minutes(frequency)).toBeLessThanOrEqual(minutes(window));
  });
});
