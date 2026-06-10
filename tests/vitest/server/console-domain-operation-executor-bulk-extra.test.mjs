import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs", () => ({
  listRuntimeDependencies: vi.fn(async (input) => ({ ok: true, dependencies: [], input })),
  downloadRuntimeDependency: vi.fn(async (input) => ({
    ok: input.targetId !== "not-real",
    targetId: input.targetId,
    planned: input.dryRun === true
  })),
  updateRuntimeDependencyConfiguration: vi.fn(async (input) => ({ ok: true, updated: input.entries?.length || 0 }))
}));

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-domain-bulk-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

function publishEvent(topic, _payload, options = {}) {
  return {
    id: `evt-${options.type || topic}`,
    offset: 1,
    topic
  };
}

function protocolEventBus() {
  return {
    publish: vi.fn(publishEvent),
    subscribe: vi.fn(async ({ cursor = 0, topics = [] } = {}) => ({
      cursor,
      nextCursor: cursor + 1,
      topics,
      events: [{ id: "event-1", topic: topics[0] || "agent_sync.test" }]
    }))
  };
}

function knowledgeCore() {
  return {
    enabled: true,
    capabilities: vi.fn(async () => ({ ok: true, features: ["search"] })),
    exportDocx: vi.fn(async () => ({
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "knowledge.docx",
      buffer: Buffer.from("docx")
    })),
    exportMarkdown: vi.fn(async () => ({
      contentType: "text/markdown",
      fileName: "knowledge.md",
      buffer: Buffer.from("# Knowledge")
    })),
    exportHtml: vi.fn(async () => ({
      contentType: "text/html",
      fileName: "knowledge.html",
      buffer: Buffer.from("<p>Knowledge</p>")
    })),
    health: vi.fn(async () => ({ ok: true })),
    getMaintenance: vi.fn(async () => ({ retrieval: { topK: 10 } })),
    setMaintenance: vi.fn(async () => ({ retrieval: { recencyHalfLifeDays: 30 } })),
    reindex: vi.fn(async () => ({ ok: true, reindexed: 1 })),
    runMaintenance: vi.fn(async () => ({ ok: true, taskType: "validate_assets" })),
    syncMirror: vi.fn(async () => ({ ok: true, scope: "mirror" })),
    listReviewItems: vi.fn(async () => ({
      items: [{ id: "core-review", updatedAt: "2026-06-04T00:00:01Z" }]
    })),
    resolveReviewItem: vi.fn(async () => ({ id: "core-review", status: "accepted" })),
    recordFeedback: vi.fn(async () => ({ ok: true, feedbackId: "fb-1" })),
    listSuggestions: vi.fn(async () => ({ items: [{ id: "sg-1" }] })),
    resolveSuggestion: vi.fn(async () => ({ id: "sg-1", status: "accepted" })),
    runLearningJob: vi.fn(async () => ({ ok: true, jobId: "learn-1" })),
    learningHealth: vi.fn(async () => ({ ok: true, jobs: 1 }))
  };
}

function metadataStore() {
  return {
    syncKnowledge: vi.fn(() => ({ ok: true, synced: 1 })),
    submitKnowledgeChanges: vi.fn(() => ({ ok: true, changes: 1 })),
    listKnowledgeReviewItems: vi.fn(() => ({
      items: [{ id: "meta-review", updatedAt: "2026-06-04T00:00:00Z" }]
    })),
    resolveKnowledgeReviewItem: vi.fn(() => null),
    getKnowledgeGraph: vi.fn(() => ({ nodes: [], edges: [] })),
    searchKnowledge: vi.fn(() => ({ items: [{ id: "meta-hit" }], count: 1 })),
    getKnowledgeItem: vi.fn(() => ({ id: "item-1" }))
  };
}

function securityPermissions() {
  return {
    getConsoleSummary: vi.fn(() => ({ session: null })),
    getSummary: vi.fn(() => ({ session: null })),
    login: vi.fn(async () => ({
      cookies: ["sid=1"],
      csrfToken: "csrf-1",
      session: { sessionId: "s-1", user: { userId: "u-1", username: "alice", roleId: "admin" } }
    })),
    logout: vi.fn(() => ({ cookies: ["sid=; Max-Age=0"] })),
    audit: vi.fn(),
    roleList: vi.fn(() => [{ roleId: "admin", label: "Admin" }]),
    listUsers: vi.fn(() => [{ userId: "u-1", username: "alice" }]),
    updateUser: vi.fn(async () => ({ userId: "u-1", roleId: "admin", enabled: true })),
    getOidcConfig: vi.fn(() => ({ enabled: false })),
    setOidcConfig: vi.fn((input) => ({ enabled: Boolean(input.enabled), issuer: input.issuer || "" })),
    listAudit: vi.fn(() => [{ auditId: "a-1" }]),
    listSessions: vi.fn(() => [{ sessionId: "s-1" }]),
    rotateSession: vi.fn(() => ({
      ok: true,
      cookies: ["sid=2"],
      csrfToken: "csrf-2",
      rotatedAt: "2026-06-04T00:00:00Z",
      session: { sessionId: "s-2", user: { userId: "u-1", username: "alice" } }
    })),
    revokeSession: vi.fn(() => ({ ok: true, sessionId: "s-1" })),
    listDecisions: vi.fn(() => [{ decisionId: "d-1" }]),
    resolveSubject: vi.fn(() => ({ subjectId: "u-1", type: "console-user" })),
    evaluatePolicy: vi.fn(() => ({ allow: true })),
    getGovernanceSummary: vi.fn(() => ({ revision: "rev-1" })),
    getGovernancePolicyRevision: vi.fn(() => "rev-1"),
    listGovernanceRoles: vi.fn(() => [{ roleId: "operator" }]),
    upsertGovernanceRole: vi.fn((input) => ({ roleId: input.roleId || "operator" })),
    listGovernanceTeams: vi.fn(() => [{ teamId: "team-1" }]),
    upsertGovernanceTeam: vi.fn((input) => ({ teamId: input.teamId || "team-1" })),
    listGovernanceUserPolicies: vi.fn(() => [{ userId: "u-1" }]),
    upsertGovernanceUserPolicy: vi.fn((input) => ({ userId: input.userId || "u-1" })),
    listGovernanceAgentGroups: vi.fn(() => [{ groupId: "g-1" }]),
    upsertGovernanceAgentGroup: vi.fn((input) => ({ groupId: input.groupId || "g-1" })),
    listGovernanceAgentBindings: vi.fn(() => [{ agentId: "agent-1" }]),
    upsertGovernanceAgentBinding: vi.fn((input) => ({ agentId: input.agentId || "agent-1" })),
    listGovernanceApprovals: vi.fn(() => [{ approvalId: "ap-1" }]),
    upsertGovernanceApproval: vi.fn((input) => ({ approvalId: input.approvalId || "ap-1" })),
    revokeGovernanceApproval: vi.fn((approvalId) => ({ approvalId })),
    listReceipts: vi.fn(() => [{ id: "receipt-1" }]),
    listLoanRecords: vi.fn(() => [{ id: "loan-1" }]),
    listDeniedRequests: vi.fn(() => [{ id: "denied-1" }]),
    setWorkspaceAssetPolicy: vi.fn((input) => ({ workspaceId: input.workspaceId, policyId: "policy-1" })),
    checkWorkspaceAssetPermission: vi.fn(() => ({ allow: true }))
  };
}

