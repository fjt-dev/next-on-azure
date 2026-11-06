# OpenNext for Azure

An [OpenNext](https://opennext.js.org/aws) adapter that runs Next.js on Azure: Functions (Flex Consumption) for compute, Blob / Table / Queue Storage for caching and ISR, and Front Door for delivery.

> **Status: experimental, pre-release.** The adapter builds and runs locally against Azurite. It has not been deployed to Azure yet. See [Compatibility](./docs/compatibility.md) and the [roadmap](./docs/plan/roadmap.md).
>
> This is an independent project and is not affiliated with the OpenNext organization.

## Repository layout

| Path | Contents |
| --- | --- |
| [`packages/open-next-azure`](./packages/open-next-azure) | The package: OpenNext overrides, CLI, Bicep template |
| [`examples/app-router`](./examples/app-router) | Example Next.js app used for manual and E2E testing |
| [`docs`](./docs) | Documentation, roadmap, decision records and work log |

## Quick start

See [Get started](./docs/get_started.md). To work on this repository, see [Local development](./docs/contribute/local_run.md).

```bash
pnpm install
pnpm build
```

## Documentation

Start at the [docs index](./docs/README.md). Project planning lives in [`docs/plan`](./docs/plan/roadmap.md).

## License

MIT
