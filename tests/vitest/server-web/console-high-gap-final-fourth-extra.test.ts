// @vitest-environment jsdom
import { computed, defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../../server-web/router";
import { useConsole } from "../../../server-web/composables/useConsole";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";
import type { CloudDriveExposureForm } from "../../../server-web/types/workspaces";

function makeRoute(fullPath: string, viewId: string, extra: { adminView?: string; tab?: string } = {}) {
  return reactive({
    fullPath,
    path: fullPath,
    meta: extra.adminView ? { viewId, adminView: extra.adminView } : { viewId },
    params: extra.tab ? { tab: extra.tab } : {},
  }) as any;
}

function flush() {
  return nextTick().then(() => nextTick());
}

const routerState = vi.hoisted(() => ({
  route: null as any,
  push: vi.fn(),
}));

const browserEffectsMock = vi.hoisted(() => ({
  notifyConsoleAction: vi.fn(),
  confirmConsoleAction: vi.fn(),
  copyTextToClipboard: vi.fn(),
  downloadTextFile: vi.fn(),
  createConsoleTargetHighlightController: vi.fn(() => ({
    configTargetElement: vi.fn(() => null),
    scrollToConfigTarget: vi.fn(async () => undefined),
    clearConfigTargetHighlight: vi.fn(),
  })),
}));

const browserStateMock = vi.hoisted(() => ({
  clearBrowserLocalStateFromUrlCore: vi.fn(async () => undefined),
  clearBrowserCacheStorage: vi.fn(),
  clearIndexedDbDatabases: vi.fn(),
  unregisterServiceWorkers: vi.fn(),
}));

const runtimeLifecycleMock = vi.hoisted(() => ({
  mountConsoleRuntime: vi.fn(),
  unmountConsoleRuntime: vi.fn(),
}));

const refreshStateMock = vi.hoisted(() => {
  const { ref } = require("vue");
  const serverAvailable = ref(false);
  const error = ref("");
  return {
    REFRESH_STATE_DELAY_MS: 1000,
    clearPendingRefreshState: vi.fn(),
    clearPendingRefreshStateTimer: vi.fn(),
    lastRefreshStateStartedAt: ref(0),
    mergeRefreshStateOptions: vi.fn((options) => options),
    normalizeRefreshStateOptions: vi.fn((options) => options),
    pendingRefreshStateOptions: ref({} as Record<string, unknown>),
    pendingRefreshStatePromise: ref(Promise.resolve(undefined)),
    pendingRefreshStateResolve: vi.fn(),
    pendingRefreshStateTimer: ref(null as ReturnType<typeof setTimeout> | null),
    performRefreshState: vi.fn(),
    refreshState: vi.fn(async (options: Record<string, unknown> = {}) => {
      if (options && typeof options === "object") {
        serverAvailable.value = true;
        error.value = "";
      }
      return undefined;
    }),
    scheduleDelayedRefreshState: vi.fn(),
    serverAvailable,
    error,
    serverAvailableRef: null as any,
    errorRef: null as any,
  };
});

const navigationMock = vi.hoisted(() => {
  const { ref } = require("vue");
  const currentView = ref("dashboard");
  const adminView = ref("jobs");
  const debugTab = ref("knowledgeRecall");
  const externalServiceTab = ref("list");
  const knowledgeTab = ref("management");
  const knowledgeManagementPanel = ref("sources");
  const viewTitle = ref("控制台");
  const visibleDebugTabs = ref([{ id: "knowledgeRecall", label: "知识召回" }]);
  const visibleKnowledgeTabs = ref([{ id: "management", label: "知识归档" }]);

  function syncNavigationStateFromRoute(route: { meta?: { viewId?: string; adminView?: string }; params?: Record<string, string>; path?: string } = {}) {
    const viewId = route.meta?.viewId || "dashboard";
    if (["dashboard", "knowledge", "admin", "debug", "externalServices"].includes(viewId)) {
      currentView.value = viewId as any;
    } else {
      currentView.value = "dashboard";
    }

    if (viewId === "knowledge") {
      knowledgeTab.value = route.params?.tab || "management";
      knowledgeManagementPanel.value = "knowledge";
      viewTitle.value = "知识库";
      return;
    }

    if (viewId === "admin") {
      adminView.value = route.meta?.adminView || route.path?.split("/").at(-1) || "jobs";
      viewTitle.value = "管理员";
      return;
    }

    if (viewId === "debug") {
      debugTab.value = route.params?.tab || "knowledgeRecall";
      viewTitle.value = "调试";
      return;
    }

    if (viewId === "externalServices") {
      externalServiceTab.value = route.params?.tab || "list";
      viewTitle.value = "外部服务";
      return;
    }

    knowledgeTab.value = "management";
    debugTab.value = "knowledgeRecall";
    adminView.value = "jobs";
    externalServiceTab.value = "list";
    knowledgeManagementPanel.value = "sources";
    viewTitle.value = "工作台";
  }

  return {
    adminView,
    bindNavigationRouter: vi.fn(),
    closeDrawer: vi.fn(),
    closeSideNavOverlay: vi.fn(),
    currentView,
    debugTab,
    drawerOpen: ref(false),
    drawerTab: ref("tools"),
    ensureKnowledgeTabState: vi.fn(),
    externalServiceTab,
    isKnownDebugRouteTab: vi.fn(() => true),
    jumpToKnowledgeFileImport: vi.fn(),
    knowledgeManagementPanel,
    knowledgeTab,
    openAdmin: vi.fn(),
    openAgentConfigurationAlert: vi.fn(),
    openDebugTab: vi.fn(),
    openDrawer: vi.fn(),
    openExternalServiceTab: vi.fn(),
    openKnowledgeManagementPanel: vi.fn(),
    openKnowledgeTab: vi.fn(),
    refreshSystemStatusLogs: vi.fn(),
    sideNavOpen: ref(false),
    syncNavigationStateFromRoute: vi.fn(syncNavigationStateFromRoute),
    switchView: vi.fn(),
    viewTitle,
    visibleDebugTabs,
    visibleKnowledgeTabs,
  };
});

const featureAccessMock = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    activeConsoleFeatureIds: ref(["knowledge-core", "agent-management"]),
    hasAnyFeature: vi.fn(() => true),
    hasFeature: vi.fn(() => true),
    isAdminViewEnabled: vi.fn(() => true),
    visibleDebugTabs: ref([{ id: "knowledgeRecall", label: "知识召回" }]),
    visibleKnowledgeTabs: ref([{ id: "management", label: "知识归档" }]),
  };
});

const externalServicesViewMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const agentSelectorMock = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    agentSelectorOptions: ref([{ label: "模型 A", value: "model-a", selectable: true }]),
    cacheAgentModelOptionLabels: vi.fn(),
    currentAgentModelOptionLabel: ref("模型 A"),
    hasAgentModelOption: vi.fn(() => true),
    inactiveAgentModelOption: ref(null),
    normalizeAgentSelectorOption: vi.fn((option) => option),
    selectedAgentExploreModel: ref("model-a"),
    selectedAgentFromOptions: ref("model-a"),
    validAgentModelAlias: vi.fn(() => true),
    agentExploreAgentOptions: ref([]),
    agentModelOptionValueSet: ref(new Set()),
    agentOptionsForModule: vi.fn(() => []),
    agentModelOptionLabelCache: ref({}),
  };
});

const knowledgeLogMock = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    filteredKnowledgeLogRows: ref([] as any[]),
    syncKnowledgeLogTableScrollLeft: vi.fn(),
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      currentRoute: {
        get value() {
          return routerState.route;
        },
      },
      push: routerState.push,
    })),
    useRoute: vi.fn(() => routerState.route),
  };
});

vi.mock("../../../server-web/composables/console-browser-effects", () => browserEffectsMock);
vi.mock("../../../server-web/composables/console-browser-state-utils", () => browserStateMock);
vi.mock("../../../server-web/composables/console-refresh-state-controller", () => ({
  createConsoleRefreshStateController: vi.fn((options: Record<string, any>) => {
    refreshStateMock.serverAvailableRef = options.serverAvailable;
    refreshStateMock.errorRef = options.error;
    const refreshState = vi.fn(async (options: Record<string, unknown> = {}) => {
      if (options && typeof options === "object") {
        refreshStateMock.serverAvailableRef.value = true;
        refreshStateMock.errorRef.value = "";
      }
      return undefined;
    });
    refreshStateMock.refreshState = refreshState;
    return {
      REFRESH_STATE_DELAY_MS: refreshStateMock.REFRESH_STATE_DELAY_MS,
      clearPendingRefreshState: refreshStateMock.clearPendingRefreshState,
      clearPendingRefreshStateTimer: refreshStateMock.clearPendingRefreshStateTimer,
      lastRefreshStateStartedAt: refreshStateMock.lastRefreshStateStartedAt,
      mergeRefreshStateOptions: refreshStateMock.mergeRefreshStateOptions,
      normalizeRefreshStateOptions: refreshStateMock.normalizeRefreshStateOptions,
      pendingRefreshStateOptions: refreshStateMock.pendingRefreshStateOptions,
      pendingRefreshStatePromise: refreshStateMock.pendingRefreshStatePromise,
      pendingRefreshStateResolve: refreshStateMock.pendingRefreshStateResolve,
      pendingRefreshStateTimer: refreshStateMock.pendingRefreshStateTimer,
      performRefreshState: refreshStateMock.performRefreshState,
      refreshState,
      scheduleDelayedRefreshState: refreshStateMock.scheduleDelayedRefreshState,
    };
  }),
}));
vi.mock("../../../server-web/composables/console-runtime-lifecycle-controller", () => ({
  createConsoleRuntimeLifecycleController: vi.fn(() => runtimeLifecycleMock),
}));
vi.mock("../../../server-web/composables/console-navigation-controller", () => ({
  createConsoleNavigationController: vi.fn(() => navigationMock),
}));
vi.mock("../../../server-web/composables/console-feature-access-controller", () => ({
  createConsoleFeatureAccessController: vi.fn(() => featureAccessMock),
}));
vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesViewMock.current),
}));
vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));
vi.mock("../../../server-web/composables/console-agent-selector-controller", () => ({
  createConsoleAgentSelectorController: vi.fn(() => agentSelectorMock),
}));
vi.mock("../../../server-web/composables/console-knowledge-log-controller", () => ({
  createConsoleKnowledgeLogController: vi.fn(() => knowledgeLogMock),
}));

