// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleNavigationController } from "../../../server-web/composables/console-navigation-controller";
import { createConsoleInfoFeedHistoryController } from "../../../server-web/composables/console-info-feed-history-controller";
import { createConsoleInfoFeedOutputController } from "../../../server-web/composables/console-info-feed-output-controller";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";
import type { InfoFeedRunState, InfoFeedTurnSnapshot } from "../../../server-web/types/app";

const browserEffectsMocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(),
  downloadTextFile: vi.fn(),
}));

const feedContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyTextToClipboard: browserEffectsMocks.copyTextToClipboard,
  downloadTextFile: browserEffectsMocks.downloadTextFile,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedContextMock.current,
}));

function summaryDefaults() {
  return {
    modelAlias: "summary-model",
    contextProfileId: "ctx-default",
    temperature: 0.2,
    maxTokens: 1800,
  };
}

function makeRun(overrides: Partial<InfoFeedRunState> = {}) {
  const run = createInfoFeedRunState("主问题", {
    attachments: [],
    summaryDefaults: summaryDefaults(),
  });
  run.runId = overrides.runId || "run-1";
  run.query = overrides.query || "主问题";
  run.startedAt = overrides.startedAt || "2026-06-04T00:00:00.000Z";
  run.completedAt = overrides.completedAt || "2026-06-04T00:10:00.000Z";
  run.followUp = overrides.followUp || {
    question: "继续追问",
    selectedLabel: "继续",
    selectedValue: "continue",
  };
  run.attachments = overrides.attachments || [
    {
      id: "att-1",
      name: "current.md",
      size: 123,
      type: "text/markdown",
      status: "completed",
      progress: 100,
      text: "current attachment",
      error: "",
    },
  ];
  run.expertFeedback = overrides.expertFeedback || [
    {
      anchor: "summary",
      selectedLabel: "继续",
      followUpQuestion: "补充细节",
    },
  ];
  run.turns = overrides.turns || [
    {
      turnId: "turn-1",
      question: "第一个问题",
      followUpQuestion: "要补充什么？",
      summaryAnswer: "Turn 1 answer with source-evidence::ev_turn",
      summaryFallback: false,
      completedAt: "2026-06-04T00:05:00.000Z",
      evidenceRefs: ["ev_turn"],
      attachments: [
        {
          id: "turn-att-1",
          name: "turn.txt",
          size: 16,
          type: "text/plain",
          status: "completed",
          progress: 100,
          text: "turn attachment",
          error: "",
        },
      ],
      expertFeedback: [
        {
          anchor: "summary",
          selectedLabel: "继续",
          followUpQuestion: "补充细节",
        },
      ],
    } as InfoFeedTurnSnapshot,
  ];
  run.summary.status = overrides.summary?.status || "completed";
  run.summary.modelAlias = overrides.summary?.modelAlias || "summary-model";
  run.summary.contextProfileId = overrides.summary?.contextProfileId || "ctx-default";
  run.summary.temperature = overrides.summary?.temperature ?? 0.7;
  run.summary.maxTokens = overrides.summary?.maxTokens ?? 2048;
  run.summary.answer = overrides.summary?.answer || "结论引用 source-evidence::ev_summary";
  run.summary.error = overrides.summary?.error || "";
  run.summary.fallback = overrides.summary?.fallback || false;
  return run;
}

