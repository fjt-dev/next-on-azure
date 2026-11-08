import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionsKeyMessage,
  checkActionsKey,
  findManifests,
} from "../../../../next-on-azure/src/cli/actions-key.js";

const KEY = Buffer.alloc(32, 7).toString("base64");

function bundle(manifest: object | undefined, nested = "examples/app") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "actions-key-"));
  if (manifest) {
    const server = path.join(dir, nested, ".next", "server");
    fs.mkdirSync(server, { recursive: true });
    fs.writeFileSync(path.join(server, "server-reference-manifest.json"), JSON.stringify(manifest));
  }
  return dir;
}
const withActions = { node: { abc: {} }, edge: {}, encryptionKey: KEY };

describe("checkActionsKey", () => {
  it("is silent when the app has no Server Actions", () => {
    const dir = bundle({ node: {}, edge: {}, encryptionKey: KEY });
    expect(checkActionsKey(dir, {})).toEqual({ status: "no-actions" });
    expect(actionsKeyMessage(checkActionsKey(dir, {}))).toBeUndefined();
  });

  it("warns that the key is per build when actions exist and no key is set here", () => {
    const check = checkActionsKey(bundle(withActions), {});
    expect(check.status).toBe("unset");
    expect(actionsKeyMessage(check)).toMatch(/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY/);
    expect(actionsKeyMessage(check)).toMatch(/openssl rand -base64 32/);
  });

  it("accepts the key that is embedded in the build, and finds it in a monorepo layout", () => {
    const dir = bundle(withActions, "a/b/c");
    expect(checkActionsKey(dir, { NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: KEY })).toEqual({
      status: "ok",
    });
  });

  it("warns when the key set here is not the one in the build", () => {
    const check = checkActionsKey(bundle(withActions), {
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "other",
    });
    expect(check.status).toBe("mismatch");
    expect(actionsKeyMessage(check)).toMatch(/differs/);
  });

  it("says nothing when no manifest can be read", () => {
    expect(checkActionsKey(bundle(undefined), {})).toEqual({ status: "unknown" });
    expect(actionsKeyMessage({ status: "unknown" })).toBeUndefined();
    const broken = bundle(undefined);
    fs.mkdirSync(path.join(broken, ".next", "server"), { recursive: true });
    fs.writeFileSync(path.join(broken, ".next", "server", "server-reference-manifest.json"), "{");
    expect(checkActionsKey(broken, {}).status).toBe("unknown");
  });

  it("does not look inside node_modules", () => {
    const dir = bundle(undefined);
    const inner = path.join(dir, "node_modules", "x");
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, "server-reference-manifest.json"), "{}");
    expect(findManifests(dir)).toEqual([]);
  });
});
