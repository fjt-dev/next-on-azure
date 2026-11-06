/**
 * Connection details of the Azurite instance started by global-setup.ts.
 * Dedicated ports so the integration tests never collide with `pnpm local:stack` (10000 to 10002).
 * The account name and key are Azurite's published development credentials, not a secret.
 */
export const PORTS = { blob: 10100, queue: 10101, table: 10102 } as const;

export const CONNECTION_STRING = [
  "DefaultEndpointsProtocol=http",
  "AccountName=devstoreaccount1",
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
  `BlobEndpoint=http://127.0.0.1:${PORTS.blob}/devstoreaccount1`,
  `QueueEndpoint=http://127.0.0.1:${PORTS.queue}/devstoreaccount1`,
  `TableEndpoint=http://127.0.0.1:${PORTS.table}/devstoreaccount1`,
].join(";");
