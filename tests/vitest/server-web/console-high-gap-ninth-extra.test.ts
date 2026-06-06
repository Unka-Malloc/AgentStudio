// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref } from "vue";
import { mount, shallowMount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../../server-web/router";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import KnowledgeDistillationWorkbench from "../../../server-web/components/KnowledgeDistillationWorkbench.vue";
import { createConsolePathPickerController } from "../../../server-web/composables/console-path-picker-controller";
import { createConsoleInfoFeedHistoryController } from "../../../server-web/composables/console-info-feed-history-controller";
import {
  downloadRuntimeDependency,
  listRuntimeDependencies,
  saveRuntimeDependencyConfiguration,
  statusLabel,
  statusTone,
} from "../../../server-web/lib/runtime-dependencies";
import {
  createKnowledgeDistillationWorkbenchRun,
  listKnowledgeDistillationWorkbenchRuns,
  compareKnowledgeDistillationWorkbenchRuns,
  knowledgeDistillationWorkbenchPackageUrl,
  resumeKnowledgeDistillationWorkbenchRun,
} from "../../../server-web/lib/knowledge-distillation-workbench";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import type {
  InfoFeedRunState,
  InfoFeedClarification,
  InfoFeedClarificationOption,
} from "../../../server-web/types/app";

const bridgeHttpMock = vi.hoisted(() => ({
  deleteJson: vi.fn(),
  downloadFile: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

const runtimeInfoMock = vi.hoisted(() => ({
  browseServerPath: vi.fn(),
}));

const agentSettingsMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  probeModel: vi.fn(),
  saveSettings: vi.fn(),
}));

const externalServicesControllerMock = vi.hoisted(() => ({
  current: null as any,
}));

const browserEffectsMock = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
  copyConsoleTextWithFeedback: vi.fn(),
}));

const pageRefreshMock = vi.hoisted(() => ({
  usePageRefreshHandler: vi.fn(),
}));

const intervalControllerMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}));

const probeControllerMock = vi.hoisted(() => ({
  distillationModelOptions: require("vue").ref([{ value: "model-a", label: "Model A", enabled: true }]),
  modelProbeLabel: require("vue").ref("在线"),
  modelProbeTone: require("vue").ref("success"),
  modelProbeTooltip: require("vue").ref("模型已就绪"),
  refreshModelProbeStatus: vi.fn(() => Promise.resolve()),
  selectedModelReady: require("vue").ref(true),
}));

vi.mock("../../../server-web/lib/bridge-http", () => ({
  deleteJson: bridgeHttpMock.deleteJson,
  downloadFile: bridgeHttpMock.downloadFile,
  getJson: bridgeHttpMock.getJson,
  postJson: bridgeHttpMock.postJson,
}));

vi.mock("../../../server-web/lib/runtime-info-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server-web/lib/runtime-info-client")>();
  return {
    ...actual,
    browseServerPath: runtimeInfoMock.browseServerPath,
  };
});

vi.mock("../../../server-web/lib/agent-settings-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server-web/lib/agent-settings-client")>();
  return {
    ...actual,
    getSettings: agentSettingsMock.getSettings,
    probeModel: agentSettingsMock.probeModel,
    saveSettings: agentSettingsMock.saveSettings,
  };
});

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesControllerMock.current),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: browserEffectsMock.confirmConsoleAction,
  copyConsoleTextWithFeedback: browserEffectsMock.copyConsoleTextWithFeedback,
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: pageRefreshMock.usePageRefreshHandler,
}));

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  createConsoleIntervalController: vi.fn(() => intervalControllerMock),
}));

vi.mock("../../../server-web/composables/knowledge-distillation-model-probe-controller", () => ({
  createKnowledgeDistillationModelProbeController: vi.fn(() => probeControllerMock),
}));

function flush() {
  return nextTick().then(() => Promise.resolve()).then(() => nextTick());
}

function summaryDefaults() {
  return {
    modelAlias: "model-a",
    contextProfileId: "ctx-a",
    temperature: 0.2,
    maxTokens: 1800,
  };
}

function makeInfoFeedRun(query = "问题", overrides: Partial<InfoFeedRunState> = {}) {
  return createInfoFeedRunState(query, {
    attachments: [],
    summaryDefaults: summaryDefaults(),
    ...(overrides.followUp ? { followUp: overrides.followUp } : {}),
  });
}

