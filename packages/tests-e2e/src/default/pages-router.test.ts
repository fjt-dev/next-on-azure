import { describe, expect, it } from "vitest";
import { eventually, freshPage, hasHostLog, header, request, sleep, timestampIn } from "../http.js";

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

describe("Pages Router static generation", () => {
  it("renders an unknown path on first request (fallback: blocking), then serves it from the cache", async () => {
    const slug = `post-${Date.now()}`;
    const a = await request(`/pages-blog/${slug}`);
    expect(a.status).toBe(200);
    expect(a.text.replaceAll("<!-- -->", "")).toContain(`Post ${slug}`);
    const b = await request(`/pages-blog/${slug}`);
    expect(timestampIn(b.text)).toBe(timestampIn(a.text));
  });

  it("serves a path built ahead of time", async () => {
    const res = await request("/pages-blog/known");
    expect(res.status).toBe(200);
    expect(res.text.replaceAll("<!-- -->", "")).toContain("Post known");
  });

  it("answers 404 for notFound from getStaticProps", async () => {
    expect((await request("/pages-blog/missing")).status).toBe(404);
  });

  it("serves a loading shell for an unknown path (fallback: true), builds it when its data is requested, then serves the page", async () => {
    const slug = `fb-${Date.now()}`;
    const shell = await request(`/pages-fallback/${slug}`);
    expect(shell.status).toBe(200);
    expect(shell.text).toContain('id="loading"');
    expect(shell.text).not.toContain(`Fallback post ${slug}`);

    // The client of the shell asks for the page data, which makes the server generate the page.
    const buildId = /"buildId":"([^"]+)"/.exec(shell.text)?.[1];
    expect(buildId).toBeDefined();
    const data = await request(`/_next/data/${buildId}/pages-fallback/${slug}.json`);
    expect(data.status).toBe(200);
    expect(JSON.parse(data.text).pageProps.slug).toBe(slug);

    const page = await eventually(
      async () => {
        const res = await request(`/pages-fallback/${slug}`);
        return res.text.replaceAll("<!-- -->", "").includes(`Fallback post ${slug}`) ? res : false;
      },
      hasHostLog() ? 15_000 : 60_000,
      500,
    );
    expect(page.status).toBe(200);
  });

  it("answers 404 for notFound under fallback: true", async () => {
    const shell = await request("/pages-fallback/missing");
    const buildId = /"buildId":"([^"]+)"/.exec(shell.text)?.[1];
    expect((await request(`/_next/data/${buildId}/pages-fallback/missing.json`)).status).toBe(404);
  });

  it("regenerates a page with revalidate after it went stale (queue)", async () => {
    const first = timestampIn((await freshPage("/pages-isr")).text);
    expect(first).toBeDefined();
    await sleep(6500);
    const stale = await request("/pages-isr");
    expect(timestampIn(stale.text)).toBe(first); // stale copy is served at once
    const fresh = await eventually(
      async () => {
        const res = await request("/pages-isr");
        return timestampIn(res.text) !== first ? res : false;
      },
      hasHostLog() ? 20_000 : 150_000,
      hasHostLog() ? 500 : 3000,
    );
    expect(timestampIn(fresh.text)).not.toBe(first);
  });
});

describe("Pages Router on-demand revalidation (res.revalidate)", () => {
  it("keeps a page until res.revalidate is called, then renders a new one", async () => {
    const a = timestampIn((await request("/pages-ondemand")).text);
    expect(timestampIn((await request("/pages-ondemand")).text)).toBe(a);
    const post = await request("/api/revalidate-page", { method: "POST" });
    expect(post.status).toBe(200);
    const c = timestampIn((await request("/pages-ondemand")).text);
    expect(c).not.toBe(a);
    expect(timestampIn((await request("/pages-ondemand")).text)).toBe(c);
  });
});