const mountedExternalWrappers: Array<{ unmount: () => void }> = [];
const mountedConsoleWrappers: Array<{ unmount: () => void }> = [];
const mountedWorkspaceWrappers: Array<{ unmount: () => void }> = [];

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
  setup(props: Record<string, unknown>, context: { slots: { default?: () => any }; emit: (event: "close" | "verify") => void }) {
    if (!props.open) return () => null;
    return () =>
      h("section", { class: "mock-config-floating-panel" }, [
        h("header", { class: "mock-config-floating-header" }, [
          h("h3", String(props.title || "")),
          props.subtitle ? h("p", String(props.subtitle)) : null,
          h("button", { class: "mock-config-verify-button", onClick: () => context.emit("verify"), disabled: !!props.verifying }, props.verifying ? "校验中" : "校验配置"),
          h("button", { class: "mock-config-close-button", onClick: () => context.emit("close") }, "关闭"),
        ]),
        h("div", { class: "mock-config-floating-content" }, [
          h("div", { class: "mock-status", "data-tone": String(props.statusTone || ""), "data-label": String(props.statusLabel || "") }),
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
  props: ["tone", "label"],
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
  source: string;
  sourceLabel: string;
  filePath: string;
  requiredOperations: string[];
  scriptCount: number;
  validationStatus: "valid" | "invalid";
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  externalMcp?: { tools: Array<string | { name?: string; toolId?: string; id?: string }> };
  upstreamTargetLabelText: string;
  upstreamTargetDetailText: string;
  sourceLabelText: string;
  discoveryLabelText: string;
  discoveryTone: string;
  discoveryRegistrationLabelText: string;
  discoveryRegistrationTone: string;
  heartbeatText: string;
  heartbeatRefreshing: boolean;
};

function createService(override: Partial<ServiceFixture> = {}): ServiceFixture {
  const serviceId = override.serviceId || "service-id";
  const sourceLabel = override.sourceLabel || "本地配置";
  return {
    entryId: override.entryId || serviceId,
    serviceId,
    serviceName: override.serviceName || serviceId,
    displayName: override.displayName || serviceId,
    description: override.description || "",
    mode: override.mode || "connected",
    startupPolicy: override.startupPolicy || "external-only",
    source: override.source || "configured",
    sourceLabel,
    filePath: override.filePath || "/tmp/pact/external-services.json",
    requiredOperations: override.requiredOperations || ["knowledge.search"],
    scriptCount: override.scriptCount ?? 1,
    validationStatus: override.validationStatus || "valid",
    validation: override.validation || { ok: true, errors: [], warnings: [] },
    externalMcp: override.externalMcp || null,
    upstreamTargetLabelText: override.upstreamTargetLabelText || "127.0.0.1:8787",
    upstreamTargetDetailText: override.upstreamTargetDetailText || "endpoint",
    sourceLabelText: override.sourceLabelText || `${sourceLabel} / ${serviceId}`,
    discoveryLabelText: override.discoveryLabelText || "MCP 服务",
    discoveryTone: override.discoveryTone || "success",
    discoveryRegistrationLabelText: override.discoveryRegistrationLabelText || "工具已发现",
    discoveryRegistrationTone: override.discoveryRegistrationTone || "success",
    heartbeatText: override.heartbeatText || "Latest: -",
    heartbeatRefreshing: override.heartbeatRefreshing || false,
  };
}

function createExternalServicesController(overrides: Record<string, unknown> = {}) {
  const services = (overrides.services as ServiceFixture[] | undefined) || [
    createService({
      serviceId: "mcp-main",
      displayName: "MCP 主服务",
      externalMcp: { tools: ["search", { name: "status" }, { toolId: "file.list" }] },
    }),
  ];

  return {
    configuredCount: (overrides.configuredCount as number) ?? services.filter((service) => service.source === "configured").length,
    presetCount: (overrides.presetCount as number) ?? services.filter((service) => service.source === "preset").length,
    validServiceCount: (overrides.validServiceCount as number) ?? services.filter((service) => service.validationStatus === "valid").length,
    discoveredServiceCount: (overrides.discoveredServiceCount as number) ?? services.length,
    mcpToolCount: (overrides.mcpToolCount as number) ?? services.reduce((total, service) => total + (service.externalMcp?.tools?.length || 0), 0),
    configEditorOpen: overrides.configEditorOpen ?? false,
    configEditorMode: overrides.configEditorMode || "add",
    configEditorTitle: overrides.configEditorTitle || "添加服务",
    configEditorSubtitle: overrides.configEditorSubtitle || "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configStatusTone: overrides.configStatusTone || "success",
    configStatusLabel: overrides.configStatusLabel || "Valid",
    loadError: overrides.loadError || "",
    actionError: overrides.actionError || "",
    actionMessage: overrides.actionMessage || "",
    discoveryCacheUpdatedAtLabel: overrides.discoveryCacheUpdatedAtLabel || "2026-06-04 11:30",
    configText: overrides.configText || "{\n  \"serviceId\": \"\"\n}",
    configDraft: overrides.configDraft || {
      serviceId: "",
      serviceName: "",
      mode: "connected",
      startupPolicy: "external-only",
      description: "",
      scripts: {},
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "",
        timeoutMs: null,
        metadata: {},
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub",
        requiredScopes: ["knowledge:read"],
        risk: "read_only",
        metadata: {},
      },
      healthCheck: {
        type: "none",
        url: "",
        host: "127.0.0.1",
        port: null,
        path: "/",
        timeoutMs: 60000,
        required: false,
      },
      metadata: {},
    },
    requiredScopesText: overrides.requiredScopesText || "knowledge:read",
    validationErrors: overrides.validationErrors || [],
    validationWarnings: overrides.validationWarnings || [],
    loading: overrides.loading || false,
    saving: overrides.saving || false,
    verifying: overrides.verifying || false,
    dirty: overrides.dirty || false,
    services,
    modeOptions: [{ value: "connected", label: "connected" }],
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTypeOptions: [
      { value: "mcp", label: "MCP 服务" },
      { value: "llm", label: "LLM Service" },
      { value: "cloud-drive", label: "Cloud Drive Service" },
      { value: "http", label: "HTTP / HTTPS 服务" },
      { value: "other", label: "其它服务" },
    ],
    mcpTransportOptions: [{ value: "streamable-http", label: "streamable-http" }],
    modelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
    modelProtocolSelectValue: overrides.modelProtocolSelectValue || "openai-compatible",
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    riskOptions: [{ value: "read_only", label: "read_only" }],
    isCloudDriveServiceDraft: overrides.isCloudDriveServiceDraft || false,
    isLlmServiceDraft: overrides.isLlmServiceDraft || false,
    showCustomUpstreamType: overrides.showCustomUpstreamType || false,
    upstreamTypeSelectValue: overrides.upstreamTypeSelectValue || "mcp",
    customUpstreamTypeValue: overrides.customUpstreamTypeValue || "",
    activeConfigSummary: overrides.activeConfigSummary || {},
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    closeConfigEditor: vi.fn(),
    refreshExternalServices: vi.fn().mockResolvedValue(undefined),
    verifyConfig: vi.fn().mockResolvedValue(undefined),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    refreshRuntime: vi.fn().mockResolvedValue(undefined),
    updateRootField: vi.fn(),
    updateUpstreamTypeSelection: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateModelProvider: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCloudDriveMode: vi.fn(),
    updateBindingField: vi.fn(),
    updateRequiredScopes: vi.fn(),
    updateUpstreamField: vi.fn(),
    updateHealthCheckField: vi.fn(),
    updateHealthCheckRequired: vi.fn(),
    onConfigInput: vi.fn(),
    serviceSourceDetail: (service: ServiceFixture) => service.sourceLabelText,
    upstreamTargetLabel: (service: ServiceFixture) => service.upstreamTargetLabelText,
    upstreamTargetDetailLabel: (service: ServiceFixture) => service.upstreamTargetDetailText,
    serviceDiscoveryLabel: (service: ServiceFixture) => service.discoveryLabelText,
    serviceDiscoveryTone: (service: ServiceFixture) => service.discoveryTone,
    serviceDiscoveryRegistrationLabel: (service: ServiceFixture) => service.discoveryRegistrationLabelText,
    serviceDiscoveryRegistrationTone: (service: ServiceFixture) => service.discoveryRegistrationTone,
    serviceHeartbeatLastAtLabel: (service: ServiceFixture) => service.heartbeatText,
    isServiceHeartbeatRefreshing: (service: ServiceFixture) => service.heartbeatRefreshing,
  };
}

function mountExternalServicesView(overrides: Record<string, unknown> = {}) {
  const controller = createExternalServicesController(overrides);
  externalServicesViewMock.current = controller;
  const wrapper = mount(ExternalServicesView, {
    global: {
      stubs: {
        ConfigFloatingPanel: ConfigFloatingPanelMock,
        HelpTooltip: HelpTooltipMock,
        StatusPill: StatusPillMock,
        BinaryCheckbox: BinaryCheckboxMock,
      },
    },
  });
  mountedExternalWrappers.push(wrapper as any);
  return { wrapper, controller };
}

function readMaybeRef<T>(value: T | any, fallback: T): T {
  if (value && typeof value === "object" && "value" in value) {
    return value.value;
  }
  return value ?? fallback;
}

type WorkspaceContextMock = {
  selected: any;
  busyKey: any;
  panel: any;
  cloudDriveData: any;
  cloudDriveResult: any;
  cloudDriveForm: {
    provider: string;
    rootPath: string;
    driveRef: string;
    clientId: string;
    managedFolderRoot: string;
    publicFolder: string;
    allowedClients: string;
    advancedMode: boolean;
    exposedDirectories: CloudDriveExposureForm[];
    path: string;
    uploadPath: string;
    uploadContent: string;
    targetPath: string;
  };
  cloudDriveConnectionOptions: any;
  addCloudDriveExposure: ReturnType<typeof vi.fn>;
  applyCloudDriveSync: ReturnType<typeof vi.fn>;
  connectCloudDrive: ReturnType<typeof vi.fn>;
  downloadCloudDriveFile: ReturnType<typeof vi.fn>;
  listCloudDriveItems: ReturnType<typeof vi.fn>;
  listCloudDrivePermissions: ReturnType<typeof vi.fn>;
  planCloudDriveSync: ReturnType<typeof vi.fn>;
  removeCloudDriveExposure: ReturnType<typeof vi.fn>;
  uploadCloudDriveFile: ReturnType<typeof vi.fn>;
};

const workspacesViewContextMock = vi.hoisted(() => ({
  current: null as WorkspaceContextMock | null,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: () => {
    if (!workspacesViewContextMock.current) {
      throw new Error("workspaces view context mock is not initialized");
    }
    return workspacesViewContextMock.current;
  },
}));

function makeWorkspaceContext(overrides: Record<string, unknown> = {}) {
  const selected = ref(readMaybeRef(overrides.selected, { title: "主工作区" }));
  const busyKey = ref(readMaybeRef(overrides.busyKey, ""));
  const panel = ref(readMaybeRef(overrides.panel, "cloudDrive"));
  const cloudDriveData = ref(readMaybeRef(overrides.cloudDriveData, null));
  const cloudDriveResult = ref(readMaybeRef(overrides.cloudDriveResult, null));
  const cloudDriveForm = reactive({
    provider: (overrides.cloudDriveForm as any)?.provider ?? "onedrive",
    rootPath: (overrides.cloudDriveForm as any)?.rootPath ?? "",
    driveRef: (overrides.cloudDriveForm as any)?.driveRef ?? "",
    clientId: (overrides.cloudDriveForm as any)?.clientId ?? "owner",
    managedFolderRoot: (overrides.cloudDriveForm as any)?.managedFolderRoot ?? ".pact-data",
    publicFolder: (overrides.cloudDriveForm as any)?.publicFolder ?? "public",
    allowedClients: (overrides.cloudDriveForm as any)?.allowedClients ?? "owner, codex",
    advancedMode: (overrides.cloudDriveForm as any)?.advancedMode ?? false,
    exposedDirectories: ((overrides.cloudDriveForm as any)?.exposedDirectories ?? []) as CloudDriveExposureForm[],
    path: (overrides.cloudDriveForm as any)?.path ?? "",
    uploadPath: (overrides.cloudDriveForm as any)?.uploadPath ?? "",
    uploadContent: (overrides.cloudDriveForm as any)?.uploadContent ?? "Pact cloud drive console upload\n",
    targetPath: (overrides.cloudDriveForm as any)?.targetPath ?? "cloud-drive",
  });
  const cloudDriveConnectionOptions = computed(() => {
    const connections = Array.isArray(cloudDriveData.value?.connections) ? cloudDriveData.value.connections : [];
    return connections.map((drive: any) => ({
      value: String(drive.driveRef || ""),
      label: `${drive.label || drive.provider} · ${String(drive.driveRef || "").slice(0, 18)}`,
    }));
  });

  const addCloudDriveExposure = vi.fn();
  const removeCloudDriveExposure = vi.fn((index: number) => {
    cloudDriveForm.exposedDirectories.splice(index, 1);
  });
  const connectCloudDrive = vi.fn(async () => {
    cloudDriveResult.value = { action: "connect" };
  });
  const listCloudDriveItems = vi.fn(async () => {
    cloudDriveResult.value = { action: "list" };
  });
  const downloadCloudDriveFile = vi.fn(async () => {
    cloudDriveResult.value = { action: "download" };
  });
  const uploadCloudDriveFile = vi.fn(async () => {
    cloudDriveResult.value = { action: "upload" };
  });
  const planCloudDriveSync = vi.fn(async () => {
    cloudDriveResult.value = { action: "plan" };
  });
  const applyCloudDriveSync = vi.fn(async () => {
    cloudDriveResult.value = { action: "apply" };
  });
  const listCloudDrivePermissions = vi.fn(async () => {
    cloudDriveResult.value = { action: "permissions" };
  });

  const context: WorkspaceContextMock = {
    selected,
    busyKey,
    panel,
    cloudDriveData,
    cloudDriveResult,
    cloudDriveForm,
    cloudDriveConnectionOptions,
    addCloudDriveExposure,
    applyCloudDriveSync,
    connectCloudDrive,
    downloadCloudDriveFile,
    listCloudDriveItems,
    listCloudDrivePermissions,
    planCloudDriveSync,
    removeCloudDriveExposure,
    uploadCloudDriveFile,
  };

  return { context, refs: { selected, busyKey, panel, cloudDriveData, cloudDriveResult } };
}

function mountWorkspaceCloudDrivePanel(overrides: Record<string, unknown> = {}) {
  const { context, refs } = makeWorkspaceContext(overrides);
  workspacesViewContextMock.current = context;
  const wrapper = mount(WorkspaceCloudDrivePanel, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxMock,
        OptionBar: {
          name: "OptionBar",
          props: ["modelValue", "label", "disabled", "options"],
          emits: ["update:modelValue", "update:model-value", "change"],
          setup(props: Record<string, unknown>, { emit }) {
            return () =>
              h("label", { class: "mock-option-bar" }, [
                props.label ? h("span", { class: "mock-option-bar-label" }, String(props.label)) : null,
                h(
                  "select",
                  {
                    class: "mock-option-bar-select",
                    disabled: props.disabled,
                    value: String(props.modelValue ?? ""),
                    onChange: (event: Event) => {
                      const value = (event.target as HTMLSelectElement).value;
                      emit("update:modelValue", value);
                      emit("update:model-value", value);
                      emit("change", value);
                    },
                  },
                  (props.options as Array<{ value: string | number | boolean; label: string; disabled?: boolean }>).map((option) =>
                    h("option", { value: String(option.value), disabled: !!option.disabled }, option.label),
                  ),
                ),
              ]);
          },
        },
        StatusPill: {
          name: "StatusPill",
          props: ["tone", "label"],
          setup(props: Record<string, unknown>) {
            return () => h("span", { class: "mock-status-pill", "data-tone": String(props.tone || "") }, String(props.label || ""));
          },
        },
      },
    },
  });
  mountedWorkspaceWrappers.push(wrapper as any);
  return { wrapper, context, refs };
}

