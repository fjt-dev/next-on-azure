# Azure E2E in CI

> **Status: written and checked locally, never run.** The workflow `azure-e2e` has not been executed on GitHub and nothing has been created in Azure for it. Treat every statement about its behaviour as **Unverified** until the first run is recorded in the [work log](../plan/worklog.md).

The workflow `.github/workflows/azure-e2e.yml` deploys `examples/app-router` to a real subscription, runs the end-to-end tests against the deployed URL and deletes everything. It follows the rules in [Real Azure runs](./azure_runs.md).

## How it works

1. Triggers: manual (`workflow_dispatch`, input `location`) and, only when the repository variable `AZURE_E2E_SCHEDULED` is `true`, weekly. Never for pull requests or pushes, so code from forks cannot reach the Azure identity.
2. No GitHub environment is used (required reviewers are not available for private repositories on the free plan). Instead the Azure credential only accepts tokens from `refs/heads/main` of this repository, and the job also refuses other refs. Only people with write access can start the workflow. If you later move to a plan with environments, switch the credential subject to `environment:<name>` and add a reviewer.
3. Sign-in is OIDC federation (`scripts/ci/azure-login.sh`): GitHub issues a short-lived token, Azure exchanges it. No secret is stored; only `curl`, `jq` and `az` are used, no third-party action. `id-token: write` exists only in this workflow (pinned by a unit test).
4. A new resource group `rg-oe2e-<run id>-<attempt>` is created with the tags `purpose=opennextjs-azure-e2e` and `createdAt`.
5. `opennext-azure deploy` provisions the app (Flex Consumption, no Front Door, queue polling 5 s) and uploads assets and cache. The identity is passed with `--deployer-principal-id` and `--deployer-principal-type ServicePrincipal` (the role assignment fails with `UnmatchedPrincipalType` otherwise); the upload retries while the new role assignment propagates (up to 5 minutes).
6. The app is polled until it answers, then `pnpm --filter tests-e2e run e2e:remote` runs the same tests as locally, except the ones that read the local host log (they are skipped; see below).
7. The group is deleted at the end of the job (`if: always()`). A second job, `cleanup`, runs even if the first timed out or was cancelled, deletes this run's group and any group with the tag that is older than three hours, and lists what remains.

Hard limits: job timeout 60 minutes, cleanup 15 minutes, one run at a time (`concurrency`). Expected cost is small (Flex Consumption bills per use, plus storage and Application Insights); the previous manual runs have no cost figure yet, so there is **no measured number** to quote. Check the subscription's cost analysis after the first runs and put the figure here.

## What the remote tests do not check

Tests that read the Function host log of the local stack are skipped when `E2E_BASE_URL` is set: the queue consumer ran and succeeded, no failed revalidation, the stampede count (one regeneration for 30 requests) and the `AFTER_DONE` marker. The ISR test still checks over HTTP that a stale page is served and later replaced. Reading these from Application Insights (which lags one to three minutes) is a follow-up.

## One-time setup (you do this; nothing here is done yet)

The workflow needs an identity in a **dedicated test subscription** (or at least a subscription where a mistake is cheap). Commands, run once by a person with rights in the tenant and the subscription:

```bash
az ad app create --display-name opennextjs-azure-e2e --query appId -o tsv
```

```bash
az ad sp create --id <appId> --query id -o tsv
```

```bash
az ad app federated-credential create --id <appId> --parameters '{
  "name": "github-main-branch",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:fjt-dev@157100279/opennextjs-azure-fjtd@1448297244:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

The `subject` must equal the token's `sub` claim exactly. This repository sends its immutable form with numeric ids (`repo:<owner>@<owner id>/<repo>@<repo id>:ref:...`), not the plain `repo:<owner>/<repo>:...`; the first run failed with `AADSTS700213` until the credential used the form shown in the error message. For another repository, copy the subject from that error or from the repository's OIDC settings.

Grant the service principal (use the object id printed by `az ad sp create`, not the app id):

```bash
az role assignment create --assignee-object-id <spObjectId> --assignee-principal-type ServicePrincipal --role Contributor --scope /subscriptions/<subscriptionId>
```

```bash
az role assignment create --assignee-object-id <spObjectId> --assignee-principal-type ServicePrincipal --role "Role Based Access Control Administrator" --scope /subscriptions/<subscriptionId>
```

Why both: the template creates the resource group's resources (Contributor) and assigns data roles to the app's managed identity and to the deployer (role assignments need RBAC Administrator or User Access Administrator). Both are subscription-wide, so use a subscription that holds nothing else you care about.

In GitHub (Settings, Secrets and variables, Actions, Variables) add these **repository variables** (not secrets): `AZURE_CLIENT_ID` (app id), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_PRINCIPAL_ID` (the service principal's object id). Optionally `AZURE_E2E_SCHEDULED=true` for the weekly run.

The first run should be manual, watched, followed by a read-only inventory of the subscription that day and the next ([Real Azure runs](./azure_runs.md)).

## Locally against any deployment

```bash
E2E_BASE_URL=https://<app>.azurewebsites.net pnpm --filter tests-e2e run e2e:remote
```
