import type { AgentExploreRunResponse } from "../lib/types";
import type { AgentExploreSession } from "../types/app";
import { asRecord } from "./console-model-utils";
import type { AgentExploreFormState } from "./console-agent-explore-form-types";
import { isAgentExploreDraftSession } from "./console-agent-explore-session-utils";

export function clearInvalidAgentExploreModelReferencesCore(
  options: {
    draftTabs: AgentExploreSession[];
    history: AgentExploreSession[];
    result: AgentExploreRunResponse | null;
    hasAgentModelOption: (value?: string) => boolean;
    sanitizeSession: (session: AgentExploreSession) => AgentExploreSession;
  },
) {
  let changed = false;
  const sanitizeList = (sessions: AgentExploreSession[]) =>
    sessions.map((session) => {
      const sanitized = options.sanitizeSession(session);
      if (sanitized.modelAlias !== session.modelAlias) {
        changed = true;
      }
      return sanitized;
    });
  const activeSession = asRecord(options.result?.run);
  const activeInput = asRecord(activeSession?.input);
  if (activeInput?.modelAlias && !options.hasAgentModelOption(String(activeInput.modelAlias))) {
    activeInput.modelAlias = "";
  }
  return {
    draftTabs: sanitizeList(options.draftTabs),
    history: sanitizeList(options.history),
    changed,
  };
}

export function syncActiveAgentExploreDraftFromFormCore(
  options: {
    activeTabId: string;
    draftTabs: AgentExploreSession[];
    form: AgentExploreFormState;
    contextProfileId: string;
    thinkingMode: string;
    normalizeHistory: (sessions: AgentExploreSession[]) => AgentExploreSession[];
  },
) {
  const tabId = options.activeTabId;
  if (!tabId.startsWith("draft:")) {
    return options.draftTabs;
  }
  const existing = options.draftTabs.find((item) => item.runId === tabId);
  if (!existing) {
    return options.draftTabs;
  }
  return options.normalizeHistory(
    options.draftTabs.map((item) =>
      item.runId === tabId
        ? {
            ...item,
            query: options.form.query,
            modelAlias: options.form.modelAlias,
            contextProfileId: options.contextProfileId,
            thinkingMode: options.thinkingMode,
            temperature: options.form.temperature,
            maxTokens: options.form.maxTokens,
            maxIterations: options.form.maxIterations,
            limit: options.form.limit,
            toolChoice: options.form.toolChoice,
            updatedAt: item.updatedAt,
          }
        : item,
    ),
  );
}

export function upsertAgentExploreHistoryCore(
  options: {
    session: AgentExploreSession | null;
    hiddenRunIds: Set<string>;
    draftTabs: AgentExploreSession[];
    history: AgentExploreSession[];
    normalizeHistory: (sessions: AgentExploreSession[]) => AgentExploreSession[];
  },
) {
  const session = options.session;
  if (!session || options.hiddenRunIds.has(session.runId)) {
    return {
      draftTabs: options.draftTabs,
      history: options.history,
      changed: false,
    };
  }
  if (isAgentExploreDraftSession(session)) {
    return {
      draftTabs: options.normalizeHistory([
        session,
        ...options.draftTabs.filter((item) => item.runId !== session.runId),
      ]),
      history: options.history,
      changed: true,
    };
  }
  const existingIndex = options.history.findIndex((item) => item.runId === session.runId);
  const nextHistory =
    existingIndex >= 0
      ? options.history.map((item, index) => (index === existingIndex ? session : item))
      : [session, ...options.history];
  return {
    draftTabs: options.draftTabs,
    history: options.normalizeHistory(nextHistory),
    changed: true,
  };
}

export function removeAgentExploreSessionStateCore(
  options: {
    session: AgentExploreSession;
    hiddenRunIds: Set<string>;
    closedTabIds: Set<string>;
    draftTabs: AgentExploreSession[];
    history: AgentExploreSession[];
    normalizeHistory: (sessions: AgentExploreSession[]) => AgentExploreSession[];
  },
) {
  const runId = String(options.session.runId || "").trim();
  return {
    runId,
    hiddenRunIds: runId
      ? new Set([...options.hiddenRunIds, runId])
      : options.hiddenRunIds,
    closedTabIds: new Set(
      [...options.closedTabIds].filter((item) => item !== runId),
    ),
    draftTabs: options.normalizeHistory(
      options.draftTabs.filter((item) => item.runId !== runId),
    ),
    history: options.normalizeHistory(
      options.history.filter((item) => item.runId !== runId),
    ),
  };
}

export function closeAgentExploreTabStateCore(
  options: {
    session: AgentExploreSession;
    closedTabIds: Set<string>;
    draftTabs: AgentExploreSession[];
    normalizeHistory: (sessions: AgentExploreSession[]) => AgentExploreSession[];
  },
) {
  const runId = String(options.session.runId || "").trim();
  if (!runId) {
    return {
      runId,
      closedTabIds: options.closedTabIds,
      draftTabs: options.draftTabs,
    };
  }
  return {
    runId,
    closedTabIds: isAgentExploreDraftSession(options.session)
      ? options.closedTabIds
      : new Set([...options.closedTabIds, runId]),
    draftTabs: isAgentExploreDraftSession(options.session)
      ? options.normalizeHistory(
          options.draftTabs.filter((item) => item.runId !== runId),
        )
      : options.draftTabs,
  };
}
