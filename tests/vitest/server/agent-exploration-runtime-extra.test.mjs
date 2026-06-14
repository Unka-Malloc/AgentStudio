import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_EXPLORATION_PROTOCOL_VERSION,
  createAgentExplorationRuntime,
} from "../../../server/platform/specialized/capabilities/tools/agent-exploration-runtime/index.mjs";

const loadSettingsMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/platform-core/settings.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/platform-core/settings.mjs");
  return {
    ...actual,
    loadSettings: loadSettingsMock,
  };
});

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

function makeToolCall(name, args = {}, id = "call_1") {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function createGatewaySequence(responses = []) {
  const calls = [];
  const gateway = vi.fn(async (input = {}) => {
    const index = calls.length;
    calls.push(input);
    const response = responses[index];
    if (typeof response === "function") {
      return response(input, calls);
    }
    return {
      ok: true,
      upstream: {
        provider: "mock",
        status: 200,
        contentType: "application/json",
      },
      finish: true,
      answer: "",
      toolCalls: [],
      ...response,
    };
  });
  return { gateway, calls };
}

function createInMemoryAgentWorkspace() {
  let runCounter = 0;
  let submissionCounter = 0;
  let decisionCounter = 0;
  const workspaces = new Map();
  const runsById = new Map();

  function createWorkspaceRecord({ workspaceId = `ws_${String(workspaces.size + 1).padStart(4, "0")}`, context = null, title = "", objective = "", metadata = {} } = {}) {
    const workspace = {
      workspaceId,
      title,
      objective,
      metadata,
      status: "active",
      runs: [],
      privateStates: [],
      submissions: [],
      decisions: [],
      context: context || {},
    };
    workspaces.set(workspaceId, workspace);
    return workspace;
  }

  return {
    createWorkspace: (input = {}) => {
      const workspace = createWorkspaceRecord(input);
      return { workspace };
    },
    getWorkspace: ({ workspaceId }) => {
      return workspaces.get(workspaceId) || null;
    },
    getWorkspaceContext: (workspaceId) => {
      return workspaces.get(workspaceId)?.context || null;
    },
    createRun: ({ workspaceId, runType, status, input, startedAt }) => {
      const workspace = workspaces.get(workspaceId) || null;
      const run = {
        runId: `run_${String(++runCounter).padStart(4, "0")}`,
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
      };
      if (workspace) {
        workspace.runs.push(run);
      }
      runsById.set(run.runId, { run, workspace: workspace || null });
      return { run };
    },
    updateRun: (runId, patch = {}) => {
      const entry = runsById.get(runId);
      if (!entry) {
        return null;
      }
      Object.assign(entry.run, patch);
      entry.run.updatedAt = new Date().toISOString();
      return { run: entry.run };
    },
    submit: (payload = {}) => {
      const workspace = workspaces.get(payload.workspaceId) || null;
      const submission = {
        submissionId: `submission_${String(++submissionCounter).padStart(4, "0")}`,
        ...payload,
      };
      if (workspace) {
        workspace.submissions.push(submission);
      }
      return {
        submission: {
          ...submission,
          status: "pending",
        },
      };
    },
    createDecision: (payload = {}) => {
      const workspace = workspaces.get(payload.workspaceId) || null;
      const decision = {
        decisionId: `decision_${String(++decisionCounter).padStart(4, "0")}`,
        ...payload,
      };
      if (workspace) {
        workspace.decisions.push(decision);
      }
      return { decision };
    },
    savePrivateState: (payload = {}) => {
      const workspace = workspaces.get(payload.workspaceId) || null;
      if (!workspace) {
        return { ok: false, error: "workspace_not_found" };
      }
      workspace.privateStates.push(payload);
      return { ok: true, state: payload };
    },
    listWorkspaces: ({ limit = 200 } = {}) => ({
      workspaces: [...workspaces.values()].slice(0, limit).map((workspace) => ({
        workspaceId: workspace.workspaceId,
      })),
    }),
    close: () => {},
  };
}

function createContextRuntime(overrides = {}) {
  return {
    assemble: vi.fn(async () => ({
      profileId: "default-context",
      contextBuildRecordId: "ctx-default",
      budgetReport: { totalTokens: 12 },
      knowledgeSkillContext: null,
      criticalEvidenceIndex: [],
      toolStateSummary: {},
      memoryBlocks: [],
      expertGuidance: [],
      compressedHistory: "",
      recentTurns: [],
      tailChecklist: {},
      ...overrides,
    })),
  };
}

function createKnowledgeCore({ searchResult = [], evidence = {} } = {}) {
  return {
    enabled: true,
    search: vi.fn(async (input = {}) => ({
      query: input.query,
      retrievalMode: input.retrievalMode || "hybrid",
      count: searchResult.length,
      items: searchResult,
      explain: {
        candidateCount: searchResult.length,
        generatedCandidateCount: searchResult.length,
        dedupedCandidateCount: searchResult.length,
        hierarchyCandidateCount: 0,
      },
    })),
    getEvidence: vi.fn(async ({ evidenceId }) => {
      return evidence[evidenceId] || null;
    }),
    aggregate: vi.fn(async (input = {}) => ({
      ok: true,
      metric: input.metric,
      groupBy: input.groupBy,
      filters: {},
      scannedDocumentCount: 0,
      matchedDocumentCount: 0,
      groups: [],
      methodology: "",
    })),
  };
}

const commonEvidence = {
  ev_1: {
    evidenceId: "ev_1",
    title: "部署记录",
    snippet: "部署版本 v1.2.3，回滚窗口 30 分钟。",
    score: 0.93,
    payload: {
      document: {
        documentId: "doc_1",
        title: "Atlas 模块部署记录.md",
        sourcePath: "fixtures/deployment.md",
      },
      blocks: [
        {
          blockId: "block_1",
          title: "正文",
          text: "部署版本 v1.2.3，回滚窗口 30 分钟。",
        },
      ],
      assets: [{ assetId: "asset_1" }],
    },
    markdown: "# Atlas 模块部署记录",
  },
};

function mockSpawnSuccess({ stdout = "", stderr = "", exitCode = 0 } = {}) {
  return vi.fn(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    };
    child.kill = vi.fn();
    setTimeout(() => {
      if (stdout) {
        child.stdout.emit("data", Buffer.from(stdout));
      }
      if (stderr) {
        child.stderr.emit("data", Buffer.from(stderr));
      }
      child.emit("close", exitCode, null);
    }, 0);
    return child;
  });
}

