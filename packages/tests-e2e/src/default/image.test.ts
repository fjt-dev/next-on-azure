import { describe, expect, it } from "vitest";
import { header, request } from "../http.js";

const image = (query: string, accept?: string) =>
  request(`/_next/image?${query}`, accept ? { headers: { Accept: accept } } : {});

describe("image optimization on /_next/image (B11)", () => {
  it("resizes the source image and negotiates WebP", async () => {
    const res = await image("url=%2Ftest.png&w=64&q=75", "image/webp");
    expect(res.status).toBe(200);
    expect(header(res, "content-type")).toBe("image/webp");
    expect(res.body.subarray(0, 4).toString()).toBe("RIFF");
    expect(res.body.length).toBeLessThan(2000); // the 128 px source is 33 kB
  });

  it("resizes without WebP when the client does not accept it", async () => {
    const res = await image("url=%2Ftest.png&w=64&q=75");
    expect(res.status).toBe(200);
    expect(header(res, "content-type")).toBe("image/png");
    const source = await request("/test.png");
    expect(res.body.length).toBeLessThan(source.body.length); // really resized, not passed through
  });

  it("sends an ETag and answers 304 to a matching If-None-Match without a body (ADR-0014)", async () => {
    const first = await image("url=%2Ftest.png&w=64&q=75", "image/webp");
    const etag = header(first, "etag");
    expect(etag).toBeTruthy();
    expect(header(first, "vary")).toBe("Accept");
    const again = await request("/_next/image?url=%2Ftest.png&w=64&q=75", {
      headers: { Accept: "image/webp", "If-None-Match": etag as string },
    });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    // A different size has a different ETag, so it is not answered 304.
    const other = await request("/_next/image?url=%2Ftest.png&w=32&q=75", {
      headers: { Accept: "image/webp", "If-None-Match": etag as string },
    });
    expect(other.status).toBe(200);
  });

  it("rejects widths that are not configured", async () => {
    expect((await image("url=%2Ftest.png&w=999&q=75")).status).toBe(400);
  });

  it("rejects remote URLs that are not allowed", async () => {
    expect((await image("url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75")).status).toBe(400);
  });

  it("answers 404 for a source image that does not exist", async () => {
    // The Next.js image optimizer itself answers 400 on Next.js 15.
    const expected = process.env.E2E_TARGET === "standalone" ? [400, 404] : [404];
    expect(expected).toContain((await image("url=%2Fmissing.png&w=64&q=75")).status);
  });
});
