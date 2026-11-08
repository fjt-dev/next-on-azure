import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Next.js versions this package supports are the `next` peer range of its own package.json
 * (inherited from the first, OpenNext-based design, ADR-0011). `package` refuses an app outside that range, because a
 * build that was never tested would fail late or in odd ways on Azure.
 */

type Version = [number, number, number];

/** `15.5.29` or `16.4.5-canary.3` -> `[15, 5, 29]`; undefined if it is not a version. */
export function parseVersion(text: string): Version | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** A range bound may be partial (`<16` means `<16.0.0`). */
function parseBound(text: string): Version | undefined {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : undefined;
}

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Evaluates the small range grammar used here: alternatives separated by `||`, each a list of
 * comparators (`>=`, `>`, `<=`, `<`, `=` or none) separated by spaces. A prerelease counts as its
 * release (`16.4.5-canary.1` is `16.4.5`).
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split("||").some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => {
        const m = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator);
        const bound = m?.[2] ? parseBound(m[2]) : undefined;
        if (!m || !bound) throw new Error(`Unsupported version range: "${range}"`);
        const c = compare(v, bound);
        switch (m[1]) {
          case ">=":
            return c >= 0;
          case ">":
            return c > 0;
          case "<=":
            return c <= 0;
          case "<":
            return c < 0;
          default:
            return c === 0;
        }
      }),
  );
}

/** The version of `next` that the app in `cwd` resolves, or undefined if it cannot be found. */
export function readNextVersion(cwd: string): string | undefined {
  try {
    const resolved = createRequire(path.join(cwd, "package.json")).resolve("next/package.json");
    return (JSON.parse(fs.readFileSync(resolved, "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** The `next` peer range of this package. */
export function supportedNextRange(): string {
  const manifest = fileURLToPath(new URL("../../package.json", import.meta.url));
  const range = (
    JSON.parse(fs.readFileSync(manifest, "utf8")) as { peerDependencies?: Record<string, string> }
  ).peerDependencies?.next;
  if (!range) throw new Error("The package declares no peer range for next.");
  return range;
}

export type NextCheck = {
  status: "ok" | "unsupported" | "unknown";
  version?: string;
  range: string;
};

export function checkNextVersion(
  cwd: string,
  range = supportedNextRange(),
  read: (cwd: string) => string | undefined = readNextVersion,
): NextCheck {
  const version = read(cwd);
  if (!version) return { status: "unknown", range };
  return { status: satisfies(version, range) ? "ok" : "unsupported", version, range };
}

/**
 * Throws for an unsupported Next.js version unless `allowUnsupported` is set. A version that cannot
 * be read only warns: the check must never block a layout it does not understand.
 */
export function assertSupportedNext(
  cwd: string,
  options: {
    allowUnsupported?: boolean;
    range?: string;
    warn?: (message: string) => void;
    /** Replaces the lookup of the app's `next` (tests). */
    read?: (cwd: string) => string | undefined;
  } = {},
): NextCheck {
  const warn = options.warn ?? console.warn;
  const check = checkNextVersion(cwd, options.range, options.read);
  if (check.status === "unknown") {
    warn(`Could not read the version of next from ${cwd}; skipping the version check.`);
  } else if (check.status === "unsupported") {
    const message = `Next.js ${check.version} is not supported (supported: ${check.range}). Use a supported version, or pass --allow-unsupported-next to package it anyway.`;
    if (!options.allowUnsupported) throw new Error(message);
    warn(`Warning: ${message}`);
  }
  return check;
}
