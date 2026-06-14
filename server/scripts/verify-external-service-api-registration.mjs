import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES,
  EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "../platform/common/composition-management/external-service-adapter.mjs";
import {
  callExternalLlmService,
  describeExternalLlmServiceAdapters,
  isExternalLlmServiceConfig
} from "../platform/common/composition-management/external-llm-service-adapters.mjs";
import {
  describeExternalServices,
  inspectExternalServiceHealth
} from "../platform/common/composition-management/external-service-registry.mjs";
import {
  createExternalMcpPassthroughRuntime
} from "../platform/common/composition-management/external-mcp-passthrough-runtime.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import {
  KERNEL_API_OPERATION_IDS,
  KERNEL_TOOL_IDS
} from "../platform/common/security/authorization/authorization-engine.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const externalServicesRoot = path.join(repoRoot, "external-services");
const CLOUD_DRIVE_EXTERNAL_OPERATION_IDS = Object.freeze([
  "external.cloudDrive.connect",
  "external.cloudDrive.status",
  "external.cloudDrive.item.list",
  "external.cloudDrive.file.download",
  "external.cloudDrive.file.upload",
  "external.cloudDrive.sync.plan",
  "external.cloudDrive.sync.apply",
  "external.cloudDrive.permission.list"
]);
const CLOUD_DRIVE_LEGACY_OPERATION_IDS = Object.freeze([
  "sharedspace.drive.connect",
  "sharedspace.drive.status",
  "sharedspace.drive.item.list",
  "sharedspace.drive.file.download",
  "sharedspace.drive.file.upload",
  "sharedspace.drive.sync.plan",
  "sharedspace.drive.sync.apply",
  "sharedspace.drive.permission.list"
]);
const CLOUD_DRIVE_LEGACY_TOOLING_EXEMPTIONS = Object.freeze([
  "sharedspace.drive.connect"
]);

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
      "pact.agentLibrary.distillation.export",
      "pact.agentLibrary.distillation.runs.create",
      "pact.agentLibrary.distillation.runs.get"
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
  },
  "rag-service": {
    namespace: "external.knowledge.rag",
    pathPrefix: "/api/external/rag",
    operationIds: [],
    requiredFiles: ["Dockerfile", "README.md", "external-service.config.json"],
    rejectedInternalOperationPrefixes: [],
    rejectedInternalToolIds: [],
    deprecatedInternalOperationIds: []
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

async function assertExternalServiceTypeValidation() {
  const baseConfig = {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: "pact.external-service.config",
    serviceId: "verify-external-service-type",
    serviceName: "external.verify.service",
    displayName: "Verify External Service Type",
    mode: "connected",
    startupPolicy: "external-only",
    binding: {
      mode: "passthrough",
      outlet: "pact.serviceHub",
      requiredScopes: ["knowledge:read"],
      risk: "read_only"
    },
    healthCheck: { type: "none" }
  };
  const acceptedUpstreams = [
    {
      type: "acp",
      transport: "http",
      url: "https://agent-relay.example.com:443/acp",
      metadata: {
        agentProfileId: "verify.acp.agent"
      }
    },
    { type: "llm", modelProtocol: "openai-compatible", provider: "openai", url: "https://api.openai.com:443/v1/chat/completions" },
    { type: "llm", modelProtocol: "anthropic-messages", provider: "anthropic", url: "https://api.anthropic.com:443/v1/messages" },
    { type: "llm", modelProtocol: "gemini-generate-content", provider: "google", url: "https://generativelanguage.googleapis.com:443/v1beta/models/gemini:generateContent" },
    { type: "llm", modelProtocol: "bedrock-converse", provider: "aws-bedrock", url: "https://bedrock-runtime.us-east-1.amazonaws.com:443/model/test/converse" },
    { type: "llm", modelProtocol: "ollama-native", provider: "ollama", url: "http://127.0.0.1:11434/api/chat" },
    { type: "cloud-drive", provider: "onedrive", mode: "contract", secretRef: "secret://pact/drive/onedrive-oauth" },
    { type: "http", url: "http://127.0.0.1:8787/health" },
    { type: "https", url: "https://example.com:443/api" },
    { type: "json-rpc", url: "https://rpc.example.com:443/jsonrpc" },
    { type: "sse", url: "https://events.example.com:443/v1/events" },
    { type: "internal-proprietary-service", url: "" }
  ];
  for (const upstream of acceptedUpstreams) {
    const tools = (() => {
      if (upstream.type === "http" || upstream.type === "https") {
        return [{ name: "verify", method: "GET", path: "/verify" }];
      }
      if (upstream.type === "json-rpc") {
        return [{ name: "verify", method: "verify.ping" }];
      }
      if (upstream.type === "sse") {
        return [{ name: "watch", transport: { type: "sse" } }];
      }
      return [];
    })();
    const config = normalizeExternalServiceConfig({
      ...baseConfig,
      serviceId: `${baseConfig.serviceId}-${upstream.type}`,
      ...(upstream.type === "acp"
        ? {
            binding: {
              mode: "passthrough",
              outlet: "pact.agentRelay",
              requiredScopes: ["agent_relay:prompt"],
              risk: "repair_write"
            }
          }
        : {}),
      ...(String(upstream.url || upstream.baseUrl || upstream.endpointUrl || "").includes("127.0.0.1")
        ? { policyPreset: "servicehub.development-local" }
        : {}),
      ...(tools.length ? { tools } : {}),
      upstream
    });
    const validation = await validateExternalServiceConfig({
      config,
      requireKnownPaths: false
    });
    assert.equal(
      validation.ok,
      true,
      `${upstream.type} upstream type must be accepted for external service discovery: ${JSON.stringify(validation.errors || [])}`
    );
    if (upstream.type === "llm") {
      assert.equal(config.upstream.type, "llm", "LLM upstream must normalize to the generic llm service type");
      assert.equal(config.upstream.modelProtocol, upstream.modelProtocol, "LLM upstream must retain modelProtocol for adapter routing");
      assert.equal(config.upstream.provider, upstream.provider, "LLM upstream must retain provider for adapter routing");
    }
    if (upstream.type === "cloud-drive") {
      assert.equal(config.upstream.type, "cloud-drive", "Cloud Drive upstream must keep the cloud-drive service type");
      assert.equal(config.upstream.provider, "onedrive", "Cloud Drive upstream must retain provider for adapter routing");
      assert.equal(config.upstream.mode, "contract", "Cloud Drive upstream must retain adapter mode");
      assert.deepEqual(
        EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES,
        ["icloud", "onedrive", "google-drive", "dropbox"],
        "Cloud Drive provider enum must stay explicit for gateway adapter routing"
      );
    }
  }
  const missingPortConfig = normalizeExternalServiceConfig({
    ...baseConfig,
    serviceId: `${baseConfig.serviceId}-missing-port`,
    policyPreset: "servicehub.development-local",
    upstream: {
      type: "http",
      url: "http://127.0.0.1/health"
    }
  });
  const missingPortValidation = await validateExternalServiceConfig({
    config: missingPortConfig,
    requireKnownPaths: false
  });
  assert.equal(missingPortValidation.ok, false, "HTTP external service URL without explicit port must be rejected");
  assert.match(
    JSON.stringify(missingPortValidation.errors || []),
    /explicit port/,
    "HTTP external service explicit-port validation must be reported"
  );
}

async function withMockHttpServer(callback) {
  const server = http.createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
  try {
    return await callback({ server, port });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const retiredOpenAiConfig = normalizeExternalServiceConfig({
    ...baseConfig,
    serviceId: `${baseConfig.serviceId}-retired-openai`,
    upstream: {
      type: "openai",
      url: "https://api.openai.com:443/v1"
    }
  });
  const retiredOpenAiValidation = await validateExternalServiceConfig({
    config: retiredOpenAiConfig,
    requireKnownPaths: false
  });
  assert.equal(retiredOpenAiValidation.ok, false, "retired openai upstream type must be rejected");
  assert.match(
    JSON.stringify(retiredOpenAiValidation.errors || []),
    /upstream\.type=openai is retired/,
    "retired openai upstream type must direct operators to upstream.type=llm"
  );
}

async function assertExternalHealthInspectionDoesNotExposeBody() {
  await withMockHttpServer(async ({ server, port }) => {
    server.removeAllListeners("request");
    server.on("request", (_request, response) => {
      const body = "private-token=health-secret-value";
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": String(Buffer.byteLength(body))
      });
      response.end(body);
    });
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-health-body-"));
    try {
      const configDir = path.join(userDataPath, "external-services", "configs");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "verify-health-body.external-service.json"),
        `${JSON.stringify({
          schemaVersion: "v0.0.1:schema:definition-1",
          kind: "pact.external-service.config",
          serviceId: "verify-health-body",
          serviceName: "external.verify.healthBody",
          displayName: "Verify Health Body",
          mode: "connected",
          startupPolicy: "external-only",
          policyPreset: "servicehub.development-local",
          healthCheck: {
            type: "http",
            url: `http://127.0.0.1:${port}/health`,
            required: true
          }
        }, null, 2)}\n`,
        "utf8"
      );
      const health = await inspectExternalServiceHealth({
        userDataPath,
        cwd: repoRoot,
        serviceId: "verify-health-body"
      });
      assert.equal(health.ok, true, "mock external service health must pass");
      assert.equal(health.results[0]?.ok, true, "mock external service health result must be healthy");
      assert.equal("body" in health.results[0], false, "external service health inspection must not return upstream response bodies");
      assert.equal(
        JSON.stringify(health).includes("health-secret-value"),
        false,
        "external service health inspection must not leak upstream response body content"
      );
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });
}

async function assertExternalHttpToolResponseLimit() {
  await withMockHttpServer(async ({ server, port }) => {
    server.on("request", (_request, response) => {
      const body = "x".repeat((4 * 1024 * 1024) + 1);
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": String(Buffer.byteLength(body))
      });
      response.end(body);
    });
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-http-limit-"));
    try {
      const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
      await runtime.refreshConfig({
        schemaVersion: "v0.0.1:schema:definition-1",
        kind: "pact.external-service.config",
        serviceId: "verify-http-response-limit",
        serviceName: "external.verify.httpResponseLimit",
        displayName: "Verify HTTP Response Limit",
        mode: "connected",
        startupPolicy: "external-only",
        policyPreset: "servicehub.development-local",
        upstream: {
          type: "http",
          url: `http://127.0.0.1:${port}`,
          transport: "http"
        },
        binding: {
          mode: "compile",
          outlet: "pact.serviceHub",
          requiredScopes: ["knowledge:read"],
          risk: "read_only"
        },
        tools: [
          {
            name: "large_result",
            method: "GET",
            path: "/large"
          }
        ],
        healthCheck: { type: "none" }
      });
      await assert.rejects(
        () => runtime.callTool({
          serviceId: "verify-http-response-limit",
          toolName: "large_result"
        }),
        /External HTTP tool response exceeded the 4194304 byte response limit/,
        "external HTTP compiled tools must reject oversized upstream responses"
      );
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });
}

