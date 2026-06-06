// @vitest-environment jsdom
import { ref } from "vue";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  getKnowledgeAgentExploreRun,
  runKnowledgeAgentExplore,
} from "../../../server-web/lib/agent-explore-client";
import {
  searchKnowledge,
} from "../../../server-web/lib/knowledge-search-client";
import type {
  AgentExploreRunResponse,
  KnowledgeSearchResponse,
} from "../../../server-web/lib/types";
import type { InfoFeedRunState } from "../../../server-web/types/app";
import { createConsoleInfoFeedTrackController } from "../../../server-web/composables/console-info-feed-track-controller";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import {
  InfoFeedRetryExhaustedError,
  withInfoFeedFetchRetry,
} from "../../../server-web/composables/console-info-feed-run-utils";

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  searchKnowledge: vi.fn(),
}));

vi.mock("../../../server-web/lib/agent-explore-client", () => ({
  getKnowledgeAgentExploreRun: vi.fn(),
  runKnowledgeAgentExplore: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-info-feed-run-utils", async () => {
  const actual = await vi.importActual<typeof import("../../../server-web/composables/console-info-feed-run-utils")>(
    "../../../server-web/composables/console-info-feed-run-utils",
  );
  return {
    ...actual,
    delayMs: vi.fn(() => Promise.resolve()),
    withInfoFeedFetchRetry: vi.fn(async (_run: InfoFeedRunState, _stage: string, operation: () => Promise<unknown>) =>
      operation()),
  };
});

const mockedSearchKnowledge = vi.mocked(searchKnowledge);
const mockedRunKnowledgeAgentExplore = vi.mocked(runKnowledgeAgentExplore);
const mockedGetKnowledgeAgentExploreRun = vi.mocked(getKnowledgeAgentExploreRun);
const mockedWithInfoFeedFetchRetry = vi.mocked(withInfoFeedFetchRetry);

function summaryDefaults() {
  return {
    modelAlias: "model-default",
    contextProfileId: "ctx-default",
    temperature: 0.2,
    maxTokens: 1800,
  };
}

function createRun(query = "起始问题", overrides: Partial<InfoFeedRunState> = {}) {
  return createInfoFeedRunState(query, {
    attachments: [],
    summaryDefaults: summaryDefaults(),
    ...(overrides.followUp ? { followUp: overrides.followUp } : {}),
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function makeKeywordResponse(overrides: Partial<KnowledgeSearchResponse> = {}): KnowledgeSearchResponse {
  return {
    query: "source-query",
    items: [
      {
        evidenceId: "ev-1",
        title: "First result",
      },
    ],
    explain: {
      candidateFileCount: 3,
      scannedFiles: 7,
      matchedUniqueFiles: 2,
      elapsedMs: 88,
    },
    ...overrides,
  };
}

function makeAgentResponse(
  status: "queued" | "running" | "completed" | "failed",
  overrides: Partial<AgentExploreRunResponse> = {},
): AgentExploreRunResponse {
  return {
    protocolVersion: "1",
    ok: status !== "failed",
    workspace: {
      workspaceId: "workspace-1",
    },
    run: {
      runId: "agent-run-1",
      workspaceId: "workspace-1",
      status,
      coverage: {
        answer: "Draft answer",
        evidenceRefs: ["ev-agent-1"],
      },
    },
    answer: "Draft answer",
    steps: [
      {
        iteration: 1,
        phase: status === "completed" ? "answer_ready" : "tool_calling",
      },
    ],
    ...overrides,
  };
}

function createFixture() {
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(createRun("起始问题"));
  const infoFeedRunSequence = ref(1);
  const keywordCache = new Map<string, { response: KnowledgeSearchResponse; cachedAt: number }>();

  const controller = createConsoleInfoFeedTrackController({
    agentExploreConfiguredLimit: ref(24),
    agentExploreConfiguredMaxIterations: ref(6),
    infoFeedAgentExpertGuidance: vi.fn(() => [{ feedbackId: "feedback-1" }]),
    infoFeedAgentProgressFromResult: vi.fn((result: AgentExploreRunResponse | null) => {
      const status = String(result?.run?.status || "");
      if (status === "completed") {
        return 100;
      }
      if (status === "running") {
        return 71;
      }
      return 19;
    }),
    infoFeedAgentRecentTurns: vi.fn(() => [{ role: "assistant", query: "上一轮" }]),
    infoFeedCurrentRun,
    infoFeedKeywordCache: keywordCache,
    infoFeedRunSequence,
    selectedInfoFeedContextProfile: ref({ value: "ctx-default" }),
    selectedInfoFeedModel: ref({ value: "model-default", enabled: true }),
    selectedThinkingMode: ref("balanced"),
  });

  return {
    controller,
    infoFeedCurrentRun,
    infoFeedRunSequence,
    keywordCache,
  };
}

describe("console info feed track controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads keyword tracks, derives scan stage text, and caches fresh responses", async () => {
    const { controller, infoFeedCurrentRun, keywordCache } = createFixture();
    const run = infoFeedCurrentRun.value!;
    mockedWithInfoFeedFetchRetry.mockImplementationOnce(async (_run, _stage, operation) => operation());
    mockedSearchKnowledge.mockResolvedValueOnce(makeKeywordResponse());

    await controller.runInfoFeedKeywordTrack(1, run.runId, "原始检索问题");

    expect(mockedSearchKnowledge).toHaveBeenCalledWith({
      query: "原始检索问题",
      limit: 12,
      retrievalMode: "raw-source-keyword",
      keywordOnly: true,
      rawSourceSearch: true,
      sourceSearch: true,
      returnAll: true,
      learningEnabled: false,
      explain: true,
    });
    expect(run.keyword.status).toBe("completed");
    expect(run.keyword.progress).toBe(100);
    expect(run.keyword.fromCache).toBe(false);
    expect(run.keyword.stage).toBe("候选 3 · 扫描 7 · 命中 2 · 88ms");
    expect(run.keyword.response).toStrictEqual({
      query: "source-query",
      items: [{ evidenceId: "ev-1", title: "First result" }],
      explain: {
        candidateFileCount: 3,
        scannedFiles: 7,
        matchedUniqueFiles: 2,
        elapsedMs: 88,
      },
    });
    expect(keywordCache.get("原始检索问题".trim().toLowerCase())?.response).toStrictEqual(run.keyword.response);
  });

  it("reuses a fresh keyword cache entry without calling the search client", async () => {
    const { controller, infoFeedCurrentRun, keywordCache } = createFixture();
    const run = infoFeedCurrentRun.value!;
    const cachedResponse = makeKeywordResponse({
      explain: undefined,
      query: "cached-query",
    });
    keywordCache.set("cached query", {
      response: cachedResponse,
      cachedAt: Date.now() - 30_000,
    });

    await controller.runInfoFeedKeywordTrack(1, run.runId, "cached query");

    expect(mockedSearchKnowledge).not.toHaveBeenCalled();
    expect(run.keyword.status).toBe("completed");
    expect(run.keyword.progress).toBe(100);
    expect(run.keyword.fromCache).toBe(true);
    expect(run.keyword.stage).toBe("已使用缓存结果");
    expect(run.keyword.response).toStrictEqual(cachedResponse);
  });

  it("keeps stale keyword results out of a newer selection", async () => {
    const { controller, infoFeedCurrentRun, infoFeedRunSequence, keywordCache } = createFixture();
    const originalRun = infoFeedCurrentRun.value!;
    const nextRun = createRun("切换后的问题");
    const searchDeferred = createDeferred<KnowledgeSearchResponse>();

    mockedWithInfoFeedFetchRetry.mockImplementationOnce(async (_run, _stage, operation) => {
      const result = operation();
      infoFeedCurrentRun.value = nextRun;
      infoFeedRunSequence.value = 2;
      searchDeferred.resolve(makeKeywordResponse({ query: "late-query" }));
      return result;
    });
    mockedSearchKnowledge.mockReturnValueOnce(searchDeferred);

    await controller.runInfoFeedKeywordTrack(1, originalRun.runId, "late query");

    expect(originalRun.keyword.status).toBe("running");
    expect(originalRun.keyword.response).toBeNull();
    expect(originalRun.keyword.fromCache).toBe(false);
    expect(originalRun.keyword.stage).toBe("服务端正在扫描原始文件，完成后返回真实扫描数");
    expect(keywordCache.size).toBe(0);
    expect(infoFeedCurrentRun.value?.runId).toBe(nextRun.runId);
  });

  it("marks keyword retries as failed and pauses continuation when retries are exhausted", async () => {
    const { controller, infoFeedCurrentRun } = createFixture();
    const run = infoFeedCurrentRun.value!;
    mockedWithInfoFeedFetchRetry.mockRejectedValueOnce(
      new InfoFeedRetryExhaustedError("keyword", 3, new Error("network down"), 3),
    );

    await controller.runInfoFeedKeywordTrack(1, run.runId, "失败问题");

    expect(run.keyword.status).toBe("failed");
    expect(run.keyword.progress).toBe(100);
    expect(run.keyword.error).toContain("network down");
    expect(run.keyword.stage).toBe(run.keyword.error);
    expect(run.pausedForRetry).toBe("keyword");
  });

  it("runs agent tracks, resets selection pauses, and derives progress from polling", async () => {
    const { controller, infoFeedCurrentRun } = createFixture();
    const run = infoFeedCurrentRun.value!;
    run.pausedForModelSelection = "agent";

    mockedWithInfoFeedFetchRetry.mockImplementation(async (_run, _stage, operation) => operation());
    mockedRunKnowledgeAgentExplore.mockResolvedValueOnce(makeAgentResponse("queued", {
      run: {
        runId: "agent-run-1",
        workspaceId: "workspace-1",
        status: "queued",
        coverage: {
          answer: "Draft answer",
          evidenceRefs: ["ev-agent-1"],
        },
      },
    }));
    mockedGetKnowledgeAgentExploreRun
      .mockResolvedValueOnce(makeAgentResponse("running"))
      .mockResolvedValueOnce(makeAgentResponse("completed"));

    await controller.runInfoFeedAgentTrack(1, run.runId, "智能规划问题");

    expect(run.pausedForModelSelection).toBe("");
    expect(mockedRunKnowledgeAgentExplore).toHaveBeenCalledWith({
      query: "智能规划问题",
      modelAlias: "model-default",
      contextProfileId: "ctx-default",
      thinkingMode: "balanced",
      maxIterations: 6,
      limit: 24,
      recentTurns: [{ role: "assistant", query: "上一轮" }],
      expertGuidance: [{ feedbackId: "feedback-1" }],
      async: true,
      realtime: true,
    });
    expect(mockedGetKnowledgeAgentExploreRun).toHaveBeenCalledTimes(2);
    expect(run.agent.runId).toBe("agent-run-1");
    expect(run.agent.workspaceId).toBe("workspace-1");
    expect(run.agent.status).toBe("completed");
    expect(run.agent.progress).toBe(100);
    expect(run.agent.error).toBe("");
    expect(run.agent.response?.run?.status).toBe("completed");
    expect(run.agent.response?.answer).toBe("Draft answer");
  });

  it("flags model configuration failures as paused for model selection", async () => {
    const { controller, infoFeedCurrentRun } = createFixture();
    const run = infoFeedCurrentRun.value!;

    mockedWithInfoFeedFetchRetry.mockImplementation(async (_run, _stage, operation) => operation());
    mockedRunKnowledgeAgentExplore.mockResolvedValueOnce(makeAgentResponse("failed", {
      ok: false,
      error: "模型 URL 未配置",
      run: {
        runId: "agent-run-2",
        workspaceId: "workspace-2",
        status: "failed",
        error: "模型 URL 未配置",
        coverage: {
          answer: "",
          evidenceRefs: [],
        },
      },
    }));

    await controller.runInfoFeedAgentTrack(1, run.runId, "智能规划失败问题");

    expect(run.agent.status).toBe("failed");
    expect(run.agent.progress).toBe(100);
    expect(run.agent.error).toBe("模型 URL 未配置");
    expect(run.pausedForModelSelection).toBe("agent");
  });
});
