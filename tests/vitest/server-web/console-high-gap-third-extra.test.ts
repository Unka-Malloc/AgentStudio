// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleAuthController } from "../../../server-web/composables/console-auth-controller";
import { createConsoleInfoFeedExecutionController } from "../../../server-web/composables/console-info-feed-execution-controller";
import type { InfoFeedRunState } from "../../../server-web/types/app";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";

const authClientMocks = vi.hoisted(() => ({
  getAuthOidc: vi.fn(),
  getAuthSession: vi.fn(),
  listAuthAudit: vi.fn(),
  listAuthSessions: vi.fn(),
  listAuthUsers: vi.fn(),
  loginAuth: vi.fn(),
  logoutAuth: vi.fn(),
  revokeAuthSession: vi.fn(),
  saveAuthOidc: vi.fn(),
  updateAuthUser: vi.fn(),
}));

const bridgeMocks = vi.hoisted(() => ({
  parseBrowserRelativeUrl: vi.fn(),
  triggerBrowserDownload: vi.fn(),
}));

const browserEffectMocks = vi.hoisted(() => ({
  copyConsoleTextWithFeedback: vi.fn(),
}));

const externalServicesControllerMock = vi.hoisted(() => ({
  current: null as any,
}));

const infoFeedTrackMocks = vi.hoisted(() => ({
  runInfoFeedKeywordTrack: vi.fn().mockResolvedValue(undefined),
  runInfoFeedAgentTrack: vi.fn().mockResolvedValue(undefined),
  runInfoFeedSummaryAgent: vi.fn().mockResolvedValue(undefined),
  syncInfoFeedExpertFeedback: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../server-web/lib/auth-client", () => authClientMocks);
vi.mock("../../../server-web/lib/browser-window", () => ({
  parseBrowserRelativeUrl: bridgeMocks.parseBrowserRelativeUrl,
}));
vi.mock("../../../server-web/lib/browser-downloads", () => ({
  triggerBrowserDownload: bridgeMocks.triggerBrowserDownload,
}));
vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesControllerMock.current),
}));
vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));
vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyConsoleTextWithFeedback: browserEffectMocks.copyConsoleTextWithFeedback,
}));
vi.mock("../../../server-web/composables/console-info-feed-track-controller", () => ({
  createConsoleInfoFeedTrackController: vi.fn(() => ({
    runInfoFeedKeywordTrack: infoFeedTrackMocks.runInfoFeedKeywordTrack,
    runInfoFeedAgentTrack: infoFeedTrackMocks.runInfoFeedAgentTrack,
  })),
}));
vi.mock("../../../server-web/composables/console-info-feed-expert-feedback-controller", () => ({
  createConsoleInfoFeedExpertFeedbackController: vi.fn(() => ({
    syncInfoFeedExpertFeedback: infoFeedTrackMocks.syncInfoFeedExpertFeedback,
  })),
}));
vi.mock("../../../server-web/composables/console-info-feed-summary-runner-controller", () => ({
  createConsoleInfoFeedSummaryRunnerController: vi.fn(() => ({
    runInfoFeedSummaryAgent: infoFeedTrackMocks.runInfoFeedSummaryAgent,
  })),
}));

const ConfigFloatingPanelStub = defineComponent({
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
  setup(props, { emit, slots }) {
    return () =>
      props.open
        ? h("section", { class: "config-panel-stub" }, [
            h("h3", String(props.title || "")),
            h("button", { class: "config-panel-verify", type: "button", onClick: () => emit("verify") }, props.verifying ? "校验中" : "校验配置"),
            h("button", { class: "config-panel-close", type: "button", onClick: () => emit("close") }, "关闭"),
            slots.default?.(),
          ])
        : null;
  },
});

