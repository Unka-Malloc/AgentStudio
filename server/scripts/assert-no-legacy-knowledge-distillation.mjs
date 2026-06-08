#!/usr/bin/env node
/**
 * Assert no legacy knowledge distillation implementation remains in the codebase.
 * Only external-services/knowledge-distillation-service is allowed as algorithm surface.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

// Patterns that must NOT appear in production code (runtime, registry, handlers)
const forbiddenPatterns = [
  "internalKnowledgeDistillationOperation",
  "INTERNAL_KNOWLEDGE_DISTILLATION_DEPRECATION",
  "INTERNAL_KNOWLEDGE_DISTILLATION_REMOVED",
  "internalKnowledgeDistillationRemovedPayload",
  "executeKnowledgeDistillationWorkflowOperation",
];

// Scan all server source files (not tests, not docs, not external-services)
function collectMjsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      results.push(...collectMjsFiles(fullPath));
    } else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

const serverFiles = collectMjsFiles(path.join(repoRoot, "server"));

let violations = 0;

for (const file of serverFiles) {
  // Skip external-services directory - that's the legitimate implementation
  if (file.includes("external-services")) continue;
  // Skip this script itself (it must name what it forbids)
  if (file.includes("assert-no-legacy-knowledge-distillation")) continue;
  // Skip tests
  if (file.includes("/tests/")) continue;

  const content = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenPatterns) {
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
}

// Verify external service is the sole distillation implementation
const externalServiceExists = fs.existsSync(
  path.join(repoRoot, "external-services/knowledge-distillation-service/server.mjs")
);
assert.ok(externalServiceExists, "external-services/knowledge-distillation-service must exist");

// Verify no legacy workbench files remain
const legacyWorkbenchPaths = [
  "server-web/components/KnowledgeDistillationWorkbench.vue",
  "server-web/components/knowledge-distillation/KnowledgeDistillationRunOverview.vue",
  "server-web/components/knowledge-distillation/KnowledgeDistillationStageCard.vue",
  "server-web/lib/knowledge-distillation-workbench-client.ts",
];

for (const legacyPath of legacyWorkbenchPaths) {
  const fullPath = path.join(repoRoot, legacyPath);
  const exists = fs.existsSync(fullPath);
  assert.ok(!exists, `Legacy workbench file must not exist: ${legacyPath}`);
}

if (violations > 0) {
  console.error(`\n${violations} legacy knowledge distillation violations found.`);
  process.exit(1);
} else {
  console.log("No legacy knowledge distillation patterns found in server runtime code.");
  console.log("External service at external-services/knowledge-distillation-service is the sole implementation.");
  console.log("anti-regression check PASSED.");
}
