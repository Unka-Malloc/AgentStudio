import { ref, type Ref } from "vue";
import type {
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
} from "../lib/types";
import { createConsoleWordCloudCorpusController } from "./console-word-cloud-corpus-controller";
import { createConsoleWordCloudEditorController } from "./console-word-cloud-editor-controller";
import type { ConsoleWordCloudMessage } from "./console-word-cloud-types";
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
  busyKey: ReadonlyRef<string>;
  canReadKnowledge: ReadonlyRef<boolean>;
  canWriteKnowledge: ReadonlyRef<boolean>;
  clearAllBusy: () => void;
  error: Ref<string>;
  setBusy: (key: string) => void;
};

export function createConsoleWordCloudController(options: ConsoleWordCloudControllerOptions) {
  const wordCloudState = ref<KnowledgeWordCloudState | null>(null);
  const wordCloudDraft = ref<KnowledgeWordCloudSet | null>(null);
  const wordCloudModelAlias = ref("");
  const wordCloudCorpusPaths = ref<KnowledgeWordCloudCorpusPath[]>([]);
  const selectedWordBagId = ref("");
  const wordBagActionMenuId = ref("");
  const collapsedWordBagIds = ref<Set<string>>(new Set());
  const pinnedWordBagIds = ref<Set<string>>(new Set());
  const wordCloudTermInputs = ref<Record<string, string>>({});
  const wordCloudMessages = ref<ConsoleWordCloudMessage[]>([]);
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
    refreshWordCloud,
    saveWordCloud,
  } = createConsoleWordCloudWorkflowController({
    applySavedWordCloudSet,
    autoAbsorbWordCloudTerms,
    busyKey: options.busyKey,
    canReadKnowledge: options.canReadKnowledge,
    canWriteKnowledge: options.canWriteKnowledge,
    clearAllBusy: options.clearAllBusy,
    createDefaultWordCloudSet,
    error: options.error,
    resolveWordCloudCorpusPathsForQuery,
    setBusy: options.setBusy,
    setWordCloudDraftFromState,
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudMessages,
    wordCloudModelAlias,
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
    clearRemovedTermsFromCloud,
    clearWordCloudCorpusPaths,
    cloneWordCloudSet,
    collapsedWordBagIds,
    createDefaultWordCloudSet,
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
    wordCloudPalette,
    wordCloudState,
    wordCloudTermFrequencyMap,
    wordCloudTermIdentity,
    wordCloudTermInputs,
    wordCloudTermWithFrequency,
    wordCloudTerms,
    wordCloudVisibleTerms,
  };
}
