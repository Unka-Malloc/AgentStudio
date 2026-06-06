// @vitest-environment jsdom
import { defineComponent, nextTick, reactive, ref } from "vue";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { useConsole } from "../../../server-web/composables/useConsole";

function makeRef<T>(value: T) {
  return {
    value,
    __v_isRef: true,
  } as { value: T; __v_isRef: true };
}

const mockNotify = vi.hoisted(() => ({
  notifyConsoleAction: vi.fn(),
  confirmConsoleAction: vi.fn(),
  copyTextToClipboard: vi.fn(),
  downloadTextFile: vi.fn(),
}));

const mockBrowserState = vi.hoisted(() => ({
  clearBrowserLocalStateFromUrlCore: vi.fn(),
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

const mockRuntimeInfoClient = vi.hoisted(() => ({
  browseServerPath: vi.fn(),
}));

const mockServerEventController = vi.hoisted(() => ({
  applyConsoleState: vi.fn(),
  baseServerEventTopics: ["console.topic"],
  currentServerEventTopics: vi.fn(() => "console.topic"),
  uploadTraceEvents: makeRef([] as any[]),
  clearServerEventTimer: vi.fn(),
  isAbortError: vi.fn(() => false),
  nextCursorFromProtocolEvents: vi.fn(() => 0),
  resetServerEventCursor: vi.fn(),
  runServerEventSubscription: vi.fn(),
  serverEventAbortController: makeRef(null as AbortController | null),
  serverEventCursor: makeRef(0),
  serverEventSubscriptionGeneration: makeRef(1),
  serverEventSubscriptionStopped: makeRef(false),
  serverEventTimer: makeRef(null as ReturnType<typeof setTimeout> | null),
  serverEventTimerResolve: vi.fn(),
  startServerEventSubscription: vi.fn(),
  stopServerEventSubscription: vi.fn(),
  waitForServerEventRetry: vi.fn(),
}));

const mockRefreshStateController = vi.hoisted(() => ({
  REFRESH_STATE_DELAY_MS: 1000,
  clearPendingRefreshState: vi.fn(),
  clearPendingRefreshStateTimer: vi.fn(),
  lastRefreshStateStartedAt: makeRef(0),
  mergeRefreshStateOptions: vi.fn((options) => options),
  normalizeRefreshStateOptions: vi.fn((options) => options),
  pendingRefreshStateOptions: makeRef({} as Record<string, unknown>),
  pendingRefreshStatePromise: makeRef(Promise.resolve(undefined)),
  pendingRefreshStateResolve: vi.fn(),
  pendingRefreshStateTimer: makeRef(null as ReturnType<typeof setTimeout> | null),
  performRefreshState: vi.fn(),
  refreshState: vi.fn(async () => undefined),
  scheduleDelayedRefreshState: vi.fn(),
}));

const mockRuntimeLifecycle = vi.hoisted(() => ({
  mountConsoleRuntime: vi.fn(),
  unmountConsoleRuntime: vi.fn(),
}));

const mockKnowledgeSourceController = vi.hoisted(() => ({
  activeKnowledgeSources: makeRef([]),
  applyJobToKnowledgeSources: vi.fn(),
  applyKnowledgeSourceState: vi.fn(),
  applyLocalSourceDirectoryPath: vi.fn(),
  deleteKnowledgeSource: vi.fn(),
  directoryNameFromPath: vi.fn((v: string) => v.split("/").at(-1) || ""),
  localSourceForm: makeRef({ directoryPath: "" }),
  refreshKnowledgeSource: vi.fn(),
  refreshKnowledgeSources: vi.fn(),
  syncLocalSourceLabelFromPath: vi.fn(),
  updateKnowledgeSource: vi.fn(),
}));

const mockAgentExploreStateController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    agentExploreForm: ref({ modelAlias: "" }),
    agentExploreResult: ref({}),
  };
});

const mockAgentExploreSessionController = vi.hoisted(() => ({
  persistAgentExploreState: vi.fn(),
}));

const mockAgentSelectorController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    agentSelectorOptions: ref([
      { label: "模型 A", value: "model-a", selectable: true },
    ]),
    cacheAgentModelOptionLabels: vi.fn(),
  };
});

const mockExpertRulesController = vi.hoisted(() => ({
  refreshExpertRules: vi.fn(),
}));

