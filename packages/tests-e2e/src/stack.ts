import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type RunningStack = {
  baseUrl: string;
  /** Directory holding this run's certificate and logs (deleted when the stack stops). */
  runDir: string;
  stop: () => Promise<void>;
};

/**
 * Starts `scripts/local-stack.mjs` (Azurite + the Function app over HTTPS) and waits until it is
 * ready. Requires `pnpm --filter example-app-router run package` to have been run.
 */
export async function startStack(extraEnv: Record<string, string> = {}): Promise<RunningStack> {
  const child: ChildProcess = spawn(process.execPath, ["scripts/local-stack.mjs"], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const runDir = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGINT");
      reject(new Error(`local stack did not become ready in 200 s\n${output}`));
    }, 200_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /logs: (.+)\/\*\.log/.exec(output);
      if (match?.[1] && output.includes("[local-stack] ready")) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`local stack exited early (${code})\n${output}`));
    });
  });

  return {
    baseUrl: "https://localhost:7071",
    runDir,
    stop: () =>
      new Promise<void>((resolve) => {
        // Close our ends of the pipes too, otherwise they keep the test process alive after the run.
        const release = () => {
          child.stdout?.destroy();
          child.stderr?.destroy();
        };
        if (child.exitCode !== null) {
          release();
          return resolve();
        }
        // Safety net if SIGINT does not stop the stack; cleared on a normal exit so it cannot keep
        // the test process alive.
        const force = setTimeout(() => {
          child.kill("SIGKILL");
          release();
          resolve();
        }, 30_000);
        child.once("exit", () => {
          clearTimeout(force);
          release();
          resolve();
        });
        child.kill("SIGINT");
      }),
  };
}
