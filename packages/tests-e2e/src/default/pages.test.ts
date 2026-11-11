import { describe, expect, it } from "vitest";
import {
  cacheStatus,
  eventually,
  freshPage,
  header,
  request,
  sleep,
  timestampIn,
} from "../http.js";

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

// Routes without a fallback: Next.js does not render a page that is not in the cache for them, so the page
// of `next build` has to be found through the cache handler (it reads the build output when Blob has no entry).
describe("routes without a fallback", () => {
  it("serves a path of generateStaticParams when dynamicParams is false (App Router), then regenerates it", async () => {
    // The built page is older than its revalidate time by now: wait for a page that is not stale.
    const first = await freshPage("/params-closed/a");
    expect(first.status).toBe(200);
    expect(first.text.replaceAll("<!-- -->", "")).toContain("closed a");
    const builtAt = timestampIn(first.text);
    expect(builtAt).toBeDefined();
    expect((await request("/params-closed/unknown")).status).toBe(404);

    await sleep(6500); // revalidate = 5
    const stale = await request("/params-closed/a");
    expect(stale.status).toBe(200);
    expect(timestampIn(stale.text)).toBe(builtAt); // the stale page is served at once
    const fresh = await eventually(
      async () => {
        const res = await request("/params-closed/a");
        return timestampIn(res.text) !== builtAt ? res : false;
      },
      30_000,
      500,
    );
    expect(fresh.status).toBe(200);
  });

  it("serves a path of getStaticPaths when fallback is false (Pages Router)", async () => {
    const res = await request("/pages-closed/known");
    expect(res.status).toBe(200);
    expect(res.text.replaceAll("<!-- -->", "")).toContain("Closed known");
    expect((await request("/pages-closed/unknown")).status).toBe(404);
  });
});
