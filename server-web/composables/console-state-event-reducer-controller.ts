import { ref, type Ref } from "vue";
import type {
  AgentSettings,
  DiscoveryConfig,
  DiscoveryConfigResponse,
  EmailRuleSet,
  ExpertVocabulary,
  KnowledgeConsoleState,
  KnowledgeSourceState,
  KnowledgeWordCloudSet,
  ProtocolEvent,
  ServerConsoleState,
  SplitJob,
} from "../lib/types";
import { asRecord } from "./console-model-utils";

type SilentRefreshOptions = {
  silent?: boolean;
};

type ConsoleStateEventReducerControllerOptions = {
  applyAgentExploreDefaultsFromSettings: () => void;
  applyMaintenanceAgentConfigFromEvent: (config: unknown) => boolean;
  applyMaintenanceAgentStateFromConsoleState: (state: ServerConsoleState) => void;
  applyWordCloudEvent: (wordBagSet: KnowledgeWordCloudSet) => boolean;
  consoleState: Ref<ServerConsoleState | null>;
  discoveryDraftDirty: Ref<boolean>;
  expertVocabularyDraftDirty: Ref<boolean>;
  hasFeature: (featureId: string) => boolean;
  knowledgeConsole: Ref<KnowledgeConsoleState | null>;
  knowledgeSourceState: Ref<KnowledgeSourceState | null>;
  mountDraftDirty: Ref<boolean>;
  normalizedSettingsFromServer: (settings: AgentSettings) => AgentSettings;
  refreshExpertRules: (options?: SilentRefreshOptions) => void | Promise<unknown>;
  refreshKnowledgeConflicts: (options?: SilentRefreshOptions) => void | Promise<unknown>;
  refreshMaintenanceAgent: (options?: SilentRefreshOptions) => void | Promise<unknown>;
  removeJobFromEvent: (jobId: string) => boolean;
  replaceDiscoveryDraftFromServer: (value: DiscoveryConfig) => void;
  replaceExpertVocabularyDraftFromServer: (value: ExpertVocabulary) => void;
  replaceMountDraftFromServer: (value: Record<string, string> | null | undefined) => void;
  replaceRulesDraftFromServer: (value: EmailRuleSet) => void;
  replaceSettingsDraftFromServer: (settings: AgentSettings) => void;
  rulesDraftDirty: Ref<boolean>;
  settingsDraftDirty: Ref<boolean>;
  upsertJobFromEvent: (job: SplitJob) => boolean;
};

export const baseServerEventTopics = [
  "server.lifecycle",
  "system.interfaces",
  "system.console_state",
  "discovery.config",
  "discovery.clients",
  "runtime.mounts",
  "settings.current",
  "email_rules.current",
  "expert_vocabulary.current",
  "knowledge.golden_rules",
  "uploads.session",
  "uploads.trace",
  "jobs.job",
  "jobs.deleted",
  "storage.summary",
  "knowledge.changes",
  "knowledge.review_items",
  "knowledge.sources",
  "knowledge.word_clouds",
  "maintenance.agent.config",
  "maintenance.agent.plan.created",
  "maintenance.agent.approval.required",
  "maintenance.agent.run.started",
  "maintenance.agent.tool.started",
  "maintenance.agent.tool.completed",
  "maintenance.agent.tool.failed",
  "maintenance.agent.run.completed",
  "agent_sync.config",
];

