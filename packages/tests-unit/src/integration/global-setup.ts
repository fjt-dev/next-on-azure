import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORTS } from "./azurite.js";

let azurite: ChildProcess | undefined;
let dataDir: string | undefined;

const waitForPort = (port: number, timeoutMs = 30_000) =>
  new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`Azurite did not open port ${port}`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });

export async function setup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azurite-it-"));
  azurite = spawn(
    path.join(root, "node_modules/.bin/azurite"),
    [
      "--silent",
      "--skipApiVersionCheck",
      "--location",
      dataDir,
      "--blobPort",
      String(PORTS.blob),
      "--queuePort",
      String(PORTS.queue),
      "--tablePort",
      String(PORTS.table),
    ],
    { stdio: "ignore" },
  );
  await Promise.all(Object.values(PORTS).map((p) => waitForPort(p)));
}

export async function teardown() {
  if (azurite && azurite.exitCode === null) {
    const exited = new Promise<void>((resolve) => azurite?.once("exit", () => resolve()));
    azurite.kill("SIGTERM");
    // Azurite flushes its data files on shutdown; only remove the directory once it has exited.
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 10_000))]);
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
