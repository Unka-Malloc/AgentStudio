// @vitest-environment jsdom
import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentExploreRunResponse } from "../../../server-web/lib/types";
import {
  AGENT_EXPLORE_STORAGE_KEY,
  AGENT_EXPLORE_STORAGE_VERSION,
} from "../../../server-web/composables/console-agent-explore-persistence";
import { createConsoleAgentExploreHistoryController } from "../../../server-web/composables/console-agent-explore-history-controller";
import { syncActiveAgentExploreDraftFromFormCore } from "../../../server-web/composables/console-agent-explore-state-utils";
import type { AgentExploreSession } from "../../../server-web/types/app";
import type { AgentExploreFormState } from "../../../server-web/composables/console-agent-explore-utils";
import {
  getAgentWorkspace,
  listAgentWorkspaces,
} from "../../../server-web/lib/agent-explore-client";

const clientMock = vi.hoisted(() => ({
  getAgentWorkspace: vi.fn(),
  listAgentWorkspaces: vi.fn(),
}));

vi.mock("../../../server-web/lib/agent-explore-client", () => ({
  getAgentWorkspace: clientMock.getAgentWorkspace,
  listAgentWorkspaces: clientMock.listAgentWorkspaces,
}));

const mockedGetAgentWorkspace = vi.mocked(getAgentWorkspace);
const mockedListAgentWorkspaces = vi.mocked(listAgentWorkspaces);

const defaultForm: AgentExploreFormState = {
  query: "默认问题",
  modelAlias: "agent-model",
  contextProfileId: "context-128k",
  thinkingMode: "auto",
  temperature: 0.3,
  maxTokens: 1800,
  maxIterations: 4,
  limit: 8,
  toolChoice: "auto",
  workspaceId: "",
};

function createSession(overrides: Partial<AgentExploreSession> = {}) {
  return {
    runId: "run-1",
    workspaceId: "workspace-1",
    query: "Explain the policy",
    modelAlias: "agent-model",
    contextProfileId: "context-128k",
    thinkingMode: "balanced",
    temperature: 0.7,
    maxTokens: 2048,
    maxIterations: 3,
    limit: 6,
    toolChoice: "auto",
    status: "completed",
    answerPreview: "Answer preview",
    updatedAt: "2026-06-04T10:00:00.000Z",
    ...overrides,
  } as AgentExploreSession;
}

function createPersistedPayload(overrides: Record<string, unknown>) {
  return {
    version: AGENT_EXPLORE_STORAGE_VERSION,
    payload: {
      form: {
        ...defaultForm,
      },
      draftTabs: [],
      history: [],
      activeTabId: "",
      activeRunId: "",
      activeWorkspaceId: "",
      hiddenRunIds: [],
      closedTabIds: [],
      ...overrides,
    },
  };
}

function setPersistedState(payload: Record<string, unknown>) {
  window.localStorage.setItem(AGENT_EXPLORE_STORAGE_KEY, JSON.stringify(payload));
}

