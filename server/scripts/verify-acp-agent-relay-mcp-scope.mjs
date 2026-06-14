#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolManagementPlatform } from "../platform/specialized/capabilities/tools/tool-management-core/index.mjs";
import { createToolSkillManagementProvider } from "../platform/specialized/capabilities/skills/tool-skill-management-provider.mjs";
import {
  executeConsoleDomainOperation,
  getAcpAgentRelayRuntime
} from "../platform/specialized/console/console-domain-operation-executor.mjs";
import { ACP_METHODS } from "../platform/common/protocols/acp/index.mjs";
import {
  handlePactMcpHttpRequest,
  MCP_INTERFACE_VERSION,
  MCP_STABLE_TOOL_NAME
} from "../platform/common/mcp/http-mcp-adapter.mjs";

function nowIso() {
  return new Date().toISOString();
}

function assertRelayChildGrantTtl(grant, label = "relay child grant") {
  const expiresAtMs = Date.parse(grant.expiresAt || "");
  assert.equal(Number.isFinite(expiresAtMs), true, `${label} must have an explicit expiresAt`);
  assert.ok(expiresAtMs > Date.now(), `${label} must not be expired at issue time`);
  assert.ok(
    expiresAtMs <= Date.now() + 16 * 60 * 1000,
    `${label} must use the short default relay MCP TTL`
  );
  assert.equal(Number(grant.metadata?.relayMcpGrantMaxTtlMs || 0), 60 * 60 * 1000);
  assert.ok(Number(grant.metadata?.relayMcpGrantTtlMs || 0) <= 15 * 60 * 1000);
}

function parseProtocolPayload(requestBody, url = null) {
  if (requestBody?.length > 0) {
    return JSON.parse(requestBody.toString("utf8"));
  }
  return url ? Object.fromEntries(url.searchParams.entries()) : {};
}

function createCapturedHttpResponse() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = "") {
      if (chunk !== undefined && chunk !== null && chunk !== "") {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      this.ended = true;
    }
  };
}

function capturedJson(response) {
  const text = Buffer.concat(response.chunks || []).toString("utf8").trim();
  return text ? JSON.parse(text) : null;
}

async function callAgentRelayHttp({ platform, token, method = "GET", path: requestPath, body = null, headers = {} }) {
  const response = createCapturedHttpResponse();
  const url = new URL(requestPath, "http://127.0.0.1");
  const requestBody = body ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);
  const request = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "acp-agent-relay-mcp-scope-verifier",
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
  const handled = await platform.router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url,
    method
  });
  assert.equal(handled, true);
  return {
    status: response.statusCode,
    payload: capturedJson(response)
  };
}

async function approveHttpPendingOperation({ platform, token, pendingOperationId }) {
  return callAgentRelayHttp({
    platform,
    token,
    method: "POST",
    path: `/api/tool-management/v1/pending-operations/${encodeURIComponent(pendingOperationId)}/resolve`,
    headers: {
      "x-pact-safety-confirm": "true"
    },
    body: {
      resolution: "approved",
      resolvedBy: "acp-agent-relay-mcp-scope-verifier"
    }
  });
}

