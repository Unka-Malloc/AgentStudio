import { computed, ref, type Ref } from "vue";
import type {
  AgentSettings,
  KnowledgeSearchResponse,
} from "../lib/types";
import {
  compactInfoFeedAttachment,
  createInfoFeedFollowUpContext,
  createInitialInfoFeedAgentState,
  createInitialInfoFeedKeywordState,
  createInitialInfoFeedSummaryState,
  INFO_FEED_CONTEXT_CHARS_PER_TOKEN,
  isReadableInfoFeedAttachment,
  makeInfoFeedId,
} from "./console-info-feed-utils";
import {
  clearInfoFeedRetryState,
  delayMs,
  INFO_FEED_FETCH_RETRY_LIMIT,
  infoFeedRetryMessageForRun,
  infoFeedRetryStageLabel,
  infoFeedSearchCacheKey,
  isInfoFeedRetryExhaustedError,
  isModelConfigurationError,
  isTransientFetchError,
  setInfoFeedRetryState,
  withInfoFeedFetchRetry,
} from "./console-info-feed-run-utils";
import { createConsoleInfoFeedDerivationController } from "./console-info-feed-derivation-controller";
import { createConsoleInfoFeedExecutionController } from "./console-info-feed-execution-controller";
import { createConsoleInfoFeedHistoryController } from "./console-info-feed-history-controller";
import { createConsoleInfoFeedKeywordController } from "./console-info-feed-keyword-controller";
import {
  createConsoleInfoFeedModelController,
  type InfoFeedAgentExploreFormLike,
  type InfoFeedAgentOption,
  type InfoFeedContextProfileBudgetRow,
  type InfoFeedContextWindowOption,
} from "./console-info-feed-model-controller";
import { createConsoleInfoFeedOutputController } from "./console-info-feed-output-controller";
import type {
  InfoFeedAttachment,
  InfoFeedRunState,
} from "../types/app";

type ReadonlyRef<T> = {
  readonly value: T;
};

export type ConsoleInfoFeedControllerOptions = {
  agentExploreConfiguredLimit: ReadonlyRef<number>;
  agentExploreConfiguredMaxIterations: ReadonlyRef<number>;
  agentExploreContextWindowOptions: InfoFeedContextWindowOption[];
  agentExploreForm: Ref<InfoFeedAgentExploreFormLike>;
  agentExploreThinkingModeOptions: Array<{ value: string }>;
  agentSelectorOptions: ReadonlyRef<InfoFeedAgentOption[]>;
  canReadKnowledge: ReadonlyRef<boolean>;
  contextProfileRows: ReadonlyRef<InfoFeedContextProfileBudgetRow[]>;
  error: Ref<string>;
  recordFeedback: (action: string, context?: Record<string, unknown>) => void;
  settingsDraft: Ref<AgentSettings>;
};

export const INFO_FEED_STORAGE_KEY = "v0.0.1:frontend:info-feed-history-1";

