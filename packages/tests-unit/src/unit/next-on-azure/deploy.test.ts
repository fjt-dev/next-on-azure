import { describe, expect, it } from "vitest";
import {
  bicepParameters,
  integerOption,
  option,
} from "../../../../next-on-azure/src/cli/deploy.js";

describe("deploy options", () => {
  it("reads a flag and its short form", () => {
    expect(option(["-g", "rg"], "--resource-group", "-g")).toBe("rg");
    expect(option(["--resource-group", "x"], "--resource-group", "-g")).toBe("x");
    expect(option([], "--resource-group", "-g")).toBeUndefined();
  });

  it("checks integer options against their range", () => {
    expect(integerOption([], "--always-ready", 0, 0)).toBe(0);
    expect(integerOption(["--always-ready", "2"], "--always-ready", 0, 0)).toBe(2);
    expect(() => integerOption(["--always-ready", "-1"], "--always-ready", 0, 0)).toThrow(
      /integer/,
    );
    expect(() => integerOption(["--always-ready", "x"], "--always-ready", 0, 0)).toThrow(/integer/);
    expect(() => integerOption(["--n", "70"], "--n", 1, 1, 60)).toThrow(/from 1 to 60/);
  });
});

describe("bicepParameters", () => {
  it("defaults to no Front Door, hold, no always-ready and sampled telemetry", () => {
    expect(bicepParameters(["-n", "app1"])).toEqual([
      "name=app1",
      "frontDoor=false",
      "waitUntilMode=hold",
      "alwaysReadyInstances=0",
      "fullTelemetry=false",
    ]);
  });

  it("passes the flags on", () => {
    expect(
      bicepParameters([
        "-n",
        "app1",
        "--front-door",
        "--wait-until",
        "detach",
        "--always-ready",
        "1",
        "--full-telemetry",
      ]),
    ).toEqual([
      "name=app1",
      "frontDoor=true",
      "waitUntilMode=detach",
      "alwaysReadyInstances=1",
      "fullTelemetry=true",
    ]);
  });

  it("passes the cost settings only when they are given, and checks them", () => {
    expect(
      bicepParameters([
        "-n",
        "a",
        "--memory",
        "512",
        "--max-instances",
        "5",
        "--cache-retention-days",
        "7",
      ]),
    ).toEqual([
      "name=a",
      "frontDoor=false",
      "waitUntilMode=hold",
      "alwaysReadyInstances=0",
      "fullTelemetry=false",
      "instanceMemoryMB=512",
      "maximumInstanceCount=5",
      "cacheRetentionDays=7",
    ]);
    expect(bicepParameters(["-n", "a", "--cache-retention-days", "0"])).toContain(
      "cacheRetentionDays=0",
    );
    expect(bicepParameters(["-n", "a", "--request-telemetry", "errors"])).toContain(
      "requestTelemetry=errors",
    );
    expect(() => bicepParameters(["-n", "a", "--request-telemetry", "none"])).toThrow(
      /"all" or "errors"/,
    );
    expect(() => bicepParameters(["-n", "a", "--memory", "1024"])).toThrow(/512, 2048 or 4096/);
    expect(() => bicepParameters(["-n", "a", "--max-instances", "0"])).toThrow(/integer/);
    expect(() => bicepParameters(["-n", "a", "--cache-retention-days", "-1"])).toThrow(/integer/);
  });

  it("needs a name and a valid wait-until mode", () => {
    expect(() => bicepParameters([])).toThrow(/--name/);
    expect(() => bicepParameters(["-n", "a", "--wait-until", "later"])).toThrow(/hold.*detach/);
  });

  it("only passes parameters that main.bicep declares", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const bicep = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../../next-on-azure/infra/main.bicep"),
      "utf8",
    );
    const all = bicepParameters([
      "-n",
      "a",
      "--memory",
      "512",
      "--max-instances",
      "5",
      "--cache-retention-days",
      "7",
      "--request-telemetry",
      "errors",
    ]);
    for (const p of all) {
      expect(bicep).toMatch(new RegExp(`^param ${p.split("=")[0]} `, "m"));
    }
  });
});