export function createConsoleStateEventReducerController(
  options: ConsoleStateEventReducerControllerOptions,
) {
  const uploadTraceEvents = ref<ProtocolEvent[]>([]);

  function currentServerEventTopics() {
    const topics = baseServerEventTopics.filter((topic) => {
      if (topic.startsWith("knowledge.") || topic === "email_rules.current" || topic === "expert_vocabulary.current") {
        return options.hasFeature("knowledge-core");
      }
      if (topic.startsWith("maintenance.agent.")) {
        return options.hasFeature("maintenance-agent-runbooks");
      }
      if (topic === "agent_sync.config") {
        return options.hasFeature("agent-gateway");
      }
      return true;
    });
    return topics.join(",");
  }

  function applyConsoleState(
    nextState: ServerConsoleState,
    applyOptions: { forceSettings?: boolean; forceDrafts?: boolean } = {},
  ) {
    const nextSettings = options.normalizedSettingsFromServer(nextState.settings.value);
    options.consoleState.value = {
      ...nextState,
      settings: {
        ...nextState.settings,
        value: nextSettings,
      },
    };
    if (applyOptions.forceSettings || !options.settingsDraftDirty.value) {
      options.replaceSettingsDraftFromServer(nextSettings);
    }
    options.applyAgentExploreDefaultsFromSettings();
    if (applyOptions.forceDrafts || !options.discoveryDraftDirty.value) {
      options.replaceDiscoveryDraftFromServer(nextState.discovery.value);
    }
    if (applyOptions.forceDrafts || !options.mountDraftDirty.value) {
      options.replaceMountDraftFromServer(nextState.runtime.mountModules || {});
    }
    if (applyOptions.forceDrafts || !options.rulesDraftDirty.value) {
      options.replaceRulesDraftFromServer(nextState.emailRules.rules);
    }
    if (applyOptions.forceDrafts || !options.expertVocabularyDraftDirty.value) {
      options.replaceExpertVocabularyDraftFromServer(
        nextState.expertVocabulary.vocabulary,
      );
    }
    options.applyMaintenanceAgentStateFromConsoleState(nextState);
  }

  function applyServerEvent(event: ProtocolEvent) {
    const payload = asRecord(event.payload);
    if (!payload) {
      return false;
    }

    if (event.topic === "system.console_state") {
      const state = asRecord(payload.state) as ServerConsoleState | null;
      if (!state) {
        return false;
      }
      applyConsoleState(state);
      return true;
    }

    if (event.topic === "uploads.trace") {
      const existingIds = new Set(uploadTraceEvents.value.map((item) => item.id));
      uploadTraceEvents.value = existingIds.has(event.id)
        ? uploadTraceEvents.value
        : [event, ...uploadTraceEvents.value].slice(0, 500);
      return true;
    }

    if (!options.consoleState.value) {
      return false;
    }

    if (event.topic === "jobs.job") {
      const job = asRecord(payload.job) as SplitJob | null;
      if (!job) {
        return false;
      }
      const handled = options.upsertJobFromEvent(job);
      if (["completed", "failed"].includes(String(job.status || ""))) {
        void options.refreshKnowledgeConflicts({ silent: true });
      }
      return handled;
    }

    if (event.topic === "jobs.deleted") {
      const job =
        (asRecord(payload.job) as SplitJob | null) ||
        (asRecord(payload.deletedJob) as SplitJob | null);
      return options.removeJobFromEvent(job?.id || String(payload.batchId || ""));
    }

    if (event.topic === "knowledge.sources") {
      const state = asRecord(payload.state) as KnowledgeSourceState | null;
      if (!state) {
        return false;
      }
      options.knowledgeSourceState.value = state;
      if (options.knowledgeConsole.value) {
        options.knowledgeConsole.value = {
          ...options.knowledgeConsole.value,
          sources: state,
        };
      }
      return true;
    }

    if (event.topic === "knowledge.word_clouds") {
      const wordBagSet = asRecord(payload.wordBagSet) as KnowledgeWordCloudSet | null;
      if (!wordBagSet) {
        return false;
      }
      return options.applyWordCloudEvent(wordBagSet);
    }

    if (event.topic === "knowledge.review_items" || event.topic === "knowledge.changes") {
      void options.refreshKnowledgeConflicts({ silent: true });
      return true;
    }

    if (event.topic === "settings.current") {
      const nextSettings = options.normalizedSettingsFromServer(payload as AgentSettings);
      options.consoleState.value = {
        ...options.consoleState.value,
        settings: {
          ...options.consoleState.value.settings,
          value: nextSettings,
        },
      };
      if (!options.settingsDraftDirty.value) {
        options.replaceSettingsDraftFromServer(nextSettings);
      }
      return true;
    }

    if (event.topic === "discovery.config") {
      const value = asRecord(payload.value) as DiscoveryConfig | null;
      if (!value) {
        return false;
      }
      options.consoleState.value = {
        ...options.consoleState.value,
        discovery: {
          ...options.consoleState.value.discovery,
          value,
          bootstrap: (asRecord(payload.bootstrap) as DiscoveryConfigResponse["bootstrap"] | null) ||
            options.consoleState.value.discovery.bootstrap,
        },
      };
      if (!options.discoveryDraftDirty.value) {
        options.replaceDiscoveryDraftFromServer(value);
      }
      return true;
    }

    if (event.topic === "runtime.mounts") {
      const runtime = asRecord(payload.runtime) as Partial<ServerConsoleState["runtime"]> | null;
      if (!runtime) {
        return false;
      }
      options.consoleState.value = {
        ...options.consoleState.value,
        runtime: {
          ...options.consoleState.value.runtime,
          ...runtime,
        },
      };
      if (!options.mountDraftDirty.value) {
        options.replaceMountDraftFromServer(options.consoleState.value.runtime.mountModules || {});
      }
      return true;
    }

    if (event.topic === "email_rules.current") {
      const rules = asRecord(payload.rules) as EmailRuleSet | null;
      if (!rules) {
        return false;
      }
      const emailRules = {
        path: String(payload.path || options.consoleState.value.emailRules.path || ""),
        rules,
      };
      options.consoleState.value = {
        ...options.consoleState.value,
        emailRules,
      };
      if (!options.rulesDraftDirty.value) {
        options.replaceRulesDraftFromServer(rules);
      }
      return true;
    }

    if (event.topic === "expert_vocabulary.current") {
      const vocabulary = asRecord(payload.vocabulary) as ExpertVocabulary | null;
      if (!vocabulary) {
        return false;
      }
      const expertVocabulary = {
        path: String(payload.path || options.consoleState.value.expertVocabulary.path || ""),
        vocabulary,
      };
      options.consoleState.value = {
        ...options.consoleState.value,
        expertVocabulary,
      };
      if (!options.expertVocabularyDraftDirty.value) {
        options.replaceExpertVocabularyDraftFromServer(vocabulary);
      }
      return true;
    }

    if (event.topic === "knowledge.golden_rules") {
      void options.refreshExpertRules({ silent: true });
      return true;
    }

    if (event.topic === "maintenance.agent.config") {
      if (!options.applyMaintenanceAgentConfigFromEvent(payload.config)) {
        return false;
      }
      return true;
    }

    if (event.topic.startsWith("maintenance.agent.")) {
      void options.refreshMaintenanceAgent({ silent: true });
      return true;
    }

    if (event.topic === "storage.summary") {
      options.consoleState.value = {
        ...options.consoleState.value,
        storage: payload as ServerConsoleState["storage"],
      };
      return true;
    }

    return false;
  }

  return {
    applyConsoleState,
    applyServerEvent,
    baseServerEventTopics,
    currentServerEventTopics,
    uploadTraceEvents,
  };
}
