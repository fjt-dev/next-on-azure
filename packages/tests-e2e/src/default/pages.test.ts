import { describe, expect, it } from "vitest";
import { header, request } from "../http.js";

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
    expect(header(res, "x-nextjs-cache")).toBe("HIT");
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
