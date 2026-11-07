# FAQ

## Is this an official OpenNext project?

No. It is an independent adapter built on `@opennextjs/aws` and its override system. The goal is to reach a quality level that would make it suitable for the OpenNext organization to consider, but there is no affiliation.

## Why build on `@opennextjs/aws` instead of the Next.js Adapter API?

`@opennextjs/aws` already solves routing, middleware, caching and bundling for Next.js, and it exposes override points designed for other platforms. Reusing it keeps this project small and keeps behavior aligned with the AWS and Cloudflare adapters.

## Why Functions and not Container Apps or App Service?

See [ADR-0001](./plan/decisions.md#adr-0001-compute-and-storage-targets). Container Apps is a reasonable second target for long-lived streaming and may be added later.

## Why Table Storage and not Cosmos DB for tags?

See [ADR-0003](./plan/decisions.md#adr-0003-table-storage-for-the-tag-cache). A Cosmos DB tag cache is a candidate for an alternative override.

## Can I use it without Front Door?

The Function apps are reachable directly, but static assets and image routing are configured in Front Door. Without it you must serve `assets` and route `/_next/image` yourself.

## Can I run it locally?

You can run the built handlers against Azurite today; see [Local development](./contribute/local_run.md). Running the full stack with Azure Functions Core Tools is planned for Phase 1.

## What does it cost?

Flex Consumption bills per execution and memory, Storage per use, and Front Door Standard has a base fee per profile. Always-ready instances (`--always-ready`, `--revalidation-always-ready`) are billed continuously; see [ADR-0013](./plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet). Check current Azure pricing for your region.
