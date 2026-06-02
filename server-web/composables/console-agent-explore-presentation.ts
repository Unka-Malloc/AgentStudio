import type { AgentExploreSession, HistorySessionPanelItem } from "../types/app";
import { asRecord } from "./console-model-utils";

export function shortId(value: unknown) {
  const text = String(value || "").trim();
  if (text.length <= 16) {
    return text || "--";
  }
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function isAgentExploreDraftRunId(runId: unknown) {
  return String(runId || "").startsWith("draft:");
}

export function agentExplorePhaseLabel(phase: unknown) {
  const value = String(phase || "");
  if (value === "model_calling") {
    return "模型决策";
  }
  if (value === "tool_selected") {
    return "已选择工具";
  }
  if (value === "tool_calling") {
    return "调用工具";
  }
  if (value === "tool_result") {
    return "工具返回";
  }
  if (value === "answer_ready") {
    return "生成答案";
  }
  if (value === "completed") {
    return "已完成";
  }
  if (value === "failed") {
    return "失败";
  }
  return value || "运行中";
}

export function agentExploreStepSummary(step: unknown) {
  const value = asRecord(step) || {};
  const toolCount = Array.isArray(value.toolCalls) ? value.toolCalls.length : 0;
  const resultCount = Array.isArray(value.toolResults) ? value.toolResults.length : 0;
  const phase = agentExplorePhaseLabel(value.phase || value.status);
  if (!toolCount && !resultCount) {
    return phase;
  }
  return `${phase} · 工具 ${toolCount} · 返回 ${resultCount}`;
}

export function agentExploreResultKey(step: unknown, toolResult: unknown, index: number) {
  const stepValue = asRecord(step) || {};
  const resultValue = asRecord(toolResult) || {};
  return [
    stepValue.iteration || "step",
    resultValue.tool || "tool",
    resultValue.startedAt || "",
    resultValue.completedAt || "",
    index,
  ].join(":");
}

export function agentExploreTabTitle(session: AgentExploreSession) {
  if (isAgentExploreDraftRunId(session.runId) && !session.query.trim()) {
    return "新会话";
  }
  return session.query || "未命名探索";
}

export function agentExploreTabMeta(session: AgentExploreSession) {
  if (isAgentExploreDraftRunId(session.runId)) {
    return "草稿";
  }
  return `${session.status || "unknown"} · ${shortId(session.runId)}`;
}

export function agentExploreEventLabel(event: unknown) {
  const value = asRecord(event) || {};
  return String(value.label || value.type || "状态更新");
}

export function agentExploreEventStatus(event: unknown) {
  const value = asRecord(event) || {};
  return String(value.status || "running");
}

export function agentExploreHistoryPanelItemsCore(
  sessions: AgentExploreSession[],
  options: {
    activeTabId: string;
    isBusy: (session: AgentExploreSession) => boolean;
    sessionLabel: (session: AgentExploreSession) => string;
  },
): HistorySessionPanelItem[] {
  return sessions.map((session) => {
    const label = options.sessionLabel(session);
    return {
      id: session.runId,
      title: label,
      meta: `${session.status || "unknown"} · ${shortId(session.runId)}`,
      preview: session.answerPreview || "",
      active: session.runId === options.activeTabId,
      disabled: options.isBusy(session),
      deleteLabel: `删除历史会话 ${label}`,
    };
  });
}
