#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolManagementPlatform } from "../platform/specialized/capabilities/tools/tool-management-core/index.mjs";
import { executeConsoleDomainOperation } from "../platform/specialized/console/console-domain-operation-executor.mjs";

function nowIso() {
  return new Date().toISOString();
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
    setHeader(name, value) {
      this.headers[name] = value;
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

function allowAllSecurityPermissions() {
  return {
    evaluatePolicy({ operation = null, tool = null, grant = null } = {}) {
      return {
        effect: "allow",
        allowed: true,
        reasonCode: "verifier_allowed",
        redactedReason: "Allowed by ACP agent relay Tool Management verifier.",
        missingScopes: [],
        missingToolsets: [],
        missingCapabilities: [],
        evaluatedLayers: ["verifier"],
        createdAt: nowIso(),
        subject: grant
          ? { type: "tool-grant", subjectId: grant.id, scopes: grant.scopes || [] }
          : { type: "verifier", subjectId: "acp-relay-tool-management-verifier" },
        resource: {
          toolId: tool?.id || "",
          operationId: operation?.id || tool?.operationId || ""
        },
        effectivePolicySnapshot: {
          policyRevision: {
            protocolVersion: "pact.verifier.authorization.v1",
            revision: 1,
            updatedAt: nowIso()
          }
        }
      };
    },
    getGovernancePolicyRevision() {
      return {
        protocolVersion: "pact.verifier.authorization.v1",
        revision: 1,
        updatedAt: nowIso()
      };
    },
    appendDecision() {}
  };
}

async function callToolManagementHttp({ platform, token = "", method = "POST", path: routePath = "", body = {}, headers = {} }) {
  const requestBody = method === "GET" ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body || {}), "utf8");
  const response = createCapturedHttpResponse();
  const request = {
    __pactRequestId: `verify-acp-relay-tool-management-${Date.now()}`,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "user-agent": "pact-acp-agent-relay-tool-management-verifier",
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
  const url = new URL(routePath, "http://127.0.0.1");
  const handled = await platform.router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url,
    method
  });
  assert.equal(handled, true, `Tool Management route was not handled: ${method} ${routePath}`);
  return {
    status: response.statusCode,
    payload: capturedJson(response)
  };
}

async function executeTool({ platform, token, toolId, input = {}, context = {} }) {
  const response = await callToolManagementHttp({
    platform,
    token,
    method: "POST",
    path: "/api/tool-management/v1/execute",
    body: {
      toolId,
      input,
      context
    }
  });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  assert.equal(response.payload.status, "ok", JSON.stringify(response.payload));
  assert.equal(response.payload.toolId, toolId);
  return response.payload;
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-relay-tool-management-"));
const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-relay-tool-management-ws-"));
let platform = null;
const httpProvider = {
  handleToolManagementHttpRequest(args) {
    return platform.router.handleToolManagementHttpRequest(args);
  }
};
const controllers = {
  system: {
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
          toolSkillManagementProvider: httpProvider
        }
      });
      if (operationResult.payload?.__responseHandled) {
        return;
      }
      response.writeHead(operationResult.status || 200, { "content-type": "application/json" });
      response.end(JSON.stringify(operationResult.payload ?? operationResult));
    }
  }
};

platform = createToolManagementPlatform({
  userDataPath,
  operations: SERVER_API_OPERATIONS,
  controllers,
  securityPermissions: allowAllSecurityPermissions(),
  logger: {
    debug() {},
    info() {},
    warn() {},
    error() {}
  }
});

