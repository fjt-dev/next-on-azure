# Image loader

The image loader `azure-blob` gives the OpenNext image adapter the source images of your own app: it reads `/_next/image?url=/images/a.png` sources from the Blob container `assets` (`ASSETS_CONTAINER_NAME`, optional `ASSETS_BLOB_PREFIX`) and streams them with their content type and cache control.

- A missing source image raises an error and is recorded for the [wrapper](./wrapper.md), which answers `404` instead of the adapter's generic `500`.
- Remote images (`images.remotePatterns`) do not go through the loader. OpenNext's image adapter validates the URL against `remotePatterns` and fetches it itself.
- The image function needs `sharp` for Linux x64; `install` in the [simple example](../simple_example.md) adds it to the bundle.
- Optimized images are not cached on the server (same as the official adapter). They carry `Cache-Control: public,max-age=N,immutable` and `Vary: Accept`; with `OPENNEXT_STATIC_ETAG=true` they get an ETag and answer `304`. See [ADR-0014](../../../plan/decisions.md).
- On Next.js 16, a remote image whose host resolves to a private address is refused unless `images.dangerouslyAllowLocalIP` is set (Next.js 15.5.29 rejects that option).
