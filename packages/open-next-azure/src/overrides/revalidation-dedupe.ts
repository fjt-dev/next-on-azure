import { createHash } from "node:crypto";
import type { TableClient } from "@azure/data-tables";

/**
 * Deduplication of ISR revalidation messages.
 *
 * Every request that finds a page stale asks for a revalidation, and Storage Queues cannot
 * deduplicate. While the queue consumer is slow, each further request added one more message
 * (25 polling requests became 25 messages and 27 regenerations of one page on Azure, ADR-0010).
 *
 * A request may enqueue only if it wins a "claim" on the combination of page and page version
 * (the ETag of the cached content, which changes when the page is regenerated with new content). The claim is a Table Storage row
 * written with optimistic concurrency, so of any number of simultaneous requests, on any number of
 * instances, exactly one wins:
 *
 * - no row                      -> create it; a 409 means someone else just did
 * - row of the same (or an unknown) version, younger than the window -> somebody already asked,
 *   do not enqueue
 * - otherwise (older, or a different version)       -> replace it using the row's ETag; a 412
 *   (or a vanished row) means someone else got there first
 *
 * After the window the claim can be taken again, so a lost message does not block a page forever.
 */
export type DedupeTable = Pick<TableClient, "getEntity" | "createEntity" | "updateEntity">;

export type ClaimInput = {
  partitionKey: string;
  host: string;
  url: string;
  /**
   * Identity of the page content being revalidated (its ETag). "" means unknown: then only the
   * window decides, and a known and an unknown version count as the same.
   */
  version: string;
  now: number;
  /** 0 disables the dedupe: every call wins and nothing is stored. */
  windowMs: number;
};

/** A fixed-length key without the characters Table Storage forbids, however long the URL is. */
export function dedupeRowKey(host: string, url: string): string {
  return createHash("sha1").update(`${host}\n${url}`).digest("hex");
}

const statusOf = (error: unknown) => (error as { statusCode?: number }).statusCode;

export async function claimRevalidation(table: DedupeTable, input: ClaimInput): Promise<boolean> {
  if (input.windowMs <= 0) return true;

  const rowKey = dedupeRowKey(input.host, input.url);
  const entity = {
    partitionKey: input.partitionKey,
    rowKey,
    version: input.version,
    claimedAt: input.now,
  };

  let existing: { version?: string; claimedAt?: number; etag?: string } | undefined;
  try {
    existing = await table.getEntity<{ version: string; claimedAt: number }>(
      input.partitionKey,
      rowKey,
    );
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }

  if (!existing) {
    try {
      await table.createEntity(entity);
      return true;
    } catch (error) {
      if (statusOf(error) === 409) return false; // lost the race to create the row
      throw error;
    }
  }

  // An unknown version on either side is a wildcard. OpenNext does not always know the page
  // version: in the server path the message carries `lastModified` 0 or 1 (a "stale" marker), and
  // treating those as different versions made concurrent requests take turns winning the claim.
  const sameVersion = !input.version || !existing.version || existing.version === input.version;
  const fresh = input.now - (existing.claimedAt ?? 0) < input.windowMs;
  if (sameVersion && fresh) return false;

  try {
    await table.updateEntity(entity, "Replace", { etag: existing.etag });
    return true;
  } catch (error) {
    if (statusOf(error) === 412 || statusOf(error) === 404) return false; // lost the race to replace it
    throw error;
  }
}
