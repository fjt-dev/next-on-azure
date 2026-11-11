# Troubleshooting

Problems observed during development, with causes and fixes.

## A Server Action fails after a deployment ("Failed to find Server Action")

Server Actions encrypt the variables a closure captures. By default Next.js makes a new key for every build, so an action can only be invoked against the build that produced it: a page that was open before a deployment fails when it calls an action, and instances built apart do not agree. This is documented for self-hosting by the Next.js team; the behavior on Azure was not reproduced.

Set the same key for every build, at build time (it is embedded in the build output):

```bash
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(openssl rand -base64 32)"   # keep it in your secret store, not in the repository
next build
next-on-azure package
```

The key is base64 of 16, 24 or 32 bytes. `package` warns when the app has Server Actions and the variable is not set in its environment, and when the value differs from the key embedded in the build. If the key was set only for `next build`, set it for `package` too to silence the warning.

## Every request through the proxy/middleware answers 500: "Unsupported external type Url for commonjs reference"

Next.js 16 (Turbopack) bundles the cache handlers into the proxy bundle, and the bundle cannot load a `node:` external from CommonJS. The handlers of this package avoid it. If you write your own cache handler, `require("fs")`, not `require("node:fs")`.

## Images are served unresized, with no error

`sharp` is missing or incomplete in the package. `package` copies the whole `sharp` package and the Linux x64 binaries; check that `@img/sharp-linux-x64` and `@img/sharp-libvips-linux-x64` are in `standalone/node_modules/@img` of the zip. Without `sharp`, Next.js serves the original image.

## A middleware rewrite answers 500 ("Failed to proxy https://localhost:3000/...")

The request carried `x-forwarded-proto: https` to the Next.js server. The entry does not forward that header; if you put another proxy between the entry and Next.js, do not add it.

## A redirect points to `http://localhost:3000/...`

The entry corrects the `Location` header. A URL that application code builds from `request.url` and writes into a body is not corrected: use an environment variable for the public origin.

## `EACCES: permission denied, mkdir '.../.next/cache'` in the logs

Something writes below the app directory, which is read-only on Azure. `withAzure()` turns off the image disk cache and `isrFlushToDisk`; remove any other write there, or write to `/tmp`.

## The Function app shows Azure's "Your Azure Function App is up and running" page

The app did not start. Read the host's log first: `az monitor app-insights query --app <name> -g <rg> --analytics-query "traces | order by timestamp desc"` shows `Worker was unable to load entry point` with the missing module. Application Insights lags by one to ten minutes.

## A setting I added with `az functionapp config appsettings set` disappeared

A [Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/overview?wt.mc_id=studentamb_679600) redeployment replaces the whole `appSettings` array. Put settings in the template.

## `pnpm e2e:standalone` or the local stack cannot find `func`

`azure-functions-core-tools` downloads its binary in a postinstall step. In a fresh checkout or a worktree, run `pnpm install` again, or copy the `bin` directory from another checkout.

## A POST without Content-Length never gets an answer on the local stack

The [Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local?wt.mc_id=studentamb_679600) host over plain http never answered a chunked upload (the request hangs until the client gives up). Send a `Content-Length`; the test client does. Not seen over https or on Azure.
