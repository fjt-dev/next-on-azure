import { beforeAll, describe, expect, it } from "vitest";
import { header, request } from "../http.js";

let jsPath: string;

beforeAll(async () => {
  const html = (await request("/")).text;
  const found = /\/_next\/static\/[^"]+\.js/.exec(html)?.[0];
  if (!found) throw new Error("no _next/static script on the home page");
  jsPath = found;
});

describe("static files served from Blob through the asset resolver", () => {
  it("serves a build asset with its type and an immutable cache", async () => {
    const res = await request(jsPath);
    expect(res.status).toBe(200);
    expect(header(res, "content-type")).toContain("text/javascript");
    expect(header(res, "cache-control")).toBe("public, max-age=31536000, immutable");
    expect(header(res, "accept-ranges")).toBe("bytes");
    expect(Number(header(res, "content-length"))).toBe(res.body.length);
    expect(header(res, "etag")).toMatch(/^"/);
  });

  it("serves a file from public/ and revalidates it", async () => {
    const res = await request("/test.png");
    expect(res.status).toBe(200);
    expect(header(res, "content-type")).toBe("image/png");
    expect(header(res, "cache-control")).toBe("public, max-age=0, must-revalidate");
    expect([...res.body.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  });

  it("answers 304 for a matching ETag and sends no body", async () => {
    const etag = header(await request(jsPath), "etag") as string;
    const res = await request(jsPath, { headers: { "If-None-Match": etag } });
    expect(res.status).toBe(304);
    expect(res.body.length).toBe(0);
  });

  it("answers HEAD with the length but no body", async () => {
    const full = await request(jsPath);
    const head = await request(jsPath, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(header(head, "content-length")).toBe(String(full.body.length));
  });

  it("serves byte ranges that match the full file", async () => {
    const full = await request(jsPath);
    const part = await request(jsPath, { headers: { Range: "bytes=0-9" } });
    expect(part.status).toBe(206);
    expect(header(part, "content-range")).toBe(`bytes 0-9/${full.body.length}`);
    expect(part.body.equals(full.body.subarray(0, 10))).toBe(true);

    const tail = await request(jsPath, { headers: { Range: "bytes=-7" } });
    expect(tail.body.equals(full.body.subarray(-7))).toBe(true);
  });

  it("answers 416 for a range beyond the end", async () => {
    const res = await request(jsPath, { headers: { Range: "bytes=99999999-" } });
    expect(res.status).toBe(416);
  });

  it.each(["/_next/static/nope.js", "/BUILD_ID", "/manifest-that-does-not-exist.json"])(
    "does not serve %s",
    async (p) => {
      expect((await request(p)).status).toBe(404);
    },
  );

  it("does not let a path with .. reach anything outside the manifest", async () => {
    const res = await request("/_next/static/../../BUILD_ID");
    expect(res.status).toBe(404);
  });

  it("does not answer a POST to a static file from Blob", async () => {
    const res = await request(jsPath, {
      method: "POST",
      body: "x",
      headers: { "content-length": "1" },
    });
    expect(res.status).not.toBe(200);
  });
});
