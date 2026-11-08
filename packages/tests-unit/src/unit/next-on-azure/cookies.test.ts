import { describe, expect, it } from "vitest";
import { parseSetCookie, takeCookies } from "../../../../next-on-azure/src/runtime/cookies.js";

describe("parseSetCookie", () => {
  it("reads name, value and every attribute the platform has a field for", () => {
    expect(
      parseSetCookie(
        "sid=abc%3D; Domain=example.com; Path=/app; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Max-Age=60; Secure; HttpOnly; SameSite=Strict",
      ),
    ).toEqual({
      name: "sid",
      value: "abc%3D",
      domain: "example.com",
      path: "/app",
      expires: new Date("2037-10-21T07:28:00Z"),
      maxAge: 60,
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    });
  });

  it("keeps an equals sign inside the value", () => {
    expect(parseSetCookie("t=a=b=c; Path=/")).toMatchObject({ name: "t", value: "a=b=c" });
  });

  it("is case-insensitive for attribute names and SameSite values", () => {
    expect(parseSetCookie("a=1; HTTPONLY; samesite=lax; PATH=/x")).toEqual({
      name: "a",
      value: "1",
      httpOnly: true,
      sameSite: "Lax",
      path: "/x",
    });
    expect(parseSetCookie("a=1; SameSite=NONE")).toMatchObject({ sameSite: "None" });
  });

  it("drops attributes the platform would reject instead of failing the response", () => {
    expect(parseSetCookie("a=1; SameSite=Bogus")).toEqual({ name: "a", value: "1" });
    expect(parseSetCookie("a=1; Expires=not-a-date")).toEqual({ name: "a", value: "1" });
    expect(parseSetCookie("a=1; Max-Age=soon")).toEqual({ name: "a", value: "1" });
    expect(parseSetCookie("a=1; Max-Age=1.5")).toEqual({ name: "a", value: "1" });
  });

  it("allows a negative Max-Age (delete the cookie) and an empty value", () => {
    expect(parseSetCookie("a=; Max-Age=-1")).toEqual({ name: "a", value: "", maxAge: -1 });
  });

  it("ignores attributes without a field (Partitioned, Priority)", () => {
    expect(parseSetCookie("a=1; Partitioned; Priority=High")).toEqual({ name: "a", value: "1" });
  });

  it("returns nothing for a line that is not a cookie", () => {
    expect(parseSetCookie("")).toBeUndefined();
    expect(parseSetCookie("novalue")).toBeUndefined();
    expect(parseSetCookie("=x")).toBeUndefined();
  });
});

describe("takeCookies", () => {
  it("removes set-cookie in any letter case and returns the cookies in order", () => {
    const headers: Record<string, string | string[]> = {
      "content-type": "text/html",
      "Set-Cookie": ["a=1", "b=2"],
      "set-cookie": "c=3",
    };
    expect(takeCookies(headers).map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(headers).toEqual({ "content-type": "text/html" });
  });
});
