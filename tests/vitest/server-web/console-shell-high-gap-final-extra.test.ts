// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";

function makeRef<T>(value: T) {
  return { value, __v_isRef: true } as { value: T; __v_isRef: true };
}

function createLooseController(overrides: Record<string, unknown> = {}) {
  const bucket: Record<string | symbol, unknown> = { ...overrides };
  return new Proxy(bucket, {
    get(target, key) {
      if (key in target) {
        return target[key];
      }
      const fallback: any = vi.fn(() => undefined);
      fallback.value = undefined;
      target[key] = fallback;
      return fallback;
    },
  });
}

const copyConsoleTextWithFeedback = vi.hoisted(() => vi.fn());
let activeExternalServicesController: Record<string, unknown> | null = null;

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => activeExternalServicesController),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyConsoleTextWithFeedback: (...args: unknown[]) => copyConsoleTextWithFeedback(...args),
}));

const ConfigFloatingPanelMock = {
  name: "ConfigFloatingPanel",
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    statusTone: { type: String, default: "" },
    statusLabel: { type: String, default: "" },
    verifying: { type: Boolean, default: false },
  },
  emits: ["close", "verify"],
  setup(props: Record<string, unknown>, context: {
    slots: { default?: () => any };
    emit: (event: "close" | "verify") => void;
  }) {
    if (!props.open) {
      return () => null;
    }
    return () =>
      h("section", { class: "mock-config-floating-panel" }, [
        h("header", { class: "mock-config-floating-header" }, [
          h("h3", String(props.title || "")),
          props.subtitle ? h("p", String(props.subtitle || "")) : null,
          h(
            "button",
            {
              class: "mock-config-verify-button",
              disabled: !!props.verifying,
              onClick: () => context.emit("verify"),
            },
            props.verifying ? "校验中" : "校验配置",
          ),
          h("button", { class: "mock-config-close-button", onClick: () => context.emit("close") }, "关闭"),
        ]),
        h("div", { class: "mock-config-floating-content" }, [
          h("div", {
            class: "mock-status",
            "data-tone": String(props.statusTone || ""),
            "data-label": String(props.statusLabel || ""),
          }),
          context.slots.default?.(),
        ]),
      ]);
  },
};

const HelpTooltipMock = {
  name: "HelpTooltip",
  props: ["ariaLabel", "items", "text"],
  setup(props: Record<string, unknown>) {
    return () => h("span", { class: "mock-help-tooltip", "aria-label": String(props.ariaLabel || "") }, String(props.text || ""));
  },
};

const StatusPillMock = {
  name: "StatusPill",
  props: ["tone", "label", "showDot"],
  setup(props: Record<string, unknown>) {
    return () => h("span", { class: "mock-status-pill", "data-tone": String(props.tone || "") }, String(props.label || ""));
  },
};

const BinaryCheckboxMock = {
  name: "BinaryCheckbox",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props: Record<string, unknown>, context: { emit: (event: string, value: unknown) => void }) {
    return () =>
      h(
        "button",
        {
          class: "mock-binary-checkbox",
          type: "button",
          disabled: !!props.disabled,
          onClick: () => {
            if (props.disabled) return;
            const nextValue = !(props.modelValue as boolean);
            context.emit("update:model-value", nextValue);
            context.emit("update:modelValue", nextValue);
            context.emit("change", nextValue);
          },
        },
        String(props.label || ""),
      );
  },
};

type ServiceFixture = {
  entryId: string;
  serviceId: string;
  serviceName: string;
  displayName: string;
  description: string;
  mode: string;
  startupPolicy: string;
  sourceLabelText: string;
  discoveryLabelText: string;
  discoveryTone: string;
  discoveryRegistrationLabelText: string;
  discoveryRegistrationTone: string;
  heartbeatText: string;
  upstreamTargetLabelText: string;
  upstreamTargetDetailText: string;
  requiredOperations: string[];
  scriptCount: number;
  validationStatus: "valid" | "invalid";
  externalMcp?: { tools: Array<string | { name?: string; toolId?: string; id?: string }> };
};

