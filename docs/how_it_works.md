# How it works

## The request path

```
client ──▶ Functions front end ──▶ Function `server` ({*path}) ──loopback──▶ Next.js server (same worker)
                                                                                  │
                                                         cache handlers ──▶ Blob (entries) + Table (tags)
```

- The Function app has **one function**, `server`, on `{*path}` with streaming enabled (`main.mjs`, from `src/runtime/entry.mjs`). The first request starts the Next.js standalone server (`server.js`) inside the same worker, on `127.0.0.1:3000`, and waits until the port is open. Measured start of that server inside a request: part of the 2.4 s cold start.
- Every request is forwarded to that server with `node:http`. The response is passed on as a stream. `Set-Cookie` values are converted to the structured `cookies` of the Functions response, because the host keeps only one value per header name.
- `x-forwarded-proto` is not forwarded: with `https`, Next.js stops treating its own loopback address as the same origin and a middleware rewrite fails with a 500. The public scheme is put back into the `Location` header of redirects.
- Request bodies are buffered before they are forwarded (forwarding the host's request stream hung on POST).
- Routing, rendering, middleware, Server Actions, streaming and image optimization are done by Next.js itself. This package does not reimplement any of them.

## Caches

Next.js asks two interfaces for storage; both are implemented on Storage and loaded by path from `next.config` (`withAzure()` sets them):

| Interface | Used for | Storage |
| --- | --- | --- |
| `cacheHandler` (`cache-handler.cjs`) | pages, route handlers, `fetch` results, `revalidateTag`, `revalidatePath` | entries as JSON blobs `<build id>/<sha256 of the key>.json` in the `cache` container; Buffers and Maps are serialized; tags in the table |
| `cacheHandlers` (`cache-handlers.cjs`) | `'use cache'` | streamed entries stored as one JSON document (value in base64) under `use-cache/<build id>/...` |
| tags (both) | revalidation state | table `tagcache`: partition = build id, row key = base64url of the tag, `revalidatedAt` in epoch ms |

An entry is dropped when any of its tags (and the soft tags of the request) was revalidated after it was written. A page's tags come from the `x-next-cache-tags` header, a `fetch` entry's from its context. Nothing is deleted on revalidation, so it is one small write per tag.

The key prefix is the build id: a new deployment starts with an empty cache, and the old entries are never read. They are not cleaned up.

**Time-based ISR** is Next.js's own: a request that finds an entry older than `revalidate` gets the stale page at once (`x-nextjs-cache: STALE`) and the server regenerates the page in the background, in the same process. There is no queue. If the instance is removed in the meantime, the regeneration is lost and the next request starts it again.

**Priming.** With a custom cache handler Next.js does not read the pages that `next build` prerendered; each would be rendered on its first request. `next-on-azure prime` (run by `deploy`) requests every route of `.next/prerender-manifest.json` once, after which they are `HIT`.

## `after()` and other deferred work

Next.js asks the platform for `waitUntil` through `globalThis[Symbol.for("@next/request-context")]`; the entry provides it and tracks the work. A response is held open until the work registered before the response ended has settled (at most `WAIT_UNTIL_MAX_SECONDS`). The reason: an idle instance disappears after roughly 1.5 to 3.5 minutes and deferred work that outlives it is lost ([Azure notes](./inner_workings/azure_notes.md), item 18). The work cannot be tied to one request, because it is registered inside the Next.js server, which the request reached over loopback.

## Packaging

`next-on-azure package` makes a Function app from `.next/standalone`:

1. checks the Next.js version and the Server Actions key;
2. copies the standalone directory and turns the pnpm `node_modules` into a plain tree without symbolic links ([Azure notes](./inner_workings/azure_notes.md), item 13);
3. copies `.next/static` and `public/` next to `server.js`, and the complete `sharp` package (file tracing leaves out `dist/index.cjs` on Next.js 16, and the optimizer then silently returns the original image), with the Linux x64 binaries for Azure;
4. writes `main.mjs`, `cookies.mjs`, `front-door.mjs`, `host.json` (HTTP routes at `/`, no extension bundle) and a `package.json` with `@azure/functions`, installs it, and zips the result.

The cache handler files are required without the `node:` prefix on purpose: Next.js 16 bundles them into the proxy bundle with Turbopack, which cannot load `node:` externals from CommonJS.
