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

const requiredDocs = [
  "docs/README.md",
  "docs/Manifest.md",
  "docs/TERM.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/protocols/PROTOCOLS.md",
  "docs/state-machine/STATE-MACHINES.md",
  "docs/runbook/DEVELOPMENT-RUNBOOK.md",
  "docs/AGENT.md",
  "docs/COMPATIBILITY.md",
  "docs/DESIGN.md",
  "docs/IMPLEMENTATION-GAP.md",
  "docs/USAGES.md",
  "docs/VERSION.md"
];

const requiredFunctionalityDocs = [
  "docs/functionality/AGENT-COLLABORATION.md",
  "docs/functionality/CLIENT-DESKTOP.md",
  "docs/functionality/EXTERNAL-SERVICES.md",
  "docs/functionality/INGESTION-JOBS.md",
  "docs/functionality/KNOWLEDGE.md",
  "docs/functionality/OPERATIONS-OBSERVABILITY.md",
  "docs/functionality/SECURITY-AUTHORIZATION.md",
  "docs/functionality/SERVER-RUNTIME.md",
  "docs/functionality/TOOL-MANAGEMENT.md",
  "docs/functionality/WORKSPACE-ASSETS.md"
];

const forbiddenCurrentDocPaths = [
  "docs/Architecture.md",
  "docs/CLIENT_ARCHITECTURE.md",
  "docs/PROTOCOLS.md",
  "docs/SERVER.md",
  "docs/USAGE.md",
  "docs/VERSIONING.md",
  "docs/WORK-QUEUE-DESIGN.md",
  "docs/WORKSPACE-ASSET-GOVERNANCE.md",
  "docs/KNOWLEDGE-GOVERNANCE.md",
  "docs/PRODUCTION-CAPABILITY-GAP.md",
  "docs/IMPLEMENTATION-DECISION-REGISTER.md"
];

const forbiddenProcessDirs = [
  "docs/history",
  "docs/reports",
  "docs/scenarios",
  "docs/boundary",
  "docs/security",
  "docs/testing"
];

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

function stripMarkdownCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, " ");
}

