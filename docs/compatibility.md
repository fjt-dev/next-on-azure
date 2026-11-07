# Compatibility

Every row is marked with how far it has been verified:

- **Verified (local)**: run locally, including against Azurite, with the result recorded in the [work log](./plan/worklog.md). Since 2026-11-06 this includes running under the real Azure Functions host (Core Tools 4.16.0) over HTTPS, written **(local, Functions host)**.
- **Verified (Azure)**: run on a real Azure deployment.
- **Unverified**: implemented or expected to work, but never run.

Since 2026-11-06 most **Verified (local, Functions host)** rows are also covered by automated tests (`pnpm test`, `pnpm test:integration`, `pnpm e2e:test`, see [Testing](./contribute/testing.md)): pages, ISR through the queue, `revalidateTag`, streaming, static files, image optimization, `after()` and the Front Door id check. The rest of the local rows were checked by hand only.

As of 2026-11-06 the rows below marked **Verified (Azure)** were checked by hand on one real deployment (Function app on Flex Consumption, japaneast, Node 22, no Front Door; work log, session 7). They are not covered by automated Azure tests yet. That is the goal of [roadmap Phase 1](./plan/roadmap.md).

## Next.js

| Version | Status |
| --- | --- |
| 15.5.29 | Verified (local, Functions host), App Router only |
| 15.x other | Unverified |
| 16.4.5+ | Unverified (accepted by the `@opennextjs/aws` peer range) |
| Older than 15.5.29 | Not supported by `@opennextjs/aws` 4.1.15 |

## Features

| Feature | Status |
| --- | --- |
| App Router, dynamic rendering (SSR) | Verified (local, Functions host); **Verified (Azure)** |
| Static pages and ISR (`revalidate`) | Verified (local, Functions host), including queue-triggered regeneration (the consumer ran and succeeded, page timestamp advanced). **Verified (Azure)**: cached page `HIT`, a stale page was regenerated through the queue consumer. 30 simultaneous requests for a stale page cause **one** regeneration (message deduplication, [ADR-0010](./plan/decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group)). The wait for the consumer is 44 s on average with the default polling and 2 s with `revalidationPollingSeconds=5` (3 trials each). Not proven on either: that regeneration is done by the queue consumer and not in-process (needs the consumer execution in the logs) |
| Response streaming | Verified (local, Functions host): first bytes at 0.15 s, slow Suspense part at 3.0 s, separate chunks. **Verified (Azure)**, directly on the Function app: headers and early content at 37 ms, late content at 3032 ms, 4 chunks. Through Front Door Unverified |
| `revalidateTag` | Verified (local, Functions host): cached value stable, new value after `revalidateTag` (Blob + Table). **Verified (Azure)** |
| `revalidatePath` | Verified (local): called from a Server Action, a prerendered page renders anew once. Azure: Verified (Azure): E2E run on commit 6720a19, 2026-11-07, 35 passed and 2 skipped (log-based tests) |
| Image optimization (`next/image`) | Verified (local, Functions host, sharp for the host OS): resize, WebP negotiation, 400 for disallowed width and remote URL. **Verified (Azure)** with the Linux x64 `sharp` binaries: 64 px WebP (250 bytes), resized PNG, 400 for a disallowed width and a remote URL. Missing source image returns 404 (Verified (local); Azure: Verified (Azure): E2E run on commit 6720a19, 2026-11-07, 35 passed and 2 skipped (log-based tests)) |
| Static files (`/_next/static`, `public/`) | Verified (local, Functions host): served from Blob through the asset resolver with correct types and cache headers; `HEAD`, `If-None-Match` (304), byte ranges (206, 416) and unlisted paths (404) behave as designed. **Verified (Azure)**: same results, including exact bytes for ranges. Cost of serving them through the function is unmeasured |
| Middleware | **Verified (local)**: redirect, rewrite and response header, with a matcher, in the single Function app (internal middleware, not `external`). Azure: Verified (Azure): E2E run on commit 6720a19, 2026-11-07, 35 passed and 2 skipped (log-based tests). Not verified: external (edge) middleware, `matcher` with i18n and `NextResponse.next({ request })` header forwarding are not tested |
| Pages Router | **Verified (local)**: `getServerSideProps`, `getStaticProps` and an API route, next to the App Router. Azure: Verified (Azure): E2E run on commit 6720a19, 2026-11-07, 35 passed and 2 skipped (log-based tests). Not verified: ISR with `revalidate` in `getStaticProps`, `fallback` paths and `app-pages-router` are not tested |
| Server Actions | Verified (local): form post without JavaScript. Azure: Verified (Azure): E2E run on commit 6720a19, 2026-11-07, 35 passed and 2 skipped (log-based tests). Not verified: client-side calls, encryption key (B12) |
| Partial Prerendering | Unverified |
| Edge runtime | Not supported |

## Known gaps

Cases verified by hand on Azure (2026-11-06) in addition: B1 (the queue consumer runs and is followed by a `HEAD` request to the page; 34 invocations, none failed), B6 (chunks arrive separately; `Content-Length` handling still open), B7 (`after()` work completes after the response, see ADR-0006), B10 (asset resolver), B11 (resize and rejections). Cases verified by hand locally so far: B2 (partly), B14 (HTTPS stack), image resize. Behavioral cases B1 to B14 in [testing](./contribute/testing.md#required-behavioral-test-cases) are not covered yet. Known gaps in the current code: `waitUntil` delays the client (see above), a missing source image returns 500, `Content-Length` is not removed from streamed responses, error details are not hidden outside development, bodyless status codes are not handled explicitly, cookies are not sanitized, and there is no optimized-image cache.

## Platform

| Item | Status |
| --- | --- |
| Azure Functions Flex Consumption, Node 22 | **Verified (Azure)**: the template deploys (after two fixes), the app starts, serves HTTP and runs the queue trigger. Node 24 Unverified |
| Storage Queue message deduplication | Not available; duplicates are possible but harmless |
| `waitUntil` / `after()` | Default (`hold`): deferred work completes, but the client waits for it, +2 s for 2 s of work, **on Azure too** (2039 ms measured). Optional `WAIT_UNTIL_MODE=detach` answers at once; what the platform does with the work afterwards: see [ADR-0006](./plan/decisions.md#adr-0006-waituntil-via-response-stream) |
| Custom domains | Not yet in the Bicep template |
| Deployment layout | One Function app, Front Door optional ([ADR-0009](./plan/decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default)). **Verified (Azure)** without Front Door; the Front Door variant has never been deployed |
| pnpm `node_modules` | Azure drops symbolic links in the package; `package` flattens the pnpm layout into a plain tree and refuses to produce a package that still contains links. Verified (Azure) for the example (pnpm, 17 packages). npm and Yarn layouts: Unverified |
| Front Door id check (`X-Azure-FDID` vs `FRONT_DOOR_ID`) | Verified (local, Functions host): 403 without or with a wrong id on server, static and image routes; case-insensitive match. The `AzureFrontDoor.Backend` access restriction on Flex Consumption is Unverified |