const HelpTooltipStub = defineComponent({
  name: "HelpTooltip",
  props: {
    ariaLabel: { type: String, default: "" },
    items: { type: Array, default: () => [] },
    text: { type: String, default: "" },
  },
  setup(props) {
    return () => h("span", { class: "help-tooltip-stub", "aria-label": props.ariaLabel }, String(props.text || ""));
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: { type: String, default: "" },
    label: { type: String, default: "" },
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone }, String(props.label || ""));
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props, { emit }) {
    return () =>
      h("button", {
        class: "binary-checkbox-stub",
        type: "button",
        disabled: props.disabled,
        onClick: () => {
          const next = !props.modelValue;
          emit("update:model-value", next);
          emit("update:modelValue", next);
          emit("change", next);
        },
      }, String(props.label || ""));
  },
});

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function makeAuthSession(authenticated: boolean, scopes: string[] = []) {
  return {
    enabled: true,
    bootstrap: { required: false, tokenPrefix: "pact", tokenFilePath: "" },
    session: {
      authenticated,
      csrfToken: authenticated ? "csrf" : "",
      expiresAt: "2026-06-05T00:00:00.000Z",
      user: authenticated
        ? {
            userId: "user-1",
            username: "owner",
            displayName: "Owner",
            roleId: "admin",
            roleLabel: "Admin",
            scopes,
            enabled: true,
            createdAt: "2026-06-04T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
            lastLoginAt: "",
          }
        : null,
    },
    roles: [],
    oidc: {
      enabled: false,
      issuer: "",
      clientId: "",
      clientSecretConfigured: false,
      redirectUri: "",
      allowedDomains: [],
      roleMapping: {},
      updatedAt: "",
    },
  } as const;
}

function makeRun(overrides: Partial<InfoFeedRunState> = {}) {
  return {
    runId: "run-1",
    query: "需要继续的知识流问题",
    summary: {
      status: "completed",
      modelAlias: "model-a",
      contextProfileId: "profile-a",
      answer: "done",
      error: "",
      fallback: false,
    },
    keyword: {
      status: "completed",
      progress: 100,
      stage: "done",
      fromCache: false,
      response: null,
      error: "",
    },
    agent: {
      status: "completed",
      progress: 100,
      runId: "agent-run-1",
      workspaceId: "workspace-1",
      response: null,
      error: "",
    },
    pausedForModelSelection: "",
    pausedForRetry: "",
    clarification: null,
    ...overrides,
  } as InfoFeedRunState;
}

function createAuthHarness() {
  const consoleState = ref({} as any);
  const error = ref("");
  const clearAllBusy = vi.fn();
  const refreshState = vi.fn(async () => ({ ok: true }));
  const resetServerEventCursor = vi.fn();
  const setBusy = vi.fn();
  const startServerEventSubscription = vi.fn();
  const stopServerEventSubscription = vi.fn();

  return {
    clearAllBusy,
    consoleState,
    controller: createConsoleAuthController({
      consoleState,
      error,
      clearAllBusy,
      refreshState,
      resetServerEventCursor,
      setBusy,
      startServerEventSubscription,
      stopServerEventSubscription,
    }),
    error,
    refreshState,
    resetServerEventCursor,
    setBusy,
    startServerEventSubscription,
    stopServerEventSubscription,
  };
}

