import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeCoverage,
  createSummarizationRuntime,
} from "../../../server/platform/specialized/knowledge/invocation/knowledge-summarization-runtime/index.mjs";

const callAgentGatewayMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());

vi.mock(
  "../../../server/platform/specialized/agent/agent-gateway/index.mjs",
  () => ({
    callAgentGateway: (...args) => callAgentGatewayMock(...args),
  })
);

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: (...args) => loadSettingsMock(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function createKnowledgeCore(searchItems = []) {
  return {
    enabled: true,
    search: vi.fn(async (input = {}) => ({
      protocolVersion: "v0.0.1:knowledge:core-1",
      query: input.query,
      items: searchItems,
      count: searchItems.length,
    })),
  };
}

function createContextRuntime() {
  const assembleCalls = [];
  return {
    assemble: vi.fn(async (input = {}) => {
      assembleCalls.push(input);
      return {
        protocolVersion: "v0.0.1:agent:context-1",
        profileId: input.contextProfileId || "default-context",
        roleId: input.roleId,
        budgetReport: {
          totalTokens: 1200,
        },
        citations: [],
        workspaceContext: input.workspaceContext || null,
      };
    }),
    assembleCalls,
  };
}

function createSummarizationWorkspace() {
  let workspaceSeq = 0;
  let runSeq = 0;
  let artifactSeq = 0;
  let issueSeq = 0;

  const workspaces = new Map();
  const runs = new Map();

  function nextWorkspaceId() {
    return `ws_${String(++workspaceSeq).padStart(4, "0")}`;
  }

  function refreshSummary(workspace) {
    workspace.summary = {
      runCount: workspace.runs.length,
      submissionCount: workspace.submissions.length,
      issueCount: workspace.issues.length,
      artifactCount: workspace.artifacts.length,
    };
  }

  function createWorkspaceRecord({
    workspaceId = nextWorkspaceId(),
    title = "",
    objective = "",
    metadata = {},
    context = null,
  } = {}) {
    const workspace = {
      workspaceId,
      title,
      objective,
      metadata,
      status: "active",
      context,
      runs: [],
      privateStates: [],
      submissions: [],
      issues: [],
      artifacts: [],
      summary: {
        runCount: 0,
        submissionCount: 0,
        issueCount: 0,
        artifactCount: 0,
      },
    };
    refreshSummary(workspace);
    return workspace;
  }

  return {
    createWorkspace: ({ includePrivate = false, ...payload } = {}) => {
      const workspace = createWorkspaceRecord(payload);
      workspaces.set(workspace.workspaceId, workspace);
      return { workspace };
    },
    getWorkspace: ({ workspaceId } = {}) => {
      const workspace = workspaces.get(workspaceId) || null;
      if (!workspace) {
        return null;
      }
      return {
        workspace,
        summary: workspace.summary,
      };
    },
    getWorkspaceContext: (workspaceId) => {
      return workspaces.get(workspaceId)?.context || null;
    },
    createRun: ({ workspaceId, runType, status, input, startedAt }) => {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) {
        throw new Error(`workspace_not_found:${workspaceId}`);
      }
      const run = {
        runId: `run_${String(++runSeq).padStart(4, "0")}`,
        workspaceId,
        runType,
        status,
        input,
        startedAt,
        updatedAt: startedAt,
        completedAt: "",
        steps: [],
        coverage: {},
        error: "",
        degraded: false,
        artifactIds: [],
      };
      workspace.runs.push(run);
      runs.set(run.runId, { run, workspace });
      refreshSummary(workspace);
      return { run };
    },
    getRun: (runId) => {
      return runs.get(runId)?.run || null;
    },
    updateRun: (runId, patch = {}) => {
      const entry = runs.get(runId);
      if (!entry) {
        return null;
      }
      Object.assign(entry.run, patch, { updatedAt: new Date().toISOString() });
      return { run: entry.run };
    },
    submit: ({ workspaceId, runId, agentId, type, payload, evidenceRefs = [], confidence } = {}) => {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) {
        return { submission: null };
      }
      const submission = {
        submissionId: `submission_${runId || "unknown"}`,
        runId,
        workspaceId,
        agentId,
        type,
        payload,
        evidenceRefs,
        confidence,
        status: "completed",
      };
      workspace.submissions.push(submission);
      refreshSummary(workspace);
      return { submission };
    },
    savePrivateState: ({ workspaceId, runId, agentId, summary, state } = {}) => {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) {
        return { ok: false };
      }
      workspace.privateStates.push({
        runId,
        workspaceId,
        agentId,
        summary,
        state,
      });
      return { ok: true };
    },
    createIssue: ({ workspaceId, runId, type, severity, title, payload, evidenceRefs, createdBy } = {}) => {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) {
        return { issue: null };
      }
      const issue = {
        issueId: `issue_${runId || "unknown"}_${String(++issueSeq).padStart(4, "0")}`,
        workspaceId,
        runId,
        type,
        severity,
        title,
        payload,
        evidenceRefs,
        createdBy,
      };
      workspace.issues.push(issue);
      refreshSummary(workspace);
      return { issue };
    },
    createArtifact: ({
      artifactId,
      workspaceId,
      runId,
      level,
      title,
      content,
      citations = [],
      status = "draft",
      createdBy,
      coverageReport,
      revision,
    } = {}) => {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) {
        return { artifact: null };
      }
      const artifact = {
        artifactId: artifactId || `artifact_${++artifactSeq}`,
        workspaceId,
        runId,
        level,
        title,
        content,
        citations,
        status,
        createdBy,
        coverageReport,
        revision,
        createdAt: new Date().toISOString(),
      };
      workspace.artifacts.push(artifact);
      refreshSummary(workspace);
      return { artifact };
    },
    listRunArtifacts: (runId) => {
      const entry = runs.get(runId);
      if (!entry) {
        return [];
      }
      return entry.workspace.artifacts.filter((artifact) => artifact.runId === runId);
    },
    updateArtifactsStatus: (runId, status) => {
      const entry = runs.get(runId);
      if (!entry) {
        return [];
      }
      for (const artifact of entry.workspace.artifacts) {
        if (artifact.runId === runId) {
          artifact.status = status;
        }
      }
      return entry.workspace.artifacts.filter((artifact) => artifact.runId === runId);
    },
    close: () => {},
  };
}

