# Local development

## next-on-azure (current)

```bash
pnpm install
pnpm build                                          # builds packages/next-on-azure
pnpm --filter example-standalone run standalone     # next build + next-on-azure package --target local
node scripts/standalone-local.mjs                   # Azurite + the Functions host on http://localhost:7071
```

`standalone-local.mjs` starts Azurite with empty storage on every run and runs `examples/standalone/.next-azure/app`. To run the HTTP suite against it: `pnpm e2e:standalone` (it packages, starts the stack, runs the suite and stops everything), or `E2E_BASE_URL=http://localhost:7071 E2E_TARGET=standalone pnpm --filter tests-e2e exec vitest run --project remote` with the stack already running. Start from empty storage for each run: the time-based ISR cases assume that no entry is older than the test.

To try another Next.js version, change `next` in the catalog of `pnpm-workspace.yaml` and run `pnpm install --no-frozen-lockfile` (CI does this for its Next.js 16 leg). In a git worktree the Functions Core Tools binary may be missing; copy the `bin` directory of `node_modules/azure-functions-core-tools` from another checkout.

## Legacy package (open-next-azure)

## Setup

```bash
pnpm install
pnpm build            # builds packages/open-next-azure
pnpm install          # again, only the first time, so pnpm links the opennext-azure bin
```

## Build the example app

```bash
pnpm --filter example-app-router run openbuild   # next build + open-next build
pnpm --filter example-app-router run package     # Azure Function app zips in .open-next-azure/
```

## Run the full local stack

Needs the example built and packaged (see above). One command starts Azurite and the single Function app under Azure Functions Core Tools over HTTPS:

```bash
pnpm local:stack
```

| What | Where |
| --- | --- |
| App (`server`, `image`, `revalidation`) | `https://localhost:7071` (`/_next/image` is the image function; the queue trigger runs in the same host) |
| Azurite | blob 10000, queue 10001, table 10002 |
| Logs | printed at startup, under the OS temp directory |

What the script does: creates a self-signed certificate valid for one day, starts Azurite, creates the `cache` and `assets` containers, the `tagcache` table and the `revalidation` queue, uploads `.open-next/assets` (with content types) and `.open-next/cache` like `deploy` does, then starts the app. The app trusts only this run's certificate, which the revalidation trigger needs to call `https://localhost:7071`. To test the Front Door check, start the stack with `FRONT_DOOR_ID=some-id` in the environment (ISR regeneration will then be refused, because the trigger's own request does not carry `X-Azure-FDID`). On exit (Ctrl+C) it stops everything and deletes the certificate and temp files.

On macOS or Windows the app runs from a temporary copy whose `image` bundle has sharp binaries for your machine; the packaged zip keeps the Linux x64 binaries that Azure needs.

Use `curl -k` because the certificate is self-signed:

```bash
curl -sk https://localhost:7071/isr
curl -sk "https://localhost:7071/_next/image?url=%2Ftest.png&w=64&q=75" -o out.png
curl -sk -X POST https://localhost:7071/api/revalidate   # revalidateTag("demo-tag")
```

The example app has routes that exist to test specific behavior: `/isr` (5 second ISR), `/slow` (streaming), `/tagged` + `/api/revalidate` (tag cache), `/api/after` (`after()` / `waitUntil`), `/blog/a` (static + ISR).

Requires `openssl` and the dev dependencies installed by `pnpm install` (Core Tools and Azurite). See [Troubleshooting](../troubleshooting.md) if `func` is missing.

## Useful commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type check all packages |
| `pnpm lint` | Biome check |
| `pnpm test` / `pnpm test:integration` / `pnpm e2e:test` | Unit, Azurite integration and local-stack E2E tests, see [Testing](./testing.md) |
| `pnpm local:stack` | Azurite + the single Function app over HTTPS |
| `pnpm --filter opennext-adapter-azure bicep:build` | Compile the Bicep template (needs Azure CLI) |

## Conventions

- TypeScript with ESM; relative imports include the `.js` extension.
- Do not import `@azure/*` statically in override modules ([ADR-0007](../plan/decisions.md#adr-0007-azure-sdks-are-imported-at-runtime-only)).
- Do not hard-code the package name in source files ([ADR-0005](../plan/decisions.md#adr-0005-package-name-is-deferred)).
- Update the [work log](../plan/worklog.md) and [roadmap](../plan/roadmap.md) with every change.
