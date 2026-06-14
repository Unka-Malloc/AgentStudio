import { computed, ref, type ComputedRef } from "vue";
import { collectPageRefreshTasks } from "./usePageRefresh";

type MaybePromise<T> = T | Promise<T>;

type RefreshStateOptions = {
  forceDrafts?: boolean;
  silent?: boolean;
};

type SilentRefreshOptions = {
  silent?: boolean;
};

type PageRefreshMessages = {
  actions: {
    refreshing: string;
    refreshPage: string;
  };
};

type ConsoleShellPageRefreshControllerOptions = {
  activeRouteAdminView: ComputedRef<string>;
  activeRouteDebugTab: ComputedRef<string>;
  activeRouteKnowledgeTab: ComputedRef<string>;
  activeRouteView: ComputedRef<string>;
  busyKey: ComputedRef<string>;
  hasFeature: (featureId: string) => boolean;
  msg: ComputedRef<PageRefreshMessages>;
  refreshAuthAdmin: () => MaybePromise<unknown>;
  refreshAuthState: () => MaybePromise<unknown>;
  refreshBackgroundProcesses: (options?: SilentRefreshOptions) => MaybePromise<unknown>;
  refreshClientRuntimeStatus: (options?: SilentRefreshOptions) => MaybePromise<unknown>;
  refreshCodexOAuthStatus: () => MaybePromise<unknown>;
  refreshContextCompiler: () => MaybePromise<unknown>;
  refreshDashboardAlertsSnapshot: (options?: SilentRefreshOptions) => MaybePromise<unknown>;
  refreshExpertRules: (options?: RefreshStateOptions) => MaybePromise<unknown>;
  refreshKnowledgeConflicts: () => MaybePromise<unknown>;
  refreshKnowledgeConsole: () => MaybePromise<unknown>;
  refreshKnowledgeSources: () => MaybePromise<unknown>;
  refreshMaintenanceAgent: (options?: SilentRefreshOptions) => MaybePromise<unknown>;
  refreshMcpAuthorizationRequests: () => MaybePromise<unknown>;
  refreshMonitorAlerts: (options?: SilentRefreshOptions) => MaybePromise<unknown>;
  refreshState: (options?: RefreshStateOptions) => MaybePromise<unknown>;
  refreshToolManagement: (options?: SilentRefreshOptions) => MaybePromise<unknown>;
  refreshWordCloud: () => MaybePromise<unknown>;
  reloadModules: () => MaybePromise<unknown>;
  routeFullPath: ComputedRef<string>;
};

async function waitForPageRefreshTasks(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) {
    throw failed.reason;
  }
}

