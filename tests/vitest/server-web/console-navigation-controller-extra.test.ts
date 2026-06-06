// @vitest-environment jsdom
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleNavigationController } from "../../../server-web/composables/console-navigation-controller";

function makeRoute(
  path: string,
  viewId: string,
  options: {
    adminView?: string;
    params?: Record<string, unknown>;
  } = {},
) {
  return {
    path,
    meta: {
      viewId,
      ...(options.adminView ? { adminView: options.adminView } : {}),
    },
    params: options.params || {},
  } as any;
}

function createFixture() {
  const error = ref("seed");
  const featureFlags: Record<string, boolean> = {
    "agent-gateway": true,
    "agent-management": true,
    "knowledge-core": true,
    "maintenance-agent-runbooks": true,
  };
  const visibleDebugTabs = ref([
    { id: "knowledgeRecall", label: "知识召回" },
    { id: "agentRetrieval", label: "智能检索" },
  ]);
  const visibleKnowledgeTabs = ref([
    { id: "management", label: "知识归档" },
    { id: "wordCloud", label: "语料分析" },
  ]);

  const ensureAgentPermissionGroupsDraft = vi.fn();
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
  const scrollToConfigTarget = vi.fn(async () => undefined);

  const router = {
    currentRoute: ref(makeRoute("/dashboard", "dashboard")),
    push: vi.fn(),
  };

  const controller = createConsoleNavigationController({
    error,
    ensureAgentPermissionGroupsDraft,
    hasFeature: (featureId: string) => featureFlags[featureId] ?? false,
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
    visibleDebugTabs,
    visibleKnowledgeTabs,
  });

  return {
    controller,
    ensureAgentPermissionGroupsDraft,
    error,
    featureFlags,
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
    visibleDebugTabs,
    visibleKnowledgeTabs,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("console-navigation-controller extra", () => {
  it("syncs routes, preserves the first router binding, and normalizes invalid state", async () => {
    const harness = createFixture();
    const primaryRouter = {
      currentRoute: ref(makeRoute("/dashboard", "dashboard")),
      push: vi.fn(),
    };
    const secondaryRouter = {
      currentRoute: ref(makeRoute("/admin/storage", "admin")),
      push: vi.fn(),
    };

    harness.controller.bindNavigationRouter(primaryRouter);
    harness.controller.bindNavigationRouter(secondaryRouter);

    expect(harness.controller.currentView.value).toBe("admin");
    expect(harness.controller.adminView.value).toBe("storage");
    expect(harness.controller.viewTitle.value).toBe("系统概览");

    harness.controller.syncNavigationStateFromRoute(
      makeRoute("/knowledge/distillation", "knowledge", {
        params: { tab: "distillation" },
      }),
    );
    expect(harness.controller.knowledgeTab.value).toBe("management");

    harness.controller.syncNavigationStateFromRoute(
      makeRoute("/debug/unknown", "debug", { params: { tab: "unknown" } }),
    );
    expect(harness.controller.debugTab.value).toBe("knowledgeRecall");

    harness.controller.syncNavigationStateFromRoute(
      makeRoute("/external-services/unknown", "externalServices", {
        params: { tab: "unknown" },
      }),
    );
    expect(harness.controller.externalServiceTab.value).toBe("list");

    harness.controller.currentView.value = "admin";
    harness.controller.adminView.value = "not-a-real-view" as any;
    expect(harness.controller.viewTitle.value).toBe("管理");

    harness.controller.switchView("dashboard");
    expect(primaryRouter.push).toHaveBeenCalledWith("/");
    expect(secondaryRouter.push).not.toHaveBeenCalled();
  });

  it("normalizes knowledge tab state for empty, invalid, and hidden tabs", () => {
    const harness = createFixture();

    harness.controller.knowledgeTab.value = "" as any;
    harness.controller.knowledgeManagementPanel.value = "rules";
    harness.controller.ensureKnowledgeTabState();
    expect(harness.controller.knowledgeTab.value).toBe("management");
    expect(harness.controller.knowledgeManagementPanel.value).toBe("knowledge");

    harness.controller.knowledgeTab.value = "management";
    harness.controller.knowledgeManagementPanel.value = "invalid" as any;
    harness.controller.ensureKnowledgeTabState();
    expect(harness.controller.knowledgeManagementPanel.value).toBe("knowledge");

    harness.visibleKnowledgeTabs.value = [{ id: "management", label: "知识归档" }];
    harness.controller.knowledgeTab.value = "maintenance" as any;
    harness.controller.knowledgeManagementPanel.value = "rules";
    harness.controller.ensureKnowledgeTabState();
    expect(harness.controller.knowledgeTab.value).toBe("management");
    expect(harness.controller.knowledgeManagementPanel.value).toBe("knowledge");
  });

  it.each([
    {
      name: "falls back to dashboard when knowledge access is disabled",
      setup(harness: ReturnType<typeof createFixture>) {
        harness.controller.bindNavigationRouter(harness.router);
        harness.featureFlags["knowledge-core"] = false;
      },
      run(harness: ReturnType<typeof createFixture>) {
        harness.controller.switchView("knowledge");
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.controller.currentView.value).toBe("dashboard");
        expect(harness.router.push).toHaveBeenCalledWith("/");
      },
    },
    {
      name: "falls back to dashboard when debug tabs are hidden",
      setup(harness: ReturnType<typeof createFixture>) {
        harness.controller.bindNavigationRouter(harness.router);
        harness.visibleDebugTabs.value = [];
      },
      run(harness: ReturnType<typeof createFixture>) {
        harness.controller.switchView("debug");
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.controller.currentView.value).toBe("dashboard");
        expect(harness.router.push).toHaveBeenCalledWith("/");
      },
    },
    {
      name: "selects the first visible debug tab when the current tab is invalid",
      setup(harness: ReturnType<typeof createFixture>) {
        harness.controller.bindNavigationRouter(harness.router);
        harness.controller.debugTab.value = "not-a-real-tab" as any;
      },
      run(harness: ReturnType<typeof createFixture>) {
        harness.controller.switchView("debug");
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.controller.currentView.value).toBe("debug");
        expect(harness.controller.debugTab.value).toBe("knowledgeRecall");
        expect(harness.router.push).toHaveBeenCalledWith("/debug/knowledgeRecall");
        expect(harness.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "refreshes dashboard alerts on dashboard navigation",
      run(harness: ReturnType<typeof createFixture>) {
        harness.controller.bindNavigationRouter(harness.router);
        harness.controller.switchView("dashboard");
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshDashboardAlertsSnapshot).toHaveBeenCalledWith({ silent: true });
      },
    },
    {
      name: "refreshes knowledge and nested views when entering knowledge",
      setup(harness: ReturnType<typeof createFixture>) {
        harness.controller.bindNavigationRouter(harness.router);
        harness.controller.knowledgeTab.value = "management";
        harness.controller.knowledgeManagementPanel.value = "rules";
      },
      run(harness: ReturnType<typeof createFixture>) {
        harness.controller.switchView("knowledge");
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);
        expect(harness.refreshExpertRules).toHaveBeenCalledTimes(1);
      },
    },
  ])("$name", async ({ setup, run, assert }) => {
    const harness = createFixture();
    setup?.(harness);

    await run(harness);

    assert(harness);
  });

  it("covers open tab helpers, invalid inputs, and refresh side effects", async () => {
    const harness = createFixture();
    harness.controller.bindNavigationRouter(harness.router);

    harness.controller.openDebugTab("agentRetrieval");
    expect(harness.router.push).toHaveBeenCalledWith("/debug/agentRetrieval");
    expect(harness.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);
    expect(harness.refreshKnowledgeRecallBackendSpaces).not.toHaveBeenCalled();

    harness.router.push.mockClear();
    harness.controller.openDebugTab("knowledgeRecall");
    expect(harness.router.push).toHaveBeenCalledWith("/debug/knowledgeRecall");
    expect(harness.refreshKnowledgeRecallBackendSpaces).toHaveBeenCalledTimes(1);

    harness.router.push.mockClear();
    harness.controller.openDebugTab("knowledgeDistillation");
    expect(harness.router.push).not.toHaveBeenCalled();

    harness.router.push.mockClear();
    harness.controller.openKnowledgeTab("wordCloud");
    expect(harness.router.push).toHaveBeenCalledWith("/knowledge/wordCloud");
    expect(harness.refreshWordCloud).toHaveBeenCalledTimes(1);

    harness.router.push.mockClear();
    harness.controller.knowledgeManagementPanel.value = "rules";
    harness.controller.openKnowledgeTab("management");
    expect(harness.router.push).toHaveBeenCalledWith("/knowledge/management");
    expect(harness.refreshExpertRules).toHaveBeenCalledTimes(1);

    harness.router.push.mockClear();
    harness.controller.openKnowledgeManagementPanel("invalid" as any);
    expect(harness.router.push).not.toHaveBeenCalled();

    harness.router.push.mockClear();
    harness.controller.openKnowledgeManagementPanel("rules");
    expect(harness.router.push).toHaveBeenCalledWith("/knowledge/management");
    expect(harness.refreshKnowledgeConsole).toHaveBeenCalledTimes(3);
    expect(harness.refreshExpertRules).toHaveBeenCalledTimes(2);
  });

  it("handles admin fallbacks, config targets, drawer fallbacks, and file import jumps", async () => {
    const harness = createFixture();
    harness.controller.bindNavigationRouter(harness.router);

    await harness.controller.openAdmin("toolList", { configTarget: "  runtime-bridge  " });
    expect(harness.controller.currentView.value).toBe("admin");
    expect(harness.controller.adminView.value).toBe("jobs");
    expect(harness.router.push).toHaveBeenCalledWith({
      path: "/admin/jobs",
      query: { configTarget: "runtime-bridge" },
    });
    expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });
    expect(harness.refreshMaintenanceAgent).toHaveBeenCalledWith({ silent: true });
    expect(harness.refreshBackgroundProcesses).toHaveBeenCalledWith({ silent: true });
    expect(harness.refreshMonitorAlerts).toHaveBeenCalledWith({ silent: true });
    expect(harness.ensureAgentPermissionGroupsDraft).not.toHaveBeenCalled();

    harness.router.push.mockClear();
    await harness.controller.openAdmin("agentPermissions", { configTarget: "permission-group" });
    await flushMicrotasks();
    expect(harness.controller.adminView.value).toBe("agentPermissions");
    expect(harness.router.push).toHaveBeenCalledWith({
      path: "/admin/agent-permissions",
      query: { configTarget: "permission-group" },
    });
    expect(harness.refreshToolManagement).toHaveBeenCalledWith({ silent: true });
    expect(harness.ensureAgentPermissionGroupsDraft).toHaveBeenCalledTimes(1);

    await harness.controller.openAgentConfigurationAlert({
      alertId: "agent-1",
      category: "policy",
      title: "Agent assignment",
      detail: "assignment",
      status: "warning",
      tone: "warning",
      view: "admin",
      adminView: "agentAssignment",
      targetId: "agent-group",
    });
    expect(harness.scrollToConfigTarget).not.toHaveBeenCalledWith("agent-group");

    await harness.controller.openAgentConfigurationAlert({
      alertId: "debug-1",
      category: "policy",
      title: "Debug card",
      detail: "debug",
      status: "warning",
      tone: "warning",
      view: "debug",
      targetId: "debug-card",
    });
    expect(harness.scrollToConfigTarget).toHaveBeenCalledWith("debug-card");

    harness.featureFlags["knowledge-core"] = false;
    harness.controller.openDrawer("syncDirectories");
    expect(harness.controller.drawerOpen.value).toBe(true);
    expect(harness.controller.drawerTab.value).toBe("discovery");

    harness.controller.openDrawer("users");
    expect(harness.refreshAuthAdmin).toHaveBeenCalled();

    harness.featureFlags["knowledge-core"] = true;
    harness.error.value = "needs-clear";
    await harness.controller.jumpToKnowledgeFileImport();
    expect(harness.error.value).toBe("");
    expect(harness.controller.currentView.value).toBe("knowledge");
    expect(harness.controller.knowledgeTab.value).toBe("management");
    expect(harness.controller.knowledgeManagementPanel.value).toBe("knowledge");
    expect(harness.router.push).toHaveBeenLastCalledWith("/knowledge/management");
    expect(harness.scrollToConfigTarget).toHaveBeenCalledWith("knowledge-file-import");
  });
});
