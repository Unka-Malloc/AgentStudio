import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAuthorizationEngine } from "../platform/common/security/authorization/authorization-engine.mjs";
import { createAuthorizationGovernanceStore } from "../platform/common/security/authorization/authorization-governance-store.mjs";
import { createAuthorizationStore } from "../platform/common/security/authorization/authorization-store.mjs";
import { CONSOLE_ROLES } from "../platform/common/security/auth/console-auth.mjs";
import { createSecurityPermissionsProvider } from "../platform/common/security/security-permissions-provider.mjs";
import { PROTOCOL_OPERATION_DEFINITIONS } from "../platform/common/operation-dispatcher/protocol-operation-definitions.mjs";
import { createToolCatalogRegistry } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolPolicyEngine } from "../platform/specialized/capabilities/tools/tool-management-core/policy.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-authz-governance-"));
const authorizationStore = createAuthorizationStore({ userDataPath });
const governanceStore = createAuthorizationGovernanceStore({ userDataPath, builtinRoles: CONSOLE_ROLES });
const authorizationEngine = createAuthorizationEngine({ store: authorizationStore, governanceStore });
const securityPermissions = createSecurityPermissionsProvider({
  authorizationEngine,
  authorizationStore,
  authorizationGovernanceStore: governanceStore
});
const toolRegistry = createToolCatalogRegistry({ operations: PROTOCOL_OPERATION_DEFINITIONS });
const toolPolicyStore = {
  decisions: [],
  appendPolicyDecision(decision) {
    this.decisions.push(decision);
    return { decisionId: decision.decisionId };
  },
  getRawGrant() {
    return null;
  }
};
const toolPolicyEngine = createToolPolicyEngine({
  registry: toolRegistry,
  store: toolPolicyStore,
  securityPermissions
});

const REPO_A = "github:unka/pact";
const REPO_B = "gerrit:pact/server";
const REPO_C = "github:unka/other";
const USER_ID = "user-alice";
const AGENT_ID = "agent-codex";

function repoPolicy(resourceId, actions = ["repo:write"], providers = ["github"]) {
  return {
    resourceType: "repo",
    resourceId,
    actions,
    targetProviders: providers
  };
}

function operation(id, scopeAction = "repo:write", risk = "safe_write") {
  return {
    id,
    requiredScopes: [scopeAction],
    safety: { risk },
    readOnly: risk === "read_only"
  };
}

function grant(agentId = AGENT_ID, userId = USER_ID, teamIds = ["team-github", "team-gerrit"]) {
  return {
    id: `grant-${agentId}`,
    label: agentId,
    scopes: ["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain"],
    toolsets: ["pact.repo.write"],
    maxRisk: "repair_write",
    metadata: {
      agentId,
      agentProfileId: agentId,
      boundUserId: userId,
      userId,
      teamIds
    }
  };
}

function evaluate({
  operationId = "codespace.change.prepare",
  resourceId = REPO_A,
  provider = "github",
  agentId = AGENT_ID,
  userId = USER_ID,
  traceId = `trace-${Math.random().toString(16).slice(2)}`,
  scopeAction = "repo:write",
  risk = "safe_write"
} = {}) {
  return authorizationEngine.evaluate({
    operation: operation(operationId, scopeAction, risk),
    grant: grant(agentId, userId),
    input: {
      resourceType: "repo",
      resourceId,
      repositoryRef: resourceId,
      targetProvider: provider,
      requestedAction: operationId,
      confirm: true
    },
    traceId,
    governanceRequired: true
  });
}

