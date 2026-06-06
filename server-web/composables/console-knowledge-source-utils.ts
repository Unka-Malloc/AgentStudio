import type { KnowledgeSource } from "../lib/types";
import { asRecord } from "./console-model-utils";

export function sourceSyncLabel(source: KnowledgeSource) {
  if (source.error) {
    return "异常";
  }
  if (Number(source.lastHydrationFailedCount || 0) > 0) {
    return "待下载";
  }
  if (["queued", "running"].includes(String(source.lastJobStatus || ""))) {
    return "处理中";
  }
  if (source.status === "pending") {
    return "等待同步";
  }
  if (source.indexStatus === "indexing") {
    return "建索引中";
  }
  if (!source.enabled) {
    return "已停用";
  }
  if (source.watcherStatus === "watching") {
    return "自动监听";
  }
  if (source.watcherStatus === "partial") {
    return "部分监听";
  }
  return "待同步";
}

export function sourceSyncTone(source: KnowledgeSource) {
  if (source.error || source.watcherStatus === "error" || source.lastJobStatus === "failed") {
    return "danger";
  }
  if (Number(source.lastHydrationFailedCount || 0) > 0) {
    return "warning";
  }
  if (["queued", "running"].includes(String(source.lastJobStatus || "")) || source.status === "pending") {
    return "warning";
  }
  if (source.indexStatus === "indexing") {
    return "warning";
  }
  if (source.indexStatus === "failed") {
    return "danger";
  }
  if (source.enabled && ["watching", "partial"].includes(String(source.watcherStatus || ""))) {
    return "success";
  }
  return "neutral";
}

export function sourceDownloadStatusLabel(source: KnowledgeSource) {
  if (source.hydrationEnabled === false) {
    return "已关闭";
  }
  switch (source.lastHydrationStatus) {
    case "readable":
      return "可读取";
    case "hydrated":
      return "已下载";
    case "partial":
      return "部分完成";
    default:
      return "未执行";
  }
}

export function sourceIndexStatusLabel(source: KnowledgeSource) {
  switch (source.indexStatus) {
    case "indexing":
      return "建索引中";
    case "indexed":
      return "已建索引";
    case "failed":
      return "索引失败";
    default:
      return "未建索引";
  }
}

export function sourceJobProgress(source: KnowledgeSource) {
  if (!source.lastJobId) {
    return 0;
  }
  if (source.lastJobStatus === "completed") {
    return 100;
  }
  return Math.max(0, Math.min(100, Number(source.lastJobProgressPercent || 0)));
}

export function uploadTraceTone(level: string) {
  if (level === "error") {
    return "danger";
  }
  if (level === "warning") {
    return "warning";
  }
  return "neutral";
}

export function traceProgressPercent(payload: Record<string, unknown>) {
  const session = asRecord(payload.session);
  const files = Array.isArray(session?.files) ? session.files : [];
  const totals = files.reduce(
    (acc, file) => {
      const record = asRecord(file) || {};
      acc.received += Number(record.receivedBytes || 0);
      acc.total += Number(record.byteSize || 0);
      return acc;
    },
    { received: 0, total: 0 },
  );
  if (totals.total > 0) {
    return Math.max(0, Math.min(100, (totals.received / totals.total) * 100));
  }
  if (payload.stage === "response_sent" || payload.stage === "accepted") {
    return 100;
  }
  return 0;
}

export function uploadTraceDetailText(payload: Record<string, unknown>) {
  const detail = {
    message: payload.message || "",
    requestId: payload.requestId || "",
    sessionId: payload.sessionId || asRecord(payload.session)?.sessionId || "",
    checkpointId: payload.checkpointId || asRecord(payload.session)?.checkpointId || "",
    code: payload.code || "",
    expectedOffset: payload.expectedOffset ?? "",
    offset: payload.offset ?? "",
    chunkBytes: payload.chunkBytes ?? "",
    request: payload.request || undefined,
    session: payload.session || undefined,
    redaction: payload.redaction || undefined,
  };
  return JSON.stringify(detail, null, 2);
}
