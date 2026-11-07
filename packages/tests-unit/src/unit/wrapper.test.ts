import { HttpRequest } from "@azure/functions";
import { afterEach, describe, expect, it, vi } from "vitest";
import converter from "../../../open-next-azure/src/overrides/converter.js";
import { markSourceImageMissing } from "../../../open-next-azure/src/overrides/request-context.js";
import azure, {
  errorBody,
  isBodyless,
  isFrontDoorRequestAllowed,
  waitUntilMode,
} from "../../../open-next-azure/src/overrides/wrapper.js";
import { asStreamCreator, deferred, readAll, sleep, webStream } from "../helpers.js";

afterEach(() => vi.unstubAllEnvs());

const request = (headers: Record<string, string> = {}) =>
  new HttpRequest({ method: "GET", url: "https://f.net/p", headers, query: {}, params: {} });

const build = (handler: (event: never, options: never) => Promise<unknown>) =>
  azure.wrapper(handler as never, converter as never);

const coreResult = (over: Record<string, unknown> = {}) => ({
  type: "core",
  statusCode: 200,
  headers: {},
  body: webStream(""),
  isBase64Encoded: false,
  ...over,
});

describe("isFrontDoorRequestAllowed", () => {
  it("allows everything when no Front Door id is configured", () => {
    expect(isFrontDoorRequestAllowed(undefined, undefined)).toBe(true);
    expect(isFrontDoorRequestAllowed("", "anything")).toBe(true);
  });
  it.each([
    ["abc", "abc", true],
    ["abc", "ABC", true],
    ["abc", " abc ", true],
    ["abc", "abd", false],
    ["abc", "abcd", false],
    ["abc", "", false],
    ["abc", undefined, false],
    ["abc", null, false],
  ])("expected %j, received %j -> %s", (expected, received, ok) => {
    expect(isFrontDoorRequestAllowed(expected, received)).toBe(ok);
  });
});

describe("wrapper metadata", () => {
  it("declares streaming support", () => {
    expect(azure.supportStreaming).toBe(true);
    expect(azure.name).toBe("azure-functions");
  });
});