function createNavigationFixture() {
  const error = ref("");
  const featureFlags: Record<string, boolean> = {
    "knowledge-core": true,
  };
  const router = {
    currentRoute: ref({
      path: "/dashboard",
      meta: { viewId: "dashboard" },
      params: {},
    }),
    push: vi.fn(),
  };
  const refreshAuthAdmin = vi.fn();
  const refreshBackgroundProcesses = vi.fn();
  const refreshClientRuntimeStatus = vi.fn();
  const refreshContextCompiler = vi.fn();
  const refreshDashboardAlertsSnapshot = vi.fn();
  const refreshExpertRules = vi.fn();
  const refreshKnowledgeConsole = vi.fn();
  const refreshKnowledgeRecallBackendSpaces = vi.fn();
  const refreshMaintenanceAgent = vi.fn();
  const refreshMonitorAlerts = vi.fn();
  const refreshState = vi.fn();
  const refreshToolManagement = vi.fn();
  const refreshWordCloud = vi.fn();
  const ensureAgentPermissionGroupsDraft = vi.fn();
  const scrollToConfigTarget = vi.fn(async () => undefined);

  return {
    controller: createConsoleNavigationController({
      error,
      ensureAgentPermissionGroupsDraft,
      hasFeature: (featureId: string) => featureFlags[featureId] ?? true,
      isAdminViewEnabled: (tab) => tab !== "toolList",
      refreshAuthAdmin,
      refreshBackgroundProcesses,
      refreshClientRuntimeStatus,
      refreshContextCompiler,
      refreshDashboardAlertsSnapshot,
      refreshExpertRules,
      refreshKnowledgeConsole,
      refreshKnowledgeRecallBackendSpaces,
      refreshMaintenanceAgent,
      refreshMonitorAlerts,
      refreshState,
      refreshToolManagement,
      refreshWordCloud,
      scrollToConfigTarget,
      visibleDebugTabs: ref([
        { id: "knowledgeRecall", label: "知识召回" },
        { id: "knowledgeDistillation", label: "知识蒸馏" },
      ]),
      visibleKnowledgeTabs: ref([
        { id: "management", label: "知识归档" },
        { id: "wordCloud", label: "词云" },
      ]),
    }),
    ensureAgentPermissionGroupsDraft,
    error,
    refreshAuthAdmin,
    refreshBackgroundProcesses,
    refreshClientRuntimeStatus,
    refreshContextCompiler,
    refreshDashboardAlertsSnapshot,
    refreshExpertRules,
    refreshKnowledgeConsole,
    refreshKnowledgeRecallBackendSpaces,
    refreshMaintenanceAgent,
    refreshMonitorAlerts,
    refreshState,
    refreshToolManagement,
    refreshWordCloud,
    router,
    scrollToConfigTarget,
    featureFlags,
  };
}

function createHistoryFixture() {
  const infoFeedAttachments = ref<InfoFeedRunState["attachments"]>([]);
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
  const infoFeedForm = ref({
    query: "",
    modelAlias: "",
    contextProfileId: "ctx-start",
    temperature: 0.2,
    maxTokens: 1800,
  });
  const infoFeedHistory = ref<InfoFeedRunState[]>([]);
  const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(null);

  const controller = createConsoleInfoFeedHistoryController({
    infoFeedAttachments,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot,
    storageKey: "console-high-gap-fourth-history",
    evidenceRefs: () => ["ev-1"],
    hasAgentModelOption: (value?: string) => value !== "removed",
    summaryDefaults,
    validAgentModelAlias: (value?: string) => (value === "removed" ? "fallback-model" : (value || "")),
  });

  return {
    controller,
    infoFeedAttachments,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot,
  };
}

