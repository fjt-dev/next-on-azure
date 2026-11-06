import type {} from "@opennextjs/aws/types/global";
import type { Queue } from "@opennextjs/aws/types/overrides";
import { getQueueClient } from "./clients.js";

/**
 * ISR revalidation queue on Azure Storage Queue.
 *
 * Storage Queues have no deduplication or message groups, so
 * MessageDeduplicationId / MessageGroupId are ignored. Revalidation is
 * idempotent, so duplicates only cost an extra render.
 *
 * The consuming Function must use host.json `extensions.queues.messageEncoding: "none"`
 * (the CLI generates this).
 */
const queue: Queue = {
  name: "azure-queue",

  async send({ MessageBody }) {
    const send = getQueueClient(process.env.REVALIDATION_QUEUE_NAME ?? "revalidation")
      .then((q) => q.sendMessage(JSON.stringify(MessageBody)))
      .then(() => undefined)
      .catch((e) => console.error("Failed to enqueue revalidation", e));

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
