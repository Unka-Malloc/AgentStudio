import type {
  InfoFeedClarification,
  InfoFeedClarificationOption,
  InfoFeedExpertFeedback,
  InfoFeedRunState,
} from "../types/app";
import { asRecord, modelAgentUid } from "./console-model-utils";
import { makeInfoFeedId } from "./console-info-feed-shared-utils";

export function archiveInfoFeedExpertFeedbackCore(
  run: InfoFeedRunState,
  clarification: InfoFeedClarification,
  option: InfoFeedClarificationOption,
) {
  const createdAt = new Date().toISOString();
  const feedbackId = `feedback::info-feed::${modelAgentUid(
    run.runId,
    clarification.questionId,
    option.optionId,
    option.followUpQuestion,
  ).replace(/^agent_/, "")}`;
  const archived: InfoFeedExpertFeedback = {
    feedbackId,
    questionId: clarification.questionId,
    anchor: clarification.anchor || "report",
    prompt: clarification.prompt,
    reason: clarification.reason,
    selectedOptionId: option.optionId,
    selectedLabel: option.label,
    selectedDescription: option.description,
    followUpQuestion: option.followUpQuestion,
    sourceQuery: run.followUp?.question || run.query,
    createdAt,
    syncedAt: "",
    syncStatus: "pending",
    syncError: "",
  };
  run.expertFeedback = [
    ...(run.expertFeedback || []).filter((item) => item.feedbackId !== feedbackId),
    archived,
  ];
  return archived;
}

export function normalizeInfoFeedClarificationOptionCore(
  value: unknown,
  index: number,
): InfoFeedClarificationOption | null {
  const record = asRecord(value) || {};
  const label = String(record.label || record.title || "").trim();
  const followUpQuestion = String(record.followUpQuestion || record.query || record.value || label || "").trim();
  if (!label || !followUpQuestion) {
    return null;
  }
  return {
    optionId: String(record.optionId || record.id || `option-${index + 1}`),
    label: label.slice(0, 64),
    description: String(record.description || record.reason || "").trim().slice(0, 180),
    followUpQuestion: followUpQuestion.slice(0, 800),
  };
}

export function extractInfoFeedClarificationCore(
  answer: string,
): { answer: string; clarification?: InfoFeedClarification } {
  const source = String(answer || "");
  let cleaned = source;
  let clarification: InfoFeedClarification | undefined;
  const blockPattern = /```(?:pact_user_options|pact-options|json)\s*([\s\S]*?)```/gi;
  for (const match of source.matchAll(blockPattern)) {
    try {
      const parsed = JSON.parse(match[1].trim().replace(/^json\s*/i, ""));
      const record = asRecord(parsed) || {};
      const options = Array.isArray(record.options)
        ? record.options
            .map((item, index) => normalizeInfoFeedClarificationOptionCore(item, index))
            .filter((item): item is InfoFeedClarificationOption => Boolean(item))
            .slice(0, 4)
        : [];
      if (options.length > 0) {
        clarification = {
          questionId: String(record.questionId || makeInfoFeedId("question")),
          prompt: String(record.prompt || record.question || "需要你确认下一步方向。").trim().slice(0, 220),
          reason: String(record.reason || "").trim().slice(0, 240),
          anchor: record.anchor === "summary" ? "summary" : "report",
          status: "open",
          selectedOptionId: "",
          options,
        };
        cleaned = cleaned.replace(match[0], "").trim();
        break;
      }
    } catch {
      // Ignore regular JSON/code blocks that are not clarification options.
    }
  }
  return {
    answer: cleaned.trim() || source.trim(),
    clarification,
  };
}

export function buildFallbackInfoFeedClarificationCore(
  run: InfoFeedRunState,
): InfoFeedClarification | undefined {
  const needsChoice = run.summary.fallback || Boolean(run.summary.error);
  if (!needsChoice) {
    return undefined;
  }
  return {
    questionId: makeInfoFeedId("question"),
    prompt: "这次结果存在不确定内容，你希望下一步怎么处理？",
    reason: run.summary.error || "当前证据不足或结论范围不够明确。",
    anchor: run.summary.answer ? "report" : "summary",
    status: "open",
    selectedOptionId: "",
    options: [
      {
        optionId: "more-evidence",
        label: "继续补证据",
        description: "扩大原文检索和智能规划范围，优先找直接证据。",
        followUpQuestion: "请继续补充直接证据，扩大检索范围，并标明哪些结论仍然无法确认。",
      },
      {
        optionId: "strict-only",
        label: "只保留已证实",
        description: "删除推测内容，只输出现有证据能支持的结论。",
        followUpQuestion: "请基于现有证据重新整理，只保留已经被证据直接支持的结论。",
      },
      {
        optionId: "change-angle",
        label: "换角度查",
        description: "从主体、时间、金额、来源等角度重新规划检索。",
        followUpQuestion: "请从主体、时间、金额、来源几个角度重新规划检索，并说明每个角度的命中情况。",
      },
    ],
  };
}

export function applyInfoFeedSummaryAnswerCore(
  run: InfoFeedRunState,
  answer: string,
  fallback: boolean,
  error = "",
) {
  const extracted = extractInfoFeedClarificationCore(answer);
  run.summary.answer = extracted.answer || answer;
  run.summary.fallback = fallback;
  run.summary.error = error;
  run.clarification = extracted.clarification || buildFallbackInfoFeedClarificationCore(run);
}
