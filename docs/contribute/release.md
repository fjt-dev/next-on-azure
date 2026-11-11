# Release

A release is a tag. The `release` workflow (`.github/workflows/release.yml`) runs for a tag `v<version>`, checks that the tag is the version of `packages/next-on-azure/package.json`, runs lint, type check, build and the tests, packs the package, and then waits for an approval before it publishes that same tarball with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and a provenance statement. No npm token is stored anywhere. See [ADR-0023](../plan/decisions.md#adr-0023-releases-are-tags-published-with-trusted-publishing-without-changesets).

## Once, before the first release

These steps are the maintainer's: they need the npm and GitHub accounts.

1. **GitHub environment.** Settings, Environments, new environment `npm-publish`; add the maintainer as required reviewer; restrict deployment to tags `v*.*.*`.
2. **npm trusted publisher.** On npmjs.com, in the settings of the package, "Trusted publishing", choose GitHub Actions: organization or user `fjt-dev`, repository `next-on-azure`, workflow filename `release.yml`, environment `npm-publish`; allow `npm publish` among the allowed actions. The package must be configured before it can publish this way: whether npm lets you do that **before the first publish of a new name** is **not verified** (the npm documentation says that a new configuration must complete its first publish within two days, and describes the settings page of a package). If it does not, the first `0.1.0` needs another route: a one-time token with a short life, removed at once.
3. **Two-factor authentication** on the npm account (done, stated by the maintainer).

## Each release

1. Update `CHANGELOG.md`. In `packages/next-on-azure/package.json` set the version; for the first release also remove `"private": true`. Commit.
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