function assertExternalLlmServiceAdapterScaffold() {
  const description = describeExternalLlmServiceAdapters();
  assert.equal(description.status, "scaffold", "LLM service adapters must be explicitly marked as scaffolds");
  for (const protocol of EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES) {
    const row = description.protocols.find((item) => item.protocol === protocol);
    assert.equal(Boolean(row?.registered), true, `${protocol} must have an LLM adapter scaffold`);
    const config = normalizeExternalServiceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: "pact.external-service.config",
      serviceId: `verify-llm-${protocol}`,
      serviceName: `external.verify.llm.${protocol}`,
      displayName: `Verify LLM ${protocol}`,
      mode: "connected",
      startupPolicy: "external-only",
      upstream: {
        type: "llm",
        modelProtocol: protocol,
        provider: "verify",
        url: "http://127.0.0.1:8787/v1"
      },
      binding: {
        mode: "compile",
        outlet: "pact.serviceHub",
        requiredScopes: ["knowledge:read"],
        risk: "read_only"
      },
      healthCheck: { type: "none" }
    });
    assert.equal(isExternalLlmServiceConfig(config), true, `${protocol} must be recognized as an LLM Service config`);
    const placeholder = callExternalLlmService({ config, input: { messages: [] }, context: { verify: true } });
    assert.equal(placeholder.status, "not_implemented", `${protocol} scaffold must not implement real adapter behavior yet`);
    assert.equal(placeholder.adapterId, protocol, `${protocol} scaffold must route through the protocol-specific adapter`);
  }
}

