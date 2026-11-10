import { describe, expect, it } from "vitest";
import { cacheStatus, header, request } from "../http.js";

describe("pages", () => {
  it("renders a dynamic page on the server", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(header(res, "content-type")).toContain("text/html");
    expect(res.text).toContain("hello azure");
    expect(header(res, "cache-control")).toContain("no-store");
  });

  it("serves a statically generated page from the cache (ISR page, second request is a HIT)", async () => {
    await request("/blog/a");
    const res = await request("/blog/a");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<h1>post (<!-- -->)?a<\/h1>/); // React separates text nodes with comments
    expect(cacheStatus(res)).toBe("HIT");
    expect(header(res, "cache-control")).toContain("s-maxage=60");
  });

  it("returns the 404 page with status 404", async () => {
    const res = await request("/this-page-does-not-exist");
    expect(res.status).toBe(404);
    expect(header(res, "content-type")).toContain("text/html");
  });

  it("generates a page for a dynamic parameter that was not prerendered", async () => {
    const res = await request("/blog/not-prerendered");
    expect([200, 404]).toContain(res.status); // 404 if dynamicParams is disabled; must not be 5xx
  });

  it("answers HEAD without a body", async () => {
    const res = await request("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

describe("responses without a body", () => {
  it("answers HEAD with the headers of the page and no body", async () => {
    const res = await request("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(header(res, "content-type")).toMatch(/text\/html/);
    expect(res.body.length).toBe(0);
  });
});

describe("cookies (B5)", () => {
  it("sends each valid Set-Cookie as its own header", async () => {
    const res = await request("/api/cookies?valid");
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    expect(cookies.map((c) => c.split("=")[0]).sort()).toEqual(["a", "b"]);
    const b = cookies.find((c) => c.startsWith("b=")) ?? "";
    expect(b).toMatch(/^b=2;/);
    expect(b).toMatch(/Secure/i);
    expect(b).toMatch(/Max-Age=60/i);
  });

  it("sends every Set-Cookie as its own header, also when an attribute is invalid", async () => {
    const res = await request("/api/cookies");
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    expect(cookies.map((c) => c.split("=")[0]).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(cookies.find((c) => c.startsWith("a="))).toContain("HttpOnly");
  });
});

// Known gap, App Router only: with `dynamicParams = false` Next.js does not find the prerendered page through
// the cache handler and, with no fallback, does not render it (NoFallbackError), so even the built path answers
// 404. `it.fails` flags the day this is fixed (docs/compatibility.md, "Known gaps"). The Pages Router with
// `fallback: false` works.
describe("routes without a fallback", () => {
  it.fails("serves a path of generateStaticParams when dynamicParams is false (App Router)", async () => {
    const res = await request("/params-closed/a");
    expect(res.status).toBe(200);
    expect(res.text).toContain("closed a");
  });

  it("serves a path of getStaticPaths when fallback is false (Pages Router)", async () => {
    const res = await request("/pages-closed/known");
    expect(res.status).toBe(200);
    expect(res.text.replaceAll("<!-- -->", "")).toContain("Closed known");
    expect((await request("/pages-closed/unknown")).status).toBe(404);
  });
});
