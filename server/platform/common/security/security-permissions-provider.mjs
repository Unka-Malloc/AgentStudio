import crypto from "node:crypto";
import { createAuthorizationEngine } from "./authorization/authorization-engine.mjs";

export const SECURITY_PERMISSIONS_PROTOCOL_VERSION = "pact.security-permissions.v1";

function defaultSummary() {
  return {
    enabled: false,
    bootstrap: {},
    session: {
      authenticated: false,
      csrfToken: "",
      expiresAt: "",
      user: null
    },
    roles: [],
    oidc: {}
  };
}

function workspaceAssetPolicyKey(workspaceId, policyId) {
  return `${String(workspaceId || "default").trim() || "default"}:${String(policyId || "").trim()}`;
}

function defaultGovernancePolicyRevision() {
  return {
    protocolVersion: "pact.authorization.governance.policy-revision.v1",
    revision: 0,
    updatedAt: ""
  };
}

export function createSecurityPermissionsProvider({
  consoleAuth = null,
  authorizationEngine = null,
  authorizationStore = null,
  authorizationGovernanceStore = null
} = {}) {
  const workspaceAssetPolicies = new Map();
  const resolvedAuthorizationStore =
    authorizationStore ||
    consoleAuth?.authorizationStore ||
    null;
  const resolvedAuthorizationGovernanceStore =
    authorizationGovernanceStore ||
    consoleAuth?.authorizationGovernanceStore ||
    null;
  const resolvedAuthorizationEngine =
    authorizationEngine ||
    consoleAuth?.authorizationEngine ||
    (resolvedAuthorizationStore
      ? createAuthorizationEngine({
          store: resolvedAuthorizationStore,
          governanceStore: resolvedAuthorizationGovernanceStore
        })
      : null);

  async function authorizeOperation(input = {}) {
    if (typeof consoleAuth?.authorizeOperation === "function") {
      return consoleAuth.authorizeOperation(input);
    }
    if (!resolvedAuthorizationEngine || typeof resolvedAuthorizationEngine.evaluate !== "function") {
      return {
        ok: true,
        session: input.authSession || null,
        authorizationDecision: null
      };
    }
    const decision = resolvedAuthorizationEngine.evaluate({
      operation: input.operation || {},
      request: input.request || null,
      authSession: input.authSession || null,
      input: {
        method: input.method || "",
        path: input.url?.pathname || ""
      },
      context: {
        transport: input.transport || "security-permissions-provider"
      },
      enforceConfirmation: false
    });
    return decision.allowed
      ? {
          ok: true,
          session: input.authSession || null,
          authorizationDecision: decision
        }
      : {
          ok: false,
          status: 403,
          error: decision.missingCapabilities?.length
            ? `权限不足：${decision.missingCapabilities.join(", ")}。`
            : decision.missingScopes?.length
            ? `权限不足：${decision.missingScopes.join(", ")}。`
            : `权限不足：${decision.reasonCode || "authorization_denied"}。`,
          session: input.authSession || null,
          authorizationDecision: decision
        };
  }

  return Object.freeze({
    protocolVersion: SECURITY_PERMISSIONS_PROTOCOL_VERSION,
    authorizationEngine: resolvedAuthorizationEngine,
    authorizationStore: resolvedAuthorizationStore,
    authorizationGovernanceStore: resolvedAuthorizationGovernanceStore,
    authorizeOperation,
    getConsoleSummary(request = null) {
      return typeof consoleAuth?.getSummary === "function"
        ? consoleAuth.getSummary(request)
        : defaultSummary();
    },
    getSummary(request = null) {
      return typeof consoleAuth?.getSummary === "function"
        ? consoleAuth.getSummary(request)
        : defaultSummary();
    },
    login(input = {}, request = null) {
      if (typeof consoleAuth?.login !== "function") {
        throw new Error("Console authentication login provider is unavailable.");
      }
      return consoleAuth.login(input, request);
    },
    logout(request = null) {
      if (typeof consoleAuth?.logout !== "function") {
        return { ok: true, cookies: [] };
      }
      return consoleAuth.logout(request);
    },
    rotateSession(request = null) {
      if (typeof consoleAuth?.rotateSession !== "function") {
        return { ok: false, status: 503, error: "Console session rotation provider is unavailable." };
      }
      return consoleAuth.rotateSession(request);
    },
    audit(entry = {}) {
      return typeof consoleAuth?.audit === "function" ? consoleAuth.audit(entry) : null;
    },
    roleList() {
      return typeof consoleAuth?.roleList === "function" ? consoleAuth.roleList() : [];
    },
    listUsers() {
      return typeof consoleAuth?.listUsers === "function" ? consoleAuth.listUsers() : [];
    },
    updateUser(userId, input = {}) {
      if (typeof consoleAuth?.updateUser !== "function") {
        return null;
      }
      return consoleAuth.updateUser(userId, input);
    },
    getOidcConfig() {
      return typeof consoleAuth?.getOidcConfig === "function" ? consoleAuth.getOidcConfig() : {};
    },
    setOidcConfig(input = {}) {
      if (typeof consoleAuth?.setOidcConfig !== "function") {
        throw new Error("Console OIDC provider is unavailable.");
      }
      return consoleAuth.setOidcConfig(input);
    },
    listAudit(input = {}) {
      return typeof consoleAuth?.listAudit === "function" ? consoleAuth.listAudit(input) : [];
    },
    listSessions() {
      return typeof consoleAuth?.listSessions === "function" ? consoleAuth.listSessions() : [];
    },
    revokeSession(sessionId) {
      if (typeof consoleAuth?.revokeSession !== "function") {
        return { ok: false };
      }
      return consoleAuth.revokeSession(sessionId);
    },
    resolveSubject(input = {}) {
      return resolvedAuthorizationEngine?.resolveSubject
        ? resolvedAuthorizationEngine.resolveSubject(input)
        : null;
    },
    evaluatePolicy(input = {}) {
      return resolvedAuthorizationEngine?.evaluate
        ? resolvedAuthorizationEngine.evaluate(input)
        : null;
    },
    getGovernancePolicyRevision() {
      return resolvedAuthorizationGovernanceStore?.getPolicyRevision?.() || defaultGovernancePolicyRevision();
    },
    getGovernanceSummary() {
      if (!resolvedAuthorizationGovernanceStore) {
        return {
          policyRevision: defaultGovernancePolicyRevision(),
          roles: [],
          teams: [],
          userPolicies: [],
          agentBindings: [],
          agentGroups: [],
          approvals: []
        };
      }
      return {
        policyRevision: resolvedAuthorizationGovernanceStore.getPolicyRevision?.() || defaultGovernancePolicyRevision(),
        roles: resolvedAuthorizationGovernanceStore.listRoles?.() || [],
        teams: resolvedAuthorizationGovernanceStore.listTeams?.() || [],
        userPolicies: resolvedAuthorizationGovernanceStore.listUserPolicies?.() || [],
        agentBindings: resolvedAuthorizationGovernanceStore.listAgentBindings?.() || [],
        agentGroups: resolvedAuthorizationGovernanceStore.listAgentGroups?.() || [],
        approvals: resolvedAuthorizationGovernanceStore.listApprovals?.({ includeRevoked: true }) || []
      };
    },
    listGovernanceRoles(input = {}) {
      return resolvedAuthorizationGovernanceStore?.listRoles?.(input) || [];
    },
    upsertGovernanceRole(input = {}) {
      if (!resolvedAuthorizationGovernanceStore?.upsertRole) {
        throw new Error("Authorization governance role store is unavailable.");
      }
      return resolvedAuthorizationGovernanceStore.upsertRole(input);
    },
    listGovernanceTeams(input = {}) {
      return resolvedAuthorizationGovernanceStore?.listTeams?.(input) || [];
    },
    upsertGovernanceTeam(input = {}) {
      if (!resolvedAuthorizationGovernanceStore?.upsertTeam) {
        throw new Error("Authorization governance team store is unavailable.");
      }
      return resolvedAuthorizationGovernanceStore.upsertTeam(input);
    },
    listGovernanceUserPolicies() {
      return resolvedAuthorizationGovernanceStore?.listUserPolicies?.() || [];
    },
    upsertGovernanceUserPolicy(input = {}) {
      if (!resolvedAuthorizationGovernanceStore?.upsertUserPolicy) {
        throw new Error("Authorization governance user policy store is unavailable.");
      }
      return resolvedAuthorizationGovernanceStore.upsertUserPolicy(input);
    },
    listGovernanceAgentGroups(input = {}) {
      return resolvedAuthorizationGovernanceStore?.listAgentGroups?.(input) || [];
    },
    upsertGovernanceAgentGroup(input = {}) {
      if (!resolvedAuthorizationGovernanceStore?.upsertAgentGroup) {
        throw new Error("Authorization governance agent group store is unavailable.");
      }
      return resolvedAuthorizationGovernanceStore.upsertAgentGroup(input);
    },
    listGovernanceAgentBindings() {
      return resolvedAuthorizationGovernanceStore?.listAgentBindings?.() || [];
    },
    upsertGovernanceAgentBinding(input = {}) {
      if (!resolvedAuthorizationGovernanceStore?.upsertAgentBinding) {
        throw new Error("Authorization governance agent binding store is unavailable.");
      }
      return resolvedAuthorizationGovernanceStore.upsertAgentBinding(input);
    },
    listGovernanceApprovals(input = {}) {
      return resolvedAuthorizationGovernanceStore?.listApprovals?.(input) || [];
    },
    upsertGovernanceApproval(input = {}) {
      if (!resolvedAuthorizationGovernanceStore?.upsertApproval) {
        throw new Error("Authorization governance approval store is unavailable.");
      }
      return resolvedAuthorizationGovernanceStore.upsertApproval(input);
    },
    revokeGovernanceApproval(approvalId, reason = "") {
      if (!resolvedAuthorizationGovernanceStore?.revokeApproval) {
        throw new Error("Authorization governance approval store is unavailable.");
      }
      return resolvedAuthorizationGovernanceStore.revokeApproval(approvalId, reason);
    },
    listReceipts(input = {}) {
      return resolvedAuthorizationStore?.listReceipts
        ? resolvedAuthorizationStore.listReceipts(input)
        : [];
    },
    listLoanRecords(input = {}) {
      return resolvedAuthorizationStore?.listLoanRecords
        ? resolvedAuthorizationStore.listLoanRecords(input)
        : [];
    },
    listDeniedRequests(input = {}) {
      return resolvedAuthorizationStore?.listDeniedRequests
        ? resolvedAuthorizationStore.listDeniedRequests(input)
        : [];
    },
    listDecisions(input = {}) {
      return resolvedAuthorizationStore?.listDecisions
        ? resolvedAuthorizationStore.listDecisions(input)
        : [];
    },
    appendReceipt(receipt, metadata = {}) {
      if (!receipt || typeof resolvedAuthorizationStore?.appendReceipt !== "function") {
        return null;
      }
      return resolvedAuthorizationStore.appendReceipt(receipt, metadata);
    },
    appendLoanRecord(record, metadata = {}) {
      if (!record || typeof resolvedAuthorizationStore?.appendLoanRecord !== "function") {
        return null;
      }
      return resolvedAuthorizationStore.appendLoanRecord(record, metadata);
    },
    appendDeniedRequest(request = {}) {
      if (!request || typeof resolvedAuthorizationStore?.appendDeniedRequest !== "function") {
        return null;
      }
      return resolvedAuthorizationStore.appendDeniedRequest(request);
    },
    appendDecision(decision = {}) {
      if (!decision || typeof resolvedAuthorizationStore?.appendDecision !== "function") {
        return null;
      }
      return resolvedAuthorizationStore.appendDecision(decision);
    },
    setWorkspaceAssetPolicy(input = {}) {
      const workspaceId = String(input.workspaceId || input.workspace || "default").trim() || "default";
      const policyId = String(input.policyId || input["policy-id"] || `workspace_asset_policy_${crypto.randomUUID()}`).trim();
      const policy = {
        ...input,
        policyId,
        workspaceId,
        updatedAt: new Date().toISOString()
      };
      workspaceAssetPolicies.set(workspaceAssetPolicyKey(workspaceId, policyId), policy);
      return policy;
    },
    getWorkspaceAssetPolicy(input = {}) {
      const workspaceId = String(input.workspaceId || input.workspace || "default").trim() || "default";
      const policyId = String(input.policyId || input["policy-id"] || input.id || "").trim();
      if (!policyId) {
        return null;
      }
      return workspaceAssetPolicies.get(workspaceAssetPolicyKey(workspaceId, policyId)) || null;
    },
    checkWorkspaceAssetPermission(input = {}) {
      if (!resolvedAuthorizationEngine || typeof resolvedAuthorizationEngine.evaluate !== "function") {
        return null;
      }
      return resolvedAuthorizationEngine.evaluate({
        operation: {
          id: "workspace.asset.permission.check",
          requiredScopes: ["workspace:read"],
          safety: { risk: "read_only" },
          readOnly: true
        },
        request: input.request || null,
        authSession: input.authSession || null,
        input,
        context: {
          requestedAction: input.requestedAction || input.action || "read",
          requestedEgress: input.requestedEgress || ""
        }
      });
    }
  });
}