export function createConsoleInfoFeedController(options: ConsoleInfoFeedControllerOptions) {
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
  const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(null);
  const infoFeedHistory = ref<InfoFeedRunState[]>([]);
  const infoFeedAttachments = ref<InfoFeedAttachment[]>([]);
  const infoFeedSummaryStreamText = ref("");
  const infoFeedRunSequence = ref(0);
  const infoFeedSummaryStreamTimer = ref<number | null>(null);
  const infoFeedKeywordCache = new Map<string, { response: KnowledgeSearchResponse; cachedAt: number }>();

  const {
    agentExploreThinkingParameters,
    hasAgentModelOption,
    infoFeedFallbackContextProfileId,
    infoFeedForm,
    infoFeedModelDisplayLabel,
    infoFeedModelOptions,
    infoFeedSummaryDefaults,
    selectedInfoFeedContextProfile,
    selectedInfoFeedModel,
    selectedThinkingMode,
    validAgentModelAlias,
  } = createConsoleInfoFeedModelController(options);

  const {
    applyInfoFeedSummaryAnswer,
    archiveInfoFeedExpertFeedback,
    buildFallbackInfoFeedClarification,
    buildInfoFeedAgentQuery,
    buildInfoFeedSourceContext,
    buildInfoFeedSourceSearchQuery,
    buildInfoFeedSummaryQuestion,
    estimateInfoFeedContextTokens,
    extractInfoFeedClarification,
    fallbackInfoFeedSummary,
    infoFeedAgentExpertGuidance,
    infoFeedAgentProgressFromResult,
    infoFeedAgentRecentTurns,
    infoFeedRunEvidenceRefs,
    infoFeedSourceContextBudgetChars,
    infoFeedSourceResultLine,
    infoFeedSourceSummary,
    isLowRelevanceSourceResult,
    normalizeInfoFeedClarificationOption,
  } = createConsoleInfoFeedDerivationController({
    contextProfileRows: options.contextProfileRows,
    fallbackProfileId: infoFeedFallbackContextProfileId,
  });

  const {
    appendInfoFeedTurnSnapshot,
    clearInvalidInfoFeedModelReferences,
    compactInfoFeedRunForStorage,
    createInfoFeedRun,
    deleteInfoFeedHistory,
    deleteInfoFeedHistoryItem,
    handleInfoFeedAttachmentFiles,
    infoFeedHistoryPanelItems,
    infoFeedRestorableModelAlias,
    initialInfoFeedAgentState,
    initialInfoFeedKeywordState,
    initialInfoFeedSummaryState,
    normalizeInfoFeedHistory,
    openInfoFeedHistoryRun,
    persistInfoFeedHistory,
    readInfoFeedAttachment,
    removeInfoFeedAttachment,
    resetInfoFeedRunForContinuation,
    restoreInfoFeedHistory,
    sanitizeInfoFeedRunModelReferences,
    selectInfoFeedHistoryItem,
    snapshotInfoFeedAttachments,
    snapshotInfoFeedTurn,
    upsertInfoFeedHistory,
  } = createConsoleInfoFeedHistoryController({
    evidenceRefs: infoFeedRunEvidenceRefs,
    hasAgentModelOption,
    infoFeedAttachments,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot,
    storageKey: INFO_FEED_STORAGE_KEY,
    summaryDefaults: infoFeedSummaryDefaults,
    validAgentModelAlias,
  });

  const {
    infoFeedAgentAnswer,
    infoFeedAgentSteps,
    infoFeedAllKeywordItems,
    infoFeedCanFollowUp,
    infoFeedClarification,
    infoFeedContextGateNotice,
    infoFeedInputPlaceholder,
    infoFeedKeywordItems,
    infoFeedKeywordProgressLabel,
    infoFeedKeywordScanExplain,
    infoFeedLowRelevanceKeywordItems,
    infoFeedParentRunForCurrent,
    infoFeedSubmitLabel,
  } = createConsoleInfoFeedKeywordController({
    buildInfoFeedSourceContext,
    infoFeedCurrentRun,
    infoFeedParentRunSnapshot,
    isLowRelevanceSourceResult,
  });
  const {
    clearInfoFeedSummaryStreamTimer,
    copyInfoFeedSummary,
    exportInfoFeedSummary,
    infoFeedCurrentUserQuestion,
    infoFeedExpertFeedbackFor,
    infoFeedExpertFeedbackForRun,
    infoFeedParentSummaryEvidenceRefs,
    infoFeedParentSummaryHtml,
    infoFeedStreamingSummaryHtml,
    infoFeedSummaryEvidenceRefs,
    infoFeedSummaryIsStreaming,
    infoFeedSummaryMarkdown,
    infoFeedSummaryRuntime,
    infoFeedTurnAttachments,
    infoFeedTurnQuestion,
    infoFeedTurnSummaryHtml,
    infoFeedTurnTitle,
    infoFeedUserCardTitle,
    infoFeedVisibleSummaryText,
    streamInfoFeedSummary,
  } = createConsoleInfoFeedOutputController({
    error: options.error,
    infoFeedAgentAnswer,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedKeywordItems,
    infoFeedParentRunForCurrent,
    infoFeedRunEvidenceRefs,
    infoFeedSummaryStreamText,
    infoFeedSummaryStreamTimer,
    modelDisplayLabel: infoFeedModelDisplayLabel,
    recordFeedback: options.recordFeedback,
    selectedInfoFeedModel,
  });
  const infoFeedReadyForSummary = computed(() => {
    const run = infoFeedCurrentRun.value;
    if (!run) {
      return false;
    }
    if (run.pausedForModelSelection) {
      return false;
    }
    if (run.pausedForRetry) {
      return false;
    }
    return ["completed", "failed"].includes(run.keyword.status) &&
      ["completed", "failed"].includes(run.agent.status);
  });
  const infoFeedNeedsModelSelection = computed(() => Boolean(infoFeedCurrentRun.value?.pausedForModelSelection));
  const infoFeedModelSelectionMessage = computed(() => {
    const run = infoFeedCurrentRun.value;
    if (!run?.pausedForModelSelection) {
      return "";
    }
    const stageLabel = run.pausedForModelSelection === "summary" ? "总结智能体" : "智能规划";
    const stageError = run.pausedForModelSelection === "summary" ? run.summary.error : run.agent.error;
    return `${stageLabel}的智能体没有可用 URL 或配置不完整。请选择一个可用智能体后继续。${stageError ? `（${stageError}）` : ""}`;
  });
  const infoFeedNeedsRetryContinue = computed(() => Boolean(infoFeedCurrentRun.value?.pausedForRetry));
  const infoFeedRetryMessage = computed(() => infoFeedRetryMessageForRun(infoFeedCurrentRun.value));

  const {
    chooseInfoFeedClarification,
    continueInfoFeedAfterModelSelection,
    continueInfoFeedAfterRetry,
    continueInfoFeedCurrentRun,
    executeInfoFeedRunIteration,
    runInfoFeed,
    runInfoFeedAgentTrack,
    runInfoFeedKeywordTrack,
    runInfoFeedSummaryAgent,
    syncInfoFeedExpertFeedback,
  } = createConsoleInfoFeedExecutionController({
    agentExploreConfiguredLimit: options.agentExploreConfiguredLimit,
    agentExploreConfiguredMaxIterations: options.agentExploreConfiguredMaxIterations,
    agentExploreThinkingParameters,
    applyInfoFeedSummaryAnswer,
    archiveInfoFeedExpertFeedback,
    buildInfoFeedAgentQuery,
    buildInfoFeedSourceSearchQuery,
    buildInfoFeedSummaryQuestion,
    canReadKnowledge: options.canReadKnowledge,
    createInfoFeedRun,
    error: options.error,
    fallbackInfoFeedSummary,
    infoFeedAgentExpertGuidance,
    infoFeedAgentProgressFromResult,
    infoFeedAgentRecentTurns,
    infoFeedCanFollowUp,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedKeywordCache,
    infoFeedParentRunSnapshot,
    infoFeedReadyForSummary,
    infoFeedRunEvidenceRefs,
    infoFeedRunSequence,
    resetInfoFeedRunForContinuation,
    selectedInfoFeedContextProfile,
    selectedInfoFeedModel,
    selectedThinkingMode,
    upsertInfoFeedHistory,
  });

  function clearInfoFeedKeywordCache() {
    infoFeedKeywordCache.clear();
  }

  return {
    INFO_FEED_CONTEXT_CHARS_PER_TOKEN,
    INFO_FEED_FETCH_RETRY_LIMIT,
    INFO_FEED_STORAGE_KEY,
    appendInfoFeedTurnSnapshot,
    applyInfoFeedSummaryAnswer,
    archiveInfoFeedExpertFeedback,
    buildFallbackInfoFeedClarification,
    buildInfoFeedAgentQuery,
    buildInfoFeedSourceContext,
    buildInfoFeedSourceSearchQuery,
    buildInfoFeedSummaryQuestion,
    chooseInfoFeedClarification,
    clearInfoFeedKeywordCache,
    clearInfoFeedRetryState,
    clearInfoFeedSummaryStreamTimer,
    clearInvalidInfoFeedModelReferences,
    compactInfoFeedAttachment,
    compactInfoFeedRunForStorage,
    continueInfoFeedAfterModelSelection,
    continueInfoFeedAfterRetry,
    continueInfoFeedCurrentRun,
    copyInfoFeedSummary,
    createInfoFeedFollowUpContext,
    createInfoFeedRun,
    createInitialInfoFeedAgentState,
    createInitialInfoFeedKeywordState,
    createInitialInfoFeedSummaryState,
    deleteInfoFeedHistory,
    deleteInfoFeedHistoryItem,
    delayMs,
    estimateInfoFeedContextTokens,
    executeInfoFeedRunIteration,
    exportInfoFeedSummary,
    extractInfoFeedClarification,
    fallbackInfoFeedSummary,
    handleInfoFeedAttachmentFiles,
    infoFeedAgentAnswer,
    infoFeedAgentExpertGuidance,
    infoFeedAgentProgressFromResult,
    infoFeedAgentRecentTurns,
    infoFeedAgentSteps,
    infoFeedAllKeywordItems,
    infoFeedAttachments,
    infoFeedCanFollowUp,
    infoFeedClarification,
    infoFeedContextGateNotice,
    infoFeedCurrentRun,
    infoFeedCurrentUserQuestion,
    infoFeedExpertFeedbackFor,
    infoFeedExpertFeedbackForRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedHistoryPanelItems,
    infoFeedInputPlaceholder,
    infoFeedKeywordCache,
    infoFeedKeywordItems,
    infoFeedKeywordProgressLabel,
    infoFeedKeywordScanExplain,
    infoFeedLowRelevanceKeywordItems,
    infoFeedModelDisplayLabel,
    infoFeedModelOptions,
    infoFeedModelSelectionMessage,
    infoFeedNeedsModelSelection,
    infoFeedNeedsRetryContinue,
    infoFeedParentRunForCurrent,
    infoFeedParentRunSnapshot,
    infoFeedParentSummaryEvidenceRefs,
    infoFeedParentSummaryHtml,
    infoFeedReadyForSummary,
    infoFeedRestorableModelAlias,
    infoFeedRetryMessage,
    infoFeedRetryStageLabel,
    infoFeedRunEvidenceRefs,
    infoFeedRunSequence,
    infoFeedSearchCacheKey,
    infoFeedSourceContextBudgetChars,
    infoFeedSourceResultLine,
    infoFeedSourceSummary,
    infoFeedStreamingSummaryHtml,
    infoFeedSubmitLabel,
    infoFeedSummaryEvidenceRefs,
    infoFeedSummaryIsStreaming,
    infoFeedSummaryMarkdown,
    infoFeedSummaryRuntime,
    infoFeedSummaryStreamText,
    infoFeedSummaryStreamTimer,
    infoFeedTurnAttachments,
    infoFeedTurnQuestion,
    infoFeedTurnSummaryHtml,
    infoFeedTurnTitle,
    infoFeedUserCardTitle,
    infoFeedVisibleSummaryText,
    initialInfoFeedAgentState,
    initialInfoFeedKeywordState,
    initialInfoFeedSummaryState,
    isInfoFeedRetryExhaustedError,
    isLowRelevanceSourceResult,
    isModelConfigurationError,
    isReadableInfoFeedAttachment,
    isTransientFetchError,
    makeInfoFeedId,
    normalizeInfoFeedClarificationOption,
    normalizeInfoFeedHistory,
    openInfoFeedHistoryRun,
    persistInfoFeedHistory,
    readInfoFeedAttachment,
    removeInfoFeedAttachment,
    resetInfoFeedRunForContinuation,
    restoreInfoFeedHistory,
    runInfoFeed,
    runInfoFeedAgentTrack,
    runInfoFeedKeywordTrack,
    runInfoFeedSummaryAgent,
    sanitizeInfoFeedRunModelReferences,
    selectedInfoFeedContextProfile,
    selectedInfoFeedModel,
    selectInfoFeedHistoryItem,
    setInfoFeedRetryState,
    snapshotInfoFeedAttachments,
    snapshotInfoFeedTurn,
    streamInfoFeedSummary,
    syncInfoFeedExpertFeedback,
    upsertInfoFeedHistory,
    withInfoFeedFetchRetry,
  };
}
