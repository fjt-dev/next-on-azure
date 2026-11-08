// Runs a packaged app locally: Azurite with fresh storage, then the Functions host on
// http://localhost:7071. Stop with Ctrl+C. Default app: examples/standalone (needs
// `pnpm --filter example-standalone run standalone`); another one: node scripts/standalone-local.mjs <app>/.next-azure/app
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.resolve(process.argv[2] ?? path.join(root, "examples/standalone/.next-azure/app"));
if (!fs.existsSync(path.join(app, "main.mjs"))) {
  console.error(
    `${app} not found. Package the app first (for the example: pnpm --filter example-standalone run standalone).`,
  );
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-local-"));
// Azurite's published development account (not a secret).
const KEY =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const cs = [
  "DefaultEndpointsProtocol=http",
  "AccountName=devstoreaccount1",
  `AccountKey=${KEY}`,
  "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1",
  "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1",
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1",
].join(";");

const children = [];
const stop = () => {
  for (const c of children) c.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
};
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("exit", stop);

children.push(
  spawn(
    path.join(root, "node_modules/.bin/azurite"),
    [
      "--silent",
      "--skipApiVersionCheck",
      "--location",
      tmp,
      "--blobPort",
      "10000",
      "--queuePort",
      "10001",
      "--tablePort",
      "10002",
    ],
    { stdio: "inherit" },
  ),
);
await new Promise((r) => setTimeout(r, 3000));

// Resolves the SDKs the way the app does: from the (flattened) node_modules of the standalone copy.
const req = createRequire(path.join(app, "standalone/package.json"));
const { BlobServiceClient } = req("@azure/storage-blob");
const { TableServiceClient } = req("@azure/data-tables");
await BlobServiceClient.fromConnectionString(cs).getContainerClient("cache").createIfNotExists();
await TableServiceClient.fromConnectionString(cs, { allowInsecureConnection: true }).createTable(
  "tagcache",
);

fs.writeFileSync(
  path.join(app, "local.settings.json"),
  JSON.stringify({
    IsEncrypted: false,
    Values: {
      FUNCTIONS_WORKER_RUNTIME: "node",
      AzureWebJobsStorage: cs,
      AZURE_STORAGE_CONNECTION_STRING: cs,
    },
  }),
);
const func = path.join(root, "node_modules/azure-functions-core-tools/bin/func");
children.push(spawn(func, ["start", "--port", "7071"], { cwd: app, stdio: "inherit" }));
console.log("[standalone-local] http://localhost:7071 (Ctrl+C to stop)");