function makeExternalServicesController(overrides: Record<string, unknown> = {}) {
  return {
    actionError: "",
    actionMessage: "",
    closeConfigEditor: vi.fn(),
    configDraft: {
      serviceId: "service-a",
      serviceName: "Service A",
      mode: "connected",
      startupPolicy: "external-only",
      description: "",
      upstream: { provider: "icloud", mode: "contract", type: "cloud-drive" },
    },
    configEditorMode: "add",
    configEditorOpen: false,
    configEditorSubtitle: "",
    configEditorTitle: "",
    configStatusLabel: "",
    configStatusTone: "",
    configText: "",
    customUpstreamTypeValue: "",
    discoveredServiceCount: 1,
    isCloudDriveServiceDraft: false,
    isLlmServiceDraft: false,
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    loadError: "",
    loading: false,
    modeOptions: [{ value: "connected", label: "connected" }],
    mcpToolCount: 2,
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 0,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [],
    saveConfig: vi.fn(),
    serviceDiscoveryLabel: vi.fn(() => "MCP 服务"),
    serviceDiscoveryRegistrationLabel: vi.fn(() => "工具已发现"),
    serviceDiscoveryRegistrationTone: vi.fn(() => "success"),
    serviceDiscoveryTone: vi.fn(() => "success"),
    serviceHeartbeatLastAtLabel: vi.fn(() => "Latest: -"),
    serviceSourceDetail: vi.fn(() => "本地 / service-a"),
    services: [
      {
        entryId: "service-a",
        serviceId: "service-a",
        serviceName: "service-a",
        displayName: "Service A",
        description: "外部服务",
        mode: "connected",
        startupPolicy: "external-only",
        source: "configured",
        sourceLabel: "本地",
        filePath: "/tmp/external-services.json",
        requiredOperations: ["knowledge.search"],
        scriptCount: 1,
        validationStatus: "valid",
        validation: { ok: true, errors: [], warnings: [] },
        externalMcp: { tools: ["alpha", { name: "beta" }, "alpha"] },
        upstreamTargetLabelText: "127.0.0.1:8787",
        upstreamTargetDetailText: "endpoint",
        sourceLabelText: "本地 / service-a",
        discoveryLabelText: "MCP 服务",
        discoveryTone: "success",
        discoveryRegistrationLabelText: "工具已发现",
        discoveryRegistrationTone: "success",
        heartbeatText: "Latest: -",
        heartbeatRefreshing: false,
      },
    ],
    showCustomUpstreamType: false,
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    stream: false,
    trigger: false,
    updateBindingField: vi.fn(),
    updateCloudDriveMode: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateHealthCheckField: vi.fn(),
    updateHealthCheckRequired: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateModelProvider: vi.fn(),
    updateRootField: vi.fn(),
    updateUpstreamField: vi.fn(),
    updateUpstreamTypeSelection: vi.fn(),
    upstreamTargetDetailLabel: vi.fn(() => "endpoint"),
    upstreamTargetLabel: vi.fn(() => "127.0.0.1:8787"),
    verifying: false,
    verifyConfig: vi.fn(),
    validServiceCount: 1,
    configuredCount: 1,
    ...overrides,
  };
}

function makeWorkbenchRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    title: "知识蒸馏任务 1",
    status: "running",
    progressPercent: 42,
    jobId: "job-1",
    batchId: "batch-1",
    priority: "normal",
    modelAlias: "model-a",
    modelEnabled: true,
    prompt: "prompt",
    tokenBudget: 64000,
    payloadBudget: 500000,
    rawCorpusBatchMaxCharacters: 160000,
    workflowScope: "project",
    mergeStrategy: "timeline_then_topic",
    maxRounds: 3,
    strategyVersion: "v2",
    timeDecayHalfLifeDays: 90,
    timeDecayFloor: 0.35,
    stages: [
      {
        stageId: "stage-1",
        title: "准备",
        actionLabel: "生成",
        description: "准备阶段",
        status: "running",
        progressPercent: 60,
      },
    ],
    ...overrides,
  };
}

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: String,
    tone: String,
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone || "" }, props.label || "");
  },
});

const HelpTooltipStub = defineComponent({
  name: "HelpTooltip",
  props: {
    text: String,
    ariaLabel: String,
  },
  setup(props) {
    return () => h("span", { class: "help-tooltip-stub", "aria-label": props.ariaLabel || "" }, props.text || "");
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    modelValue: Boolean,
    label: String,
  },
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "binary-checkbox-stub",
          type: "button",
          onClick: () => {
            const nextValue = !Boolean(props.modelValue);
            emit("update:modelValue", nextValue);
            emit("update:model-value", nextValue);
            emit("change", nextValue);
          },
        },
        props.label || "",
      );
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: {
    modelValue: String,
  },
  emits: ["update:modelValue", "update:model-value"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "agent-model-option-bar-stub",
          type: "button",
          onClick: () => {
            emit("update:modelValue", "model-a");
            emit("update:model-value", "model-a");
          },
        },
        String(props.modelValue || ""),
      );
  },
});

const KnowledgeDistillationRunOverviewStub = defineComponent({
  name: "KnowledgeDistillationRunOverview",
  props: {
    selectedRun: Object,
    compareResult: Object,
    activeRunProgress: Number,
    packageHref: String,
    runs: Array,
    busy: String,
  },
  emits: ["archive", "cancel", "compare", "delete", "resume", "update:compareRightRunId"],
  setup(props, { emit }) {
    return () =>
      h("section", { class: "workbench-overview-stub" }, [
        h("strong", { class: "workbench-overview-title" }, String((props.selectedRun as any)?.title || "")),
        h("button", { class: "workbench-overview-compare", type: "button", onClick: () => emit("compare") }, "compare"),
      ]);
  },
});

