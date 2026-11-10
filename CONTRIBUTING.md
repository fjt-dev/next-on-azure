# Contributing

Thank you for looking at `next-on-azure`. It is an experimental project with one maintainer, so please open an issue before you start on a large change. Everyone taking part is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Set up

```bash
pnpm install
pnpm build              # build all packages
pnpm typecheck
pnpm lint
pnpm test               # unit tests
pnpm test:integration   # the Azure SDKs against Azurite
pnpm e2e:standalone     # packages examples/standalone, starts Azurite and the Functions host, runs the HTTP suite
```

More in [Run locally](./docs/contribute/local_run.md), [Testing](./docs/contribute/testing.md) and [CI](./docs/contribute/ci.md).

## Rules

- **A change needs a test.** A behavior change needs a unit test in `packages/tests-unit`, and an E2E case if it is visible over HTTP. A test that documents a known gap uses `it.fails`.
- **Write only what was run.** Mark every statement about behavior as Verified (local), Verified (Azure) or Unverified in [Compatibility](./docs/compatibility.md). Do not describe something as working when it was not run.
- **Documentation is English.**
- **Do not create Azure resources for a pull request.** Deploying costs money and the pull request checks need no Azure account. The rules for a real Azure run are in [Real Azure runs](./docs/contribute/azure_runs.md).
- **New dependencies are reviewed.** See [Supply chain](./docs/contribute/supply_chain.md): the license allow-list, the audit and the secret scan run in CI.
- **Use official sources.** Please do not copy code from other Azure adapters for Next.js or OpenNext; the design rests on the Next.js documentation, Microsoft Learn and this project's own measurements.
- Large decisions are recorded as an ADR in [decisions](./docs/plan/decisions.md); read it before proposing something that changes a recorded decision.

## Pull requests

Keep a pull request to one change. The `check` workflow must pass: lint, build, tests on Node 22 and 24, the HTTP suite on Next.js 15 and 16, the install tests with npm and Yarn, the audit, the secret scan and the license check.
