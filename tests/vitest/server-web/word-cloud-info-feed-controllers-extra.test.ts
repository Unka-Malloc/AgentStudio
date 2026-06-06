// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createConsoleWordCloudWorkflowController } from "../../../server-web/composables/console-word-cloud-workflow-controller";
import { createConsoleInfoFeedExecutionController } from "../../../server-web/composables/console-info-feed-execution-controller";
import { createConsoleInfoFeedHistoryController } from "../../../server-web/composables/console-info-feed-history-controller";
import { createConsoleInfoFeedOutputController } from "../../../server-web/composables/console-info-feed-output-controller";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import type {
  InfoFeedClarification,
  InfoFeedClarificationOption,
  InfoFeedRunState,
} from "../../../server-web/types/app";

const wordCloudClient = vi.hoisted(() => ({
  getKnowledgeWordClouds: vi.fn(),
  saveKnowledgeWordClouds: vi.fn(),
  proposeKnowledgeWordClouds: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-word-cloud-client", () => ({
  getKnowledgeWordClouds: wordCloudClient.getKnowledgeWordClouds,
  saveKnowledgeWordClouds: wordCloudClient.saveKnowledgeWordClouds,
  proposeKnowledgeWordClouds: wordCloudClient.proposeKnowledgeWordClouds,
}));

const executionTrackController = vi.hoisted(() => ({
  runInfoFeedKeywordTrack: vi.fn(),
  runInfoFeedAgentTrack: vi.fn(),
}));
const executionSummaryRunner = vi.hoisted(() => ({
  runInfoFeedSummaryAgent: vi.fn(),
}));
const executionExpertFeedbackController = vi.hoisted(() => ({
  syncInfoFeedExpertFeedback: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-info-feed-track-controller", () => ({
  createConsoleInfoFeedTrackController: vi.fn(() => executionTrackController),
}));

vi.mock("../../../server-web/composables/console-info-feed-summary-runner-controller", () => ({
  createConsoleInfoFeedSummaryRunnerController: vi.fn(() => executionSummaryRunner),
}));

vi.mock("../../../server-web/composables/console-info-feed-expert-feedback-controller", () => ({
  createConsoleInfoFeedExpertFeedbackController: vi.fn(() => executionExpertFeedbackController),
}));

const copyTextToClipboardMock = vi.hoisted(() => vi.fn());
const downloadTextFileMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyTextToClipboard: copyTextToClipboardMock,
  downloadTextFile: downloadTextFileMock,
}));

function summaryDefaults() {
  return {
    modelAlias: "model-default",
    contextProfileId: "ctx-default",
    temperature: 0.2,
    maxTokens: 1800,
  };
}

function createBaseRun(query = "Q") {
  return createInfoFeedRunState(query, {
    attachments: [],
    summaryDefaults: summaryDefaults(),
  });
}

function createWordCloudFixture(overrides: Record<string, unknown> = {}) {
  const busyKey = ref("");
  const options = {
    addTermToCloud: vi.fn(),
    applySavedWordCloudSet: vi.fn(),
    autoAbsorbWordCloudTerms: vi.fn(() => 0),
    busyKey,
    canReadKnowledge: ref(true),
    canWriteKnowledge: ref(true),
    clearAllBusy: vi.fn(),
    createDefaultWordCloudSet: (terms: unknown[] = []) => ({
      schemaVersion: 1,
      wordBagSetId: "default-set",
      title: "语料词云",
      status: "draft",
      wordBagCount: 0,
      termsSnapshot: [...terms],
      wordBags: [],
      unassignedTerms: [...terms],
      corpusPaths: [],
      modelAlias: "",
    }),
    fillingWordBagIds: ref(new Set<string>()),
    fillSourceWordBagSetId: ref<string | null>(null),
    fillTargetWordBagId: ref<string | null>(null),
    refreshWordCloudCorpusTerms: vi.fn(),
    resolveWordCloudCorpusPathsForQuery: vi.fn(() => [] as Array<{ path: string; type: string }>),
    selectedWordCloudModel: ref({ value: "m1", enabled: true, disabledReason: "" }),
    setBusy: vi.fn((key: string) => {
      busyKey.value = key;
    }),
    setWordCloudDraftFromState: vi.fn(),
    wordCloudCorpusPaths: ref([] as Array<{ path: string; type: string }>),
    wordCloudDraft: ref<any>(null),
    wordCloudMessages: ref<any[]>([]),
    wordCloudModelAlias: ref("model-default"),
    wordCloudPrompt: ref(""),
    wordCloudState: ref<any>(null),
    wordCloudTerms: ref<any[]>([]),
    error: ref(""),
  };

  return {
    controller: createConsoleWordCloudWorkflowController({ ...(options as any), ...overrides }),
    options: { ...(options as any), ...overrides },
  };
}