async function callMcpTool({ toolSkillManagementProvider, headers = {}, operation, input = {}, relayMcp = null }) {
  const response = createCapturedHttpResponse();
  const normalizedHeaders = {
    ...headers,
    ...(headers.Authorization ? { authorization: headers.Authorization } : {}),
    ...(headers["X-Pact-Relay-Mcp-Grant-Id"] ? { "x-pact-relay-mcp-grant-id": headers["X-Pact-Relay-Mcp-Grant-Id"] } : {}),
    ...(headers["X-Pact-Relay-Session-Id"] ? { "x-pact-relay-session-id": headers["X-Pact-Relay-Session-Id"] } : {}),
    ...(headers["X-Pact-Relay-Turn-Id"] ? { "x-pact-relay-turn-id": headers["X-Pact-Relay-Turn-Id"] } : {}),
    ...(headers["X-Pact-Virtual-Agent-Id"] ? { "x-pact-virtual-agent-id": headers["X-Pact-Virtual-Agent-Id"] } : {}),
    ...(headers["X-Pact-Target-Agent-Id"] ? { "x-pact-target-agent-id": headers["X-Pact-Target-Agent-Id"] } : {}),
    ...(headers["X-Pact-Relay-Operation-Id"] ? { "x-pact-relay-operation-id": headers["X-Pact-Relay-Operation-Id"] } : {}),
    ...(headers["X-Pact-Trace-Id"] ? { "x-pact-trace-id": headers["X-Pact-Trace-Id"] } : {})
  };
  const requestBody = Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    id: `mcp-call-${Date.now()}`,
    method: "tools/call",
    params: {
      name: MCP_STABLE_TOOL_NAME,
      arguments: {
        apiVersion: MCP_INTERFACE_VERSION,
        operation,
        input,
        ...(relayMcp ? { relayMcp } : {})
      }
    }
  }));
  await handlePactMcpHttpRequest({
    request: {
      method: "POST",
      headers: {
        "user-agent": "pact-acp-relay-mcp-scope-verifier",
        ...normalizedHeaders
      },
      socket: { remoteAddress: "127.0.0.1" }
    },
    response,
    requestBody,
    method: "POST",
    url: new URL("http://127.0.0.1:7228/mcp"),
    toolSkillManagementProvider
  });
  return {
    status: response.statusCode,
    payload: capturedJson(response)
  };
}

