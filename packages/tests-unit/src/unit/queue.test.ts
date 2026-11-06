import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQueue } from "../fakes.js";
import { deferred, sleep } from "../helpers.js";

vi.mock("../../../open-next-azure/src/overrides/clients.js", () => ({
  getBlobService: vi.fn(),
  getTableClient: vi.fn(),
  getQueueClient: vi.fn(),
}));

let q: ReturnType<typeof fakeQueue>;
const g = globalThis as unknown as Record<string, unknown>;
const message = {
  MessageBody: { host: "www.example.com", url: "/blog/a", lastModified: 1, eTag: "e" },
  MessageDeduplicationId: "dedup",
  MessageGroupId: "group",
};

async function load() {
  vi.resetModules();
  const clients = await import("../../../open-next-azure/src/overrides/clients.js");
  vi.mocked(clients.getQueueClient).mockResolvedValue(q.client as never);
  return {
    queue: (await import("../../../open-next-azure/src/overrides/queue.js")).default,
    clients,
  };
}

beforeEach(() => {
  q = fakeQueue();
  g.__openNextAls = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("send", () => {
  it("enqueues the body as plain JSON (the host reads it with messageEncoding none)", async () => {
    const { queue } = await load();
    await queue.send(message);
    expect(q.sent).toHaveLength(1);
    expect(JSON.parse(q.sent[0] as string)).toEqual(message.MessageBody);
    expect(q.sent[0]).not.toMatch(/^[A-Za-z0-9+/=]+$/); // not base64
  });

  it("ignores deduplication id and group id (Storage Queues have neither)", async () => {
    const { queue } = await load();
    await queue.send(message);
    expect(q.sent[0]).not.toContain("dedup");
    expect(q.sent[0]).not.toContain("group");
  });

  it("uses the configured queue name, default 'revalidation'", async () => {
    const { queue, clients } = await load();
    await queue.send(message);
    expect(clients.getQueueClient).toHaveBeenLastCalledWith("revalidation");
    vi.stubEnv("REVALIDATION_QUEUE_NAME", "custom");
    await queue.send(message);
    expect(clients.getQueueClient).toHaveBeenLastCalledWith("custom");
  });

  it("waits for the enqueue when there is no waitUntil", async () => {
    const gate = deferred();
    q.gate.wait = gate.promise;
    const { queue } = await load();
    let returned = false;
    const sending = queue.send(message).then(() => {
      returned = true;
    });
    await sleep(20);
    expect(returned).toBe(false);
    gate.resolve();
    await sending;
    expect(q.sent).toHaveLength(1);
  });

  it("hands the enqueue to waitUntil and returns immediately when it exists", async () => {
    const gate = deferred();
    q.gate.wait = gate.promise;
    const handed: Promise<void>[] = [];
    g.__openNextAls = { getStore: () => ({ waitUntil: (p: Promise<void>) => handed.push(p) }) };
    const { queue } = await load();

    await queue.send(message); // does not wait for the gate
    expect(q.sent).toHaveLength(0);
    expect(handed).toHaveLength(1);

    gate.resolve();
    await handed[0];
    expect(q.sent).toHaveLength(1);
  });

  it("never throws when the queue is unavailable (a failed enqueue must not break the page)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(q.client, "sendMessage").mockRejectedValue(new Error("queue down"));
    const { queue } = await load();
    await expect(queue.send(message)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
