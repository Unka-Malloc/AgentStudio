import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSearchResult } from "../../../server-web/lib/types";
import type { InfoFeedClarification, InfoFeedRunState } from "../../../server-web/types/app";
import { createConsoleInfoFeedKeywordController } from "../../../server-web/composables/console-info-feed-keyword-controller";
import { setConsoleLocaleState } from "../../../server-web/i18n/console";

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

function makeKeywordResult(id: string, title: string, score = 0.9): KnowledgeSearchResult {
  return {
    evidenceId: id,
    title,
    score,
  } as KnowledgeSearchResult;
}

function createController(currentRun = ref<InfoFeedRunState | null>(null)) {
  const parentRunSnapshot = ref<InfoFeedRunState | null>(null);
  const buildInfoFeedSourceContext = vi.fn((run: InfoFeedRunState | null | undefined) => ({
    report: {
      runId: run?.runId || "",
      message: run?.keyword.status || "no-run",
    },
  }));
  const isLowRelevanceSourceResult = vi.fn((item: KnowledgeSearchResult) => String(item.title || "").includes("low"));

  return {
    controller: createConsoleInfoFeedKeywordController({
      buildInfoFeedSourceContext,
      infoFeedCurrentRun: currentRun,
      infoFeedParentRunSnapshot: parentRunSnapshot,
      isLowRelevanceSourceResult,
    }),
    buildInfoFeedSourceContext,
    currentRun,
    isLowRelevanceSourceResult,
    parentRunSnapshot,
  };
}

afterEach(() => {
  setConsoleLocaleState("zh-CN");
});

