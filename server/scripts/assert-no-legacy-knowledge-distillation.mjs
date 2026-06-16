#!/usr/bin/env node
/**
 * Assert no legacy knowledge distillation implementation remains in production code.
 * Only external-services/knowledge-distillation-service is allowed as algorithm surface.
 *
 * Allowed paths:
 *   - external-services/knowledge-distillation-service/** (sole algorithm surface)
 *   - server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs (external KD client, allows external.knowledge.distillation.*)
 *   - server/platform/common/version-control/version-registry.json (governed historical token registry)
 *   - tests/** (migration regression tests, no-legacy assertions)
 *   - server/scripts/verify-*.mjs active verification (may reference patterns for checking)
 *   - This script itself (must name what it forbids)
 *
 * Disallowed paths (production runtime):
 *   - server/platform/** (except external-distillation-service)
 *   - server-web/lib/** (production client libraries)
 *   - package.json (active scripts)
 *   - docs/** (active docs)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

// ── FORBIDDEN PATTERNS ──────────────────────────────────────────────
// These must NOT appear in production runtime code
const forbiddenRuntimePatterns = [
  // Legacy handler names
  "handleKnowledgeDistillationRuns",
  "handleKnowledgeDistillationRunGet",
  "handleKnowledgeDistillationWorkbench",
  "handleKnowledgeDistillationExport",
  // Legacy function names
  "exportDistillation",
  "distillationDocuments",
  // Legacy internal identifiers
  "internalKnowledgeDistillationOperation",
  "INTERNAL_KNOWLEDGE_DISTILLATION_DEPRECATION",
  "INTERNAL_KNOWLEDGE_DISTILLATION_REMOVED",
  "internalKnowledgeDistillationRemovedPayload",
  "executeKnowledgeDistillationWorkflowOperation",
  // Legacy protocol
  "v0.0.1:knowledge:distillation-1",
];

// Quoted internal operation IDs (not external.knowledge.distillation.*)
const forbiddenQuotedOperationIds = [
  '"knowledge.distillation.export"',
  "'knowledge.distillation.export'",
  '"knowledge.distillation.runs.create"',
  "'knowledge.distillation.runs.create'",
  '"knowledge.distillation.runs.get"',
  "'knowledge.distillation.runs.get'",
  '"knowledge.distillation.workbench.',
  "'knowledge.distillation.workbench.",
];

// ── ALLOWED FILES ───────────────────────────────────────────────────
const allowedPrefixes = [
  "external-services",
  "server/platform/specialized/knowledge/invocation/external-distillation-service",
  "server/platform/common/version-control/version-registry.json",
  "tests/",
  "server/scripts/assert-no-legacy-knowledge-distillation",
];

// Specific verification scripts that reference legacy operation IDs for
// checking they no longer exist (rejectedInternal, deprecatedInternal lists).
// These are migration regression tests, not production implementations.
const allowedVerifyScripts = new Set([
  "server/scripts/verify-external-service-api-registration.mjs",
  "server/scripts/verify-agent-knowledge-tools.mjs",
  "server/scripts/verify-protocol-operation-registration.mjs",
  "server/scripts/verify-knowledge-architecture-governance.mjs",
  "server/scripts/verify-knowledge-golden-distillation.mjs",
  "server/scripts/verify-knowledge-distillation-optimization.mjs",
]);

function isAllowed(filePath) {
  const relative = path.relative(repoRoot, filePath);
  for (const prefix of allowedPrefixes) {
    if (relative.startsWith(prefix)) return true;
  }
  if (allowedVerifyScripts.has(relative)) return true;
  return false;
}

// ── SCAN: production JS/MJS files ───────────────────────────────────
function collectJsFiles(dir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      results.push(...collectJsFiles(fullPath));
    } else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js") || entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── SCAN: JSON config files ─────────────────────────────────────────
function collectJsonFiles(dir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (fullPath.includes("/tests/")) continue;
      results.push(...collectJsonFiles(fullPath));
    } else if (entry.name.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results;
}

let violations = 0;

// 1. Check JS/MJS/TS files for forbidden patterns
const jsFiles = collectJsFiles(path.join(repoRoot, "server")).concat(
  collectJsFiles(path.join(repoRoot, "server-web"))
);
for (const file of jsFiles) {
  if (isAllowed(file)) continue;

  const content = fs.readFileSync(file, "utf8");

  for (const pattern of forbiddenRuntimePatterns) {
    if (content.includes(pattern)) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(pattern)) {
          console.error(`VIOLATION: ${file}:${i + 1}: ${pattern}`);
          violations++;
        }
      }
    }
  }
  for (const pattern of forbiddenQuotedOperationIds) {
    if (content.includes(pattern) && !content.includes("external." + pattern.replace(/^["']/, "").replace(/["']$/, ""))) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(pattern) && !lines[i].includes("external.") && !lines[i].includes("externalKnowledge")) {
          console.error(`VIOLATION: ${file}:${i + 1}: ${pattern} (internal operation reference)`);
          violations++;
        }
      }
    }
  }
}

// 2. Check JSON config files for legacy operation IDs
const jsonFiles = collectJsonFiles(path.join(repoRoot, "server")).concat(
  collectJsonFiles(path.join(repoRoot, "server-web"))
);
for (const file of jsonFiles) {
  if (isAllowed(file)) continue;
  if (file.includes("node_modules")) continue;

  const content = fs.readFileSync(file, "utf8");
  // Check for quoted legacy operation IDs in JSON
  for (const badId of [
    '"knowledge.distillation.export"',
    '"knowledge.distillation.runs.create"',
    '"knowledge.distillation.runs.get"',
    '"knowledge.distillation.workbench.',
    '"v0.0.1:knowledge:distillation-1"',
  ]) {
    if (content.includes(badId)) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(badId)) {
          console.error(`VIOLATION: ${file}:${i + 1}: ${badId} (legacy operation in config)`);
          violations++;
        }
      }
    }
  }
}

// 3. Check package.json for legacy scripts
const packageJsonPath = path.join(repoRoot, "package.json");
if (fs.existsSync(packageJsonPath)) {
  const pkgContent = fs.readFileSync(packageJsonPath, "utf8");
  const lines = pkgContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("knowledge-distillation-workbench")) {
      console.error(`VIOLATION: package.json:${i + 1}: knowledge-distillation-workbench script reference`);
      violations++;
    }
  }
}

// 4. Verify external service is the sole distillation implementation
const externalServiceExists = fs.existsSync(
  path.join(repoRoot, "external-services/knowledge-distillation-service/server.mjs")
);
assert.ok(externalServiceExists, "external-services/knowledge-distillation-service must exist");

// 5. Verify no legacy workbench files remain
const legacyWorkbenchPaths = [
  "server-web/components/KnowledgeDistillationWorkbench.vue",
  "server-web/components/knowledge-distillation/KnowledgeDistillationRunOverview.vue",
  "server-web/components/knowledge-distillation/KnowledgeDistillationStageCard.vue",
  "server-web/lib/knowledge-distillation-workbench-client.ts",
];
for (const legacyPath of legacyWorkbenchPaths) {
  const fullPath = path.join(repoRoot, legacyPath);
  const exists = fs.existsSync(fullPath);
  if (exists) {
    console.error(`VIOLATION: ${legacyPath} legacy workbench file still exists`);
    violations++;
  }
}

if (violations > 0) {
  console.error(`\n${violations} legacy knowledge distillation violations found.`);
  process.exit(1);
} else {
  console.log("No legacy knowledge distillation patterns found in production code.");
  console.log("External service at external-services/knowledge-distillation-service is the sole implementation.");
  console.log("anti-regression check PASSED.");
}