function createService(overrides: Partial<ServiceFixture> = {}): ServiceFixture {
  const serviceId = overrides.serviceId || "service-a";
  return {
    entryId: overrides.entryId || serviceId,
    serviceId,
    serviceName: overrides.serviceName || serviceId,
    displayName: overrides.displayName || "Service A",
    description: overrides.description || "",
    mode: overrides.mode || "connected",
    startupPolicy: overrides.startupPolicy || "external-only",
    sourceLabelText: overrides.sourceLabelText || "本地 / service-a",
    discoveryLabelText: overrides.discoveryLabelText || "MCP 服务",
    discoveryTone: overrides.discoveryTone || "success",
    discoveryRegistrationLabelText: overrides.discoveryRegistrationLabelText || "工具已发现",
    discoveryRegistrationTone: overrides.discoveryRegistrationTone || "success",
    heartbeatText: overrides.heartbeatText || "Latest: -",
    upstreamTargetLabelText: overrides.upstreamTargetLabelText || "127.0.0.1:8787",
    upstreamTargetDetailText: overrides.upstreamTargetDetailText || "endpoint",
    requiredOperations: overrides.requiredOperations || ["knowledge.search"],
    scriptCount: overrides.scriptCount ?? 1,
    validationStatus: overrides.validationStatus || "valid",
    externalMcp: overrides.externalMcp,
  };
}

function createExternalServicesController(overrides: Record<string, unknown> = {}) {
  const services = (overrides.services as ServiceFixture[] | undefined) || [
    createService({
      serviceId: "service-a",
      displayName: "Service A",
      upstreamTargetLabelText: "  ",
      externalMcp: { tools: [] },
    }),
  ];

  return {
    actionError: "",
    actionMessage: "",
    configEditorOpen: false,
    configEditorMode: "add",
    configEditorSubtitle: "",
    configEditorTitle: "",
    configStatusLabel: "",
    configStatusTone: "",
    validationErrors: [],
    validationWarnings: [],
    configDraft: {
      serviceId: "service-a",
      serviceName: "service-a",
      mode: "connected",
      startupPolicy: "external-only",
      description: "",
      upstream: { provider: "icloud", mode: "contract", type: "cloud-drive" },
    },
    customUpstreamTypeValue: "",
    discoveryCacheUpdatedAtLabel: "刚刚",
    discoveredServiceCount: services.length,
    isCloudDriveServiceDraft: false,
    isLlmServiceDraft: false,
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    loadError: "",
    loading: false,
    modeOptions: [{ value: "connected", label: "connected" }],
    mcpToolCount: services.reduce((total, service) => total + (service.externalMcp?.tools?.length || 0), 0),
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 0,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [],
    saveConfig: vi.fn(),
    serviceDiscoveryLabel: vi.fn((service: ServiceFixture) => service.discoveryLabelText),
    serviceDiscoveryRegistrationLabel: vi.fn((service: ServiceFixture) => service.discoveryRegistrationLabelText),
    serviceDiscoveryRegistrationTone: vi.fn((service: ServiceFixture) => service.discoveryRegistrationTone),
    serviceDiscoveryTone: vi.fn((service: ServiceFixture) => service.discoveryTone),
    serviceHeartbeatLastAtLabel: vi.fn((service: ServiceFixture) => service.heartbeatText),
    serviceSourceDetail: vi.fn((service: ServiceFixture) => service.sourceLabelText),
    services,
    showCustomUpstreamType: false,
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    stream: false,
    trigger: false,
    upstreamTargetDetailLabel: vi.fn((service: ServiceFixture) => service.upstreamTargetDetailText),
    upstreamTargetLabel: vi.fn((service: ServiceFixture) => service.upstreamTargetLabelText),
    validServiceCount: services.length,
    verifyConfig: vi.fn(),
    ...overrides,
  };
}

function mountExternalServicesView(overrides: Record<string, unknown> = {}) {
  activeExternalServicesController = createExternalServicesController(overrides);
  return mount(ExternalServicesView, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxMock,
        ConfigFloatingPanel: ConfigFloatingPanelMock,
        HelpTooltip: HelpTooltipMock,
        StatusPill: StatusPillMock,
      },
    },
  });
}

