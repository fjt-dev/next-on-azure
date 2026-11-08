# next-on-azure (provisional name, not published)

Runs Next.js on one Azure Function (Flex Consumption) with Blob and Table Storage, without
`@opennextjs/aws`. See ADR-0016 and ADR-0017 in `docs/plan/decisions.md`. Experimental.

```js
// next.config.mjs
import { withAzure } from "next-on-azure/config";
export default withAzure({ /* your Next.js config */ });
```

```bash
next build
next-on-azure package          # .next-azure/app.zip, one Function app (Linux x64 sharp inside)
next-on-azure prime <url>      # request every prerendered route once after a deployment
```

What `withAzure()` sets and why is in `src/config.ts`. The example app is `examples/standalone`; run it
locally with `pnpm --filter example-standalone run standalone` and `node scripts/standalone-local.mjs`.
