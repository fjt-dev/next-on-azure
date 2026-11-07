# Revalidation

`revalidate.js` has two exports for the `revalidate` section of `open-next.config.ts`:

- `revalidateWrapper` registers a queue trigger on the Storage Queue `revalidation`. A failed revalidation throws, so the host retries (up to 3 times) and then moves the message to `revalidation-poison`.
- `revalidateConverter` reads the plain JSON message (`{ host, url, lastModified, eTag }`) and turns it into the request OpenNext's revalidation adapter sends: a `HEAD` to `https://<host><url>` with the preview-mode revalidation header and `x-isr: 1`.

This runs in the same Function app as the server. The queue trigger is its own scale group, so with no always-ready instance a stale page can wait minutes for its regeneration; `--revalidation-always-ready` and `--revalidation-polling-seconds` of `deploy` shorten that ([ADR-0010](../../plan/decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group)). The flow is in [Caching and revalidation](../../inner_workings/caching.md).