try {
  const trusted = {
    sourceId: "trusted-tool-source",
    workspaceId: "trusted-tool-workspace",
    sourceSessionId: "trusted-tool-source-session",
    sourceSubjectId: "trusted-tool-subject",
    agentProfileId: "trusted-tool-agent-profile",
    credentialRef: "credential://pact/verifier/tool-management-source"
  };
  const spoofed = {
    sourceId: "spoofed-request-source",
    workspaceId: "spoofed-request-workspace",
    sourceSessionId: "spoofed-request-session",
    sourceSubjectId: "spoofed-request-subject"
  };
  const issued = await platform.store.createGrant({
    label: "ACP Relay Tool Management Source Verifier",
    type: "machine",
    toolsets: ["pact.agent.relay"],
    scopes: ["agent_relay:view", "agent_relay:operate"],
    maxRisk: "repair_write",
    metadata: trusted
  });
  const { grant, token } = issued;

  const list = await executeTool({
    platform,
    token,
    toolId: "pact.agentRelay.virtualAgents.list",
    input: spoofed,
    context: { profileId: trusted.agentProfileId }
  });
  assert.equal(list.result.ok, true);
  assert.equal(
    list.result.data.virtualAgents.some((agent) => agent.virtualAgentId === "antigravity.repo-analysis"),
    true
  );

  const created = await executeTool({
    platform,
    token,
    toolId: "pact.agentRelay.session.create",
    input: {
      ...spoofed,
      virtualAgentId: "antigravity.repo-analysis",
      requestedMode: "ask"
    },
    context: { profileId: trusted.agentProfileId }
  });
  assert.equal(created.result.ok, true, JSON.stringify(created.result));
  const relaySession = created.result.data.session;
  assert.equal(relaySession.sourceId, trusted.sourceId);
  assert.equal(relaySession.workspaceId, trusted.workspaceId);
  assert.equal(relaySession.sourceSessionId, trusted.sourceSessionId);
  assert.equal(relaySession.sourceSubjectId, trusted.sourceSubjectId);
  assert.equal(relaySession.metadata.sourceAuthContext.sourceId, trusted.sourceId);
  assert.equal(relaySession.metadata.sourceAuthContext.workspaceId, trusted.workspaceId);
  assert.equal(relaySession.metadata.sourceAuthContext.sourceSubjectId, trusted.sourceSubjectId);
  assert.equal(relaySession.metadata.sourceAuthContext.grantId, grant.id);
  assert.equal(relaySession.metadata.sourceAuthContext.credentialRef, trusted.credentialRef);
  assert.equal(JSON.stringify(relaySession).includes(spoofed.sourceId), false);
  assert.equal(JSON.stringify(relaySession).includes(spoofed.workspaceId), false);

  const prompt = await executeTool({
    platform,
    token,
    toolId: "pact.agentRelay.prompt",
    input: {
      ...spoofed,
      sessionId: relaySession.relaySessionId,
      prompt: "Tool Management source grant should own this ACP relay turn.",
      requestReasoning: false,
      confirm: true
    },
    context: { profileId: trusted.agentProfileId }
  });
  assert.equal(prompt.result.ok, true, JSON.stringify(prompt.result));
  assert.equal(prompt.result.data.session.sourceId, trusted.sourceId);
  assert.equal(prompt.result.data.session.workspaceId, trusted.workspaceId);
  assert.equal(prompt.result.data.communicationSummary.sourceId, trusted.sourceId);
  assert.equal(prompt.result.data.communicationSummary.sourceSessionId, trusted.sourceSessionId);
  assert.equal(prompt.result.data.communicationSummary.reasoningIncluded, false);
  assert.equal(prompt.result.data.communicationSummary.outputAvailable, true);
  assert.equal(prompt.result.data.targetEvidence.targetId, "mock.repo-analysis:stdio");
  assert.ok(prompt.result.data.turn.relayTurnId);

  const sessions = await executeTool({
    platform,
    token,
    toolId: "pact.agentRelay.sessions.list",
    input: {
      ...spoofed,
      sourceId: spoofed.sourceId
    },
    context: { profileId: trusted.agentProfileId }
  });
  assert.equal(sessions.result.ok, true);
  assert.equal(sessions.result.data.sessions.length, 1);
  assert.equal(sessions.result.data.sessions[0].sourceId, trusted.sourceId);
  assert.equal(sessions.result.data.sessions[0].relaySessionId, relaySession.relaySessionId);

  const createAudit = platform.store.getAudit(created.toolExecutionId);
  const promptAudit = platform.store.getAudit(prompt.toolExecutionId);
  assert.equal(createAudit.grantId, grant.id);
  assert.equal(createAudit.subjectId, grant.id);
  assert.equal(createAudit.operationId, "acp_agent_relay.session.create");
  assert.equal(createAudit.status, "ok");
  assert.equal(promptAudit.grantId, grant.id);
  assert.equal(promptAudit.subjectId, grant.id);
  assert.equal(promptAudit.operationId, "acp_agent_relay.prompt.send");
  assert.equal(promptAudit.status, "ok");
  assert.equal(promptAudit.resultSummary.type, "object");
  assert.equal(promptAudit.redactedInput.sourceId, spoofed.sourceId);

  const metrics = platform.store.metricsSummary({
    grantId: grant.id,
    toolId: "pact.agentRelay.prompt"
  });
  assert.equal(metrics.toolCalls.byGrant[grant.id] >= 1, true);
  assert.equal(metrics.toolCalls.byTool["pact.agentRelay.prompt"] >= 1, true);
  assert.equal(metrics.toolCalls.byStatus.ok >= 1, true);

  console.log(JSON.stringify({
    ok: true,
    verifier: "acp-agent-relay-tool-management",
    relaySessionId: relaySession.relaySessionId,
    relayTurnId: prompt.result.data.turn.relayTurnId,
    grantId: grant.id,
    trustedSourceId: trusted.sourceId,
    spoofedSourceId: spoofed.sourceId,
    sourceIdentityBoundByGrant: true,
    toolExecutionIds: {
      list: list.toolExecutionId,
      create: created.toolExecutionId,
      prompt: prompt.toolExecutionId,
      sessions: sessions.toolExecutionId
    },
    auditBoundToGrant: true,
    metricsBoundToGrant: true,
    proof: "tool-management-grant-to-acp-relay-target-turn"
  }, null, 2));
} finally {
  platform.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
