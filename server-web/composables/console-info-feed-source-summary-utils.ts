import type { KnowledgeSearchResult } from "../lib/types";
import {
  extractEvidenceRefsFromText,
  uniqueEvidenceRefs,
} from "../lib/rendering";
import type { InfoFeedRunState } from "../types/app";
import {
  formatFileSize,
  infoFeedStatusLabel,
  truncateInfoFeedText,
} from "./console-info-feed-shared-utils";

export function buildInfoFeedSourceSummaryCore(
  run: InfoFeedRunState,
  sourceContext: {
    text: string;
    report: { message?: string };
  },
) {
  const sourceContextText = [
    sourceContext.report.message ? `上下文门禁：${sourceContext.report.message}` : "",
    sourceContext.text,
  ].filter(Boolean).join("\n\n");
  const attachmentLines = run.attachments.map((attachment, index) => [
    `${index + 1}. ${attachment.name}（${infoFeedStatusLabel(attachment.status)}，${formatFileSize(attachment.size)}）`,
    attachment.text ? `摘录：${truncateInfoFeedText(attachment.text, 420)}` : "",
    attachment.error ? `错误：${attachment.error}` : "",
  ].filter(Boolean).join("\n"));
  const followUpLines = run.followUp
    ? [
        "【上一轮信息流上下文】",
        `上一轮问题：${run.followUp.parentQuery}`,
        `当前追问：${run.followUp.question}`,
        run.followUp.parentEvidenceRefs.length
          ? `上一轮证据编号：${run.followUp.parentEvidenceRefs.join("、")}`
          : "上一轮证据编号：无",
        "",
        "上一轮总结：",
        run.followUp.parentSummary,
        "",
      ]
    : [];
  return [
    ...followUpLines,
    "【附件处理】",
    attachmentLines.length ? attachmentLines.join("\n\n") : "无附件。",
    "",
    "【原文检索结果】",
    sourceContextText || run.keyword.error || "未找到原文检索结果。",
    "",
    "【智能规划 + 知识库检索结果】",
    run.agent.response?.answer
      ? truncateInfoFeedText(run.agent.response.answer, 4200)
      : (run.agent.error || "智能规划未返回最终回答。"),
  ].join("\n");
}

export function infoFeedRunEvidenceRefsCore(run: InfoFeedRunState) {
  return uniqueEvidenceRefs([
    ...(((run.keyword.response?.items || run.keyword.response?.results || []) as KnowledgeSearchResult[])
      .map((item) => String(item.evidenceId || ""))
      .filter(Boolean)),
    ...extractEvidenceRefsFromText(run.agent.response?.answer || ""),
    ...extractEvidenceRefsFromText(run.summary.answer || ""),
  ]);
}
