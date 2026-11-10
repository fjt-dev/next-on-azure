# FAQ

## Why Functions and not Container Apps or App Service?

See [ADR-0001](./plan/decisions.md#adr-0001-compute-and-storage-targets). Functions on Flex Consumption scales to zero and streams responses. A container would run the standalone server without the forwarding step, and may be a second target later.

## Why Table Storage for the tags and not Cosmos DB?

See [ADR-0003](./plan/decisions.md#adr-0003-table-storage-for-the-tag-cache). The cache handler is one file; another store is a replacement of that file.

## Can I use it without Front Door?

Yes, and that is the default. Static files are served by the function too, so a busy site should put a CDN in front.

## Can I run it locally?

Yes: [Local development](./contribute/local_run.md).

## What does it cost?

Flex Consumption bills executions and memory times active time, Storage per transaction and capacity, Application Insights and Log Analytics per ingested GB, and Front Door Standard has a base fee per profile. Always-ready instances (`--always-ready`) are billed continuously ([ADR-0013](./plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet)).

**An estimate by traffic. Not measured: every quantity is an assumption** (see [ADR-0020](./plan/decisions.md#adr-0020-static-files-stay-with-the-function-cost-options-first-measure-later)). Unit prices are the Azure retail prices for Japan East of 2026-11-10 (USD): 0.40 per million executions, 0.000026 per GB-second, Blob 0.004 per 10,000 reads, Log Analytics 3.34 per GB. The free grants (250,000 executions and 100,000 GB-seconds a month, paid subscriptions only) are taken from the Azure docs, not re-read from the price list. Assumed: 30% of page views are first visits that fetch 30 static files (the browser keeps `/_next/static/*` for a year), so 10 executions per page view; 0.2 to 2 GB-seconds per page view at 2048 MB (a busy instance shares its time; a lone visit bills at least one second); 0.5 to 1 KB of Application Insights data per request, which is never sampled.

| Page views a month | Function, 2048 MB | Function, 512 MB | Application Insights | Total, 2048 MB |
| --- | --- | --- | --- | --- |
| 10,000 | 0 | 0 | 0 | about 0 |
| 100,000 | 0.3 to 2.9 | 0.3 | 0 | about 0.4 to 3 |
| 1,000,000 | 6.5 to 53 | 3.9 to 14 | 0 to 17 | about 7 to 70 |
| 10,000,000 | 89 to 557 | 50 to 167 | 150 to 317 | about 250 to 880 |

Storage adds about 0.5 USD at one million page views. One always-ready instance adds its baseline: about 21 USD a month at 2048 MB, about 5 USD at 512 MB. What brings the bill down, in the order of their effect: `--memory 512` (unverified below 2048), `--request-telemetry errors` (unverified), and, at hundreds of thousands of page views a month, serving `/_next/static/*` from Blob or Front Door instead of the function (Front Door Standard has a base fee of about 35 USD a month at list price, checked on 2026-11-07). The cost of serving static files through the function is the open item B3 of the [release plan](./plan/release_plan.md). The real runs so far were short (17 and 27 minutes of one small app, and two of about 35 minutes); no Azure Cost Management figure has been read yet.

## Why are the first requests after a deployment slow?

Without `--always-ready` the instance starts on the first request (2.4 s measured after idle; 0.15 s with `--always-ready 1`). `deploy` makes that request itself and primes the prerendered pages, so a visitor does not.
