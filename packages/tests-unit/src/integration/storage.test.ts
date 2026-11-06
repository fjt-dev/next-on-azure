import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { QueueClient } from "@azure/storage-queue";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildAssetsManifest } from "../../../open-next-azure/src/cli/assets-manifest.js";
import { readAll } from "../helpers.js";
import { CONNECTION_STRING } from "./azurite.js";
import { useAzurite } from "./env.js";

const NAMES = {
  container: "it-cache",
  assets: "it-assets",
  table: "ittagcache",
  queue: "it-revalidation",
};
const g = globalThis as unknown as Record<string, unknown>;

beforeAll(async () => {
  useAzurite(NAMES);
  g.openNextConfig = {};
  const blob = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  await blob.getContainerClient(NAMES.container).createIfNotExists();
  await blob.getContainerClient(NAMES.assets).createIfNotExists();
  await TableServiceClient.fromConnectionString(CONNECTION_STRING, {
    allowInsecureConnection: true,
  }).createTable(NAMES.table);
  await new QueueClient(CONNECTION_STRING, NAMES.queue).createIfNotExists();
});

afterAll(() => vi.unstubAllEnvs());

describe("incremental cache on Blob Storage", () => {
  it("round-trips pages and fetch entries, and a missing entry is null (real 404)", async () => {
    const cache = (await import("../../../open-next-azure/src/overrides/incremental-cache.js"))
      .default;
    const page = { type: "app", html: "<h1>hi</h1>", rsc: "r" } as never;

    expect(await cache.get("blog/a", "cache")).toBeNull();
    const beforeSet = Date.now();
    await cache.set("blog/a", page, "cache");
    await cache.set("fetch-key", { kind: "FETCH", data: { body: "b" } } as never, "fetch");

    const got = await cache.get("blog/a", "cache");
    expect(got?.value).toEqual(page);
    expect(Math.abs((got?.lastModified ?? 0) - Date.now())).toBeLessThan(60_000);
    // Millisecond precision: Blob's own Last-Modified is truncated to the second and would be earlier
    // than the moment just before the write about 999 times out of 1000 (see incremental-cache.ts).
    expect(got?.lastModified).toBeGreaterThanOrEqual(beforeSet);
    expect((await cache.get("fetch-key", "fetch"))?.value).toMatchObject({ kind: "FETCH" });

    await cache.delete("blog/a");
    expect(await cache.get("blog/a", "cache")).toBeNull();
  });
});

describe("tag cache on Table Storage", () => {
  it("accepts tags containing every character Table Storage forbids in keys (B4, against the real service)", async () => {
    const tag = "_N_T_/blog/a?x=1#frag\\back";
    const cache = (await import("../../../open-next-azure/src/overrides/tag-cache.js")).default;
    expect(await cache.hasBeenRevalidated([tag], 0)).toBe(false);
    await cache.writeTags([tag]);
    expect(await cache.hasBeenRevalidated([tag], Date.now() - 5_000)).toBe(true);
    expect(await cache.hasBeenRevalidated([tag], Date.now() + 5_000)).toBe(false);
  });

  it("represents soft revalidation (stale) and overwrites on repeat", async () => {
    const cache = (await import("../../../open-next-azure/src/overrides/tag-cache.js")).default;
    const before = Date.now() - 1000;
    await cache.writeTags([{ tag: "soft", stale: Date.now() + 60_000 }]);
    expect(await cache.isStale?.(["soft"], before)).toBe(true);
    await cache.writeTags(["soft"]); // replaced by a hard revalidation without stale
    expect(await cache.isStale?.(["soft"], before)).toBe(false);
    expect(await cache.hasBeenRevalidated(["soft"], before)).toBe(true);
  });
});

describe("revalidation queue on Storage Queue", () => {
  it("delivers plain JSON that the revalidation converter understands", async () => {
    const { default: queue } = await import("../../../open-next-azure/src/overrides/queue.js");
    const { revalidateConverter } = await import(
      "../../../open-next-azure/src/overrides/revalidate.js"
    );
    const body = { host: "www.example.com", url: "/isr", lastModified: 1, eTag: "e" };

    await queue.send({ MessageBody: body, MessageDeduplicationId: "d", MessageGroupId: "g" });

    const client = new QueueClient(CONNECTION_STRING, NAMES.queue);
    const { receivedMessageItems } = await client.receiveMessages({ numberOfMessages: 1 });
    const item = receivedMessageItems[0];
    if (!item) throw new Error("no message was delivered");
    expect(JSON.parse(item.messageText)).toEqual(body); // not base64
    const event = await revalidateConverter.convertFrom(JSON.parse(item.messageText));
    expect(event.records[0]).toMatchObject({ host: "www.example.com", url: "/isr" });
    await client.deleteMessage(item.messageId, item.popReceipt);
  });
});

