import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBlobService } from "../fakes.js";
import { readAll } from "../helpers.js";

vi.mock("../../../open-next-azure/src/overrides/clients.js", () => ({
  getBlobService: vi.fn(),
  getTableClient: vi.fn(),
  getQueueClient: vi.fn(),
}));

afterEach(() => vi.unstubAllEnvs());

async function load(blobs: ReturnType<typeof fakeBlobService>) {
  vi.resetModules();
  const { getBlobService } = await import("../../../open-next-azure/src/overrides/clients.js");
  vi.mocked(getBlobService).mockResolvedValue(blobs.service as never);
  return (await import("../../../open-next-azure/src/overrides/image-loader.js")).default;
}

describe("image loader", () => {
  it("streams the source image with its content type and cache control", async () => {
    const blobs = fakeBlobService();
    blobs.put("assets", "images/a.png", "PNGDATA", "image/png");
    const res = await (await load(blobs)).load("/images/a.png");
    expect(res.contentType).toBe("image/png");
    expect(res.cacheControl).toBe("public, max-age=60");
    expect(await readAll(res.body as never)).toBe("PNGDATA");
  });

  it("strips the leading slash and honours container and prefix", async () => {
    vi.stubEnv("ASSETS_CONTAINER_NAME", "static");
    vi.stubEnv("ASSETS_BLOB_PREFIX", "/v2/");
    const blobs = fakeBlobService();
    blobs.put("static", "v2/a.png", "X", "image/png");
    const res = await (await load(blobs)).load("/a.png");
    expect(await readAll(res.body as never)).toBe("X");
    expect(blobs.downloads[0]).toMatchObject({ container: "static", name: "v2/a.png" });
  });

  it("raises a clear error for a missing image", async () => {
    await expect((await load(fakeBlobService())).load("/nope.png")).rejects.toThrow(
      "The specified image does not exist.",
    );
  });

  it("records a missing source image for the wrapper, which answers 404", async () => {
    const loader = await load(fakeBlobService());
    // Import after load(): it resets the module registry, and the loader's instance must be the one used.
    const { requestContext } = await import(
      "../../../open-next-azure/src/overrides/request-context.js"
    );
    const ctx = { sourceImageMissing: false };
    await requestContext.run(ctx, async () => {
      await expect(loader.load("/nope.png")).rejects.toThrow();
    });
    expect(ctx.sourceImageMissing).toBe(true);
  });
});
