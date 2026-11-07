<h1 align="center">OpenNext Adapter for Azure</h1>

<p align="center">
  <a href="./docs/README.md">Docs</a> ·
  <a href="./docs/get_started.md">Get started</a> ·
  <a href="./docs/compatibility.md">Compatibility</a> ·
  <a href="./docs/plan/roadmap.md">Roadmap</a>
</p>

---

> **Status: experimental, pre-release, not yet published to npm.** This is a community adapter and **not an official OpenNext package**. It is not affiliated with the OpenNext organization or SST.

## Description

[OpenNext](https://opennext.js.org/aws) takes the Next.js build output and converts it into packages that can be deployed across a variety of environments. This project adds the Azure pieces: a set of OpenNext overrides, a small CLI and a Bicep template that run a Next.js app on **one Azure Functions app (Flex Consumption)**, with Blob, Table and Queue Storage for the cache, the tag cache and ISR revalidation. Azure Front Door is optional.

## Features

This adapter follows the Next.js features that `@opennextjs/aws` supports. Each item below is marked with how far it has been checked; the evidence, versions and open gaps are in [Compatibility](./docs/compatibility.md). If you run into a problem, check the [troubleshooting page](./docs/troubleshooting.md) first, then open a new issue.

- [x] App & Pages Router (checked on Azure)
- [x] API routes (checked on Azure)
- [x] Dynamic routes (checked on Azure)
- [x] Server-side rendering (SSR) with response streaming (checked on Azure)
- [x] Static site generation (SSG) and incremental static regeneration (ISR), regenerated through a Storage Queue (checked on Azure)
- [x] On-demand revalidation: `revalidateTag`, `revalidatePath` (checked on Azure)
- [x] Middleware (internal, in the same Function app) (checked on Azure)
- [x] Server Actions (checked on Azure)
- [x] Image optimization (`next/image`) with `sharp` (checked on Azure)
- [x] Composable Caching (`'use cache'`) (checked locally only)
- [ ] Partial Prerendering (not checked)
- [ ] Edge runtime (not supported: Azure Functions has none)

"Checked on Azure" means the automated E2E suite or a manual run passed on a real deployment; "checked locally" means it passed against Azurite and the Azure Functions host on a developer machine. Nothing is described as working unless it was run.

## Getting started

```bash
npm install opennext-adapter-azure @opennextjs/aws
npx open-next build
npx opennext-azure package
npx opennext-azure deploy --resource-group <rg> --name <short-name> --location <region>
```

The package name is not published yet, so this works only from a checkout of this repository today. The full guide, including `open-next.config.ts`, is [Get started](./docs/get_started.md).

## Configuration

### Configuration file

Create `open-next.config.ts` next to your `next.config.js` and point each OpenNext override at the Azure implementation. A complete file is in [Simple example](./docs/config/simple_example.md); every override has its own page under [Configuration](./docs/config/README.md).

### Debug mode

OpenNext runs in debug mode when `OPEN_NEXT_DEBUG=true` is set before the build. It prints a lot of additional logs, disables minification and adds source maps, so do **not** use it in production. See the [OpenNext configuration docs](https://opennext.js.org/aws/config).

## Cold start

A request that arrives while no instance is running waits for one to start. Measured on Azure without any mitigation: about 4.1 to 4.5 s, and up to 25.7 s for the first request right after a package deployment. `deploy` ends by requesting `/` until the app answers, so a visitor does not make that first request. `--always-ready <n>` keeps instances running (billed continuously). There is no timer-based warmer yet; see [ADR-0013](./docs/plan/decisions.md#adr-0013-cold-start-always-ready-instances-first-no-timer-warmer-yet).

## Repository layout

| Path | Contents |
| --- | --- |
| [`packages/open-next-azure`](./packages/open-next-azure) | The package: OpenNext overrides, CLI, Bicep template |
| [`packages/tests-unit`](./packages/tests-unit) | Unit and integration tests |
| [`packages/tests-e2e`](./packages/tests-e2e) | HTTP tests against the local stack or a deployment |
| [`examples/app-router`](./examples/app-router) | Example Next.js app used for manual and E2E testing |
| [`docs`](./docs) | Documentation, roadmap, decision records and work log |

## Contribute

To work on this adapter locally:

1. Clone this repository and install dependencies:

   ```bash
   pnpm install
   ```

1. Build all packages:

   ```bash
   pnpm build
   ```

1. Start the local stack (Azurite and the Azure Functions host) with the example app:

   ```bash
   pnpm local:stack
   ```

1. Change the adapter, rebuild, and test against the example app.

The full guide is [Local development](./docs/contribute/local_run.md). Pull requests are welcome once the repository is public; see [Contributing](./docs/contribute/README.md).

## Testing

Unit tests:

```bash
pnpm test
```

Integration tests (the real Azure SDKs against Azurite):

```bash
pnpm test:integration
```

End-to-end tests (build, package the example, start the local stack, run HTTP checks):

```bash
pnpm e2e:test
```

How the tests are organized, and the opt-in run against real Azure resources, is in [Testing](./docs/contribute/testing.md).

## Acknowledgements

This project is built on [OpenNext](https://opennext.js.org/aws) by the [SST](https://sst.dev) team and the OpenNext community. The override model, the structure of this documentation and many details of caching and revalidation come from `@opennextjs/aws`, and the compatibility work follows its behavior. Thanks to everyone who maintains it.

## License

MIT
