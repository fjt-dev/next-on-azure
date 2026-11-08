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

## Useful commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type check all packages |
| `pnpm lint` | Biome check |
| `pnpm test` / `pnpm test:integration` / `pnpm e2e:standalone` | Unit, Azurite integration and local-stack E2E tests, see [Testing](./testing.md) |
| `node scripts/standalone-local.mjs` | Azurite + the Functions host on http://localhost:7071 |
| `pnpm --filter next-on-azure bicep:build` | Compile the Bicep template (needs Azure CLI) |

## Conventions

- TypeScript with ESM; relative imports include the `.js` extension.
- Do not import `@azure/*` statically in override modules ([ADR-0007](../plan/decisions.md#adr-0007-azure-sdks-are-imported-at-runtime-only)).
- Do not hard-code the package name in source files ([ADR-0005](../plan/decisions.md#adr-0005-package-name-is-deferred)).
- Update the [work log](../plan/worklog.md) and [roadmap](../plan/roadmap.md) with every change.
