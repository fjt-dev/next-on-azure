# Comparison

How this adapter relates to the official OpenNext adapters. Compared with `@opennextjs/aws` 4.1.15 (types and docs) and `@opennextjs/cloudflare` (docs), on 2026-11-07. Not every official feature is a goal; each difference is a decision, recorded in the [ADRs](./plan/decisions.md).

## What is the same

- The override model: wrapper, converter, incremental cache, tag cache (`nextMode`), queue, image loader, asset resolver, revalidation wrapper and converter.
- The Blob layout of the incremental cache is the layout of the S3 override.
- Tag cache semantics (`hasBeenRevalidated`, `isStale`, `writeTags` with `stale` and `expire`) equal the official `nextMode` implementation.
- Queue messages carry the whole `{ host, url, lastModified, eTag }` body, and the revalidation consumer is OpenNext's own adapter (a `HEAD` with `x-prerender-revalidate` and `x-isr: 1`).
- Next.js support follows `@opennextjs/aws` ([ADR-0011](./plan/decisions.md)).

## What is different

| Topic | OpenNext AWS | This adapter |
| --- | --- | --- |
| Compute | Lambda functions, optionally split per route | One Azure Functions app (Flex Consumption); no function splitting, no external middleware, no origin resolver ([ADR-0009](./plan/decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default)) |
| Cache storage | S3 + DynamoDB + SQS | Blob + Table + Storage Queue |
| Edge runtime | Supported | Not available on Azure Functions |
| Revalidation de-duplication | FIFO queue message groups | A claim row in the tag table, load tested ([ADR-0010](./plan/decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group)) |
| Warmer | `warmer` function | No warmer override; `deploy --always-ready <n>` and a warm-up request after each deployment ([ADR-0013](./plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet)) |
| CDN invalidation | `cdnInvalidation` override | Not needed: Front Door caches only `/_next/static/*` (content-hashed) |
| Initialization function | Needed by the original tag cache mode | Not needed: this tag cache is `nextMode` |
| Development implementations | `fs-dev`, `dummy` | The local stack uses Azurite and the Functions host (`pnpm local:stack`) |
| Credentials | IAM roles | Managed identity; shared-key access is disabled on the storage account |
| Cache interception | Optional (`enableCacheInterception`) | Works locally with these overrides; off by default, as upstream; not tried on Azure |

## Compared with the Cloudflare adapter

Cloudflare has a larger CLI (`preview`, `populateCache`, `upload`, `migrate`), skew protection (experimental) and documented support for Partial Prerendering and Turbopack. Here the CLI is `package` and `deploy`; a local `preview` command is on the roadmap, and PPR and Turbopack are not verified.

## Not planned

Function splitting, external middleware and `originResolver` (single app); the Edge runtime (not available on Azure Functions).

## Where this adapter is ahead

ISR revalidation de-duplication with a load test, measured `waitUntil` behavior, identity-based access without shared keys, and an Azure E2E run from CI with automatic teardown.

The working list of open items is in the [roadmap](./plan/roadmap.md#comparison-with-the-official-adapters-2026-11-07).