const mockKnowledgeMaintenanceController = vi.hoisted(() => ({
  refreshKnowledgeConsole: vi.fn(),
}));

const mockKnowledgeLogController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    filteredKnowledgeLogRows: ref([] as any[]),
    syncKnowledgeLogTableScrollLeft: vi.fn(),
  };
});

const mockInfoFeedController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    infoFeedForm: ref({ modelAlias: "" }),
    selectedInfoFeedModel: ref({ enabled: true, selectable: true, label: "信息流智能体" }),
  };
});

const mockRuleAuthoringController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    ruleAuthoringForm: ref({ modelAlias: "" }),
    selectedRuleAuthoringModel: ref({ enabled: true, selectable: true, label: "规则编排模型" }),
  };
});

const mockKnowledgeReviewController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    selectedKnowledgeReviewFusionModel: ref({ enabled: true, selectable: true, label: "知识融合模型" }),
  };
});

const mockWordCloudController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    selectedWordCloudModel: ref({ enabled: true, selectable: true, label: "词云模型" }),
    wordCloudModelAlias: ref(""),
  };
});

const mockSettingsDraftController = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    settingsDraft: ref({ agentExploreDefaults: { reviewFusionModelAlias: "" } }),
  };
});

const mockNavigationState = vi.hoisted(() => {
  const { ref } = require("vue");
  const currentView = ref("dashboard");
  const adminView = ref("jobs");
  const debugTab = ref("agentRetrieval");
  const drawerOpen = ref(false);
  const drawerTab = ref("tools");
  const sideNavOpen = ref(false);
  const knowledgeTab = ref("management");
  const externalServiceTab = ref("jobs");
  const knowledgeManagementPanel = ref("sources");
  const visibleDebugTabs = ref([
    { id: "knowledgeRecall", label: "知识召回" },
    { id: "knowledgeDistillation", label: "知识蒸馏" },
  ]);
  const visibleKnowledgeTabs = ref([
    { id: "management", label: "知识归档" },
    { id: "wordCloud", label: "词云" },
  ]);
  const viewTitle = ref("控制台");

  function syncNavigationStateFromRoute(route: { meta?: { viewId?: string }; params?: Record<string, string> } = {}) {
    const viewId = route.meta?.viewId || "dashboard";
    if (["dashboard", "knowledge", "admin", "debug", "externalServices"].includes(viewId)) {
      currentView.value = viewId;
    } else {
      currentView.value = "dashboard";
    }

    if (viewId === "knowledge") {
      knowledgeTab.value = route.params?.tab || "management";
      viewTitle.value = "知识库";
    } else if (viewId === "admin") {
      adminView.value = route.params?.tab || "jobs";
      viewTitle.value = "管理员";
    } else if (viewId === "debug") {
      debugTab.value = route.params?.tab || "knowledgeRecall";
      viewTitle.value = "调试";
    } else if (viewId === "externalServices") {
      externalServiceTab.value = route.params?.tab || "list";
      viewTitle.value = "外部服务";
    } else {
      viewTitle.value = "控制台";
      knowledgeTab.value = "management";
      debugTab.value = "knowledgeRecall";
      adminView.value = "jobs";
    }
  }

  return {
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
    sideNavOpen,
    syncNavigationStateFromRoute: vi.fn(syncNavigationStateFromRoute),
    switchView: vi.fn(),
    viewTitle,
    visibleDebugTabs,
    visibleKnowledgeTabs,
  };
});

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

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    currentRoute: {
      get value() {
        return routerState.route;
      },
    },
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

vi.mock("../../../server-web/lib/runtime-info-client", () => ({
  browseServerPath: mockRuntimeInfoClient.browseServerPath,
  browseServerLogs: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-agent-explore-utils", () => ({
  isAgentExploreDraftSession: vi.fn(() => false),
}));

vi.mock("../../../server-web/composables/console-agent-selection-reference-controller", () => ({
  AGENT_SELECTION_REFERENCE_LOG_LIMIT: 20,
  createConsoleAgentSelectionReferenceController: vi.fn(() => {
    return {
      ...createLooseController({
        agentSelectionReferenceLogs: makeRef([]),
        agentSelectionReferenceStates: makeRef({} as Record<string, { alias: string; state: string }>),
        emitAgentSelectionReferenceLog: vi.fn(),
        normalizeAgentSelectionAlias: (value?: string) => String(value || "").trim(),
        trackAgentSelectionReference: vi.fn(),
      }),
      watchAgentSelectionReference: vi.fn((_, __, getAlias, getSelection) => {
        getAlias();
        getSelection();
      }),
    };
  }),
}));

