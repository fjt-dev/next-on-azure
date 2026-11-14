# Compatibility

How far each row has been verified:

- **Verified (Azure)**: run against a real deployment of this package ([Flex Consumption](https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan?wt.mc_id=studentamb_679600), japaneast, Node 22). The record is the HTTP suite of `packages/tests-e2e` with `E2E_TARGET=standalone` (47 passed on 2026-11-08; five host-log cases that no longer exist were skipped then) and the measurements in ADR-0016; an earlier spike of the same design gave the same results.
- **Verified (local)**: run with [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite?wt.mc_id=studentamb_679600) and the Azure Functions host on a developer machine and in CI (`pnpm e2e:standalone`).
- **Unverified**: implemented or expected to work, but never run.

## Next.js

| Version | Status |
| --- | --- |
| 15.5.29 | Verified (Azure) and in CI |
| 16.4.5 | Verified (Azure, 2026-11-09: the HTTP suite, 48 cases, against a deployment with the example on `middleware.js`), and in CI |
| 15.5.30 and later 15.x | Expected to work (inside the supported range); only 15.5.29 was run |
| 16.0.0 to 16.4.4 | Not supported (`package` refuses; `--allow-unsupported-next` overrides) |
| Older than 15.5.29 | Not supported |

The range is the `next` peer range of the package, inherited from the first design and not re-derived.

## Features

