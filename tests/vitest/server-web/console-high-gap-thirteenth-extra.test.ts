// @vitest-environment jsdom
import { defineComponent, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../../server-web/router";
import { useConsole } from "../../../server-web/composables/useConsole";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";

function makeRef<T>(value: T) {
  return { value, __v_isRef: true } as { value: T; __v_isRef: true };
}

const mockNotify = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
  copyConsoleTextWithFeedback: vi.fn(),
  copyTextToClipboard: vi.fn(),
  downloadTextFile: vi.fn(),
  notifyConsoleAction: vi.fn(),
}));

const mockBrowserState = vi.hoisted(() => ({
  clearBrowserLocalStateFromUrlCore: vi.fn(() => Promise.resolve()),
  clearBrowserCacheStorage: vi.fn(),
  clearIndexedDbDatabases: vi.fn(),
  unregisterServiceWorkers: vi.fn(),
}));

const routerState = vi.hoisted(() => ({
  route: null as any,
  push: vi.fn(),
}));

const targetHighlightController = vi.hoisted(() => ({
  configTargetElement: vi.fn(() => null),
  scrollToConfigTarget: vi.fn(() => Promise.resolve()),
  clearConfigTargetHighlight: vi.fn(),
}));

const mockFeatureFlags = vi.hoisted(() => ({
  knowledgeCore: true,
  maintenanceAgentRunbooks: true,
  agentGateway: true,
  agentManagement: true,
}));

const mockRuntimeLifecycle = vi.hoisted(() => ({
  mountConsoleRuntime: vi.fn(),
  unmountConsoleRuntime: vi.fn(),
}));

const mockKnowledgeIngest = vi.hoisted(() => ({
  uploadFilesToKnowledge: vi.fn(),
}));

const mockModelLibrary = vi.hoisted(() => ({
  hasOpenAiModelUsage: vi.fn(() => false),
}));

const mockCodexOAuth = vi.hoisted(() => ({
  ensureCodexOAuthReady: vi.fn(),
}));

const mockSettingsPersistenceController = vi.hoisted(() => ({
  agentPermissionGroupsCalls: 0,
  saveAgentPermissionSettings: vi.fn(),
}));

const mockNavigationController = vi.hoisted(() => ({
  params: null as null | Record<string, unknown>,
}));

const mockServerEventController = vi.hoisted(() => ({
  startServerEventSubscription: vi.fn(),
  stopServerEventSubscription: vi.fn(),
}));

const externalServicesControllerMock = vi.hoisted(() => ({
  current: null as any,
}));

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

function makeRoute(fullPath: string, viewId: string, tab = "") {
  return reactive({
    fullPath,
    path: fullPath,
    meta: { viewId },
    params: tab ? { tab } : {},
  }) as any;
}

function createUseConsoleHarness() {
  const shell = defineComponent({
    setup: () => useConsole(),
    template: "<div />",
  });
  return mount(shell);
}

