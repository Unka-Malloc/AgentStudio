import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const backendPort = {
    connect: vi.fn(),
    listSpaces: vi.fn(),
    requestExport: vi.fn(),
    requestPermission: vi.fn(),
    search: vi.fn(),
    getEvidence: vi.fn()
  };
  const cloudGateway = {
    execute: vi.fn()
  };
  const distillationClient = {
    baseUrl: "https://distill.example.invalid",
    health: vi.fn(),
    capabilities: vi.fn(),
    runtimeHealth: vi.fn(),
    listRuns: vi.fn(),
    createRun: vi.fn(),
    getRun: vi.fn(),
    cancelRun: vi.fn(),
    queryEvidence: vi.fn(),
    queryProjectEvidence: vi.fn(),
    exportArtifact: vi.fn()
  };
  return {
    backendPort,
    cloudGateway,
    distillationClient,
    searchSourceFiles: vi.fn(),
    getSourceFileEvidence: vi.fn()
  };
});

vi.mock("../../../server/platform/specialized/console/cloud-drive-upstream-gateway.mjs", () => ({
  createCloudDriveUpstreamGateway: vi.fn(() => mocks.cloudGateway),
  isCloudDriveUpstreamGatewayOperation: vi.fn((operationId) => String(operationId || "").startsWith("external.cloudDrive."))
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs", () => ({
  createKnowledgeBackendPort: vi.fn(() => mocks.backendPort),
  isKnowledgeBackendEvidenceId: vi.fn((evidenceId) => String(evidenceId || "").startsWith("kb:"))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs", () => ({
  searchSourceFiles: mocks.searchSourceFiles,
  getSourceFileEvidence: mocks.getSourceFileEvidence,
  isSourceEvidenceId: vi.fn((evidenceId) => String(evidenceId || "").startsWith("src:"))
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs", () => ({
  createExternalKnowledgeDistillationClient: vi.fn(() => mocks.distillationClient),
  resolveExternalKnowledgeDistillationConfig: vi.fn(() => ({ baseUrl: "https://distill.example.invalid" }))
}));

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.backendPort.connect.mockResolvedValue({ ok: true, connected: true });
  mocks.backendPort.listSpaces.mockResolvedValue({ spaces: [{ spaceId: "space-1" }] });
  mocks.backendPort.requestExport.mockResolvedValue({
    httpStatus: 202,
    exportId: "export-1",
    accessDecision: { decisionId: "decision-1" }
  });
  mocks.backendPort.requestPermission.mockResolvedValue({ permissionId: "permission-1" });
  mocks.backendPort.search.mockResolvedValue({ items: [{ id: "backend-hit" }] });
  mocks.backendPort.getEvidence.mockResolvedValue({ httpStatus: 206, evidenceId: "kb:evidence-1" });
  mocks.cloudGateway.execute.mockResolvedValue({ status: 201, payload: { ok: true, driveId: "drive-1" } });
  mocks.searchSourceFiles.mockResolvedValue({ items: [{ sourceId: "source-1" }], count: 1 });
  mocks.getSourceFileEvidence.mockResolvedValue({ evidenceId: "src:evidence-1", text: "source text" });
  mocks.distillationClient.health.mockResolvedValue({ ok: true });
  mocks.distillationClient.capabilities.mockResolvedValue({ capabilities: ["runs"] });
  mocks.distillationClient.runtimeHealth.mockResolvedValue({ ok: true, runtime: "ready" });
  mocks.distillationClient.listRuns.mockResolvedValue({ runs: [] });
  mocks.distillationClient.createRun.mockResolvedValue({ runId: "run-1" });
  mocks.distillationClient.getRun.mockResolvedValue({ runId: "run-1", status: "running" });
  mocks.distillationClient.cancelRun.mockResolvedValue({ runId: "run-1", status: "canceled" });
  mocks.distillationClient.queryEvidence.mockResolvedValue({ evidence: [] });
  mocks.distillationClient.queryProjectEvidence.mockResolvedValue({ evidence: [] });
  mocks.distillationClient.exportArtifact.mockResolvedValue({
    contentType: "application/json",
    fileName: "artifact.json",
    buffer: Buffer.from("{}"),
    pactExternalServiceCall: { durationMs: 3, transferBytes: 2, bytesPerSecond: 1 }
  });
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-edge-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

