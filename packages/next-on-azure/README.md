# next-on-azure (not published)

Runs Next.js on one Azure Function (Flex Consumption) with Blob and Table Storage. Experimental. See the [documentation](../../docs/README.md).

```js
// next.config.mjs
import { withAzure } from "next-on-azure/config";
export default withAzure({ /* your Next.js config */ });
```

```bash
next build
next-on-azure package                 # .next-azure/app.zip (Linux x64 sharp inside)
next-on-azure deploy -g <rg> -n <name> -l <region>
next-on-azure prime <url>             # request every prerendered route once
```
