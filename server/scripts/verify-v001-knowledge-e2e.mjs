import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

const REQUIRED_OPERATIONS = [
  "knowledge.backend.connect",
  "knowledge.space.list",
  "knowledge.search",
  "knowledge.evidence.get",
  "knowledge.export.request",
  "knowledge.permission.request"
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function mcpHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Pact-Api-Key": token
  };
}

function mcpRequest(method, params = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

async function localMcpGrant(serverUrl, body = {}, headers = {}) {
  return fetchJson(`${serverUrl}/api/mcp/local-grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

let mcpRequestId = 0;

const originalCapabilityKernelEnv = {
  PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER,
  PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER: process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER,
  PACT_OPAQUE_CAPABILITY_KEY_PROVIDER: process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER,
  PACT_CAPABILITY_BINDING_GUARD_PROVIDER: process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER
};

function useIsolatedCapabilityKernelForVerifier() {
  process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
  process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER = "local-file";
}

function restoreCapabilityKernelEnv() {
  for (const [key, value] of Object.entries(originalCapabilityKernelEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function callKnowledgeOperation({ serverUrl, token, operation, input = {} }) {
  mcpRequestId += 1;
  return fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.agentLibrary",
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation,
        input,
        clientVersion: "verify-v001-knowledge-e2e"
      }
    }, mcpRequestId))
  });
}

function structuredPayload(response) {
  return response.payload?.result?.structuredContent?.payload;
}

function assertKnowledgeOk(response, operation) {
  assert.equal(response.status, 200, JSON.stringify(response.payload, null, 2));
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  assert.equal(response.payload.result.structuredContent.operation, operation);
  const payload = structuredPayload(response);
  assert.equal(payload?.ok, true, JSON.stringify(payload || {}, null, 2));
  assert.equal(payload.protocolVersion, "v0.0.1:knowledge:backend-port-1");
  return payload;
}

function assertSafeMetadataOnly(item = {}) {
  assert.equal(item.metadataOnly, true, JSON.stringify(item, null, 2));
  assert.equal(Object.prototype.hasOwnProperty.call(item, "body"), false, "safe search result must not include body");
  assert.equal(Object.prototype.hasOwnProperty.call(item, "snippet"), false, "safe search result must not include snippet");
  assert.equal(Object.prototype.hasOwnProperty.call(item, "content"), false, "safe search result must not include content");
  assert.equal(Object.prototype.hasOwnProperty.call(item, "upstreamObjectId"), false, "safe search result must not include upstream object id");
  assert.equal(Object.prototype.hasOwnProperty.call(item.source || {}, "privatePath"), false, "safe search source must not include private path");
}

const operationsById = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
const toolsByOperationId = new Map(
  createToolCatalog({ operations: SERVER_API_OPERATIONS }).tools
    .filter((tool) => tool.operationId)
    .map((tool) => [tool.operationId, tool])
);

for (const operationId of REQUIRED_OPERATIONS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must be registered`);
  assert.ok(operation.http?.path, `${operationId} must expose HTTP API`);
  assert.equal(operation.rpc?.method, operationId, `${operationId} must expose RPC method`);
  assert.ok(operation.cli?.command?.length, `${operationId} must expose CLI command`);
  const tool = toolsByOperationId.get(operationId);
  assert.ok(tool, `${operationId} must be exposed through Tool Management`);
  assert.ok(tool.id.startsWith("pact.agentLibrary."), `${operationId} must map to pact.knowledge namespace`);
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-v001-knowledge-"));
useIsolatedCapabilityKernelForVerifier();
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});