function mountConsoleHarness(route: any) {
  routerState.route = route;
  const shell = defineComponent({
    setup: () => useConsole(),
    template: "<div />",
  });
  const wrapper = mount(shell);
  mountedConsoleWrappers.push(wrapper as any);
  return wrapper;
}

beforeEach(() => {
  routerState.route = null;
  routerState.push.mockReset();
  browserEffectsMock.notifyConsoleAction.mockReset();
  browserEffectsMock.confirmConsoleAction.mockReset();
  browserEffectsMock.copyTextToClipboard.mockReset();
  browserEffectsMock.downloadTextFile.mockReset();
  browserEffectsMock.createConsoleTargetHighlightController.mockClear();
  browserStateMock.clearBrowserLocalStateFromUrlCore.mockReset();
  browserStateMock.clearBrowserCacheStorage.mockReset();
  browserStateMock.clearIndexedDbDatabases.mockReset();
  browserStateMock.unregisterServiceWorkers.mockReset();
  runtimeLifecycleMock.mountConsoleRuntime.mockReset();
  runtimeLifecycleMock.unmountConsoleRuntime.mockReset();
  refreshStateMock.refreshState.mockReset();
  refreshStateMock.serverAvailable.value = false;
  refreshStateMock.error.value = "";
  navigationMock.syncNavigationStateFromRoute.mockClear();
  navigationMock.currentView.value = "dashboard";
  navigationMock.adminView.value = "jobs";
  navigationMock.debugTab.value = "knowledgeRecall";
  navigationMock.externalServiceTab.value = "list";
  navigationMock.knowledgeTab.value = "management";
  navigationMock.knowledgeManagementPanel.value = "sources";
  navigationMock.viewTitle.value = "控制台";
  agentSelectorMock.cacheAgentModelOptionLabels.mockReset();
  knowledgeLogMock.syncKnowledgeLogTableScrollLeft.mockReset();
  workspacesViewContextMock.current = null;
  externalServicesViewMock.current = null;
});

