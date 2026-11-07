import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const NAME = "opennext-adapter-azure";
// The name of another author's package; it must not be used as ours (ADR-0015).
const OLD = "opennextjs-azure";

describe("package name (ADR-0015)", () => {
  it("is the chosen name", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "packages/open-next-azure/package.json"), "utf8"),
    ) as { name: string };
    expect(manifest.name).toBe(NAME);
  });

  it("does not leave the old name in the package, the example or the user docs", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      .filter(
        (f) =>
          f.startsWith("packages/open-next-azure/") ||
          f.startsWith("examples/") ||
          f === "docs/get_started.md" ||
          f.startsWith("docs/config/"),
      );
    const hits = tracked.filter(
      (f) =>
        fs.existsSync(path.join(root, f)) &&
        fs.readFileSync(path.join(root, f), "utf8").includes(OLD),
    );
    expect(hits).toEqual([]);
  });
});