function createExecutionFixture(overrides: Record<string, unknown> = {}) {
  const error = ref("");
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
  const infoFeedForm = ref({
    query: "",
    modelAlias: "",
    contextProfileId: "",
    temperature: 0.2,
    maxTokens: 1800,
  });
  const infoFeedRunSequence = ref(0);

  const options = {
    agentExploreConfiguredLimit: ref(40),
    agentExploreConfiguredMaxIterations: ref(5),
    agentExploreThinkingParameters: vi.fn(() => ({ think: "deep" })),
    applyInfoFeedSummaryAnswer: vi.fn((run: InfoFeedRunState, answer: string, fallback: boolean, errorText = "") => {
      run.summary.answer = answer;
      run.summary.fallback = fallback;
      run.summary.error = errorText;
    }),
    archiveInfoFeedExpertFeedback: vi.fn((run: InfoFeedRunState, clarification: InfoFeedClarification, option: InfoFeedClarificationOption) => ({
      feedbackId: "fb-1",
      questionId: clarification.questionId,
      anchor: clarification.anchor,
      prompt: clarification.prompt,
      reason: clarification.reason,
      selectedOptionId: option.optionId,
      selectedLabel: option.label,
      selectedDescription: option.description,
      followUpQuestion: option.followUpQuestion,
      sourceQuery: run.query,
      createdAt: "2026-06-04T00:00:00.000Z",
      syncedAt: "",
      syncStatus: "pending",
      syncError: "",
    })),
    buildInfoFeedAgentQuery: vi.fn((run: InfoFeedRunState) => `agent:${run.query}`),
    buildInfoFeedSourceSearchQuery: vi.fn((run: InfoFeedRunState) => `source:${run.query}`),
    buildInfoFeedSummaryQuestion: vi.fn((run: InfoFeedRunState) => `summary:${run.query}`),
    canReadKnowledge: ref(true),
    canWriteKnowledge: ref(true),
    createInfoFeedRun: vi.fn((query: string) => createBaseRun(query)),
    fallbackInfoFeedSummary: vi.fn((run: InfoFeedRunState) => `fallback:${run.query}`),
    infoFeedAgentExpertGuidance: vi.fn(() => ({})),
    infoFeedAgentProgressFromResult: vi.fn(() => 100),
    infoFeedAgentRecentTurns: vi.fn(() => []),
    infoFeedCanFollowUp: ref(false),
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedKeywordCache: new Map<string, { response: never; cachedAt: number }>(),
    infoFeedParentRunSnapshot: ref<InfoFeedRunState | null>(null),
    infoFeedReadyForSummary: ref(true),
    infoFeedRunEvidenceRefs: vi.fn(() => ["ev-run"]),
    infoFeedRunSequence,
    resetInfoFeedRunForContinuation: vi.fn((run: InfoFeedRunState, question: string) => {
      run.query = `${run.query}|${question}`;
    }),
    selectedInfoFeedContextProfile: ref({ value: "ctx-default" }),
    selectedInfoFeedModel: ref({ value: "model-default", enabled: true }),
    selectedThinkingMode: ref("deep"),
    upsertInfoFeedHistory: vi.fn(),
    infoFeedRunState: ref<InfoFeedRunState | null>(null),
    error,
    ...overrides,
  };

  return {
    controller: createConsoleInfoFeedExecutionController(options as any),
    options,
    error,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedRunSequence,
  };
}