function setMockRect(element: Element, rect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height" | "x" | "y">) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      toJSON: () => rect,
    }),
  });
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    query: "原始问题",
    clarification: undefined,
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
      status: "completed",
      modelAlias: "model-a",
      contextProfileId: "ctx-a",
      answer: "",
      error: "",
      fallback: false,
    },
    pausedForModelSelection: "",
    pausedForRetry: "",
    ...overrides,
  } as any;
}

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

afterEach(() => {
  copyConsoleTextWithFeedback.mockReset();
  activeExternalServicesController = null;
});

describe("ExternalServicesView", () => {
  it("renders conditional editor fields and suppresses empty state while loading", () => {
    const wrapper = mountExternalServicesView({
      configEditorOpen: true,
      loadError: "加载失败",
      actionError: "保存失败",
      actionMessage: "已完成",
      loading: true,
      services: [],
      discoveredServiceCount: 0,
      mcpToolCount: 0,
      configuredCount: 0,
      validServiceCount: 0,
      isLlmServiceDraft: true,
      isCloudDriveServiceDraft: true,
      showCustomUpstreamType: true,
    });

    expect(wrapper.text()).toContain("加载失败");
    expect(wrapper.text()).toContain("保存失败");
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).not.toContain("暂无外部服务");
    expect(wrapper.find('input[placeholder="internal-proprietary-service"]').exists()).toBe(true);
    expect(wrapper.find('select[aria-label="模型协议"]').exists()).toBe(true);
    expect(wrapper.find('select[aria-label="网盘 Provider"]').exists()).toBe(true);
    expect(wrapper.find('select[aria-label="网盘适配模式"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="http://127.0.0.1:8787/mcp/"]').exists()).toBe(false);
  });

  it("deduplicates tools, flips popovers, and places upstream copy bubbles on both sides", async () => {
    const wrapper = mountExternalServicesView({
      services: [
        createService({
          serviceId: "mcp-main",
          displayName: "MCP Main",
          externalMcp: {
            tools: ["search", { name: "search" }, { toolId: "file.list" }, { id: "file.list" }, "status", ""],
          },
        }),
      ],
    });

    const upstreamButton = wrapper.find(".external-service-upstream-copy");
    setMockRect(upstreamButton.element, {
      top: 20,
      bottom: 40,
      left: 100,
      right: 260,
      width: 160,
      height: 20,
      x: 100,
      y: 20,
    });
    await upstreamButton.trigger("mouseenter");
    let bubble = wrapper.find(".external-service-upstream-bubble");
    expect(bubble.exists()).toBe(true);
    expect(bubble.classes()).toContain("is-below");
    expect(bubble.text()).toBe("127.0.0.1:8787");

    setMockRect(upstreamButton.element, {
      top: 300,
      bottom: 320,
      left: 100,
      right: 260,
      width: 160,
      height: 20,
      x: 100,
      y: 300,
    });
    await upstreamButton.trigger("mouseleave");
    await upstreamButton.trigger("mouseenter");
    bubble = wrapper.find(".external-service-upstream-bubble");
    expect(bubble.classes()).toContain("is-above");

    const toolListButton = wrapper.find(".external-service-tool-list-button");
    setMockRect(toolListButton.element, {
      top: 280,
      bottom: 320,
      left: 250,
      right: 350,
      width: 100,
      height: 40,
      x: 250,
      y: 280,
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });
    await toolListButton.trigger("click");
    const updatedPopover = wrapper.find(".external-service-tool-popover");
    expect(updatedPopover.classes()).toContain("is-above");
    expect(updatedPopover.text()).toContain("search");
    expect(updatedPopover.text()).toContain("file.list");
    expect(updatedPopover.text()).toContain("status");
    expect(updatedPopover.findAll(".external-service-tool-item")).toHaveLength(3);

    await toolListButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });

  it("handles scroll, keydown, and drag guards without breaking state", async () => {
    const wrapper = mountExternalServicesView({
      services: [
        createService({
          serviceId: "mcp-scroll",
          displayName: "MCP Scroll",
          externalMcp: { tools: ["alpha"] },
        }),
      ],
    });

    const scroller = wrapper.find(".external-service-table-scroll");
    const scrollerEl = scroller.element as HTMLElement & {
      scrollWidth: number;
      clientWidth: number;
      scrollLeft: number;
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
      hasPointerCapture: (pointerId: number) => boolean;
    };
    Object.defineProperty(scrollerEl, "scrollWidth", { configurable: true, value: 900, writable: true });
    Object.defineProperty(scrollerEl, "clientWidth", { configurable: true, value: 300, writable: true });
    Object.defineProperty(scrollerEl, "scrollLeft", { configurable: true, value: 120, writable: true });
    scrollerEl.setPointerCapture = vi.fn();
    scrollerEl.releasePointerCapture = vi.fn();
    scrollerEl.hasPointerCapture = vi.fn(() => true);

    await scroller.trigger("keydown", { key: "ArrowRight" });
    expect(scrollerEl.scrollLeft).toBe(216);
    await scroller.trigger("keydown", { key: "Home" });
    expect(scrollerEl.scrollLeft).toBe(0);
    await scroller.trigger("keydown", { key: "End" });
    expect(scrollerEl.scrollLeft).toBe(900);

    await scroller.trigger("keydown", { key: "Escape" });
    expect(scrollerEl.scrollLeft).toBe(900);

    scrollerEl.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 7,
      clientX: 450,
    }));
    expect(scrollerEl.setPointerCapture).toHaveBeenCalledWith(7);
    scrollerEl.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 7,
      clientX: 410,
    }));
    expect(scrollerEl.scrollLeft).toBeGreaterThan(120);
    scrollerEl.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 7,
    }));
    expect(scrollerEl.releasePointerCapture).toHaveBeenCalledWith(7);
  });
});

