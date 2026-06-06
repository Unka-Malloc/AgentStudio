#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const args = {
    expectedDate: "",
    timezone: process.env.TZ || "Asia/Shanghai"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--expected-date") {
      args.expectedDate = argv[index + 1] || "";
      index += 1;
    } else if (value === "--timezone") {
      args.timezone = argv[index + 1] || args.timezone;
      index += 1;
    }
  }
  return args;
}

function todayIso(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function exists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(rootDir, predicate, collected = []) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolute, predicate, collected);
    } else if (predicate(absolute)) {
      collected.push(absolute);
    }
  }
  return collected;
}

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function isHistoryPath(relativePath) {
  return relativePath.startsWith("docs/history/") || relativePath.startsWith("docs/reports/history/");
}

function findContentStartAfterFrontmatter(lines) {
  if (lines[0] !== "---") {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") {
      return index + 1;
    }
  }
  return 0;
}

function assertDocumentMetadata(relativePath, text, expectedDate) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const contentStart = findContentStartAfterFrontmatter(lines);
  const titleIndex = lines.findIndex((line, index) => index >= contentStart && /^#\s+\S/.test(line));
  assert.notEqual(titleIndex, -1, `${relativePath} must start with an H1 title`);

  let firstContentIndex = titleIndex + 1;
  while (firstContentIndex < lines.length && lines[firstContentIndex].trim() === "") {
    firstContentIndex += 1;
  }

  assert.equal(
    lines[firstContentIndex],
    "## Metadata / 元数据",
    `${relativePath} must use '## Metadata / 元数据' as the first section after the title`
  );

  const metadataEnd = lines.findIndex((line, index) => index > firstContentIndex && /^##\s+\S/.test(line));
  const metadataLines = lines
    .slice(firstContentIndex + 1, metadataEnd === -1 ? lines.length : metadataEnd)
    .join("\n");

  assert.match(metadataLines, new RegExp(`Last updated: ${expectedDate.replaceAll("-", "\\-")}`), `${relativePath} must use commit-day Last updated: ${expectedDate}`);
  assert.match(metadataLines, /Status:/, `${relativePath} metadata must include Status`);
  assert.match(metadataLines, /Scope:/, `${relativePath} metadata must include Scope`);
  assert.match(metadataLines, /Staleness check:/, `${relativePath} metadata must include Staleness check`);
}

async function selectHistoryRoot() {
  const candidates = [
    path.join(repoRoot, "docs", "history"),
    path.join(repoRoot, "docs", "reports", "history")
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function assertHistorySummary(expectedDate) {
  const historyRoot = await selectHistoryRoot();
  if (!historyRoot) {
    return { historyRoot: "", historyFiles: [] };
  }

  const summaryPath = path.join(historyRoot, `Summary-${expectedDate}.md`);
  assert.equal(await exists(summaryPath), true, `${repoRelative(historyRoot)} must contain Summary-${expectedDate}.md`);

  const historyFiles = (await walkFiles(historyRoot, (absolute) => absolute.endsWith(".md")))
    .map(repoRelative)
    .filter((relative) => !relative.endsWith(`/Summary-${expectedDate}.md`))
    .sort();
  const summaryText = await fs.readFile(summaryPath, "utf8");
  assert.match(summaryText, /## Source Inventory \/ 来源清单/, `${repoRelative(summaryPath)} must include source inventory`);
  for (const relative of historyFiles) {
    assert.equal(
      summaryText.includes(relative),
      true,
      `${repoRelative(summaryPath)} must list merged history source ${relative}`
    );
  }

  return { historyRoot: repoRelative(historyRoot), historyFiles };
}

const args = parseArgs(process.argv.slice(2));
const expectedDate = args.expectedDate || todayIso(args.timezone);
assert.match(expectedDate, /^\d{4}-\d{2}-\d{2}$/, "expected date must be YYYY-MM-DD");

const docsRoot = path.join(repoRoot, "docs");
const markdownFiles = await walkFiles(docsRoot, (absolute) => absolute.endsWith(".md"));
const currentDocs = markdownFiles.map(repoRelative).filter((relative) => !isHistoryPath(relative)).sort();
for (const relative of currentDocs) {
  const absolute = path.join(repoRoot, relative);
  const text = await fs.readFile(absolute, "utf8");
  assertDocumentMetadata(relative, text, expectedDate);
}

const historySummary = await assertHistorySummary(expectedDate);

console.log(
  `[verify-doc-governance] ok: ${currentDocs.length} current docs checked for ${expectedDate}; ` +
    `${historySummary.historyFiles.length} history docs listed in ${historySummary.historyRoot || "no history root"}`
);
