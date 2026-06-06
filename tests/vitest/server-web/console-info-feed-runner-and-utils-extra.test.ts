// @vitest-environment jsdom
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "vue";
import { callAgentGateway } from "../../../server-web/lib/agent-gateway-client";
import { InfoFeedRetryExhaustedError } from "../../../server-web/composables/console-info-feed-run-utils";
import { withInfoFeedFetchRetry } from "../../../server-web/composables/console-info-feed-run-utils";
import {
  buildFallbackInfoFeedClarificationCore,
  extractInfoFeedClarificationCore,
  normalizeInfoFeedClarificationOptionCore,
  applyInfoFeedSummaryAnswerCore,
} from "../../../server-web/composables/console-info-feed-clarification-utils";
import {
  createConsoleInfoFeedSummaryRunnerController,
} from "../../../server-web/composables/console-info-feed-summary-runner-controller";
import { createConsoleInfoFeedController } from "../../../server-web/composables/console-info-feed-controller";
import type { InfoFeedRunState } from "../../../server-web/types/app";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";

vi.mock("../../../server-web/lib/agent-gateway-client", () => ({
  callAgentGateway: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-info-feed-run-utils", async () => {
  const actual = await vi.importActual<typeof import("../../../server-web/composables/console-info-feed-run-utils")>(
    "../../../server-web/composables/console-info-feed-run-utils",
  );
  return {
    ...actual,
    withInfoFeedFetchRetry: vi.fn(async (_run: InfoFeedRunState, _stage: string, operation: () => Promise<unknown>) => operation()),
  };
});

let modelControllerMock: ReturnType<typeof createModelControllerMock>;
let derivationControllerMock: ReturnType<typeof createDerivationControllerMock>;
let historyControllerMock: ReturnType<typeof createHistoryControllerMock>;
let keywordControllerMock: ReturnType<typeof createKeywordControllerMock>;
let outputControllerMock: ReturnType<typeof createOutputControllerMock>;
let executionControllerMock: ReturnType<typeof createExecutionControllerMock>;

function createModelControllerMock() {
  return {
    agentExploreThinkingParameters: vi.fn(() => ({ temperature: 0.2 })),
    hasAgentModelOption: vi.fn(() => true),
    infoFeedFallbackContextProfileId: ref("ctx-fallback"),
    infoFeedForm: ref({
      query: "",
      modelAlias: "",
      contextProfileId: "",
      temperature: 0.2,
      maxTokens: 1800,
    }),
    infoFeedModelDisplayLabel: vi.fn((value = "") => `模型-${value}`),
    infoFeedModelOptions: ref([{ value: "model-default", enabled: true }]),
    infoFeedSummaryDefaults: {
      modelAlias: "model-default",
      contextProfileId: "ctx-default",
      temperature: 0.2,
      maxTokens: 1800,
    },
    selectedInfoFeedContextProfile: ref({ value: "ctx-default" }),
    selectedInfoFeedModel: ref({ value: "model-default", enabled: true }),
    selectedThinkingMode: ref("balanced"),
    validAgentModelAlias: vi.fn((value?: string) => (value === "invalid" ? "model-default" : value || "model-default")),
  };
}

function createDerivationControllerMock() {
  return {
    applyInfoFeedSummaryAnswer: vi.fn(),
    archiveInfoFeedExpertFeedback: vi.fn(),
    buildInfoFeedAgentQuery: vi.fn((run: InfoFeedRunState) => `agent:${run.query}`),
    buildInfoFeedSourceContext: vi.fn(() => "源上下文"),
    buildInfoFeedSourceSearchQuery: vi.fn((run: InfoFeedRunState) => `source:${run.query}`),
    buildInfoFeedSummaryQuestion: vi.fn((run: InfoFeedRunState) => `summary:${run.query}`),
    estimateInfoFeedContextTokens: vi.fn(() => 128),
    extractInfoFeedClarification: vi.fn(),
    fallbackInfoFeedSummary: vi.fn((run: InfoFeedRunState) => `fallback:${run.query}`),
    infoFeedAgentExpertGuidance: vi.fn(() => ({})),
    infoFeedAgentProgressFromResult: vi.fn(() => 0),
    infoFeedAgentRecentTurns: vi.fn(() => []),
    infoFeedRunEvidenceRefs: vi.fn(() => ["evidence-1"]),
    infoFeedSourceContextBudgetChars: vi.fn(() => 2000),
    infoFeedSourceResultLine: vi.fn(() => ""),
    infoFeedSourceSummary: vi.fn(() => ""),
    isLowRelevanceSourceResult: vi.fn(() => false),
    normalizeInfoFeedClarificationOption: vi.fn((value: unknown, index: number) => normalizeInfoFeedClarificationOptionCore(value, index)),
  };
}

function createHistoryControllerMock() {
  return {
    appendInfoFeedTurnSnapshot: vi.fn(),
    clearInvalidInfoFeedModelReferences: vi.fn(),
    compactInfoFeedAttachment: vi.fn(),
    compactInfoFeedRunForStorage: vi.fn(),
    createInfoFeedRun: vi.fn((query: string) => createInfoFeedRunState(query, {
      attachments: [],
      summaryDefaults: modelControllerMock.infoFeedSummaryDefaults,
    })),
    deleteInfoFeedHistory: vi.fn(),
    deleteInfoFeedHistoryItem: vi.fn(),
    handleInfoFeedAttachmentFiles: vi.fn(async () => []),
    infoFeedHistoryPanelItems: ref([] as unknown[]),
    infoFeedRestorableModelAlias: ref("model-default"),
    initialInfoFeedAgentState: { status: "idle", progress: 0, runId: "", workspaceId: "", response: null, error: "" },
    initialInfoFeedKeywordState: { status: "idle", progress: 0, stage: "", fromCache: false, response: null, error: "" },
    initialInfoFeedSummaryState: {
      status: "idle",
      progress: 0,
      modelAlias: "model-default",
      contextProfileId: "ctx-default",
      parametersOpen: false,
      temperature: 0.2,
      maxTokens: 1800,
      answer: "",
      error: "",
      fallback: false,
    },
    normalizeInfoFeedHistory: vi.fn((history: InfoFeedRunState[]) => history),
    openInfoFeedHistoryRun: vi.fn(),
    persistInfoFeedHistory: vi.fn(),
    readInfoFeedAttachment: vi.fn(),
    removeInfoFeedAttachment: vi.fn(),
    resetInfoFeedRunForContinuation: vi.fn(),
    restoreInfoFeedHistory: vi.fn(async () => undefined),
    sanitizeInfoFeedRunModelReferences: vi.fn(),
    selectInfoFeedHistoryItem: vi.fn(),
    snapshotInfoFeedAttachments: vi.fn(),
    snapshotInfoFeedTurn: vi.fn(),
    upsertInfoFeedHistory: vi.fn(),
  };
}

function createKeywordControllerMock() {
  return {
    infoFeedAgentAnswer: ref(""),
    infoFeedAgentSteps: ref([] as unknown[]),
    infoFeedAllKeywordItems: ref([] as unknown[]),
    infoFeedCanFollowUp: ref(false),
    infoFeedClarification: ref(undefined),
    infoFeedContextGateNotice: ref(""),
    infoFeedInputPlaceholder: ref(""),
    infoFeedKeywordItems: ref([] as unknown[]),
    infoFeedKeywordProgressLabel: ref(""),
    infoFeedKeywordScanExplain: ref(""),
    infoFeedLowRelevanceKeywordItems: ref([] as unknown[]),
    infoFeedParentRunForCurrent: ref(null as InfoFeedRunState | null),
    infoFeedSubmitLabel: ref("提交"),
  };
}

function createOutputControllerMock() {
  return {
    clearInfoFeedSummaryStreamTimer: vi.fn(),
    copyInfoFeedSummary: vi.fn(),
    exportInfoFeedSummary: vi.fn(),
    infoFeedCurrentUserQuestion: vi.fn(() => "当前问题"),
    infoFeedExpertFeedbackFor: vi.fn(() => [] as unknown[]),
    infoFeedExpertFeedbackForRun: vi.fn(() => [] as unknown[]),
    infoFeedParentSummaryEvidenceRefs: ref([] as string[]),
    infoFeedParentSummaryHtml: ref(""),
    infoFeedStreamingSummaryHtml: ref(""),
    infoFeedSummaryEvidenceRefs: ref([] as string[]),
    infoFeedSummaryIsStreaming: ref(false),
    infoFeedSummaryMarkdown: ref(""),
    infoFeedSummaryRuntime: ref({ model: "", temperature: 0.2, maxTokens: 1800 }),
    infoFeedSummaryStreamText: ref(""),
    infoFeedSummaryStreamTimer: ref(null as number | null),
    infoFeedTurnAttachments: ref([] as unknown[]),
    infoFeedTurnQuestion: vi.fn(() => ""),
    infoFeedTurnSummaryHtml: ref(""),
    infoFeedTurnTitle: vi.fn(() => ""),
    infoFeedUserCardTitle: vi.fn(() => ""),
    infoFeedVisibleSummaryText: ref(""),
    streamInfoFeedSummary: vi.fn(async () => undefined),
  };
}

function createExecutionControllerMock() {
  return {
    chooseInfoFeedClarification: vi.fn(),
    continueInfoFeedAfterModelSelection: vi.fn(),
    continueInfoFeedAfterRetry: vi.fn(),
    continueInfoFeedCurrentRun: vi.fn(),
    executeInfoFeedRunIteration: vi.fn(),
    runInfoFeed: vi.fn(async () => undefined),
    runInfoFeedAgentTrack: vi.fn(async () => undefined),
    runInfoFeedKeywordTrack: vi.fn(async () => undefined),
    runInfoFeedSummaryAgent: vi.fn(async () => undefined),
    syncInfoFeedExpertFeedback: vi.fn(),
  };
}

vi.mock("../../../server-web/composables/console-info-feed-model-controller", () => ({
  createConsoleInfoFeedModelController: vi.fn(() => modelControllerMock),
}));
vi.mock("../../../server-web/composables/console-info-feed-derivation-controller", () => ({
  createConsoleInfoFeedDerivationController: vi.fn(() => derivationControllerMock),
}));
vi.mock("../../../server-web/composables/console-info-feed-history-controller", () => ({
  createConsoleInfoFeedHistoryController: vi.fn(() => historyControllerMock),
}));
vi.mock("../../../server-web/composables/console-info-feed-keyword-controller", () => ({
  createConsoleInfoFeedKeywordController: vi.fn(() => keywordControllerMock),
}));
vi.mock("../../../server-web/composables/console-info-feed-output-controller", () => ({
  createConsoleInfoFeedOutputController: vi.fn(() => outputControllerMock),
}));
vi.mock("../../../server-web/composables/console-info-feed-execution-controller", () => ({
  createConsoleInfoFeedExecutionController: vi.fn(() => executionControllerMock),
}));
vi.mock("../../../server-web/composables/console-info-feed-expert-feedback-controller", () => ({
  createConsoleInfoFeedExpertFeedbackController: vi.fn(() => ({
    syncInfoFeedExpertFeedback: vi.fn(),
  })),
}));

const mockedCallAgentGateway = vi.mocked(callAgentGateway);

const mockedWithInfoFeedFetchRetry = vi.mocked(withInfoFeedFetchRetry);

function makeRun(overrides: Partial<InfoFeedRunState> = {}) {
  return createInfoFeedRunState("问题：如何验证摘要质量", {
    attachments: [],
    summaryDefaults: {
      modelAlias: "model-default",
      contextProfileId: "ctx-default",
      temperature: 0.2,
      maxTokens: 1800,
    },
    ...overrides,
  });
}

function createSummaryRunnerHarness(overrides: {
  run?: InfoFeedRunState | null;
  infoFeedForm?: { temperature?: number; maxTokens?: number };
  selectedModel?: string;
  selectedContextProfile?: string;
} = {}) {
  const run = overrides.run === undefined ? makeRun() : overrides.run;
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(run);
  const infoFeedRunSequence = ref(1);
  const infoFeedForm = ref({
    temperature: overrides.infoFeedForm?.temperature ?? 0.35,
    maxTokens: overrides.infoFeedForm?.maxTokens ?? 2200,
  }) as Ref<{
    temperature: number;
    maxTokens: number;
  }>;
  const selectedInfoFeedModel = ref({ value: overrides.selectedModel || "summary-model" });
  const selectedInfoFeedContextProfile = ref({ value: overrides.selectedContextProfile || "context-default" });
  const upsertInfoFeedHistory = vi.fn();
  const applyInfoFeedSummaryAnswer = vi.fn((state: InfoFeedRunState, answer: string, fallback: boolean, error = "") => {
    state.summary.answer = answer;
    state.summary.fallback = fallback;
    state.summary.error = error;
  });
  const buildFallbackInfoFeedSummary = vi.fn((state: InfoFeedRunState) => `fallback:${state.runId}`);

  const controller = createConsoleInfoFeedSummaryRunnerController({
    agentExploreThinkingParameters: () => ({ top_p: 0.95 }),
    applyInfoFeedSummaryAnswer,
    buildInfoFeedSummaryQuestion: (state: InfoFeedRunState) => `summary question for ${state.runId}`,
    fallbackInfoFeedSummary: buildFallbackInfoFeedSummary,
    infoFeedCurrentRun,
    infoFeedForm: infoFeedForm as Ref<{ temperature: number; maxTokens: number; } & Record<string, unknown>>,
    infoFeedReadyForSummary: ref(true),
    infoFeedRunSequence,
    selectedInfoFeedContextProfile,
    selectedInfoFeedModel,
    upsertInfoFeedHistory,
  });

  return {
    applyInfoFeedSummaryAnswer,
    buildFallbackInfoFeedSummary,
    controller,
    infoFeedCurrentRun,
    infoFeedRunSequence,
    infoFeedForm,
    selectedInfoFeedModel,
    selectedInfoFeedContextProfile,
    upsertInfoFeedHistory,
    run,
  };
}

function createInfoFeedControllerHarness() {
  modelControllerMock = createModelControllerMock();
  derivationControllerMock = createDerivationControllerMock();
  historyControllerMock = createHistoryControllerMock();
  keywordControllerMock = createKeywordControllerMock();
  outputControllerMock = createOutputControllerMock();
  executionControllerMock = createExecutionControllerMock();

  const controller = createConsoleInfoFeedController({
    agentExploreConfiguredLimit: ref(30),
    agentExploreConfiguredMaxIterations: ref(6),
    agentExploreContextWindowOptions: [],
    agentExploreForm: ref({
      query: "",
      modelAlias: "",
      contextProfileId: "",
      temperature: 0.2,
      maxTokens: 1800,
    }),
    agentExploreThinkingModeOptions: [{ value: "balanced" }, { value: "deep" }],
    agentSelectorOptions: ref([{ value: "model-default", enabled: true, agentUid: "agent" }] as unknown[]),
    canReadKnowledge: ref(true),
    contextProfileRows: [],
    error: ref(""),
    recordFeedback: vi.fn(),
    settingsDraft: ref({
      agentExploreDefaults: {},
    } as any),
  });

  return {
    controller,
    createInfoFeedRunState,
    executionControllerMock,
    historyControllerMock,
  };
}

describe("info feed summary runner controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成功时写入总结并标记 completed", async () => {
    const {
      controller,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedRunSequence,
      upsertInfoFeedHistory,
      run,
    } = createSummaryRunnerHarness({
      infoFeedForm: { temperature: 0, maxTokens: 0 },
      selectedModel: "summary-model",
      selectedContextProfile: "ctx-summary",
    });
    mockedCallAgentGateway.mockResolvedValueOnce({ answer: "  最终总结  " });

    await controller.runInfoFeedSummaryAgent(1);

    expect(infoFeedCurrentRun.value?.runId).toBe(run.runId);
    expect(mockedCallAgentGateway).toHaveBeenCalledWith(expect.objectContaining({
      modelAlias: "summary-model",
      alias: "summary-model",
      moduleId: "agentTools",
      taskId: run.runId,
      sessionId: run.runId,
      question: `summary question for ${run.runId}`,
      parameters: expect.objectContaining({
        max_tokens: 1800,
        temperature: 0.2,
      }),
    }));
    expect(run.summary.status).toBe("completed");
    expect(run.summary.progress).toBe(100);
    expect(run.summary.answer).toBe("最终总结");
    expect(run.summary.modelAlias).toBe("summary-model");
    expect(run.summary.contextProfileId).toBe("ctx-summary");
    expect(run.summary.temperature).toBe(0.2);
    expect(run.summary.maxTokens).toBe(1800);
    expect(infoFeedRunSequence.value).toBe(1);
    expect(upsertInfoFeedHistory).toHaveBeenCalledTimes(1);
    expect(upsertInfoFeedHistory).toHaveBeenCalledWith(run);
    expect(run.completedAt).not.toBe("");
  });

  it("空回答应回落到本地兜底并设置 failed", async () => {
    const { controller, run } = createSummaryRunnerHarness();
    mockedCallAgentGateway.mockResolvedValueOnce({ answer: "", text: "" });

    await controller.runInfoFeedSummaryAgent(1);

    expect(run.summary.status).toBe("failed");
    expect(run.summary.progress).toBe(100);
    expect(run.summary.answer).toBe(`fallback:${run.runId}`);
    expect(run.summary.fallback).toBe(true);
    expect(run.summary.error).toBe("总结智能体没有返回可用回答，已展示本地兜底摘要。");
  });

  it("加载时设置 running 与 15% 进度", async () => {
    const { controller, run } = createSummaryRunnerHarness();
    const fetchReady = new Promise((resolve) => {
      mockedCallAgentGateway.mockImplementationOnce(async () => {
        expect(run.summary.status).toBe("running");
        expect(run.summary.progress).toBe(15);
        return resolve(undefined);
      });
    });

    await Promise.all([controller.runInfoFeedSummaryAgent(1), fetchReady]);

    expect(run.summary.status).toBe("failed");
  });

  it("失败时写入模型未配置分支，暂停模型选择", async () => {
    const { controller, run } = createSummaryRunnerHarness();
    mockedWithInfoFeedFetchRetry.mockRejectedValueOnce(new Error("模型未配置 URL"));

    await controller.runInfoFeedSummaryAgent(1);

    expect(run.summary.status).toBe("failed");
    expect(run.summary.progress).toBe(0);
    expect(run.summary.fallback).toBe(false);
    expect(run.pausedForModelSelection).toBe("summary");
    expect(run.pausedForRetry).toBe("");
    expect(run.summary.error).toContain("模型未配置 URL");
    expect(run.summary.answer).toBe("");
  });

  it("失败时对重试耗尽分支进行暂停并保存错误", async () => {
    const { controller, run } = createSummaryRunnerHarness();
    mockedWithInfoFeedFetchRetry.mockRejectedValueOnce(
      new InfoFeedRetryExhaustedError("summary", 3, new Error("network down"), 3),
    );

    await controller.runInfoFeedSummaryAgent(1);

    expect(run.summary.status).toBe("failed");
    expect(run.summary.progress).toBe(100);
    expect(run.pausedForRetry).toBe("summary");
    expect(run.summary.error).toBe("知识归纳请求失败，已自动重试 3/3 次：network down");
    expect(run.summary.fallback).toBe(false);
  });

  it("通用错误走兜底并记录错误信息", async () => {
    const { controller, run } = createSummaryRunnerHarness();
    mockedWithInfoFeedFetchRetry.mockRejectedValueOnce(new Error("服务端异常"));

    await controller.runInfoFeedSummaryAgent(1);

    expect(run.summary.status).toBe("failed");
    expect(run.summary.progress).toBe(100);
    expect(run.summary.fallback).toBe(true);
    expect(run.summary.answer).toBe(`fallback:${run.runId}`);
    expect(run.summary.error).toBe("服务端异常");
  });

  it("空运行态会直接返回，不触发调用", async () => {
    const { controller } = createSummaryRunnerHarness({ run: null });

    await controller.runInfoFeedSummaryAgent(1);

    expect(mockedCallAgentGateway).not.toHaveBeenCalled();
  });

  it("运行序列失效时不更新结果且不落库", async () => {
    const { controller, infoFeedRunSequence, run } = createSummaryRunnerHarness();
    mockedWithInfoFeedFetchRetry.mockImplementationOnce(async (_run, _stage, operation) => {
      const promise = operation();
      infoFeedRunSequence.value = 2;
      return promise;
    });
    mockedCallAgentGateway.mockResolvedValueOnce({ answer: "已过期返回" });

    await controller.runInfoFeedSummaryAgent(1);

    expect(run.summary.status).toBe("running");
    expect(run.summary.progress).toBe(15);
    expect(run.summary.answer).toBe("");
  });
});