describe("console info feed keyword controller extra coverage", () => {
  it("splits keyword items, falls back to results, and preserves the source context report", () => {
    const run = makeRun({
      keyword: {
        status: "completed",
        progress: 100,
        stage: "",
        fromCache: false,
        response: {
          results: [
            makeKeywordResult("ev-1", "high relevance"),
            makeKeywordResult("ev-2", "low relevance"),
          ],
          explain: {
            scannedFiles: "7",
            candidateFileCount: "3",
            matchedUniqueFiles: 2,
            returned: "1",
            highRelevanceCount: "5",
            lowRelevanceCount: 1,
            elapsedMs: 88,
            candidateElapsedMs: "11",
            inspectElapsedMs: 12,
            candidateSearch: 123,
          },
          query: "source-query",
        },
        error: "",
      },
      summary: {
        status: "completed",
        progress: 100,
        modelAlias: "",
        contextProfileId: "",
        parametersOpen: false,
        answer: "  answer ready  ",
        error: "",
        fallback: false,
      },
    });
    const { controller, buildInfoFeedSourceContext, isLowRelevanceSourceResult } = createController(ref(run));

    expect(controller.infoFeedAllKeywordItems.value).toHaveLength(2);
    expect(controller.infoFeedKeywordItems.value).toEqual([makeKeywordResult("ev-1", "high relevance")]);
    expect(controller.infoFeedLowRelevanceKeywordItems.value).toEqual([makeKeywordResult("ev-2", "low relevance")]);
    expect(controller.infoFeedContextGateNotice.value).toEqual({ runId: "run-1", message: "completed" });
    expect(buildInfoFeedSourceContext).toHaveBeenCalledWith(run);
    expect(isLowRelevanceSourceResult).toHaveBeenCalledTimes(4);
    expect(controller.infoFeedKeywordScanExplain.value).toEqual({
      scannedFiles: 7,
      candidateFileCount: 3,
      matchedUniqueFiles: 2,
      returned: 1,
      highRelevanceCount: 5,
      lowRelevanceCount: 1,
      elapsedMs: 88,
      candidateElapsedMs: 11,
      inspectElapsedMs: 12,
      candidateSearch: "123",
    });
  });

  it("returns the running stage, completed cache labels, and empty defaults when no run exists", () => {
    const { controller, currentRun } = createController();

    expect(controller.infoFeedKeywordItems.value).toEqual([]);
    expect(controller.infoFeedLowRelevanceKeywordItems.value).toEqual([]);
    expect(controller.infoFeedAllKeywordItems.value).toEqual([]);
    expect(controller.infoFeedContextGateNotice.value).toEqual({ runId: "", message: "no-run" });
    expect(controller.infoFeedKeywordProgressLabel.value).toBe("");
    expect(controller.infoFeedAgentSteps.value).toEqual([]);
    expect(controller.infoFeedAgentAnswer.value).toBe("");
    expect(controller.infoFeedCanFollowUp.value).toBe(false);
    expect(controller.infoFeedInputPlaceholder.value).toBe("输入问题，信息流会并行对比原文检索和智能规划。");
    expect(controller.infoFeedSubmitLabel.value).toBe("开始信息流");
    expect(controller.infoFeedClarification.value).toBeNull();
    expect(controller.infoFeedParentRunForCurrent.value).toBeNull();

    currentRun.value = makeRun({
      keyword: {
        status: "running",
        progress: 41,
        stage: "",
        fromCache: false,
        response: null,
        error: "",
      },
      summary: {
        status: "running",
        progress: 10,
        modelAlias: "",
        contextProfileId: "",
        parametersOpen: false,
        answer: "  still working  ",
        error: "",
        fallback: false,
      },
    });
    expect(controller.infoFeedKeywordProgressLabel.value).toBe("服务端检索中，等待扫描结果返回");
    expect(controller.infoFeedCanFollowUp.value).toBe(false);
    expect(controller.infoFeedInputPlaceholder.value).toBe("输入问题，信息流会并行对比原文检索和智能规划。");
    expect(controller.infoFeedSubmitLabel.value).toBe("开始信息流");
  });

  it("prefers explicit stage and handles completion, error, clarification, and parent run branches", () => {
    const clarification: InfoFeedClarification = {
      status: "open",
      question: "需要补充上下文吗？",
      options: [],
      selectedOptionIds: [],
      selectedOptionId: "",
      note: "",
      reasoning: "",
    };
    const parentRun = makeRun({ runId: "parent-run" });
    const completedRun = makeRun({
      followUp: {
        parentRunId: "parent-run",
        parentQuery: "原始问题",
        question: "继续追问",
        parentSummary: "父级总结",
        parentEvidenceRefs: ["ev-parent"],
      },
      clarification,
      keyword: {
        status: "completed",
        progress: 100,
        stage: "",
        fromCache: true,
        response: {
          items: [],
          explain: {},
          query: "cached-query",
        },
        error: "",
      },
      summary: {
        status: "completed",
        progress: 100,
        modelAlias: "",
        contextProfileId: "",
        parametersOpen: false,
        answer: "  可继续追问  ",
        error: "",
        fallback: false,
      },
    });
    const { controller, currentRun, parentRunSnapshot } = createController(ref(completedRun));

    parentRunSnapshot.value = parentRun;
    expect(controller.infoFeedClarification.value).toEqual(clarification);
    expect(controller.infoFeedCanFollowUp.value).toBe(true);
    expect(controller.infoFeedInputPlaceholder.value).toBe("继续追问当前信息流结果。");
    expect(controller.infoFeedSubmitLabel.value).toBe("追问");
    expect(controller.infoFeedKeywordProgressLabel.value).toBe("已使用缓存结果");
    expect(controller.infoFeedParentRunForCurrent.value).toStrictEqual(parentRun);

    currentRun.value = makeRun({
      keyword: {
        status: "completed",
        progress: 100,
        stage: "",
        fromCache: false,
        response: {
          items: [],
          explain: {
            candidateFileCount: 2,
            scannedFiles: 8,
            matchedUniqueFiles: 1,
            elapsedMs: 19,
          },
          query: "fresh-query",
        },
        error: "",
      },
      summary: {
        status: "failed",
        progress: 100,
        modelAlias: "",
        contextProfileId: "",
        parametersOpen: false,
        answer: "  ",
        error: "summary exploded",
        fallback: false,
      },
    });

    expect(controller.infoFeedKeywordProgressLabel.value).toBe("候选 2 · 扫描 8 · 命中 1 · 19ms");
    expect(controller.infoFeedClarification.value).toBeNull();
    expect(controller.infoFeedCanFollowUp.value).toBe(false);
    expect(controller.infoFeedInputPlaceholder.value).toBe("输入问题，信息流会并行对比原文检索和智能规划。");
    expect(controller.infoFeedSubmitLabel.value).toBe("开始信息流");
    expect(controller.infoFeedKeywordItems.value).toEqual([]);
    expect(controller.infoFeedLowRelevanceKeywordItems.value).toEqual([]);
    expect(controller.infoFeedKeywordProgressLabel.value).toBe("候选 2 · 扫描 8 · 命中 1 · 19ms");

    currentRun.value = makeRun({
      keyword: {
        status: "failed",
        progress: 0,
        stage: "",
        fromCache: false,
        response: null,
        error: "keyword failed",
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
    });
    expect(controller.infoFeedKeywordProgressLabel.value).toBe("keyword failed");
  });

  it("localizes the input placeholder when the console locale is English", () => {
    setConsoleLocaleState("en");
    const { controller, currentRun } = createController();

    expect(controller.infoFeedInputPlaceholder.value).toBe(
      "Enter a question. Feed will compare source retrieval and intelligent planning in parallel.",
    );

    currentRun.value = makeRun({
      summary: {
        status: "completed",
        progress: 100,
        modelAlias: "",
        contextProfileId: "",
        parametersOpen: false,
        answer: "ready",
        error: "",
        fallback: false,
      },
    });

    expect(controller.infoFeedInputPlaceholder.value).toBe("Ask a follow-up about the current feed result.");
  });
});
