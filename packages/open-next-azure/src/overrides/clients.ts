import type { TableClient } from "@azure/data-tables";
import type { BlobServiceClient } from "@azure/storage-blob";
import type { QueueClient } from "@azure/storage-queue";

/**
 * Shared storage clients for the OpenNext overrides.
 *
 * IMPORTANT: the Azure SDKs are loaded with a non-literal dynamic import on
 * purpose. OpenNext bundles `open-next.config.ts` with esbuild to evaluate it
 * at build time; a literal import would pull @azure/identity (and its
 * dependencies) into that bundle and break it. With a computed specifier
 * esbuild leaves the import alone and the SDKs are resolved at runtime from
 * the Function app's node_modules (`opennext-azure package` installs them).
 *
 * Auth: when AZURE_STORAGE_CONNECTION_STRING is set (local dev / Azurite) it is
 * used; otherwise the account is addressed by AZURE_STORAGE_ACCOUNT_NAME with
 * DefaultAzureCredential (managed identity in Azure).
 */
const load = <T>(specifier: string): Promise<T> => import(specifier);

const connectionString = () => process.env.AZURE_STORAGE_CONNECTION_STRING;
const accountName = () => {
  const name = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!name) {
    throw new Error("Set AZURE_STORAGE_ACCOUNT_NAME (or AZURE_STORAGE_CONNECTION_STRING)");
  }
  return name;
};

let credential: Promise<unknown> | undefined;
const getCredential = () => {
  credential ??= load<typeof import("@azure/identity")>("@azure/identity").then(
    (m) => new m.DefaultAzureCredential(),
  );
  return credential;
};

let blobService: Promise<BlobServiceClient> | undefined;
export function getBlobService(): Promise<BlobServiceClient> {
  blobService ??= (async () => {
    const { BlobServiceClient } =
      await load<typeof import("@azure/storage-blob")>("@azure/storage-blob");
    const cs = connectionString();
    return cs
      ? BlobServiceClient.fromConnectionString(cs)
      : new BlobServiceClient(
          `https://${accountName()}.blob.core.windows.net`,
          (await getCredential()) as never,
        );
  })();
  return blobService;
}

const tables = new Map<string, Promise<TableClient>>();
export function getTableClient(name: string): Promise<TableClient> {
  let client = tables.get(name);
  if (!client) {
    client = (async () => {
      const { TableClient } = await load<typeof import("@azure/data-tables")>("@azure/data-tables");
      const cs = connectionString();
      return cs
        ? TableClient.fromConnectionString(cs, name, {
            allowInsecureConnection: cs.includes("127.0.0.1"),
          })
        : new TableClient(
            `https://${accountName()}.table.core.windows.net`,
            name,
            (await getCredential()) as never,
          );
    })();
    tables.set(name, client);
  }
  return client;
}

const queues = new Map<string, Promise<QueueClient>>();
export function getQueueClient(name: string): Promise<QueueClient> {
  let client = queues.get(name);
  if (!client) {
    client = (async () => {
      const { QueueClient } =
        await load<typeof import("@azure/storage-queue")>("@azure/storage-queue");
      const cs = connectionString();
      return cs
        ? new QueueClient(cs, name)
        : new QueueClient(
            `https://${accountName()}.queue.core.windows.net/${name}`,
            (await getCredential()) as never,
          );
    })();
    queues.set(name, client);
  }
  return client;
}
