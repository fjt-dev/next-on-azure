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
});
