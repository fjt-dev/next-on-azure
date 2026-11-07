# Agent guide

This repository is an Azure adapter for OpenNext, developed with Claude Code. Read this file first.

## What this is

A pnpm + Turborepo monorepo. The published package is `packages/open-next-azure` (placeholder name `opennextjs-azure`). It provides OpenNext overrides, a CLI (`package`, `deploy`) and a Bicep template to run Next.js on one Azure Functions app (Flex Consumption) with Blob/Table/Queue Storage; Front Door is optional (ADR-0009). Full context is in `docs/`.

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
- **Package name is a placeholder.** Do not hard-code it in source (ADR-0005).
- **Override modules must not import `@azure/*` statically** (ADR-0007).
- **Never run `npm install` inside an OpenNext bundle** (ADR-0008).
- **Do not read, copy or run the code of other Azure adapters for OpenNext, in particular the npm package `opennextjs-azure` (zpg6).** This includes its repository, its tarball and its documentation beyond the registry listing. The maintainer wants this project to stay independent. Use only official sources (OpenNext, Next.js, Microsoft Learn). Do not paste their snippets into this repository. Reason: ADR-0015.
- Follow OpenNext conventions; the upstream repository is `opennextjs/opennextjs-aws`.

## Commands

```bash
pnpm install
pnpm build        # turbo: build all packages
pnpm typecheck
pnpm lint
pnpm test               # unit tests (packages/tests-unit)
pnpm test:integration   # real Azure SDKs against Azurite
pnpm e2e:test           # builds + packages the example, runs the local stack, HTTP checks
pnpm --filter example-app-router run openbuild   # open-next build for the example
pnpm --filter example-app-router run package     # produce the single Function app zip (.open-next-azure/app.zip)
```

See `docs/contribute/local_run.md` for running the local stack (`pnpm local:stack`: Azurite + Functions Core Tools over HTTPS).

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
