// @vitest-environment jsdom
import { defineComponent, nextTick, reactive, ref } from "vue";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createConsoleNavigationController } from "../../../server-web/composables/console-navigation-controller";

const mockNotify = vi.hoisted(() => ({
  notifyConsoleAction: vi.fn(),
  confirmConsoleAction: vi.fn(),
  copyTextToClipboard: vi.fn(),
  downloadTextFile: vi.fn(),
}));

const mockBrowserState = vi.hoisted(() => ({
  clearBrowserLocalStateFromUrlCore: vi.fn(),
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

const targetHighlightController = vi.hoisted(() => ({
  configTargetElement: vi.fn(() => null),
  scrollToConfigTarget: vi.fn(() => Promise.resolve()),
  clearConfigTargetHighlight: vi.fn(),
}));

const routerState = vi.hoisted(() => ({
  route: null as any,
  currentRouteRef: { value: null as any },
  push: vi.fn(),
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

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    currentRoute: routerState.currentRouteRef,
    push: routerState.push,
  })),
  useRoute: vi.fn(() => routerState.route),
}));

vi.mock("../../../server-web/composables/console-browser-state-utils", () => ({
  CLEAR_LOCAL_STATE_PARAM: "clearLocalState",
  clearBrowserCacheStorage: vi.fn(),
  clearBrowserLocalStateFromUrl: mockBrowserState.clearBrowserLocalStateFromUrlCore,
  clearIndexedDbDatabases: vi.fn(),
  unregisterServiceWorkers: vi.fn(),
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
    codexOAuthLogin: vi.fn(),
    codexOAuthPollTimer: ref(0),
    codexOAuthStatus: ref("idle"),
    beginCodexOAuthLogin: vi.fn(),
    ensureCodexOAuthReady: vi.fn(),
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
      visibleDebugTabs: ref([{ id: "knowledgeRecall", label: "知识召回" }]),
      visibleKnowledgeTabs: ref([
        { id: "management", label: "知识归档" },
        { id: "wordCloud", label: "词云" },
      ]),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-knowledge-source-controller", () => ({
  createConsoleKnowledgeSourceController: vi.fn(() => createLooseController()),
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
  createConsoleKnowledgeIngestController: vi.fn(() => createLooseController()),
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
  createConsoleModelLibraryController: vi.fn(() => createLooseController()),
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
  createConsoleRuntimeLifecycleController: vi.fn(() =>
    createLooseController({
      mountConsoleRuntime: mockRuntimeLifecycle.mountConsoleRuntime,
      unmountConsoleRuntime: mockRuntimeLifecycle.unmountConsoleRuntime,
    }),
  ),
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
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-settings-draft-controller", () => ({
  createConsoleSettingsDraftController: vi.fn(() => createLooseController()),
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
  createConsoleWordCloudController: vi.fn(() => createLooseController()),
}));

import { useConsole } from "../../../server-web/composables/useConsole";

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

function createNavigationController() {
  const refreshSpies = {
    error: ref(""),
    ensureAgentPermissionGroupsDraft: vi.fn(),
    hasFeature: vi.fn(() => true),
    isAdminViewEnabled: vi.fn(() => true),
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
    visibleDebugTabs: ref([
      { id: "knowledgeRecall", label: "知识召回" },
      { id: "knowledgeDistillation", label: "知识蒸馏" },
    ]),
    visibleKnowledgeTabs: ref([
      { id: "management", label: "知识归档" },
      { id: "wordCloud", label: "词云" },
    ]),
  };
  const router = {
    currentRoute: ref(makeRoute("/dashboard", "dashboard")),
    push: vi.fn(),
  };
  const controller = createConsoleNavigationController(refreshSpies);
  return { controller, router, refreshSpies };
}

beforeEach(() => {
  const route = makeRoute("/dashboard", "dashboard");
  routerState.route = route;
  routerState.currentRouteRef.value = route;
  routerState.push.mockClear();
  vi.clearAllMocks();
  targetHighlightController.scrollToConfigTarget.mockClear();
  mockRuntimeLifecycle.mountConsoleRuntime.mockClear();
  mockRuntimeLifecycle.unmountConsoleRuntime.mockClear();
});

