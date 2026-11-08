# Troubleshooting

Issues observed during development, with causes and fixes. Add new ones here as they are found.

## `Cannot find module` / types resolve to `any` when importing `@opennextjs/aws/types/*`

`@opennextjs/aws` maps `./*` to `./dist/*` with a `.d.ts` suffix, so type imports must **not** have an extension:

```ts
import type { Converter } from "@opennextjs/aws/types/overrides";   // correct
import type { Converter } from "@opennextjs/aws/types/overrides.js"; // resolves to any
```

## `open-next build` fails with `Identifier '__dirname' has already been declared`

`open-next.config.ts` is bundled by esbuild and evaluated at build time. If a module in the config's import graph statically imports `@azure/identity`, its dependencies get bundled and clash with OpenNext's banner. Overrides in this package avoid it by importing the Azure SDKs dynamically at runtime ([ADR-0007](../plan/decisions.md#adr-0007-azure-sdks-are-imported-at-runtime-only)). If you write your own override, do the same, or pass the packages to `open-next build --node-externals`.

## `sharp` is missing from the image Function app

Running `npm install` inside an OpenNext bundle prunes packages that are not in its `package.json`. Use `opennext-azure package`, which merges dependencies without pruning ([ADR-0008](../plan/decisions.md#adr-0008-packaging-never-runs-npm-install-inside-an-opennext-bundle)).

## `opennext-azure: command not found` in a pnpm workspace

pnpm creates `node_modules/.bin` links when it installs a workspace package. If `dist/` did not exist yet (first install, which is every fresh checkout and every CI run), the link is skipped. The example app therefore calls the CLI by path (`node ./node_modules/opennext-adapter-azure/dist/cli/index.js package`), which does not depend on the link. For your own workspace app, either do the same or build the package and reinstall the consumer:

```bash
pnpm --filter <package> build
rm -rf examples/app-router/node_modules && pnpm install
```

Applications that install the package from the npm registry are not affected.

## `@opennextjs/aws` peer dependency conflict with Next.js

`@opennextjs/aws` 4.1.15 requires `next >=15.5.29 <16 || >=16.4.5`. Older Next.js versions fail with `ERESOLVE`.

## `Set AZURE_STORAGE_ACCOUNT_NAME (or AZURE_STORAGE_CONNECTION_STRING)` in logs

The server could not find a storage account. For ISR pages this surfaces as `Failed to set cache`. In Azure the Bicep template sets the variable; locally, set `AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true;` and start Azurite.

## Queue messages are not processed

The revalidation app expects plain JSON. Check that `host.json` contains `"queues": { "messageEncoding": "none" }`. Messages that fail three times are in `revalidation-poison`.

## `azure-functions-core-tools` installs but `func` is not found (Node 26)

The package downloads `Azure.Functions.Cli.<os>-<arch>.<version>.zip` in its postinstall step and unpacks it with `extract-zip`. On Node 26 that stopped after a couple of files and reported no error, leaving `bin/` without `func`. `pnpm local:stack` (and therefore `pnpm e2e:test`) now notices the missing binary and unpacks the downloaded zip with the system `unzip`; nothing to do by hand. The build script must still be allowed (`allowBuilds: azure-functions-core-tools: true` in `pnpm-workspace.yaml`) so the zip is downloaded. Reproduced on a clean install on Node 26; not seen on the Node 22 and 24 that CI uses (unverified until CI has run).

## `The binding type(s) 'queueTrigger' are not registered`

Node apps get trigger extensions from the extension bundle. `host.json` must contain `extensionBundle` (`Microsoft.Azure.Functions.ExtensionBundle`, `[4.*, 5.0.0)`). `opennext-azure package` writes it. The first local run downloads the bundle.

## Images are served unresized, no error

sharp could not load its native binary and the image optimizer falls back to the original image silently. On a macOS or Windows build host, OpenNext's `npm install --os=linux --cpu=x64` skips sharp's `glibc`-only binaries unless `libc` is given:

```ts
install: { packages: ["sharp@0.33.5"], os: "linux", arch: "x64", libc: "glibc" }
```

`opennext-azure package` now fails with this hint when `@img/sharp-linux-x64` or `@img/sharp-libvips-linux-x64` is missing. `install.nodeVersion` is ignored by OpenNext and should be removed.

## ISR never regenerates locally

The revalidation app fetches `https://<host><path>`. Plain HTTP local hosts cannot work. Use `pnpm local:stack`, which runs everything over HTTPS with a certificate created for the run.

## `pnpm local:stack` left files behind

The stack deletes its temp directory (certificate and key) on exit. If the process is killed with `SIGKILL`, remove `opennext-azure-local-*` from the OS temp directory by hand.

## Static files return 404 although they are in Blob

The asset resolver serves only paths listed in `assets-manifest.json` and finds it through `ASSETS_MANIFEST_PATH`. If it logs `Static assets will not be served: cannot read ...`, the manifest is missing or the variable points elsewhere. Do not rely on the working directory: in a monorepo OpenNext nests the app inside the server bundle (`server/<path to app>/`). Re-run `opennext-azure package`, which writes the manifest and the generated `main.mjs` sets the variable.

## `kill` of the local stack did not stop it

Send `SIGINT` to the `node scripts/local-stack.mjs` process itself (for example `pkill -INT -f "^node scripts/local-stack.mjs"`), not to a wrapping shell. It then stops Azurite and the Function app and deletes the certificate. Started from a tool that captures output, run it in the background.

## The Function app shows Azure's "Your Azure Function App is up and running" page

The host started but registered no function, so your routes answer 404 and `/` shows the default page. The reason is in Application Insights, not in the HTTP response:

```bash
az monitor app-insights query --app <appi-name> -g <rg> \
  --analytics-query "traces | where timestamp > ago(30m) | order by timestamp desc | project timestamp, message | take 30"
```

Look for `Worker was unable to load entry point "main.mjs"`. Seen causes: `Cannot find module 'styled-jsx/package.json'` and `Cannot find package 'next'`, both because the pnpm `node_modules` was packaged with symbolic links or with the link targets copied; Azure keeps no symbolic links. `opennext-azure package` flattens the pnpm layout and refuses to produce a package with links; use a version that has it.

## `deploy` fails with `RoleDefinitionDoesNotExist`

A built-in role definition id in `main.bicep` is wrong. `az bicep build`, `validate` and `what-if` do not catch it. Look the id up with `az role definition list --name "<role name>" --query "[0].name" -o tsv` and compare with the ids pinned in `packages/tests-unit/src/unit/bicep.test.ts`.

## `deploy` fails while uploading static files (AuthorizationPermissionMismatch)

Owner on the subscription is not a Blob data role and shared keys are off. The template assigns *Storage Blob Data Contributor* to the signed-in user (`deployerPrincipalId`, filled in by `deploy`). If the user object id could not be read, `deploy` warns and skips the assignment; assign the role yourself.

## A setting I added with `az functionapp config appsettings set` disappeared

The next `deploy` replaces all app settings with the ones in the template. Add the setting to `main.bicep` (as `WAIT_UNTIL_MODE` and the always-ready count already are).

## Stale pages are not regenerated for minutes

The revalidation message sits in the `revalidation` queue until the queue-triggered function runs. Observed: 1 to 5 s normally, one stall of 2 min 21 s, and 37 s with an idle always-ready instance. See [ADR-0010](../plan/decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group). Meanwhile every stale request adds another message (no deduplication).

## `deploy` fails with "Evaluation window size must be one of [PT1H, PT6H, PT12H, P1D]"

The queue backlog alert uses the `QueueMessageCount` metric, which Azure Monitor evaluates over windows of at least one hour. The template uses PT1H; a shorter window passes `validate` and `what-if` and fails the deployment. Do not shorten it.

## A Server Action fails after a deployment ("Failed to find Server Action")

Server Actions encrypt the variables a closure captures. By default Next.js makes a new key for every build, so an action can only be invoked against the build that produced it: a page that was open before a deployment fails when it calls an action, and instances built apart do not agree. This is documented for self-hosting by the Next.js team; the behavior on Azure was not reproduced.

Set the same key for every build, at build time (it is embedded in the build output):

```bash
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(openssl rand -base64 32)"   # keep it in your secret store, not in the repository
npx open-next build
npx opennext-azure package
```

The key is base64 of 16, 24 or 32 bytes. `package` warns when the app has Server Actions and the variable is not set in its environment, and when the value differs from the key embedded in the build. The warning is a hint: if the key was set only for `open-next build`, set it for `package` too to silence it.
