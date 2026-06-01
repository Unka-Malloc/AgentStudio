import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEATURE_MANIFEST,
  collectPackagePlan,
  filterOperationsForFeatures,
  resolveFeatureRuntime,
  validateFeatureManifest
} from "../platform/interactive/features/feature-manifest.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const STANDALONE_FEATURE_ID = "external-knowledge-distillation";
const LEGACY_FEATURE_ID = "knowledge-distillation";
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const externalServiceEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/server.mjs");

const REQUIRED_STANDALONE_DEPENDENCIES = Object.freeze([
  "core-platform",
  "security-permissions",
  "operation-dispatcher",
  "console-shell",
  "tool-management-core",
  "work-queue-core"
]);

const EXTERNAL_OPERATION_IDS = Object.freeze([
  "external.knowledge.distillation.service.health",
  "external.knowledge.distillation.service.capabilities",
  "external.knowledge.distillation.service.runtime_health",
  "external.knowledge.distillation.runs.list",
  "external.knowledge.distillation.runs.create",
  "external.knowledge.distillation.runs.get",
  "external.knowledge.distillation.runs.cancel",
  "external.knowledge.distillation.evidence.query",
  "external.knowledge.distillation.projects.evidence.query",
  "external.knowledge.distillation.artifacts.export"
]);

const INTERNAL_WORKFLOW_IDS = Object.freeze([
  "knowledge.agent_skill",
  "knowledge.skills",
  "knowledge.golden_rules",
  "knowledge.rule_authoring",
  "knowledge.gold_cases",
  "knowledge.summarization",
  "knowledge.training_sets",
  "knowledge.evaluation",
  "knowledge.model_roles",
  "knowledge.model_decision",
  "knowledge.evidence_gate.evaluate"
]);

const INTERNAL_OPERATION_PREFIXES = Object.freeze([
  "knowledge.distillation.",
  "knowledge.agent_skill.",
  "knowledge.skills.",
  "knowledge.golden_rules.",
  "knowledge.rule_authoring.",
  "knowledge.gold_cases.",
  "knowledge.summarization.",
  "knowledge.training_sets.",
  "knowledge.evaluation."
]);

const INTERNAL_OPERATION_IDS = Object.freeze([
  "knowledge.evidence_gate.evaluate",
  "knowledge.model_roles",
  "knowledge.model_decision"
]);

const FORBIDDEN_STANDALONE_FEATURES = Object.freeze([
  "knowledge-distillation",
  "knowledge-evolution",
  "knowledge-core",
  "agent-gateway",
  "agent-exploration",
  "document-parser",
  "analysis-runtime",
  "pdf-processor",
  "ocr",
  "multimodal-parser",
  "data-connectors",
  "gmail",
  "outlook",
  "google-drive",
  "onedrive",
  "slack",
  "teams",
  "macos-mail",
  "embedded-server"
]);

const REQUIRED_EXTERNAL_PACKAGE_PATHS = Object.freeze([
  "external-services/knowledge-distillation-service",
  "server/platform/specialized/knowledge/invocation/external-distillation-service"
]);

const REQUIRED_LEGACY_REMOVE_PATHS = Object.freeze([
  "server/platform/specialized/capabilities/tools/agent-evaluation-runtime",
  "server/platform/specialized/knowledge/retrieval/evidence-sufficiency-gate",
  "server/platform/specialized/knowledge/invocation/golden-rule-runtime",
  "server/platform/specialized/knowledge/invocation/knowledge-agent-skill-runtime",
  "server/platform/specialized/knowledge/invocation/knowledge-rule-authoring-runtime",
  "server/platform/specialized/knowledge/invocation/knowledge-skill-runtime",
  "server/platform/specialized/knowledge/invocation/knowledge-summarization-runtime"
]);

function sourceSliceBetweenFunctions(source = "", functionName = "", nextFunctionName = "") {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(`\nfunction ${nextFunctionName}`, start + 1);
  assert.notEqual(start, -1, `${functionName} must exist in the external knowledge distillation service`);
  assert.notEqual(end, -1, `${functionName} must be followed by ${nextFunctionName}`);
  return source.slice(start, end);
}

const featureMap = new Map(FEATURE_MANIFEST.features.map((feature) => [feature.featureId, feature]));
const standaloneFeature = featureMap.get(STANDALONE_FEATURE_ID);
const legacyFeature = featureMap.get(LEGACY_FEATURE_ID);

