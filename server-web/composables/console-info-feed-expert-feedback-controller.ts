import { recordKnowledgeFeedback } from "../lib/knowledge-search-client";
import type { KnowledgeSearchResult } from "../lib/types";
import type {
  InfoFeedExpertFeedback,
  InfoFeedRunState,
} from "../types/app";

type ConsoleInfoFeedExpertFeedbackControllerOptions = {
  infoFeedRunEvidenceRefs: (run: InfoFeedRunState) => string[];
  upsertInfoFeedHistory: (run: InfoFeedRunState | null) => void;
};

export function createConsoleInfoFeedExpertFeedbackController(
  options: ConsoleInfoFeedExpertFeedbackControllerOptions,
) {
  async function syncInfoFeedExpertFeedback(run: InfoFeedRunState, feedbackItem: InfoFeedExpertFeedback) {
    try {
      await recordKnowledgeFeedback({
        feedbackId: feedbackItem.feedbackId,
        clientId: "server-console-info-feed",
        query: feedbackItem.sourceQuery || run.query,
        action: "human_expert_clarification",
        itemId: run.runId,
        evidenceId: options.infoFeedRunEvidenceRefs(run)[0] || "",
        resultRank: 0,
        createdAt: feedbackItem.createdAt,
        context: {
          type: "info_feed_expert_feedback",
          gold: true,
          humanExpert: true,
          source: "clarification_option",
          runId: run.runId,
          questionId: feedbackItem.questionId,
          anchor: feedbackItem.anchor,
          prompt: feedbackItem.prompt,
          reason: feedbackItem.reason,
          selectedOption: {
            optionId: feedbackItem.selectedOptionId,
            label: feedbackItem.selectedLabel,
            description: feedbackItem.selectedDescription,
            followUpQuestion: feedbackItem.followUpQuestion,
          },
          evidenceRefs: options.infoFeedRunEvidenceRefs(run),
          modelAlias: run.summary.modelAlias,
          summaryStatus: run.summary.status,
          keywordCount: ((run.keyword.response?.items || run.keyword.response?.results || []) as KnowledgeSearchResult[]).length,
          agentRunId: run.agent.runId,
        },
      });
      feedbackItem.syncStatus = "synced";
      feedbackItem.syncedAt = new Date().toISOString();
      feedbackItem.syncError = "";
    } catch (nextError) {
      feedbackItem.syncStatus = "failed";
      feedbackItem.syncError = nextError instanceof Error ? nextError.message : "专家意见同步失败。";
    } finally {
      options.upsertInfoFeedHistory(run);
    }
  }

  return {
    syncInfoFeedExpertFeedback,
  };
}
