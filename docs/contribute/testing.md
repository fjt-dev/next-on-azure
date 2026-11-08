# Testing

| Layer | Command | Runs against |
| --- | --- | --- |
| Unit | `pnpm test` | `packages/tests-unit/src/unit/next-on-azure/`: config helper, packaging helpers, `prime`, deploy options, Bicep template, Front Door check, both cache handlers with a fake storage, `npm pack` contents |
| Integration | `pnpm test:integration` | both cache handlers with the real Azure SDKs against Azurite (ports 10100 to 10102) |
| Local E2E | `pnpm e2e:standalone` | the HTTP suite of `packages/tests-e2e` against `examples/standalone` in the real Functions host with Azurite |
| Azure E2E | workflow `azure-e2e` (manual) | the same suite against a deployment, see [Azure E2E in CI](./azure_e2e.md) |

`pnpm e2e:standalone` packages the example for the local machine, starts Azurite and the Functions host (`scripts/standalone-local.mjs`), runs the suite with `E2E_BASE_URL=http://localhost:7071`, and stops everything. Start from empty storage for each run (the script does): the time-based ISR cases assume that no entry is older than the test.

The suite against a deployment: `E2E_TARGET=standalone E2E_BASE_URL=https://<app>.azurewebsites.net pnpm --filter tests-e2e run e2e:remote`.

## What the suite checks

SSR, static and ISR pages (stale-while-revalidate), `revalidateTag` and `revalidatePath`, `'use cache'`, Pages Router (`fallback`, `notFound`, `res.revalidate`), middleware, Server Actions, `after()` (the response waits for the work), streaming with chunk timing, image optimization, cookies, HEAD, 404, static files. 47 cases.

## Rules

- A behavior change needs a test in `packages/tests-unit` and, if it is visible over HTTP, a case in `packages/tests-e2e`.
- A feature is only marked **Verified** in [Compatibility](../compatibility.md) when a test or a recorded run covers it.
- A new test is checked by breaking the code it covers once (the handler tests were: 4 failed).
