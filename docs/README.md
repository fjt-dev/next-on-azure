# Documentation

> **Experimental, pre-release, not published.** `next-on-azure` is a provisional name (ADR-0017). It is a community project, not affiliated with Vercel or the Next.js team; Next.js is a trademark of Vercel, Inc.

`next-on-azure` runs a Next.js app on **one Azure Function (Flex Consumption)**: the Next.js server runs inside the Functions worker, and its caches are kept in Blob and Table Storage. It uses the options Next.js documents for this (`output: "standalone"`, `cacheHandler`, `cacheHandlers`) and does not depend on `@opennextjs/aws`.

Every statement about behavior on Azure is marked **Verified (Azure)**, **Verified (local)** or **Unverified** in [Compatibility](./compatibility.md). Nothing is described as working unless it was run.

| Page | What is in it |
| --- | --- |
| [Get started](./get_started.md) | Install, configure, build, package and deploy |
| [Compatibility](./compatibility.md) | Next.js versions and features, with verification status and known gaps |
| [Configuration](./configuration.md) | `withAzure()`, environment variables, the CLI |
| [How it works](./how_it_works.md) | The request path, the caches, `after()`, priming, packaging |
| [Azure notes](./inner_workings/azure_notes.md) | Platform facts that shaped the design, with their source |
| [Comparison](./comparison.md) | OpenNext (AWS, Cloudflare) and the Next.js Adapter API |
| [FAQ](./faq.md), [Troubleshooting](./troubleshooting.md) | Short answers; known problems and fixes |
| [Contributing](./contribute/README.md) | Run locally, tests, CI, real Azure runs |
| [Plan](./plan/roadmap.md) | Roadmap, release plan, decision records (ADRs) and the work log |
| [Legacy](./legacy-opennext/README.md) | Documentation of the first, OpenNext-based package, until it is removed |

## Documentation conventions

- Documentation is written in **English**.
- Every claim about behavior on Azure must be marked **Verified** or **Unverified**.
- Update the [work log](./plan/worklog.md) at the end of every working session and the [roadmap](./plan/roadmap.md) when a task changes state.
- Record every non-obvious design choice as an [ADR](./plan/decisions.md).
