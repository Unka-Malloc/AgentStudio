import type { ComputedRef, Ref } from "vue";
import {
  getKnowledgeAgentExploreRun,
  runKnowledgeAgentExplore as runKnowledgeAgentExploreApi,
} from "../lib/agent-explore-client";
import type { AgentExploreRunResponse } from "../lib/types";
import type {
  AgentExploreSession,
  AppView,
  DebugTab,
} from "../types/app";
import { asRecord } from "./console-model-utils";
import { createConsoleAgentExploreHistoryController } from "./console-agent-explore-history-controller";
import { createConsoleAgentExplorePollingController } from "./console-agent-explore-polling-controller";
import { createConsoleAgentExploreTabController } from "./console-agent-explore-tab-controller";
import {
  agentExploreFormFromSession,
  agentExploreRunStatus,
  agentExploreSessionFromResultCore,
  createAgentExploreDraftSession,
  isAgentExploreDraftSession,
  normalizeAgentExploreRun,
  type AgentExploreFormDefaults,
  type AgentExploreFormState,
} from "./console-agent-explore-utils";

type AgentExploreContextProfile = {
  value: string;
};

type AgentExploreModelOption = {
  value: string;
  enabled: boolean;
};

type ConsoleAgentExploreSessionControllerOptions = {
  agentExploreActiveTabId: Ref<string>;
  agentExploreClosedTabIds: Ref<Set<string>>;
  agentExploreDraftTabs: Ref<AgentExploreSession[]>;
  agentExploreForm: Ref<AgentExploreFormState>;
  agentExploreHiddenRunIds: Ref<Set<string>>;
  agentExploreHistory: Ref<AgentExploreSession[]>;
  agentExploreHydrated: Ref<boolean>;
  agentExploreResult: Ref<AgentExploreRunResponse | null>;
  agentExploreTraceOpen: Ref<boolean>;
  busyKey: ComputedRef<string>;
  canReadKnowledge: ComputedRef<boolean>;
  clearAllBusy: () => void;
  currentView: Ref<AppView>;
  debugTab: Ref<DebugTab>;
  error: Ref<string>;
  hasAgentModelOption: (value?: string) => boolean;
  selectedAgentExploreContextProfile: ComputedRef<AgentExploreContextProfile>;
  selectedAgentExploreModel: ComputedRef<AgentExploreModelOption>;
  selectedAgentExploreThinkingMode: ComputedRef<string>;
  setBusy: (key: string) => void;
  validAgentModelAlias: (value?: string) => string;
  agentExploreDefaults: () => AgentExploreFormDefaults;
  normalizeThinkingMode: (value?: string) => string;
};

