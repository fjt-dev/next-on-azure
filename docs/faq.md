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

Flex Consumption bills per execution and memory, Storage per use, and Front Door Standard has a base fee per profile. Always-ready instances (`--always-ready`) are billed continuously; see [ADR-0013](./plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet). Check current Azure pricing for your region. The real runs so far were short (17 and 27 minutes of one small app); the cost figure from Azure Cost Management has not been read yet.

## Why are the first requests after a deployment slow?

Without `--always-ready` the instance starts on the first request (2.4 s measured after idle; 0.15 s with `--always-ready 1`). `deploy` makes that request itself and primes the prerendered pages, so a visitor does not.
