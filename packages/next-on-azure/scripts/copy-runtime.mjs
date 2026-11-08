// tsc compiles TypeScript only. The runtime files that Next.js and the Functions host load as they
// are (CommonJS cache handlers, the Functions entry) are copied next to the compiled output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "src/runtime");
const to = path.join(root, "dist/runtime");
fs.mkdirSync(to, { recursive: true });
for (const file of fs.readdirSync(from)) {
  if (file.endsWith(".cjs") || file.endsWith(".mjs"))
    fs.copyFileSync(path.join(from, file), path.join(to, file));
}
