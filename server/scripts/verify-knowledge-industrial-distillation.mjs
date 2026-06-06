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
  "component-pipeline-graph-json",
  "haystack-llamaindex-inspired-component-pipeline-graph.v1",
  "external-kd-configurable-component-registry.v1",
  "visio-opc-shape-parser.v1",
  "directory-file-ref-recursive-routing.v1",
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
assert.equal(benchmark.referenceAudit.strategy, "manifest-pinned-local-source-evidence.v1");
assert.equal(benchmark.referenceAudit.summary.expectedCount, benchmark.referenceManifest.frameworkCount);
assert.equal(benchmark.referenceAudit.frameworks.length, benchmark.referenceAudit.summary.expectedCount);
assert.equal(benchmark.absorptionMatrix.length >= 8, true);
const industrialCoverageCount = benchmark.absorptionMatrix.filter((item) => (
  Array.isArray(item.serviceEvidence) &&
  item.serviceEvidence.length > 0 &&
  item.serviceEvidence.every((entry) => entry.present)
)).length;
assert.equal(industrialCoverageCount, 8, "knowledge-industrial-distillation must cover 8 industrial capability tracks");
assert.equal(benchmark.absorptionMatrix.some((item) => item.capability === "DocumentParsing" && item.references.includes("docling")), true);
assert.equal(benchmark.absorptionMatrix.some((item) => item.capability === "RealModelDistillation" && item.servicePatterns.includes("required-agent-gateway-real-model-call.v1")), true);
assert.equal(benchmark.checks.referenceFrameworksPresent, true);
if (benchmark.referenceAudit.summary.presentCount > 0) {
  assert.equal(benchmark.referenceAudit.summary.gitCheckoutCount, benchmark.referenceAudit.summary.presentCount);
  assert.equal(benchmark.referenceAudit.summary.commitMatchCount, benchmark.referenceAudit.summary.presentCount);
  assert.equal(benchmark.referenceAudit.summary.sourceEvidencePassCount, benchmark.referenceAudit.summary.presentCount);
  assert.equal(benchmark.referenceAudit.frameworks.every((framework) => (
    !framework.exists || (
      framework.gitPresent &&
      framework.commitMatches &&
      framework.sourceEvidencePassed &&
      framework.sourceEvidence.length > 0
    )
  )), true);
  assert.equal(benchmark.checks.referenceCheckoutsPinned, true);
  assert.equal(benchmark.checks.referenceSourceEvidence, true);
  assert.equal(benchmark.checks.referenceAbsorptionMatrix, true);
}
assert.equal(benchmark.checks.routeWindowClassification, true);
assert.equal(benchmark.checks.graphConvergence, true);
assert.equal(benchmark.checks.humanAgentSeparation, true);
assert.equal(benchmark.checks.professionalOfficeAdaptation, true);
assert.equal(benchmark.checks.officeVisioAdaptation, true);
assert.equal(benchmark.checks.mountedProjectDirectoryExpansion, true);
assert.equal(benchmark.checks.realModelDistillation, true);

console.log("external knowledge distillation industrial benchmark verification passed");