assert.ok(standaloneFeature, `${STANDALONE_FEATURE_ID} feature must exist`);
assert.ok(legacyFeature, `${LEGACY_FEATURE_ID} feature must remain as a migration marker`);
assert.deepEqual(
  standaloneFeature.dependsOn,
  REQUIRED_STANDALONE_DEPENDENCIES,
  `${STANDALONE_FEATURE_ID} must declare its minimal platform dependencies explicitly`
);
assert.equal(
  standaloneFeature.lifecycle?.deploymentBoundary,
  "standalone-external-service",
  `${STANDALONE_FEATURE_ID} must be marked as a standalone external service boundary`
);
assert.equal(
  legacyFeature.lifecycle?.status,
  "must-migrate",
  `${LEGACY_FEATURE_ID} must be marked as must-migrate`
);
assert.equal(
  legacyFeature.lifecycle?.replacementFeature,
  STANDALONE_FEATURE_ID,
  `${LEGACY_FEATURE_ID} must point to the standalone external feature`
);

const migrationWorkflows = new Map((legacyFeature.lifecycle?.internalWorkflows || []).map((workflow) => [workflow.id, workflow]));
for (const workflowId of INTERNAL_WORKFLOW_IDS) {
  const workflow = migrationWorkflows.get(workflowId);
  assert.ok(workflow, `${workflowId} must be listed as an internal workflow migration item`);
  assert.equal(workflow.status, "must-migrate", `${workflowId} must be marked must-migrate`);
  assert.equal(workflow.target, "external.knowledge.distillation", `${workflowId} must migrate to external.knowledge.distillation`);
}

assert.throws(
  () => resolveFeatureRuntime({
    edition: "custom",
    profile: {
      features: [LEGACY_FEATURE_ID],
      disableFeatures: [STANDALONE_FEATURE_ID]
    }
  }),
  /Feature dependency cannot be disabled/,
  "Feature dependency resolution must prevent legacy workflows from hiding the external service dependency"
);

validateFeatureManifest({
  operations: SERVER_API_OPERATIONS,
  validateClientModules: false
});

const runtime = resolveFeatureRuntime({
  edition: "custom",
  profile: {
    name: "external-knowledge-distillation-standalone-gate",
    features: [STANDALONE_FEATURE_ID]
  }
});

const activeFeatures = new Set(runtime.activeFeatureIds);
assert.ok(activeFeatures.has(STANDALONE_FEATURE_ID), "standalone profile must activate external knowledge distillation");
for (const dependencyId of REQUIRED_STANDALONE_DEPENDENCIES) {
  assert.ok(activeFeatures.has(dependencyId), `standalone profile must include ${dependencyId}`);
}
for (const featureId of FORBIDDEN_STANDALONE_FEATURES) {
  assert.equal(activeFeatures.has(featureId), false, `standalone profile must not pull ${featureId}`);
}

const allowedFeatureIds = new Set([
  STANDALONE_FEATURE_ID,
  ...FEATURE_MANIFEST.features.filter((feature) => feature.required).map((feature) => feature.featureId),
  ...(FEATURE_MANIFEST.editions.custom?.includes || []),
  ...REQUIRED_STANDALONE_DEPENDENCIES
]);
for (const featureId of runtime.activeFeatureIds) {
  assert.ok(allowedFeatureIds.has(featureId), `standalone profile contains unexpected feature ${featureId}`);
}

const activeOperations = filterOperationsForFeatures(SERVER_API_OPERATIONS, runtime);
const activeOperationIds = new Set(activeOperations.map((operation) => operation.id));
for (const operationId of EXTERNAL_OPERATION_IDS) {
  assert.ok(activeOperationIds.has(operationId), `${operationId} must stay active in the standalone service profile`);
}
for (const operationId of activeOperationIds) {
  assert.equal(
    INTERNAL_OPERATION_PREFIXES.some((prefix) => operationId.startsWith(prefix)) || INTERNAL_OPERATION_IDS.includes(operationId),
    false,
    `${operationId} is an internal workflow and must not be active in the standalone service profile`
  );
}

const catalog = createToolCatalog({
  operations: activeOperations,
  activeFeatureIds: runtime.activeFeatureIds
});
const toolOperationIds = new Set(catalog.tools.map((tool) => tool.operationId).filter(Boolean));
for (const operationId of EXTERNAL_OPERATION_IDS) {
  assert.ok(toolOperationIds.has(operationId), `${operationId} must be exposed to agents as a managed external tool`);
}
for (const operationId of toolOperationIds) {
  assert.equal(
    INTERNAL_OPERATION_PREFIXES.some((prefix) => operationId.startsWith(prefix)) || INTERNAL_OPERATION_IDS.includes(operationId),
    false,
    `${operationId} must not be exposed to agents from the standalone service profile`
  );
}

const packagePlan = collectPackagePlan(runtime);
for (const includePath of REQUIRED_EXTERNAL_PACKAGE_PATHS) {
  assert.ok(packagePlan.includePaths.includes(includePath), `standalone package plan must include ${includePath}`);
}
for (const removePath of REQUIRED_LEGACY_REMOVE_PATHS) {
  assert.ok(packagePlan.removePaths.includes(removePath), `standalone package plan must strip legacy path ${removePath}`);
}

