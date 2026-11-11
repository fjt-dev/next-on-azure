# Continuous integration

Workflow `check`: every pull request and every push to `main`; superseded runs of the same ref are cancelled. All jobs passed on GitHub for commit 04fcd42.

| Job | What it does |
| --- | --- |
| `check` (Node 22 and 24) | `pnpm install --frozen-lockfile`, lint, build, type check, unit tests, Azurite integration tests, `az bicep build` of the template |
| `supply-chain` | production audit, secret scan, license allow-list ([Supply chain](./supply_chain.md)), the links between the Markdown files (`node scripts/check-links.mjs`: the file exists and the `#anchor` is a heading) |
| `e2e` (Next.js 15 and 16.4.5, Node 22) | `pnpm e2e:standalone`; on failure it uploads the host log (`LOCAL_STACK_LOG_DIR`) for 7 days |
| `install` (npm and Yarn 1, Node 22 and 24) | `node scripts/install-test.mjs`: packs the package, installs the tarball into a clean copy of the example, builds, packages and runs the HTTP suite on the Functions host; on failure it uploads the host log. The `pnpm` workspace link hides layout problems, this job does not |

## Security rules for workflows

- `permissions: contents: read` for the whole workflow. No job needs more. Do not add `id-token` or any write permission to this workflow. `id-token: write` exists in two places, both pinned by a unit test: the Azure E2E workflow ([Azure E2E in CI](./azure_e2e.md)) and the publish job of the release workflow ([Release](./release.md)).
- Never use `pull_request_target` or `workflow_run` here: they run with a privileged token against code from forks.
- `actions/checkout` runs with `persist-credentials: false`.
- **Every action is pinned to a full commit SHA**, with the release tag in a trailing comment. Currently: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2.
- Only first-party `actions/*` actions are used. pnpm is installed from npm at the version in `package.json` (`packageManager`), not through a third-party action.
- Every `pnpm install` of a workflow goes through `scripts/ci/pnpm-install.sh`, which tries up to three times: the download of the Functions Core Tools binary in its postinstall failed now and then on GitHub runners (a network error).
- `.github/dependabot.yml` opens weekly update PRs for the actions and for npm dependencies.

### Updating a pinned action

1. Resolve the tag to its commit: `git ls-remote --tags --refs https://github.com/actions/<name> | grep <tag>`.
2. Check that the commit is not brand new (prefer a release that has been out for a few weeks) and that the inputs you use still exist in its `action.yml`.
3. Replace the SHA and the version comment together. Review Dependabot PRs the same way: the SHA must belong to the tag named in the comment.
