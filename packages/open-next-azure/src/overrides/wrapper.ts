import { timingSafeEqual } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { InternalResult, StreamCreator } from "@opennextjs/aws/types/open-next";
import type { Wrapper, WrapperHandler } from "@opennextjs/aws/types/overrides";

type Prelude = Parameters<StreamCreator["writeHeaders"]>[0];

/**
 * What happens to work registered with `waitUntil` (for example `after()` callbacks and queue
 * enqueues) when the response body is complete:
 *
 * - `hold` (default): the response stays open until that work has settled. Safe, but the client
 *   waits for it.
 * - `detach`: the response ends at once and the work continues in the background. Fast for the
 *   client, but the work only completes if the platform keeps the instance running.
 *
 * Set with the `WAIT_UNTIL_MODE` app setting. See ADR-0006.
 */
export function waitUntilMode(
  env: string | undefined = process.env.WAIT_UNTIL_MODE,
): "hold" | "detach" {
  return env === "detach" ? "detach" : "hold";
}

/**
 * When the app sits behind Azure Front Door, only traffic that came through *our* profile may be
 * served. Front Door adds `X-Azure-FDID` with the profile's id; the app compares it with the
 * `FRONT_DOOR_ID` setting. Without the setting nothing is checked (no Front Door in front).
 * This complements, and does not replace, the `AzureFrontDoor.Backend` access restriction.
 */
export function isFrontDoorRequestAllowed(
  expected: string | undefined,
  received: string | null | undefined,
): boolean {
  if (!expected) return true;
  if (!received) return false;
  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(received.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Wrapper for the Azure Functions Node v4 model with HTTP streaming.
 *
 * The generated entrypoint must call `app.setup({ enableHttpStream: true })`
 * and register the returned function with `app.http(...)`.
 *
 * waitUntil: the response stream is held open until deferred promises settle,
 * so background work (ISR enqueue, cache write-through) is not frozen when the
 * invocation returns.
 */
const wrapper: WrapperHandler = async (handler, converter) => {
  return async (req: HttpRequest, _context?: InvocationContext): Promise<HttpResponseInit> => {
    if (!isFrontDoorRequestAllowed(process.env.FRONT_DOOR_ID, req.headers.get("x-azure-fdid"))) {
      return {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: "Forbidden",
      };
    }

    const event = await converter.convertFrom(req);

    const pending: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<void>) => {
      pending.push(p);
    };

    const pass = new PassThrough();
    let written: Prelude | undefined;
    let resolvePrelude!: (p: Prelude) => void;
    const preludeReady = new Promise<Prelude>((r) => {
      resolvePrelude = r;
    });

    const streamCreator: StreamCreator = {
      writeHeaders(prelude) {
        written = prelude;
        resolvePrelude(prelude);
        return pass;
      },
    };

    // Either the handler streams (writeHeaders is called) or it returns a
    // plain InternalResult (e.g. responses built by routing/middleware).
    const done = handler(event, { streamCreator, waitUntil }).then((result: InternalResult) => ({
      result,
    }));
    const first = await Promise.race([preludeReady.then((prelude) => ({ prelude })), done]);

    // A handler that streams without awaiting anything can finish before the race above looks at
    // the prelude, so `first` may be its (empty) return value. Whether headers were written is
    // what decides the path, not which promise happened to win.
    const prelude = written ?? ("prelude" in first ? first.prelude : undefined);

    let status: number;
    let headers: Record<string, string | string[]>;
    let source: Readable;

    if (prelude) {
      status = prelude.statusCode;
      headers = prelude.headers;
      for (const c of prelude.cookies ?? []) {
        headers["set-cookie"] = [...([] as string[]).concat(headers["set-cookie"] ?? []), c];
      }
      source = pass;
      done.catch((e: unknown) => pass.destroy(e as Error));
    } else {
      const { result } = first as { result: InternalResult };
      status = result.statusCode;
      headers = result.headers;
      pass.end();
      source = Readable.fromWeb(result.body as never);
    }

    const out = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      if (Array.isArray(v)) for (const x of v) out.append(k, x);
      else if (v !== undefined) out.set(k, v);
    }

    async function* body() {
      for await (const chunk of source) yield chunk as Uint8Array;
      await done.catch(() => undefined);
      if (waitUntilMode() === "detach") {
        // Close the response now; deferred work keeps running in this process. Whether the platform
        // lets it finish after the response ended is what the Azure measurement has to show.
        void Promise.allSettled(pending);
        return;
      }
      await Promise.allSettled(pending);
    }

    return {
      status,
      headers: out,
      body: Readable.toWeb(Readable.from(body())) as never,
    };
  };
};

export default {
  name: "azure-functions",
  wrapper,
  supportStreaming: true,
} satisfies Wrapper;
