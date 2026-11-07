import { describe, expect, it } from "vitest";
import { header, request, timestampIn } from "../http.js";

describe("Pages Router", () => {
  it("renders getServerSideProps on every request", async () => {
    const a = await request("/pages-ssr?name=azure");
    expect(a.status).toBe(200);
    // React separates adjacent text with comment markers; compare the text without them.
    expect(a.text.replaceAll("<!-- -->", "")).toContain("Hello azure");
    const stampA = timestampIn(a.text);
    await new Promise((r) => setTimeout(r, 1100));
    const b = await request("/pages-ssr?name=azure");
    expect(timestampIn(b.text)).not.toBe(stampA);
  });

  it("serves a statically generated page with a stable build time", async () => {
    const a = await request("/pages-static");
    const b = await request("/pages-static");
    expect(a.status).toBe(200);
    expect(timestampIn(a.text)).toBeDefined();
    expect(timestampIn(b.text)).toBe(timestampIn(a.text));
  });

  it("serves an API route", async () => {
    const res = await request("/api/hello", { method: "POST" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ method: "POST", hello: "pages-api" });
  });
});

describe("middleware", () => {
  it("redirects", async () => {
    const res = await request("/mw/redirect");
    expect(res.status).toBe(307);
    expect(header(res, "location")).toMatch(/\/pages-static$/);
  });

  it("rewrites to another page and sets a header", async () => {
    const res = await request("/mw/rewrite");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Pages static");
    expect(header(res, "x-example-middleware")).toBe("rewrite");
  });

  it("does not run for paths outside its matcher", async () => {
    const res = await request("/pages-static");
    expect(header(res, "x-example-middleware")).toBeUndefined();
  });
});
