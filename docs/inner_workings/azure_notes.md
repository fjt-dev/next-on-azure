# Azure notes

Azure platform facts that affect the design.

**Source and status.** Items marked *(microsoft)* were found in Microsoft Learn during development. Items marked *(reported)* come from an external review of an earlier Azure adapter that ran on real Azure; treat them as hypotheses until this project confirms them. Items marked *(verified 2026-11-06)* were observed by this project on a real Azure subscription (japaneast, Azure for Students), see the work log, session 7.

## Flex Consumption

| # | Fact | Source |
| --- | --- | --- |
| 1 | Linux only, one app per plan, no deployment slots. | reported |
| 2 | Runtime, scale and package location live in `functionAppConfig`. | microsoft |
| 3 | Classic settings are rejected or ignored: `FUNCTIONS_WORKER_RUNTIME`, `FUNCTIONS_EXTENSION_VERSION`, `WEBSITE_RUN_FROM_PACKAGE`, `WEBSITE_CONTENT*`, `WEBSITE_NODE_DEFAULT_VERSION` and others. Do not write them to a Flex app. | reported (`WEBSITE_RUN_FROM_PACKAGE` also: microsoft) |
| 4 | Initialization has a 30-second limit. | reported |
| 5 | The deployment container is filled by the platform. Do not write to it. | reported |
| 6 | Supported Node.js versions are 22 and 24. Node 22 runs our app. | microsoft; Node 22 *(verified 2026-11-06)* |
| 7 | Linux Consumption retires on 2028-09-30; do not target it. | microsoft |
| 8 | `az functionapp show` returns Flex apps with fields under `properties`. Queries written for the flat shape silently return nothing; test against the real shape. | *(verified 2026-11-06)*: `--query "{state:state, host:defaultHostName}"` returned `null` for both |
| 9 | `az functionapp deployment source config-zip` works on Flex (202, sync triggers, health check; about 3 minutes for a 32 MB package). | *(verified 2026-11-06)* |
| 10 | A first request after idle takes about 5 to 6 seconds. | reported (measured) |
| 11 | A burst of 200 requests (40 parallel) scaled to 7 to 9 instances with a maximum of 10. Set the maximum instance count explicitly, at creation, not afterwards (the default is large). | reported (measured) |
| 12 | Application data access by managed identity needs Blob, Queue and Table data roles. The Functions host needs *Storage Blob Data Owner* on its own storage when identity-based. | microsoft / reported. Worked with Blob Data Owner + Queue Data Contributor + Table Data Contributor on one storage account, with `AzureWebJobsStorage__accountName` and shared keys disabled *(verified 2026-11-06)* |
| 13 | **A deployed package keeps no symbolic links.** With links kept in the zip the app failed at startup (`Cannot find package 'next'`); with links followed it failed too (`Cannot find module 'styled-jsx/package.json'`) because Node resolves siblings from the real path. A pnpm `node_modules` must be turned into a plain tree. | *(verified 2026-11-06)* |
| 14 | Owner on the subscription gives no Blob data access. With shared keys disabled, whoever uploads files needs a data role (for example Storage Blob Data Contributor) on the storage account. | *(verified 2026-11-06)* |
| 15 | `az bicep build`, `az deployment group validate` and `what-if` do not catch a wrong built-in role definition id; the real deployment fails with `RoleDefinitionDoesNotExist`. | *(verified 2026-11-06)* |
| 16 | ARM registered the unregistered `Microsoft.Insights` provider by itself during the first template deployment. | *(verified 2026-11-06)*, as documented by Microsoft |
| 17 | The Flex Consumption app registered all three functions (`server`, `image`, `revalidation`) in one app, and one process served the HTTP routes and the queue trigger. | *(verified 2026-11-06)* |
| 18 | **An instance is not frozen after the response.** Timers set by deferred work kept running on time (20.004 s and 90.009 s) with no request in flight. But an **idle instance disappears after roughly 1.5 to 3.5 minutes** without requests, and deferred work that outlives it is lost silently (a 240 s callback never ran). | *(verified 2026-11-06)*, one run; bounds from log timestamps |
| 19 | Cold start of the HTTP function, client side, 32 MB package, 2048 MB instances, Node 22: **4.1 s** (first request after a settings restart), **4.25 s** (first request after about 4 minutes idle), up to **25.7 s** for the very first request after a package deployment. Warm requests: 25 to 60 ms. | *(verified 2026-11-06)*; the review reported 5 to 6 s |
| 20 | Burst of 200 requests, 40 in parallel, to the SSR page: all 200 returned 200 OK; p50 393 ms, p90 880 ms, p95 4.5 s, p99 5.0 s, max 5.7 s. **17 instances** served it (`maximumInstanceCount` was 20); one instance took 181 requests, 16 others took 1 or 2 each. The slow tail is the start-up of the extra instances (about 4 to 5 s each). | *(verified 2026-11-06)*; the review reported 7 to 9 instances with a cap of 10 for a similar burst |
| 21 | Changing an app setting restarts the app. The replaced instance keeps serving its in-flight requests (and their held deferred work) for minutes, while a new instance starts. During the switch requests took 2 to 31 s. | *(verified 2026-11-06)* |
| 22 | **A Bicep/ARM redeployment replaces the whole `appSettings` array.** A setting added afterwards with `az functionapp config appsettings set` is gone after the next `deploy`. Settings must live in the template. | *(verified 2026-11-06)* |
| 23 | Some instances report the host health check `azure.functions.webjobs.storage` as Unhealthy with "Unable to create client for AzureWebJobsStorage" right after they start (2 of about 20 instances). The effect on triggers is not known. | *(verified 2026-11-06)* as an observation, cause unknown |
| 24 | **Queue-trigger consumption does not run unless an instance is running that function.** Messages enqueued at 06:33:56 were not consumed until 06:36:17, when a new instance started (27 messages at once). A consumer that was running already picked a message up in 1 to 3 s. Presumably Flex scales non-HTTP function groups separately from HTTP, from zero; see ADR-0010. | *(verified 2026-11-06)* for the delay; the explanation is a hypothesis |
| 25 | Application Insights shows records about 1 to 3 minutes after the event. `az monitor app-insights query` works for diagnosis; `cloud_RoleInstance` tells which instance handled a request. | *(verified 2026-11-06)* |
| 26 | `alwaysReady: [{ "name": "function:revalidation", "instanceCount": 1 }]` is accepted by Flex. With it, a queued message was still consumed only 37 s later (cold start of the consumer: 5 s). Probable cause, untested: an idle queue listener's polling backs off to `maxPollingInterval` (1 minute by default). | *(verified 2026-11-06)* for acceptance and the delay, cause is a hypothesis |

## Pricing

| Item | Value | Source |
| --- | --- | --- |
| Front Door Standard base fee | 35.00 USD per month per profile, all zones; requests and data transfer out are extra | Azure retail prices API, public list price, queried 2026-11-06 *(verified)* |
| Front Door Premium base fee | 330.00 USD per month per profile | same |

List prices change and exclude agreements and discounts. Re-query before relying on them (`https://prices.azure.com/api/retail/prices`).

## Open items (not verified on Flex by anyone)

- ~~Identity-based host storage.~~ Verified, see item 12.
- Virtual-network integration (needs the Container Apps resource provider for subnet delegation).
- Reading the app with basic authentication disabled.

Treat these as unsupported until verified.

## Where the current implementation stands

- The Bicep template sets `AzureWebJobsStorage__accountName`, identity-based deployment storage, an explicit `maximumInstanceCount` and Blob/Queue/Table roles. It sets none of the rejected classic settings listed above, except that this is not yet proven against a real Flex app.
- It has never been deployed. Phase 1c is where items 1 to 12 get confirmed or corrected.
