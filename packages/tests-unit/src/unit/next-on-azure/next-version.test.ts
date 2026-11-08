import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertSupportedNext,
  checkNextVersion,
  parseVersion,
  satisfies,
  supportedNextRange,
} from "../../../../next-on-azure/src/cli/next-version.js";

const RANGE = ">=15.5.29 <16 || >=16.4.5";

describe("parseVersion", () => {
  it("reads releases and prereleases, and nothing else", () => {
    expect(parseVersion("15.5.29")).toEqual([15, 5, 29]);
    expect(parseVersion("v16.4.5-canary.3")).toEqual([16, 4, 5]);
    expect(parseVersion("16.4")).toBeUndefined();
    expect(parseVersion("latest")).toBeUndefined();
  });
});

describe("satisfies (the next peer range)", () => {
  it.each([
    ["15.5.29", true],
    ["15.5.30", true],
    ["15.9.0", true],
    ["15.5.28", false],
    ["15.0.0", false],
    ["14.2.0", false],
    ["16.0.0", false],
    ["16.4.4", false],
    ["16.4.5", true],
    ["16.5.0", true],
    ["17.0.0", true], // the range has no upper bound; OpenNext decides when it ends
    ["16.4.5-canary.1", true],
    ["nonsense", false],
  ])("%s -> %s", (version, expected) => {
    expect(satisfies(version, RANGE)).toBe(expected);
  });

  it("supports the comparators >, <=, = and exact versions", () => {
    expect(satisfies("1.2.4", ">1.2.3")).toBe(true);
    expect(satisfies("1.2.3", ">1.2.3")).toBe(false);
    expect(satisfies("1.2.3", "<=1.2.3")).toBe(true);
    expect(satisfies("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
  });

  it("fails loudly on a range it does not understand", () => {
    expect(() => satisfies("1.2.3", "^1.2.0")).toThrow(/Unsupported version range/);
  });
});

describe("the package's own range", () => {
  it("is the next peer range of package.json", () => {
    expect(supportedNextRange()).toBe(RANGE);
  });
});

function app(version: string | undefined) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-check-"));
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  if (version) {
    const next = path.join(dir, "node_modules", "next");
    fs.mkdirSync(next, { recursive: true });
    fs.writeFileSync(path.join(next, "package.json"), JSON.stringify({ name: "next", version }));
  }
  return dir;
}

describe("assertSupportedNext", () => {
  it("accepts a supported version silently", () => {
    const warn = vi.fn();
    expect(assertSupportedNext(app("15.5.29"), { warn }).status).toBe("ok");
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses an unsupported version and names the version, the range and the escape hatch", () => {
    expect(() => assertSupportedNext(app("14.2.5"))).toThrow(
      /Next\.js 14\.2\.5 is not supported \(supported: .*--allow-unsupported-next/,
    );
    expect(() => assertSupportedNext(app("16.4.4"))).toThrow(/16\.4\.4/);
  });

  it("only warns with allowUnsupported", () => {
    const warn = vi.fn();
    expect(assertSupportedNext(app("14.2.5"), { allowUnsupported: true, warn }).status).toBe(
      "unsupported",
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("14.2.5"));
  });

  it("does not block when next cannot be found", () => {
    const warn = vi.fn();
    // A package manager may put another `next` on NODE_PATH, so the lookup is replaced here.
    expect(assertSupportedNext(app(undefined), { warn, read: () => undefined }).status).toBe(
      "unknown",
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipping the version check"));
  });

  it("reads the next the app resolves", () => {
    expect(checkNextVersion(app("16.4.5"))).toMatchObject({ status: "ok", version: "16.4.5" });
  });
});