describe("info feed clarification utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalize 会修剪空格并截断长度，不合法选项返回 null", () => {
    const normalized = normalizeInfoFeedClarificationOptionCore(
      {
        label: "  这是一个非常长的选项标题，超过六十四字符会被截断，这里继续添加字符以触发截断。  ",
        description: "  这是建议描述  ",
        followUpQuestion: "  需要下一步吗？  ",
      },
      0,
    );

    expect(normalized).toMatchObject({
      optionId: "option-1",
      label: expect.stringContaining("这是一个非常长的选项标题，超过六十四字符会被截断，这里"),
      description: "这是建议描述",
      followUpQuestion: "需要下一步吗？",
    });
    expect(normalized?.label.length).toBeLessThanOrEqual(64);
    expect(normalized?.followUpQuestion.length).toBeLessThanOrEqual(800);

    expect(normalizeInfoFeedClarificationOptionCore({}, 0)).toBeNull();
  });

  it("extract 会识别 pact_user_options 块并提取 clarification", () => {
    const answer = [
      "开头说明",
      "```pact_user_options",
      `{"questionId":"q1","prompt":"  请确认下一步  ","reason":"  证据不足  ","anchor":"summary","options":[{"label":"A","description":" 说明  ","followUpQuestion":" 继续A  "},{"title":"备选","description":"x","query":"继续B"}]}`,
      "```",
      "结尾补充",
    ].join("\n");

    const result = extractInfoFeedClarificationCore(answer);

    expect(result.answer).toBe("开头说明\n\n结尾补充");
    expect(result.clarification).toMatchObject({
      questionId: "q1",
      prompt: "请确认下一步",
      reason: "证据不足",
      anchor: "summary",
      options: expect.arrayContaining([
        expect.objectContaining({
          optionId: "option-1",
          label: "A",
          description: "说明",
          followUpQuestion: "继续A",
        }),
        expect.objectContaining({
          optionId: "option-2",
          label: "备选",
          description: "x",
          followUpQuestion: "继续B",
        }),
      ]),
    });
  });

  it("extract 在没有可解析块时返回空的 clarification 与原始答案", () => {
    const answer = "  纯文本回答  ";
    const result = extractInfoFeedClarificationCore(answer);

    expect(result.answer).toBe("纯文本回答");
    expect(result.clarification).toBeUndefined();
  });

  it("buildFallback 根据 summary 状态生成默认 clarification", () => {
    const uncertainRun = makeRun();
    uncertainRun.summary.answer = "";
    uncertainRun.summary.fallback = true;
    uncertainRun.summary.error = "证据不足";
    const withAnswer = makeRun();
    withAnswer.summary.answer = "已有总结";
    withAnswer.summary.fallback = true;

    const fallbackWithoutAnswer = buildFallbackInfoFeedClarificationCore(uncertainRun);
    const fallbackWithAnswer = buildFallbackInfoFeedClarificationCore(withAnswer);

    expect(fallbackWithoutAnswer?.anchor).toBe("summary");
    expect(fallbackWithoutAnswer?.reason).toBe("证据不足");
    expect(fallbackWithAnswer?.anchor).toBe("report");
  });

  it("apply 会解析 clarification 并落到 run.summary", () => {
    const run = makeRun();
    const answer = [
      "结论文本",
      "```pact_user_options",
      '{"questionId":"q2","prompt":"确认下一步","options":[{"optionId":"o1","label":"继续","followUpQuestion":"详细说明"}]}',
      "```",
    ].join("\n");

    applyInfoFeedSummaryAnswerCore(run, answer, false, "");

    expect(run.summary.answer).toBe("结论文本");
    expect(run.summary.fallback).toBe(false);
    expect(run.summary.error).toBe("");
    expect(run.clarification).toEqual(expect.objectContaining({
      questionId: "q2",
      options: [
        {
          optionId: "o1",
          label: "继续",
          description: "",
          followUpQuestion: "详细说明",
        },
      ],
    }));
  });
});

