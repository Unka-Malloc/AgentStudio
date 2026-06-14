import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { promisify } from "node:util";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";
import { CONSOLE_ROLES } from "../platform/common/security/auth/console-auth.mjs";
import { createAuthorizationGovernanceStore } from "../platform/common/security/authorization/authorization-governance-store.mjs";

const execFileAsync = promisify(execFile);

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function bearerHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
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

let mcpRequestId = 0;

async function callMcpStructured({ serverUrl, token, operation, input = {}, toolName = "pact.sharedspace" }) {
  mcpRequestId += 1;
  const response = await fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: toolName,
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation,
        input,
        clientVersion: "verify-tool-management-platform"
      }
    }, mcpRequestId))
  });
  assert.equal(response.status, 200, JSON.stringify(response.payload, null, 2));
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  return response.payload.result.structuredContent;
}

function assertDurationPercentiles(percentiles) {
  assert.ok(percentiles);
  assert.ok(percentiles.p50Ms >= 0);
  assert.ok(percentiles.p95Ms >= percentiles.p50Ms);
  assert.ok(percentiles.p99Ms >= percentiles.p95Ms);
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-"));
process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});
const authorizationGovernanceStore = createAuthorizationGovernanceStore({
  userDataPath,
  builtinRoles: CONSOLE_ROLES
});

