import type {
  InfoFeedRunState,
  InfoFeedTurnSnapshot,
} from "../types/app";
import { truncateInfoFeedText } from "./console-info-feed-shared-utils";

export function infoFeedTurnQuestionCore(turn: InfoFeedTurnSnapshot) {
  return turn.followUpQuestion || turn.query || "未记录问题";
}

export function buildInfoFeedSourceSearchQueryCore(run: InfoFeedRunState) {
  if (!run.followUp) {
    return run.query;
  }
  return [
    run.followUp.parentQuery,
    run.followUp.question,
  ].filter(Boolean).join("\n");
}

export function buildInfoFeedAgentQueryCore(run: InfoFeedRunState) {
  if (!run.followUp) {
    return run.query;
  }
  return [
    "这是一次基于上一轮信息流结果的追问。",
    "",
    `上一轮问题：${run.followUp.parentQuery}`,
    "",
    "上一轮总结：",
    run.followUp.parentSummary,
    "",
    run.followUp.parentEvidenceRefs.length
      ? `上一轮证据编号：${run.followUp.parentEvidenceRefs.join("、")}`
      : "上一轮证据编号：无",
    "",
    `用户追问：${run.followUp.question}`,
    "",
    "请优先利用上一轮上下文；需要新证据时继续调用工具检索。回答必须保留可复核证据编号。",
  ].join("\n");
}

export function infoFeedAgentRecentTurnsCore(run: InfoFeedRunState) {
  return [
    ...(run.turns || []).map((turn) => ({
      role: "assistant",
      query: infoFeedTurnQuestionCore(turn),
      summary: truncateInfoFeedText(turn.summaryAnswer, 1800),
      evidenceRefs: turn.evidenceRefs || [],
      completedAt: turn.completedAt,
    })),
    ...(run.followUp
      ? [
          {
            role: "user" as const,
            query: run.followUp.question,
            parentQuery: run.followUp.parentQuery,
          },
        ]
      : []),
  ].slice(-12);
}

export function infoFeedAgentExpertGuidanceCore(run: InfoFeedRunState) {
  return [
    ...(run.turns || []).flatMap((turn) => turn.expertFeedback || []),
    ...(run.expertFeedback || []),
  ].map((item) => ({
    feedbackId: item.feedbackId,
    query: item.sourceQuery,
    label: item.selectedLabel,
    instruction: item.followUpQuestion,
    reason: item.reason || item.prompt,
    evidenceRefs: [],
    createdAt: item.createdAt,
    context: {
      gold: true,
      humanExpert: true,
      selectedOption: {
        label: item.selectedLabel,
        followUpQuestion: item.followUpQuestion,
      },
    },
  }));
}
