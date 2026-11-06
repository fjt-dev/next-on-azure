import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageVersion } from "../../../open-next-azure/src/overrides/queue.js";
import { fakeQueue, fakeTable } from "../fakes.js";
import { deferred, sleep } from "../helpers.js";

vi.mock("../../../open-next-azure/src/overrides/clients.js", () => ({
  getBlobService: vi.fn(),
  getTableClient: vi.fn(),
  getQueueClient: vi.fn(),
}));

let q: ReturnType<typeof fakeQueue>;
let table: ReturnType<typeof fakeTable>;
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
  vi.mocked(clients.getTableClient).mockResolvedValue(table.client as never);
  return {
    queue: (await import("../../../open-next-azure/src/overrides/queue.js")).default,
    clients,
  };
}

beforeEach(() => {
  q = fakeQueue();
  table = fakeTable();
  g.__openNextAls = undefined;
  vi.stubEnv("OPEN_NEXT_BUILD_ID", "b1");
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
    // a different page version, otherwise the dedupe (rightly) drops the second message
    await queue.send({
      ...message,
      MessageBody: { ...message.MessageBody, eTag: "another-version" },
    });
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

describe("pageVersion", () => {
  it.each([
    [{ eTag: '"abc"', lastModified: 1 }, '"abc"'],
    [{ eTag: '"abc"', lastModified: 1700000000000 }, '"abc"'],
    [{ eTag: "", lastModified: 1700000000000 }, "1700000000000"],
    [{ eTag: "", lastModified: 1 }, ""],
    [{ eTag: "", lastModified: 0 }, ""],
    [{ lastModified: 0 }, ""],
    [{}, ""],
  ])("%j -> %j", (input, expected) => {
    expect(pageVersion(input)).toBe(expected);
  });
});

describe("deduplication (ADR-0010)", () => {
  const body = (over: Partial<typeof message.MessageBody> = {}) => ({
    ...message,
    MessageBody: { ...message.MessageBody, ...over },
  });

  it("enqueues once however many requests find the same page version stale", async () => {
    const { queue } = await load();
    for (let i = 0; i < 25; i++) await queue.send(body());
    expect(q.sent).toHaveLength(1);
  });

  it("holds when the requests arrive at the same time", async () => {
    const { queue } = await load();
    await Promise.all(Array.from({ length: 25 }, () => queue.send(body())));
    expect(q.sent).toHaveLength(1);
  });

  it("enqueues again when the page was regenerated with new content (a new ETag)", async () => {
    const { queue } = await load();
    await queue.send(body({ eTag: "v1" }));
    await queue.send(body({ eTag: "v2" }));
    await queue.send(body({ eTag: "v2" }));
    expect(q.sent).toHaveLength(2);
  });

  it("does not take turns when OpenNext reports lastModified 0 to some requests and 1 to others (seen on Azure)", async () => {
    // In the server path OpenNext sets lastModified to a marker: 1 when stale, 0 when unset.
    // Using it as the page version made concurrent requests of one stale page win one claim each.
    const { queue } = await load();
    const lastModified = [0, 1, 0, 1, 1, 0, 0, 1, 0, 1];
    await Promise.all(lastModified.map((value) => queue.send(body({ lastModified: value }))));
    expect(q.sent).toHaveLength(1);
  });

  it("without an ETag it still deduplicates, by the window alone", async () => {
    const { queue } = await load();
    await queue.send(body({ eTag: "", lastModified: 0 }));
    await queue.send(body({ eTag: "", lastModified: 1 }));
    await queue.send(body({ eTag: "" }));
    expect(q.sent).toHaveLength(1);
  });

  it("enqueues for different pages and hosts", async () => {
    const { queue } = await load();
    await queue.send(body({ url: "/a" }));
    await queue.send(body({ url: "/b" }));
    await queue.send(body({ url: "/a", host: "other.example.com" }));
    expect(q.sent).toHaveLength(3);
  });

  it("enqueues again after the window, in case the first message was lost", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      vi.stubEnv("REVALIDATION_DEDUPE_SECONDS", "30");
      const { queue } = await load();
      await queue.send(body());
      vi.setSystemTime(1_000_000 + 29_000);
      await queue.send(body());
      expect(q.sent).toHaveLength(1);
      vi.setSystemTime(1_000_000 + 30_000);
      await queue.send(body());
      expect(q.sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("REVALIDATION_DEDUPE_SECONDS=0 turns it off and touches no table", async () => {
    vi.stubEnv("REVALIDATION_DEDUPE_SECONDS", "0");
    const { queue, clients } = await load();
    await queue.send(body());
    await queue.send(body());
    expect(q.sent).toHaveLength(2);
    expect(clients.getTableClient).not.toHaveBeenCalled();
  });

  it.each(["abc", "-5", ""])("falls back to the default window for %j", async (value) => {
    vi.stubEnv("REVALIDATION_DEDUPE_SECONDS", value);
    const { queue } = await load();
    await queue.send(body());
    await queue.send(body());
    expect(q.sent).toHaveLength(1);
  });

  it("keeps its rows apart from the tag cache and per build", async () => {
    const { queue, clients } = await load();
    await queue.send(body());
    expect(clients.getTableClient).toHaveBeenLastCalledWith("tagcache");
    expect([...table.rows.values()].map((r) => r.partitionKey)).toEqual(["dedupe-b1"]);

    vi.stubEnv("OPEN_NEXT_BUILD_ID", "b2");
    await queue.send(body()); // a new deployment is not held back by the old one
    expect(q.sent).toHaveLength(2);
  });

  it("uses the configured table", async () => {
    vi.stubEnv("CACHE_TABLE_NAME", "custom");
    const { queue, clients } = await load();
    await queue.send(body());
    expect(clients.getTableClient).toHaveBeenLastCalledWith("custom");
  });

  it("enqueues anyway, and says so, when the claim cannot be made", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    table.client.getEntity = async () => {
      throw Object.assign(new Error("table unavailable"), { statusCode: 500 });
    };
    const { queue } = await load();
    await queue.send(body());
    expect(q.sent).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("dedupe failed"), expect.anything());
  });

  it("does not enqueue when it has no claim, and does not complain", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { queue } = await load();
    await queue.send(body());
    await queue.send(body());
    expect(error).not.toHaveBeenCalled();
  });
});
