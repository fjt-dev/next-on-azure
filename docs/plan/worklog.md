# Work log

Newest entry first. One entry per working session: what was done, what was verified, what was learned, what is next. Keep it factual; mark anything not run as **unverified**.

---

## 2026-11-07 (session 30): release plan

### Done

- Pushed up to `74dc394`; `check` green (all five jobs).
- Checked the npm registry (read-only): **`opennextjs-azure` is already published by someone else** (0.2.0, MIT, Azure Functions with Blob, Table and Queue Storage, built on `@opennextjs/aws` 3.x). Read from the registry metadata and README only. `opennext-azure` and a few other names were free.
- Wrote [the release plan](./release_plan.md): starting point, the name finding, three stages with gates, sizes and verification, fixed dates, order, Azure budget, risks, maintainer-only actions. [ADR-0015](./decisions.md#adr-0015-the-placeholder-package-name-is-taken-the-name-and-the-positioning-are-open-proposed) (proposed).
- Found two identifiers to scrub before the repository goes public: a real client id in a test sample, and the federated credential subject in the Azure E2E guide.

### Rule from the maintainer

- The assistant does not read the code of other Azure adapters (including the existing `opennextjs-azure`), to avoid being influenced by it. Recorded in `AGENTS.md`. The maintainer does not want a public statement about independence; none is written. Before the rule, the assistant had read the registry metadata and the first part of that README (no code).

### Not verified

- What the other package does (it will not be checked by reading its code); GitHub's current policy on free Actions minutes for public repositories; the free names on npm (can change).

---

## 2026-11-07 (session 29): Azure-specific optimizations, first two

### Done

- Application Insights sampling: the generated `host.json` had disabled it, so every telemetry item was sent and the ingestion cost grew with traffic. It now uses the platform default (sampling on, requests excluded from it); `deploy --full-telemetry` (Bicep parameter `fullTelemetry`, app setting `AzureFunctionsJobHost__logging__applicationInsights__samplingSettings__isEnabled=false`) restores the old behavior for measurements. Why it was off is not recorded; probably to count invocations in Application Insights (requests stay unsampled).
- Warm-up after deployment: `deploy` requests `/` until it answers below 500 (up to 5 minutes), and prints the time. `deploy` is now async. `--no-warm-up` skips it. The first request after a deployment was measured at up to 25.7 s (Azure notes, item 19).
- Tests: 3 for `warmUp` (accepts 403 and 404, retries after 5xx and network errors, gives up with the last error), 1 for `host.json`.

### Verified (local)

- Unit 225, lint, typecheck, Bicep compiles, the CLI starts. **Unverified:** the warm-up against a real deployment, and that the app setting overrides the sampling in `host.json` on Flex.

### Next

- Measure the module load time of the server bundle locally (Azure SDKs versus lighter clients), then an Azure run for the HTTP per-instance concurrency and `--always-ready 1`.

---

## 2026-11-07 (session 28): comparison with the official source

### Done

- Three research agents read the OpenNext AWS docs (inner workings, config and overrides pages) and the `opennextjs-aws` source of the overrides and core cache code. Compared with our overrides: the layouts and semantics agree (details in the roadmap section "Comparison with the official adapters"). No behavior had to change.
- Experiment: `dangerous.enableCacheInterception: true` in the example: 48 of 50 E2E cases passed, the two failures only asserted the header name; with the new helper `cacheStatus` (accepts `x-nextjs-cache` and `x-opennext-cache`) all 50 pass. Reverted to the official default (off).
- Open item found: the tag cache reads one entity per tag.

### Verified (local)

- E2E 50 + 10 + 1 with interception on; lint and typecheck. The default configuration was rerun after the helper change: 50 + 10 + 1.

---

## 2026-11-07 (session 27): image cache investigation

### Done

- Pushed up to `d0a6867`; `check` green.
- Read the image adapter of `@opennextjs/aws` 4.1.15: it does not cache images by design (`Cache-Control: public,max-age=<n>,immutable`, `Vary: Accept`, optional ETag and 304 with `OPENNEXT_STATIC_ETAG`). Correction: the earlier statement that the missing cache is a gap against the official adapters was wrong; on AWS the CDN does the caching.
- [ADR-0014](./decisions.md#adr-0014-optimized-images-are-not-cached-by-the-server-opennextstaticetag-is-on) : options A to D; recommendation B (set `OPENNEXT_STATIC_ETAG`), measure on Azure before building a Blob cache. Accepted the same day (B): `OPENNEXT_STATIC_ETAG=true` in Bicep and the local stack, one E2E case (ETag, `Vary: Accept`, 304 for a matching `If-None-Match`, 200 for another size). Verified (local): unit 221, E2E 50 + 10 + 1, Bicep compiles. Not on Azure.

---

## 2026-11-07 (session 26): cookies lost, `cdnInvalidation` not needed

### Done

- Pushed up to `63a5772`.
- `cdnInvalidation`: not needed. Front Door caches only `/_next/static/*`; there is nothing to purge on revalidation.
- B5 cookies: a probe route (`/api/cookies`) with several `Set-Cookie` headers showed a **real bug**: only the last cookie reached the client, even when all were valid (the Functions host keeps one value per header name). Fixed in the wrapper: `cookies.ts` turns `Set-Cookie` lines into structured cookies (`HttpResponseInit.cookies`) and drops attributes the platform rejects (unknown `SameSite`, unreadable `Expires`, non-numeric `Max-Age`). `Partitioned` and `Priority` have no field and are dropped.
- Tests: 8 unit tests for the parser, two wrapper tests updated, two E2E cases (valid cookies, invalid attributes).

### CI finding

- The Next.js 16.4.5 E2E job of `63a5772` failed: Next.js 16 refuses remote images that resolve to a private address (`images.dangerouslyAllowLocalIP`), and the new remote image test serves its image from localhost. My earlier local check on 16 was invalid: `pnpm --filter example-app-router run package` does not rebuild, so it packaged the old Next.js 15 build. Fixed with a version-aware `next.config.mjs` (the option is unknown to 15.5.29 and makes its build fail); verified locally on both versions with a real rebuild (`pnpm e2e:test`). Always switch versions through `pnpm e2e:test`, which rebuilds.

### Verified (local)

- Unit 221, E2E 49 + 10 + 1, lint, typecheck. Not run on Azure: the behavior of the host with structured cookies in a deployment, and cookie values with unusual characters, are unverified.

---

## 2026-11-07 (session 25): warmer

### Done

- Read the Microsoft Learn pages on Flex Consumption (always-ready instances, billing, quota) and the Functions pricing page (numbers are not rendered there).
- Found that the Bicep template already had `alwaysReadyInstances` for the `http` group but the CLI could not set it, and `docs/faq.md` named a setting that does not exist. Added `deploy --always-ready <n>`; fixed the FAQ; documented in Get started.
- [ADR-0013](./decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet): no `warmer` override, always-ready first, a timer ping not built (unverified on Flex, does not help bursts).

### Verified (local)

- Typecheck, lint and unit tests. The flag is passed to `az deployment group create` only on a deployment, which was not run: **Unverified** on Azure, as is the effect on cold start.

### Next

- A paid Azure run with `--always-ready 1`: cold start, first request after a deployment, and the real cost.

---

## 2026-11-07 (session 24): remote images

### Done

- Added `images.remotePatterns` (`https://localhost:8443`) to the example and three E2E cases: an image from a listed origin is fetched and resized, an unlisted origin is refused (400), a missing remote image answers an error status. The test serves the image itself over HTTPS with the run's certificate; it is skipped against a deployment.
- Correction: the roadmap item "remote images" assumed a gap. There is none: OpenNext's image adapter validates against `remotePatterns` and fetches the URL itself; the earlier 400 came from an empty `remotePatterns`.

### Verified (local)

- Local E2E 47 + 10 + 1. Not run on Azure.

### Next

- Warmer: check whether an always-ready instance on Flex Consumption removes the cold start before building a `warmer` override; then `cdnInvalidation`.

---

## 2026-11-07 (session 23): Next.js Adapter API

### Done

- Researched the Next.js Adapter API (docs and blog, by a research agent): build-time interface, stable since Next.js 16.2, runtime and caches stay with Next.js (`cacheHandler`, `cacheHandlers`); not mentioned by the official OpenNext READMEs.
- [ADR-0012](./decisions.md#adr-0012-the-nextjs-adapter-api-is-not-adopted-yet-nextjs-15-stays-supported): not adopted yet; Next.js 15 stays supported (end of its support on 2027-01-31 per the maintainer, source not checked); review on that date.

### Not verified

- The Next.js 15 end-of-support date, the status of the Adapter API in `opennextjs-aws`, and the unread pages listed in the ADR.

---

## 2026-11-07 (session 22): comparison with the official adapters, `'use cache'`

### Done

- Compared this adapter with `@opennextjs/aws` (override types in 4.1.15, docs) and `@opennextjs/cloudflare` (docs, read by a research agent); the result is a new roadmap section with priorities. AWS pages for queue, image loader, asset resolver, origin resolver, warmer, CDN invalidation, initializer and cache interception were not read.
- Priority 1: `app/use-cache` and `app/api/revalidate-use-cache` in the example, `experimental.useCache` in `next.config.mjs`, one E2E case. It passes on Next.js 15.5.29 and, in a temporary change of the catalog (reverted), on 16.4.5, which warns that `experimental.useCache` and the `middleware` file convention are deprecated.

### Verified (local)

- Local E2E 44 + 10 + 1 on 15.5.29; the same 44 + 10 + 1 on 16.4.5 (temporary). Not run on Azure.

### Next

- Remote images (`remotePatterns`), then the warmer question (always-ready instance first), then `cdnInvalidation`.

---

## 2026-11-07 (session 21): Dependabot PRs, tooling upgrades, Next.js policy

### Done

- Investigated the 5 open Dependabot PRs. PRs 2 to 5 failed only because their branches predated the fix of my unused `@ts-expect-error`; PR 1 failed on a download in the `azure-functions-core-tools` postinstall (not reproduced). Tried every update locally in a separate worktree: TypeScript 7.0.2, vitest 5.1.0, Next.js 16.4.5, biome 2.6.4, turbo 2.11.10 and changesets 3.0.3 all work.
- Applied TypeScript 7, vitest 5, biome 2, turbo and changesets 3. Biome 2: `biome migrate` turned `recommended: true` into `preset: none` (no lint rule would run); set `preset: recommended` explicitly and checked with a probe file. Markdown is excluded from Biome (version 2 would have reformatted about 300 lines of docs). The recommended set found one unused function in `flatten-node-modules.ts`, removed. `noTemplateCurlyInString` is off (generated code and workflow syntax).
- Next.js policy: [ADR-0011](./decisions.md#adr-0011-nextjs-support-follows-opennextjsaws). `next` peer range added; `check` runs the local E2E on the catalog version and on 16.4.5; Dependabot ignores `next` and `@types/node` majors.

### Verified (local)

- Build, typecheck, lint, unit 213, integration 9, E2E 43 + 10 + 1 on the new tool versions. Next.js 16 passed the same in a trial worktree, not yet through the new CI matrix. Not run on Azure.

---

## 2026-11-07 (session 20): second Azure E2E run

### Done

- Installed `gh` (maintainer), started `azure-e2e` on `main` at `a03cfb0` with the maintainer's go-ahead and watched it.
- Result: success. Deploy, test and delete took about 6 minutes (07:59 to 08:05 UTC); the `cleanup` job succeeded. 8 test files, 41 passed, 2 skipped (the two host-log tests). The `poison` project is local only and not part of the remote run.
- New on Azure since the first run: Pages Router ISR, `fallback: "blocking"`, `notFound`, `res.revalidate`, a Server Action called like client JavaScript, `revalidatePath` from a form action, missing image 404, middleware.

### Not done

- Inventory: the maintainer reported on 2026-11-07 that no `rg-oe2e-*` group remains after the two CI runs. Cost: the maintainer's Cost Management view by resource group (period not shown) listed `opennextjs-azure` 12 yen, `rg-opennextjs-azure-2` 1 yen, `rg-opennextjs-azure-1c` under 1 yen and two `flex-*` groups 0 yen. No `rg-oe2e-*` group appeared yet, so the CI runs are not in that number (usage is reported with a delay). The subscription has no resource group left (checked read-only with `az group list`).
- Dependabot PRs for `next` 16, TypeScript 7 and a dev-tooling group fail `check`; not looked at.

---

## 2026-11-07 (session 19): poison queue end to end

### Done

- New E2E project `poison` (`src/poison/poison-queue.test.ts`, run last by `pnpm e2e:test`): sends a non-JSON message to `revalidation` through Azurite; waits until it appears in `revalidation-poison`; checks it is gone from the main queue and that the host log shows exactly 3 failed executions (`maxDequeueCount: 3`).
- Separate project and stack on purpose: the default tests assert that no revalidation failed in the host log.

### Verified (local)

- Passes in the full local run (default 43, front-door 10, poison 1); lint and typecheck pass. Not run on Azure; the remote project does not include it.

---

## 2026-11-07 (session 18): supply chain checks

### Done

- `pnpm audit --prod` found 4 advisories, all in the `postcss` that Next.js pins. Fixed with an `overrides` entry (the lockfile had to be regenerated with `--lockfile-only`); production audit is clean, build and local E2E pass.
- `scripts/secret-scan.mjs` (+ `secret-rules.mjs`): tracked files and full history, no findings; the Azurite public key is allow-listed. Unit tests for the rules and the tree.
- `scripts/license-check.mjs`: allow-list for the package, two documented exceptions for the example.
- New `supply-chain` job in `check` (production audit gate, report-only full audit, secret scan, licenses); new doc [Supply chain checks](../contribute/supply_chain.md).

### Verified (local)

- Unit tests 213 pass; lint passes; the new CI job has not run on GitHub yet. The full audit still lists development-tool advisories (2 critical, 5 high at the start): not fixed, report only.

---

## 2026-11-07 (session 17): npm pack contents check

### Done

- `packages/tests-unit/src/unit/pack.test.ts` runs `npm pack --dry-run --json` and checks the file list: CLI entry with a node shebang, `infra/main.bicep`, README, LICENSE, every override with its `.d.ts`, nothing from `src`, tests, source maps or `node_modules`, and nothing outside `dist`, `infra` and the known top-level files.
- It found a real gap: the package had no `LICENSE` (npm does not copy the repository root file). Added `packages/open-next-azure/LICENSE`; the test requires it to equal the root one.

### Verified (local)

- Unit tests 205 pass; lint passes. Not verified: a clean install of the packed tarball.

---

## 2026-11-07 (session 16): res.revalidate and client-style Server Action call

### Done

- Pushed `3401292`; `check` was green.
- `pages/pages-ondemand.js` (revalidate 3600) and `pages/api/revalidate-page.js` (`res.revalidate`); E2E case: the page stays until the API route is called.
- E2E case for a Server Action called as client JavaScript does (`Next-Action` header, `text/x-component` response); the maintainer chose to batch Azure runs to save GitHub Actions minutes.

### Verified (local)

- Local E2E: 43 default + 10 front-door; lint passes. Not run on Azure.

---

## 2026-11-07 (session 15): Pages Router ISR and fallback in the example

### Done

- Pushed `58077bb` (Azure E2E counts: 35 passed, 2 skipped on `6720a19`).
- `examples/app-router`: `pages/pages-isr.js` (`revalidate: 5`) and `pages/pages-blog/[slug].js` (`fallback: "blocking"`, `notFound` for `missing`).
- Four E2E cases in `pages-router.test.ts`: unknown path rendered on first request then cached, prebuilt path, 404 from `notFound`, stale page regenerated through the queue.

### Verified (local)

- Local E2E: 41 default + 10 front-door pass; lint and typecheck pass. Not run on Azure yet.

### Next

- The next Azure E2E run will cover these cases; then `fallback: true`, `res.revalidate`, Server Actions called from client JavaScript.

---

## 2026-11-07 (session 14): Server Actions and revalidatePath in the example

### Done

- Pushed the Pages Router and middleware commit (`6b47363`).
- `examples/app-router`: `app/actions` (a form whose Server Action calls `revalidatePath("/actions/data")`) and `app/actions/data` (a `force-static` page that shows its render time).
- `packages/tests-e2e/src/default/server-actions.test.ts`: the prerendered page keeps its time until the form (posted without JavaScript, with the hidden action id) is submitted, then renders a new one that is cached again; an unknown action id does not give a 5xx.

### Verified (local)

- Local E2E: 37 default + 10 front-door tests pass; lint and typecheck pass.

### Not verified

- Azure. Server Actions called from client JavaScript (`Next-Action` header with a React Flight body), the stable encryption key guidance (B12), and `revalidatePath` of a dynamic segment or `layout` type.

### Azure

- Azure E2E run on `6720a19` (2026-11-07, started 04:55 UTC, deployment, tests and delete finished about 6.5 minutes later): 8 test files, 35 passed, 2 skipped (the failed-revalidation and stampede tests, which read host logs). The group `rg-oe2e-42340530662-1` was deleted by the job; the `cleanup` job issued its own delete (the group was still listed right after, as the delete runs with `--no-wait`). Cost of the run is still unknown. The `check` workflow was also green.

### Next

- Next-day inventory and the cost of the run.

---

## 2026-11-07 (session 13): Pages Router and middleware in the example

### Done

- Pushed the three earlier commits (`3c1acd9`); the `check` result is for the maintainer to report.
- `examples/app-router` now also has `pages/pages-ssr` (getServerSideProps), `pages/pages-static` (getStaticProps), `pages/api/hello` and a `middleware.js` for `/mw/*` (header, redirect, rewrite).
- New E2E file `pages-router.test.ts` (6 tests). No adapter code had to change: all of it worked on the first run except one test assertion (React puts comment markers between adjacent text nodes).

### Verified (local)

- Local E2E 35 + 10; lint. Nothing on Azure.

### Open

- Pages Router ISR and `fallback`, `app-pages-router`, external middleware, and all of this on Azure (it adds routes to the example that the next Azure E2E run will exercise).

---

## 2026-11-07 (session 12): missing image 404 and bodyless responses

### Done

- A missing source image now answers 404. OpenNext's image adapter turns every loader error into a 500, so the loader records the miss in a per-request `AsyncLocalStorage` (`request-context.ts`) and the wrapper corrects the status. The E2E case that was `it.fails` is now a normal test.
- The wrapper sends no body for HEAD and for 101/204/205/304, while still reading the body to its end so `waitUntil` work (the HEAD revalidation) is held.
- Tried and reverted: dropping `Content-Length` from streamed responses. It broke two E2E tests, because static assets stream with an exact length; the roadmap item stays open for a case where the length is really wrong.

- A handler that fails before sending anything now gives a generic `500 Internal Server Error` (detail in the log, in the body only when `NODE_ENV` is `development`) instead of failing the invocation. The queue consumer's wrapper is separate and still throws, so retries keep working.

### Verified (local)

- 199 unit tests, lint, type check; local E2E 29 + 10.

### Unverified

- Both changes on Azure; the 404 for a missing image only matters if the deployed image function reaches the same code path (it should, the same bundle).

---

## 2026-11-06 (session 11): Azure E2E in CI (written, not run)

### Done

- `tests-e2e`: new project `remote` (`E2E_BASE_URL`, script `e2e:remote`). Normal TLS verification against a deployed app; tests that read the local host log (consumer succeeded, no failed revalidation, stampede count, `AFTER_DONE`) are skipped there, and the ISR test waits longer.
- CLI `deploy`: `--deployer-principal-id` (a service principal cannot use `az ad signed-in-user`), `--output-file` (url, app, storage account, group), and the blob upload retries authorization errors while a new role assignment propagates.
- `.github/workflows/azure-e2e.yml` and `scripts/ci/azure-login.sh`: manual (and optional weekly) trigger restricted to `main` (no GitHub environment: required reviewers need a paid plan for private repos), OIDC sign-in without a third-party action, per-run resource group with tags, deploy, remote E2E, delete, plus a `cleanup` job that also removes tagged groups older than three hours.
- Unit test pinning the workflow rules (SHA pins, no privileged triggers, `id-token` only in this workflow, always-delete, no secrets).
- Guide with the one-time setup: [Azure E2E in CI](../contribute/azure_e2e.md).

### Verified (local)

- Lint, type check, build; 188 unit tests; local E2E 28 + 10 pass. The workflow YAML parses and every `run:` block passes `bash -n`; all actions are SHA-pinned.

### Unverified

- Everything that needs GitHub or Azure: the OIDC sign-in, the role propagation retry, deployment from the runner, the remote E2E over the internet, the cleanup job, `actionlint`. No Azure resource was created.
- The remote ISR timing (5 s polling should give a few seconds, from the earlier measurement) and the cost of a run.

### Update 2026-11-07: first runs on GitHub

Three runs failed before the fourth passed, all before or at deployment and each fixed: variables scoped to an environment, the OIDC subject with numeric ids (`AADSTS700213`), app name 14 characters against a limit of 12, deployer role principal type (`UnmatchedPrincipalType`). The fourth run (commit `f5e80ec`) succeeded in both jobs (6 min 1 s). Reported by the maintainer from the Actions page; details, cost and the post-run inventory are not yet checked.

### Next

1. (done, see above) The maintainer does the one-time setup in the guide; then a watched first run (confirm region, cost ceiling and time window first).
2. Read Application Insights from the remote tests to restore the log-based checks.

---

## 2026-11-06 (session 10): first push and first CI run

### Done

- Pushed the 9 commits of `main` to the private repository `fjt-dev/opennextjs-azure-fjtd` (created empty on github.com by the maintainer; remote added over HTTPS, authenticated by the maintainer's stored credentials; no token was shared).
- Before the push, the whole history (not only the working tree) was searched for the subscription, tenant and object ids, the maintainer's e-mail addresses, private keys, SAS tokens and common token formats: nothing found. The only key-like string is Azurite's published development key in `azurite.ts`. All commits are authored by `fjt-dev` with the GitHub noreply address.
- A signing failure during the previous commit step (`gpg: not a tty`) had left implementation files inside the test commit; the two local, unpushed commits were reset (`git reset --soft`, working tree untouched) and redone as three correct commits before this push.

### Result

The maintainer reported that **all jobs of the first `check` run succeeded**: `check` on Node 22 and 24 and `e2e`. This was not seen directly (a private repository's Actions cannot be read from the development environment); see [CI](../contribute/ci.md) for what that does and does not establish.

### Not done / still open

- `actionlint` was skipped on purpose (the maintainer chose to push without it).
- The repository name starts with `opennextjs-`; fine while private, to be reconsidered before publishing ([ADR-0005](./decisions.md#adr-0005-package-name-is-deferred)).
- Azure E2E in CI (OIDC federation, new resource group per run, teardown) is not written.
- Cost of both Azure runs: still to be read the day after.
- This doc update is not committed yet; pushing it runs the workflow again.

---

## 2026-11-06 (session 9): second Azure run, ISR deduplication and queue options (finished, resources deleted)

### Plan (recorded before anything was created)

| Item | Value |
| --- | --- |
| Subscription | the maintainer's subscription (`<subscription-id>`), signed-in user is Owner |
| Region | japaneast |
| Resource group | `rg-opennextjs-azure-2`, **new**, created by this run. The pre-existing empty group `opennextjs-azure` is not touched; the group of the first run was deleted |
| Layout | Single Function app, no Front Door |
| Cost ceiling | 5 USD (an estimate; the first run's real cost is still not reported: 3 meters recorded, 0.0000 so far). Stop and delete if it looks like it will be exceeded |
| Time window | 2 hours: started 2026-11-06T12:39:05Z, hard stop 2026-11-06T14:39:05Z |
| Deploy 1 | `--revalidation-always-ready 1 --alert-queue-backlog 20` (polling stays 60 s, the baseline) |
| Deploy 2 | the same plus `--revalidation-polling-seconds 5` |
| What is measured | (a) the new alert and settings are accepted by Flex/Azure Monitor; (b) 30 simultaneous requests for a stale page cause 1 or 2 `revalidation` invocations, not 30 (Application Insights); (c) three trials per polling setting of the time from the stale request to the `revalidation` invocation, with at least 2 minutes of silence between trials. The baseline so far is one measurement of 37 s |
| Cleanup | Delete the created resources one by one by name, then the group (created by this run); read-only inventory afterwards and next day |

### Record of created resources

All in `rg-opennextjs-azure-2` (japaneast), created by this run at 12:39 UTC and deleted by 13:18 UTC (39 minutes of the 2 hour window).

| Type | Name |
| --- | --- |
| Resource group | `rg-opennextjs-azure-2` (new, created by this run) |
| Storage account | `stonx2rwnu7d4g` |
| Log Analytics workspace | `log-onx2-rwnu7d4ggqqx4` |
| Application Insights | `appi-onx2-rwnu7d4ggqqx4` |
| Flex Consumption plan | `plan-onx2-rwnu7d4ggqqx4` |
| Function app | `func-onx2-rwnu7d4ggqqx4` |
| Metric alert | `alert-queue-backlog-onx2-rwnu7d4ggqqx4` |
| Action group (created by Azure next to Application Insights, not in the template) | `Application Insights Smart Detection` |

### What happened

| Step | Result |
| --- | --- |
| Deploy 1 (`--revalidation-always-ready 1 --alert-queue-backlog 20`) | **failed**: `BadRequest: Evaluation window size must be one of [PT1H, PT6H, PT12H, P1D] for the metric QueueMessageCount`. `validate` and `what-if` had passed. Fixed to window PT1H, evaluated every PT15M; a unit test pins it. Second attempt succeeded (about 2.6 minutes) |
| Alert, always-ready, settings | alert created and enabled (PT1H, every PT15M, threshold 20); `function:revalidation` always-ready 1 in the effective configuration; `REVALIDATION_DEDUPE_SECONDS=60` set; the polling setting is absent at the default 60, as designed |
| **Deduplication** | 30 simultaneous requests for a stale page: 30 `STALE` responses and **exactly one** `revalidation` invocation. Without dedupe the first run had 27 invocations |
| **Why the wait was long** (3 timed trials per setting) | `maxPollingInterval` 60 s (default): waits 32.7 / 42.7 / 57.5 s, mean **44.3 s**. 5 s: 1.6 / 3.8 / 1.1 s, mean **2.2 s** |
| Burst of 200 requests (40 parallel) then a stale request at once, the situation of the 2 min 21 s stall in the first run | consumed after 3.9 s with one invocation. **The stall did not reproduce** (one attempt) |
| Whole run | 45 `server` and 7 `revalidation` invocations, 0 failed, 0 exceptions; 21 distinct instances, 26 host starts |
| `Unable to create client for AzureWebJobsStorage` | seen once, during the restart of deploy 2 (1 of 26 host starts); 2 of about 20 in the first run. Cause still unknown |
| Cold start of the HTTP function | 4.5 to 4.75 s again (three first requests after idle) |
| Deployment time | about 2.5 minutes per package deployment |
| Cost | not reported yet for this run either; see below |
| Alert firing | not tested: the queues stayed empty, as they should |
| Storage transaction metric | not yet available when the resources were deleted; the cost of polling at 5 s is an estimate from list prices (see ADR-0010) |

### Cleanup (13:16 to 13:18 UTC)

Deleted one by one from the record above: metric alert, Function app, plan, Application Insights, Log Analytics workspace (purged with `--force`), storage account (with its role assignments), the action group, then the resource group. Verified: no resource of the run in the subscription, no soft-deleted workspace, the pre-existing groups `opennextjs-azure` and `NetworkWatcherRG` untouched.

### Still to do after this run

- **Next day:** read-only inventory of the subscription and the actual cost of **both** Azure runs. When the first run was deleted, the usage API showed 3 meters at 0.0000; this run's usage was not available at all yet. The ceiling was 5 USD per run; both ran well under 2 hours on scale-to-zero resources plus one always-ready instance, but the cost is an estimate until usage is reported.
- Decide the default for `revalidationPollingSeconds` ([ADR-0010](./decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group)).
- The alert has never fired; whether it does when a consumer stalls is untested.
- Nothing of sessions 8 and 9 is committed yet.

---

## 2026-11-06 (session 8): ISR revalidation, deduplication and options

### Done

- **Deduplication of revalidation messages** (`revalidation-dedupe.ts`, used by `queue.ts`): a request must win a claim, a Table row written with optimistic concurrency (create: 409 means lost; replace with the row's ETag: 412 means lost), before it enqueues. Window `REVALIDATION_DEDUPE_SECONDS` (default 60, 0 = off). Fails open on storage errors. Design and limits in [ADR-0010](./decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group).
- Bicep and `deploy`: `revalidationDedupeSeconds` (`--revalidation-dedupe-seconds`), `revalidationPollingSeconds` (`--revalidation-polling-seconds`, sets `AzureFunctionsJobHost__extensions__queues__maxPollingInterval`), `queueBacklogAlertThreshold` (`--alert-queue-backlog`, a metric alert on `QueueMessageCount`) and `alertActionGroupId`. All off or at the platform default.
- Tests: dedupe unit tests (17, including 50 simultaneous claims and an alternating known/unknown version), queue tests, two Azurite tests against the real Table Storage (50 simultaneous requests give one message; a race over an expired claim gives one more), and an E2E test (30 simultaneous requests for a stale page cause one or two regenerations).

### The first version was wrong, and the end-to-end test found it

The first design used the message's `lastModified` as the page version. The E2E test failed: 30 simultaneous requests still caused **6** regenerations (instead of 30 before, but not 1). Reproduced on the local stack: no dedupe error in the host log, one dedupe row with `version = 0`. Reading OpenNext (`adapters/cache.js`): in the server path `store.lastModified = _isStale ? 1 : _lastModified`, a **marker** (1 stale, 0 unset), not a version. Concurrent requests for one page reported 0 or 1, counted as different versions and took turns winning the claim. The unit tests had used realistic-looking but wrong `lastModified` values, so they passed.

Fix: the version is the **ETag** of the cached content (stable per page content, changes on regeneration); an unknown version is a wildcard decided by the window alone. A unit test now replays the alternating 0/1 pattern, and the E2E test stays as the guard.

### Verified

| Check | Result |
| --- | --- |
| Unit tests | 181 passed |
| Azurite integration tests | 9 passed (run three times in a row) |
| Local E2E | 28 passed (`default`, includes the stampede test) and 10 passed (`front-door`) |
| `az bicep build`, `az deployment group validate` against an empty group, with and without the new options | compile, both validate; `what-if` plans 18 resources with the alert |
| Lint, build, type check | pass |

### Not verified

- **Anything on Azure.** Nothing of this session was deployed. Whether the dedupe prevents the 27 regenerations on Azure, whether a lower polling interval shortens the 37 s, and whether the metric alert is accepted and fires: untested. The Azure run was finished and deleted in session 7.
- The cause of the 2 min 21 s stall (`Unable to create client for AzureWebJobsStorage`) is still unknown; the dedupe makes a stall cheaper (one message instead of dozens) but does not remove it.

### Next

Deploy once with the new defaults and with `--alert-queue-backlog` and a lower polling interval, repeat the burst of stale requests and look at the invocations in Application Insights ([Real Azure runs](../contribute/azure_runs.md): subscription, region, group, cost ceiling and time window needed). Nothing is committed yet.

---

## 2026-11-06 (session 7): Phase 1c, first real Azure run (finished, resources deleted)

### Plan (recorded before anything was created)

| Item | Value |
| --- | --- |
| Subscription | the maintainer's subscription (`<subscription-id>`), signed-in user is Owner |
| Region | japaneast (Flex Consumption supported; no region policy on the subscription) |
| Resource group | `rg-opennextjs-azure-1c`, **new**, created by this run. The pre-existing empty group `opennextjs-azure` (japaneast) is not touched |
| Layout | Single Function app, **no Front Door** (`frontDoor=false`) |
| Expected resources | 17 per `az deployment group what-if`: Application Insights, Log Analytics workspace, Storage account (+ `assets`, `cache`, `deploy-app` containers, `revalidation` queue, `tagcache` table), 3 role assignments for the app + 1 for the deployer (Blob data), Flex plan, Function app |
| Cost ceiling | 5 USD (estimate, not measured: expected cents). Stop and delete if it looks like it will be exceeded |
| Time window | 2 hours from the start of the run: started 2026-11-06T05:39:10Z, hard stop 2026-11-06T07:39:10Z. Stages: provision 20 min, deploy 20 min, verify 60 min, delete 20 min |
| Provider registration | `Microsoft.Insights` is not registered. Not registered by hand; ARM registers missing providers during a template deployment (Microsoft Learn: "What are the resource providers for Azure services"). The maintainer allowed it "if free"; no charge for registration is documented, but I found no page that says explicitly that it is free |
| Free pre-checks done | `az deployment group validate` succeeded; `what-if` listed the 16 resources above |
| Cleanup | Delete created resources one by one by name from the record below, delete the group only because this run created it, read-only inventory now and the next day |

### Record of created resources

All in resource group `rg-opennextjs-azure-1c` (japaneast), created by this run at 05:40 UTC. `Microsoft.Insights` was registered automatically by ARM during the first deployment.

| Type | Name |
| --- | --- |
| Resource group | `rg-opennextjs-azure-1c` (new, created by this run) |
| Storage account | `stonx1cdjj4tstk` (containers `assets`, `cache`, `deploy-app`; queue `revalidation`; table `tagcache`) |
| Log Analytics workspace | `log-onx1c-djj4tstkxq4ly` |
| Application Insights | `appi-onx1c-djj4tstkxq4ly` |
| App Service plan (Flex Consumption FC1) | `plan-onx1c-djj4tstkxq4ly` |
| Function app | `func-onx1c-djj4tstkxq4ly` |
| Role assignments on the storage account | Blob Data Owner, Queue Data Contributor, Table Data Contributor (app identity); Blob Data Contributor (the deploying user) |

### What the first real deployments taught

| # | Problem | Why local checks missed it | Fix |
| --- | --- | --- | --- |
| 1 | Deployment failed: `RoleDefinitionDoesNotExist`. I had typed the Storage Table Data Contributor id wrong | `az bicep build`, `az deployment group validate` and `what-if` all succeeded | Correct id taken from `az role definition list`; a unit test pins all four role ids |
| 2 | `deploy` could not upload static files: Owner on the subscription has no Blob data access and shared keys are disabled | Not reached yet when the first deployment failed; predicted from the design | Bicep parameter `deployerPrincipalId` assigns Blob Data Contributor to the deploying user; the CLI passes the signed-in user's object id. Upload worked on the second attempt |
| 3 | App started with 0 functions: `Cannot find module 'styled-jsx/package.json'` | Local runs executed the unzipped-from nothing directory, never the zip | see 4 and 5 |
| 4 | With symlinks kept in the zip: `Cannot find package 'next'` | Same | **Azure Functions (Flex Consumption) does not keep symbolic links of a deployed package**, and the pnpm layout is made of them. Zipping the link targets (the default) breaks Node's resolution of sibling packages, keeping the links gets them dropped |
| 5 | `fs.cpSync` had rewritten the relative links to absolute paths into the build machine's `.open-next/` | Locally those paths existed | `copyBundle` copies with `verbatimSymlinks` |
| 6 | | | `flattenPnpmNodeModules` turns the pnpm store into a plain tree (top-level copies, nested copies only for version conflicts); `assertNoSymlinks` refuses to package anything with a link left; the local stack now runs the unpacked zip, so the deployed artifact is what gets tested |

After these fixes the application started and serves traffic on Azure (06:08 UTC).

### Measured on Azure (single app, no Front Door, japaneast, Node 22, 2048 MB, max 20 instances)

| Measurement | Result |
| --- | --- |
| Whole run | 321 `server`, 34 `revalidation`, 5 `image` invocations; **0 failed, 0 exceptions**; 42 distinct instances over the run |
| HTTP cold start (client side) | 4.1 s after a settings restart, 4.25 s after about 4 minutes idle, 4.5 s after 11 minutes idle; up to 25.7 s for the very first request after a package deployment; warm 25 to 60 ms |
| Burst, 200 requests, 40 in parallel, SSR page | all 200; p50 393 ms, p90 880 ms, p95 4.5 s, p99 5.0 s, max 5.7 s; **17 instances**, one served 181 requests, 16 served one or two |
| Package deployment (`config-zip`, 32 MB) | about 3 minutes including the asset upload and the health check |
| `after()` with 2 s of work | `hold`: client waits 2039 ms; `detach`: 127 to 149 ms and the work still completes |
| Deferred work of 20, 90, 240 s after a `detach` response | 20 s and 90 s ran on time; 240 s lost (the idle instance was removed) |
| Queue consumption of an ISR revalidation | 1 s (warm), 5 s (from zero), 37 s (with an always-ready instance, probably polling backoff), and one stall of 2 min 21 s with 27 messages processed at once afterwards |
| `function:revalidation` always-ready | accepted by Flex |
| Template-managed settings | a redeploy restored `WAIT_UNTIL_MODE=hold` (it had been set to `detach` with `az`) |

Decisions and open questions that came out of it: [ADR-0006](./decisions.md#adr-0006-waituntil-via-response-stream) (measured), [ADR-0009](./decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default) (Azure result added), [ADR-0010](./decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group) (new). Azure facts: [Azure notes](../inner_workings/azure_notes.md) items 13 to 26.

### Also changed in this session

- `package`: `copyBundle` (links kept relative), `flattenPnpmNodeModules`, `assertNoSymlinks`, `zipDirectory` with `-y`; example app calls the CLI by path.
- Bicep and `deploy`: `deployerPrincipalId`, `waitUntilMode` (`--wait-until`), `revalidationAlwaysReady` (`--revalidation-always-ready`); role ids pinned by a test.
- Wrapper: `WAIT_UNTIL_MODE` (`hold` default, `detach`).
- Example app: routes `/api/after-long` for the deferred-work measurement.
- Tests: unit tests now 142 (flattening, symlink-preserving zip, role ids, wait-until mode, `copyBundle`, `assertNoSymlinks`).

### Cleanup (07:03 to 07:06 UTC)

Deleted one by one from the record above: Function app, App Service plan, Application Insights, Log Analytics workspace (purged with `--force`, so it does not stay soft-deleted), storage account (with its role assignments), then an action group `Application Insights Smart Detection` that Azure creates next to Application Insights and that was not in the template, then the resource group, which this run had created. Verified: no resource of the run anywhere in the subscription (0 matches), no soft-deleted workspace, and the pre-existing groups `opennextjs-azure` (empty) and `NetworkWatcherRG` were not touched.

### Still to do after this run

- **Next day:** read-only inventory of the subscription again, and look at the actual cost: usage was not reported yet when the resources were deleted (`az consumption usage list` returned nothing for the group). The ceiling was 5 USD; the resources ran about 1 hour 25 minutes and, being Flex Consumption (scale to zero) plus a small storage account and monitoring, the cost is expected to be cents, but that is an estimate, not a measurement.
- The items under roadmap 1d.
- `actionlint` and the first GitHub run of the CI workflow are still open from session 6.

### Verified on real Azure (06:08 to 06:09 UTC, `https://func-onx1c-djj4tstkxq4ly.azurewebsites.net`, no Front Door)

| Check | Result |
| --- | --- |
| SSR, 404, HEAD | pass |
| Cached page: second request `x-nextjs-cache: HIT` | pass (50 ms) |
| Static files through the asset resolver: type, immutable cache, ETag 304, HEAD length, `Range` 206 with exact bytes, suffix range, 416, `BUILD_ID` and unknown paths 404 | pass |
| `public/test.png`, content type and revalidating cache control | pass |
| Image optimization with `sharp` on Linux x64: WebP 64 px (250 bytes), resized PNG without WebP accept (2879 of 33814 bytes), 400 for a disallowed width and for a remote URL | pass |
| Streaming (`/slow`): headers and early content at 37 ms, late content at 3032 ms in a separate chunk, 4 chunks | pass |
| `revalidateTag`: cached value stable, new value after `POST /api/revalidate`, then cached again | pass (Blob + Table) |
| Queue-driven ISR: a stale page was regenerated within 6.5 s after the request that found it stale | pass; the consumer execution itself is not yet confirmed in Application Insights (ingestion lag) |
| `after()`: the client waits for the deferred work (total 2039 ms for 2000 ms of work) | confirmed on Azure, same as local (ADR-0006) |
| Missing source image | 500, same as local (known gap) |
| `az functionapp show --query "{state:state, host:defaultHostName}"` | both `null`: Flex apps keep their fields under `properties` |

---

## 2026-11-06 (session 6): CI

### Done

- `.github/workflows/check.yml`: job `check` (Node 22 and 24: frozen install, lint, build, type check, unit, Azurite integration, `az bicep build`) and job `e2e` (Node 22: `pnpm e2e:test`, uploads host logs of a failed run). Read-only token, no privileged triggers, `persist-credentials: false`, concurrency cancel. `.github/dependabot.yml` for actions and npm. Documented in [CI](../contribute/ci.md).
- Actions pinned to full SHAs after resolving the release tags with `git ls-remote`, checking that the commits are weeks old (checkout v7.0.1 from 2026-07-17, setup-node v7.1.0 and upload-artifact v7.0.2 from 2026-10-07) and that the inputs used exist in each `action.yml`. Only first-party actions; pnpm is installed from npm at the `packageManager` version.
- `scripts/local-stack.mjs`: `LOCAL_STACK_LOG_DIR` keeps the host logs after a run; unpacks the Core Tools zip itself when the binary is missing; stops every child on any exit (see below).
- The example's `package` script no longer depends on the workspace bin link.

### Verified

| Check | Result |
| --- | --- |
| YAML parses, every `run:` block passes `bash -n`, every `uses:` is a 40 hex SHA, no write permissions or privileged triggers | pass |
| Clean copy of the repo (no `node_modules`, no build output): `pnpm install --frozen-lockfile`, lint, build, type check, 123 unit tests, 7 integration tests, Bicep | all pass |
| `actionlint` | **not run**: downloading and running its binary was blocked in this session |
| Anything on GitHub Actions, Node 22 and 24, `ubuntu-latest` tool availability | **not run / not verified** |

### Problems found by the clean-copy dry run

| Problem | Cause | Fix |
| --- | --- | --- |
| Fresh install: `opennext-azure` bin not linked, so the example's `package` step would fail in CI | pnpm links bins at install time and `dist/` does not exist yet on a fresh checkout | Example calls the CLI by path |
| Fresh install: no `func` binary | Core Tools postinstall unpacks its zip with `extract-zip`, which stopped after two files on Node 26 without an error | `ensureFunc()` in the stack script unpacks the zip with `unzip`. Seen on Node 26 only; not seen on 22 and 24 (unverified) |
| A crash of the stack script left Azurite running and holding ports 10000 to 10002 | The `exit` handler removed the temp files but not the children; the first dry run crashed on the missing `func` | Children are stopped on `exit`, on uncaught errors and when a child cannot start |
| `LOCAL_STACK_LOG_DIR` had no effect when `pnpm e2e:test` ran (the CI failure-log artifact would have been empty) | Turborepo does not pass undeclared environment variables to tasks | `passThroughEnv: ["LOCAL_STACK_LOG_DIR"]` on the `e2e:test` task in `turbo.json` |

### Re-verified after the fixes (clean copy, Node 26)

- Crash test: with `func` made unexecutable the script reports `could not start app`, exits, and leaves no Azurite process, no bound port and no temp directory.
- With the `func` binary deleted on purpose, `pnpm e2e:test` restored it by itself and passed: 27 tests in `default`, 10 in `front-door`.
- With `LOCAL_STACK_LOG_DIR` set, `app.log` and `azurite.log` are saved after the run (the second E2E project overwrites the first project's files; a failing project keeps its own).
- No processes, ports or temp directories left after the runs.

The leaked Azurite from the first dry run (PID 32309) was stopped by the maintainer; this session could not do it.

### Next

Push to a remote and watch the first real run of `check` (and run `actionlint` first if wanted). Then Phase 1c, or the remaining local features (Pages Router fixture, `revalidatePath`, middleware).

---

## 2026-11-06 (session 5): automated tests

### Done

- New packages: `packages/tests-unit` (Vitest; `unit` and `integration` projects) and `packages/tests-e2e` (Vitest over HTTPS; `default` and `front-door` projects). New commands: `pnpm test`, `pnpm test:integration`, `pnpm e2e:test`; turbo tasks wired so E2E builds and packages the example first. Strategy page rewritten ([Testing](../contribute/testing.md)).
- Unit tests (123): converter, wrapper, asset resolver, tag cache, incremental cache, queue, revalidation converter/wrapper, image loader, manifest builder, packaging helpers. Storage is replaced by in-memory fakes.
- Integration tests (7): real Azure SDKs against Azurite on dedicated ports 10100 to 10102 (Blob round trips and real 404s, tag keys with every forbidden character, queue message format, asset resolver byte ranges, image loader).
- E2E tests (27 + 10): the real Functions host with Azurite over HTTPS, started by the test run. TLS is verified against the run's own certificate. Chunk timings prove streaming; the host log proves the queue consumer ran.

### Results

| Suite | Result |
| --- | --- |
| Unit | 123 passed |
| Integration | 7 passed, three runs in a row |
| E2E `default` | 27 passed |
| E2E `front-door` | 10 passed |
| Lint, build, typecheck | pass |
| Leftover processes, ports, temp files after the runs | none |

### Bugs the tests found (both fixed)

| Bug | How it showed | Fix |
| --- | --- | --- |
| Wrapper race: a handler that streams without awaiting anything and returns could win `Promise.race` against the headers promise; the response was then built from the handler's empty return value, losing the streamed body and the cookies | Three wrapper unit tests failed (empty body, no Set-Cookie). Real traffic did not hit it because real handlers await, so it was latent | Decide the path by whether `writeHeaders` was called, not by which promise won |
| After `revalidateTag`, the tagged page was re-rendered on every request for up to one second | E2E `revalidateTag` test: the value changed again immediately after the first re-render. Blob `Last-Modified` has one-second resolution while tag revalidation times are in milliseconds, so a page written in the same second looked older than the revalidation | The cache stores its write time in milliseconds as blob metadata (`writtenatms`) and prefers it; blobs without it (prerendered cache from deploy) fall back to `Last-Modified`. Unit and integration tests added |

Also fixed in tests: an E2E assertion that ignored React's `<!-- -->` text separators, and a leaked 30 second timer in the E2E stack helper that kept the test process alive.

### Known gaps pinned by tests

- A missing source image answers 500; `image.test.ts` has an `it.fails` that will flag itself once it answers 404.
- `after()` makes the client wait for the deferred work (ADR-0006); `after.test.ts` documents it and must be updated with the ADR.

### Not done

CI (GitHub Actions with SHA-pinned actions needs the pins to be looked up and verified; deliberately not written from memory), Azure E2E, poison-queue end-to-end, `revalidatePath`, middleware, Server Actions, Pages Router fixtures. The same race in a race-prone spot upstream (second-granularity `Last-Modified` versus tag times) probably exists in the OpenNext AWS S3 override too; not verified, not reported.

### Next

CI workflow, then the remaining local features (Pages Router fixture, `revalidatePath`, middleware), or Phase 1c on real Azure (needs subscription, region, resource group, cost ceiling and time window).

---

## 2026-11-06 (session 4): single-app implementation

### Done

Implemented what [ADR-0009](./decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default) decided.

- `opennext-azure package` now builds one app (`.open-next-azure/app.zip`, 37.8 MB for the example, down from about 49 MB for three zips): generated `main.mjs` with per-bundle `chdir` and `server` loaded last, Azure SDKs installed once at the root, `host.json`, `assets-manifest.json`. Split into `package-app.ts`, `deploy.ts`, `assets-manifest.ts`, `index.ts`. The three-app layout was removed.
- New `asset-resolver` override: serves `/_next/static` and `public/` files from Blob by exact manifest path (`HEAD`, `If-None-Match`, single byte range).
- Wrapper: `FRONT_DOOR_ID` / `X-Azure-FDID` check (constant-time, case-insensitive) before any other work.
- `scripts/local-stack.mjs` runs the single app on `https://localhost:7071`; uploads assets with content types.
- `main.bicep` rewritten: one Function app, private `assets` and `cache` containers, no public blob access, Front Door behind a `frontDoor` parameter (edge cache for `/_next/static/*`, access restriction + `FRONT_DOOR_ID`). `deploy` takes `--front-door`.
- Docs updated: Get started, architecture, overrides, local run, ADR-0009, roadmap, compatibility, testing, common issues.

### Verified (local, Functions host, over HTTPS; nothing on Azure)

| Check | Result |
| --- | --- |
| Full regression on the single app | pages, 404, streaming (ttfb 0.02 s, total 3.03 s), image to WebP, `revalidateTag`, ISR via the queue trigger (`HIT`, `STALE`, `HIT`; consumer ran and succeeded), `after()` (2.03 s) all as before |
| Static files | 200 with `text/javascript` and `image/png`, immutable cache for `_next/static`, 304 on matching ETag, HEAD, 206 and 416, 404 for unlisted paths and for `BUILD_ID`, POST not intercepted |
| Front Door id (stack started with `FRONT_DOOR_ID`) | 403 without header, empty or wrong id on server, static, image and POST; 200 with the right id in any letter case |
| `az bicep build` | compiles without warnings (default parameters) |
| Lint, build, typecheck | pass |
| Cleanup after every stop | no processes, ports or temp files left |

### Problems found and fixed

| Problem | Cause | Fix |
| --- | --- | --- |
| Static files 404 although in Blob | In a monorepo OpenNext nests the app in the server bundle, so the runtime cwd is `server/examples/app-router`, not the bundle root; the cwd-relative manifest lookup found nothing and logged an error | The generated entry sets `ASSETS_MANIFEST_PATH` to an absolute path |
| `/BUILD_ID` was served | OpenNext copies it into `assets` for its own tooling | Excluded from the manifest |
| Stack not stopped by the first `kill` | Signal went to a wrapping shell | Signal the node process itself; recorded in Common issues |

### Not verified

Everything on Azure: deployment, the Bicep with `frontDoor=true` (compiled only), the `AzureFrontDoor.Backend` access restriction on Flex, cold start and scale-out of the single app, and the cost of serving static files through the function. No automated tests exist for any of this yet.

### Next

Phase 1c, the first real deployment. It needs the subscription, region and resource group name from the maintainer, a cost ceiling and a time window ([Real Azure runs](../contribute/azure_runs.md)). Cheap local follow-ups before that: tests for the new code (Phase 2), `revalidatePath`, Pages Router fixture, 404 for missing images.

---

## 2026-11-06 (session 3): Phase 1b, deployment shape

### Done

- Queried the Azure retail prices API for Front Door. Standard base fee is 35 USD per month per profile (Premium 330), requests and transfer extra ([Azure notes](../inner_workings/azure_notes.md#pricing)).
- Ran the experiment from [ADR-0009](./decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default): the three built bundles loaded into one Functions app and exercised under Core Tools over HTTPS with Azurite.
- Wrote ADR-0009, marked ADR-0002 superseded, resolved the open question in ADR-0001, and restructured roadmap 1b.

### Verified (local, Functions host)

- All checks that passed with three apps pass identically in one app: SSR, ISR page, 404, streaming (first bytes 0.04 s, late part 3.0 s), `revalidateTag`, image resize to WebP on `/_next/image`, `after()`, and queue-driven ISR regeneration (2 consumer executions, both succeeded, `STALE` then `HIT`).
- Co-location cost, fresh processes, 3 runs each: module load 59 ms (server only) vs 72 to 76 ms (all three); RSS 87 MB vs 91 MB.

### Learned

- The `globalThis` clash that justified three apps (ADR-0002) did not occur; that reasoning was an inference from reading source and was wrong. The external review's claim held.
- The one real constraint: the revalidation adapter reads `./prerender-manifest.json` relative to `process.cwd()` at import time, so a combined entry point must `chdir` into each bundle before importing it and load `server` last.

### Not verified

Anything on real Azure: cold start, scale-out, cost of single vs split, `X-Azure-FDID` / service-tag restriction on Flex, `AssetResolver` cost. The numbers above are local and say nothing about Azure cold start.

### No code changed

The CLI, Bicep and local stack still implement three apps plus Front Door. The follow-up implementation tasks are listed in the roadmap under 1b. The experiment's temporary files were removed; no processes, ports or certificates were left behind.

### Next

Implement the single-app layout (package, local stack, Bicep with optional Front Door, asset resolver, `X-Azure-FDID` check), then Phase 1c. Phase 1c needs subscription, region and resource group from the maintainer.

---

## 2026-11-06 (session 2): Phase 1a, local Functions stack

### Done

- Added `azure-functions-core-tools` 4.16.0 and `azurite` as workspace dev dependencies (no global install). The Core Tools postinstall did not unpack its zip under Node 26; unpacked by hand (see [Common issues](../troubleshooting.md)).
- Wrote `scripts/local-stack.mjs` (`pnpm local:stack`): per-run self-signed certificate, Azurite, storage setup, upload of `.open-next/assets` and `.open-next/cache`, three Function apps over HTTPS, cleanup on exit. On non-Linux hosts the image app runs from a temp copy with host-OS sharp binaries.
- Extended `examples/app-router` with routes that each test one behavior: `/isr`, `/slow`, `/tagged`, `/api/revalidate`, `/api/after`, and `public/test.png`.

### Verified (local, under the real Functions host, over HTTPS)

| Check | Result |
| --- | --- |
| server and image apps register and serve | SSR, ISR page, 404 correct; cache `HIT` on repeat |
| Streaming (`/slow`) | First bytes at 0.15 s; the Suspense part arrives at 3.0 s in a separate chunk |
| ISR regeneration through the queue | Consumer logged `Executed ... Succeeded` for each stale serve; page timestamp advanced; response went `STALE` then `HIT` |
| `revalidateTag` (`/tagged`) | Same value on two reads, new value after `POST /api/revalidate` (Blob + Table) |
| Image optimization | 128x128 source resized to 64x64 (PNG), WebP when `Accept` allows it; 400 for width 999 and for a remote URL |
| `after()` (`/api/after`) | Deferred work completed (2004 ms later) but the client request took 2.14 s |
| Cleanup | After Ctrl+C: no processes of this repo, no ports bound, no temp directory, certificate deleted |

### Problems found and fixed

| Problem | Cause | Fix |
| --- | --- | --- |
| Revalidation app: `queueTrigger` not registered | `host.json` had no `extensionBundle`; the mocked tests could not see this | `package` writes `extensionBundle` `[4.*, 5.0.0)` |
| Images returned unresized with no error | OpenNext installed sharp without any `@img/*` binary: on a macOS host `npm install --os=linux --cpu=x64` drops glibc-only optional packages unless `--libc` is set. sharp then fails to load and the optimizer serves the original image | Config `install: { os: "linux", arch: "x64", libc: "glibc" }`; `package` now **fails** if `@img/sharp-linux-x64` or its libvips is missing (negative test done). This would have shipped unoptimized images to Azure unnoticed |
| ISR could not run locally over HTTP | The revalidation adapter fetches `https://<host>` | HTTPS local stack (B14) |
| Leftover temp directory with certificate after a fast stop | Cleanup ran only on signals | Also clean on `exit` |

### Open findings (not fixed yet)

1. **`waitUntil` holds the client for the full deferred time** (+2 s measured). [ADR-0006](./decisions.md#adr-0006-waituntil-via-response-stream) now records this. The right fix depends on whether Flex keeps the instance running after the body ends, which only a real deployment can answer.
2. A missing source image returns 500; it should be 404.
3. `Content-Length` is still sent on non-streamed responses (B6 gap not closed).
4. Proof that ISR regeneration is done by the consumer and not in-process needs a server-side log assertion (B1).

### Not done in Phase 1a

Pages Router fixture, `revalidatePath`, middleware, Server Actions. No Azure resources were created.

### Next

Phase 1b: decide the deployment shape by measurement (3 apps vs 1 app, Front Door fee). Phase 1c needs the subscription, region and resource group from the maintainer. Cheap local follow-ups first: `revalidatePath`, Pages Router fixture, the 404 for missing images.

---

## 2026-11-06 (session 1, continued): roadmap revision after external review

### Input

A written review of the first roadmap, produced by another session from verification of an earlier Azure adapter on real Azure. Its Azure measurements and platform facts were **not reproduced here**, so they are recorded as *reported* in [Azure notes](../inner_workings/azure_notes.md).

### Decisions by the maintainer

- The review's section on reusing earlier carry-over material (specs, independent test suites, receipts) is **not adopted**. Nothing from it was imported, and no `provenance.md` is kept.
- Everything else was accepted, with two adjustments: the one-app-versus-three-apps question and the Front Door fee are turned into measurements in Phase 1b rather than decided now.

### Done

- `git init -b main` (no commits yet).
- Rewrote the [roadmap](./roadmap.md): Phase 1 split into 1a local Functions stack, 1b deployment shape, 1c first real deployment; added security, version-policy, rollback, readiness, `npm pack` and cross-platform install items.
- [ADR-0002](./decisions.md#adr-0002-one-function-app-per-opennext-component) marked provisional and under re-evaluation; open question on Front Door cost added to ADR-0001; naming rule added to ADR-0005.
- Added B1 to B14 behavioral test cases to [testing](../contribute/testing.md#required-behavioral-test-cases), added [Real Azure runs](../contribute/azure_runs.md) and [Azure notes](../inner_workings/azure_notes.md), added a Known gaps section to [Compatibility](../compatibility.md), updated `AGENTS.md`.

### Checked against the current code

Gaps confirmed by reading the code, not by running it: `Content-Length` not removed on streams (B6), no error-detail gating (B8), no explicit bodyless-status handling (B9), static assets routed by name pattern (B10), no optimized-image cache or platform guard (B11), no cookie sanitizing (B5).

### Not verified

Every reported Azure fact. No code was changed in this session step.

### Next

Phase 1a: run the packaged apps with Azure Functions Core Tools + Azurite (needs Core Tools installed).

---

## 2026-11-05 (session 1)

### Done

- Studied `@opennextjs/aws` 4.1.15: override interfaces (`wrapper`, `converter`, `incrementalCache`, `tagCache`, `queue`, `imageLoader`), the build output layout (`server-functions/default`, `image-optimization-function`, `revalidation-function`, `assets`, `cache`) and how the config is compiled.
- Checked Azure Functions constraints in Microsoft Learn: Node v4 model, HTTP streams need `@azure/functions` >= 4.3.0 and runtime >= 4.28, Flex Consumption supports Node 22/24 and package deployment through a blob container.
- Built the prototype package: overrides, CLI (`package`, `deploy`), Bicep template.
- Converted the repository to a pnpm + Turborepo monorepo, added Biome and Changesets configuration, and an `examples/app-router` app.
- Wrote this documentation set, modeled on the OpenNext docs (structure taken from the public site; the docs source is not in the `opennextjs-aws` repo).
- Added `AGENTS.md` / `CLAUDE.md` so future Claude sessions load the project rules, and `LICENSE` (MIT).
- Made Biome lint clean (0 errors) and re-ran the Azurite smoke test after the refactor: results unchanged.

### Verified (locally, no Azure resources used)

- `tsc` type check passes; `az bicep build` compiles the template without warnings.
- `open-next build` succeeds for a Next.js 15.5.29 app using the Azure overrides.
- The built server handler, called with a real `HttpRequest`, serves a dynamic page, an ISR page and a 404, with streamed bodies.
- With Azurite: the ISR page is `MISS` on the first request and `HIT` on the second (Blob cache); the Table tag cache reports revalidation, newer pages and stale tags correctly; the Queue message is plain JSON and the revalidation wrapper throws on failure so the host retries.
- In the monorepo: `pnpm build`, then `open-next build` and `opennext-azure package` in `examples/app-router` produce `server.zip` (about 30 MB), `image.zip` (about 19 MB, contains `sharp`) and `revalidation.zip` (about 0.3 MB).

### Problems found and fixed

| Problem | Cause | Fix |
| --- | --- | --- |
| Types resolved to `any` | `@opennextjs/aws` `exports` map expects extensionless type paths | Import `@opennextjs/aws/types/overrides` without `.js` |
| `open-next build` crashed in config compile (`__dirname` redeclared) | Azure SDKs bundled into the config by esbuild | [ADR-0007](./decisions.md#adr-0007-azure-sdks-are-imported-at-runtime-only) |
| `import "@opennextjs/aws/types/global"` broke bundling | Side-effect import survived compilation | Use `import type {} from ...` |
| `sharp` missing from `image.zip` | `npm install` pruned it | [ADR-0008](./decisions.md#adr-0008-packaging-never-runs-npm-install-inside-an-opennext-bundle) |
| `opennext-azure` bin not linked in the example | pnpm links bins at install time, before `dist` existed | Reinstall after the first build; see [Common issues](../troubleshooting.md) |

### Not verified (carried into Phase 1)

Everything that needs Azure or the Functions host: deployment, streaming through Functions and Front Door, `waitUntil`, queue-triggered revalidation, image optimization at runtime, RBAC, cold start.

### Next

1. Phase 1: deploy `examples/app-router` to the user's Azure subscription (confirm subscription, region and resource group name first, because this creates billable resources).
2. Install Azure Functions Core Tools to run the stack locally.

## Session 31 (2026-11-08): package name decided, rename done

- The maintainer picked a name. `nextjs-azure` is taken on npm (0.0.4, another author) and uses the Next.js name. `opennext-azure` is an unpublished name (publishability unknown). Decision: **`opennext-adapter-azure`** (ADR-0015, name accepted; positioning still open). The OpenNext repository is MIT and its README has no naming or trademark policy; whether SST holds a trademark is not checked, so P5 stays recommended before publishing.
- R1 done: `package.json` names (package, monorepo, example dependency), `open-next.config` examples, docs, README (now states it is not an official OpenNext package), Bicep comment, license check filter. The `opennext-azure` bin name and the directory `packages/open-next-azure` are unchanged. Azure resource tags `purpose=opennextjs-azure-e2e` are unchanged on purpose (the cleanup job finds groups by them).
- New unit test `name.test.ts` checks the package name and that the old name is not left in the package source, the example or the docs outside the history files.

### Documentation restructured after the OpenNext docs (2026-11-08)

- README rewritten in the style of the `opennextjs-aws` README (description, features checklist, configuration, cold start, contribute, testing, acknowledgements), with the status and "not an official OpenNext package" notice at the top and each feature marked with how far it was checked.
- `docs/` follows the sidebar of opennext.js.org/aws (only that site and README were read): Overview (`docs/README.md`), Getting started, Compatibility, Configuration (`config/README.md`, `simple_example.md`, `reference.md`, one page per override under `config/overrides/`), Comparison (new), How does it work?, FAQ, Troubleshooting (renamed from `common_issues.md`), Contributing (`contribute/README.md`). `config/overrides.md` was split into the override pages; no content was dropped.
- Fixed in passing: the options table of `get_started.md` was split by a blank line, and its status note said that no Azure deployment had been verified.
- Not done: the pages "Routing layer", "Main components", "Migration" and "Reference implementation" of the official site have no counterpart because there is nothing true to say yet.

### Direction confirmed (2026-11-08, later)

ADR-0016 (a Next.js adapter without OpenNext) was proposed and withdrawn the same day: the maintainer confirmed that the goal is the **Azure version of `opennextjs-aws`**, to use Next.js on Azure. The project stays an OpenNext adapter built on `@opennextjs/aws`; ADR-0011, ADR-0012 and ADR-0015 stand, and the docs keep the OpenNext structure. The earlier wish not to "depend on" OpenNext was a misunderstanding on my side; it should not be read as dropping `@opennextjs/aws`.

## Session 33 (2026-11-08): tag cache reads in batches

- Table Storage allows 15 comparisons in one `$filter` (Microsoft Learn, Query Entities / Querying tables and entities), so a query asks for 14 row keys plus the partition key. `tag-cache.ts`: one tag stays a point read; several tags become one query per 14 keys, in parallel, with absent tags remembered for the request. No tag limit (the official DynamoDB implementation refuses more than 100).
- Tests: 6 unit tests (batch size, 150 tags, request cache, failure not hidden) with a fake table that rejects filters over 15 comparisons, and 1 integration test with 40 tags on Azurite. Unit 233, integration 10 pass; local E2E run below.
- **Unverified:** speed against point reads on Azure. A query with OR on row keys may cost more than 14 point reads; measure before claiming a gain.
- CI check on `ae2bf59` passed. The two Dependabot PRs for react and react-dom 19.3.1 fail their `check` run (not yet looked at).
- react and react-dom 19.1.0 to 19.3.1 together (catalog). The two Dependabot PRs failed because each bumped only one of the pair ("Incompatible React versions" at build). `dependabot.yml` now groups `react` and `react-dom`. Verified (local): build, unit 233, local E2E 50 + 10 + 1 on Next.js 15.5.29. Not run on Next.js 16 locally or on Azure.

## Session 34 (2026-11-08): module load time and a Next.js version guard

- **Measured (local, Node 26.13 on a Mac, warm disk, 5 runs each):** importing `@azure/storage-blob` about 70 ms, `@azure/data-tables` about 62 ms, `@azure/storage-queue` about 65 ms, `@azure/identity` about 78 ms, `@azure/functions` about 6 ms; all four storage and identity SDKs together about 125 ms (they share dependencies). Against a cold start of 4.1 to 4.5 s measured on Azure, this is a small part. They are already loaded lazily on first use. Not measured on Azure (Node 22, a slower file system after a deployment). No change made.
- `package` now refuses a Next.js version outside the `next` peer range (read from the package's own `package.json`, no new dependency). It reads the version the app resolves, accepts the range grammar of the peer range (including bounds such as `<16`), only warns when the version cannot be read, and `--allow-unsupported-next` overrides it. A first version failed on `<16` because bounds were parsed as full versions; the unit test with the real range found it. Unit 256 pass; local E2E 50 + 10 + 1 pass (the E2E packages the example with Next.js 15.5.29).
- Under pnpm scripts `NODE_PATH` can make another `next` resolvable; for an app that has its own `next`, its copy is found first. Not tested with a hoisted layout where the app has none.

## Session 35 (2026-11-08): Server Actions encryption key (B12)

- Source: the Next.js data-security and self-hosting guides (read by a research agent, 2026-11-08): the key is per build by default, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64 of 16, 24 or 32 bytes) set at build time keeps it stable and is embedded in the build output. Not documented there: whether `deploymentId` skew protection covers Server Action requests (the reference page was not read).
- The build output holds the key in `server-reference-manifest.json` (field `encryptionKey`, 44 characters here). `package` now reads it: no warning without actions; "unset" when the variable is not set in the packaging environment; "differs" when it is set and not equal to the embedded key. Checked with four real builds of the example (built without key, with key, packaged with the same, another and no key): the warnings appear exactly in the cases above. Unit 262 pass.
- Limit: the packaging environment may differ from the build environment, so "unset" is a hint, worded as such. Whether a stable key fixes a page opened across two deployments was not reproduced here, and nothing was run on Azure.

## Session 36 (2026-11-08): Pages Router `fallback: true`

- New example page `pages/pages-fallback/[slug].js` and two E2E cases: an unknown slug gets the loading shell (HTML without the content), requesting `/_next/data/<buildId>/pages-fallback/<slug>.json` (build id taken from the shell) returns 200 and builds the page, then the HTML shows the full page; `notFound` gives 404 on the data URL. Local E2E: 52 + 10 + 1 pass (Next.js 15.5.29). Not run on Next.js 16 locally (the CI matrix does), and not on Azure.
- The 404 case checks the data URL only, not what a browser shows. A browser test is not part of the suite.
- The roadmap item `app-pages-router` was an unclear label. What can be said: the example app already has `app/` and `pages/` side by side, and the whole E2E run (App Router and Pages Router cases) passes against it. Whether that is what the label meant was not checked in an official source, so the docs say so and claim only the coexistence.

## Session 37 (2026-11-08): Azure run, plan written before starting

- **Approved by the maintainer (2026-11-08):** resource group `opennextjs-azure-fjtd` in japaneast (it existed before, empty, no tags: it is **not deleted**; only resources created by this run are deleted, by name), time window 3 hours, cost ceiling 500 yen, no Front Door. Subscription: the maintainer's.
- **Start 10:58 JST (01:58Z). Hard stop 13:58 JST (04:58Z).** Stage deadlines: provision and deploy by 11:30; verify by 12:30; delete by 13:00; read-only inventory right after, and again on 2026-11-09.
- **Plan:** deploy `examples/app-router` with `--always-ready 1 --revalidation-polling-seconds 5` and the name `onxfjt1`; run the remote E2E (`e2e:remote`) including the new cases (Pages `fallback: true`, cookies, `'use cache'`, remote images are skipped in remote mode); record the deploy warm-up output and the first-request time; look at Application Insights for the sampling setting. Not planned: Front Door (35 USD per month base fee).
- **Resources created (recorded as they appear):** see below.
- **Created (11:01 JST):** in `opennextjs-azure-fjtd`: `Microsoft.Web/sites` `func-onxfjt1-pb7hlwxyvanyk`, `Microsoft.Web/serverFarms` `plan-onxfjt1-pb7hlwxyvanyk`, `Microsoft.Storage/storageAccounts` `stonxfjt1pb7hlwxy`, `Microsoft.Insights/components` `appi-onxfjt1-pb7hlwxyvanyk`, `Microsoft.OperationalInsights/workspaces` `log-onxfjt1-pb7hlwxyvanyk`. Deploy took about 3 minutes (10:58 to 11:01). With `--always-ready 1`, the warm-up request answered HTTP 200 after 0.3 s on the first attempt.
- **Remote E2E (11:03 JST, Azure, commit 26e3574 content, Next.js 15.5.29): 47 passed, 5 skipped** (the skipped ones need the local host log or a local HTTPS fixture server), 24 s in total. New in this run on Azure: Pages `fallback: true` (shell, data JSON builds the page, 404), the cookies case, `'use cache'` with `revalidateTag`, the Server Actions cases, the poison-free ISR cases. Which of the 47 are new relative to the earlier Azure runs (35 and 41 passed) was not itemized.
- **Warm latency from a Mac in Japan (3 requests each):** `/` 95 to 138 ms, `/isr` 117 to 150 ms, `/pages-ssr` 95 to 106 ms, `/blog/a` 94 to 99 ms (time to first byte; total within 1 ms of it).
- **App settings on the deployed app:** `WAIT_UNTIL_MODE=hold`, `OPENNEXT_STATIC_ETAG=true`, no sampling override (platform default sampling, as designed).
- **Application Insights:** at 11:09 JST `traces` had 69 rows and `requests` 0; at 11:13 `requests` had 114 and `traces` 414. So request telemetry arrives, only later than traces (an ingestion delay of several minutes, longer than the one to three minutes noted before). With the default sampling and `excludedTypes: "Request"`, 114 request rows for the 60 or so requests of the E2E run, the idle test and the curls is plausible; the exact number of requests sent was not counted, so "requests are not sampled" is not proven by this run.
- **Idle test (always-ready 1):** after 10 minutes without traffic the first requests answered in 170 ms (`/`), 217 ms (`/isr`) and 116 ms (`/pages-ssr`). Without always-ready the earlier measurements were about 4.1 to 4.5 s and up to 25.7 s right after a deployment. One instance, one measurement, from one location: a first measurement, not a guarantee.
- **Deleted (11:13 JST), one by one by name, from the record above:** `func-onxfjt1-pb7hlwxyvanyk`, `plan-onxfjt1-pb7hlwxyvanyk`, `appi-onxfjt1-pb7hlwxyvanyk`, `log-onxfjt1-pb7hlwxyvanyk`, `stonxfjt1pb7hlwxy`, plus `Application Insights Smart Detection` (an action group that Application Insights created by itself; the group was empty before the run). The resource group `opennextjs-azure-fjtd` was **kept**, as agreed. Read-only inventory right after: empty, and no role assignment scoped to it. A deleted Log Analytics workspace stays soft-deleted for a while (name reserved, not billed as far as known; not checked). Next-day inventory is still to do (2026-11-09).
- **Cost:** the run lasted about 15 minutes (10:58 to 11:13 JST) against a window of 3 hours and a ceiling of 500 yen. No figure from Azure Cost Management yet (it lags); the always-ready instance of 2 GB for 15 minutes is a few yen at the list price I know of (not re-queried today). To be filled in after 1 to 2 days.

## Session 38 (2026-11-08): Next.js 16 `proxy` and `cacheComponents` (local)

- Method: a temporary git worktree with `next` 16.4.5 in the catalog (the main checkout and its lockfile were not touched; the worktree and the processes were removed afterwards).
- **`proxy`:** `middleware.js` renamed to `proxy.js` (`export function proxy`). `open-next build` printed `Proxy (Middleware)`, bundled the middleware function, and the whole local E2E passed: 52 + 10 + 1. So OpenNext 4.1.15 handles the new file name with these overrides. The repository's example still uses `middleware.js`, so CI does not cover `proxy.js`; keeping both is impossible in one app, and a per-version rename is not done.
- **`cacheComponents: true` on the existing example fails to build** with 9 errors, all "Route segment config `dynamic` is not compatible with `nextConfig.cacheComponents`" (also `partialPrefetching` should be set explicitly, a warning). So a small separate app (`app/page.js` with a `'use cache'` function tagged `cc-demo`, a `connection()` component in Suspense, and a `revalidateTag` route) was built with `open-next build`, packaged, and run on the local stack: the route is a partial prerender; two requests returned the same cached timestamp and different live timestamps; after `POST /api/revalidate` the cached timestamp changed. Response had `x-nextjs-postponed: 1` and `cache-control: private, no-cache, no-store`. I printed full page bodies by mistake while testing; nothing sensitive was in them.
- Not done: chunk timing for the dynamic part, `cacheLife` expiry, `remote` and `private` caches, an E2E case in CI (it needs a second example app and a Next.js 16 only configuration), Azure.

## Session 39 (2026-11-08): standalone spike without `@opennextjs/aws` (ADR-0016)

- Direction taken from the maintainer's latest instruction (implement without handling `@opennextjs/aws`). ADR-0016 rewritten as accepted for a spike; the spike is `examples/standalone` plus `scripts/standalone-local.mjs`; the current package is unchanged.
- Result and findings: see "Spike results" in ADR-0016. E2E against the spike: 43 passed, 4 failed (differences listed there), 5 skipped. Nothing was run on Azure.
- Mistakes on the way, corrected: I printed full page bodies by accident once more earlier today; I first blamed Node's `fetch` for a 304 that was lost because the file's ETag had changed after repackaging, then re-measured with the current ETag and `fetch` still answered 200 where `http` answers 304; a first E2E run showed ISR failures that came from stale storage of the previous run (storage is now emptied per run).
- Test client changes (apply to every run): `http.ts` can speak plain http to loopback and sends a Content-Length; `setup-remote.ts` accepts `http://localhost` only.

## Session 40 (2026-11-08): Azure run of the standalone spike, plan written before starting

- **Conditions:** the same as the run earlier today, restated by me and followed by the maintainer's "go ahead with the Azure check" (the group name, 3 hours, 500 yen were in my question; they were not typed again by the maintainer): resource group `opennextjs-azure-fjtd` in japaneast (pre-existing, empty; it is **kept**, only the resources of this run are deleted, by name), no Front Door, the maintainer's subscription. Window 3 hours; cost ceiling 500 yen.
- **Start 13:33 JST (the 13:00 first written was a guess made before the clock was read). Hard stop 16:33 JST.** Deadlines: provision and deploy by 14:15, verify by 15:15, delete by 15:45, read-only inventory right after, and again on 2026-11-09.
- **Plan:** deploy `examples/standalone` (built with `--linux` for the sharp binaries) on the infrastructure of `packages/open-next-azure/infra/main.bicep` (name `sfjt1`, no always-ready), with `az functionapp deployment source config-zip`. Measure: first request after the deployment, the first request after about 10 minutes idle, the remote E2E (`e2e:remote`), the host's logs and Application Insights for errors. Then, if time allows, `alwaysReadyInstances=1` and the same measurements. Not planned: Front Door, load tests.
- **Resources created:** see below, recorded as they appear.

- **Created (13:34 JST), in `opennextjs-azure-fjtd`:** `Microsoft.Web/sites` `func-sfjt1-rnrva3c4gltoc`, `Microsoft.Web/serverFarms` `plan-sfjt1-rnrva3c4gltoc`, `Microsoft.Storage/storageAccounts` `stsfjt1rnrva3c4`, `Microsoft.Insights/components` `appi-sfjt1-rnrva3c4gltoc`, `Microsoft.OperationalInsights/workspaces` `log-sfjt1-rnrva3c4gltoc`.
- **Results:** see "Spike results on Azure" in ADR-0016 (E2E 43 passed, 4 differences, 5 skipped; cold start after idle 2.5 s; two Azure-only faults found and fixed).
- **Deleted (14:00 JST), one by one by name:** the five resources above and `Application Insights Smart Detection` (an action group created by Application Insights). The resource group was kept as agreed. Read-only inventory right after: empty, no role assignment. The inventory of the next day (2026-11-09) and the Cost Management figure are still to do.
- Mistakes: I first suspected the proxy (`fetch`) for the lost 304, then the wrong thing again for the middleware 500 (I added `Host`, then tried an undocumented `trustHostHeader`) before reproducing it locally with `x-forwarded-proto: https` and reading Next.js's code; my own curl test with a shell variable made several local "400" results that were my command's fault.

## Session 41 (2026-11-08): standalone spike, round 2 (local)

- Added: `waitUntil` through Next.js's request context with a hold; `prime.mjs`; a complete `sharp` copy; `require` without `node:`. Details and numbers: ADR-0016, "Follow-up of the same day".
- Next.js 16.4.5 trial in a temporary worktree (removed afterwards): found the Turbopack `node:fs` failure and the incomplete `sharp` trace. Mistakes on the way: the worktree had no Functions Core Tools binary (copied from the main checkout) and `webpack` as a builder did not build this app (`node:crypto` unhandled scheme), which I did not pursue.

## Session 42 (2026-11-08): migration, stage 1 (ADR-0017)

- New package `packages/next-on-azure` (provisional name, private): `withAzure()` config helper, cache handlers (`cache-handler`, `cache-handlers`) and the Functions entry as runtime files, CLI `package` and `prime`; code moved by copy from the old package (flattening, version check, Server Actions key check, warm-up, cookies). The old package and its tests are untouched.
- `examples/standalone` now uses the package (its local copies are deleted); `scripts/standalone-local.mjs` runs `.next-azure/app`.
- Tests: ported unit tests for the moved modules (47), new unit tests for `withAzure`, the packaging helpers, `prime` and both handlers with a fake storage (checked by breaking the tag comparison: 4 tests failed, restored: all pass), and an integration test of both handlers on Azurite. Totals: unit 343, integration 13. Local E2E against the package-built example: 44 passed, 3 failed (the same Next.js behavior differences as the spike), 5 skipped. The existing OpenNext E2E still passes (52 + 10 + 1).
- Lint findings handled: a function named `useLinuxSharp` was read as a React hook (renamed); the `node:` prefix rule is switched off for the runtime `.cjs` files on purpose (see `azure-storage.cjs`).
- Not done in this stage: Bicep template and `deploy` for the new layout (stage 2), CI jobs (3), docs and name (4), removal of the old package (5).

## Session 43 (2026-11-08): migration, stage 2 (code; no Azure run yet)

- `packages/next-on-azure/infra/main.bicep`: derived from the old template; removed the assets container, the queue and everything around revalidation, the deployer role, the queue alert and the OpenNext settings; kept storage (container `cache`, table `tagcache`, `deploy-app`), the Flex Consumption app, Application Insights, the optional Front Door, always-ready for HTTP and `fullTelemetry`. The Queue Data Contributor role is kept on purpose (the host may use queues of the host storage; not tested for an HTTP-only app). `az bicep build` passes; **it was not deployed**.
- CLI `deploy` (resource group, Bicep, `config-zip`, warm-up, then `prime`), the Front Door id check in the Functions entry (`front-door.mjs`), tests: Bicep (role ids, no OpenNext remains, settings the handlers read), deploy options, Front Door check, pack contents. Totals: unit 370, integration 13.
- Still open for the Azure run of the package build: the Bicep template as written, `deploy` as written, the Front Door variant (never deployed), a deployment over an older build.

## Session 44 (2026-11-08): migration, stage 3 (CI for next-on-azure)

- New root script `pnpm e2e:standalone` (`scripts/e2e-standalone.mjs`): packages `examples/standalone` for the local machine, starts Azurite and the Functions host, runs the `remote` project of tests-e2e against `http://localhost:7071` with `E2E_TARGET=standalone`, stops everything; `LOCAL_STACK_LOG_DIR` keeps the host log.
- Three E2E expectations became target-aware (strong or weak ETag, `javascript` content type, `Cache-Control` of `public/` files, 400 or 404 for a missing source image): they are details the Next.js server decides, not behavior of this package. The OpenNext target keeps the strict values.
- Result: **47 passed, 5 skipped on Next.js 15.5.29 and on 16.4.5** (the 16.4.5 leg in a throwaway worktree, Node 26, local). The skipped cases need the local host log of the OpenNext stack or an HTTPS fixture server.
- CI: job `standalone-e2e` (matrix: catalog and 16.4.5, Node 22) and a Bicep compile step for the new template. The first CI run on GitHub is still to be seen; Node 22 and Linux differ from this machine.

## Session 45 (2026-11-08): Azure run of the next-on-azure package, plan written before starting

- **Conditions** (stated in my questions after the CI stage and answered "go ahead" by the maintainer, as before): resource group `opennextjs-azure-fjtd` in japaneast (pre-existing and empty; it is **kept**, only resources of this run are deleted, by name), no Front Door, the maintainer's subscription, window 3 hours, cost ceiling 500 yen.
- **Start 15:18 JST (the time was read from the clock). Hard stop 18:18 JST.** Deadlines: provision and deploy by 15:50, verify by 17:00, delete by 17:30, read-only inventory right after and again on 2026-11-09.
- **Plan:** package `examples/standalone` for Azure (`next-on-azure package`), deploy it with `next-on-azure deploy -g opennextjs-azure-fjtd -n nfjt1` (new Bicep template, warm-up and prime of the CLI), run the HTTP suite with `E2E_TARGET=standalone` against the URL, measure the first request after about 11 minutes idle, read Application Insights for errors, a small load. Not planned: Front Door, always-ready.
- **Resources created:** see below, recorded as they appear.
- **Created (15:21 JST), in `opennextjs-azure-fjtd`:** `Microsoft.Web/sites` `func-nfjt1-ennwz3ygympuc`, `Microsoft.Web/serverFarms` `plan-nfjt1-ennwz3ygympuc`, `Microsoft.Storage/storageAccounts` `stnfjt1ennwz3yg`, `Microsoft.Insights/components` `appi-nfjt1-ennwz3ygympuc`, `Microsoft.OperationalInsights/workspaces` `log-nfjt1-ennwz3ygympuc`.
- **Results:** see "Azure run of the package build" in ADR-0016 (suite 47 passed and 5 skipped; cold start after idle 2.4 s; load test; the first deployment of the new Bicep and `deploy` worked).
- **Deleted (15:35 JST), one by one by name:** the five resources and `Application Insights Smart Detection`. The resource group was kept. Read-only inventory right after: empty (the action group was deleted after the first listing showed it), no role assignment. The inventory of 2026-11-09 and the Cost Management figure are still to do.
- CI of 04fcd42 was green in all 8 jobs, including both `standalone-e2e` legs.

## Session 46 (2026-11-08): migration, stage 4 (documentation and name)

- Name: the maintainer chose `next-on-azure` "for now"; it stays provisional (ADR-0017). The trademark question ("Next" in a package name, Vercel) is not checked and is listed in the docs.
- The OpenNext-specific pages moved to `docs/legacy-opennext/` (get started, configuration and overrides, comparison, compatibility record, architecture, caching, FAQ, troubleshooting) with relative links repaired; the old package README says it is legacy.
- New pages written for the new design: docs index, get started, compatibility (with the verification status of each row from the Azure suite run), configuration, how it works, comparison, FAQ, troubleshooting; the root README; the contributing pages got short sections for the new scripts. Link check over all Markdown: 0 broken.
- Wording choices that stay honest: rows without a run are **Unverified** (Next.js 16 on Azure, Front Door, always-ready, `proxy` and `cacheComponents` with this design, `detach`); the supported Next.js range is inherited from the OpenNext-based design and said so.
- Not done: stage 5 (removal of the old package, `examples/app-router`, the `azure-e2e` workflow and the legacy CI job). The Azure E2E workflow still targets the old package.

## Session 47 (2026-11-08): migration, stage 5 (removal of the OpenNext-based package)

- Removal approved by the maintainer. Deleted: `packages/open-next-azure`, `examples/app-router`, `scripts/local-stack.mjs`, `docs/legacy-opennext`, the stack files and the `front-door` and `poison` projects of `packages/tests-e2e`, and every unit and integration test of the old package (the ported ones remain). `@opennextjs/aws` is gone from the catalog; the dependencies only the old package used were dropped. History stays in git.
- Dead code of the HTTP suite removed: the host-log helpers, the cases that needed the local host log (queue consumer ran, failed revalidations, stampede count) or an HTTPS fixture (remote images). The suite is now 47 cases, none skipped; the Azure run earlier today (47 passed, 5 skipped) had run the same cases plus those five skipped ones.
- `azure-e2e.yml` now deploys `examples/standalone` with `next-on-azure deploy` and runs the suite with `E2E_TARGET=standalone`; the tag of its resource groups is `purpose=next-on-azure-e2e`. **It was not run** (the federated credential and the variables exist for the old workflow; the rights of that identity were set for the old template).
- `check.yml`: the old `e2e` job is gone, `standalone-e2e` is now `e2e`; one Bicep step.
- Local: lint, typecheck, build, unit 121, integration 3, `pnpm e2e:standalone` 47 passed, license check, secret scan. GitHub CI of this change is still to be seen.
- AGENTS.md, README, docs and the roadmap note updated; the number of unit tests fell from 370 to 121 because the old package's tests went with it.

## Session 48 (2026-11-08): documentation site in a separate repository; a packaging fix it found

- The maintainer wanted the documentation as a website, in a repository of its own, built with this project, with the structure and design of the OpenNext site. Done in `/Users/fjt/Desktop/next-on-azure-docs` (own git repository, no remote): Next.js App Router, Markdown from `content/` rendered at build time, sidebar, breadcrumbs, "On This Page", previous and next, ⌘K search over a build-time index, light and dark themes, mobile drawer. The design was taken from the live OpenNext site in the browser pane (colors, sizes, layout); the wordmark is this project's own text.
- Checked: type check, production build, the site packaged with `next-on-azure package --target local` and served by the local Functions host (all pages 200, unknown route 404); in the browser: dark and light, desktop and mobile width, tables, code blocks, search. Not done: Azure deployment (costs money; needs a resource group, a time window and a cost ceiling from the maintainer), a GitHub repository, a custom domain.
- **Bug found by using the package as a dependency:** with `next-on-azure` installed from a tarball by pnpm, Next.js wrote the cache handler paths into `server.js` pointing into `node_modules/.pnpm/<id>/...`; the flattening removed that directory, so every request failed with a missing module. `package` now points these paths (in `server.js` and `required-server-files.json`) at `node_modules/next-on-azure/...` after flattening (`repointRuntimePaths`, 3 unit tests). The repository's own example did not show it because it reaches the package through a workspace link.
- Also seen: plain `next start` of a site built with `withAzure()` fails when no storage account is configured (the handlers need Azurite or an account); use `next dev` or the local Functions host.

## Session 49 (2026-11-08): repository renamed

- The maintainer renamed the repository to `fjt-dev/next-on-azure` (private) and created `fjt-dev/docs-next-on-azure` (**public**, empty) for the documentation site. The remote of this checkout points to the new URL; the local directory name is unchanged.
- The OIDC `subject` in `docs/contribute/azure_e2e.md` now names the new repository. The federated credential in Azure (app registration `opennextjs-azure-e2e`, credential `github-main-branch`) had the old subject; changed on 2026-11-08 with the maintainer's approval to `repo:<owner>@<owner id>/<repo>@<repo id>:ref:refs/heads/main`, and read back. **Not tested by a workflow run** (a run creates billable resources). The app registration keeps its old display name.

## Session 50 (2026-11-08): small clean-ups

- Biome 2.6.4 to 2.6.5 (the open Dependabot pull request: patch update, same checks green locally and in its own run).
- The release plan was rewritten for the design without OpenNext (the old one described the OpenNext-based package and its name search).
- R2 of the release plan, first part: the real Azure client id in the sample of `secret-scan.test.ts` was replaced with an all-zero GUID (the test only needs a GUID that is not flagged as a secret). Still in the repository, left on purpose: the GitHub user and repository ids in the OIDC subject example, and the names of Azure resources that were deleted (work log).
- R1 (`SECURITY.md` and the other community files) is blocked on the maintainer's security contact address (P4), so it was not written.
- B6, local part (throwaway worktree on Next.js 16.4.5, removed): `proxy.js` instead of `middleware.js` in the example: 47 of 47 cases pass, build shows `Proxy (Middleware)`. A small app with `cacheComponents: true` and `partialPrefetching: true` through `withAzure()`: partial prerender, cached part stable, live part per request, `revalidateTag` renews the cached part. Not on Azure, not in CI. `scripts/standalone-local.mjs` now takes the packaged app as an argument.
- B7: a route that sends "partial" and then breaks its stream (`/api/stream-error` in the example). Directly against Next.js the client sees the connection closed (curl exit 18); **through the function it waited until its own timeout** (curl exit 28, 7 bytes): an errored web stream does not end the Functions response. The entry now ends the stream at that point and logs the error; the client gets a shortened body with a normal end (the lesser evil; the cause stays visible in the logs only). E2E case added (`errors.test.ts`); it fails with a 180 s timeout against the previous entry and passes with the fix. Local only, not on Azure.

## Session 51 (2026-11-09): Azure run, Next.js 16.4.5 and always-ready

- **Conditions** (stated in my question, answered "same conditions" by the maintainer): resource group `opennextjs-azure-fjtd` in japaneast (pre-existing and empty; **kept**, only resources of this run deleted, by name), no Front Door, the maintainer's subscription, window 00:34 to 03:34 JST, cost ceiling 500 yen.
- **Done:** a throwaway worktree of commit 1eb995c with `next: 16.4.5`, the example packaged for Azure, deployed with `next-on-azure deploy -n noaz1109 --always-ready 1`. First answer 0.7 s after the deployment, 9 prerendered routes primed. The HTTP suite with `E2E_TARGET=standalone`: **48 of 48 passed**, including the stream-error case. The first run without that variable had 2 failures (the one shown was a `static` expectation for the other target; the second was not looked at, and the run with the variable passed).
- **Created and deleted by name** (00:43 to 00:44 JST, about 10 minutes after creation): `func-noaz1109-l3tyas7mni4wg`, `plan-noaz1109-l3tyas7mni4wg`, `appi-noaz1109-l3tyas7mni4wg`, `log-noaz1109-l3tyas7mni4wg`, `stnoaz1109l3tyas7m`. Inventory right after: empty. The maintainer looked at the site before the deletion.
- **Not done:** Front Door; the `proxy` convention on Azure (the example uses `middleware.js`); a measurement of always-ready (cold start with and without it); the cost figure (usage is not reported yet; the run lasted about 10 minutes with one always-ready instance, expected to be a few yen, an estimate). To do: inventory and cost on 2026-11-10.

## Session 52 (2026-11-10): Azure run, always-ready and Next.js 16 `proxy` / `cacheComponents`

- **Conditions** (the maintainer asked for the check of these two items; same conditions as before, restated by me): resource group `opennextjs-azure-fjtd` in japaneast (pre-existing and empty; **kept**, only resources of this run deleted, by name), no Front Door, the maintainer's subscription, window 10:45 to 13:45 JST, cost ceiling 500 yen.
- **Plan:** two apps from the same Next.js 16.4.5 build of the example with `proxy.js` instead of `middleware.js`: one with `--always-ready 0`, one with `--always-ready 1`; cold start after idle on both; then a small `cacheComponents` app deployed over the first one; delete everything by name.
- **Done:** the example with `proxy.js` on Next.js 16.4.5 deployed as `noazra0` (`--always-ready 0`) and `noazra1` (`--always-ready 1`; the setting read back as `http: 1`). HTTP suite (`E2E_TARGET=standalone`): **48 of 48 on both**; a redirect and a rewrite by `proxy` checked by hand. Cold start after about 17 minutes without requests (`/pages-ssr?name=x`, client in Japan): `noazra0` **2.40 s**, then 0.13 s and 0.22 s; `noazra1` **0.15 s**, then 0.13 s and 0.12 s. One sample each. Then a small `cacheComponents` + `partialPrefetching` app (`app/page.js`: a `'use cache'` part tagged `cc`, a part behind `connection()`) deployed over `noazra0`: the cached timestamp stayed the same over three requests, the live one changed each time, after `POST /api/revalidate` (`revalidateTag("cc", "max")`) the cached one was renewed and stayed.
- **Seen:** two `deploy` runs started at the same time in one resource group collide on the Bicep deployment name `main` (only one app was created; run them one after the other). The zip deployment got `403` from the storage account right after the first Bicep deployment (role assignment not yet effective) and worked two minutes later, the same symptom as on the first run. A `proxy` rewrite leaves `x-middleware-rewrite: http://localhost:3000/pages-static` in the response (not checked on Next.js 15).
- **Created and deleted by name** (11:16 to 11:18 JST): `func-`, `plan-`, `appi-`, `log-` and `st` resources for `noazra0` (`func-noazra0-ql5qymo7s5orm`, `stnoazra0ql5qymo7`) and `noazra1` (`func-noazra1-b666qbwisuzow`, `stnoazra1b666qbwi`), and the `Application Insights Smart Detection` action group Azure created. Inventory right after: empty. The first attempt to delete them with a loop over a file of names was refused by the permission check; the names were then listed and given one by one.
- **Not done:** Front Door; the cost figure (the two apps lived about 35 minutes, one with an always-ready instance; usage is not reported yet; expected to be a few yen, an estimate); the next-day inventory (2026-11-11).

## Session 53 (2026-11-10): install tests with npm and Yarn, scrub check

- Packed the package (`pnpm pack`, 26 kB) and installed it from the tarball into clean copies of the example (macOS, Node 26.13, npm 11.20): **npm, Next.js 15.5.29: build, `package --target local`, run on Azurite and the Functions host, HTTP suite 48 of 48; npm, Next.js 16.4.5: the same, 48 of 48; Yarn 1.22.22, Next.js 15.5.29: 48 of 48.** `npm audit` of the 15.5.29 app lists `postcss` pulled in by `next` (Next.js pins 8.4.31; this repository overrides it); 0 findings on 16.4.5.
- **Yarn 4 (Plug'n'Play, the default linker):** `next build` and `package` both succeeded, but there is no `node_modules`, so the packaged app died at the first request with `Cannot find module '@azure/storage-blob'` (37 of 48 cases failed). A package that looks fine and is broken is the bad kind of failure: `package` now stops with a message that names the fix (`nodeLinker: node-modules`), `assertHasNodeModules` with a unit test (126 unit tests). Checked against the real Yarn 4 output; Yarn 2+ with `nodeLinker: node-modules` was not run.
- Not done: Linux, Node 22 and 24 (the CI matrix would do it as a job that packs, installs and runs); Azure.
- R2 checked: both secret scans (tree and history) find nothing; no e-mail address; the only GUIDs in tracked files are built-in role ids. Left for the maintainer: the GitHub user and repository ids in the OIDC subject, deleted resource names and a home-directory path in this log.
- The release plan state table was brought up to date (it still described Next.js 16 and always-ready as unverified).

## Session 54 (2026-11-10): the install test as a CI job

- `scripts/install-test.mjs npm|yarn [--next <version>]` packs the package, installs the tarball into a clean copy of `examples/standalone` (versions of Next.js and React from the catalog), builds, packages and runs the suite through `scripts/e2e-standalone.mjs --app <dir>` (new option: run an already packaged app). Run here (macOS, Node 26): npm and Yarn 1.22, Next.js 15.5.29, 48 of 48 each.
- New CI job `install` (npm and Yarn 1, Node 22 and 24, Linux): the item R4 of the release plan (Linux, Node 22 and 24). **Its first run on GitHub is still to be seen.** macOS stays a local check (macOS runners are billed at a higher rate).
- An earlier CI run of the same day failed once in `pnpm install` (the download of the Functions Core Tools binary by its postinstall, a network error); the rerun passed.
- **The first run of `install` found a real bug (Yarn 1, Linux, both Node versions):** `package` stopped with "The package still contains 1 symbolic link(s): standalone/node_modules/sharp/node_modules/.bin/semver". `removeShims` ran before `copyCompleteSharp`, which copies the whole sharp package including its own `node_modules/.bin`; with Yarn on Linux sharp has a nested `semver` and the link came back. Not seen on macOS or with npm. Fix: `removeShims` runs again after the sharp copy. A unit test for `removeShims` at every depth was added (it passed before the fix too, since the function was right and the order was wrong); the proof is the CI job. **Not reproduced locally** (no Linux here), so the fix is unverified until CI runs it.
- **Result of the fix:** CI of a82be0d: all jobs green, including `install` with npm and Yarn 1 on Node 22 and 24. The fix is verified in CI.

## Session 55 (2026-11-10): the package name is confirmed

- The maintainer asked whether an `azure-<name>` name would follow Microsoft's naming better, then decided: **`next-on-azure`** ("next-on-azure is fine"). [ADR-0018](./decisions.md#adr-0018-the-package-name-is-next-on-azure) records it and supersedes ADR-0005; the Microsoft trademark guidelines were **not read** in this session, the reasoning against `azure-` is the `@azure/*` scope and the general caution about names that start with "Azure", labelled as such in the ADR.
- The "provisional name" notes are gone from the README, `docs/`, the package README and `package.json`, `AGENTS.md`; the rule not to hard-code the name in source files is removed (ADR-0005 superseded). The release plan marks P1 as decided. Still to do before the first publish: check on npm that the name is free that day.

## Session 56 (2026-11-10): banner image in the README

- `docs/assets/banner.svg` (source) and `banner.png` (2544 x 600, rendered with `sharp`) show the Next.js logotype, a plus sign and the Azure icon on a dark strip, in the style the maintainer gave as a sample. It sits under the "Experimental, pre-release" note of the README. (A first version with two cards and the word "Azure" in text was replaced at the maintainer's request.) The Azure icon (`10018-icon-service-Azure-A.svg`) and the Next.js logotype for dark backgrounds (`nextjs-assets.zip`) are the files the maintainer downloaded from the owners' distributions. The brand guidelines of Microsoft and Vercel were **not read** in this session: whether this use of the logos is allowed has not been checked. The package README (what npm shows) has no image: a relative path does not work there and the repository is private.

## Session 57 (2026-11-10): cost levers in the template and the CLI

- Read the template for what is billed. Findings: the CLI could not set the instance memory or the instance bound (only the template could); cache entries are keyed by build id, so every deployment left its entries in the `cache` container for good (storage grows without limit); Log Analytics has 30 days of retention and no daily cap; static files are one function execution each, and a page that is loaded for the first time loads many (browsers keep `/_next/static/*` for a year, `public/` files are revalidated each time).
- Done: `cacheRetentionDays` (default 30, 0 = off) adds a lifecycle rule that deletes blobs of the `cache` container not written for that many days (never `deploy-app`); `deploy --memory 512|2048|4096`, `--max-instances <n>`, `--cache-retention-days <n>` (passed on only when given; the template keeps the defaults). Unit tests 130 (bicep shape, flags, ranges), lint, `az bicep build`. **Unverified on Azure**: nothing here was deployed; `validate` and `what-if` are known to pass templates that fail at deployment, so expect to fix the lifecycle rule on its first real deployment.
- Not done, by decision: a smaller default memory (no measurement of Next.js under 512 MB with `sharp`); a Log Analytics daily cap; a memory layer for the cache handler (a design change: ADR and tests); a CDN for `/_next/static/*` other than the optional Front Door (never deployed). To measure on the deployment of the documentation site: executions per page view (Application Insights), Blob and Table transactions per request, memory at 512 and 2048, the daily ingestion.

## Session 58 (2026-11-10): organizations, at the level of OpenNext

- The maintainer wanted the project usable by organizations, then narrowed it: "at the same level" as opennextjs-aws. The official architecture page says OpenNext does not create infrastructure; its docs have a reference implementation and leave the rest to SST, CDK or Terraform.
- A first batch for the template (storage SKU, tags, an existing Log Analytics workspace, retention, diagnostic settings; it compiled with `az bicep build`) was **discarded before any commit**, as beyond that level.
- Done: [Your own infrastructure](../infrastructure.md) (what the app needs, roles, deploying without `deploy`, what is stored where, what is not provided), ADR-0019, a roadmap section. The manual steps of the page are those of `deploy`; infrastructure not made by the template is **Unverified**. The documentation site does not have the page yet (its sync list and navigation).

## Session 59 (2026-11-10): cost by traffic, and the direction

- The maintainer asked how the cost grows with traffic, compared with OpenNext (AWS), which serves static files outside the function. Read the official OpenNext architecture page and the Azure docs (Flex Consumption billing: executions and memory times active time, a minimum billable period of 1,000 ms; the Functions monitoring docs), and fetched the Azure retail prices for Japan East (executions 0.40 USD per million, 0.000026 per GB-second, always-ready baseline 0.000004 per GB-second, Blob reads 0.004 and writes 0.05 per 10,000, Log Analytics 3.34 per GB; the Table Storage price query returned nothing).
- The estimate is in the FAQ with its assumptions. Findings: up to about 100,000 page views a month the bill is inside the free grants or a few dollars; above that the instance memory and the Application Insights request records (never sampled, one per static file) dominate, and at 10 million page views the records can cost as much as the function.
- The maintainer chose to keep the design and prepare options (B): [ADR-0020](./decisions.md#adr-0020-static-files-stay-with-the-function-cost-options-first-measure-later). Added `deploy --request-telemetry all|errors` (Bicep `requestTelemetry`; `errors` sets `AzureFunctionsJobHost__logging__logLevel__Host.Results=Error`, from the Azure docs); unit tests 131, lint, `az bicep build`. **Unverified on Azure**: that app setting name contains a period; the docs exclude Linux Elastic Premium and Dedicated plans for such names and do not mention Flex Consumption. Nothing was deployed.

## Session 60 (2026-11-10): the documentation site on Azure, first a measuring run

- **Conditions** (stated in my question; the maintainer chose "first a temporary measuring run, then a permanent site", "publish on the internet" for the permanent site, and the existing resource group; the ceiling was in my wording and not typed by the maintainer): resource group `opennextjs-azure-fjtd` in japaneast (pre-existing and empty; **kept**, only resources of this run deleted, by name), no Front Door, the maintainer's subscription, window 14:55 to 17:55 JST, cost ceiling 500 yen. The permanent deployment gets its own decision (resource group, monthly ceiling) afterwards; the existing group is not a good home for something that stays.
- **Plan:** two apps from the same package of the documentation site, one after the other: `docsa` with the defaults (2048 MB, all requests recorded) and `docsb` with `--memory 512 --request-telemetry errors`. A scripted visitor (first visits that fetch the page and its assets, and repeat visits) and the metrics (executions, execution units, memory working set, storage transactions, Application Insights requests); the resource inventory for the diagram; delete everything by name.

- **Measuring run, results (2026-11-10, JST 14:51 to about 15:15):** two apps of the documentation site (`docsa` defaults, `docsb` 512 MB), same scripted visitors (300 visits, 30% first visits, 4 at a time; 1,260 requests, 55.7 MB each run). The first deployment answered 404 for every page: the site used `dynamicParams = false`, and next-on-azure does not render such App Router routes (see below); fixed in the site. After that all pages 200 on both apps.
  - Executions and time (Azure Monitor): `docsa` 1,460 executions in the load window, 158,105,600 MB-ms = 154 GB-s, **0.106 GB-s per request** (about 53 ms at 2048 MB). `docsb` (512 MB): 1,299 executions, 139,110,400 MB-ms = 136 GB-s, **0.105 GB-s per request** (about 209 ms at 512 MB). **Memory 512 saves nothing**: four times the time for a quarter of the memory; instance count 2 against 1. The memory working set was about 0.6 GB on both.
  - Telemetry (Application Insights): `docsa` 3,561 traces (4.19 MB), 1,550 requests (2.13 MB), 146 metrics: about **4.1 KB per request**. With `Host.Results=Error` only (`docsb`): requests 0, traces 3,295 (4.14 MB): the app setting with a period **works on Flex Consumption**, but it saves little, since the "Executing/Executed" traces have the category `Function.server`. Adding `Function.server=Warning`: 560 traces and 56 metrics, 0.79 MB for 1,260 requests: **0.63 KB per request, 85% less**. `requestTelemetry=errors` now sets both.
  - Storage transactions (Azure Monitor, whole window incl. deployment): `docsa` 1,357 Blob and 2,186 Table; `docsb` (three runs) 3,279 Blob and 5,406 Table: negligible in cost.
  - The template deployed without a fix: the lifecycle rule exists (`delete-old-cache-entries`, 30 days, prefix `cache/`), the memory settings are 2048 and 512, the setting with a period was accepted. First deployment of this template; the zip upload did not fail with 403 this time.
  - **Package gap found:** `dynamicParams = false` (App Router) answers 404 for every path, even the built ones (`NoFallbackError`): Next.js does not find the prerendered page through the cache handler and, with no fallback, does not render it. The Pages Router with `fallback: false` works. Reproduced locally; E2E: `app/params-closed` (`it.fails`) and `pages/pages-closed` in the example, 49 passed and 1 expected failure.
- The visitor script counted `/_next/static/*` from the text of a documentation page as a file (60 failed requests per run were that, not the site).

## Session 61 (2026-11-10): the documentation site moves to Next.js 16

- Why 15 until now: no reason on record; the site was created pinned to 15.5.29, the version of the repository catalog and the first one verified on Azure. The maintainer asked for 16: `next` 16.4.5 (16.4.6 exists; 16.4.5 is the verified one), `src/middleware.ts` renamed to `src/proxy.ts` (`export function proxy`), nothing else needed. Build with Turbopack, typecheck, and the packaged site on the local Functions host: all pages 200, `/` and `/faq` redirect to `/en...`, the `lang` cookie sends to `/ja/...`, an unknown path 404.
- Deployed over `docsa` (the 2048 MB app) with `config-zip`: first answer 200, 40 prerendered routes primed, 0 failed; the same checks on Azure pass (`/`, `/faq`, cookie redirect, 404). The cache holds the entries of the new build.
- **Measured again** (same 300 scripted visits): first run after the deployment 1,309 executions, 265 GB-s: **0.203 GB-s per request** (about 101 ms at 2048 MB), telemetry 4.4 KB per request; second run a minute later 1,260 executions, 66 GB-s: **0.052 GB-s per request** (about 26 ms), 3.8 KB. The Next.js 15.5.29 first run had been 0.106. One sample each: **no difference between 15 and 16 can be claimed**; the first run includes the warm-up of a new instance, so the Cost page figures are an upper bound for a site that stays up. (A slip of mine: a per-minute listing first showed units under both names because I cut the metric names to 18 characters; fixed before anything was written.)

- **Created and deleted by name** (resources from 14:51 JST; deleted 16:45 to 16:48 JST, inside the 3-hour window): `func-`, `plan-`, `appi-`, `log-` and `st` resources of `docsa` (`func-docsa-wh7owolfxqipk`, `stdocsawh7owolf`) and `docsb` (`func-docsb-htbc6bmeacxa2`, `stdocsbhtbc6bme`), and the `Application Insights Smart Detection` action group that Azure created. Inventory right after: empty. The maintainer looked at the sites before the deletion was approved. The apps lived about 2 hours; no cost figure yet (usage is not reported yet; expected to be a few yen, an estimate). To do: the next-day inventory and the Cost Management figure (2026-11-11).
- **Next:** a permanent deployment of the site needs its own decision (resource group, monthly ceiling; the maintainer chose "publish on the internet"). The architecture diagram, the "deployed with next-on-azure" page and the footer notice follow it. The inventory of what the template created (storage account, Log Analytics workspace, Application Insights, plan, function app) is the same as the diagram draft.

## Session 62 (2026-11-10): towards a public repository (P2)

- The maintainer chose to go the P2 way. Audit (read-only): commit identities, secrets, personal data, workflows, license, community files, logos; the result is the table in the [release plan](./release_plan.md). Drafted `SECURITY.md` (private vulnerability reporting of GitHub, best effort, one maintainer), `CONTRIBUTING.md`, `.github/CODEOWNERS`, the pull request template and the issue templates (bug report, feature request; blank issues off). Lint, 131 unit tests. Nothing was changed in GitHub: the repository is still private, no setting was touched.
- Open: logos (guidelines not read), the license holder name, the code of conduct, whether to scrub the work log, the issues target of the documentation site, the date.
- Decisions of the maintainer: the logos stay as they are with no notice (the images were chosen according to the official guidelines, which the assistant did not read); the license holder stays `fjtd`; the code of conduct is the Contributor Covenant, to be added when the enforcement contact is given; personal items are removed from the current files (the GitHub ids of the OIDC example, the subscription type, the Japanese phrases; the history is not rewritten).
- The maintainer gave `security@fjtd.dev` and asked for the local part of the conduct address: chose `conduct@fjtd.dev` (the usual name for it). Added `CODE_OF_CONDUCT.md` (the text of the Contributor Covenant 2.1 read from contributor-covenant.org on 2026-11-10, with the contact and one added sentence for a report about the maintainer), the e-mail address in `SECURITY.md`, a link in `CONTRIBUTING.md`. A DNS lookup shows the MX records of `fjtd.dev` at Cloudflare (Email Routing): the two addresses need routing rules (or a catch-all) there; **not verified, no mail was sent**.

## Session 63 (2026-11-10): the domain of the documentation site, npm

- The maintainer chose **`next-on-azure.fjtd.dev`** for the documentation site and will set up the custom domain himself or herself (Cloudflare DNS, Azure binding); two-factor authentication on the npm account `fjtd` is set (stated by the maintainer). Read-only checks: the nameservers of `fjtd.dev` are Cloudflare's, `fjtd.dev` and `www` already answer, the other candidate names had no records; the npm registry has no `next-on-azure` and no `@fjtd/next-on-azure`.
- Candidates that were not chosen: `docs.fjtd.dev` (a shared docs name, and the site does not support a path prefix), `docs.next-on-azure.fjtd.dev` (two levels: Cloudflare's free certificate is expected to cover one level only, not confirmed), `noa.fjtd.dev`.
- Recorded in the release plan (P4 and the starting-point table). Nothing was changed in DNS, Azure or npm.

## Session 64 (2026-11-10): the promise of the first release (P3), the translation target

- The maintainer chose the issues of the documentation site's repository as the target of "request a translation"; that repository must become public with the site. Audit of it (read-only): all 16 commits use the no-reply address, both secret scans clean, no personal data except a quota fact of the Azure docs; added a `LICENSE` (MIT, `fjtd`) and a `CONTRIBUTING.md` about translations (commit `9d663c2` there, not pushed).
- P3 proposed as "only what was run is promised"; the maintainer asked for **no letters in the tag**: the first release is `0.1.0` with the default tag, no `-alpha` ([ADR-0021](./decisions.md#adr-0021-the-first-release-is-010-without-a-pre-release-suffix)). Written: [Support](../support.md) (versions, what was run, what is not promised), linked from the README and `docs/README.md`; the release plan updated (P3, stage names). `package.json` still says `0.0.1` and `private`: R3 (Changesets) changes that. The Support page is not on the documentation site yet.

## Session 65 (2026-11-11): next-day inventory and the first bill

- **Inventory (read-only):** the resource group `opennextjs-azure-fjtd` is empty. Soft-deleted Log Analytics workspaces of the runs (and of older e2e groups) are still listed: they are not billed. Two other resource groups exist in the subscription (`simple-web-app` and, in the cost data, `rg-ujp`); they were not created by the runs of this project as far as the records show, and were not touched.
- **Cost Management** (the `costmanagement` extension of the CLI is not installed; the Cost Management query API was called through `az rest`, which answered 429 once and worked after a pause): actual cost 2026-11-06 to 2026-11-10 in yen: `opennextjs-azure-fjtd` **0.28** (0.0006 on 11-08, 0.28 on 11-10, nothing shown for 11-09); `rg-opennextjs-azure-2` 1.28 and `rg-opennextjs-azure-1c` 0.008 on 11-06 (the first runs); the platform's `flex-*` groups 0. Usage can be reported late: the figures are a lower bound. Written on the [Cost](../cost.md#a-real-bill) page; the "no figure yet" notes in the ADRs of the first Azure runs are left as they were at the time.
