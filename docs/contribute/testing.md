# Testing strategy

Three layers exist (Phase 2 of the [roadmap](../plan/roadmap.md)); Azure E2E and CI do not yet.

| Layer | Package / command | Runs against | Needs |
| --- | --- | --- | --- |
| Unit | `packages/tests-unit`, `pnpm test` | In-memory fakes of the Azure SDK parts the overrides use | `pnpm build` (Turborepo does it) |
| Integration | `packages/tests-unit`, `pnpm test:integration` | Real Azure SDKs against Azurite on ports 10100 to 10102 | nothing else (Azurite is a dev dependency, started and stopped by the test run) |
| Local E2E | `packages/tests-e2e`, `pnpm e2e:test` | The real Functions host (Core Tools) with Azurite over HTTPS, started by the test run through `scripts/local-stack.mjs` | `openssl`; the example is built and packaged by Turborepo |
| Azure E2E | not written | A real deployment | Phase 1c |
| CI | not written | | |

## Running

```bash
pnpm test               # unit tests
pnpm test:integration   # Azurite integration tests
pnpm e2e:test           # builds + packages the example, then runs both E2E projects
```

`pnpm e2e:test` runs two Vitest projects one after the other, because both need the fixed local ports: `default` (the stack as `deploy` would configure it) and `front-door` (the same stack started with `FRONT_DOOR_ID`).

## How the layers are built

- **Unit tests** import the TypeScript sources of `packages/open-next-azure` directly and replace `clients.ts` with in-memory fakes (`src/fakes.ts`: blob service, table, queue). They cover the converter, the wrapper (streaming, plain results, Set-Cookie, `waitUntil`, errors, Front Door id), the asset resolver (200, 304, HEAD, 206, 416, ignored ranges, unlisted paths), the tag cache (key encoding, time comparisons, expiry, stale, request memoization, disabled flag), the incremental cache (blob names, prefix, 404), the queue (plain JSON, `waitUntil`, never throws), the revalidation converter and wrapper (failures must throw so the host retries), the image loader, the manifest builder, and the packaging helpers (entry point order, `host.json`, the sharp guard).
- **Integration tests** use the real clients (`clients.ts` and the dynamically imported SDKs) against Azurite: Blob round trips and real 404s, tag keys with every character Table Storage forbids, the queue message format, and the asset resolver with real byte ranges.
- **E2E tests** talk HTTPS to the running stack and trust exactly the certificate created for that run, so TLS is verified, not disabled. They read response chunk timings to prove streaming and the Function host log to prove the queue consumer ran.

## What E2E checks, and what it does not

Checked: SSR, cached/ISR pages, 404, HEAD, static files (all response forms), streaming with chunk timing, image optimization (resize, WebP, rejections), queue-driven ISR regeneration, `revalidateTag`, `after()` behaviour, the Front Door id check on server, static, image and POST routes.

Not checked yet: `revalidatePath`, middleware, Server Actions, Pages Router, i18n and base path, Partial Prerendering, and anything that needs real Azure (cold start, scale-out, RBAC, Flex Consumption settings). Tests that pin down behavior that is known to be wrong or expected to change are marked: `it.fails` for the missing-image status code, and a comment in `after.test.ts` for the ADR-0006 latency.

## Required behavioral test cases

Each case names the symptom so a test can be written for it. They come from an external review (2026-11-06) of an earlier Azure adapter and are **not yet implemented or verified here**. Cases marked (*) are known gaps in the current code.

