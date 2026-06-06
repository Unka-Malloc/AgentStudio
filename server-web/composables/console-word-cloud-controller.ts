import { computed, ref, type Ref } from "vue";
import type {
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
} from "../lib/types";
import { createConsoleWordCloudCorpusController } from "./console-word-cloud-corpus-controller";
import { createConsoleWordCloudEditorController } from "./console-word-cloud-editor-controller";
import type {
  ConsoleWordCloudAgentOption,
  ConsoleWordCloudMessage,
} from "./console-word-cloud-types";
import { createConsoleWordCloudWorkflowController } from "./console-word-cloud-workflow-controller";
import {
  cloneWordCloudSet,
  findWordCloudInTree,
  normalizeWordCloudCloudForUi,
  normalizeWordCloudCorpusPathForUi,
  normalizeWordCloudCorpusPathsForUi,
  normalizeWordCloudSetForUi,
  normalizeWordCloudTermForUi,
  wordCloudTermIdentity,
} from "./console-word-cloud-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

export type ConsoleWordCloudControllerOptions = {
  agentSelectorOptions: ReadonlyRef<ConsoleWordCloudAgentOption[]>;
  busyKey: ReadonlyRef<string>;
  canReadKnowledge: ReadonlyRef<boolean>;
  canWriteKnowledge: ReadonlyRef<boolean>;
  clearAllBusy: () => void;
  error: Ref<string>;
  setBusy: (key: string) => void;
};

export type { ConsoleWordCloudAgentOption } from "./console-word-cloud-types";

function inactiveWordCloudAgentOption(value?: string): ConsoleWordCloudAgentOption {
  const selectedValue = String(value || "").trim();
  return {
    value: selectedValue,
    agentUid: selectedValue,
    label: selectedValue ? "已移除的智能体" : "未选择智能体",
    provider: "",
    model: "",
    moduleIds: [],
    capabilities: [],
    status: "unconfigured",
    enabled: false,
    selectable: false,
    disabledReason: selectedValue ? "已从智能体列表删除" : "未分配",
    reason: selectedValue ? "已从智能体列表删除" : "未分配",
  };
}

function selectedWordCloudAgentFromOptions(
  options: ConsoleWordCloudAgentOption[],
  value?: string,
): ConsoleWordCloudAgentOption {
  const selectedValue = String(value || "").trim();
  if (!selectedValue) {
    return inactiveWordCloudAgentOption("");
  }
  return options.find((item) => item.value === selectedValue) || inactiveWordCloudAgentOption(selectedValue);
}