function auditStore() {
  return {
    list: vi.fn(() => [{ auditId: "audit-1", status: "ok", operationId: "x", readOnly: false }]),
    exportRedacted: vi.fn(() => ({
      manifest: { count: 1 },
      items: [{ auditId: "audit-1" }],
      jsonl: "{\"auditId\":\"audit-1\"}\n"
    })),
    getRetentionPolicy: vi.fn(() => ({ retentionDays: 30 })),
    setRetentionPolicy: vi.fn((input) => ({ retentionDays: Number(input.retentionDays || 30) })),
    pruneExpired: vi.fn(() => ({ removed: 1 })),
    getTrace: vi.fn(() => ({ traceId: "trace-1", items: [] }))
  };
}

function storageProvider() {
  return {
    getStorageSummary: vi.fn(() => ({ totalBytes: 10 })),
    runDoctor: vi.fn(async () => ({ ok: true })),
    reconcile: vi.fn(async () => ({ ok: true })),
    listBackups: vi.fn(async () => [{ id: "backup-1" }]),
    createBackup: vi.fn(async () => ({ id: "backup-1" })),
    restoreBackupPreview: vi.fn(async () => ({ ok: true, dryRun: true })),
    restoreBackup: vi.fn(async () => ({ ok: true })),
    rebuildSourceVocabulary: vi.fn(() => ({ ok: true })),
    getSignificantSourceTerms: vi.fn(() => ({ terms: ["alpha"] })),
    search: vi.fn(() => ({ items: [{ id: "hit-1" }] })),
    recordClientCheckIn: vi.fn((input) => ({ ...input, checkedIn: true })),
    listClientRegistrations: vi.fn(() => [{ clientId: "client-1" }]),
    findClientRegistration: vi.fn(() => ({ clientId: "client-1" }))
  };
}

function agentWorkspace() {
  const ok = (extra = {}) => ({ ok: true, workspaceId: "ws-1", ...extra });
  return {
    protocolVersion: "pact.agent-workspace.v1",
    connectLocalDirectory: vi.fn(() => ok({ mountId: "mount-1" })),
    listLocalDirectoryMounts: vi.fn(() => ok({ items: [] })),
    listLocalDirectoryItems: vi.fn(() => ok({ items: [] })),
    createWorkspaceFolder: vi.fn(async () => ok({ folder: "docs" })),
    listWorkspaceFiles: vi.fn(async () => ok({ files: [] })),
    workspaceFileMetadata: vi.fn(async () => ok({ path: "a.txt" })),
    downloadWorkspaceFile: vi.fn(async () => ok({ text: "hello" })),
    uploadWorkspaceFile: vi.fn(async () => ok({ path: "a.txt" })),
    writeWorkspaceFile: vi.fn(async () => ok({ path: "a.txt" })),
    patchWorkspaceFile: vi.fn(async () => ok({ path: "a.txt" })),
    deleteWorkspaceFile: vi.fn(async () => ok({ deleted: true })),
    moveWorkspaceFile: vi.fn(async () => ok({ moved: true })),
    localDirectorySyncPlan: vi.fn(() => ok({ plan: [] })),
    applyLocalDirectorySync: vi.fn(async () => ok({ applied: true })),
    listWorkspaces: vi.fn(() => ({ items: [{ workspaceId: "ws-1" }] })),
    getWorkspace: vi.fn(() => ({ workspaceId: "ws-1", title: "Workspace" })),
    getWorkspaceContext: vi.fn(() => ({ workspaceId: "ws-1", contextProfileId: "default", modelAlias: "model-a" })),
    createWorkspace: vi.fn(() => ({ ok: true, workspace: { workspaceId: "ws-1", title: "Workspace" } })),
    setWorkspaceParent: vi.fn(() => ({ ok: true, workspace: { workspaceId: "ws-1", parentWorkspaceId: "root" } })),
    deleteWorkspace: vi.fn(() => ok({ deleted: true })),
    listSessions: vi.fn(() => ({ items: [{ sessionId: "s-1" }] })),
    getSession: vi.fn(() => ({ sessionId: "s-1" })),
    getSessionContext: vi.fn(() => ({ sessionId: "s-1", workspaceId: "ws-1", modelAlias: "model-a" })),
    appendSessionEvent: vi.fn(() => ({ eventId: "event-1" })),
    forkSession: vi.fn(() => ok({ sessionId: "fork-1" })),
    compareSessions: vi.fn(() => ok({ diff: [] })),
    createSessionMergeProposal: vi.fn(() => ok({ proposalId: "merge-1" })),
    archiveSession: vi.fn(() => ok({ archived: true })),
    resolveSubmission: vi.fn(() => ({
      submission: { submissionId: "sub-1", status: "accepted", payload: { title: "Decision" } }
    })),
    updateIssue: vi.fn(() => ({ issueId: "issue-1", status: "closed" })),
    listLocks: vi.fn(() => [{ lockId: "lock-1" }]),
    acquireLock: vi.fn(() => ok({ lockId: "lock-1" })),
    releaseLock: vi.fn(() => ok({ released: true })),
    submit: vi.fn(() => ({ submission: { submissionId: "proposal-1", payload: { title: "Proposal" } } })),
    createDecision: vi.fn(() => ({ decision: { decisionId: "decision-1" } })),
    exportWorkspaceContextBundle: vi.fn(() => ({ bundleId: "bundle-1" })),
    restoreWorkspaceContextBundle: vi.fn(() => ok({ restored: true })),
    resolveWorkspaceChain: vi.fn(() => [{ workspaceId: "ws-1" }]),
    resolveWorkspaceSourceIds: vi.fn(() => ["source-1"]),
    resolveWorkspaceProfile: vi.fn(() => ({ profileId: "default" })),
    hotSwapProfile: vi.fn(() => ok({ profileId: "fast" })),
    setOwnedSourceIds: vi.fn(() => ok({ sourceIds: ["source-1"] })),
    shareWorkspace: vi.fn(() => ok({ shared: true })),
    unshareWorkspace: vi.fn(() => ok({ shared: false }))
  };
}