type ExternalServiceFixture = {
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

function createService(overrides: Partial<ExternalServiceFixture> = {}): ExternalServiceFixture {
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
  const services = (overrides.services as ExternalServiceFixture[] | undefined) || [
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
    serviceDiscoveryLabel: vi.fn((service: ExternalServiceFixture) => service.discoveryLabelText),
    serviceDiscoveryRegistrationLabel: vi.fn((service: ExternalServiceFixture) => service.discoveryRegistrationLabelText),
    serviceDiscoveryRegistrationTone: vi.fn((service: ExternalServiceFixture) => service.discoveryRegistrationTone),
    serviceDiscoveryTone: vi.fn((service: ExternalServiceFixture) => service.discoveryTone),
    serviceHeartbeatLastAtLabel: vi.fn((service: ExternalServiceFixture) => service.heartbeatText),
    serviceSourceDetail: vi.fn((service: ExternalServiceFixture) => service.sourceLabelText),
    services,
    showCustomUpstreamType: false,
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    stream: false,
    trigger: false,
    upstreamTargetDetailLabel: vi.fn((service: ExternalServiceFixture) => service.upstreamTargetDetailText),
    upstreamTargetLabel: vi.fn((service: ExternalServiceFixture) => service.upstreamTargetLabelText),
    validServiceCount: services.length,
    verifyConfig: vi.fn(),
    ...overrides,
  };
}

function mountExternalServicesView(overrides: Record<string, unknown> = {}) {
  externalServicesControllerMock.current = createExternalServicesController(overrides);
  return mount(ExternalServicesView, {
    global: {
      stubs: {
        BinaryCheckbox: true,
        ConfigFloatingPanel: true,
        HelpTooltip: true,
        StatusPill: true,
      },
    },
  });
}

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof import("vue-router")>("vue-router");
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

vi.mock("../../../server-web/composables/console-browser-state-utils", () => ({
  CLEAR_LOCAL_STATE_PARAM: "clearLocalState",
  clearBrowserCacheStorage: mockBrowserState.clearBrowserCacheStorage,
  clearBrowserLocalStateFromUrl: mockBrowserState.clearBrowserLocalStateFromUrlCore,
  clearIndexedDbDatabases: mockBrowserState.clearIndexedDbDatabases,
  unregisterServiceWorkers: mockBrowserState.unregisterServiceWorkers,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: mockNotify.confirmConsoleAction,
  copyConsoleTextWithFeedback: mockNotify.copyConsoleTextWithFeedback,
  copyTextToClipboard: mockNotify.copyTextToClipboard,
  createConsoleTargetHighlightController: vi.fn(() => targetHighlightController),
  downloadTextFile: mockNotify.downloadTextFile,
  notifyConsoleAction: mockNotify.notifyConsoleAction,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesControllerMock.current),
}));

vi.mock("../../../server-web/composables/console-agent-explore-utils", () => ({
  isAgentExploreDraftSession: vi.fn(() => false),
}));