function mockJsonResponse(body, status = 200, contentType = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        if (name === "content-type") {
          return contentType;
        }
        return null;
      },
    },
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}

let fetchSpy;

beforeEach(() => {
  loadSettingsMock.mockReset();
  loadSettingsMock.mockResolvedValue({});
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    throw new Error("spawn should be explicitly stubbed");
  });
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network should be stubbed"));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("agent exploration runtime exports and public contract", () => {
  it("exports protocol version + public descriptor surface", () => {
    const runtime = createAgentExplorationRuntime({
      agentGatewayCall: vi.fn(async () => ({ ok: true, answer: "" })),
      agentWorkspace: createInMemoryAgentWorkspace(),
      contextRuntime: createContextRuntime(),
    });

    const descriptor = runtime.describe();
    expect(runtime.protocolVersion).toBe(AGENT_EXPLORATION_PROTOCOL_VERSION);
    expect(descriptor.protocolVersion).toBe(AGENT_EXPLORATION_PROTOCOL_VERSION);

    const names = runtime.toolDefinitions().map((item) => item.function?.name).filter(Boolean).sort();
    expect(names).toEqual([
      "golden_rule_authoring",
      "http_request",
      "keyword_search",
      "knowledge_aggregate",
      "knowledge_skill_propose",
      "knowledge_skill_search",
      "local_command",
      "open_evidence",
    ].sort());
    expect(descriptor.toolPolicy.searchOrAggregateFirst).toBe(true);
    expect(descriptor.toolPolicy.keywordSearchFirst).toBe(false);
  });

  it("validates run dependencies and mandatory query input", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const contextRuntime = createContextRuntime();
    const missingQueryRuntime = createAgentExplorationRuntime({
      agentGatewayCall: vi.fn(async () => ({ ok: true })),
      agentWorkspace: workspace,
      contextRuntime,
    });
    await expect(missingQueryRuntime.run({})).rejects.toThrow("智能探索缺少 query。");

    const missingGateway = createAgentExplorationRuntime({
      agentWorkspace: workspace,
      contextRuntime,
    });
    await expect(missingGateway.run({ query: "q" })).rejects.toThrow("AgentExplorationRuntime requires agentGatewayCall.");

    const missingContextRuntime = createAgentExplorationRuntime({
      agentGatewayCall: vi.fn(async () => ({ ok: true })),
      agentWorkspace: workspace,
    });
    await expect(missingContextRuntime.run({ query: "q" })).rejects.toThrow("AgentExplorationRuntime requires ContextRuntime.");
  });
});

