import type { Readable } from "node:stream";
import type { ImageLoader } from "@opennextjs/aws/types/overrides";
import { getBlobService } from "./clients.js";
import { markSourceImageMissing } from "./request-context.js";

/** Loads source images for `/_next/image` from the static assets container. */
const imageLoader: ImageLoader = {
  name: "azure-blob",

  async load(url: string) {
    const container = (await getBlobService()).getContainerClient(
      process.env.ASSETS_CONTAINER_NAME ?? "assets",
    );
    const prefix = (process.env.ASSETS_BLOB_PREFIX ?? "").replace(/^\/|\/$/g, "");
    const name = [prefix, url.replace(/^\//, "")].filter(Boolean).join("/");
    try {
      const res = await container.getBlockBlobClient(name).download();
      if (!res.readableStreamBody) throw new Error("Empty image body");
      return {
        body: res.readableStreamBody as Readable,
        contentType: res.contentType,
        cacheControl: res.cacheControl,
      };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        markSourceImageMissing();
        throw new Error("The specified image does not exist.");
      }
      throw e;
    }
  },
};

export default imageLoader;
