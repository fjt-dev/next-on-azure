# Standalone spike (ADR-0016)

Next.js on one Azure Function **without `@opennextjs/aws`**: the Next.js standalone server runs inside
the Functions worker, `main.mjs` forwards every request to it over loopback, and the caches are
replaced through the documented options `cacheHandler` and `experimental.cacheHandlers`
(`cache-handler.cjs`, `cache-handlers.cjs`, both on Blob and Table Storage).

This is an experiment, not a supported package. Results and open points: ADR-0016 in
`docs/plan/decisions.md`.

## Run it locally

```bash
pnpm --filter example-standalone run standalone      # next build + build-app.mjs -> .azure-app/
node ../../scripts/standalone-local.mjs         # Azurite + the Functions host on http://localhost:7071
E2E_BASE_URL=http://localhost:7071 pnpm --filter tests-e2e run e2e:remote
```

Start from empty storage for each E2E run (the script does): ISR cases assume that no entry is older
than the test.