function createOutputFixture(overrides: Record<string, unknown> = {}) {
  const run = createBaseRun("起始问题");
  run.summary.answer = "summary evidence::s1";
  run.summary.status = "completed";
  run.summary.modelAlias = "model-2";

  const options = {
    error: ref("") as any,
    infoFeedAgentAnswer: ref("agent evidence::a1") as any,
    infoFeedCurrentRun: ref<InfoFeedRunState | null>(run),
    infoFeedForm: ref({
      query: "问题",
      modelAlias: "",
      contextProfileId: "",
      temperature: 0.4,
      maxTokens: 1200,
    }),
    infoFeedKeywordItems: ref([{ evidenceId: "source-evidence::k1" }] as any[]),
    infoFeedParentRunForCurrent: ref<InfoFeedRunState | null>(null),
    infoFeedRunEvidenceRefs: vi.fn(() => ["parent-ref"]),
    infoFeedSummaryStreamText: ref("") as any,
    infoFeedSummaryStreamTimer: ref(null as number | null),
    modelDisplayLabel: vi.fn((value = "") => `模型-${value}`),
    recordFeedback: vi.fn(),
    selectedInfoFeedModel: ref({ value: "model-2" }),
    ...overrides,
  } as const;

  return {
    run,
    options,
    controller: createConsoleInfoFeedOutputController(options as any),
  };
}

function createHistoryFixture(overrides: Record<string, unknown> = {}) {
  const infoFeedHistory = ref<InfoFeedRunState[]>([]);
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
  const infoFeedForm = ref({
    query: "",
    modelAlias: "",
    contextProfileId: "",
    temperature: 0.2,
    maxTokens: 1800,
  });

  const options = {
    infoFeedAttachments: ref([] as any[]),
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot: ref<InfoFeedRunState | null>(null),
    storageKey: "test-info-feed-history",
    evidenceRefs: vi.fn(() => ["ev-history"]),
    hasAgentModelOption: vi.fn((value?: string) => value !== "invalid"),
    summaryDefaults: summaryDefaults,
    validAgentModelAlias: (value?: string) => (value === "invalid" ? "fallback-model" : (value || "fallback-model")),
    ...overrides,
  };

  return {
    controller: createConsoleInfoFeedHistoryController(options as any),
    options: {
      ...options,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedHistory,
    },
  };
}