describe("console-domain bulk provider dispatch", () => {
  it("covers knowledge management and retrieval operations", async () => {
    const bus = protocolEventBus();
    const core = knowledgeCore();
    const metadata = metadataStore();
    const context = {
      runtime: { mounts: { knowledgeBase: core } },
      metadataStore: metadata,
      protocolEventBus: bus,
      saveSettings: vi.fn(async () => ({})),
      userDataPath: "/tmp/pact-console-domain-knowledge",
      loadEmailRules: vi.fn(async () => ({}))
    };

    const calls = [
      ["knowledge.config_schema", {}, 200],
      ["knowledge.capabilities", {}, 200],
      ["knowledge.export_docx", { documentId: "doc-1", includeMachineReadable: "true" }, 200],
      ["knowledge.export_markdown", { batchId: "batch-1" }, 200],
      ["knowledge.export_html", { sourceId: "source-1" }, 200],
      ["knowledge.health", {}, 200],
      ["knowledge.maintenance.get", {}, 200],
      ["knowledge.maintenance.set", { retrieval: { recencyHalfLifeDays: 30 } }, 200],
      ["knowledge.reindex", { confirm: true }, 200],
      ["knowledge.maintenance.run", { taskType: "validate_assets" }, 200],
      ["knowledge.sync", { scope: "mirror", since: "2" }, 200],
      ["knowledge.sync", { scope: "metadata" }, 200],
      ["knowledge.changes", { changes: [{ id: "c-1" }] }, 200],
      ["knowledge.review_items", { status: "all", limit: 10 }, 200],
      ["knowledge.review_resolve", { reviewId: "core-review", action: "accept" }, 200],
      ["knowledge.feedback", { itemId: "item-1" }, 200],
      ["knowledge.suggestions", { status: "pending" }, 200],
      ["knowledge.suggestion_resolve", { suggestionId: "sg-1", action: "accept" }, 200],
      ["knowledge.learning.jobs", { taskType: "profile" }, 200],
      ["knowledge.learning.health", {}, 200],
      ["knowledge.graph", { seed: "node-1" }, 200],
      ["knowledge.search", { query: "terms", limit: "1" }, 200],
      ["knowledge.document_structure", { documentId: "missing" }, 503],
      ["knowledge.item", { id: "item-1" }, 200]
    ];

    for (const [operationId, input, status] of calls) {
      await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
    }
    expect(core.setMaintenance).toHaveBeenCalled();
    expect(context.saveSettings).toHaveBeenCalledWith(context.userDataPath, { retrievalHalfLifeDays: 30 });
    expect(bus.publish).toHaveBeenCalled();
  });

  it("covers storage, corpus, runtime, monitor, checkpoint, and discovery operations", async () => {
    await withTempDir(async (userDataPath) => {
      const storage = storageProvider();
      const devopsProvider = {
        getMonitorAlertState: vi.fn(async () => ({ alerts: [] })),
        saveMonitorAlertConfig: vi.fn(async (config) => config),
        acknowledgeMonitorAlert: vi.fn(async () => ({ ok: true })),
        recoverBackgroundSupervisor: vi.fn(async () => ({ ok: true })),
        getBackgroundProcessStatus: vi.fn(async () => ({ processes: [] }))
      };
      const checkpointTreeApi = {
        listCheckpointTrees: vi.fn(async () => [{ treeId: "tree-1" }]),
        checkpointTreeSummary: vi.fn((tree) => ({ treeId: tree.treeId })),
        loadCheckpointTree: vi.fn(async () => ({ treeId: "tree-1" })),
        diffCheckpointTree: vi.fn(async () => ({ ok: true, files: [] })),
        queryCheckpointScope: vi.fn(async () => ({ ok: true, scope: [] })),
        previewCheckpointRestore: vi.fn(async () => ({ ok: true, actions: [] })),
        restoreCheckpointTree: vi.fn(async () => ({ ok: true, actions: [] }))
      };
      const context = {
        userDataPath,
        storageProvider: storage,
        devopsProvider,
        checkpointTreeApi,
        queueMonitor: { snapshot: () => ({}) },
        jobWorkflowProvider: {
          listJobs: vi.fn(async () => ({
            summary: { total: 2 },
            items: [{ id: "job-1", status: "failed", error: "boom" }, { id: "job-2", status: "done" }]
          }))
        },
        clientRuntimeAllocator: {
          listProfiles: vi.fn(async () => ({ items: [] })),
          saveProfiles: vi.fn(async (input) => ({ saved: input })),
          resolve: vi.fn(async () => ({ runtime: "node" })),
          getStatus: vi.fn(async () => ({ ok: true }))
        },
        clientRuntimeBootstrap: {
          buildPlan: vi.fn(() => ({ steps: [] })),
          buildPull: vi.fn(() => ({ commands: [] }))
        },
        moduleManagement: {
          getMountsSnapshot: vi.fn(async () => ({ mounts: [] })),
          setMounts: vi.fn(async () => ({ ok: true })),
          reloadMounts: vi.fn(async () => ({ ok: true }))
        },
        protocolEventBus: protocolEventBus(),
        discoveryState: {
          serverId: "server-1",
          mode: "active",
          activeServiceUrl: "http://127.0.0.1:3000",
          offlineAfterSeconds: 30,
          configVersion: "cfg-1"
        },
        loadEmailRules: vi.fn(async () => ({ rules: [] })),
        loadSettings: vi.fn(async () => ({ retrieval: { topK: 10 } })),
        getExpertVocabularySummary: vi.fn(async () => ({ terms: 1 })),
        getKnowledgeGuidanceSummary: vi.fn(async () => ({ ok: true })),
        enhanceAffairTaxonomy: vi.fn(async () => ({ ok: true })),
        consoleDomainServices: {
          buildToolManagementClientConnectionRows: vi.fn(async () => [{ clientId: "tool-client" }])
        },
        setDiscoveryState: vi.fn()
      };

      const calls = [
        ["storage.summary", {}, 200],
        ["storage.doctor", {}, 200],
        ["storage.reconcile", {}, 200],
        ["storage.backups.list", {}, 200],
        ["storage.backups.create", {}, 200],
        ["storage.backups.restore_preview", {}, 200],
        ["storage.backups.restore", {}, 200],
        ["storage.source_vocabulary.rebuild", {}, 200],
        ["knowledge.corpus.significant_terms", {}, 200],
        ["knowledge.affair_taxonomy", { documents: [] }, 200],
        ["search.query", { q: "alpha", entityTypes: "person,org", formalOnly: "true" }, 200],
        ["client_runtime.profiles.get", {}, 200],
        ["client_runtime.profiles.set", { profiles: [] }, 200],
        ["client_runtime.resolve", { taskType: "coding" }, 200],
        ["client_runtime.bootstrap.plan", {}, 200],
        ["client_runtime.bootstrap.pull", {}, 200],
        ["client_runtime.status", {}, 200],
        ["system.monitor_alerts.get", {}, 200],
        ["system.monitor_alerts.set", { enabled: true }, 200],
        ["system.monitor_alerts.ack", { alertId: "a-1" }, 200],
        ["system.background_supervisor.recover", {}, 200],
        ["system.background_processes", {}, 200],
        ["system.checkpoint_trees.list", {}, 200],
        ["system.checkpoint_trees.get", { treeId: "tree-1" }, 200],
        ["workspace.checkpoint.diff", { treeId: "tree-1" }, 200],
        ["workspace.checkpoint.scope.query", { treeId: "tree-1" }, 200],
        ["workspace.checkpoint.restore.preview", { treeId: "tree-1" }, 200],
        ["workspace.checkpoint.restore", { treeId: "tree-1" }, 200],
        ["jobs.failed_review", { limit: 5 }, 200],
        ["system.health", {}, 200],
        ["system.bootstrap", {}, 200],
        ["runtime.mounts", {}, 200],
        ["runtime.set_mounts", { mounts: [] }, 200],
        ["runtime.reload_mounts", {}, 200],
        ["discovery.check_in", { hostname: "host-a", clientLabel: "client-a" }, 200],
        ["discovery.clients", {}, 200],
        ["discovery.clients.migration", { clientId: "client-1" }, 200],
        ["discovery.get_config", {}, 200],
        ["discovery.set_config", { mode: "forward", refreshIntervalSeconds: 5 }, 200]
      ];

      for (const [operationId, input, status] of calls) {
        await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
      }
      expect(context.setDiscoveryState).toHaveBeenCalled();
    });
  });

  it("covers auth, audit, authorization, and tool grant facades", async () => {
    const permissions = securityPermissions();
    const context = {
      securityPermissions: permissions,
      operationAuditStore: auditStore(),
      protocolEventBus: protocolEventBus(),
      authSession: { user: { userId: "u-1", username: "alice", roleId: "admin" } },
      request: { headers: { host: "localhost", origin: "http://localhost", "user-agent": "vitest" }, socket: {} },
      appendConsoleOperationLog: vi.fn()
    };
    const provider = {
      createAuthorizationGrant: vi.fn(async () => ({ grant: { grantId: "grant-1" }, token: "tok" })),
      revokeAuthorizationGrant: vi.fn(async () => ({ grantId: "grant-1" })),
      createMcpAuthorizationRequest: vi.fn(() => ({ requestId: "req-1" })),
      listMcpAuthorizationRequests: vi.fn(() => [{ requestId: "req-1" }]),
      resolveMcpAuthorizationRequest: vi.fn(async () => ({ success: true, grantId: "grant-1" })),
      authorizeRequest: vi.fn(async () => ({ ok: true, grant: { grantId: "grant-1" } }))
    };
    context.toolSkillManagementProvider = provider;

    const calls = [
      ["auth.session", {}, 200],
      ["auth.login", { username: "Alice", password: "secret" }, 200],
      ["auth.logout", {}, 200],
      ["auth.users", {}, 200],
      ["auth.users.update", { userId: "u-1", roleId: "admin" }, 200],
      ["auth.roles.get", { roleId: "admin" }, 200],
      ["auth.oidc.get", {}, 200],
      ["auth.oidc.set", { enabled: true, issuer: "https://issuer.example" }, 200],
      ["auth.audit", { limit: 5 }, 200],
      ["auth.audit.export", { limit: 5 }, 200],
      ["auth.audit.retention.get", {}, 200],
      ["auth.audit.retention.set", { retentionDays: 14 }, 200],
      ["auth.audit.prune", { retentionDays: 14 }, 200],
      ["observability.trace.get", { traceId: "trace-1" }, 200],
      ["auth.sessions", {}, 200],
      ["auth.sessions.rotate", {}, 200],
      ["auth.sessions.revoke", { sessionId: "s-1" }, 200],
      ["authorization.subject.resolve", { subject: { subjectId: "u-1" } }, 200],
      ["authorization.policy.evaluate", { operationId: "op.read" }, 200],
      ["authorization.governance.summary", {}, 200],
      ["authorization.roles.list", {}, 200],
      ["authorization.roles.upsert", { roleId: "operator" }, 200],
      ["authorization.teams.list", {}, 200],
      ["authorization.teams.upsert", { teamId: "team-1" }, 200],
      ["authorization.users.policies.list", {}, 200],
      ["authorization.users.policy.upsert", { userId: "u-1" }, 200],
      ["authorization.agent_groups.list", {}, 200],
      ["authorization.agent_groups.upsert", { groupId: "g-1" }, 200],
      ["authorization.agents.bindings.list", {}, 200],
      ["authorization.agents.binding.upsert", { agentId: "agent-1" }, 200],
      ["authorization.approvals.list", {}, 200],
      ["authorization.approvals.upsert", { approvalId: "ap-1" }, 200],
      ["authorization.approvals.revoke", { approvalId: "ap-1" }, 200],
      ["authorization.receipts.list", {}, 200],
      ["authorization.loan_records.list", {}, 200],
      ["authorization.denied_requests.list", { operationId: "op.write" }, 200],
      ["workspace.asset.policy.set", { workspaceId: "ws-1" }, 200],
      ["workspace.asset.permission.check", { workspaceId: "ws-1" }, 200],
      ["authorization.grants.create", { scopes: ["x"] }, 201],
      ["authorization.grants.revoke", { grantId: "grant-1" }, 200],
      ["tool_management.mcp.request_authorization", {}, 200],
      ["tool_management.mcp.list_requests", {}, 200],
      ["tool_management.mcp.resolve_request", { requestId: "req-1" }, 200],
      ["workspace.audit.query", { limit: 1 }, 200],
      ["workspace.operation.revert.scope", { limit: 1 }, 200]
    ];

    for (const [operationId, input, status] of calls) {
      await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
    }
    expect(context.appendConsoleOperationLog).toHaveBeenCalled();
    expect(context.protocolEventBus.publish).toHaveBeenCalled();
  });

  it("covers sync, strategy, maintenance, rule, skill, and evaluation runtimes", async () => {
    const context = {
      userDataPath: "/tmp/pact-console-domain-runtimes",
      protocolEventBus: protocolEventBus(),
      response: { once: vi.fn(), destroyed: false },
      request: { aborted: false },
      toolSkillManagementProvider: {
        authorizeRequest: vi.fn(async () => ({ ok: true, grant: { grantId: "grant-1" } }))
      },
      strategyManagementProvider: {
        describe: vi.fn(() => ({ ok: true })),
        evaluateWorkflowPolicy: vi.fn(() => ({ allow: true })),
        evaluateAgentPolicy: vi.fn(() => ({ allow: true })),
        evaluateToolPolicy: vi.fn(() => ({ allow: true })),
        createModelDecisionRuntimePort: vi.fn(() => ({
          describe: vi.fn(() => ({ roles: [] })),
          decide: vi.fn(async () => ({ decision: "default" }))
        }))
      },
      maintenanceAgent: {
        getConfig: vi.fn(async () => ({ enabled: true })),
        setConfig: vi.fn(async (input) => input),
        chat: vi.fn(async () => ({ reply: "ok" })),
        listRuns: vi.fn(async () => ({ items: [] })),
        startRun: vi.fn(async () => ({ runId: "run-1" })),
        getRun: vi.fn(async () => ({ runId: "run-1" })),
        approveRun: vi.fn(async () => ({ runId: "run-1", status: "approved" })),
        cancelRun: vi.fn(async () => ({ runId: "run-1", status: "cancelled" }))
      },
      goldenRuleRuntime: {
        listRulePackages: vi.fn(async () => ({ items: [{ packageId: "pkg-1", activeVersion: "v1" }] })),
        getRulePackage: vi.fn(async () => ({ packageId: "pkg-1" })),
        saveRulePackage: vi.fn(async () => ({ packageId: "pkg-1" })),
        publishRulePackage: vi.fn(async () => ({ packageId: "pkg-1", status: "published" })),
        rollbackRulePackage: vi.fn(async () => ({ packageId: "pkg-1", status: "rolled-back" })),
        listGoldCases: vi.fn(async () => ({ items: [] })),
        saveGoldCase: vi.fn(async () => ({ caseId: "case-1" })),
        exportTrainingSet: vi.fn(async () => ({ items: [] })),
        saveGoldCaseFromSkillResolution: vi.fn(async () => ({ caseId: "case-2" }))
      },
      knowledgeRuleAuthoringRuntime: {
        chat: vi.fn(async () => ({ runId: "rule-run-1" })),
        getRun: vi.fn(async () => ({ runId: "rule-run-1" }))
      },
      knowledgeSkillRuntime: {
        protocolVersion: "pact.skill.v1",
        listSkills: vi.fn(() => ({ items: [{ skillId: "skill-1" }] })),
        getSkill: vi.fn(() => ({ skillId: "skill-1" })),
        generateSkill: vi.fn(async () => ({ skillId: "skill-2" })),
        proposeSkill: vi.fn(async () => ({ skillId: "skill-3" })),
        resolveSkill: vi.fn(() => ({ action: "accept", skill: { skillId: "skill-1" } })),
        loadFramework: vi.fn(async () => ({ rubrics: [] })),
        saveFramework: vi.fn(async () => ({ ok: true })),
        runSkillEvaluation: vi.fn(async () => ({ runId: "eval-1" })),
        createSkillDeployment: vi.fn(async () => ({ ok: true, deploymentId: "dep-1" })),
        rollbackSkillDeployment: vi.fn(async () => ({ ok: true, deploymentId: "dep-1" }))
      },
      evidenceSufficiencyGate: { evaluate: vi.fn(() => ({ pass: true })) },
      knowledgeAgentSkill: {
        describe: vi.fn(() => ({ ok: true })),
        plan: vi.fn(() => ({ steps: [] })),
        run: vi.fn(async () => ({ ok: true }))
      },
      agentEvaluationRuntime: {
        runEvaluation: vi.fn(async () => ({ runId: "eval-run-1" })),
        listRuns: vi.fn(async () => ({ items: [] })),
        getRun: vi.fn(async () => ({ runId: "eval-run-1" }))
      },
      knowledgeEvolutionRuntime: {
        describe: vi.fn(() => ({ ok: true })),
        runEvolution: vi.fn(async () => ({ runId: "evo-1" })),
        listRuns: vi.fn(async () => ({ items: [] })),
        getRun: vi.fn(async () => ({ runId: "evo-1" })),
        auditHierarchy: vi.fn(async () => ({ ok: true })),
        listDeployments: vi.fn(() => ({ items: [] })),
        promote: vi.fn(async () => ({ ok: true })),
        rollback: vi.fn(async () => ({ ok: true }))
      },
      summarizationRuntime: {
        startRun: vi.fn(async () => ({ run: { runId: "sum-1", status: "running" } })),
        getRun: vi.fn(() => ({ runId: "sum-1" })),
        approveRun: vi.fn(async () => ({ runId: "sum-1", status: "approved" }))
      },
      agentExplorationRuntime: {
        run: vi.fn(async () => ({ ok: true, runId: "explore-1" })),
        getRun: vi.fn(() => ({ runId: "explore-1" }))
      }
    };

    const calls = [
      ["agent_sync.config.get", {}, 200],
      ["agent_sync.config.set", { topics: [] }, 200],
      ["events.subscribe", { topics: "agent_sync.test", includeSnapshot: "true" }, 200],
      ["agent_sync.subscribe", { topics: "agent_sync.test" }, 200],
      ["agent_sync.publish", { topic: "agent_sync.test" }, 404],
      ["strategy.describe", {}, 200],
      ["strategy.workflow_policy.evaluate", {}, 200],
      ["strategy.agent_policy.evaluate", {}, 200],
      ["strategy.tool_policy.preview", {}, 200],
      ["maintenance_agent.config.get", {}, 200],
      ["maintenance_agent.config.set", { enabled: true }, 200],
      ["maintenance_agent.chat", { message: "hi" }, 200],
      ["maintenance_agent.runs.create", {}, 200],
      ["maintenance_agent.runs.list", {}, 200],
      ["maintenance_agent.runs.get", { runId: "run-1" }, 200],
      ["maintenance_agent.runs.approve", { runId: "run-1" }, 200],
      ["maintenance_agent.runs.cancel", { runId: "run-1" }, 200],
      ["knowledge.golden_rules.list", { includeRules: "true" }, 200],
      ["knowledge.golden_rules.save", { packageId: "pkg-1" }, 200],
      ["knowledge.golden_rules.publish", { packageId: "pkg-1" }, 200],
      ["knowledge.golden_rules.rollback", { packageId: "pkg-1" }, 200],
      ["knowledge.rule_authoring.chat", { prompt: "rule" }, 200],
      ["knowledge.rule_authoring.runs.get", { runId: "rule-run-1" }, 200],
      ["knowledge.gold_cases.list", {}, 200],
      ["knowledge.gold_cases.save", { caseId: "case-1" }, 200],
      ["knowledge.training_sets.export", {}, 200],
      ["knowledge.skills.list", {}, 200],
      ["knowledge.skills.get", { skillId: "skill-1" }, 200],
      ["knowledge.skills.generate", {}, 201],
      ["knowledge.skills.propose", {}, 201],
      ["knowledge.skills.resolve", { skillId: "skill-1", action: "accept" }, 200],
      ["knowledge.skills.framework", {}, 200],
      ["knowledge.skills.framework_save", {}, 200],
      ["knowledge.skills.evaluation.runs.create", {}, 201],
      ["knowledge.skills.deployments.create", {}, 201],
      ["knowledge.skills.deployments.rollback", { deploymentId: "dep-1" }, 200],
      ["knowledge.evidence_gate.evaluate", {}, 200],
      ["knowledge.agent_skill.describe", {}, 200],
      ["knowledge.agent_skill.plan", {}, 200],
      ["knowledge.agent_skill.run", {}, 200],
      ["knowledge.evaluation.runs.create", {}, 201],
      ["knowledge.evaluation.runs.list", {}, 200],
      ["knowledge.evaluation.runs.get", { runId: "eval-run-1" }, 200],
      ["knowledge.model_roles", {}, 200],
      ["knowledge.model_decision", {}, 200],
      ["knowledge.evolution.describe", {}, 200],
      ["knowledge.evolution.runs.create", {}, 201],
      ["knowledge.evolution.runs.list", {}, 200],
      ["knowledge.evolution.runs.get", { runId: "evo-1" }, 200],
      ["knowledge.hierarchy.audit", {}, 200],
      ["knowledge.evolution.deployments.list", {}, 200],
      ["knowledge.evolution.deployments.promote", { deploymentId: "dep-1" }, 200],
      ["knowledge.evolution.deployments.rollback", { deploymentId: "dep-1" }, 200],
      ["knowledge.summarization.runs.create", {}, 201],
      ["knowledge.summarization.runs.get", { runId: "sum-1" }, 200],
      ["knowledge.summarization.runs.approve", { runId: "sum-1" }, 200],
      ["knowledge.agent_explore.runs.create", {}, 201],
      ["knowledge.agent_explore.runs.get", { runId: "explore-1" }, 200],
      ["knowledge.distillation.workbench.runs.create", {}, 501]
    ];

    for (const [operationId, input, status] of calls) {
      await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
    }
  });

  it("covers agent workspace file, management, proposal, and context runtime operations", async () => {
    const workspace = agentWorkspace();
    const context = {
      agentWorkspace: workspace,
      authSession: { user: { userId: "u-1", username: "alice" } },
      contextRuntime: {
        listProfiles: vi.fn(async () => ({ items: [] })),
        saveProfiles: vi.fn(async (input) => ({ saved: input })),
        preview: vi.fn(async (input) => ({ input })),
        previewCompaction: vi.fn(async () => ({ tokens: 10 })),
        runCompaction: vi.fn(async () => ({ runId: "compact-1" })),
        listCompactionRecords: vi.fn(async () => ({ items: [] })),
        listSessionMemory: vi.fn(async () => ({ items: [] })),
        clearSessionMemory: vi.fn(async () => ({ cleared: true })),
        listBuildRecords: vi.fn(async () => ({ items: [] })),
        runEvaluation: vi.fn(async () => ({ runId: "ctx-eval-1" }))
      }
    };

    const calls = [
      ["sharedspace.localDir.connect", { workspaceId: "ws-1", path: "/tmp" }, 201],
      ["sharedspace.localDir.list", { workspaceId: "ws-1" }, 200],
      ["sharedspace.item.list", { workspaceId: "ws-1", mountId: "mount-1" }, 200],
      ["agent_workspaces.folder.create", { workspaceId: "ws-1", path: "docs" }, 201],
      ["agent_workspaces.files.list", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.file.stat", { workspaceId: "ws-1", path: "a.txt" }, 200],
      ["agent_workspaces.file.download", { workspaceId: "ws-1", path: "a.txt" }, 200],
      ["agent_workspaces.file.upload", { workspaceId: "ws-1", path: "a.txt", text: "hello" }, 201],
      ["agent_workspaces.file.write", { workspaceId: "ws-1", path: "a.txt", text: "hello" }, 200],
      ["workspace.file.patch", { workspaceId: "ws-1", path: "a.txt", patch: [] }, 200],
      ["agent_workspaces.file.delete", { workspaceId: "ws-1", path: "a.txt", recursive: true }, 200],
      ["agent_workspaces.file.move", { workspaceId: "ws-1", path: "a.txt", targetPath: "b.txt" }, 200],
      ["sharedspace.sync.plan", { workspaceId: "ws-1" }, 200],
      ["sharedspace.sync.apply", { workspaceId: "ws-1" }, 200],
      ["workspace.info", {}, 200],
      ["workspace.info", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.list", {}, 200],
      ["agent_workspaces.get", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.create", { title: "Workspace", parentWorkspaceId: "root" }, 201],
      ["agent_workspaces.delete", { workspaceId: "ws-1" }, 200],
      ["agent_sessions.list", { workspaceId: "ws-1" }, 200],
      ["agent_sessions.get", { sessionId: "s-1" }, 200],
      ["agent_sessions.context.get", { sessionId: "s-1" }, 200],
      ["agent_sessions.events.append", { sessionId: "s-1", type: "note" }, 201],
      ["agent_sessions.fork", { sessionId: "s-1" }, 201],
      ["agent_sessions.compare", { sessionId: "s-1", rightSessionId: "s-2" }, 200],
      ["agent_sessions.merge_proposal", { sessionId: "s-1" }, 201],
      ["agent_sessions.archive", { sessionId: "s-1" }, 200],
      ["agent_workspaces.submissions.resolve", { workspaceId: "ws-1", submissionId: "sub-1" }, 200],
      ["agent_workspaces.issues.resolve", { workspaceId: "ws-1", issueId: "issue-1" }, 200],
      ["agent_workspaces.locks.list", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.locks.write", { workspaceId: "ws-1", action: "acquire" }, 200],
      ["agent_workspaces.locks.write", { workspaceId: "ws-1", action: "release" }, 200],
      ["workspace.proposal.create", { workspaceId: "ws-1", title: "Proposal" }, 201],
      ["workspace.proposal.apply", { workspaceId: "ws-1", proposalId: "sub-1" }, 200],
      ["agent_workspaces.context.get", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.context_bundle.export", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.context_bundle.restore", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.chain.get", { workspaceId: "ws-1" }, 200],
      ["agent_workspaces.parent.set", { workspaceId: "ws-1", parentWorkspaceId: "root" }, 200],
      ["agent_workspaces.profile.hotswap", { workspaceId: "ws-1", profileId: "fast" }, 200],
      ["agent_workspaces.sources.set", { workspaceId: "ws-1", sourceIds: ["source-1"] }, 200],
      ["agent_workspaces.share", { workspaceId: "ws-1", targetWorkspaceId: "ws-2" }, 200],
      ["agent_workspaces.unshare", { workspaceId: "ws-1", targetWorkspaceId: "ws-2" }, 200],
      ["context.profiles.get", {}, 200],
      ["context.profiles.set", { profiles: [] }, 200],
      ["context.preview", { workspaceId: "ws-1" }, 200],
      ["context.compaction.preview", {}, 200],
      ["context.compaction.run", {}, 200],
      ["context.compaction.records", {}, 200],
      ["context.session_memory.get", {}, 200],
      ["context.session_memory.clear", {}, 200],
      ["context.build_records", {}, 200],
      ["context.evaluation.runs.create", {}, 201]
    ];

    for (const [operationId, input, status] of calls) {
      await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
    }
    expect(workspace.createWorkspace).toHaveBeenCalled();
    expect(context.contextRuntime.preview).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-1" }));
  });

  it("covers workspace contribution and workspace skill registry operations", async () => {
    await withTempDir(async (userDataPath) => {
      const context = {
        userDataPath,
        contributionRegistryWorkspaceId: "ws-1",
        authSession: { user: { userId: "u-1", username: "alice", scopes: ["workspace:write"] } },
        subject: { type: "agent", subjectId: "agent-1", username: "agent-alpha" },
        securityPermissions: {
          appendLoanRecord: vi.fn()
        }
      };
      const submitContribution = async (suffix, input = {}) => {
        const response = await runOperation("workspace.contribution.submit", {
          input: {
            workspaceId: "ws-1",
            title: `Contribution ${suffix}`,
            contributionType: "knowledge",
            payloadRefs: [`payload-${suffix}`],
            ...input
          },
          context
        });
        expect(response.status).toBe(201);
        return response.payload.contribution.contributionId;
      };

      const primaryId = await submitContribution("primary");
      await expect(runOperation("knowledge.contribution.submit", {
        input: { workspaceId: "ws-1", title: "Knowledge contribution", knowledgeRefs: ["k-1"] },
        context
      })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("workspace.contribution.permission.request", {
        input: { contributionId: primaryId, actions: ["read"], purpose: "review" },
        context
      })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("workspace.contribution.permission.grant", {
        input: { contributionId: primaryId, actions: ["read"], targetWorkspaceId: "ws-2" },
        context
      })).resolves.toMatchObject({ status: 200 });
      expect(context.securityPermissions.appendLoanRecord).toHaveBeenCalled();

      for (const operationId of [
        "workspace.contribution.scan",
        "workspace.contribution.review",
        "workspace.contribution.preview",
        "workspace.contribution.publish",
        "workspace.contribution.revoke"
      ]) {
        await expect(runOperation(operationId, {
          input: { contributionId: primaryId, decision: "approved", actorId: "reviewer-1" },
          context
        })).resolves.toMatchObject({ status: 200 });
      }

      const adoptedId = await submitContribution("adopted");
      for (const operationId of [
        "workspace.contribution.scan",
        "workspace.contribution.review",
        "workspace.contribution.publish",
        "workspace.contribution.adopt"
      ]) {
        await expect(runOperation(operationId, {
          input: {
            contributionId: adoptedId,
            targetWorkspaceId: "ws-2",
            decision: "approved",
            actorId: "reviewer-1"
          },
          context
        })).resolves.toMatchObject({ status: 200 });
      }

      const rejectedId = await submitContribution("rejected");
      await expect(runOperation("workspace.contribution.reject", {
        input: { contributionId: rejectedId, reason: "not relevant" },
        context
      })).resolves.toMatchObject({ status: 200 });
      const changesId = await submitContribution("changes");
      await expect(runOperation("workspace.contribution.request_changes", {
        input: { contributionId: changesId, reason: "needs source refs" },
        context
      })).resolves.toMatchObject({ status: 200 });

      const skillUpload = await runOperation("workspace.skill.upload", {
        input: {
          workspaceId: "ws-1",
          skillId: "skill-alpha",
          skillManifestRef: "skills/alpha/SKILL.md",
          title: "Skill Alpha"
        },
        context
      });
      expect(skillUpload.status).toBe(201);
      const skillContributionId = skillUpload.payload.contribution.contributionId;

      const calls = [
        ["workspace.contribution.list", { workspaceId: "ws-1" }, 200],
        ["workspace.contribution.assets.list", { workspaceId: "ws-1" }, 200],
        ["workspace.contribution.leaderboard", { workspaceId: "ws-1" }, 200],
        ["workspace.contribution.stats", {}, 200],
        ["workspace.contribution.report", { timeRange: "all" }, 200],
        ["workspace.skill.list", { workspaceId: "ws-1" }, 200],
        ["workspace.skill.download", { skillId: skillContributionId }, 200],
        ["workspace.skill.download", { skillId: "missing-skill" }, 404],
        ["workspace.skill.usage.report", { contributionId: skillContributionId, action: "skill.used" }, 200]
      ];
      for (const [operationId, input, status] of calls) {
        await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
      }
    });
  });

  it("covers preprocessing rule, document parsing, knowledge source, and provider error operations", async () => {
    await withTempDir(async (userDataPath) => {
      const bus = protocolEventBus();
      const preprocessingContext = {
        userDataPath,
        protocolEventBus: bus,
        loadEmailRules: vi.fn(async () => ({ rules: [{ id: "r-1" }] })),
        saveEmailRules: vi.fn(async (root, rules) => ({ saved: true, rules })),
        getEmailRulesPath: vi.fn((root) => path.join(root, "email-rules.json")),
        getExpertVocabularySummary: vi.fn(async () => ({ termCount: 1 })),
        loadExpertVocabulary: vi.fn(async () => ({ terms: ["alpha"] })),
        saveExpertVocabulary: vi.fn(async (root, vocabulary) => ({ saved: true, vocabulary })),
        getExpertVocabularyPath: vi.fn((root) => path.join(root, "expert-vocabulary.json")),
        listExpertVocabularyVersions: vi.fn(async () => ({ items: [{ version: "v1" }] })),
        getKnowledgeGuidanceSummary: vi.fn(async () => ({ ok: true, topics: 1 })),
        loadKnowledgeTaxonomy: vi.fn(async () => ({ nodes: [{ id: "topic" }] })),
        saveKnowledgeTaxonomy: vi.fn(async (root, taxonomy) => ({ saved: true, taxonomy })),
        getKnowledgeTaxonomyPath: vi.fn((root) => path.join(root, "knowledge-taxonomy.json")),
        listKnowledgeTaxonomyVersions: vi.fn(async () => ({ items: [{ version: "v1" }] }))
      };
      const preprocessingCalls = [
        ["email_rules.get", {}, 200],
        ["email_rules.set", { rules: [{ id: "r-2" }] }, 200],
        ["expert_vocabulary.summary", {}, 200],
        ["expert_vocabulary.get", {}, 200],
        ["expert_vocabulary.set", { vocabulary: { terms: ["beta"] } }, 200],
        ["expert_vocabulary.versions", {}, 200],
        ["knowledge.guidance.summary", {}, 200],
        ["knowledge_taxonomy.get", {}, 200],
        ["knowledge_taxonomy.set", { taxonomy: { nodes: [{ id: "next" }] } }, 200],
        ["knowledge_taxonomy.versions", {}, 200]
      ];
      for (const [operationId, input, status] of preprocessingCalls) {
        await expect(runOperation(operationId, { input, context: preprocessingContext })).resolves.toMatchObject({ status });
      }
      await expect(runOperation("expert_vocabulary.summary", {
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 503 });
      expect(bus.publish).toHaveBeenCalled();

      const parseDocuments = vi.fn(async (payload) => ({ parsed: true, payload }));
      const deleteUploadSession = vi.fn(async () => {});
      const parsingContext = {
        userDataPath,
        runtime: { mounts: {} },
        loadSettings: vi.fn(async () => ({ retrieval: { topK: 5 } })),
        createDocumentParsingRuntime: vi.fn(async () => ({ parseDocuments })),
        resolveUploadSessionFiles: vi.fn(async () => [{ fileName: "source.md", path: "/tmp/source.md" }]),
        toPublicDocumentParsingResult: vi.fn(async (value) => ({ public: true, parsed: value.parsed })),
        deleteUploadSession
      };
      await expect(runOperation("knowledge.document_parse", {
        input: {
          uploadSessionId: "upload-1",
          dryRun: true,
          cleanupUploadSession: true,
          documentParsing: { expectedOutput: "sections" }
        },
        context: parsingContext
      })).resolves.toMatchObject({ status: 200, payload: { public: true } });
      expect(parseDocuments).toHaveBeenCalledWith(expect.objectContaining({
        expectedOutput: "sections",
        dryRun: true,
        uploadedFiles: expect.any(Array)
      }));
      expect(deleteUploadSession).toHaveBeenCalledWith(userDataPath, "upload-1");
      await expect(runOperation("knowledge.document_parse", {
        context: { userDataPath, createDocumentParsingRuntime: vi.fn(async () => null) }
      })).resolves.toMatchObject({ status: 503 });

      const knowledgeSourceService = {
        listSources: vi.fn(async () => [{ sourceId: "source-1" }]),
        createSource: vi.fn(async (input) => ({ sourceId: "source-2", ...input })),
        updateSource: vi.fn(async (sourceId, input) => sourceId === "missing" ? null : { sourceId, ...input }),
        deleteSource: vi.fn(async (sourceId) => sourceId === "missing" ? null : { sourceId, deleted: true }),
        refreshSource: vi.fn(async (sourceId) => ({ sourceId, refreshed: true })),
        refreshAll: vi.fn(async () => ({ refreshed: 2 }))
      };
      const sourceContext = {
        runtime: { mounts: {} },
        jobWorkflowProvider: {},
        consoleDomainServices: {
          buildKnowledgeConsoleSummary: vi.fn(async () => ({ summary: true }))
        },
        knowledgeSourceService
      };
      const sourceCalls = [
        ["knowledge.console", {}, 200],
        ["knowledge.sources.list", {}, 200],
        ["knowledge.sources.create", { label: "Source 2" }, 200],
        ["knowledge.sources.update", { sourceId: "source-1", label: "Updated" }, 200],
        ["knowledge.sources.update", { sourceId: "missing" }, 404],
        ["knowledge.sources.delete", { sourceId: "source-1" }, 200],
        ["knowledge.sources.delete", { sourceId: "missing" }, 404],
        ["knowledge.sources.refresh", { sourceId: "source-1" }, 200],
        ["knowledge.sources.refresh_all", {}, 200]
      ];
      for (const [operationId, input, status] of sourceCalls) {
        await expect(runOperation(operationId, { input, context: sourceContext })).resolves.toMatchObject({ status });
      }
      await expect(runOperation("knowledge.console", { context: {} })).resolves.toMatchObject({ status: 503 });
      await expect(runOperation("knowledge.sources.list", { context: {} })).resolves.toMatchObject({ status: 503 });

      const failingStorage = {
        createBackup: vi.fn(async () => {
          throw new Error("create failed");
        }),
        restoreBackupPreview: vi.fn(async () => {
          throw new Error("preview failed");
        }),
        restoreBackup: vi.fn(async () => {
          throw new Error("restore failed");
        })
      };
      await expect(runOperation("storage.backups.create", {
        context: { storageProvider: failingStorage }
      })).resolves.toMatchObject({ status: 400 });
      await expect(runOperation("storage.backups.restore_preview", {
        context: { storageProvider: failingStorage }
      })).resolves.toMatchObject({ status: 400 });
      await expect(runOperation("storage.backups.restore", {
        context: { storageProvider: failingStorage }
      })).resolves.toMatchObject({ status: 400 });

      const providerFailureCalls = [
        ["client_runtime.profiles.get", {}, {}, 503],
        ["client_runtime.profiles.set", {}, {}, 503],
        ["client_runtime.resolve", {}, {}, 503],
        ["client_runtime.bootstrap.plan", {}, {}, 503],
        ["client_runtime.bootstrap.pull", {}, {}, 503],
        ["client_runtime.status", {}, {}, 503],
        ["system.monitor_alerts.get", {}, { devopsProvider: {} }, 503],
        ["system.monitor_alerts.set", {}, { devopsProvider: {} }, 503],
        ["system.monitor_alerts.ack", {}, { devopsProvider: {} }, 503],
        ["system.background_supervisor.recover", {}, { devopsProvider: {} }, 503],
        ["settings.get", {}, {}, 503],
        ["agent_gateway.config.get", {}, { agentRuntimeProvider: {} }, 503]
      ];
      for (const [operationId, input, context, status] of providerFailureCalls) {
        await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
      }
    });
  });

  it("covers module ecosystem and lightweight production report operations", async () => {
    await withTempDir(async (userDataPath) => {
      const moduleManagement = {
        listModuleTemplates: vi.fn(() => [{ templateId: "documentParser" }]),
        planModuleScaffold: vi.fn(async () => ({ ok: true, steps: [] })),
        scaffoldModule: vi.fn(async () => ({ ok: true, files: [] })),
        validateCapabilityPackageScaffoldManifest: vi.fn(() => ({ ok: false, errors: ["missing id"] })),
        runModuleContractTest: vi.fn(async () => ({ ok: true, checks: [] }))
      };
      const moduleCalls = [
        ["module_ecosystem.templates", {}, 200],
        ["module_ecosystem.plan", { moduleType: "documentParser" }, 200],
        ["module_ecosystem.scaffold", { moduleId: "parser-alpha" }, 200],
        ["module_ecosystem.contract_test", { manifest: {} }, 422],
        ["module_ecosystem.contract_test", { moduleId: "parser-alpha" }, 200]
      ];
      for (const [operationId, input, status] of moduleCalls) {
        await expect(runOperation(operationId, {
          input,
          context: { userDataPath, moduleManagement }
        })).resolves.toMatchObject({ status });
      }
      await expect(runOperation("module_ecosystem.templates", {
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 503 });
      await expect(runOperation("module_ecosystem.plan", {
        input: {},
        context: {
          userDataPath,
          moduleManagement: {
            planModuleScaffold: vi.fn(async () => {
              throw Object.assign(new Error("bad plan"), { details: ["invalid"] });
            })
          }
        }
      })).resolves.toMatchObject({ status: 400 });

      await expect(runOperation("executive_report.preview", {
        input: { title: "Coverage Gate", sections: [] },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("executive_report.list", {
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("sample_business_pack.list", {
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("sample_business_pack.get", {
        input: { packId: "missing-pack" },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 404 });

      await expect(runOperation("runtime.dependencies.list", {
        input: { cacheRoot: path.join(userDataPath, "runtime-cache") },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("runtime.dependencies.configure", {
        input: {
          entries: [
            { key: "sources.python.url", value: "https://example.invalid/python.tgz" }
          ]
        },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("runtime.dependencies.download", {
        input: { targetId: "not-real", dryRun: true },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 400 });
    });
  });
});
