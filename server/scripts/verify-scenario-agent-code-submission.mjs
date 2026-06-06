import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROTOCOL_OPERATION_DEFINITIONS } from "../platform/common/operation-dispatcher/protocol-operation-definitions.mjs";
import { createAuthorizationGovernanceStore } from "../platform/common/security/authorization/authorization-governance-store.mjs";
import { createAuthorizationStore } from "../platform/common/security/authorization/authorization-store.mjs";
import { CONSOLE_ROLES } from "../platform/common/security/auth/console-auth.mjs";
import { createSecurityPermissionsProvider } from "../platform/common/security/security-permissions-provider.mjs";
import { createCodespaceRegistry } from "../platform/specialized/capabilities/code-management/codespace/index.mjs";
import { createToolCatalogRegistry } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolPolicyEngine } from "../platform/specialized/capabilities/tools/tool-management-core/policy.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-scenario-agent-code-submission-"));
const authorizationStore = createAuthorizationStore({ userDataPath });
const governanceStore = createAuthorizationGovernanceStore({ userDataPath, builtinRoles: CONSOLE_ROLES });
const securityPermissions = createSecurityPermissionsProvider({
  authorizationStore,
  authorizationGovernanceStore: governanceStore
});
const registry = createToolCatalogRegistry({ operations: PROTOCOL_OPERATION_DEFINITIONS });
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
  registry,
  store: policyStore,
  securityPermissions
});
const codespace = createCodespaceRegistry({
  userDataPath,
  executeRepoOperation: async ({ operationId, input }) => {
    if (input.liveProviderReceipt === true) {
      return {
        ok: true,
        status: 201,
        data: {
          contractVerified: false,
          providerMode: "live",
          operationId,
          provider: input.provider || "github",
          repositoryRef: input.repositoryRef || input.repoId || "",
          pullRequestNumber: "77",
          reviewUrl: "https://github.com/unka/pact/pull/77",
          stdout: "https://github.com/unka/pact/pull/77\n"
        }
      };
    }
    return {
      ok: true,
      status: 200,
      data: {
        contractVerified: true,
        operationId,
        provider: input.provider || "github",
        repositoryRef: input.repositoryRef || input.repoId || ""
      }
    };
  },
  uploadGerritGitChange: async (input = {}) => ({
    ok: true,
    status: 200,
    provider: "gerrit",
    targetProvider: "gerrit",
    repositoryRef: input.repositoryRef || "pact/server",
    branch: input.branch || "main",
    changeId: input.changeId || "I1234567890abcdef",
    changeNumber: input.changeNumber || "12345",
    changeRef: "refs/changes/45/12345/1",
    reviewUrl: "https://gerrit.example.invalid/c/pact/server/+/12345",
    uploadId: "upload-gerrit-contract",
    dryRun: input.dryRun !== false,
    completion: {
      confirmed: input.dryRun === false,
      contractVerified: true,
      receiptId: "receipt-gerrit-contract"
    }
  })
});

const REPO = "unka/pact";
const TEAM_ID = "team-code-submit";
const USER_ID = "user-code-owner";
const AGENT_A = "agent-codex";
const AGENT_B = "agent-opencode";

function repoPolicy(actions = ["repo:read"], providers = ["github", "gerrit"]) {
  return {
    resourceType: "repo",
    resourceId: REPO,
    actions,
    targetProviders: providers
  };
}

function grant(agentId, userId = USER_ID) {
  return {
    id: `grant-${agentId}`,
    label: agentId,
    scopes: ["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain"],
    toolsets: ["pact.repo.write", "pact.repo.review"],
    maxRisk: "repair_write",
    metadata: {
      agentId,
      agentProfileId: agentId,
      boundUserId: userId,
      userId,
      teamIds: [TEAM_ID]
    }
  };
}

function assertToolAvailable(operationId) {
  const tool = registry.getToolByOperationId(operationId);
  assert.ok(tool, `MCP tool missing for ${operationId}`);
  assert.equal(tool.operationId, operationId);
  return tool;
}

function evaluateTool({
  operationId,
  agentId = AGENT_A,
  userId = USER_ID,
  provider = "github",
  extraInput = {},
  traceId = `trace-${operationId}-${provider}-${agentId}`
} = {}) {
  const tool = assertToolAvailable(operationId);
  const decision = policyEngine.evaluate({
    tool,
    grant: grant(agentId, userId),
    input: {
      resourceType: "repo",
      resourceId: REPO,
      repositoryRef: REPO,
      provider,
      targetProvider: provider,
      branch: "main",
      confirm: true,
      ...extraInput
    },
    traceId,
    context: {
      agentId,
      profileId: agentId,
      boundUserId: userId,
      userId,
      teamIds: [TEAM_ID],
      resource: {
        resourceType: "repo",
        resourceId: REPO,
        targetProvider: provider
      }
    }
  });
  assert.ok(decision.decisionId);
  assert.ok(decision.auditId);
  assert.equal(decision.traceId, traceId);
  assert.ok(decision.effectivePolicySnapshot);
  return decision;
}

