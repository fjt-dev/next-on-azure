# Agent guide

This repository runs Next.js on Azure Functions (`next-on-azure`), developed with Claude Code. Read this file first.

## What this is

A pnpm + Turborepo monorepo. The package is `packages/next-on-azure` (name confirmed by the maintainer on 2026-11-10, ADR-0018): a `withAzure()` config helper, cache handlers on Blob and Table Storage, the Functions entry that forwards requests to the Next.js standalone server, a CLI (`package`, `deploy`, `prime`) and a Bicep template for one Azure Functions app (Flex Consumption); Front Door is optional. It does not use `@opennextjs/aws` (ADR-0016). Full context is in `docs/`.

## Read before working

1. `docs/plan/roadmap.md` for the current phase and what is next
2. `docs/plan/decisions.md` for decisions already made; do not re-litigate them without a new ADR
3. `docs/plan/worklog.md` for what was done and verified last

## Rules

- **Documentation is English.** Conversation with the maintainer may be in Japanese; files are English.
- **Document as you go.** At the end of each session add a work-log entry; update the roadmap checkboxes; add an ADR for any non-obvious design choice.
- **Tests with every change.** A behavior change needs a test in `packages/tests-unit` (and an E2E case if it is visible over HTTP). Tests that document a known gap use `it.fails` so they flag themselves when the gap is fixed.
- **Verification honesty.** Never write that something works unless it was run. Mark it **Verified (local)**, **Verified (Azure)** or **Unverified** in `docs/compatibility.md`.
- **Do not create Azure resources without asking.** Deploying costs money. Follow `docs/contribute/azure_runs.md`: dedicated resource group, time window, cost ceiling, delete by name, next-day inventory. Run the local stack first.
- **Package name: `next-on-azure`** (ADR-0018). It was free on npm when checked; check again on the publish day (the release plan). Do not rename it without a new ADR.
- **The runtime `.cjs` files must not `require("node:...")`** (Next.js 16 bundles them with Turbopack; see `docs/troubleshooting.md`).
- **Do not read the code of other Azure adapters for Next.js or OpenNext** (for example the npm package `opennextjs-azure` by another author): not the repository, the tarball or its documentation beyond the registry listing. Reading it would influence the design. Use official sources (Next.js, Microsoft Learn) and this project's own measurements.

## Commands

```bash
pnpm install
pnpm build              # turbo: build all packages
pnpm typecheck
pnpm lint
pnpm test               # unit tests (packages/tests-unit)
pnpm test:integration   # the real Azure SDKs against Azurite
pnpm e2e:standalone     # packages examples/standalone, starts the local stack, runs the HTTP suite
```

See `docs/contribute/local_run.md` for running the local stack (`node scripts/standalone-local.mjs`: Azurite + the Functions host).

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