describe("agent exploration run state and tool orchestration", () => {
  it("runs keyword search + open evidence and persists deterministic run state", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const workspaceState = workspace.createWorkspace({
      workspaceId: "ws-state",
      title: "State Workspace",
      objective: "for deterministic case",
      context: {
        knowledgeSourceIds: ["ws-source-1"],
      },
    }).workspace;
    const searchInput = [];
    const knowledgeCore = createKnowledgeCore({
      searchResult: [{
        evidenceId: "ev_1",
        documentId: "doc_1",
        title: "Atlas 模块部署记录.md",
        snippet: "部署版本 v1.2.3，回滚窗口 30 分钟。",
        score: 0.93,
        hierarchy: {
          source: "mail",
        },
        modalities: ["text"],
        assets: [{ assetId: "asset_1" }],
        reasons: [],
      }],
      evidence: commonEvidence,
    });
    const originalSearch = knowledgeCore.search;
    knowledgeCore.search = vi.fn(async (input) => {
      searchInput.push(input);
      return originalSearch(input);
    });

    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("keyword_search", { query: "部署记录", limit: 2 }, "call_kw")],
      },
      {
        toolCalls: [makeToolCall("open_evidence", { evidenceId: "ev_1" }, "call_open")],
      },
      {
        answer: "已完成：发现 evidence::ev_1 的部署信息。",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "",
      runtime: {
        mounts: {
          knowledgeBase: knowledgeCore,
        },
      },
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime({
        profileId: "small-context",
        contextBuildRecordId: "cbr-1",
      }),
      agentGatewayCall: gateway.gateway,
    });

    const result = await runtime.run({
      workspaceId: workspaceState.workspaceId,
      query: "帮我找部署记录",
      maxIterations: 4,
      limit: 2,
      modelAlias: "deepseek",
      contextProfileId: "small-context",
    });

    expect(result.ok).toBe(true);
    expect(result.run.workspaceId || result.workspace.workspaceId).toBe("ws-state");
    expect(result.degraded).toBe(false);
    expect(result.run.status).toBe("completed");
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults[0]).toMatchObject({
      tool: "keyword_search",
      result: {
        ok: true,
        query: "部署记录",
      },
    });
    expect(result.toolResults[1]).toMatchObject({
      tool: "open_evidence",
      result: {
        ok: true,
        evidence: {
          evidenceId: "ev_1",
        },
      },
    });
    expect(result.evidenceRefs).toEqual(["ev_1"]);
    expect(result.run.coverage.evidenceRefCount).toBe(1);
    expect(result.run.coverage.nativeFunctionCalling).toBe(true);
    expect(result.contextPack.profileId).toBe("small-context");
    expect(result.run.input.scopeSourceIds).toEqual(["ws-source-1"]);
    expect(Array.isArray(searchInput[0]?.scopeSourceIds)).toBe(true);
    expect(searchInput[0].scopeSourceIds).toEqual(["ws-source-1"]);

    const loaded = runtime.getRun({
      workspaceId: "ws-state",
      runId: result.run.runId,
    });
    expect(loaded?.run?.runId).toBe(result.run.runId);
    expect(loaded.steps[0].events.some((item) => item.type === "tool_selected")).toBe(true);
    expect(loaded.steps[0].toolCalls).toHaveLength(1);
  });

  it("treats open_evidence as a protocol error when search/aggregate was not run", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      searchResult: [],
      evidence: commonEvidence,
    });

    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("open_evidence", { evidenceId: "ev_1" }, "call_open")],
      },
      {
        answer: "我先返回一个保底答案。",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "先开证据",
      modelAlias: "deepseek",
      workspaceId: "error-open-only",
      maxIterations: 2,
      limit: 2,
    });

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      tool: "open_evidence",
      result: {
        ok: false,
        error: "search_or_aggregate_required_first",
      },
    });
    expect(result.degraded).toBe(false);
    expect(result.run.status).toBe("completed");
    expect(knowledgeCore.search).not.toHaveBeenCalled();
  });

  it("tolerates json-text tool calls and marks degraded when parser path is used", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      searchResult: [{
        evidenceId: "ev_1",
        documentId: "doc_1",
        title: "Atlas 模块部署记录.md",
        snippet: "部署版本 v1.2.3。",
        score: 0.93,
        hierarchy: null,
        modalities: ["text"],
        assets: [],
        reasons: [],
      }],
      evidence: commonEvidence,
    });

    const gateway = createGatewaySequence([
      {
        answer:
          '<tool_call>{"name":"keyword_search","arguments":{"query":"部署记录","limit":1}}</tool_call>',
      },
      {
        answer: "最终找到了 evidence::ev_1。",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "文本工具调用",
      modelAlias: "qwen3",
      maxIterations: 1,
    });

    expect(result.degraded).toBe(true);
    expect(result.toolResults).toHaveLength(1);
    expect(result.steps[0].functionCallSource).toBe("json_text_tool_call");
    expect(result.steps.some((step) => step.toolResults[0]?.result?.ok)).toBe(true);
    expect(result.evidenceRefs).toEqual(["ev_1"]);
    expect(result.answer).toContain("evidence::ev_1");
  });

  it("falls back to final synthesis when final model result is still empty", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      searchResult: [{
        evidenceId: "ev_1",
        documentId: "doc_1",
        title: "Atlas 模块部署记录.md",
        snippet: "部署版本 v1.2.3。",
        score: 0.93,
        modalities: ["text"],
        assets: [],
        reasons: [],
      }],
      evidence: commonEvidence,
    });

    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("keyword_search", { query: "部署记录", limit: 1 }, "call_kw_fallback")],
      },
      {
        tool_choice: "none",
        answer: "",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime({
        contextBuildRecordId: "ctx-final",
        profileId: "small-context",
      }),
    });

    const result = await runtime.run({
      query: "触发最终综合",
      modelAlias: "deepseek",
      maxIterations: 1,
      limit: 1,
    });

    expect(result.run.coverage.finalSynthesis).toBe(true);
    expect(result.degraded).toBe(false);
    expect(result.answer).toMatch(/已完成本地关键词检索，模型未给出最终整合回答。候选证据：/);
    expect(result.run.status).toBe("completed");
    expect(result.toolResults).toHaveLength(1);
    expect(gateway.calls).toHaveLength(2);
  });
});

