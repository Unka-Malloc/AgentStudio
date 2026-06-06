// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  candidateTextFromRecord,
  compactReadableText,
  emailSubjectFromText,
  evidenceDisplayTitle,
  htmlMetaHeader,
  htmlToReadableText,
  knowledgeFusionSummary,
  knowledgeResultAssetCount,
  knowledgeResultEvidenceId,
  knowledgeResultHierarchyPath,
  knowledgeResultScore,
  knowledgeResultSnippet,
  knowledgeResultTitle,
  normalizeSearchResults,
  readableSnippetFromText,
} from "../../../server-web/composables/console-knowledge-search-utils";
import {
  INFO_FEED_FETCH_RETRY_LIMIT,
  InfoFeedRetryExhaustedError,
  clearInfoFeedRetryState,
  infoFeedAgentProgressFromResultCore,
  infoFeedRetryMessageForRun,
  infoFeedRetryStageLabel,
  infoFeedSearchCacheKey,
  isInfoFeedRetryExhaustedError,
  isModelConfigurationError,
  isTransientFetchError,
  setInfoFeedRetryState,
  withInfoFeedFetchRetry,
} from "../../../server-web/composables/console-info-feed-run-utils";
import type { InfoFeedRunState } from "../../../server-web/types/app";

function makeRun(overrides: Partial<InfoFeedRunState> = {}): InfoFeedRunState {
  return {
    runId: "run-1",
    query: "Pact 测试",
    startedAt: "2026-06-04T00:00:00.000Z",
    completedAt: "",
    attachments: [],
    expertFeedback: [],
    turns: [],
    keyword: {
      status: "idle",
      progress: 0,
      stage: "",
      fromCache: false,
      response: null,
      error: "",
    },
    agent: {
      status: "idle",
      progress: 0,
      runId: "",
      workspaceId: "",
      response: null,
      error: "",
    },
    summary: {
      status: "idle",
      progress: 0,
      modelAlias: "",
      contextProfileId: "",
      parametersOpen: false,
      answer: "",
      error: "",
      fallback: false,
    },
    ...overrides,
  };
}

describe("console knowledge search utils", () => {
  it("normalizes result containers and readable snippets", () => {
    expect(normalizeSearchResults(null)).toEqual([]);
    expect(normalizeSearchResults({ items: [{ itemId: "item-1" }] })).toEqual([{ itemId: "item-1" }]);
    expect(normalizeSearchResults({ results: [{ itemId: "item-2" }] })).toEqual([{ itemId: "item-2" }]);
    expect(normalizeSearchResults({ evidencePacks: [{ evidenceId: "ev-1" }] })).toEqual([{ evidenceId: "ev-1" }]);

    expect(compactReadableText("  one\n\n two   three  ", 100)).toBe("one two three");
    expect(compactReadableText("abcdef", 4)).toBe("abc…");
    expect(readableSnippetFromText("")).toBe("");
    expect(readableSnippetFromText("<html><head><style>.x{}</style></head><body>Hello <script>bad()</script>World</body></html>")).toBe("Hello World");
    expect(htmlToReadableText("<article>Alpha&nbsp;<strong>Beta</strong></article>")).toBe("Alpha Beta");
    expect(htmlMetaHeader("<meta name=\"message:raw-header:Subject\" content=\"Quarterly Update\">", "Subject")).toBe("Quarterly Update");
    expect(htmlMetaHeader("<div>No meta</div>", "Subject")).toBe("");
  });

  it("derives titles, snippets, evidence ids, scores and hierarchy paths", () => {
    const result = {
      itemId: "item-1",
      documentId: "doc-1",
      evidenceId: "ev-1",
      score: 0.45678,
      assets: [{ id: "asset-1" }, { id: "asset-2" }],
      payload: {
        blocks: [
          { text: "Subject: Encoded Mail\nFrom: unit@example.test\n\nBody text from block" },
          { snippet: "ignored because first block already contributes" },
        ],
      },
      hierarchy: {
        documentId: "doc-1",
        sectionId: "sec-2",
      },
    } as any;

    expect(candidateTextFromRecord(result)).toContain("Body text from block");
    expect(emailSubjectFromText(candidateTextFromRecord(result))).toBe("Encoded Mail");
    expect(evidenceDisplayTitle(result)).toBe("Encoded Mail");
    expect(knowledgeResultTitle(result)).toBe("Encoded Mail");
    expect(knowledgeResultSnippet(result)).toContain("Subject: Encoded Mail");
    expect(knowledgeResultEvidenceId(result)).toBe("ev-1");
    expect(knowledgeResultAssetCount(result)).toBe(2);
    expect(knowledgeResultScore(result)).toBe("0.457");
    expect(knowledgeResultHierarchyPath(result)).toBe("document:doc-1 > section:sec-2");

    expect(evidenceDisplayTitle({ title: "Explicit title" })).toBe("Explicit title");
    expect(knowledgeResultAssetCount({ relatedAssetIds: ["a", "b", "c"] } as any)).toBe(3);
    expect(knowledgeResultAssetCount({ assetIds: ["a"] } as any)).toBe(1);
    expect(knowledgeResultScore({ finalScore: 0.2 } as any)).toBe("0.200");
    expect(knowledgeResultScore({ relevanceScore: 0.9 } as any)).toBe("0.900");
    expect(knowledgeResultHierarchyPath({ hierarchy: { path: "root > leaf" } } as any)).toBe("root > leaf");
    expect(knowledgeFusionSummary(null)).toBe("");
    expect(knowledgeFusionSummary({ fusion: { mode: "hybrid", localHitCount: 0 } } as any)).toBe("hybrid · 无本地 mirror 命中");
    expect(knowledgeFusionSummary({
      fusion: {
        mode: "hybrid",
        localHitCount: 5,
        localMergedCount: 2,
        localAppendedCount: 3,
      },
    } as any)).toBe("hybrid · 本地 mirror 5 条，合并 2 条，补充 3 条");
  });
});

