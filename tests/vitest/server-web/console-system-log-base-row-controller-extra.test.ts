import { describe, expect, it } from "vitest";
import { buildBaseServerLogRows } from "../../../server-web/composables/console-system-log-base-row-controller";

function readonlyValue<T>(value: T) {
  return { value };
}

describe("console system log base row controller extra coverage", () => {
  it("builds and sorts trace, job, source, and reference log rows", () => {
    const rows = buildBaseServerLogRows({
      activeKnowledgeSources: readonlyValue([
        {
          sourceId: "source-abcdef1234567890",
          label: "法律目录",
          directoryPath: "/cases",
          status: "active",
          enabled: true,
          watcherStatus: "watching",
          lastJobId: "job-source-abcdef1234567890",
          lastJobStatus: "completed",
          lastJobStage: "indexed",
          lastJobUpdatedAt: "2026-06-04T12:02:00.000Z",
          lastFileCount: 3,
          lastTotalBytes: 2048,
          createdAt: "2026-06-04T10:00:00.000Z",
        },
      ] as any[]),
      agentSelectionReferenceLogs: readonlyValue([
        {
          logId: "agent:selection",
          kindLabel: "智能体",
          displayId: "agent",
          target: "agent-a",
          status: "ok",
          statusLabel: "已选择",
          tone: "success",
          stage: "select",
          occurredAt: "2026-06-04T12:01:00.000Z",
          createdAt: "2026-06-04T12:01:00.000Z",
          progressPercent: 100,
          detail: "reference",
          error: "",
        },
      ] as any[]),
      knowledgeRecentJobs: readonlyValue([
        {
          id: "job-completed-abcdef1234567890",
          status: "completed",
          createdAt: "2026-06-04T11:00:00.000Z",
          updatedAt: "2026-06-04T12:03:00.000Z",
          progressPercent: 88,
          stage: "done",
          resultSummary: {
            emails: 1,
            transactions: 2,
            people: 3,
            warnings: 4,
          },
        },
      ] as any[]),
      uploadTraceEvents: readonlyValue([
        {
          id: "trace-1",
          offset: 7,
          type: "upload.chunk",
          publishedAt: "2026-06-04T12:04:00.000Z",
          payload: {
            error: "boom",
            functionName: "storeChunk",
            http: { method: "POST", path: "/api/upload" },
            layer: "store",
            level: "warning",
            message: "chunk accepted",
            requestId: "req-1",
            session: {
              checkpointId: "checkpoint-a",
              files: [
                { byteSize: 10, receivedBytes: 5 },
                { byteSize: 30, receivedBytes: 15 },
              ],
              sessionId: "session-a",
            },
            stage: "chunk_received",
          },
        },
      ] as any[]),
    });

    expect(rows.map((row) => row.logId)).toEqual([
      "upload-trace:trace-1",
      "job:job-completed-abcdef1234567890",
      "source:source-abcdef1234567890",
      "agent:selection",
    ]);

    expect(rows[0]).toMatchObject({
      kindLabel: "上传函数",
      displayId: "#7",
      target: "POST /api/upload",
      status: "warning",
      statusLabel: "chunk_received",
      tone: "warning",
      stage: "storeChunk",
      progressPercent: 50,
      error: "boom",
    });
    expect(rows[0].detail).toContain('"requestId": "req-1"');

    expect(rows[1]).toMatchObject({
      kindLabel: "入库任务",
      target: "job-completed-abcdef1234567890",
      status: "completed",
      statusLabel: "已完成",
      tone: "completed",
      stage: "done",
      progressPercent: 88,
      detail: "邮件 1 / 事务 2 / 人物 3 / 警告 4",
      error: "",
    });

    expect(rows[2]).toMatchObject({
      kindLabel: "目录管理",
      target: "法律目录",
      status: "active",
      statusLabel: "自动监听",
      tone: "success",
      stage: "indexed",
      progressPercent: 100,
      error: "",
    });
    expect(rows[2].detail).toContain("/cases · 3 个文件 · 2.0 KB");
  });

  it("uses fallback fields for sparse traces, failed jobs, and errored sources", () => {
    const rows = buildBaseServerLogRows({
      activeKnowledgeSources: readonlyValue([
        {
          sourceId: "source-error",
          directoryPath: "/broken",
          status: "pending",
          error: "permission denied",
          lastHydrationFailedCount: 2,
          lastEventAt: "2026-06-04T09:00:00.000Z",
          lastFileCount: 0,
          lastTotalBytes: 0,
        },
      ] as any[]),
      agentSelectionReferenceLogs: readonlyValue([] as any[]),
      knowledgeRecentJobs: readonlyValue([
        {
          id: "job-failed",
          status: "failed",
          createdAt: "2026-06-04T08:00:00.000Z",
          updatedAt: "",
          finishedAt: "2026-06-04T09:30:00.000Z",
          progressPercent: 12,
          stage: "",
          error: "parser failed",
        },
      ] as any[]),
      uploadTraceEvents: readonlyValue([
        {
          id: "trace-accepted",
          offset: 2,
          type: "upload.accepted",
          publishedAt: "2026-06-04T10:00:00.000Z",
          payload: {
            level: "info",
            sessionId: "session-only",
            stage: "accepted",
          },
        },
      ] as any[]),
    });

    expect(rows.map((row) => row.logId)).toEqual([
      "upload-trace:trace-accepted",
      "job:job-failed",
      "source:source-error",
    ]);
    expect(rows[0]).toMatchObject({
      kindLabel: "上传报文",
      target: "session-only",
      status: "info",
      statusLabel: "accepted",
      tone: "neutral",
      stage: "",
      progressPercent: 100,
    });
    expect(rows[1]).toMatchObject({
      statusLabel: "失败",
      tone: "failed",
      detail: "parser failed",
      error: "parser failed",
    });
    expect(rows[2]).toMatchObject({
      target: "/broken",
      statusLabel: "异常",
      tone: "danger",
      progressPercent: 0,
      detail: "/broken · 0 个文件 · 0 B",
      error: "permission denied",
    });
  });
});
