import type {
  KnowledgeSource,
  ProtocolEvent,
  SplitJob,
} from "../lib/types";
import type { KnowledgeLogRow } from "../types/app";
import { shortId } from "./console-agent-explore-presentation";
import { jobStatusLabels } from "./console-defaults";
import { formatBytes, jobStatusTone, parseTime } from "./console-format-utils";
import {
  sourceJobProgress,
  sourceSyncLabel,
  sourceSyncTone,
  traceProgressPercent,
  uploadTraceDetailText,
  uploadTraceTone,
} from "./console-knowledge-source-utils";
import { asRecord } from "./console-model-utils";
import type { ReadonlyValue } from "./console-system-log-row-utils";

export type ConsoleBaseServerLogRowOptions = {
  activeKnowledgeSources: ReadonlyValue<KnowledgeSource[]>;
  agentSelectionReferenceLogs: ReadonlyValue<KnowledgeLogRow[]>;
  knowledgeRecentJobs: ReadonlyValue<SplitJob[]>;
  uploadTraceEvents: ReadonlyValue<ProtocolEvent[]>;
};

export function buildBaseServerLogRows(options: ConsoleBaseServerLogRowOptions): KnowledgeLogRow[] {
  const traceRows = options.uploadTraceEvents.value.map((event): KnowledgeLogRow => {
    const payload = asRecord(event.payload) || {};
    const http = asRecord(payload.http) || {};
    const level = String(payload.level || "info");
    const functionName = String(payload.functionName || "");
    const stage = String(payload.stage || event.type || "");
    const message = String(payload.message || "");
    const layer = String(payload.layer || "");
    return {
      logId: `upload-trace:${event.id}`,
      kindLabel: layer === "store" ? "上传函数" : "上传报文",
      displayId: `#${event.offset}`,
      target: [http.method, http.path].filter(Boolean).join(" ") || functionName || String(payload.sessionId || ""),
      status: level,
      statusLabel: stage || level,
      tone: uploadTraceTone(level),
      stage: functionName || message,
      occurredAt: event.publishedAt || "",
      createdAt: event.publishedAt || "",
      progressPercent: traceProgressPercent(payload),
      detail: uploadTraceDetailText(payload),
      error: String(payload.error || ""),
    };
  });

  const jobRows = options.knowledgeRecentJobs.value.map((job): KnowledgeLogRow => {
    const summary = job.resultSummary
      ? [
          `邮件 ${job.resultSummary.emails || 0}`,
          `事务 ${job.resultSummary.transactions || 0}`,
          `人物 ${job.resultSummary.people || 0}`,
          `警告 ${job.resultSummary.warnings || 0}`,
        ].join(" / ")
      : "";
    return {
      logId: `job:${job.id}`,
      kindLabel: "入库任务",
      displayId: shortId(job.id),
      target: job.id,
      status: job.status,
      statusLabel: jobStatusLabels[job.status] || job.status,
      tone: jobStatusTone(job.status),
      stage: job.stage || "",
      occurredAt: job.updatedAt || job.finishedAt || job.startedAt || job.createdAt || "",
      createdAt: job.createdAt || "",
      progressPercent: Number(job.progressPercent || 0),
      detail: summary || job.error || "",
      error: job.error || "",
    };
  });

  const sourceRows = options.activeKnowledgeSources.value.map((source): KnowledgeLogRow => ({
    logId: `source:${source.sourceId}`,
    kindLabel: "目录管理",
    displayId: shortId(source.sourceId),
    target: source.label || source.directoryPath || source.sourceId,
    status: source.status || source.lastJobStatus || "",
    statusLabel: sourceSyncLabel(source),
    tone: sourceSyncTone(source),
    stage: source.lastJobStage || source.pendingReason || source.watcherStatus || "",
    occurredAt:
      source.lastJobUpdatedAt ||
      source.lastSyncedAt ||
      source.lastScanAt ||
      source.lastEventAt ||
      source.updatedAt ||
      source.createdAt ||
      "",
    createdAt: source.createdAt || "",
    progressPercent: sourceJobProgress(source),
    detail: [
      source.directoryPath,
      `${source.lastFileCount || 0} 个文件`,
      formatBytes(source.lastTotalBytes || 0),
      source.lastJobId ? `任务 ${shortId(source.lastJobId)}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    error: source.error || "",
  }));

  return [...traceRows, ...jobRows, ...sourceRows, ...options.agentSelectionReferenceLogs.value].sort(
    (left, right) => parseTime(right.occurredAt) - parseTime(left.occurredAt),
  );
}