export function createConsoleAgentExploreSessionController(options: ConsoleAgentExploreSessionControllerOptions) {
  function boundedAgentExploreNumber(value: unknown, fallback: number, min: number, max: number) {
    const next = Number(value);
    return Math.max(min, Math.min(Number.isFinite(next) ? next : fallback, max));
  }

  function agentExploreSessionFromResult(
    result: AgentExploreRunResponse | null,
    fallback: Partial<AgentExploreSession> = {},
  ): AgentExploreSession | null {
    return agentExploreSessionFromResultCore(result, {
      fallback,
      currentForm: options.agentExploreForm.value,
      normalizeThinkingMode: options.normalizeThinkingMode,
    });
  }

  function createAgentExploreDraftTab(seed: Partial<AgentExploreSession> = {}): AgentExploreSession {
    return createAgentExploreDraftSession({
      form: options.agentExploreForm.value,
      contextProfileId: options.selectedAgentExploreContextProfile.value.value,
      thinkingMode: options.selectedAgentExploreThinkingMode.value,
      defaults: options.agentExploreDefaults(),
      seed,
    });
  }

  const {
    agentExploreHistoryPanelItems,
    agentExploreSessionLabel,
    agentExploreTabBusy,
    agentExploreTabs,
    clearInvalidAgentExploreModelReferences,
    loadAgentExploreHistoryFromServer,
    normalizeAgentExploreHistoryList,
    persistAgentExploreState,
    restoreAgentExploreState,
    sanitizeAgentExploreSessionModelReference,
    selectAgentExploreHistoryItem,
    syncActiveAgentExploreDraftFromForm,
    upsertAgentExploreHistory,
  } = createConsoleAgentExploreHistoryController({
    agentExploreActiveTabId: options.agentExploreActiveTabId,
    agentExploreClosedTabIds: options.agentExploreClosedTabIds,
    agentExploreDraftTabs: options.agentExploreDraftTabs,
    agentExploreForm: options.agentExploreForm,
    agentExploreHiddenRunIds: options.agentExploreHiddenRunIds,
    agentExploreHistory: options.agentExploreHistory,
    agentExploreHydrated: options.agentExploreHydrated,
    agentExploreResult: options.agentExploreResult,
    agentExploreDefaults: options.agentExploreDefaults,
    agentExploreSessionFromResult,
    applyAgentExploreDraftTab,
    busyKey: options.busyKey,
    createAgentExploreDraftTab,
    hasAgentModelOption: options.hasAgentModelOption,
    loadAgentExploreSession,
    normalizeThinkingMode: options.normalizeThinkingMode,
    selectedAgentExploreContextProfile: options.selectedAgentExploreContextProfile,
    selectedAgentExploreThinkingMode: options.selectedAgentExploreThinkingMode,
    switchAgentExploreTab,
    validAgentModelAlias: options.validAgentModelAlias,
  });

  const {
    currentAgentExplorePollTimer,
    startAgentExplorePolling,
    stopAgentExplorePolling,
  } = createConsoleAgentExplorePollingController({
    agentExploreResult: options.agentExploreResult,
    busyKey: options.busyKey,
    clearAllBusy: options.clearAllBusy,
    error: options.error,
    persistAgentExploreState,
  });

  function applyAgentExploreDraftTab(session: AgentExploreSession) {
    stopAgentExplorePolling();
    options.agentExploreTraceOpen.value = true;
    options.agentExploreActiveTabId.value = session.runId;
    options.agentExploreResult.value = null;
    options.agentExploreForm.value = agentExploreFormFromSession(session, {
      currentForm: options.agentExploreForm.value,
      defaults: options.agentExploreDefaults(),
      hasAgentModelOption: options.hasAgentModelOption,
      normalizeThinkingMode: options.normalizeThinkingMode,
      preferCurrentLimits: false,
      workspaceId: "",
    });
    if (options.busyKey.value === "knowledge:agent-explore") {
      options.clearAllBusy();
    }
    persistAgentExploreState();
  }

  async function switchAgentExploreTab(session: AgentExploreSession) {
    if (options.agentExploreClosedTabIds.value.has(session.runId)) {
      options.agentExploreClosedTabIds.value = new Set(
        [...options.agentExploreClosedTabIds.value].filter((item) => item !== session.runId),
      );
    }
    if (isAgentExploreDraftSession(session)) {
      applyAgentExploreDraftTab(session);
      return;
    }
    options.agentExploreActiveTabId.value = session.runId;
    await loadAgentExploreSession(session);
  }

  async function loadAgentExploreSession(session: AgentExploreSession) {
    stopAgentExplorePolling();
    options.agentExploreTraceOpen.value = true;
    options.setBusy(`knowledge:agent-explore:load:${session.runId}`);
    options.error.value = "";
    options.agentExploreActiveTabId.value = session.runId;
    try {
      options.agentExploreForm.value = agentExploreFormFromSession(session, {
        currentForm: options.agentExploreForm.value,
        defaults: options.agentExploreDefaults(),
        hasAgentModelOption: options.hasAgentModelOption,
        normalizeThinkingMode: options.normalizeThinkingMode,
      });
      const result = normalizeAgentExploreRun(
        await getKnowledgeAgentExploreRun(session.runId, {
          workspaceId: session.workspaceId,
        }),
      );
      options.agentExploreResult.value = result;
      upsertAgentExploreHistory(agentExploreSessionFromResult(result, session));
      if (["queued", "running"].includes(agentExploreRunStatus(result))) {
        startAgentExplorePolling(session.runId, session.workspaceId);
      }
      persistAgentExploreState();
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "恢复智能检索会话失败。";
    } finally {
      if (options.busyKey.value === `knowledge:agent-explore:load:${session.runId}`) {
        options.clearAllBusy();
      }
    }
  }

  async function runKnowledgeAgentExplore() {
    const query = options.agentExploreForm.value.query.trim();
    if (!query) {
      options.error.value = "请输入智能检索问题。";
      return;
    }
    if (!options.canReadKnowledge.value) {
      options.error.value = "当前账号没有知识库读取权限。";
      return;
    }
    if (!options.selectedAgentExploreModel.value.enabled) {
      options.error.value = "请选择模型库中已配置且支持智能检索工具调用的模型。";
      return;
    }
    const defaults = options.agentExploreDefaults();
    const maxIterations = boundedAgentExploreNumber(
      options.agentExploreForm.value.maxIterations,
      defaults.maxIterations,
      1,
      8,
    );
    const limit = boundedAgentExploreNumber(
      options.agentExploreForm.value.limit,
      defaults.limit,
      1,
      20,
    );
    const temperature = boundedAgentExploreNumber(
      options.agentExploreForm.value.temperature,
      defaults.temperature,
      0,
      2,
    );
    const maxTokens = boundedAgentExploreNumber(
      options.agentExploreForm.value.maxTokens,
      defaults.maxTokens,
      128,
      32000,
    );
    const toolChoice =
      String(options.agentExploreForm.value.toolChoice || defaults.toolChoice || "auto").trim() || "auto";
    options.agentExploreForm.value.maxIterations = maxIterations;
    options.agentExploreForm.value.limit = limit;
    options.agentExploreForm.value.temperature = temperature;
    options.agentExploreForm.value.maxTokens = maxTokens;
    options.agentExploreForm.value.toolChoice = toolChoice;
    options.agentExploreForm.value.contextProfileId = options.selectedAgentExploreContextProfile.value.value;
    options.agentExploreForm.value.thinkingMode = options.selectedAgentExploreThinkingMode.value;
    options.agentExploreTraceOpen.value = true;
    options.setBusy("knowledge:agent-explore");
    options.error.value = "";
    options.currentView.value = "debug";
    options.debugTab.value = "agentRetrieval";
    options.agentExploreResult.value = null;
    const draftRunId = options.agentExploreActiveTabId.value.startsWith("draft:")
      ? options.agentExploreActiveTabId.value
      : "";
    stopAgentExplorePolling();
    try {
      const result = normalizeAgentExploreRun(await runKnowledgeAgentExploreApi({
        query,
        modelAlias: options.selectedAgentExploreModel.value.value,
        contextProfileId: options.selectedAgentExploreContextProfile.value.value,
        thinkingMode: options.selectedAgentExploreThinkingMode.value,
        temperature,
        maxTokens,
        maxIterations,
        limit,
        toolChoice,
        workspaceId: options.agentExploreForm.value.workspaceId || undefined,
        async: true,
        realtime: true,
      }));
      options.agentExploreResult.value = result;
      const runId = String(asRecord(result.run)?.runId || "");
      const workspaceId = String(result.workspace?.workspaceId || "");
      if (workspaceId) {
        options.agentExploreForm.value.workspaceId = workspaceId;
      }
      if (runId) {
        options.agentExploreActiveTabId.value = runId;
        if (draftRunId) {
          options.agentExploreDraftTabs.value = normalizeAgentExploreHistoryList(
            options.agentExploreDraftTabs.value.filter((item) => item.runId !== draftRunId),
          );
        }
      }
      persistAgentExploreState();
      if (runId && workspaceId && ["queued", "running"].includes(agentExploreRunStatus(result))) {
        startAgentExplorePolling(runId, workspaceId);
        return;
      }
      if (result.ok === false && result.error) {
        options.error.value = result.error;
      }
      options.clearAllBusy();
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "智能检索失败。";
      options.clearAllBusy();
    }
  }

  const {
    closeAgentExploreTab,
    deleteAgentExploreHistoryItem,
    deleteAgentExploreHistorySession,
    resetKnowledgeAgentExplore,
  } = createConsoleAgentExploreTabController({
    agentExploreActiveTabId: options.agentExploreActiveTabId,
    agentExploreClosedTabIds: options.agentExploreClosedTabIds,
    agentExploreDraftTabs: options.agentExploreDraftTabs,
    agentExploreForm: options.agentExploreForm,
    agentExploreHiddenRunIds: options.agentExploreHiddenRunIds,
    agentExploreHistory: options.agentExploreHistory,
    agentExploreResult: options.agentExploreResult,
    agentExploreTabs,
    agentExploreTraceOpen: options.agentExploreTraceOpen,
    applyAgentExploreDraftTab,
    busyKey: options.busyKey,
    clearAllBusy: options.clearAllBusy,
    createAgentExploreDraftTab,
    normalizeAgentExploreHistoryList,
    persistAgentExploreState,
    selectedAgentExploreContextProfile: options.selectedAgentExploreContextProfile,
    selectedAgentExploreThinkingMode: options.selectedAgentExploreThinkingMode,
    stopAgentExplorePolling,
    switchAgentExploreTab,
  });

  return {
    agentExploreHistoryPanelItems,
    agentExplorePollTimer: currentAgentExplorePollTimer(),
    agentExploreSessionFromResult,
    agentExploreSessionLabel,
    agentExploreTabBusy,
    agentExploreTabs,
    applyAgentExploreDraftTab,
    clearInvalidAgentExploreModelReferences,
    closeAgentExploreTab,
    createAgentExploreDraftTab,
    deleteAgentExploreHistoryItem,
    deleteAgentExploreHistorySession,
    loadAgentExploreHistoryFromServer,
    loadAgentExploreSession,
    normalizeAgentExploreHistoryList,
    persistAgentExploreState,
    resetKnowledgeAgentExplore,
    restoreAgentExploreState,
    runKnowledgeAgentExplore,
    sanitizeAgentExploreSessionModelReference,
    selectAgentExploreHistoryItem,
    startAgentExplorePolling,
    stopAgentExplorePolling,
    switchAgentExploreTab,
    syncActiveAgentExploreDraftFromForm,
    upsertAgentExploreHistory,
  };
}