describe("console-domain executor edge branch coverage", () => {
  it("covers knowledge agent support, evaluation, evolution, and summarization edge branches", async () => {
    const events = {
      publish: vi.fn(() => ({ id: "event-1" }))
    };
    const agentSkill = {
      describe: vi.fn(() => ({ ok: true, skills: [] })),
      plan: vi.fn((input) => ({ ok: true, input })),
      run: vi.fn(async (input) => ({ ok: true, output: input.prompt || "" }))
    };
    const modelDecisionRuntime = {
      describe: vi.fn(() => ({ roles: ["judge"] })),
      decide: vi.fn(async (input) => ({ ok: true, selected: input.role || "judge" }))
    };
    const evaluationRuntime = {
      runEvaluation: vi.fn(async () => ({ runId: "eval-1" })),
      listRuns: vi.fn(async ({ limit }) => ({ limit, runs: [] })),
      getRun: vi.fn((runId) => (runId === "missing" ? null : { runId }))
    };
    const evolutionRuntime = {
      describe: vi.fn(() => ({ ok: true })),
      runEvolution: vi.fn(async () => ({ runId: "evo-1" })),
      listRuns: vi.fn(({ limit }) => ({ limit, runs: [] })),
      getRun: vi.fn((runId) => (runId === "missing" ? null : { runId })),
      auditHierarchy: vi.fn(async () => ({ ok: true })),
      listDeployments: vi.fn(({ status, limit }) => ({ status, limit, items: [] })),
      promote: vi.fn(async (input) => ({ promoted: input.deploymentId })),
      rollback: vi.fn(async (input) => ({ rolledBack: input.deploymentId }))
    };
    const summarizationRuntime = {
      startRun: vi.fn(async () => ({ run: { status: "failed" }, error: "bad summary" })),
      getRun: vi.fn(() => null),
      approveRun: vi.fn(async () => null)
    };
    const context = {
      evidenceSufficiencyGate: { evaluate: vi.fn((input) => ({ ok: true, score: input.score || 0 })) },
      knowledgeAgentSkill: agentSkill,
      modelDecisionRuntime,
      agentEvaluationRuntime: evaluationRuntime,
      knowledgeEvolutionRuntime: evolutionRuntime,
      summarizationRuntime,
      protocolEventBus: events
    };

    await expect(runOperation("knowledge.evidence_gate.evaluate", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("knowledge.evidence_gate.evaluate", { input: { score: 9 }, context }))
      .resolves.toMatchObject({ status: 200, payload: { ok: true, score: 9 } });
    await expect(runOperation("knowledge.agent_skill.describe", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("knowledge.agent_skill.describe", { context }))
      .resolves.toMatchObject({ status: 200, payload: { ok: true } });
    await expect(runOperation("knowledge.agent_skill.plan", { input: { prompt: "plan" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { input: { prompt: "plan" } } });
    await expect(runOperation("knowledge.agent_skill.run", { input: { prompt: "run" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { output: "run" } });

    await expect(runOperation("knowledge.model_roles", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("knowledge.model_roles", { context }))
      .resolves.toMatchObject({ status: 200, payload: { roles: ["judge"] } });
    await expect(runOperation("knowledge.model_decision", { input: { role: "reviewer" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { selected: "reviewer" } });
    await expect(runOperation("knowledge.evaluation.runs.create", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("knowledge.evaluation.runs.create", { context }))
      .resolves.toMatchObject({ status: 201, payload: { runId: "eval-1" } });
    await expect(runOperation("knowledge.evaluation.runs.list", { input: { limit: "7" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { limit: 7 } });
    await expect(runOperation("knowledge.evaluation.runs.get", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });

    await expect(runOperation("knowledge.evolution.describe", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("knowledge.evolution.describe", { context }))
      .resolves.toMatchObject({ status: 200, payload: { ok: true } });
    await expect(runOperation("knowledge.evolution.runs.create", { context }))
      .resolves.toMatchObject({ status: 201, payload: { runId: "evo-1" } });
    await expect(runOperation("knowledge.evolution.runs.list", { input: { limit: "5" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { limit: 5 } });
    await expect(runOperation("knowledge.evolution.runs.get", { input: { runId: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("knowledge.hierarchy.audit", { context }))
      .resolves.toMatchObject({ status: 200, payload: { ok: true } });
    await expect(runOperation("knowledge.evolution.deployments.list", { input: { status: "active", limit: "2" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { status: "active", limit: 2 } });
    await expect(runOperation("knowledge.evolution.deployments.promote", { input: { id: "dep-1" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { promoted: "dep-1" } });
    await expect(runOperation("knowledge.evolution.deployments.rollback", { input: { "deployment-id": "dep-2" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { rolledBack: "dep-2" } });

    await expect(runOperation("knowledge.summarization.runs.create", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("knowledge.summarization.runs.create", { context }))
      .resolves.toMatchObject({ status: 500 });
    await expect(runOperation("knowledge.summarization.runs.get", { input: { id: "sum-1", private: "true" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("knowledge.summarization.runs.approve", { input: { id: "sum-1" }, context }))
      .resolves.toMatchObject({ status: 404 });

    expect(agentSkill.run).toHaveBeenCalledWith({ prompt: "run" });
    expect(evaluationRuntime.listRuns).toHaveBeenCalledWith({ limit: 7 });
    expect(evolutionRuntime.promote).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: "dep-1" }));
    expect(summarizationRuntime.getRun).toHaveBeenCalledWith("sum-1", { includePrivate: true });
  });

  it("covers external distillation, backend, cloud drive, and raw source search branches", async () => {
    await withTempDir(async (userDataPath) => {
      const access = {
        appendReceipt: vi.fn(),
        appendLoanRecord: vi.fn(),
        appendDeniedRequest: vi.fn()
      };
      const events = {
        publish: vi.fn(() => ({ id: "event-1" }))
      };
      const context = {
        userDataPath,
        protocolEventBus: events,
        securityPermissions: access,
        authSession: { user: { userId: "u-1", username: "alice" } }
      };

      for (const operationId of [
        "external.knowledge.distillation.service.health",
        "external.knowledge.distillation.service.capabilities",
        "external.knowledge.distillation.service.runtime_health",
        "external.knowledge.distillation.runs.list",
        "external.knowledge.distillation.runs.create",
        "external.knowledge.distillation.runs.get",
        "external.knowledge.distillation.runs.cancel",
        "external.knowledge.distillation.evidence.query",
        "external.knowledge.distillation.projects.evidence.query",
        "external.knowledge.distillation.artifacts.export"
      ]) {
        await expect(runOperation(operationId, { input: { runId: "run-1" }, context }))
          .resolves.toMatchObject({ status: expect.any(Number) });
      }
      expect(events.publish).toHaveBeenCalledWith(
        "external.knowledge.distillation",
        { runId: "run-1" },
        expect.objectContaining({ type: "external.knowledge.distillation.created" })
      );

      mocks.distillationClient.health.mockRejectedValueOnce(Object.assign(new Error("service down"), {
        statusCode: 503,
        payload: { code: "DOWN", details: ["offline"] },
        externalServiceCall: { durationMs: 5 }
      }));
      await expect(runOperation("external.knowledge.distillation.service.health", { context }))
        .resolves.toMatchObject({
          status: 503,
          payload: {
            code: "DOWN",
            service: "external.knowledge.distillation"
          }
        });

      await expect(runOperation("knowledge.backend.connect", { input: { provider: "dify" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { connected: true } });
      await expect(runOperation("knowledge.space.list", { input: { provider: "dify" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { spaces: [{ spaceId: "space-1" }] } });
      await expect(runOperation("knowledge.export.request", {
        input: { provider: "dify", workspaceId: "ws-1", subjectId: "subject-1" },
        context
      })).resolves.toMatchObject({ status: 202, payload: { exportId: "export-1" } });
      await expect(runOperation("knowledge.permission.request", { input: { provider: "dify" }, context }))
        .resolves.toMatchObject({ status: 201, payload: { permissionId: "permission-1" } });

      mocks.backendPort.connect.mockRejectedValueOnce(Object.assign(new Error("unsupported"), {
        code: "UNSUPPORTED_PROVIDER"
      }));
      await expect(runOperation("knowledge.backend.connect", { input: { provider: "unknown" }, context }))
        .resolves.toMatchObject({ status: 404 });

      await expect(runOperation("external.cloudDrive.connect", { input: { workspaceId: "ws-1" }, context }))
        .resolves.toMatchObject({ status: 201, payload: { driveId: "drive-1" } });
      mocks.cloudGateway.execute.mockResolvedValueOnce(null);
      await expect(runOperation("external.cloudDrive.status", { context }))
        .resolves.toMatchObject({ status: 501 });
      mocks.cloudGateway.execute.mockRejectedValueOnce(Object.assign(new Error("drive missing"), {
        code: "DRIVE_CONNECTION_NOT_FOUND"
      }));
      await expect(runOperation("external.cloudDrive.item.list", { context }))
        .resolves.toMatchObject({ status: 404 });

      await expect(runOperation("knowledge.search", {
        input: { rawSourceSearch: true, query: "source", limit: 3, all: true },
        context
      })).resolves.toMatchObject({ status: 200, payload: { count: 1 } });
      expect(mocks.searchSourceFiles).toHaveBeenCalledWith(expect.objectContaining({
        userDataPath,
        query: "source",
        limit: 3,
        returnAll: true
      }));
    });
  });

  it("covers knowledge retrieval workspace, backend evidence, assets, and fallback branches", async () => {
    await withTempDir(async (userDataPath) => {
      const knowledgeCore = {
        search: vi.fn(async () => ({ items: [{ evidenceId: "evidence-1", title: "hit" }] })),
        renderMarkdown: vi.fn(async () => ({ markdown: "# hit" })),
        prepareHierarchyReasoning: vi.fn(async () => ({ decisionId: "hierarchy-1" })),
        getDocumentStructure: vi.fn(({ documentId }) => (documentId === "missing" ? null : { documentId })),
        getItem: vi.fn(async ({ itemId }) => (itemId === "core-item" ? { itemId } : null)),
        getEvidence: vi.fn(async ({ evidenceId }) => (evidenceId === "core:evidence" ? { evidenceId } : null)),
        getAssetContent: vi.fn(async ({ assetId }) => (assetId === "asset-1" ? {
          contentType: "text/plain",
          fileName: "asset.txt",
          buffer: Buffer.from("asset")
        } : null))
      };
      const agentWorkspace = {
        getWorkspaceContext: vi.fn((workspaceId) => workspaceId === "missing"
          ? null
          : {
              workspaceId,
              contextProfileId: "ctx-1",
              modelAlias: "model-a",
              toolGrantId: "grant-1",
              knowledgeSourceIds: ["source-1"]
            }),
        getSessionContext: vi.fn((sessionId) => sessionId === "missing-session"
          ? null
          : {
              sessionId,
              workspaceId: "ws-session",
              contextProfileId: "ctx-session",
              modelAlias: "model-session",
              knowledgeSourceIds: ["session-source"]
            })
      };
      const context = {
        userDataPath,
        runtime: { mounts: { knowledgeBase: knowledgeCore } },
        agentWorkspace,
        clientRuntimeAllocator: {
          apply: vi.fn(async (input) => ({
            input: { ...input, query: `${input.query}-allocated` },
            allocation: { runtimeId: "node" }
          }))
        },
        authSession: { user: { userId: "u-1", username: "alice", roleId: "tool-grant" } },
        modelDecisionRuntime: { decide: vi.fn(async () => ({ ok: true })) },
        securityPermissions: {
          appendReceipt: vi.fn(),
          appendLoanRecord: vi.fn(),
          appendDeniedRequest: vi.fn()
        },
        metadataStore: {
          searchKnowledge: vi.fn(() => ({ items: [{ id: "fallback-hit" }], count: 1 })),
          getKnowledgeItem: vi.fn(({ itemId }) => (itemId === "meta-item" ? { itemId } : null))
        }
      };

      await expect(runOperation("knowledge.search", {
        input: {
          query: "hello",
          workspaceId: "ws-1",
          format: "markdown",
          hierarchyReasoning: "true",
          machineReadable: "true",
          filters: { modality: "image", topic: "ops" }
        },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          clientRuntimeAllocation: { runtimeId: "node" },
          workspaceContext: { workspaceId: "ws-1" },
          rendered: { markdown: "# hit" }
        }
      });
      expect(knowledgeCore.search).toHaveBeenCalledWith(expect.objectContaining({
        query: "hello-allocated",
        responseProfile: "agent",
        hierarchyReasoning: true,
        scopeSourceIds: ["source-1"]
      }));
      expect(knowledgeCore.prepareHierarchyReasoning).toHaveBeenCalled();

      await expect(runOperation("knowledge.search", {
        input: { query: "no-workspace", workspaceId: "missing" },
        context
      })).resolves.toMatchObject({ status: 404 });
      await expect(runOperation("knowledge.search", {
        input: { query: "no-session", agentSessionId: "missing-session" },
        context
      })).resolves.toMatchObject({ status: 404 });

      await expect(runOperation("knowledge.search.get", {
        input: { provider: "ragflow", query: "backend", workspaceId: "ws-2" },
        context
      })).resolves.toMatchObject({ status: 200, payload: { items: [{ id: "backend-hit" }] } });
      await expect(runOperation("knowledge.document_structure", { input: { documentId: "doc-1" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { documentId: "doc-1" } });
      await expect(runOperation("knowledge.document_structure", { input: { documentId: "missing" }, context }))
        .resolves.toMatchObject({ status: 404 });
      await expect(runOperation("knowledge.item", { input: { itemId: "core-item" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { itemId: "core-item" } });
      await expect(runOperation("knowledge.item", { input: { itemId: "meta-item" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { itemId: "meta-item" } });
      await expect(runOperation("knowledge.item", { input: { itemId: "missing" }, context }))
        .resolves.toMatchObject({ status: 404 });

      await expect(runOperation("knowledge.evidence.get", { input: { evidenceId: "kb:evidence-1" }, context }))
        .resolves.toMatchObject({ status: 206, payload: { evidenceId: "kb:evidence-1" } });
      mocks.backendPort.getEvidence.mockResolvedValueOnce(null);
      await expect(runOperation("knowledge.evidence.get", { input: { evidenceId: "kb:missing" }, context }))
        .resolves.toMatchObject({ status: 404 });
      await expect(runOperation("knowledge.evidence", { input: { evidenceId: "src:evidence-1" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { text: "source text" } });
      await expect(runOperation("knowledge.evidence", { input: { evidenceId: "core:evidence" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { evidenceId: "core:evidence" } });
      await expect(runOperation("knowledge.evidence", { input: { evidenceId: "missing" }, context }))
        .resolves.toMatchObject({ status: 404 });

      await expect(runOperation("knowledge.asset", { input: { assetId: "asset-1" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { __binaryResponse: true, fileName: "asset.txt" } });
      await expect(runOperation("knowledge.asset", { input: { assetId: "missing" }, context }))
        .resolves.toMatchObject({ status: 404 });
      await expect(runOperation("knowledge.render_markdown", { input: { evidenceId: "evidence-1" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { markdown: "# hit" } });

      const fallbackContext = {
        metadataStore: context.metadataStore,
        runtime: { mounts: { knowledgeBase: { enabled: false } } }
      };
      await expect(runOperation("knowledge.search", {
        input: { query: "fallback", limit: "bad" },
        context: fallbackContext
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          items: [{ id: "fallback-hit" }],
          modalityPolicy: { mode: "multimodal" }
        }
      });
      await expect(runOperation("knowledge.document_structure", { context: fallbackContext }))
        .resolves.toMatchObject({ status: 503 });
      await expect(runOperation("knowledge.render_markdown", { context: fallbackContext }))
        .resolves.toMatchObject({ status: 404 });
    });
  });
});

describe("console-domain workspace and context executor edge coverage", () => {
  function workspaceHarness() {
    const ok = (extra = {}) => ({ ok: true, workspaceId: "ws-1", ...extra });
    return {
      protocolVersion: "pact.agent-workspace.v1",
      listWorkspaces: vi.fn(() => ({ items: [{ workspaceId: "ws-1" }] })),
      getWorkspace: vi.fn(({ workspaceId }) => (workspaceId === "missing" ? null : { workspaceId, title: "Workspace" })),
      createWorkspace: vi.fn((input) => ({ ok: true, workspace: { workspaceId: "created", title: input.title } })),
      setWorkspaceParent: vi.fn((_workspaceId, parentWorkspaceId) => parentWorkspaceId === "bad-parent"
        ? { ok: false, error: "bad parent" }
        : { ok: true, workspace: { workspaceId: "created", parentWorkspaceId } }),
      deleteWorkspace: vi.fn((workspaceId) => workspaceId === "missing"
        ? { ok: false, error: "missing" }
        : ok({ deleted: true })),
      listSessions: vi.fn(() => ({ items: [{ sessionId: "session-1" }] })),
      getSession: vi.fn(({ sessionId }) => (sessionId === "missing" ? null : { sessionId })),
      getSessionContext: vi.fn((sessionId) => (sessionId === "missing" ? null : { sessionId, workspaceId: "ws-1" })),
      appendSessionEvent: vi.fn(({ sessionId }) => (sessionId === "missing" ? null : { eventId: "event-1" })),
      forkSession: vi.fn(({ sessionId }) => sessionId === "missing"
        ? { ok: false, error: "会话不存在" }
        : ok({ sessionId: "fork-1" })),
      compareSessions: vi.fn(({ leftSessionId }) => leftSessionId === "missing"
        ? { ok: false, error: "会话不存在" }
        : ok({ diff: [] })),
      createSessionMergeProposal: vi.fn(({ targetSessionId }) => targetSessionId === "missing"
        ? { ok: false, error: "会话不存在" }
        : ok({ proposalId: "merge-1" })),
      archiveSession: vi.fn(({ sessionId }) => sessionId === "missing"
        ? { ok: false, error: "会话不存在" }
        : ok({ archived: true })),
      resolveSubmission: vi.fn(({ submissionId }) => {
        if (submissionId === "missing") return null;
        return {
          submission: {
            submissionId,
            runId: "run-1",
            status: submissionId === "reject-me" ? "rejected" : "accepted",
            payload: { title: "Decision", summary: "Summary" }
          }
        };
      }),
      updateIssue: vi.fn(({ issueId }) => (issueId === "missing" ? null : { issueId, status: "closed" })),
      listLocks: vi.fn(() => [{ lockId: "lock-1" }]),
      acquireLock: vi.fn(({ lockId }) => lockId === "held"
        ? { ok: false, error: "lock_held" }
        : ok({ lockId: lockId || "lock-1" })),
      releaseLock: vi.fn(() => ok({ released: true })),
      submit: vi.fn((input) => ({ submission: { submissionId: "submission-1", runId: input.runId, payload: input.payload } })),
      createDecision: vi.fn((input) => ({ decision: { decisionId: "decision-1", title: input.title } })),
      getWorkspaceContext: vi.fn((workspaceId) => (workspaceId === "missing" ? null : {
        workspaceId,
        contextProfileId: "ctx-1",
        modelAlias: "model-a",
        knowledgeSourceIds: ["source-1"]
      })),
      exportWorkspaceContextBundle: vi.fn((workspaceId) => (workspaceId === "missing" ? null : { workspaceId, bundleId: "bundle-1" })),
      restoreWorkspaceContextBundle: vi.fn((_workspaceId, input) => input.fail ? { ok: false, error: "bad bundle" } : ok({ restored: true })),
      resolveWorkspaceChain: vi.fn((workspaceId) => workspaceId === "empty-chain" ? [] : [{ workspaceId }]),
      resolveWorkspaceSourceIds: vi.fn(() => ["source-1"]),
      resolveWorkspaceProfile: vi.fn(() => ({ profileId: "default" })),
      hotSwapProfile: vi.fn((_workspaceId, input) => input.fail ? { ok: false, error: "bad profile" } : ok({ profileId: "fast" })),
      setOwnedSourceIds: vi.fn((_workspaceId, sourceIds) => ok({ sourceIds })),
      shareWorkspace: vi.fn((_workspaceId, target) => target === "bad" ? { ok: false, error: "bad target" } : ok({ shared: true })),
      unshareWorkspace: vi.fn(() => ok({ shared: false }))
    };
  }

  function contextRuntimeHarness() {
    return {
      listProfiles: vi.fn(async () => ({ profiles: [{ profileId: "default" }] })),
      saveProfiles: vi.fn(async (input) => ({ saved: input.profiles || [] })),
      preview: vi.fn(async (input) => ({ preview: true, input })),
      previewCompaction: vi.fn(async () => ({ preview: true })),
      runCompaction: vi.fn(async () => ({ runId: "compact-1" })),
      listCompactionRecords: vi.fn(async ({ limit }) => ({ limit, items: [] })),
      listSessionMemory: vi.fn(async ({ sessionId }) => ({ sessionId, items: [] })),
      clearSessionMemory: vi.fn(async () => ({ cleared: true })),
      listBuildRecords: vi.fn(async ({ limit }) => ({ limit, items: [] })),
      runEvaluation: vi.fn(async () => ({ runId: "eval-1" }))
    };
  }

  it("covers workspace management validation, missing, and accepted proposal branches", async () => {
    const agentWorkspace = workspaceHarness();
    const context = {
      agentWorkspace,
      authSession: { user: { userId: "u-1", username: "alice" } }
    };

    await expect(runOperation("workspace.info", { context }))
      .resolves.toMatchObject({ status: 200, payload: { items: [{ workspaceId: "ws-1" }] } });
    await expect(runOperation("workspace.info", { input: { workspaceId: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_workspaces.create", { input: [], context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.create", { input: {}, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.create", {
      input: { title: "Created", parentWorkspaceId: "bad-parent" },
      context
    })).resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.create", {
      input: { title: "Created", parentWorkspaceId: "root" },
      context
    })).resolves.toMatchObject({ status: 201, payload: { workspace: { parentWorkspaceId: "root" } } });
    await expect(runOperation("agent_workspaces.delete", { input: { workspaceId: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });

    await expect(runOperation("agent_sessions.get", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_sessions.context.get", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_sessions.events.append", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_sessions.fork", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_sessions.compare", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_sessions.merge_proposal", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_sessions.archive", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });

    await expect(runOperation("agent_workspaces.submissions.resolve", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_workspaces.issues.resolve", { input: { id: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_workspaces.locks.list", { input: { includeExpired: "true" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { protocolVersion: "pact.agent-workspace.v1" } });
    await expect(runOperation("agent_workspaces.locks.write", { input: { lockId: "held" }, context }))
      .resolves.toMatchObject({ status: 409 });
    await expect(runOperation("agent_workspaces.locks.write", { input: { action: "release" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { released: true } });

    await expect(runOperation("workspace.proposal.create", { input: [], context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("workspace.proposal.create", { input: { title: "" }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("workspace.proposal.create", {
      input: { workspaceId: "ws-1", title: "Approve change", proposal: { summary: "Summary" } },
      context
    })).resolves.toMatchObject({ status: 201, payload: { created: true } });
    await expect(runOperation("workspace.proposal.apply", { input: { workspaceId: "ws-1" }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("workspace.proposal.apply", {
      input: { workspaceId: "ws-1", proposalId: "missing" },
      context
    })).resolves.toMatchObject({ status: 404 });
    await expect(runOperation("workspace.proposal.apply", {
      input: { workspaceId: "ws-1", proposalId: "reject-me" },
      context
    })).resolves.toMatchObject({ status: 200, payload: { applied: false, decision: null } });
    await expect(runOperation("workspace.proposal.apply", {
      input: { workspaceId: "ws-1", proposalId: "accept-me" },
      context
    })).resolves.toMatchObject({ status: 200, payload: { applied: true, decision: { decisionId: "decision-1" } } });
  });

  it("covers workspace context, sharing, chain, and context runtime branches", async () => {
    const agentWorkspace = workspaceHarness();
    agentWorkspace.resolveWorkspaceChain.mockImplementationOnce(() => {
      throw new Error("chain failed");
    });
    const contextRuntime = contextRuntimeHarness();
    const context = {
      agentWorkspace,
      contextRuntime,
      authSession: { user: { userId: "u-1", username: "alice" } }
    };

    await expect(runOperation("agent_workspaces.context.get", { input: { workspaceId: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_workspaces.context_bundle.export", { input: { workspaceId: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_workspaces.context_bundle.restore", { input: { workspaceId: "ws-1", fail: true }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.chain.get", { input: { workspaceId: "ws-1" }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.chain.get", { input: { workspaceId: "empty-chain" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("agent_workspaces.chain.get", { input: { workspaceId: "ws-1" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { resolvedSourceIds: ["source-1"] } });
    await expect(runOperation("agent_workspaces.parent.set", { input: { workspaceId: "ws-1", parentWorkspaceId: "bad-parent" }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.profile.hotswap", { input: { workspaceId: "ws-1", fail: true }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.sources.set", { input: { workspaceId: "ws-1", sourceIds: ["a"] }, context }))
      .resolves.toMatchObject({ status: 200, payload: { sourceIds: ["a"] } });
    await expect(runOperation("agent_workspaces.share", { input: { workspaceId: "ws-1" }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.share", { input: { workspaceId: "ws-1", targetWorkspaceId: "bad" }, context }))
      .resolves.toMatchObject({ status: 400 });
    await expect(runOperation("agent_workspaces.unshare", { input: { workspaceId: "ws-1", targetWorkspaceId: "target" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { shared: false } });

    await expect(runOperation("context.profiles.get", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("context.profiles.get", { context }))
      .resolves.toMatchObject({ status: 200, payload: { profiles: [{ profileId: "default" }] } });
    await expect(runOperation("context.profiles.set", { input: { profiles: [] }, context }))
      .resolves.toMatchObject({ status: 200, payload: { saved: [] } });
    await expect(runOperation("context.preview", { input: { workspaceId: "missing" }, context }))
      .resolves.toMatchObject({ status: 404 });
    await expect(runOperation("context.preview", { input: { workspaceId: "ws-1" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { preview: true } });
    await expect(runOperation("context.compaction.preview", { context }))
      .resolves.toMatchObject({ status: 200, payload: { preview: true } });
    await expect(runOperation("context.compaction.run", { context }))
      .resolves.toMatchObject({ status: 200, payload: { runId: "compact-1" } });
    await expect(runOperation("context.compaction.records", { input: { limit: "2" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { limit: 2 } });
    await expect(runOperation("context.session_memory.get", { input: { sessionId: "s-1" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { sessionId: "s-1" } });
    await expect(runOperation("context.session_memory.clear", { context }))
      .resolves.toMatchObject({ status: 200, payload: { cleared: true } });
    await expect(runOperation("context.build_records", { input: { limit: "3" }, context }))
      .resolves.toMatchObject({ status: 200, payload: { limit: 3 } });
    await expect(runOperation("context.evaluation.runs.create", { context }))
      .resolves.toMatchObject({ status: 201, payload: { runId: "eval-1" } });
  });
});