afterEach(() => {
  while (mountedExternalWrappers.length) {
    mountedExternalWrappers.pop()?.unmount();
  }
  while (mountedConsoleWrappers.length) {
    mountedConsoleWrappers.pop()?.unmount();
  }
  while (mountedWorkspaceWrappers.length) {
    mountedWorkspaceWrappers.pop()?.unmount();
  }
  workspacesViewContextMock.current = null;
  externalServicesViewMock.current = null;
});

describe("router and view gaps", () => {
  it("keeps redirect records and lazy-loaded view modules in place", async () => {
    const routeByPath = (path: string) => router.getRoutes().find((route) => route.path === path);

    expect(routeByPath("/external-services")?.redirect).toBe("/external-services/list");
    expect(routeByPath("/knowledge")?.redirect).toBe("/knowledge/management");
    expect(routeByPath("/debug")?.redirect).toBe("/debug/knowledgeRecall");
    expect(routeByPath("/admin")?.redirect).toBe("/admin/storage");
    expect(routeByPath("/:pathMatch(.*)*")?.redirect).toBe("/");

    const externalServicesRoute = routeByPath("/external-services/:tab")!;
    const knowledgeRoute = routeByPath("/knowledge/:tab")!;
    const debugRoute = routeByPath("/debug/:tab")!;

    const externalServicesLoader = externalServicesRoute.components?.default ?? externalServicesRoute.component;
    const knowledgeLoader = knowledgeRoute.components?.default ?? knowledgeRoute.component;
    const debugLoader = debugRoute.components?.default ?? debugRoute.component;

    expect(typeof externalServicesLoader).toBe("function");
    expect(typeof knowledgeLoader).toBe("function");
    expect(typeof debugLoader).toBe("function");

    const [externalServicesModule, knowledgeModule, debugModule] = await Promise.all([
      (externalServicesLoader as () => Promise<Record<string, unknown>>)(),
      (knowledgeLoader as () => Promise<Record<string, unknown>>)(),
      (debugLoader as () => Promise<Record<string, unknown>>)(),
    ]);

    expect(externalServicesModule.default).toBeTruthy();
    expect(knowledgeModule.default).toBeTruthy();
    expect(debugModule.default).toBeTruthy();
  });

  it("syncs route-driven state, actions, refresh, and cleanup in useConsole", async () => {
    const route = makeRoute("/external-services/list", "externalServices", { tab: "list" });
    const wrapper = mountConsoleHarness(route);
    const vm: any = wrapper.vm;

    await flush();
    expect(runtimeLifecycleMock.mountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(vm.currentView).toBe("externalServices");
    expect(vm.externalServiceTab).toBe("list");
    expect(vm.viewTitle).toBe("外部服务");

    route.fullPath = "/debug/knowledgeRecall";
    route.meta = { viewId: "debug" };
    route.params = { tab: "knowledgeRecall" };
    await flush();
    expect(vm.currentView).toBe("debug");
    expect(vm.debugTab).toBe("knowledgeRecall");
    expect(vm.viewTitle).toBe("调试");

    route.fullPath = "/admin/tool-list";
    route.meta = { viewId: "admin", adminView: "toolList" };
    route.params = {};
    await flush();
    expect(vm.currentView).toBe("admin");
    expect(vm.adminView).toBe("toolList");

    await vm.refreshState({ silent: true, forceSettings: true });
    expect(refreshStateMock.refreshState).toHaveBeenCalledWith({ silent: true, forceSettings: true });
    expect(vm.serverAvailable).toBe(true);

    vm.importClients();
    vm.exportClients();
    expect(browserEffectsMock.notifyConsoleAction).toHaveBeenNthCalledWith(1, "导入客户端功能正在开发中…");
    expect(browserEffectsMock.notifyConsoleAction).toHaveBeenNthCalledWith(2, "导出客户端列表成功。");

    wrapper.unmount();
    expect(runtimeLifecycleMock.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
  });
});

describe("ExternalServicesView gaps", () => {
  it("keeps the empty state visible and closes popovers on scroll", async () => {
    const { wrapper } = mountExternalServicesView({
      services: [],
      loading: false,
    });

    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.find(".empty-state").text()).toContain("暂无外部服务");
    expect(wrapper.find(".external-service-tool-list-button").exists()).toBe(false);

    await wrapper.unmount();
  });

  it("updates scroll affordances and closes interactions when the table scrolls", async () => {
    const { wrapper } = mountExternalServicesView({
      services: [
        createService({
          serviceId: "scroll-service",
          displayName: "滚动服务",
          externalMcp: { tools: ["search", { name: "status" }] },
        }),
      ],
    });

    const scroller = wrapper.get(".external-service-table-scroll");
    const scrollerElement = scroller.element as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
      hasPointerCapture: (pointerId: number) => boolean;
      scrollLeft: number;
    };

    Object.defineProperty(scrollerElement, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(scrollerElement, "clientWidth", { configurable: true, value: 240 });
    Object.defineProperty(scrollerElement, "scrollLeft", { configurable: true, writable: true, value: 0 });
    scrollerElement.setPointerCapture = vi.fn();
    scrollerElement.releasePointerCapture = vi.fn();
    scrollerElement.hasPointerCapture = vi.fn(() => true);

    await flush();
    expect(scroller.classes()).toContain("has-horizontal-overflow");
    expect(scroller.classes()).toContain("has-right-overflow");
    expect(scroller.classes()).not.toContain("has-left-overflow");

    const toolButton = wrapper.get(".external-service-tool-list-button");
    await toolButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    scrollerElement.scrollLeft = 120;
    scrollerElement.dispatchEvent(new Event("scroll", { bubbles: true }));
    await flush();

    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
    expect(scroller.classes()).toContain("has-left-overflow");

    await toolButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await flush();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });
});

describe("WorkspaceCloudDrivePanel gaps", () => {
  it("renders busy permissions state and empty-directory branch together", async () => {
    const { wrapper, context } = mountWorkspaceCloudDrivePanel({
      selected: ref({ title: "云盘工作区" }),
      busyKey: ref("ws:drive-permissions"),
      cloudDriveData: ref(null),
      cloudDriveForm: {
        provider: "onedrive",
        advancedMode: true,
        exposedDirectories: [],
        path: "",
        uploadPath: "",
      } as Partial<WorkspaceContextMock["cloudDriveForm"]> as WorkspaceContextMock["cloudDriveForm"],
    });

    expect(wrapper.text()).toContain("云盘 — 云盘工作区");
    expect(wrapper.text()).toContain("暂无目录。");
    const permissionsButton = wrapper.findAll("button").find((button) => button.text() === "权限" || button.text() === "读取中…");
    expect(permissionsButton?.text()).toBe("读取中…");
    expect(permissionsButton?.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).not.toContain("已连接云盘");

    context.busyKey.value = "";
    await flush();
    expect(permissionsButton?.text()).toBe("权限");

    await permissionsButton!.trigger("click");
    expect(context.listCloudDrivePermissions).toHaveBeenCalledTimes(1);
  });
});