describe("word cloud workflow controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("暴露公开 API 并覆盖词云读取/保存/生成的成功与失败路径", async () => {
    const { controller, options } = createWordCloudFixture();

    expect(controller).toEqual(expect.objectContaining({
      applyWordCloudEvent: expect.any(Function),
      autoFillCloudWithAgent: expect.any(Function),
      proposeWordCloud: expect.any(Function),
      refreshWordCloud: expect.any(Function),
      saveWordCloud: expect.any(Function),
    }));

    wordCloudClient.getKnowledgeWordClouds.mockResolvedValue({
      terms: [{ term: "a", frequency: 1 }, { term: "b", frequency: 2 }],
      wordBagSet: {
        wordBagSetId: "set-1",
        title: "base",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [{ term: "a", frequency: 1 }, { term: "b", frequency: 2 }],
        wordBags: [],
      },
    });
    options.resolveWordCloudCorpusPathsForQuery.mockReturnValue([{ path: "/tmp", type: "directory" }]);

    await controller.refreshWordCloud();
    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenCalledWith({
      limit: 100000,
      minFrequency: 1,
      corpusPaths: [{ path: "/tmp", type: "directory" }],
    });
    expect(options.setWordCloudDraftFromState).toHaveBeenCalled();
    expect(options.clearAllBusy).toHaveBeenCalled();
    expect(options.error.value).toBe("");
    expect(options.wordCloudMessages.value[0].text).toBe("已读取 2 个语料词。");

    options.wordCloudDraft.value = {
      wordBagSetId: "draft-1",
      title: "draft",
      status: "draft",
      wordBagCount: 0,
      termsSnapshot: [{ term: "old", frequency: 1 }],
      wordBags: [],
      unassignedTerms: [{ term: "old", frequency: 1 }],
    };
    options.wordCloudTerms.value = [{ term: "old", frequency: 1 }];
    wordCloudClient.saveKnowledgeWordClouds.mockResolvedValue({
      ok: true,
      wordBagSet: {
        wordBagSetId: "saved-1",
        title: "saved",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [{ term: "old", frequency: 1 }],
        wordBags: [],
      },
    });

    await controller.saveWordCloud();
    expect(options.setBusy).toHaveBeenCalledWith("knowledge:word-clouds:save");
    expect(options.applySavedWordCloudSet).toHaveBeenCalledWith(expect.objectContaining({ wordBagSetId: "saved-1" }));
    expect(options.clearAllBusy).toHaveBeenCalled();
    expect(options.error.value).toBe("");

    wordCloudClient.saveKnowledgeWordClouds.mockRejectedValueOnce(new Error("保存失败"));
    await controller.saveWordCloud();
    expect(options.error.value).toBe("保存失败");

    options.wordCloudPrompt.value = "按主题聚类";
    options.refreshWordCloudCorpusTerms.mockResolvedValue([{ term: "x", frequency: 1 }]);
    wordCloudClient.proposeKnowledgeWordClouds.mockResolvedValue({
      ok: true,
      run: { runId: "run-123" },
      wordBagSet: {
        wordBagSetId: "proposed",
        title: "proposed",
        status: "ready",
        wordBagCount: 1,
        termsSnapshot: [{ term: "x", frequency: 1 }],
        wordBags: [{ wordBagId: "w-1", label: "主题1", terms: [] }],
      },
    });

    await controller.proposeWordCloud();
    expect(options.refreshWordCloudCorpusTerms).toHaveBeenCalledWith({
      silent: true,
      forceRebuild: true,
      corpusPaths: [{ path: "/tmp", type: "directory" }],
    });
    expect(wordCloudClient.proposeKnowledgeWordClouds).toHaveBeenCalled();
    expect(options.error.value).toBe("");
    expect(options.wordCloudMessages.value[0].text).toBe("词云分类后台任务已启动。");

    options.wordCloudPrompt.value = "按主题聚类";
    options.refreshWordCloudCorpusTerms.mockResolvedValue([{ term: "x", frequency: 1 }]);
    wordCloudClient.proposeKnowledgeWordClouds.mockRejectedValueOnce(new Error("生成失败"));
    await controller.proposeWordCloud();
    expect(options.error.value).toBe("生成失败");
  });

  it("自动填充链路会更新填充状态并在事件回写后清理进度", async () => {
    const { controller, options } = createWordCloudFixture();

    options.wordCloudDraft.value = {
      wordBagSetId: "set-1",
      title: "base",
      status: "ready",
      wordBagCount: 1,
      termsSnapshot: [],
      wordBags: [{ wordBagId: "target", label: "目标词云", terms: [] }],
    };
    options.refreshWordCloudCorpusTerms.mockResolvedValue([{ term: "a", frequency: 1 }]);
    options.resolveWordCloudCorpusPathsForQuery.mockReturnValue([{ path: "/tmp", type: "directory" }]);
    wordCloudClient.proposeKnowledgeWordClouds.mockResolvedValue({
      ok: true,
      wordBagSet: {
        wordBagSetId: "fill-source",
        title: "auto",
        status: "draft",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
      },
    });

    await controller.autoFillCloudWithAgent("target");
    expect(options.fillingWordBagIds.value.has("target")).toBe(true);
    expect(options.fillTargetWordBagId.value).toBe("target");
    expect(options.fillSourceWordBagSetId.value).toBe("fill-source");

    controller.applyWordCloudEvent({
      wordBagSetId: "fill-source",
      status: "ready",
      wordBags: [{
        wordBagId: "x",
        label: "x",
        terms: [{ term: "one", frequency: 1 }, { term: "two", frequency: 2 }],
      }],
    } as any);

    expect(options.addTermToCloud).toHaveBeenCalledTimes(2);
    expect(options.fillingWordBagIds.value.has("target")).toBe(false);
    expect(options.fillTargetWordBagId.value).toBeNull();
    expect(options.fillSourceWordBagSetId.value).toBeNull();
  });

  it("权限和输入检查会阻断请求并保持错误状态", async () => {
    const { controller, options } = createWordCloudFixture();

    options.canReadKnowledge.value = false;
    await controller.refreshWordCloud();
    expect(wordCloudClient.getKnowledgeWordClouds).not.toHaveBeenCalled();

    options.canReadKnowledge.value = true;
    options.canWriteKnowledge.value = false;
    options.wordCloudDraft.value = { wordBagSetId: "x", title: "", status: "draft", wordBagCount: 0, termsSnapshot: [], wordBags: [] };
    await controller.saveWordCloud();
    expect(options.error.value).toBe("需要 knowledge:write 权限才能保存词云。");

    options.canWriteKnowledge.value = true;
    options.canReadKnowledge.value = true;
    options.selectedWordCloudModel.value = { value: "", enabled: false, disabledReason: "模型不可用" };
    options.wordCloudPrompt.value = "x";
    await controller.proposeWordCloud();
    expect(options.error.value).toBe("模型不可用");
  });
});

