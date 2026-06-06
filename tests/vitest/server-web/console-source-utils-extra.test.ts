import { describe, expect, it } from "vitest";
import {
  buildInfoFeedSourceContextCore,
  estimateInfoFeedContextTokens,
  infoFeedSourceContextBudgetChars,
  infoFeedSourceResultLine,
  isLowRelevanceSourceResult,
} from "../../../server-web/composables/console-info-feed-source-context-utils";
import {
  sourceDownloadStatusLabel,
  sourceIndexStatusLabel,
  sourceJobProgress,
  sourceSyncLabel,
  sourceSyncTone,
  traceProgressPercent,
  uploadTraceDetailText,
  uploadTraceTone,
} from "../../../server-web/composables/console-knowledge-source-utils";

function makeRun(items: any[] = [], contextProfileId = "context-128k") {
  return {
    keyword: {
      response: {
        items,
      },
    },
    summary: {
      contextProfileId,
    },
  } as any;
}

describe("console info feed source context utils", () => {
  it("classifies relevance and formats source result lines", () => {
    expect(isLowRelevanceSourceResult({ relevanceTier: "LOW" } as any)).toBe(true);
    expect(isLowRelevanceSourceResult({ lowRelevance: true } as any)).toBe(true);
    expect(isLowRelevanceSourceResult({ contextEligible: false } as any)).toBe(true);
    expect(isLowRelevanceSourceResult({ relevanceTier: "high" } as any)).toBe(false);

    const line = infoFeedSourceResultLine({
      title: "",
      evidenceId: "ev-1",
      score: 0.12345,
      snippet: "alpha ".repeat(80),
      contextEligible: false,
    } as any, 2);

    expect(line).toContain("3. 未命名来源（低关联）");
    expect(line).toContain("证据：ev-1");
    expect(line).toContain("分数：0.123");
    expect(line).toContain("片段：");
    expect(line.length).toBeLessThan(360);
  });

  it("estimates budgets from explicit profiles and fallback profile ids", () => {
    expect(estimateInfoFeedContextTokens(0)).toBe(0);
    expect(estimateInfoFeedContextTokens(-12)).toBe(0);
    expect(estimateInfoFeedContextTokens(7, 3)).toBe(3);
    expect(infoFeedSourceContextBudgetChars(makeRun([], "small"), {
      profiles: [{ profileId: "small", contextWindowTokens: 0, knowledgeBudget: 1000 }],
      fallbackProfileId: "context-128k",
      charsPerToken: 4,
    })).toBe(4000);
    expect(infoFeedSourceContextBudgetChars(makeRun([], "window"), {
      profiles: [{ profileId: "window", contextWindowTokens: 100000, knowledgeBudget: 0 }],
      fallbackProfileId: "context-128k",
      charsPerToken: 3,
    })).toBe(84000);
    expect(infoFeedSourceContextBudgetChars(makeRun([], ""), {
      profiles: [],
      fallbackProfileId: "context-1m",
      charsPerToken: 3,
    })).toBe(960000);
    expect(infoFeedSourceContextBudgetChars(makeRun([], ""), {
      profiles: [],
      fallbackProfileId: "context-32k",
      charsPerToken: 3,
    })).toBe(24000);
  });

  it("builds high and low relevance source context with gate accounting", () => {
    const highA = { title: "High A", evidenceId: "ev-a", score: 0.9, snippet: "A".repeat(800) };
    const highB = { title: "High B", evidenceId: "ev-b", score: 0.8, snippet: "B".repeat(800) };
    const highC = { title: "High C", evidenceId: "ev-c", score: 0.7, snippet: "C".repeat(800) };
    const lowA = { title: "Low A", evidenceId: "ev-l", score: 0.2, snippet: "low", relevanceTier: "low" };
    const result = buildInfoFeedSourceContextCore(
      makeRun([highA, highB, highC, lowA], "tiny"),
      {
        profiles: [{ profileId: "tiny", contextWindowTokens: 0, knowledgeBudget: 4000 }],
        fallbackProfileId: "context-128k",
        charsPerToken: 1,
      },
    );

    expect(result.text).toContain("High A");
    expect(result.text).toContain("【低关联原始命中】");
    expect(result.text).toContain("Low A");
    expect(result.report).toMatchObject({
      budgetChars: 4000,
      totalCount: 4,
      highCount: 3,
      lowCount: 1,
      includedLow: 1,
      omittedLow: 0,
    });
    expect(result.report.includedHigh).toBeGreaterThan(0);
    expect(result.report.message).toContain("原文检索上下文预算约");
  });
});

