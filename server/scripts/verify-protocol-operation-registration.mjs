import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";
import {
  PROTOCOL_OPERATION_IDS
} from "../platform/common/operation-dispatcher/protocol-operation-definitions.mjs";
import {
  SERVER_API_OPERATIONS
} from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  createToolCatalog
} from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function mcpRequest(method, params = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

const operationsById = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
const controllerDir = path.join(repoRoot, "server/platform/common/console/http/controllers");
const controllerSource = (
  await Promise.all(
    (await fs.readdir(controllerDir))
      .filter((fileName) => fileName.endsWith(".mjs"))
      .map((fileName) => fs.readFile(path.join(controllerDir, fileName), "utf8"))
  )
).join("\n");
const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
const toolsByOperationId = new Map(
  catalog.tools
    .filter((tool) => tool.operationId)
    .map((tool) => [tool.operationId, tool])
);

function requiresToolCatalogExposure(operationId) {
  return !String(operationId || "").startsWith("knowledge.distillation.");
}

for (const operationId of PROTOCOL_OPERATION_IDS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must be registered in SERVER_API_OPERATIONS`);
  assert.equal(operation.target?.controller, "system", `${operationId} must target system controller`);
  assert.ok(operation.target?.method, `${operationId} must declare target method`);
  assert.match(
    controllerSource,
    new RegExp(`async\\s+${operation.target.method}\\s*\\(`),
    `${operationId} target method ${operation.target.method} must exist`
  );
  assert.ok(operation.http?.method && operation.http?.path, `${operationId} must expose HTTP binding`);
  assert.equal(operation.rpc?.method, operationId, `${operationId} RPC method must equal operation id`);
  assert.ok(Array.isArray(operation.requiredScopes), `${operationId} must declare required scopes`);
  assert.ok(operation.requiredScopes.length > 0, `${operationId} must not be implicitly public`);
  assert.ok(operation.safety?.risk, `${operationId} must declare normalized safety risk`);
  assert.equal(typeof operation.readOnly, "boolean", `${operationId} must declare readOnly`);

  const tool = toolsByOperationId.get(operationId);
  if (!requiresToolCatalogExposure(operationId)) {
    assert.equal(tool, undefined, `${operationId} must remain an internal API operation, not a Tool Management tool`);
    continue;
  }
  assert.ok(tool, `${operationId} must be discoverable through Tool Management catalog`);
  assert.equal(tool.status, "active", `${operationId} tool must be active`);
  assert.ok(tool.id.startsWith("pact."), `${operationId} tool id must be in pact namespace`);
  assert.ok(tool.requiredScopes.length > 0, `${operationId} tool must carry grant scopes`);
  assert.ok(tool.toolsets.length > 0, `${operationId} tool must belong to at least one toolset`);
}

const concreteMcpNames = new Set(catalog.tools.map((tool) => tool.id));
for (const requiredTool of [
  "pact.workspace.file.upload",
  "pact.workspace.contribution.submit",
  "pact.knowledge.access.evaluate",
  "pact.workspace.code.change.upload",
  "pact.rawCorpus.format.convert",
  "pact.knowledge.dossier.export"
]) {
  assert.equal(concreteMcpNames.has(requiredTool), true, `${requiredTool} must be in capabilities list`);
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-protocol-operations-"));
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});

try {
  const auth = await installAuthenticatedFetch(server);
  const rpcInterfaces = await fetchJson(`${server.url}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "interfaces",
      method: "system.interfaces",
      params: {}
    })
  });
  assert.equal(rpcInterfaces.status, 200);
  const activeOperationIds = new Set(rpcInterfaces.payload.result.interfaces.map((item) => item.id));
  for (const operationId of PROTOCOL_OPERATION_IDS) {
    assert.equal(activeOperationIds.has(operationId), true, `${operationId} must be active at runtime`);
  }

  const runtimeCatalog = await fetchJson(`${server.url}/api/tool-management/v1/catalog`, {
    headers: authHeaders(auth)
  });
  assert.equal(runtimeCatalog.status, 200);
  const runtimeToolNames = new Set(runtimeCatalog.payload.tools.map((tool) => tool.id));
  for (const requiredTool of concreteMcpNames) {
    if (!requiredTool.startsWith("pact.workspace.") &&
        !requiredTool.startsWith("pact.knowledge.access.") &&
        !requiredTool.startsWith("pact.authorization.") &&
        !requiredTool.startsWith("pact.rawCorpus.") &&
        !requiredTool.startsWith("pact.knowledge.dossier")) {
      continue;
    }
    assert.equal(runtimeToolNames.has(requiredTool), true, `${requiredTool} must be active in runtime tool catalog`);
  }

  const grant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      label: "verify-protocol-capabilities",
      scopes: ["storage:write", "workspace:write", "knowledge:read", "knowledge:write", "repo:maintain"],
      metadata: { maxRisk: "repair_write" }
    })
  });
  assert.equal(grant.status, 201);
  assert.ok(grant.payload.token);

  const capabilities = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grant.payload.token}`
    },
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "pact.capabilities.list",
        input: {}
      }
    }, "capabilities"))
  });
  assert.equal(capabilities.status, 200);
  const mcpOperationNames = new Set(capabilities.payload.result.structuredContent.operations.map((tool) => tool.name));
  for (const requiredTool of [
    "pact.workspace.file.upload",
    "pact.workspace.contribution.submit",
    "pact.knowledge.access.evaluate",
    "pact.workspace.code.change.upload",
    "pact.rawCorpus.format.convert",
    "pact.knowledge.dossier.export"
  ]) {
    assert.equal(mcpOperationNames.has(requiredTool), true, `${requiredTool} must be visible in MCP capabilities`);
  }
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log(`protocol operation registration verification passed (${PROTOCOL_OPERATION_IDS.length} protocol operations)`);
