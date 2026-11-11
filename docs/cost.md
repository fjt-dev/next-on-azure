# Cost

What a deployment costs depends on the traffic. This page says what is billed, what was measured on Azure, and what the bill looks like at different traffic. The estimates are made from measurements of one site (this documentation site) and are not bills. The only bill read so far is that of the short runs below (see "A real bill").

## What is billed

| Resource | Billed by |
| --- | --- |
| Function app ([Flex Consumption](https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan?wt.mc_id=studentamb_679600)) | executions, and memory times execution time (GB-seconds), above a monthly free grant; always-ready instances are billed continuously ([ADR-0013](./plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet)) |
| Application Insights and Log Analytics | ingested data (GB), above a monthly free grant |
| Storage account | transactions and capacity |
| Outbound data | GB sent to the internet, above a free first part |
| [Azure Front Door](https://learn.microsoft.com/azure/frontdoor/front-door-overview?wt.mc_id=studentamb_679600) Standard (optional) | a base fee per profile, plus requests and data |

Every request runs the function, static files included. `/_next/static/*` is sent with `Cache-Control: public, max-age=31536000, immutable`, so a browser fetches each file once; `public/` files are revalidated on every request ([ADR-0020](./plan/decisions.md#adr-0020-static-files-stay-with-the-function-cost-options-first-measure-later)).

## Measured on Azure

The documentation site was deployed twice on 2026-11-10 (Flex Consumption, japaneast, Next.js 15.5.29): one app with the defaults, one with 512 MB of memory. A script made 300 visits to each: 30% were first visits that fetch the page and its 10 static files, the others fetched the page only. Each run was 1,260 requests and 55.7 MB.

| | Measured |
| --- | --- |
| Requests per visit, data per visit | 4.2 requests, 186 KB |
| Execution time per request, 2048 MB | 0.106 GB-seconds (about 53 ms) |
| Execution time per request, 512 MB | 0.105 GB-seconds (about 209 ms): the same GB-seconds, a request four times as long |
| Application Insights data per request, default | about 4.1 KB (3,561 traces of 4.19 MB, 1,550 requests of 2.13 MB, 146 metrics, for 1,550 requests) |
| Application Insights data per request, `--request-telemetry errors` | about 0.63 KB (560 traces and 56 metrics, 0.79 MB, for 1,260 requests) |
| Storage transactions | a few thousand in the whole window, including the deployment: negligible in cost |

**Next.js 16.** The site was then moved to Next.js 16.4.5 (`proxy.ts` instead of `middleware.ts`) and deployed over the first app. The first run after that deployment: 0.203 GB-seconds per request (about 101 ms at 2048 MB) and 4.4 KB of telemetry per request. A second run a minute later: 0.052 GB-seconds per request (about 26 ms) and 3.8 KB. The first run on Next.js 15.5.29 had cost 0.106. The first requests after a deployment include the warm-up of a new instance, so the figures above are an upper bound for a site that stays up, and one sample of each does not show a difference between Next.js 15 and 16.

The largest part of the telemetry is not the request record but the "Executing" and "Executed" messages of the function. `--request-telemetry errors` sets `Host.Results` to `Error` and `Function.server` to `Warning`; the app setting names contain a period, and that works on Flex Consumption.

## A real bill

Azure Cost Management (actual cost, read through its [Query API](https://learn.microsoft.com/rest/api/cost-management/query?wt.mc_id=studentamb_679600) on 2026-11-11) for the resource group of the runs, 2026-11-08 to 2026-11-10: **0.28 yen in total** (0.0006 on 11-08 and 0.28 on 11-10; nothing was shown for 11-09, so usage of the last days may not be reported yet). The runs in that group were three short deployments of the example (17 to 35 minutes each) and the two apps of the documentation site (about two hours), each with a few thousand requests. This fits the estimate for a small site: inside the free grants, so the bill is the small items. It says nothing about the cost at real traffic, and a figure read within a day or two of the usage can still grow.

## Estimate by traffic

For a documentation-like site: 4.2 requests and 186 KB per visit, measured at 2048 MB. Prices are the Azure retail prices for Japan East of 2026-11-10 in USD: 0.40 per million executions, 0.000026 per GB-second, Log Analytics 3.34 per GB, Blob reads 0.004 per 10,000, outbound data 0.11 per GB after what looks like a free first 100 GB (**tier sizes not confirmed**). Free grants: 250,000 executions, 100,000 GB-seconds and 5 GB of Log Analytics a month, taken from the Azure docs and not re-read from the price list.

| Visits a month | Function | Application Insights, default | Application Insights, `errors` | Outbound data | Total, default | Total, `errors` |
| --- | --- | --- | --- | --- | --- | --- |
| 10,000 | 0 | 0 | 0 | 0 | about 0 | about 0 |
| 100,000 | 0.1 | 0 | 0 | 0 | about 0.2 | about 0.2 |
| 1,000,000 | 10.5 | 41 | 0 | 9.5 | about 62 | about 22 |
| 10,000,000 | 130 | 558 | 70 | 194 | about 900 | about 410 |

The function column uses the first-run figure; at steady state (0.052 GB-seconds per request) it is about half of that. Storage adds about 1.5 USD at one million visits. One always-ready instance adds its baseline: about 21 USD a month at 2048 MB. A site with more requests or more data per visit costs more, and one with fewer costs less: scale the table by the requests and the kilobytes of your own pages.

Up to about 100,000 visits a month the bill is inside the free grants or a few dollars. Above that, Application Insights is the largest part of the bill unless it is reduced, then the function, then outbound data.

## How to lower the bill

| Lever | Effect | State |
| --- | --- | --- |
| `deploy --request-telemetry errors` | 85% less Application Insights data; successful requests then do not appear there | **Verified (Azure)**, the effect measured |
| Fewer requests per visit | Serving `/_next/static/*` from Blob or Front Door (Standard: base fee about 35 USD a month at list price, checked on 2026-11-07; outbound data is billed there too) takes the static files off the function | Not built ([ADR-0020](./plan/decisions.md#adr-0020-static-files-stay-with-the-function-cost-options-first-measure-later)); worth it from a few hundred thousand visits a month, by the estimate |
| `deploy --max-instances <n>` | Bounds the worst case of a burst or abuse (default 20) | Accepted by the template; the effect was not measured |
| `deploy --cache-retention-days <n>` | Deletes cache entries, and those of old builds, after `n` days (default 30) | The rule was created on Azure (2026-11-10); that it deletes was not observed |
| `deploy --memory 512` | **None for this workload**: the request takes four times as long, the GB-seconds are the same, and the instance count went up | Measured; images with `sharp` at 512 MB were not tried |
| Keeping `--always-ready` at 0 | An always-ready instance costs about 21 USD a month at 2048 MB; it removes the cold start (2.4 s to 0.15 s) | Cost computed from the price list, cold start measured |

## What was not measured

- A bill at traffic: the one bill read is for runs of minutes to hours with scripted traffic, see "A real bill" below.
- Traffic of a real site: the visits were scripted, 4 at a time. Dynamic pages, images and Server Actions were not part of the load.
- Outbound data prices above the free first part, and Table Storage prices.
