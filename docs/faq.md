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

It depends on the traffic. A small site stays inside the free grants of Azure Functions; a busy one pays for executions, instance time, Application Insights and outbound data. [Cost](./cost.md) has what was measured on Azure with the documentation site, an estimate by traffic (about 0.2 USD a month at 100,000 visits, about 22 to 62 USD at a million) and what lowers the bill. Always-ready instances (`--always-ready`) are billed continuously ([ADR-0013](./plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet)).

## Why are the first requests after a deployment slow?

Without `--always-ready` the instance starts on the first request (2.4 s measured after idle; 0.15 s with `--always-ready 1`). `deploy` makes that request itself and primes the prerendered pages, so a visitor does not.
