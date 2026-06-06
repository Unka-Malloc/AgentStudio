// @vitest-environment jsdom
import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAgentWorkspace,
  getKnowledgeAgentExploreRun,
  listAgentWorkspaces,
  runKnowledgeAgentExplore as runKnowledgeAgentExploreApi,
} from "../../../server-web/lib/agent-explore-client";
import { createConsoleAgentExploreSessionController } from "../../../server-web/composables/console-agent-explore-session-controller";
import type { AgentExploreRunResponse } from "../../../server-web/lib/types";
import type { AgentExploreSession, AppView, DebugTab } from "../../../server-web/types/app";

vi.mock("../../../server-web/lib/agent-explore-client", () => ({
  getAgentWorkspace: vi.fn(),
  getKnowledgeAgentExploreRun: vi.fn(),
  listAgentWorkspaces: vi.fn(),
  runKnowledgeAgentExplore: vi.fn(),
}));

const mockedGetAgentWorkspace = vi.mocked(getAgentWorkspace);
const mockedGetKnowledgeAgentExploreRun = vi.mocked(getKnowledgeAgentExploreRun);
const mockedListAgentWorkspaces = vi.mocked(listAgentWorkspaces);
const mockedRunKnowledgeAgentExploreApi = vi.mocked(runKnowledgeAgentExploreApi);

function createRunResponse(overrides: Partial<AgentExploreRunResponse> = {}): AgentExploreRunResponse {
  const run = {
    runId: "run-1",
    workspaceId: "workspace-1",
    status: "completed",
    input: {
      query: "Explain the policy",
      modelAlias: "agent-model",
      contextProfileId: "context-128k",
      thinkingMode: "balanced",
      temperature: 0.4,
      maxTokens: 2048,
      maxIterations: 3,
      limit: 6,
      toolChoice: "auto",
    },
    updatedAt: "2026-06-04T10:00:00.000Z",
    coverage: {
      answer: "Policy answer",
      evidenceRefs: ["doc:1"],
    },
  };
  return {
    protocolVersion: "1",
    ok: true,
    workspace: {
      workspaceId: "workspace-1",
    },
    run,
    answer: "Policy answer",
    steps: [],
    evidenceRefs: ["doc:1"],
    toolResults: [],
    ...overrides,
  } as AgentExploreRunResponse;
}

function createSession(overrides: Partial<AgentExploreSession> = {}): AgentExploreSession {
  return {
    runId: "run-1",
    workspaceId: "workspace-1",
    query: "Explain the policy",
    modelAlias: "agent-model",
    contextProfileId: "context-128k",
    thinkingMode: "balanced",
    temperature: 0.4,
    maxTokens: 2048,
    maxIterations: 3,
    limit: 6,
    toolChoice: "auto",
    status: "completed",
    answerPreview: "Policy answer",
    updatedAt: "2026-06-04T10:00:00.000Z",
    ...overrides,
  };
}

