import { describe, expect, it } from "vitest";
import { isFrontDoorRequestAllowed } from "../../../../next-on-azure/src/runtime/front-door.mjs";

describe("isFrontDoorRequestAllowed", () => {
  it("allows everything when no Front Door id is configured", () => {
    expect(isFrontDoorRequestAllowed(undefined, undefined)).toBe(true);
    expect(isFrontDoorRequestAllowed("", "anything")).toBe(true);
  });
  it.each([
    ["abc", "abc", true],
    ["abc", "ABC", true],
    ["abc", " abc ", true],
    ["abc", "abd", false],
    ["abc", "abcd", false],
    ["abc", "", false],
    ["abc", undefined, false],
    ["abc", null, false],
  ])("expected %j, received %j -> %s", (expected, received, ok) => {
    expect(isFrontDoorRequestAllowed(expected, received as never)).toBe(ok);
  });
});