describe("external I/O mocks in tool execution", () => {
  it("executes local command via configured template and substitutes variables", async () => {
    spawnMock.mockImplementation(mockSpawnSuccess({ stdout: "v20.10.0\n" }));

    loadSettingsMock.mockResolvedValue({
      agentToolExecution: {
        local: {
          commands: [
            {
              commandId: "node-version",
              command: "node",
              args: ["{{flag}}"],
              allowExtraArgs: false,
              variables: [
                {
                  name: "flag",
                  required: true,
                },
              ],
            },
          ],
        },
      },
    });

    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      evidence: commonEvidence,
    });

    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("local_command", {
            commandId: "node-version",
            variables: {
              flag: "--version",
            },
          }),
        ],
      },
      {
        answer: "本地命令执行完成。",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-local-command",
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({ query: "本地命令", modelAlias: "deepseek", maxIterations: 1 });

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      tool: "local_command",
      result: {
        ok: true,
        command: "node",
        args: ["--version"],
        exitCode: 0,
      },
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe("node");
    expect(spawnMock.mock.calls[0][1]).toEqual(["--version"]);
  });

  it("returns deterministic local command validation errors when required variable is missing", async () => {
    loadSettingsMock.mockResolvedValue({
      agentToolExecution: {
        local: {
          commands: [
            {
              commandId: "node-version",
              command: "node",
              args: ["{{flag}}"],
              allowExtraArgs: false,
              variables: [
                {
                  name: "flag",
                  required: true,
                },
              ],
            },
          ],
        },
      },
    });

    const workspace = createInMemoryAgentWorkspace();
    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("local_command", { commandId: "node-version" }, "call_local_no_var")],
      },
      {
        answer: "兜底答案。",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-local-command-missing",
      runtime: { mounts: { knowledgeBase: createKnowledgeCore({ evidence: commonEvidence }) } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "缺少变量",
      modelAlias: "deepseek",
      maxIterations: 1,
    });

    expect(result.degraded).toBe(false);
    expect(result.toolResults[0]).toMatchObject({
      tool: "local_command",
      result: {
        ok: false,
        error: "local_command_variable_required",
      },
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("calls fetch only for allowed HTTP hosts and rejects other hosts", async () => {
    loadSettingsMock.mockResolvedValue({
      agentToolExecution: {
        http: {
          enabled: true,
          allowedHosts: ["allowed.local"],
          timeoutMs: 5000,
          maxResponseBytes: 64_000,
        },
      },
    });
    const workspace = createInMemoryAgentWorkspace();

    const firstGateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("http_request", {
            method: "GET",
            url: "https://allowed.local/ping",
            query: { q: "ok" },
          }),
        ],
      },
      {
        answer: "http 调用完成。",
      },
    ]);

    fetchSpy.mockImplementationOnce(async () =>
      mockJsonResponse({ ok: true, method: "GET", path: "/ping", q: "ok" })
    );

    const allowRuntime = createAgentExplorationRuntime({
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore({
            evidence: commonEvidence,
          }),
        },
      },
      userDataPath: "/tmp/agent-exploration-http",
      agentGatewayCall: firstGateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const allowResult = await allowRuntime.run({
      query: "测试 http",
      modelAlias: "deepseek",
      maxIterations: 1,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(allowResult.toolResults[0]).toMatchObject({
      tool: "http_request",
      result: {
        ok: true,
        status: 200,
      },
    });

    const deniedWorkspace = createInMemoryAgentWorkspace();
    const deniedGateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("http_request", {
            method: "GET",
            url: "https://denied.example/ping",
            query: { q: "ok" },
          }),
        ],
      },
      {
        answer: "拒绝后兜底。",
      },
    ]);
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() => Promise.reject(new Error("network should not run")));

    const denyRuntime = createAgentExplorationRuntime({
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore({
            evidence: commonEvidence,
          }),
        },
      },
      userDataPath: "/tmp/agent-exploration-http-deny",
      agentGatewayCall: deniedGateway.gateway,
      agentWorkspace: deniedWorkspace,
      contextRuntime: createContextRuntime(),
    });

    const denyResult = await denyRuntime.run({
      query: "拒绝 http",
      modelAlias: "deepseek",
      maxIterations: 1,
      clientUid: "blocked-http",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(denyResult.toolResults[0]).toMatchObject({
      tool: "http_request",
      result: {
        ok: false,
        error: "http_host_not_allowed",
      },
    });
  });
});