try {
  const auth = await installAuthenticatedFetch(server, { safetyConfirm: true });

  const inlineSecret = await fetchJson(`${server.url}/api/knowledge/backend/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      provider: "dify",
      secretRef: "secret://pact/knowledge/dify-api-key",
      apiKey: "must-not-be-stored"
    })
  });
  assert.equal(inlineSecret.status, 400, JSON.stringify(inlineSecret.payload, null, 2));

  const difyConnect = await fetchJson(`${server.url}/api/knowledge/backend/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      provider: "dify",
      secretRef: "secret://pact/knowledge/dify-api-key",
      mode: "contract"
    })
  });
  assert.equal(difyConnect.status, 200, JSON.stringify(difyConnect.payload, null, 2));
  assert.equal(difyConnect.payload.secretPolicy, "secretRefOnly");
  assert.equal(difyConnect.payload.provider.contractVerified, true);

  const providerConfigPath = path.join(userDataPath, "knowledge", "knowledge-backends.json");
  const providerConfigText = await fs.readFile(providerConfigPath, "utf8");
  const providerConfig = JSON.parse(providerConfigText);
  assert.equal(providerConfig.providers.dify.mode, "contract");
  assert.equal(providerConfig.providers.dify.secretRef, "secret://pact/knowledge/dify-api-key");
  assert.equal(providerConfigText.includes("must-not-be-stored"), false, "runtime backend config must not store inline secrets");

  const difySpaces = await fetchJson(`${server.url}/api/knowledge/spaces?provider=dify`, {
    headers: authHeaders(auth)
  });
  assert.equal(difySpaces.status, 200, JSON.stringify(difySpaces.payload, null, 2));
  assert.equal(difySpaces.payload.metadataPolicy, "safeMetadataOnly");
  assert.ok(difySpaces.payload.spaces.length >= 1, "Dify contract provider must expose a safe derived space");
  for (const space of difySpaces.payload.spaces) {
    assert.equal(Object.prototype.hasOwnProperty.call(space, "body"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(space, "snippet"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(space, "datasetId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(space, "privatePath"), false);
    assert.ok(space.derivedKnowledgeSpace);
    assert.ok(space.upstreamKnowledgeRef);
  }

  const ragflowRpcSpaces = await fetchJson(`${server.url}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify(mcpRequest("knowledge.space.list", { provider: "ragflow" }, "rpc-ragflow-spaces"))
  });
  assert.equal(ragflowRpcSpaces.status, 200, JSON.stringify(ragflowRpcSpaces.payload, null, 2));
  assert.ok(ragflowRpcSpaces.payload.result.spaces.length >= 1, "RAGFlow must use the same KnowledgeBasePort list API");

  const search = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      provider: "dify",
      knowledgeBackend: true,
      query: "policy receipt",
      limit: 1
    })
  });
  assert.equal(search.status, 200, JSON.stringify(search.payload, null, 2));
  assert.equal(search.payload.backendPort, "KnowledgeBasePort");
  assert.equal(search.payload.externalKnowledgeBase.contractVerified, true);
  assert.equal(search.payload.items.length, 1);
  assertSafeMetadataOnly(search.payload.items[0]);
  const evidenceId = search.payload.items[0].evidenceId;

  const evidenceAllowed = await fetchJson(`${server.url}/api/knowledge/evidence-read?id=${encodeURIComponent(evidenceId)}`, {
    headers: authHeaders(auth)
  });
  assert.equal(evidenceAllowed.status, 200, JSON.stringify(evidenceAllowed.payload, null, 2));
  assert.equal(evidenceAllowed.payload.contractVerified, true);
  assert.ok(evidenceAllowed.payload.body.includes("Contract evidence"));
  assert.ok(evidenceAllowed.payload.knowledgeAccessReceipt?.receiptId, "authorized evidence read must emit a receipt");
  assert.ok(evidenceAllowed.payload.loanRecord?.loanRecordId, "authorized evidence read must emit a loan record");

  const evidenceDeclaredSubject = await fetchJson(
    `${server.url}/api/knowledge/evidence-read?id=${encodeURIComponent(evidenceId)}&subjectId=agent-b&username=agent-b`,
    { headers: authHeaders(auth) }
  );
  assert.equal(evidenceDeclaredSubject.status, 200, JSON.stringify(evidenceDeclaredSubject.payload, null, 2));
  assert.equal(evidenceDeclaredSubject.payload.accessDecision.allowed, true);
  assert.equal(
    evidenceDeclaredSubject.payload.knowledgeAccessReceipt?.subject?.declaredSubject?.subjectId,
    "agent-b",
    "request subject overrides must be retained only as declaredSubject"
  );
  assert.notEqual(
    evidenceDeclaredSubject.payload.knowledgeAccessReceipt?.subject?.subjectId,
    "agent-b",
    "request subject overrides must not replace the authenticated subject"
  );

  const exportDenied = await fetchJson(`${server.url}/api/knowledge/export/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      provider: "ragflow",
      format: "jsonl"
    })
  });
  assert.equal(exportDenied.status, 403, JSON.stringify(exportDenied.payload, null, 2));
  assert.equal(exportDenied.payload.backendExportInvoked, false, "unauthorized export must not call backend export");

  const exportAllowed = await fetchJson(`${server.url}/api/knowledge/export/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      provider: "ragflow",
      format: "jsonl",
      confirm: true,
      authorization: { approved: true }
    })
  });
  assert.equal(exportAllowed.status, 200, JSON.stringify(exportAllowed.payload, null, 2));
  assert.equal(exportAllowed.payload.contractVerified, true);
  assert.equal(exportAllowed.payload.backendExportInvoked, false);
  assert.ok(exportAllowed.payload.knowledgeAccessReceipt?.receiptId);
  assert.ok(exportAllowed.payload.loanRecord?.loanRecordId);

  const permission = await fetchJson(`${server.url}/api/knowledge/permission/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      provider: "dify",
      requestedAccessMode: "copyToContext",
      requestedEgress: "evidenceRead",
      reason: "verify v0.0.1 permission request"
    })
  });
  assert.equal(permission.status, 201, JSON.stringify(permission.payload, null, 2));
  assert.equal(permission.payload.status, "pending");
  assert.ok(permission.payload.permissionRequestId);

  const receipts = await fetchJson(`${server.url}/api/knowledge/access/receipts`, {
    headers: authHeaders(auth)
  });
  assert.equal(receipts.status, 200, JSON.stringify(receipts.payload, null, 2));
  assert.ok(receipts.payload.items.some((item) => item.receiptId === evidenceAllowed.payload.knowledgeAccessReceipt.receiptId));
  assert.ok(receipts.payload.items.some((item) => item.receiptId === exportAllowed.payload.knowledgeAccessReceipt.receiptId));

  const loanRecords = await fetchJson(`${server.url}/api/knowledge/access/loan-records`, {
    headers: authHeaders(auth)
  });
  assert.equal(loanRecords.status, 200, JSON.stringify(loanRecords.payload, null, 2));
  assert.ok(loanRecords.payload.items.some((item) => item.loanRecordId === evidenceAllowed.payload.loanRecord.loanRecordId));
  assert.ok(loanRecords.payload.items.some((item) => item.loanRecordId === exportAllowed.payload.loanRecord.loanRecordId));

  const deniedRequests = await fetchJson(`${server.url}/api/knowledge/access/denied-requests`, {
    headers: authHeaders(auth)
  });
  assert.equal(deniedRequests.status, 200, JSON.stringify(deniedRequests.payload, null, 2));
  assert.ok(deniedRequests.payload.items.length >= 1, "denied export must be audited");

  const grant = await localMcpGrant(server.url, {
    label: "verify-v001-knowledge",
    toolsets: ["pact.agentLibrary.read", "pact.agentLibrary.write", "pact.agentLibrary.maintain"],
    grantMode: "maintain",
    targets: ["knowledge-v001"]
  }, { "x-pact-safety-confirm": "true" });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));
  const token = grant.payload.token;

  const capabilities = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation: "pact.capabilities.list",
        input: {}
      }
    }, "capabilities"))
  });
  assert.equal(capabilities.status, 200);
  const capabilityNames = new Set(capabilities.payload.result.structuredContent.operations.map((tool) => tool.name));
  for (const toolId of [
    "pact.agentLibrary.backend.connect",
    "pact.agentLibrary.space.list",
    "pact.agentLibrary.export.request",
    "pact.agentLibrary.permission.request"
  ]) {
    assert.equal(capabilityNames.has(toolId), true, `${toolId} must be visible through MCP capabilities`);
  }

  const mcpConnect = assertKnowledgeOk(await callKnowledgeOperation({
    serverUrl: server.url,
    token,
    operation: "pact.agentLibrary.backend.connect",
    input: {
      provider: "ragflow",
      secretRef: "secret://pact/knowledge/ragflow-api-key",
      mode: "contract"
    }
  }), "pact.agentLibrary.backend.connect");
  assert.equal(mcpConnect.provider.provider, "ragflow");

  const mcpSpaces = assertKnowledgeOk(await callKnowledgeOperation({
    serverUrl: server.url,
    token,
    operation: "pact.agentLibrary.space.list",
    input: {
      provider: "ragflow"
    }
  }), "pact.agentLibrary.space.list");
  assert.ok(mcpSpaces.spaces.every((space) => space.provider === "ragflow"));

  const mcpSearch = assertKnowledgeOk(await callKnowledgeOperation({
    serverUrl: server.url,
    token,
    operation: "pact.agentLibrary.search",
    input: {
      provider: "ragflow",
      knowledgeBackend: true,
      query: "contract policy",
      limit: 1
    }
  }), "pact.agentLibrary.search");
  assert.equal(mcpSearch.backendPort, "KnowledgeBasePort");
  assertSafeMetadataOnly(mcpSearch.items[0]);
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
  restoreCapabilityKernelEnv();
}

console.log("v0.0.1 knowledge backend E2E verification passed");
