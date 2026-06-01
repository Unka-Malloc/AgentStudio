import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const externalServicesRoot = path.join(repoRoot, "external-services");

const SERVICE_REGISTRATION_REQUIREMENTS = Object.freeze({
  "knowledge-distillation-service": {
    namespace: "external.knowledge.distillation",
    pathPrefix: "/api/external/knowledge/distillation",
    operationIds: [
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
    ],
    requiredFiles: ["server.mjs", "README.md", "Dockerfile", "reference-frameworks.json", "format-routes.json", "parser-strategies.json", "format-conversion-profiles.json", "model-distillation-profiles.json"],
    rejectedInternalOperationPrefixes: ["knowledge.distillation."],
    rejectedInternalToolIds: [
      "pact.knowledge.distillation.runs.create",
      "pact.knowledge.distillation.runs.get"
    ],
    deprecatedInternalOperationIds: [
      "knowledge.distillation.export",
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
      "knowledge.distillation.workbench.runs.compare"
    ]
  }
});

async function listExternalServiceDirectories() {
  try {
    const entries = await fs.readdir(externalServicesRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function assertRequiredFiles(serviceName, requiredFiles = []) {
  for (const fileName of requiredFiles) {
    const filePath = path.join(externalServicesRoot, serviceName, fileName);
    const stat = await fs.stat(filePath).catch(() => null);
    assert.equal(Boolean(stat?.isFile()), true, `${serviceName} must include ${fileName}`);
  }
}

const operationsById = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
const toolsByOperationId = new Map(catalog.tools.map((tool) => [tool.operationId, tool]));
const toolIds = new Set(catalog.tools.map((tool) => tool.id));

for (const operation of SERVER_API_OPERATIONS) {
  if (!operation.aspects?.includes("external-service")) {
    continue;
  }
  assert.equal(operation.id.startsWith("external."), true, `${operation.id} external service operation id must use external.*`);
  assert.equal(operation.feature, "external", `${operation.id} external service operation feature must be external`);
  assert.equal(
    String(operation.http?.path || "").startsWith("/api/external/"),
    true,
    `${operation.id} external service HTTP path must be under /api/external/`
  );
  assert.equal(operation.rpc?.method, operation.id, `${operation.id} RPC method must match the operation id`);
  assert.ok(toolsByOperationId.has(operation.id), `${operation.id} must be exposed through Tool Management`);
}

const externalServiceNames = await listExternalServiceDirectories();
for (const serviceName of externalServiceNames) {
  const requirement = SERVICE_REGISTRATION_REQUIREMENTS[serviceName];
  assert.ok(
    requirement,
    `${serviceName} must be declared in verify-external-service-api-registration.mjs before it can enter the project`
  );
  await assertRequiredFiles(serviceName, requirement.requiredFiles);
  const dockerfileText = await fs.readFile(path.join(externalServicesRoot, serviceName, "Dockerfile"), "utf8");
  for (const requiredFile of requirement.requiredFiles.filter((fileName) => fileName.endsWith(".json"))) {
    assert.match(
      dockerfileText,
      new RegExp(requiredFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${serviceName} Dockerfile must copy ${requiredFile} so container capabilities work`
    );
  }
  for (const operationId of requirement.operationIds) {
    const operation = operationsById.get(operationId);
    assert.ok(operation, `${serviceName} must register ${operationId}`);
    assert.equal(operation.aspects?.includes("external-service"), true, `${operationId} must use the external-service aspect`);
    assert.equal(operation.feature, "external", `${operationId} must use the external feature namespace`);
    assert.equal(operation.id.startsWith(`${requirement.namespace}.`), true, `${operationId} must stay under ${requirement.namespace}`);
    assert.equal(
      String(operation.http?.path || "").startsWith(requirement.pathPrefix),
      true,
      `${operationId} must expose a mediated API under ${requirement.pathPrefix}`
    );
    assert.ok(toolsByOperationId.has(operationId), `${operationId} must be exposed as a managed external service tool`);
  }
  for (const rejectedOperationPrefix of requirement.rejectedInternalOperationPrefixes || []) {
    for (const tool of catalog.tools) {
      assert.equal(
        String(tool.operationId || "").startsWith(rejectedOperationPrefix),
        false,
        `${tool.id} exposes internal platform algorithm operation ${tool.operationId}; use the external service API instead`
      );
    }
  }
  for (const rejectedToolId of requirement.rejectedInternalToolIds) {
    assert.equal(
      toolIds.has(rejectedToolId),
      false,
      `${rejectedToolId} is an internal platform algorithm capability and must not be exposed`
    );
  }
  for (const operationId of requirement.deprecatedInternalOperationIds || []) {
    const operation = operationsById.get(operationId);
    assert.ok(operation, `${operationId} must remain registered only as a migration shim until callers move`);
    assert.equal(operation.deprecated, true, `${operationId} must be marked deprecated`);
    assert.equal(
      operation.replacementService,
      requirement.namespace,
      `${operationId} must point to ${requirement.namespace}`
    );
    assert.equal(
      operation.lifecycle?.maintenancePolicy,
      "compatibility-shim-only",
      `${operationId} must not be treated as a maintained algorithm surface`
    );
    assert.equal(
      operation.aspects?.includes("internal-deprecated"),
      true,
      `${operationId} must expose an internal-deprecated aspect`
    );
    assert.equal(
      toolsByOperationId.has(operationId),
      false,
      `${operationId} must not be exposed through Tool Management`
    );
  }
}

const runtimeProvidersText = await fs.readFile(
  path.join(repoRoot, "server/platform/interactive/server-runtime-providers.mjs"),
  "utf8"
);
assert.equal(
  runtimeProvidersText.includes("knowledge-distillation-runtime/index.mjs"),
  false,
  "server runtime providers must not load the internal knowledge distillation runtime"
);
assert.equal(
  runtimeProvidersText.includes("createKnowledgeDistillationRuntime"),
  false,
  "server runtime providers must not instantiate the internal knowledge distillation runtime"
);
assert.equal(
  runtimeProvidersText.includes("knowledgeDistillationRuntime"),
  false,
  "server runtime providers must not expose an internal knowledgeDistillationRuntime compatibility slot"
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

const operationExecutorText = await fs.readFile(
  path.join(repoRoot, "server/platform/specialized/console/console-domain-operation-executor.mjs"),
  "utf8"
);
assert.match(
  operationExecutorText,
  /INTERNAL_KNOWLEDGE_DISTILLATION_REMOVED/,
  "internal knowledge distillation operations must return a machine-readable migration response"
);

console.log("external service API registration gate passed");