const externalServiceSource = await fs.readFile(externalServiceEntry, "utf8");
for (const functionName of [
  "runKnowledgeDistillationWorkflow",
  "runDistillationWorkflow",
  "initializeDistillationWorkflow",
  "normalizeDistillationInput",
  "filterDistillationInputByTime",
  "buildDistillationCorpusPlan",
  "buildDistillationRoutePlan",
  "buildDistillationDocumentSet",
  "buildDistillationClassification",
  "buildDistillationConvergence",
  "buildDistillationGrounding",
  "buildDistillationIncrementalPlan",
  "buildDistillationGraphEvidence",
  "composeDistillationWorkflowState",
  "evaluateDistillationWorkflow",
  "composeDistillationResult"
]) {
  assert.match(
    externalServiceSource,
    new RegExp(`function ${functionName}\\(`),
    `${functionName} must exist as an explicit external service workflow boundary`
  );
}
const unifiedWorkflowBody = sourceSliceBetweenFunctions(
  externalServiceSource,
  "runKnowledgeDistillationWorkflow",
  "runDistillationWorkflow"
);
assert.match(
  unifiedWorkflowBody,
  /const distillationWorkflow = runDistillationWorkflow\(input, runtimeStatus, priorRuns\);/,
  "runKnowledgeDistillationWorkflow must start with DistillationWorkflow"
);
assert.match(
  unifiedWorkflowBody,
  /const evaluation = evaluateDistillationWorkflow\(distillationWorkflow, runtimeStatus, referenceFrameworks\);/,
  "runKnowledgeDistillationWorkflow must evaluate after DistillationWorkflow"
);
assert.match(
  unifiedWorkflowBody,
  /return composeDistillationResult\(distillationWorkflow, evaluation, runtimeStatus\);/,
  "runKnowledgeDistillationWorkflow must finish with Result Composition"
);
for (const forbiddenInlineStep of [
  "normalizeDocuments(",
  "buildCorpusPlan(",
  "classifyDocuments(",
  "buildGroundingReport(",
  "buildMarkdown("
]) {
  assert.equal(
    unifiedWorkflowBody.includes(forbiddenInlineStep),
    false,
    `runKnowledgeDistillationWorkflow must not inline ${forbiddenInlineStep}; keep one workflow command per function call`
  );
}
const distillationWorkflowBody = sourceSliceBetweenFunctions(
  externalServiceSource,
  "runDistillationWorkflow",
  "initializeDistillationWorkflow"
);
for (const expectedLine of [
  /const workflowContext = initializeDistillationWorkflow\(input\);/,
  /const normalizedInput = normalizeDistillationInput\(workflowContext, runtimeStatus\);/,
  /const filteredInput = filterDistillationInputByTime\(normalizedInput\);/,
  /const corpusPlanState = buildDistillationCorpusPlan\(filteredInput\);/,
  /const routePlanState = buildDistillationRoutePlan\(corpusPlanState\);/,
  /const documentSet = buildDistillationDocumentSet\(routePlanState\);/,
  /const classificationState = buildDistillationClassification\(documentSet\);/,
  /const convergenceState = buildDistillationConvergence\(classificationState\);/,
  /const groundingState = buildDistillationGrounding\(convergenceState\);/,
  /const incrementalState = buildDistillationIncrementalPlan\(groundingState, priorRuns\);/,
  /const graphEvidenceState = buildDistillationGraphEvidence\(incrementalState\);/,
  /return composeDistillationWorkflowState\(graphEvidenceState\);/
]) {
  assert.match(
    distillationWorkflowBody,
    expectedLine,
    "runDistillationWorkflow must remain a step-by-step orchestration function"
  );
}
for (const forbiddenInlineStep of [
  "normalizeDocuments(",
  "normalizeTimeFilter(",
  "applyTimeFilterToDocuments(",
  "buildCorpusPlan(",
  "buildRoutePlan(",
  "classifyDocuments(",
  "buildProjectConvergence(",
  "buildGroundingReport(",
  "buildIncrementalPlan(",
  "buildGraphEvidencePack(",
  "buildFormatConversionPlan(",
  ".filter(",
  ".map("
]) {
  assert.equal(
    distillationWorkflowBody.includes(forbiddenInlineStep),
    false,
    `runDistillationWorkflow must not inline ${forbiddenInlineStep}; keep one command per workflow step`
  );
}
const createRunWrapperBody = sourceSliceBetweenFunctions(externalServiceSource, "createRun", "capabilities");
assert.match(
  createRunWrapperBody,
  /return runKnowledgeDistillationWorkflow\(input, runtimeStatus, priorRuns, referenceFrameworks\);/,
  "createRun must remain a compatibility wrapper around the unified workflow"
);

console.log("knowledge distillation standalone service feature gate passed");