function createAllowAllSecurityPermissions() {
  return {
    evaluatePolicy() {
      return {
        effect: "allow",
        allowed: true,
        reasonCode: "verifier_allowed",
        redactedReason: "Allowed by ACP relay MCP scope verifier.",
        missingScopes: [],
        missingToolsets: [],
        evaluatedLayers: ["verifier"],
        createdAt: nowIso(),
        effectivePolicySnapshot: {
          policyRevision: {
            protocolVersion: "v0.0.1:test:authorization-verifier-1",
            revision: 1,
            updatedAt: nowIso()
          }
        }
      };
    },
    getGovernancePolicyRevision() {
      return {
        protocolVersion: "v0.0.1:test:authorization-verifier-1",
        revision: 1,
        updatedAt: nowIso()
      };
    },
    appendDecision() {}
  };
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-relay-mcp-scope-"));
const userDataPath = path.join(tempRoot, "user-data");
const workspaceRoot = path.join(tempRoot, "workspace");
await fs.mkdir(workspaceRoot, { recursive: true });

let platform = null;
let providerCore = null;
const provider = {
  handleToolManagementHttpRequest(args) {
    return platform.router.handleToolManagementHttpRequest(args);
  },
  createAuthorizationGrant(input = {}) {
    return providerCore.createAuthorizationGrant(input);
  },
  revokeAuthorizationGrant(input = {}) {
    return providerCore.revokeAuthorizationGrant(input);
  },
  createRelayMcpGrant(input = {}) {
    return providerCore.createRelayMcpGrant(input);
  },
  revokeRelayMcpGrant(input = {}) {
    return providerCore.revokeRelayMcpGrant(input);
  }
};

try {
  platform = createToolManagementPlatform({
    userDataPath,
    operations: SERVER_API_OPERATIONS,
    controllers: {
      system: {
        async handleGetRuntimeInfo({ response }) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({
            schemaVersion: "v0.0.1:schema:definition-1",
            result: {
              ok: true,
              runtime: "acp-agent-relay-mcp-scope-verifier"
            }
          }));
        },
        async handleToolManagementPassthrough({ operation, request, response, requestBody, url, params = {} }) {
          const operationResult = await executeConsoleDomainOperation({
            operationId: operation?.id || "",
            input: {
              ...parseProtocolPayload(requestBody, url),
              ...(params && typeof params === "object" ? params : {})
            },
            context: {
              userDataPath,
              workspaceRoot,
              request,
              response,
              requestBody,
              url,
              method: operation?.http?.method || request?.method || "GET",
              toolSkillManagementProvider: provider
            }
          });
          if (operationResult.payload?.__responseHandled) {
            return;
          }
          response.writeHead(operationResult.status || 200, { "content-type": "application/json" });
          response.end(JSON.stringify(operationResult.payload ?? operationResult));
        }
      }
    },
    securityPermissions: createAllowAllSecurityPermissions(),
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    }
  });
  providerCore = createToolSkillManagementProvider({
    toolManagementPlatform: platform,
    userDataPath
  });

  const sourceGrant = await platform.store.createGrant({
    label: "ACP Relay MCP Scope Source",
    type: "machine",
    toolsets: ["pact.agent.relay", "pact.runtime.read"],
    scopes: ["agent_relay:view", "agent_relay:operate", "storage:read", "jobs:read"],
    metadata: {
      agentId: "codex-mcp-scope-verifier"
    }
  });
  const sourceGrantHeaders = {
    "x-pact-agent-id": "codex-mcp-scope-verifier"
  };

  await platform.store.createGrant({
    id: "relay_mcp_collision_existing",
    label: "Existing Relay MCP Child Grant Collision Fixture",
    type: "relay-mcp-child",
    scopes: ["storage:read"],
    toolsets: ["pact.runtime.read"],
    metadata: {
      issuedBy: "pact-acp-agent-relay",
      relayMcp: true,
      relaySessionId: "existing-relay-session-owner",
      sourceGrantId: sourceGrant.grant.id,
      virtualAgentId: "antigravity.multimodal-coding",
      targetId: "mock.antigravity:stdio"
    }
  });
  const childGrantCollision = await providerCore.createRelayMcpGrant({
    grantId: "relay_mcp_collision_existing",
    session: {
      relaySessionId: "new-relay-session-owner",
      sourceId: "codex-mcp-scope-verifier",
      sourceSessionId: "new-source-session-owner",
      sourceSubjectId: "codex-mcp-scope-verifier",
      workspaceId: "mcp-scope-workspace"
    },
    route: {
      virtualAgent: { virtualAgentId: "antigravity.multimodal-coding" },
      target: { targetId: "mock.antigravity:stdio" },
      workspaceId: "mcp-scope-workspace"
    },
    sourceAuthorization: {
      ok: true,
      grant: sourceGrant.grant
    },
    scopes: ["storage:read"],
    toolsets: ["pact.runtime.read"],
    relayTurnId: "relay_turn_collision",
    parentOperationId: "acp_agent_relay.prompt.send"
  });
  assert.equal(childGrantCollision.ok, false);
  assert.equal(childGrantCollision.error?.code, "relay_mcp_grant_id_collision");
  assert.equal(
    platform.store.getGrant("relay_mcp_collision_existing").metadata.relaySessionId,
    "existing-relay-session-owner"
  );

  const create = await callAgentRelayHttp({
    platform,
    token: sourceGrant.token,
    method: "POST",
    path: "/api/agent-relay/v1/sessions",
    headers: sourceGrantHeaders,
    body: {
      virtualAgentId: "antigravity.multimodal-coding",
      sourceId: "codex-mcp-scope-verifier",
      sourceSessionId: "mcp-scope-source-session",
      workspaceId: "mcp-scope-workspace"
    }
  });
  assert.equal(create.status, 200, JSON.stringify(create.payload));
  assert.equal(create.payload.status, "ok");
  assert.equal(create.payload.result.ok, true);
  const relaySessionId = create.payload.result.data.session.relaySessionId;

  const promptPending = await callAgentRelayHttp({
    platform,
    token: sourceGrant.token,
    method: "POST",
    path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/prompt`,
    headers: {
      ...sourceGrantHeaders,
      "x-pact-safety-confirm": "true"
    },
    body: {
      prompt: "verify relay-scoped MCP child grant",
      relayMcpToolsets: ["pact.runtime.read"],
      relayMcpScopes: ["storage:read", "runtime:admin"],
      sourceMcpToken: "source-mcp-secret-must-not-reach-target",
      upstreamToken: "upstream-secret-must-not-reach-target"
    }
  });
  assert.equal(promptPending.status, 202, JSON.stringify(promptPending.payload));
  assert.equal(promptPending.payload.status, "pending_approval");
  assert.equal(promptPending.payload.pendingOperation.status, "pending");
  assert.equal(promptPending.payload.pendingOperation.operationId, "acp_agent_relay.prompt.send");
  assert.equal(Object.hasOwn(promptPending.payload.pendingOperation, "originalInput"), false);
  const promptPendingStored = platform.store.getPendingOperation(
    promptPending.payload.pendingOperation.pendingOperationId,
    { includeOriginalInput: true }
  );
  const promptPendingOriginalInputJson = JSON.stringify(promptPendingStored.originalInput || {});
  for (const forbidden of [
    "sourceMcpToken",
    "upstreamToken",
    "source-mcp-secret-must-not-reach-target",
    "upstream-secret-must-not-reach-target"
  ]) {
    assert.equal(promptPendingOriginalInputJson.includes(forbidden), false);
  }

  const prompt = await approveHttpPendingOperation({
    platform,
    token: sourceGrant.token,
    pendingOperationId: promptPending.payload.pendingOperation.pendingOperationId
  });
  assert.equal(prompt.status, 200, JSON.stringify(prompt.payload));
  assert.equal(prompt.payload.status, "ok");
  assert.equal(prompt.payload.pendingOperation.status, "completed");
  assert.ok(prompt.payload.pendingOperation.resumedToolExecutionId);
  assert.equal(prompt.payload.result.ok, true);
  assert.equal(prompt.payload.result.data.session.relaySessionId, relaySessionId);

  const runtime = await getAcpAgentRelayRuntime({ userDataPath, workspaceRoot });
  const connections = Array.from(runtime.sessionDriver.connections.values());
  const connection = connections.find((candidate) =>
    Array.isArray(candidate.messages) &&
      candidate.messages.some((entry) => entry.message?.params?.relaySessionId === relaySessionId)
  );
  assert.ok(connection, "target connection must be available for relay MCP projection inspection");
  const initializeMessage = connection.messages.find((entry) => entry.message?.method === ACP_METHODS.initialize);
  const promptMessage = connection.messages.find((entry) => entry.message?.method === ACP_METHODS.sessionPrompt);
  assert.ok(initializeMessage, "target initialize must be recorded");
  assert.ok(promptMessage, "target prompt must be recorded");

  const initializeParams = initializeMessage.message.params;
  const promptParams = promptMessage.message.params;
  const relayGrantId = prompt.payload.result.data.session.relayMcpGrantId;
  const relayTurnId = prompt.payload.result.data.turn.relayTurnId;
  assert.ok(relayTurnId, "prompt must expose a relay turn id for child-operation binding");
  assert.equal(initializeParams.relayMcp.grantId, relayGrantId);
  assert.equal(promptParams.relayMcp.grantId, relayGrantId);
  assert.equal(initializeParams.relayMcp.relayTurnId, relayTurnId);
  assert.equal(promptParams.relayMcp.relayTurnId, relayTurnId);
  assert.equal(promptParams.relayMcp.childOperation.relayTurnId, relayTurnId);
  assert.equal(promptParams.relayMcp.childOperation.relayMcpGrantId, relayGrantId);
  assert.equal(promptParams.relayMcp.childOperation.virtualAgentId, "antigravity.multimodal-coding");
  assert.match(initializeParams.mcpServers.pact.headers.Authorization, /^Bearer\s+\S+/);
  assert.equal(promptParams.mcpServers.pact.headers.Authorization, initializeParams.mcpServers.pact.headers.Authorization);
  assert.equal(initializeParams.mcpServers.pact.authorization.mode, "relay-managed");
  assert.equal(initializeParams.mcpServers.pact.authorization.credential, "bearer");
  assert.equal(initializeParams.mcpServers.pact.headers["X-Pact-Relay-Mcp-Grant-Id"], relayGrantId);
  assert.equal(initializeParams.mcpServers.pact.headers["X-Pact-Relay-Turn-Id"], relayTurnId);
  assert.equal(promptParams.mcpServers.pact.headers["X-Pact-Relay-Turn-Id"], relayTurnId);
  assert.equal(JSON.stringify([initializeParams, promptParams]).includes("source-mcp-secret-must-not-reach-target"), false);
  assert.equal(JSON.stringify([initializeParams, promptParams]).includes("upstream-secret-must-not-reach-target"), false);

  const childToken = initializeParams.mcpServers.pact.headers.Authorization.replace(/^Bearer\s+/, "");
  const childAuthorization = await platform.store.authorizeRequest({
    request: {
      headers: {
        authorization: initializeParams.mcpServers.pact.headers.Authorization
      },
      socket: { remoteAddress: "127.0.0.1" }
    },
    requiredScopes: ["storage:read"]
  });
  assert.equal(childAuthorization.ok, true);
  assert.equal(childAuthorization.grant.id, relayGrantId);
  assert.equal(childAuthorization.grant.type, "relay-mcp-child");
  assert.equal(childAuthorization.grant.toolsets.includes("pact.runtime.read"), true);
  assert.equal(childAuthorization.grant.toolsets.includes("pact.agent.relay"), false);
  assert.equal(childAuthorization.grant.scopes.includes("storage:read"), true);
  assert.equal(childAuthorization.grant.scopes.includes("runtime:admin"), false);
  assert.equal(childAuthorization.grant.metadata.issuedBy, "pact-acp-agent-relay");
  assert.equal(childAuthorization.grant.metadata.sourceGrantId, sourceGrant.grant.id);
  assert.equal(childAuthorization.grant.metadata.relaySessionId, relaySessionId);
  assert.equal(childAuthorization.grant.metadata.relayTurnId, relayTurnId);
  assertRelayChildGrantTtl(childAuthorization.grant, "initial relay child grant");

  const mcpCall = await callMcpTool({
    toolSkillManagementProvider: providerCore,
    headers: initializeParams.mcpServers.pact.headers,
    operation: "pact.runtime.info",
    input: {},
    relayMcp: promptParams.relayMcp
  });
  assert.equal(mcpCall.status, 200, JSON.stringify(mcpCall.payload));
  assert.equal(Boolean(mcpCall.payload.error), false, JSON.stringify(mcpCall.payload));
  assert.equal(Boolean(mcpCall.payload.result), true, JSON.stringify(mcpCall.payload));
  const childAudit = platform.store.listAudit({
    toolId: "pact.runtime.info",
    grantId: relayGrantId,
    status: "ok",
    limit: 5
  }).find((entry) => entry.resultSummary?.relayChildOperation?.relayTurnId === relayTurnId);
  assert.ok(childAudit, "target MCP tool call audit must be readable");
  const relayChildOperation = childAudit.resultSummary.relayChildOperation;
  assert.equal(relayChildOperation.binding, "v0.0.1:agent:acp-agent-relay-child-operation-1");
  assert.equal(relayChildOperation.relaySessionId, relaySessionId);
  assert.equal(relayChildOperation.relayTurnId, relayTurnId);
  assert.equal(relayChildOperation.virtualAgentId, "antigravity.multimodal-coding");
  assert.equal(relayChildOperation.targetId, "mock.antigravity:stdio");
  assert.equal(relayChildOperation.relayMcpGrantId, relayGrantId);
  assert.equal(relayChildOperation.grantBindingVerified, true);
  assert.deepEqual(relayChildOperation.requestBindingMismatches, []);
  assert.equal(relayChildOperation.parentOperationId, "acp_agent_relay.prompt.send");
  assert.equal(relayChildOperation.operationId, "runtime.info");

  const mismatchedMcpCall = await callMcpTool({
    toolSkillManagementProvider: providerCore,
    headers: initializeParams.mcpServers.pact.headers,
    operation: "pact.runtime.info",
    input: {},
    relayMcp: {
      ...promptParams.relayMcp,
      childOperation: {
        ...promptParams.relayMcp.childOperation,
        relayTurnId: "relay_turn_spoofed_mismatch"
      }
    }
  });
  assert.equal(mismatchedMcpCall.status, 200, JSON.stringify(mismatchedMcpCall.payload));
  assert.equal(mismatchedMcpCall.payload.error?.data?.code, "relay_child_operation_binding_mismatch");
  assert.deepEqual(mismatchedMcpCall.payload.error?.data?.requestBindingMismatches, ["relayTurnId"]);

  const forbiddenScope = await platform.store.authorizeRequest({
    request: {
      headers: {
        authorization: initializeParams.mcpServers.pact.headers.Authorization
      },
      socket: { remoteAddress: "127.0.0.1" }
    },
    tool: platform.registry.getTool("pact.agentRelay.session.create")
  });
  assert.equal(forbiddenScope.ok, false);
  assert.equal(
    forbiddenScope.missingCapabilities.includes("cap:tool:pact.agentRelay.session.create:execute"),
    true
  );

  const persistedStorePath = path.join(userDataPath, "agent-relay", "acp-relay-store.json");
  const persistedStore = JSON.parse(await fs.readFile(persistedStorePath, "utf8"));
  const persistedSession = persistedStore.sessions[relaySessionId];
  assert.equal(Boolean(persistedSession), true);
  const persistedSerialized = JSON.stringify(persistedSession);
  assert.equal(persistedSerialized.includes(childToken), false);
  assert.equal(persistedSerialized.includes("source-mcp-secret-must-not-reach-target"), false);
  assert.equal(persistedSerialized.includes("upstream-secret-must-not-reach-target"), false);
  assert.equal(persistedSession.metadata.relayMcpGrant.tokenPersisted, false);

  const closedRuntimeConnections = await runtime.close();
  assert.equal(closedRuntimeConnections.ok, true);

  const secondPromptPending = await callAgentRelayHttp({
    platform,
    token: sourceGrant.token,
    method: "POST",
    path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/prompt`,
    headers: {
      ...sourceGrantHeaders,
      "x-pact-safety-confirm": "true"
    },
    body: {
      prompt: "verify relay-scoped MCP child grant reissue after connection loss",
      relayMcpToolsets: ["pact.runtime.read"],
      relayMcpScopes: ["storage:read"]
    }
  });
  assert.equal(secondPromptPending.status, 202, JSON.stringify(secondPromptPending.payload));
  assert.equal(secondPromptPending.payload.status, "pending_approval");
  assert.equal(secondPromptPending.payload.pendingOperation.status, "pending");
  assert.equal(secondPromptPending.payload.pendingOperation.operationId, "acp_agent_relay.prompt.send");
  assert.equal(Object.hasOwn(secondPromptPending.payload.pendingOperation, "originalInput"), false);

  const secondPrompt = await approveHttpPendingOperation({
    platform,
    token: sourceGrant.token,
    pendingOperationId: secondPromptPending.payload.pendingOperation.pendingOperationId
  });
  assert.equal(secondPrompt.status, 200, JSON.stringify(secondPrompt.payload));
  assert.equal(secondPrompt.payload.status, "ok");
  assert.equal(secondPrompt.payload.pendingOperation.status, "completed");
  assert.ok(secondPrompt.payload.pendingOperation.resumedToolExecutionId);
  assert.equal(secondPrompt.payload.result.ok, true);
  assert.equal(secondPrompt.payload.result.data.session.relayMcpGrantId, relayGrantId);

  const rewokenConnections = Array.from(runtime.sessionDriver.connections.values());
  const rewokenConnection = rewokenConnections.find((candidate) =>
    Array.isArray(candidate.messages) &&
      candidate.messages.some((entry) =>
        entry.message?.params?.relaySessionId === relaySessionId &&
          JSON.stringify(entry.message?.params || {}).includes("reissue after connection loss")
      )
  );
  assert.ok(rewokenConnection, "target connection must be rebuilt for relay MCP token reissue inspection");
  const rewokenInitializeMessage = rewokenConnection.messages.find((entry) => entry.message?.method === ACP_METHODS.initialize);
  const rewokenPromptMessage = [...rewokenConnection.messages]
    .reverse()
    .find((entry) => entry.message?.method === ACP_METHODS.sessionPrompt);
  assert.ok(rewokenInitializeMessage, "rewoken target initialize must be recorded");
  assert.ok(rewokenPromptMessage, "rewoken target prompt must be recorded");
  const rewokenInitializeParams = rewokenInitializeMessage.message.params;
  const rewokenPromptParams = rewokenPromptMessage.message.params;
  assert.equal(rewokenInitializeParams.relayMcp.grantId, relayGrantId);
  assert.equal(rewokenPromptParams.relayMcp.grantId, relayGrantId);
  assert.match(rewokenInitializeParams.mcpServers.pact.headers.Authorization, /^Bearer\s+\S+/);
  assert.equal(
    rewokenPromptParams.mcpServers.pact.headers.Authorization,
    rewokenInitializeParams.mcpServers.pact.headers.Authorization
  );
  assert.notEqual(
    rewokenInitializeParams.mcpServers.pact.headers.Authorization,
    initializeParams.mcpServers.pact.headers.Authorization,
    "relay MCP bearer must be reissued after the non-persisted token is lost"
  );
  const secondChildToken = rewokenInitializeParams.mcpServers.pact.headers.Authorization.replace(/^Bearer\s+/, "");
  const oldChildAfterReissue = await platform.store.authorizeRequest({
    request: {
      headers: {
        authorization: initializeParams.mcpServers.pact.headers.Authorization
      },
      socket: { remoteAddress: "127.0.0.1" }
    },
    requiredScopes: ["storage:read"]
  });
  assert.equal(oldChildAfterReissue.ok, false);
  const secondChildAuthorization = await platform.store.authorizeRequest({
    request: {
      headers: {
        authorization: rewokenInitializeParams.mcpServers.pact.headers.Authorization
      },
      socket: { remoteAddress: "127.0.0.1" }
    },
    requiredScopes: ["storage:read"]
  });
  assert.equal(secondChildAuthorization.ok, true);
  assert.equal(secondChildAuthorization.grant.id, relayGrantId);
  assertRelayChildGrantTtl(secondChildAuthorization.grant, "reissued relay child grant");

  const persistedStoreAfterReissue = JSON.parse(await fs.readFile(persistedStorePath, "utf8"));
  const persistedSessionAfterReissue = persistedStoreAfterReissue.sessions[relaySessionId];
  assert.equal(JSON.stringify(persistedSessionAfterReissue).includes(secondChildToken), false);
  assert.equal(persistedSessionAfterReissue.metadata.relayMcpGrant.tokenPersisted, false);

  const sourceCloseAuthorization = await platform.store.authorizeRequest({
    request: {
      headers: {
        authorization: `Bearer ${sourceGrant.token}`,
        ...sourceGrantHeaders
      },
      socket: { remoteAddress: "127.0.0.1" }
    },
    tool: platform.registry.getTool("pact.agentRelay.session.close")
  });
  assert.equal(sourceCloseAuthorization.ok, true, JSON.stringify(sourceCloseAuthorization));

  const close = await callAgentRelayHttp({
    platform,
    token: sourceGrant.token,
    method: "POST",
    path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/close`,
    headers: sourceGrantHeaders,
    body: {
      reason: "mcp scope verifier close"
    }
  });
  assert.equal(close.status, 200, JSON.stringify(close.payload));
  assert.equal(close.payload.status, "ok");
  assert.equal(close.payload.result.ok, true);
  assert.equal(close.payload.result.data.relayMcpGrantRevoke.enabled, false);

  const revokedGrant = platform.store.getGrant(relayGrantId);
  assert.equal(revokedGrant.enabled, false);
  assert.ok(revokedGrant.revokedAt);
  const afterRevoke = await platform.store.authorizeRequest({
    request: {
      headers: {
        authorization: rewokenInitializeParams.mcpServers.pact.headers.Authorization
      },
      socket: { remoteAddress: "127.0.0.1" }
    },
    requiredScopes: ["storage:read"]
  });
  assert.equal(afterRevoke.ok, false);

  console.log(JSON.stringify({
    ok: true,
    verifier: "acp-agent-relay-mcp-scope",
    relaySessionId,
    relayMcpGrantId: relayGrantId,
    childGrantRevoked: true,
    childGrantReissuedAfterConnectionLoss: true,
    childGrantHasExplicitTtl: true,
    childGrantCollisionRejected: true,
    targetMcpToolCallBoundToRelayTurn: true,
    mismatchedChildOperationRejected: true,
    tokenPersisted: false,
    sourceTokenLeaked: false
  }, null, 2));
} finally {
  if (platform) {
    platform.close();
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}
