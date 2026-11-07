# Revalidation queue

The queue `azure-queue` sends ISR revalidation requests to the Storage Queue `revalidation` (`REVALIDATION_QUEUE_NAME`). Messages are plain JSON (`{ host, url, lastModified, eTag }`), so `host.json` sets `extensions.queues.messageEncoding` to `none`. The send goes through `waitUntil`.

## Deduplication

Storage Queues have no deduplication or message groups, so `MessageDeduplicationId` and `MessageGroupId` are ignored. Instead, before enqueueing, a request must win a claim on the page: a row in the tag table (partition `dedupe-<build id>`) created or replaced with optimistic concurrency. That gives one message per page and window, however many requests find the page stale ([ADR-0010](../../plan/decisions.md#adr-0010-isr-revalidation-depends-on-the-queue-trigger-scale-group)).

- The page version is the ETag of the cached content. A regeneration with new content allows the next claim at once.
- Without a known version only `REVALIDATION_DEDUPE_SECONDS` (default `60`, `0` = off) decides.
- If the claim cannot be made (storage error), the message is enqueued anyway.

## Failures

A failed revalidation throws, the host retries up to `maxDequeueCount` (3), and then moves the message to the `revalidation-poison` queue.
