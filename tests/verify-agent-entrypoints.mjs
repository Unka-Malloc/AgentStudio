#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const entrypoints = [
  {
    path: "AGENT.md",
    maxLines: 120,
    requiredPatterns: [
      /根 `README\.md` 和 `README\.zh-CN\.md` 是产品宣传页/u,
      /目标子目录最近的 `AGENT\.md`/u,
      /git status --short/u
    ]
  },
  {
    path: "server/AGENT.md",
    maxLines: 80,
    requiredPatterns: [/Server Agent Entry/u, /server\/platform\/README\.md/u, /Context Budget/u]
  },
  {
    path: "server-web/AGENT.md",
    maxLines: 80,
    requiredPatterns: [/Server Web Agent Entry/u, /server-web\/components\/common\.ts/u, /Context Budget/u]
  },
  {
    path: "mcp-connector/AGENT.md",
    maxLines: 80,
    requiredPatterns: [/MCP Connector Agent Entry/u, /mcp-connector\/bin\/pact-mcp\.mjs/u, /Context Budget/u]
  },
  {
    path: "client-cli/AGENT.md",
    maxLines: 80,
    requiredPatterns: [/Client CLI Agent Entry/u, /client-cli\/src\/lib\.rs/u, /Context Budget/u]
  },
  {
    path: "client-gui/AGENT.md",
    maxLines: 80,
    requiredPatterns: [/Client GUI Agent Entry/u, /client-gui\/pubspec\.yaml/u, /Context Budget/u]
  },
  {
    path: "docs/AGENT.md",
    maxLines: 80,
    requiredPatterns: [/Docs Agent Entry/u, /## Metadata \/ 元数据/u, /Context Budget/u]
  }
];

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function assertMissing(relativePath) {
  try {
    await fs.stat(path.join(repoRoot, relativePath));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  assert.fail(`${relativePath} must not exist; AGENT.md is the single root agent entry`);
}

function lineCount(text) {
  return text.split(/\r?\n/).filter((line, index, lines) => index < lines.length - 1 || line.length > 0).length;
}

await assertMissing("AGENTS.md");

for (const entry of entrypoints) {
  const text = await readText(entry.path);
  const lines = lineCount(text);
  assert.ok(lines <= entry.maxLines, `${entry.path} has ${lines} lines; keep <= ${entry.maxLines}`);
  for (const pattern of entry.requiredPatterns) {
    assert.match(text, pattern, `${entry.path} must include ${pattern}`);
  }
}

const docsIndex = await readText("docs/README.md");
assert.match(docsIndex, /\[AGENT\.md\]\(AGENT\.md\)/u, "docs/README.md must index docs/AGENT.md");

const collaborationGuide = await readText("docs/GIT-COLLAB.md");
for (const entry of entrypoints.slice(1)) {
  assert.ok(
    collaborationGuide.includes(`\`${entry.path}\``),
    `docs/GIT-COLLAB.md must list ${entry.path}`
  );
}

console.log(`[verify-agent-entrypoints] ok: ${entrypoints.length} agent entrypoints checked`);