describe("console info feed run utils", () => {
  it("formats retry labels, retry messages and error categories", () => {
    expect(INFO_FEED_FETCH_RETRY_LIMIT).toBe(10);
    expect(infoFeedRetryStageLabel("keyword")).toBe("原文检索");
    expect(infoFeedRetryStageLabel("agent")).toBe("智能规划");
    expect(infoFeedRetryStageLabel("summary")).toBe("知识归纳");
    expect(infoFeedRetryStageLabel("")).toBe("请求");
    expect(infoFeedRetryMessageForRun(makeRun())).toBe("");

    const run = makeRun({ pausedForRetry: "agent" });
    setInfoFeedRetryState(run, "agent", 3, new Error("Failed to fetch"), 4);
    expect(infoFeedRetryMessageForRun(run)).toContain("智能规划请求失败，已自动重试 3/4 次");
    expect(infoFeedRetryMessageForRun(makeRun({ pausedForRetry: "summary" }), 2)).toContain("知识归纳请求失败，已自动重试 2/2 次");

    expect(isModelConfigurationError("model URL 未配置")).toBe(true);
    expect(isModelConfigurationError(new Error("missing provider url"))).toBe(true);
    expect(isModelConfigurationError("permission denied")).toBe(false);
    expect(isTransientFetchError(new Error("Failed to fetch"))).toBe(true);
    expect(isTransientFetchError("ERR_NETWORK connection reset")).toBe(true);
    expect(isTransientFetchError("validation failed")).toBe(false);
    expect(infoFeedSearchCacheKey("  Mixed CASE Query  ")).toBe("mixed case query");

    clearInfoFeedRetryState(run, "keyword");
    expect(run.retry?.stage).toBe("agent");
    clearInfoFeedRetryState(run, "agent");
    expect(run.retry).toBeUndefined();
    expect(run.pausedForRetry).toBe("");
  });

  it("retries transient fetch failures and pauses after exhaustion", async () => {
    const run = makeRun();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce("ok");

    await expect(withInfoFeedFetchRetry(run, "keyword", operation, {
      retryLimit: 3,
      retryDelayMs: (attempt) => attempt * 10,
      sleep,
    })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
    expect(run.retry).toBeUndefined();
    expect(run.pausedForRetry).toBeUndefined();

    const exhaustedRun = makeRun();
    await expect(withInfoFeedFetchRetry(exhaustedRun, "summary", async () => {
      throw new Error("Network request failed");
    }, {
      retryLimit: 2,
      sleep,
    })).rejects.toMatchObject({
      name: "InfoFeedRetryExhaustedError",
      stage: "summary",
      attempts: 2,
      retryLimit: 2,
    });
    expect(exhaustedRun.pausedForRetry).toBe("summary");
    expect(exhaustedRun.retry).toMatchObject({
      stage: "summary",
      attempts: 2,
      limit: 2,
      error: "Network request failed",
    });
    expect(isInfoFeedRetryExhaustedError(new InfoFeedRetryExhaustedError("agent", 1, "load failed", 1))).toBe(true);
  });

  it("does not retry permanent failures and calculates agent progress", async () => {
    const run = makeRun({ retry: { stage: "keyword", attempts: 1, limit: 2, error: "old", updatedAt: "old" } });

    await expect(withInfoFeedFetchRetry(run, "keyword", async () => {
      throw new Error("validation failed");
    }, {
      retryLimit: 2,
      sleep: vi.fn(),
    })).rejects.toThrow("validation failed");
    expect(run.retry).toBeUndefined();

    expect(infoFeedAgentProgressFromResultCore({ run: { status: "completed" } } as any, 4)).toBe(100);
    expect(infoFeedAgentProgressFromResultCore({ run: { status: "failed" } } as any, 4)).toBe(100);
    expect(infoFeedAgentProgressFromResultCore({
      run: { status: "running" },
      steps: [{ iteration: 2, phase: "tool_calling" }],
    } as any, 4)).toBe(41);
    expect(infoFeedAgentProgressFromResultCore({
      run: { status: "running" },
      steps: [{ iteration: 99, phase: "answer_ready" }],
    } as any, 2)).toBe(92);
    expect(infoFeedAgentProgressFromResultCore(null, 4)).toBe(6);
  });
});
