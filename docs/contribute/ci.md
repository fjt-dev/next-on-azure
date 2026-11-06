# Continuous integration

> **Status: ran on GitHub Actions on 2026-11-06 and succeeded.** The maintainer reported that every job of the first run passed (`check` on Node 22 and 24, and `e2e`) after the repository (private, `fjt-dev/opennextjs-azure-fjtd`) received its first push of 9 commits. The author of this page could not read the run (no access to a private repository's Actions from the development environment), so the details of the logs were not seen: durations, whether `func` came from the postinstall or from the fallback, and any warnings.

## Workflow `check`

Triggers: every pull request and every push to `main`. Cancels superseded runs of the same ref.

| Job | Runs on | What it does |
| --- | --- | --- |
| `check` (Node 22 and 24) | `ubuntu-latest` | `pnpm install --frozen-lockfile`, lint, build, type check, unit tests, Azurite integration tests, `az bicep build` |
| `e2e` (Node 22) | `ubuntu-latest` | `pnpm e2e:test`: builds and packages the example, then runs both E2E projects (the Functions host with Azurite over HTTPS, and the same stack with `FRONT_DOOR_ID`). On failure it uploads the host logs (`LOCAL_STACK_LOG_DIR`) as an artifact for 7 days |

## Security rules for workflows

- `permissions: contents: read` for the whole workflow. No job needs more. Do not add `id-token` or any write permission to this workflow; the Azure E2E workflow will be separate (see below).
- Never use `pull_request_target` or `workflow_run` here: they run with a privileged token against code from forks.
- `actions/checkout` runs with `persist-credentials: false`.
- **Every action is pinned to a full commit SHA**, with the release tag in a trailing comment. Currently: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2.
- Only first-party `actions/*` actions are used. pnpm is installed from npm at the version in `package.json` (`packageManager`), not through a third-party action.
- `.github/dependabot.yml` opens weekly update PRs for the actions and for npm dependencies.

### Updating a pinned action

1. Resolve the tag to its commit: `git ls-remote --tags --refs https://github.com/actions/<name> | grep <tag>`.
2. Check that the commit is not brand new (prefer a release that has been out for a few weeks) and that the inputs you use still exist in its `action.yml`.
3. Replace the SHA and the version comment together. Review Dependabot PRs the same way: the SHA must belong to the tag named in the comment.

## What was verified, and what was not

Verified locally (2026-11-06):

- Both YAML files parse; every `run:` block passes `bash -n`.
- Every `uses:` is a 40 hex character SHA; no `pull_request_target`, no write permissions.
- The SHAs are the commits of the named tags (`git ls-remote`), dated 2026-07-17 (checkout), 2026-10-07 (setup-node, upload-artifact); the inputs used exist in those versions' `action.yml`.
- The same commands, run in a clean copy of the repository (no `node_modules`, no build output) on Node 26: `pnpm install --frozen-lockfile` and the whole `check` job pass, and `pnpm e2e:test` passes (27 + 10 tests), including with the Core Tools binary deleted beforehand (the stack script restores it) and with `LOCAL_STACK_LOG_DIR` producing the saved logs.
- The stack script leaves nothing behind when it crashes (tested by making `func` unexecutable).

Verified on GitHub (reported by the maintainer, 2026-11-06): the whole workflow, which includes `ubuntu-latest` providing `az`, `zip`, `unzip` and `openssl`, the Node 22 and Node 24 jobs, `npm install --global pnpm@<packageManager version>`, `pnpm install --frozen-lockfile`, and the end-to-end job with the Functions host.

Not verified:

- The contents of that first run: nothing was read from its logs.
- `actionlint`: not run, because downloading and executing its binary was not allowed in the development session. Run it yourself before the first push if you want a stricter check.
- Whether the artifact upload of failed runs works (it only runs on failure and has never run).
- Pull requests from forks, and the first Dependabot pull requests.

## Not in CI yet

- Azure E2E against a real deployment. It must be a separate workflow: GitHub OIDC federation to a dedicated test subscription, a new resource group per run, deletion of the resources afterwards, a cost ceiling ([Real Azure runs](./azure_runs.md)). Triggered manually and nightly, never on pull requests from forks.
- Dependency audit, secret scan, license allow-list and third-party notices, `npm pack` contents check, clean-install tests on macOS and Windows ([roadmap](../plan/roadmap.md) Phases 2 to 3).
- Release automation (Changesets, npm provenance), Phase 4.

## Reproducing CI locally

Run the same commands in a clean copy so that nothing depends on local build output:

```bash
rsync -a --exclude node_modules --exclude dist --exclude .next --exclude .open-next \
  --exclude .open-next-azure --exclude .turbo --exclude .git ./ /tmp/clean-copy/
cd /tmp/clean-copy
pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm typecheck \
  && pnpm test && pnpm test:integration && pnpm e2e:test
```