describe("info feed execution controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("暴露公开 API 并覆盖 runInfoFeed 的校验与执行链", async () => {
    const { controller, options, infoFeedCurrentRun, infoFeedForm, infoFeedRunSequence } = createExecutionFixture();

    expect(controller).toEqual(expect.objectContaining({
      chooseInfoFeedClarification: expect.any(Function),
      continueInfoFeedAfterModelSelection: expect.any(Function),
      continueInfoFeedAfterRetry: expect.any(Function),
      continueInfoFeedCurrentRun: expect.any(Function),
      executeInfoFeedRunIteration: expect.any(Function),
      runInfoFeed: expect.any(Function),
      runInfoFeedAgentTrack: expect.any(Function),
      runInfoFeedKeywordTrack: expect.any(Function),
      runInfoFeedSummaryAgent: expect.any(Function),
      syncInfoFeedExpertFeedback: expect.any(Function),
    }));

    infoFeedForm.value.query = "  ";
    await controller.runInfoFeed();
    expect(options.error.value).toBe("请输入信息流问题。");

    infoFeedForm.value.query = "我的问题";
    options.canReadKnowledge.value = false;
    await controller.runInfoFeed();
    expect(options.error.value).toBe("当前账号没有知识库读取权限。");

    options.canReadKnowledge.value = true;
    options.selectedInfoFeedModel.value.enabled = false;
    await controller.runInfoFeed();
    expect(options.error.value).toBe("请选择模型库中已配置且支持智能体调用的模型。");

    options.selectedInfoFeedModel.value.enabled = true;
    executionTrackController.runInfoFeedKeywordTrack.mockImplementation(async (sequence: number, runId: string) => {
      expect(sequence).toBe(infoFeedRunSequence.value);
      expect(infoFeedCurrentRun.value?.runId).toBe(runId);
    });
    executionTrackController.runInfoFeedAgentTrack.mockResolvedValue(undefined);
    executionSummaryRunner.runInfoFeedSummaryAgent.mockResolvedValue(undefined);

    infoFeedForm.value.query = "我的问题";
    await controller.runInfoFeed();
    expect(infoFeedCurrentRun.value?.query).toBe("我的问题");
    expect(infoFeedRunSequence.value).toBe(1);
    expect(infoFeedForm.value.query).toBe("");
    expect(executionTrackController.runInfoFeedKeywordTrack).toHaveBeenCalledTimes(1);
    expect(executionTrackController.runInfoFeedAgentTrack).toHaveBeenCalledTimes(1);
    expect(executionSummaryRunner.runInfoFeedSummaryAgent).toHaveBeenCalledTimes(1);

    options.infoFeedCurrentRun.value = createBaseRun("历史追问");
    options.createInfoFeedRun.mockClear();
    infoFeedForm.value.query = "继续我的问题";
    options.infoFeedCanFollowUp.value = true;
    await controller.runInfoFeed();
    expect(options.createInfoFeedRun).toHaveBeenCalledTimes(0);
    expect(infoFeedRunSequence.value).toBe(2);
  });

  it("澄清/模型选择/重试分支会更新状态并驱动后续执行", async () => {
    const { controller, options, infoFeedCurrentRun } = createExecutionFixture();

    const run = createBaseRun("上一步");
    run.clarification = {
      questionId: "q1",
      prompt: "如何继续？",
      reason: "ambiguity",
      anchor: "summary",
      status: "open",
      selectedOptionId: "",
      options: [{
        optionId: "o1",
        label: "A",
        description: "desc",
        followUpQuestion: "继续",
      }],
    };
    run.summary.status = "completed";
    infoFeedCurrentRun.value = run;
    options.selectedInfoFeedModel.value.enabled = true;
    executionTrackController.runInfoFeedKeywordTrack.mockResolvedValue(undefined);
    executionTrackController.runInfoFeedAgentTrack.mockResolvedValue(undefined);
    executionSummaryRunner.runInfoFeedSummaryAgent.mockResolvedValue(undefined);

    await controller.chooseInfoFeedClarification({
      optionId: "o1",
      label: "A",
      description: "desc",
      followUpQuestion: "继续",
    });

    expect(run.clarification?.status).toBe("answered");
    expect(executionExpertFeedbackController.syncInfoFeedExpertFeedback).toHaveBeenCalledTimes(1);

    const retryRun = createBaseRun("重试问题");
    retryRun.pausedForRetry = "keyword";
    retryRun.summary.status = "failed";
    infoFeedCurrentRun.value = retryRun;
    executionTrackController.runInfoFeedKeywordTrack.mockImplementation(async () => {
      retryRun.keyword.status = "completed";
    });
    await controller.continueInfoFeedAfterRetry();
    expect(retryRun.keyword.status).toBe("completed");

    const modelRun = createBaseRun("模型重选");
    modelRun.pausedForModelSelection = "agent";
    infoFeedCurrentRun.value = modelRun;
    options.selectedInfoFeedModel.value = { value: "model-new", enabled: true };
    executionTrackController.runInfoFeedAgentTrack.mockImplementation(async () => {
      modelRun.agent.status = "completed";
      modelRun.agent.runId = "agent-run";
      modelRun.agent.workspaceId = "ws";
    });
    await controller.continueInfoFeedAfterModelSelection();
    expect(modelRun.summary.modelAlias).toBe("model-new");
    expect(modelRun.summary.contextProfileId).toBe("ctx-default");
    expect(modelRun.pausedForModelSelection).toBe("");
    expect(executionTrackController.runInfoFeedAgentTrack).toHaveBeenCalledTimes(2);
  });
});

