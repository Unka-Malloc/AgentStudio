import type {
  AgentExploreRunResponse,
  KnowledgeSearchResult,
} from "../lib/types";
import type {
  InfoFeedClarification,
  InfoFeedClarificationOption,
  InfoFeedRunState,
} from "../types/app";
import {
  applyInfoFeedSummaryAnswerCore,
  archiveInfoFeedExpertFeedbackCore,
  buildFallbackInfoFeedClarificationCore,
  buildInfoFeedAgentQueryCore,
  buildInfoFeedSourceContextCore,
  buildInfoFeedSourceSearchQueryCore,
  buildInfoFeedSourceSummaryCore,
  buildInfoFeedSummaryQuestionCore,
  estimateInfoFeedContextTokens as estimateInfoFeedContextTokensCore,
  extractInfoFeedClarificationCore,
  infoFeedAgentExpertGuidanceCore,
  infoFeedAgentRecentTurnsCore,
  infoFeedRunEvidenceRefsCore,
  infoFeedSourceContextBudgetChars as infoFeedSourceContextBudgetCharsCore,
  infoFeedSourceResultLine as infoFeedSourceResultLineCore,
  isLowRelevanceSourceResult as isLowRelevanceSourceResultCore,
  normalizeInfoFeedClarificationOptionCore,
  fallbackInfoFeedSummaryCore,
} from "./console-info-feed-utils";
import { infoFeedAgentProgressFromResultCore } from "./console-info-feed-run-utils";
import type { InfoFeedContextProfileBudgetRow } from "./console-info-feed-model-controller";

type ReadonlyRef<T> = {
  readonly value: T;
};

export type ConsoleInfoFeedDerivationControllerOptions = {
  contextProfileRows: ReadonlyRef<InfoFeedContextProfileBudgetRow[]>;
  fallbackProfileId: () => string;
};

export function createConsoleInfoFeedDerivationController(
  options: ConsoleInfoFeedDerivationControllerOptions,
) {
  function infoFeedAgentProgressFromResult(result: AgentExploreRunResponse | null, maxIterations: number) {
    return infoFeedAgentProgressFromResultCore(result, maxIterations);
  }

  function isLowRelevanceSourceResult(item: KnowledgeSearchResult) {
    return isLowRelevanceSourceResultCore(item);
  }

  function infoFeedSourceResultLine(item: KnowledgeSearchResult, index: number) {
    return infoFeedSourceResultLineCore(item, index);
  }

  function estimateInfoFeedContextTokens(chars: number) {
    return estimateInfoFeedContextTokensCore(chars);
  }

  function infoFeedSourceContextBudgetChars(run: InfoFeedRunState | null | undefined) {
    return infoFeedSourceContextBudgetCharsCore(run, {
      profiles: options.contextProfileRows.value,
      fallbackProfileId: options.fallbackProfileId(),
    });
  }

  function buildInfoFeedSourceContext(run: InfoFeedRunState | null | undefined) {
    return buildInfoFeedSourceContextCore(run, {
      profiles: options.contextProfileRows.value,
      fallbackProfileId: options.fallbackProfileId(),
    });
  }

  function buildInfoFeedSourceSearchQuery(run: InfoFeedRunState) {
    return buildInfoFeedSourceSearchQueryCore(run);
  }

  function buildInfoFeedAgentQuery(run: InfoFeedRunState) {
    return buildInfoFeedAgentQueryCore(run);
  }

  function infoFeedAgentRecentTurns(run: InfoFeedRunState) {
    return infoFeedAgentRecentTurnsCore(run);
  }

  function infoFeedAgentExpertGuidance(run: InfoFeedRunState) {
    return infoFeedAgentExpertGuidanceCore(run);
  }

  function infoFeedSourceSummary(run: InfoFeedRunState) {
    return buildInfoFeedSourceSummaryCore(run, buildInfoFeedSourceContext(run));
  }

  function buildInfoFeedSummaryQuestion(run: InfoFeedRunState) {
    return buildInfoFeedSummaryQuestionCore(run, infoFeedSourceSummary(run));
  }

  function fallbackInfoFeedSummary(run: InfoFeedRunState) {
    return fallbackInfoFeedSummaryCore(run);
  }

  function normalizeInfoFeedClarificationOption(value: unknown, index: number): InfoFeedClarificationOption | null {
    return normalizeInfoFeedClarificationOptionCore(value, index);
  }

  function extractInfoFeedClarification(answer: string): { answer: string; clarification?: InfoFeedClarification } {
    return extractInfoFeedClarificationCore(answer);
  }

  function buildFallbackInfoFeedClarification(run: InfoFeedRunState): InfoFeedClarification | undefined {
    return buildFallbackInfoFeedClarificationCore(run);
  }

  function applyInfoFeedSummaryAnswer(run: InfoFeedRunState, answer: string, fallback: boolean, error = "") {
    applyInfoFeedSummaryAnswerCore(run, answer, fallback, error);
  }

  function infoFeedRunEvidenceRefs(run: InfoFeedRunState) {
    return infoFeedRunEvidenceRefsCore(run);
  }

  function archiveInfoFeedExpertFeedback(
    run: InfoFeedRunState,
    clarification: InfoFeedClarification,
    option: InfoFeedClarificationOption,
  ) {
    return archiveInfoFeedExpertFeedbackCore(run, clarification, option);
  }

  return {
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
  };
}
