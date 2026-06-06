// @vitest-environment jsdom
import { defineComponent, nextTick, reactive, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { useConsole } from "../../../server-web/composables/useConsole";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";

function makeRef<T>(value: T) {
  return { value, __v_isRef: true } as { value: T; __v_isRef: true };
}

const mockNotify = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
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

const routerState = vi.hoisted(() => ({
  route: null as any,
  push: vi.fn(),
  currentRouteRef: { value: null as any },
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

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    currentRoute: routerState.currentRouteRef,
    push: routerState.push,
  })),
  useRoute: vi.fn(() => routerState.route),
}));

vi.mock("../../../server-web/composables/console-browser-state-utils", () => ({
  CLEAR_LOCAL_STATE_PARAM: "clearLocalState",
  clearBrowserCacheStorage: mockBrowserState.clearBrowserCacheStorage,
  clearBrowserLocalStateFromUrl: mockBrowserState.clearBrowserLocalStateFromUrlCore,
  clearIndexedDbDatabases: mockBrowserState.clearIndexedDbDatabases,
  unregisterServiceWorkers: mockBrowserState.unregisterServiceWorkers,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: mockNotify.confirmConsoleAction,
  copyTextToClipboard: mockNotify.copyTextToClipboard,
  createConsoleTargetHighlightController: vi.fn(() => targetHighlightController),
  downloadTextFile: mockNotify.downloadTextFile,
  notifyConsoleAction: mockNotify.notifyConsoleAction,
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
  createConsoleBusyController: vi.fn(() => createLooseController({
    busyKey: ref(""),
    isBusy: ref(false),
    isBusyPrefix: ref(""),
    clearAllBusy: vi.fn(),
    clearBusy: vi.fn(),
    setBusy: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-codex-oauth-controller", () => ({
  createConsoleCodexOAuthController: vi.fn(() => createLooseController({
    beginCodexOAuthLogin: vi.fn(),
    codexOAuthLogin: vi.fn(),
    codexOAuthPollTimer: ref(0),
    codexOAuthStatus: ref("idle"),
    ensureCodexOAuthReady: mockCodexOAuth.ensureCodexOAuthReady,
    refreshCodexOAuthStatus: vi.fn(),
    startCodexOAuthPolling: vi.fn(),
    stopCodexOAuthPolling: vi.fn(),
  })),
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
      visibleDebugTabs: ref([ { id: "knowledgeRecall", label: "知识召回" } ]),
      visibleKnowledgeTabs: ref([ { id: "management", label: "知识归档" }, { id: "wordCloud", label: "词云" } ]),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-knowledge-source-controller", () => ({
  createConsoleKnowledgeSourceController: vi.fn(() => createLooseController({
    activeKnowledgeSources: ref([]),
    applyKnowledgeSourceState: vi.fn(),
    applyLocalSourceDirectoryPath: vi.fn(),
    applyJobToKnowledgeSources: vi.fn(),
    clearActiveKnowledgeSources: vi.fn(),
    createKnowledgeSource: vi.fn(),
    deleteKnowledgeSource: vi.fn(),
    directoryNameFromPath: (value: string) => value,
    localSourceForm: makeRef({ directoryPath: "" }),
    refreshKnowledgeSource: vi.fn(),
    refreshKnowledgeSources: vi.fn(),
    syncLocalSourceLabelFromPath: vi.fn(),
    updateKnowledgeSource: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-path-picker-action-controller", () => ({
  createConsolePathPickerActionController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-path-picker-controller", () => ({
  createConsolePathPickerController: vi.fn(() => createLooseController()),
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
  createConsoleKnowledgeIngestController: vi.fn(() => createLooseController({
    uploadFilesToKnowledge: mockKnowledgeIngest.uploadFilesToKnowledge,
  })),
}));

vi.mock("../../../server-web/composables/console-job-controller", () => ({
  createConsoleJobController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-log-controller", () => ({
  createConsoleKnowledgeLogController: vi.fn(() => createLooseController({
    syncKnowledgeLogTableScrollLeft: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-knowledge-maintenance-controller", () => ({
  createConsoleKnowledgeMaintenanceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-recall-controller", () => ({
  createConsoleKnowledgeRecallController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-search-state-controller", () => ({
  createConsoleKnowledgeSearchPanelStateController: vi.fn(() => createLooseController()),
  createConsoleKnowledgeSearchStateController: vi.fn(() => createLooseController()),
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
  createConsoleNavigationController: vi.fn((params: Record<string, unknown>) =>
    ((params: Record<string, unknown>) => {
      mockNavigationController.params = params;
      return createLooseController({
      ...params,
      currentView: ref("dashboard"),
      debugTab: ref("knowledgeRecall"),
      adminView: ref("jobs"),
      knowledgeTab: ref("management"),
      currentRoute: ref(makeRoute("/dashboard", "dashboard")),
      drawerOpen: ref(false),
      drawerTab: ref("tools"),
      sideNavOpen: ref(false),
      externalServiceTab: ref("list"),
      knowledgeManagementPanel: ref("sources"),
      viewTitle: ref("控制台"),
      syncNavigationStateFromRoute: vi.fn(),
      switchView: vi.fn(),
      openAdmin: vi.fn(),
      openKnowledgeTab: vi.fn(),
      openDebugTab: vi.fn(),
      openAddServiceConfig: vi.fn(),
      bindNavigationRouter: vi.fn(),
      ensureKnowledgeTabState: vi.fn(),
      isKnownDebugRouteTab: vi.fn(() => true),
      openAgentConfigurationAlert: vi.fn(),
      openKnowledgeManagementPanel: vi.fn(),
      openExternalServiceTab: vi.fn(),
      jumpToKnowledgeFileImport: vi.fn(),
      refreshSystemStatusLogs: vi.fn(),
      closeDrawer: vi.fn(),
      closeSideNavOverlay: vi.fn(),
      visibleDebugTabs: ref([{ id: "knowledgeRecall", label: "知识召回" }]),
      visibleKnowledgeTabs: ref([{ id: "management", label: "知识归档" }]),
      });
    })(params),
  ),
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
  createConsoleRefreshStateController: vi.fn(() => createLooseController()),
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
      deps.clearConfigTargetHighlight();
      deps.stopServerEventSubscription();
    },
  })),
}));

vi.mock("../../../server-web/composables/console-server-event-controller", () => ({
  createConsoleServerEventController: vi.fn(() => mockServerEventController),
}));

vi.mock("../../../server-web/composables/console-settings-draft-controller", () => ({
  createConsoleSettingsDraftController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-settings-persistence-controller", () => ({
  createConsoleSettingsPersistenceController: vi.fn((options) => {
    const saveAgentPermissionSettings = vi.fn(async () => {
      mockSettingsPersistenceController.agentPermissionGroupsCalls += 1;
      options.agentPermissionGroups();
      return Promise.resolve();
    });
    mockSettingsPersistenceController.saveAgentPermissionSettings = saveAgentPermissionSettings;
    return { saveAgentPermissionSettings };
  }),
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

const externalServicesController = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesController.current),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

function mountExternalServicesView(overrides: Record<string, unknown> = {}) {
  const service = {
    entryId: "service-a",
    serviceId: "service-a",
    serviceName: "Service A",
    displayName: "Service A",
    description: "",
    mode: "connected",
    startupPolicy: "external-only",
    source: "configured",
    requiredOperations: ["knowledge.search"],
    scriptCount: 1,
    validationStatus: "valid",
    validation: { ok: true, errors: [], warnings: [] },
    externalMcp: { tools: ["status"] },
    upstreamTargetLabelText: "127.0.0.1:8787",
    upstreamTargetDetailText: "endpoint",
    sourceLabelText: "本地 / service-a",
    discoveryLabelText: "MCP 服务",
    discoveryTone: "success",
    discoveryRegistrationLabelText: "工具已发现",
    discoveryRegistrationTone: "success",
    heartbeatText: "Latest: -",
    heartbeatRefreshing: false,
  };

  const controller = {
    actionError: "",
    actionMessage: "",
    actionMessageVisible: true,
    closeConfigEditor: vi.fn(),
    configDraft: {
      serviceId: "service-a",
      serviceName: "service-a",
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
    configText: "{}",
    customUpstreamTypeValue: "",
    discoveryCacheUpdatedAtLabel: "-",
    discoveredServiceCount: 1,
    isCloudDriveServiceDraft: false,
    isLlmServiceDraft: false,
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    loadError: "",
    loading: false,
    modeOptions: [{ value: "connected", label: "connected" }],
    mcpToolCount: 1,
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 1,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [],
    saveConfig: vi.fn(),
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    stream: false,
    trigger: false,
    updateBindingField: vi.fn(),
    updateCloudDriveMode: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateHealthCheckField: vi.fn(),
    updateHealthCheckRequired: vi.fn(),
    updateModelProvider: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateRootField: vi.fn(),
    updateUpstreamField: vi.fn(),
    updateUpstreamTypeSelection: vi.fn(),
    verifyConfig: vi.fn(),
    sourceLabel: "本地",
    serviceSourceDetail: (serviceEntry: any) => serviceEntry.sourceLabelText || "",
    serviceDiscoveryLabel: (serviceEntry: any) => serviceEntry.discoveryLabelText,
    serviceDiscoveryTone: (serviceEntry: any) => serviceEntry.discoveryTone,
    serviceDiscoveryRegistrationLabel: (serviceEntry: any) => serviceEntry.discoveryRegistrationLabelText,
    serviceDiscoveryRegistrationTone: (serviceEntry: any) => serviceEntry.discoveryRegistrationTone,
    serviceHeartbeatLastAtLabel: (serviceEntry: any) => serviceEntry.heartbeatText,
    upstreamTargetDetailLabel: (serviceEntry: any) => serviceEntry.upstreamTargetDetailText,
    upstreamTargetLabel: (serviceEntry: any) => serviceEntry.upstreamTargetLabelText,
    validServiceCount: 1,
    services: [service],
    configuredCount: 1,
    showCustomUpstreamType: true,
    externalServiceName: "",
    externalServiceConfig: null,
    mcpToolCountLabel: "1",
    ...overrides,
  } as Record<string, unknown>;

  externalServicesController.current = controller;
  return mount(ExternalServicesView, {
    global: {
      stubs: {
        ConfigFloatingPanel: true,
        HelpTooltip: true,
        StatusPill: true,
      },
    },
  });
}

beforeEach(() => {
  routerState.route = makeRoute("/dashboard", "dashboard");
  routerState.currentRouteRef.value = routerState.route;
  routerState.push.mockClear();
  mockRuntimeLifecycle.mountConsoleRuntime.mockReset();
  mockRuntimeLifecycle.unmountConsoleRuntime.mockReset();
  mockBrowserState.clearBrowserLocalStateFromUrlCore.mockReset().mockResolvedValue(undefined);
  mockServerEventController.startServerEventSubscription.mockClear();
  mockServerEventController.stopServerEventSubscription.mockClear();
  targetHighlightController.configTargetElement.mockClear();
  targetHighlightController.scrollToConfigTarget.mockClear();
  targetHighlightController.clearConfigTargetHighlight.mockClear();
  mockModelLibrary.hasOpenAiModelUsage.mockReset().mockReturnValue(false);
  mockCodexOAuth.ensureCodexOAuthReady.mockReset();
  mockSettingsPersistenceController.agentPermissionGroupsCalls = 0;
  mockSettingsPersistenceController.saveAgentPermissionSettings.mockReset();
  externalServicesController.current = null;
});

describe("useConsole (twelfth gap)", () => {
  it("error computed 字段会匹配更多语料导入提示文案", async () => {
    const wrapper = createUseConsoleHarness();
    const vm = wrapper.vm as any;

    vm.error = "完成文档入库前请先重建语料词频";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(true);

    vm.error = "重建语料词频任务尚未完成";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(true);

    vm.error = "网络已断开";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(false);

    wrapper.unmount();
  });

  it("clearBrowserLocalStateFromUrl 失败时仍会进入生命周期并报告调用参数", async () => {
    mockBrowserState.clearBrowserLocalStateFromUrlCore.mockRejectedValueOnce(new Error("桥接失败"));

    const wrapper = createUseConsoleHarness();
    await nextTick();

    expect(mockRuntimeLifecycle.mountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(mockBrowserState.clearBrowserLocalStateFromUrlCore).toHaveBeenCalledTimes(1);
    expect(mockBrowserState.clearBrowserLocalStateFromUrlCore).toHaveBeenCalledWith(
      expect.objectContaining({
        clearMemoryCaches: expect.any(Function),
      }),
    );

    await nextTick();
    expect(mockServerEventController.startServerEventSubscription).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(mockRuntimeLifecycle.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
  });

  it("上传语料会透传到 ingest controller", async () => {
    const wrapper = createUseConsoleHarness();
    const vm = wrapper.vm as any;

    mockKnowledgeIngest.uploadFilesToKnowledge.mockResolvedValue(undefined);
    await vm.uploadFilesToKnowledge(["a.txt"]);
    expect(mockKnowledgeIngest.uploadFilesToKnowledge).toHaveBeenCalledWith(["a.txt"]);

    wrapper.unmount();
  });

  it("保存权限设置会读取 agentPermissionGroups", async () => {
    const wrapper = createUseConsoleHarness();
    const vm = wrapper.vm as any;

    await vm.saveAgentPermissionSettings();
    expect(mockSettingsPersistenceController.agentPermissionGroupsCalls).toBe(1);
    expect(mockSettingsPersistenceController.saveAgentPermissionSettings).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("config target 路由透传方法会原样透传 controller 回调", async () => {
    const wrapper = createUseConsoleHarness();
    const scrollToConfigTarget = mockNavigationController.params?.scrollToConfigTarget as
      | ((targetId: string) => Promise<unknown>)
      | undefined;
    expect(typeof scrollToConfigTarget).toBe("function");

    await scrollToConfigTarget?.("runtime-bridge");
    expect(targetHighlightController.scrollToConfigTarget).toHaveBeenCalledWith("runtime-bridge");

    wrapper.unmount();
  });
});

describe("ExternalServicesView (twelfth gap)", () => {
  it("新增服务、刷新列表按钮会向控制器派发操作", async () => {
    const wrapper = mountExternalServicesView();
    const controller = externalServicesController.current as Record<string, unknown> & {
      openAddServiceConfig: ReturnType<typeof vi.fn>;
      refreshExternalServices: ReturnType<typeof vi.fn>;
    };

    await nextTick();
    const buttons = wrapper.findAll(".external-service-actions button");
    expect(buttons).toHaveLength(2);

    await buttons[0].trigger("click");
    expect(controller.openAddServiceConfig).toHaveBeenCalledTimes(1);

    await buttons[1].trigger("click");
    expect(controller.refreshExternalServices).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("渲染加载失败、保存失败与信息提示三类提示栏并显示空态", async () => {
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
    expect(wrapper.find(".empty-state strong").text()).toBe("暂无外部服务");

    wrapper.unmount();
  });

  it("ResizeObserver 与滚动边界类名会随滚动状态变化", async () => {
    const roObserve = vi.fn();
    const roDisconnect = vi.fn();
    const previousResizeObserver = globalThis.ResizeObserver;

    class FakeResizeObserver {
      constructor() {}
      observe = roObserve;
      disconnect = roDisconnect;
    }

    globalThis.ResizeObserver = FakeResizeObserver as any;
    const wrapper = mountExternalServicesView();
    const table = wrapper.find(".external-service-table-scroll").element as HTMLElement;

    await nextTick();
    expect(roObserve).toHaveBeenCalledTimes(2);

    Object.defineProperty(table, "scrollWidth", { configurable: true, value: 220, writable: true });
    Object.defineProperty(table, "clientWidth", { configurable: true, value: 420, writable: true });
    Object.defineProperty(table, "scrollLeft", { configurable: true, value: 0, writable: true });
    await wrapper.find(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-table-scroll").classes("has-horizontal-overflow")).toBe(false);

    Object.defineProperty(table, "scrollWidth", { configurable: true, value: 1200, writable: true });
    Object.defineProperty(table, "clientWidth", { configurable: true, value: 400, writable: true });
    table.scrollLeft = 0;
    await wrapper.find(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-table-scroll").classes()).toEqual(
      expect.arrayContaining(["has-horizontal-overflow", "has-right-overflow"]),
    );
    expect(wrapper.find(".external-service-table-scroll").classes()).not.toContain("has-left-overflow");

    table.scrollLeft = 300;
    await wrapper.find(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-table-scroll").classes()).toEqual(
      expect.arrayContaining(["has-horizontal-overflow", "has-left-overflow", "has-right-overflow"]),
    );

    table.scrollLeft = 800;
    await wrapper.find(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-table-scroll").classes()).toEqual(
      expect.arrayContaining(["has-horizontal-overflow", "has-left-overflow"]),
    );
    expect(wrapper.find(".external-service-table-scroll").classes()).not.toContain("has-right-overflow");

    wrapper.unmount();
    globalThis.ResizeObserver = previousResizeObserver;
    expect(roDisconnect).toHaveBeenCalledTimes(1);
  });
});