describe("info feed output controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("暴露公开 API 并覆盖 computed 与流式输出状态切换", async () => {
    const { controller, options, run } = createOutputFixture();

    expect(typeof controller.clearInfoFeedSummaryStreamTimer).toBe("function");
    expect(typeof controller.copyInfoFeedSummary).toBe("function");
    expect(typeof controller.exportInfoFeedSummary).toBe("function");
    expect(typeof controller.infoFeedCurrentUserQuestion).toBe("function");
    expect(typeof controller.infoFeedExpertFeedbackFor).toBe("function");
    expect(typeof controller.infoFeedSummaryEvidenceRefs).toBe("object");
    expect(typeof controller.infoFeedSummaryMarkdown).toBe("object");
    expect(typeof controller.infoFeedSummaryRuntime).toBe("object");
    expect(typeof controller.infoFeedStreamingSummaryHtml).toBe("object");
    expect(typeof controller.infoFeedSummaryIsStreaming).toBe("object");
    expect(typeof controller.infoFeedTurnTitle).toBe("function");
    expect(typeof controller.streamInfoFeedSummary).toBe("function");
    expect(controller.infoFeedSummaryEvidenceRefs).toHaveProperty("value");
    expect(controller.infoFeedSummaryMarkdown).toHaveProperty("value");
    expect(controller.infoFeedSummaryRuntime).toHaveProperty("value");
    expect(controller.infoFeedStreamingSummaryHtml).toHaveProperty("value");
    expect(controller.infoFeedSummaryIsStreaming).toHaveProperty("value");

    expect(controller.infoFeedSummaryRuntime.value).toEqual({
      model: "模型-model-2",
      temperature: 0.2,
      maxTokens: 1800,
    });

    expect(controller.infoFeedSummaryEvidenceRefs.value).toEqual([
      "source-evidence::k1",
      "evidence::a1",
      "evidence::s1",
    ]);

    expect(controller.infoFeedSummaryMarkdown.value).toContain("# 信息流总结");
    options.infoFeedCurrentRun.value.followUp = {
      parentRunId: "p1",
      parentQuery: "old",
      question: "追问",
      parentSummary: "parent",
      parentEvidenceRefs: [],
    };
    expect(controller.infoFeedCurrentUserQuestion(options.infoFeedCurrentRun.value)).toBe("追问");

    options.infoFeedCurrentRun.value.summary.answer = "ABCD";
    options.infoFeedCurrentRun.value.summary.answer = "ABCD";
    await controller.streamInfoFeedSummary("ABCD", options.infoFeedCurrentRun.value.runId);
    expect(options.infoFeedSummaryStreamText.value).toBe("A");
    expect(controller.infoFeedSummaryIsStreaming.value).toBe(true);
    vi.advanceTimersByTime(20);
    await nextTick();
    expect(options.infoFeedSummaryStreamText.value).toBe("ABCD");
    expect(controller.infoFeedSummaryIsStreaming.value).toBe(false);
  });

  it("复制导出路径在成功与失败时更新错误与反馈", async () => {
    const { controller, options, run } = createOutputFixture();

    copyTextToClipboardMock.mockResolvedValue(undefined);
    await controller.copyInfoFeedSummary();
    expect(copyTextToClipboardMock).toHaveBeenCalledWith(expect.stringContaining("# 信息流总结"));
    expect(options.recordFeedback).toHaveBeenCalledWith("copy", expect.objectContaining({
      surface: "info_feed",
      query: run.query,
      itemId: run.runId,
    }));

    copyTextToClipboardMock.mockRejectedValueOnce(new Error("clipboard-fail"));
    await controller.copyInfoFeedSummary();
    expect(options.error.value).toBe("clipboard-fail");

    options.infoFeedCurrentRun.value.summary.answer = "";
    await controller.copyInfoFeedSummary();
    expect(options.error.value).toBe("暂无可复制的信息流总结。");

    options.infoFeedCurrentRun.value.summary.answer = "有答案";
    await controller.exportInfoFeedSummary();
    const [filename, content, type] = downloadTextFileMock.mock.calls.at(-1) as [string, string, string];
    expect(filename).toContain("起始问题");
    expect(filename.endsWith(".md")).toBe(true);
    expect(type).toBe("text/markdown;charset=utf-8");
    expect(content).toContain("# 信息流总结");

    options.infoFeedCurrentRun.value.summary.answer = "";
    await controller.exportInfoFeedSummary();
    expect(options.error.value).toBe("暂无可导出的信息流总结。");
  });
});

