import { computed, type ComputedRef, type Ref } from "vue";
import {
  getAgentWorkspace,
  listAgentWorkspaces,
} from "../lib/agent-explore-client";
import type { AgentExploreRunResponse } from "../lib/types";
import type { AgentExploreSession, HistorySessionPanelItem } from "../types/app";
import { formatCompactDate } from "./console-format-utils";
import { agentExploreHistoryPanelItemsCore } from "./console-agent-explore-presentation";
import {
  agentExploreFormFromPersistenceCore,
  agentExplorePersistencePayloadCore,
  readAgentExplorePersistence,
  writeAgentExplorePersistence,
} from "./console-agent-explore-persistence";
import {
  agentExploreSessionsFromWorkspaceDetailsCore,
  clearInvalidAgentExploreModelReferencesCore,
  isAgentExploreDraftSession,
  normalizeAgentExploreHistoryListCore,
  sanitizeAgentExploreSessionModelReference as sanitizeAgentExploreSessionModelReferenceCore,
  syncActiveAgentExploreDraftFromFormCore,
  upsertAgentExploreHistoryCore,
  type AgentExploreFormDefaults,
  type AgentExploreFormState,
} from "./console-agent-explore-utils";
import { asRecord } from "./console-model-utils";

type AgentExploreContextProfile = {
  value: string;
};

type ConsoleAgentExploreHistoryControllerOptions = {
  agentExploreActiveTabId: Ref<string>;
  agentExploreClosedTabIds: Ref<Set<string>>;
  agentExploreDraftTabs: Ref<AgentExploreSession[]>;
  agentExploreForm: Ref<AgentExploreFormState>;
  agentExploreHiddenRunIds: Ref<Set<string>>;
  agentExploreHistory: Ref<AgentExploreSession[]>;
  agentExploreHydrated: Ref<boolean>;
  agentExploreResult: Ref<AgentExploreRunResponse | null>;
  agentExploreDefaults: () => AgentExploreFormDefaults;
  agentExploreSessionFromResult: (
    result: AgentExploreRunResponse | null,
    fallback?: Partial<AgentExploreSession>,
  ) => AgentExploreSession | null;
  applyAgentExploreDraftTab: (session: AgentExploreSession) => void;
  busyKey: ComputedRef<string>;
  createAgentExploreDraftTab: (seed?: Partial<AgentExploreSession>) => AgentExploreSession;
  hasAgentModelOption: (value?: string) => boolean;
  loadAgentExploreSession: (session: AgentExploreSession) => Promise<void>;
  normalizeThinkingMode: (value?: string) => string;
  selectedAgentExploreContextProfile: ComputedRef<AgentExploreContextProfile>;
  selectedAgentExploreThinkingMode: ComputedRef<string>;
  switchAgentExploreTab: (session: AgentExploreSession) => Promise<void>;
  validAgentModelAlias: (value?: string) => string;
};

