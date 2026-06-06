// @vitest-environment jsdom
import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleShellPageRefreshController } from "../../../server-web/composables/console-shell-page-refresh-controller";

const pageRefreshMock = vi.hoisted(() => ({
  collectPageRefreshTasks: vi.fn(),
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  collectPageRefreshTasks: pageRefreshMock.collectPageRefreshTasks,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFixture() {
  const featureFlags = {
    "knowledge-core": true,
    "maintenance-agent-runbooks": true,
    "agent-gateway": true,
    "agent-management": true,
  };
  const activeRouteAdminView = ref("storage");
  const activeRouteDebugTab = ref("knowledgeRecall");
  const activeRouteKnowledgeTab = ref("management");
  const activeRouteView = ref("dashboard");
  const routeFullPath = ref("/dashboard");
  const msg = computed(() => ({
    actions: {
      refreshing: "Refreshing",
      refreshPage: "Refresh page",
    },
  }));

  const refreshAuthAdmin = vi.fn(async () => undefined);
  const refreshAuthState = vi.fn(async () => undefined);
  const refreshBackgroundProcesses = vi.fn(async () => undefined);
  const refreshClientRuntimeStatus = vi.fn(async () => undefined);
  const refreshCodexOAuthStatus = vi.fn(async () => undefined);
  const refreshContextCompiler = vi.fn(async () => undefined);
  const refreshDashboardAlertsSnapshot = vi.fn(async () => undefined);
  const refreshExpertRules = vi.fn(async () => undefined);
  const refreshKnowledgeConflicts = vi.fn(async () => undefined);
  const refreshKnowledgeConsole = vi.fn(async () => undefined);
  const refreshKnowledgeSources = vi.fn(async () => undefined);
  const refreshMaintenanceAgent = vi.fn(async () => undefined);
  const refreshMcpAuthorizationRequests = vi.fn(async () => undefined);
  const refreshMonitorAlerts = vi.fn(async () => undefined);
  const refreshState = vi.fn(async () => undefined);
  const refreshToolManagement = vi.fn(async () => undefined);
  const refreshWordCloud = vi.fn(async () => undefined);
  const reloadModules = vi.fn(async () => undefined);

  const controller = createConsoleShellPageRefreshController({
    activeRouteAdminView,
    activeRouteDebugTab,
    activeRouteKnowledgeTab,
    activeRouteView,
    hasFeature: vi.fn((featureId: string) => featureFlags[featureId as keyof typeof featureFlags] ?? false),
    msg,
    refreshAuthAdmin,
    refreshAuthState,
    refreshBackgroundProcesses,
    refreshClientRuntimeStatus,
    refreshCodexOAuthStatus,
    refreshContextCompiler,
    refreshDashboardAlertsSnapshot,
    refreshExpertRules,
    refreshKnowledgeConflicts,
    refreshKnowledgeConsole,
    refreshKnowledgeSources,
    refreshMaintenanceAgent,
    refreshMcpAuthorizationRequests,
    refreshMonitorAlerts,
    refreshState,
    refreshToolManagement,
    refreshWordCloud,
    reloadModules,
    routeFullPath,
  });

  return {
    activeRouteAdminView,
    activeRouteDebugTab,
    activeRouteKnowledgeTab,
    activeRouteView,
    controller,
    featureFlags,
    msg,
    refreshAuthAdmin,
    refreshAuthState,
    refreshBackgroundProcesses,
    refreshClientRuntimeStatus,
    refreshCodexOAuthStatus,
    refreshContextCompiler,
    refreshDashboardAlertsSnapshot,
    refreshExpertRules,
    refreshKnowledgeConflicts,
    refreshKnowledgeConsole,
    refreshKnowledgeSources,
    refreshMaintenanceAgent,
    refreshMcpAuthorizationRequests,
    refreshMonitorAlerts,
    refreshState,
    refreshToolManagement,
    refreshWordCloud,
    reloadModules,
    routeFullPath,
  };
}

describe("console shell page refresh controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageRefreshMock.collectPageRefreshTasks.mockReset();
    pageRefreshMock.collectPageRefreshTasks.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: "dashboard refreshes the alert snapshot with a visible refresh",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "dashboard";
        harness.routeFullPath.value = "/dashboard";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshDashboardAlertsSnapshot).toHaveBeenCalledWith({ silent: false });
      },
    },
    {
      name: "approval refreshes authorization requests and knowledge conflicts together",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "approval";
        harness.routeFullPath.value = "/approval";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshMcpAuthorizationRequests).toHaveBeenCalledTimes(1);
        expect(harness.refreshKnowledgeConflicts).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "feed refreshes state silently",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "feed";
        harness.routeFullPath.value = "/feed";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });
      },
    },
    {
      name: "sources refreshes sources, runtime status, and state silently",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "sources";
        harness.routeFullPath.value = "/sources";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshKnowledgeSources).toHaveBeenCalledTimes(1);
        expect(harness.refreshClientRuntimeStatus).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });
      },
    },
    {
      name: "workspaces refreshes auth state",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "workspaces";
        harness.routeFullPath.value = "/workspaces";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshAuthState).toHaveBeenCalledTimes(1);
      },
    },
  ])("$name", async ({ configure, assert }) => {
    const harness = createFixture();
    configure(harness);

    const pending = harness.controller.refreshCurrentPage();

    expect(harness.controller.pageRefreshBusy.value).toBe(true);
    expect(harness.controller.pageRefreshTitle.value).toBe("Refreshing...");
    expect(harness.controller.pageRefreshAriaLabel.value).toBe("Refreshing");
    expect(pageRefreshMock.collectPageRefreshTasks).toHaveBeenCalledWith({
      viewId: harness.activeRouteView.value,
      adminView: harness.activeRouteAdminView.value,
      knowledgeTab: harness.activeRouteKnowledgeTab.value,
      debugTab: harness.activeRouteDebugTab.value,
      routePath: harness.routeFullPath.value,
    });

    await pending;

    assert(harness);
    expect(harness.controller.pageRefreshBusy.value).toBe(false);
    expect(harness.controller.pageRefreshTitle.value).toBe("Refresh page");
    expect(harness.controller.pageRefreshAriaLabel.value).toBe("Refresh page");
  });

  it.each([
    {
      name: "knowledge word cloud refreshes the word cloud only",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "knowledge";
        harness.activeRouteKnowledgeTab.value = "wordCloud";
        harness.routeFullPath.value = "/knowledge/word-cloud";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshWordCloud).toHaveBeenCalledTimes(1);
        expect(harness.refreshExpertRules).not.toHaveBeenCalled();
        expect(harness.refreshKnowledgeConsole).not.toHaveBeenCalled();
      },
    },
    {
      name: "knowledge maintenance refreshes expert rules with draft forcing",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "knowledge";
        harness.activeRouteKnowledgeTab.value = "maintenance";
        harness.routeFullPath.value = "/knowledge/maintenance";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshExpertRules).toHaveBeenCalledWith({ forceDrafts: true });
        expect(harness.refreshWordCloud).not.toHaveBeenCalled();
      },
    },
    {
      name: "knowledge default refreshes the console",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "knowledge";
        harness.activeRouteKnowledgeTab.value = "management";
        harness.routeFullPath.value = "/knowledge/management";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);
      },
    },
  ])("$name", async ({ configure, assert }) => {
    const harness = createFixture();
    configure(harness);

    await harness.controller.refreshCurrentPage();

    assert(harness);
  });

  it.each([
    {
      name: "admin storage refreshes auth, modules, and state with forceDrafts disabled",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "storage";
        harness.routeFullPath.value = "/admin/storage";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshAuthAdmin).toHaveBeenCalledTimes(1);
        expect(harness.reloadModules).toHaveBeenCalledTimes(1);
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true, forceDrafts: false });
      },
    },
    {
      name: "admin jobs refreshes state with draft forcing and silent subsystem refreshes",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "jobs";
        harness.routeFullPath.value = "/admin/jobs";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true, forceDrafts: true });
        expect(harness.refreshMaintenanceAgent).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshMonitorAlerts).toHaveBeenCalledWith({ silent: true });
      },
    },
    {
      name: "admin logs refreshes optional controllers when features are enabled",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "logs";
        harness.routeFullPath.value = "/admin/logs";
        harness.featureFlags["knowledge-core"] = true;
        harness.featureFlags["maintenance-agent-runbooks"] = true;
        harness.featureFlags["agent-gateway"] = true;
        harness.featureFlags["agent-management"] = false;
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);
        expect(harness.refreshMaintenanceAgent).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshToolManagement).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshBackgroundProcesses).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshMonitorAlerts).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshAuthAdmin).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "admin logs skips optional controllers when features are disabled",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "logs";
        harness.routeFullPath.value = "/admin/logs";
        harness.featureFlags["knowledge-core"] = false;
        harness.featureFlags["maintenance-agent-runbooks"] = false;
        harness.featureFlags["agent-gateway"] = false;
        harness.featureFlags["agent-management"] = false;
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshKnowledgeConsole).not.toHaveBeenCalled();
        expect(harness.refreshMaintenanceAgent).not.toHaveBeenCalled();
        expect(harness.refreshToolManagement).not.toHaveBeenCalled();
      },
    },
    {
      name: "admin ops monitor refreshes all three silent controllers",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "opsMonitor";
        harness.routeFullPath.value = "/admin/ops-monitor";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshBackgroundProcesses).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshClientRuntimeStatus).toHaveBeenCalledWith({ silent: true });
        expect(harness.refreshMonitorAlerts).toHaveBeenCalledWith({ silent: true });
      },
    },
    {
      name: "admin production health is a no-op refresh branch",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "productionHealth";
        harness.routeFullPath.value = "/admin/production-health";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshState).not.toHaveBeenCalled();
        expect(harness.refreshAuthAdmin).not.toHaveBeenCalled();
        expect(harness.reloadModules).not.toHaveBeenCalled();
      },
    },
    {
      name: "admin clients refreshes state silently",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "clients";
        harness.routeFullPath.value = "/admin/clients";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });
      },
    },
    {
      name: "admin tools refreshes tool management",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "tools";
        harness.routeFullPath.value = "/admin/tools";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshToolManagement).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "admin modules reloads modules",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "modules";
        harness.routeFullPath.value = "/admin/modules";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.reloadModules).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "admin agent permissions refreshes auth and tool management",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "agentPermissions";
        harness.routeFullPath.value = "/admin/agent-permissions";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshAuthAdmin).toHaveBeenCalledTimes(1);
        expect(harness.refreshToolManagement).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "admin agent config refreshes codex oauth status",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "agentConfig";
        harness.routeFullPath.value = "/admin/agent-config";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshCodexOAuthStatus).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "admin context management refreshes the context compiler",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "contextManagement";
        harness.routeFullPath.value = "/admin/context-management";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshContextCompiler).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "admin maintenance agent refreshes the maintenance agent",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "admin";
        harness.activeRouteAdminView.value = "maintenanceAgent";
        harness.routeFullPath.value = "/admin/maintenance-agent";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshMaintenanceAgent).toHaveBeenCalledTimes(1);
      },
    },
    {
      name: "unknown routes fall back to silent state refresh",
      configure(harness: ReturnType<typeof createFixture>) {
        harness.activeRouteView.value = "externalServices";
        harness.activeRouteAdminView.value = "";
        harness.routeFullPath.value = "/external-services";
      },
      assert(harness: ReturnType<typeof createFixture>) {
        expect(harness.refreshState).toHaveBeenCalledWith({ silent: true });
      },
    },
  ])("$name", async ({ configure, assert }) => {
    const harness = createFixture();
    configure(harness);

    await harness.controller.refreshCurrentPage();

    assert(harness);
  });

  it("waits for concurrent refresh promises, ignores reentry while busy, and clears busy state after a failure", async () => {
    const harness = createFixture();
    const routeRefresh = deferred<void>();
    const taskRefresh = deferred<void>();
    const taskFailure = Promise.resolve().then(() => {
      throw new Error("page task failed");
    });

    harness.activeRouteView.value = "dashboard";
    harness.routeFullPath.value = "/dashboard";
    pageRefreshMock.collectPageRefreshTasks.mockReturnValueOnce([taskRefresh.promise, Promise.resolve()]);
    harness.refreshDashboardAlertsSnapshot.mockReturnValueOnce(routeRefresh.promise);

    const firstPending = harness.controller.refreshCurrentPage();

    expect(harness.controller.pageRefreshBusy.value).toBe(true);
    expect(harness.refreshDashboardAlertsSnapshot).toHaveBeenCalledTimes(1);
    expect(pageRefreshMock.collectPageRefreshTasks).toHaveBeenCalledTimes(1);

    const secondPending = harness.controller.refreshCurrentPage();
    await expect(secondPending).resolves.toBeUndefined();
    expect(harness.refreshDashboardAlertsSnapshot).toHaveBeenCalledTimes(1);
    expect(pageRefreshMock.collectPageRefreshTasks).toHaveBeenCalledTimes(1);

    taskRefresh.resolve(undefined);
    routeRefresh.resolve(undefined);
    await firstPending;

    expect(harness.controller.pageRefreshBusy.value).toBe(false);

    harness.refreshDashboardAlertsSnapshot.mockReset();
    pageRefreshMock.collectPageRefreshTasks.mockReset();
    pageRefreshMock.collectPageRefreshTasks.mockReturnValueOnce([taskFailure]);

    const failingPending = harness.controller.refreshCurrentPage();

    await expect(failingPending).rejects.toThrow("page task failed");
    expect(harness.controller.pageRefreshBusy.value).toBe(false);
  });
});
