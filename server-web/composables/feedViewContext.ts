import { inject, provide, type InjectionKey } from "vue";
import type { FeedShellContext } from "./console-shell-feed-context";

const feedViewContextKeys = [
  "agentSelectorOptions",
  "busyKey",
  "chooseInfoFeedClarification",
  "contextWindowOptionBarOptions",
  "continueInfoFeedAfterModelSelection",
  "continueInfoFeedAfterRetry",
  "copyInfoFeedSummary",
  "deleteInfoFeedHistoryItem",
  "exportInfoFeedSummary",
  "handleAgentAnswerClick",
  "handleInfoFeedAttachmentFiles",
  "highlightedConfigTarget",
  "infoFeedAgentAnswer",
  "infoFeedAgentSteps",
  "infoFeedAllKeywordItems",
  "infoFeedAttachments",
  "infoFeedClarification",
  "infoFeedContextGateNotice",
  "infoFeedCurrentRun",
  "infoFeedCurrentUserQuestion",
  "infoFeedExpertFeedbackFor",
  "infoFeedExpertFeedbackForRun",
  "infoFeedForm",
  "infoFeedHistory",
  "infoFeedHistoryPanelItems",
  "infoFeedInputPlaceholder",
  "infoFeedKeywordItems",
  "infoFeedKeywordProgressLabel",
  "infoFeedLowRelevanceKeywordItems",
  "infoFeedModelOptions",
  "infoFeedModelSelectionMessage",
  "infoFeedNeedsModelSelection",
  "infoFeedNeedsRetryContinue",
  "infoFeedParentRunForCurrent",
  "infoFeedParentSummaryHtml",
  "infoFeedReadyForSummary",
  "infoFeedRetryMessage",
  "infoFeedRetryStageLabel",
  "infoFeedStreamingSummaryHtml",
  "infoFeedSubmitLabel",
  "infoFeedSummaryIsStreaming",
  "infoFeedSummaryMarkdown",
  "infoFeedSummaryRuntime",
  "infoFeedTurnAttachments",
  "infoFeedTurnQuestion",
  "infoFeedTurnSummaryHtml",
  "infoFeedTurnTitle",
  "infoFeedUserCardTitle",
  "openAgentEvidencePreview",
  "removeInfoFeedAttachment",
  "runInfoFeed",
  "runInfoFeedSummaryAgent",
  "saveSettings",
  "selectedInfoFeedModel",
  "selectInfoFeedHistoryItem",
  "settingsDraft",
  "thinkingModeOptionBarOptions",
] as const;

type FeedViewContextKey = (typeof feedViewContextKeys)[number];

export type FeedViewContext = Pick<FeedShellContext, FeedViewContextKey>;

export function createFeedViewContext(shell: FeedShellContext): FeedViewContext {
  return Object.fromEntries(feedViewContextKeys.map((key) => [key, shell[key]])) as FeedViewContext;
}

const feedViewKey = Symbol("feed-view") as InjectionKey<FeedViewContext>;

export function provideFeedView(context: FeedViewContext) {
  provide(feedViewKey, context);
}

export function useFeedViewContext() {
  const context = inject(feedViewKey);
  if (!context) {
    throw new Error("Feed view context is not available");
  }
  return context;
}
