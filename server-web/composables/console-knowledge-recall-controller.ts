import type { ComputedRef, Ref } from "vue";
import type {
  KnowledgeConsoleState,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
  KnowledgeSource,
  MaintenanceSettings,
} from "../lib/types";
import type { DebugTab } from "../types/app";
import { createConsoleKnowledgeRecallRunnerController } from "./console-knowledge-recall-runner-controller";
import { createConsoleKnowledgeRecallTargetController } from "./console-knowledge-recall-target-controller";
import type { KnowledgeSearchFormState } from "./console-knowledge-recall-types";

type ConsoleKnowledgeRecallControllerOptions = {
  activeKnowledgeSources: ComputedRef<KnowledgeSource[]>;
  canReadKnowledge: ComputedRef<boolean>;
  clearAllBusy: () => void;
  clearSelectedEvidence: () => void;
  error: Ref<string>;
  knowledgeConsole: Ref<KnowledgeConsoleState | null>;
  knowledgeMaintenanceDraft: Ref<MaintenanceSettings>;
  knowledgeSearchForm: Ref<KnowledgeSearchFormState>;
  knowledgeSearchResponse: Ref<KnowledgeSearchResponse | null>;
  knowledgeSearchResults: Ref<KnowledgeSearchResult[]>;
  lastKnowledgeSearchQuery: Ref<string>;
  loadEvidence: (evidenceId: string) => Promise<void>;
  openDebugTab: (tab: DebugTab) => void;
  setBusy: (key: string) => void;
};

export function createConsoleKnowledgeRecallController(
  options: ConsoleKnowledgeRecallControllerOptions,
) {
  const targetController = createConsoleKnowledgeRecallTargetController({
    activeKnowledgeSources: options.activeKnowledgeSources,
    knowledgeConsole: options.knowledgeConsole,
  });
  const runnerController = createConsoleKnowledgeRecallRunnerController({
    canReadKnowledge: options.canReadKnowledge,
    clearAllBusy: options.clearAllBusy,
    clearSelectedEvidence: options.clearSelectedEvidence,
    error: options.error,
    knowledgeMaintenanceDraft: options.knowledgeMaintenanceDraft,
    knowledgeRecallDebugForm: targetController.knowledgeRecallDebugForm,
    knowledgeRecallDebugModeOptionBarOptions: targetController.knowledgeRecallDebugModeOptionBarOptions,
    knowledgeSearchForm: options.knowledgeSearchForm,
    knowledgeSearchResponse: options.knowledgeSearchResponse,
    knowledgeSearchResults: options.knowledgeSearchResults,
    lastKnowledgeSearchQuery: options.lastKnowledgeSearchQuery,
    loadEvidence: options.loadEvidence,
    openDebugTab: options.openDebugTab,
    selectedKnowledgeRecallDebugTarget: targetController.selectedKnowledgeRecallDebugTarget,
    setBusy: options.setBusy,
  });

  return {
    buildKnowledgeRecallSearchPayload: runnerController.buildKnowledgeRecallSearchPayload,
    currentKnowledgeLearningEnabled: runnerController.currentKnowledgeLearningEnabled,
    currentKnowledgeRetrievalSettings: runnerController.currentKnowledgeRetrievalSettings,
    currentKnowledgeSearchLimit: runnerController.currentKnowledgeSearchLimit,
    knowledgeRecallDebugForm: targetController.knowledgeRecallDebugForm,
    knowledgeRecallDebugGridStyle: runnerController.knowledgeRecallDebugGridStyle,
    knowledgeRecallDebugModeOptionBarOptions: targetController.knowledgeRecallDebugModeOptionBarOptions,
    knowledgeRecallDebugRuns: runnerController.knowledgeRecallDebugRuns,
    knowledgeRecallDebugTargetOptions: targetController.knowledgeRecallDebugTargetOptions,
    refreshKnowledgeRecallBackendSpaces: targetController.refreshKnowledgeRecallBackendSpaces,
    runKnowledgeRecallDebugBatch: runnerController.runKnowledgeRecallDebugBatch,
    searchKnowledge: runnerController.searchKnowledge,
  };
}
