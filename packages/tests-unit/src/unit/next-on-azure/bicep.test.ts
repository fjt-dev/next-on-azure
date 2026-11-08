import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bicep = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../next-on-azure/infra/main.bicep",
  ),
  "utf8",
);

// Built-in role definition ids as returned by `az role definition list` (see bicep.test.ts of the
// previous package): a wrong id only fails during a real deployment.
const BUILT_IN_ROLES: Record<string, string> = {
  blobOwner: "b7e6dc6d-f1e8-4753-8033-0f276bb0955b",
  queueContributor: "974c5e8b-45b9-4653-ba55-5f855dd0fb88",
  tableContributor: "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3",
};

describe("next-on-azure main.bicep", () => {
  it.each(Object.entries(BUILT_IN_ROLES))("role %s uses the real built-in id", (name, id) => {
    expect(new RegExp(`${name}:\\s*'([^']+)'`).exec(bicep)?.[1]).toBe(id);
  });

  it("only references roles this test knows about", () => {
    for (const role of new Set([...bicep.matchAll(/roles\.(\w+)/g)].map((m) => m[1] as string))) {
      expect(Object.keys(BUILT_IN_ROLES)).toContain(role);
    }
  });

  it("has nothing of the first design left: no assets container, queue, revalidation settings", () => {
    expect(bicep).not.toMatch(/queueServices|REVALIDATION|ASSETS_|OPENNEXT_|revalidation/i);
  });

  it("gives the cache handlers the settings they read", () => {
    for (const setting of [
      "AZURE_STORAGE_ACCOUNT_NAME",
      "CACHE_CONTAINER_NAME",
      "CACHE_TABLE_NAME",
      "WAIT_UNTIL_MODE",
    ]) {
      expect(bicep).toContain(`'${setting}'`);
    }
  });

  it("keeps shared-key access off and sets FRONT_DOOR_ID only with Front Door", () => {
    expect(bicep).toMatch(/allowSharedKeyAccess:\s*false/);
    expect(bicep).toMatch(/frontDoor \? \[\s*\/\/[^\n]*\n\s*\{ name: 'FRONT_DOOR_ID'/);
  });

  it("names the containers and the table the handlers default to", () => {
    expect(bicep).toMatch(/name: 'cache'/);
    expect(bicep).toMatch(/var tableName = 'tagcache'/);
  });
});