export function createConsoleWordCloudController(options: ConsoleWordCloudControllerOptions) {
  const wordCloudState = ref<KnowledgeWordCloudState | null>(null);
  const wordCloudDraft = ref<KnowledgeWordCloudSet | null>(null);
  const wordCloudPrompt = ref("");
  const wordCloudModelAlias = ref("");
  const wordCloudCorpusPaths = ref<KnowledgeWordCloudCorpusPath[]>([]);
  const selectedWordBagId = ref("");
  const wordBagActionMenuId = ref("");
  const collapsedWordBagIds = ref<Set<string>>(new Set());
  const pinnedWordBagIds = ref<Set<string>>(new Set());
  const wordCloudTermInputs = ref<Record<string, string>>({});
  const fillingWordBagIds = ref<Set<string>>(new Set());
  const fillTargetWordBagId = ref<string | null>(null);
  const fillSourceWordBagSetId = ref<string | null>(null);
  const wordCloudMessages = ref<ConsoleWordCloudMessage[]>([]);

  const wordCloudModelOptions = computed(() => options.agentSelectorOptions.value);
  const selectedWordCloudModel = computed(() =>
    selectedWordCloudAgentFromOptions(wordCloudModelOptions.value, wordCloudModelAlias.value),
  );
  const {
    addChildWordCloud,
    addManualWordCloud,
    addTermActionToCloud,
    addTermInputToCloud,
    addTermToCloud,
    applySavedWordCloudSet,
    autoAbsorbWordCloudTerms,
    clearRemovedTermsFromCloud,
    createDefaultWordCloudSet,
    flattenWordCloudCards,
    mutateWordCloudDraft,
    pinWordCloud,
    removeSelectedWordCloud,
    removeTermFromCloud,
    selectWordCloud,
    selectedWordCloud,
    setWordCloudDraftFromState,
    setWordCloudTermInput,
    toggleWordCloudActionMenu,
    toggleWordCloudCollapsed,
    updateSelectedWordCloudField,
    updateWordCloudField,
    wordCloudCanvasClouds,
    wordCloudCardRows,
    wordCloudCardStyle,
    wordCloudPalette,
    wordCloudTermFrequencyMap,
    wordCloudTermWithFrequency,
    wordCloudTerms,
    wordCloudVisibleTerms,
  } = createConsoleWordCloudEditorController({
    collapsedWordBagIds,
    pinnedWordBagIds,
    selectedWordBagId,
    wordBagActionMenuId,
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudModelAlias,
    wordCloudState,
    wordCloudTermInputs,
  });

  const {
    addWordCloudCorpusPaths,
    clearWordCloudCorpusPaths,
    persistWordCloudCorpusPaths,
    preferredWordCloudCorpusPaths,
    refreshWordCloudCorpusTerms,
    removeWordCloudCorpusPath,
    resolveWordCloudCorpusPathsForQuery,
    setWordCloudDraftCorpusPaths,
    wordCloudCorpusPathLabel,
    wordCloudCorpusPathSummary,
  } = createConsoleWordCloudCorpusController({
    applySavedWordCloudSet,
    autoAbsorbWordCloudTerms,
    busyKey: options.busyKey,
    canReadKnowledge: options.canReadKnowledge,
    canWriteKnowledge: options.canWriteKnowledge,
    clearAllBusy: options.clearAllBusy,
    createDefaultWordCloudSet,
    error: options.error,
    setBusy: options.setBusy,
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudMessages,
    wordCloudModelAlias,
    wordCloudState,
    wordCloudTerms,
  });

  const {
    applyWordCloudEvent,
    autoFillCloudWithAgent,
    proposeWordCloud,
    refreshWordCloud,
    saveWordCloud,
  } = createConsoleWordCloudWorkflowController({
    addTermToCloud,
    applySavedWordCloudSet,
    autoAbsorbWordCloudTerms,
    busyKey: options.busyKey,
    canReadKnowledge: options.canReadKnowledge,
    canWriteKnowledge: options.canWriteKnowledge,
    clearAllBusy: options.clearAllBusy,
    createDefaultWordCloudSet,
    error: options.error,
    fillingWordBagIds,
    fillSourceWordBagSetId,
    fillTargetWordBagId,
    refreshWordCloudCorpusTerms,
    resolveWordCloudCorpusPathsForQuery,
    selectedWordCloudModel,
    setBusy: options.setBusy,
    setWordCloudDraftFromState,
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudMessages,
    wordCloudModelAlias,
    wordCloudPrompt,
    wordCloudState,
    wordCloudTerms,
  });

  return {
    addChildWordCloud,
    addManualWordCloud,
    addTermActionToCloud,
    addTermInputToCloud,
    addTermToCloud,
    addWordCloudCorpusPaths,
    applySavedWordCloudSet,
    applyWordCloudEvent,
    autoFillCloudWithAgent,
    clearRemovedTermsFromCloud,
    clearWordCloudCorpusPaths,
    cloneWordCloudSet,
    collapsedWordBagIds,
    createDefaultWordCloudSet,
    fillingWordBagIds,
    findWordCloudInTree,
    flattenWordCloudCards,
    mutateWordCloudDraft,
    normalizeWordCloudCloudForUi,
    normalizeWordCloudCorpusPathForUi,
    normalizeWordCloudCorpusPathsForUi,
    normalizeWordCloudSetForUi,
    normalizeWordCloudTermForUi,
    persistWordCloudCorpusPaths,
    pinWordCloud,
    pinnedWordBagIds,
    preferredWordCloudCorpusPaths,
    proposeWordCloud,
    refreshWordCloud,
    refreshWordCloudCorpusTerms,
    removeSelectedWordCloud,
    removeTermFromCloud,
    removeWordCloudCorpusPath,
    resolveWordCloudCorpusPathsForQuery,
    saveWordCloud,
    selectWordCloud,
    selectedWordBagId,
    selectedWordCloud,
    selectedWordCloudModel,
    setWordCloudDraftCorpusPaths,
    setWordCloudDraftFromState,
    setWordCloudTermInput,
    toggleWordCloudActionMenu,
    toggleWordCloudCollapsed,
    updateSelectedWordCloudField,
    updateWordCloudField,
    wordBagActionMenuId,
    wordCloudCanvasClouds,
    wordCloudCardRows,
    wordCloudCardStyle,
    wordCloudCorpusPathLabel,
    wordCloudCorpusPathSummary,
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudMessages,
    wordCloudModelAlias,
    wordCloudModelOptions,
    wordCloudPalette,
    wordCloudPrompt,
    wordCloudState,
    wordCloudTermFrequencyMap,
    wordCloudTermIdentity,
    wordCloudTermInputs,
    wordCloudTermWithFrequency,
    wordCloudTerms,
    wordCloudVisibleTerms,
  };
}
