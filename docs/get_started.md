# Get started

> **Experimental, pre-release.** The package is not published to npm yet, so the install step works from a checkout of this repository only (`examples/standalone` is a working app). What is verified is in [Compatibility](./compatibility.md).

## Prerequisites

- Node.js 22 or later
- A Next.js app on 15.5.29 or later, or 16.4.5 or later, using the App Router or the Pages Router
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), signed in (`az login`), with the right to create resources in a resource group
- `zip` on the PATH (used by `package`)

## 1. Configure Next.js

```js
// next.config.mjs
import { withAzure } from "next-on-azure/config";

export default withAzure({
  // your Next.js configuration
});
```

`withAzure()` sets `output: "standalone"`, the cache handlers and the settings Azure needs; see [Configuration](./configuration.md).

## 2. Build and package

```bash
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(openssl rand -base64 32)"   # keep it in your secret store
next build
next-on-azure package
```

This writes `.next-azure/app.zip`: the standalone build with its `node_modules` turned into a plain tree (Azure drops symbolic links), the Linux x64 `sharp` binaries, and the Functions entry. Use the same Server Actions key for every build, otherwise pages that were open before a deployment fail when they call an action ([Troubleshooting](./troubleshooting.md#a-server-action-fails-after-a-deployment-failed-to-find-server-action)). `package --target local` keeps the binaries of your machine, for running locally.

## 3. Deploy

```bash
next-on-azure deploy --resource-group <rg> --name <short-name> --location <region>
```

`--name` is 3 to 12 lowercase letters or digits; it is combined with a hash into globally unique resource names. `deploy`:

1. creates the resource group if `--location` is given;
2. deploys `infra/main.bicep` (storage account with the `cache` container and the `tagcache` table, one Function app, Application Insights, and Front Door only with `--front-door`);
3. deploys `.next-azure/app.zip`;
4. requests `/` until the app answers (up to 5 minutes) and prints how long it took;
5. requests every prerendered route once (`prime`), so that the pages are in the cache before visitors arrive.

| Flag | Default | Effect |
| --- | --- | --- |
| `--front-door` | off | Puts Azure Front Door in front (recurring base fee). The app then refuses requests that did not pass through it (`X-Azure-FDID`). **Never deployed so far.** |
| `--wait-until hold\|detach` | `hold` | What happens to deferred work such as `after()` when the response is complete. `hold` keeps the response open until the work is done; `detach` answers at once, which is safe for short work only (an idle instance is removed after about 1.5 to 3.5 minutes). |
| `--always-ready <n>` | `0` | Keeps `n` instances of the HTTP function running, so that a request does not wait for a cold start. Billed continuously. Measured once: the first request after about 17 idle minutes took 0.15 s instead of 2.4 s. |
| `--memory <512\|2048\|4096>` | `2048` | Memory of each instance (MB). Flex Consumption bills memory times execution time. Measured on Azure (documentation site, 2026-11-10): at 512 MB a request took about four times as long as at 2048 MB, so the GB-seconds per request were the same and the instance count went up: **a smaller size did not save money for this CPU-bound workload.** The site ran correctly at 512 MB; images with `sharp` were not tried. |
| `--max-instances <n>` | `20` | Upper bound on instances: a burst or abuse cannot scale (and bill) without limit. |
| `--cache-retention-days <n>` | `30` | A lifecycle rule deletes cache entries not written for `n` days, and with them the entries of old builds, which are never read again. `0` keeps everything. A deleted entry is a cache miss: the page is rendered and written again. **Unverified on Azure** (the template compiles; the rule was never deployed). |
| `--request-telemetry all\|errors` | `all` | `errors` sends only failures to Application Insights: `Host.Results` is set to `Error` and `Function.server` to `Warning`. Measured on Azure (2026-11-10, the documentation site): about 4.1 KB of telemetry per request with `all`, about 0.6 KB with `errors`. Application Insights bills by ingestion, and every request counts, static files included. Successful requests then do not appear in Application Insights. |
| `--full-telemetry` | off | Turns Application Insights sampling off. Costs more with traffic. |
| `--no-warm-up`, `--no-prime` | off | Skip the wait for the first answer, or the priming. |
| `--output-file <path>` | none | Writes the URL and the resource names as JSON. |

Every setting lives in the Bicep template, because a redeployment replaces the app settings: a setting added later with `az functionapp config appsettings set` is gone after the next `deploy`.

## What gets created

| Resource | Purpose |
| --- | --- |
| Storage account | `cache` container (pages, `fetch` results, `'use cache'` entries), `tagcache` table (tag revalidation state), `deploy-app` container (the platform fills it) |
| 1 Function app (Flex Consumption) | one function `server` on `{*path}`: every request, static files included |
| Application Insights + Log Analytics | logs and metrics |
| Front Door Standard (only with `--front-door`) | edge caching of `/_next/static/*` |

All data access uses the Function app's managed identity; shared-key access is disabled on the storage account and no container is public.

## Run it locally

```bash
pnpm install && pnpm build
pnpm --filter example-standalone run standalone    # next build + package --target local
node scripts/standalone-local.mjs                  # Azurite + the Functions host on http://localhost:7071
```

More in [Local development](./contribute/local_run.md).