function createOutputFixture() {
  const error = ref("");
  const infoFeedAgentAnswer = ref("Agent answer with source-evidence::ev_agent");
  const infoFeedCurrentRun = ref(makeRun());
  const infoFeedForm = ref({
    query: "主问题",
    modelAlias: "summary-model",
    contextProfileId: "ctx-default",
    temperature: 0.2,
    maxTokens: 1800,
  });
  const infoFeedKeywordItems = ref([
    { evidenceId: "ev_keyword" },
    { evidenceId: "ev_keyword" },
  ]);
  const infoFeedParentRunForCurrent = ref<InfoFeedRunState | null>(makeRun({
    runId: "parent-run",
    query: "父问题",
    summary: {
      status: "completed",
      modelAlias: "summary-model",
      contextProfileId: "ctx-parent",
      temperature: 0.4,
      maxTokens: 1024,
      answer: "父答案 source-evidence::ev_parent",
      error: "",
      fallback: false,
    },
    turns: [
      {
        turnId: "parent-turn-1",
        question: "父级问题",
        summaryAnswer: "父级回答 source-evidence::ev_parent",
        summaryFallback: false,
        completedAt: "2026-06-04T00:02:00.000Z",
        evidenceRefs: ["ev_parent"],
        attachments: [],
        expertFeedback: [],
      } as InfoFeedTurnSnapshot,
    ],
    expertFeedback: [],
    attachments: [],
  }));
  const infoFeedSummaryStreamText = ref("");
  const infoFeedSummaryStreamTimer = ref<number | null>(null);
  const selectedInfoFeedModel = ref({ value: "summary-model", enabled: true });
  const recordFeedback = vi.fn();

  const controller = createConsoleInfoFeedOutputController({
    error,
    infoFeedAgentAnswer,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedKeywordItems,
    infoFeedParentRunForCurrent,
    infoFeedRunEvidenceRefs: (run) => run.turns?.flatMap((turn) => turn.evidenceRefs || []) || [],
    infoFeedSummaryStreamText,
    infoFeedSummaryStreamTimer,
    modelDisplayLabel: (value?: string) => `模型:${value || "unknown"}`,
    recordFeedback,
    selectedInfoFeedModel,
  });

  return {
    controller,
    error,
    infoFeedAgentAnswer,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedKeywordItems,
    infoFeedParentRunForCurrent,
    infoFeedSummaryStreamText,
    infoFeedSummaryStreamTimer,
    recordFeedback,
    selectedInfoFeedModel,
  };
}

function createComposerContext(overrides: Record<string, unknown> = {}) {
  return {
    agentSelectorOptions: ref([{ label: "模型 A", value: "model-a" }]),
    busyKey: ref(""),
    contextWindowOptionBarOptions: ref([{ label: "32k", value: "32k" }]),
    handleInfoFeedAttachmentFiles: vi.fn(),
    infoFeedAttachments: ref([]),
    infoFeedCurrentRun: ref(null),
    infoFeedForm: ref({
      contextProfileId: "32k",
      maxTokens: 4096,
      modelAlias: "",
      query: "初始问题",
      temperature: 0.2,
    }),
    infoFeedInputPlaceholder: ref("输入问题"),
    infoFeedModelOptions: ref([{ label: "模型 A", value: "model-a" }]),
    infoFeedSubmitLabel: ref("开始信息流"),
    removeInfoFeedAttachment: vi.fn(),
    runInfoFeed: vi.fn(),
    saveSettings: vi.fn(),
    selectedInfoFeedModel: ref({ enabled: true, label: "模型 A" }),
    settingsDraft: ref({
      agentExploreDefaults: {
        answerTemplate: "模板",
        contextProfileId: "32k",
        continuationPrompt: "继续",
        limit: 5,
        maxIterations: 3,
        maxTokens: 4096,
        reviewFusionMaxTokens: 1024,
        reviewFusionModelAlias: "",
        reviewFusionSystemPrompt: "融合提示词",
        reviewFusionTemperature: 0.1,
        systemPrompt: "系统提示词",
        temperature: 0.2,
        thinkingMode: "balanced",
        toolChoice: "auto",
        toolPolicyPrompt: "工具策略提示词",
      },
    }),
    thinkingModeOptionBarOptions: ref([{ label: "Balanced", value: "balanced" }]),
    ...overrides,
  };
}

function mountComposerPanel() {
  return mount(InfoFeedComposerPanel, {
    global: {
      stubs: {
        AgentModelOptionBar: true,
        BrowseSelectButton: true,
        ConfigFoldCard: true,
        OptionBar: true,
      },
    },
  });
}

beforeEach(() => {
  browserEffectsMocks.copyTextToClipboard.mockReset();
  browserEffectsMocks.downloadTextFile.mockReset();
  feedContextMock.current = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("console-navigation-controller", () => {
  it("falls back to the default admin section, preserves config target, and routes drawers and imports", async () => {
    const harness = createNavigationFixture();
    harness.controller.bindNavigationRouter(harness.router);

    await harness.controller.openAdmin("toolList", { configTarget: "runtime-bridge" });
    expect(harness.router.push).toHaveBeenCalledWith({
      path: "/admin/jobs",
      query: { configTarget: "runtime-bridge" },
    });
    expect(harness.controller.adminView.value).toBe("jobs");
    expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });

    harness.featureFlags["knowledge-core"] = false;
    harness.controller.openDrawer("syncDirectories");
    expect(harness.controller.drawerOpen.value).toBe(true);
    expect(harness.controller.drawerTab.value).toBe("discovery");

    harness.featureFlags["knowledge-core"] = true;
    harness.controller.openDrawer("users");
    expect(harness.refreshAuthAdmin).toHaveBeenCalledTimes(2);

    await harness.controller.jumpToKnowledgeFileImport();
    expect(harness.router.push).toHaveBeenCalledWith("/knowledge/management");
    expect(harness.scrollToConfigTarget).toHaveBeenCalledWith("knowledge-file-import");
  });
});

