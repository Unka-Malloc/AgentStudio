import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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

  function createWorkspaceRecord({
    workspaceId = `ws_${String(workspaces.size + 1).padStart(4, "0")}`,
    context = null,
    title = "",
    objective = "",
    metadata = {},
  } = {}) {
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
    createWorkspace: (input = {}) => ({ workspace: createWorkspaceRecord(input) }),
    getWorkspace: ({ workspaceId }) => workspaces.get(workspaceId) || null,
    getWorkspaceContext: (workspaceId) => workspaces.get(workspaceId)?.context || null,
    getRun: (runId) => runsById.get(runId)?.run || null,
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

function createContextRuntime(assembleImpl = null, overrides = {}) {
  return {
    assemble: vi.fn(
      assembleImpl ||
        (async () => ({
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
        }))
    ),
  };
}

function createKnowledgeCore({
  searchResult = [],
  evidence = {},
  includeSearch = true,
  includeAggregate = true,
  includeGetEvidence = true,
} = {}) {
  const core = { enabled: true };
  if (includeSearch) {
    core.search = vi.fn(async (input = {}) => ({
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
    }));
  }
  if (includeAggregate) {
    core.aggregate = vi.fn(async (input = {}) => ({
      ok: true,
      metric: input.metric,
      groupBy: input.groupBy,
      filters: {},
      scannedDocumentCount: 0,
      matchedDocumentCount: 0,
      groups: [],
      methodology: "",
    }));
  }
  if (includeGetEvidence) {
    core.getEvidence = vi.fn(async ({ evidenceId }) => evidence[evidenceId] || null);
  }
  return core;
}

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

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
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

describe("agent exploration runtime focused extra coverage", () => {
  it("records async failures and returns null for missing run ids", async () => {
    const userDataPath = await makeTempDir("agent-exploration-focused-async-");
    const workspace = createInMemoryAgentWorkspace();
    workspace.createWorkspace({
      workspaceId: "ws-async-failure",
    });
    const originalUpdateRun = workspace.updateRun;
    let failOnce = true;
    workspace.updateRun = (runId, patch = {}) => {
      if (failOnce && patch.status === "failed") {
        failOnce = false;
        throw new Error("run update failed");
      }
      return originalUpdateRun(runId, patch);
    };
    const runtime = createAgentExplorationRuntime({
      userDataPath,
      agentGatewayCall: vi.fn(async () => ({ ok: true, answer: "unused" })),
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(async () => {
        throw new Error("context assembly failed");
      }),
    });

    const pending = await runtime.run({
      workspaceId: "ws-async-failure",
      query: "background failure",
      async: true,
      maxIterations: 1,
    });

    expect(pending.pending).toBe(true);
    expect(pending.run.status).toBe("running");

    await new Promise((resolve) => setTimeout(resolve, 25));

    const failed = runtime.getRun({
      workspaceId: "ws-async-failure",
      runId: pending.run.runId,
    });
    expect(failed?.run?.status).toBe("failed");
    expect(failed?.run?.error).toBe("run update failed");
    expect(runtime.getRun({ workspaceId: "ws-async-failure", runId: "missing" })).toBeNull();
  });

  it("records aggregate example evidence in later context assembly", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      includeSearch: false,
      evidence: {},
      includeGetEvidence: false,
    });
    knowledgeCore.aggregate = vi.fn(async (input = {}) => ({
      ok: true,
      metric: input.metric,
      groupBy: input.groupBy,
      filters: {},
      scannedDocumentCount: 2,
      matchedDocumentCount: 2,
      topGroup: {
        key: "sender-a",
        label: "Sender A",
        count: 2,
      },
      groups: [
        {
          key: "sender-a",
          label: "Sender A",
          count: 2,
          evidenceRefs: ["ev-a"],
          examples: [
            {
              evidenceId: "ev-a",
              title: "Aggregate example",
            },
          ],
        },
      ],
      methodology: "aggregate method",
    }));
    const contextRuntime = createContextRuntime();
    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall(
            "knowledge_aggregate",
            {
              metric: "email_count_by_sender",
              groupBy: "senderEmail",
            },
            "call_aggregate_success"
          ),
        ],
      },
      {
        answer: "aggregate done",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: {
        mounts: {
          knowledgeBase: knowledgeCore,
        },
      },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime,
    });

    const result = await runtime.run({
      query: "aggregate example",
      maxIterations: 2,
    });

    expect(result.toolResults[0]).toMatchObject({
      tool: "knowledge_aggregate",
      result: {
        ok: true,
        metric: "email_count_by_sender",
        groupBy: "senderEmail",
      },
    });
    expect(contextRuntime.assemble).toHaveBeenCalledTimes(2);
    expect(contextRuntime.assemble.mock.calls[1][0].retrievedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: "ev-a",
        }),
      ])
    );
  });

  it("covers local command validation branches and substitution defaults", async () => {
    spawnMock.mockImplementation(
      mockSpawnSuccess({
        stdout: "ok\n",
      })
    );

    loadSettingsMock.mockResolvedValue({
      agentToolExecution: {
        local: {
          commands: [
            {
              commandId: "templated",
              command: "node",
              args: ["{{flag}}", "{{mode}}"],
              cwd: "/tmp/{{mode}}",
              stdin: "input {{mode}}",
              allowExtraArgs: false,
              variables: [
                {
                  name: "flag",
                  required: true,
                },
                {
                  name: "mode",
                  defaultValue: "alpha",
                  allowedValues: ["alpha", "beta"],
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
        toolCalls: [
          makeToolCall("local_command", {}, "call_template_required"),
          makeToolCall("local_command", { commandId: "missing-template" }, "call_not_registered"),
          makeToolCall("local_command", { commandId: "templated" }, "call_missing_var"),
        ],
      },
      {
        toolCalls: [
          makeToolCall(
            "local_command",
            {
              commandId: "templated",
              variables: { flag: "--flag", mode: "gamma" },
            },
            "call_not_allowed"
          ),
          makeToolCall(
            "local_command",
            {
              commandId: "templated",
              variables: { flag: "--flag" },
              args: ["extra"],
            },
            "call_extra_args"
          ),
          makeToolCall(
            "local_command",
            {
              commandId: "templated",
              variables: { flag: "--flag" },
            },
            "call_success"
          ),
        ],
      },
      {
        answer: "local command done",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-focused-local-command",
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore({
            evidence: {},
          }),
        },
      },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "local command",
      maxIterations: 2,
    });

    expect(result.toolResults).toHaveLength(6);
    expect(result.toolResults[0]).toMatchObject({
      tool: "local_command",
      result: {
        ok: false,
        error: "local_command_template_required",
      },
    });
    expect(result.toolResults[1]).toMatchObject({
      tool: "local_command",
      result: {
        ok: false,
        error: "local_command_not_registered",
        commandId: "missing-template",
      },
    });
    expect(result.toolResults[2]).toMatchObject({
      tool: "local_command",
      result: {
        ok: false,
        error: "local_command_variable_required",
        variable: "flag",
      },
    });
    expect(result.toolResults[3]).toMatchObject({
      tool: "local_command",
      result: {
        ok: false,
        error: "local_command_variable_not_allowed",
        variable: "mode",
      },
    });
    expect(result.toolResults[4]).toMatchObject({
      tool: "local_command",
      result: {
        ok: false,
        error: "local_command_extra_args_not_allowed",
        commandId: "templated",
      },
    });
    expect(result.toolResults[5]).toMatchObject({
      tool: "local_command",
      result: {
        ok: true,
        commandId: "templated",
        command: "node",
        args: ["--flag", "alpha"],
        cwd: "/tmp/alpha",
        exitCode: 0,
      },
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe("node");
    expect(spawnMock.mock.calls[0][1]).toEqual(["--flag", "alpha"]);
    expect(spawnMock.mock.calls[0][2]).toMatchObject({
      cwd: "/tmp/alpha",
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("rejects disabled and malformed HTTP tool calls", async () => {
    loadSettingsMock.mockResolvedValue({
      agentToolExecution: {
        http: {
          enabled: false,
          allowedHosts: ["allowed.local"],
          timeoutMs: 5000,
          maxResponseBytes: 64_000,
        },
      },
    });

    const workspace = createInMemoryAgentWorkspace();
    const disabledGateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("http_request", { method: "GET", url: "https://allowed.local/ping" }, "call_http_disabled")],
      },
      {
        answer: "disabled",
      },
    ]);

    const disabledRuntime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-focused-http-disabled",
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore(),
        },
      },
      agentGatewayCall: disabledGateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const disabledResult = await disabledRuntime.run({
      query: "disabled http",
      maxIterations: 1,
    });

    expect(disabledResult.toolResults[0]).toMatchObject({
      tool: "http_request",
      result: {
        ok: false,
        error: "http_tools_disabled",
      },
    });

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

    const malformedWorkspace = createInMemoryAgentWorkspace();
    const malformedGateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("http_request", { method: "TRACE", url: "https://allowed.local/ping" }, "call_bad_method"),
          makeToolCall("http_request", { method: "GET", url: "notaurl" }, "call_bad_url"),
          makeToolCall("http_request", { method: "GET", url: "ftp://allowed.local/ping" }, "call_bad_protocol"),
        ],
      },
      {
        answer: "malformed",
      },
    ]);

    const malformedRuntime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-focused-http-malformed",
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore(),
        },
      },
      agentGatewayCall: malformedGateway.gateway,
      agentWorkspace: malformedWorkspace,
      contextRuntime: createContextRuntime(),
    });

    const malformedResult = await malformedRuntime.run({
      query: "malformed http",
      maxIterations: 1,
    });

    expect(malformedResult.toolResults).toHaveLength(3);
    expect(malformedResult.toolResults[0]).toMatchObject({
      result: {
        ok: false,
        error: "http_method_not_allowed",
        method: "TRACE",
      },
    });
    expect(malformedResult.toolResults[1]).toMatchObject({
      result: {
        ok: false,
        error: "invalid_url",
      },
    });
    expect(malformedResult.toolResults[2]).toMatchObject({
      result: {
        ok: false,
        error: "unsupported_protocol",
        protocol: "ftp:",
      },
    });
  });

  it("covers knowledge aggregation and evidence validation errors", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const skillRuntime = {
      chat: vi.fn(async () => ({
        ok: true,
        status: "draft",
        gate: {
          scenarios: [
            {
              result: {
                context: {
                  candidate: {
                    evidenceRefs: ["ev-golden"],
                  },
                },
              },
            },
          ],
        },
      })),
    };
    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("knowledge_aggregate", { metric: "email_count_by_sender" }, "call_aggregate_unavailable"),
          makeToolCall("open_evidence", {}, "call_open_missing_id"),
          makeToolCall("golden_rule_authoring", {}, "call_rule_success"),
        ],
      },
      {
        toolCalls: [
          makeToolCall("open_evidence", { evidenceId: "missing" }, "call_open_missing"),
        ],
      },
      {
        answer: "validation errors",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore({
            includeAggregate: false,
            evidence: {},
          }),
        },
      },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      knowledgeRuleAuthoringRuntime: skillRuntime,
    });

    const result = await runtime.run({
      query: "evidence validation",
      maxIterations: 2,
    });

    expect(result.toolResults).toHaveLength(4);
    expect(result.toolResults[0]).toMatchObject({
      tool: "knowledge_aggregate",
      result: {
        ok: false,
        error: "knowledge_aggregate_unavailable",
      },
    });
    expect(result.toolResults[1]).toMatchObject({
      tool: "open_evidence",
      result: {
        ok: false,
        error: "evidence_id_required",
      },
    });
    expect(result.toolResults[2]).toMatchObject({
      tool: "golden_rule_authoring",
      result: {
        ok: true,
        status: "draft",
      },
    });
    expect(result.toolResults[3]).toMatchObject({
      tool: "open_evidence",
      result: {
        ok: false,
        error: "evidence_not_found",
        evidenceId: "missing",
      },
    });
    expect(skillRuntime.chat).toHaveBeenCalledWith(expect.objectContaining({
      message: "evidence validation",
      modelEnabled: false,
    }));
  });

  it("parses payload tool calls and fenced JSON tool calls", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      searchResult: [
        {
          evidenceId: "ev_1",
          documentId: "doc_1",
          title: "payload evidence",
          snippet: "payload snippet",
          score: 0.9,
          modalities: ["text"],
          assets: [],
          reasons: [],
        },
      ],
      evidence: {
        ev_1: {
          evidenceId: "ev_1",
          title: "payload evidence",
          snippet: "payload snippet",
          payload: {},
        },
      },
    });
    const gateway = createGatewaySequence([
      {
        payload: {
          choices: [
            {
              message: {
                tool_calls: [
                  makeToolCall("keyword_search", { query: "payload", limit: 1 }, "call_payload_keyword"),
                ],
              },
            },
          ],
        },
      },
      {
        answer: "```json\n[{\"name\":\"open_evidence\",\"arguments\":{\"evidenceId\":\"ev_1\"}}]\n```",
      },
      {
        answer: "payload parser done",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "payload parser",
      maxIterations: 2,
    });

    expect(result.toolResults).toHaveLength(2);
    expect(result.steps[0].functionCallSource).toBe("native_payload_tool_calls");
    expect(result.steps[1].functionCallSource).toBe("json_text_tool_call");
    expect(result.toolResults[0]).toMatchObject({
      tool: "keyword_search",
      result: {
        ok: true,
        query: "payload",
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
  });
});
