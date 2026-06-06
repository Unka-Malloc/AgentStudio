// @vitest-environment jsdom
import { defineComponent, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleNavigationController } from "../../../server-web/composables/console-navigation-controller";
import {
  createConsoleRefreshStateController,
  REFRESH_STATE_DELAY_MS,
} from "../../../server-web/composables/console-refresh-state-controller";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import type { InfoFeedRunState } from "../../../server-web/types/app";
import { useConsole } from "../../../server-web/composables/useConsole";

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

const consoleStateClientMock = vi.hoisted(() => ({
  getServerConsoleState: vi.fn(),
}));

const browserStateMock = vi.hoisted(() => ({
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
  scrollToConfigTarget: vi.fn(async () => undefined),
  clearConfigTargetHighlight: vi.fn(),
}));

const useConsoleMockState = vi.hoisted(() => {
  const { ref } = require("vue");

  const currentView = ref("dashboard");
  const adminView = ref("jobs");
  const debugTab = ref("knowledgeRecall");
  const externalServiceTab = ref("list");
  const knowledgeTab = ref("management");
  const knowledgeManagementPanel = ref("knowledge");
  const drawerOpen = ref(false);
  const drawerTab = ref("discovery");
  const sideNavOpen = ref(false);
  const viewTitle = ref("工作台");

  const visibleDebugTabs = ref([{ id: "knowledgeRecall", label: "知识召回" }]);
  const visibleKnowledgeTabs = ref([{ id: "management", label: "知识归档" }]);
  const agentSelectorOptions = ref([{ label: "模型 A", value: "model-a", selectable: true }]);
  const agentExploreForm = ref({ modelAlias: "" });
  const agentExploreResult = ref({});
  const infoFeedForm = ref({ modelAlias: "" });
  const selectedInfoFeedModel = ref({ enabled: true, selectable: true, label: "信息流智能体" });
  const ruleAuthoringForm = ref({ modelAlias: "" });
  const selectedRuleAuthoringModel = ref({ enabled: true, selectable: true, label: "规则编排智能体" });
  const wordCloudModelAlias = ref("");
  const selectedWordCloudModel = ref({ enabled: true, selectable: true, label: "词云模型" });
  const filteredKnowledgeLogRows = ref([] as any[]);
  const settingsDraft = ref({ agentExploreDefaults: { reviewFusionModelAlias: "" } });

  const busyKey = ref("");
  const isBusy = ref(false);
  const isBusyPrefix = ref("");
  const serverAvailable = ref(false);
  const error = ref("");
  const pathPicker = ref({ open: false, error: "" });
  const localSourceForm = ref({ directoryPath: "" });

  const refreshState = vi.fn(async (options: Record<string, unknown> = {}) => {
    if (options && typeof options === "object") {
      serverAvailable.value = true;
      error.value = "";
    }
  });

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
      const nextAdminView = route.meta?.adminView || route.path?.split("/").at(-1) || "jobs";
      adminView.value = nextAdminView as any;
      viewTitle.value =
        ({
          jobs: "任务队列",
          logs: "日志记录",
          tools: "工具列表",
          toolList: "工具列表",
          toolStats: "工具统计",
          agentPermissions: "权限组",
          storage: "系统概览",
        } as Record<string, string>)[nextAdminView] || "管理";
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
    viewTitle.value = "工作台";
  }

  const bindNavigationRouter = vi.fn((router: { currentRoute: { value: any } }) => {
    syncNavigationStateFromRoute(router.currentRoute.value);
  });

  const refreshKnowledgeConsole = vi.fn();
  const refreshExpertRules = vi.fn();
  const persistAgentExploreState = vi.fn();
  const cacheAgentModelOptionLabels = vi.fn();
  const syncKnowledgeLogTableScrollLeft = vi.fn();
  const mountConsoleRuntime = vi.fn();
  const unmountConsoleRuntime = vi.fn();
  const notifyConsoleAction = vi.fn();
  const browseServerPath = vi.fn();

  return {
    agentExploreForm,
    agentExploreResult,
    agentSelectorOptions,
    adminView,
    bindNavigationRouter,
    busyKey,
    cacheAgentModelOptionLabels,
    currentView,
    debugTab,
    drawerOpen,
    drawerTab,
    error,
    externalServiceTab,
    filteredKnowledgeLogRows,
    infoFeedForm,
    isBusy,
    isBusyPrefix,
    knowledgeManagementPanel,
    knowledgeTab,
    localSourceForm,
    mountConsoleRuntime,
    notifyConsoleAction,
    pathPicker,
    persistAgentExploreState,
    refreshExpertRules,
    refreshKnowledgeConsole,
    refreshState,
    ruleAuthoringForm,
    settingsDraft,
    selectedInfoFeedModel,
    selectedRuleAuthoringModel,
    selectedWordCloudModel,
    serverAvailable,
    sideNavOpen,
    syncKnowledgeLogTableScrollLeft,
    syncNavigationStateFromRoute,
    unmountConsoleRuntime,
    viewTitle,
    visibleDebugTabs,
    visibleKnowledgeTabs,
    wordCloudModelAlias,
    browseServerPath,
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

const knowledgeSourceMock = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    activeKnowledgeSources: ref([]),
    applyLocalSourceDirectoryPath: vi.fn(),
    directoryNameFromPath: vi.fn((value: string) => value.split("/").at(-1) || ""),
    localSourceForm: ref({ directoryPath: "" }),
    refreshKnowledgeSource: vi.fn(),
    refreshKnowledgeSources: vi.fn(),
    syncLocalSourceLabelFromPath: vi.fn(),
    updateKnowledgeSource: vi.fn(),
  };
});