| # | Area | Symptom to test for |
| --- | --- | --- |
| B1 | ISR queue | Change a page, wait, request it. Regeneration must be executed by the queue consumer (assert on the consumer's log), not by an in-process fallback. Watch for a consumer named from a release id while the server enqueues using the Next.js build id. |
| B2 | ISR request | Regeneration is a `HEAD` request with the preview-mode header and the ISR marker; redirects are not followed. Success means 200/307/308/404 **and** the response header saying the page was revalidated. Anything else must fail so the queue retries. |
| B3 | Poison queue | A malformed message is retried up to the dequeue count and then lands in the poison queue, never acknowledged as success. On real Azure the retry cycle takes minutes; use a large timeout. |
| B4 | Table keys | Keys cannot contain `/ \ # ?` or control characters. "List by tag" and "list by path" need two rows per pair (a row-key-only filter scans every partition). Keys written by older versions must stay readable. |
| B5 | Cookies | Cookies reach Functions as structured values, never one comma-joined header. Drop invalid `SameSite`, invalid dates and non-numeric max-age (the platform throws and fails the whole response). Done in the wrapper (`cookies.ts`): `Set-Cookie` lines become structured cookies, invalid attributes are dropped, and `Partitioned`/`Priority` cannot be passed. The old code kept only the last cookie (found 2026-11-07: with two `Set-Cookie` headers only one reached the client). Verified (local): unit and E2E. Not on Azure. |
| B6 | Streaming | Remove `Content-Length` from streamed responses; keep redirect bodies and headers until the handler finishes; compare time to first byte with total time on a deliberately slow page. (*) `Content-Length` is not removed. |
| B7 | `waitUntil` | Deferred work completes after the response ends and the invocation is not frozen early. Prove it with a test that writes to storage after the response. |
| B8 | Errors | Show message and stack only when `NODE_ENV` is exactly `development`. (*) Not handled. |
| B9 | Bodyless responses | HEAD, 204, 205, 304 and 101 carry no body; HEAD never carries one even if the handler wrote it. (*) Not handled explicitly. |
| B10 | Static assets | Serve exact paths from a manifest of uploaded files, not by file-name patterns (metadata routes such as `robots`, `sitemap`, `opengraph-image` are rendered by the server). Test conditional GET and byte ranges. Static files are now served by the asset resolver from an exact-path manifest; metadata routes still need a test. |
| B11 | Images | Cache optimized images in a private container keyed by the full `Accept` header and query. Never cache non-200 responses, responses with cookies, or `no-store` / `private`. Drop upstream validators so a replaced source image is not shown stale. A build on macOS or Windows must refuse to produce a deployable artifact (needs Linux x64 glibc native binaries). (*) The cache is not implemented, and the official adapter has none either (ADR-0014). |
| B12 | Server Actions | Without a stable encryption key every build has its own action ids and open pages fail with 409 after a deployment. Warn and document how to set a key. |
| B13 | Locale and base path | Root request of an i18n site with a base path and no trailing slash; `+` in a dynamic path segment must not become a space; Pages Router `notFound` and API bodies. Needs a Pages Router fixture (none exists yet). |
| B14 | HTTPS only | Features that fetch `https://<host>` (for example `res.revalidate()` in Pages API routes) cannot run on plain HTTP. Provide an HTTPS local run with a self-signed certificate created for the run and deleted afterwards. |

### Checked by hand on Azure (2026-11-06, not automated)

The probes were throwaway scripts against one deployment (since deleted). They covered pages, cache `HIT`, static files (200, 304, `HEAD`, ranges, 416, unlisted paths), image optimization (WebP, resized PNG, rejections), streaming chunk timing, `revalidateTag`, `after()` timing in both `waitUntil` modes, queue-driven ISR, and a 200-request burst. Turning them into `tests-e2e` cases that accept a deployed URL is on the [roadmap](../plan/roadmap.md) (1d). What the Azure run could verify only through Application Insights (consumer executions, instances) needs the Application Insights query as part of such a test.

### Checked by hand locally so far (not automated)

Run on 2026-11-06 under Core Tools 4.16.0 with Azurite. Each needs an automated test in Phase 2.

- B1/B2 (partly): after a stale `/isr` request the consumer logged an execution that succeeded, and the next response had a newer timestamp. Not yet asserted: that the server did not regenerate in-process.
- B6 (partly): `/slow` delivered the early shell at 0.15 s and the Suspense part at 3.0 s in separate chunks. `Content-Length` handling still open.
- B7 (partly): `/api/after` deferred work completed, but the client waited for it (2.14 s total). Whether the invocation stays alive on Azure is unverified.
- B11 (partly): resize and WebP negotiation work with host-OS sharp. Cache rules for optimized images do not exist yet.
- B10 (partly): the asset resolver serves only manifest paths; 200, 304, HEAD, 206, 416, 404 for unlisted paths and for `/BUILD_ID` checked by hand. Not checked: metadata routes that Next.js renders (`robots`, `sitemap`, `opengraph-image`) against the manifest.
- Front Door id: 403 for missing, empty and wrong `X-Azure-FDID` on server, asset and image routes; 200 for the right id in any letter case.
- B14: the local stack runs over HTTPS; ISR regeneration through `https://localhost` works.

## Azure E2E in CI

- Authenticate with GitHub OIDC federation to a dedicated test subscription; no secrets stored.
- Deploy to a uniquely named resource group per run and delete it at the end, including on failure.
- Treat Front Door provisioning time as a fixed cost; keep the Azure E2E suite small and run the broad suite locally.

## Rules

- A feature is only marked **Verified** in [Compatibility](../compatibility.md) when a test covers it.
- Never mark a Phase 1 item done from local runs alone if it concerns the Functions runtime or Azure resources.
