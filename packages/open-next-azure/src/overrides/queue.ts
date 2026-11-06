import type {} from "@opennextjs/aws/types/global";
import type { Queue } from "@opennextjs/aws/types/overrides";
import { getQueueClient, getTableClient } from "./clients.js";
import { claimRevalidation } from "./revalidation-dedupe.js";

/**
 * ISR revalidation queue on Azure Storage Queue.
 *
 * Storage Queues have no deduplication or message groups, so `MessageDeduplicationId` and
 * `MessageGroupId` are ignored and the deduplication is done here instead: before a message is
 * enqueued the request must win a claim on that page version, its ETag (see revalidation-dedupe.ts). Without
 * it every request that finds the page stale adds a message, and a slow consumer turns that into
 * dozens of regenerations of the same page (ADR-0010).
 *
 * The claim lives in the tag cache table under its own partition. `REVALIDATION_DEDUPE_SECONDS`
 * (default 60, 0 = off) is how long a claim holds; it ends early when the page is regenerated with new content.
 * If the claim cannot be made (storage error) the message is enqueued anyway: a duplicate costs a
 * render, a missing revalidation leaves a page stale.
 *
 * The consuming Function must use host.json `extensions.queues.messageEncoding: "none"`
 * (the CLI generates this).
 */
const DEFAULT_DEDUPE_SECONDS = 60;

function dedupeWindowMs(): number {
  const raw = process.env.REVALIDATION_DEDUPE_SECONDS;
  const seconds = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_DEDUPE_SECONDS) * 1000;
}

/**
 * What identifies the content that is being revalidated. The ETag does: it is the same for every
 * request that sees the same cached page and changes when the page is regenerated with new
 * content. `lastModified` cannot be used for the server path: OpenNext sets it to a marker (1 for
 * stale, 0 for unset) there. Real values (the cache interception path) are only a fallback.
 */
export function pageVersion(body: { eTag?: string; lastModified?: number }): string {
  if (body.eTag) return body.eTag;
  return body.lastModified !== undefined && body.lastModified > 1 ? String(body.lastModified) : "";
}

async function shouldEnqueue(body: {
  host: string;
  url: string;
  eTag?: string;
  lastModified?: number;
}) {
  const windowMs = dedupeWindowMs();
  if (windowMs === 0) return true;
  try {
    const table = await getTableClient(process.env.CACHE_TABLE_NAME ?? "tagcache");
    return await claimRevalidation(table, {
      partitionKey: `dedupe-${process.env.OPEN_NEXT_BUILD_ID ?? ""}`,
      host: body.host,
      url: body.url,
      version: pageVersion(body),
      now: Date.now(),
      windowMs,
    });
  } catch (error) {
    console.error("Revalidation dedupe failed, enqueueing anyway", error);
    return true;
  }
}

const queue: Queue = {
  name: "azure-queue",

  async send({ MessageBody }) {
    const send = (async () => {
      if (!(await shouldEnqueue(MessageBody))) return;
      const client = await getQueueClient(process.env.REVALIDATION_QUEUE_NAME ?? "revalidation");
      await client.sendMessage(JSON.stringify(MessageBody));
    })().catch((e) => console.error("Failed to enqueue revalidation", e));

    // Do not block the response on the enqueue when the wrapper has waitUntil.
    const waitUntil = globalThis.__openNextAls?.getStore()?.waitUntil;
    if (waitUntil) {
      waitUntil(send);
      return;
    }
    await send;
  },
};

export default queue;