describe("streaming responses", () => {
  it("returns status and headers as soon as the handler writes them, then streams the body", async () => {
    const release = deferred();
    const fn = await build(async (_e, { streamCreator }: never) => {
      const out = asStreamCreator(streamCreator).writeHeaders({
        statusCode: 201,
        headers: { "x-test": "1", "content-type": "text/html" },
        cookies: [],
      });
      out.write("early ");
      await release.promise;
      out.end("late");
      return coreResult();
    });

    const res = await fn(request());
    expect(res.status).toBe(201);
    expect(res.headers).toBeInstanceOf(Headers);
    expect((res.headers as Headers).get("x-test")).toBe("1");

    // The response object exists before the body is complete.
    const reading = readAll(res.body as never);
    await sleep(20);
    release.resolve();
    expect(await reading).toBe("early late");
  });

  it("keeps each Set-Cookie as its own header and merges prelude cookies (B5)", async () => {
    const fn = await build(async (_e, { streamCreator }: never) => {
      const out = asStreamCreator(streamCreator).writeHeaders({
        statusCode: 200,
        headers: { "set-cookie": ["a=1; Path=/"] },
        cookies: ["b=2; Path=/; Secure"],
      });
      out.end("x");
      return coreResult();
    });
    const res = await fn(request());
    expect((res.headers as Headers).getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/; Secure"]);
    await readAll(res.body as never);
  });

  it("errors the body stream if the handler fails after the headers were sent", async () => {
    const fn = await build(async (_e, { streamCreator }: never) => {
      const out = asStreamCreator(streamCreator).writeHeaders({
        statusCode: 200,
        headers: {},
        cookies: [],
      });
      out.write("partial");
      await sleep(10);
      throw new Error("render failed");
    });
    const res = await fn(request());
    await expect(readAll(res.body as never)).rejects.toThrow();
  });
});

describe("plain results (routing, redirects, middleware)", () => {
  it("returns the handler's result when it never opens a stream", async () => {
    const fn = await build(async () =>
      coreResult({
        statusCode: 302,
        headers: { location: "/next", "set-cookie": ["a=1", "b=2"] },
        body: webStream("redirecting"),
      }),
    );
    const res = await fn(request());
    expect(res.status).toBe(302);
    expect((res.headers as Headers).get("location")).toBe("/next");
    expect((res.headers as Headers).getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(await readAll(res.body as never)).toBe("redirecting");
  });
});

describe("waitUntil (ADR-0006: the stream is held open until deferred work settles)", () => {
  it("does not complete the response body before deferred work is done", async () => {
    const work = deferred();
    const fn = await build(async (_e, { streamCreator, waitUntil }: never) => {
      (waitUntil as (p: Promise<void>) => void)(work.promise);
      const out = asStreamCreator(streamCreator).writeHeaders({
        statusCode: 200,
        headers: {},
        cookies: [],
      });
      out.end("body");
      return coreResult();
    });

    const res = await fn(request());
    let finished = false;
    const reading = readAll(res.body as never).then((t) => {
      finished = true;
      return t;
    });
    await sleep(40);
    expect(finished).toBe(false); // body bytes are sent, but the stream stays open
    work.resolve();
    expect(await reading).toBe("body");
  });

  it("still completes when deferred work fails", async () => {
    const fn = await build(async (_e, { streamCreator, waitUntil }: never) => {
      (waitUntil as (p: Promise<void>) => void)(Promise.reject(new Error("background failure")));
      const out = asStreamCreator(streamCreator).writeHeaders({
        statusCode: 200,
        headers: {},
        cookies: [],
      });
      out.end("ok");
      return coreResult();
    });
    const res = await fn(request());
    expect(await readAll(res.body as never)).toBe("ok");
  });
});

describe("Front Door id check", () => {
  it("answers 403 before running anything when the id is missing or wrong", async () => {
    vi.stubEnv("FRONT_DOOR_ID", "fd-123");
    const handler = vi.fn();
    const fn = await build(handler);

    for (const headers of [{}, { "x-azure-fdid": "other" }] as Record<string, string>[]) {
      const res = await fn(request(headers));
      expect(res.status).toBe(403);
      expect(res.body).toBe("Forbidden");
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets the right id through (any letter case)", async () => {
    vi.stubEnv("FRONT_DOOR_ID", "fd-123");
    const handler = vi.fn(async () => coreResult({ body: webStream("ok") }));
    const fn = await build(handler);
    const res = await fn(request({ "x-azure-fdid": "FD-123" }));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(await readAll(res.body as never)).toBe("ok");
  });

  it("does not check anything without FRONT_DOOR_ID", async () => {
    const handler = vi.fn(async () => coreResult());
    const fn = await build(handler);
    expect((await fn(request())).status).toBe(200);
  });
});

describe("waitUntil mode (WAIT_UNTIL_MODE)", () => {
  it("is hold unless explicitly set to detach", () => {
    expect(waitUntilMode(undefined)).toBe("hold");
    expect(waitUntilMode("")).toBe("hold");
    expect(waitUntilMode("hold")).toBe("hold");
    expect(waitUntilMode("nonsense")).toBe("hold");
    expect(waitUntilMode("detach")).toBe("detach");
  });

  it("detach: closes the response without waiting, and the work still runs to completion", async () => {
    vi.stubEnv("WAIT_UNTIL_MODE", "detach");
    const work = deferred();
    let finished = false;
    const fn = await build(async (_e, { streamCreator, waitUntil }: never) => {
      (waitUntil as (p: Promise<void>) => void)(
        work.promise.then(() => {
          finished = true;
        }),
      );
      const out = asStreamCreator(streamCreator).writeHeaders({
        statusCode: 200,
        headers: {},
        cookies: [],
      });
      out.end("body");
      return coreResult();
    });

    const res = await fn(request());
    expect(await readAll(res.body as never)).toBe("body"); // completes while the work is pending
    expect(finished).toBe(false);
    work.resolve();
    await sleep(10);
    expect(finished).toBe(true); // the deferred work was not cancelled
  });
});

describe("missing source image (the image adapter answers 500 for any loader error)", () => {
  it("turns that 500 into a 404", async () => {
    const fn = await build(async () => {
      markSourceImageMissing();
      return coreResult({ statusCode: 500, body: webStream("Internal server error") });
    });
    const res = await fn(request());
    expect(res.status).toBe(404);
  });

  it("leaves a 500 alone when no image was missing, and does not leak between requests", async () => {
    let missing = true;
    const fn = await build(async () => {
      if (missing) markSourceImageMissing();
      return coreResult({ statusCode: 500, body: webStream("boom") });
    });
    expect((await fn(request())).status).toBe(404);
    missing = false;
    expect((await fn(request())).status).toBe(500);
  });

  it("does not touch other statuses", async () => {
    const fn = await build(async () => {
      markSourceImageMissing();
      return coreResult({ statusCode: 200 });
    });
    expect((await fn(request())).status).toBe(200);
  });
});

describe("responses without a body", () => {
  const head = () =>
    new HttpRequest({ method: "HEAD", url: "https://f.net/p", headers: {}, query: {}, params: {} });

  it("knows which responses never have a body", () => {
    for (const status of [101, 204, 205, 304]) expect(isBodyless("GET", status)).toBe(true);
    expect(isBodyless("HEAD", 200)).toBe(true);
    expect(isBodyless("head", 200)).toBe(true);
    expect(isBodyless("GET", 200)).toBe(false);
    expect(isBodyless("POST", 404)).toBe(false);
  });

  it("sends no body for HEAD, but keeps the headers", async () => {
    const fn = await build(async () =>
      coreResult({ headers: { "x-nextjs-cache": "HIT" }, body: webStream("page") }),
    );
    const res = await fn(head());
    expect(res.status).toBe(200);
    expect((res.headers as Headers).get("x-nextjs-cache")).toBe("HIT");
    expect(await readAll(res.body as never)).toBe("");
  });

  it("sends no body for a 304", async () => {
    const fn = await build(async () => coreResult({ statusCode: 304, body: webStream("x") }));
    expect(await readAll((await fn(request())).body as never)).toBe("");
  });

  it("still holds a bodyless response open until deferred work settles (HEAD revalidation)", async () => {
    const gate = deferred<void>();
    let ended = false;
    const fn = await build(async (_event, options) => {
      (options as never as { waitUntil: (p: Promise<void>) => void }).waitUntil(gate.promise);
      return coreResult();
    });
    const res = await fn(head());
    const reading = readAll(res.body as never).then(() => {
      ended = true;
    });
    await sleep(20);
    expect(ended).toBe(false);
    gate.resolve();
    await reading;
    expect(ended).toBe(true);
  });

  it("keeps a Content-Length that the handler declared (static assets stream with an exact one)", async () => {
    const fn = await build(async (_e, { streamCreator }: never) => {
      const out = asStreamCreator(streamCreator).writeHeaders({
        statusCode: 200,
        headers: { "content-length": "5" },
        cookies: [],
      });
      out.end("hello");
      return coreResult();
    });
    expect(((await fn(request())).headers as Headers).get("content-length")).toBe("5");
  });
});

describe("a handler that fails before sending anything", () => {
  it("answers 500 with a generic body and logs the detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fn = await build(async () => {
      throw new Error("secret connection string in message");
    });
    const res = await fn(request());
    expect(res.status).toBe(500);
    expect(res.body).toBe("Internal Server Error");
    expect(String(res.body)).not.toContain("secret");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("shows the detail only in development", () => {
    expect(errorBody(new Error("boom"), "production")).toBe("Internal Server Error");
    expect(errorBody(new Error("boom"), undefined)).toBe("Internal Server Error");
    expect(errorBody(new Error("boom"), "development")).toContain("boom");
  });
});
