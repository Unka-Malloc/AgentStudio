import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAuthorizationEngine } from "../platform/common/security/authorization/authorization-engine.mjs";
import { createAuthorizationStore } from "../platform/common/security/authorization/authorization-store.mjs";
import {
  SECURITY_PERMISSIONS_PROTOCOL_VERSION,
  createSecurityPermissionsProvider
} from "../platform/common/security/security-permissions-provider.mjs";
import { createToolPolicyEngine } from "../platform/specialized/capabilities/tools/tool-management-core/policy.mjs";
import { createToolExecutionRuntime } from "../platform/specialized/capabilities/tools/tool-management-core/runtime.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-authz-migration-"));
const authorizationStore = createAuthorizationStore({ userDataPath });
const authorizationEngine = createAuthorizationEngine({ store: authorizationStore });

try {
  const readOperation = {
    id: "workspace.file.list",
    requiredScopes: ["storage:read"],
    safety: { risk: "read_only" },
    readOnly: true
  };
  const writeOperation = {
    id: "workspace.file.upload",
    requiredScopes: ["storage:write"],
    safety: { risk: "safe_write" },
    readOnly: false
  };
  const repairOperation = {
    id: "workspace.checkpoint.restore",
    requiredScopes: ["workspace:maintain"],
    safety: { risk: "repair_write", requiresConfirmation: true },
    readOnly: false
  };

  const viewerSession = {
    user: {
      userId: "viewer-1",
      username: "viewer",
      roleId: "viewer",
      scopes: ["storage:read"]
    }
  };
  const maintainerSession = {
    user: {
      userId: "maintainer-1",
      username: "maintainer",
      roleId: "operator",
      scopes: ["workspace:maintain"]
    }
  };

  const securityPermissions = createSecurityPermissionsProvider({
    consoleAuth: {
      authorizationEngine,
      authorizationStore,
      getSummary() {
        return {
          enabled: true,
          bootstrap: {},
          session: { authenticated: false, csrfToken: "", expiresAt: "", user: null },
          roles: [],
          oidc: {}
        };
      },
      authorizeOperation({ request, operation, method, url }) {
        const decision = authorizationEngine.evaluate({
          operation,
          request,
          authSession: viewerSession,
          input: {
            method,
            path: url?.pathname || ""
          },
          enforceConfirmation: false
        });
        return decision.allowed
          ? { ok: true, session: viewerSession, authorizationDecision: decision }
          : { ok: false, status: 403, error: decision.reasonCode, session: viewerSession, authorizationDecision: decision };
      }
    }
  });
  assert.equal(securityPermissions.protocolVersion, SECURITY_PERMISSIONS_PROTOCOL_VERSION);
  assert.equal(securityPermissions.getConsoleSummary().enabled, true);
  assert.equal(securityPermissions.authorizationStore, authorizationStore);
  assert.equal(securityPermissions.authorizationEngine, authorizationEngine);
  const providerAllowed = await securityPermissions.authorizeOperation({
    operation: readOperation,
    method: "GET",
    url: new URL("http://127.0.0.1/api/workspace/files")
  });
  assert.equal(providerAllowed.ok, true);
  const providerDenied = await securityPermissions.authorizeOperation({
    operation: writeOperation,
    method: "POST",
    url: new URL("http://127.0.0.1/api/workspace/file/upload")
  });
  assert.equal(providerDenied.ok, false);
  assert.equal(providerDenied.authorizationDecision.reasonCode, "missing_scopes");
  const workspaceAssetPolicy = securityPermissions.setWorkspaceAssetPolicy({
    workspaceId: "workspace-a",
    accessMode: "read",
    subjectId: "viewer-1"
  });
  assert.equal(workspaceAssetPolicy.workspaceId, "workspace-a");
  assert.equal(
    securityPermissions.getWorkspaceAssetPolicy({
      workspaceId: "workspace-a",
      policyId: workspaceAssetPolicy.policyId
    }).policyId,
    workspaceAssetPolicy.policyId
  );
  const workspaceAssetDecision = securityPermissions.checkWorkspaceAssetPermission({
    authSession: {
      user: {
        userId: "workspace-reader",
        username: "workspace-reader",
        roleId: "viewer",
        scopes: ["workspace:read"]
      }
    },
    requestedAction: "read"
  });
  assert.equal(workspaceAssetDecision.allowed, true);

  const readDecision = authorizationEngine.evaluate({
    operation: readOperation,
    authSession: viewerSession
  });
  assert.equal(readDecision.allowed, true);
  assert.equal(readDecision.reasonCode, "allowed");

  const writeDecision = authorizationEngine.evaluate({
    operation: writeOperation,
    authSession: viewerSession
  });
  assert.equal(writeDecision.allowed, false);
  assert.equal(writeDecision.reasonCode, "missing_scopes");
  assert.deepEqual(writeDecision.missingScopes, ["storage:write"]);

  const repairNeedsConfirmation = authorizationEngine.evaluate({
    operation: repairOperation,
    authSession: maintainerSession,
    input: {}
  });
  assert.equal(repairNeedsConfirmation.effect, "require_confirmation");
  assert.equal(repairNeedsConfirmation.requiredConfirmation, true);

  const repairConfirmed = authorizationEngine.evaluate({
    operation: repairOperation,
    authSession: maintainerSession,
    input: { confirm: true }
  });
  assert.equal(repairConfirmed.allowed, true);

  const deniedRequests = authorizationStore.listDeniedRequests({ limit: 20 });
  assert.ok(
    deniedRequests.some((item) => item.reasonCode === "missing_scopes"),
    "denied authorization decisions must be recorded in unified store"
  );
  const missingScopeDeniedRequests = authorizationStore.listDeniedRequests({
    reasonCode: "missing_scopes",
    operationId: writeOperation.id,
    subjectId: "viewer-1",
    limit: 20
  });
  assert.equal(missingScopeDeniedRequests.length, 2);
  assert.ok(missingScopeDeniedRequests.every((item) => item.reasonCode === "missing_scopes"));
  assert.ok(missingScopeDeniedRequests.every((item) => item.operationId === writeOperation.id));
  assert.ok(missingScopeDeniedRequests.every((item) => item.subjectId === "viewer-1"));
  assert.equal(
    authorizationStore.listDeniedRequests({
      reasonCode: "missing_scopes",
      operationId: repairOperation.id,
      subjectId: "viewer-1",
      limit: 20
    }).length,
    0
  );

  const policyStore = {
    decisions: [],
    appendPolicyDecision(decision) {
      this.decisions.push(decision);
      return { decisionId: decision.decisionId };
    },
    getRawGrant() {
      return null;
    }
  };
  const policyEngine = createToolPolicyEngine({
    registry: { getTool: () => null, listProfiles: () => [] },
    store: policyStore,
    securityPermissions
  });
  const knowledgeTool = {
    id: "pact.agentLibrary.health",
    status: "active",
    operationId: "knowledge.health",
    requiredScopes: ["knowledge:read"],
    toolsets: ["pact.agentLibrary.read"],
    risk: "read_only",
    readOnly: true
  };
  const narrowGrant = {
    id: "grant-narrow",
    label: "narrow",
    scopes: ["knowledge:read"],
    toolsets: ["pact.document.parse"],
    toolAllow: [],
    toolDeny: [],
    metadata: {}
  };
  const toolsetDenied = policyEngine.evaluate({
    tool: knowledgeTool,
    grant: narrowGrant
  });
  assert.equal(toolsetDenied.effect, "deny");
  assert.equal(toolsetDenied.reasonCode, "missing_toolsets");
  assert.ok(policyStore.decisions.some((decision) => decision.reasonCode === "missing_toolsets"));
  assert.ok(
    authorizationStore.listDecisions({ limit: 50 }).some((decision) =>
      decision.toolId === "pact.agentLibrary.health" && decision.reasonCode === "missing_toolsets"
    ),
    "tool policy decisions must also be mirrored into the unified authorization store"
  );

  const repairTool = {
    id: "pact.runtime.mounts.reload",
    status: "active",
    operationId: "runtime.reload_mounts",
    requiredScopes: ["knowledge:maintain"],
    toolsets: ["pact.runtime.maintain"],
    risk: "repair_write",
    readOnly: false,
    requiresApproval: true
  };
  const repairGrant = {
    id: "grant-repair",
    label: "repair",
    scopes: ["knowledge:maintain"],
    toolsets: ["pact.runtime.maintain"],
    toolAllow: [],
    toolDeny: [],
    metadata: { maxRisk: "repair_write" }
  };
  const policyNeedsConfirmation = policyEngine.evaluate({
    tool: repairTool,
    grant: repairGrant,
    input: {}
  });
  assert.equal(policyNeedsConfirmation.effect, "require_confirmation");

  const policyAllowed = policyEngine.evaluate({
    tool: repairTool,
    grant: repairGrant,
    input: { confirm: true }
  });
  assert.equal(policyAllowed.effect, "allow");

  const expiredGrantDecision = authorizationEngine.evaluate({
    operation: {
      id: "tool.grant.authorize",
      requiredScopes: [],
      safety: { risk: "read_only" },
      readOnly: true
    },
    grant: {
      id: "grant-expired",
      scopes: [],
      toolsets: [],
      expiresAt: new Date(Date.now() - 1000).toISOString()
    },
    grantRequired: true
  });
  assert.equal(expiredGrantDecision.allowed, false);
  assert.equal(expiredGrantDecision.reasonCode, "grant_expired");

  const originGrantDecision = authorizationEngine.evaluate({
    operation: {
      id: "tool.grant.authorize",
      requiredScopes: [],
      safety: { risk: "read_only" },
      readOnly: true
    },
    grant: {
      id: "grant-origin",
      scopes: [],
      toolsets: [],
      allowedOrigins: ["https://allowed.example"]
    },
    request: { headers: { origin: "https://denied.example" } },
    grantRequired: true
  });
  assert.equal(originGrantDecision.allowed, false);
  assert.equal(originGrantDecision.reasonCode, "origin_not_allowed");

  const runtimeStore = {
    policyDecisions: [],
    executions: [],
    metrics: [],
    authorizeRequest() {
      return {
        ok: false,
        status: 401,
        error: "缺少工具访问令牌。",
        reasonCode: "missing_token"
      };
    },
    appendPolicyDecision(decision) {
      this.policyDecisions.push(decision);
      return { decisionId: decision.decisionId };
    },
    appendExecution(entry) {
      this.executions.push(entry);
      return { toolExecutionId: entry.toolExecutionId };
    },
    appendMetric(entry) {
      this.metrics.push(entry);
      return {};
    }
  };
  const runtime = createToolExecutionRuntime({
    registry: {
      getTool: () => knowledgeTool,
      listProfiles: () => []
    },
    store: runtimeStore,
    policyEngine,
    securityPermissions,
    operations: [{
      id: "knowledge.health",
      requiredScopes: ["knowledge:read"],
      safety: { risk: "read_only" },
      readOnly: true,
      target: { controller: "system", method: "handleHealthz" },
      http: { method: "GET", path: "/api/knowledge/health" }
    }],
    controllers: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    }
  });
  const runtimeDenied = await runtime.executeTool({
    toolId: "pact.agentLibrary.health",
    input: {},
    request: { headers: {}, socket: {} }
  });
  assert.equal(runtimeDenied.ok, false);
  assert.equal(runtimeDenied.payload.error.code, "missing_token");
  assert.ok(
    authorizationStore.listDecisions({ limit: 100 }).some((decision) =>
      decision.toolId === "pact.agentLibrary.health" && decision.reasonCode === "missing_token"
    ),
    "tool token authorization denials must be mirrored into unified authorization store"
  );

  const approvalRuntimeStore = {
    policyDecisions: [],
    executions: [],
    metrics: [],
    pendingOperations: [],
    authorizeRequest() {
      return {
        ok: true,
        grant: repairGrant,
        sourceIp: "127.0.0.1"
      };
    },
    createPendingOperation(entry) {
      const pending = {
        ...entry,
        pendingOperationId: `pending_${this.pendingOperations.length + 1}`,
        status: "pending"
      };
      this.pendingOperations.push(pending);
      return pending;
    },
    appendPolicyDecision(decision) {
      this.policyDecisions.push(decision);
      return { decisionId: decision.decisionId };
    },
    appendExecution(entry) {
      this.executions.push(entry);
      return { toolExecutionId: entry.toolExecutionId };
    },
    appendMetric(entry) {
      this.metrics.push(entry);
      return {};
    }
  };
  const approvalRuntime = createToolExecutionRuntime({
    registry: {
      getTool: () => repairTool,
      listProfiles: () => []
    },
    store: approvalRuntimeStore,
    policyEngine,
    securityPermissions,
    operations: [{
      id: "runtime.reload_mounts",
      requiredScopes: ["knowledge:maintain"],
      safety: { risk: "repair_write", requiresConfirmation: true },
      target: { controller: "system", method: "handleMissingRuntimeReload" },
      http: { method: "POST", path: "/api/runtime/mounts/reload" }
    }],
    controllers: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    }
  });
  const forgedApprovalContext = await approvalRuntime.executeTool({
    toolId: "pact.runtime.mounts.reload",
    input: { confirm: true },
    request: { headers: {}, socket: {} },
    context: {
      approval: { approved: true, pendingOperationId: "forged-pending-operation" },
      pendingOperationApproved: true,
      transport: "tool-http"
    }
  });
  assert.equal(forgedApprovalContext.status, 202);
  assert.equal(forgedApprovalContext.payload.status, "pending_approval");
  assert.equal(approvalRuntimeStore.pendingOperations.length, 1);
} finally {
  authorizationStore.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("authorization migration verification passed");