describe("info feed history controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("暴露公开 API 并覆盖 computed 行列表与历史入库状态", () => {
    const { controller, options } = createHistoryFixture();

    expect(controller).toEqual(expect.objectContaining({
      appendInfoFeedTurnSnapshot: expect.any(Function),
      clearInvalidInfoFeedModelReferences: expect.any(Function),
      compactInfoFeedRunForStorage: expect.any(Function),
      createInfoFeedRun: expect.any(Function),
      deleteInfoFeedHistory: expect.any(Function),
      deleteInfoFeedHistoryItem: expect.any(Function),
      handleInfoFeedAttachmentFiles: expect.any(Function),
      infoFeedHistoryPanelItems: expect.any(Object),
      openInfoFeedHistoryRun: expect.any(Function),
      readInfoFeedAttachment: expect.any(Function),
      removeInfoFeedAttachment: expect.any(Function),
      restoreInfoFeedHistory: expect.any(Function),
      upsertInfoFeedHistory: expect.any(Function),
    }));

    const runA = createBaseRun("问题A");
    runA.runId = "a";
    runA.completedAt = "2026-06-04T00:00:00.000Z";
    runA.summary.answer = "答案A";

    const runB = createBaseRun("问题B");
    runB.runId = "b";
    runB.completedAt = "2026-06-03T00:00:00.000Z";
    runB.summary.answer = "答案B";

    options.infoFeedHistory.value = [runA, runB];
    options.infoFeedCurrentRun.value = runA;

    expect(controller.infoFeedHistoryPanelItems.value).toHaveLength(2);
    expect(controller.infoFeedHistoryPanelItems.value[0]).toMatchObject({
      id: "a",
      title: "问题A",
      active: true,
    });
    expect(controller.infoFeedHistoryPanelItems.value[1]).toMatchObject({
      id: "b",
      title: "问题B",
      active: false,
    });
  });

  it("附件读写与读写历史持久化行为可复现", async () => {
    const { controller, options } = createHistoryFixture();

    const small = new File(["hello"], "small.txt", { type: "text/plain" });
    const large = new File(["x".repeat(2 * 1024 * 1024 + 1)], "big.txt", { type: "text/plain" });

    await controller.handleInfoFeedAttachmentFiles([small, large]);
    expect(options.infoFeedAttachments.value[0].status).toBe("completed");
    expect(options.infoFeedAttachments.value[1].status).toBe("failed");

    const binary = new File(["\u0000"], "binary.txt", { type: "text/plain" });
    const result = await controller.readInfoFeedAttachment(binary);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("文件内容为空或疑似二进制内容。");

    const run = createBaseRun("历史");
    run.runId = "run-1";
    run.summary.answer = "answer";
    run.summary.status = "completed";
    controller.upsertInfoFeedHistory(run);
    expect(options.infoFeedHistory.value).toHaveLength(1);
    const secondRun = createBaseRun("历史2");
    secondRun.runId = "run-1";
    secondRun.summary.answer = "new answer";
    secondRun.summary.status = "completed";
    controller.upsertInfoFeedHistory(secondRun);
    expect(options.infoFeedHistory.value).toHaveLength(1);
    expect(options.infoFeedHistory.value[0].summary.answer).toBe("new answer");

    controller.deleteInfoFeedHistory("run-1");
    expect(options.infoFeedHistory.value).toHaveLength(0);
  });

  it("恢复历史并清洗模型引用、去重运行记录", () => {
    const { controller, options } = createHistoryFixture();

    const run = createBaseRun("恢复");
    run.runId = "r1";
    run.summary.answer = "restore answer";
    run.summary.status = "completed";
    run.summary.modelAlias = "invalid";
    const duplicate = { ...run, runId: "r1", completedAt: "2026-06-05T00:00:00.000Z", summary: { ...run.summary, modelAlias: "invalid" } } as InfoFeedRunState;

    window.localStorage.setItem(options.storageKey, JSON.stringify({ version: 1, history: [run, duplicate] }));
    controller.restoreInfoFeedHistory();
    expect(options.infoFeedHistory.value).toHaveLength(1);
    expect(options.infoFeedHistory.value[0].summary.modelAlias).toBe("fallback-model");

    options.infoFeedHistory.value[0].summary.answer = "updated";
    options.infoFeedCurrentRun.value = { ...options.infoFeedHistory.value[0], query: "current" };
    controller.clearInvalidInfoFeedModelReferences();
    expect(options.infoFeedCurrentRun.value?.summary.modelAlias).toBe("fallback-model");
  });
});
