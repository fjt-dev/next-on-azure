# Real Azure runs

Rules for any work that creates resources in an Azure subscription. They exist to prevent cost and cleanup surprises. They apply to humans and to coding agents.

## Before the run

1. Confirm the subscription, region and resource group name with the maintainer. Do not assume.
2. Use a **new, dedicated resource group** per run. Do not reuse a group that existed before.
3. Set a **time window** with hard deadlines per stage (provision, deploy, verify, delete) and a **cost ceiling**. Write both in the work log before starting.
4. Check current prices of anything with a recurring fee (for example Front Door Standard) on the Azure pricing page first.
5. Run local checks first (Functions Core Tools + Azurite). Real Azure should only be used for what the local stack cannot show.

## During the run

- Give every long command an explicit time limit.
- Record the name of every resource you create as you create it.
- Do not write to a Flex Consumption deployment container; the platform fills it.

## After the run

1. Delete the created resources **one by one by name**, from your own record. Delete the resource group itself only if this run created it.
2. Verify deletion with a read-only inventory of the group, and repeat the inventory **the next day** (soft-deleted or delayed resources, such as Front Door profiles and storage accounts, can linger).
3. Record in the [work log](../plan/worklog.md): what was created, what was measured, what it cost, and what was deleted.

## Credentials

- No secrets in the repository or in CI variables. CI uses GitHub OIDC federation.
- Prefer managed identity and role assignments over keys. The storage account has shared-key access disabled.

## Lessons from the first run (2026-11-06)

- **`az bicep build`, `az deployment group validate` and `what-if` pass templates that fail when deployed.** A wrong built-in role definition id (`RoleDefinitionDoesNotExist`) was only found by the real deployment. Pin such ids in a test against `az role definition list` output, and expect the first real deployment to fail once or twice.
- **Run the artifact you deploy.** The local stack ran the directory the zip was made from, so a package that lost its symbolic links (Azure drops them) passed every local test. The stack now runs the unpacked zip.
- **Read the host's own log first.** `az monitor app-insights query --app <name> -g <rg> --analytics-query "traces | order by timestamp desc"` showed `Worker was unable to load entry point` with the missing module within a minute; the HTTP response (Azure's default "up and running" page) said nothing. Application Insights lags by one to three minutes.
- **Do not set app settings with `az functionapp config appsettings set` for anything you want to keep:** the next template deployment replaces them all. Put them in the Bicep template.
- **Idle instances disappear after minutes**, so a measurement that needs a fresh instance needs minutes without traffic, and deferred work that outlives the instance is lost.
- Keep a timestamped record while you go (start time, hard stop, resource names): the cleanup is mechanical when the list exists.
- **A second class of errors that `validate` and `what-if` let through: values Azure Monitor and ARM check only at deployment** (the `QueueMessageCount` alert window, built-in role ids). Pin every such constraint in a test the first time you hit it (`packages/tests-unit/src/unit/bicep.test.ts`), and budget a failed first deployment for any new resource type.