function createInfoFeedHarness() {
  const infoFeedRunSequence = ref(1);
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
  const infoFeedForm = ref({
    query: "",
    modelAlias: "model-a",
    contextProfileId: "profile-a",
    temperature: 0.2,
    maxTokens: 1800,
  });
  const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(null);
  const selectedInfoFeedModel = ref({ value: "model-a", enabled: true });
  const selectedInfoFeedContextProfile = ref({ value: "profile-a" });
  const selectedThinkingMode = ref("default");
  const canReadKnowledge = ref(true);
  const infoFeedCanFollowUp = ref(false);
  const infoFeedReadyForSummary = ref(true);
  const error = ref("");
  const infoFeedKeywordCache = new Map<string, { response: unknown; cachedAt: number }>();
  const createInfoFeedRun = vi.fn((query: string) => makeRun({ query, runId: `run-${infoFeedRunSequence.value + 1}` }));
  const applyInfoFeedSummaryAnswer = vi.fn();
  const archiveInfoFeedExpertFeedback = vi.fn();
  const buildInfoFeedAgentQuery = vi.fn((run: InfoFeedRunState) => `agent:${run.runId}`);
  const buildInfoFeedSourceSearchQuery = vi.fn((run: InfoFeedRunState) => `source:${run.runId}`);
  const buildInfoFeedSummaryQuestion = vi.fn((run: InfoFeedRunState) => `summary:${run.runId}`);
  const fallbackInfoFeedSummary = vi.fn((run: InfoFeedRunState) => `fallback:${run.runId}`);
  const infoFeedAgentExpertGuidance = vi.fn();
  const infoFeedAgentProgressFromResult = vi.fn(() => 0);
  const infoFeedAgentRecentTurns = vi.fn();
  const infoFeedRunEvidenceRefs = vi.fn(() => []);
  const resetInfoFeedRunForContinuation = vi.fn();
  const upsertInfoFeedHistory = vi.fn();

  return {
    applyInfoFeedSummaryAnswer,
    archiveInfoFeedExpertFeedback,
    buildInfoFeedAgentQuery,
    buildInfoFeedSourceSearchQuery,
    buildInfoFeedSummaryQuestion,
    canReadKnowledge,
    controller: createConsoleInfoFeedExecutionController({
      agentExploreConfiguredLimit: ref(3),
      agentExploreConfiguredMaxIterations: ref(5),
      agentExploreThinkingParameters: () => ({}),
      applyInfoFeedSummaryAnswer,
      archiveInfoFeedExpertFeedback,
      buildInfoFeedAgentQuery,
      buildInfoFeedSourceSearchQuery,
      buildInfoFeedSummaryQuestion,
      canReadKnowledge,
      createInfoFeedRun,
      error,
      fallbackInfoFeedSummary,
      infoFeedAgentExpertGuidance,
      infoFeedAgentProgressFromResult,
      infoFeedAgentRecentTurns,
      infoFeedCanFollowUp,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedKeywordCache,
      infoFeedParentRunSnapshot,
      infoFeedReadyForSummary,
      infoFeedRunEvidenceRefs,
      infoFeedRunSequence,
      resetInfoFeedRunForContinuation,
      selectedInfoFeedContextProfile,
      selectedInfoFeedModel,
      selectedThinkingMode,
      upsertInfoFeedHistory,
    }),
    createInfoFeedRun,
    error,
    fallbackInfoFeedSummary,
    infoFeedAgentExpertGuidance,
    infoFeedAgentProgressFromResult,
    infoFeedAgentRecentTurns,
    infoFeedCanFollowUp,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedKeywordCache,
    infoFeedParentRunSnapshot,
    infoFeedReadyForSummary,
    infoFeedRunEvidenceRefs,
    infoFeedRunSequence,
    resetInfoFeedRunForContinuation,
    selectedInfoFeedContextProfile,
    selectedInfoFeedModel,
    selectedThinkingMode,
    upsertInfoFeedHistory,
  };
}

