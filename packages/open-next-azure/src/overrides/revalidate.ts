import type { InvocationContext } from "@azure/functions";
import type { Converter, Wrapper } from "@opennextjs/aws/types/overrides";

type RevalidateEvent = {
  type: "revalidate";
  records: { host: string; url: string; id: string }[];
};

/** Storage Queue message (already JSON-parsed by the Functions host) -> revalidate event. */
export const revalidateConverter: Converter<any, any> = {
  name: "azure-queue-revalidate",

  async convertFrom(message: unknown): Promise<RevalidateEvent> {
    const body = typeof message === "string" ? JSON.parse(message) : (message as any);
    return {
      type: "revalidate",
      records: [{ host: body.host, url: body.url, id: crypto.randomUUID() }],
    };
  },

  // Failed records come back in `records`; throwing makes the Functions host
  // retry the message and finally move it to the -poison queue.
  async convertTo(result: RevalidateEvent) {
    if (result.records.length > 0) {
      throw new Error(`Failed to revalidate ${result.records.length} page(s)`);
    }
    return { type: "revalidate" };
  },
};

export const revalidateWrapper: Wrapper<any, any> = {
  name: "azure-queue",
  supportStreaming: false,
  wrapper:
    async (handler: any, converter: any) =>
    async (message: unknown, _context?: InvocationContext) => {
      const event = await converter.convertFrom(message);
      const result = await handler(event);
      return converter.convertTo(result);
    },
};

export default revalidateWrapper;
