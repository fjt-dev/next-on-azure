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

  it("rejects widths that are not configured", async () => {
    expect((await image("url=%2Ftest.png&w=999&q=75")).status).toBe(400);
  });

  it("rejects remote URLs that are not allowed", async () => {
    expect((await image("url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75")).status).toBe(400);
  });

  it("answers 404 for a source image that does not exist", async () => {
    expect((await image("url=%2Fmissing.png&w=64&q=75")).status).toBe(404);
  });
});