try {
  const initialRevision = governanceStore.getPolicyRevision();
  assert.equal(initialRevision.protocolVersion, "v0.0.1:risk-control:governance-policy-revision-1");
  assert.equal(initialRevision.revision, 0);

  const builtins = governanceStore.listRoles();
  for (const roleId of ["owner", "admin", "operator", "viewer"]) {
    assert.ok(builtins.some((role) => role.roleId === roleId && role.system), `builtin role missing: ${roleId}`);
  }

  const customRole = governanceStore.upsertRole({
    roleId: "repo-maintainer-template",
    label: "Repo Maintainer Template",
    scopes: ["repo:read", "repo:write", "repo:maintain"],
    resourcePolicies: [repoPolicy(REPO_B, ["repo:write", "repo:maintain"], ["gerrit"])]
  });
  assert.equal(customRole.system, false);
  assert.equal(governanceStore.getRole("repo-maintainer-template").resourcePolicies.length, 1);

  governanceStore.upsertTeam({
    teamId: "team-github",
    label: "GitHub Team",
    memberUserIds: [USER_ID],
    resourcePolicies: [repoPolicy(REPO_A, ["repo:write", "repo:maintain", "repo:review", "repo:approve"], ["github"])]
  });
  governanceStore.upsertTeam({
    teamId: "team-gerrit",
    label: "Gerrit Team",
    memberUserIds: [USER_ID],
    roleIds: ["repo-maintainer-template"]
  });
  governanceStore.upsertUserPolicy({
    userId: USER_ID,
    teamIds: ["team-github", "team-gerrit"],
    resourcePolicies: [
      repoPolicy(REPO_A, ["repo:write", "repo:maintain", "repo:review", "repo:approve"], ["github"]),
      repoPolicy(REPO_B, ["repo:write", "repo:maintain"], ["gerrit"])
    ]
  });
  governanceStore.upsertAgentGroup({
    groupId: "code-submitters",
    label: "Code Submitters",
    resourcePolicies: [repoPolicy(REPO_A, ["repo:write", "repo:maintain"], ["github"])]
  });
  governanceStore.upsertAgentBinding({
    agentId: AGENT_ID,
    boundUserId: USER_ID,
    groupIds: ["code-submitters"],
    resourcePolicies: [repoPolicy(REPO_B, ["repo:write", "repo:maintain"], ["gerrit"])]
  });

  const multiTeamAllowed = evaluate({
    operationId: "codespace.change.upload",
    resourceId: REPO_B,
    provider: "gerrit",
    scopeAction: "repo:maintain",
    risk: "repair_write",
    traceId: "trace-governance-team-union"
  });
  assert.equal(multiTeamAllowed.effect, "allow");
  assert.ok(multiTeamAllowed.effectivePolicySnapshot.team.matchedTeamIds.includes("team-gerrit"));
  assert.ok(multiTeamAllowed.decisionId);
  assert.ok(multiTeamAllowed.auditId);
  assert.equal(multiTeamAllowed.traceId, "trace-governance-team-union");
  const currentRevision = governanceStore.getPolicyRevision();
  assert.equal(currentRevision.revision > initialRevision.revision, true);
  assert.deepEqual(multiTeamAllowed.effectivePolicySnapshot.policyRevision, currentRevision);
  assert.deepEqual(securityPermissions.getGovernanceSummary().policyRevision, currentRevision);

  const tool = toolRegistry.getToolByOperationId("codespace.change.upload");
  assert.ok(tool, "codespace upload tool must exist");
  const staleGrantDecision = toolPolicyEngine.evaluate({
    tool,
    grant: {
      ...grant(),
      metadata: {
        ...grant().metadata,
        policyRevision: Math.max(1, currentRevision.revision - 1)
      }
    },
    input: {
      resourceType: "repo",
      resourceId: REPO_B,
      repositoryRef: REPO_B,
      provider: "gerrit",
      targetProvider: "gerrit",
      confirm: true
    },
    context: {
      agentId: AGENT_ID,
      boundUserId: USER_ID,
      teamIds: ["team-github", "team-gerrit"],
      resource: {
        resourceType: "repo",
        resourceId: REPO_B,
        targetProvider: "gerrit"
      }
    },
    traceId: "trace-governance-stale-grant"
  });
  assert.equal(staleGrantDecision.effect, "allow");
  assert.equal(staleGrantDecision.grantPolicyState, currentRevision.revision > 1 ? "stale" : "fresh");
  assert.deepEqual(staleGrantDecision.governancePolicyRevision, currentRevision);
  const freshGrantDecision = toolPolicyEngine.evaluate({
    tool,
    grant: {
      ...grant(),
      metadata: {
        ...grant().metadata,
        policyRevision: currentRevision.revision
      }
    },
    input: {
      resourceType: "repo",
      resourceId: REPO_B,
      repositoryRef: REPO_B,
      provider: "gerrit",
      targetProvider: "gerrit",
      confirm: true
    },
    context: {
      agentId: AGENT_ID,
      boundUserId: USER_ID,
      teamIds: ["team-github", "team-gerrit"],
      resource: {
        resourceType: "repo",
        resourceId: REPO_B,
        targetProvider: "gerrit"
      }
    },
    traceId: "trace-governance-fresh-grant"
  });
  assert.equal(freshGrantDecision.effect, "allow");
  assert.equal(freshGrantDecision.grantPolicyState, "fresh");

  const teamDenied = evaluate({ resourceId: REPO_C, provider: "github" });
  assert.equal(teamDenied.effect, "deny");
  assert.equal(teamDenied.deniedLayer, "team");

  governanceStore.upsertUserPolicy({
    userId: "user-needs-approval",
    teamIds: ["team-github"],
    resourcePolicies: []
  });
  governanceStore.upsertAgentBinding({
    agentId: "agent-user-approval",
    boundUserId: "user-needs-approval",
    resourcePolicies: [repoPolicy(REPO_A, ["repo:write"], ["github"])]
  });
  const userNeedsApproval = evaluate({
    agentId: "agent-user-approval",
    userId: "user-needs-approval"
  });
  assert.equal(userNeedsApproval.effect, "needsApproval");
  assert.equal(userNeedsApproval.deniedLayer, "user");
  assert.deepEqual(userNeedsApproval.requiredApproval.grantKinds, ["once", "timed", "permanent"]);

  for (const grantKind of ["once", "timed", "permanent"]) {
    const approval = governanceStore.upsertApproval({
      approvalId: `approval-${grantKind}`,
      userId: "user-needs-approval",
      agentId: "agent-user-approval",
      resourceType: "repo",
      resourceId: REPO_A,
      actions: ["repo:write"],
      targetProviders: ["github"],
      grantKind,
      expiresAt: grantKind === "timed" ? new Date(Date.now() + 60_000).toISOString() : ""
    });
    const decision = evaluate({
      agentId: "agent-user-approval",
      userId: "user-needs-approval"
    });
    assert.equal(decision.effect, "allow", `${grantKind} approval should allow the request`);
    governanceStore.revokeApproval(approval.approvalId, "verified");
  }

  governanceStore.upsertApproval({
    approvalId: "approval-expired",
    userId: "user-needs-approval",
    agentId: "agent-user-approval",
    resourceType: "repo",
    resourceId: REPO_A,
    actions: ["repo:write"],
    targetProviders: ["github"],
    grantKind: "timed",
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  });
  assert.equal(evaluate({ agentId: "agent-user-approval", userId: "user-needs-approval" }).effect, "needsApproval");

  governanceStore.upsertUserPolicy({
    userId: "user-agent-approval",
    teamIds: ["team-github"],
    resourcePolicies: [repoPolicy(REPO_A, ["repo:write"], ["github"])]
  });
  governanceStore.upsertAgentBinding({
    agentId: "agent-no-policy",
    boundUserId: "user-agent-approval",
    resourcePolicies: []
  });
  const agentNeedsApproval = evaluate({
    agentId: "agent-no-policy",
    userId: "user-agent-approval"
  });
  assert.equal(agentNeedsApproval.effect, "needsApproval");
  assert.equal(agentNeedsApproval.deniedLayer, "agent");

  governanceStore.upsertAgentGroup({
    groupId: "other-repo-only",
    resourcePolicies: [repoPolicy(REPO_C, ["repo:write"], ["github"])]
  });
  governanceStore.upsertAgentBinding({
    agentId: "agent-group-expander",
    boundUserId: "user-agent-approval",
    groupIds: ["other-repo-only"]
  });
  const groupCannotExpand = evaluate({
    agentId: "agent-group-expander",
    userId: "user-agent-approval",
    resourceId: REPO_C,
    provider: "github"
  });
  assert.equal(groupCannotExpand.effect, "deny");
  assert.equal(groupCannotExpand.deniedLayer, "team");

  const storedDecision = authorizationStore.listDecisions({
    traceId: "trace-governance-team-union",
    limit: 10
  })[0];
  assert.equal(storedDecision.decision.auditId, multiTeamAllowed.auditId);
  assert.equal(storedDecision.decision.effectivePolicySnapshot.team.allowed, true);

  console.log("authorization governance verifier passed");
} finally {
  governanceStore.close();
  authorizationStore.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
