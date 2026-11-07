import { timingSafeEqual } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { InternalResult, StreamCreator } from "@opennextjs/aws/types/open-next";
import type { Wrapper, WrapperHandler } from "@opennextjs/aws/types/overrides";
import { takeCookies } from "./cookies.js";
import { type RequestContext, requestContext } from "./request-context.js";

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

/** Statuses that never carry a body (RFC 9110). */
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Whether the response must be sent without a body: HEAD requests and statuses that never have one.
 * The body is still read to its end, so deferred work held by `waitUntil` is not cut short.
 */
export function isBodyless(method: string, status: number): boolean {
  return method.toUpperCase() === "HEAD" || NO_BODY_STATUSES.has(status);
}

/** The text of a 500 response: generic, unless NODE_ENV is "development". */
export function errorBody(error: unknown, env: string | undefined = process.env.NODE_ENV): string {
  if (env === "development")
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  return "Internal Server Error";
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
    const context: RequestContext = { sourceImageMissing: false };
    const done = requestContext
      .run(context, () => handler(event, { streamCreator, waitUntil }))
      .then((result: InternalResult) => ({ result }));
    let first: Awaited<typeof done> | { prelude: Prelude };
    try {
      first = await Promise.race([preludeReady.then((prelude) => ({ prelude })), done]);
    } catch (error) {
      // Nothing was sent yet. The detail goes to the log; the client only gets it in development.
      console.error("Request handler failed", error);
      return {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: errorBody(error),
      };
    }

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

    // The image adapter answers 500 for any loader error; a missing source image is a 404.
    if (status === 500 && context.sourceImageMissing) status = 404;

    const bodyless = isBodyless(req.method, status);
    const cookies = takeCookies(headers);
    const out = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      if (Array.isArray(v)) for (const x of v) out.append(k, x);
      else if (v !== undefined) out.set(k, v);
    }

    async function* body() {
      for await (const chunk of source) if (!bodyless) yield chunk as Uint8Array;
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
      cookies,
      body: Readable.toWeb(Readable.from(body())) as never,
    };
  };
};

export default {
  name: "azure-functions",
  wrapper,
  supportStreaming: true,
} satisfies Wrapper;