describe("revalidation dedupe on the real Table Storage (ADR-0010)", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    MessageBody: { host: "www.example.com", url: "/race", lastModified: 1, eTag: "e", ...over },
    MessageDeduplicationId: "d",
    MessageGroupId: "g",
  });

  it("50 simultaneous requests enqueue exactly one message, a new page version one more", async () => {
    vi.stubEnv("REVALIDATION_QUEUE_NAME", "it-dedupe-queue");
    const queueClient = new QueueClient(CONNECTION_STRING, "it-dedupe-queue");
    await queueClient.createIfNotExists();
    const { default: queue } = await import("../../../open-next-azure/src/overrides/queue.js");

    // 409 on create and 412 on a conditional replace are the real service's answers here.
    await Promise.all(Array.from({ length: 50 }, () => queue.send(body())));
    expect(
      (await queueClient.peekMessages({ numberOfMessages: 32 })).peekedMessageItems,
    ).toHaveLength(1);

    await queue.send(body()); // still the same version
    expect(
      (await queueClient.peekMessages({ numberOfMessages: 32 })).peekedMessageItems,
    ).toHaveLength(1);

    await queue.send(body({ eTag: "regenerated" })); // new content, it can go stale again
    await queue.send(body({ url: "/other" })); // another page
    expect(
      (await queueClient.peekMessages({ numberOfMessages: 32 })).peekedMessageItems,
    ).toHaveLength(3);
  });

  it("many simultaneous requests racing to replace an expired claim enqueue exactly one message", async () => {
    vi.stubEnv("REVALIDATION_QUEUE_NAME", "it-dedupe-queue-2");
    vi.stubEnv("REVALIDATION_DEDUPE_SECONDS", "1");
    const queueClient = new QueueClient(CONNECTION_STRING, "it-dedupe-queue-2");
    await queueClient.createIfNotExists();
    const { default: queue } = await import("../../../open-next-azure/src/overrides/queue.js");

    await queue.send(body({ url: "/expiring" }));
    await new Promise((resolve) => setTimeout(resolve, 1200)); // the one second window ends
    await Promise.all(Array.from({ length: 50 }, () => queue.send(body({ url: "/expiring" }))));
    // the original message plus exactly one from the race over the expired claim (ETag 412 for the rest)
    expect(
      (await queueClient.peekMessages({ numberOfMessages: 32 })).peekedMessageItems,
    ).toHaveLength(2);
  });
});

describe("asset resolver and image loader on Blob Storage", () => {
  let dir: string;
  const files: Record<string, Buffer> = {
    "_next/static/chunks/main.js": Buffer.from("0123456789".repeat(50)),
    "images/a.png": Buffer.from([137, 80, 78, 71, 1, 2, 3]),
    "favicon.ico": Buffer.from([0, 0, 1, 0]),
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "assets-it-"));
    const container = BlobServiceClient.fromConnectionString(CONNECTION_STRING).getContainerClient(
      NAMES.assets,
    );
    for (const [name, body] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
      await container.getBlockBlobClient(name).upload(body, body.length);
    }
    fs.writeFileSync(
      path.join(dir, "..", `${path.basename(dir)}.json`),
      JSON.stringify(buildAssetsManifest(dir)),
    );
    vi.stubEnv("ASSETS_MANIFEST_PATH", path.join(dir, "..", `${path.basename(dir)}.json`));
  });

  afterAll(() => {
    fs.rmSync(path.join(dir, "..", `${path.basename(dir)}.json`), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const ev = (rawPath: string, headers: Record<string, string> = {}, method = "GET") =>
    ({
      type: "core",
      method,
      rawPath,
      headers,
      url: `https://h${rawPath}`,
      query: {},
      cookies: {},
      remoteAddress: "::1",
      body: Buffer.alloc(0),
    }) as never;

  it("serves the exact bytes, a byte range, HEAD and 304 from real blobs", async () => {
    const resolver = (await import("../../../open-next-azure/src/overrides/asset-resolver.js"))
      .default;
    const main = files["_next/static/chunks/main.js"] as Buffer;

    const full = await resolver.maybeGetAssetResult?.(ev("/_next/static/chunks/main.js"));
    expect(full?.statusCode).toBe(200);
    expect(await readAll(full?.body as never)).toBe(main.toString());

    const part = await resolver.maybeGetAssetResult?.(
      ev("/_next/static/chunks/main.js", { range: "bytes=100-109" }),
    );
    expect(part?.statusCode).toBe(206);
    expect(await readAll(part?.body as never)).toBe(main.subarray(100, 110).toString());

    const tail = await resolver.maybeGetAssetResult?.(
      ev("/_next/static/chunks/main.js", { range: "bytes=-5" }),
    );
    expect(await readAll(tail?.body as never)).toBe(main.subarray(-5).toString());

    const head = await resolver.maybeGetAssetResult?.(
      ev("/_next/static/chunks/main.js", {}, "HEAD"),
    );
    expect(head?.headers["content-length"]).toBe(String(main.length));
    expect(await readAll(head?.body as never)).toBe("");

    const etag = full?.headers.etag as string;
    const notModified = await resolver.maybeGetAssetResult?.(
      ev("/_next/static/chunks/main.js", { "if-none-match": etag }),
    );
    expect(notModified?.statusCode).toBe(304);
  });

  it("leaves paths outside the manifest to Next.js even if a blob with that name exists", async () => {
    const container = BlobServiceClient.fromConnectionString(CONNECTION_STRING).getContainerClient(
      NAMES.assets,
    );
    await container.getBlockBlobClient("secret.txt").upload("hidden", 6);
    const resolver = (await import("../../../open-next-azure/src/overrides/asset-resolver.js"))
      .default;
    expect(await resolver.maybeGetAssetResult?.(ev("/secret.txt"))).toBeUndefined();
  });

  it("loads source images for the optimizer", async () => {
    const loader = (await import("../../../open-next-azure/src/overrides/image-loader.js")).default;
    const res = await loader.load("/images/a.png");
    expect(Buffer.from(await readAll(res.body as never), "binary").length).toBe(
      (files["images/a.png"] as Buffer).length,
    );
    await expect(loader.load("/images/missing.png")).rejects.toThrow("does not exist");
  });
});
