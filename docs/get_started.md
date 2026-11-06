# Get started

> **Status: experimental.** The package builds and runs locally. Deployment to Azure has not been verified yet; see [Compatibility](./compatibility.md).

This guide deploys a Next.js app to one Azure Functions app (Flex Consumption) with Blob, Table and Queue Storage. Azure Front Door is optional.

## Prerequisites

- Node.js 22 or later
- A Next.js app supported by `@opennextjs/aws` 4.x (Next.js 15.5.29+ or 16.4.5+)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) signed in (`az login`) with permission to create resources and role assignments in a resource group
- `zip` available on the PATH (used by the packaging step)

## 1. Install

```bash
npm install opennextjs-azure @opennextjs/aws
```

`opennextjs-azure` is a placeholder name until the first release (see [ADR-0005](./plan/decisions.md#adr-0005-package-name-is-deferred)).

## 2. Configure OpenNext

Create `open-next.config.ts` in your app root. Start from the example shipped with the package:

```ts
import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

const config = {
  default: {
    override: {
      wrapper: () => import("opennextjs-azure/overrides/wrapper.js").then((m) => m.default),
      converter: () => import("opennextjs-azure/overrides/converter.js").then((m) => m.default),
      incrementalCache: () => import("opennextjs-azure/overrides/incremental-cache.js").then((m) => m.default),
      tagCache: () => import("opennextjs-azure/overrides/tag-cache.js").then((m) => m.default),
      queue: () => import("opennextjs-azure/overrides/queue.js").then((m) => m.default),
    },
  },
  middleware: {
    external: false,
    // Serves /_next/static and public files from Blob Storage (exact paths from assets-manifest.json).
    assetResolver: () =>
      import("opennextjs-azure/overrides/asset-resolver.js").then((m) => m.default),
  },
  imageOptimization: {
    override: {
      wrapper: () => import("opennextjs-azure/overrides/wrapper.js").then((m) => m.default),
      converter: () => import("opennextjs-azure/overrides/converter.js").then((m) => m.default),
    },
    loader: () => import("opennextjs-azure/overrides/image-loader.js").then((m) => m.default),
    install: { packages: ["sharp@0.33.5"], os: "linux", arch: "x64", libc: "glibc" },
  },
  revalidate: {
    override: {
      wrapper: () => import("opennextjs-azure/overrides/revalidate.js").then((m) => m.revalidateWrapper),
      converter: () => import("opennextjs-azure/overrides/revalidate.js").then((m) => m.revalidateConverter),
    },
  },
} satisfies OpenNextConfig;

export default config;
```

See [Overrides](./config/overrides.md) for what each override does.

## 3. Build

```bash
npx open-next build        # produces .open-next/
npx opennext-azure package # produces .open-next-azure/app.zip (one Function app)
```

## 4. Deploy

```bash
npx opennext-azure deploy --resource-group <rg> --name <short-name> --location <region>
# add --front-door to put Azure Front Door in front (adds a recurring fee, see below)
```

Options:

| Flag | Default | Effect |
| --- | --- | --- |
| `--front-door` | off | Creates Azure Front Door in front of the app (recurring fee). The app then rejects requests that did not pass through it |
| `--wait-until hold\|detach` | `hold` | What happens to deferred work such as `after()` when the response is complete. `hold` makes the client wait for it; `detach` answers at once, which is safe for short work only (an idle instance is removed after about 1.5 to 3.5 minutes) |
| `--revalidation-always-ready <n>` | `0` | Keeps `n` instance(s) of the queue-triggered revalidation function running (billed continuously). With `0` a stale page can wait minutes for its regeneration, see [ADR-0010](./plan/decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group) |

| `--revalidation-dedupe-seconds <n>` | `60` | How long one stale request holds the right to enqueue a page's revalidation; the other requests for that page enqueue nothing meanwhile. `0` turns it off |
| `--revalidation-polling-seconds <1-60>` | `60` | Longest wait between polls of an empty revalidation queue (the platform default is 60). Lower = shorter wait for a stale page, a few more storage transactions. Not measured on Azure |
| `--alert-queue-backlog <messages>` | off | Creates an Azure Monitor alert when the queues hold more than this many messages on average over one hour |

Every setting lives in the Bicep template, because a redeployment replaces the app settings: a setting added later with `az functionapp config appsettings set` is gone after the next `deploy`.

`deploy`:

1. creates the resource group if `--location` is given;
2. deploys `infra/main.bicep` (storage account, one Function app, Application Insights, and Front Door only with `--front-door`);
3. uploads `.open-next/assets` to the `assets` container and `.open-next/cache` to the `cache` container, using your Azure AD identity (you need *Storage Blob Data Contributor* on the storage account);
4. deploys `app.zip` to the Function app;
5. prints the URL (the Function app's default host name, or the Front Door endpoint).

`--name` must be 3 to 12 lowercase letters or digits; it is combined with a hash to form globally unique resource names.

## What gets created

| Resource | Purpose |
| --- | --- |
| Storage account | `assets` and `cache` containers (both private), `tagcache` table, `revalidation` queue, `deploy-app` container |
| 1 Function app (Flex Consumption) | Three functions: `server` (all routes and static files), `image` (`/_next/image`), `revalidation` (queue trigger) |
| Application Insights + Log Analytics | Logs and metrics |
| Front Door Standard (only with `--front-door`) | Edge caching of `/_next/static/*`; the app then accepts only requests carrying this profile's id |

All data-plane access uses the Function app's system-assigned managed identity. Shared-key access is disabled on the storage account and no container is public.

### Cost note

Front Door Standard has a base fee of 35 USD per month per profile (list price, queried 2026-11-06) before requests and data transfer. Without it, every static file request is a function execution; for a small site that is usually cheaper, for a busy site put a CDN in front.

## Next steps

- [Architecture](./inner_workings/architecture.md)
- [Common issues](./common_issues.md)
