# Contributing

Pull requests are welcome once the repository is public. Until then the maintainer works from the [roadmap](../plan/roadmap.md).

- [Run locally](./local_run.md): build the packages and start the local stack (Azurite and the Azure Functions host)
- [Testing](./testing.md): unit, integration and E2E tests and the required behavioral cases
- [CI](./ci.md): what the GitHub Actions workflows run
- [Azure E2E](./azure_e2e.md) and [real Azure runs](./azure_runs.md): the opt-in run against real resources, with its cost rules
- [Supply chain](./supply_chain.md): audit, license check and secret scan

## Ground rules

- A behavior change needs a test in `packages/tests-unit`, and an E2E case if it is visible over HTTP.
- Do not create Azure resources without agreeing on a resource group, a time window and a cost ceiling ([real Azure runs](./azure_runs.md)).
- Override modules must not import `@azure/*` statically ([ADR-0007](../plan/decisions.md#adr-0007-azure-sdks-are-imported-at-runtime-only)).
- Never run `npm install` inside an OpenNext bundle ([ADR-0008](../plan/decisions.md#adr-0008-packaging-never-runs-npm-install-inside-an-opennext-bundle)).
- Documentation is English.