function createExternalServicesController() {
  return {
    actionError: "",
    actionMessage: "",
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    closeConfigEditor: vi.fn(),
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    configDraft: {
      binding: { mode: "passthrough", outlet: "pact.skillHub", risk: "read_only" },
      healthCheck: { type: "none", host: "127.0.0.1", port: 8787, timeoutMs: 60000, url: "" },
      mode: "connected",
      metadata: {},
      scripts: {},
      serviceId: "service-1",
      serviceName: "service-1",
      startupPolicy: "external-only",
      description: "external service",
      upstream: {
        mode: "remote-live",
        provider: "icloud",
        secretRef: "secret://drive",
        endpointRef: "config://drive-endpoint",
        endpointUrl: "https://drive.example",
        rootPath: "/Users/name/Library/Mobile Documents/com~apple~CloudDocs",
        timeoutMs: 5000,
        transport: "streamable-http",
        type: "cloud-drive",
        url: "https://drive.example",
      },
    },
    configEditorOpen: true,
    configEditorSubtitle: "subtitle",
    configEditorTitle: "title",
    configStatusLabel: "Valid",
    configStatusTone: "success",
    configText: "{\n  \"serviceId\": \"service-1\"\n}",
    configEditorMode: "add",
    customUpstreamTypeValue: "custom-service",
    discoveredServiceCount: 1,
    dirty: false,
    externalServicesView: undefined,
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    isCloudDriveServiceDraft: true,
    isLlmServiceDraft: true,
    loading: false,
    modeOptions: [{ value: "connected", label: "connected" }],
    mcpTransportOptions: [{ value: "streamable-http", label: "streamable-http" }],
    mcpToolCount: 2,
    modelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
    modelProtocolSelectValue: "openai-compatible",
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 0,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [{ value: "read_only", label: "read_only" }],
    saveConfig: vi.fn(),
    serviceDiscoveryLabel: vi.fn(() => "MCP 服务"),
    serviceDiscoveryRegistrationLabel: vi.fn(() => "工具已发现"),
    serviceDiscoveryRegistrationTone: vi.fn(() => "success"),
    serviceDiscoveryTone: vi.fn(() => "success"),
    serviceHeartbeatLastAtLabel: vi.fn(() => "Latest: -"),
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    serviceSourceDetail: vi.fn(() => "本地 / service-1"),
    services: [
      {
        entryId: "service-1",
        serviceId: "service-1",
        serviceName: "service-1",
        displayName: "Service One",
        description: "External service",
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
        sourceLabelText: "本地 / service-1",
        discoveryLabelText: "MCP 服务",
        discoveryTone: "success",
        discoveryRegistrationLabelText: "工具已发现",
        discoveryRegistrationTone: "success",
        heartbeatText: "Latest: -",
        heartbeatRefreshing: false,
      },
    ],
    showCustomUpstreamType: true,
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
    validServiceCount: 1,
    validationErrors: ["invalid upstream"],
    validationWarnings: ["check transport"],
    verifying: false,
    verifyConfig: vi.fn(),
  };
}

async function loadBridgeHttp() {
  vi.resetModules();
  return import("../../../server-web/lib/bridge-http");
}

async function loadRouter() {
  vi.resetModules();
  return import("../../../server-web/router/index");
}

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  bridgeMocks.parseBrowserRelativeUrl.mockReset();
  bridgeMocks.triggerBrowserDownload.mockReset();
  infoFeedTrackMocks.runInfoFeedKeywordTrack.mockClear();
  infoFeedTrackMocks.runInfoFeedAgentTrack.mockClear();
  infoFeedTrackMocks.runInfoFeedSummaryAgent.mockClear();
  infoFeedTrackMocks.syncInfoFeedExpertFeedback.mockClear();
  externalServicesControllerMock.current = null;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bridge-http", () => {
  it("falls back to URL segments when browser-relative parsing fails", async () => {
    bridgeMocks.parseBrowserRelativeUrl.mockImplementationOnce(() => {
      throw new Error("parse failed");
    });
    const { downloadFile } = await loadBridgeHttp();
    fetchMock().mockResolvedValueOnce(new Response("abc", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }));

    await expect(downloadFile("/api/files/fallback-name.bin?download=1")).resolves.toMatchObject({
      fileName: "fallback-name.bin",
      byteLength: 3,
    });
    expect(bridgeMocks.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "fallback-name.bin");
  });
});

