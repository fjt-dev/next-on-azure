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

**Measured on Azure, with the documentation site (2026-11-10, two apps, 300 scripted visits each; 30% of the visits are first visits that fetch the page and its 10 static files, the others fetch the page only).** A visit made 4.2 requests and 186 KB. Per request at 2048 MB: 0.106 GB-seconds of execution time, and about 4.1 KB of Application Insights data (6.4 MB for 1,550 requests: 3,561 traces, 1,550 requests, 146 metrics). Storage transactions were few (about 3 Blob and 6 Table operations per page request, including the host's own).

**An estimate by traffic, from those numbers** (a documentation-like site: 4.2 requests and 186 KB per visit; Azure retail prices for Japan East of 2026-11-10 in USD: 0.40 per million executions, 0.000026 per GB-second, Log Analytics 3.34 per GB, Blob reads 0.004 per 10,000, outbound data 0.11 per GB after what looks like a free first 100 GB, **tier sizes not confirmed**; free grants of 250,000 executions, 100,000 GB-seconds and 5 GB of Log Analytics a month, taken from the Azure docs). Estimates, not bills.

| Visits a month | Function | Application Insights, `all` | Application Insights, `errors` | Outbound data | Total, `all` | Total, `errors` |
| --- | --- | --- | --- | --- | --- | --- |
| 10,000 | 0 | 0 | 0 | 0 | about 0 | about 0 |
| 100,000 | 0.1 | 0 | 0 | 0 | about 0.2 | about 0.2 |
| 1,000,000 | 10.5 | 41 | 0 | 9.5 | about 62 | about 22 |
| 10,000,000 | 130 | 558 | 70 | 194 | about 900 | about 410 |

Storage adds about 1.5 USD at one million visits. One always-ready instance adds its baseline: about 21 USD a month at 2048 MB. What brings the bill down: `--request-telemetry errors` (85% less telemetry, measured), and, for the rest, fewer requests per visit (static files from Blob or Front Door instead of the function; Front Door Standard has a base fee of about 35 USD a month at list price, checked on 2026-11-07, and outbound data is billed there too). `--memory 512` did **not** save money (measured). The cost of serving static files through the function is the open item B3 of the [release plan](./plan/release_plan.md). The real runs so far were short (17 and 27 minutes of one small app, two of about 35 minutes, and about 90 minutes for the documentation site); no Azure Cost Management figure has been read yet.

## Why are the first requests after a deployment slow?

Without `--always-ready` the instance starts on the first request (2.4 s measured after idle; 0.15 s with `--always-ready 1`). `deploy` makes that request itself and primes the prerendered pages, so a visitor does not.
