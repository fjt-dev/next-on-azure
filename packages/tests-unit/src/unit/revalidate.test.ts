import { describe, expect, it, vi } from "vitest";
import {
  revalidateConverter,
  revalidateWrapper,
} from "../../../open-next-azure/src/overrides/revalidate.js";

const body = { host: "www.example.com", url: "/blog/a", lastModified: 1, eTag: "e" };

describe("revalidateConverter.convertFrom", () => {
  it("turns a parsed queue message into a revalidate event", async () => {
    const e = await revalidateConverter.convertFrom(body);
    expect(e.type).toBe("revalidate");
    expect(e.records).toHaveLength(1);
    expect(e.records[0]).toMatchObject({ host: "www.example.com", url: "/blog/a" });
    expect(e.records[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("also accepts the message as a JSON string", async () => {
    const e = await revalidateConverter.convertFrom(JSON.stringify(body));
    expect(e.records[0]).toMatchObject({ host: "www.example.com", url: "/blog/a" });
  });
});

describe("revalidateConverter.convertTo (B3: failures must be retried, never acknowledged)", () => {
  it("returns normally when every record was revalidated", async () => {
    await expect(
      revalidateConverter.convertTo({ type: "revalidate", records: [] }),
    ).resolves.toEqual({
      type: "revalidate",
    });
  });

  it("throws when records failed, so the Functions host retries and finally poisons the message", async () => {
    await expect(
      revalidateConverter.convertTo({
        type: "revalidate",
        records: [{ host: "h", url: "/u", id: "1" }],
      }),
    ).rejects.toThrow(/Failed to revalidate 1 page/);
  });
});

describe("revalidateWrapper", () => {
  it("passes the event to the handler and succeeds when nothing failed", async () => {
    const handler = vi.fn(async () => ({ type: "revalidate", records: [] }));
    const run = await revalidateWrapper.wrapper(handler as never, revalidateConverter as never);
    await expect(run(body)).resolves.toEqual({ type: "revalidate" });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: "revalidate" }));
  });

  it("rejects when the handler reports failed records", async () => {
    const handler = async (e: { records: unknown[] }) => ({
      type: "revalidate",
      records: e.records,
    });
    const run = await revalidateWrapper.wrapper(handler as never, revalidateConverter as never);
    await expect(run(body)).rejects.toThrow();
  });

  it("is not a streaming wrapper", () => {
    expect(revalidateWrapper.supportStreaming).toBe(false);
  });
});