try {
  await installAuthenticatedFetch(server);
  authorizationGovernanceStore.upsertTeam({
    teamId: "verify-tool-management-policy-revision",
    label: "Verify Tool Management Policy Revision"
  });
  const grantPolicyRevision = authorizationGovernanceStore.getPolicyRevision();
  assert.ok(grantPolicyRevision.revision > 0);

  const catalog = await fetchJson(`${server.url}/api/tool-management/v1/catalog`);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.payload.schemaVersion, "v0.0.1:schema:definition-1");
  assert.ok(catalog.payload.fingerprint);
  assert.ok(Array.isArray(catalog.payload.toolGroups));
  assert.ok(catalog.payload.toolGroups.some((group) => group.id === "pact.agentLibrary.read" && group.toolCount > 0));
  const toolIds = new Set(catalog.payload.tools.map((tool) => tool.id));
  assert.equal(toolIds.has("pact.runtime.info"), true);
  assert.equal(toolIds.has("pact.runtime.mounts"), true);
  assert.equal(toolIds.has("pact.runtime.mounts.set"), true);
  assert.equal(toolIds.has("pact.runtime.mounts.reload"), true);
  assert.equal(toolIds.has("pact.agentLibrary.health"), true);
  assert.equal(toolIds.has("pact.agentLibrary.search"), true);
  assert.equal(toolIds.has("agent-exploration.keyword_search"), true);
  assert.equal(toolIds.has("maintenance-agent.storage.doctor"), true);

  const toolsets = await fetchJson(`${server.url}/api/tool-management/v1/toolsets`);
  assert.equal(toolsets.status, 200);
  assert.ok(toolsets.payload.toolsets.some((toolset) => toolset.id === "pact.agentLibrary.read"));
  assert.ok(toolsets.payload.toolsets.some((toolset) =>
    toolset.id === "pact.runtime.maintain" && toolset.requiredScopes.includes("runtime:admin")
  ));
  const runtimeSetTool = catalog.payload.tools.find((tool) => tool.id === "pact.runtime.mounts.set");
  assert.deepEqual(runtimeSetTool.requiredScopes, ["runtime:admin"]);

  const grantResult = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-tool-management",
      scopes: ["knowledge:read"]
    })
  });
  assert.equal(grantResult.status, 201);
  assert.match(grantResult.payload.token, /^ock_[A-Za-z0-9_-]+$/);
  assert.equal(grantResult.payload.grant.hasToken, true);
  assert.equal(grantResult.payload.grant.scopes.includes("knowledge:read"), true);
  assert.equal(grantResult.payload.grant.credential.protocolVersion, "v0.0.1:risk-control:opaque-capability-key-1");
  assert.equal(grantResult.payload.grant.metadata.policyRevision, grantPolicyRevision.revision);
  assert.equal(
    grantResult.payload.grant.metadata.policyRevisionProtocolVersion,
    grantPolicyRevision.protocolVersion
  );
  assert.equal(grantResult.payload.grant.metadata.policyRevisionUpdatedAt, grantPolicyRevision.updatedAt);

  const forgedMcpAuthorizationRequest = await fetchJson(`${server.url}/api/mcp/authorization/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer forged-mcp-request-token"
    },
    body: JSON.stringify({
      clientName: "forged-mcp-client",
      requestedScopes: ["knowledge:read"]
    })
  });
  assert.equal(forgedMcpAuthorizationRequest.status, 401);
  assert.equal(forgedMcpAuthorizationRequest.payload.error.code, "invalid_token");

  const mcpAuthorizationGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-mcp-authorization-request",
      scopes: ["knowledge:read"]
    })
  });
  assert.equal(mcpAuthorizationGrant.status, 201);

  const mcpAuthorizationRequest = await fetchJson(`${server.url}/api/mcp/authorization/request`, {
    method: "POST",
    headers: bearerHeaders(mcpAuthorizationGrant.payload.token),
    body: JSON.stringify({
      clientName: "verify-mcp-client",
      requestedScopes: ["knowledge:read"],
      reason: "verify central external auth gate"
    })
  });
  assert.equal(mcpAuthorizationRequest.status, 200);
  assert.equal(mcpAuthorizationRequest.payload.status, "pending");
  assert.match(mcpAuthorizationRequest.payload.requestId, /^mcp_auth_req_/);

  const freshGrantPreview = await fetchJson(`${server.url}/api/tool-management/v1/policy/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      grantId: grantResult.payload.grant.id,
      input: {}
    })
  });
  assert.equal(freshGrantPreview.status, 200);
  assert.equal(freshGrantPreview.payload.decision.grantPolicyRevision, grantPolicyRevision.revision);
  assert.equal(freshGrantPreview.payload.decision.grantPolicyState, "fresh");
  assert.equal(
    freshGrantPreview.payload.decision.governancePolicyRevision.revision,
    grantPolicyRevision.revision
  );

  authorizationGovernanceStore.upsertTeam({
    teamId: "verify-tool-management-policy-revision-next",
    label: "Verify Tool Management Policy Revision Next"
  });
  const changedPolicyRevision = authorizationGovernanceStore.getPolicyRevision();
  assert.equal(changedPolicyRevision.revision > grantPolicyRevision.revision, true);
  const staleGrantPreview = await fetchJson(`${server.url}/api/tool-management/v1/policy/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      grantId: grantResult.payload.grant.id,
      input: {}
    })
  });
  assert.equal(staleGrantPreview.status, 200);
  assert.equal(staleGrantPreview.payload.decision.grantPolicyRevision, grantPolicyRevision.revision);
  assert.equal(staleGrantPreview.payload.decision.grantPolicyState, "stale");
  assert.equal(
    staleGrantPreview.payload.decision.governancePolicyRevision.revision,
    changedPolicyRevision.revision
  );

  const currentRevisionGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-current-policy-revision",
      scopes: ["knowledge:read"]
    })
  });
  assert.equal(currentRevisionGrant.status, 201);
  assert.equal(currentRevisionGrant.payload.grant.metadata.policyRevision, changedPolicyRevision.revision);
  const currentRevisionPreview = await fetchJson(`${server.url}/api/tool-management/v1/policy/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      grantId: currentRevisionGrant.payload.grant.id,
      input: {}
    })
  });
  assert.equal(currentRevisionPreview.status, 200);
  assert.equal(currentRevisionPreview.payload.decision.grantPolicyState, "fresh");

  const narrowGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-jobs-read-only",
      scopes: ["jobs:read"]
    })
  });
  assert.equal(narrowGrant.status, 201);
  assert.ok(narrowGrant.payload.token, `narrow grant must issue token: ${JSON.stringify(narrowGrant.payload)}`);

  const noToken = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.payload.error.code, "missing_token");

  const toolsetDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(narrowGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(toolsetDenied.status, 403, JSON.stringify(toolsetDenied.payload));
  assert.equal(toolsetDenied.payload.error.code, "missing_capabilities");
  assert.deepEqual(toolsetDenied.payload.error.details.missingCapabilities, [
    "cap:tool:pact.agentLibrary.health:execute"
  ]);

  const rateLimitedGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-rate-limit",
      scopes: ["knowledge:read"],
      toolAllow: ["pact.agentLibrary.health"],
      rateLimit: { perMinute: 1 }
    })
  });
  assert.equal(rateLimitedGrant.status, 201, JSON.stringify(rateLimitedGrant.payload));
  const rateFirst = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rateLimitedGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(rateFirst.status, 200, JSON.stringify(rateFirst.payload));
  const rateSecond = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rateLimitedGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(rateSecond.status, 429);
  assert.equal(rateSecond.payload.error.code, "rate_limited");

  const originGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-origin-boundary",
      scopes: ["knowledge:read"],
      toolAllow: ["pact.agentLibrary.health"],
      allowedOrigins: ["https://allowed.example"]
    })
  });
  assert.equal(originGrant.status, 201);
  const originDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(originGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(originDenied.status, 403);
  assert.equal(originDenied.payload.error.code, "origin_not_allowed");
  const originAllowed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      ...bearerHeaders(originGrant.payload.token),
      Origin: "https://allowed.example"
    },
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(originAllowed.status, 200);

  const boundGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-bound-agent-user",
      scopes: ["knowledge:read"],
      toolAllow: ["pact.agentLibrary.health"],
      metadata: {
        agentId: "agent-a",
        boundUserId: "user-a"
      }
    })
  });
  assert.equal(boundGrant.status, 201);
  assert.equal(boundGrant.payload.grant.credential.bindingProtocol, "v0.0.1:risk-control:capability-binding-guard-1");
  assert.equal(boundGrant.payload.grant.credential.bindingStrength, "user+agent");
  const boundAllowed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(boundGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      context: {
        agentId: "agent-a",
        userId: "user-a"
      },
      input: {}
    })
  });
  assert.equal(boundAllowed.status, 200);
  const boundWrongUser = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(boundGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      context: {
        agentId: "agent-a",
        userId: "user-b"
      },
      input: {}
    })
  });
  assert.equal(boundWrongUser.status, 403);
  assert.equal(boundWrongUser.payload.error.code, "binding_user_mismatch");

  const approvalGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-pending-operation-approval",
      toolsets: ["pact.agent.workspace.maintain"],
      scopes: ["workspace:maintain"],
      metadata: { maxRisk: "repair_write" }
    })
  });
  assert.equal(approvalGrant.status, 201);

  const forgedApprovalAttempt = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(approvalGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.workspaceGovernance.policy.set",
      context: {
        approval: { approved: true, pendingOperationId: "forged-pending-operation" },
        pendingOperationApproved: true,
        approvedPendingOperation: { pendingOperationId: "forged-pending-operation" },
        transport: "mcp",
        requirePendingOperation: false,
        pendingApprovalRequired: false,
        agentId: "approval-agent",
        source: "forged-approval-context",
        userDataPath: "/tmp/attacker-user-data",
        workspaceRoot: "/tmp/attacker-workspace",
        apiKey: "context-secret-must-not-persist",
        nested: { secret: "nested-secret-must-not-persist" }
      },
      input: {
        confirm: true,
        policy: {
          workspaceId: "tool-management-forged-approval-policy",
          organizationId: "verify-org",
          allowedSubjectIds: ["agent-a"]
        }
      }
    })
  });
  assert.equal(forgedApprovalAttempt.status, 202, JSON.stringify(forgedApprovalAttempt.payload, null, 2));
  assert.equal(forgedApprovalAttempt.payload.status, "pending_approval");
  assert.equal(forgedApprovalAttempt.payload.pendingOperation.status, "pending");
  assert.equal(forgedApprovalAttempt.payload.pendingOperation.toolId, "pact.workspaceGovernance.policy.set");
  assert.equal(forgedApprovalAttempt.payload.pendingOperation.context.source, "forged-approval-context");
  assert.equal(forgedApprovalAttempt.payload.pendingOperation.context.transport, "tool-http");
  const forgedPendingContextJson = JSON.stringify(forgedApprovalAttempt.payload.pendingOperation.context);
  assert.equal(forgedPendingContextJson.includes("userDataPath"), false);
  assert.equal(forgedPendingContextJson.includes("workspaceRoot"), false);
  assert.equal(forgedPendingContextJson.includes("context-secret-must-not-persist"), false);
  assert.equal(forgedPendingContextJson.includes("nested-secret-must-not-persist"), false);
  const governanceAfterForgedApproval = await fetchJson(`${server.url}/api/workspace-governance`);
  assert.equal(governanceAfterForgedApproval.status, 200);
  assert.equal(
    JSON.stringify(governanceAfterForgedApproval.payload).includes("tool-management-forged-approval-policy"),
    false,
    "external context approval flags must not execute a pending-approval tool"
  );
  const forgedApprovalCleanup = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations/${encodeURIComponent(forgedApprovalAttempt.payload.pendingOperation.pendingOperationId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      resolution: "rejected",
      resolvedBy: "verify-console",
      reason: "forged approval context must remain pending"
    })
  });
  assert.equal(forgedApprovalCleanup.status, 200, JSON.stringify(forgedApprovalCleanup.payload, null, 2));
  assert.equal(forgedApprovalCleanup.payload.pendingOperation.status, "rejected");

  const rejectedPending = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(approvalGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.workspaceGovernance.policy.set",
      context: {
        transport: "mcp",
        agentId: "approval-agent",
        idempotencyKey: "verify-rejected-policy"
      },
      input: {
        policy: {
          workspaceId: "tool-management-rejected-policy",
          organizationId: "verify-org",
          allowedSubjectIds: ["agent-a"]
        }
      }
    })
  });
  assert.equal(rejectedPending.status, 202, JSON.stringify(rejectedPending.payload, null, 2));
  assert.equal(rejectedPending.payload.status, "pending_approval");
  assert.equal(rejectedPending.payload.pendingOperation.status, "pending");
  assert.equal(rejectedPending.payload.pendingOperation.toolId, "pact.workspaceGovernance.policy.set");
  assert.equal(rejectedPending.payload.pendingOperation.grantId, approvalGrant.payload.grant.id);
  assert.equal(Object.hasOwn(rejectedPending.payload.pendingOperation, "originalInput"), false);

  const pendingOperations = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations?status=pending`);
  assert.equal(pendingOperations.status, 200);
  assert.ok(pendingOperations.payload.pendingOperations.some((item) =>
    item.pendingOperationId === rejectedPending.payload.pendingOperation.pendingOperationId &&
      item.status === "pending" &&
      item.redactedInput.type !== "raw"
  ));

  const rejectedResolution = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations/${encodeURIComponent(rejectedPending.payload.pendingOperation.pendingOperationId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      resolution: "rejected",
      resolvedBy: "verify-console",
      reason: "verify rejection path"
    })
  });
  assert.equal(rejectedResolution.status, 200, JSON.stringify(rejectedResolution.payload, null, 2));
  assert.equal(rejectedResolution.payload.pendingOperation.status, "rejected");
  assert.equal(rejectedResolution.payload.pendingOperation.errorCode, "pending_operation_rejected");

  const governanceAfterReject = await fetchJson(`${server.url}/api/workspace-governance`);
  assert.equal(governanceAfterReject.status, 200);
  assert.equal(
    JSON.stringify(governanceAfterReject.payload).includes("tool-management-rejected-policy"),
    false,
    "rejected pending operation must not execute the original tool"
  );

  const approvedPendingStructured = await callMcpStructured({
    serverUrl: server.url,
    token: approvalGrant.payload.token,
    toolName: "pact.discovery",
    operation: "pact.workspaceGovernance.policy.set",
    input: {
      policy: {
        workspaceId: "tool-management-approved-policy",
        organizationId: "verify-org",
        allowedSubjectIds: ["agent-a"],
        allowedActions: ["discover", "read", "copy"]
      }
    }
  });
  const approvedPending = approvedPendingStructured.payload;
  assert.equal(approvedPending.status, "pending_approval", JSON.stringify(approvedPendingStructured, null, 2));
  assert.equal(approvedPending.pendingOperation.status, "pending");
  assert.equal(approvedPending.pendingOperation.toolId, "pact.workspaceGovernance.policy.set");
  assert.equal(approvedPendingStructured.operation, "pact.workspaceGovernance.policy.set");
  const approvedResolution = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations/${encodeURIComponent(approvedPending.pendingOperation.pendingOperationId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      resolution: "approved",
      resolvedBy: "verify-console",
      reason: "verify approval path"
    })
  });
  assert.equal(approvedResolution.status, 200, JSON.stringify(approvedResolution.payload, null, 2));
  assert.equal(approvedResolution.payload.status, "ok");
  assert.equal(approvedResolution.payload.pendingOperation.status, "completed");
  assert.ok(approvedResolution.payload.pendingOperation.resumedToolExecutionId);

  const governanceAfterApprove = await fetchJson(`${server.url}/api/workspace-governance`);
  assert.equal(governanceAfterApprove.status, 200);
  assert.equal(
    JSON.stringify(governanceAfterApprove.payload).includes("tool-management-approved-policy"),
    true,
    "approved pending operation must resume and execute the original tool"
  );

  const approvalAudit = await fetchJson(`${server.url}/api/tool-management/v1/audit?limit=50`);
  assert.equal(approvalAudit.status, 200);
  assert.ok(approvalAudit.payload.items.some((item) =>
    item.approvalId === approvedPending.pendingOperation.pendingOperationId &&
      item.status === "pending_approval"
  ));
  assert.ok(approvalAudit.payload.items.some((item) =>
    item.toolExecutionId === approvedResolution.payload.pendingOperation.resumedToolExecutionId &&
      item.status === "ok"
  ));

  const executed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(grantResult.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      context: {
        profileId: "profile-metered"
      },
      input: {}
    })
  });
  assert.equal(executed.status, 200);
  assert.ok(executed.payload.toolExecutionId);
  assert.ok(executed.payload.traceId);
  assert.equal(executed.payload.status, "ok");
  assert.equal(executed.payload.result.ok, true);
  assert.equal(executed.payload.policy.grantPolicyRevision, grantPolicyRevision.revision);
  assert.equal(executed.payload.policy.grantPolicyState, "stale");
  assert.equal(executed.payload.policy.governancePolicyRevision.revision, changedPolicyRevision.revision);

  const executedAudit = await fetchJson(`${server.url}/api/tool-management/v1/audit/${encodeURIComponent(executed.payload.toolExecutionId)}`);
  assert.equal(executedAudit.status, 200);
  assert.equal(executedAudit.payload.audit.resultSummary.policy.grantPolicyRevision, grantPolicyRevision.revision);
  assert.equal(executedAudit.payload.audit.resultSummary.policy.grantPolicyState, "stale");
  assert.equal(
    executedAudit.payload.audit.resultSummary.policy.governancePolicyRevision.revision,
    changedPolicyRevision.revision
  );

  const audit = await fetchJson(`${server.url}/api/tool-management/v1/audit?limit=20`);
  assert.equal(audit.status, 200);
  assert.ok(audit.payload.items.some((item) => item.toolExecutionId === executed.payload.toolExecutionId));

  const metrics = await fetchJson(`${server.url}/api/tool-management/v1/metrics/summary`);
  assert.equal(metrics.status, 200);
  assert.ok(metrics.payload.metrics.callsTotal >= 2);
  assert.ok(metrics.payload.metrics.byStatus.ok >= 1);
  assert.ok(metrics.payload.metrics.byStatus.denied >= 1);
  assert.ok(metrics.payload.metrics.inputBytesTotal > 0);
  assert.ok(metrics.payload.metrics.resultBytesTotal > 0);
  assert.ok(metrics.payload.metrics.transferBytesTotal >= metrics.payload.metrics.inputBytesTotal);
  assert.ok(metrics.payload.metrics.toolCalls.inputBytesTotal > 0);
  assert.ok(metrics.payload.metrics.toolCalls.resultBytesTotal > 0);
  assert.ok(metrics.payload.metrics.toolCalls.averageBytesPerSecond >= 0);
  const grantUsage = metrics.payload.metrics.toolCalls.usageByGrant.find((item) =>
    item.grantId === grantResult.payload.grant.id
  );
  assert.ok(grantUsage);
  assert.ok(grantUsage.total >= 1);
  assert.ok(grantUsage.transferBytesTotal > 0);
  assert.ok(grantUsage.averageBytesPerSecond >= 0);
  assert.ok(grantUsage.failureRate >= 0);
  assertDurationPercentiles(grantUsage.durationPercentiles);
  const profileUsage = metrics.payload.metrics.toolCalls.usageByProfile.find((item) =>
    item.profileId === "profile-metered"
  );
  assert.ok(profileUsage);
  assert.ok(profileUsage.total >= 1);
  assert.ok(profileUsage.transferBytesTotal > 0);
  assertDurationPercentiles(profileUsage.durationPercentiles);
  assert.ok(metrics.payload.metrics.requests.total >= 1);
  assert.ok(metrics.payload.metrics.requests.byTransport["tool-management"] >= 1);
  assert.ok(metrics.payload.metrics.requests.byRoute["/api/tool-management/v1/execute"] >= 1);
  assert.ok(metrics.payload.metrics.requests.byCompletionStatus.completed >= 1);
  assert.ok(metrics.payload.metrics.requests.successTotal >= 1);
  assert.ok(metrics.payload.metrics.requests.clientErrorTotal >= 0);
  assert.ok(metrics.payload.metrics.requests.serverErrorTotal >= 0);
  assert.ok(metrics.payload.metrics.requests.completionFailureTotal >= 0);
  assert.ok(metrics.payload.metrics.requests.clientErrorRate >= 0);
  assert.ok(metrics.payload.metrics.requests.serverErrorRate >= 0);
  assert.ok(metrics.payload.metrics.requests.completionFailureRate >= 0);
  assertDurationPercentiles(metrics.payload.metrics.requests.durationPercentiles);
  assert.ok(metrics.payload.metrics.requests.requestBytesTotal > 0);
  assert.ok(metrics.payload.metrics.requests.responseBytesTotal > 0);
  assert.ok(metrics.payload.metrics.requests.transferBytesPerSecond >= 0);
  assert.ok(metrics.payload.metrics.pendingOperations.total >= 2);
  assert.ok(metrics.payload.metrics.pendingOperations.byStatus.rejected >= 1);
  assert.ok(metrics.payload.metrics.pendingOperations.byStatus.completed >= 1);
  assert.ok(metrics.payload.metrics.pendingOperations.byTool["pact.workspaceGovernance.policy.set"] >= 2);
  assert.ok(metrics.payload.metrics.pendingOperations.byRisk.repair_write >= 2);
  assert.ok(metrics.payload.metrics.pendingOperations.byGrant[approvalGrant.payload.grant.id] >= 2);
  assert.ok(metrics.payload.metrics.pendingOperations.metadataBytesTotal > 0);
  assert.ok(metrics.payload.metrics.pendingOperations.operationsPerMinute >= 0);
  assert.ok(metrics.payload.metrics.pendingOperations.averagePendingAgeSeconds >= 0);

  const filteredMetricsUrl = new URL(`${server.url}/api/tool-management/v1/metrics/summary`);
  filteredMetricsUrl.searchParams.set("toolId", "pact.agentLibrary.health");
  filteredMetricsUrl.searchParams.set("grantId", grantResult.payload.grant.id);
  filteredMetricsUrl.searchParams.set("profileId", "profile-metered");
  filteredMetricsUrl.searchParams.set("transport", "tool-management");
  filteredMetricsUrl.searchParams.set("route", "/api/tool-management/v1/execute");
  filteredMetricsUrl.searchParams.set("bucketSeconds", "60");
  const filteredMetrics = await fetchJson(filteredMetricsUrl.toString());
  assert.equal(filteredMetrics.status, 200);
  assert.equal(filteredMetrics.payload.metrics.filters.toolId, "pact.agentLibrary.health");
  assert.equal(filteredMetrics.payload.metrics.filters.grantId, grantResult.payload.grant.id);
  assert.equal(filteredMetrics.payload.metrics.filters.profileId, "profile-metered");
  assert.equal(filteredMetrics.payload.metrics.filters.transport, "tool-management");
  assert.equal(filteredMetrics.payload.metrics.filters.route, "/api/tool-management/v1/execute");
  assert.equal(filteredMetrics.payload.metrics.series.bucketSeconds, 60);
  assert.ok(filteredMetrics.payload.metrics.toolCalls.byTool["pact.agentLibrary.health"] >= 1);
  assert.equal(Object.keys(filteredMetrics.payload.metrics.toolCalls.byTool).length, 1);
  assert.equal(Object.keys(filteredMetrics.payload.metrics.toolCalls.byGrant).length, 1);
  assert.equal(filteredMetrics.payload.metrics.toolCalls.byGrant[grantResult.payload.grant.id] >= 1, true);
  assert.equal(Object.keys(filteredMetrics.payload.metrics.toolCalls.byProfile).length, 1);
  assert.equal(filteredMetrics.payload.metrics.toolCalls.byProfile["profile-metered"] >= 1, true);
  assert.ok(filteredMetrics.payload.metrics.requests.byTransport["tool-management"] >= 1);
  assert.ok(filteredMetrics.payload.metrics.requests.byRoute["/api/tool-management/v1/execute"] >= 1);
  assert.equal(filteredMetrics.payload.metrics.pendingOperations.total, 0);
  assert.ok(filteredMetrics.payload.metrics.series.buckets.some((bucket) =>
    bucket.toolCalls.total >= 1 &&
      bucket.toolCalls.byTool["pact.agentLibrary.health"] >= 1
  ));
  assert.ok(filteredMetrics.payload.metrics.series.buckets.some((bucket) =>
    bucket.requests.total >= 1 &&
      bucket.requests.byTransport["tool-management"] >= 1 &&
      bucket.requests.byCompletionStatus.completed >= 1 &&
      bucket.requests.successTotal >= 1
  ));

  {
    const healthMetricsDb = new Database(path.join(userDataPath, "tool-management", "tool-management.sqlite"), {
      fileMustExist: true
    });
    try {
      const createdAt = new Date().toISOString();
      for (let index = 0; index < 3; index += 1) {
        healthMetricsDb.prepare(`
          INSERT INTO tool_metric_events (
            metric_id, trace_id, tool_id, status, risk, duration_ms,
            input_bytes, result_bytes, transfer_bytes, bytes_per_second, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `metric_verify_latency_tool_${index}`,
          `trace_verify_latency_${index}`,
          "pact.agentLibrary.health",
          "ok",
          "read_only",
          2500 + index,
          13,
          29,
          42,
          16.8,
          createdAt
        );
        healthMetricsDb.prepare(`
          INSERT INTO http_request_metric_events (
            metric_id, trace_id, request_id, transport, method, route, status_code,
            completion_status, request_bytes, response_bytes, transfer_bytes,
            duration_ms, bytes_per_second, user_agent, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `http_metric_verify_latency_${index}`,
          `trace_verify_latency_${index}`,
          `request_verify_latency_${index}`,
          "tool-management",
          "POST",
          "/api/tool-management/v1/execute",
          200,
          "completed",
          13,
          29,
          42,
          3000 + index,
          14,
          "verify",
          createdAt
        );
      }
    } finally {
      healthMetricsDb.close();
    }
  }

  const metricsHealthUrl = new URL(`${server.url}/api/tool-management/v1/metrics/health`);
  metricsHealthUrl.searchParams.set("windowSeconds", "3600");
  metricsHealthUrl.searchParams.set("maxDeniedRate", "0");
  metricsHealthUrl.searchParams.set("maxToolFailureRate", "1");
  metricsHealthUrl.searchParams.set("maxRequestErrorRate", "1");
  metricsHealthUrl.searchParams.set("maxRequestP95Ms", "1");
  metricsHealthUrl.searchParams.set("maxToolP95Ms", "1");
  const metricsHealth = await fetchJson(metricsHealthUrl.toString());
  assert.equal(metricsHealth.status, 200);
  assert.equal(metricsHealth.payload.health.schemaVersion, "v0.0.1:tool:management-metrics-health-1");
  assert.equal(metricsHealth.payload.health.window.windowSeconds, 3600);
  assert.equal(metricsHealth.payload.health.thresholds.maxDeniedRate, 0);
  assert.equal(metricsHealth.payload.health.thresholds.maxRequestP95Ms, 1);
  assert.equal(metricsHealth.payload.health.thresholds.maxToolP95Ms, 1);
  assert.ok(["warn", "critical"].includes(metricsHealth.payload.health.status));
  assert.ok(metricsHealth.payload.health.toolCalls.total >= 2);
  assert.ok(metricsHealth.payload.health.toolCalls.callsPerMinute >= 0);
  assert.ok(metricsHealth.payload.health.toolCalls.transferBytesPerSecond >= 0);
  assertDurationPercentiles(metricsHealth.payload.health.toolCalls.durationPercentiles);
  assert.ok(metricsHealth.payload.health.requests.total >= 1);
  assert.ok(metricsHealth.payload.health.requests.requestsPerMinute >= 0);
  assert.ok(metricsHealth.payload.health.requests.transferBytesPerSecond >= 0);
  assertDurationPercentiles(metricsHealth.payload.health.requests.durationPercentiles);
  assert.ok(metricsHealth.payload.health.breaches.some((breach) => breach.code === "tool_denied_rate"));
  assert.ok(metricsHealth.payload.health.breaches.some((breach) => breach.code === "request_p95_duration_ms"));
  assert.ok(metricsHealth.payload.health.breaches.some((breach) => breach.code === "tool_p95_duration_ms"));
  const healthTopTool = metricsHealth.payload.health.toolCalls.topTools.find((item) =>
    item.toolId === "pact.agentLibrary.health"
  );
  assert.ok(healthTopTool);
  assert.ok(healthTopTool.averageDurationMs >= 0);
  assert.ok(healthTopTool.transferBytesPerSecond >= 0);
  assertDurationPercentiles(healthTopTool.durationPercentiles);
  const healthTopRoute = metricsHealth.payload.health.requests.topRoutes.find((item) =>
    item.route === "/api/tool-management/v1/execute"
  );
  assert.ok(healthTopRoute);
  assert.ok(healthTopRoute.averageDurationMs >= 0);
  assert.ok(healthTopRoute.transferBytesPerSecond >= 0);
  assertDurationPercentiles(healthTopRoute.durationPercentiles);

  const prometheusUrl = new URL(`${server.url}/api/tool-management/v1/metrics/prometheus`);
  prometheusUrl.searchParams.set("windowSeconds", "3600");
  prometheusUrl.searchParams.set("maxDeniedRate", "0");
  const prometheusResponse = await fetch(prometheusUrl.toString());
  const prometheusText = await prometheusResponse.text();
  assert.equal(prometheusResponse.status, 200);
  assert.match(prometheusResponse.headers.get("content-type") || "", /text\/plain/);
  assert.match(prometheusText, /^# HELP pact_tool_management_window_seconds/m);
  assert.match(prometheusText, /^pact_tool_management_requests_total \d+/m);
  assert.match(prometheusText, /^pact_tool_management_tool_calls_total \d+/m);
  assert.match(prometheusText, /^pact_tool_management_health_breaches_total \d+/m);
  assert.match(prometheusText, /^pact_tool_management_request_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(prometheusText, /^pact_tool_management_tool_call_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(
    prometheusText,
    /^pact_tool_management_top_tool_calls_total\{tool_id="pact\.agentLibrary\.health"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_tool_transfer_bytes_per_second\{tool_id="pact\.agentLibrary\.health"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_tool_duration_ms\{tool_id="pact\.agentLibrary\.health",quantile="0\.95"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_route_requests_total\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_route_transfer_bytes_per_second\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_route_duration_ms\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute",quantile="0\.95"\} \d+/m
  );

  const toolMetricsExportUrl = new URL(`${server.url}/api/tool-management/v1/metrics/export`);
  toolMetricsExportUrl.searchParams.set("kind", "tool");
  toolMetricsExportUrl.searchParams.set("toolId", "pact.agentLibrary.health");
  toolMetricsExportUrl.searchParams.set("grantId", grantResult.payload.grant.id);
  toolMetricsExportUrl.searchParams.set("profileId", "profile-metered");
  toolMetricsExportUrl.searchParams.set("limit", "10");
  const toolMetricsExport = await fetchJson(toolMetricsExportUrl.toString());
  assert.equal(toolMetricsExport.status, 200);
  assert.equal(toolMetricsExport.payload.export.schemaVersion, "v0.0.1:tool:management-metrics-export-1");
  assert.equal(toolMetricsExport.payload.export.filters.kind, "tool");
  assert.equal(toolMetricsExport.payload.export.filters.toolId, "pact.agentLibrary.health");
  assert.equal(toolMetricsExport.payload.export.filters.grantId, grantResult.payload.grant.id);
  assert.equal(toolMetricsExport.payload.export.filters.profileId, "profile-metered");
  assert.ok(toolMetricsExport.payload.export.toolMetricEvents.length >= 1);
  assert.equal(toolMetricsExport.payload.export.httpRequestMetricEvents.length, 0);
  assert.equal(toolMetricsExport.payload.export.toolMetricEvents.every((event) =>
    event.toolId === "pact.agentLibrary.health" &&
      event.grantId === grantResult.payload.grant.id &&
      event.profileId === "profile-metered" &&
      !Object.hasOwn(event, "input") &&
      !Object.hasOwn(event, "result")
  ), true);
  assert.equal(toolMetricsExport.payload.export.counts.total, toolMetricsExport.payload.export.toolMetricEvents.length);

  const requestMetricsExportUrl = new URL(`${server.url}/api/tool-management/v1/metrics/export`);
  requestMetricsExportUrl.searchParams.set("kind", "request");
  requestMetricsExportUrl.searchParams.set("transport", "tool-management");
  requestMetricsExportUrl.searchParams.set("route", "/api/tool-management/v1/execute");
  requestMetricsExportUrl.searchParams.set("limit", "10");
  const requestMetricsExport = await fetchJson(requestMetricsExportUrl.toString());
  assert.equal(requestMetricsExport.status, 200);
  assert.equal(requestMetricsExport.payload.export.filters.kind, "request");
  assert.equal(requestMetricsExport.payload.export.toolMetricEvents.length, 0);
  assert.ok(requestMetricsExport.payload.export.httpRequestMetricEvents.length >= 1);
  assert.equal(requestMetricsExport.payload.export.httpRequestMetricEvents.every((event) =>
    event.transport === "tool-management" &&
      event.route === "/api/tool-management/v1/execute" &&
      !Object.hasOwn(event, "body") &&
      !Object.hasOwn(event, "response") &&
      !Object.hasOwn(event, "userAgent")
  ), true);

  const storage = await fetchJson(`${server.url}/api/tool-management/v1/metrics/storage`);
  assert.equal(storage.status, 200);
  assert.equal(storage.payload.storage.schemaVersion, "v0.0.1:tool:management-metrics-storage-1");
  assert.equal(storage.payload.storage.database.fileName, "tool-management.sqlite");
  assert.equal(Object.hasOwn(storage.payload.storage.database, "path"), false);
  assert.ok(storage.payload.storage.database.totalBytes > 0);
  assert.ok(storage.payload.storage.tables.toolMetricEvents.rows >= 2);
  assert.ok(storage.payload.storage.tables.toolMetricEvents.transferBytesTotal > 0);
  assert.ok(storage.payload.storage.tables.toolMetricEvents.eventsPerMinute >= 0);
  assert.ok(storage.payload.storage.tables.httpRequestMetricEvents.rows >= 1);
  assert.ok(storage.payload.storage.tables.httpRequestMetricEvents.transferBytesTotal > 0);
  assert.ok(storage.payload.storage.tables.httpRequestMetricEvents.eventsPerMinute >= 0);
  assert.equal(storage.payload.storage.totals.metricRows,
    storage.payload.storage.tables.toolMetricEvents.rows +
      storage.payload.storage.tables.httpRequestMetricEvents.rows);
  assert.ok(storage.payload.storage.totals.transferBytesTotal > 0);

  const metricsDb = new Database(path.join(userDataPath, "tool-management", "tool-management.sqlite"), {
    fileMustExist: true
  });
  try {
    const httpMetric = metricsDb.prepare(`
      SELECT request_bytes, response_bytes, transfer_bytes, bytes_per_second
      FROM http_request_metric_events
      WHERE route = '/api/tool-management/v1/execute'
      ORDER BY created_at DESC
      LIMIT 1
    `).get();
    assert.ok(httpMetric);
    assert.ok(httpMetric.request_bytes > 0);
    assert.ok(httpMetric.response_bytes > 0);
    assert.ok(httpMetric.transfer_bytes >= httpMetric.request_bytes + httpMetric.response_bytes);
    assert.ok(httpMetric.bytes_per_second >= 0);

    const toolMetric = metricsDb.prepare(`
      SELECT input_bytes, result_bytes, transfer_bytes, bytes_per_second
      FROM tool_metric_events
      WHERE tool_id = 'pact.agentLibrary.health' AND status = 'ok'
      ORDER BY created_at DESC
      LIMIT 1
    `).get();
    assert.ok(toolMetric);
    assert.ok(toolMetric.input_bytes > 0);
    assert.ok(toolMetric.result_bytes > 0);
    assert.ok(toolMetric.transfer_bytes >= toolMetric.input_bytes + toolMetric.result_bytes);
    assert.ok(toolMetric.bytes_per_second >= 0);

    metricsDb.prepare(`
      INSERT INTO tool_metric_events (
        metric_id, trace_id, tool_id, status, risk, duration_ms,
        input_bytes, result_bytes, transfer_bytes, bytes_per_second, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "metric_verify_old_tool",
      "trace_verify_old",
      "pact.agentLibrary.health",
      "ok",
      "read_only",
      12,
      9,
      17,
      26,
      2166.67,
      "2000-01-01T00:00:00.000Z"
    );
    metricsDb.prepare(`
      INSERT INTO http_request_metric_events (
        metric_id, trace_id, request_id, transport, method, route, status_code,
        completion_status, request_bytes, response_bytes, transfer_bytes,
        duration_ms, bytes_per_second, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "http_metric_verify_old",
      "trace_verify_old",
      "request_verify_old",
      "tool-management",
      "POST",
      "/api/tool-management/v1/execute",
      200,
      "completed",
      9,
      17,
      26,
      12,
      2166.67,
      "verify",
      "2000-01-01T00:00:00.000Z"
    );
  } finally {
    metricsDb.close();
  }

  const pruneDenied = await fetchJson(`${server.url}/api/tool-management/v1/metrics/prune`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pact-safety-confirm": "false"
    },
    body: JSON.stringify({ olderThan: "2001-01-01T00:00:00.000Z" })
  });
  assert.equal(pruneDenied.status, 428);
  assert.match(JSON.stringify(pruneDenied.payload), /confirm|confirmation/i);

  const pruned = await fetchJson(`${server.url}/api/tool-management/v1/metrics/prune`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ olderThan: "2001-01-01T00:00:00.000Z" })
  });
  assert.equal(pruned.status, 200);
  assert.equal(pruned.payload.prune.schemaVersion, "v0.0.1:tool:management-metrics-prune-1");
  assert.equal(pruned.payload.prune.deleted.toolMetrics, 1);
  assert.equal(pruned.payload.prune.deleted.httpRequestMetrics, 1);

  const prunedDb = new Database(path.join(userDataPath, "tool-management", "tool-management.sqlite"), {
    fileMustExist: true
  });
  try {
    assert.equal(
      prunedDb.prepare("SELECT count(*) AS count FROM tool_metric_events WHERE metric_id = ?")
        .get("metric_verify_old_tool").count,
      0
    );
    assert.equal(
      prunedDb.prepare("SELECT count(*) AS count FROM http_request_metric_events WHERE metric_id = ?")
        .get("http_metric_verify_old").count,
      0
    );
    prunedDb.prepare(`
      INSERT INTO tool_metric_events (
        metric_id, trace_id, tool_id, status, risk, duration_ms,
        input_bytes, result_bytes, transfer_bytes, bytes_per_second, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "metric_verify_cli_old_tool",
      "trace_verify_cli_old",
      "pact.agentLibrary.health",
      "ok",
      "read_only",
      8,
      4,
      5,
      9,
      1125,
      "2000-01-02T00:00:00.000Z"
    );
    prunedDb.prepare(`
      INSERT INTO http_request_metric_events (
        metric_id, trace_id, request_id, transport, method, route, status_code,
        completion_status, request_bytes, response_bytes, transfer_bytes,
        duration_ms, bytes_per_second, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "http_metric_verify_cli_old",
      "trace_verify_cli_old",
      "request_verify_cli_old",
      "tool-management",
      "POST",
      "/api/tool-management/v1/execute",
      200,
      "completed",
      4,
      5,
      9,
      8,
      1125,
      "verify-cli",
      "2000-01-02T00:00:00.000Z"
    );
  } finally {
    prunedDb.close();
  }

  const cliCatalog = await execFileAsync(
    process.execPath,
    [path.resolve("server/scripts/pact.mjs"), "tools", "catalog", "--server-url", server.url],
    { env: process.env }
  );
  const cliCatalogPayload = JSON.parse(cliCatalog.stdout);
  assert.equal(cliCatalogPayload.schemaVersion, "v0.0.1:schema:definition-1");
  assert.ok(cliCatalogPayload.tools.some((tool) => tool.id === "pact.agentLibrary.health"));

  const cliMetrics = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "--server-url",
      server.url,
      "--limit",
      "20",
      "--tool-id",
      "pact.agentLibrary.health",
      "--grant-id",
      grantResult.payload.grant.id,
      "--profile-id",
      "profile-metered",
      "--transport",
      "tool-management",
      "--route",
      "/api/tool-management/v1/execute",
      "--bucket-seconds",
      "60"
    ],
    { env: process.env }
  );
  const cliMetricsPayload = JSON.parse(cliMetrics.stdout);
  assert.equal(cliMetricsPayload.schemaVersion, "v0.0.1:schema:definition-1");
  assert.ok(cliMetricsPayload.metrics.callsTotal >= 1);
  assert.equal(cliMetricsPayload.metrics.filters.toolId, "pact.agentLibrary.health");
  assert.equal(cliMetricsPayload.metrics.filters.grantId, grantResult.payload.grant.id);
  assert.equal(cliMetricsPayload.metrics.filters.profileId, "profile-metered");
  assert.equal(cliMetricsPayload.metrics.filters.transport, "tool-management");
  assert.equal(cliMetricsPayload.metrics.series.bucketSeconds, 60);

  const cliHealth = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "health",
      "--server-url",
      server.url,
      "--window-seconds",
      "3600",
      "--max-denied-rate",
      "1",
      "--max-request-p95-ms",
      "1",
      "--max-tool-p95-ms",
      "1"
    ],
    { env: process.env }
  );
  const cliHealthPayload = JSON.parse(cliHealth.stdout);
  assert.equal(cliHealthPayload.schemaVersion, "v0.0.1:schema:definition-1");
  assert.equal(cliHealthPayload.health.schemaVersion, "v0.0.1:tool:management-metrics-health-1");
  assert.equal(cliHealthPayload.health.window.windowSeconds, 3600);
  assert.ok(cliHealthPayload.health.toolCalls.total >= 1);
  assertDurationPercentiles(cliHealthPayload.health.toolCalls.durationPercentiles);
  assert.ok(cliHealthPayload.health.requests.total >= 1);
  assertDurationPercentiles(cliHealthPayload.health.requests.durationPercentiles);
  assert.ok(cliHealthPayload.health.breaches.some((breach) => breach.code === "request_p95_duration_ms"));
  assert.ok(cliHealthPayload.health.breaches.some((breach) => breach.code === "tool_p95_duration_ms"));

  const cliPrometheus = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "prometheus",
      "--server-url",
      server.url,
      "--window-seconds",
      "3600",
      "--max-denied-rate",
      "1",
      "--max-request-p95-ms",
      "1",
      "--max-tool-p95-ms",
      "1"
    ],
    { env: process.env }
  );
  assert.match(cliPrometheus.stdout, /^# HELP pact_tool_management_window_seconds/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_tool_calls_total \d+/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_requests_total \d+/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_request_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_tool_call_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(
    cliPrometheus.stdout,
    /^pact_tool_management_top_tool_duration_ms\{tool_id="pact\.agentLibrary\.health",quantile="0\.95"\} \d+/m
  );
  assert.match(
    cliPrometheus.stdout,
    /^pact_tool_management_top_route_duration_ms\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute",quantile="0\.95"\} \d+/m
  );

  const cliExport = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "export",
      "--server-url",
      server.url,
      "--kind",
      "request",
      "--transport",
      "tool-management",
      "--route",
      "/api/tool-management/v1/execute",
      "--limit",
      "10"
    ],
    { env: process.env }
  );
  const cliExportPayload = JSON.parse(cliExport.stdout);
  assert.equal(cliExportPayload.schemaVersion, "v0.0.1:schema:definition-1");
  assert.equal(cliExportPayload.export.schemaVersion, "v0.0.1:tool:management-metrics-export-1");
  assert.equal(cliExportPayload.export.filters.kind, "request");
  assert.ok(cliExportPayload.export.httpRequestMetricEvents.length >= 1);
  assert.equal(cliExportPayload.export.toolMetricEvents.length, 0);

  const cliToolExport = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "export",
      "--server-url",
      server.url,
      "--kind",
      "tool",
      "--tool-id",
      "pact.agentLibrary.health",
      "--grant-id",
      grantResult.payload.grant.id,
      "--profile-id",
      "profile-metered",
      "--limit",
      "10"
    ],
    { env: process.env }
  );
  const cliToolExportPayload = JSON.parse(cliToolExport.stdout);
  assert.equal(cliToolExportPayload.export.filters.kind, "tool");
  assert.equal(cliToolExportPayload.export.filters.grantId, grantResult.payload.grant.id);
  assert.equal(cliToolExportPayload.export.filters.profileId, "profile-metered");
  assert.ok(cliToolExportPayload.export.toolMetricEvents.length >= 1);
  assert.equal(cliToolExportPayload.export.httpRequestMetricEvents.length, 0);
  assert.equal(cliToolExportPayload.export.toolMetricEvents.every((event) =>
    event.grantId === grantResult.payload.grant.id && event.profileId === "profile-metered"
  ), true);

  const cliStorage = await execFileAsync(
    process.execPath,
    [path.resolve("server/scripts/pact.mjs"), "tools", "metrics", "storage", "--server-url", server.url],
    { env: process.env }
  );
  const cliStoragePayload = JSON.parse(cliStorage.stdout);
  assert.equal(cliStoragePayload.schemaVersion, "v0.0.1:schema:definition-1");
  assert.equal(cliStoragePayload.storage.schemaVersion, "v0.0.1:tool:management-metrics-storage-1");
  assert.equal(cliStoragePayload.storage.database.fileName, "tool-management.sqlite");
  assert.equal(Object.hasOwn(cliStoragePayload.storage.database, "path"), false);
  assert.ok(cliStoragePayload.storage.tables.toolMetricEvents.rows >= 1);
  assert.ok(cliStoragePayload.storage.tables.httpRequestMetricEvents.rows >= 1);

  const cliPrune = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "prune",
      "--server-url",
      server.url,
      "--confirm",
      "--body",
      "{\"olderThan\":\"2001-01-01T00:00:00.000Z\"}"
    ],
    { env: process.env }
  );
  const cliPrunePayload = JSON.parse(cliPrune.stdout);
  assert.equal(cliPrunePayload.schemaVersion, "v0.0.1:schema:definition-1");
  assert.equal(cliPrunePayload.prune.deleted.toolMetrics, 1);
  assert.equal(cliPrunePayload.prune.deleted.httpRequestMetrics, 1);

  const rotated = await fetchJson(`${server.url}/api/tool-management/v1/grants/${grantResult.payload.grant.id}/rotate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.payload.token);
  assert.equal(rotated.payload.grant.metadata.policyRevision, changedPolicyRevision.revision);
  const oldTokenDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(grantResult.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(oldTokenDenied.status, 401);
  assert.equal(oldTokenDenied.payload.error.code, "invalid_token");
  const newTokenAllowed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rotated.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(newTokenAllowed.status, 200);

  const runtimeReadGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-runtime-read",
      scopes: ["console:read", "storage:read", "jobs:read"]
    })
  });
  assert.equal(runtimeReadGrant.status, 201);

  const runtimeMounts = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeReadGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts",
      input: {}
    })
  });
  assert.equal(runtimeMounts.status, 200);
  assert.ok(runtimeMounts.payload.result.runtime.mountGeneration >= 1);
  assert.ok(Array.isArray(runtimeMounts.payload.result.runtime.mounts));

  const runtimeSetDeniedForReadGrant = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeReadGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.set",
      input: {
        value: {
          mountRouting: {
            extensionRoutes: {
              ".tmverify": { mountName: "documentParser", action: "extractDocument" }
            }
          }
        }
      }
    })
  });
  assert.equal(runtimeSetDeniedForReadGrant.status, 403);
  assert.equal(runtimeSetDeniedForReadGrant.payload.error.code, "missing_capabilities");

  const loweredRuntimeGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-runtime-maintain-lowered-scope-denied",
      toolsets: ["pact.runtime.maintain"],
      scopes: ["knowledge:maintain"],
      metadata: {
        maxRisk: "repair_write"
      }
    })
  });
  assert.equal(loweredRuntimeGrant.status, 201);
  const loweredRuntimeSetDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(loweredRuntimeGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.set",
      input: {
        value: {
          mountRouting: {
            extensionRoutes: {
              ".tmverify-denied": { mountName: "documentParser", action: "extractDocument" }
            }
          }
        }
      }
    })
  });
  assert.equal(loweredRuntimeSetDenied.status, 403);
  assert.equal(loweredRuntimeSetDenied.payload.error.code, "missing_scopes");

  const runtimeMaintainGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-runtime-maintain",
      scopes: ["runtime:admin"],
      metadata: {
        maxRisk: "repair_write"
      }
    })
  });
  assert.equal(runtimeMaintainGrant.status, 201);

  const setRequiresApproval = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      ...bearerHeaders(runtimeMaintainGrant.payload.token),
      "x-pact-safety-confirm": "false"
    },
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.set",
      input: {
        value: {
          mountRouting: {
            extensionRoutes: {
              ".tmverify": { mountName: "documentParser", action: "extractDocument" }
            }
          }
        }
      }
    })
  });
  assert.equal(setRequiresApproval.status, 202, JSON.stringify(setRequiresApproval.payload, null, 2));
  assert.equal(setRequiresApproval.payload.status, "pending_approval");
  const setRequiresApprovalCleanup = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations/${encodeURIComponent(setRequiresApproval.payload.pendingOperation.pendingOperationId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      resolution: "rejected",
      resolvedBy: "verify-console",
      reason: "verify set requires approval"
    })
  });
  assert.equal(setRequiresApprovalCleanup.status, 200, JSON.stringify(setRequiresApprovalCleanup.payload, null, 2));

  const setMountsPending = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeMaintainGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.set",
      input: {
        confirm: true,
        value: {
          mountRouting: {
            extensionRoutes: {
              ".tmverify": { mountName: "documentParser", action: "extractDocument" }
            }
          }
        }
      }
    })
  });
  assert.equal(setMountsPending.status, 202, JSON.stringify(setMountsPending.payload, null, 2));
  assert.equal(setMountsPending.payload.status, "pending_approval");
  const setMounts = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations/${encodeURIComponent(setMountsPending.payload.pendingOperation.pendingOperationId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      resolution: "approved",
      resolvedBy: "verify-console",
      reason: "verify set mounts approval"
    })
  });
  assert.equal(setMounts.status, 200, JSON.stringify(setMounts.payload, null, 2));
  assert.ok(setMounts.payload.result.runtime.mountGeneration > runtimeMounts.payload.result.runtime.mountGeneration);
  assert.equal(
    setMounts.payload.result.value.mountRouting.extensionRoutes[".tmverify"].mountName,
    "documentParser"
  );
  assert.equal(
    setMounts.payload.result.value.mountRouting.extensionRoutes[".tmverify"].action,
    "extractDocument"
  );

  const runtimeMountsAfterSet = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeReadGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts",
      input: {}
    })
  });
  assert.equal(runtimeMountsAfterSet.status, 200);
  assert.equal(
    runtimeMountsAfterSet.payload.result.value.mountRouting.extensionRoutes[".tmverify"].mountName,
    "documentParser"
  );
  assert.ok(
    runtimeMountsAfterSet.payload.result.runtime.mountGeneration >=
      setMounts.payload.result.runtime.mountGeneration
  );

  const reloadRequiresApproval = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      ...bearerHeaders(runtimeMaintainGrant.payload.token),
      "x-pact-safety-confirm": "false"
    },
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.reload",
      input: {}
    })
  });
  assert.equal(reloadRequiresApproval.status, 202, JSON.stringify(reloadRequiresApproval.payload, null, 2));
  assert.equal(reloadRequiresApproval.payload.status, "pending_approval");
  const reloadRequiresApprovalCleanup = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations/${encodeURIComponent(reloadRequiresApproval.payload.pendingOperation.pendingOperationId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      resolution: "rejected",
      resolvedBy: "verify-console",
      reason: "verify reload requires approval"
    })
  });
  assert.equal(reloadRequiresApprovalCleanup.status, 200, JSON.stringify(reloadRequiresApprovalCleanup.payload, null, 2));

  const reloadedMountsPending = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeMaintainGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.reload",
      input: { confirm: true }
    })
  });
  assert.equal(reloadedMountsPending.status, 202, JSON.stringify(reloadedMountsPending.payload, null, 2));
  assert.equal(reloadedMountsPending.payload.status, "pending_approval");
  const reloadedMounts = await fetchJson(`${server.url}/api/tool-management/v1/pending-operations/${encodeURIComponent(reloadedMountsPending.payload.pendingOperation.pendingOperationId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      resolution: "approved",
      resolvedBy: "verify-console",
      reason: "verify reload mounts approval"
    })
  });
  assert.equal(reloadedMounts.status, 200);
  assert.equal(reloadedMounts.payload.result.ok, true);
  assert.ok(reloadedMounts.payload.result.runtime.mountGeneration > setMounts.payload.result.runtime.mountGeneration);
  assert.equal(
    reloadedMounts.payload.result.value.mountRouting.extensionRoutes[".tmverify"].mountName,
    "documentParser"
  );

  const revoked = await fetchJson(`${server.url}/api/tool-management/v1/grants/${grantResult.payload.grant.id}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "verify complete" })
  });
  assert.equal(revoked.status, 200);
  const revokedDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rotated.payload.token),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
      input: {}
    })
  });
  assert.equal(revokedDenied.status, 401);
  assert.equal(revokedDenied.payload.error.code, "invalid_token");
} finally {
  authorizationGovernanceStore.close();
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