function createHarness(overrides: {
  canReadKnowledge?: boolean;
  modelEnabled?: boolean;
  busy?: string;
  hydrated?: boolean;
} = {}) {
  const busy = ref(overrides.busy || "");
  const agentExploreActiveTabId = ref("draft:active");
  const agentExploreClosedTabIds = ref(new Set<string>());
  const agentExploreDraftTabs = ref<AgentExploreSession[]>([
    createSession({
      runId: "draft:active",
      workspaceId: "",
      query: "Draft question",
      status: "draft",
      updatedAt: "2026-06-04T09:00:00.000Z",
    }),
  ]);
  const agentExploreHiddenRunIds = ref(new Set<string>());
  const agentExploreHistory = ref<AgentExploreSession[]>([]);
  const agentExploreHydrated = ref(overrides.hydrated ?? true);
  const agentExploreResult = ref<AgentExploreRunResponse | null>(null);
  const agentExploreTraceOpen = ref(false);
  const agentExploreForm = ref({
    query: " Explain the policy ",
    modelAlias: "agent-model",
    contextProfileId: "context-128k",
    thinkingMode: "balanced",
    temperature: 9,
    maxTokens: 999999,
    maxIterations: 99,
    limit: 99,
    toolChoice: " auto ",
    workspaceId: "",
  });
  const error = ref("");
  const clearAllBusy = vi.fn(() => {
    busy.value = "";
  });
  const setBusy = vi.fn((key: string) => {
    busy.value = key;
  });

  const controller = createConsoleAgentExploreSessionController({
    agentExploreActiveTabId,
    agentExploreClosedTabIds,
    agentExploreDraftTabs,
    agentExploreForm,
    agentExploreHiddenRunIds,
    agentExploreHistory,
    agentExploreHydrated,
    agentExploreResult,
    agentExploreTraceOpen,
    busyKey: computed(() => busy.value),
    canReadKnowledge: computed(() => overrides.canReadKnowledge ?? true),
    clearAllBusy,
    currentView: ref<AppView>("dashboard"),
    debugTab: ref<DebugTab>("knowledgeRecall"),
    error,
    hasAgentModelOption: (value?: string) => ["agent-model", "fallback-model"].includes(String(value || "")),
    selectedAgentExploreContextProfile: computed(() => ({ value: "context-128k" })),
    selectedAgentExploreModel: computed(() => ({
      value: "agent-model",
      enabled: overrides.modelEnabled ?? true,
    })),
    selectedAgentExploreThinkingMode: computed(() => "balanced"),
    setBusy,
    validAgentModelAlias: (value?: string) => (value === "agent-model" ? "agent-model" : ""),
    agentExploreDefaults: () => ({
      temperature: 0.2,
      maxTokens: 1800,
      maxIterations: 4,
      limit: 8,
      toolChoice: "auto",
    }),
    normalizeThinkingMode: (value?: string) => String(value || "default").trim() || "default",
  });

  return {
    agentExploreActiveTabId,
    agentExploreClosedTabIds,
    agentExploreDraftTabs,
    agentExploreForm,
    agentExploreHiddenRunIds,
    agentExploreHistory,
    agentExploreHydrated,
    agentExploreResult,
    agentExploreTraceOpen,
    busy,
    clearAllBusy,
    controller,
    error,
    setBusy,
  };
}