vi.mock("../../../server-web/composables/console-agent-selector-controller", () => ({
  createConsoleAgentSelectorController: vi.fn(() => createLooseController(mockAgentSelectorController)),
}));

vi.mock("../../../server-web/composables/console-auth-controller", () => ({
  createConsoleAuthController: vi.fn(() =>
    createLooseController({
      canAdminAuth: makeRef(false),
      canAdminKnowledge: makeRef(false),
      canAdminMaintenanceAgent: makeRef(false),
      canApproveMaintenanceAgent: makeRef(false),
      canBrowseServerPaths: makeRef(true),
      canMaintainKnowledge: makeRef(true),
      canReadKnowledge: makeRef(true),
      canReadMaintenanceAgent: makeRef(false),
      canRunMaintenanceAgent: makeRef(false),
      canWriteJobs: makeRef(false),
      canWriteKnowledge: makeRef(true),
      currentUser: makeRef({ username: "demo", role: "admin", scopes: [] }),
      currentUserScopes: makeRef([]),
      hasScope: vi.fn(() => true),
      isAuthenticated: makeRef(true),
      loginForm: makeRef({ username: "", password: "" }),
      oidcAllowedDomainsText: "",
      oidcDraft: makeRef({}),
      oidcRoleMappingText: "",
      refreshAuthAdmin: vi.fn(),
      refreshAuthState: vi.fn(),
      logoutConsole: vi.fn(),
      revokeConsoleSession: vi.fn(),
      saveOidcConfig: vi.fn(),
      submitLoginAuth: vi.fn(),
      updateConsoleUser: vi.fn(),
      updateConsoleUserRole: vi.fn(),
      updateConsoleUserRoleFromEvent: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-busy-controller", () => ({
  createConsoleBusyController: vi.fn(() =>
    createLooseController({
      busyKey: makeRef(""),
      isBusy: makeRef(false),
      isBusyPrefix: makeRef(""),
      clearAllBusy: vi.fn(),
      clearBusy: vi.fn(),
      setBusy: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-codex-oauth-controller", () => ({
  createConsoleCodexOAuthController: vi.fn(() =>
    createLooseController({
      codexOAuthLogin: vi.fn(),
      codexOAuthPollTimer: makeRef(0),
      codexOAuthStatus: makeRef("idle"),
      beginCodexOAuthLogin: vi.fn(),
      ensureCodexOAuthReady: vi.fn(),
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
  createConsoleAgentExploreSessionController: vi.fn(() => createLooseController(mockAgentExploreSessionController)),
}));

vi.mock("../../../server-web/composables/console-agent-explore-state-controller", () => ({
  createConsoleAgentExploreStateController: vi.fn(() => createLooseController(mockAgentExploreStateController)),
}));

vi.mock("../../../server-web/composables/console-context-compiler-controller", () => ({
  createConsoleContextCompilerController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-discovery-controller", () => ({
  createConsoleDiscoveryController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-expert-rules-controller", () => ({
  createConsoleExpertRulesController: vi.fn(() => createLooseController(mockExpertRulesController)),
}));

vi.mock("../../../server-web/composables/console-feature-access-controller", () => ({
  createConsoleFeatureAccessController: vi.fn(() =>
    createLooseController({
      activeConsoleFeatureIds: makeRef(["knowledge-core", "agent-management", "agent-gateway", "maintenance-agent-runbooks"]),
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
      visibleDebugTabs: makeRef([
        { id: "knowledgeRecall", label: "知识召回" },
      ]),
      visibleKnowledgeTabs: makeRef([
        { id: "management", label: "知识归档" },
        { id: "wordCloud", label: "词云" },
      ]),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-knowledge-source-controller", () => ({
  createConsoleKnowledgeSourceController: vi.fn(() => mockKnowledgeSourceController),
}));

vi.mock("../../../server-web/composables/console-knowledge-search-state-controller", () => ({
  createConsoleKnowledgeSearchPanelStateController: vi.fn(() => createLooseController()),
  createConsoleKnowledgeSearchStateController: vi.fn(() =>
    createLooseController({
      knowledgeSearchForm: makeRef({ query: "" }),
      knowledgeSearchResponse: makeRef(null),
      knowledgeSearchResults: makeRef([]),
      lastKnowledgeSearchQuery: makeRef(""),
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
  createConsoleInfoFeedController: vi.fn(() => createLooseController(mockInfoFeedController)),
}));

vi.mock("../../../server-web/composables/console-knowledge-evidence-controller", () => ({
  createConsoleKnowledgeEvidenceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-ingest-controller", () => ({
  createConsoleKnowledgeIngestController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-job-controller", () => ({
  createConsoleJobController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-log-controller", () => ({
  createConsoleKnowledgeLogController: vi.fn(() => createLooseController(mockKnowledgeLogController)),
}));

vi.mock("../../../server-web/composables/console-knowledge-maintenance-controller", () => ({
  createConsoleKnowledgeMaintenanceController: vi.fn(() => createLooseController(mockKnowledgeMaintenanceController)),
}));

vi.mock("../../../server-web/composables/console-knowledge-recall-controller", () => ({
  createConsoleKnowledgeRecallController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-review-controller", () => ({
  createConsoleKnowledgeReviewController: vi.fn(() => createLooseController(mockKnowledgeReviewController)),
}));

vi.mock("../../../server-web/composables/console-maintenance-agent-controller", () => ({
  createConsoleMaintenanceAgentController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-mcp-authorization-controller", () => ({
  createConsoleMcpAuthorizationController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-model-library-controller", () => ({
  createConsoleModelLibraryController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-navigation-controller", () => ({
  createConsoleNavigationController: vi.fn(() => mockNavigationState),
}));

vi.mock("../../../server-web/composables/console-option-bar-controller", () => ({
  createConsoleOptionBarController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-ops-monitor-controller", () => ({
  createConsoleOpsMonitorController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-rule-authoring-controller", () => ({
  createConsoleRuleAuthoringController: vi.fn(() => createLooseController(mockRuleAuthoringController)),
}));

vi.mock("../../../server-web/composables/console-refresh-state-controller", () => ({
  createConsoleRefreshStateController: vi.fn(() => mockRefreshStateController),
}));

vi.mock("../../../server-web/composables/console-runtime-lifecycle-controller", () => ({
  createConsoleRuntimeLifecycleController: vi.fn((deps) => {
    return {
      mountConsoleRuntime: () => {
        mockRuntimeLifecycle.mountConsoleRuntime();
        void deps.clearBrowserLocalStateFromUrl();
        deps.startServerEventSubscription();
      },
      unmountConsoleRuntime: () => {
        mockRuntimeLifecycle.unmountConsoleRuntime();
        deps.stopServerEventSubscription();
      },
    };
  }),
}));

vi.mock("../../../server-web/composables/console-server-event-controller", () => ({
  createConsoleServerEventController: vi.fn(() => mockServerEventController),
}));

vi.mock("../../../server-web/composables/console-settings-bridge-controller", () => ({
  createConsoleSettingsBridgeController: vi.fn(() =>
    createLooseController({
      applyingRemoteConsoleDrafts: makeRef(false),
      bindSettingsDraftActions: vi.fn(),
      bindSettingsPersistenceActions: vi.fn(),
      saveSettings: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-settings-draft-controller", () => ({
  createConsoleSettingsDraftController: vi.fn(() => createLooseController(mockSettingsDraftController)),
}));

vi.mock("../../../server-web/composables/console-settings-persistence-controller", () => ({
  createConsoleSettingsPersistenceController: vi.fn(() => createLooseController()),
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
  createConsoleWordCloudController: vi.fn(() =>
    createLooseController({
      ...mockWordCloudController,
      addWordCloudCorpusPaths: vi.fn(),
      addWordCloudCorpusPath: vi.fn(),
    }),
  ),
}));

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

beforeEach(() => {
  const route = makeRoute("/dashboard", "dashboard");
  routerState.route = route;
  routerState.push.mockClear();
  vi.clearAllMocks();

  mockBrowserState.clearBrowserLocalStateFromUrlCore.mockReset();
  mockRuntimeInfoClient.browseServerPath.mockReset();
  mockRuntimeInfoClient.browseServerPath.mockResolvedValue({
    currentPath: "",
    parentPath: "",
    mode: "file",
    extensions: [],
    roots: [],
    entries: [],
    truncated: false,
  });

  mockNavigationState.currentView.value = "dashboard";
  mockNavigationState.adminView.value = "jobs";
  mockNavigationState.debugTab.value = "agentRetrieval";
  mockNavigationState.drawerOpen.value = false;
  mockNavigationState.drawerTab.value = "tools";
  mockNavigationState.sideNavOpen.value = false;
  mockNavigationState.knowledgeTab.value = "management";
  mockNavigationState.externalServiceTab.value = "jobs";
  mockNavigationState.knowledgeManagementPanel.value = "sources";
  mockNavigationState.viewTitle.value = "控制台";
  mockKnowledgeSourceController.localSourceForm.value = { directoryPath: "" };
  mockAgentExploreStateController.agentExploreForm.value = { modelAlias: "" };
  mockAgentExploreStateController.agentExploreResult.value = {};
  mockAgentSelectorController.agentSelectorOptions.value = [{ label: "模型 A", value: "model-a", selectable: true }];
  mockKnowledgeLogController.filteredKnowledgeLogRows.value = [];
});

describe("useConsole", () => {
  it("初始化会基于当前路由同步视图并启动服务器事件订阅", () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    expect(mockRuntimeLifecycle.mountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(mockServerEventController.startServerEventSubscription).toHaveBeenCalledTimes(1);
    expect(vm.currentView).toBe("dashboard");
    expect(vm.viewTitle).toBe("控制台");

    wrapper.unmount();
    expect(mockRuntimeLifecycle.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(mockServerEventController.stopServerEventSubscription).toHaveBeenCalledTimes(1);
  });

  it("路由切换会派生页面和 tab 状态", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    routerState.route.fullPath = "/knowledge/wordCloud";
    routerState.route.meta = { viewId: "knowledge" };
    routerState.route.params = { tab: "wordCloud" };
    routerState.route.path = "/knowledge/wordCloud";
    await nextTick();

    expect(vm.currentView).toBe("knowledge");
    expect(vm.knowledgeTab).toBe("wordCloud");
    expect(vm.viewTitle).toBe("知识库");

    routerState.route.fullPath = "/debug/knowledgeRecall";
    routerState.route.meta = { viewId: "debug" };
    routerState.route.params = { tab: "knowledgeRecall" };
    routerState.route.path = "/debug/knowledgeRecall";
    await nextTick();

    expect(vm.currentView).toBe("debug");
    expect(vm.debugTab).toBe("knowledgeRecall");
    expect(vm.viewTitle).toBe("调试");

    wrapper.unmount();
  });

  it("externalServices 路由会同步外部服务 tab，并在挂载时清理浏览器本地状态", async () => {
    routerState.route = makeRoute("/external-services/list", "externalServices", "list");
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    await nextTick();

    expect(vm.currentView).toBe("externalServices");
    expect(vm.externalServiceTab).toBe("list");
    expect(mockBrowserState.clearBrowserLocalStateFromUrlCore).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("error 文案会派生出导入类提示需求", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    vm.error = "语料词频表为空，请先完成文档入库。";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(true);

    vm.error = "网络连接超时";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(false);

    wrapper.unmount();
  });

  it("本地目录路径浏览会打开路径弹窗并在选择后提交 localSourceForm", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    vm.openLocalSourceDirectoryPicker();
    await Promise.resolve();
    await nextTick();

    expect(vm.pathPicker.open).toBe(true);
    expect(mockRuntimeInfoClient.browseServerPath).toHaveBeenCalledWith({
      path: String(mockKnowledgeSourceController.localSourceForm.value.directoryPath || ""),
      mode: "directory",
      extensions: [],
      includeHidden: false,
    });

    vm.selectServerPath("/opt/local/data");
    expect(mockKnowledgeSourceController.applyLocalSourceDirectoryPath).toHaveBeenCalledWith("/opt/local/data");
    expect(vm.pathPicker.open).toBe(false);

    wrapper.unmount();
  });

  it("路径浏览失败会回传错误提示", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    mockRuntimeInfoClient.browseServerPath.mockRejectedValueOnce(new Error("路径浏览失败"));
    vm.openLocalSourceDirectoryPicker();
    await Promise.resolve();

    expect(vm.pathPicker.error).toBe("路径浏览失败");

    wrapper.unmount();
  });

  it("刷新与重连分支会透传 refresh 选项并在卸载时停止订阅", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    await vm.refreshState({ silent: true });

    expect(mockRefreshStateController.refreshState).toHaveBeenCalledWith({ silent: true });

    wrapper.unmount();
    expect(mockServerEventController.stopServerEventSubscription).toHaveBeenCalledTimes(1);
    expect(mockRuntimeLifecycle.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
  });

  it("未知 viewId 会回退到 dashboard 并保持主标题", async () => {
    routerState.route = makeRoute("/legacy", "legacy");
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    await nextTick();

    expect(vm.currentView).toBe("dashboard");
    expect(vm.viewTitle).toBe("控制台");

    wrapper.unmount();
  });

  it("knowledgeManagementPanel 的 watcher 会按面板类型派发不同刷新", async () => {
    routerState.route = makeRoute("/knowledge/management", "knowledge", "management");
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    await nextTick();
    expect(vm.currentView).toBe("knowledge");
    expect(vm.knowledgeTab).toBe("management");

    vm.knowledgeManagementPanel = "rules";
    await nextTick();
    expect(mockExpertRulesController.refreshExpertRules).toHaveBeenCalledTimes(1);

    vm.knowledgeManagementPanel = "sources";
    await nextTick();
    expect(mockKnowledgeMaintenanceController.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("agent explore 的状态变化会持久化到本地状态", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;
    const baseline = mockAgentExploreSessionController.persistAgentExploreState.mock.calls.length;

    mockAgentExploreStateController.agentExploreForm.value = { modelAlias: "model-a" };
    await nextTick();
    expect(mockAgentExploreSessionController.persistAgentExploreState.mock.calls.length).toBeGreaterThan(baseline);

    mockAgentExploreStateController.agentExploreResult.value = { answer: "ok" };
    await nextTick();
    expect(mockAgentExploreSessionController.persistAgentExploreState.mock.calls.length).toBeGreaterThan(1 + baseline);

    wrapper.unmount();
  });

  it("管理员日志面板切到 logs 时会同步表格横向滚动", async () => {
    routerState.route = makeRoute("/admin/logs", "admin", "logs");
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    await nextTick();
    await nextTick();
    expect(mockKnowledgeLogController.syncKnowledgeLogTableScrollLeft).toHaveBeenCalledTimes(1);

    vm.filteredKnowledgeLogRows = [{ id: "row-1" } as any];
    await nextTick();
    await nextTick();
    expect(mockKnowledgeLogController.syncKnowledgeLogTableScrollLeft).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it("agentSelectorOptions 变化会触发模型标签缓存", async () => {
    const wrapper = createUseConsoleHarness();

    expect(mockAgentSelectorController.cacheAgentModelOptionLabels).toHaveBeenCalledTimes(1);

    const vm: any = wrapper.vm;
    vm.agentSelectorOptions = [{ label: "模型 B", value: "model-b", selectable: true }];
    await nextTick();
    expect(mockAgentSelectorController.cacheAgentModelOptionLabels).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it("导出导入动作会透传提示，清理浏览器状态可触发回收", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    vm.importClients();
    expect(mockNotify.notifyConsoleAction).toHaveBeenCalledWith("导入客户端功能正在开发中…");

    vm.exportClients();
    expect(mockNotify.notifyConsoleAction).toHaveBeenCalledWith("导出客户端列表成功。");

    wrapper.unmount();
  });

  it("在非知识页切换 knowledgeManagementPanel 时不会触发知识刷新", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    expect(vm.currentView).toBe("dashboard");

    vm.knowledgeManagementPanel = "rules";
    await nextTick();
    expect(mockExpertRulesController.refreshExpertRules).not.toHaveBeenCalled();
    expect(mockKnowledgeMaintenanceController.refreshKnowledgeConsole).not.toHaveBeenCalled();

    vm.knowledgeManagementPanel = "sources";
    await nextTick();
    expect(mockExpertRulesController.refreshExpertRules).not.toHaveBeenCalled();
    expect(mockKnowledgeMaintenanceController.refreshKnowledgeConsole).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
