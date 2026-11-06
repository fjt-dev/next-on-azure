import { HttpRequest } from "@azure/functions";
import { describe, expect, it } from "vitest";
import converter from "../../../open-next-azure/src/overrides/converter.js";

function req(init: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}) {
  return new HttpRequest({
    method: init.method ?? "GET",
    url: init.url ?? "https://func.azurewebsites.net/hello",
    headers: init.headers ?? {},
    query: {},
    params: {},
    ...(init.body !== undefined ? { body: { string: init.body } } : {}),
  });
}

describe("convertFrom", () => {
  it("lower-cases header names and keeps values", async () => {
    const e = await converter.convertFrom(
      req({ headers: { "X-Custom": "A", Accept: "text/html" } }),
    );
    expect(e.headers["x-custom"]).toBe("A");
    expect(e.headers.accept).toBe("text/html");
  });

  it("rebuilds the public URL from Front Door's forwarded host and proto", async () => {
    const e = await converter.convertFrom(
      req({
        url: "https://func.azurewebsites.net/blog/a?x=1",
        headers: { "x-forwarded-host": "www.example.com", "x-forwarded-proto": "https" },
      }),
    );
    expect(e.url).toBe("https://www.example.com/blog/a?x=1");
    expect(e.rawPath).toBe("/blog/a");
  });

  it("falls back to the Host header, then https", async () => {
    const e = await converter.convertFrom(req({ headers: { host: "app.example.net" } }));
    expect(e.url).toBe("https://app.example.net/hello");
  });

  it("collects repeated query parameters into arrays", async () => {
    const e = await converter.convertFrom(req({ url: "https://h.net/p?a=1&b=2&b=3&empty=" }));
    expect(e.query).toEqual({ a: "1", b: ["2", "3"], empty: "" });
  });

  it("keeps the path percent-encoded as received (no double decoding)", async () => {
    const e = await converter.convertFrom(req({ url: "https://h.net/a%2Fb/c%20d" }));
    expect(e.rawPath).toBe("/a%2Fb/c%20d");
  });

  it("does not turn + in a path into a space (B13)", async () => {
    const e = await converter.convertFrom(req({ url: "https://h.net/tag/c++" }));
    expect(e.rawPath).toBe("/tag/c++");
  });

  it("parses cookies, keeping '=' inside values", async () => {
    const e = await converter.convertFrom(req({ headers: { cookie: "a=1; token=abc==; empty=" } }));
    expect(e.cookies).toEqual({ a: "1", token: "abc==", empty: "" });
  });

  it("has no cookies when the header is absent", async () => {
    expect((await converter.convertFrom(req({}))).cookies).toEqual({});
  });

  it("reads the body of non-GET requests and gives GET/HEAD an empty body", async () => {
    const post = await converter.convertFrom(req({ method: "POST", body: "a=1&b=2" }));
    expect(post.body?.toString()).toBe("a=1&b=2");
    for (const method of ["GET", "HEAD"]) {
      const e = await converter.convertFrom(req({ method }));
      expect(e.body?.length).toBe(0);
    }
  });

  it("prefers x-azure-clientip, then the first x-forwarded-for, then ::1", async () => {
    expect(
      (
        await converter.convertFrom(
          req({ headers: { "x-azure-clientip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" } }),
        )
      ).remoteAddress,
    ).toBe("1.1.1.1");
    expect(
      (await converter.convertFrom(req({ headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" } })))
        .remoteAddress,
    ).toBe("2.2.2.2");
    expect((await converter.convertFrom(req({}))).remoteAddress).toBe("::1");
  });

  it("produces a core event with the request method", async () => {
    const e = await converter.convertFrom(req({ method: "PUT", body: "x" }));
    expect(e.type).toBe("core");
    expect(e.method).toBe("PUT");
  });
});
