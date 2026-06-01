import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serviceRoot = path.join(repoRoot, "external-services/knowledge-distillation-service");
const referenceManifestPath = path.join(serviceRoot, "reference-frameworks.json");
const serviceServerPath = path.join(serviceRoot, "server.mjs");
const internalRuntimePath = path.join(repoRoot, "server/platform/specialized/knowledge/invocation/knowledge-distillation-runtime");
const internalWorkbenchPath = path.join(repoRoot, "server/platform/specialized/knowledge/invocation/knowledge-distillation-workbench");

async function hasFiles(filePath) {
  try {
    const entries = await fs.readdir(filePath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(filePath, entry.name);
      if (entry.isFile()) {
        return true;
      }
      if (entry.isDirectory() && await hasFiles(childPath)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

const manifest = await readJson(referenceManifestPath);
const serviceText = await fs.readFile(serviceServerPath, "utf8");
const frameworkIds = new Set((manifest.frameworks || []).map((framework) => String(framework.id || "")));

for (const id of ["ragflow", "mineru", "docling", "llama-index", "marker", "graphrag", "haystack", "unstructured"]) {
  assert.equal(frameworkIds.has(id), true, `external reference framework manifest must include ${id}`);
}

assert.equal(await hasFiles(internalRuntimePath), false, "internal knowledge-distillation-runtime directory must be removed");
assert.equal(await hasFiles(internalWorkbenchPath), false, "internal knowledge-distillation-workbench directory must be removed");

for (const requiredPattern of [
  "routePlan",
  "graphEvidence",
  "referenceGapReport",
  "hashing_embedding_window_community_classification_v3",
  "hierarchical-domain-topic-project-convergence.v3",
  "human-agent-response-profile-separation.v1",
  "professional-format-manifest-json",
  "office-document-professional-adaptation.v1",
  "format-conversion-plan-json",
  "PROJECT_EVIDENCE_QUERY_STRATEGY"
]) {
  assert.match(serviceText, new RegExp(requiredPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `external service must retain ${requiredPattern}`);
}

const outputPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kd-industrial-")), "benchmark.json");
const cli = spawnSync(process.execPath, [
  path.join(repoRoot, "server/scripts/knowledge-distillation-industrial-benchmark.mjs"),
  "--output",
  outputPath
], {
  cwd: repoRoot,
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr || cli.stdout);

const benchmark = await readJson(outputPath);
assert.equal(benchmark.protocolVersion, "pact.external-knowledge-distillation.industrial-benchmark.v1");
assert.equal(benchmark.service, "external.knowledge.distillation");
assert.equal(benchmark.referenceManifest.frameworkCount >= 8, true);
assert.equal(benchmark.checks.referenceFrameworksPresent, true);
assert.equal(benchmark.checks.routeWindowClassification, true);
assert.equal(benchmark.checks.graphConvergence, true);
assert.equal(benchmark.checks.humanAgentSeparation, true);
assert.equal(benchmark.checks.professionalOfficeAdaptation, true);

console.log("external knowledge distillation industrial benchmark verification passed");
