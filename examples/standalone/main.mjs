// Azure Functions entry (spike, ADR-0016): starts the Next.js standalone server in this worker and
// forwards every request to it over loopback, streaming the response back.
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app } from "@azure/functions";
import { takeCookies } from "./cookies.mjs";

app.setup({ enableHttpStream: true });

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(root, "standalone", "__APP_SUB__");
const PORT = Number(process.env.NEXT_INTERNAL_PORT ?? 3000);
const BODYLESS = new Set(["GET", "HEAD"]);

function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error("The Next.js server did not start"));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

/**
 * `after()` and other deferred work. Next.js asks the platform for `waitUntil` through this global
 * (documented in its source as the "builtin request context"). The work is tracked here, and a
 * response is held open until the work that was registered before it ended has settled, so that the
 * instance is not stopped in the middle of it (the same choice as WAIT_UNTIL_MODE=hold of the
 * OpenNext wrapper, ADR-0006). The work cannot be tied to one request: the call comes from inside
 * the Next.js server, which the request reached over loopback.
 */
const pending = new Set();
globalThis[Symbol.for("@next/request-context")] = {
  get: () => ({
    waitUntil: (promise) => {
      const tracked = Promise.resolve(promise)
        .catch((error) => console.error("waitUntil work failed:", error))
        .finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
  }),
};
const HOLD = (process.env.WAIT_UNTIL_MODE ?? "hold") !== "detach";
const HOLD_MAX_MS = Number(process.env.WAIT_UNTIL_MAX_SECONDS ?? 220) * 1000;

/** Settles when the work registered so far is done, or after the longest hold allowed. */
function settled() {
  if (!HOLD || pending.size === 0) return Promise.resolve();
  const work = Promise.allSettled([...pending]);
  const limit = new Promise((resolve) => setTimeout(resolve, HOLD_MAX_MS).unref());
  return Promise.race([work, limit]);
}

/** The body of a response, closed only after the deferred work has settled. */
function holdOpen(source) {
  if (!HOLD) return source;
  const reader = source?.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = reader ? await reader.read() : { done: true };
      if (!done) {
        controller.enqueue(value);
        return;
      }
      await settled();
      controller.close();
    },
    cancel: (reason) => reader?.cancel(reason),
  });
}

let started;
function start() {
  started ??= (async () => {
    process.env.PORT = String(PORT);
    process.env.HOSTNAME = "127.0.0.1";
    process.chdir(dir);
    await import(pathToFileURL(path.join(dir, "server.js")).href);
    await waitForPort(PORT);
  })();
  return started;
}

/**
 * Forwards one request to the Next.js server with node:http: no body decoding, several Set-Cookie
 * values arrive as a list, and the response stream is passed on as it is. Node's fetch is not used:
 * asked for the same file with the current ETag in If-None-Match, fetch got 200 where http gets 304
 * (measured against this server, Node 26).
 */
function forward(request, url, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    for (const [name, value] of request.headers) headers[name] = value;
    delete headers["accept-encoding"];
    // The public host: Next.js builds absolute URLs (middleware rewrites and redirects) from it.
    headers["x-forwarded-host"] ??= url.host;
    headers.host = headers["x-forwarded-host"];
    // Not forwarded: with "https" Next.js stops treating its own loopback address as the same
    // origin, and a middleware rewrite fails with 500 ("Failed to proxy https://localhost:3000").
    // The public scheme is put back into Location below.
    delete headers["x-forwarded-proto"];
    if (body) headers["content-length"] = String(body.length);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: url.pathname + url.search,
        method: request.method,
        headers,
      },
      resolve,
    );
    req.on("error", reject);
    req.end(body);
  });
}

app.http("server", {
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async (request) => {
    await start();
    const url = new URL(request.url);
    let body;
    if (!BODYLESS.has(request.method.toUpperCase())) {
      // Buffered: forwarding the host's request stream hung on POST (Server Actions).
      const buffer = Buffer.from(await request.arrayBuffer());
      if (buffer.length > 0) body = buffer;
    }
    const res = await forward(request, url, body);
    // Several Set-Cookie values are a list in res.headers; takeCookies turns them into cookies.
    const record = { ...res.headers };
    // Next.js knows only its loopback origin; absolute URLs it builds (middleware redirects) get the
    // public one. Bodies are not touched: code that writes request.url into a page is not covered.
    const publicOrigin = `${request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${url.host}`;
    if (typeof record.location === "string") {
      record.location = record.location.replace(
        new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${PORT}`),
        publicOrigin,
      );
    }
    const cookies = takeCookies(record);
    const out = new Headers();
    for (const [name, value] of Object.entries(record)) {
      for (const v of [].concat(value)) out.append(name, String(v));
    }
    const noBody =
      request.method.toUpperCase() === "HEAD" || [204, 205, 304].includes(res.statusCode);
    if (noBody) res.resume();
    return {
      status: res.statusCode,
      headers: out,
      cookies,
      body: holdOpen(noBody ? null : Readable.toWeb(res)),
    };
  },
});
