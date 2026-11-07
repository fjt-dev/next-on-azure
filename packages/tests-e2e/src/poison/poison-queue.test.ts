import { QueueServiceClient } from "@azure/storage-queue";
import { describe, expect, it } from "vitest";
import { eventually, hostLog } from "../http.js";

const service = QueueServiceClient.fromConnectionString("UseDevelopmentStorage=true;");

describe("poison queue (B3)", () => {
  it("moves a message the consumer cannot process to revalidation-poison after 3 attempts", async () => {
    const queue = service.getQueueClient("revalidation");
    const poison = service.getQueueClient("revalidation-poison");
    const marker = `not-json-${Date.now()}`;
    // Plain text, not JSON: the converter's JSON.parse throws, so every attempt fails.
    await queue.sendMessage(marker);

    const moved = await eventually(async () => {
      const { peekedMessageItems } = await poison.peekMessages({ numberOfMessages: 32 });
      return peekedMessageItems.find((m) => m.messageText === marker) ?? false;
    }, 40_000);
    expect(moved.messageText).toBe(marker);

    // The main queue does not keep it.
    const left = await queue.peekMessages({ numberOfMessages: 32 });
    expect(left.peekedMessageItems.some((m) => m.messageText === marker)).toBe(false);

    // maxDequeueCount is 3: the host ran the function three times for it, all failed.
    const failures = (hostLog().match(/Executed 'Functions\.revalidation' \(Failed/g) ?? []).length;
    expect(failures).toBe(3);
  });
});
