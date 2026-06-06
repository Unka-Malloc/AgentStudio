import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { executeConsoleDomainOperation } from "../platform/specialized/console/console-domain-operation-executor.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const INTERNAL_OPERATION_IDS = Object.freeze([
  "knowledge.distillation.runs.create",
  "knowledge.distillation.runs.get",
  "knowledge.distillation.workbench.runs.list",
  "knowledge.distillation.workbench.runs.create",
  "knowledge.distillation.workbench.runs.get",
  "knowledge.distillation.workbench.runs.resume",
  "knowledge.distillation.workbench.runs.cancel",
  "knowledge.distillation.workbench.runs.archive",
  "knowledge.distillation.workbench.runs.delete",
  "knowledge.distillation.workbench.stage.rerun",
  "knowledge.distillation.workbench.stage.export",
  "knowledge.distillation.workbench.runs.package",
  "knowledge.distillation.workbench.runs.artifacts",
  "knowledge.distillation.workbench.runs.compare",
  "knowledge.distillation.export"
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

const operationsById = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
const toolOperationIds = new Set(catalog.tools.map((tool) => tool.operationId).filter(Boolean));

for (const operationId of EXTERNAL_OPERATION_IDS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must stay registered as the maintained external distillation surface`);
  assert.equal(operation.feature, "external", `${operationId} must use the external feature namespace`);
  assert.equal(operation.aspects?.includes("external-service"), true, `${operationId} must be an external service operation`);
  assert.equal(operation.aspects?.includes("external-upstream-gateway"), true, `${operationId} must go through the external upstream gateway aspect`);
  assert.equal(operation.aspects?.includes("knowledge-distillation"), true, `${operationId} must keep the knowledge-distillation aspect`);
  assert.equal(operation.public === true || operation.externalAuth === true, false, `${operationId} must not bypass console authorization as public/externalAuth`);
  assert.ok(Array.isArray(operation.requiredScopes) && operation.requiredScopes.length > 0, `${operationId} must declare required scopes`);
  assert.equal(String(operation.http?.path || "").startsWith("/api/external/knowledge/distillation/"), true, `${operationId} must stay behind the mediated external knowledge distillation API`);
  assert.equal(toolOperationIds.has(operationId), true, `${operationId} must be exposed to Tool Management`);
}

for (const operationId of INTERNAL_OPERATION_IDS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must remain as a temporary migration shim`);
  assert.equal(operation.deprecated, true, `${operationId} must be explicitly deprecated`);
  assert.equal(operation.replacementService, "external.knowledge.distillation", `${operationId} must point to the external service`);
  assert.equal(operation.lifecycle?.maintenancePolicy, "compatibility-shim-only", `${operationId} must not be maintained as an algorithm surface`);
  assert.equal(operation.aspects?.includes("internal-deprecated"), true, `${operationId} must expose the internal-deprecated aspect`);
  assert.equal(operation.aspects?.includes("external-replaced"), true, `${operationId} must expose the external-replaced aspect`);
  assert.ok(Array.isArray(operation.requiredScopes) && operation.requiredScopes.length > 0, `${operationId} must still require console authorization before returning migration metadata`);
  assert.equal(toolOperationIds.has(operationId), false, `${operationId} must not be exposed to agents`);
}

for (const operationId of INTERNAL_OPERATION_IDS) {
  const migrationResult = await executeConsoleDomainOperation({
    operationId,
    input: { jobId: "deprecated-internal-workbench", runId: "deprecated-run", artifactId: "deprecated-artifact" },
    context: {}
  });
  assert.equal(migrationResult.status, 410, `${operationId} must return migration metadata instead of running the old internal surface`);
  assert.equal(migrationResult.payload.code, "INTERNAL_KNOWLEDGE_DISTILLATION_REMOVED");
  assert.equal(migrationResult.payload.replacementService, "external.knowledge.distillation");
  assert.equal(migrationResult.payload.migration.createRun, "external.knowledge.distillation.runs.create");
}

const runtimeProvidersText = await fs.readFile(
  path.join(repoRoot, "server/platform/interactive/server-runtime-providers.mjs"),
  "utf8"
);
assert.equal(
  runtimeProvidersText.includes("knowledge-distillation-runtime/index.mjs"),
  false,
  "the server runtime must not dynamically load the internal knowledge distillation runtime"
);
assert.equal(
  runtimeProvidersText.includes("knowledgeDistillationRuntime"),
  false,
  "the server runtime must not keep an internal knowledgeDistillationRuntime compatibility slot"
);

const consoleDomainServicesText = await fs.readFile(
  path.join(repoRoot, "server/platform/specialized/console/console-domain-services.mjs"),
  "utf8"
);
assert.equal(
  consoleDomainServicesText.includes("knowledge-distillation-workbench/index.mjs"),
  false,
  "console domain services must not import the internal knowledge distillation workbench"
);

async function readOptional(relativePath) {
  try {
    return await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

const workbenchFacadeText = await fs.readFile(
  path.join(repoRoot, "server-web/lib/knowledge-distillation-workbench.ts"),
  "utf8"
);
const workbenchComponentText = await fs.readFile(
  path.join(repoRoot, "server-web/components/KnowledgeDistillationWorkbench.vue"),
  "utf8"
);
const legacyDebugDistillationControllerText = await fs.readFile(
  path.join(repoRoot, "server-web/composables/console-debug-distillation-controller.ts"),
  "utf8"
);
const extractedWorkbenchControllerText = await readOptional(
  "server-web/composables/knowledge-distillation-workbench-controller.ts"
);
const extractedDebugDistillationRunnerText = await readOptional(
  "server-web/composables/console-debug-distillation-runner.ts"
);
const consoleWorkbenchCallerText = [
  workbenchComponentText,
  extractedWorkbenchControllerText
].join("\n");
const consoleDebugDistillationCallerText = [
  legacyDebugDistillationControllerText,
  extractedDebugDistillationRunnerText
].join("\n");

assert.ok(
  /type\s+CreateWorkbenchRunPayload\s*=\s*Record<string,\s*unknown>\s*&\s*\{\s*workflowScope:\s*"document"\s*\|\s*"corpus"\s*\|\s*"project";\s*\}/.test(workbenchFacadeText) ||
    /CreateKnowledgeDistillationWorkbenchRunPayload/.test(workbenchFacadeText),
  "console workbench facade must require workflowScope in the create payload type"
);
assert.match(
  consoleWorkbenchCallerText,
  /workflowScope:\s*"project"/,
  "project-directory workbench runs must explicitly pass workflowScope=project"
);
assert.match(
  consoleDebugDistillationCallerText,
  /workflowScope:\s*"document"/,
  "single-file debug distillation runs must explicitly pass workflowScope=document"
);
assert.match(
  consoleDebugDistillationCallerText,
  /fileName:\s*file\.name/,
  "single-file debug distillation must pass the known fileName as the document selector"
);

const externalCreateOperation = operationsById.get("external.knowledge.distillation.runs.create");
assert.ok(externalCreateOperation, "external distillation create operation must exist");
assert.equal(
  externalCreateOperation.inputSchema?.required?.includes("workflowScope"),
  true,
  "external distillation create operation must force workflowScope at the platform boundary"
);
assert.deepEqual(
  externalCreateOperation.inputSchema?.properties?.workflowScope?.enum,
  ["document", "corpus", "project"],
  "external distillation create operation must expose workflowScope as an enum"
);

console.log("knowledge distillation internal workbench deprecation verification passed");
