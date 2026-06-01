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
  assert.equal(toolOperationIds.has(operationId), true, `${operationId} must be exposed to Tool Management`);
}

for (const operationId of INTERNAL_OPERATION_IDS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must remain as a temporary migration shim`);
  assert.equal(operation.deprecated, true, `${operationId} must be explicitly deprecated`);
  assert.equal(operation.replacementService, "external.knowledge.distillation", `${operationId} must point to the external service`);
  assert.equal(operation.lifecycle?.maintenancePolicy, "compatibility-shim-only", `${operationId} must not be maintained as an algorithm surface`);
  assert.equal(toolOperationIds.has(operationId), false, `${operationId} must not be exposed to agents`);
}

const migrationResult = await executeConsoleDomainOperation({
  operationId: "knowledge.distillation.workbench.runs.create",
  input: { jobId: "deprecated-internal-workbench" },
  context: {}
});
assert.equal(migrationResult.status, 410);
assert.equal(migrationResult.payload.code, "INTERNAL_KNOWLEDGE_DISTILLATION_REMOVED");
assert.equal(migrationResult.payload.replacementService, "external.knowledge.distillation");
assert.equal(migrationResult.payload.migration.createRun, "external.knowledge.distillation.runs.create");

const runtimeProvidersText = await fs.readFile(
  path.join(repoRoot, "server/platform/interactive/server-runtime-providers.mjs"),
  "utf8"
);
assert.equal(
  runtimeProvidersText.includes("knowledge-distillation-runtime/index.mjs"),
  false,
  "the server runtime must not dynamically load the internal knowledge distillation runtime"
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

console.log("knowledge distillation internal workbench deprecation verification passed");