export function createConsoleShellPageRefreshController(options: ConsoleShellPageRefreshControllerOptions) {
  const pageRefreshPendingCount = ref(0);
  const pageRefreshActionBusy = computed(() => pageRefreshPendingCount.value > 0);
  const pageRefreshBusy = computed(() =>
    pageRefreshActionBusy.value || Boolean(options.busyKey.value),
  );
  const pageRefreshTitle = computed(() =>
    pageRefreshBusy.value ? `${options.msg.value.actions.refreshing}...` : options.msg.value.actions.refreshPage,
  );
  const pageRefreshAriaLabel = computed(() =>
    pageRefreshBusy.value ? options.msg.value.actions.refreshing : options.msg.value.actions.refreshPage,
  );

  async function trackPageRefreshTask<T>(task: MaybePromise<T>): Promise<T> {
    pageRefreshPendingCount.value += 1;
    try {
      return await task;
    } finally {
      pageRefreshPendingCount.value = Math.max(0, pageRefreshPendingCount.value - 1);
    }
  }

  async function refreshAdminRoute() {
    switch (options.activeRouteAdminView.value) {
      case "storage":
        await Promise.all([
          options.refreshAuthAdmin(),
          options.reloadModules(),
          options.refreshState({ silent: true, forceDrafts: false }),
        ]);
        return;
      case "jobs":
        await Promise.all([
          options.refreshState({ silent: true, forceDrafts: true }),
          options.refreshMaintenanceAgent({ silent: true }),
          options.refreshMonitorAlerts({ silent: true }),
        ]);
        return;
      case "logs":
        await Promise.all([
          options.refreshState({ silent: true }),
          options.hasFeature("knowledge-core") ? options.refreshKnowledgeConsole() : Promise.resolve(),
          options.hasFeature("maintenance-agent-runbooks")
            ? options.refreshMaintenanceAgent({ silent: true })
            : Promise.resolve(),
          options.hasFeature("agent-gateway") || options.hasFeature("agent-management")
            ? options.refreshToolManagement({ silent: true })
            : Promise.resolve(),
          options.refreshBackgroundProcesses({ silent: true }),
          options.refreshMonitorAlerts({ silent: true }),
          options.refreshAuthAdmin(),
        ]);
        return;
      case "opsMonitor":
        await Promise.all([
          options.refreshBackgroundProcesses({ silent: true }),
          options.refreshMonitorAlerts({ silent: true }),
        ]);
        return;
      case "productionHealth":
        return;
      case "strategyManagement":
        return;
      case "versionRelease":
        return;
      case "versionAssembly":
        return;
      case "clients":
        await options.refreshState({ silent: true });
        return;
      case "tools":
      case "toolList":
      case "toolGovernance":
      case "toolStats":
        await options.refreshToolManagement();
        return;
      case "modules":
        await options.reloadModules();
        return;
      case "agentPermissions":
        await Promise.all([
          options.refreshAuthAdmin(),
          options.refreshToolManagement(),
        ]);
        return;
      case "agentConfig":
      case "agentAssignment":
        await options.refreshCodexOAuthStatus();
        return;
      case "contextManagement":
        await options.refreshContextCompiler();
        return;
      case "maintenanceAgent":
        await options.refreshMaintenanceAgent();
        return;
      default:
        await options.refreshState({ silent: true });
    }
  }

  async function refreshCurrentRouteDefaults() {
    switch (options.activeRouteView.value) {
      case "dashboard":
        await options.refreshDashboardAlertsSnapshot({ silent: false });
        return;
      case "approval":
        await Promise.all([
          options.refreshMcpAuthorizationRequests(),
          options.refreshKnowledgeConflicts(),
        ]);
        return;
      case "feed":
        await options.refreshState({ silent: true });
        return;
      case "sources":
        await Promise.all([
          options.refreshKnowledgeSources(),
          options.refreshClientRuntimeStatus({ silent: true }),
          options.refreshState({ silent: true }),
        ]);
        return;
      case "workspaces":
        await options.refreshAuthState();
        return;
      case "knowledge":
        if (options.activeRouteKnowledgeTab.value === "wordCloud") {
          await options.refreshWordCloud();
          return;
        }
        if (options.activeRouteKnowledgeTab.value === "maintenance") {
          await options.refreshExpertRules({ forceDrafts: true });
          return;
        }
        await options.refreshKnowledgeConsole();
        return;
      case "debug":
        await options.refreshKnowledgeConsole();
        return;
      case "admin":
        await refreshAdminRoute();
        return;
      default:
        await options.refreshState({ silent: true });
    }
  }

  async function refreshCurrentPage() {
    if (pageRefreshActionBusy.value) {
      return;
    }
    await trackPageRefreshTask((async () => {
      const pageTasks = collectPageRefreshTasks({
        viewId: options.activeRouteView.value,
        adminView: options.activeRouteAdminView.value,
        knowledgeTab: options.activeRouteKnowledgeTab.value,
        debugTab: options.activeRouteDebugTab.value,
        routePath: options.routeFullPath.value,
      });
      await waitForPageRefreshTasks([
        Promise.resolve(refreshCurrentRouteDefaults()),
        ...pageTasks,
      ]);
    })());
  }

  return {
    pageRefreshAriaLabel,
    pageRefreshBusy,
    pageRefreshTitle,
    refreshCurrentPage,
    trackPageRefreshTask,
  };
}