describe("authorization decisions", () => {
  it("reports authorization-denied for managed tool execution and keeps run flowing", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const securityPermissions = {
      evaluatePolicy: vi.fn(({ tool, dryRun = false, ...input }) => {
        if (tool?.id === "agent-exploration.local_command") {
          return {
            protocolVersion: "v0.0.1:risk-control:authorization-1",
            decisionId: "decision-deny",
            auditId: "audit-deny",
            toolExecutionId: input.toolExecutionId || "",
            traceId: input.traceId || "",
            toolId: tool.id,
            subject: {},
            grantedBy: "test",
            effect: "deny",
            allowed: false,
            reasonCode: "risk_exceeds_policy",
            redactedReason: "风险门禁触发。",
            deniedLayer: "tool",
            missingScopes: [],
            missingToolsets: [],
            evaluatedLayers: ["tool_catalog_policy", "runtime_safety_policy"],
            createdAt: new Date().toISOString(),
          };
        }
        return {
          protocolVersion: "v0.0.1:risk-control:authorization-1",
          decisionId: "decision-allow",
          auditId: "audit-allow",
          toolExecutionId: input.toolExecutionId || "",
          traceId: input.traceId || "",
          toolId: tool?.id || "",
          subject: {},
          effect: dryRun ? "dry_run_only" : "allow",
          allowed: true,
          reasonCode: dryRun ? "dry_run" : "allowed",
          redactedReason: "",
          deniedLayer: "",
          missingScopes: [],
          missingToolsets: [],
          evaluatedLayers: ["tool_catalog_policy"],
          createdAt: new Date().toISOString(),
        };
      }),
    };

    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("local_command", {
            commandId: "node-version",
            variables: {
              flag: "--version",
            },
          }),
        ],
      },
      {
        answer: "授权被拒绝后返回说明。",
      },
    ]);

    const deniedRuntime = createAgentExplorationRuntime({
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore({ evidence: commonEvidence }),
        },
      },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      securityPermissions,
    });

    const result = await deniedRuntime.run({
      query: "拒绝本地命令",
      modelAlias: "deepseek",
      maxIterations: 1,
    });

    expect(result.toolResults[0]).toMatchObject({
      tool: "local_command",
      result: {
        ok: false,
        error: "authorization_denied",
        reasonCode: "risk_exceeds_policy",
      },
    });
    expect(result.degraded).toBe(false);
    expect(securityPermissions.evaluatePolicy).toHaveBeenCalled();
  });
});
