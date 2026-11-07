# Work log

Newest entry first. One entry per working session: what was done, what was verified, what was learned, what is next. Keep it factual; mark anything not run as **unverified**.

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
| Subscription | Azure for Students (`<subscription-id>`), signed-in user is Owner |
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
| Subscription | Azure for Students (`<subscription-id>`), signed-in user is Owner |
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

- Added `azure-functions-core-tools` 4.16.0 and `azurite` as workspace dev dependencies (no global install). The Core Tools postinstall did not unpack its zip under Node 26; unpacked by hand (see [Common issues](../common_issues.md)).
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
| `opennext-azure` bin not linked in the example | pnpm links bins at install time, before `dist` existed | Reinstall after the first build; see [Common issues](../common_issues.md) |

### Not verified (carried into Phase 1)

Everything that needs Azure or the Functions host: deployment, streaming through Functions and Front Door, `waitUntil`, queue-triggered revalidation, image optimization at runtime, RBAC, cold start.

### Next

1. Phase 1: deploy `examples/app-router` to the user's Azure subscription (confirm subscription, region and resource group name first, because this creates billable resources).
2. Install Azure Functions Core Tools to run the stack locally.
