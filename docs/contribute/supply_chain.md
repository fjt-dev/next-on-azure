# Supply chain checks

What runs on every push and pull request (job `supply-chain` in the `check` workflow) and what does not.

## Dependency audit

- `pnpm audit --prod --audit-level high` fails the build when a production dependency has a known high or critical advisory. A new advisory can turn the build red without a change in this repository; the fix is an update or an override, not a skipped step.
- `pnpm audit` over all dependencies runs as a report only. On 2026-11-07 it listed development tools only (the test runner, `azure-functions-core-tools`, a build helper of OpenNext). They do not ship in the package and do not run on user machines, so they do not block. Look at the report from time to time.
- Next.js pins `postcss` 8.4.31 exactly, which has known advisories. `overrides` in `pnpm-workspace.yaml` raises it to a fixed version for the example app; local E2E passes with it. Remove the override when the Next.js version in the catalog ships a fixed one. After changing overrides, regenerate the lockfile with `pnpm install --lockfile-only` (a plain `pnpm install` said "Already up to date" and ignored the change).

## Secret scan

`node scripts/secret-scan.mjs` checks the tracked files; `--history` checks every line ever added on any branch (needs a full clone). It is a small scanner with its own rules (`scripts/secret-rules.mjs`: private keys, storage account keys, SAS signatures, Azure AD client secrets, GitHub and npm tokens, AWS key ids, JWTs, password assignments), because the CI should not download a third-party binary. It prints file and rule, never the value. The only allowed value is the documented, public development key of Azurite. A unit test covers the rules and the tracked files.

Run with `--history` on 2026-11-07: nothing found. Limits: pattern based, so it does not find a secret in an unusual shape. Azure resource, tenant and subscription ids are not secrets for this purpose but should not be copied around.

## Licenses

`node scripts/license-check.mjs` fails when a production dependency of the published package, or of the workspace, uses a license other than MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause or 0BSD. Two known exceptions are accepted by package name:

- `@img/sharp-libvips-*` (`LGPL-3.0-or-later`): the prebuilt `libvips` binaries that `sharp` ships.
- `caniuse-lite` (`CC-BY-4.0`): browser data used by Next.js.

Both come from the peer dependency `next`, which the user installs (since the `next` peer range was added in ADR-0011, `pnpm` lists them for the package as well). They end up in the app zip of a user, not in this package. A new package with a non-allowed license fails the check.

Because the package contains only its own code (`dist`, `infra`), it needs no third-party notices file; what the user's app zip contains is the user's responsibility, and this note lists what the example brings.

## Not covered yet

Software bill of materials, npm provenance on release (Phase 4), and pinning of the Azure Functions Core Tools download in CI.