function normalizeTermCandidate(rawValue) {
  return String(rawValue || "")
    .trim()
    .replace(/^[`'"([{<]+|[`'"\])}>.,;:]+$/g, "")
    .replace(/[([]$/g, "")
    .replace(/\.\.\.$/g, "");
}

function isTermCandidate(rawValue) {
  const value = normalizeTermCandidate(rawValue);
  if (!value || value.length < 2) return "";
  if (/^\d/.test(value)) return "";
  if (/[()]/.test(value)) return "";
  if (/[\\/]/.test(value)) return "";
  if (/\.(?:md|json|mjs|ts|vue|dart|rs|yaml|yml|svg|html|sqlite|app)$/i.test(value)) return "";
  if (/^[A-Z]{1,4}-\d{2}$/u.test(value)) return "";
  if (/^[A-Z0-9_-]+$/.test(value) && value.includes("-")) return "";
  if (/^(?:npm|run|node|bash|git|docker|cargo|flutter|printf|curl)$/u.test(value)) return "";
  if (/^(?:server|client|mcp|auth|dev|repo|pact):/u.test(value)) return "";
  if (/^[a-z]+(?:-[a-z0-9]+)+$/u.test(value)) return "";
  if (/^[a-z0-9_.:-]+$/.test(value) && !value.includes(".") && !value.includes(":")) return "";
  if (/^[a-z]+\.[a-zA-Z]/.test(value)) return value;
  if (/^[a-z]+:[a-zA-Z]/.test(value)) return value;
  const highSignal = /[A-Z]{2,}/.test(value) || /[a-z][A-Z]/.test(value) || /[A-Z][a-z]+[A-Z]/.test(value);
  return highSignal ? value : "";
}

function parseRegisteredTerms(termDocText) {
  const terms = new Set();
  for (const match of termDocText.matchAll(/^\s*-\s+`([^`]+)`/gm)) {
    const term = normalizeTermCandidate(match[1]);
    if (term) {
      terms.add(term);
    }
  }
  return terms;
}

function extractTermCandidates(relativePath, text) {
  if (relativePath === "docs/TERM.md") return [];
  const ignoredTerms = new Set([
    "AGENT",
    "Current",
    "Checked",
    "DD",
    "Docs",
    "HOME",
    "IDs",
    "KNOWLEDGE",
    "Last",
    "MM",
    "Metadata",
    "PATH",
    "Scope",
    "Status",
    "Staleness",
    "TODO",
    "YYYY"
  ]);
  const candidates = new Set();
  const textWithoutFences = stripMarkdownCodeFences(text);

  for (const match of textWithoutFences.matchAll(/`([^`]+)`/g)) {
    for (const rawPart of match[1].split(/[\s,]+/)) {
      const candidate = isTermCandidate(rawPart);
      if (candidate && !ignoredTerms.has(candidate)) {
        candidates.add(candidate);
      }
    }
  }

  for (const match of textWithoutFences.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*\b/g)) {
    const candidate = isTermCandidate(match[0]);
    if (candidate && !ignoredTerms.has(candidate)) {
      candidates.add(candidate);
    }
  }

  return [...candidates].sort();
}

function assertTermGovernance(currentDocTexts) {
  const termDoc = currentDocTexts.get("docs/TERM.md") || "";
  const registeredTerms = parseRegisteredTerms(termDoc);
  const requiredTerms = [
    "TERM",
    "智能体",
    "工作空间",
    "知识治理",
    "权限",
    "审计",
    "外部服务",
    "兼容层",
    "状态机",
    "版本治理",
    "运行时",
    "服务端",
    "客户端",
    "控制台",
    "证据包",
    "能力包",
    "工具管理"
  ];
  for (const term of requiredTerms) {
    assert.equal(registeredTerms.has(term), true, `docs/TERM.md must register required term: ${term}`);
  }

  const missing = [];
  for (const [relative, text] of currentDocTexts.entries()) {
    for (const candidate of extractTermCandidates(relative, text)) {
      if (!registeredTerms.has(candidate)) {
        missing.push(`${relative}: ${candidate}`);
      }
    }
  }
  assert.deepEqual(missing, [], `docs/TERM.md must register every professional term candidate:\n${missing.join("\n")}`);
}

const args = parseArgs(process.argv.slice(2));
const expectedDate = args.expectedDate || todayIso(args.timezone);
assert.match(expectedDate, /^\d{4}-\d{2}-\d{2}$/, "expected date must be YYYY-MM-DD");

const docsRoot = path.join(repoRoot, "docs");
const markdownFiles = await walkFiles(docsRoot, (absolute) => absolute.endsWith(".md"));
const currentDocs = markdownFiles.map(repoRelative).sort();
const currentDocSet = new Set(currentDocs);

for (const relative of requiredDocs) {
  assert.equal(currentDocSet.has(relative), true, `${relative} must exist`);
}

const functionalityDocs = currentDocs.filter((relative) => relative.startsWith("docs/functionality/"));
assert.deepEqual(functionalityDocs, requiredFunctionalityDocs, "docs/functionality must contain exactly the maintained functionality module documents");

for (const relative of forbiddenCurrentDocPaths) {
  assert.equal(currentDocSet.has(relative), false, `${relative} must be merged into the new canonical docs and removed`);
}

for (const relative of forbiddenProcessDirs) {
  assert.equal(await exists(path.join(repoRoot, relative)), false, `${relative} is a historical/process docs directory and must not exist`);
}

const currentDocTexts = new Map();

for (const relative of currentDocs) {
  const absolute = path.join(repoRoot, relative);
  const text = await fs.readFile(absolute, "utf8");
  currentDocTexts.set(relative, text);
  assertDocumentMetadata(relative, text, expectedDate);
}

assertTermGovernance(currentDocTexts);

console.log(`[verify-doc-governance] ok: ${currentDocs.length} current docs checked for ${expectedDate}; no historical process docs present`);
