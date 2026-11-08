# FAQ

## Is this an official project of Next.js, Vercel or OpenNext?

No. It is an independent community project. Next.js is a trademark of Vercel, Inc. The name `next-on-azure` is provisional, and whether a name containing "Next" can be used for a published package has not been checked.

## Does it depend on `@opennextjs/aws`?

No. The first design did (see [Legacy](./legacy-opennext/README.md)); this one runs the Next.js standalone server and replaces only its caches.

## Why Functions and not Container Apps or App Service?

See [ADR-0001](./plan/decisions.md#adr-0001-compute-and-storage-targets). Functions on Flex Consumption scales to zero and streams responses. A container would run the standalone server without the forwarding step, and may be a second target later.

## Why Table Storage for the tags and not Cosmos DB?

See [ADR-0003](./plan/decisions.md#adr-0003-table-storage-for-the-tag-cache). The cache handler is one file; another store is a replacement of that file.

## Why does the Function forward requests to a server instead of calling Next.js directly?

The Functions host hands over a Fetch-style request, and Next.js's request handler expects Node's `IncomingMessage` and `ServerResponse`. Forwarding over loopback keeps the Next.js server exactly as Next.js ships it. Warm responses were 0.1 to 0.2 s from Japan; the cost of the loopback hop was not measured on its own.

## Can I use it without Front Door?

Yes, and that is the default. Static files are served by the function too, so a busy site should put a CDN in front.

## Can I run it locally?

Yes: [Local development](./contribute/local_run.md).

## What does it cost?

Flex Consumption bills per execution and memory, Storage per use, and Front Door Standard has a base fee per profile. Always-ready instances (`--always-ready`) are billed continuously; see [ADR-0013](./plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet). Check current Azure pricing for your region. The real runs so far were short (17 and 27 minutes of one small app); the cost figure from Azure Cost Management has not been read yet.

## Why are the first requests after a deployment slow?

Without `--always-ready` the instance starts on the first request (2.4 s measured after idle). `deploy` makes that request itself and primes the prerendered pages, so a visitor does not.
