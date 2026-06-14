import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentExplorationRuntime,
} from "../../../server/platform/specialized/capabilities/tools/agent-exploration-runtime/index.mjs";

const loadSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/platform-core/settings.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/platform-core/settings.mjs");
  return {
    ...actual,
    loadSettings: loadSettingsMock,
  };
});

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
    submit: () => ({ submission: { status: "pending" } }),
    createDecision: () => ({ decision: {} }),
    savePrivateState: () => ({ ok: true }),
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
    getEvidence: vi.fn(async ({ evidenceId }) => evidence[evidenceId] || null),
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

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readAuditEvents(userDataPath) {
  const logPath = path.join(userDataPath, "logs", "agent-exploration.jsonl");
  const raw = await fs.readFile(logPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  loadSettingsMock.mockReset();
  loadSettingsMock.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent exploration runtime extra coverage", () => {
  it("rejects runtime creation without an AgentWorkspace", async () => {
    const runtime = createAgentExplorationRuntime({
      agentGatewayCall: vi.fn(async () => ({ ok: true, answer: "unused" })),
      contextRuntime: createContextRuntime(),
    });

    await expect(runtime.run({ query: "missing workspace" })).rejects.toThrow(
      "AgentExplorationRuntime requires AgentWorkspace."
    );
  });

  it("returns default settings when loadSettings fails", async () => {
    loadSettingsMock.mockRejectedValueOnce(new Error("settings unavailable"));

    const workspace = createInMemoryAgentWorkspace();
    const gateway = createGatewaySequence([
      {
        answer: "settings fallback",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-authz",
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore(),
        },
      },
    });

    const result = await runtime.run({
      query: "settings fallback",
      maxIterations: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.run.status).toBe("completed");
    expect(gateway.calls[0].parameters.pact_thinking_mode).toBeUndefined();
  });

  it("returns tool validation errors for missing skill and rule inputs", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const skillRuntime = {
      searchSkills: vi.fn(async () => ({
        items: [],
      })),
      proposeSkill: vi.fn(async () => ({
        ok: true,
        skill: {
          skillId: "skill-unreachable",
        },
      })),
    };
    const ruleRuntime = {
      chat: vi.fn(async () => ({
        ok: true,
        status: "draft",
      })),
    };
    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("keyword_search", { limit: 1 }, "call_keyword_missing_query"),
          makeToolCall("knowledge_skill_search", { limit: 1 }, "call_skill_search_missing_query"),
          makeToolCall("knowledge_skill_propose", { title: "proposal" }, "call_skill_propose_missing_refs"),
        ],
      },
      {
        answer: "validation done",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-authz",
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore(),
        },
      },
      knowledgeSkillRuntime: skillRuntime,
      knowledgeRuleAuthoringRuntime: ruleRuntime,
    });

    const result = await runtime.run({
      query: "validation",
      maxIterations: 1,
    });

    expect(result.toolResults).toHaveLength(3);
    expect(result.toolResults[0]).toMatchObject({
      tool: "keyword_search",
      result: {
        ok: false,
        error: "query_required",
      },
    });
    expect(result.toolResults[1]).toMatchObject({
      tool: "knowledge_skill_search",
      result: {
        ok: false,
        error: "query_required",
      },
    });
    expect(result.toolResults[2]).toMatchObject({
      tool: "knowledge_skill_propose",
      result: {
        ok: false,
        error: "evidence_refs_required",
      },
    });
    expect(skillRuntime.searchSkills).not.toHaveBeenCalled();
    expect(skillRuntime.proposeSkill).not.toHaveBeenCalled();
  });

  it("returns unavailable results when exploration runtimes are missing", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("keyword_search", { query: "mail" }, "call_keyword_missing_core"),
          makeToolCall("knowledge_skill_search", { query: "skills" }, "call_skill_missing_runtime"),
          makeToolCall("golden_rule_authoring", { message: "rule" }, "call_rule_missing_runtime"),
        ],
      },
      {
        answer: "missing runtimes",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-authz",
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "missing runtimes",
      maxIterations: 1,
    });

    expect(result.toolResults).toHaveLength(3);
    expect(result.toolResults[0]).toMatchObject({
      tool: "keyword_search",
      result: {
        ok: false,
        error: "knowledge_core_unavailable",
      },
    });
    expect(result.toolResults[1]).toMatchObject({
      tool: "knowledge_skill_search",
      result: {
        ok: false,
        error: "knowledge_skill_runtime_unavailable",
      },
    });
    expect(result.toolResults[2]).toMatchObject({
      tool: "golden_rule_authoring",
      result: {
        ok: false,
        error: "knowledge_rule_authoring_runtime_unavailable",
      },
    });
  });

  it("fails the run when skill runtime execution throws", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeSkillRuntime = {
      searchSkills: vi.fn(() => {
        throw new Error("skill search exploded");
      }),
    };
    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall("knowledge_skill_search", { query: "skills" }, "call_skill_throw"),
        ],
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-authz",
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore(),
        },
      },
      knowledgeSkillRuntime,
    });

    const result = await runtime.run({
      query: "skill runtime failure",
      maxIterations: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toBe("skill search exploded");
    expect(result.degraded).toBe(true);
  });

  it("passes authorization parameters to policy evaluation and executes allowed HTTP calls", async () => {
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
    workspace.createWorkspace({
      workspaceId: "ws-authz",
      context: {
        teamIds: ["workspace-team"],
      },
    });

    const securityPermissions = {
      evaluatePolicy: vi.fn(async ({ tool, dryRun, traceId, toolExecutionId, input, context }) => ({
        protocolVersion: "v0.0.1:risk-control:authorization-1",
        decisionId: `decision-${dryRun ? "preflight" : "allow"}`,
        auditId: `audit-${dryRun ? "preflight" : "allow"}`,
        toolExecutionId,
        traceId,
        toolId: tool?.id || "",
        effect: dryRun ? "dry_run_only" : "allow",
        allowed: true,
        reasonCode: "allowed",
        redactedReason: "",
        deniedLayer: "",
        requiredApproval: null,
        missingScopes: [],
        missingToolsets: [],
        evaluatedLayers: ["tool_catalog_policy"],
        createdAt: new Date().toISOString(),
        input,
        context,
      })),
    };

    const localFetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name === "content-type" ? "application/json" : null),
      },
      text: async () => JSON.stringify({
        ok: true,
        message: "pong",
      }),
    });

    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall(
            "http_request",
            {
              method: "GET",
              url: "https://allowed.local/ping?x=1",
              repoId: "repo-99",
              provider: "custom-provider",
              action: "fetch",
              workspaceId: "codespace-123",
            },
            "call_http_allowed"
          ),
        ],
      },
      {
        answer: "http ok",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath: "/tmp/agent-exploration-authz",
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore(),
        },
      },
      securityPermissions,
    });

    const result = await runtime.run({
      query: "http authz",
      workspaceId: "ws-authz",
      agentId: "agent-77",
      boundUserId: "user-88",
      teamIds: ["run-team"],
      authSession: {
        user: {
          userId: "session-user",
          username: "session-name",
          roleId: "role-a",
          teamIds: ["session-team"],
          tenantId: "tenant-a",
          orgId: "org-a",
          maxRisk: "medium",
        },
      },
      maxIterations: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.toolResults[0]).toMatchObject({
      tool: "http_request",
      result: {
        ok: true,
        method: "GET",
        url: "https://allowed.local/ping?x=1",
        status: 200,
      },
    });

    const executionCall = securityPermissions.evaluatePolicy.mock.calls.find(
      ([payload]) => payload.dryRun === false
    )?.[0];

    expect(executionCall).toMatchObject({
      dryRun: false,
      grantRequired: true,
      governanceRequired: true,
      enforceConfirmation: false,
      context: {
        surface: "agent-exploration-runtime",
        toolExpected: true,
        preflight: false,
        agentId: "agent-77",
        agentProfileId: "agent-77",
        profileId: "agent-77",
        boundUserId: "user-88",
        userId: "user-88",
        workspaceId: "ws-authz",
        resourceType: "repo",
        resourceId: "repo-99",
        targetProvider: "custom-provider",
        requestedAction: "fetch",
        requestedEgress: "allowed.local",
      },
      input: {
        repoId: "repo-99",
        provider: "custom-provider",
        action: "fetch",
        resourceType: "repo",
        resourceId: "repo-99",
        targetProvider: "custom-provider",
        requestedEgress: "allowed.local",
      },
    });
    expect(executionCall.subject).toMatchObject({
      subjectId: "agent-77",
      agentProfileId: "agent-77",
      metadata: {
        boundUserId: "user-88",
        userId: "user-88",
      },
    });
    localFetchSpy.mockRestore();
  });

  it("falls back to denied authorization when policy evaluation throws", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const securityPermissions = {
      evaluatePolicy: vi.fn(async () => {
        throw new Error("policy engine unavailable");
      }),
    };
    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall(
            "http_request",
            {
              method: "GET",
              url: "https://allowed.local/ping",
              repoId: "repo-77",
            },
            "call_http_denied"
          ),
        ],
      },
      {
        answer: "denied",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore(),
        },
      },
      securityPermissions,
    });

    const result = await runtime.run({
      query: "authorization fallback",
      maxIterations: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.toolResults[0]).toMatchObject({
      tool: "http_request",
      result: {
        ok: false,
        error: "authorization_denied",
        reasonCode: "authorization_evaluation_failed",
      },
    });
  });

  it("maps workspace run status into getRun pending and ok fields", () => {
    const workspace = createInMemoryAgentWorkspace();
    const created = workspace.createWorkspace({
      workspaceId: "ws-status",
    }).workspace;
    const queued = workspace.createRun({
      workspaceId: created.workspaceId,
      runType: "knowledge_agent_exploration",
      status: "queued",
      input: {},
      startedAt: "2026-06-05T00:00:00.000Z",
    }).run;
    const running = workspace.createRun({
      workspaceId: created.workspaceId,
      runType: "knowledge_agent_exploration",
      status: "running",
      input: {},
      startedAt: "2026-06-05T00:00:00.000Z",
    }).run;
    const completed = workspace.createRun({
      workspaceId: created.workspaceId,
      runType: "knowledge_agent_exploration",
      status: "completed",
      input: {},
      startedAt: "2026-06-05T00:00:00.000Z",
    }).run;
    const failed = workspace.createRun({
      workspaceId: created.workspaceId,
      runType: "knowledge_agent_exploration",
      status: "failed",
      input: {},
      startedAt: "2026-06-05T00:00:00.000Z",
    }).run;

    const runtime = createAgentExplorationRuntime({
      agentGatewayCall: vi.fn(async () => ({ ok: true, answer: "unused" })),
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    expect(runtime.getRun({ workspaceId: created.workspaceId, runId: queued.runId })).toMatchObject({
      ok: true,
      pending: true,
    });
    expect(runtime.getRun({ workspaceId: created.workspaceId, runId: running.runId })).toMatchObject({
      ok: true,
      pending: true,
    });
    expect(runtime.getRun({ workspaceId: created.workspaceId, runId: completed.runId })).toMatchObject({
      ok: true,
      pending: false,
    });
    expect(runtime.getRun({ workspaceId: created.workspaceId, runId: failed.runId })).toMatchObject({
      ok: false,
      pending: false,
      error: "",
    });
  });

  it("normalizes legacy inputs, keyword-search aliases, and audit provider fallback", async () => {
    loadSettingsMock.mockResolvedValue({
      agentExploreDefaults: {
        thinkingMode: "disabled",
      },
    });

    const userDataPath = await makeTempDir("agent-exploration-audit-");
    const workspace = createInMemoryAgentWorkspace();
    workspace.createWorkspace({
      workspaceId: "ws-legacy",
      context: {
        knowledgeSourceIds: ["ws-source-1"],
      },
    });
    const knowledgeCore = createKnowledgeCore({
      searchResult: [
        {
          evidenceId: "ev-legacy",
          documentId: "doc-legacy",
          title: "旧入口记录",
          snippet: "legacy search hit",
          score: 0.91,
          hierarchy: { source: "mail" },
          modalities: ["text"],
          assets: [],
          reasons: [],
        },
      ],
    });
    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("search", { query: "  legacy query  ", limit: 1 }, "call_search")],
        upstream: {
          status: "fallback-provider",
          contentType: "application/json",
        },
      },
      {
        answer: "done",
        upstream: {
          status: "fallback-provider",
          contentType: "application/json",
        },
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath,
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      workspaceId: "ws-legacy",
      question: "legacy question",
      alias: "legacy-model",
      profileId: "legacy-profile",
      thinkingMode: "disabled",
      maxIterations: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.run.input.query).toBe("legacy question");
    expect(result.run.input.modelAlias).toBe("legacy-model");
    expect(result.run.input.contextProfileId).toBe("legacy-profile");
    expect(result.run.input.thinkingMode).toBe("disabled");
    expect(result.run.input.scopeSourceIds).toEqual(["ws-source-1"]);
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      tool: "keyword_search",
      result: {
        ok: true,
        query: "legacy query",
      },
    });
    expect(gateway.calls[0].modelAlias).toBe("legacy-model");
    expect(gateway.calls[0].parameters.pact_thinking_mode).toBe("disabled");
    expect(gateway.calls[0].parameters.tools.map((item) => item.function?.name)).toContain("keyword_search");

    const events = await readAuditEvents(userDataPath);
    const modelResponse = events.find((entry) => entry.event === "model_response");
    expect(modelResponse.provider).toBe("fallback-provider");
  });

  it("hydrates knowledge skill context and runs the skill-search alias", async () => {
    loadSettingsMock.mockResolvedValue({
      agentExploreDefaults: {
        thinkingMode: "enabled",
      },
    });

    const userDataPath = await makeTempDir("agent-exploration-skill-");
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore();
    const knowledgeSkillRuntime = {
      buildContextForQuery: vi.fn(() => ({
        matchedSkills: ["skill-1"],
        note: "guidance",
      })),
      searchSkills: vi.fn(() => ({
        items: [
          {
            skillId: "skill-1",
            title: "Skill 1",
            summary: "Reusable guidance",
            matchScore: 0.88,
            skill: {
              applicability: { useWhen: ["when needed"] },
              coreConcepts: [{ term: "focus", weight: 1 }],
              decisionHeuristics: ["stay local"],
              antiPatterns: ["invent facts"],
              honestBoundaries: ["cite evidence"],
            },
            evidenceRefs: ["ev-skill-1"],
            qualityReport: { score: 0.92 },
          },
        ],
      })),
    };
    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("skill_search", { query: "contextual skill", limit: 1 }, "call_skill")],
      },
      {
        answer: "skill answer",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath,
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      knowledgeSkillRuntime,
    });

    const result = await runtime.run({
      query: "skill query",
      maxIterations: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.knowledgeSkillContext).toMatchObject({
      matchedSkills: ["skill-1"],
      note: "guidance",
    });
    expect(result.toolResults[0]).toMatchObject({
      tool: "knowledge_skill_search",
      result: {
        ok: true,
        query: "contextual skill",
        count: 1,
      },
    });
    expect(result.evidenceRefs).toEqual(["ev-skill-1"]);
    expect(gateway.calls[0].parameters.pact_thinking_mode).toBe("enabled");
    expect(knowledgeSkillRuntime.buildContextForQuery).toHaveBeenCalledWith(expect.objectContaining({
      query: "skill query",
    }));
    expect(knowledgeSkillRuntime.searchSkills).toHaveBeenCalledWith(expect.objectContaining({
      query: "contextual skill",
      status: "published",
    }));
  });

  it("filters unauthorized managed tools preflight and returns needs-approval on execution", async () => {
    const securityPermissions = {
      evaluatePolicy: vi.fn(async ({ tool, dryRun = false }) => {
        if (tool?.id === "agent-exploration.knowledge_skill_propose") {
          if (dryRun) {
            return {
              protocolVersion: "v0.0.1:risk-control:authorization-1",
              decisionId: "decision-preflight-deny",
              auditId: "audit-preflight-deny",
              toolExecutionId: "",
              traceId: "",
              toolId: tool.id,
              effect: "deny",
              allowed: false,
              reasonCode: "preflight_blocked",
              redactedReason: "preflight denied",
              deniedLayer: "tool",
              requiredApproval: null,
              missingScopes: [],
              missingToolsets: [],
              evaluatedLayers: ["tool_catalog_policy"],
              createdAt: new Date().toISOString(),
            };
          }
          return {
            protocolVersion: "v0.0.1:risk-control:authorization-1",
            decisionId: "decision-needs-approval",
            auditId: "audit-needs-approval",
            toolExecutionId: "",
            traceId: "",
            toolId: tool.id,
            effect: "needsApproval",
            allowed: false,
            reasonCode: "human_review_required",
            redactedReason: "needs approval",
            deniedLayer: "tool",
            requiredApproval: { code: "operator-approval", label: "Review required" },
            missingScopes: [],
            missingToolsets: [],
            evaluatedLayers: ["tool_catalog_policy"],
            createdAt: new Date().toISOString(),
          };
        }
        return {
          protocolVersion: "v0.0.1:risk-control:authorization-1",
          decisionId: "decision-allow",
          auditId: "audit-allow",
          toolExecutionId: "",
          traceId: "",
          toolId: tool?.id || "",
          effect: dryRun ? "dry_run_only" : "allow",
          allowed: true,
          reasonCode: "allowed",
          redactedReason: "",
          deniedLayer: "",
          requiredApproval: null,
          missingScopes: [],
          missingToolsets: [],
          evaluatedLayers: ["tool_catalog_policy"],
          createdAt: new Date().toISOString(),
        };
      }),
    };

    const workspace = createInMemoryAgentWorkspace();
    const gateway = createGatewaySequence([
      {
        toolCalls: [
          makeToolCall(
            "knowledge_skill_propose",
            {
              title: "Reusable proposal",
              summary: "summary",
              decisionHeuristics: ["use evidence"],
              honestBoundaries: ["do not invent"],
              evidenceRefs: ["ev-1"],
            },
            "call_skill_propose"
          ),
        ],
      },
      {
        answer: "authorization handled",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: {
        mounts: {
          knowledgeBase: createKnowledgeCore({
            evidence: {
              ev_1: {
                evidenceId: "ev_1",
                title: "evidence",
                snippet: "snippet",
                payload: {},
              },
            },
          }),
        },
      },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      securityPermissions,
    });

    const result = await runtime.run({
      query: "authorization",
      maxIterations: 1,
    });

    expect(gateway.calls[0].parameters.tools.map((item) => item.function?.name)).not.toContain("knowledge_skill_propose");
    expect(result.toolResults[0]).toMatchObject({
      tool: "knowledge_skill_propose",
      result: {
        ok: false,
        error: "authorization_needs_approval",
        reasonCode: "human_review_required",
      },
    });
    expect(result.toolResults[0].result.requiredApproval).toMatchObject({
      code: "operator-approval",
    });
    expect(result.degraded).toBe(false);
    expect(securityPermissions.evaluatePolicy).toHaveBeenCalled();
  });

  it("rejects final synthesis tool calls and falls back to the local evidence summary", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      searchResult: [
        {
          evidenceId: "ev-final",
          documentId: "doc-final",
          title: "final evidence",
          snippet: "final snippet",
          score: 0.95,
          modalities: ["text"],
          assets: [],
          reasons: [],
        },
      ],
    });
    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("search", { query: "final", limit: 1 }, "call_final_search")],
      },
      {
        toolCalls: [makeToolCall("search", { query: "should not run" }, "call_final_bad")],
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "final synthesis rejection",
      maxIterations: 1,
    });

    expect(result.degraded).toBe(true);
    expect(result.run.coverage.finalSynthesis).toBe(true);
    expect(result.steps.some((step) => step.phase === "final_synthesis_rejected_tool_call")).toBe(true);
    expect(result.answer).toContain("已完成本地关键词检索");
    expect(result.answer).toContain("ev-final");
  });

  it("returns pending for async runs and finishes them in the background", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const knowledgeCore = createKnowledgeCore({
      searchResult: [
        {
          evidenceId: "ev-bg",
          documentId: "doc-bg",
          title: "background evidence",
          snippet: "background snippet",
          score: 0.93,
          modalities: ["text"],
          assets: [],
          reasons: [],
        },
      ],
    });
    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("search", { query: "background", limit: 1 }, "call_bg")],
      },
      {
        answer: "background answer",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: knowledgeCore } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "background",
      async: true,
      maxIterations: 1,
    });

    expect(result.pending).toBe(true);
    expect(result.run.status).toBe("running");

    await new Promise((resolve) => setTimeout(resolve, 25));

    const finished = runtime.getRun({ workspaceId: result.workspace.workspaceId, runId: result.run.runId });
    expect(finished?.run?.status).toBe("completed");
    expect(finished?.answer).toContain("background answer");
  });

  it("normalizes legacy input aliases and clamps run bounds before the first gateway call", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const gateway = createGatewaySequence([
      {
        answer: "normalized",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: createKnowledgeCore() } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      workspaceId: "ws-normalized",
      question: "  legacy question  ",
      alias: "  legacy-model  ",
      profileId: "  legacy-profile  ",
      sourceIds: ["  alpha  ", "alpha", " beta ", "", null, "beta"],
      thinkingMode: "unsupported-mode",
      maxIterations: 99,
      limit: 99,
    });

    expect(result.ok).toBe(true);
    expect(result.run.input).toMatchObject({
      query: "legacy question",
      modelAlias: "legacy-model",
      contextProfileId: "legacy-profile",
      thinkingMode: "default",
      maxIterations: 8,
      limit: 20,
      scopeSourceIds: ["alpha", "beta"],
    });
    expect(gateway.calls[0].sessionId).toBe("ws-normalized");
    expect(gateway.calls[0].parameters.pact_thinking_mode).toBeUndefined();
    expect(gateway.calls[0].modelAlias).toBe("legacy-model");
  });

  it("keeps async run lifecycle stable when audit log persistence is blocked", async () => {
    const userDataPath = await makeTempDir("agent-exploration-persistence-");
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(path.join(userDataPath, "logs"), "blocked by test");

    const workspace = createInMemoryAgentWorkspace();
    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("search", { query: "background", limit: 1 }, "call_bg_persist")],
      },
      {
        answer: "background answer",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      userDataPath,
      runtime: { mounts: { knowledgeBase: createKnowledgeCore() } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const pending = await runtime.run({
      query: "background",
      workspaceId: "ws-persistence",
      async: true,
      maxIterations: 1,
    });

    expect(pending.pending).toBe(true);
    expect(pending.run.status).toBe("running");

    await new Promise((resolve) => setTimeout(resolve, 50));

    const finished = runtime.getRun({ runId: pending.run.runId });
    expect(finished?.pending).toBe(false);
    expect(finished?.run?.status).toBe("completed");
    expect(finished?.answer).toContain("background answer");
    expect(workspace.getWorkspace({ workspaceId: "ws-persistence" })?.runs).toHaveLength(1);
    await expect(fs.stat(path.join(userDataPath, "logs", "agent-exploration.jsonl"))).rejects.toThrow();
  });

  it("records unknown tool calls as failures and still completes the run", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const gateway = createGatewaySequence([
      {
        toolCalls: [makeToolCall("unknown_tool", { query: "  fallback  " }, "call_unknown_tool")],
      },
      {
        answer: "tool failure handled",
      },
    ]);

    const runtime = createAgentExplorationRuntime({
      runtime: { mounts: { knowledgeBase: createKnowledgeCore() } },
      agentGatewayCall: gateway.gateway,
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
    });

    const result = await runtime.run({
      query: "unknown tool",
      workspaceId: "ws-tool-failure",
      maxIterations: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.run.status).toBe("completed");
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      tool: "unknown_tool",
      result: {
        ok: false,
        error: "authorization_denied",
      },
    });
    expect(result.steps.some((step) => step.toolResults.some((entry) => entry.status === "failed"))).toBe(true);
    expect(gateway.calls).toHaveLength(2);
  });

  it("returns a failed run when the gateway throws", async () => {
    const workspace = createInMemoryAgentWorkspace();
    const runtime = createAgentExplorationRuntime({
      agentGatewayCall: vi.fn(async () => {
        throw new Error("gateway exploded");
      }),
      agentWorkspace: workspace,
      contextRuntime: createContextRuntime(),
      runtime: { mounts: { knowledgeBase: createKnowledgeCore() } },
    });

    const result = await runtime.run({
      query: "failure",
      maxIterations: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toBe("gateway exploded");
    expect(result.degraded).toBe(true);
  });
});
