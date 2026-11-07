# Wrapper

The wrapper is the server entrypoint. This one is `azure-functions`: it returns a function that you register with `app.http`, receives an Azure Functions v4 `HttpRequest` and answers with an `HttpResponseInit` whose body is a stream. It supports streaming and `waitUntil`.

Things to note:

- The generated `main.mjs` registers one function per bundle (`server` on `{*path}`, `image` on `_next/image`, and the queue trigger):

  ```js
  app.setup({ enableHttpStream: true });
  const server = await load("server"); // chdir into the bundle, then import it
  app.http("server", { methods, authLevel: "anonymous", route: "{*path}", handler: server });
  ```

- `host.json` sets `routePrefix` to an empty string so Next.js routes are served from `/` instead of `/api`.
- When `FRONT_DOOR_ID` is set, the wrapper answers 403 before doing anything else if `X-Azure-FDID` is missing or different (case-insensitive).
- Several `Set-Cookie` headers are passed as structured `cookies` of the response, because the Functions host keeps only one value per header name.
- `HEAD` requests and the status codes 101, 204, 205 and 304 are answered without a body. A `Content-Length` declared by the handler is kept.
- A handler that fails before it sent anything gets a generic `500` (details only when `NODE_ENV=development`). One that fails after the headers were sent errors the body stream.
- A missing source image makes the image adapter answer `500`; the wrapper turns it into `404`.

## `waitUntil`

OpenNext uses `waitUntil` for deferred work such as `after()` and the queue send. `WAIT_UNTIL_MODE` decides what the wrapper does with it:

| Mode | Behavior |
| --- | --- |
| `hold` (default) | The response stays open until the deferred work has settled, so the client waits for it (measured +2 s for 2 s of work, on Azure too) |
| `detach` | The response ends at once and the work runs on; safe for short work only, because an idle instance is removed after about 1.5 to 3.5 minutes |

See [ADR-0006](../../plan/decisions.md#adr-0006-waituntil-via-response-stream) for the measurements.
