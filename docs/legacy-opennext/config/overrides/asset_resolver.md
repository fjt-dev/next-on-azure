# Asset resolver

The asset resolver `azure-blob-manifest` serves `/_next/static/*` and `public/` files from the Blob container `assets`. `opennext-azure package` writes `assets-manifest.json` (path, size, content type and a SHA-1 based ETag for every file in `.open-next/assets`, except OpenNext's internal `BUILD_ID`). Only listed paths are served, by exact match; everything else goes on to Next.js, so metadata routes such as `robots` or `sitemap` that the server renders are never shadowed.

| Request | Response |
| --- | --- |
| `GET` / `HEAD` of a listed path | 200 with `content-type`, `etag`, `content-length`, `accept-ranges: bytes` |
| `_next/static/*` | `cache-control: public, max-age=31536000, immutable` |
| other files | `cache-control: public, max-age=0, must-revalidate` |
| `If-None-Match` matching the ETag | 304 |
| `Range: bytes=a-b` (single range) | 206 with `content-range`; an unsatisfiable range gives 416 |
| other methods, unlisted paths | passed on to Next.js |

If a listed file is missing in storage, the resolver logs the inconsistency and lets Next.js answer. The manifest path is `ASSETS_MANIFEST_PATH` (set by the generated `main.mjs`).
