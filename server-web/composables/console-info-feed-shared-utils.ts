import type { InfoFeedStageStatus } from "../types/app";

export interface InfoFeedSummaryDefaults {
  modelAlias: string;
  contextProfileId: string;
  temperature: number;
  maxTokens: number;
}

export interface InfoFeedContextProfileBudgetRow {
  profileId: string;
  contextWindowTokens: number;
  knowledgeBudget: number;
}

export const INFO_FEED_CONTEXT_CHARS_PER_TOKEN = 3;

export function makeInfoFeedId(prefix = "info-feed") {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function truncateInfoFeedText(value: unknown, maxLength = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatFileSize(size: number) {
  const value = Number(size || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function infoFeedStatusLabel(status: InfoFeedStageStatus) {
  if (status === "running") return "运行中";
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  return "待开始";
}

export function infoFeedStatusTone(status: InfoFeedStageStatus) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "running") return "info";
  return "muted";
}
