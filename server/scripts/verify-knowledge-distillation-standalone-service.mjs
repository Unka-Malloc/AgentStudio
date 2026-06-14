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
const formatRoutesConfigEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/format-routes.json");
const parserStrategiesConfigEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/parser-strategies.json");
const formatConversionProfilesConfigEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/format-conversion-profiles.json");
const modelDistillationProfilesConfigEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/model-distillation-profiles.json");

const REQUIRED_STANDALONE_DEPENDENCIES = Object.freeze([
  "core-platform",
  "security-permissions",
  "operation-dispatcher",
  "console-shell",
  "tool-management-core",
  "work-queue-core",
  "agent-gateway"
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
  "server/platform/specialized/knowledge/invocation/external-distillation-service",
  "server/platform/specialized/agent/agent-gateway",
  "server/protocols/agent-sync"
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
  const functionStartPattern = (name) => new RegExp(`(?:^|\\n)(?:async\\s+)?function ${name}\\(`, "m");
  const startMatch = functionStartPattern(functionName).exec(source);
  const start = startMatch ? startMatch.index + (startMatch[0].startsWith("\n") ? 1 : 0) : -1;
  const nextMatch = start === -1 ? null : functionStartPattern(nextFunctionName).exec(source.slice(start + 1));
  const end = nextMatch ? start + 1 + nextMatch.index + (nextMatch[0].startsWith("\n") ? 1 : 0) : -1;
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
  standaloneFeature.lifecycle?.modelGatewayPolicy,
  "required-real-model-call",
  `${STANDALONE_FEATURE_ID} must carry the model gateway as a required distillation dependency`
);
assert.equal(
  standaloneFeature.lifecycle?.uploadPolicy,
  "reuse-platform-upload-sessions-and-checkpoints",
  `${STANDALONE_FEATURE_ID} must reuse platform upload sessions and checkpoints`
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

const packagePlan = collectPackagePlan(runtime, { surface: "server" });
assert.equal(packagePlan.surface, "server", "standalone knowledge distillation package plan must use the server-only surface");
assert.deepEqual(
  packagePlan.clientModules,
  [],
  "standalone knowledge distillation service packaging must not carry client modules"
);
assert.deepEqual(
  packagePlan.webPanels,
  [],
  "standalone knowledge distillation service packaging must not carry web panels"
);
assert.deepEqual(
  packagePlan.webNavItems,
  [],
  "standalone knowledge distillation service packaging must not carry web navigation"
);
for (const includePath of packagePlan.includePaths) {
  assert.equal(
    String(includePath).startsWith("client-gui"),
    false,
    "standalone knowledge distillation service packaging must not read client-gui paths"
  );
}
for (const includePath of REQUIRED_EXTERNAL_PACKAGE_PATHS) {
  assert.ok(packagePlan.includePaths.includes(includePath), `standalone package plan must include ${includePath}`);
}
for (const removePath of REQUIRED_LEGACY_REMOVE_PATHS) {
  assert.ok(packagePlan.removePaths.includes(removePath), `standalone package plan must strip legacy path ${removePath}`);
}

const externalServiceSource = await fs.readFile(externalServiceEntry, "utf8");
const formatRoutesConfig = JSON.parse(await fs.readFile(formatRoutesConfigEntry, "utf8"));
const parserStrategiesConfig = JSON.parse(await fs.readFile(parserStrategiesConfigEntry, "utf8"));
const formatConversionProfilesConfig = JSON.parse(await fs.readFile(formatConversionProfilesConfigEntry, "utf8"));
const modelDistillationProfilesConfig = JSON.parse(await fs.readFile(modelDistillationProfilesConfigEntry, "utf8"));
assert.equal(
  formatRoutesConfig.protocolVersion,
  "v0.0.1:external-service:knowledge-distillation-format-routes-1",
  "external knowledge distillation must keep format routes in a versioned singleton config"
);
assert.equal(
  formatRoutesConfig.strategy,
  "singleton-format-route-registry.v1",
  "external knowledge distillation must route formats through the singleton registry"
);
assert.equal(formatRoutesConfig.routes.length >= 24, true, "format route registry must cover all current route families");
assert.equal(
  new Set(formatRoutesConfig.routes.flatMap((route) => route.extensions || [])).size >= 141,
  true,
  "format route registry must preserve current extension coverage"
);
for (const [routeId, parser] of [
  ["pdf", "pdf.text.tika-safe"],
  ["word", "office.word.structured"],
  ["presentation", "office.presentation.slides"],
  ["spreadsheet", "table.sheet.structured"],
  ["markdown", "text.direct.markdown"],
  ["email", "email.headers-body-attachments"],
  ["archive", "archive.expand-route"],
  ["directory", "directory.file-ref.expand"]
]) {
  assert.equal(
    formatRoutesConfig.routes.some((route) => route.id === routeId && route.preferredParser === parser),
    true,
    `format route registry must map ${routeId} to ${parser}`
  );
}
assert.equal(
  externalServiceSource.includes("const FORMAT_ROUTES = Object.freeze(["),
  false,
  "format route definitions must not be hard-coded inline in server.mjs"
);
assert.equal(
  externalServiceSource.includes("const FORMAT_ROUTES = loadFormatRoutes();"),
  true,
  "server.mjs must load format routes from the singleton config"
);
assert.equal(
  parserStrategiesConfig.protocolVersion,
  "v0.0.1:external-service:knowledge-distillation-parser-strategies-1",
  "external knowledge distillation must keep parser strategies in a versioned singleton config"
);
assert.equal(
  parserStrategiesConfig.strategy,
  "singleton-parser-strategy-registry.v1",
  "external knowledge distillation must route parser strategy metadata through the singleton registry"
);
assert.equal(parserStrategiesConfig.strategies.length >= 145, true, "parser strategy registry must cover built-in and route-bound strategies");
assert.equal(
  parserStrategiesConfig.strategies.filter((strategy) => strategy.capabilitySurface === "built-in-parser").length >= 103,
  true,
  "parser strategy registry must preserve current built-in parser coverage"
);
const parserStrategyIds = new Set(parserStrategiesConfig.strategies.map((strategy) => strategy.id));
for (const route of formatRoutesConfig.routes) {
  for (const parserId of [
    route.preferredParser,
    ...(route.fallbackParsers || []),
    ...(route.parserChain || [])
  ].filter(Boolean)) {
    assert.ok(
      parserStrategyIds.has(parserId),
      `parser strategy registry must define ${parserId} referenced by ${route.id}`
    );
  }
}
for (const parserId of [
  "pdf.text.tika-safe",
  "pdf.text.file-ref-elements",
  "office.word.structured",
  "office.presentation.slides",
  "table.sheet.structured",
  "text.direct.markdown",
  "email.headers-body-attachments",
  "archive.expand-route",
  "directory.file-ref.expand",
  "structured-zip.large-entry-stream",
  "payload.stream-text"
]) {
  assert.ok(parserStrategyIds.has(parserId), `parser strategy registry must include ${parserId}`);
}
assert.equal(
  externalServiceSource.includes("const PARSER_STRATEGIES = loadParserStrategies(FORMAT_ROUTES);"),
  true,
  "server.mjs must load parser strategies from the singleton config after format routes"
);
assert.equal(
  externalServiceSource.includes("function parsePdfTextFileRefElements("),
  true,
  "large PDF filePath parsing must convert pdftotext output into page-aware structure elements"
);
assert.equal(
  externalServiceSource.includes("pdf-text-file-ref-layout.v1"),
  true,
  "large PDF filePath parsing must preserve page and layout references for element-aware windowing"
);
assert.equal(
  externalServiceSource.includes("xml-active-element-carry-preserving-stream-scanner.v1"),
  true,
  "structured XML streaming must preserve active elements across chunk boundaries instead of trimming through them"
);
assert.equal(
  externalServiceSource.includes("function findNextXmlElementSpan("),
  true,
  "structured XML streaming must use a token-aware element span scanner for large Office/OpenDocument/EPUB XML entries"
);
assert.equal(
  externalServiceSource.includes("function parseDocxLargeEntryStreaming("),
  true,
  "large DOCX filePath parsing must keep a dedicated streaming structure parser instead of downgrading to plain text"
);
assert.equal(
  externalServiceSource.includes("wordprocessingml-stream-paragraph.v1"),
  true,
  "large DOCX streaming parser must preserve paragraph element references for element-aware windowing"
);
for (const strategy of [
  "wordprocessingml-stream-table.v1",
  "wordprocessingml-stream-content-control.v1",
  "wordprocessingml-stream-bookmark.v1",
  "wordprocessingml-stream-annotation.v1",
  "wordprocessingml-stream-revision.v1",
  "wordprocessingml-stream-hyperlink.v1"
]) {
  assert.equal(
    externalServiceSource.includes(strategy),
    true,
    `large DOCX streaming parser must preserve ${strategy} element references for element-aware windowing`
  );
}
assert.equal(
  externalServiceSource.includes("streaming-large-wordprocessingml-elements"),
  true,
  "large DOCX streaming parser must advertise structural extraction mode in parserTrace"
);
assert.equal(
  externalServiceSource.includes("function parsePptxLargeEntryStreaming("),
  true,
  "large PPTX filePath parsing must keep a dedicated streaming structure parser instead of downgrading to plain text"
);
assert.equal(
  externalServiceSource.includes("presentationml-stream-shape.v1"),
  true,
  "large PPTX streaming parser must preserve shape element references for element-aware windowing"
);
assert.equal(
  externalServiceSource.includes("presentationml-speaker-note-stream.v1"),
  true,
  "large PPTX streaming parser must preserve oversized speaker-note element references"
);
assert.equal(
  externalServiceSource.includes("presentationml-comment-stream.v1"),
  true,
  "large PPTX streaming parser must preserve oversized comment element references"
);
assert.equal(
  externalServiceSource.includes("streaming-large-presentationml-elements"),
  true,
  "large PPTX streaming parser must advertise structural extraction mode in parserTrace"
);
assert.equal(
  externalServiceSource.includes("function parseXlsxLargeEntryStreaming("),
  true,
  "large XLSX filePath parsing must keep a dedicated streaming structure parser instead of downgrading to plain text"
);
assert.equal(
  externalServiceSource.includes("spreadsheetml-stream-row.v1"),
  true,
  "large XLSX streaming parser must preserve row element references for element-aware windowing"
);
assert.equal(
  externalServiceSource.includes("spreadsheetml-shared-string-disk-index.v1"),
  true,
  "large XLSX streaming parser must use a disk-backed shared string lookup instead of an in-memory sharedStrings array"
);
assert.equal(
  externalServiceSource.includes("streaming-large-spreadsheetml-elements"),
  true,
  "large XLSX streaming parser must advertise structural extraction mode in parserTrace"
);
assert.equal(
  externalServiceSource.includes("function parseOpenDocumentLargeEntryStreaming("),
  true,
  "large OpenDocument filePath parsing must keep a dedicated streaming structure parser instead of downgrading to plain text"
);
assert.equal(
  externalServiceSource.includes("opendocument-stream-paragraph.v1"),
  true,
  "large OpenDocument streaming parser must preserve paragraph element references for element-aware windowing"
);
assert.equal(
  externalServiceSource.includes("streaming-large-opendocument-elements"),
  true,
  "large OpenDocument streaming parser must advertise structural extraction mode in parserTrace"
);
assert.equal(
  externalServiceSource.includes("function parseEpubLargeEntryStreaming("),
  true,
  "large EPUB filePath parsing must keep a dedicated streaming structure parser instead of downgrading to plain text"
);
assert.equal(
  externalServiceSource.includes("epub-stream-paragraph.v1"),
  true,
  "large EPUB streaming parser must preserve paragraph element references for element-aware windowing"
);
assert.equal(
  externalServiceSource.includes("streaming-large-epub-elements"),
  true,
  "large EPUB streaming parser must advertise structural extraction mode in parserTrace"
);
assert.equal(
  externalServiceSource.includes("function parseVisioLargeEntryStreaming("),
  true,
  "large Visio filePath parsing must keep a dedicated streaming structure parser instead of downgrading to plain text"
);
assert.equal(
  externalServiceSource.includes("streaming-large-visio-elements"),
  true,
  "large Visio streaming parser must advertise structural extraction mode in parserTrace"
);
assert.equal(
  externalServiceSource.includes("visio-shape-geometry.v1"),
  true,
  "large Visio streaming parser must preserve shape geometry references for element-aware windowing"
);
assert.equal(
  externalServiceSource.includes("visio-connector-ref.v1"),
  true,
  "large Visio streaming parser must preserve connector references for element-aware windowing"
);
assert.equal(
  formatConversionProfilesConfig.protocolVersion,
  "v0.0.1:external-service:knowledge-distillation-format-conversion-profiles-1",
  "external knowledge distillation must keep format conversion profiles in a versioned singleton config"
);
assert.equal(
  formatConversionProfilesConfig.strategy,
  "singleton-format-conversion-profile-registry.v1",
  "external knowledge distillation must load format conversion profiles through the singleton registry"
);
assert.deepEqual(
  formatConversionProfilesConfig.profileOrder,
  ["pdf", "word", "presentation", "visio", "spreadsheet", "markdown", "open-document"],
  "format conversion profiles must preserve professional document priority order"
);
const routeIds = new Set(formatRoutesConfig.routes.map((route) => route.id));
for (const profile of formatConversionProfilesConfig.profiles) {
  assert.ok(routeIds.has(profile.routeId), `format conversion profile ${profile.routeId} must bind to a known format route`);
  for (const parserStage of profile.parserStages || []) {
    assert.ok(parserStrategyIds.has(parserStage), `format conversion profile ${profile.routeId} must use registered parser stage ${parserStage}`);
  }
  assert.equal(
    (profile.conversionAdapters || []).some((adapter) => adapter.targetFormat === "docx"),
    true,
    `format conversion profile ${profile.routeId} must keep a DOCX conversion adapter`
  );
  assert.equal(
    (profile.conversionAdapters || []).some((adapter) => adapter.targetFormat === "agent-json"),
    true,
    `format conversion profile ${profile.routeId} must keep an agent JSON conversion adapter`
  );
}
assert.equal(
  externalServiceSource.includes("const FORMAT_CONVERSION_PROFILES = loadFormatConversionProfiles(FORMAT_ROUTES, PARSER_STRATEGIES);"),
  true,
  "server.mjs must load format conversion profiles from the singleton config after parser strategies"
);
assert.equal(
  modelDistillationProfilesConfig.protocolVersion,
  "v0.0.1:external-service:knowledge-distillation-model-distillation-profiles-1",
  "external knowledge distillation must keep model distillation profiles in a versioned singleton config"
);
assert.equal(
  modelDistillationProfilesConfig.strategy,
  "singleton-model-distillation-profile-registry.v1",
  "external knowledge distillation must load model distillation profiles through the singleton registry"
);
const defaultModelProfile = modelDistillationProfilesConfig.profiles.find((profile) => (
  profile.id === modelDistillationProfilesConfig.defaultProfileId
));
assert.ok(defaultModelProfile, "model distillation default profile must exist");
assert.equal(defaultModelProfile.moduleBoundary, "v0.0.1:external-service:knowledge-distillation-model-distillation-module-1");
assert.equal(defaultModelProfile.gatewayStrategy, "required-agent-gateway-real-model-call.v1");
assert.equal(defaultModelProfile.requiredRealModelCall, true);
assert.equal(defaultModelProfile.noBuiltinFallback, true);
assert.equal(defaultModelProfile.dependency, "agent-gateway");
assert.equal(defaultModelProfile.taskType, "knowledge_distillation");
assert.equal(defaultModelProfile.requestFields.includes("modelAlias"), true);
assert.equal(defaultModelProfile.requestFields.includes("question"), true);
assert.equal(defaultModelProfile.systemPromptLines.length >= 3, true);
assert.equal(defaultModelProfile.parameters.responseProfile, "machine-readable");
assert.equal(defaultModelProfile.parameters.maxOutputTokens >= 1000, true);
assert.equal(defaultModelProfile.requiredOutput.machineReadableContract, "v0.0.1:external-service:knowledge-distillation-model-output-1");
assert.equal(defaultModelProfile.outputRepairPolicy.enabled, true);
assert.equal(defaultModelProfile.outputRepairPolicy.strategy, "model-distillation-contract-repair-retry.v1");
assert.equal(defaultModelProfile.outputRepairPolicy.maxAttempts >= 1, true);
assert.equal(defaultModelProfile.transportPolicy.maxAttempts, 2);
assert.equal(defaultModelProfile.transportPolicy.retryOn.includes("ECONNRESET"), true);
assert.equal(defaultModelProfile.classificationDistillation.enabled, true);
assert.equal(defaultModelProfile.classificationDistillation.strategy, "profile-guided-group-distillation-map.v1");
assert.equal(defaultModelProfile.classificationDistillation.includeGarbageGroups, true);
assert.equal(defaultModelProfile.classificationDistillation.groupGatewayCalls.enabled, true);
assert.equal(defaultModelProfile.classificationDistillation.groupGatewayCalls.strategy, "classification-group-real-model-call.v1");
assert.equal(defaultModelProfile.classificationDistillation.groupGatewayCalls.maxGroupCalls >= 8, true);
assert.equal(defaultModelProfile.classificationDistillation.groupGatewayCalls.includeGarbageGroups, false);
assert.equal(defaultModelProfile.requiredOutput.constraints.length >= 3, true);
assert.equal(
  externalServiceSource.includes("const MODEL_DISTILLATION_PROFILES = loadModelDistillationProfiles();"),
  true,
  "server.mjs must load model distillation profiles from the singleton config"
);
assert.equal(
  externalServiceSource.includes("runQueue: {"),
  true,
  "standalone service must advertise async run queue capabilities for large document workflows"
);
assert.equal(
  externalServiceSource.includes("function scheduleQueuedRun("),
  true,
  "standalone service must schedule queued distillation runs outside the request wait path"
);
assert.equal(
  externalServiceSource.includes("Prefer: respond-async"),
  true,
  "standalone service must support the standard respond-async request signal"
);
assert.equal(
  externalServiceSource.includes("function queuedRunDecision("),
  true,
  "standalone service must centralize explicit and automatic queue decisions"
);
assert.equal(
  externalServiceSource.includes("function isExplicitSyncRunRequest("),
  true,
  "standalone service must preserve an explicit sync override for compatibility callers"
);
assert.equal(
  externalServiceSource.includes("large-input-auto-queue.v1"),
  true,
  "standalone service must auto-queue large file-ref, manifest, and request-body workflows"
);
for (const functionName of [
  "runKnowledgeDistillationWorkflow",
  "runDistillationWorkflow",
  "runDistillationAlgorithmWorkflow",
  "runDocumentParsingModule",
  "bindDocumentParsingToAlgorithmInput",
  "runModelDistillationModule",
  "callModelDistillationGateway",
  "callModelGatewayWithPrompt",
  "callClassificationGroupModelGatewayCalls",
  "buildGroupModelDistillationPrompt",
  "runFormatConversionModule",
  "initializeDistillationWorkflow",
  "normalizeDistillationWorkflowScope",
  "prepareDistillationAlgorithmInput",
  "filterDistillationInputByTime",
  "selectDistillationWorkflowScope",
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
  /const distillationWorkflow = await runDistillationWorkflow\(input, runtimeStatus, priorRuns\);/,
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
  "runDistillationAlgorithmWorkflow"
);
for (const expectedLine of [
  /const workflowContext = initializeDistillationWorkflow\(input\);/,
  /const algorithmInput = prepareDistillationAlgorithmInput\(workflowContext, runtimeStatus\);/,
  /const algorithmWorkflow = runDistillationAlgorithmWorkflow\(algorithmInput, priorRuns\);/,
  /return runModelDistillationModule\(algorithmWorkflow, runtimeStatus\);/
]) {
  assert.match(
    distillationWorkflowBody,
    expectedLine,
    "runDistillationWorkflow must remain a thin parser-adapter-to-algorithm boundary"
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
    `runDistillationWorkflow must not inline ${forbiddenInlineStep}; keep one command per workflow boundary`
  );
}
const algorithmWorkflowBody = sourceSliceBetweenFunctions(
  externalServiceSource,
  "runDistillationAlgorithmWorkflow",
  "normalizeDistillationWorkflowScope"
);
for (const expectedLine of [
  /const filteredInput = filterDistillationInputByTime\(algorithmInput\);/,
  /const scopedInput = selectDistillationWorkflowScope\(filteredInput\);/,
  /const corpusPlanState = buildDistillationCorpusPlan\(scopedInput\);/,
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
    algorithmWorkflowBody,
    expectedLine,
    "runDistillationAlgorithmWorkflow must remain a step-by-step algorithm orchestration function"
  );
}
for (const forbiddenInlineStep of [
  "normalizeDocuments(",
  "loadDocumentPayload(",
  "loadDocumentManifest(",
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
  "rawDocumentsManifestPath",
  "contentBase64",
  "filePathOverride"
]) {
  assert.equal(
    algorithmWorkflowBody.includes(forbiddenInlineStep),
    false,
    `runDistillationAlgorithmWorkflow must not inline ${forbiddenInlineStep}; keep parser payload handling outside the algorithm core`
  );
}
const parsingModuleBody = sourceSliceBetweenFunctions(
  externalServiceSource,
  "runDocumentParsingModule",
  "bindDocumentParsingToAlgorithmInput"
);
for (const expectedLine of [
  /const normalizedInput = normalizeDocuments\(input, runtimeStatus\);/,
  /assertDistillationAlgorithmInputContract\(normalizedInput\.documents\);/
]) {
  assert.match(
    parsingModuleBody,
    expectedLine,
    "DocumentParsing must own normalization and contract stripping before the algorithm receives input"
  );
}
const prepareAlgorithmInputBody = sourceSliceBetweenFunctions(
  externalServiceSource,
  "prepareDistillationAlgorithmInput",
  "filterDistillationInputByTime"
);
assert.match(
  prepareAlgorithmInputBody,
  /const documentParsing = runDocumentParsingModule\(workflowContext\.input, runtimeStatus\);/,
  "prepareDistillationAlgorithmInput must call the DocumentParsing module boundary"
);
assert.match(
  prepareAlgorithmInputBody,
  /return bindDocumentParsingToAlgorithmInput\(workflowContext, documentParsing\);/,
  "prepareDistillationAlgorithmInput must bind parsed documents to the algorithm contract without parsing inline"
);
const modelModuleBody = sourceSliceBetweenFunctions(
  externalServiceSource,
  "normalizeModelGatewayEndpoint",
  "runKnowledgeDistillationWorkflow"
);
for (const expectedText of [
  "resolveModelDistillationProfile",
  "profile.gatewayStrategy",
  "profile.systemPromptLines",
  "profile.parameters",
  "MODEL_DISTILLATION_OUTPUT_VALIDATION_STRATEGY",
  "MODEL_DISTILLATION_OUTPUT_CONTRACT",
  "MODEL_DISTILLATION_OUTPUT_REPAIR_STRATEGY",
  "modelDistillationOutputContractSpec",
  "parseModelDistillationOutputPayload",
  "validateModelDistillationOutput",
  "callValidatedModelGatewayWithPrompt",
  "buildModelOutputRepairPrompt",
  "MODEL_GATEWAY_INVALID_MACHINE_READABLE_OUTPUT",
  "machineReadablePayload",
  "buildClassificationDistillationMap",
  "buildGroupModelDistillationPrompt",
  "callClassificationGroupModelGatewayCalls",
  "groupGatewayCalls",
  "MODEL_GATEWAY_REQUIRED",
  "MODEL_ALIAS_REQUIRED",
  "callModelDistillationGateway"
]) {
  assert.equal(
    modelModuleBody.includes(expectedText),
    true,
    `ModelDistillation must require a real model gateway path containing ${expectedText}`
  );
}
const formatConversionModuleBody = sourceSliceBetweenFunctions(
  externalServiceSource,
  "runFormatConversionModule",
  "jsonArtifactBuffer"
);
for (const expectedText of [
  "FORMAT_CONVERSION_MODULE_BOUNDARY",
  "buildFormatConversionPlan",
  "attachFormatConversionOutputValidation"
]) {
  assert.equal(
    formatConversionModuleBody.includes(expectedText),
    true,
    `FormatConversion must own output packaging and validation through ${expectedText}`
  );
}
for (const expectedText of [
  "xmlWellFormedness",
  "xmlRelationshipTargets",
  "openxml-xml-parts-well-formed",
  "openxml-package-relationships-resolve",
  "response-profile-json-artifact-self-check.v1",
  "validateJsonArtifactBuffer",
  "json-required-fields-present",
  "json-expected-fields-match"
]) {
  assert.equal(
    externalServiceSource.includes(expectedText),
    true,
    `FormatConversion artifact validation must include OpenXML package self-check support: ${expectedText}`
  );
}
const createRunWrapperBody = sourceSliceBetweenFunctions(externalServiceSource, "createRun", "capabilities");
assert.match(
  createRunWrapperBody,
  /return runKnowledgeDistillationWorkflow\(input, runtimeStatus, priorRuns, referenceFrameworks\);/,
  "createRun must remain a compatibility wrapper around the unified workflow"
);

console.log("knowledge distillation standalone service feature gate passed");
