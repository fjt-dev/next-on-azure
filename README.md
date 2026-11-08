<h1 align="center">next-on-azure</h1>

<p align="center">
  <a href="./docs/README.md">Docs</a> ·
  <a href="./docs/get_started.md">Get started</a> ·
  <a href="./docs/compatibility.md">Compatibility</a> ·
  <a href="./docs/plan/roadmap.md">Roadmap</a>
</p>

---

> **Experimental, pre-release, not published to npm.** `next-on-azure` is a provisional name.

## Description

`next-on-azure` runs a Next.js app on **one Azure Function (Flex Consumption)**. The Next.js standalone server runs inside the Functions worker; the package replaces only what has to be Azure-specific: the incremental cache and `'use cache'` (Blob Storage), the tag state (Table Storage), the Functions entry that forwards requests to the server, and the packaging and deployment. It uses the options Next.js documents for this (`output: "standalone"`, `cacheHandler`, `cacheHandlers`) and does not depend on `@opennextjs/aws`.

## Features

Each item is marked with how far it was checked; the evidence and the gaps are in [Compatibility](./docs/compatibility.md). "Azure" means the HTTP suite passed on a real deployment (47 passed, 2026-11-08), "local" means Azurite and the Functions host on a developer machine and in CI.

- [x] App Router and Pages Router, API routes, dynamic routes (Azure)
- [x] Server-side rendering with response streaming (Azure)
- [x] Static generation and ISR with stale-while-revalidate (Azure)
- [x] On-demand revalidation: `revalidateTag`, `revalidatePath` (Azure)
- [x] `'use cache'` with tags (Azure)
- [x] Middleware, Server Actions, `after()` (Azure)
- [x] Image optimization with `sharp` (Azure)
- [x] Next.js 15.5.29 (Azure) and 16.4.5 (local and CI; **not on Azure**)
- [ ] Front Door (the template compiles, never deployed), always-ready, Partial Prerendering with this design: not checked
- [ ] Edge runtime: not supported

## Getting started

```js
// next.config.mjs
import { withAzure } from "next-on-azure/config";
export default withAzure({ /* your Next.js configuration */ });
```

```bash
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
next build
next-on-azure package
next-on-azure deploy --resource-group <rg> --name <short-name> --location <region>
```

The package is not published, so this works from a checkout of this repository only (`examples/standalone` is a working app). The full guide is [Get started](./docs/get_started.md).

## Repository layout

| Path | Contents |
| --- | --- |
| [`packages/next-on-azure`](./packages/next-on-azure) | The package: config helper, cache handlers, Functions entry, CLI, Bicep template |
| [`packages/tests-unit`](./packages/tests-unit), [`packages/tests-e2e`](./packages/tests-e2e) | Unit and integration tests; HTTP tests against the local stack or a deployment |
| [`examples/standalone`](./examples/standalone) | Example app for the new package |
| [`docs`](./docs) | Documentation, roadmap, decision records and work log |

## Contribute

```bash
pnpm install
pnpm build
pnpm --filter example-standalone run standalone   # next build + package --target local
node scripts/standalone-local.mjs                 # Azurite + the Functions host, http://localhost:7071
```

Details: [Local development](./docs/contribute/local_run.md). Pull requests are welcome once the repository is public; see [Contributing](./docs/contribute/README.md).

## Testing

```bash
pnpm test               # unit tests
pnpm test:integration   # the real Azure SDKs against Azurite
pnpm e2e:standalone     # packages the example, starts the local stack, runs the HTTP suite
```

How the tests are organized, and the opt-in run against real Azure resources: [Testing](./docs/contribute/testing.md).

## License

MIT
