# Azure

> **Experimental, pre-release, not yet published to npm.** This documentation covers a community adapter and **not an official OpenNext package**. It is not affiliated with the OpenNext organization or SST. The pages follow the structure of the [OpenNext for AWS docs](https://opennext.js.org/aws) so readers of one can find their way around the other.

OpenNext takes the Next.js build output and converts it into packages that can be deployed across a variety of environments. This adapter deploys that output to **one Azure Functions app (Flex Consumption)**, with Blob, Table and Queue Storage for the cache, the tag cache and ISR revalidation. Azure Front Door is optional.

OpenNext aims to support all Next.js 15 features, and this adapter follows what `@opennextjs/aws` supports. Some features are work in progress. If you run into a problem, check [Troubleshooting](./troubleshooting.md) first, then open a new issue.

Every statement about behavior on Azure is marked **Verified (local)**, **Verified (Azure)** or **Unverified** in [Compatibility](./compatibility.md). Nothing is described as working unless it was run.

- App & Pages Router, API routes, dynamic routes
- Static site generation, server-side rendering with streaming
- Incremental static regeneration, regenerated through a Storage Queue
- On-demand revalidation (`revalidateTag`, `revalidatePath`)
- Middleware, Server Actions
- Image optimization
- Composable Caching (`'use cache'`, checked locally only)

Not supported: the Edge runtime, function splitting and external middleware (see [Comparison](./comparison.md)).

Ready? Start with [Getting started](./get_started.md).

## Pages

| Section | What is in it |
| --- | --- |
| [Getting started](./get_started.md) | Install, configure, build and deploy a Next.js app to Azure |
| [Compatibility](./compatibility.md) | Supported Next.js versions and features, with verification status |
| [Configuration](./config/README.md) | [Simple example](./config/simple_example.md), [Reference](./config/reference.md) and one page per override: [Wrapper](./config/overrides/wrapper.md), [Converter](./config/overrides/converter.md), [Incremental cache](./config/overrides/incremental_cache.md), [Tag cache](./config/overrides/tag_cache.md), [Revalidation queue](./config/overrides/queue.md), [Image loader](./config/overrides/image_loader.md), [Asset resolver](./config/overrides/asset_resolver.md), [Revalidation](./config/overrides/revalidate.md) |
| [Comparison](./comparison.md) | How this adapter differs from the official AWS and Cloudflare adapters |
| [How does it work?](./inner_workings/architecture.md) | [Default architecture](./inner_workings/architecture.md), [Caching and revalidation](./inner_workings/caching.md), [Azure notes](./inner_workings/azure_notes.md) |
| [FAQ](./faq.md) | Short answers |
| [Troubleshooting](./troubleshooting.md) | Known problems and fixes |
| [Contributing](./contribute/README.md) | [Run locally](./contribute/local_run.md), [testing](./contribute/testing.md), [CI](./contribute/ci.md), [real Azure runs](./contribute/azure_runs.md) |
| [Plan](./plan/roadmap.md) | Roadmap, release plan, architecture decision records and the work log |

## Documentation conventions

- Documentation is written in **English**.
- Every claim about behavior on Azure must be marked **Verified** or **Unverified**. Never describe a behavior as working unless it was actually run.
- Update the [work log](./plan/worklog.md) at the end of every working session, and the [roadmap](./plan/roadmap.md) whenever a task changes state.
- Record every non-obvious design choice as an [ADR](./plan/decisions.md) with its reasoning and the alternatives considered.
- Pages are plain Markdown so they render on GitHub. They can be fed to a docs site generator later without changes.
