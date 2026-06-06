import {
  type BrowserStorageLike,
  readBrowserJsonStorage,
  writeBrowserJsonStorage,
} from "../lib/browser-storage";
import type { AgentExploreSession } from "../types/app";
import type {
  AgentExploreFormDefaults,
  AgentExploreFormState,
} from "./console-agent-explore-utils";
import { asRecord } from "./console-model-utils";

export const AGENT_EXPLORE_STORAGE_KEY = "pact.agentExplore.sessions.v1";
export const AGENT_EXPLORE_STORAGE_VERSION = 1;

const AGENT_EXPLORE_CACHE_ID_LIMIT = 100;

function boundedStorageIdList(values: Iterable<unknown>, limit = AGENT_EXPLORE_CACHE_ID_LIMIT) {
  return Array.from(values)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(-limit);
}

export function readAgentExplorePersistence(
  storageKey = AGENT_EXPLORE_STORAGE_KEY,
  storage?: BrowserStorageLike,
) {
  return readBrowserJsonStorage<Record<string, unknown>>(
    storageKey,
    {},
    (value) => {
      const record = asRecord(value);
      if (!record) {
        return null;
      }
      const payload = asRecord(record.payload);
      if ("version" in record) {
        return Number(record.version) === AGENT_EXPLORE_STORAGE_VERSION && payload ? payload : null;
      }
      return record;
    },
    storage,
  );
}

export function writeAgentExplorePersistence(
  payload: Record<string, unknown>,
  storageKey = AGENT_EXPLORE_STORAGE_KEY,
  storage?: BrowserStorageLike,
) {
  writeBrowserJsonStorage(storageKey, {
    version: AGENT_EXPLORE_STORAGE_VERSION,
    payload,
  }, storage);
}

export function agentExplorePersistencePayloadCore(
  options: {
    activeTabId: string;
    activeSession: AgentExploreSession | null;
    form: AgentExploreFormState;
    draftTabs: AgentExploreSession[];
    history: AgentExploreSession[];
    hiddenRunIds: Set<string>;
    closedTabIds: Set<string>;
  },
) {
  const activeTabId =
    options.activeTabId ||
    options.activeSession?.runId ||
    (options.form.workspaceId ? "" : options.draftTabs[0]?.runId || "");
  return {
    activeRunId: options.activeSession?.runId || "",
    activeTabId,
    activeWorkspaceId: options.activeSession?.workspaceId || options.form.workspaceId || "",
    form: { ...options.form },
    draftTabs: options.draftTabs.slice(0, 20),
    history: options.history.slice(0, 20),
    hiddenRunIds: boundedStorageIdList(options.hiddenRunIds),
    closedTabIds: boundedStorageIdList(options.closedTabIds),
  };
}

export function agentExploreFormFromPersistenceCore(
  persisted: Record<string, unknown>,
  options: {
    currentForm: AgentExploreFormState;
    defaults: AgentExploreFormDefaults;
    hasAgentModelOption: (value?: string) => boolean;
    normalizeThinkingMode: (value?: string) => string;
  },
): AgentExploreFormState {
  const persistedForm = asRecord(persisted.form) || {};
  const persistedModelAlias = String(persistedForm.modelAlias || options.currentForm.modelAlias || "");
  return {
    query: String(persistedForm.query || options.currentForm.query || ""),
    modelAlias: options.hasAgentModelOption(persistedModelAlias) ? persistedModelAlias : "",
    contextProfileId: String(persistedForm.contextProfileId || options.currentForm.contextProfileId || "context-128k"),
    thinkingMode: options.normalizeThinkingMode(
      String(persistedForm.thinkingMode || options.currentForm.thinkingMode || "default"),
    ),
    temperature: Number(persistedForm.temperature || options.currentForm.temperature || options.defaults.temperature),
    maxTokens: Number(persistedForm.maxTokens || options.currentForm.maxTokens || options.defaults.maxTokens),
    maxIterations: Number(persistedForm.maxIterations || options.currentForm.maxIterations || options.defaults.maxIterations),
    limit: Number(persistedForm.limit || options.currentForm.limit || options.defaults.limit),
    toolChoice: String(persistedForm.toolChoice || options.currentForm.toolChoice || options.defaults.toolChoice),
    workspaceId: String(persistedForm.workspaceId || persisted.activeWorkspaceId || options.currentForm.workspaceId || ""),
  };
}