describe("console agent explore session controller", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("validates required query, permission, and enabled model before running", async () => {
    const emptyQueryHarness = createHarness();
    emptyQueryHarness.agentExploreForm.value.query = "   ";
    await emptyQueryHarness.controller.runKnowledgeAgentExplore();
    expect(emptyQueryHarness.error.value).toBe("请输入智能检索问题。");
    expect(mockedRunKnowledgeAgentExploreApi).not.toHaveBeenCalled();

    const deniedHarness = createHarness({ canReadKnowledge: false });
    await deniedHarness.controller.runKnowledgeAgentExplore();
    expect(deniedHarness.error.value).toBe("当前账号没有知识库读取权限。");

    const disabledModelHarness = createHarness({ modelEnabled: false });
    await disabledModelHarness.controller.runKnowledgeAgentExplore();
    expect(disabledModelHarness.error.value).toBe("请选择模型库中已配置且支持智能检索工具调用的模型。");
  });

  it("runs exploration with bounded numeric options and replaces the active draft tab", async () => {
    mockedRunKnowledgeAgentExploreApi.mockResolvedValue(createRunResponse());
    const harness = createHarness();

    await harness.controller.runKnowledgeAgentExplore();

    expect(mockedRunKnowledgeAgentExploreApi).toHaveBeenCalledWith({
      query: "Explain the policy",
      modelAlias: "agent-model",
      contextProfileId: "context-128k",
      thinkingMode: "balanced",
      temperature: 2,
      maxTokens: 32000,
      maxIterations: 8,
      limit: 20,
      toolChoice: "auto",
      workspaceId: undefined,
      async: true,
      realtime: true,
    });
    expect(harness.agentExploreForm.value.workspaceId).toBe("workspace-1");
    expect(harness.agentExploreActiveTabId.value).toBe("run-1");
    expect(harness.agentExploreDraftTabs.value).toHaveLength(0);
    expect(harness.error.value).toBe("");
    expect(harness.clearAllBusy).toHaveBeenCalled();
    expect(harness.busy.value).toBe("");
  });

  it("loads sessions, normalizes history, and reports load failures", async () => {
    mockedGetKnowledgeAgentExploreRun.mockResolvedValueOnce(createRunResponse({
      run: {
        ...createRunResponse().run,
        runId: "run-load",
        workspaceId: "workspace-load",
        status: "completed",
      },
      workspace: {
        workspaceId: "workspace-load",
      },
    } as Partial<AgentExploreRunResponse>));
    const harness = createHarness();
    const session = createSession({
      runId: "run-load",
      workspaceId: "workspace-load",
      modelAlias: "missing-model",
    });

    await harness.controller.loadAgentExploreSession(session);

    expect(mockedGetKnowledgeAgentExploreRun).toHaveBeenCalledWith("run-load", {
      workspaceId: "workspace-load",
    });
    expect(harness.agentExploreForm.value.modelAlias).toBe("");
    expect(harness.agentExploreActiveTabId.value).toBe("run-load");
    expect(harness.controller.agentExploreTabs.value.map((item) => item.runId)).toContain("run-load");
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:agent-explore:load:run-load");

    mockedGetKnowledgeAgentExploreRun.mockRejectedValueOnce(new Error("load failed"));
    await harness.controller.loadAgentExploreSession(createSession({ runId: "bad-run" }));
    expect(harness.error.value).toBe("load failed");
  });

  it("loads server history from agent workspaces and ignores unrelated workspaces", async () => {
    mockedListAgentWorkspaces.mockResolvedValue({
      count: 3,
      workspaces: [
        {
          workspaceId: "workspace-a",
          metadata: {
            createdBy: "knowledge.agent-explore",
          },
        },
        {
          workspaceId: "workspace-b",
          metadata: {
            createdBy: "manual",
          },
        },
        {
          workspaceId: "workspace-c",
          metadata: {
            createdBy: "knowledge.agent-explore",
          },
        },
      ],
    });
    mockedGetAgentWorkspace
      .mockResolvedValueOnce({
        workspace: {
          workspaceId: "workspace-a",
        },
        runs: [
          {
            runId: "run-a",
            workspaceId: "workspace-a",
            runType: "knowledge_agent_exploration",
            status: "completed",
            input: {
              query: "A",
              modelAlias: "agent-model",
            },
            coverage: {
              answer: "Answer A",
            },
            updatedAt: "2026-06-04T11:00:00.000Z",
          },
          {
            runId: "ignored-run",
            runType: "other",
            updatedAt: "2026-06-04T12:00:00.000Z",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("missing workspace"));
    const harness = createHarness();

    const sessions = await harness.controller.loadAgentExploreHistoryFromServer();

    expect(mockedListAgentWorkspaces).toHaveBeenCalledWith({
      limit: 30,
      includeSummary: false,
    });
    expect(mockedGetAgentWorkspace).toHaveBeenCalledTimes(2);
    expect(sessions.map((item) => item.runId)).toEqual(["run-a"]);
    expect(harness.controller.agentExploreHistoryPanelItems.value[0]).toMatchObject({
      id: "run-a",
      title: expect.stringContaining("A"),
    });
  });

  it("polls running sessions and clears busy state on terminal failures", async () => {
    mockedGetKnowledgeAgentExploreRun.mockResolvedValue(createRunResponse({
      ok: false,
      error: "terminal failure",
      run: {
        ...createRunResponse().run,
        status: "failed",
        error: "terminal failure",
      },
    } as Partial<AgentExploreRunResponse>));
    const harness = createHarness({ busy: "knowledge:agent-explore" });

    harness.controller.startAgentExplorePolling("run-1", "workspace-1");
    await vi.runOnlyPendingTimersAsync();

    expect(mockedGetKnowledgeAgentExploreRun).toHaveBeenCalledWith("run-1", {
      workspaceId: "workspace-1",
    });
    expect(harness.error.value).toBe("terminal failure");
    expect(harness.clearAllBusy).toHaveBeenCalled();
  });

  it("resets, closes, and deletes tabs while preserving normalized state", async () => {
    const harness = createHarness();
    const historySession = createSession({ runId: "history-run", updatedAt: "2026-06-04T08:00:00.000Z" });
    harness.controller.upsertAgentExploreHistory(historySession);

    harness.controller.resetKnowledgeAgentExplore();
    expect(harness.agentExploreActiveTabId.value).toMatch(/^draft:/u);
    expect(harness.agentExploreForm.value.query).toBe("");
    expect(harness.controller.agentExploreTabs.value[0].status).toBe("draft");

    await harness.controller.switchAgentExploreTab(historySession);
    harness.controller.closeAgentExploreTab(historySession);
    expect(harness.agentExploreClosedTabIds.value.has("history-run")).toBe(true);

    harness.controller.deleteAgentExploreHistoryItem("history-run");
    expect(harness.controller.agentExploreTabs.value.some((item) => item.runId === "history-run")).toBe(false);
  });

  it("ignores empty session ids when closing or deleting agent explore tabs", () => {
    const harness = createHarness();
    const emptySession = createSession({ runId: "" });

    harness.controller.closeAgentExploreTab(emptySession);
    harness.controller.deleteAgentExploreHistorySession(emptySession);

    expect(harness.agentExploreHiddenRunIds.value.size).toBe(0);
    expect(harness.agentExploreClosedTabIds.value.size).toBe(0);
    expect(harness.agentExploreDraftTabs.value).toHaveLength(1);
  });

  it("clears an active deleted run without creating a fallback tab", () => {
    const activeSession = createSession({ runId: "run-active", workspaceId: "workspace-active" });
    const harness = createHarness({ busy: "knowledge:agent-explore:load:run-active" });
    harness.agentExploreActiveTabId.value = "run-active";
    harness.agentExploreDraftTabs.value = [];
    harness.agentExploreHistory.value = [activeSession];
    harness.agentExploreForm.value.workspaceId = "workspace-active";
    harness.agentExploreResult.value = createRunResponse({
      run: {
        ...createRunResponse().run,
        runId: "run-active",
        workspaceId: "workspace-active",
      },
      workspace: {
        workspaceId: "workspace-active",
      },
    } as Partial<AgentExploreRunResponse>);

    harness.controller.deleteAgentExploreHistorySession(activeSession);

    expect(harness.agentExploreHiddenRunIds.value.has("run-active")).toBe(true);
    expect(harness.agentExploreActiveTabId.value).toBe("");
    expect(harness.agentExploreForm.value.workspaceId).toBe("");
    expect(harness.agentExploreResult.value).toBeNull();
    expect(harness.agentExploreDraftTabs.value).toEqual([]);
    expect(harness.clearAllBusy).toHaveBeenCalled();
  });

  it("creates a fallback draft when closing the active run tab", () => {
    const activeSession = createSession({ runId: "run-close", workspaceId: "workspace-close" });
    const harness = createHarness({ busy: "knowledge:agent-explore" });
    harness.agentExploreActiveTabId.value = "run-close";
    harness.agentExploreDraftTabs.value = [];
    harness.agentExploreHistory.value = [activeSession];
    harness.agentExploreResult.value = createRunResponse({
      run: {
        ...createRunResponse().run,
        runId: "run-close",
        workspaceId: "workspace-close",
      },
      workspace: {
        workspaceId: "workspace-close",
      },
    } as Partial<AgentExploreRunResponse>);

    harness.controller.closeAgentExploreTab(activeSession);

    expect(harness.agentExploreClosedTabIds.value.has("run-close")).toBe(true);
    expect(harness.agentExploreDraftTabs.value).toHaveLength(1);
    expect(harness.agentExploreActiveTabId.value).toMatch(/^draft:/u);
    expect(harness.agentExploreTraceOpen.value).toBe(true);
    expect(harness.agentExploreResult.value).toBeNull();
    expect(harness.clearAllBusy).toHaveBeenCalled();
  });
});