const knowledgeLogMock = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    filteredKnowledgeLogRows: ref([] as any[]),
    syncKnowledgeLogTableScrollLeft: vi.fn(),
  };
});

const agentSelectionReferenceMock = vi.hoisted(() => ({
  agentSelectionReferenceLogs: [],
  agentSelectionReferenceStates: {},
  emitAgentSelectionReferenceLog: vi.fn(),
  normalizeAgentSelectionAlias: (value?: string) => String(value || "").trim(),
  trackAgentSelectionReference: vi.fn(),
  watchAgentSelectionReference: vi.fn((_, __, getAlias, getSelection) => {
    getAlias();
    getSelection();
  }),
}));

const agentExploreSessionMock = vi.hoisted(() => ({
  persistAgentExploreState: vi.fn(),
}));

const useConsoleOptionCaptures = vi.hoisted(() => ({
  featureAccess: null as any,
  knowledgeMaintenance: null as any,
  knowledgeEvidence: null as any,
  knowledgeRecall: null as any,
  contextCompiler: null as any,
  modelLibrary: null as any,
  navigation: null as any,
  runtimeLifecycle: null as any,
  settingsDraft: null as any,
  stateEventReducer: null as any,
  output: null as any,
}));

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
  clearBrowserCacheStorage: browserStateMock.clearBrowserCacheStorage,
  clearBrowserLocalStateFromUrl: browserStateMock.clearBrowserLocalStateFromUrlCore,
  clearIndexedDbDatabases: browserStateMock.clearIndexedDbDatabases,
  unregisterServiceWorkers: browserStateMock.unregisterServiceWorkers,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: vi.fn(),
  copyTextToClipboard: vi.fn(),
  createConsoleTargetHighlightController: vi.fn(() => targetHighlightController),
  downloadTextFile: vi.fn(),
  notifyConsoleAction: useConsoleMockState.notifyConsoleAction,
}));

vi.mock("../../../server-web/lib/runtime-info-client", () => ({
  browseServerPath: useConsoleMockState.browseServerPath,
  browseServerLogs: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-agent-explore-utils", () => ({
  isAgentExploreDraftSession: vi.fn(() => false),
}));

vi.mock("../../../server-web/composables/console-agent-selection-reference-controller", () => ({
  AGENT_SELECTION_REFERENCE_LOG_LIMIT: 20,
  createConsoleAgentSelectionReferenceController: vi.fn(() => agentSelectionReferenceMock),
}));

