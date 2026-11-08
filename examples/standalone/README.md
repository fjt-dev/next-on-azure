# Example app

The app for `next-on-azure`: App Router and Pages Router routes that exist to test specific behavior (`/isr` with a 5 second revalidate, `/slow` for streaming, `/tagged`, `/use-cache`, `/actions`, `/pages-*`, `/mw/*` for middleware, `/api/after`).

```bash
pnpm --filter example-standalone run standalone   # next build + next-on-azure package --target local
node ../../scripts/standalone-local.mjs           # from this directory: the local stack on http://localhost:7071
pnpm e2e:standalone                               # all of it, plus the HTTP suite
```

`standalone:azure` packages for Azure (Linux x64 `sharp`).