function buildEvidenceItems() {
  return [
    {
      evidenceId: "ev-summary-a",
      itemId: "doc-a-item-1",
      documentId: "doc-a",
      title: "供应商确认采购条款",
      snippet: "2026-06-01 供应商确认采购条款并通过审批。",
      score: 0.93,
      hierarchy: { documentId: "doc-a", sectionId: "sec-a" },
      source: {
        sourcePath: "scope/doc-a.md",
        batchId: "batch-a",
      },
    },
    {
      evidenceId: "ev-summary-b",
      itemId: "doc-a-item-2",
      documentId: "doc-a",
      title: "供应商未确认付款时间",
      snippet: "尚未确认对账后付款时间。",
      score: 0.92,
      hierarchy: { documentId: "doc-a", sectionId: "sec-a" },
      source: {
        sourcePath: "scope/doc-a.md",
        batchId: "batch-a",
      },
    },
    {
      evidenceId: "ev-summary-c",
      itemId: "doc-b-item-1",
      documentId: "doc-b",
      title: "预算金额确认",
      snippet: "预算金额 120000 元，财务审核完成。",
      score: 0.71,
      source: {
        sourcePath: "scope/doc-b.md",
        batchId: "batch-b",
      },
    },
  ];
}

describe("knowledge summarization runtime extra coverage", () => {
  it("exports computeCoverage and reports conflicts plus missing high-confidence evidence", () => {
    const coverage = computeCoverage(
      [
        {
          evidenceId: "ev_a",
          claim: "该项目通过审批",
          confidence: 0.9,
        },
        {
          evidenceId: "ev_b",
          claim: "该项目未通过审批",
          confidence: 0.84,
        },
        {
          evidenceId: "ev_c",
          claim: "该项目金额 15000 元",
          confidence: 0.62,
        },
      ],
      [
        "- 该项目已通过审批 [ev_a]",
        "- 非引用行（应触发 uncitedClaims）",
      ].join("\n")
    );

    expect(coverage).toMatchObject({
      totalEvidence: 3,
      coveredEvidence: 1,
      score: 0.3333,
      missingImportantEvidence: [{ evidenceId: "ev_b", confidence: 0.84 }],
      conflicts: [
        {
          claimA: "该项目通过审批",
          claimB: "该项目未通过审批",
          evidenceIds: ["ev_a", "ev_b"],
        },
      ],
    });
    expect(coverage.uncitedClaims).toHaveLength(1);
    expect(coverage.uncitedClaims[0]).toBe("- 非引用行（应触发 uncitedClaims）");
  });

  it("starts a run, groups evidence into topics, returns state/artifacts, and emits completion protocol event", async () => {
    loadSettingsMock.mockResolvedValue({ mockMode: true });
    callAgentGatewayMock
      .mockResolvedValueOnce({ answer: "模型辅助证据解读：条款与金额信息一致。" })
      .mockResolvedValueOnce({ answer: "模型辅助分析：建议关注付款时序风险。" });

    const protocolEventBus = {
      publish: vi.fn(async () => ({ ok: true })),
    };
    const runtimeWorkspace = createSummarizationWorkspace();
    const contextRuntime = createContextRuntime();
    const knowledgeCore = createKnowledgeCore(buildEvidenceItems());

    const runtime = createSummarizationRuntime({
      userDataPath: "/tmp/knowledge-summarization-runtime-extra",
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentWorkspace: runtimeWorkspace,
      contextRuntime,
      protocolEventBus,
    });

    const response = await runtime.startRun({
      query: "支付与预算审批",
      useModel: true,
      scopeSourceIds: ["scope-doc-a", "scope-doc-b"],
      includeState: true,
    });

    expect(response).toMatchObject({
      protocolVersion: "v0.0.1:knowledge:summarization-1",
      coordinatorProtocolVersion: "v0.0.1:agent:multi-agent-1",
      graphRuntime: "langgraph-js",
      run: {
        status: "completed",
        workspaceId: "",
        degraded: false,
      },
    });
    expect(response.run.coverage.totalEvidence).toBe(3);
    expect(response.state).toBeTruthy();
    expect(response.state.steps).toHaveLength(9);
    expect(response.state.topics).toHaveLength(2);
    expect(response.state.topics[0].topicId).toBe("doc-a");
    expect(response.state.topics[0].evidenceCount).toBe(2);
    expect(response.state.topics[1].topicId).toBe("doc-b");
    expect(response.state.topics[1].evidenceCount).toBe(1);
    expect(response.state.analystOutputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ analystId: "business-focus" }),
        expect.objectContaining({ analystId: "risk-gap" }),
        expect.objectContaining({ analystId: "timeline-money" }),
        expect.objectContaining({ analystId: "model-assisted" }),
      ])
    );
    expect(response.artifacts).toHaveLength(4);
    expect(response.artifacts.map((artifact) => artifact.level)).toEqual(
      expect.arrayContaining(["EvidenceUnitSummary", "TopicSummary", "ExecutiveSummary", "ReviewReport"])
    );
    expect(response.artifacts.every((artifact) => artifact.status === "draft")).toBe(true);
    expect(response.errors).toHaveLength(0);
    expect(contextRuntime.assemble).toHaveBeenCalledTimes(3);
    expect(response.state.analystOutputs.some((item) => item.analystId === "model-assisted")).toBe(true);

    expect(protocolEventBus.publish).toHaveBeenCalledTimes(1);
    expect(protocolEventBus.publish).toHaveBeenCalledWith(
      "knowledge.summarization",
      expect.objectContaining({
        runId: response.run.runId,
        artifactIds: expect.arrayContaining(response.artifacts.map((artifact) => artifact.artifactId)),
        coverage: expect.objectContaining({ totalEvidence: 3 }),
      }),
      { type: "knowledge.summarization.completed" }
    );

    const fetched = runtime.getRun(response.run.runId);
    expect(fetched).toMatchObject({
      protocolVersion: "v0.0.1:knowledge:summarization-1",
      run: { runId: response.run.runId, status: "completed" },
      coverage: expect.objectContaining({ totalEvidence: 3, coveredEvidence: 3 }),
    });
    expect(fetched.artifacts).toHaveLength(4);
    expect(fetched.workspace).toMatchObject({ workspaceId: response.workspace.workspaceId });
    expect(runtime.getRun("run-not-exists")).toBeNull();

    const approved = await runtime.approveRun({ runId: response.run.runId, action: "approve" });
    expect(approved.status).toBe("approved");
    expect(approved.run.status).toBe("approved");
    expect(approved.artifacts.every((artifact) => artifact.status === "approved")).toBe(true);
    expect(protocolEventBus.publish).toHaveBeenCalledWith(
      "knowledge.summarization",
      expect.objectContaining({
        runId: response.run.runId,
        status: "approved",
        artifactIds: expect.arrayContaining(approved.artifacts.map((artifact) => artifact.artifactId)),
      }),
      { type: "knowledge.summarization.approved" }
    );
  });

  it("degrades gracefully when model calls fail and keeps completion path", async () => {
    loadSettingsMock.mockResolvedValue({ mockMode: true });
    callAgentGatewayMock.mockRejectedValue(new Error("model gateway timeout"));

    const protocolEventBus = {
      publish: vi.fn(async () => ({ ok: true })),
    };
    const runtimeWorkspace = createSummarizationWorkspace();
    const contextRuntime = createContextRuntime();
    const knowledgeCore = createKnowledgeCore(buildEvidenceItems());

    const runtime = createSummarizationRuntime({
      userDataPath: "/tmp/knowledge-summarization-runtime-extra-fallback",
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentWorkspace: runtimeWorkspace,
      contextRuntime,
      protocolEventBus,
    });

    const response = await runtime.startRun({
      query: "支付与预算审批",
      useModel: true,
      includeState: true,
    });

    expect(response.run.status).toBe("completed");
    expect(response.run.degraded).toBe(true);
    expect(response.errors.length).toBeGreaterThanOrEqual(2);
    expect(response.errors[0]).toMatch(/model gateway timeout/);
    expect(response.state.analystOutputs).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ analystId: "model-assisted" })])
    );
    expect(response.artifacts).toHaveLength(4);
    expect(protocolEventBus.publish).toHaveBeenCalledTimes(1);
    expect(callAgentGatewayMock).toHaveBeenCalledTimes(2);
    const needsReview = await runtime.approveRun({ runId: response.run.runId, action: "reject" });
    expect(needsReview.status).toBe("needs_review");
    expect(protocolEventBus.publish).toHaveBeenCalledWith(
      "knowledge.summarization",
      expect.objectContaining({
        runId: response.run.runId,
        status: "needs_review",
      }),
      { type: "knowledge.summarization.needs_review" }
    );
  });
});