vi.mock("../../../server-web/composables/console-agent-selector-controller", () => ({
  createConsoleAgentSelectorController: vi.fn(() =>
    createLooseController({
      agentSelectorOptions: useConsoleMockState.agentSelectorOptions,
      cacheAgentModelOptionLabels: useConsoleMockState.cacheAgentModelOptionLabels,
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-auth-controller", () => ({
  createConsoleAuthController: vi.fn(() =>
    createLooseController({
      canBrowseServerPaths: ref(true),
      canMaintainKnowledge: ref(true),
      canReadKnowledge: ref(true),
      currentUser: ref({ username: "demo", role: "admin", scopes: [] }),
      currentUserScopes: ref([]),
      hasScope: vi.fn(() => true),
      isAuthenticated: ref(true),
      loginForm: ref({ username: "", password: "" }),
      oidcAllowedDomainsText: "",
      oidcDraft: ref({}),
      oidcRoleMappingText: "",
      refreshAuthAdmin: vi.fn(),
      refreshAuthState: vi.fn(),
      logoutConsole: vi.fn(),
      revokeConsoleSession: vi.fn(),
      saveOidcConfig: vi.fn(),
      submitLoginAuth: vi.fn(),
      updateConsoleUser: vi.fn(),
      updateConsoleUserRole: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-busy-controller", () => ({
  createConsoleBusyController: vi.fn(() =>
    createLooseController({
      busyKey: useConsoleMockState.busyKey,
      clearAllBusy: vi.fn(),
      clearBusy: vi.fn(),
      isBusy: useConsoleMockState.isBusy,
      isBusyPrefix: useConsoleMockState.isBusyPrefix,
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
  createConsoleAgentExploreOutputController: vi.fn((options) => {
    useConsoleOptionCaptures.output = options;
    return createLooseController();
  }),
}));

vi.mock("../../../server-web/composables/console-agent-explore-session-controller", () => ({
  createConsoleAgentExploreSessionController: vi.fn(() =>
    createLooseController(agentExploreSessionMock),
  ),
}));

vi.mock("../../../server-web/composables/console-agent-explore-state-controller", () => ({
  createConsoleAgentExploreStateController: vi.fn(() =>
    createLooseController({
      agentExploreForm: useConsoleMockState.agentExploreForm,
      agentExploreResult: useConsoleMockState.agentExploreResult,
      selectedAgentExploreContextProfile: ref({ value: "ctx-a" }),
      selectedAgentExploreModel: ref({ value: "model-a", enabled: true }),
      selectedAgentExploreThinkingMode: ref("balanced"),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-context-compiler-controller", () => ({
  createConsoleContextCompilerController: vi.fn((options) => {
    useConsoleOptionCaptures.contextCompiler = options;
    return createLooseController();
  }),
}));

vi.mock("../../../server-web/composables/console-discovery-controller", () => ({
  createConsoleDiscoveryController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-expert-rules-controller", () => ({
  createConsoleExpertRulesController: vi.fn(() =>
    createLooseController({
      refreshExpertRules: useConsoleMockState.refreshExpertRules,
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-feature-access-controller", () => ({
  createConsoleFeatureAccessController: vi.fn((options) => {
    useConsoleOptionCaptures.featureAccess = options;
    return featureAccessMock;
  }),
}));

vi.mock("../../../server-web/composables/console-knowledge-source-controller", () => ({
  createConsoleKnowledgeSourceController: vi.fn(() => knowledgeSourceMock),
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
  createConsoleInfoFeedController: vi.fn(() =>
    createLooseController({
      infoFeedForm: useConsoleMockState.infoFeedForm,
      infoFeedCurrentRun: ref(null),
      selectedInfoFeedModel: useConsoleMockState.selectedInfoFeedModel,
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-knowledge-evidence-controller", () => ({
  createConsoleKnowledgeEvidenceController: vi.fn((options) => {
    useConsoleOptionCaptures.knowledgeEvidence = options;
    return createLooseController();
  }),
}));

vi.mock("../../../server-web/composables/console-knowledge-ingest-controller", () => ({
  createConsoleKnowledgeIngestController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-job-controller", () => ({
  createConsoleJobController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-log-controller", () => ({
  createConsoleKnowledgeLogController: vi.fn(() => knowledgeLogMock),
}));

vi.mock("../../../server-web/composables/console-knowledge-maintenance-controller", () => ({
  createConsoleKnowledgeMaintenanceController: vi.fn((options) => {
    useConsoleOptionCaptures.knowledgeMaintenance = options;
    return createLooseController({
      knowledgeConsole: ref(null),
      knowledgeManagementPanelOptionBarOptions: ref([]),
      refreshKnowledgeConsole: useConsoleMockState.refreshKnowledgeConsole,
    });
  }),
}));

vi.mock("../../../server-web/composables/console-knowledge-recall-controller", () => ({
  createConsoleKnowledgeRecallController: vi.fn((options) => {
    useConsoleOptionCaptures.knowledgeRecall = options;
    return createLooseController();
  }),
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
  createConsoleModelLibraryController: vi.fn((options) => {
    useConsoleOptionCaptures.modelLibrary = options;
    return createLooseController();
  }),
}));

vi.mock("../../../server-web/composables/console-navigation-controller", () => ({
  createConsoleNavigationController: vi.fn((options) => {
    useConsoleOptionCaptures.navigation = options;
    return createLooseController({
      adminView: useConsoleMockState.adminView,
      bindNavigationRouter: useConsoleMockState.bindNavigationRouter,
      closeDrawer: vi.fn(),
      closeSideNavOverlay: vi.fn(),
      currentView: useConsoleMockState.currentView,
      debugTab: useConsoleMockState.debugTab,
      drawerOpen: useConsoleMockState.drawerOpen,
      drawerTab: useConsoleMockState.drawerTab,
      ensureKnowledgeTabState: vi.fn(),
      externalServiceTab: useConsoleMockState.externalServiceTab,
      isKnownDebugRouteTab: vi.fn(() => true),
      knowledgeManagementPanel: useConsoleMockState.knowledgeManagementPanel,
      knowledgeTab: useConsoleMockState.knowledgeTab,
      openAdmin: vi.fn(),
      openDebugTab: vi.fn(),
      openDrawer: vi.fn(),
      openExternalServiceTab: vi.fn(),
      openKnowledgeManagementPanel: vi.fn(),
      openKnowledgeTab: vi.fn(),
      refreshSystemStatusLogs: vi.fn(),
      sideNavOpen: useConsoleMockState.sideNavOpen,
      syncNavigationStateFromRoute: useConsoleMockState.syncNavigationStateFromRoute,
      switchView: vi.fn(),
      viewTitle: useConsoleMockState.viewTitle,
      visibleDebugTabs: useConsoleMockState.visibleDebugTabs,
      visibleKnowledgeTabs: useConsoleMockState.visibleKnowledgeTabs,
    });
  }),
}));

vi.mock("../../../server-web/composables/console-option-bar-controller", () => ({
  createConsoleOptionBarController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-path-picker-action-controller", () => ({
  createConsolePathPickerActionController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-path-picker-controller", () => ({
  createConsolePathPickerController: vi.fn(() =>
    createLooseController({
      closeServerPathPicker: vi.fn(),
      confirmServerPathPicker: vi.fn(),
      openPathEntry: vi.fn(),
      openServerPathPicker: vi.fn(),
      pathEntryMeta: ref({}),
      pathPicker: useConsoleMockState.pathPicker,
      pathPickerModeLabel: ref(""),
      refreshServerPathBrowser: vi.fn(),
      selectServerPath: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-refresh-state-controller", () => ({
  REFRESH_STATE_DELAY_MS: 3000,
  createConsoleRefreshStateController: vi.fn((options) => {
    useConsoleMockState.refreshState.mockImplementation(async () => {
      options.serverAvailable.value = true;
      options.error.value = "";
    });
    return createLooseController({
      clearPendingRefreshState: vi.fn(),
      clearPendingRefreshStateTimer: vi.fn(),
      lastRefreshStateStartedAt: ref(0),
      mergeRefreshStateOptions: vi.fn((value) => value),
      normalizeRefreshStateOptions: vi.fn((value) => value),
      pendingRefreshStateOptions: ref(null),
      pendingRefreshStatePromise: ref(null),
      pendingRefreshStateResolve: ref(null),
      pendingRefreshStateTimer: ref(null),
      performRefreshState: vi.fn(),
      refreshState: useConsoleMockState.refreshState,
      scheduleDelayedRefreshState: vi.fn(),
    });
  }),
}));

vi.mock("../../../server-web/composables/console-runtime-lifecycle-controller", () => ({
  createConsoleRuntimeLifecycleController: vi.fn((deps) => {
    useConsoleOptionCaptures.runtimeLifecycle = deps;
    return {
      mountConsoleRuntime: () => {
        useConsoleMockState.mountConsoleRuntime();
        void deps.clearBrowserLocalStateFromUrl();
        deps.startServerEventSubscription();
      },
      unmountConsoleRuntime: () => {
        useConsoleMockState.unmountConsoleRuntime();
        deps.stopServerEventSubscription();
      },
    };
  }),
}));

vi.mock("../../../server-web/composables/console-server-event-controller", () => ({
  createConsoleServerEventController: vi.fn(() => createLooseController()),
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
  createConsoleSettingsDraftController: vi.fn((options) => {
    useConsoleOptionCaptures.settingsDraft = options;
    return createLooseController({
      settingsDraft: useConsoleMockState.settingsDraft,
    });
  }),
}));

vi.mock("../../../server-web/composables/console-settings-persistence-controller", () => ({
  createConsoleSettingsPersistenceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-state-event-reducer-controller", () => ({
  createConsoleStateEventReducerController: vi.fn((options) => {
    useConsoleOptionCaptures.stateEventReducer = options;
    return createLooseController();
  }),
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
      selectedWordCloudModel: useConsoleMockState.selectedWordCloudModel,
      wordCloudModelAlias: useConsoleMockState.wordCloudModelAlias,
    }),
  ),
}));

beforeEach(() => {
  routerState.route = reactive({
    fullPath: "/dashboard",
    path: "/dashboard",
    meta: { viewId: "dashboard" },
    params: {},
  }) as any;
  routerState.push.mockClear();

  browserStateMock.clearBrowserLocalStateFromUrlCore.mockReset();
  browserStateMock.clearBrowserCacheStorage.mockReset();
  browserStateMock.clearIndexedDbDatabases.mockReset();
  browserStateMock.unregisterServiceWorkers.mockReset();

  useConsoleMockState.currentView.value = "dashboard";
  useConsoleMockState.adminView.value = "jobs";
  useConsoleMockState.debugTab.value = "knowledgeRecall";
  useConsoleMockState.externalServiceTab.value = "list";
  useConsoleMockState.knowledgeTab.value = "management";
  useConsoleMockState.knowledgeManagementPanel.value = "knowledge";
  useConsoleMockState.drawerOpen.value = false;
  useConsoleMockState.drawerTab.value = "discovery";
  useConsoleMockState.sideNavOpen.value = false;
  useConsoleMockState.viewTitle.value = "工作台";
  useConsoleMockState.agentExploreForm.value = { modelAlias: "" };
  useConsoleMockState.agentExploreResult.value = {};
  useConsoleMockState.infoFeedForm.value = { modelAlias: "" };
  useConsoleMockState.selectedInfoFeedModel.value = { enabled: true, selectable: true, label: "信息流智能体" };
  useConsoleMockState.ruleAuthoringForm.value = { modelAlias: "" };
  useConsoleMockState.selectedRuleAuthoringModel.value = { enabled: true, selectable: true, label: "规则编排智能体" };
  useConsoleMockState.wordCloudModelAlias.value = "";
  useConsoleMockState.selectedWordCloudModel.value = { enabled: true, selectable: true, label: "词云模型" };
  useConsoleMockState.filteredKnowledgeLogRows.value = [];
  useConsoleMockState.settingsDraft.value = { agentExploreDefaults: { reviewFusionModelAlias: "" } };
  useConsoleMockState.busyKey.value = "";
  useConsoleMockState.isBusy.value = false;
  useConsoleMockState.isBusyPrefix.value = "";
  useConsoleMockState.serverAvailable.value = false;
  useConsoleMockState.error.value = "";
  useConsoleMockState.pathPicker.value = { open: false, error: "" };
  useConsoleMockState.localSourceForm.value = { directoryPath: "" };

  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeRoute(fullPath: string, viewId: string, extra: { adminView?: string; tab?: string } = {}) {
  return reactive({
    fullPath,
    path: fullPath,
    meta: extra.adminView ? { viewId, adminView: extra.adminView } : { viewId },
    params: extra.tab ? { tab: extra.tab } : {},
  }) as any;
}

function createUseConsoleHarness() {
  const shell = defineComponent({
    setup: () => useConsole(),
    template: "<div />",
  });
  return mount(shell);
}

describe("console navigation controller gap", () => {
  it("会优先使用 route meta 上的 adminView，并给出对应标题", async () => {
    const { createConsoleNavigationController: createActualConsoleNavigationController } =
      await vi.importActual<typeof import("../../../server-web/composables/console-navigation-controller")>(
        "../../../server-web/composables/console-navigation-controller",
      );
    const error = ref("seed");
    const featureFlags: Record<string, boolean> = {
      "agent-gateway": true,
      "agent-management": true,
      "knowledge-core": true,
      "maintenance-agent-runbooks": true,
    };
    const visibleDebugTabs = ref([{ id: "knowledgeRecall", label: "知识召回" }]);
    const visibleKnowledgeTabs = ref([{ id: "management", label: "知识归档" }]);
    const controller = createActualConsoleNavigationController({
      error,
      ensureAgentPermissionGroupsDraft: vi.fn(),
      hasFeature: (featureId: string) => featureFlags[featureId] ?? false,
      isAdminViewEnabled: () => true,
      refreshAuthAdmin: vi.fn(),
      refreshBackgroundProcesses: vi.fn(),
      refreshClientRuntimeStatus: vi.fn(),
      refreshContextCompiler: vi.fn(),
      refreshDashboardAlertsSnapshot: vi.fn(),
      refreshExpertRules: vi.fn(),
      refreshKnowledgeConsole: vi.fn(),
      refreshKnowledgeRecallBackendSpaces: vi.fn(),
      refreshMaintenanceAgent: vi.fn(),
      refreshMonitorAlerts: vi.fn(),
      refreshState: vi.fn(),
      refreshToolManagement: vi.fn(),
      refreshWordCloud: vi.fn(),
      scrollToConfigTarget: vi.fn(),
      visibleDebugTabs,
      visibleKnowledgeTabs,
    });

    const router = {
      currentRoute: ref(makeRoute("/admin/storage", "admin")),
      push: vi.fn(),
    };

    controller.bindNavigationRouter(router as any);
    controller.syncNavigationStateFromRoute({
      path: "/admin/tool-list",
      meta: { viewId: "admin", adminView: "toolList" },
      params: {},
    } as any);

    expect(controller.currentView.value).toBe("admin");
    expect(controller.adminView.value).toBe("toolList");
    expect(controller.viewTitle.value).toBe("工具列表");
  });
});

describe("useConsole", () => {
  it("初始化时会同步路由并启动生命周期", () => {
    routerState.route = makeRoute("/admin/tool-list", "admin", { adminView: "toolList" });
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    expect(useConsoleMockState.mountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(vm.currentView).toBe("admin");
    expect(vm.adminView).toBe("toolList");
    expect(vm.viewTitle).toBe("工具列表");
    expect(vm.serverAvailable).toBe(false);
    expect(vm.selectedModelProvider).toBe("deepseek");

    wrapper.unmount();
    expect(useConsoleMockState.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
  });

  it("error 和 refresh wrapper 会走到对应派生/透传分支", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    vm.error = "语料词频表为空，请先完成文档入库。";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(true);

    vm.error = "普通错误";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(false);

    await vm.refreshState({ silent: true, forceSettings: true });
    expect(useConsoleMockState.refreshState).toHaveBeenCalledWith({ silent: true, forceSettings: true });
    expect(vm.serverAvailable).toBe(true);

    vm.importClients();
    expect(useConsoleMockState.notifyConsoleAction).toHaveBeenCalledWith("导入客户端功能正在开发中…");

    vm.exportClients();
    expect(useConsoleMockState.notifyConsoleAction).toHaveBeenCalledWith("导出客户端列表成功。");

    wrapper.unmount();
  });

  it("路由切换会同步 knowledge、debug、externalServices 和未知分支", async () => {
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    routerState.route.fullPath = "/knowledge/wordCloud";
    routerState.route.meta = { viewId: "knowledge" };
    routerState.route.params = { tab: "wordCloud" };
    await nextTick();
    expect(vm.currentView).toBe("knowledge");
    expect(vm.knowledgeTab).toBe("wordCloud");
    expect(vm.viewTitle).toBe("知识库");

    routerState.route.fullPath = "/debug/knowledgeRecall";
    routerState.route.meta = { viewId: "debug" };
    routerState.route.params = { tab: "knowledgeRecall" };
    await nextTick();
    expect(vm.currentView).toBe("debug");
    expect(vm.debugTab).toBe("knowledgeRecall");
    expect(vm.viewTitle).toBe("调试");

    routerState.route.fullPath = "/external-services/list";
    routerState.route.meta = { viewId: "externalServices" };
    routerState.route.params = { tab: "list" };
    await nextTick();
    expect(vm.currentView).toBe("externalServices");
    expect(vm.externalServiceTab).toBe("list");
    expect(vm.viewTitle).toBe("外部服务");

    routerState.route.fullPath = "/legacy";
    routerState.route.meta = { viewId: "legacy" };
    routerState.route.params = {};
    await nextTick();
    expect(vm.currentView).toBe("dashboard");
    expect(vm.viewTitle).toBe("工作台");

    wrapper.unmount();
  });

  it("会执行注入到各个子控制器的闭包并触发响应式分支", async () => {
    const wrapper = createUseConsoleHarness();

    expect(useConsoleOptionCaptures.featureAccess.isAuthenticated()).toBe(true);

    await useConsoleOptionCaptures.navigation.refreshAuthAdmin();
    await useConsoleOptionCaptures.navigation.refreshBackgroundProcesses({});
    await useConsoleOptionCaptures.navigation.refreshClientRuntimeStatus({});
    await useConsoleOptionCaptures.navigation.refreshContextCompiler({});
    await useConsoleOptionCaptures.navigation.refreshDashboardAlertsSnapshot({});
    await useConsoleOptionCaptures.navigation.refreshExpertRules({});
    await useConsoleOptionCaptures.navigation.refreshKnowledgeConsole();
    await useConsoleOptionCaptures.navigation.refreshKnowledgeRecallBackendSpaces();
    await useConsoleOptionCaptures.navigation.refreshMaintenanceAgent({});
    await useConsoleOptionCaptures.navigation.refreshMonitorAlerts({});
    await useConsoleOptionCaptures.navigation.refreshState({ silent: true, forceSettings: true });
    await useConsoleOptionCaptures.navigation.refreshToolManagement({});
    await useConsoleOptionCaptures.navigation.refreshWordCloud({});
    await useConsoleOptionCaptures.navigation.scrollToConfigTarget("config-target-1");
    useConsoleOptionCaptures.navigation.ensureAgentPermissionGroupsDraft();
    useConsoleOptionCaptures.navigation.hasFeature("knowledge-core");
    useConsoleOptionCaptures.navigation.isAdminViewEnabled();

    await useConsoleOptionCaptures.knowledgeMaintenance.refreshKnowledgeConflicts({});
    await useConsoleOptionCaptures.knowledgeMaintenance.refreshKnowledgeRecallBackendSpaces();
    useConsoleOptionCaptures.knowledgeMaintenance.hasScope("knowledge:read");

    useConsoleOptionCaptures.contextCompiler.recentTurns();
    useConsoleOptionCaptures.contextCompiler.selectedContextProfileId();

    useConsoleOptionCaptures.output.infoFeedQuery();
    useConsoleOptionCaptures.output.infoFeedRunId();
    useConsoleOptionCaptures.output.knowledgeSearchQuery();

    useConsoleOptionCaptures.knowledgeEvidence.infoFeedQuery();

    useConsoleOptionCaptures.modelLibrary.agentExploreModelAlias();
    useConsoleOptionCaptures.modelLibrary.infoFeedModelAlias();
    useConsoleOptionCaptures.modelLibrary.infoFeedRunningSummary();
    useConsoleOptionCaptures.modelLibrary.ruleAuthoringModelAlias();

    useConsoleOptionCaptures.settingsDraft.normalizeModelEntry({ modelAlias: "model-a" } as any);
    useConsoleOptionCaptures.settingsDraft.visibleModelEntries();

    useConsoleOptionCaptures.stateEventReducer.applyAgentExploreDefaultsFromSettings();
    useConsoleOptionCaptures.stateEventReducer.applyMaintenanceAgentConfigFromEvent({} as any);
    useConsoleOptionCaptures.stateEventReducer.applyMaintenanceAgentStateFromConsoleState({} as any);
    useConsoleOptionCaptures.stateEventReducer.applyWordCloudEvent({} as any);
    useConsoleOptionCaptures.stateEventReducer.refreshKnowledgeConflicts({});
    useConsoleOptionCaptures.stateEventReducer.refreshMaintenanceAgent({});
    useConsoleOptionCaptures.stateEventReducer.removeJobFromEvent("job-1");
    useConsoleOptionCaptures.stateEventReducer.upsertJobFromEvent({ jobId: "job-2" } as any);

    useConsoleOptionCaptures.knowledgeRecall.clearSelectedEvidence();
    await useConsoleOptionCaptures.runtimeLifecycle.clearBrowserLocalStateFromUrl();
    useConsoleOptionCaptures.runtimeLifecycle.clearConfigTargetHighlight();

    useConsoleMockState.currentView.value = "knowledge";
    useConsoleMockState.knowledgeTab.value = "management";
    useConsoleMockState.knowledgeManagementPanel.value = "rules";
    await nextTick();
    expect(useConsoleMockState.refreshExpertRules).toHaveBeenCalled();

    useConsoleMockState.knowledgeManagementPanel.value = "knowledge";
    await nextTick();
    expect(useConsoleMockState.refreshKnowledgeConsole).toHaveBeenCalled();

    useConsoleMockState.currentView.value = "admin";
    useConsoleMockState.adminView.value = "logs";
    knowledgeLogMock.filteredKnowledgeLogRows.value = [{ rowId: "row-1" }];
    await nextTick();
    await nextTick();
    expect(knowledgeLogMock.syncKnowledgeLogTableScrollLeft).toHaveBeenCalled();

    wrapper.unmount();
  });
});

function makeInfoFeedSummaryDefaults() {
  return {
    modelAlias: "model-a",
    contextProfileId: "ctx-a",
    temperature: 0.2,
    maxTokens: 1800,
  };
}

function makeInfoFeedRun(query = "起始问题") {
  return createInfoFeedRunState(query, {
    attachments: [],
    summaryDefaults: makeInfoFeedSummaryDefaults(),
  });
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

  const runUtils = await import("../../../server-web/composables/console-info-feed-run-utils");
  const module = await import("../../../server-web/composables/console-info-feed-execution-controller");
  return { ...module, expertFeedbackMock, runUtils, summaryMock, trackMock };
}

async function importTrackController() {
  vi.resetModules();
  vi.doUnmock("../../../server-web/composables/console-info-feed-track-controller");

  const trackMocks = {
    getKnowledgeAgentExploreRun: vi.fn(),
    runKnowledgeAgentExplore: vi.fn(),
    searchKnowledge: vi.fn(),
  };
  const withInfoFeedFetchRetryMock = vi.fn(async (_run: InfoFeedRunState, _stage: string, operation: () => Promise<unknown>) =>
    operation());

  vi.doMock("../../../server-web/lib/knowledge-search-client", () => ({
    searchKnowledge: trackMocks.searchKnowledge,
  }));
  vi.doMock("../../../server-web/lib/agent-explore-client", () => ({
    getKnowledgeAgentExploreRun: trackMocks.getKnowledgeAgentExploreRun,
    runKnowledgeAgentExplore: trackMocks.runKnowledgeAgentExplore,
  }));
  vi.doMock("../../../server-web/composables/console-agent-explore-utils", async () => {
    const actual = await vi.importActual<typeof import("../../../server-web/composables/console-agent-explore-utils")>(
      "../../../server-web/composables/console-agent-explore-utils",
    );
    return actual;
  });
  vi.doMock("../../../server-web/composables/console-info-feed-run-utils", async () => {
    const actual = await vi.importActual<typeof import("../../../server-web/composables/console-info-feed-run-utils")>(
      "../../../server-web/composables/console-info-feed-run-utils",
    );
      return {
        ...actual,
        delayMs: vi.fn(() => Promise.resolve()),
        withInfoFeedFetchRetry: withInfoFeedFetchRetryMock,
      };
    });

  const runUtils = await import("../../../server-web/composables/console-info-feed-run-utils");
  const module = await import("../../../server-web/composables/console-info-feed-track-controller");
  return { ...module, runUtils, trackMocks, withInfoFeedFetchRetryMock };
}

describe("console-info-feed-execution-controller", () => {
  it("covers model-selection and retry continuation branches", async () => {
    const { createConsoleInfoFeedExecutionController, summaryMock, trackMock } = await importExecutionController();
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
    const selectedModel = ref({ value: "model-a", enabled: false });

    const controller = createConsoleInfoFeedExecutionController({
      agentExploreConfiguredLimit: ref(6),
      agentExploreConfiguredMaxIterations: ref(3),
      agentExploreThinkingParameters: vi.fn(() => ({})),
      applyInfoFeedSummaryAnswer: vi.fn(),
      archiveInfoFeedExpertFeedback: vi.fn(() => ({}) as any),
      buildInfoFeedAgentQuery: vi.fn((run: InfoFeedRunState) => `agent:${run.query}`),
      buildInfoFeedSourceSearchQuery: vi.fn((run: InfoFeedRunState) => `source:${run.query}`),
      buildInfoFeedSummaryQuestion: vi.fn((run: InfoFeedRunState) => `summary:${run.query}`),
      canReadKnowledge: ref(true),
      createInfoFeedRun: vi.fn((query: string) => makeInfoFeedRun(query)),
      error,
      fallbackInfoFeedSummary: vi.fn(),
      infoFeedAgentExpertGuidance: vi.fn(() => ({})),
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
      resetInfoFeedRunForContinuation: vi.fn((run: InfoFeedRunState, question: string) => {
        run.query = question;
      }),
      selectedInfoFeedContextProfile: ref({ value: "ctx-a" }),
      selectedInfoFeedModel: selectedModel,
      selectedThinkingMode: ref("balanced"),
      upsertInfoFeedHistory,
    } as any);

    const run = infoFeedCurrentRun.value!;
    run.pausedForModelSelection = "agent";
    await controller.continueInfoFeedAfterModelSelection();
    expect(error.value).toBe("请选择一个已配置且可用的模型。");

    selectedModel.value.enabled = true;
    infoFeedCurrentRun.value = run;
    infoFeedRunSequence.value = 1;
    trackMock.runInfoFeedAgentTrack.mockImplementationOnce(async () => {
      infoFeedCurrentRun.value = makeInfoFeedRun("切换后的问题");
    });
    await controller.continueInfoFeedAfterModelSelection();
    expect(trackMock.runInfoFeedAgentTrack).toHaveBeenCalledTimes(1);
    expect(upsertInfoFeedHistory).toHaveBeenCalledTimes(1);
    expect(summaryMock.runInfoFeedSummaryAgent).not.toHaveBeenCalled();

    const keywordStaleRun = makeInfoFeedRun("重试关键词");
    keywordStaleRun.pausedForRetry = "keyword";
    infoFeedCurrentRun.value = keywordStaleRun;
    trackMock.runInfoFeedKeywordTrack.mockImplementationOnce(async () => {
      infoFeedCurrentRun.value = makeInfoFeedRun("更换后的问题");
    });
    await controller.continueInfoFeedAfterRetry();

    const agentStaleRun = makeInfoFeedRun("重试智能体");
    agentStaleRun.pausedForRetry = "agent";
    infoFeedCurrentRun.value = agentStaleRun;
    trackMock.runInfoFeedAgentTrack.mockImplementationOnce(async () => {
      infoFeedCurrentRun.value = makeInfoFeedRun("再次切换");
    });
    await controller.continueInfoFeedAfterRetry();

    expect(upsertInfoFeedHistory).toHaveBeenCalledTimes(3);
  });
});

describe("console-info-feed-track-controller", () => {
  it("covers stale run, polling, and failure branches", async () => {
    const { createConsoleInfoFeedTrackController, runUtils, trackMocks, withInfoFeedFetchRetryMock } = await importTrackController();
    const keywordRun = makeInfoFeedRun("原始问题");
    const otherRun = makeInfoFeedRun("切换后的问题");
    const infoFeedCurrentRun = ref<InfoFeedRunState | null>(keywordRun);
    const infoFeedRunSequence = ref(1);

    keywordRun.runId = "run-1";
    otherRun.runId = "run-2";

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
    await controller.runInfoFeedKeywordTrack(1, keywordRun.runId, "keyword:stale");
    expect(trackMocks.searchKnowledge).not.toHaveBeenCalled();
    expect(keywordRun.keyword.status).toBe("idle");

    const agentCurrentRun = ref<InfoFeedRunState | null>(makeInfoFeedRun("智能体问题"));
    agentCurrentRun.value!.runId = "run-3";
    const agentRunSequence = ref(1);
    const agentController = createConsoleInfoFeedTrackController({
      agentExploreConfiguredLimit: ref(3),
      agentExploreConfiguredMaxIterations: ref(5),
      infoFeedAgentExpertGuidance: vi.fn(() => ({})),
      infoFeedAgentProgressFromResult: vi.fn(() => 0),
      infoFeedAgentRecentTurns: vi.fn(() => []),
      infoFeedCurrentRun: agentCurrentRun,
      infoFeedKeywordCache: new Map(),
      infoFeedRunSequence: agentRunSequence,
      selectedInfoFeedContextProfile: ref({ value: "ctx-a" }),
      selectedInfoFeedModel: ref({ value: "model-a", enabled: true }),
      selectedThinkingMode: ref("balanced"),
    } as any);

    const retryExhaustedError = new runUtils.InfoFeedRetryExhaustedError(
      "agent",
      1,
      new Error("网络错误"),
      1,
    );
    const retryRun = makeInfoFeedRun("重试智能体");
    retryRun.runId = "run-4";
    agentCurrentRun.value = retryRun;
    withInfoFeedFetchRetryMock.mockImplementationOnce(async (run: InfoFeedRunState, stage: string) => {
      run.pausedForRetry = stage as any;
      throw retryExhaustedError;
    });
    await agentController.runInfoFeedAgentTrack(1, retryRun.runId, "agent:retry");
    expect(retryRun.agent.status).toBe("failed");
    expect(retryRun.pausedForRetry).toBe("agent");

    const modelConfigRun = makeInfoFeedRun("模型配置问题");
    modelConfigRun.runId = "run-5";
    agentCurrentRun.value = modelConfigRun;
    trackMocks.runKnowledgeAgentExplore.mockRejectedValueOnce(new Error("模型未配置"));
    await agentController.runInfoFeedAgentTrack(1, modelConfigRun.runId, "agent:model");
    expect(modelConfigRun.agent.status).toBe("failed");
    expect(modelConfigRun.pausedForModelSelection).toBe("agent");
  });
});