vi.mock("../../../server-web/composables/console-agent-selection-reference-controller", () => ({
  AGENT_SELECTION_REFERENCE_LOG_LIMIT: 20,
  createConsoleAgentSelectionReferenceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-selector-controller", () => ({
  createConsoleAgentSelectorController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-auth-controller", () => ({
  createConsoleAuthController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-busy-controller", () => ({
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

vi.mock("../../../server-web/composables/console-codex-oauth-controller", () => ({
  createConsoleCodexOAuthController: vi.fn(() =>
    createLooseController({
      beginCodexOAuthLogin: vi.fn(),
      codexOAuthLogin: vi.fn(),
      codexOAuthPollTimer: ref(0),
      codexOAuthStatus: ref("idle"),
      ensureCodexOAuthReady: mockCodexOAuth.ensureCodexOAuthReady,
      refreshCodexOAuthStatus: vi.fn(),
      startCodexOAuthPolling: vi.fn(),
      stopCodexOAuthPolling: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-client-controller", () => ({
  createConsoleClientController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-layout-controller", () => ({
  createConsoleAgentExploreLayoutController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-output-controller", () => ({
  createConsoleAgentExploreOutputController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-session-controller", () => ({
  createConsoleAgentExploreSessionController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-state-controller", () => ({
  createConsoleAgentExploreStateController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-context-compiler-controller", () => ({
  createConsoleContextCompilerController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-discovery-controller", () => ({
  createConsoleDiscoveryController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-expert-rules-controller", () => ({
  createConsoleExpertRulesController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-feature-access-controller", () => ({
  createConsoleFeatureAccessController: vi.fn(() =>
    createLooseController({
      activeConsoleFeatureIds: ref(["knowledge-core", "agent-management", "agent-gateway", "maintenance-agent-runbooks"]),
      hasAnyFeature: vi.fn(() => true),
      hasFeature: vi.fn((featureId: string) => {
        if (featureId === "knowledge-core") {
          return mockFeatureFlags.knowledgeCore;
        }
        if (featureId === "maintenance-agent-runbooks") {
          return mockFeatureFlags.maintenanceAgentRunbooks;
        }
        if (featureId === "agent-gateway") {
          return mockFeatureFlags.agentGateway;
        }
        if (featureId === "agent-management") {
          return mockFeatureFlags.agentManagement;
        }
        return true;
      }),
      isAdminViewEnabled: vi.fn(() => true),
      visibleDebugTabs: ref([{ id: "knowledgeRecall", label: "知识召回" }]),
      visibleKnowledgeTabs: ref([{ id: "management", label: "知识归档" }, { id: "wordCloud", label: "词云" }]),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-knowledge-source-controller", () => ({
  createConsoleKnowledgeSourceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-search-state-controller", () => ({
  createConsoleKnowledgeSearchPanelStateController: vi.fn(() => createLooseController()),
  createConsoleKnowledgeSearchStateController: vi.fn(() =>
    createLooseController({
      knowledgeSearchForm: ref({ query: "" }),
      knowledgeSearchResponse: ref(null),
      knowledgeSearchResults: ref([]),
      lastKnowledgeSearchQuery: ref(""),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-runtime-mount-controller", () => ({
  createConsoleRuntimeMountController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-dashboard-alert-controller", () => ({
  createConsoleDashboardAlertController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-info-feed-controller", () => ({
  createConsoleInfoFeedController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-evidence-controller", () => ({
  createConsoleKnowledgeEvidenceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-ingest-controller", () => ({
  createConsoleKnowledgeIngestController: vi.fn(() => createLooseController(mockKnowledgeIngest)),
}));

vi.mock("../../../server-web/composables/console-job-controller", () => ({
  createConsoleJobController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-log-controller", () => ({
  createConsoleKnowledgeLogController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-maintenance-controller", () => ({
  createConsoleKnowledgeMaintenanceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-recall-controller", () => ({
  createConsoleKnowledgeRecallController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-review-controller", () => ({
  createConsoleKnowledgeReviewController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-maintenance-agent-controller", () => ({
  createConsoleMaintenanceAgentController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-mcp-authorization-controller", () => ({
  createConsoleMcpAuthorizationController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-model-library-controller", () => ({
  createConsoleModelLibraryController: vi.fn(() => createLooseController(mockModelLibrary)),
}));

vi.mock("../../../server-web/composables/console-navigation-controller", () => ({
  createConsoleNavigationController: vi.fn(() => {
    const adminView = ref("jobs");
    const currentView = ref("dashboard");
    const debugTab = ref("knowledgeRecall");
    const drawerOpen = ref(false);
    const drawerTab = ref("tools");
    const externalServiceTab = ref("list");
    const knowledgeManagementPanel = ref("sources");
    const knowledgeTab = ref("management");
    const sideNavOpen = ref(false);
    const viewTitle = ref("控制台");
    const visibleDebugTabs = ref([{ id: "knowledgeRecall", label: "知识召回" }]);
    const visibleKnowledgeTabs = ref([{ id: "management", label: "知识归档" }]);

    function syncNavigationStateFromRoute(route: { meta?: { viewId?: string }; params?: Record<string, string> } = {}) {
      const viewId = route.meta?.viewId || "dashboard";
      currentView.value = viewId === "knowledge" || viewId === "admin" || viewId === "debug" ? viewId : "dashboard";
      if (viewId === "knowledge") {
        knowledgeTab.value = route.params?.tab || "management";
        viewTitle.value = "知识库";
      } else if (viewId === "admin") {
        adminView.value = route.params?.tab || "jobs";
        viewTitle.value = "管理员";
      } else if (viewId === "debug") {
        debugTab.value = route.params?.tab || "knowledgeRecall";
        viewTitle.value = "调试";
      } else {
        knowledgeTab.value = "management";
        debugTab.value = "knowledgeRecall";
        adminView.value = "jobs";
        viewTitle.value = "控制台";
      }
    }

    return createLooseController({
      adminView,
      bindNavigationRouter: vi.fn(),
      closeDrawer: vi.fn(),
      closeSideNavOverlay: vi.fn(),
      currentView,
      debugTab,
      drawerOpen,
      drawerTab,
      ensureKnowledgeTabState: vi.fn(),
      externalServiceTab,
      isKnownDebugRouteTab: vi.fn(() => true),
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
      sideNavOpen,
      syncNavigationStateFromRoute: vi.fn(syncNavigationStateFromRoute),
      switchView: vi.fn(),
      viewTitle,
      visibleDebugTabs,
      visibleKnowledgeTabs,
    });
  }),
}));

vi.mock("../../../server-web/composables/console-option-bar-controller", () => ({
  createConsoleOptionBarController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-ops-monitor-controller", () => ({
  createConsoleOpsMonitorController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-rule-authoring-controller", () => ({
  createConsoleRuleAuthoringController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-refresh-state-controller", () => ({
  createConsoleRefreshStateController: vi.fn(() =>
    createLooseController({
      clearPendingRefreshState: vi.fn(),
      clearPendingRefreshStateTimer: vi.fn(),
      lastRefreshStateStartedAt: ref(0),
      mergeRefreshStateOptions: vi.fn((options: any) => options),
      normalizeRefreshStateOptions: vi.fn((options: any) => options),
      pendingRefreshStateOptions: ref({}),
      pendingRefreshStatePromise: ref(Promise.resolve(undefined)),
      pendingRefreshStateResolve: vi.fn(),
      pendingRefreshStateTimer: ref(null),
      performRefreshState: vi.fn(),
      refreshState: vi.fn(async () => undefined),
      scheduleDelayedRefreshState: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-runtime-lifecycle-controller", () => ({
  createConsoleRuntimeLifecycleController: vi.fn((deps) => ({
    mountConsoleRuntime: () => {
      mockRuntimeLifecycle.mountConsoleRuntime();
      void deps.clearBrowserLocalStateFromUrl().catch(() => {});
      deps.startServerEventSubscription();
    },
    unmountConsoleRuntime: () => {
      mockRuntimeLifecycle.unmountConsoleRuntime();
      deps.stopServerEventSubscription();
    },
  })),
}));

vi.mock("../../../server-web/composables/console-server-event-controller", () => ({
  createConsoleServerEventController: vi.fn(() => createLooseController(mockServerEventController)),
}));

vi.mock("../../../server-web/composables/console-settings-bridge-controller", () => ({
  createConsoleSettingsBridgeController: vi.fn(() =>
    createLooseController({
      applyingRemoteConsoleDrafts: ref(false),
      bindSettingsDraftActions: vi.fn(),
      bindSettingsPersistenceActions: vi.fn(),
      saveSettings: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-settings-draft-controller", () => ({
  createConsoleSettingsDraftController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-settings-persistence-controller", () => ({
  createConsoleSettingsPersistenceController: vi.fn(() => createLooseController({
    agentPermissionGroups: () => [],
    clearAllBusy: vi.fn(),
    ensureCodexOAuthReady: mockCodexOAuth.ensureCodexOAuthReady,
    error: ref(""),
    hasOpenAiModelUsage: mockModelLibrary.hasOpenAiModelUsage,
    modelEntryStatusKey: vi.fn(),
    mountDraft: ref({}),
    mountDraftDirty: ref(false),
    probeModelLibraryBeforeSave: vi.fn(),
    refreshState: vi.fn(),
    replaceSettingsDraftFromServer: vi.fn(),
    setBusy: vi.fn(),
    settingsDraft: ref({}),
    settingsDraftDirty: ref(false),
    settingsPayloadForSave: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-state-event-reducer-controller", () => ({
  createConsoleStateEventReducerController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-system-log-row-controller", () => ({
  createConsoleSystemLogRowController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-tool-management-controller", () => ({
  createConsoleToolManagementController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-word-cloud-controller", () => ({
  createConsoleWordCloudController: vi.fn(() => createLooseController()),
}));

beforeEach(() => {
  routerState.route = makeRoute("/dashboard", "dashboard");
  routerState.push.mockReset();
  externalServicesControllerMock.current = null;

  mockNotify.confirmConsoleAction.mockReset();
  mockNotify.copyConsoleTextWithFeedback.mockReset();
  mockNotify.copyTextToClipboard.mockReset();
  mockNotify.downloadTextFile.mockReset();
  mockNotify.notifyConsoleAction.mockReset();

  mockBrowserState.clearBrowserLocalStateFromUrlCore.mockReset();
  mockBrowserState.clearBrowserLocalStateFromUrlCore.mockResolvedValue(undefined);
  mockBrowserState.clearBrowserCacheStorage.mockReset();
  mockBrowserState.clearIndexedDbDatabases.mockReset();
  mockBrowserState.unregisterServiceWorkers.mockReset();

  mockRuntimeLifecycle.mountConsoleRuntime.mockReset();
  mockRuntimeLifecycle.unmountConsoleRuntime.mockReset();

  mockKnowledgeIngest.uploadFilesToKnowledge.mockReset();
  mockModelLibrary.hasOpenAiModelUsage.mockReset();
  mockModelLibrary.hasOpenAiModelUsage.mockReturnValue(false);
  mockCodexOAuth.ensureCodexOAuthReady.mockReset();
  mockSettingsPersistenceController.agentPermissionGroupsCalls = 0;
  mockSettingsPersistenceController.saveAgentPermissionSettings.mockReset();
  mockNavigationController.params = null;
  mockServerEventController.startServerEventSubscription.mockReset();
  mockServerEventController.stopServerEventSubscription.mockReset();
});

afterEach(() => {
  externalServicesControllerMock.current = null;
});

describe("useConsole (thirteenth gap)", () => {
  it("falls back from unknown routes, keeps action dispatch, and preserves error helpers", async () => {
    routerState.route = makeRoute("/legacy", "legacy");
    mockBrowserState.clearBrowserLocalStateFromUrlCore.mockRejectedValueOnce(new Error("桥接失败"));

    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    await nextTick();
    expect(mockRuntimeLifecycle.mountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(mockBrowserState.clearBrowserLocalStateFromUrlCore).toHaveBeenCalledTimes(1);
    expect(vm.currentView).toBe("dashboard");
    expect(vm.viewTitle).toBe("控制台");

    vm.error = "完成文档入库前请先重建语料词频";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(true);

    vm.error = "网络已断开";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(false);

    vm.importClients();
    vm.exportClients();
    expect(mockNotify.notifyConsoleAction).toHaveBeenCalledWith("导入客户端功能正在开发中…");
    expect(mockNotify.notifyConsoleAction).toHaveBeenCalledWith("导出客户端列表成功。");

    wrapper.unmount();
    expect(mockRuntimeLifecycle.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(mockServerEventController.stopServerEventSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("ExternalServicesView (thirteenth gap)", () => {
  it("renders error and empty states, and dispatches the header buttons", async () => {
    const wrapper = mountExternalServicesView({
      services: [],
      loading: false,
      loadError: "加载列表失败",
      actionError: "保存失败",
      actionMessage: "已刷新",
    });

    await nextTick();
    const alerts = wrapper.findAll(".external-service-alert");
    expect(alerts).toHaveLength(3);
    expect(alerts[0].classes()).toContain("is-danger");
    expect(alerts[1].classes()).toContain("is-danger");
    expect(alerts[2].classes()).toContain("is-info");
    expect(wrapper.find(".empty-state").exists()).toBe(true);

    const buttons = wrapper.findAll(".external-service-actions button");
    expect(buttons).toHaveLength(2);
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    expect(externalServicesControllerMock.current.openAddServiceConfig).toHaveBeenCalledTimes(1);
    expect(externalServicesControllerMock.current.refreshExternalServices).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("covers copy, tool popover, ResizeObserver fallback, and scroll classes", async () => {
    const previousResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = undefined as any;

    const wrapper = mountExternalServicesView({
      services: [
        createService({
          serviceId: "service-blank",
          displayName: "Service Blank",
          upstreamTargetLabelText: "   ",
          externalMcp: { tools: [] },
        }),
        createService({
          serviceId: "service-rich",
          displayName: "Service Rich",
          upstreamTargetLabelText: " 127.0.0.1:8787 ",
          externalMcp: {
            tools: ["alpha", { name: " beta " }, { toolId: "beta" }, { id: "gamma" }, "alpha"],
          },
        }),
      ],
    });

    await nextTick();
    const scroller = wrapper.get(".external-service-table-scroll").element as HTMLElement;
    expect(wrapper.find(".external-service-table-scroll").classes()).not.toContain("has-horizontal-overflow");

    const upstreamButtons = wrapper.findAll(".external-service-upstream-copy");
    expect(upstreamButtons).toHaveLength(2);

    await upstreamButtons[0].trigger("mouseenter");
    await upstreamButtons[0].trigger("click");
    expect(mockNotify.copyConsoleTextWithFeedback).not.toHaveBeenCalled();
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);

    await upstreamButtons[1].trigger("mouseenter");
    await upstreamButtons[1].trigger("click");
    expect(mockNotify.copyConsoleTextWithFeedback).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      "127.0.0.1:8787",
      { message: "已复制" },
    );
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);

    const toolButtons = wrapper.findAll(".external-service-tool-list-button");
    expect(toolButtons).toHaveLength(1);
    await toolButtons[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);
    expect(wrapper.text()).toContain("alpha");
    expect(wrapper.text()).toContain("beta");
    expect(wrapper.text()).toContain("gamma");

    await toolButtons[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    await toolButtons[0].trigger("click");
    await nextTick();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 1200, writable: true });
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 400, writable: true });
    scroller.scrollLeft = 0;
    await wrapper.find(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-table-scroll").classes()).toEqual(
      expect.arrayContaining(["has-horizontal-overflow", "has-right-overflow"]),
    );
    expect(wrapper.find(".external-service-table-scroll").classes()).not.toContain("has-left-overflow");

    scroller.scrollLeft = 300;
    await wrapper.find(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-table-scroll").classes()).toEqual(
      expect.arrayContaining(["has-horizontal-overflow", "has-left-overflow", "has-right-overflow"]),
    );

    scroller.scrollLeft = 800;
    await wrapper.find(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-table-scroll").classes()).toEqual(
      expect.arrayContaining(["has-horizontal-overflow", "has-left-overflow"]),
    );
    expect(wrapper.find(".external-service-table-scroll").classes()).not.toContain("has-right-overflow");

    wrapper.unmount();
    globalThis.ResizeObserver = previousResizeObserver;
  });
});

describe("router/index (thirteenth gap)", () => {
  it("keeps valid routes stable, redirects invalid tabs, and falls back from unknown routes", async () => {
    expect(router.getRoutes().find((route) => route.path === "/external-services/:tab")?.meta).toMatchObject({
      viewId: "externalServices",
    });
    expect(router.getRoutes().find((route) => route.path === "/knowledge/:tab")?.meta).toMatchObject({
      viewId: "knowledge",
    });
    expect(router.options.scrollBehavior?.({} as any, {} as any, {} as any)).toEqual({ top: 0 });

    await router.push("/external-services/list");
    expect(router.currentRoute.value.path).toBe("/external-services/list");

    await router.push("/knowledge/management");
    expect(router.currentRoute.value.path).toBe("/knowledge/management");

    await router.push("/debug/knowledgeRecall");
    expect(router.currentRoute.value.path).toBe("/debug/knowledgeRecall");

    await router.push("/external-services/bad");
    expect(router.currentRoute.value.path).toBe("/external-services/list");

    await router.push("/knowledge/bad");
    expect(router.currentRoute.value.path).toBe("/knowledge/management");

    await router.push("/debug/bad");
    expect(router.currentRoute.value.path).toBe("/debug/knowledgeRecall");

    await router.push("/not-a-route");
    expect(router.currentRoute.value.path).toBe("/");
  });
});
