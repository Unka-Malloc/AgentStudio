import { recordKnowledgeFeedback } from "../lib/knowledge-search-client";
import type { AgentExploreRunResponse } from "../lib/types";
import { asRecord } from "./console-model-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleKnowledgeFeedbackControllerOptions = {
  agentExploreResult: ReadonlyRef<AgentExploreRunResponse | null>;
  currentAgentExploreQuery: () => string;
  infoFeedQuery: () => string;
  infoFeedRunId: () => string;
  knowledgeSearchQuery: () => string;
};

export function createConsoleKnowledgeFeedbackController(
  options: ConsoleKnowledgeFeedbackControllerOptions,
) {
  function recordConsoleKnowledgeFeedback(action: string, context: Record<string, unknown> = {}) {
    const query = String(
      context.query ||
        options.currentAgentExploreQuery() ||
        options.infoFeedQuery() ||
        options.knowledgeSearchQuery() ||
        "",
    ).trim();
    const agentRunId = String(asRecord(options.agentExploreResult.value?.run)?.runId || "");
    void recordKnowledgeFeedback({
      clientId: "server-console-ui",
      query,
      action,
      itemId: String(context.itemId || agentRunId || options.infoFeedRunId() || ""),
      evidenceId: String(context.evidenceId || ""),
      resultRank: Number(context.resultRank || 0),
      createdAt: new Date().toISOString(),
      context: {
        source: "server_console",
        ...context,
      },
    }).catch(() => {
      // Feedback must not block user actions.
    });
  }

  return {
    recordConsoleKnowledgeFeedback,
  };
}