describe("console-auth-controller", () => {
  it("handles bootstrap/login failures, early admin exits, and OIDC JSON errors", async () => {
    authClientMocks.getAuthSession.mockRejectedValueOnce(new Error("bootstrap failed"));
    authClientMocks.loginAuth.mockResolvedValue({ ok: true });
    authClientMocks.getAuthSession.mockResolvedValueOnce(makeAuthSession(false));

    const harness = createAuthHarness();

    await expect(harness.controller.refreshAuthState()).resolves.toBeNull();
    expect(harness.error.value).toBe("bootstrap failed");
    expect(harness.stopServerEventSubscription).toHaveBeenCalledTimes(1);
    expect(harness.consoleState.value).toBeNull();

    harness.error.value = "";
    harness.controller.loginForm.value = { username: "owner", password: "secret" };
    await harness.controller.submitLoginAuth();
    expect(authClientMocks.loginAuth).toHaveBeenCalledWith({ username: "owner", password: "secret" });
    expect(harness.error.value).toBe("登录已返回，但会话状态尚未生效，请重试。");
    expect(harness.refreshState).not.toHaveBeenCalled();
    expect(harness.startServerEventSubscription).not.toHaveBeenCalled();

    await harness.controller.refreshAuthAdmin();
    expect(authClientMocks.listAuthUsers).not.toHaveBeenCalled();
    expect(authClientMocks.listAuthAudit).not.toHaveBeenCalled();
    expect(authClientMocks.listAuthSessions).not.toHaveBeenCalled();
    expect(authClientMocks.getAuthOidc).not.toHaveBeenCalled();

    harness.controller.oidcRoleMappingText.value = "{broken";
    await harness.controller.saveOidcConfig();
    expect(authClientMocks.saveAuthOidc).not.toHaveBeenCalled();
    expect(harness.error.value).toContain("JSON");

    authClientMocks.saveAuthOidc.mockRejectedValueOnce("save failed");
    harness.controller.oidcRoleMappingText.value = "{}";
    await harness.controller.saveOidcConfig();
    expect(harness.error.value).toBe("保存 OIDC 失败。");
  });
});

describe("console-info-feed-execution-controller", () => {
  it("bails out when the run sequence becomes stale", async () => {
    const harness = createInfoFeedHarness();
    const run = makeRun();

    harness.infoFeedCurrentRun.value = run;
    harness.infoFeedRunSequence.value = 1;
    harness.infoFeedReadyForSummary.value = true;
    infoFeedTrackMocks.runInfoFeedKeywordTrack.mockImplementationOnce(async () => {
      harness.infoFeedRunSequence.value = 2;
    });

    await harness.controller.executeInfoFeedRunIteration(1, run);
    expect(infoFeedTrackMocks.runInfoFeedSummaryAgent).not.toHaveBeenCalled();
    expect(harness.upsertInfoFeedHistory).not.toHaveBeenCalled();
  });

  it("stores paused runs and skips summary work", async () => {
    const harness = createInfoFeedHarness();
    const run = makeRun({ pausedForModelSelection: "agent" });

    harness.infoFeedCurrentRun.value = run;
    await harness.controller.executeInfoFeedRunIteration(1, run);

    expect(infoFeedTrackMocks.runInfoFeedKeywordTrack).toHaveBeenCalledWith(1, run.runId, "source:run-1");
    expect(infoFeedTrackMocks.runInfoFeedAgentTrack).toHaveBeenCalledWith(1, run.runId, "agent:run-1");
    expect(harness.upsertInfoFeedHistory).toHaveBeenCalledWith(run);
    expect(infoFeedTrackMocks.runInfoFeedSummaryAgent).not.toHaveBeenCalled();
  });
});

