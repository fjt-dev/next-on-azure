# Plan to the first public release

Written 2026-11-07. It extends Phase 4 of the [roadmap](./roadmap.md) with stages, gates, order and who does what. Sizes are S (hours), M (a day or two), L (several days) of focused work; there are no calendar dates because they depend on the maintainer's time, except one external date (see "Fixed dates").

## 1. Starting point

| Area | State | Evidence |
| --- | --- | --- |
| Features | App Router and Pages Router pages, ISR through a queue, `revalidateTag`/`revalidatePath`, `'use cache'`, Server Actions, middleware, streaming, `after()`, image optimization, static assets, cookies | [Compatibility](../compatibility.md) |
| Tests | 225 unit, 9 integration, 50 local E2E (plus 10 Front Door, 1 poison queue), on Next.js 15.5.29 and 16.4.5 in CI | CI `check` green on `main` |
| Azure | Two green E2E runs from CI (second: 35 passed on 2026-11-07 at `a03cfb0`; the later features are not run there yet) | [Azure E2E](../contribute/azure_e2e.md) |
| Repository | Private, one maintainer, 39 commits, no release yet, no public docs site | |
| Quality gates | Lint, typecheck, audit, secret scan, license allow-list, SHA-pinned actions, `npm pack` contents test | [Supply chain](../contribute/supply_chain.md) |

## 2. Finding: the planned name is taken, and there is prior art

- `opennextjs-azure` (the placeholder name of this package, ADR-0005) **is already published on npm** by another maintainer: version 0.2.0 (2026-08-30), MIT, repository `zpg6/opennextjs-azure`, "True serverless Next.js on Azure Functions", built on `@opennextjs/aws` 3.x. Read from the npm registry metadata and README only; its code was not read and its behavior was not tested.
- So the name cannot be used, and users will find two projects with similar goals. `opennext-azure` and a few other names were free on 2026-11-07 (`npm view` returned 404); that can change at any time.
- This is a positioning question before it is a naming question. Options: (A) publish separately under another name and state the differences plainly; (B) propose merging or contributing to the existing project; (C) offer this work to the OpenNext organization as the Azure adapter. The choice is the maintainer's. Whatever it is, first learn what the other project does and verifies (task P1).

## 3. Stages

### Stage 0: decisions and groundwork (before any code for the release)

| # | Task | Size | Who | Notes |
| --- | --- | --- | --- | --- |
| P1 | Compare with `zpg6/opennextjs-azure`: features, supported Next.js versions, tests, what is verified on Azure, license, activity. Read its code and run it on the Azure for Students subscription only if the maintainer agrees to the cost | M | assistant, maintainer decides on any Azure run | Output: a short comparison page and the A/B/C choice |
| P2 | Decide the package name and scope (ADR-0015, proposed). Candidates to check: `opennext-azure`, `@<npm-user>/opennext-azure`, a name that does not contain `opennextjs` (ADR-0005) | S | maintainer | Check availability again on the day |
| P3 | Decide public versus private and when. Public gives unlimited free Actions minutes for standard runners (GitHub policy, to be confirmed), branch protection and environment reviewers on a free plan, and is needed for npm provenance | S | maintainer | See the checklist in Stage 1 |
| P4 | Decide the audience and promise of `0.1.0`: "experimental, App Router, Linux/macOS build machines" is the suggested wording | S | maintainer | The README must list the **Unverified** items |
| P5 | Contact the OpenNext maintainers (Discord or an issue) about listing a community Azure adapter and the use of the name | S | maintainer | Not required to publish; recommended |

### Stage 1: `0.1.0-alpha` (public, tagged `next` or `alpha` on npm)

Gate: all items done and one full Azure E2E run green on the release commit.

