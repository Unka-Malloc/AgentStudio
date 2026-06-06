import type { ComputedRef, Ref } from "vue";
import type { AgentExploreRunResponse } from "../lib/types";
import type { AgentExploreSession } from "../types/app";
import { asRecord } from "./console-model-utils";
import {
  closeAgentExploreTabStateCore,
  removeAgentExploreSessionStateCore,
  type AgentExploreFormState,
} from "./console-agent-explore-utils";

type AgentExploreContextProfile = {
  value: string;
};

type ConsoleAgentExploreTabControllerOptions = {
  agentExploreActiveTabId: Ref<string>;
  agentExploreClosedTabIds: Ref<Set<string>>;
  agentExploreDraftTabs: Ref<AgentExploreSession[]>;
  agentExploreForm: Ref<AgentExploreFormState>;
  agentExploreHiddenRunIds: Ref<Set<string>>;
  agentExploreHistory: Ref<AgentExploreSession[]>;
  agentExploreResult: Ref<AgentExploreRunResponse | null>;
  agentExploreTabs: ComputedRef<AgentExploreSession[]>;
  agentExploreTraceOpen: Ref<boolean>;
  applyAgentExploreDraftTab: (session: AgentExploreSession) => void;
  busyKey: ComputedRef<string>;
  clearAllBusy: () => void;
  createAgentExploreDraftTab: (seed?: Partial<AgentExploreSession>) => AgentExploreSession;
  normalizeAgentExploreHistoryList: (sessions: AgentExploreSession[]) => AgentExploreSession[];
  persistAgentExploreState: () => void;
  selectedAgentExploreContextProfile: ComputedRef<AgentExploreContextProfile>;
  selectedAgentExploreThinkingMode: ComputedRef<string>;
  stopAgentExplorePolling: () => void;
  switchAgentExploreTab: (session: AgentExploreSession) => Promise<void>;
};

export function createConsoleAgentExploreTabController(
  options: ConsoleAgentExploreTabControllerOptions,
) {
  function currentActiveRunId() {
    return String(asRecord(options.agentExploreResult.value?.run)?.runId || "");
  }

  function clearBusyForRun(runId: string) {
    if (
      options.busyKey.value === "knowledge:agent-explore" ||
      options.busyKey.value === `knowledge:agent-explore:load:${runId}`
    ) {
      options.clearAllBusy();
    }
  }

  function isActiveRun(runId: string) {
    return options.agentExploreActiveTabId.value === runId || currentActiveRunId() === runId;
  }

  function clearActiveRun(runId: string) {
    options.stopAgentExplorePolling();
    options.agentExploreResult.value = null;
    options.agentExploreForm.value.workspaceId = "";
    options.agentExploreActiveTabId.value = "";
    clearBusyForRun(runId);
  }

  function switchToNextAgentExploreTab(createFallbackDraft: boolean) {
    const nextTab = options.agentExploreTabs.value[0];
    if (nextTab) {
      void options.switchAgentExploreTab(nextTab);
      return;
    }
    if (!createFallbackDraft) {
      return;
    }
    const draft = options.createAgentExploreDraftTab({
      modelAlias: options.agentExploreForm.value.modelAlias,
      contextProfileId: options.agentExploreForm.value.contextProfileId,
    });
    options.agentExploreDraftTabs.value = [draft];
    options.applyAgentExploreDraftTab(draft);
  }

  function deleteAgentExploreHistorySession(session: AgentExploreSession) {
    const nextState = removeAgentExploreSessionStateCore({
      session,
      hiddenRunIds: options.agentExploreHiddenRunIds.value,
      closedTabIds: options.agentExploreClosedTabIds.value,
      draftTabs: options.agentExploreDraftTabs.value,
      history: options.agentExploreHistory.value,
      normalizeHistory: options.normalizeAgentExploreHistoryList,
    });
    const runId = nextState.runId;
    if (!runId) {
      return;
    }
    options.agentExploreHiddenRunIds.value = nextState.hiddenRunIds;
    options.agentExploreClosedTabIds.value = nextState.closedTabIds;
    options.agentExploreDraftTabs.value = nextState.draftTabs;
    options.agentExploreHistory.value = nextState.history;
    if (isActiveRun(runId)) {
      clearActiveRun(runId);
      switchToNextAgentExploreTab(false);
    }
    options.persistAgentExploreState();
  }

  function deleteAgentExploreHistoryItem(runId: string) {
    const session = options.agentExploreHistory.value.find((item) => item.runId === runId);
    if (session) {
      deleteAgentExploreHistorySession(session);
    }
  }

  function closeAgentExploreTab(session: AgentExploreSession) {
    const nextState = closeAgentExploreTabStateCore({
      session,
      closedTabIds: options.agentExploreClosedTabIds.value,
      draftTabs: options.agentExploreDraftTabs.value,
      normalizeHistory: options.normalizeAgentExploreHistoryList,
    });
    const runId = nextState.runId;
    if (!runId) {
      return;
    }
    const wasActive = isActiveRun(runId);
    options.agentExploreClosedTabIds.value = nextState.closedTabIds;
    options.agentExploreDraftTabs.value = nextState.draftTabs;

    if (wasActive) {
      clearActiveRun(runId);
      switchToNextAgentExploreTab(true);
    }
    options.persistAgentExploreState();
  }

  function resetKnowledgeAgentExplore() {
    options.stopAgentExplorePolling();
    options.agentExploreTraceOpen.value = true;
    const draft = options.createAgentExploreDraftTab({
      modelAlias: options.agentExploreForm.value.modelAlias,
      contextProfileId: options.selectedAgentExploreContextProfile.value.value,
      thinkingMode: options.selectedAgentExploreThinkingMode.value,
      temperature: options.agentExploreForm.value.temperature,
      maxTokens: options.agentExploreForm.value.maxTokens,
      maxIterations: options.agentExploreForm.value.maxIterations,
      limit: options.agentExploreForm.value.limit,
      toolChoice: options.agentExploreForm.value.toolChoice,
    });
    options.agentExploreDraftTabs.value = options.normalizeAgentExploreHistoryList([
      draft,
      ...options.agentExploreDraftTabs.value,
    ]);
    options.agentExploreActiveTabId.value = draft.runId;
    options.agentExploreResult.value = null;
    options.agentExploreForm.value = {
      query: "",
      modelAlias: draft.modelAlias,
      contextProfileId: draft.contextProfileId,
      thinkingMode: draft.thinkingMode,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      maxIterations: draft.maxIterations,
      limit: draft.limit,
      toolChoice: draft.toolChoice,
      workspaceId: "",
    };
    options.persistAgentExploreState();
    if (options.busyKey.value === "knowledge:agent-explore") {
      options.clearAllBusy();
    }
  }

  return {
    closeAgentExploreTab,
    deleteAgentExploreHistoryItem,
    deleteAgentExploreHistorySession,
    resetKnowledgeAgentExplore,
  };
}
