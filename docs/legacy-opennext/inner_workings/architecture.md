# Architecture

This page describes how a Next.js app runs on Azure with this package. It assumes you know the [OpenNext for AWS architecture](https://opennext.js.org/aws/inner_workings/architecture); the Azure design keeps the same components and swaps the platform pieces.

> Behavior on Azure is **unverified** until roadmap Phase 1 is complete. See [Compatibility](../compatibility.md).

```
   Without Front Door (default)              With Front Door (--front-door)

   Browser                                   Browser
      │                                         │
      ▼                                         ▼
 ┌──────────────────────────────┐        ┌───────────────┐
 │  Function app (Flex)         │        │  Front Door   │  caches /_next/static/*
 │  ├ server        {*path}  ───┼─ static└───────┬───────┘
 │  ├ image         _next/image │  files          ▼
 │  └ revalidation  queue trig. │        Function app (same as left,
 └───────┬──────┬───────┬───────┘        accepts only this profile's id)
         │      │       │
         ▼      ▼       ▼
   Blob assets  Blob cache  Table tagcache     Storage Queue "revalidation"
   (static)     (ISR/fetch) (revalidateTag)    ──▶ revalidation function
                                                   │ HEAD request with revalidate header
                                                   ▼
                                               server function (via the public host)
```

## Components

| OpenNext component | Azure | Notes |
| --- | --- | --- |
| Server function | Function `server` | Runs the bundled Next.js server through the Azure wrapper. Streams responses. |
| Static assets | Asset resolver override reading Blob `assets` | Only paths in `assets-manifest.json` (exact match); supports `HEAD`, `If-None-Match`, single byte ranges. Every request is a function execution. |
| Image optimization function | Function `image` on route `_next/image` | Next's image optimizer with `sharp`; reads source images from the `assets` container. |
| Revalidation function | Function `revalidation` (queue trigger) | Sends a `HEAD` request to the page with the preview-mode revalidation header so the server regenerates it. |
| ISR and fetch cache | Blob `cache` container | Key layout: `[__fetch/]<buildId>/<key>[.<ext>]`. |
| Tag cache | Table `tagcache` | See [Tag cache](../config/overrides/tag_cache.md). |
| CDN | Optional Front Door Standard | Caches `/_next/static/*` only; the dynamic route is not cached. |
| Warmer | Not used | Flex Consumption "always ready" instances replace it (`alwaysReadyInstances` in Bicep). |
| Initializer / dynamodb-provider | Not used | The `nextMode` tag cache needs no seeding. |

## One app, three bundles

The three OpenNext bundles are loaded into one Node process by a generated `main.mjs`. Each bundle expects its own directory as the working directory (the revalidation adapter reads `./prerender-manifest.json` while it is imported), so the entry changes directory before importing each bundle and loads `server` last. The shared `globalThis` state turned out to be compatible (same configuration object in every bundle). See [ADR-0009](../../plan/decisions.md#adr-0009-single-function-app-and-optional-front-door-by-default).

Trade-off: SSR and image processing share an instance, so memory must be sized for `sharp` (`instanceMemoryMB`), and they scale together.

## Request flow: a page request

1. The request reaches the Function app directly, or through Front Door (which adds `x-forwarded-host`, `x-forwarded-proto` and `X-Azure-FDID`; the wrapper rejects a mismatching `X-Azure-FDID` when `FRONT_DOOR_ID` is set).
2. The Functions host calls the registered handler with an `HttpRequest`.
3. The converter builds an OpenNext `InternalEvent`.
4. OpenNext routes the request (rewrites, redirects, middleware). If the path is a static file listed in the assets manifest, the asset resolver answers it from Blob; otherwise the Next.js server runs.
5. The wrapper waits for the first of two things: the server asking for a response stream (`writeHeaders`), or the handler returning a complete result. It returns an `HttpResponseInit` whose body is a web `ReadableStream`, so HTML streams to the client as it renders.
6. Deferred work registered through `waitUntil` (for example enqueueing a revalidation) is awaited before the stream is closed.

## Build and packaging

```
next build ─▶ open-next build ─▶ .open-next/ ─▶ opennext-azure package ─▶ .open-next-azure/app.zip
```

`package` copies the three OpenNext bundles into `app/server`, `app/image` and `app/revalidation`, writes `assets-manifest.json`, `host.json`, `package.json` and `main.mjs`, installs the Azure SDKs once at the app root (every bundle resolves them from there; [ADR-0008](../../plan/decisions.md#adr-0008-packaging-never-runs-npm-install-inside-an-opennext-bundle)), refuses to continue if `sharp` lacks its Linux x64 binaries, and zips the app. `deploy` uses `az functionapp deployment source config-zip`.

## Security model

- The storage account has shared-key access disabled and no public container. The Function app's system-assigned managed identity has *Storage Blob Data Owner*, *Storage Queue Data Contributor* and *Storage Table Data Contributor* on that account.
- Without Front Door the Function app is the public entry point and nothing can be bypassed.
- With Front Door, the app is protected twice: an `AzureFrontDoor.Backend` access restriction carrying the profile id (support on Flex Consumption is **unverified**), and the wrapper's `X-Azure-FDID` check, which works regardless and is covered by a local test.