export function createConsoleAgentExploreHistoryController(
  options: ConsoleAgentExploreHistoryControllerOptions,
) {
  function sanitizeAgentExploreSessionModelReference(session: AgentExploreSession): AgentExploreSession {
    return sanitizeAgentExploreSessionModelReferenceCore(session, options.validAgentModelAlias);
  }

  function normalizeAgentExploreHistoryList(sessions: AgentExploreSession[]) {
    return normalizeAgentExploreHistoryListCore(sessions, {
      hiddenRunIds: options.agentExploreHiddenRunIds.value,
      validAgentModelAlias: options.validAgentModelAlias,
    });
  }

  const agentExploreTabs = computed(() =>
    normalizeAgentExploreHistoryList([
      ...options.agentExploreDraftTabs.value,
      ...options.agentExploreHistory.value,
    ]).filter((session) => !options.agentExploreClosedTabIds.value.has(session.runId)),
  );

  function clearInvalidAgentExploreModelReferences() {
    const result = clearInvalidAgentExploreModelReferencesCore({
      draftTabs: options.agentExploreDraftTabs.value,
      history: options.agentExploreHistory.value,
      result: options.agentExploreResult.value,
      hasAgentModelOption: options.hasAgentModelOption,
      sanitizeSession: sanitizeAgentExploreSessionModelReference,
    });
    options.agentExploreDraftTabs.value = result.draftTabs;
    options.agentExploreHistory.value = result.history;
    if (result.changed) {
      persistAgentExploreState();
    }
  }

  function syncActiveAgentExploreDraftFromForm() {
    options.agentExploreDraftTabs.value = syncActiveAgentExploreDraftFromFormCore({
      activeTabId: options.agentExploreActiveTabId.value,
      draftTabs: options.agentExploreDraftTabs.value,
      form: options.agentExploreForm.value,
      contextProfileId: options.selectedAgentExploreContextProfile.value.value,
      thinkingMode: options.selectedAgentExploreThinkingMode.value,
      normalizeHistory: normalizeAgentExploreHistoryList,
    });
  }

  function upsertAgentExploreHistory(session: AgentExploreSession | null) {
    const nextState = upsertAgentExploreHistoryCore({
      session,
      hiddenRunIds: options.agentExploreHiddenRunIds.value,
      draftTabs: options.agentExploreDraftTabs.value,
      history: options.agentExploreHistory.value,
      normalizeHistory: normalizeAgentExploreHistoryList,
    });
    options.agentExploreDraftTabs.value = nextState.draftTabs;
    options.agentExploreHistory.value = nextState.history;
  }

  function agentExploreTabBusy(session: AgentExploreSession) {
    return options.busyKey.value === `knowledge:agent-explore:load:${session.runId}`;
  }

  function agentExploreSessionLabel(session: AgentExploreSession) {
    const time = formatCompactDate(session.updatedAt);
    return `${time ? `${time} · ` : ""}${session.query || "未命名探索"}`;
  }

  const agentExploreHistoryPanelItems = computed<HistorySessionPanelItem[]>(() =>
    agentExploreHistoryPanelItemsCore(options.agentExploreHistory.value, {
      activeTabId: options.agentExploreActiveTabId.value,
      isBusy: agentExploreTabBusy,
      sessionLabel: agentExploreSessionLabel,
    }),
  );

  function selectAgentExploreHistoryItem(runId: string) {
    const session = options.agentExploreHistory.value.find((item) => item.runId === runId);
    if (session) {
      void options.switchAgentExploreTab(session);
    }
  }

  async function loadAgentExploreHistoryFromServer() {
    try {
      const list = await listAgentWorkspaces({
        limit: 30,
        includeSummary: false,
      });
      const workspaceIds = (list.workspaces || [])
        .filter((workspace) => {
          const metadata = asRecord(workspace.metadata) || {};
          return String(metadata.createdBy || "") === "knowledge.agent-explore";
        })
        .map((workspace) => String(workspace.workspaceId || ""))
        .filter(Boolean)
        .slice(0, 12);
      const details = await Promise.all(
        workspaceIds.map((workspaceId) =>
          getAgentWorkspace(workspaceId).catch(() => null),
        ),
      );
      const sessions = agentExploreSessionsFromWorkspaceDetailsCore(details, {
        currentForm: options.agentExploreForm.value,
        normalizeThinkingMode: options.normalizeThinkingMode,
      });
      const visibleSessions = normalizeAgentExploreHistoryList(sessions);
      if (visibleSessions.length) {
        options.agentExploreHistory.value = visibleSessions;
      }
      return visibleSessions;
    } catch {
      return [];
    }
  }

  function persistAgentExploreState() {
    if (!options.agentExploreHydrated.value) {
      return;
    }
    syncActiveAgentExploreDraftFromForm();
    const activeSession = options.agentExploreSessionFromResult(options.agentExploreResult.value);
    upsertAgentExploreHistory(activeSession);
    writeAgentExplorePersistence(
      agentExplorePersistencePayloadCore({
        activeTabId: options.agentExploreActiveTabId.value,
        activeSession,
        form: options.agentExploreForm.value,
        draftTabs: options.agentExploreDraftTabs.value,
        history: options.agentExploreHistory.value,
        hiddenRunIds: options.agentExploreHiddenRunIds.value,
        closedTabIds: options.agentExploreClosedTabIds.value,
      }),
    );
  }

  async function restoreAgentExploreState() {
    const persisted = readAgentExplorePersistence();
    const history = Array.isArray(persisted.history)
      ? (persisted.history as AgentExploreSession[]).filter((item) => item?.runId && item?.workspaceId)
      : [];
    const draftTabs = Array.isArray(persisted.draftTabs)
      ? (persisted.draftTabs as AgentExploreSession[]).filter((item) => isAgentExploreDraftSession(item))
      : [];
    options.agentExploreHiddenRunIds.value = new Set(
      Array.isArray(persisted.hiddenRunIds)
        ? persisted.hiddenRunIds.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
    );
    options.agentExploreClosedTabIds.value = new Set(
      Array.isArray(persisted.closedTabIds)
        ? persisted.closedTabIds.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
    );
    options.agentExploreDraftTabs.value = normalizeAgentExploreHistoryList(draftTabs);
    options.agentExploreHistory.value = normalizeAgentExploreHistoryList(history);
    if (!options.agentExploreHistory.value.length) {
      await loadAgentExploreHistoryFromServer();
    }
    options.agentExploreForm.value = agentExploreFormFromPersistenceCore(persisted, {
      currentForm: options.agentExploreForm.value,
      defaults: options.agentExploreDefaults(),
      hasAgentModelOption: options.hasAgentModelOption,
      normalizeThinkingMode: options.normalizeThinkingMode,
    });
    options.agentExploreHydrated.value = true;
    if (!agentExploreTabs.value.length) {
      const draft = options.createAgentExploreDraftTab({
        query: options.agentExploreForm.value.query,
        modelAlias: options.agentExploreForm.value.modelAlias,
        contextProfileId: options.agentExploreForm.value.contextProfileId,
        thinkingMode: options.agentExploreForm.value.thinkingMode,
        temperature: options.agentExploreForm.value.temperature,
        maxTokens: options.agentExploreForm.value.maxTokens,
        maxIterations: options.agentExploreForm.value.maxIterations,
        limit: options.agentExploreForm.value.limit,
        toolChoice: options.agentExploreForm.value.toolChoice,
      });
      options.agentExploreDraftTabs.value = [draft];
      options.agentExploreActiveTabId.value = draft.runId;
      persistAgentExploreState();
      return;
    }
    const latestServerSession = options.agentExploreHistory.value[0];
    const persistedActiveTabId = String(persisted.activeTabId || persisted.activeRunId || latestServerSession?.runId || "").trim();
    const activeTabId = options.agentExploreClosedTabIds.value.has(persistedActiveTabId)
      ? ""
      : persistedActiveTabId;
    const activeDraft = activeTabId
      ? options.agentExploreDraftTabs.value.find((item) => item.runId === activeTabId)
      : null;
    if (activeDraft && !options.agentExploreHiddenRunIds.value.has(activeDraft.runId)) {
      options.applyAgentExploreDraftTab(activeDraft);
      return;
    }
    const activeRunId = activeTabId;
    const activeHistorySession = activeRunId
      ? options.agentExploreHistory.value.find((item) => item.runId === activeRunId)
      : null;
    const activeWorkspaceId = String(
      persisted.activeWorkspaceId ||
        activeHistorySession?.workspaceId ||
        options.agentExploreForm.value.workspaceId ||
        latestServerSession?.workspaceId ||
        "",
    ).trim();
    if (activeRunId && activeWorkspaceId && !options.agentExploreHiddenRunIds.value.has(activeRunId)) {
      const session =
        activeHistorySession || {
          runId: activeRunId,
          workspaceId: activeWorkspaceId,
          query: options.agentExploreForm.value.query,
          modelAlias: options.agentExploreForm.value.modelAlias,
          contextProfileId: options.agentExploreForm.value.contextProfileId,
          thinkingMode: options.agentExploreForm.value.thinkingMode,
          temperature: options.agentExploreForm.value.temperature,
          maxTokens: options.agentExploreForm.value.maxTokens,
          maxIterations: options.agentExploreForm.value.maxIterations,
          limit: options.agentExploreForm.value.limit,
          toolChoice: options.agentExploreForm.value.toolChoice,
          status: "",
          answerPreview: "",
          updatedAt: new Date().toISOString(),
        };
      await options.loadAgentExploreSession(session);
      return;
    }
    if (agentExploreTabs.value[0]) {
      await options.switchAgentExploreTab(agentExploreTabs.value[0]);
      return;
    }
    persistAgentExploreState();
  }

  return {
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
  };
}
