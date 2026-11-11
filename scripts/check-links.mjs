// Checks the relative links of the Markdown files: the file exists, and a `#anchor` is a heading of that file
// (GitHub's rule for the anchor of a heading). No network: external links are only counted.
//   node scripts/check-links.mjs [file or directory ...]     (default: the Markdown of this repository)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipDirs = new Set([
  "node_modules",
  ".git",
  ".next",
  ".next-azure",
  "dist",
  ".turbo",
  ".pnpm-store",
]);

function walk(target, out = []) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith(".md")) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    walk(path.join(target, entry.name), out);
  }
  return out;
}

/** Text without fenced code blocks, which can hold link-like text. */
function withoutFences(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
}

/** Text without fenced code blocks and inline code (the text of a heading keeps its code). */
function prose(text) {
  return withoutFences(text).replace(/`[^`\n]*`/g, "``");
}

/** The anchors of the headings of a file, as GitHub makes them (repeats get -1, -2, ...). */
function anchors(text) {
  const seen = new Map();
  const out = new Set();
  for (const [, heading] of withoutFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const plain = heading
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*~]/g, "")
      .toLowerCase();
    const base = plain
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

const targets =
  process.argv.slice(2).length > 0 ? process.argv.slice(2).map((p) => path.resolve(p)) : [root];
const files = targets.flatMap((t) => walk(t));
const anchorCache = new Map();
const anchorsOf = (file) => {
  if (!anchorCache.has(file)) anchorCache.set(file, anchors(fs.readFileSync(file, "utf8")));
  return anchorCache.get(file);
};

const problems = [];
let checked = 0;
let external = 0;
for (const file of files) {
  const text = prose(fs.readFileSync(file, "utf8"));
  for (const [, url] of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(https?:|mailto:)/.test(url)) {
      external++;
      continue;
    }
    const [target = "", hash] = url.split("#");
    const resolved = target === "" ? file : path.resolve(path.dirname(file), decodeURI(target));
    checked++;
    if (!fs.existsSync(resolved)) {
      problems.push(`${path.relative(root, file)}: ${url} (no such file)`);
      continue;
    }
    if (
      hash &&
      fs.statSync(resolved).isFile() &&
      resolved.endsWith(".md") &&
      !anchorsOf(resolved).has(decodeURIComponent(hash))
    ) {
      problems.push(`${path.relative(root, file)}: ${url} (no such heading)`);
    }
  }
}
console.log(
  `${files.length} Markdown files, ${checked} relative links checked, ${external} external links not checked.`,
);
if (problems.length > 0) {
  console.error(`${problems.length} broken link(s):\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