function createHarness(overrides: {
  activeTabId?: string;
  history?: AgentExploreSession[];
  draftTabs?: AgentExploreSession[];
  closedTabIds?: string[];
  hiddenRunIds?: string[];
  hydrated?: boolean;
  busy?: string;
  contextProfileId?: string;
  thinkingMode?: string;
  form?: Partial<AgentExploreFormState>;
  result?: AgentExploreRunResponse | null;
} = {}) {
  const agentExploreActiveTabId = ref(overrides.activeTabId || "draft:active");
  const agentExploreClosedTabIds = ref(new Set(overrides.closedTabIds || []));
  const agentExploreDraftTabs = ref(overrides.draftTabs || []);
  const agentExploreHistory = ref(overrides.history || []);
  const agentExploreHiddenRunIds = ref(new Set(overrides.hiddenRunIds || []));
  const agentExploreForm = ref<AgentExploreFormState>({
    ...defaultForm,
    ...(overrides.form || {}),
  });
  const agentExploreResult = ref<AgentExploreRunResponse | null>(overrides.result ?? null);
  const agentExploreHydrated = ref(overrides.hydrated ?? true);
  const agentExploreTraceOpen = ref(false);
  const busy = ref(overrides.busy || "");
  const busyKey = computed(() => busy.value);
  const createAgentExploreDraftTab = vi.fn((seed: Partial<AgentExploreSession>) => ({
    runId: "draft:generated",
    workspaceId: "",
    query: seed.query || agentExploreForm.value.query,
    modelAlias: seed.modelAlias || agentExploreForm.value.modelAlias,
    contextProfileId: String(seed.contextProfileId || selectedAgentExploreContextProfile.value.value),
    thinkingMode: String(seed.thinkingMode || selectedAgentExploreThinkingMode.value),
    temperature: Number(seed.temperature ?? agentExploreForm.value.temperature),
    maxTokens: Number(seed.maxTokens ?? agentExploreForm.value.maxTokens),
    maxIterations: Number(seed.maxIterations ?? defaultForm.maxIterations),
    limit: Number(seed.limit ?? defaultForm.limit),
    toolChoice: String(seed.toolChoice || agentExploreForm.value.toolChoice),
    status: "draft",
    answerPreview: "",
    updatedAt: new Date().toISOString(),
    ...seed,
  }));
  const applyAgentExploreDraftTab = vi.fn((session: AgentExploreSession) => {
    agentExploreActiveTabId.value = session.runId;
    agentExploreTraceOpen.value = true;
  });
  const loadAgentExploreSession = vi.fn(async (session: AgentExploreSession) => {
    expect(session).toBeTruthy();
  });
  const switchAgentExploreTab = vi.fn(async (session: AgentExploreSession) => {
    agentExploreActiveTabId.value = session.runId;
  });
  const agentExploreSessionFromResult = vi.fn(
    (result: AgentExploreRunResponse | null, fallback: Partial<AgentExploreSession> = {}) => {
      if (!result?.run?.runId || !result?.workspace?.workspaceId) {
        return null;
      }
      return {
        runId: String(result.run.runId),
        workspaceId: String(result.workspace.workspaceId),
        query: String(result.run.input?.query || fallback.query || ""),
        modelAlias: String(result.run.input?.modelAlias || fallback.modelAlias || ""),
        contextProfileId: String(
          result.run.input?.contextProfileId || fallback.contextProfileId || defaultForm.contextProfileId,
        ),
        thinkingMode: "balanced",
        temperature: Number(result.run.input?.temperature ?? fallback.temperature ?? defaultForm.temperature),
        maxTokens: Number(result.run.input?.maxTokens ?? fallback.maxTokens ?? defaultForm.maxTokens),
        maxIterations: Number(result.run.input?.maxIterations ?? fallback.maxIterations ?? defaultForm.maxIterations),
        limit: Number(result.run.input?.limit ?? fallback.limit ?? defaultForm.limit),
        toolChoice: String(result.run.input?.toolChoice || fallback.toolChoice || defaultForm.toolChoice),
        status: result.run.status || "completed",
        answerPreview: String(result.answer || fallback.answerPreview || ""),
        updatedAt: String(result.run.updatedAt || result.run.completedAt || new Date().toISOString()),
      } as AgentExploreSession;
    },
  );
  const selectedAgentExploreContextProfile = computed(() => ({ value: overrides.contextProfileId || "context-128k" }));
  const selectedAgentExploreThinkingMode = computed(() => overrides.thinkingMode || "balanced");

  const controller = createConsoleAgentExploreHistoryController({
    agentExploreActiveTabId,
    agentExploreClosedTabIds,
    agentExploreDraftTabs,
    agentExploreForm,
    agentExploreHiddenRunIds,
    agentExploreHistory,
    agentExploreHydrated,
    agentExploreResult,
    agentExploreDefaults: () => ({
      temperature: 0.2,
      maxTokens: 1800,
      maxIterations: 4,
      limit: 8,
      toolChoice: "auto",
    }),
    agentExploreSessionFromResult,
    applyAgentExploreDraftTab,
    busyKey,
    createAgentExploreDraftTab,
    hasAgentModelOption: (value?: string) => ["agent-model", "fallback-model"].includes(String(value || "")),
    loadAgentExploreSession,
    normalizeThinkingMode: (value?: string) => String(value || "default").trim() || "default",
    selectedAgentExploreContextProfile,
    selectedAgentExploreThinkingMode,
    switchAgentExploreTab,
    validAgentModelAlias: (value?: string) => String(value || "") === "agent-model" ? "agent-model" : "",
  });

  return {
    applyAgentExploreDraftTab,
    agentExploreActiveTabId,
    agentExploreClosedTabIds,
    agentExploreDraftTabs,
    agentExploreForm,
    agentExploreHistory,
    agentExploreHiddenRunIds,
    agentExploreHydrated,
    agentExploreResult,
    busy,
    controller,
    createAgentExploreDraftTab,
    loadAgentExploreSession,
    getAgentWorkspace: mockedGetAgentWorkspace,
    listAgentWorkspaces: mockedListAgentWorkspaces,
    selectedAgentExploreContextProfile,
    selectedAgentExploreThinkingMode,
    switchAgentExploreTab,
    agentExploreSessionFromResult,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("console agent explore history controller extra coverage", () => {
  it("builds panel items from loaded history and marks busy/active rows", () => {
    const history = [
      createSession({ runId: "run-a", status: "completed", answerPreview: "Answer A", updatedAt: "" }),
      createSession({ runId: "run-b", status: "running", updatedAt: "" }),
    ];
    const harness = createHarness({
      activeTabId: "run-a",
      busy: "knowledge:agent-explore:load:run-a",
      history,
    });

    expect(harness.controller.agentExploreSessionLabel(history[0])).toBe("未记录 · Explain the policy");

    const items = harness.controller.agentExploreHistoryPanelItems.value;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "run-a",
      active: true,
      disabled: true,
      deleteLabel: `删除历史会话 ${harness.controller.agentExploreSessionLabel(history[0])}`,
    });
    expect(items[1]).toMatchObject({
      id: "run-b",
      active: false,
      disabled: false,
    });
  });

  it("marks a session as busy when its load key matches the busy state", () => {
    const session = createSession({ runId: "run-b" });
    const harness = createHarness({
      busy: "knowledge:agent-explore:load:run-b",
      history: [session],
    });

    expect(harness.controller.agentExploreTabBusy(session)).toBe(true);
    expect(harness.controller.agentExploreTabBusy(createSession({ runId: "run-c" }))).toBe(false);
  });

  it("cleans invalid model references in drafts/history and persists when changes occur", () => {
    const harness = createHarness({
      draftTabs: [
        createSession({
          runId: "draft-invalid",
          workspaceId: "",
          status: "draft",
          modelAlias: "deprecated-model",
        }),
      ],
      history: [
        createSession({
          runId: "run-invalid",
          modelAlias: "deprecated-model",
        }),
      ],
    });

    expect(window.localStorage.getItem(AGENT_EXPLORE_STORAGE_KEY)).toBeNull();
    harness.controller.clearInvalidAgentExploreModelReferences();

    expect(harness.agentExploreDraftTabs.value[0]).toMatchObject({ modelAlias: "" });
    expect(harness.agentExploreHistory.value[0]).toMatchObject({ modelAlias: "" });
    expect(window.localStorage.getItem(AGENT_EXPLORE_STORAGE_KEY)).not.toBeNull();
  });

  it("does not persist when model references are already valid", () => {
    const harness = createHarness({
      draftTabs: [
        createSession({
          runId: "draft-valid",
          workspaceId: "",
          status: "draft",
          modelAlias: "agent-model",
        }),
      ],
      history: [createSession({ runId: "run-valid", modelAlias: "agent-model" })],
    });

    harness.controller.clearInvalidAgentExploreModelReferences();

    expect(window.localStorage.getItem(AGENT_EXPLORE_STORAGE_KEY)).toBeNull();
  });

  it("loads server history and normalizes it into candidate history sessions", async () => {
    mockedListAgentWorkspaces.mockResolvedValueOnce({
      count: 2,
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
      ],
    });
    mockedGetAgentWorkspace.mockResolvedValueOnce({
      workspace: {
        workspaceId: "workspace-a",
      },
      runs: [
        {
          runId: "run-a",
          runType: "knowledge_agent_exploration",
          status: "completed",
          input: {
            query: "History from server",
            modelAlias: "missing-model",
          },
          workspaceId: "workspace-a",
          updatedAt: "2026-06-04T11:00:00.000Z",
          coverage: { answer: "Session answer" },
        },
        {
          runId: "run-b",
          runType: "other",
          updatedAt: "2026-06-04T12:00:00.000Z",
        },
      ],
    });
    const harness = createHarness();

    const sessions = await harness.controller.loadAgentExploreHistoryFromServer();

    expect(harness.listAgentWorkspaces).toHaveBeenCalledWith({
      limit: 30,
      includeSummary: false,
    });
    expect(harness.getAgentWorkspace).toHaveBeenCalledWith("workspace-a");
    expect(harness.getAgentWorkspace).toHaveBeenCalledTimes(1);
    expect(sessions.map((session) => session.runId)).toEqual(["run-a"]);
    expect(sessions[0]).toMatchObject({
      runId: "run-a",
      modelAlias: "",
      thinkingMode: "auto",
      answerPreview: "Session answer",
    });
  });

  it("returns empty history when workspace list loads fails", async () => {
    mockedListAgentWorkspaces.mockRejectedValueOnce(new Error("load failure"));
    const harness = createHarness();

    const sessions = await harness.controller.loadAgentExploreHistoryFromServer();

    expect(sessions).toEqual([]);
    expect(harness.getAgentWorkspace).not.toHaveBeenCalled();
  });

  it("selects existing history items only and ignores unknown run id", () => {
    const history = [createSession({ runId: "run-a" }), createSession({ runId: "run-b" })];
    const harness = createHarness({ history });

    harness.controller.selectAgentExploreHistoryItem("run-b");
    expect(harness.switchAgentExploreTab).toHaveBeenCalledTimes(1);
    expect(harness.switchAgentExploreTab).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-b" }));

    harness.controller.selectAgentExploreHistoryItem("run-missing");
    expect(harness.switchAgentExploreTab).toHaveBeenCalledTimes(1);
  });

  it("restores persisted draft as active when activeTabId refers to draft", async () => {
    setPersistedState(
      createPersistedPayload({
        activeTabId: "draft:persisted",
        draftTabs: [
          createSession({
            runId: "draft:persisted",
            workspaceId: "",
            status: "draft",
            query: "Persisted draft",
            updatedAt: "2026-06-04T09:00:00.000Z",
          }),
        ],
        history: [createSession({ runId: "run-old" })],
      }),
    );
    const harness = createHarness();

    await harness.controller.restoreAgentExploreState();

    expect(harness.agentExploreDraftTabs.value[0]).toMatchObject({
      runId: "draft:persisted",
      query: "Persisted draft",
    });
    expect(harness.agentExploreForm.value.query).toBe("默认问题");
    expect(harness.agentExploreHiddenRunIds.value).toEqual(new Set());
  });

  it("restores active run session from history and forwards it to loader when draft is absent", async () => {
    const persistedSession = createSession({
      runId: "run-loaded",
      workspaceId: "workspace-load",
      query: "Persisted active",
      status: "completed",
    });
    setPersistedState(
      createPersistedPayload({
        activeTabId: "run-loaded",
        activeWorkspaceId: "workspace-load",
        history: [persistedSession],
      }),
    );
    const harness = createHarness({ form: { workspaceId: "" } });

    await harness.controller.restoreAgentExploreState();

    expect(harness.loadAgentExploreSession).toHaveBeenCalledTimes(1);
    expect(harness.loadAgentExploreSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-loaded",
        workspaceId: "workspace-load",
      }),
    );
  });

  it("refreshes history from server when no persisted history exists and creates draft if still empty", async () => {
    mockedListAgentWorkspaces.mockResolvedValueOnce({
      count: 1,
      workspaces: [{ workspaceId: "workspace-empty", metadata: { createdBy: "knowledge.agent-explore" } }],
    });
    mockedGetAgentWorkspace.mockResolvedValueOnce({
      workspace: { workspaceId: "workspace-empty" },
      runs: [],
    });
    setPersistedState(
      createPersistedPayload({
        activeTabId: "run-missing",
        form: {
          ...defaultForm,
          query: "Refresh query",
        },
      }),
    );
    const harness = createHarness({
      history: [],
      draftTabs: [],
    });

    await harness.controller.restoreAgentExploreState();

    expect(harness.listAgentWorkspaces).toHaveBeenCalledWith({
      limit: 30,
      includeSummary: false,
    });
    expect(harness.createAgentExploreDraftTab).toHaveBeenCalledTimes(1);
    expect(harness.createAgentExploreDraftTab).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Refresh query",
        modelAlias: "agent-model",
      }),
    );
    expect(harness.agentExploreActiveTabId.value).toBe("draft:generated");
    expect(harness.switchAgentExploreTab).not.toHaveBeenCalled();
  });

  it("falls back to first visible tab when active tab is closed during restore", async () => {
    setPersistedState(
      createPersistedPayload({
        activeTabId: "run-a",
        activeRunId: "run-a",
        closedTabIds: ["run-a", "draft-hidden"],
        draftTabs: [
          createSession({
            runId: "draft-hidden",
            status: "draft",
            workspaceId: "",
            query: "Hidden draft",
            updatedAt: "2026-06-04T08:00:00.000Z",
          }),
        ],
        history: [
          createSession({ runId: "run-a", workspaceId: "workspace-a", updatedAt: "2026-06-04T09:00:00.000Z" }),
          createSession({ runId: "run-b", workspaceId: "workspace-b", updatedAt: "2026-06-04T11:00:00.000Z" }),
        ],
      }),
    );
    const harness = createHarness({
      draftTabs: [],
      history: [],
    });

    await harness.controller.restoreAgentExploreState();

    expect(harness.loadAgentExploreSession).not.toHaveBeenCalled();
    expect(harness.switchAgentExploreTab).toHaveBeenCalledTimes(1);
    expect(harness.switchAgentExploreTab).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-b" }),
    );
    expect(harness.agentExploreActiveTabId.value).toBe("run-b");
  });

  it("syncs draft fields with selected context and thinking parameters when using state core helper", () => {
    const draftTabs = [
      createSession({
        runId: "draft:active",
        status: "draft",
        query: "old",
        contextProfileId: "context-old",
        thinkingMode: "default",
      }),
    ];
    const form = ref({
      query: "current query",
      modelAlias: "agent-model",
      contextProfileId: "context-128k",
      thinkingMode: "auto",
      temperature: 1.1,
      maxTokens: 1024,
      maxIterations: 7,
      limit: 12,
      toolChoice: "required",
      workspaceId: "",
    } as AgentExploreFormState);
    const synced = syncActiveAgentExploreDraftFromFormCore({
      activeTabId: "draft:active",
      draftTabs,
      form: form.value,
      contextProfileId: "context-32k",
      thinkingMode: "deep",
      normalizeHistory: (sessions) => sessions,
    });

    expect(synced[0]).toMatchObject({
      query: "current query",
      modelAlias: "agent-model",
      contextProfileId: "context-32k",
      thinkingMode: "deep",
      temperature: 1.1,
      maxTokens: 1024,
      maxIterations: 7,
      limit: 12,
      toolChoice: "required",
    });
  });

  it("persists state only when hydrated and records latest active session", async () => {
    const persistedSession = createSession({
      runId: "result-run",
      workspaceId: "workspace-result",
      query: "Result query",
      status: "completed",
      answerPreview: "Result answer",
    });
    const harness = createHarness({ hydrated: true });
    harness.agentExploreResult.value = {
      protocolVersion: "1",
      ok: true,
      workspace: {
        workspaceId: "workspace-result",
      },
      run: {
        runId: "result-run",
        workspaceId: "workspace-result",
        status: "completed",
        input: {
          query: "Result query",
          modelAlias: "agent-model",
          contextProfileId: "context-128k",
          thinkingMode: "balanced",
          temperature: 0.9,
          maxTokens: 4096,
          maxIterations: 6,
          limit: 10,
          toolChoice: "auto",
        },
        updatedAt: "2026-06-04T12:00:00.000Z",
      },
      answer: "Result answer",
      steps: [],
      evidenceRefs: [],
      toolResults: [],
    };
    harness.agentExploreSessionFromResult.mockReturnValueOnce(persistedSession);
    await harness.controller.persistAgentExploreState();

    expect(harness.agentExploreHistory.value.map((item) => item.runId)).toContain("result-run");
    const payloadRaw = window.localStorage.getItem(AGENT_EXPLORE_STORAGE_KEY);
    expect(payloadRaw).not.toBeNull();
    const parsed = JSON.parse(payloadRaw || "{}");
    expect(parsed).toMatchObject({
      version: AGENT_EXPLORE_STORAGE_VERSION,
      payload: {
        activeRunId: "result-run",
      },
    });

    const blockedHydrateHarness = createHarness({ hydrated: false });
    await blockedHydrateHarness.controller.persistAgentExploreState();
    expect(window.localStorage.getItem(AGENT_EXPLORE_STORAGE_KEY)).toBe(payloadRaw);
  });
});