describe("console-navigation-controller", () => {
  it("同步路由元信息到导航状态并处理视图转换", async () => {
    const { controller, router } = createNavigationController();
    controller.bindNavigationRouter(router);

    expect(controller.currentView.value).toBe("dashboard");
    expect(router.push).not.toHaveBeenCalled();

    controller.syncNavigationStateFromRoute({
      path: "/knowledge/chunking",
      meta: { viewId: "knowledge" },
      params: { tab: "chunking" },
    } as any);
    expect(controller.currentView.value).toBe("knowledge");
    expect(controller.knowledgeTab.value).toBe("management");

    controller.syncNavigationStateFromRoute({
      path: "/admin/tool-stats",
      meta: { viewId: "admin" },
      params: {},
    } as any);
    expect(controller.currentView.value).toBe("admin");
    expect(controller.adminView.value).toBe("toolStats");

    controller.syncNavigationStateFromRoute({
      path: "/debug/agentRetrieval",
      meta: { viewId: "debug" },
      params: { tab: "agentRetrieval" },
    } as any);
    expect(controller.currentView.value).toBe("debug");
    expect(controller.debugTab.value).toBe("agentRetrieval");
    await nextTick();

    expect(controller.viewTitle.value).toBe("调试");
  });

  it("在知识库与调试功能受限时回退并回到主页", () => {
    const { controller, router, refreshSpies } = createNavigationController();
    refreshSpies.hasFeature = vi.fn((featureId: string) => featureId !== "knowledge-core");
    controller.bindNavigationRouter(router);

    controller.switchView("knowledge");
    expect(controller.currentView.value).toBe("dashboard");
    expect(router.push).toHaveBeenCalledWith("/");

    refreshSpies.visibleDebugTabs.value = [];
    controller.switchView("debug");
    expect(router.push).toHaveBeenCalledWith("/");
    expect(controller.currentView.value).toBe("dashboard");
  });

  it("切换管理员页会做可访问性回退并保留配置锚点查询", async () => {
    const { controller, router, refreshSpies } = createNavigationController();
    refreshSpies.isAdminViewEnabled = vi.fn(() => false);
    controller.bindNavigationRouter(router);

    await controller.openAdmin("toolList", { configTarget: "runtime-bridge" });

    expect(router.push).toHaveBeenCalledWith({
      path: "/admin/jobs",
      query: { configTarget: "runtime-bridge" },
    });
  });

  it("配置告警跳转区分管理员与非管理员分支", async () => {
    const { controller, refreshSpies } = createNavigationController();
    controller.bindNavigationRouter({ currentRoute: ref(makeRoute("/dashboard", "dashboard")), push: vi.fn() } as any);

    await controller.openAgentConfigurationAlert({
      alertId: "a1",
      category: "policy",
      title: "Test",
      detail: "test",
      status: "warning",
      tone: "warning",
      view: "admin",
      adminView: "agentAssignment",
      targetId: "agent-group",
    });
    expect(targetHighlightController.scrollToConfigTarget).not.toHaveBeenCalled();

    targetHighlightController.scrollToConfigTarget.mockClear();
    await controller.openAgentConfigurationAlert({
      alertId: "a2",
      category: "policy",
      title: "Test",
      detail: "test",
      status: "warning",
      tone: "warning",
      view: "debug",
      targetId: "debug-card",
    });
    expect(refreshSpies.scrollToConfigTarget).toHaveBeenCalledWith("debug-card");
  });
});

describe("useConsole", () => {
  it("组件挂载与卸载时触发控制器生命周期", () => {
    const wrapper = createUseConsoleHarness();
    expect(mockRuntimeLifecycle.mountConsoleRuntime).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(mockRuntimeLifecycle.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
  });

  it("路由变化会驱动导航状态与当前视图同步", async () => {
    const wrapper = createUseConsoleHarness();
    const vm = wrapper.vm as any;

    expect(vm.currentView).toBe("dashboard");

    routerState.route.fullPath = "/knowledge/wordCloud";
    routerState.route.meta = { viewId: "knowledge" };
    routerState.route.params = { tab: "wordCloud" };
    routerState.route.path = "/knowledge/wordCloud";
    await nextTick();

    expect(vm.currentView).toBe("knowledge");
    expect(vm.knowledgeTab).toBe("wordCloud");

    routerState.route.fullPath = "/debug/knowledgeRecall";
    routerState.route.meta = { viewId: "debug" };
    routerState.route.params = { tab: "knowledgeRecall" };
    routerState.route.path = "/debug/knowledgeRecall";
    await nextTick();

    expect(vm.currentView).toBe("debug");
    expect(vm.debugTab).toBe("knowledgeRecall");
  });

  it("会触发客户端功能导入导出时的提示文案", () => {
    const wrapper = createUseConsoleHarness();
    const vm = wrapper.vm as any;

    vm.importClients();
    vm.exportClients();

    expect(mockNotify.notifyConsoleAction).toHaveBeenNthCalledWith(1, "导入客户端功能正在开发中…");
    expect(mockNotify.notifyConsoleAction).toHaveBeenNthCalledWith(2, "导出客户端列表成功。");
  });
});
