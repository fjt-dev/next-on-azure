# next-on-azure

Runs Next.js on one Azure Function (Flex Consumption) with Blob and Table Storage.

**Experimental.** The first release promises only what was run: see [Support](https://next-on-azure.fjtd.dev/en/support) and [Compatibility](https://next-on-azure.fjtd.dev/en/compatibility) for what is verified and what is not.

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

- Needs Node.js 22 or later, and `next` 15.5.29 or later 15.x, or 16.4.5 or later.
- Documentation: <https://next-on-azure.fjtd.dev>
- Source, issues and security reports: <https://github.com/fjt-dev/next-on-azure>
- License: MIT
