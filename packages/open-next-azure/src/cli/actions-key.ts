import fs from "node:fs";
import path from "node:path";

/**
 * Server Actions encrypt closure variables with a key. By default Next.js makes a new key for each
 * build, so an action can only be invoked against the build that produced it: a page opened before
 * a deployment fails after it, and instances built apart do not agree. Setting
 * `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64, 16, 24 or 32 bytes) at build time keeps one key. The
 * key ends up in `server-reference-manifest.json` of the build output (Next.js docs: data-security
 * and self-hosting guides, read 2026-11-08).
 */

const MANIFEST = "server-reference-manifest.json";

export type ActionsKeyCheck =
  | { status: "no-actions" }
  | { status: "unknown" }
  | { status: "ok" }
  | { status: "unset" }
  | { status: "mismatch" };

/** `server-reference-manifest.json` files below `dir`, without descending into `node_modules`. */
export function findManifests(dir: string, depth = 8): string[] {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findManifests(full, depth - 1));
    else if (entry.name === MANIFEST) found.push(full);
  }
  return found;
}

type Manifest = { node?: object; edge?: object; encryptionKey?: string };

export function checkActionsKey(
  serverDir: string,
  env: NodeJS.ProcessEnv = process.env,
): ActionsKeyCheck {
  const manifests = findManifests(serverDir).flatMap((file) => {
    try {
      return [JSON.parse(fs.readFileSync(file, "utf8")) as Manifest];
    } catch {
      return [];
    }
  });
  if (manifests.length === 0) return { status: "unknown" };
  const withActions = manifests.filter(
    (m) => Object.keys(m.node ?? {}).length + Object.keys(m.edge ?? {}).length > 0,
  );
  if (withActions.length === 0) return { status: "no-actions" };
  const configured = env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY?.trim();
  if (!configured) return { status: "unset" };
  return withActions.every((m) => m.encryptionKey === configured)
    ? { status: "ok" }
    : { status: "mismatch" };
}

export function actionsKeyMessage(check: ActionsKeyCheck): string | undefined {
  if (check.status === "unset") {
    return "This app has Server Actions, but NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is not set in this environment. If it was not set for `open-next build` either, Next.js made a key for this build only: pages opened before the next deployment will fail when they call an action. Set the same key for every build (`openssl rand -base64 32`).";
  }
  if (check.status === "mismatch") {
    return "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY in this environment differs from the key embedded in the build. The build ran without it or with another value. Run `open-next build` again with the key set.";
  }
  return undefined;
}