describe("console-info-feed-history-controller", () => {
  it("covers attachment failure states, successful pending reads, and invalid model cleanup", async () => {
    const harness = createHistoryFixture();
    const { controller } = harness;

    await controller.handleInfoFeedAttachmentFiles([]);
    expect(harness.infoFeedAttachments.value).toHaveLength(0);

    const successFile = new File(["successful content"], "note.md", { type: "text/markdown" });
    await controller.handleInfoFeedAttachmentFiles([successFile]);
    expect(harness.infoFeedAttachments.value).toHaveLength(1);
    expect(harness.infoFeedAttachments.value[0]).toMatchObject({
      name: "note.md",
      status: "completed",
      progress: 100,
    });
    expect(harness.infoFeedAttachments.value[0].text).toContain("successful content");

    const tooLargeFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.md", { type: "text/markdown" });
    const unreadableFile = new File(["x"], "diagram.pdf", { type: "application/pdf" });
    const emptyFile = new File(["   "], "blank.md", { type: "text/markdown" });
    const binaryFile = new File(["\u0000"], "binary.txt", { type: "text/plain" });

    await expect(controller.readInfoFeedAttachment(tooLargeFile)).resolves.toMatchObject({
      status: "failed",
      error: "附件超过 2MB，信息流输入暂不直接读取。",
    });
    await expect(controller.readInfoFeedAttachment(unreadableFile)).resolves.toMatchObject({
      status: "failed",
      error: "当前格式无法在页面侧直接读取。",
    });
    await expect(controller.readInfoFeedAttachment(emptyFile)).resolves.toMatchObject({
      status: "failed",
      error: "文件内容为空或疑似二进制内容。",
    });
    await expect(controller.readInfoFeedAttachment(binaryFile)).resolves.toMatchObject({
      status: "failed",
      error: "文件内容为空或疑似二进制内容。",
    });

    const invalidRun = makeRun({
      runId: "run-invalid",
      summary: {
        status: "completed",
        modelAlias: "removed",
        contextProfileId: "ctx-invalid",
        temperature: 0.2,
        maxTokens: 1800,
        answer: "摘要",
        error: "",
        fallback: false,
      },
      turns: [],
      attachments: [],
      expertFeedback: [],
    });
    const parent = makeRun({ runId: "parent" });
    harness.infoFeedHistory.value = [invalidRun];
    harness.infoFeedCurrentRun.value = invalidRun;
    harness.infoFeedParentRunSnapshot.value = parent;

    controller.clearInvalidInfoFeedModelReferences();
    expect(harness.infoFeedHistory.value[0].summary.modelAlias).toBe("fallback-model");
    expect(harness.infoFeedCurrentRun.value?.summary.modelAlias).toBe("fallback-model");

    controller.selectInfoFeedHistoryItem("run-invalid");
    expect(harness.infoFeedParentRunSnapshot.value).toBeNull();
    expect(harness.infoFeedForm.value.query).toBe("");
    expect(harness.infoFeedForm.value.modelAlias).toBe("fallback-model");
    expect(harness.infoFeedForm.value.contextProfileId).toBe("ctx-invalid");

    controller.upsertInfoFeedHistory(null);
    expect(harness.infoFeedHistory.value).toHaveLength(1);
  });
});