try {
  governanceStore.upsertTeam({
    teamId: TEAM_ID,
    label: "Code Submit Team",
    memberUserIds: [USER_ID],
    resourcePolicies: [repoPolicy(["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain"])]
  });
  governanceStore.upsertUserPolicy({
    userId: USER_ID,
    teamIds: [TEAM_ID],
    resourcePolicies: [repoPolicy(["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain"])]
  });
  governanceStore.upsertAgentGroup({
    groupId: "code-submitters",
    resourcePolicies: [repoPolicy(["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain"])]
  });
  for (const agentId of [AGENT_A, AGENT_B]) {
    governanceStore.upsertAgentBinding({
      agentId,
      boundUserId: USER_ID,
      groupIds: ["code-submitters"]
    });
  }

  for (const operationId of [
    "codespace.providers.manifest",
    "codespace.change.prepare",
    "codespace.change.upload",
    "codespace.review.comment",
    "codespace.review.requestChanges",
    "codespace.review.approve",
    "codespace.review.status.sync"
  ]) {
    assertToolAvailable(operationId);
  }

  const unboundDiscovery = policyEngine.evaluate({
    tool: assertToolAvailable("codespace.providers.manifest"),
    grant: {
      id: "grant-unbound-discovery",
      scopes: ["repo:read"],
      toolsets: ["pact.repo.read"],
      maxRisk: "read_only",
      metadata: { agentId: "agent-unbound" }
    },
    input: {},
    traceId: "trace-unbound-readonly-discovery"
  });
  assert.equal(unboundDiscovery.effect, "allow");
  assert.equal(unboundDiscovery.reasonCode, "agent_readonly_discovery_allowed");

  const unboundSubmitDenied = policyEngine.evaluate({
    tool: assertToolAvailable("codespace.change.upload"),
    grant: {
      id: "grant-unbound-submit",
      scopes: ["repo:maintain"],
      toolsets: ["pact.repo.write"],
      maxRisk: "repair_write",
      metadata: { agentId: "agent-unbound" }
    },
    input: {
      resourceType: "repo",
      resourceId: REPO,
      repositoryRef: REPO,
      provider: "github",
      confirm: true
    },
    traceId: "trace-unbound-submit-denied"
  });
  assert.equal(unboundSubmitDenied.effect, "deny");
  assert.equal(unboundSubmitDenied.allowed, false);

  const agentADecision = evaluateTool({ operationId: "codespace.change.prepare", agentId: AGENT_A });
  const agentBDecision = evaluateTool({ operationId: "codespace.change.prepare", agentId: AGENT_B });
  assert.equal(agentADecision.effect, "allow");
  assert.equal(agentBDecision.effect, "allow");

  const prepared = await codespace.prepareChange({
    workspaceId: "workspace-code-submit",
    targetProvider: "github",
    repositoryRef: REPO,
    branch: "main",
    diff: "diff --git a/README.md b/README.md\n",
    commitPlan: [{ message: "Verify agent code submission contract" }]
  });
  assert.equal(prepared.ok, true);
  assert.ok(prepared.codeChangeId);
  assert.ok(prepared.auditId);

  const githubDraftDecision = evaluateTool({
    operationId: "codespace.change.upload",
    provider: "github",
    extraInput: { codeChangeId: prepared.codeChangeId, dryRun: true },
    traceId: "trace-github-draft-pr"
  });
  assert.equal(githubDraftDecision.effect, "allow");
  const githubDraft = await codespace.uploadCodespaceChange({
    workspaceId: "workspace-code-submit",
    codeChangeId: prepared.codeChangeId,
    provider: "github",
    repositoryRef: REPO,
    branch: "main",
    dryRun: true
  });
  assert.equal(githubDraft.ok, true);
  assert.equal(githubDraft.provider, "github");
  assert.equal(githubDraft.contractVerified, true);
  assert.equal(githubDraft.providerMode, "contract");
  assert.equal(githubDraft.uploadState, "dry-run");
  assert.equal(githubDraft.codeChange.reviewStatus, "draft");
  assert.ok(githubDraft.auditId);
  assert.ok(githubDraft.completion.receipt.contractVerified);

  const providerConfigPath = path.join(userDataPath, "code-management", "codespace-providers.json");
  const providerConfig = JSON.parse(await fs.readFile(providerConfigPath, "utf8"));
  providerConfig.providers.github.mode = "live";
  await fs.writeFile(providerConfigPath, `${JSON.stringify(providerConfig, null, 2)}\n`, "utf8");

  const githubReadyDecision = evaluateTool({
    operationId: "codespace.change.upload",
    provider: "github",
    extraInput: { codeChangeId: prepared.codeChangeId, dryRun: false, liveProviderReceipt: true },
    traceId: "trace-github-ready-pr"
  });
  assert.equal(githubReadyDecision.effect, "allow");
  const githubReady = await codespace.uploadCodespaceChange({
    workspaceId: "workspace-code-submit",
    codeChangeId: prepared.codeChangeId,
    provider: "github",
    repoId: "mock-live-github-repo",
    repositoryRef: REPO,
    branch: "main",
    dryRun: false,
    liveProviderReceipt: true
  });
  assert.equal(githubReady.ok, true);
  assert.equal(githubReady.provider, "github");
  assert.equal(githubReady.codeChange.reviewStatus, "open");
  assert.equal(githubReady.contractVerified, false);
  assert.equal(githubReady.providerMode, "live");
  assert.equal(githubReady.uploadState, "remote-live");
  assert.equal(githubReady.completion.contractVerified, false);
  assert.equal(githubReady.completion.confirmed, true);
  assert.equal(githubReady.completion.providerMode, "live");
  assert.equal(githubReady.completion.uploadState, "remote-live");
  assert.equal(githubReady.completion.receipt.pullRequestNumber, "77");
  assert.equal(githubReady.codeChange.changeNumber, "77");
  assert.doesNotMatch(githubReady.codeChange.reviewUrl, /github\.example\.invalid/);

  const gerritDecision = evaluateTool({
    operationId: "codespace.change.upload",
    provider: "gerrit",
    extraInput: { codeChangeId: prepared.codeChangeId, dryRun: true },
    traceId: "trace-gerrit-change"
  });
  assert.equal(gerritDecision.effect, "allow");
  const gerritChange = await codespace.uploadCodespaceChange({
    workspaceId: "workspace-code-submit",
    codeChangeId: prepared.codeChangeId,
    provider: "gerrit",
    repositoryRef: REPO,
    branch: "main",
    dryRun: true
  });
  assert.equal(gerritChange.ok, true);
  assert.equal(gerritChange.operationId, "codespace.change.upload");
  assert.equal(gerritChange.target.targetProvider, "gerrit");
  assert.equal(gerritChange.codeChange.reviewStatus, "draft");
  assert.ok(gerritChange.auditId);

  for (const [operationId, provider] of [
    ["codespace.review.comment", "github"],
    ["codespace.review.requestChanges", "github"],
    ["codespace.review.approve", "github"],
    ["codespace.review.status.sync", "gerrit"]
  ]) {
    const decision = evaluateTool({
      operationId,
      provider,
      extraInput: {
        codeChangeId: prepared.codeChangeId,
        reviewTarget: githubReady.codeChange.changeRef || githubReady.codeChange.changeId,
        providerReceipt: { result: { status: "open" } }
      },
      traceId: `trace-${operationId}`
    });
    assert.equal(decision.effect, "allow");
  }

  governanceStore.upsertAgentBinding({
    agentId: "agent-needs-approval",
    boundUserId: USER_ID,
    resourcePolicies: []
  });
  const approvalDecision = evaluateTool({
    operationId: "codespace.change.upload",
    agentId: "agent-needs-approval",
    provider: "github",
    extraInput: { dryRun: true },
    traceId: "trace-agent-submit-needs-approval"
  });
  assert.equal(approvalDecision.effect, "needsApproval");
  assert.equal(approvalDecision.deniedLayer, "agent");
  assert.equal(approvalDecision.requiredApproval.resourceType, "repo");

  const stored = authorizationStore.listDecisions({ limit: 100 });
  assert.ok(stored.some((item) => item.decision.traceId === "trace-github-draft-pr"));
  assert.ok(stored.some((item) => item.decision.traceId === "trace-gerrit-change"));
  assert.ok(policyStore.decisions.some((item) => item.traceId === "trace-agent-submit-needs-approval"));

  console.log("scenario agent code submission verifier passed");
} finally {
  authorizationStore.close();
  governanceStore.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
