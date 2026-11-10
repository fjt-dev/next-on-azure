# Security policy

`next-on-azure` is experimental and has not been published to npm. There are no supported releases yet: the supported version is the latest commit on `main`.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Or send an e-mail to security@fjtd.dev. Include what you found, how to reproduce it, and the version or commit.

This is a project with one maintainer. Reports are answered on a best-effort basis; there is no guaranteed response time and no bug bounty.

## What is in scope

- The package (`packages/next-on-azure`): the CLI, the Functions entry, the cache handlers.
- The Bicep template (`packages/next-on-azure/infra/main.bicep`) and what `deploy` creates.
- The workflows in `.github/workflows` and the scripts in `scripts/`.

Problems in Next.js, Azure Functions or other Azure services belong to their owners: report them there.

## Credentials

The repository holds no credentials and the workflows use OIDC, not stored secrets. If you find a credential in the repository or its history, report it the same way.
