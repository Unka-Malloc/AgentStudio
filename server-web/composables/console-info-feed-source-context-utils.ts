import type { KnowledgeSearchResult } from "../lib/types";
import type { InfoFeedRunState } from "../types/app";
import {
  INFO_FEED_CONTEXT_CHARS_PER_TOKEN,
  truncateInfoFeedText,
  type InfoFeedContextProfileBudgetRow,
} from "./console-info-feed-shared-utils";

export function isLowRelevanceSourceResult(item: KnowledgeSearchResult) {
  return String(item.relevanceTier || "").toLowerCase() === "low" ||
    item.lowRelevance === true ||
    item.contextEligible === false;
}

export function infoFeedSourceResultLine(item: KnowledgeSearchResult, index: number) {
  const tier = isLowRelevanceSourceResult(item) ? "低关联" : "高关联";
  return [
    `${index + 1}. ${item.title || "未命名来源"}（${tier}）`,
    item.evidenceId ? `证据：${item.evidenceId}` : "",
    item.score !== undefined ? `分数：${Number(item.score).toFixed(3)}` : "",
    item.snippet ? `片段：${truncateInfoFeedText(item.snippet, 260)}` : "",
  ].filter(Boolean).join("\n");
}

export function estimateInfoFeedContextTokens(
  chars: number,
  charsPerToken = INFO_FEED_CONTEXT_CHARS_PER_TOKEN,
) {
  return Math.ceil(Math.max(0, Number(chars || 0)) / charsPerToken);
}

export function infoFeedSourceContextBudgetChars(
  run: InfoFeedRunState | null | undefined,
  options: {
    profiles: InfoFeedContextProfileBudgetRow[];
    fallbackProfileId: string;
    charsPerToken?: number;
  },
) {
  const charsPerToken = options.charsPerToken || INFO_FEED_CONTEXT_CHARS_PER_TOKEN;
  const profileId = String(
    run?.summary.contextProfileId ||
      options.fallbackProfileId ||
      "context-128k",
  );
  const profile = options.profiles.find((item) => item.profileId === profileId);
  const tokenBudget = Number(
    profile?.knowledgeBudget ||
      (profile?.contextWindowTokens ? Math.floor(profile.contextWindowTokens * 0.28) : 0) ||
      (profileId.includes("1m") ? 320000 : profileId.includes("32k") ? 8000 : 36000),
  );
  return Math.max(4000, tokenBudget * charsPerToken);
}

export function buildInfoFeedSourceContextCore(
  run: InfoFeedRunState | null | undefined,
  options: {
    profiles: InfoFeedContextProfileBudgetRow[];
    fallbackProfileId: string;
    charsPerToken?: number;
  },
) {
  const charsPerToken = options.charsPerToken || INFO_FEED_CONTEXT_CHARS_PER_TOKEN;
  const response = run?.keyword.response;
  const allItems = ((response?.items || response?.results || []) as KnowledgeSearchResult[]);
  const highItems = allItems.filter((item) => !isLowRelevanceSourceResult(item));
  const lowItems = allItems.filter(isLowRelevanceSourceResult);
  const budget = infoFeedSourceContextBudgetChars(run, {
    ...options,
    charsPerToken,
  });
  const hasLowItems = lowItems.length > 0;
  const lowReserve = hasLowItems
    ? Math.min(Math.max(2400, Math.floor(budget * 0.12)), Math.floor(budget * 0.22))
    : 0;
  const highBudget = Math.max(1200, budget - lowReserve);
  const lines: string[] = [];
  let usedChars = 0;
  let highUsedChars = 0;
  let includedHigh = 0;
  for (const item of highItems) {
    const line = infoFeedSourceResultLine(item, includedHigh);
    if (lines.length > 0 && usedChars + line.length + 2 > highBudget) {
      break;
    }
    lines.push(line);
    usedChars += line.length + 2;
    highUsedChars += line.length + 2;
    includedHigh += 1;
  }
  const highOmitted = Math.max(0, highItems.length - includedHigh);
  let includedLow = 0;
  const lowLines: string[] = [];
  const lowHeader = "【低关联原始命中】";
  let lowUsedChars = 0;
  const lowBudget = Math.max(0, budget - usedChars - (hasLowItems ? lowHeader.length + 4 : 0));
  for (const item of lowItems) {
    const line = infoFeedSourceResultLine(item, includedLow);
    if (includedLow > 0 && lowUsedChars + line.length + 2 > lowBudget) {
      break;
    }
    if (includedLow === 0 && line.length + 2 > lowBudget) {
      break;
    }
    lowLines.push(line);
    lowUsedChars += line.length + 2;
    includedLow += 1;
  }
  if (lowLines.length > 0) {
    lines.push("【低关联原始命中】");
    lines.push(lowLines.join("\n\n"));
    usedChars += lowHeader.length + lowUsedChars + 4;
  }
  const lowOmitted = Math.max(0, lowItems.length - includedLow);
  const gateLines = [];
  const budgetTokens = estimateInfoFeedContextTokens(budget, charsPerToken);
  const usedTokens = estimateInfoFeedContextTokens(usedChars, charsPerToken);
  const highUsedTokens = estimateInfoFeedContextTokens(highUsedChars, charsPerToken);
  const lowUsedTokens = Math.max(0, usedTokens - highUsedTokens);
  if (highOmitted > 0) {
    gateLines.push(`高关联邮件进入 ${includedHigh}/${highItems.length} 封，省略 ${highOmitted} 封。`);
  } else if (highItems.length > 0) {
    gateLines.push(`高关联邮件已全部进入上下文（${includedHigh}/${highItems.length}）。`);
  }
  if (lowOmitted > 0) {
    gateLines.push(`低关联邮件进入 ${includedLow}/${lowItems.length} 封，省略 ${lowOmitted} 封。`);
  } else if (lowItems.length > 0) {
    gateLines.push(`低关联邮件已全部进入上下文（${includedLow}/${lowItems.length}）。`);
  }
  gateLines.push(`原文检索上下文预算约 ${budgetTokens.toLocaleString()} tokens，已使用约 ${usedTokens.toLocaleString()} tokens。`);
  return {
    text: lines.join("\n\n"),
    report: {
      budgetChars: budget,
      usedChars,
      remainingChars: Math.max(0, budget - usedChars),
      budgetTokens,
      usedTokens,
      remainingTokens: Math.max(0, budgetTokens - usedTokens),
      highBudgetChars: highBudget,
      lowReserveChars: lowReserve,
      highUsedTokens,
      lowUsedTokens,
      totalCount: allItems.length,
      highCount: highItems.length,
      lowCount: lowItems.length,
      includedHigh,
      includedLow,
      omittedHigh: highOmitted,
      omittedLow: lowOmitted,
      message: gateLines.join(" "),
    },
  };
}