describe("console-info-feed-output-controller", () => {
  it("streams, links evidence, copies, exports, and exposes run helpers", async () => {
    vi.useFakeTimers();
    const harness = createOutputFixture();
    const { controller } = harness;

    expect(controller.infoFeedSummaryRuntime.value).toEqual({
      model: "模型:summary-model",
      temperature: 0.7,
      maxTokens: 2048,
    });
    expect(controller.infoFeedSummaryEvidenceRefs.value).toEqual([
      "ev_keyword",
      "source-evidence::ev_agent",
      "source-evidence::ev_summary",
    ]);
    expect(controller.infoFeedParentSummaryEvidenceRefs.value).toEqual(["ev_parent"]);
    expect(controller.infoFeedParentSummaryHtml.value).toContain("#pact-evidence-ev_parent");
    expect(controller.infoFeedSummaryIsStreaming.value).toBe(true);

    await vi.runAllTimersAsync();
    await nextTick();
    expect(harness.infoFeedSummaryStreamTimer.value).toBeNull();
    expect(controller.infoFeedSummaryIsStreaming.value).toBe(false);
    expect(controller.infoFeedVisibleSummaryText.value).toContain("结论引用");
    expect(controller.infoFeedStreamingSummaryHtml.value).toContain("#pact-evidence-source-evidence%3A%3Aev_summary");

    expect(controller.infoFeedCurrentUserQuestion(harness.infoFeedCurrentRun.value as InfoFeedRunState)).toBe("继续追问");
    expect(controller.infoFeedUserCardTitle(harness.infoFeedCurrentRun.value as InfoFeedRunState)).toBe("用户回复");
    const turn = harness.infoFeedCurrentRun.value?.turns?.[0] as InfoFeedTurnSnapshot;
    expect(controller.infoFeedTurnTitle(turn, 0)).toBe("第 1 轮追问");
    expect(controller.infoFeedTurnQuestion(turn)).toBe("要补充什么？");
    expect(controller.infoFeedTurnAttachments(turn)).toHaveLength(1);
    expect(controller.infoFeedTurnSummaryHtml(turn)).toContain("#pact-evidence-ev_turn");
    expect(controller.infoFeedExpertFeedbackFor("summary")).toHaveLength(1);
    expect(controller.infoFeedExpertFeedbackForRun(null, "summary")).toHaveLength(0);

    await controller.copyInfoFeedSummary();
    expect(browserEffectsMocks.copyTextToClipboard).toHaveBeenCalledTimes(1);
    expect(harness.recordFeedback).toHaveBeenCalledWith(
      "copy",
      expect.objectContaining({
        surface: "info_feed",
        query: "主问题",
        itemId: "run-1",
      }),
    );

    controller.exportInfoFeedSummary();
    expect(browserEffectsMocks.downloadTextFile).toHaveBeenCalledTimes(1);
    expect(browserEffectsMocks.downloadTextFile.mock.calls[0][0]).toContain("主问题");
    expect(browserEffectsMocks.downloadTextFile.mock.calls[0][0]).toMatch(/\.md$/);
    expect(browserEffectsMocks.downloadTextFile.mock.calls[0][1]).toContain("主问题");
    expect(browserEffectsMocks.downloadTextFile.mock.calls[0][1]).toContain("结论引用");

    harness.infoFeedCurrentRun.value!.summary.answer = "";
    await controller.copyInfoFeedSummary();
    expect(harness.error.value).toBe("暂无可复制的信息流总结。");

    harness.infoFeedCurrentRun.value!.summary.answer = "新的答案 source-evidence::ev_new";
    browserEffectsMocks.copyTextToClipboard.mockRejectedValueOnce(new Error("clipboard denied"));
    await controller.copyInfoFeedSummary();
    expect(harness.error.value).toBe("clipboard denied");
  });
});

describe("InfoFeedComposerPanel", () => {
  it("closes the advanced options dialog from the backdrop click path", async () => {
    feedContextMock.current = createComposerContext();
    const wrapper = mountComposerPanel();

    await wrapper.get("button.info-feed-advanced-button").trigger("click");
    expect(wrapper.text()).toContain("高级选项");

    await wrapper.get(".info-feed-advanced-backdrop").trigger("click");
    await nextTick();

    expect(wrapper.find(".info-feed-advanced-dialog").exists()).toBe(false);
  });
});