describe("console-info-feed-execution-controller", () => {
  it("covers continuation guards and the summary retry branch", async () => {
    const { createConsoleInfoFeedExecutionController, trackMock, summaryMock, expertFeedbackMock } = await importExecutionController();

    const infoFeedCurrentRun = ref<any>(null);
    const infoFeedParentRunSnapshot = ref<any>(null);
    const infoFeedRunSequence = ref(0);
    const infoFeedForm = ref({
      query: "原始问题",
      modelAlias: "model-a",
      contextProfileId: "ctx-a",
      temperature: 0.2,
      maxTokens: 1800,
    });
    const error = ref("");
    const canReadKnowledge = ref(true);
    const selectedInfoFeedModel = ref({ value: "model-a", enabled: true });
    const infoFeedCanFollowUp = ref(false);
    const infoFeedReadyForSummary = ref(true);

    const controller = createConsoleInfoFeedExecutionController({
      agentExploreConfiguredLimit: ref(6),
      agentExploreConfiguredMaxIterations: ref(3),
      agentExploreThinkingParameters: vi.fn(() => ({})),
      applyInfoFeedSummaryAnswer: vi.fn(),
      archiveInfoFeedExpertFeedback: vi.fn(() => ({ archived: true }) as any),
      buildInfoFeedAgentQuery: vi.fn((run: any) => `agent:${run.query}`),
      buildInfoFeedSourceSearchQuery: vi.fn((run: any) => `source:${run.query}`),
      buildInfoFeedSummaryQuestion: vi.fn((run: any) => `summary:${run.query}`),
      canReadKnowledge,
      createInfoFeedRun: vi.fn((query: string) => makeRun({ runId: `run-${query}`, query })),
      error,
      fallbackInfoFeedSummary: vi.fn((run: any) => `fallback:${run.query}`),
      infoFeedAgentExpertGuidance: vi.fn(() => []),
      infoFeedAgentProgressFromResult: vi.fn(() => 0),
      infoFeedAgentRecentTurns: vi.fn(() => []),
      infoFeedCanFollowUp,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedKeywordCache: new Map(),
      infoFeedParentRunSnapshot,
      infoFeedReadyForSummary,
      infoFeedRunEvidenceRefs: vi.fn(() => []),
      infoFeedRunSequence,
      resetInfoFeedRunForContinuation: vi.fn((run: any, question: string) => {
        run.query = question;
      }),
      selectedInfoFeedContextProfile: ref({ value: "ctx-a" }),
      selectedInfoFeedModel,
      selectedThinkingMode: ref("normal"),
      upsertInfoFeedHistory: vi.fn(),
    });

    await controller.continueInfoFeedCurrentRun("追问");
    expect(error.value).toBe("");
    expect(trackMock.runInfoFeedKeywordTrack).not.toHaveBeenCalled();

    infoFeedCurrentRun.value = makeRun({ runId: "run-1", query: "原始问题" });
    canReadKnowledge.value = false;
    await controller.continueInfoFeedCurrentRun("追问");
    expect(error.value).toBe("当前账号没有知识库读取权限。");

    canReadKnowledge.value = true;
    selectedInfoFeedModel.value = { value: "model-a", enabled: false };
    await controller.continueInfoFeedCurrentRun("追问");
    expect(error.value).toBe("请选择模型库中已配置且支持智能体调用的模型。");

    selectedInfoFeedModel.value = { value: "model-a", enabled: true };
    const clarificationRun = makeRun({
      runId: "clarify-run",
      clarification: {
        questionId: "q1",
        prompt: "如何继续？",
        reason: "ambiguity",
        anchor: "summary",
        status: "open",
        selectedOptionId: "",
        options: [],
      },
      summary: {
        status: "running",
        modelAlias: "model-a",
        contextProfileId: "ctx-a",
        answer: "",
        error: "",
        fallback: false,
      },
    });
    infoFeedCurrentRun.value = clarificationRun;
    await controller.chooseInfoFeedClarification({
      optionId: "o1",
      label: "A",
      description: "desc",
      followUpQuestion: "继续",
    } as any);
    expect(expertFeedbackMock.syncInfoFeedExpertFeedback).not.toHaveBeenCalled();

    clarificationRun.summary.status = "completed";
    await controller.chooseInfoFeedClarification({
      optionId: "o1",
      label: "A",
      description: "desc",
      followUpQuestion: "继续",
    } as any);
    expect(expertFeedbackMock.syncInfoFeedExpertFeedback).toHaveBeenCalledTimes(1);

    const retryRun = makeRun({
      runId: "retry-run",
      pausedForRetry: "summary",
      summary: {
        status: "failed",
        modelAlias: "model-a",
        contextProfileId: "ctx-a",
        answer: "旧答案",
        error: "旧错误",
        fallback: true,
      },
    });
    infoFeedCurrentRun.value = retryRun;
    infoFeedReadyForSummary.value = true;
    await controller.continueInfoFeedAfterRetry();
    expect(retryRun.summary.answer).toBe("");
    expect(retryRun.summary.error).toBe("");
    expect(retryRun.summary.fallback).toBe(false);
    expect(summaryMock.runInfoFeedSummaryAgent).toHaveBeenCalled();

    const modelSelectionRun = makeRun({
      runId: "model-run",
      pausedForModelSelection: "agent",
      summary: {
        status: "completed",
        modelAlias: "model-old",
        contextProfileId: "ctx-old",
        answer: "",
        error: "",
        fallback: false,
      },
    });
    infoFeedCurrentRun.value = modelSelectionRun;
    selectedInfoFeedModel.value = { value: "model-new", enabled: true };
    await controller.continueInfoFeedAfterModelSelection();
    expect(modelSelectionRun.pausedForModelSelection).toBe("");
    expect(modelSelectionRun.summary.modelAlias).toBe("model-new");
    expect(trackMock.runInfoFeedAgentTrack).toHaveBeenCalled();
  });
});

