# Plan to the first public release

Rewritten 2026-11-08 for the design without OpenNext ([ADR-0016](./decisions.md), [ADR-0017](./decisions.md)); the earlier plan was for the OpenNext-based package. Sizes: S (hours), M (a day or two), L (several days) of focused work.

## 1. Starting point

| Area | State |
| --- | --- |
| Package | `packages/next-on-azure`, private, version 0.0.1; the name was confirmed on 2026-11-10 ([ADR-0018](./decisions.md#adr-0018-the-package-name-is-next-on-azure)) |
| Verified on Azure | The HTTP suite passes on Next.js 15.5.29 (47 cases, 2026-11-08) and 16.4.5 (48 cases, 2026-11-09 and 11-10, with `middleware.js` and with `proxy.js`; `cacheComponents` with a small app): Flex Consumption, japaneast, Node 22; first request after about 17 idle minutes 2.4 s, 0.15 s with `--always-ready 1` (one sample each); see [Compatibility](../compatibility.md) |
| Verified locally and in CI | Next.js 15.5.29 and 16.4.5 (`pnpm e2e:standalone`), 126 unit and 3 integration tests, lint, audit, secret scan, license allow-list; all CI jobs green |
| Not verified | Front Door, the cost figures, the `azure-e2e` workflow after its rewrite, macOS install tests in CI |
| Repository | Private (`fjt-dev/next-on-azure`), one maintainer; the documentation site is a separate private repository (`fjt-dev/docs-next-on-azure`) |

## 2. Decisions that are the maintainer's

| # | Decision | Notes |
| --- | --- | --- |
| P1 | The package name | **Decided 2026-11-10: `next-on-azure`** (ADR-0018). Free on npm when checked on 2026-11-08; check again on the publish day. The npm package `opennextjs-azure` by another author exists; its code is not read ([AGENTS.md](../../AGENTS.md)) |
| P2 | Public or private, and when | A public repository gets unlimited free Actions minutes on standard runners (GitHub policy, to be confirmed), branch protection and environment reviewers on the free plan |
| P3 | The promise of `0.1.0` | Suggested: "experimental, App Router and Pages Router, Next.js 15, pnpm, Linux or macOS build machine"; the README lists the **Unverified** rows |
| P4 | npm account with two-factor authentication, package or scope, trusted publishing for the repository, a security contact address | Only the maintainer can do these |

## 3. Stage 1: `0.1.0-alpha` (public, tagged `alpha` on npm)

Gate: every item done, and one Azure run on the release commit with the whole suite green.

| # | Task | Size |
| --- | --- | --- |
| R1 | `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, `CODEOWNERS` | S |
| R2 | Scrub before the repository becomes public: the sample client id in `secret-scan.test.ts`, the OIDC subject in `azure_e2e.md`, resource names in the work log; run the history scan again | S; **checked 2026-11-10**: working tree and history scans find nothing; the sample client id is gone; no e-mail address in tracked files; the only GUIDs are built-in role ids; left: the GitHub user and repository ids in the OIDC subject (`azure_e2e.md`, public through the GitHub API anyway), names of deleted resources and a home-directory path in the work log: the maintainer decides whether to scrub them |
| R3 | Release pipeline: Changesets version pull request, a `release` workflow with npm provenance and trusted publishing (no long-lived token), SHA-pinned actions, a protected environment; dry run with `npm publish --dry-run` | M |
| R4 | Install test of the packed tarball in a clean project (Node 22 and 24, Linux and macOS), running `package` on the example and on the documentation site (which already installs from a tarball) | M; **started 2026-11-10**: npm, macOS, Node 26 done (see R7); Linux, Node 22 and 24: CI job `install` passes (2026-11-10, commit a82be0d); macOS stays a local check |
| R5 | GitHub settings: branch protection on `main` with the required checks, review of workflow changes, Dependabot, secret scanning and push protection | S |
| R6 | Azure run on the release commit: the suite on Next.js 15 and 16, `--always-ready 1` measurement (done once on 2026-11-10), one `--front-door` deployment, the cost recorded; first a run of `azure-e2e` | M, costs money |
| R7 | npm and Yarn layouts of `node_modules` (only pnpm is verified): a clean-install test for npm; Yarn documented as unverified | M; **done locally 2026-11-10**: npm (Next.js 15 and 16) and Yarn 1 pass the suite (48 cases); Yarn Plug'n'Play was found to produce a broken package and is now refused with a message; the CI job `install` runs npm and Yarn 1 on Linux with Node 22 and 24 and passes (it found a bug on its first run, see the work log) |

## 4. Stage 2: beta

| # | Task |
| --- | --- |
| B1 | Concurrent regeneration after a revalidation is not coalesced (ten values in one test): decide whether a lock in Table Storage is worth it |
| B2 | `after()` work cannot be tied to one request: measure how much it matters under load |
| B3 | Static files are served by the function: Blob or CDN for `/_next/static`, and its cost against the function executions |
| B4 | Observability: Application Insights queries (invocations, failures, instances), documented |
| B5 | Rollback and redeploy (Flex has no slots), and a deployment over an older build with and without a stable Server Actions key |
| B6 | A CI case for `proxy` and `cacheComponents` (both pass on Azure and locally); Node 24 |
| B8 | i18n and base path, a custom domain in the template |

## 5. Not planned

The Edge runtime and external middleware (not available on Azure Functions); a second compute target such as Container Apps before the first release.

## 6. Cost rule

Every Azure run follows [Real Azure runs](../contribute/azure_runs.md): a dedicated resource group, a time window and a cost ceiling agreed first, resources deleted by name, an inventory the next day.