const KnowledgeDistillationStageCardStub = defineComponent({
  name: "KnowledgeDistillationStageCard",
  props: {
    stage: Object,
  },
  setup(props) {
    return () => h("div", { class: "workbench-stage-card-stub" }, String((props.stage as any)?.title || ""));
  },
});

beforeEach(() => {
  window.scrollTo = vi.fn();
  bridgeHttpMock.deleteJson.mockReset();
  bridgeHttpMock.downloadFile.mockReset();
  bridgeHttpMock.getJson.mockReset();
  bridgeHttpMock.postJson.mockReset();
  runtimeInfoMock.browseServerPath.mockReset();
  agentSettingsMock.getSettings.mockReset();
  agentSettingsMock.probeModel.mockReset();
  agentSettingsMock.saveSettings.mockReset();
  browserEffectsMock.confirmConsoleAction.mockReset();
  browserEffectsMock.copyConsoleTextWithFeedback.mockReset();
  intervalControllerMock.start.mockReset();
  intervalControllerMock.stop.mockReset();
  probeControllerMock.refreshModelProbeStatus.mockReset();
  externalServicesControllerMock.current = null;
  pageRefreshMock.usePageRefreshHandler.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("router/index", () => {
  it("keeps valid tabs and redirects invalid prefixes through the route guards", async () => {
    const externalServiceRoute = router.getRoutes().find((route) => route.path === "/external-services/:tab");
    const guard = externalServiceRoute?.beforeEnter as any;
    expect(guard?.({ params: { tab: "list" } }, {} as any, vi.fn())).toBe(true);
    expect(guard?.({ params: { tab: "bad" } }, {} as any, vi.fn())).toBe("/external-services/list");

    await router.push("/unknown/path");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/");

    expect(router.options.scrollBehavior?.({} as any, {} as any, {} as any)).toEqual({ top: 0 });
  });
});

describe("ExternalServicesView", () => {
  it("shows the service table, copies upstream values, and closes popovers on scroll or outside clicks", async () => {
    externalServicesControllerMock.current = makeExternalServicesController();
    browserEffectsMock.copyConsoleTextWithFeedback.mockResolvedValue(undefined);

    const wrapper = shallowMount(ExternalServicesView, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          ConfigFloatingPanel: true,
          HelpTooltip: HelpTooltipStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await flush();
    expect(wrapper.text()).toContain("Service A");
    expect(wrapper.text()).toContain("MCP 服务");
    expect(wrapper.find(".external-service-table-scroll").exists()).toBe(true);

    await wrapper.get(".external-service-upstream-copy").trigger("mouseenter");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(true);
    expect(wrapper.find(".external-service-upstream-bubble").text()).toBe("127.0.0.1:8787");

    await wrapper.get(".external-service-upstream-copy").trigger("click");
    expect(browserEffectsMock.copyConsoleTextWithFeedback).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      "127.0.0.1:8787",
      { message: "已复制" },
    );

    await wrapper.get(".external-service-tool-list-button").trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);
    expect(wrapper.find(".external-service-tool-list").text()).toContain("alpha");
    expect(wrapper.find(".external-service-tool-list").text()).toContain("beta");

    wrapper.get(".external-service-table-scroll").element.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);

    await wrapper.get(".external-service-tool-list-button").trigger("click");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });

  it("renders the empty state when no services are loaded", async () => {
    externalServicesControllerMock.current = makeExternalServicesController({
      loading: false,
      services: [],
      discoveredServiceCount: 0,
      mcpToolCount: 0,
      configuredCount: 0,
      validServiceCount: 0,
    });

    const wrapper = shallowMount(ExternalServicesView, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          ConfigFloatingPanel: true,
          HelpTooltip: HelpTooltipStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await flush();
    expect(wrapper.text()).toContain("暂无外部服务");
  });
});

describe("console-info-feed-history-controller", () => {
  it("reads small text attachments and rejects empty, binary, and oversized inputs", async () => {
    const controller = createConsoleInfoFeedHistoryController({
      infoFeedAttachments: ref([]),
      infoFeedCurrentRun: ref(null),
      infoFeedForm: ref({
        query: "",
        modelAlias: "",
        contextProfileId: "ctx-a",
        temperature: 0.2,
        maxTokens: 1800,
      }),
      infoFeedHistory: ref([]),
      storageKey: "info-feed-history-test",
      evidenceRefs: vi.fn(() => []),
      hasAgentModelOption: vi.fn(() => true),
      summaryDefaults,
      validAgentModelAlias: vi.fn((value?: string) => String(value || "")),
    } as any);

    await expect(controller.readInfoFeedAttachment(new File(["hello"], "hello.txt", { type: "text/plain" }))).resolves.toMatchObject({
      status: "completed",
      progress: 100,
      text: "hello",
    });

    await expect(controller.readInfoFeedAttachment(new File([""], "empty.txt", { type: "text/plain" }))).resolves.toMatchObject({
      status: "failed",
      error: "文件内容为空或疑似二进制内容。",
    });

    const binaryFile = new File(["\u0000"], "binary.txt", { type: "application/octet-stream" });
    await expect(controller.readInfoFeedAttachment(binaryFile)).resolves.toMatchObject({
      status: "failed",
      error: "文件内容为空或疑似二进制内容。",
    });

    const largeFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
    await expect(controller.readInfoFeedAttachment(largeFile)).resolves.toMatchObject({
      status: "failed",
      error: "附件超过 2MB，信息流输入暂不直接读取。",
    });
  });

  it("surfaces read failures from File.text() and keeps attachment insertion stable", async () => {
    const controller = createConsoleInfoFeedHistoryController({
      infoFeedAttachments: ref([]),
      infoFeedCurrentRun: ref(null),
      infoFeedForm: ref({
        query: "",
        modelAlias: "",
        contextProfileId: "ctx-a",
        temperature: 0.2,
        maxTokens: 1800,
      }),
      infoFeedHistory: ref([]),
      storageKey: "info-feed-history-test",
      evidenceRefs: vi.fn(() => []),
      hasAgentModelOption: vi.fn(() => true),
      summaryDefaults,
      validAgentModelAlias: vi.fn((value?: string) => String(value || "")),
    } as any);

    const broken = new File(["x"], "broken.txt", { type: "text/plain" }) as File & { text: () => Promise<string> };
    Object.defineProperty(broken, "text", {
      configurable: true,
      value: () => Promise.reject(new Error("磁盘故障")),
    });

    await expect(controller.readInfoFeedAttachment(broken)).resolves.toMatchObject({
      status: "failed",
      error: "磁盘故障",
    });
  });
});

async function importExecutionController() {
  vi.resetModules();
  const trackMock = {
    runInfoFeedAgentTrack: vi.fn().mockResolvedValue(undefined),
    runInfoFeedKeywordTrack: vi.fn().mockResolvedValue(undefined),
  };
  const summaryMock = {
    runInfoFeedSummaryAgent: vi.fn().mockResolvedValue(undefined),
  };
  const expertFeedbackMock = {
    syncInfoFeedExpertFeedback: vi.fn().mockResolvedValue(undefined),
  };

  vi.doMock("../../../server-web/composables/console-info-feed-track-controller", () => ({
    createConsoleInfoFeedTrackController: vi.fn(() => trackMock),
  }));
  vi.doMock("../../../server-web/composables/console-info-feed-summary-runner-controller", () => ({
    createConsoleInfoFeedSummaryRunnerController: vi.fn(() => summaryMock),
  }));
  vi.doMock("../../../server-web/composables/console-info-feed-expert-feedback-controller", () => ({
    createConsoleInfoFeedExpertFeedbackController: vi.fn(() => expertFeedbackMock),
  }));

  const module = await import("../../../server-web/composables/console-info-feed-execution-controller");
  return { ...module, trackMock, summaryMock, expertFeedbackMock };
}

describe("console-info-feed-execution-controller", () => {
  it("rejects empty queries, permission failures, and model selection failures", async () => {
    const { createConsoleInfoFeedExecutionController, trackMock, summaryMock } = await importExecutionController();
    const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
    const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(null);
    const infoFeedRunSequence = ref(0);
    const infoFeedForm = ref({
      query: "",
      modelAlias: "model-a",
      contextProfileId: "ctx-a",
      temperature: 0.2,
      maxTokens: 1800,
    });
    const error = ref("");
    const canReadKnowledge = ref(true);
    const selectedInfoFeedModel = ref({ value: "model-a", enabled: true });

    const controller = createConsoleInfoFeedExecutionController({
      agentExploreConfiguredLimit: ref(6),
      agentExploreConfiguredMaxIterations: ref(3),
      agentExploreThinkingParameters: vi.fn(() => ({})),
      applyInfoFeedSummaryAnswer: vi.fn(),
      archiveInfoFeedExpertFeedback: vi.fn(() => ({}) as any),
      buildInfoFeedAgentQuery: vi.fn((run: InfoFeedRunState) => `agent:${run.query}`),
      buildInfoFeedSourceSearchQuery: vi.fn((run: InfoFeedRunState) => `source:${run.query}`),
      buildInfoFeedSummaryQuestion: vi.fn((run: InfoFeedRunState) => `summary:${run.query}`),
      canReadKnowledge,
      createInfoFeedRun: vi.fn((query: string) => makeInfoFeedRun(query)),
      error,
      fallbackInfoFeedSummary: vi.fn(),
      infoFeedAgentExpertGuidance: vi.fn(),
      infoFeedAgentProgressFromResult: vi.fn(() => 100),
      infoFeedAgentRecentTurns: vi.fn(() => []),
      infoFeedCanFollowUp: ref(false),
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedKeywordCache: new Map(),
      infoFeedParentRunSnapshot,
      infoFeedReadyForSummary: ref(true),
      infoFeedRunEvidenceRefs: vi.fn(() => []),
      infoFeedRunSequence,
      resetInfoFeedRunForContinuation: vi.fn(),
      selectedInfoFeedContextProfile: ref({ value: "ctx-a" }),
      selectedInfoFeedModel,
      selectedThinkingMode: ref("balanced"),
      upsertInfoFeedHistory: vi.fn(),
    } as any);

    await controller.runInfoFeed();
    expect(error.value).toBe("请输入信息流问题。");
    expect(trackMock.runInfoFeedKeywordTrack).not.toHaveBeenCalled();
    expect(summaryMock.runInfoFeedSummaryAgent).not.toHaveBeenCalled();

    infoFeedForm.value.query = "问题";
    canReadKnowledge.value = false;
    await controller.runInfoFeed();
    expect(error.value).toBe("当前账号没有知识库读取权限。");

    canReadKnowledge.value = true;
    selectedInfoFeedModel.value.enabled = false;
    await controller.runInfoFeed();
    expect(error.value).toBe("请选择模型库中已配置且支持智能体调用的模型。");
    expect(trackMock.runInfoFeedKeywordTrack).not.toHaveBeenCalled();
    expect(trackMock.runInfoFeedAgentTrack).not.toHaveBeenCalled();
  });

  it("continues a paused run through the retry and clarification branches", async () => {
    const { createConsoleInfoFeedExecutionController, trackMock, summaryMock, expertFeedbackMock } = await importExecutionController();
    const infoFeedCurrentRun = ref<InfoFeedRunState | null>(makeInfoFeedRun("起始问题"));
    const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(null);
    const infoFeedRunSequence = ref(1);
    const infoFeedForm = ref({
      query: "",
      modelAlias: "model-a",
      contextProfileId: "ctx-a",
      temperature: 0.2,
      maxTokens: 1800,
    });
    const error = ref("");
    const upsertInfoFeedHistory = vi.fn();
    const resetInfoFeedRunForContinuation = vi.fn((run: InfoFeedRunState, question: string) => {
      run.query = question;
    });
    const archiveInfoFeedExpertFeedback = vi.fn((run: InfoFeedRunState, clarification: InfoFeedClarification, option: InfoFeedClarificationOption) => ({
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
    }));

    const controller = createConsoleInfoFeedExecutionController({
      agentExploreConfiguredLimit: ref(6),
      agentExploreConfiguredMaxIterations: ref(3),
      agentExploreThinkingParameters: vi.fn(() => ({})),
      applyInfoFeedSummaryAnswer: vi.fn((run: InfoFeedRunState, answer: string, fallback: boolean, errorText = "") => {
        run.summary.answer = answer;
        run.summary.fallback = fallback;
        run.summary.error = errorText;
      }),
      archiveInfoFeedExpertFeedback,
      buildInfoFeedAgentQuery: vi.fn((run: InfoFeedRunState) => `agent:${run.query}`),
      buildInfoFeedSourceSearchQuery: vi.fn((run: InfoFeedRunState) => `source:${run.query}`),
      buildInfoFeedSummaryQuestion: vi.fn((run: InfoFeedRunState) => `summary:${run.query}`),
      canReadKnowledge: ref(true),
      createInfoFeedRun: vi.fn((query: string) => makeInfoFeedRun(query)),
      error,
      fallbackInfoFeedSummary: vi.fn((run: InfoFeedRunState) => `fallback:${run.query}`),
      infoFeedAgentExpertGuidance: vi.fn(() => ({})),
      infoFeedAgentProgressFromResult: vi.fn(() => 100),
      infoFeedAgentRecentTurns: vi.fn(() => []),
      infoFeedCanFollowUp: ref(true),
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedKeywordCache: new Map(),
      infoFeedParentRunSnapshot,
      infoFeedReadyForSummary: ref(true),
      infoFeedRunEvidenceRefs: vi.fn(() => []),
      infoFeedRunSequence,
      resetInfoFeedRunForContinuation,
      selectedInfoFeedContextProfile: ref({ value: "ctx-a" }),
      selectedInfoFeedModel: ref({ value: "model-a", enabled: true }),
      selectedThinkingMode: ref("balanced"),
      upsertInfoFeedHistory,
    } as any);

    const run = infoFeedCurrentRun.value!;
    run.clarification = {
      questionId: "q-1",
      prompt: "请补充",
      reason: "缺少上下文",
      status: "pending",
      selectedOptionId: "",
      options: [],
    } as any;

    await controller.chooseInfoFeedClarification({
      optionId: "opt-1",
      label: "继续",
      description: "继续追问",
      followUpQuestion: "补充问题",
    } as InfoFeedClarificationOption);

    expect(archiveInfoFeedExpertFeedback).toHaveBeenCalledTimes(1);
    expect(expertFeedbackMock.syncInfoFeedExpertFeedback).toHaveBeenCalledTimes(1);
    expect(trackMock.runInfoFeedKeywordTrack).toHaveBeenCalledTimes(1);
    expect(trackMock.runInfoFeedAgentTrack).toHaveBeenCalledTimes(1);
    expect(summaryMock.runInfoFeedSummaryAgent).toHaveBeenCalledTimes(1);

    run.pausedForRetry = "summary";
    run.summary.error = "需要重试";
    await controller.continueInfoFeedAfterRetry();
    expect(run.summary.answer).toBe("");
    expect(run.summary.error).toBe("");
    expect(run.summary.fallback).toBe(false);
  });
});

async function importTrackController() {
  vi.resetModules();
  const trackMocks = {
    searchKnowledge: vi.fn(),
    runKnowledgeAgentExplore: vi.fn(),
    getKnowledgeAgentExploreRun: vi.fn(),
  };

  vi.doMock("../../../server-web/lib/knowledge-search-client", () => ({
    searchKnowledge: trackMocks.searchKnowledge,
  }));
  vi.doMock("../../../server-web/lib/agent-explore-client", () => ({
    getKnowledgeAgentExploreRun: trackMocks.getKnowledgeAgentExploreRun,
    runKnowledgeAgentExplore: trackMocks.runKnowledgeAgentExplore,
  }));
  vi.doMock("../../../server-web/composables/console-info-feed-run-utils", async () => {
    const actual = await vi.importActual<typeof import("../../../server-web/composables/console-info-feed-run-utils")>(
      "../../../server-web/composables/console-info-feed-run-utils",
    );
    return {
      ...actual,
      delayMs: vi.fn(() => Promise.resolve()),
      withInfoFeedFetchRetry: vi.fn(async (_run: InfoFeedRunState, _stage: string, operation: () => Promise<unknown>) => operation()),
    };
  });

  const module = await import("../../../server-web/composables/console-info-feed-track-controller");
  return { ...module, trackMocks };
}

describe("console-info-feed-track-controller", () => {
  it("returns early when the run id no longer matches the active run", async () => {
    const { createConsoleInfoFeedTrackController, trackMocks } = await importTrackController();
    const run = makeInfoFeedRun("起始问题");
    run.runId = "run-1";
    const otherRun = makeInfoFeedRun("切换后的问题");
    otherRun.runId = "run-2";
    const infoFeedCurrentRun = ref<InfoFeedRunState | null>(run);
    const infoFeedRunSequence = ref(1);

    const controller = createConsoleInfoFeedTrackController({
      agentExploreConfiguredLimit: ref(3),
      agentExploreConfiguredMaxIterations: ref(5),
      infoFeedAgentExpertGuidance: vi.fn(() => ({})),
      infoFeedAgentProgressFromResult: vi.fn(() => 0),
      infoFeedAgentRecentTurns: vi.fn(() => []),
      infoFeedCurrentRun,
      infoFeedKeywordCache: new Map(),
      infoFeedRunSequence,
      selectedInfoFeedContextProfile: ref({ value: "ctx-a" }),
      selectedInfoFeedModel: ref({ value: "model-a", enabled: true }),
      selectedThinkingMode: ref("balanced"),
    } as any);

    infoFeedCurrentRun.value = otherRun;
    await controller.runInfoFeedAgentTrack(1, run.runId, "agent:query");
    expect(trackMocks.runKnowledgeAgentExplore).not.toHaveBeenCalled();
    expect(run.agent.status).toBe("idle");
    expect(otherRun.agent.status).toBe("idle");
  });
});

describe("console-path-picker-controller", () => {
  it("opens, refreshes, selects, and confirms paths", async () => {
    runtimeInfoMock.browseServerPath.mockResolvedValue({
      currentPath: "/tmp/project",
      entries: [
        {
          path: "/tmp/project/src",
          name: "src",
          type: "directory",
          browsable: true,
        },
        {
          path: "/tmp/project/README.md",
          name: "README.md",
          type: "file",
          browsable: false,
          byteSize: 1024,
          modifiedAt: "2026-06-04T00:00:00.000Z",
        },
      ],
      error: "",
    });

    const controller = createConsolePathPickerController();
    expect(controller.pathPickerModeLabel("directory")).toBe("目录");
    expect(controller.pathPickerModeLabel("file")).toBe("文件");

    controller.openServerPathPicker({
      title: "选择目录",
      mode: "directory",
      value: "/tmp",
      closeOnSelect: false,
      applyPath: vi.fn(),
    });
    await flush();

    expect(runtimeInfoMock.browseServerPath).toHaveBeenCalledWith({
      path: "/tmp",
      mode: "directory",
      extensions: [],
      includeHidden: false,
    });
    expect(controller.pathPicker.value.open).toBe(true);
    expect(controller.pathPicker.value.response?.currentPath).toBe("/tmp/project");
    expect(controller.pathEntryMeta(controller.pathPicker.value.response!.entries[1] as any)).toContain("1.0 KB");

    const applyPath = vi.fn();
    controller.pathPicker.value.applyPath = applyPath;
    controller.selectServerPath("/tmp/project/src");
    expect(applyPath).toHaveBeenCalledWith("/tmp/project/src");
    expect(controller.pathPicker.value.open).toBe(true);

    controller.confirmServerPathPicker();
    expect(applyPath).toHaveBeenCalledWith("/tmp/project");
    expect(controller.pathPicker.value.open).toBe(false);

    controller.openPathEntry(controller.pathPicker.value.response!.entries[0] as any);
    expect(runtimeInfoMock.browseServerPath).toHaveBeenLastCalledWith({
      path: "/tmp/project/src",
      mode: "directory",
      extensions: [],
      includeHidden: false,
    });
  });

  it("surfaces refresh errors and ignores non-browsable entries", async () => {
    runtimeInfoMock.browseServerPath.mockRejectedValueOnce(new Error("路径服务不可用"));
    const controller = createConsolePathPickerController();
    const applyPath = vi.fn();
    controller.openServerPathPicker({
      title: "选择文件",
      mode: "file",
      value: "/tmp/file.txt",
      applyPath,
    });
    await flush();
    expect(controller.pathPicker.value.error).toBe("路径服务不可用");
    controller.openPathEntry({ path: "/tmp/file.txt", browsable: false } as any);
    expect(runtimeInfoMock.browseServerPath).toHaveBeenCalledTimes(1);
  });
});

describe("KnowledgeDistillationWorkbench", () => {
  it("renders the empty and populated branches and forwards the start action", async () => {
    agentSettingsMock.getSettings.mockResolvedValue({
      modelLibraryAgents: [],
      defaultModelProvider: "deepseek",
      deepSeekModel: "",
      customHttpAdapter: { alias: "", url: "", token: "", tokenHeader: "", tokenPrefix: "", engine: "", parameters: {}, pluginList: [], timeoutMs: 30000, agentName: "" },
    });
    agentSettingsMock.probeModel.mockResolvedValue({
      ok: true,
      checkedAt: "2026-06-05T00:00:00.000Z",
      message: "在线",
    });
    pageRefreshMock.usePageRefreshHandler.mockImplementation(() => undefined);
    browserEffectsMock.confirmConsoleAction.mockReturnValue(true);

    bridgeHttpMock.getJson.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/knowledge/distillation/workbench/runs?limit=")) {
        return { items: [] };
      }
      return {};
    });
    bridgeHttpMock.postJson.mockImplementation(async (url: string, payload: Record<string, unknown>) => {
      if (url === "/api/knowledge/distillation/workbench/runs") {
        return makeWorkbenchRun({
          runId: "run-created",
          title: String(payload.title || "知识蒸馏任务"),
          status: "running",
          stages: [
            {
              stageId: "stage-1",
              title: "准备",
              actionLabel: "生成",
              description: "准备阶段",
              status: "running",
            },
          ],
        });
      }
      return {};
    });

    const emptyWrapper = shallowMount(KnowledgeDistillationWorkbench, {
      props: {
        canReadKnowledge: true,
        canMaintainKnowledge: true,
        ingestJob: { id: "job-1", status: "completed" } as any,
        normalizedManifest: null,
        formatCompactDate: (value: string) => value,
      },
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          KnowledgeDistillationRunOverview: KnowledgeDistillationRunOverviewStub,
          KnowledgeDistillationStageCard: KnowledgeDistillationStageCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await flush();
    expect(emptyWrapper.text()).toContain("暂无知识蒸馏任务");
    await emptyWrapper.get("button.primary-action").trigger("click");
    await flush();
    await flush();
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/distillation/workbench/runs",
      expect.objectContaining({
        title: "job-1 项目知识蒸馏",
        jobId: "job-1",
        batchId: "job-1",
        workflowScope: "project",
        modelEnabled: true,
      }),
      expect.objectContaining({ safetyConfirm: true }),
    );
    expect(emptyWrapper.text()).toContain("job-1 项目知识蒸馏");

    bridgeHttpMock.getJson.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/knowledge/distillation/workbench/runs?limit=")) {
        return { items: [makeWorkbenchRun()] };
      }
      if (url === "/api/knowledge/distillation/workbench/runs/run-1") {
        return makeWorkbenchRun();
      }
      return {};
    });

    const populatedWrapper = shallowMount(KnowledgeDistillationWorkbench, {
      props: {
        canReadKnowledge: true,
        canMaintainKnowledge: true,
        ingestJob: { id: "job-1", status: "completed" } as any,
        normalizedManifest: null,
        formatCompactDate: (value: string) => value,
      },
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          KnowledgeDistillationRunOverview: KnowledgeDistillationRunOverviewStub,
          KnowledgeDistillationStageCard: KnowledgeDistillationStageCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await flush();
    expect(populatedWrapper.text()).toContain("知识蒸馏任务 1");
    expect(populatedWrapper.text()).toContain("准备");
    expect(populatedWrapper.find(".workbench-overview-title").text()).toBe("知识蒸馏任务 1");
  });

  it("keeps the start action disabled until the ingest job completes", async () => {
    bridgeHttpMock.getJson.mockResolvedValue({ items: [] });
    const wrapper = shallowMount(KnowledgeDistillationWorkbench, {
      props: {
        canReadKnowledge: true,
        canMaintainKnowledge: true,
        ingestJob: { id: "job-1", status: "running" } as any,
        normalizedManifest: null,
        formatCompactDate: (value: string) => value,
      },
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          KnowledgeDistillationRunOverview: KnowledgeDistillationRunOverviewStub,
          KnowledgeDistillationStageCard: KnowledgeDistillationStageCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await flush();
    expect(wrapper.text()).toContain("请先在页面顶部选择项目文件夹并点击“开始解析”。");
    expect(wrapper.get("button.primary-action").attributes("disabled")).toBeDefined();
  });

  it("binds workbench form controls and switches run selector entries", async () => {
    bridgeHttpMock.getJson.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/knowledge/distillation/workbench/runs?limit=")) {
        return {
          items: [
            makeWorkbenchRun({ runId: "run-a", title: "任务 A", status: "completed" }),
            makeWorkbenchRun({ runId: "run-b", title: "任务 B", status: "running" }),
          ],
        };
      }
      if (url === "/api/knowledge/distillation/workbench/runs/run-b") {
        return makeWorkbenchRun({ runId: "run-b", title: "任务 B", status: "running" });
      }
      return makeWorkbenchRun({ runId: "run-a", title: "任务 A", status: "completed" });
    });

    const wrapper = shallowMount(KnowledgeDistillationWorkbench, {
      props: {
        canReadKnowledge: true,
        canMaintainKnowledge: true,
        ingestJob: { id: "job-1", status: "completed" } as any,
        normalizedManifest: null,
        formatCompactDate: (value: string) => value,
      },
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          KnowledgeDistillationRunOverview: KnowledgeDistillationRunOverviewStub,
          KnowledgeDistillationStageCard: KnowledgeDistillationStageCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await flush();
    expect(wrapper.find(".workbench-overview-title").text()).toBe("任务 A");

    await wrapper.get(".agent-model-option-bar-stub").trigger("click");
    const selects = wrapper.findAll("select");
    await selects[0].setValue("high");
    await selects[1].setValue("source_order");
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("4096");
    await inputs[1].setValue("8192");
    await inputs[2].setValue("12288");
    await inputs[3].setValue("4");
    await inputs[4].setValue("365");
    await inputs[5].setValue("0.4");
    await wrapper.get("textarea").setValue("新的蒸馏 Prompt");

    const runButtons = wrapper.findAll(".distillation-run-item");
    expect(runButtons).toHaveLength(2);
    await runButtons[1].trigger("click");
    await flush();

    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/knowledge/distillation/workbench/runs/run-b");
    expect(wrapper.find(".workbench-overview-title").text()).toBe("任务 B");
  });
});