describe("console info feed controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("对外 API 覆盖 run/refresh/reset 路径并委派到子 controller", async () => {
    const { controller, executionControllerMock, historyControllerMock } = createInfoFeedControllerHarness();

    expect(controller).toEqual(expect.objectContaining({
      clearInfoFeedKeywordCache: expect.any(Function),
      runInfoFeed: expect.any(Function),
      runInfoFeedAgentTrack: expect.any(Function),
      runInfoFeedKeywordTrack: expect.any(Function),
      runInfoFeedSummaryAgent: expect.any(Function),
      resetInfoFeedRunForContinuation: expect.any(Function),
      restoreInfoFeedHistory: expect.any(Function),
    }));

    await controller.runInfoFeed();
    expect(executionControllerMock.runInfoFeed).toHaveBeenCalledTimes(1);

    await controller.restoreInfoFeedHistory();
    expect(historyControllerMock.restoreInfoFeedHistory).toHaveBeenCalledTimes(1);

    const run = makeRun();
    controller.resetInfoFeedRunForContinuation(run, "为什么？");
    expect(historyControllerMock.resetInfoFeedRunForContinuation).toHaveBeenCalledWith(run, "为什么？");
  });

  it("空状态下 infoFeedReadyForSummary 为 false；run 就绪后可切换计算状态", () => {
    const { controller } = createInfoFeedControllerHarness();
    expect(controller.infoFeedCurrentRun.value).toBeNull();
    expect(controller.infoFeedReadyForSummary.value).toBe(false);
    expect(controller.infoFeedNeedsModelSelection.value).toBe(false);
    expect(controller.infoFeedNeedsRetryContinue.value).toBe(false);

    const run = makeRun();
    run.keyword.status = "completed";
    run.agent.status = "completed";
    run.summary.status = "completed";
    controller.infoFeedCurrentRun.value = run;

    expect(controller.infoFeedReadyForSummary.value).toBe(true);
    run.pausedForModelSelection = "summary";
    expect(controller.infoFeedNeedsModelSelection.value).toBe(true);
    expect(controller.infoFeedNeedsRetryContinue.value).toBe(false);
    expect(controller.infoFeedModelSelectionMessage.value).toContain("总结智能体");
  });
});
