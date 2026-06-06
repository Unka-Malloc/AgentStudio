import type { KnowledgeSearchResult } from "../lib/types";
import type { InfoFeedRunState } from "../types/app";
import {
  compactInfoFeedAttachment,
  snapshotInfoFeedAttachments,
} from "./console-info-feed-attachment-utils";
import type { InfoFeedSummaryDefaults } from "./console-info-feed-shared-utils";

function compactInfoFeedExpertFeedbackList(
  items: InfoFeedRunState["expertFeedback"],
  limit: number,
) {
  return (items || []).slice(-limit).map((item) => ({
    ...item,
    prompt: String(item.prompt || "").slice(0, 600),
    reason: String(item.reason || "").slice(0, 600),
    selectedDescription: String(item.selectedDescription || "").slice(0, 600),
    followUpQuestion: String(item.followUpQuestion || "").slice(0, 1200),
    sourceQuery: String(item.sourceQuery || "").slice(0, 1200),
  }));
}

export function compactInfoFeedRunForStorage(
  run: InfoFeedRunState,
  summaryDefaults: Pick<InfoFeedSummaryDefaults, "temperature" | "maxTokens">,
): InfoFeedRunState {
  const keywordItems = ((run.keyword.response?.items || run.keyword.response?.results || []) as KnowledgeSearchResult[])
    .slice(0, 12);
  const keywordResponse = run.keyword.response
    ? {
        ...run.keyword.response,
        items: keywordItems,
        results: keywordItems,
      }
    : null;
  const agentResponse = run.agent.response
    ? {
        ...run.agent.response,
        steps: (run.agent.response.steps || []).slice(-8),
        toolResults: (run.agent.response.toolResults || []).slice(-12),
        answer: String(run.agent.response.answer || "").slice(0, 12000),
      }
    : null;
  return {
    ...run,
    followUp: run.followUp
      ? {
          ...run.followUp,
          parentSummary: String(run.followUp.parentSummary || "").slice(0, 4000),
          parentEvidenceRefs: (run.followUp.parentEvidenceRefs || []).slice(0, 24),
        }
      : undefined,
    attachments: run.attachments.map((attachment) => ({
      ...compactInfoFeedAttachment(attachment),
    })),
    turns: (run.turns || []).slice(-8).map((turn) => ({
      ...turn,
      query: String(turn.query || "").slice(0, 1200),
      followUpQuestion: String(turn.followUpQuestion || "").slice(0, 1200),
      attachments: snapshotInfoFeedAttachments(turn.attachments || []).slice(0, 12),
      summaryAnswer: String(turn.summaryAnswer || "").slice(0, 16000),
      summaryError: String(turn.summaryError || "").slice(0, 1000),
      evidenceRefs: (turn.evidenceRefs || []).slice(0, 32),
      expertFeedback: compactInfoFeedExpertFeedbackList(turn.expertFeedback || [], 8),
    })),
    expertFeedback: compactInfoFeedExpertFeedbackList(run.expertFeedback || [], 16),
    clarification: run.clarification
      ? {
          ...run.clarification,
          anchor: run.clarification.anchor || "report",
          options: (run.clarification.options || []).slice(0, 4),
        }
      : undefined,
    keyword: {
      ...run.keyword,
      response: keywordResponse,
    },
    agent: {
      ...run.agent,
      response: agentResponse,
    },
    summary: {
      ...run.summary,
      temperature: Number(run.summary.temperature ?? summaryDefaults.temperature ?? 0.2),
      maxTokens: Number(run.summary.maxTokens ?? summaryDefaults.maxTokens ?? 1800),
      answer: String(run.summary.answer || "").slice(0, 20000),
    },
  };
}

export function sanitizeInfoFeedRunModelReferences(
  run: InfoFeedRunState,
  validAgentModelAlias: (value?: string) => string,
): InfoFeedRunState {
  const summaryModelAlias = validAgentModelAlias(run.summary?.modelAlias);
  return {
    ...run,
    turns: (run.turns || []).map((turn) => ({
      ...turn,
      summaryModelAlias: validAgentModelAlias(turn.summaryModelAlias),
    })),
    summary: {
      ...run.summary,
      modelAlias: summaryModelAlias,
    },
  };
}

export function normalizeInfoFeedHistoryCore(
  runs: InfoFeedRunState[],
  options: {
    validAgentModelAlias: (value?: string) => string;
    summaryDefaults: Pick<InfoFeedSummaryDefaults, "temperature" | "maxTokens">;
  },
) {
  const seen = new Set<string>();
  return runs
    .filter((run) => {
      const runId = String(run?.runId || "").trim();
      if (!runId || seen.has(runId)) {
        return false;
      }
      seen.add(runId);
      return true;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(String(left.completedAt || left.startedAt || ""));
      const rightTime = Date.parse(String(right.completedAt || right.startedAt || ""));
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, 20)
    .map((run) =>
      sanitizeInfoFeedRunModelReferences(
        compactInfoFeedRunForStorage(run, options.summaryDefaults),
        options.validAgentModelAlias,
      ),
    );
}
