import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
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

// A remote image from an origin listed in images.remotePatterns (next.config.mjs). The test serves
// it from this process over HTTPS with the certificate of the run, which the host trusts. Not
// possible against a deployment, where the host cannot reach this process.
describe.skipIf(inject("remote"))("remote images (images.remotePatterns)", () => {
  let server: https.Server;
  const png = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../../examples/app-router/public/test.png"),
  );

  beforeAll(async () => {
    const dir = inject("runDir");
    server = https.createServer(
      {
        key: fs.readFileSync(path.join(dir, "key.pem")),
        cert: fs.readFileSync(path.join(dir, "cert.pem")),
      },
      (req, res) => {
        if (req.url === "/remote.png") {
          res.writeHead(200, { "content-type": "image/png" });
          res.end(png);
        } else {
          res.writeHead(404).end();
        }
      },
    );
    await new Promise<void>((resolve) => server.listen(8443, "127.0.0.1", resolve));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const remote = (p: string) =>
    image(`url=${encodeURIComponent(`https://localhost:8443${p}`)}&w=64&q=75`);

  it("fetches, resizes and serves an image from an allowed origin", async () => {
    const res = await remote("/remote.png");
    expect(res.status).toBe(200);
    expect(header(res, "content-type")).toBe("image/png");
    expect(res.body.length).toBeLessThan(png.length);
  });

  it("still refuses an origin that is not listed", async () => {
    expect((await image("url=https%3A%2F%2Flocalhost%3A9999%2Fa.png&w=64&q=75")).status).toBe(400);
  });

  it("answers an error status, not a hang, when the remote image is missing", async () => {
    const res = await remote("/missing.png");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
