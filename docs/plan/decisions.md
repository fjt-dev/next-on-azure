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

**Status:** Accepted, 2026-11-05. Superseded by [ADR-0018](#adr-0018-the-package-name-is-next-on-azure) on 2026-11-10 (the rule about not hard-coding the name no longer applies).

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

---

## ADR-0015: The package is named `opennext-adapter-azure`; the positioning is open (superseded by ADR-0017 for the name)

**Date:** 2026-11-07, name decided 2026-11-08. **Status:** accepted for the name; positioning still open. Follows [ADR-0005](#adr-0005-package-name-is-deferred).

**Finding.** `opennextjs-azure` is already on npm (version 0.2.0, published 2026-08-30 by another maintainer, MIT, repository `zpg6/opennextjs-azure`), with a similar goal: OpenNext on Azure Functions with Blob, Table and Queue Storage. Seen through the npm registry metadata and README only. `opennext-azure` returned 404 on 2026-11-07, but as "Unpublished on 2025-10-29": a name that was unpublished may not be publishable again, so it is not relied on. `opennext-adapter-azure` had never been used (404) on 2026-11-08.

**Decision (name).** The unscoped name `opennext-adapter-azure`, chosen by the maintainer on 2026-11-08 after comparing `nextjs-azure` (taken on npm, and uses the Next.js name), `opennext-azure` (unpublished name, publishability unknown) and scoped names. It says what the package is, does not start with `opennextjs` (ADR-0005) and is spelled differently from the existing package. The README states that it is not an official OpenNext package. The OpenNext code is MIT licensed and the OpenNext README has no naming or trademark policy; other community packages use `opennext` in their names. Whether SST holds a trademark was not checked, so P5 (ask the OpenNext maintainers) stays recommended before publishing. Availability must be checked again on the publish day (P2).

**Open.** Whether to publish separately, contribute to the existing project, or offer this work to the OpenNext organization. See [Release plan](./release_plan.md), tasks P1 to P5. The package is renamed in the repository and is not published.

The code of other Azure adapters is not read while developing this project (rule in `AGENTS.md`). Contributing to or merging with the existing package, which would need a closer look, is not pursued for now.


---

## ADR-0016: Run Next.js on Azure without `@opennextjs/aws`; start with a spike (accepted for the spike)

**Date:** 2026-11-08. **Status:** the maintainer decided the direction; the design is validated by a spike before the existing package is changed. A first proposal of the same day was withdrawn when the goal was stated as "the Azure version of opennextjs-aws"; the maintainer then restated, as an instruction, that the implementation must not use `@opennextjs/aws`. The latest instruction is followed. It supersedes [ADR-0011](#adr-0011-nextjs-support-follows-opennextjsaws) and [ADR-0012](#adr-0012-the-nextjs-adapter-api-is-not-adopted-yet-nextjs-15-stays-supported) once the spike is accepted.

**Direction.** Keep the Next.js server (it does routing, rendering, middleware, streaming and image optimization) and provide only the Azure parts, through interfaces Next.js documents: `output: "standalone"`, `cacheHandler` (incremental and `fetch` cache, `revalidateTag`) and, for `'use cache'`, `cacheHandlers`. The goal of the user-visible behavior stays that of `opennextjs-aws` on Azure: one Function app, Blob, Table and Queue Storage, streaming, ISR, tags, images.

**Spike (this ADR's first step).** In a new example (`examples/standalone`): the app built with `output: "standalone"`; a Functions v4 HTTP function that starts the Next.js server inside the worker and forwards each request to it with streaming; a `cacheHandler` on Blob (entries) and Table (tags) against Azurite; run the existing HTTP E2E cases against it. Questions: streaming through the forward, cookies, ISR and `revalidateTag`/`revalidatePath`, `'use cache'`, image optimization, middleware, Server Actions; cold start and package size compared with the OpenNext bundle.

**Next.js 15.** The spike uses 15.5.29 (the catalog version), which has no Adapter API; `standalone` and `cacheHandler` exist in 15 and 16. Whether to also use the Adapter API on 16.2+ is decided after the spike.

**Name and docs.** The package is then not an OpenNext adapter; the name `opennext-adapter-azure` (ADR-0015) and the OpenNext-shaped docs are revisited after the spike, not before.

**Not done by this ADR.** The current package keeps working and is not changed until the spike is accepted. Nothing is removed.

### Spike results (2026-11-08, local only)

Setup: `examples/standalone` on Next.js 15.5.29, `output: "standalone"`, `outputFileTracingRoot` set to the workspace root, `cacheHandler` (`cache-handler.cjs`) and `experimental.cacheHandlers.default` (`cache-handlers.cjs`) on Azurite, `main.mjs` forwarding with `node:http` to the Next.js server started inside the worker, pnpm layout flattened with the existing helper. The existing E2E suite (`e2e:remote`, plain http on loopback) against it, from empty storage: **43 passed, 4 failed, 5 skipped** (52). Azure was not used.

Works: pages and route handlers, Pages Router (ISR, `fallback: "blocking"` and `true`, `notFound`, `res.revalidate`), time-based ISR with stale-while-revalidate **in the same process** (no queue: STALE is served, the next request is a HIT with the new page), `revalidateTag` and `revalidatePath` through the cache handler, `'use cache'` with `revalidateTag` through `cacheHandlers`, Server Actions (form post, `Next-Action` call), middleware (redirect, rewrite, header), streaming (the slow Suspense page), image optimization with Next.js's own optimizer (resize, WebP, 400 for a bad size), all cookies (five distinct `Set-Cookie`), static files and conditional requests (304). Package: zip 17.4 MB for the spike against 31.2 MB for the OpenNext package of the same app (not comparable: the OpenNext package carries three bundles and `sharp` for Linux, the spike's `sharp` is the build machine's). First request after the host started, including starting the Next.js server in the worker: 0.24 s (local, warm disk, Node 26).

The 4 failures are differences, not breakage: (1) `after()`: the response ends at once, the deferred work runs on in the process; the OpenNext wrapper held the response open for it (ADR-0006), and an idle instance can be removed while work is pending, so a hold is still to be designed; (2) a missing source image gives **400** (Next.js's own answer), the OpenNext adapter's mapping gave 404; (3) `/_next/static` JS is served as `application/javascript`, the test wanted `text/javascript`; (4) `public/` files get `public, max-age=0` without `must-revalidate`. 2 to 4 are expectations written for OpenNext's behavior.

Found on the way: Next.js writes the cache handler path into `server.js` relative to the dist directory, so the working directory must be the app directory; `next build` calls the handlers while prerendering (there is no storage account then), so they do nothing in the build phase; page entries carry their tags in the `x-next-cache-tags` header, not in the context; pages prerendered at build are not in Blob (a first request renders them; whether and how to seed them is open); a chunked POST never got an answer from the Functions Core Tools host over plain http (the test client now sends a Content-Length); forwarding the host's request stream hung, so POST bodies are buffered; Node's `fetch` answered 200 to a conditional request where `http` gets 304, so the forward uses `node:http`.

Not tested: Azure (Flex Consumption, run from package, symbolic links are gone), `sharp` for Linux x64 in the package, cold start and memory on Azure, Next.js 16, the Adapter API, concurrency (one worker serves many requests; HTTP concurrency setting), several instances sharing the cache and tags, deploying and the `deploy` CLI, a Front Door id check, `waitUntil`, error handling when the Next.js server dies or does not start, request body limits.

**Verdict so far:** the approach holds for the behavior the E2E suite checks, with much less code than the OpenNext overrides (a 130-line entry and two cache handler files). It is not yet a replacement: nothing runs on Azure, and the points above are open.

### Spike results on Azure (2026-11-08, one Function app, Flex Consumption, japaneast, Node 22, no always-ready)

Deployed with the Bicep template of the existing package (`name=sfjt1`) and `az functionapp deployment source config-zip` with the spike zip (17.5 MB, built with `--linux`: the Linux x64 `sharp` binaries are copied in; no symbolic links). The existing E2E suite against the deployment: **43 passed, 4 failed, 5 skipped**, the same 4 differences as locally (`after()` does not hold the response; 400 instead of 404 for a missing source image; JS content type; `Cache-Control` of `public/` files). The time-based ISR, `fallback`, `revalidateTag`, `'use cache'`, Server Actions, cookies, images, streaming and middleware cases pass on Azure.

Measured (one sample each, client in Japan, no always-ready): first request after a deployment 0.54 s (the deployment's own health check had already started the instance); first request after about 11 minutes idle **2.5 s**, then 0.13 s (the OpenNext package measured 4.1 to 4.5 s without always-ready); warm responses 0.1 to 0.2 s; 300 requests at 30 parallel to a dynamic page: all 200, p50 0.18 s, p95 0.71 s, max 1.13 s; 300 at 30 parallel to an ISR page: all 200, p50 0.12 s, p95 0.44 s. After `revalidateTag`, 60 parallel requests produced four different regenerated values within about 60 ms (no coalescing of concurrent renders) and the next 60 requests all saw the last one. Application Insights showed 15 distinct role instances over the whole life of the app across several deployments; how many served the load test was not read.

Found on Azure only: (1) the app directory is read-only: Next.js's image optimizer wrote to `.next/cache` and failed with `EACCES` on every first image request, logged as an unhandled rejection. Fixed with `images.maximumDiskCacheSize: 0` and `experimental.isrFlushToDisk: false`; after that the only error left in the traces was the expected one of the "unknown action id" test. (2) The front end sends `x-forwarded-proto: https`. With it, Next.js stopped treating its own loopback origin as the same origin and a middleware rewrite answered 500 ("Failed to proxy https://localhost:3000/..."). The same failure reproduces locally with that header. `main.mjs` no longer forwards that header and puts the public origin into `Location` (middleware redirects were pointing to `http://localhost:3000` even before). Absolute URLs that application code builds from `request.url` and writes into bodies are not corrected. `experimental.trustHostHeader` was tried first: it is not a documented option (it is set only when Next.js detects a hosting platform) and did not take effect.

Still not tested: always-ready, Next.js 16, a Front Door id check, `after()` hold, scale-out consistency of the cache with a measured instance count, prerendered pages seeded into Blob, the `deploy` CLI for this layout, a deployment over an older build (Server Actions key), error handling when the Next.js server dies, memory.

Cost: the app existed for about 27 minutes (13:33 to 14:00 JST). No figure from Azure Cost Management yet.

### Follow-up of the same day (local): after(), priming, Next.js 16

- **`after()`:** Next.js asks the platform for `waitUntil` through `globalThis[Symbol.for("@next/request-context")]`. `main.mjs` provides it, tracks the work, and holds each response open until the work registered before the response ended has settled (at most 220 s; `WAIT_UNTIL_MODE=detach` turns it off). The work cannot be tied to one request (it is registered inside the Next.js server, which the request reached over loopback), so a response may also wait for work of other requests that started earlier. The E2E cases for `after()` pass (2.01 s hold).
- **Priming:** with a custom cache handler Next.js does not read the pages that `next build` prerendered; each is rendered on its first request after a deployment (`x-nextjs-cache: MISS`). `prime.mjs <url>` requests every route of `prerender-manifest.json`, after which they are `HIT`. Converting the prerendered files into cache entries was not tried (version-specific format).
- **Concurrent regeneration:** after `revalidateTag`, parallel requests can each regenerate; they converge on the last write. Not changed.
- **Next.js 16.4.5 (local, Node 26):** the same E2E suite gives **45 passed, 2 failed, 5 skipped**; the 2 failures are the `public/` header expectations. Needed on 16: (1) the cache handler modules must not `require("node:...")`, because Turbopack bundles them into the proxy bundle and every proxied request fails with "Unsupported external type Url for commonjs reference" (reproduced with `next start` too); (2) the whole `sharp` package must be copied into the app, because the traced copy lacks `dist/index.cjs` and the image optimizer then silently returns the original. `experimental.cacheHandlers` and `experimental.useCache` still work on 16 with deprecation warnings (moved to `cacheHandlers` and `cacheComponents`); the `middleware` file convention is deprecated. Not run on Azure.
- **Next.js 15.5.29 (local) after these changes:** 44 passed, 3 failed (a missing source image answers 400, the two `public/` header expectations), 5 skipped.

---

## ADR-0017: Migrate to the standalone design in a new package, `next-on-azure`

**Date:** 2026-11-08. **Status:** accepted by the maintainer's instruction to migrate ("go ahead with the migration"); the name was provisional until [ADR-0018](#adr-0018-the-package-name-is-next-on-azure).

**Decision.** The runtime validated by the spike ([ADR-0016](#adr-0016-run-nextjs-on-azure-without-opennextjsaws-start-with-a-spike-accepted-for-the-spike)) becomes a package of its own, `packages/next-on-azure`, with the name `next-on-azure` (not published; `next-on-azure`, `next-azure-adapter`, `nextjs-on-azure` and `azure-next-adapter` were free on npm on 2026-11-08). It does not depend on `@opennextjs/aws`. The old package `packages/open-next-azure` stays untouched, with its tests and CI, until the new one reaches parity (the same E2E suite, an Azure run, docs). Then the old package is removed in a separate change. The name and the positioning are decided before publishing (ADR-0015 is superseded in spirit: `opennext-adapter-azure` no longer describes the project).

**Contents of the new package.** Runtime: cache handlers (`cache-handler`, `cache-handlers`) on Blob and Table, the Functions entry that forwards to the Next.js server, the cookie conversion. Build side: `withAzure(nextConfig)` (sets `output: "standalone"`, the handlers, and the settings the spike found necessary), a CLI with `package`, `prime` and `deploy`, a Bicep template without the OpenNext pieces. Code that is still good is moved from the old package by copy (flattening of pnpm trees, version and Server Actions key checks, warm-up).

**Stages.** (1) the package with runtime, config helper and CLI `package`/`prime`, unit and integration tests, the example using it, local E2E; (2) simplified Bicep and `deploy`, Azure run; (3) CI jobs; (4) docs rewrite and the choice of name; (5) removal of the old package.

**Name (2026-11-08).** The maintainer chose `next-on-azure` "for now". It was free on npm that day. Confirmed on 2026-11-10 (ADR-0018).

**Not decided.** Static files from Blob (today Next.js serves them from the package), Front Door, always-ready defaults, a Next.js Adapter API path for 16.2+.

### Azure run of the package build (2026-11-08, `next-on-azure`, new Bicep template and `deploy`)

Deployed with `next-on-azure deploy -g opennextjs-azure-fjtd -n nfjt1` (Flex Consumption, japaneast, Node 22, no always-ready, no Front Door): the new Bicep template deployed at the first try, the zip (17.7 MB, Linux `sharp`) was deployed, the first request after the deployment answered 200 in 0.6 s, and the 9 prerendered routes were primed in 0.6 s. The deployment command took about 3 minutes in all.

The HTTP suite with `E2E_TARGET=standalone` against the URL: **47 passed, 5 skipped** (the 5 skipped need the local host log or a local HTTPS fixture server). A first run had 2 failures in the time-based ISR tests: after priming, the first answer was already STALE, and the tests assumed a fresh page. The tests now wait for a non-stale page (`freshPage`); the behavior itself was correct (a probe every 1.5 s showed STALE then HIT with the new page, in cycles of 5 s).

Measured (one sample each, client in Japan): first request after about 11 minutes idle **2.4 s** (then 0.16 s and 0.55 s for an ISR page); 300 requests at 30 parallel: dynamic page all 200, p50 0.13 s, p95 0.29 s, max 0.34 s; ISR page all 200, p50 0.12 s, p95 0.86 s, max 1.2 s. Application Insights: no error except the expected one of the "unknown action id" test.

`'use cache'` consistency: 60 parallel requests before `revalidateTag` all saw one value; after it, 60 parallel requests saw ten different regenerated values within 70 ms (concurrent regeneration is not coalesced, across or within instances); the cache converges on the last write. Unchanged and unmitigated.

CI (GitHub, commit 04fcd42): all jobs green, including `standalone-e2e` on Next.js 15 and 16.4.5.

Not tested on Azure: Front Door, always-ready, Next.js 16, the Queue Data Contributor role being unnecessary (the template still grants it), a deployment over an older build with and without a stable Server Actions key, scale-out instance count.

Cost: the app existed for about 17 minutes (15:18 to 15:35 JST). No figure from Azure Cost Management yet.

## ADR-0018: The package name is `next-on-azure`

**Date:** 2026-11-10. **Status:** accepted by the maintainer ("next-on-azure is fine"). Supersedes [ADR-0005](#adr-0005-package-name-is-deferred).

**Decision.** The package, the repository and the documentation use the name `next-on-azure`. It follows the pattern `next-on-<platform>` of other platform packages for Next.js, and says what the package does: Next.js on Azure.

**Considered.** `azure-<name>`: the maintainer asked on 2026-11-10 whether to follow Microsoft's naming; rejected because `@azure/*` is Microsoft's own scope, an `azure-` prefix reads as an official package, and Microsoft's trademark guidelines are generally strict about product names that start with "Azure" (the guidelines themselves were not read in this session). `opennextjs-azure` and `opennext-*` names: dropped when the package stopped depending on `@opennextjs/aws` (ADR-0016).

**Consequences.** The "provisional" notes are removed from the README, the docs and the package. The rule not to hard-code the name in source files is gone. Before the first publish the name must be free on npm (checked on 2026-11-08; check again on the publish day); if it is not, a new ADR chooses another one.

## ADR-0019: Enterprise use at the level of OpenNext

**Date:** 2026-11-10. **Status:** accepted by the maintainer ("for organizations, at the level of opennextjs-aws").

**Decision.** Support for organizations means what OpenNext offers: a build that runs on the platform, documentation that says what the app needs, versioned releases and a security policy. The template (`infra/main.bicep`) and `deploy` are a reference implementation, as OpenNext's reference implementation is; an organization that has its own infrastructure code or landing zone creates the resources itself ([Your own infrastructure](../infrastructure.md)). OpenNext does not create infrastructure at all ([its architecture page](https://opennext.js.org/aws/inner_workings/architecture), read 2026-11-10).

**Not in the template, and not planned until someone needs it:** private networking, a web application firewall, customer-managed keys, redundancy and diagnostic settings, tags for Azure Policy, reuse of an existing workspace or plan. A first version of these (parameters for storage SKU, tags, an existing Log Analytics workspace, retention and diagnostic settings) was written and discarded the same day as beyond this level.

**Still to do at this level:** `SECURITY.md`, `CONTRIBUTING.md` and the other community files (R1, waits for the maintainer's contact address, P4), a statement of the supported Next.js and Node.js versions (the peer range and [Compatibility](../compatibility.md)), the release pipeline with provenance (R3).

## ADR-0020: Static files stay with the function; cost options first, measure later

**Date:** 2026-11-10. **Status:** accepted by the maintainer ("the current state may be fine", "otherwise keep the current state", and the choice of option B after the estimate by traffic).

**Context.** Every request, static files included, runs the function: in the first design the asset resolver read Blob inside the function, and now the Next.js server serves them from the package. OpenNext (AWS) serves its `assets` folder without the server function, from S3 behind a CDN that the user builds ([architecture page](https://opennext.js.org/aws/inner_workings/architecture), read 2026-11-10). `/_next/static/*` is sent with `Cache-Control: public, max-age=31536000, immutable`, so a browser fetches each file once; `public/` files are revalidated on every request.

**Decision.** For the alpha the design stays. Cost is lowered with options that do not change the design and are off by default: `deploy --memory`, `--max-instances`, `--cache-retention-days`, `--request-telemetry errors`. The estimate by traffic is on the [Cost](../cost.md) page, labelled as an estimate (real Japan East prices, assumed quantities). Serving `/_next/static/*` from Blob (a public read container and `assetPrefix`) or from Front Door Standard (Blob origin with the managed identity of Front Door; the Azure docs list this for Standard, partly marked preview) is **not** built. Decide it when the measurement of the documentation site's deployment and a target traffic exist; by the estimate, around a few hundred thousand to one million page views a month.

**Consequences.** Small sites pay close to nothing inside the free grants. **Measured on 2026-11-10** (documentation site on Azure, see the [Cost](../cost.md) page): about 4.1 KB of Application Insights data per request, 0.106 GB-seconds per request at 2048 MB, 186 KB and 4.2 requests per visit. For a busy site the Application Insights ingestion is the largest part of the bill (about 40 of 62 USD at a million visits); `--request-telemetry errors` cuts it by 85% (Host.Results to Error and Function.server to Warning; the app setting names with a period work on Flex Consumption). `--memory 512` saves nothing for this workload: a request takes about four times as long, so the GB-seconds are the same. The measurements still to be made: Cost Management figures, a longer run, `sharp` at 512 MB.

## ADR-0021: The first release is `0.1.0`, without a pre-release suffix

**Date:** 2026-11-10. **Status:** accepted by the maintainer ("the tag carries no letters").

**Decision.** The first public release is `0.1.0`, published with npm's default tag. No `-alpha`, `-beta` or `-rc` suffix and no `alpha` dist-tag. That the project is experimental is stated in the README, in the package description and on the [Support](../support.md) page, which promises only what was run. The `0.x` series itself tells users that a minor version may break. The stage that the first plan called beta becomes `0.2.0` and later minors.

**Consequence.** `npm install next-on-azure` installs the experimental release without asking for a tag: the documents must carry the warning, since the version does not. A pre-release channel (for testing a release before it is the default) is not planned; a release is tested on the release commit (R6) before it is published.