describe("knowledge-distillation-workbench client", () => {
  it("forwards list, create, compare, resume, and package URL helpers", async () => {
    bridgeHttpMock.getJson.mockResolvedValue({});
    bridgeHttpMock.postJson.mockResolvedValue({});

    await listKnowledgeDistillationWorkbenchRuns(7);
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/knowledge/distillation/workbench/runs?limit=7");

    await createKnowledgeDistillationWorkbenchRun({
      title: "run title",
      jobId: "job-1",
      batchId: "batch-1",
      query: "query",
      workflowScope: "project",
    } as any);
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/distillation/workbench/runs",
      expect.objectContaining({
        title: "run title",
        jobId: "job-1",
        batchId: "batch-1",
        query: "query",
        workflowScope: "project",
      }),
      expect.objectContaining({ safetyConfirm: true }),
    );

    await compareKnowledgeDistillationWorkbenchRuns("left-run", "right-run");
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/knowledge/distillation/workbench/runs/left-run/compare?rightRunId=right-run",
    );

    await resumeKnowledgeDistillationWorkbenchRun("run-1");
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/distillation/workbench/runs/run-1/resume",
      {},
      expect.objectContaining({ safetyConfirm: true }),
    );

    expect(knowledgeDistillationWorkbenchPackageUrl("run 1")).toBe("/api/knowledge/distillation/workbench/runs/run%201/package");
  });
});

describe("runtime-dependencies", () => {
  it("forwards bridge calls and normalizes status helpers", async () => {
    bridgeHttpMock.getJson.mockResolvedValue({});
    bridgeHttpMock.postJson.mockResolvedValue({});

    expect(statusLabel("running")).toBe("安装中");
    expect(statusTone("failed")).toBe("danger");

    await listRuntimeDependencies();
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/runtime/dependencies");

    await downloadRuntimeDependency({ id: "runtime-a", label: "Runtime A", status: "queued" } as any);
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/runtime/dependencies/download",
      expect.objectContaining({
        targetId: "runtime-a",
        async: true,
        confirm: true,
      }),
      expect.objectContaining({ safetyConfirm: true }),
    );

    await saveRuntimeDependencyConfiguration("runtime-a", [{ key: "path", value: "/tmp/runtime" }]);
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/runtime/dependencies/configuration",
      {
        targetId: "runtime-a",
        entries: [{ key: "path", value: "/tmp/runtime" }],
      },
    );
  });
});
