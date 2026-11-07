# Architecture decision records

Each record states the decision, why it was made and what was rejected. When a decision changes, add a new record that supersedes the old one instead of editing history.

---

## ADR-0001: Compute and storage targets

**Status:** Accepted, 2026-11-05. **Unverified on Azure** (see [roadmap Phase 1](./roadmap.md)).

**Decision**

- Compute: Azure Functions on the **Flex Consumption** plan, Node.js 22 or 24, programming model v4 with HTTP streaming.
- ISR and fetch cache: **Blob Storage**.
- Revalidation queue: **Storage Queue**.
- Static assets and CDN: Blob Storage behind **Azure Front Door Standard** (changed by ADR-0009: static files are served by the app from Blob, and Front Door is optional).
- Tag cache (`revalidateTag` / `revalidatePath`): **Table Storage** (see ADR-0003).

**Why**

- Functions is the closest equivalent to the Lambda model OpenNext was designed around: per-request scaling, pay per use, and a documented HTTP streaming feature.
- Flex Consumption supports Node 22/24 and identity-based storage access. The older Linux Consumption plan is being retired (2028) and gets no new features.
- Blob, Queue and Table are in one storage account, so one set of role assignments covers the whole data plane.

**Resolved (2026-11-06, [ADR-0009](#adr-0009-single-function-app-and-optional-front-door-by-default)):** Front Door Standard costs **35 USD per month per profile** before any request or data transfer charge (Azure retail prices API, queried 2026-11-06; Premium is 330 USD). That is more than the expected compute and storage bill of a small site, so Front Door is **optional and off by default**. The architecture above describes the Front Door variant.

**Alternatives**

- Container Apps: simpler to run the `standalone` output and good for long-lived streaming, but it diverges from OpenNext's function-per-component model. A reasonable future second target.
- App Service: simplest, but weaker scaling and cost model.

---

## ADR-0002: One Function app per OpenNext component

**Status:** **Superseded by [ADR-0009](#adr-0009-single-function-app-and-optional-front-door-by-default)** (2026-11-06). Kept for history; the code still implements this layout until the work in roadmap Phase 1b is done.

**Decision (current):** Deploy `server`, `image` and `revalidation` as three separate Function apps, mirroring the three Lambda functions of OpenNext for AWS.

**Why:** The OpenNext runtime stores state in `globalThis` (queue, caches, config, route preloader). Two bundles in one Node process would overwrite each other's globals. Separate apps also allow independent memory, scaling and `sharp` dependencies.

**Cost:** more resources to deploy, more settings, three cold starts. Flex Consumption bills per execution, so idle apps cost little.

**Challenge (2026-11-06):** an external review reports that one app registering all three functions was verified on real Azure and is simpler. That contradicts the `globalThis` reasoning above, which was an inference from reading the OpenNext source and never tested here. Phase 1b tested it locally: the review was right and the `globalThis` inference was wrong in practice. See ADR-0009.

---

## ADR-0003: Table Storage for the tag cache

**Status:** Accepted, 2026-11-05.

**Decision:** Implement the `nextMode` tag cache on Table Storage: `PartitionKey` is the OpenNext build ID, `RowKey` is the base64url-encoded tag, with `revalidatedAt`, `stale` and `expire` columns.

**Why:** The initial scope was "Blob + Queue", which has no good place for tag state. Table Storage is cheap, lives in the same storage account, supports point reads by key, and mirrors the DynamoDB `nextMode` implementation.

**Alternatives:** Cosmos DB (richer, much more expensive, extra resource); Blob per tag (slow, no batch read). Cosmos DB remains a candidate for an alternative override in Phase 3.

---

## ADR-0004: Monorepo layout and tooling

**Status:** Accepted, 2026-11-05.

**Decision:** pnpm workspaces + Turborepo + Biome + Changesets, with this layout:

```
packages/open-next-azure   the published package (overrides, CLI, Bicep)
packages/tests-unit        (planned)
packages/tests-e2e         (planned)
examples/app-router        example Next.js apps used for manual and E2E testing
docs/                      documentation, plan and work log
```

**Why:** it matches the upstream OpenNext repository, so contributors and tooling feel familiar. Example apps need to live next to the package so E2E tests can build them against the workspace version. A single `pnpm-workspace.yaml` catalog pins shared versions (Next.js, React, `@opennextjs/aws`).

---

## ADR-0005: Package name is deferred

**Status:** Accepted, 2026-11-05.

**Decision:** Use the placeholder name `opennextjs-azure` until just before the first publish. The `@opennextjs/*` scope belongs to the upstream organization and cannot be used. The final name must not start with `opennextjs` unless the OpenNext maintainers agree, and the package must state that it is not an official OpenNext package.

**Why:** The name only matters at publish time and renaming is cheap if it stays isolated. To keep it cheap:

- the name appears in `packages/open-next-azure/package.json` and in import specifiers inside `open-next.config.ts` files, docs and examples;
- no source file may hard-code the package name.

**Rename checklist (Phase 4):** check npm availability, update `package.json` `name`, search the repo for `opennextjs-azure`, update the changeset config and docs.

---

## ADR-0006: `waitUntil` via response stream

**Status:** Accepted, 2026-11-05; **measured on Azure 2026-11-06** (see below). The default stays `hold`; `detach` is available.

**Decision:** The wrapper implements `waitUntil` by keeping the response stream open until deferred promises settle, then closing it.

**Why:** Azure Functions has no `waitUntil` primitive for the Node v4 model, and an invocation may be frozen once the handler returns. Holding the stream is the same approach the AWS streaming wrapper takes.

**Risk:** the client sees a response that finishes slightly later than necessary. If Phase 1 shows that Functions keeps the instance alive after the body is flushed, switch to a true detached approach and supersede this ADR.

**Measured locally (2026-11-06, Functions Core Tools 4.16.0, not Azure):** a route that responds immediately and calls `after()` with 2 seconds of deferred work completes the work (it is logged), but the client's request takes 2.14 seconds in total (time to first byte 0.12 s). So holding the stream open **does** delay the client by the full duration of the deferred work. This is a user-visible cost for every `after()`, queue enqueue on a cache miss, and cache write-through, and it makes this decision a poor default.

**Measured on Azure (2026-11-06, Flex Consumption, Node 22, japaneast):**

| Mode | `after()` with 2 s of work | Deferred work of 20 s, 90 s, 240 s |
| --- | --- | --- |
| `hold` (default) | client total 2039 ms (headers after 37 ms); the work completes | not measured (the response would stay open for 240 s) |
| `detach` (`WAIT_UNTIL_MODE=detach`) | client total 127 to 149 ms; the work completes (2004 ms later) | the 20 s and 90 s callbacks ran on time (20.004 s and 90.009 s) with **no request in flight and no new request** during those seconds; the 240 s callback **never ran** |

The 240 s callback was lost because the instance that held it disappeared: it logged nothing after 06:26:10 and the next request, at 06:28:00, started a new host. So on Flex Consumption an instance is **not frozen** after the response (timers keep running), but an **idle instance is removed after roughly 1.5 to 3.5 minutes without requests** and deferred work that outlives it is lost without any error. (One instance, one run: the bounds are from the log timestamps, not a documented timeout.) In `hold` mode an instance that is replaced during a settings change still finished its in-flight requests for minutes.

ISR enqueue under `detach`: a stale page was regenerated 3 s after the stale request. An earlier `detach` trial seemed to lose the enqueue, but that was the queue consumer not running yet, not the enqueue (see [ADR-0010](#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group)).

**Decision after the measurement:** keep `hold` as the default, because it is correct for any duration of deferred work; offer `detach` through the `waitUntilMode` Bicep parameter and `deploy --wait-until detach` for apps whose deferred work is short (the ISR enqueue and typical `after()` callbacks are). Work expected to take minutes needs a durable mechanism (a queue), not `after()`. Revisit the default once more data exists.

**Previously open question, now answered in part:** whether Flex Consumption keeps running (and keeps CPU) after the response body ends. If it does, end the body immediately and let deferred work finish on the warm instance. If it does not, a mechanism that keeps the invocation alive without holding the body is needed. Candidate: make the behavior configurable (`hold` vs `detach`) and default to whichever the Azure measurement supports. Local runs cannot answer this because they never freeze the process.

---

## ADR-0007: Azure SDKs are imported at runtime only

**Status:** Accepted, 2026-11-05.

**Decision:** Override modules load `@azure/*` with a non-literal dynamic `import()` (see `clients.ts`). `opennext-azure package` installs the SDKs into each Function app.

**Why:** OpenNext bundles `open-next.config.ts` with esbuild and evaluates it at build time. A literal import pulls `@azure/identity` and its dependencies into that bundle, which fails (`__dirname` redeclared). A computed specifier keeps the SDKs out of the config bundle.

**Trade-off:** no tree-shaking of the SDKs and a larger zip. REST-based "lite" overrides (as upstream does for AWS) are an option if size or cold start becomes a problem.

---

## ADR-0008: Packaging never runs `npm install` inside an OpenNext bundle

**Status:** Accepted, 2026-11-05.

**Decision:** `opennext-azure package` writes a fresh `package.json`, installs Azure dependencies in a temporary directory and merges them into the bundle's `node_modules` without overwriting.

**Why:** OpenNext already traces and installs what each bundle needs (including `sharp` for images). Running `npm install` inside the bundle removed `sharp` (it was not in the generated `package.json`) and, for the server, installed the whole application's dependencies.

---

## ADR-0009: Single Function app and optional Front Door by default

**Status:** **Accepted** 2026-11-06 on local evidence and **implemented the same day** (package, local stack, asset resolver, `X-Azure-FDID` check, Bicep). Behavior on Azure is **unverified**; static asset cost is still to be measured.

### Evidence

**Front Door price** (Azure retail prices API, public list prices, USD, queried 2026-11-06): Standard base fee 35.00 per month per profile in every zone; Premium 330.00. Requests and data transfer out are billed on top (for example Standard requests 0.009 per 10K in Zone 1).

**Single app works locally.** The built `image`, `revalidation` and `server` bundles were loaded into one Functions app (one `main.mjs`, three registrations: `_next/image`, `{*path}`, queue trigger) and run under Core Tools 4.16.0 over HTTPS against Azurite. SSR, ISR page, 404, streaming (first bytes 0.04 s, Suspense part at 3.0 s), `revalidateTag`, image resize to WebP, `after()` and queue-driven ISR regeneration (consumer executed twice, both succeeded, timestamp advanced, `STALE` then `HIT`) all behaved exactly as in the three-app run. The `globalThis` clash assumed in ADR-0002 did not occur: the three bundles carry the same `open-next.config.mjs`, so the shared `openNextConfig` is identical, and the server alone owns the queue and cache globals.

**The one real constraint is the working directory.** Loading all three failed first with `ENOENT: prerender-manifest.json` because the revalidation adapter reads that file relative to `process.cwd()` at import time (on Lambda every function's cwd is its own root). Fix that worked: `process.chdir(<bundle dir>)` before importing each bundle, loading `server` **last** so it keeps its own directory as cwd at runtime.

**Cost of co-location (local, fresh processes, 3 runs each):** module load 59 ms for `server` alone vs 72 to 76 ms for all three; resident memory 87 MB vs 91 MB. Not measured: real cold start and scale-out on Azure (Phase 1c).

### Decision

1. **One Function app, three functions** is the default layout: `server` (`{*path}`), `image` (`_next/image`), `revalidation` (queue trigger). One plan, one set of settings, one package, no drift between apps.
2. **Front Door is optional** (Bicep parameter, off by default). Without it the Function app is the public entry point.
3. **Direct access restriction:** with no Front Door nothing can be bypassed. When Front Door is enabled, the app must reject traffic that did not come through it: the wrapper validates `X-Azure-FDID` against a `FRONT_DOOR_ID` setting (testable locally), and the Bicep adds an access restriction for the `AzureFrontDoor.Backend` service tag (support on Flex Consumption is unverified).
4. **Static assets:** serve them through an OpenNext `AssetResolver` override that reads exact paths from Blob, using a manifest of uploaded files (this also addresses B10). One origin, no public container, no CORS. A CDN, Front Door or another, can sit in front later. Cost to validate: every asset request becomes a function execution, which may be significant for large sites.

### Consequences

- The split layout (three apps) was **removed** from the code instead of being kept as an untested option. It can be rebuilt from this ADR if a real need appears.
- Shared instance: image processing and SSR compete for the same memory and CPU, and scale together. Memory must be sized for `sharp`. If this hurts in practice, splitting is the escape hatch.
- Packaging creates the single entry point with the `chdir` logic and installs the Azure SDKs once at the app root (done).
- The generated entry also sets `ASSETS_MANIFEST_PATH`: found during implementation, in a monorepo OpenNext nests the app inside the server bundle (`server/examples/app-router/`), so the runtime cwd is **not** the bundle root and a cwd-relative manifest lookup silently served no assets.
- `BUILD_ID`, which OpenNext copies into `assets` for its own tooling, is excluded from the manifest so it is not served.
- Revisit if Phase 1c shows that the single app's cold start or scale-out is materially worse than three apps.

### Alternatives considered

- Keep three apps (ADR-0002): rejected as the default; its only reason was a failure mode that did not occur.
- Front Door by default: rejected on cost for small projects.
**Azure result (2026-11-06):** the single app deployed and ran all three functions on Flex Consumption (Node 22, no Front Door): 321 `server`, 34 `revalidation` and 5 `image` invocations, 0 failures, 0 exceptions. Cold start about 4.1 to 4.5 s; 200 requests with 40 in parallel were served by 17 instances (p50 393 ms, p95 4.5 s). **Not measured: the three-app layout on Azure**, so the cold start and cost comparison with the split layout is still open. The Front Door variant has not been deployed.

- Public `assets` container plus `assetPrefix`: cheaper per request, but `assetPrefix` does not cover files in `public/` and exposes the container; kept as a fallback if the asset resolver proves too expensive.

---

## ADR-0010: ISR revalidation depends on the queue trigger scale group

**Status:** Observations recorded 2026-11-06 on Azure; cause of the one stall **unconfirmed**. **Deduplication implemented and verified on Azure 2026-11-06** (second Azure run). The lower polling interval is verified to remove the wait; the backlog alert was created by Azure Monitor but never fired.

### What was observed (Flex Consumption, one Function app, Node 22, japaneast)

| When | What | Time from enqueue to the revalidation function running |
| --- | --- | --- |
| 06:08 | Right after a deployment | about 1 s |
| 06:49 | After 11 minutes without any request | **about 5 s** (a different instance started and consumed it, then made the `HEAD` request to the page) |
| 06:33:56 | Right after a 200-request burst that had created 17 instances | **2 min 21 s**: nothing consumed the queue until 06:36:17, when a new instance started after a settings change, and it processed **27 messages at once** |

During the stall two instances reported the host health check `azure.functions.webjobs.storage` as Unhealthy with "Unable to create client for AzureWebJobsStorage" (06:34:03 and 06:36:51). That coincides with the stall but is **not shown to be its cause**.

### Consequences that follow from the data, whatever the cause

1. **Messages are not deduplicated** (Storage Queue). Each request that finds the page stale enqueues a message. While the revalidation is delayed, every further request adds one: 25 polling requests became 25 messages and 27 regenerations of the same page. The cost grows with traffic during the delay. **Fixed by a claim before enqueueing, see "Deduplication" below.**
2. **A stale page can stay stale for minutes** if the consumer stalls. Pages are still served (stale-while-revalidate), so this is a freshness problem, not an outage.
3. Failed consumption is silent from the HTTP side. Nothing alerts on a queue that is not being drained.

### Deduplication (implemented)

Before a message is enqueued the request must win a **claim** on that page: a row in the tag cache table (own partition `dedupe-<build id>`, row key a SHA-1 of host and URL) written with optimistic concurrency. No row: create it (409 means somebody else did). Row of the same version younger than the window (`REVALIDATION_DEDUPE_SECONDS`, default 60): somebody already asked, enqueue nothing. Otherwise: replace it using the row's ETag (412 means somebody else did). So of any number of simultaneous requests on any number of instances exactly one enqueues; after the window the claim can be taken again, so a lost message cannot block a page for good. A storage error while claiming enqueues anyway (a duplicate costs a render, a missing revalidation leaves a page stale).

**The page version is the ETag, not `lastModified`.** The first version used `lastModified` from the message and failed its end-to-end test: 30 simultaneous requests still caused 6 regenerations. Reproduced locally; the dedupe row showed `version = 0`. OpenNext's server path sets the async-storage `lastModified` to a *marker* (`1` when the entry is stale, `0` when unset; `adapters/cache.js`, `store.lastModified = _isStale ? 1 : _lastModified`), so concurrent requests for the same page reported 0 or 1, counted as different versions, and took turns winning the claim. The ETag of the cached content is the same for every request that sees the same page and changes when it is regenerated with new content. An unknown version (no ETag, `lastModified` 0 or 1) is a wildcard: only the window decides. Consequence: a page regenerated to *identical* content keeps its claim until the window ends, which is harmless because the content did not change.

Limits: one row per page and build stays in the table (small, never cleaned); with an unknown version a page cannot be revalidated more often than the window (60 s by default), set `REVALIDATION_DEDUPE_SECONDS` lower for pages that must refresh faster; the claim costs one Table read and, for the winner, one write per stale request. Unit, Azurite (50 simultaneous requests against the real service, plus a race over an expired claim) and local end-to-end tests cover it. **Verified on Azure (second run, 2026-11-06):** 30 simultaneous requests for a stale page returned 30 `STALE` responses and caused **exactly one** `revalidation` invocation (22 s later, with the default polling). The first run, without dedupe, had 27 invocations from a polling loop of 25 requests.

### Why the wait was 20 to 57 seconds: measured

Three timed trials per setting, one stale request each, at least 2.5 minutes of silence between trials, one always-ready instance of the revalidation function in both cases (japaneast, Flex Consumption). "Wait" is from the end of the stale HTTP request (the enqueue) to the start of the `revalidation` invocation, both from Application Insights.

| `maxPollingInterval` | Waits (s) | Mean |
| --- | --- | --- |
| 60 s (platform default) | 32.7, 42.7, 57.5 | **44.3 s** |
| 5 s (`revalidationPollingSeconds=5`) | 1.6, 3.8, 1.1 | **2.2 s** |

Together with the earlier 22 s (stampede) and 37 s (first run) this confirms the hypothesis: an idle queue listener backs off its polling up to `maxPollingInterval`, so a message waits up to a minute. The cost of the fix is storage transactions: one poll every 5 s is 518,400 `GetMessages` per month per listening instance, which is about **0.21 USD per month** at the list price of 0.004 USD per 10,000 operations (Queues v2, Standard LRS, japaneast, Azure retail prices API, 2026-11-06); at 60 s it is about 0.02 USD. The storage metric for the actual count was not yet available when the resources were deleted, so that number is an estimate, not a measurement.

### Options

- **Always-ready instance for the revalidation function** (`revalidationAlwaysReady` in Bicep, `deploy --revalidation-always-ready 1`, setting `function:revalidation`). Costs one instance continuously. **Tested:** Flex accepted it (`alwaysReady: [{name: "function:revalidation", instanceCount: 1}]` is in the effective configuration). **It did not make consumption faster:** the message enqueued at 06:59:53 was consumed at 07:00:30, **37 s** later, against 5 s from a cold start. Likely reason (hypothesis, not tested): an idle queue listener backs off its polling up to `maxPollingInterval`, which is 1 minute by default (it shows in the host's `QueuesOptions`), whereas a freshly scaled-out instance polls at once. The stall of 2 min 21 s was seen once and could not be reproduced, so the effect on it is unknown.
- **Lower `maxPollingInterval`:** `revalidationPollingSeconds` in Bicep (`deploy --revalidation-polling-seconds <1-60>`) sets the app setting `AzureFunctionsJobHost__extensions__queues__maxPollingInterval`, which overrides `host.json`. Each poll of an empty queue is a storage transaction, so this trades a small, constant cost per running instance for latency. **Measured: 44 s becomes 2 s** (table above). Default stays 60 (the platform default) until a default is chosen; 5 s is the value that was tested.
- **Dedupe before enqueueing**: done, above.
- **An alert on the queue backlog:** (created and enabled on Azure with window PT1H and evaluation every PT15M; it never fired because the queues stayed empty, so nothing is known about a real alert.)
  Details: `queueBacklogAlertThreshold` in Bicep (`deploy --alert-queue-backlog <messages>`) creates a metric alert on `QueueMessageCount` of the storage account's queue service (average above the threshold over one hour, because Azure Monitor only accepts windows of PT1H, PT6H, PT12H or P1D for `QueueMessageCount` (found by the first deployment of the alert, not by `validate`); revalidation and poison queue together, since Storage reports no "age of the oldest message"). Off by default; without an action group (`alertActionGroupId`) it is visible in the portal only. Validated and what-if'd, not deployed. Still missing: an alert on the host health check.
- Find the cause of "Unable to create client for AzureWebJobsStorage" (identity token timing, role propagation, or the identity-based `AzureWebJobsStorage` settings) before choosing.

### Not decided

The default for `revalidationAlwaysReady` stays 0. `revalidationPollingSeconds` stays at the platform default 60 for now; the measurement supports recommending a low value (5 s) for sites where a stale page should be refreshed within seconds. Which default to ship is a decision for the maintainer, not made here. Nothing here is a reason to change the architecture; it is a reason to add dedupe and monitoring.

---

## ADR-0011: Next.js support follows `@opennextjs/aws`

**Date:** 2026-11-07. **Status:** accepted.

**Decision.** This package supports the Next.js versions that the installed `@opennextjs/aws` declares as its `peerDependencies`. For `@opennextjs/aws` 4.1.15 that is `>=15.5.29 <16 || >=16.4.5`, and the package declares the same range for `next`. When `@opennextjs/aws` changes its range, this one changes with it. The catalog in `pnpm-workspace.yaml` stays on the lowest 15.x; CI also runs the local E2E suite with the lowest 16.x (matrix in the `check` workflow). Dependabot does not open major updates of `next`: raising the range is a decision made here, not an automatic update.

**Why.** Behavior should match official OpenNext, which also uses version checks (`compareSemver`) internally. A range of our own would either promise more than OpenNext supports or diverge from it. Running both lines in CI keeps the claim honest: on 2026-11-07, `next` 16.4.5 passed the build and the local E2E suite (43 default, 10 front-door, 1 poison) in a trial, and the Azure E2E has only been run on 15.5.29.

**Rejected.** Moving the example to 16 only (loses the 15 coverage); a stricter range than OpenNext (needs its own justification for each version); no matrix (a Next.js 16 claim without a test).

**Consequences.** Azure has not been run on 16 (Unverified). A guard that refuses an unsupported version at `package` time is still open (roadmap).

---

## ADR-0012: The Next.js Adapter API is not adopted yet; Next.js 15 stays supported

**Date:** 2026-11-07. **Status:** accepted. Builds on [ADR-0011](#adr-0011-nextjs-support-follows-opennextjsaws).

**Decision.** This adapter keeps building on `@opennextjs/aws`, which reads the `next build` output, and does not use the Next.js Adapter API (`adapterPath`, `modifyConfig`, `onBuildComplete`). Next.js 15 stays in the supported range. Revisit when `@opennextjs/aws` adopts the Adapter API, or when Next.js 15 is no longer supported by the Next.js team.

**Why.**

- The Adapter API is a build-time interface that describes routes, outputs, prerenders and static files. Request handling, streaming and caching stay with the Next.js server and the cache interfaces (`cacheHandler`, `cacheHandlers`), so the overrides of this package (caches, queue, image, assets, wrapper) are not replaced by it. Source: the Next.js docs on adapters, read by a research agent on 2026-11-07, not by the maintainer or the assistant.
- It is stable only since Next.js 16.2 (blog post of 2026-03-18, same source). With Next.js 15 in the range, it cannot be the only path.
- Official OpenNext follows its own course: neither the `opennextjs-aws` nor the `opennextjs-cloudflare` README mentions it, and the Next.js "Across Platforms" post (2026-03) calls the Netlify, Cloudflare and AWS (OpenNext) adapters in development (current status not checked). Following OpenNext is the policy in ADR-0011.
- Next.js 15 is supported by the Next.js team until 2027-01-31, according to the maintainer (2026-11-07; official source not checked here). Dropping it earlier would leave users of a supported release without this adapter.

**Review date.** 2027-01-31, or earlier if `@opennextjs/aws` changes its `next` peer range or adopts the Adapter API. At that date: remove 15 from the range and the CI matrix if OpenNext has done so, and decide on the Adapter API.

**Rejected.** Moving to the Adapter API now (no gain for the runtime overrides, excludes Next.js 15); dropping Next.js 15 before its support ends.

**Not read.** The adapter sub-pages on PPR, routing and static assets, the feature matrix, the RFC (`vercel/next.js` discussion 77740), and `opennextjs-aws` issues beyond the first page.

---

## ADR-0013: Cold start: always-ready instances first, no timer warmer yet

**Date:** 2026-11-07. **Status:** accepted.

**Context.** `@opennextjs/aws` has a `warmer` override: a scheduled invocation that keeps Lambda instances warm. On Flex Consumption the platform has its own feature, always-ready instances per scale group (`http` for the HTTP function). Measured on Azure without it (Azure notes, items 19 and 20): HTTP cold start 4.1 to 4.5 s, up to 25.7 s for the first request after a package deployment, warm requests 25 to 60 ms.

**Decision.** There is no `warmer` override. Cold start is handled by the platform: the Bicep parameter `alwaysReadyInstances` (group `http`) is now reachable from the CLI as `deploy --always-ready <n>`; the default stays 0. A timer-triggered self-ping is not built.

**Why.**

- Microsoft documents always-ready instances as the Flex Consumption mitigation for cold starts; the warm-up trigger and prewarmed instances are Premium features (Microsoft Learn, read on 2026-11-07).
- Billing, per the same pages: on-demand instances are billed only while executing, with a monthly free grant of 100,000 GB-s and 250,000 executions per subscription (paid subscriptions only). Always-ready instances are billed for their memory all the time (baseline, in GB-s) plus execution time and executions, with no free grant. One 2 GB instance is about 5.2 million GB-s in a 30-day month, roughly 50 times that free grant. Prices were not readable on the pricing page; use the Azure pricing calculator.
- Always-ready instances count against the regional core quota (15 cores on Azure for Students and Free Trial subscriptions).
- A ping from a timer function would only keep an instance from being removed after idling (about 1.5 to 3.5 minutes, measured). It does not help when a burst needs new instances, it needs its own scale group to run in, and nothing here shows it works on Flex. It is cheap in theory (about 2 GB-s per execution at the 1 s minimum) but unverified.

**Rejected.** A `warmer` override that mimics the AWS one (different platform mechanism); always-ready by default (a continuous cost for every site, including the E2E runs).

**Open.** Measure the cold start and the first request after a deployment with `--always-ready 1` on Azure (needs a paid run; compare with items 19 and 20). Decide then whether to recommend it in Get started. Test a timer ping only if always-ready turns out too expensive for small sites. Pricing numbers for the cost section of the docs.

---

## ADR-0014: Optimized images are not cached by the server; `OPENNEXT_STATIC_ETAG` is on

**Date:** 2026-11-07. **Status:** accepted (option B). The maintainer asked to follow the official adapter.

**What was found.** The roadmap and B11 assumed a missing server-side cache for optimized images and called it the biggest gap against the official adapters. Reading the installed `@opennextjs/aws` 4.1.15 image adapter (`dist/adapters/image-optimization-adapter.js`) shows that this is the official design too: "We don't cache any images". It answers `Cache-Control: public,max-age=<n>,immutable` and `Vary: Accept`; the cache is expected to be the CDN (CloudFront on AWS) and the browser. With the environment variable `OPENNEXT_STATIC_ETAG` set, it also returns an `ETag` (hash of URL, width, quality and build id) and answers `304` to a matching `If-None-Match` before any image work. On Azure without Front Door there is no shared cache, and Front Door here caches only `/_next/static/*`, so each visitor's first request for each image size runs `sharp` on a function instance. Repeat requests of the same browser are answered from the browser cache.

**Options.**

- **A. Do nothing.** Same as the official adapter; no shared cache on Azure without a CDN.
- **B. Set `OPENNEXT_STATIC_ETAG=true` in the Bicep app settings.** One line; conditional requests (a browser revalidating, a CDN) end in a `304` without running `sharp` or reading the source. Caveats: the ETag does not include the `Accept` value although the response varies on it, and a remote source image that changes without a deployment is revalidated as unchanged until its `max-age` ends.
- **C. A Blob cache in the image function's wrapper.** On a request, look up a blob keyed by URL, width, quality, the full `Accept` value and the build id; on a miss run the handler, copy the bytes while streaming them, and store them after the response (`waitUntil`) when the status is 200, there is no `Set-Cookie` and `Cache-Control` has no `private`/`no-store`. Expire by the `max-age` of the stored response; add a Blob lifecycle rule to delete old entries. Buildable inside the existing override points, testable against Azurite. Costs: a storage container, a lifecycle rule in Bicep, a read per hit (a function execution still happens), a write per miss, and code to maintain.
- **D. Let Front Door cache `/_next/image`.** Only helps with the optional Front Door and needs a cache key on the query string and `Accept`.

**Decision.** B, implemented: `OPENNEXT_STATIC_ETAG=true` in the Bicep app settings and in the local stack; an E2E case checks the ETag and the 304. C and D are not built. The reasoning: it is the official mechanism, costs nothing and needs no new component. Do not build C until a measurement on Azure (time and memory of the image function for a typical photo, and the cost of repeated first requests) shows a problem. Revisit with the numbers. D is a separate decision for the Front Door variant.

**Not measured.** The time of `sharp` on Azure for realistic images (locally 30 to 50 ms for a 128 px source); how often visitors with a cold browser cache request the same image.