| Feature | Status |
| --- | --- |
| App Router: dynamic rendering (SSR), route handlers, dynamic routes | Verified (Azure) |
| Pages Router: `getServerSideProps`, `getStaticProps`, API routes, `fallback: "blocking"` and `true`, `notFound`, `res.revalidate` | Verified (Azure) |
| Static pages and time-based ISR (`revalidate`) | Verified (Azure): stale page served at once, the next request gets the new one. Regeneration runs in the same process as the stale request (no queue). |
| `revalidateTag`, `revalidatePath` | Verified (Azure) |
| `'use cache'` with `cacheTag` and `revalidateTag` | Verified (Azure) on Next.js 15 with `experimental.useCache`. `cacheComponents` (16.4.5) with Partial Prerendering: **Verified (Azure)** with a small app (2026-11-10; the page is a partial prerender; the `'use cache'` part keeps its value across requests, the part behind `connection()` is rendered per request, `revalidateTag` renews the cached part) and Verified (local, 2026-11-08); not in CI. `cacheLife` expiry and the `remote` and `private` variants: untested. |
| Response streaming (Suspense) | Verified (Azure) |
| Middleware (redirect, rewrite, headers), including the Next.js 16 `proxy` convention | Verified (Azure) for `middleware`; `proxy`: **Verified (Azure)** on 16.4.5 (the example's `middleware.js` renamed to `proxy.js`: the whole suite, 48 cases, passes against two deployments; 2026-11-10) and Verified (local); not in CI (the example keeps `middleware.js`). Edge-runtime middleware: not supported. |
| Server Actions | Verified (Azure): form post and the `Next-Action` call. `package` warns when no stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is set. A deployment over an older build: **Unverified**. |
| `after()` | Verified (Azure): the response is held open until the work is done (`--wait-until hold`, the default). `detach`: **Unverified** with this design. |
| Image optimization (`next/image`) | Verified (Azure): resize, WebP, rejection of bad sizes and remote URLs not allowed, with the Linux `sharp`. A missing source image answers **400** (Next.js's own answer on 15). Next.js's disk cache for optimized images is off (the app directory is read-only), so an optimized image is made again after an instance restarts. |
| Cookies (several `Set-Cookie`) | Verified (Azure) |
| Static files (`/_next/static`, `public/`) | Verified (Azure): served by the Next.js server from the package, with its `ETag` and `Cache-Control`. They are **not** in Blob or a CDN, so every request is a function execution. |
| Pages prerendered by `next build` | Next.js does not read them through a custom cache handler, so on a miss in Blob the handler reads them itself from the build output, with Next.js's own file-system cache class (read-only; tag revalidation is checked against Table Storage as for any entry; [ADR-0022](./plan/decisions.md#adr-0022-the-cache-handler-reads-the-build-output-on-a-miss)). **Verified (local)** since 2026-11-11 and **Verified (Azure)** on 2026-11-14 (commit 3006689, Next.js 15.5.29 and 16.4.5: right after `deploy`, every prerendered route answered `HIT` on the priming request, and the HTTP suite passed, 50 of 50 on both). Before the change, each page was rendered on its first request; `deploy` still primes every route once. |
| `dynamicParams = false` (App Router), `fallback: false` (Pages Router) | App Router: every path answered 404 until 2026-11-11 (Azure and local; Next.js does not render a page that is not in the cache when there is no fallback). Now the built page is found through the build output: the path answers 200, an unknown one 404, and a stale page is served and regenerated. **Verified (Azure)** on 2026-11-14 (Next.js 15.5.29 and 16.4.5, the E2E cases of `routes without a fallback`; by hand: the built path 200, an unknown path 404, on both) and Verified (local). Pages Router `fallback: false`: Verified (local), it was not affected. |
| Edge runtime | Not supported |
| [Front Door](https://learn.microsoft.com/azure/frontdoor/front-door-overview?wt.mc_id=studentamb_679600) | Template compiles; **never deployed**. The `X-Azure-FDID` check of the entry: Verified (local) by unit test only. |

## Platform

| Item | Status |
| --- | --- |
| Azure Functions Flex Consumption, Node 22 | Verified (Azure). Node 24: Unverified. |
| Run from package: the app directory is read-only | Verified (Azure): the image optimizer's disk cache failed with `EACCES` until it was turned off. |
| Package without symbolic links | Verified (Azure): `package` flattens the pnpm layout into a plain tree and refuses to produce a package that still has links. npm and Yarn classic (1.x) layouts: **Verified (local, and in CI)** on 2026-11-10 (the packed tarball installed into a clean project, built, packaged and run on Azurite and the Functions host: 48 cases pass with npm on Next.js 15.5.29 and 16.4.5 and with Yarn 1.22 on 15.5.29 on macOS with Node 26; in CI with npm and Yarn 1 on Linux with Node 22 and 24, Next.js 15.5.29; not on Azure). Yarn Plug'n'Play is not supported: `package` stops with a message that names the fix (`nodeLinker: node-modules`). Yarn 2+ with `node_modules` and Bun: Unverified. |
| Cold start | One sample, client in Japan: **2.4 s** for the first request after about 11 minutes idle (2.5 s in the earlier spike), 0.1 to 0.2 s warm. With `--always-ready 1`: **0.15 s** for the first request after the same kind of idle time (about 17 minutes), against **2.4 s** without it (2026-11-10, one sample each, the same build on two apps). On 2026-11-14 the first request after about 10 to 12 minutes idle took **2.68 s** (Next.js 15.5.29) and **2.45 s** (16.4.5), without always-ready, one sample each. |
| Load | 300 requests at 30 parallel: all 200; dynamic page p95 0.29 s, ISR page p95 0.86 s (one sample). |
| Scale-out | Cache and tags are shared through Storage. After `revalidateTag`, parallel requests can each regenerate (ten different values within 70 ms in one test); the cache converges on the last write. |

## Known gaps

- A response that fails after its first byte (the Next.js server closes the connection) ends at that point: the client sees a shortened body with a normal end, and the failure is logged. Erroring the stream left the client waiting until the platform's timeout (measured locally). The case passes against a deployment on Azure (2026-11-09).
- Concurrent regeneration after a revalidation is not coalesced.
- `after()` work cannot be tied to one request: a response may also wait for work that other requests started earlier (at most 220 s).
- Absolute URLs that application code builds from `request.url` in middleware and writes into a response body show the loopback origin (`http://localhost:3000`); a redirect's `Location` header is corrected.
- Front Door is untested, and so is the cost of always-ready (the only Azure Cost Management figure read is for the short runs: [Cost](./cost.md#a-real-bill)).
- A rewrite by `proxy` (Next.js 16.4.5) leaves the response header `x-middleware-rewrite` with the loopback origin (`http://localhost:3000/...`). Seen on Azure on 2026-11-10; whether Next.js 15 or a plain `next start` does the same was not checked.
- The behavior differences against OpenNext that come from Next.js's own server are listed in [Comparison](./comparison.md).
