# Roadmap

Goal: an npm package that deploys Next.js to Azure, built to the same quality bar as [OpenNext for AWS](https://opennext.js.org/aws): documented, tested (unit, integration, E2E) and released with a repeatable process. Official adoption is not a goal in itself, but the project should be good enough to be considered.

Status legend: `[x]` done, `[~]` partially done, `[ ]` not started.

Revision history: revised 2026-11-06 after an external review (see the [work log](./worklog.md)). Main changes: local Functions stack first, `git init` immediately, access restriction moved up, app layout and Front Door made measurable decisions, behavioral test cases and missing security/release items added.

## Phase 0: Prototype (done, 2026-11-05)

- [x] Choose architecture: Azure Functions (Flex Consumption), Blob/Table/Queue Storage, Front Door ([ADR-0001](./decisions.md#adr-0001-compute-and-storage-targets))
- [x] OpenNext overrides: wrapper, converter, incremental cache, tag cache, queue, image loader, revalidation wrapper/converter
- [x] CLI: `package` and `deploy`
- [x] Bicep template for all infrastructure (compiles; not deployed)
- [x] Verified locally: `open-next build`, SSR/ISR/404 through the wrapper, Blob cache `MISS` then `HIT`, Table tag cache and Queue against Azurite
- [x] Convert to a pnpm + Turborepo monorepo ([ADR-0004](./decisions.md#adr-0004-monorepo-layout-and-tooling))
- [x] `git init` (2026-11-06; no commits yet)

## Phase 1: Prove it, locally first, then on Azure

Most real defects are expected to show up under the real Functions host running locally; real Azure should only add a few. So the local stack comes first and costs nothing.

### 1a. Local Functions stack (no Azure resources)

- [x] Run the packaged apps with Azure Functions Core Tools + Azurite; one command starts the stack (`pnpm local:stack`)
- [~] Verify on it: streaming (done), queue-triggered ISR regeneration (done), `revalidateTag` (done), `/_next/image` (done), `waitUntil` (completion done; client latency is a problem, see [ADR-0006](./decisions.md#adr-0006-waituntil-via-response-stream)), `revalidatePath` (done)
- [x] HTTPS local run with a self-signed certificate created for the run and deleted afterwards (B14)
- [ ] Add a Pages Router fixture next to `examples/app-router`
- [~] Fix whatever the above uncovers: extension bundle, sharp native binaries and a packaging guard fixed; `waitUntil` latency, missing-image status code (500 instead of 404) and `Content-Length` handling open; see the [work log](./worklog.md)

### 1b. Decide the deployment shape

Decided on 2026-11-06 in [ADR-0009](./decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default): one Function app with three functions, Front Door optional and off by default.

- [x] Check the current Front Door Standard base fee: 35 USD/month per profile (Premium 330); optional, off by default
- [x] Compare three apps vs one app registering all three functions locally: behavior identical, +about 15 ms module load, +about 4 MB; the only constraint is the working directory
- [x] Decide direct access restriction: not needed without Front Door; with it, `X-Azure-FDID` check in the wrapper plus a service-tag access restriction
- [ ] Cold start, scale-out and cost of single vs split on real Azure (Phase 1c; local numbers cannot answer this)

Work this decision created (implemented 2026-11-06, verified locally only):

- [x] `opennext-azure package`: builds the single app (`chdir` per bundle, server last, Azure SDKs installed once at the root); the old three-app layout was removed
- [x] `scripts/local-stack.mjs`: runs the single app
- [x] Bicep: one Function app, one deployment container, Front Door behind the `frontDoor` parameter; `deploy` updated (compiles; never deployed)
- [x] Asset serving without Front Door: `AssetResolver` override reading Blob via a manifest (B10, exact paths)
- [ ] Measure the cost of serving static files through the function (Phase 1c)
- [x] Wrapper: `FRONT_DOOR_ID` / `X-Azure-FDID` validation, checked on the local host
- [x] Document the Front Door variant and the no-Front-Door variant in Get started
- [ ] Automated tests for all of the above (Phase 2): manifest builder, asset resolver (200/304/206/416/HEAD), entry point generation, `isFrontDoorRequestAllowed`

### 1c. First real deployment

Follow [Real Azure runs](../contribute/azure_runs.md). Confirm subscription, region and resource group before creating anything.

- [x] Deploy `examples/app-router` with `opennext-azure deploy` (2026-11-06; it took five attempts, see the work log: role id typo, deployer data role, pnpm symlinks twice)
- [~] Verify the Flex Consumption specifics in [Azure notes](../inner_workings/azure_notes.md): `properties` response shape, config-zip, identity-based host storage and Node 22 verified; rejected classic settings, init limit and the explicit maximum instance count still open
- [x] Verify response streaming through Functions (directly on the app; through Front Door not tested)
- [x] Verify `waitUntil` ([ADR-0006](./decisions.md#adr-0006-waituntil-via-response-stream)): `hold` and `detach` measured on Azure; deferred work survives the response, an idle instance is removed after about 1.5 to 3.5 minutes
- [x] Verify ISR regeneration is executed by the queue consumer, not by an in-process fallback: 34 `revalidation` invocations recorded in Application Insights, each followed by a `HEAD` request to the page ([ADR-0010](./decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group))
- [x] Verify managed identity RBAC: no shared keys, Blob/Queue/Table roles, host storage role
- [x] Measure cold start and scale-out: HTTP cold start 4.1 to 4.5 s; 200 requests at 40 in parallel on 17 instances, p95 4.5 s ([Azure notes](../inner_workings/azure_notes.md), items 19 and 20). Not yet: the same on the three-app layout, with Node 24, or with a larger package
- [~] Post-deployment readiness check: `deploy` now waits for the first answer and reports its time (`warm-up.ts`, unit-tested; not run against a real deployment yet). Open: a health route that reports the same release as the local build
- [x] Delete everything created and verify it (2026-11-06 07:06 UTC: 0 resources of the run left in the subscription)
- [ ] **Next-day** read-only inventory of the subscription and a look at the actual cost of the run (usage had not been reported yet when the resources were deleted)

### 1d. What the first Azure run found that still needs work

- [x] ISR revalidation: dedupe messages before enqueueing (implemented and tested locally, [ADR-0010](./decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group))
- [~] ISR revalidation: the backlog alert is deployed and enabled on Azure but has never fired; the `maxPollingInterval` option is verified. Open: choose the default polling interval
- [x] ISR revalidation: deployed on Azure; 30 simultaneous stale requests caused one regeneration; a lower polling interval cuts the wait from 44 s to 2 s (second Azure run)
- [ ] Find the cause of `Unable to create client for AzureWebJobsStorage` on some new instances (seen on 3 of about 46 host starts in two runs); add an alert on the host health check
- [ ] Decide the `WAIT_UNTIL_MODE` default with more data than one run ([ADR-0006](./decisions.md#adr-0006-waituntil-via-response-stream))
- [ ] Limit the instance count for small sites: a 200-request burst started 17 instances, 16 of which served one or two requests
- [x] Make `tests-e2e` run against a deployed URL (`E2E_BASE_URL`, project `remote`; log-based tests are skipped there). Verified (local): typecheck and lint; not yet run against a deployment
- [x] A missing source image answers 404 instead of 500: the loader records it per request, the wrapper corrects the adapter's 500 (OpenNext's image adapter turns every loader error into 500). Verified (local): unit and E2E; not yet on Azure
- [ ] Verify the three-app layout against the single app on Azure, then close or supersede [ADR-0009](./decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default)
- [ ] Deploy the Front Door variant once (`--front-door`), including the access restriction on Flex
- [ ] Verify npm and Yarn layouts of `node_modules` on Azure; extend the flattening or the guard if a layout other than pnpm's needs it

## Phase 2: Test infrastructure

- [x] `packages/tests-unit` (Vitest): converter, wrapper, asset resolver, caches, queue, revalidation, image loader, manifest and packaging helpers against in-memory fakes
- [x] Integration tests against Azurite (real SDKs, dedicated ports), automating the manual checks done in Phase 0
- [~] Implement the behavioral test cases listed in [testing](../contribute/testing.md#required-behavioral-test-cases): B1, B2 (partly), B3 (converter level and local poison queue), B4, B5 (partly), B6, B7 (current behaviour), B9 (HEAD), B10, B11 (resize and rejections) are covered; B8, B12, B13, B14-beyond-HTTPS, cookie sanitizing, `Content-Length` removal, optimized-image cache rules are not
- [x] `packages/tests-e2e` (Vitest + HTTPS, not Playwright): runs against the local Functions + Azurite stack; a browser-driven suite can be added later if UI behaviour needs it
- [x] E2E against a real Azure deployment, deployed from CI using OIDC federation (no stored secrets), with automatic teardown: first run green on 2026-11-07 ([Azure E2E in CI](../contribute/azure_e2e.md)). Second green run on 2026-11-07 (41 passed, 2 skipped); no `rg-oe2e-*` group left afterwards (reported by the maintainer). Still to do: cost of a run, log-based checks via Application Insights
- [ ] Evaluate reusing the example apps and E2E specs from `opennextjs/opennextjs-aws` as a conformance suite
- [x] CI (GitHub Actions): `check` workflow (lint, typecheck, build, unit, integration, Bicep, local E2E; SHA-pinned actions, read-only token, Dependabot) ran on GitHub and passed on 2026-11-06 ([CI](../contribute/ci.md)). Still to do: Azure E2E on demand and nightly; `actionlint` was never run
- [x] Poison-queue end-to-end test (B3 beyond the converter): a malformed message reaches `revalidation-poison` after exactly 3 failed executions (Verified (local); own `poison` project because it makes the consumer fail on purpose). Not run on Azure
- [~] `npm pack` contents check is done (unit test: CLI entry and shebang, Bicep, LICENSE, overrides with types, no sources or maps; it found that the package had no LICENSE). Open: third-party notices and a clean-install test on Node 22 and 24 on macOS, Linux and Windows

## Phase 3: Feature parity and hardening

- [~] Next.js version policy: decided in [ADR-0011](./decisions.md#adr-0011-nextjs-support-follows-opennextjsaws) (follow `@opennextjs/aws`; `next` peer range declared; local E2E on 15.5.29 and 16.4.5 in CI). Open: a guard that refuses an unsupported version at `package` time, Azure E2E on 16. Review on 2027-01-31 (end of Next.js 15 support, per the maintainer) or when `@opennextjs/aws` adopts the Next.js Adapter API: see [ADR-0012](./decisions.md#adr-0012-the-nextjs-adapter-api-is-not-adopted-yet-nextjs-15-stays-supported)
- [~] Pages Router and middleware: SSR, static page, API route, and middleware redirect/rewrite/header are covered by local E2E (Verified (local)). Pages Router ISR (`revalidate`), `fallback: "blocking"` and `notFound` are covered locally. `res.revalidate` is covered locally. Open: these on Azure, `fallback: true`, `app-pages-router`, external middleware
- [~] Server Actions: form post and `revalidatePath` are covered by local E2E. A `Next-Action` header call is covered locally. Open: a real browser, the stable encryption key guidance (B12), Azure. Also open: `next/image` remote patterns, streaming/Suspense, PPR where supported
- [~] Image optimization hardening: refuse non-Linux-x64 artifacts is done (`assertSharpForAzure`). A server-side cache is not what the official adapter does either: see [ADR-0014](./decisions.md#adr-0014-optimized-images-are-not-cached-by-the-server-opennextstaticetag-is-on) (decided: `OPENNEXT_STATIC_ETAG` is set, 304 verified locally; a Blob cache only after a measurement on Azure)
- [ ] Static assets served from an exact-path manifest instead of name patterns (B10)
- [~] Security hardening of responses: no body on HEAD/204/205/304/101 is done (Verified (local); the body is still read so `waitUntil` work is held). Error detail only when `NODE_ENV` is `development` is done for failures before the first byte (generic 500, detail in the log; Verified (local), unit only); a failure after streaming started still just ends the stream. Cookies: done (structured cookies in the wrapper, [work log](./worklog.md) session 26). Dropping `Content-Length` on streamed responses was tried and reverted: static assets stream with an exact length and the E2E tests need it; revisit only with a case where the length is wrong
- [~] Supply chain and security checks: SHA-pinned actions, read-only token and no privileged triggers are in place for `check` (see [CI](../contribute/ci.md)); production audit gate, own secret scanner (tree, history checked once), license allow-list: done, see [Supply chain checks](../contribute/supply_chain.md). Open: SBOM, npm provenance, a dependency update policy
- [ ] Rollback and engine switch behavior, documented and tested
- [ ] Observability: Application Insights wiring, structured logging, documented queries
- [ ] Revisit known limitations in [Compatibility](../compatibility.md) and [Common issues](../common_issues.md)
- [ ] Optional: custom domain and certificate support in the Bicep template; Cosmos DB tag cache as an alternative override

## Comparison with the official adapters (2026-11-07)

Compared with `@opennextjs/aws` (types of 4.1.15 and its docs) and `@opennextjs/cloudflare` (docs). Several AWS override pages were not read (queue, image loader, asset resolver, origin resolver, warmer, CDN invalidation, initializer, cache interception), so entries about them rest on the type definitions. Not every official feature is a goal; each item is a decision.

Priority order:

- [~] Verify `'use cache'` (Composable Caching), PPR and Turbopack: the Cloudflare docs list them as supported. `'use cache'` with `cacheTag` and `revalidateTag` is Verified (local) on Next.js 15.5.29 and 16.4.5 (E2E case in `revalidation.test.ts`). Open: on Azure, `cacheComponents` (16), PPR, Turbopack, and Next.js 16's `proxy` file (the build warns that the `middleware` convention is deprecated)
- [x] Remote images (`images.remotePatterns`): already worked. The earlier note that only the app's own Blob assets are served was wrong: the 400 for an external URL came from an empty `remotePatterns`. OpenNext's image adapter validates the URL against `remotePatterns` and fetches it itself (`https.get`); the Blob loader only serves the app's own images. Verified (local): fetch, resize, an unlisted origin refused, a missing remote image answers an error status. Open: Azure (needs a reachable origin), `http:` origins (the adapter uses `https.get`, untested), redirects from the origin, size and time limits of the fetch
- [~] Warmer: decided in [ADR-0013](./decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet): no `warmer` override; `deploy --always-ready <n>` added (Bicep parameter already existed). Open: measure it on Azure (cold start and first request after a deployment), a timer ping only if always-ready is too expensive
- [x] `cdnInvalidation` override: not needed. Front Door caches only `/_next/static/*` (content-hashed, immutable); no page or ISR response is cached there, so a revalidation has nothing to purge. Revisit if the Bicep template ever caches dynamic routes
- [ ] CLI: a local `preview` command (the repository has `pnpm local:stack`; users do not), `populate-cache` as its own step, a way to upload a version without serving it. Cloudflare has `preview`, `populateCache`, `upload`, `migrate`
- [ ] Decide on: cache interception (`enableCacheInterception`), a Blob/Table dev implementation like `fs-dev`, skew protection (Cloudflare has it, experimental)

Checked against the official source and docs (2026-11-07; docs pages and the `opennextjs-aws` main branch were read by research agents, the installed 4.1.15 package by the assistant):

- Aligned: Blob layout of the incremental cache (`[__fetch/]<buildId>/<key>[.cache|.composable]`, the same as the S3 override); tag cache semantics (`hasBeenRevalidated`, `isStale`, `writeTags` with `stale` and `expire`) equal to the official nextMode implementation; queue message handling (the whole `{host, url, lastModified, eTag}` body is forwarded, the send goes through `waitUntil`); the revalidation consumer is OpenNext's own adapter (a `HEAD` with `x-prerender-revalidate` and `x-isr: 1`); the cache headers of hashed static files; `OPENNEXT_STATIC_ETAG` (ADR-0014); the asset resolver interface (OpenNext 3.7.0 and later).
- Verified (local): `dangerous.enableCacheInterception: true` works with these overrides. All 50 E2E cases pass, including ISR regeneration through the queue; only the response header differs (`x-opennext-cache` instead of `x-nextjs-cache`, the E2E helper `cacheStatus` accepts both). It stays off, as in the official default; not tried on Azure.
- Differences, by decision or because they do not apply: `warmer` (ADR-0013), `cdnInvalidation` (nothing cached at the edge), `initializationFunction` (only the original tag cache mode needs its prepopulation; this one is nextMode), external middleware, split functions and `originResolver` (ADR-0009), the edge runtime, development implementations (`fs-dev`, `dummy`), an in-memory tier like `multi-tier-ddb-s3`, a revalidation concurrency setting like `MAX_REVALIDATE_CONCURRENCY` (on Azure it would be the queue trigger's `batchSize`, not set here). Not-hashed static files get `max-age=0, must-revalidate` without the official `s-maxage` (it exists for a CDN that is purged on deployment).
- Open, worth a look: the tag cache reads one entity per tag (the official nextMode implementation uses one batched read and refuses more than 100 tags); a page with many tags makes many Table requests per cache read, cached per request only. Windows: the official docs say full support is not guaranteed; here the local stack is only run on macOS and Linux.

Not planned, with the reason: function splitting, external middleware and `originResolver` (single app, [ADR-0009](./decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default)); Edge runtime (not available on Azure Functions).

Where this adapter is ahead: ISR revalidation de-duplication with a load test (ADR-0010), measured `waitUntil` behavior (ADR-0006), identity-based access without shared keys, and an Azure E2E run from CI with automatic teardown.

## Phase 4: Publish

- [ ] Decide the final npm package name ([ADR-0005](./decisions.md#adr-0005-package-name-is-deferred)); do not use `opennextjs` as a name prefix unless the OpenNext maintainers agree
- [ ] Attribution wording in README and package metadata: not an official OpenNext package
- [ ] Repository settings, branch protection, `CONTRIBUTING.md`, `SECURITY.md`
- [ ] Changesets-based release with npm provenance; pre-release channel via `pkg-pr-new` or an npm `next` tag
- [ ] Docs site (generated from `docs/`), example apps, migration guide from other hosts
- [ ] First public release `0.1.0`, clearly labeled experimental until Phases 1 to 3 are complete