describe("useConsole", () => {
  it("delegates browser-state clearing through the exposed action", async () => {
    vi.resetModules();
    const browserStateMock = {
      clearBrowserLocalStateFromUrlCore: vi.fn(() => Promise.resolve()),
    };
    const runtimeLifecycleMock = {
      mountConsoleRuntime: vi.fn(),
      unmountConsoleRuntime: vi.fn(),
    };

    const mocks: Array<[string, string]> = [
      ["../../../server-web/composables/console-agent-explore-utils", "isAgentExploreDraftSession"],
      ["../../../server-web/composables/console-agent-selection-reference-controller", "createConsoleAgentSelectionReferenceController"],
      ["../../../server-web/composables/console-agent-selector-controller", "createConsoleAgentSelectorController"],
      ["../../../server-web/composables/console-auth-controller", "createConsoleAuthController"],
      ["../../../server-web/composables/console-busy-controller", "createConsoleBusyController"],
      ["../../../server-web/composables/console-codex-oauth-controller", "createConsoleCodexOAuthController"],
      ["../../../server-web/composables/console-client-controller", "createConsoleClientController"],
      ["../../../server-web/composables/console-agent-explore-layout-controller", "createConsoleAgentExploreLayoutController"],
      ["../../../server-web/composables/console-agent-explore-output-controller", "createConsoleAgentExploreOutputController"],
      ["../../../server-web/composables/console-agent-explore-session-controller", "createConsoleAgentExploreSessionController"],
      ["../../../server-web/composables/console-agent-explore-state-controller", "createConsoleAgentExploreStateController"],
      ["../../../server-web/composables/console-context-compiler-controller", "createConsoleContextCompilerController"],
      ["../../../server-web/composables/console-discovery-controller", "createConsoleDiscoveryController"],
      ["../../../server-web/composables/console-expert-rules-controller", "createConsoleExpertRulesController"],
      ["../../../server-web/composables/console-feature-access-controller", "createConsoleFeatureAccessController"],
      ["../../../server-web/composables/console-knowledge-source-controller", "createConsoleKnowledgeSourceController"],
      ["../../../server-web/composables/console-path-picker-action-controller", "createConsolePathPickerActionController"],
      ["../../../server-web/composables/console-path-picker-controller", "createConsolePathPickerController"],
      ["../../../server-web/composables/console-runtime-mount-controller", "createConsoleRuntimeMountController"],
      ["../../../server-web/composables/console-dashboard-alert-controller", "createConsoleDashboardAlertController"],
      ["../../../server-web/composables/console-info-feed-controller", "createConsoleInfoFeedController"],
      ["../../../server-web/composables/console-knowledge-evidence-controller", "createConsoleKnowledgeEvidenceController"],
      ["../../../server-web/composables/console-knowledge-ingest-controller", "createConsoleKnowledgeIngestController"],
      ["../../../server-web/composables/console-job-controller", "createConsoleJobController"],
      ["../../../server-web/composables/console-knowledge-log-controller", "createConsoleKnowledgeLogController"],
      ["../../../server-web/composables/console-knowledge-maintenance-controller", "createConsoleKnowledgeMaintenanceController"],
      ["../../../server-web/composables/console-knowledge-recall-controller", "createConsoleKnowledgeRecallController"],
      ["../../../server-web/composables/console-knowledge-search-state-controller", "createConsoleKnowledgeSearchPanelStateController"],
      ["../../../server-web/composables/console-knowledge-search-state-controller", "createConsoleKnowledgeSearchStateController"],
      ["../../../server-web/composables/console-knowledge-review-controller", "createConsoleKnowledgeReviewController"],
      ["../../../server-web/composables/console-maintenance-agent-controller", "createConsoleMaintenanceAgentController"],
      ["../../../server-web/composables/console-mcp-authorization-controller", "createConsoleMcpAuthorizationController"],
      ["../../../server-web/composables/console-model-library-controller", "createConsoleModelLibraryController"],
      ["../../../server-web/composables/console-option-bar-controller", "createConsoleOptionBarController"],
      ["../../../server-web/composables/console-ops-monitor-controller", "createConsoleOpsMonitorController"],
      ["../../../server-web/composables/console-rule-authoring-controller", "createConsoleRuleAuthoringController"],
      ["../../../server-web/composables/console-refresh-state-controller", "createConsoleRefreshStateController"],
      ["../../../server-web/composables/console-server-event-controller", "createConsoleServerEventController"],
      ["../../../server-web/composables/console-settings-bridge-controller", "createConsoleSettingsBridgeController"],
      ["../../../server-web/composables/console-settings-draft-controller", "createConsoleSettingsDraftController"],
      ["../../../server-web/composables/console-settings-persistence-controller", "createConsoleSettingsPersistenceController"],
      ["../../../server-web/composables/console-state-event-reducer-controller", "createConsoleStateEventReducerController"],
      ["../../../server-web/composables/console-system-log-row-controller", "createConsoleSystemLogRowController"],
      ["../../../server-web/composables/console-tool-management-controller", "createConsoleToolManagementController"],
      ["../../../server-web/composables/console-word-cloud-controller", "createConsoleWordCloudController"],
      ["../../../server-web/composables/console-runtime-lifecycle-controller", "createConsoleRuntimeLifecycleController"],
      ["../../../server-web/composables/console-navigation-controller", "createConsoleNavigationController"],
    ];

    vi.doMock("vue-router", () => ({
      useRouter: vi.fn(() => ({
        currentRoute: makeRef({ fullPath: "/dashboard", meta: { viewId: "dashboard" }, params: {} }),
        push: vi.fn(),
      })),
      useRoute: vi.fn(() => ({ fullPath: "/dashboard", meta: { viewId: "dashboard" }, params: {} })),
    }));
    vi.doMock("../../../server-web/composables/console-browser-state-utils", () => ({
      CLEAR_LOCAL_STATE_PARAM: "clearLocalState",
      clearBrowserCacheStorage: vi.fn(),
      clearBrowserLocalStateFromUrl: browserStateMock.clearBrowserLocalStateFromUrlCore,
      clearIndexedDbDatabases: vi.fn(),
      unregisterServiceWorkers: vi.fn(),
    }));
    vi.doMock("../../../server-web/composables/console-browser-effects", () => ({
      confirmConsoleAction: vi.fn(),
      copyTextToClipboard: vi.fn(),
      createConsoleTargetHighlightController: vi.fn(() => ({
        configTargetElement: vi.fn(() => null),
        scrollToConfigTarget: vi.fn(),
        clearConfigTargetHighlight: vi.fn(),
      })),
      downloadTextFile: vi.fn(),
      notifyConsoleAction: vi.fn(),
    }));

    for (const [modulePath, exportName] of mocks) {
      vi.doMock(modulePath, () => ({
        [exportName]: vi.fn(() => createLooseController()),
      }));
    }

    vi.doMock("../../../server-web/composables/console-feature-access-controller", () => ({
      createConsoleFeatureAccessController: vi.fn(() =>
        createLooseController({
          activeConsoleFeatureIds: ref(["knowledge-core", "agent-management", "agent-gateway", "maintenance-agent-runbooks"]),
          hasAnyFeature: vi.fn(() => true),
          hasFeature: vi.fn(() => true),
          isAdminViewEnabled: vi.fn(() => true),
          visibleDebugTabs: ref([{ id: "knowledgeRecall", label: "知识召回" }]),
          visibleKnowledgeTabs: ref([{ id: "management", label: "知识归档" }]),
        }),
      ),
    }));
    vi.doMock("../../../server-web/composables/console-busy-controller", () => ({
      createConsoleBusyController: vi.fn(() =>
        createLooseController({
          busyKey: ref(""),
          isBusy: ref(false),
          isBusyPrefix: ref(""),
          clearAllBusy: vi.fn(),
          clearBusy: vi.fn(),
          setBusy: vi.fn(),
        }),
      ),
    }));
    vi.doMock("../../../server-web/composables/console-codex-oauth-controller", () => ({
      createConsoleCodexOAuthController: vi.fn(() =>
        createLooseController({
          beginCodexOAuthLogin: vi.fn(),
          codexOAuthLogin: vi.fn(),
          codexOAuthPollTimer: ref(0),
          codexOAuthStatus: ref("idle"),
          ensureCodexOAuthReady: vi.fn(),
          refreshCodexOAuthStatus: vi.fn(),
          startCodexOAuthPolling: vi.fn(),
          stopCodexOAuthPolling: vi.fn(),
        }),
      ),
    }));
    vi.doMock("../../../server-web/composables/console-client-controller", () => ({
      createConsoleClientController: vi.fn(() => createLooseController()),
    }));
    vi.doMock("../../../server-web/composables/console-knowledge-search-state-controller", () => ({
      createConsoleKnowledgeSearchPanelStateController: vi.fn(() => createLooseController({
        knowledgeSearchEmpty: ref(true),
        knowledgeSearchExpanded: ref(false),
      })),
      createConsoleKnowledgeSearchStateController: vi.fn(() => createLooseController({
        knowledgeSearchForm: ref({ query: "" }),
        knowledgeSearchResponse: ref(null),
        knowledgeSearchResults: ref([]),
        lastKnowledgeSearchQuery: ref(""),
      })),
    }));
    vi.doMock("../../../server-web/composables/console-agent-explore-state-controller", () => ({
      createConsoleAgentExploreStateController: vi.fn(() => createLooseController({
        agentExploreForm: ref({ modelAlias: "" }),
        agentExploreResult: ref({}),
      })),
    }));
    vi.doMock("../../../server-web/composables/console-agent-selector-controller", () => ({
      createConsoleAgentSelectorController: vi.fn(() => createLooseController({
        agentSelectorOptions: ref([]),
        cacheAgentModelOptionLabels: vi.fn(),
        hasAgentModelOption: vi.fn(() => true),
        validAgentModelAlias: vi.fn((value?: string) => String(value || "")),
      })),
    }));
    vi.doMock("../../../server-web/composables/console-auth-controller", () => ({
      createConsoleAuthController: vi.fn(() => createLooseController({
        canAdminAuth: ref(false),
        canAdminKnowledge: ref(false),
        canAdminMaintenanceAgent: ref(false),
        canApproveMaintenanceAgent: ref(false),
        canBrowseServerPaths: ref(true),
        canMaintainKnowledge: ref(true),
        canReadKnowledge: ref(true),
        canReadMaintenanceAgent: ref(false),
        canRunMaintenanceAgent: ref(false),
        canWriteJobs: ref(false),
        canWriteKnowledge: ref(true),
        currentUser: ref({ username: "demo" }),
        currentUserScopes: ref([]),
        hasScope: vi.fn(() => true),
        isAuthenticated: ref(true),
        loginForm: ref({ username: "", password: "" }),
        refreshAuthAdmin: vi.fn(),
        refreshAuthState: vi.fn(),
        logoutConsole: vi.fn(),
        revokeConsoleSession: vi.fn(),
        saveOidcConfig: vi.fn(),
        submitLoginAuth: vi.fn(),
        updateConsoleUser: vi.fn(),
        updateConsoleUserRole: vi.fn(),
        updateConsoleUserRoleFromEvent: vi.fn(),
      })),
    }));
    vi.doMock("../../../server-web/composables/console-runtime-lifecycle-controller", () => ({
      createConsoleRuntimeLifecycleController: vi.fn((deps: { clearBrowserLocalStateFromUrl: () => Promise<void> }) => ({
        mountConsoleRuntime: () => {
          runtimeLifecycleMock.mountConsoleRuntime();
          void deps.clearBrowserLocalStateFromUrl();
        },
        unmountConsoleRuntime: () => {
          runtimeLifecycleMock.unmountConsoleRuntime();
        },
      })),
    }));

    const { useConsole } = await import("../../../server-web/composables/useConsole");
    const shell = defineComponent({
      setup: () => useConsole(),
      template: "<div />",
    });
    const wrapper = mount(shell);
    await nextTick();

    expect(browserStateMock.clearBrowserLocalStateFromUrlCore).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(runtimeLifecycleMock.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
  });
});
