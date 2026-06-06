import type { KnowledgeSearchResult } from "../lib/types";
import type { InfoFeedRunState } from "../types/app";
import { truncateInfoFeedText } from "./console-info-feed-shared-utils";

export function buildInfoFeedSummaryQuestionCore(
  run: InfoFeedRunState,
  sourceSummary: string,
) {
  return [
    run.followUp ? `用户追问：${run.followUp.question}` : `用户问题：${run.query}`,
    "",
    sourceSummary,
    "",
    "请把以上两路检索和附件处理结果合并成一份面向用户的最终回答。",
    "要求：",
    "1. 先给出直接结论，再列出关键证据和不确定性。",
    "2. 保留 evidence:: 或 ev_ 证据编号，便于页面点击查看。",
    "3. 如果原文检索和智能规划互相冲突，要明确说明冲突。",
    "4. 不要编造附件、证据、日期、金额或来源。",
    "5. 不要频繁提问。只有在没有人类选择就无法继续检索、归纳或执行下一步时，才在答案末尾追加 fenced block：```pact_user_options 换行 JSON 换行 ```。",
    "   JSON 示例：{\"prompt\":\"你希望优先确认哪类内容？\",\"reason\":\"当前证据覆盖不足。\",\"options\":[{\"label\":\"继续补证据\",\"description\":\"扩大检索范围。\",\"followUpQuestion\":\"请继续补充直接证据。\"}]}",
  ].join("\n");
}

export function fallbackInfoFeedSummaryCore(run: InfoFeedRunState) {
  const keywordItems = ((run.keyword.response?.items || run.keyword.response?.results || []) as KnowledgeSearchResult[]).slice(0, 5);
  const lines = [
    run.followUp
      ? `根据本次信息流追问，问题「${run.followUp.question}」已有以下可用结果：`
      : `根据本次信息流检索，问题「${run.query}」已有以下可用结果：`,
    run.followUp ? `上一轮问题：${run.followUp.parentQuery}` : "",
    "",
    "---",
    "",
    "1. 原文检索",
    keywordItems.length
      ? keywordItems.map((item, index) =>
          `${index + 1}. ${item.title || "未命名来源"}${item.evidenceId ? `（${item.evidenceId}）` : ""}\n${truncateInfoFeedText(item.snippet || "", 220)}`,
        ).join("\n\n")
      : (run.keyword.error || "没有找到可展示的原文检索结果。"),
    "",
    "---",
    "",
    "2. 智能规划",
    run.agent.response?.answer
      ? truncateInfoFeedText(run.agent.response.answer, 1800)
      : (run.agent.error || "智能规划没有返回可用回答。"),
  ];
  return lines.join("\n");
}
