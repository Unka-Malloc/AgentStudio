import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const skippedDirs = new Set([
  ".git",
  "build",
  "node_modules",
  "test-results",
  "coverage"
]);
const skippedFiles = new Set([
  "CHANGELOG.md",
  "package-lock.json",
  "scripts/verify-pactium-hygiene.mjs"
]);
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".sqlite"
]);

const oldPactMcpCommand = `${"pact"}-${"mcp"}`;
const oldPactClientCommand = `${"pact"}-${"client"}`;
const oldPactServerIdentifier = `${"pact"}-${"server"}`;

const checks = [
  { pattern: /\bPACT_[A-Z0-9_]+\b/g, reason: "old PACT_* environment variable" },
  { pattern: new RegExp(`\\.${oldPactServerIdentifier}-data`, "g"), reason: "old server data directory" },
  { pattern: new RegExp(`\\b${oldPactMcpCommand}\\b`, "g"), reason: "old MCP command" },
  { pattern: new RegExp(`\\b${oldPactClientCommand}\\b`, "g"), reason: "old client command" },
  { pattern: new RegExp(`\\b${oldPactServerIdentifier}\\b`, "g"), reason: "old server identifier" },
  { pattern: /Unka-Malloc\/Pact(?!ium)/g, reason: "old repository identity" },
  { pattern: /\bLicolite\b/g, reason: "incorrect LicoLite spelling" },
  { pattern: /\bO-Sys-It\b/g, reason: "old product positioning" }
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skippedDirs.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
      continue;
    }
    if (!entry.isFile()) continue;
    if (skippedFiles.has(relative) || skippedFiles.has(entry.name)) continue;
    if (binaryExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(absolute);
  }
  return files;
}

async function addMaintainedGeneratedDocs(files) {
  const buildReadme = path.join(root, "build", "README.md");
  try {
    await fs.access(buildReadme);
    files.push(buildReadme);
  } catch {}
  return files;
}

const findings = [];
for (const file of await addMaintainedGeneratedDocs(await walk(root))) {
  const relative = path.relative(root, file);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  for (const check of checks) {
    for (const match of text.matchAll(check.pattern)) {
      const lineText = text.slice(text.lastIndexOf("\n", match.index) + 1, text.indexOf("\n", match.index) < 0 ? text.length : text.indexOf("\n", match.index));
      if (
        check.reason === "old product positioning" &&
        /migrat|archiv|迁移|归档/i.test(lineText)
      ) {
        continue;
      }
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({
        file: relative,
        line,
        text: match[0],
        reason: check.reason
      });
    }
  }
}

if (findings.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    findings
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checked: "pactium-hygiene"
}, null, 2));
