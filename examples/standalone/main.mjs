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
    headers["x-forwarded-host"] ??= url.host;
    headers["x-forwarded-proto"] ??= url.protocol.replace(":", "");
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
      body: noBody ? null : Readable.toWeb(res),
    };
  },
});
