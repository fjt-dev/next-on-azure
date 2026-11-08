"use strict";
// Storage clients shared by the cache handlers (spike, ADR-0016).
const fs = require("node:fs");
const path = require("node:path");

const connectionString = () => process.env.AZURE_STORAGE_CONNECTION_STRING;
const account = () => process.env.AZURE_STORAGE_ACCOUNT_NAME;

let clients;
async function getClients() {
  clients ??= (async () => {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const { TableClient } = require("@azure/data-tables");
    const cs = connectionString();
    if (cs) {
      return {
        container: BlobServiceClient.fromConnectionString(cs).getContainerClient(
          process.env.CACHE_CONTAINER_NAME ?? "cache",
        ),
        table: TableClient.fromConnectionString(cs, process.env.CACHE_TABLE_NAME ?? "tagcache", {
          allowInsecureConnection: cs.includes("127.0.0.1"),
        }),
      };
    }
    const { DefaultAzureCredential } = require("@azure/identity");
    const credential = new DefaultAzureCredential();
    return {
      container: new BlobServiceClient(
        `https://${account()}.blob.core.windows.net`,
        credential,
      ).getContainerClient(process.env.CACHE_CONTAINER_NAME ?? "cache"),
      table: new TableClient(
        `https://${account()}.table.core.windows.net`,
        process.env.CACHE_TABLE_NAME ?? "tagcache",
        credential,
      ),
    };
  })();
  return clients;
}

const rowKey = (tag) => Buffer.from(tag).toString("base64url");
const sha = (s) => require("node:crypto").createHash("sha256").update(s).digest("hex");

/** The build id, so that entries of an older build are never read by a newer one. */
function readBuildId(serverDistDir) {
  if (process.env.NEXT_BUILD_ID) return process.env.NEXT_BUILD_ID;
  try {
    return fs
      .readFileSync(path.join(serverDistDir ?? ".next/server", "..", "BUILD_ID"), "utf8")
      .trim();
  } catch {
    return "dev";
  }
}

/**
 * `next build` prerenders pages and calls the cache handlers. There is no storage account then, and
 * what the build produces is read from the build output anyway, so the handlers do nothing.
 */
const inBuild = () => process.env.NEXT_PHASE === "phase-production-build";

module.exports = { getClients, rowKey, sha, readBuildId, inBuild };