| # | Task | Size | Verification |
| --- | --- | --- | --- |
| R1 | Rename the package everywhere (69 occurrences of the old name: package metadata, `open-next.config` examples, docs, CLI help). The code must not hard-code it (ADR-0005); keep one constant | M | unit test that greps for the old name; CI |
| R2 | README for the package and the repository: what it is, not an official OpenNext package, status table, install, one-page quick start, link to the comparison with the other project | M | review |
| R3 | `SECURITY.md` (how to report, a contact), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, `CODEOWNERS` | S | review |
| R4 | Scrub the repository before it becomes public: the test sample with a real client id (`secret-scan.test.ts`), the federated credential subject in `azure_e2e.md`, any other identifier. Run the history scan again; decide whether the history needs rewriting (it has only the maintainer's noreply address) | S | `scripts/secret-scan.mjs --history` |
| R5 | Release pipeline: Changesets version PR, a `release` workflow with npm provenance and trusted publishing (no long-lived npm token), SHA-pinned actions, a protected environment with a required reviewer. Dry run with `npm publish --dry-run` | M | a pre-release published to the `next` tag under the final name |
| R6 | Install test of the packed tarball: `npm pack`, install into a clean temporary project (Node 22 and 24, Linux and macOS runners), run `opennext-azure package` on the example, check the zip | M | new CI job |
| R7 | Lock down GitHub: branch protection on `main` (required checks), required review for workflow changes, Dependabot, secret scanning and push protection | S | settings checklist in the docs |
| R8 | Azure run on the release commit: full E2E on Next.js 15 and 16, `deploy` warm-up output, `--always-ready 1` measurement, one Front Door deployment (`--front-door`), cost recorded | M, Azure cost | [Azure runs](../contribute/azure_runs.md) |
| R9 | Known limitations page generated from the **Unverified** and gap rows; wording reviewed so nothing is claimed that was not run | S | review |
| R10 | `npm`/Yarn layouts of `node_modules` (only pnpm is verified): at least a clean-install test for npm; document Yarn as unverified | M | CI job (part of R6) |

### Stage 2: `0.x` beta (feedback phase)

Aim: fewer surprises for a first real user. Order by risk, not by effort.

| # | Task | Size | Verification |
| --- | --- | --- | --- |
| B1 | Next.js version guard at `package` time (refuse versions outside the OpenNext range, ADR-0011) | S | unit |
| B2 | Server Actions: the encryption key guidance and a `package` warning (B12) | S | unit, docs |
| B3 | Observability: Application Insights queries (invocations, failures, instances, ISR consumer), a documented structured log format, `--full-telemetry` guidance | M | queries run on a real deployment |
| B4 | Rollback and redeploy behavior documented and tested (Flex has no slots; site update strategy) | M, Azure | Azure run |
| B5 | Error after the first byte: decide and test what the client sees | S | unit, E2E |
| B6 | Tag cache: one read per tag becomes a batched read | M | unit, integration, E2E |
| B7 | CLI: local `preview`, `populate-cache` as a step, upload without serving | L | local E2E |
| B8 | Remaining Next.js coverage: `app-pages-router`, `fallback: true`, `proxy` (Next.js 16), PPR, Turbopack, `cacheComponents` | M each | local E2E, then Azure |
| B9 | HTTP per-instance concurrency and instance memory size: measure and set a documented default; a cost guide with real numbers | M, Azure | load test |
| B10 | Cold start work: module load time of the server bundle, lighter storage clients if it pays | M | measurement first |
| B11 | Image function: time and memory of `sharp` on Azure, then decide whether a cache is needed (ADR-0014) | S, Azure | measurement |
| B12 | The three-app layout against the single app (closes ADR-0009) or a decision not to measure | M, Azure | Azure run |
| B13 | Docs site generated from `docs/`, migration guide, troubleshooting built from real reports | L | review |
| B14 | Windows: either CI on Windows or a clear "not supported" statement | S or M | CI |

### Stage 3: `1.0`

Gate: the promises below are stated and tested.

- A semantic-versioning policy for the CLI flags, the override module paths and the generated Bicep parameters.
- A support policy for Next.js (follows `@opennextjs/aws`, ADR-0011), for Node.js and for the two Azure regions measured.
- A soak or load test on Azure with recorded results, a cost guide, and an upgrade guide between minor versions.
- A response time for security reports and the first advisory process rehearsed.
- No open item rated "wrong result for the user" in the limitations page.

## 4. Fixed dates

- **2027-01-31**: end of Next.js 15 support (as told by the maintainer; official source not checked). The review in ADR-0012 happens then: remove 15 from the range and the CI matrix if OpenNext has done so. Stage 1 should be done well before, so that the first release states the range clearly.

## 5. Order and parallel work

1. P1 to P5 first; R1 cannot start before P2.
2. R3, R4, R7 can run while R1 and R2 are written. R5 and R6 depend on R1.
3. R8 is the last step before tagging (it needs the final name and the release commit).
4. Stage 2 items are independent of each other; B1, B2, B5 and B6 are local only and can start right after Stage 0. Items marked Azure share runs: plan them in one session to save time and cost.

## 6. Azure budget and limits

- The test subscription is Azure for Students: 15 cores regional quota for Flex Consumption (always-ready instances count), no confirmed price for a CI run yet (the first two runs were not yet in the cost view; look again one to two days later).
- Group the Azure items (R8, B3, B4, B9, B11, B12) into at most three sessions, each with a stated cost ceiling and a delete step, as in the Azure runs guide.

## 7. Risks and unknowns

- **Overlap with the existing package.** Users may not distinguish the two. Mitigation: P1 and P5, an honest comparison page.
- **Maintainer capacity.** One maintainer; the release process should be as automatic as possible (R5, R6, R7) and the issue templates should ask for the information needed to reproduce.
- **Upstream changes.** `@opennextjs/aws` and Next.js release often; Dependabot PRs and the CI matrix (15 and 16) are the early warning. The Next.js Adapter API may replace the approach later (ADR-0012).
- **Unverified Azure behavior** listed in [Compatibility](../compatibility.md): the release notes must repeat it.
- **Cost surprises for users** (always-ready instances, Front Door, storage transactions): the cost guide (B9) before `1.0`, a short warning in the README at `0.1.0`.
- **Claims about the other package** are based on its npm metadata and README only.

## 8. What only the maintainer can do

npm account and two-factor authentication, creating the package or scope, configuring trusted publishing for the repository, making the repository public and enabling protections, choosing the security contact address, the decisions P2 to P5, running or approving any Azure deployment and its cost.
