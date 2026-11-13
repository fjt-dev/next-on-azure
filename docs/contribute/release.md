# Release

A release is a tag. The `release` workflow (`.github/workflows/release.yml`) runs for a tag `v<version>`, checks that the tag is the version of `packages/next-on-azure/package.json`, runs lint, type check, build and the tests, packs the package, and then waits for an approval before it publishes that same tarball with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and a provenance statement. No npm token is stored anywhere. See [ADR-0023](../plan/decisions.md#adr-0023-releases-are-tags-published-with-trusted-publishing-without-changesets).

## Once, before the first release

These steps are the maintainer's: they need the npm and GitHub accounts.

1. **GitHub environment.** Settings, Environments, `npm-publish` (it exists; a workflow run also creates it without rules). Select "Required reviewers" and add the maintainer; **leave "Prevent self-review" off**, or the only maintainer cannot approve their own release; under "Deployment branches and tags" choose "Selected branches and tags" and add the tag rule `v*.*.*`. **Required reviewers exist only for a public repository** on the GitHub Free, Pro and Team plans (GitHub Docs, "Managing environments for deployment", read 2026-11-11), so this step comes after the repository is made public; the protection rules are ignored again if it goes back to private.
1a. **Repository settings (R5).** `scripts/github-settings.sh check` prints the current state (read-only); `scripts/github-settings.sh apply` turns on Dependabot alerts and security updates, private vulnerability reporting, secret scanning with push protection, branch protection on `main` (the checks must pass; administrators may still push), approval of workflows from first-time contributors, and a tag rule for `v*.*.*`. It refuses to run on a private repository. **Applied on 2026-11-13** after both repositories were made public; `check` afterwards showed every setting on (the required checks are the five jobs of `check`; the documentation site's repository has none of these settings yet).
2. **npm trusted publisher.** It is set in the settings of the package on npmjs.com ("Trusted publishing", GitHub Actions: user `fjt-dev`, repository `next-on-azure`, workflow filename `release.yml`, environment `npm-publish`). **A package that was never published has no settings page: on 2026-11-13 the maintainer found no such option.** So the first release is published by hand (below), the trusted publisher is configured after it, and the workflow publishes from `0.1.1` on.
3. **Two-factor authentication** on the npm account (done, stated by the maintainer).

## The first release, `0.1.0`, by hand

Decided on 2026-11-13: no long-lived token is created; the first version is published from the maintainer's machine, with the one-time code of the two-factor authentication. This version has **no provenance**.

1. On a clean checkout of the release commit: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm test`, and the Azure run of the release plan (R6).
2. `cd packages/next-on-azure && npm pack`, and look at the file list (`npm pack --dry-run` shows it: `dist`, `infra`, `LICENSE`, `README.md`, `package.json`).
3. `npm publish next-on-azure-0.1.0.tgz` and enter the one-time code. Check the package page and `npm install next-on-azure` in an empty directory.
4. On npmjs.com, set the trusted publisher (step 2 above), and in the settings of the package require two-factor authentication or a trusted publisher for publishing, and disallow tokens.
5. Tag the commit (`git tag -s v0.1.0 && git push origin v0.1.0`). The `release` workflow runs its verification; **reject the approval of the `publish to npm` job**, because the version already exists. Create the GitHub release from the tag with the changelog text, and fill in the date in `CHANGELOG.md`.

Not verified: the steps above were not run.

## Each release

1. Update `CHANGELOG.md`. In `packages/next-on-azure/package.json` set the version. Commit. (The release commit of `0.1.0` already did this and removed `"private": true`.)
2. Run the checks of the [release plan](../plan/release_plan.md) for that commit: the HTTP suite on Next.js 15 and 16 against a real deployment ([Real Azure runs](./azure_runs.md)).
3. Tag and push: `git tag -s v0.1.0 && git push origin v0.1.0`.
4. Approve the `publish to npm` job in GitHub when it waits.
5. Check the package page on npmjs.com: the version, the provenance badge, and `npm install next-on-azure` in an empty directory.

## What the workflow refuses

- A tag that is not `v<package version>`; a package that is still `private`.
- A publish without the approval of the `npm-publish` environment.
- Anything but a tag: it does not run for branches or pull requests.

## Not verified

The workflow was never run: there is no tag yet and the npm side is not configured. `npm publish` of a tarball with `--provenance` under trusted publishing, and the minimum npm version (11.5.1) and Node version (22.14), are taken from the npm documentation.