const operationsById = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
const toolsByOperationId = new Map(catalog.tools.map((tool) => [tool.operationId, tool]));
const toolIds = new Set(catalog.tools.map((tool) => tool.id));
const kernelApiOperationIds = new Set(KERNEL_API_OPERATION_IDS);
const kernelToolIds = new Set(KERNEL_TOOL_IDS);

await assertExternalServiceTypeValidation();
await assertExternalHealthInspectionDoesNotExposeBody();
await assertExternalHttpToolResponseLimit();
assertExternalLlmServiceAdapterScaffold();

const healthInspectOperation = operationsById.get("external_services.health.inspect");
assert.ok(healthInspectOperation, "external service health inspection operation must be registered");
assert.deepEqual(
  healthInspectOperation.requiredScopes,
  ["runtime:admin"],
  "external service health inspection performs network egress and must require runtime admin"
);
assert.equal(
  healthInspectOperation.safety?.risk,
  "safe_write",
  "external service health inspection must not be classified as simple read-only metadata"
);
assert.equal(
  healthInspectOperation.safety?.requiresConfirmation,
  true,
  "external service health inspection must require explicit confirmation"
);

for (const operationId of CLOUD_DRIVE_EXTERNAL_OPERATION_IDS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must be registered as an upstream cloud drive service operation`);
  assert.equal(operation.feature, "external", `${operationId} must use the external feature namespace`);
  assert.equal(operation.aspects?.includes("external-service"), true, `${operationId} must use the external-service aspect`);
  assert.equal(operation.aspects?.includes("external-upstream-gateway"), true, `${operationId} must use the external upstream gateway aspect`);
  assert.equal(operation.aspects?.includes("cloud-drive-upstream"), true, `${operationId} must use the cloud-drive-upstream aspect`);
  assert.equal(
    String(operation.http?.path || "").startsWith("/api/external/cloud-drive/"),
    true,
    `${operationId} must expose a mediated API under /api/external/cloud-drive/`
  );
  assert.ok(toolsByOperationId.has(operationId), `${operationId} must be exposed as a managed external cloud drive tool`);
}

for (const operationId of CLOUD_DRIVE_LEGACY_OPERATION_IDS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} legacy shim must remain registered for console/API compatibility`);
  assert.equal(operation.deprecated, true, `${operationId} must be deprecated after Cloud Drive moves to upstream service gateway`);
  assert.equal(operation.replacementService, "external.cloudDrive", `${operationId} must point to external.cloudDrive`);
  assert.equal(
    operation.lifecycle?.maintenancePolicy,
    "compatibility-shim-only",
    `${operationId} must be compatibility-shim-only`
  );
  if (!CLOUD_DRIVE_LEGACY_TOOLING_EXEMPTIONS.includes(operationId)) {
    assert.equal(
      toolsByOperationId.has(operationId),
      false,
      `${operationId} must not be exposed through Tool Management as a platform core tool`
    );
  }
  assert.equal(
    kernelApiOperationIds.has(operationId),
    false,
    `${operationId} must not remain in the authorization kernel as a platform core API capability`
  );
}

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
    if (requirement.namespace === "external.knowledge.distillation") {
      assert.equal(operation.aspects?.includes("external-upstream-gateway"), true, `${operationId} must use the external upstream gateway aspect`);
    }
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
    assert.equal(
      kernelToolIds.has(rejectedToolId),
      false,
      `${rejectedToolId} is an internal platform algorithm capability and must not remain in the authorization kernel`
    );
  }
  for (const operationId of requirement.deprecatedInternalOperationIds || []) {
    const operation = operationsById.get(operationId);
    assert.equal(operation, undefined, `${operationId} legacy internal operation must not remain registered after migration to ${requirement.namespace}`);
    assert.equal(
      toolsByOperationId.has(operationId),
      false,
      `${operationId} must not be exposed through Tool Management`
    );
    assert.equal(
      kernelApiOperationIds.has(operationId),
      false,
      `${operationId} is an internal platform algorithm operation and must not remain in the authorization kernel`
    );
  }
}

const externalServiceState = await describeExternalServices({ cwd: repoRoot });
const ragServiceEntry = externalServiceState.services.find((entry) => entry.serviceId === "rag-service");
assert.ok(ragServiceEntry, "rag-service external-service.config.json must be discovered by the generic registry scan");
assert.equal(ragServiceEntry.source, "discovered", "rag-service must enter through dynamic config discovery");
assert.equal(
  externalServiceState.maintenancePresets.some((preset) => preset.serviceId === "rag-service"),
  true,
  "rag-service health check must be exposed as a generic maintenance preset"
);
const healthInspection = await inspectExternalServiceHealth({ cwd: repoRoot, serviceId: "rag-service" });
assert.equal(healthInspection.checkedCount, 1, "generic external service health inspection must target rag-service");
assert.equal(healthInspection.results[0].serviceId, "rag-service");

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
assert.equal(
  operationExecutorText.replace(/external\.knowledge\.distillation\./g, "").includes("knowledge.distillation."),
  false,
  "console domain operation executor must not reference internal knowledge distillation operation ids"
);

console.log("external service API registration gate passed");
