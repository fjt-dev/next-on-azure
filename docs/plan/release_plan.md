# Plan to the first public release

Rewritten 2026-11-08 for the design without OpenNext ([ADR-0016](./decisions.md), [ADR-0017](./decisions.md)); the earlier plan was for the OpenNext-based package. Sizes: S (hours), M (a day or two), L (several days) of focused work.

## 1. Starting point

| Area | State |
| --- | --- |
| Package | `packages/next-on-azure`, provisional name, private, version 0.0.1 |
| Verified on Azure | The HTTP suite (47 cases) passes on Next.js 15.5.29: Flex Consumption, japaneast, Node 22; cold start 2.4 s after idle (one sample); see [Compatibility](../compatibility.md) |
| Verified locally and in CI | Next.js 15.5.29 and 16.4.5 (`pnpm e2e:standalone`), 124 unit and 3 integration tests, lint, audit, secret scan, license allow-list; all CI jobs green |
| Not verified | Next.js 16 on Azure, Front Door, always-ready, `proxy` and `cacheComponents` with this design, `azure-e2e` workflow after its rewrite |
| Repository | Private (`fjt-dev/next-on-azure`), one maintainer; the documentation site is a separate private repository (`fjt-dev/docs-next-on-azure`) |

## 2. Decisions that are the maintainer's

| # | Decision | Notes |
| --- | --- | --- |
| P1 | The package name | `next-on-azure` is provisional and free on npm (checked 2026-11-08). Check again on the publish day. The npm package `opennextjs-azure` by another author exists; its code is not read ([AGENTS.md](../../AGENTS.md)) |
| P2 | Public or private, and when | A public repository gets unlimited free Actions minutes on standard runners (GitHub policy, to be confirmed), branch protection and environment reviewers on the free plan |
| P3 | The promise of `0.1.0` | Suggested: "experimental, App Router and Pages Router, Next.js 15, pnpm, Linux or macOS build machine"; the README lists the **Unverified** rows |
| P4 | npm account with two-factor authentication, package or scope, trusted publishing for the repository, a security contact address | Only the maintainer can do these |

## 3. Stage 1: `0.1.0-alpha` (public, tagged `alpha` on npm)

Gate: every item done, and one Azure run on the release commit with the whole suite green.

| # | Task | Size |
| --- | --- | --- |
| R1 | `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, `CODEOWNERS` | S |
| R2 | Scrub before the repository becomes public: the sample client id in `secret-scan.test.ts`, the OIDC subject in `azure_e2e.md`, resource names in the work log; run the history scan again | S |
| R3 | Release pipeline: Changesets version pull request, a `release` workflow with npm provenance and trusted publishing (no long-lived token), SHA-pinned actions, a protected environment; dry run with `npm publish --dry-run` | M |
| R4 | Install test of the packed tarball in a clean project (Node 22 and 24, Linux and macOS), running `package` on the example and on the documentation site (which already installs from a tarball) | M |
| R5 | GitHub settings: branch protection on `main` with the required checks, review of workflow changes, Dependabot, secret scanning and push protection | S |
| R6 | Azure run on the release commit: the suite on Next.js 15 and 16, `--always-ready 1` measurement, one `--front-door` deployment, the cost recorded; first a run of `azure-e2e` | M, costs money |
| R7 | npm and Yarn layouts of `node_modules` (only pnpm is verified): a clean-install test for npm; Yarn documented as unverified | M |

## 4. Stage 2: beta

| # | Task |
| --- | --- |
| B1 | Concurrent regeneration after a revalidation is not coalesced (ten values in one test): decide whether a lock in Table Storage is worth it |
| B2 | `after()` work cannot be tied to one request: measure how much it matters under load |
| B3 | Static files are served by the function: Blob or CDN for `/_next/static`, and its cost against the function executions |
| B4 | Observability: Application Insights queries (invocations, failures, instances), documented |
| B5 | Rollback and redeploy (Flex has no slots), and a deployment over an older build with and without a stable Server Actions key |
| B6 | `proxy` and `cacheComponents` (Partial Prerendering) with this design; Next.js 16 on Azure; Node 24 |
| B7 | Error after the first byte: decide and test what the client sees |
| B8 | i18n and base path, a custom domain in the template |

## 5. Not planned

The Edge runtime and external middleware (not available on Azure Functions); a second compute target such as Container Apps before the first release.

## 6. Cost rule

Every Azure run follows [Real Azure runs](../contribute/azure_runs.md): a dedicated resource group, a time window and a cost ceiling agreed first, resources deleted by name, an inventory the next day.