describe("console knowledge source utils", () => {
  it("formats source sync labels, tones and job progress", () => {
    expect(sourceSyncLabel({ error: "boom" } as any)).toBe("异常");
    expect(sourceSyncLabel({ lastHydrationFailedCount: 2 } as any)).toBe("待下载");
    expect(sourceSyncLabel({ lastJobStatus: "running" } as any)).toBe("处理中");
    expect(sourceSyncLabel({ status: "pending" } as any)).toBe("等待同步");
    expect(sourceSyncLabel({ indexStatus: "indexing" } as any)).toBe("建索引中");
    expect(sourceSyncLabel({ enabled: false } as any)).toBe("已停用");
    expect(sourceSyncLabel({ enabled: true, watcherStatus: "watching" } as any)).toBe("自动监听");
    expect(sourceSyncLabel({ enabled: true, watcherStatus: "partial" } as any)).toBe("部分监听");
    expect(sourceSyncLabel({ enabled: true } as any)).toBe("待同步");

    expect(sourceSyncTone({ error: "boom" } as any)).toBe("danger");
    expect(sourceSyncTone({ watcherStatus: "error" } as any)).toBe("danger");
    expect(sourceSyncTone({ lastJobStatus: "failed" } as any)).toBe("danger");
    expect(sourceSyncTone({ lastHydrationFailedCount: 1 } as any)).toBe("warning");
    expect(sourceSyncTone({ lastJobStatus: "queued" } as any)).toBe("warning");
    expect(sourceSyncTone({ status: "pending" } as any)).toBe("warning");
    expect(sourceSyncTone({ indexStatus: "failed" } as any)).toBe("danger");
    expect(sourceSyncTone({ enabled: true, watcherStatus: "watching" } as any)).toBe("success");
    expect(sourceSyncTone({ enabled: true } as any)).toBe("neutral");

    expect(sourceJobProgress({} as any)).toBe(0);
    expect(sourceJobProgress({ lastJobId: "job-1", lastJobStatus: "completed" } as any)).toBe(100);
    expect(sourceJobProgress({ lastJobId: "job-1", lastJobProgressPercent: 140 } as any)).toBe(100);
    expect(sourceJobProgress({ lastJobId: "job-1", lastJobProgressPercent: -10 } as any)).toBe(0);
  });

  it("formats hydration, index and upload trace states", () => {
    expect(sourceDownloadStatusLabel({ hydrationEnabled: false } as any)).toBe("已关闭");
    expect(sourceDownloadStatusLabel({ lastHydrationStatus: "readable" } as any)).toBe("可读取");
    expect(sourceDownloadStatusLabel({ lastHydrationStatus: "hydrated" } as any)).toBe("已下载");
    expect(sourceDownloadStatusLabel({ lastHydrationStatus: "partial" } as any)).toBe("部分完成");
    expect(sourceDownloadStatusLabel({} as any)).toBe("未执行");

    expect(sourceIndexStatusLabel({ indexStatus: "indexing" } as any)).toBe("建索引中");
    expect(sourceIndexStatusLabel({ indexStatus: "indexed" } as any)).toBe("已建索引");
    expect(sourceIndexStatusLabel({ indexStatus: "failed" } as any)).toBe("索引失败");
    expect(sourceIndexStatusLabel({} as any)).toBe("未建索引");

    expect(uploadTraceTone("error")).toBe("danger");
    expect(uploadTraceTone("warning")).toBe("warning");
    expect(uploadTraceTone("info")).toBe("neutral");

    expect(traceProgressPercent({
      session: {
        files: [
          { receivedBytes: 40, byteSize: 100 },
          { receivedBytes: 10, byteSize: 100 },
        ],
      },
    })).toBe(25);
    expect(traceProgressPercent({ stage: "accepted" })).toBe(100);
    expect(traceProgressPercent({ stage: "response_sent" })).toBe(100);
    expect(traceProgressPercent({ stage: "uploading" })).toBe(0);

    const detail = JSON.parse(uploadTraceDetailText({
      message: "chunk mismatch",
      requestId: "req-1",
      session: { sessionId: "session-1", checkpointId: "checkpoint-1" },
      code: "offset_mismatch",
      expectedOffset: 100,
      offset: 80,
      chunkBytes: 20,
      request: { method: "POST" },
      redaction: { secret: true },
    }));
    expect(detail).toMatchObject({
      message: "chunk mismatch",
      requestId: "req-1",
      sessionId: "session-1",
      checkpointId: "checkpoint-1",
      code: "offset_mismatch",
      expectedOffset: 100,
      offset: 80,
      chunkBytes: 20,
      request: { method: "POST" },
      redaction: { secret: true },
    });
  });
});