describe("ExternalServicesView", () => {
  it("renders conditional draft fields and closes the tool popover from both toggle paths", async () => {
    externalServicesControllerMock.current = createExternalServicesController();
    const wrapper = mount(ExternalServicesView, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          ConfigFloatingPanel: ConfigFloatingPanelStub,
          HelpTooltip: HelpTooltipStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.text()).toContain("自定义类型");
    expect(wrapper.text()).toContain("模型协议");
    expect(wrapper.text()).toContain("网盘 Provider");
    expect(wrapper.text()).toContain("Secret Ref");
    expect(wrapper.text()).toContain("Endpoint Ref");
    expect(wrapper.text()).toContain("iCloud Root Path");

    const toolButton = wrapper.get(".external-service-tool-list-button");
    await toolButton.trigger("click");
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);
    expect(wrapper.find(".external-service-tool-popover").text()).toContain("alpha");
    expect(wrapper.find(".external-service-tool-popover").text()).toContain("beta");

    await toolButton.trigger("click");
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    await toolButton.trigger("click");
    await nextTick();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });

  it("shows upstream copy feedback and exercises table scroll, drag, and keyboard branches", async () => {
    externalServicesControllerMock.current = createExternalServicesController();
    const wrapper = mount(ExternalServicesView, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          ConfigFloatingPanel: ConfigFloatingPanelStub,
          HelpTooltip: HelpTooltipStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await nextTick();

    const scroller = wrapper.get(".external-service-table-scroll").element as HTMLElement & {
      clientWidth: number;
      scrollLeft: number;
      scrollWidth: number;
      setPointerCapture: (pointerId: number) => void;
      hasPointerCapture: (pointerId: number) => boolean;
      releasePointerCapture: (pointerId: number) => void;
    };
    Object.defineProperty(scroller, "clientWidth", { value: 420, configurable: true });
    Object.defineProperty(scroller, "scrollWidth", { value: 1040, configurable: true });
    Object.defineProperty(scroller, "scrollLeft", { value: 0, writable: true, configurable: true });
    scroller.setPointerCapture = vi.fn();
    scroller.hasPointerCapture = vi.fn(() => true);
    scroller.releasePointerCapture = vi.fn();

    const upstreamButton = wrapper.get(".external-service-upstream-copy");
    await upstreamButton.trigger("mouseenter");
    await nextTick();
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(true);
    expect(wrapper.find(".external-service-upstream-bubble").text()).toBe("127.0.0.1:8787");

    await upstreamButton.trigger("click");
    expect(browserEffectMocks.copyConsoleTextWithFeedback).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      "127.0.0.1:8787",
      { message: "已复制" },
    );

    const toolButton = wrapper.get(".external-service-tool-list-button");
    await toolButton.trigger("click");
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    await wrapper.get(".external-service-tool-popover").trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    await scroller.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7, clientX: 300 }));
    await scroller.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: 280 }));
    await scroller.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: 220 }));
    await scroller.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, clientX: 220 }));

    expect(scroller.setPointerCapture).toHaveBeenCalledWith(7);
    expect(scroller.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(scroller.scrollLeft).toBeGreaterThan(0);

    await wrapper.get(".external-service-table-scroll").trigger("keydown", { key: "ArrowRight" });
    expect(scroller.scrollLeft).toBeGreaterThan(0);

    await wrapper.get(".external-service-table-scroll").trigger("keydown", { key: "Home" });
    expect(scroller.scrollLeft).toBe(0);

    await wrapper.get(".external-service-table-scroll").trigger("keydown", { key: "End" });
    expect(scroller.scrollLeft).toBe(1040);

    await wrapper.get(".external-service-table-scroll").trigger("scroll");
    await nextTick();
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });
});

describe("router index", () => {
  it("redirects invalid subroutes to their canonical tabs", async () => {
    const { router } = await loadRouter();

    await router.push("/knowledge/not-a-tab");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/knowledge/management");

    await router.push("/debug/not-a-tab");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/debug/knowledgeRecall");

    await router.push("/external-services/not-a-tab");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/external-services/list");
  });

  it("loads a canonical lazy route and preserves the router scroll behavior", async () => {
    const { router } = await loadRouter();

    expect(router.options.scrollBehavior?.()).toEqual({ top: 0 });

    await router.push("/external-services/list");
    await router.isReady();

    expect(router.currentRoute.value.path).toBe("/external-services/list");
    expect(router.currentRoute.value.meta).toMatchObject({ viewId: "externalServices" });
  });
});
