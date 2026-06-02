import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import type { Router } from "vue-router";
import {
  adminSectionToSlug,
  isExternalServiceRouteTab,
  knowledgeRouteTabToViewTab,
  slugToAdminView,
  viewToPath,
} from "../router/routes";
import type {
  AdminView,
  AgentConfigurationAlert,
  AppView,
  DebugTab,
  DrawerTab,
  ExternalServiceTab,
  KnowledgeManagementPanel,
  KnowledgeTab,
  RefreshStateOptions,
} from "../types/app";
import { adminViewTitleMap, debugTabs, viewTitleMap } from "./console-defaults";

type LabeledTab<T extends string> = {
  id: T;
  label: string;
};

type RouteLike = {
  meta?: Record<string, unknown>;
  params?: Record<string, unknown>;
  path: string;
};

type SilentRefreshOptions = {
  silent?: boolean;
};

type OpenAdminOptions = {
  configTarget?: string;
};

type ConsoleNavigationControllerOptions = {
  error: Ref<string>;
  ensureAgentPermissionGroupsDraft: () => void;
  hasFeature: (featureId: string) => boolean;
  isAdminViewEnabled: (tab: AdminView) => boolean;
  refreshAuthAdmin: () => void | Promise<void>;
  refreshBackgroundProcesses: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshClientRuntimeStatus: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshContextCompiler: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshDashboardAlertsSnapshot: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshExpertRules: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshKnowledgeConsole: () => void | Promise<void>;
  refreshKnowledgeRecallBackendSpaces: () => void | Promise<void>;
  refreshMaintenanceAgent: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshMonitorAlerts: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshState: (options?: RefreshStateOptions) => void | Promise<void>;
  refreshToolManagement: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshWordCloud: (options?: SilentRefreshOptions) => void | Promise<void>;
  scrollToConfigTarget: (targetId: string) => void | Promise<void>;
  visibleDebugTabs: ComputedRef<LabeledTab<DebugTab>[]>;
  visibleKnowledgeTabs: ComputedRef<LabeledTab<KnowledgeTab>[]>;
};

export function createConsoleNavigationController(options: ConsoleNavigationControllerOptions) {
  const debugTab = ref<DebugTab>("knowledgeRecall");
  const externalServiceTab = ref<ExternalServiceTab>("list");
  const knowledgeTab = ref<KnowledgeTab>("management");
  const knowledgeManagementPanel = ref<KnowledgeManagementPanel>("knowledge");
  const drawerOpen = ref(false);
  const drawerTab = ref<DrawerTab>("discovery");
  const sideNavOpen = ref(false);
  const currentView = ref<AppView>("dashboard");
  const adminView = ref<AdminView>("jobs");
  let appRouter: Pick<Router, "currentRoute" | "push"> | null = null;

  const viewTitle = computed(() => {
    if (currentView.value === "admin") {
      return adminViewTitleMap[adminView.value] || "管理";
    }
    return viewTitleMap[currentView.value] || "";
  });

  function bindNavigationRouter(router: Pick<Router, "currentRoute" | "push">) {
    if (!appRouter) {
      appRouter = router;
    }
    syncNavigationStateFromRoute(router.currentRoute.value);
  }

  function ensureKnowledgeTabState() {
    if (!knowledgeTab.value) {
      knowledgeTab.value = "management";
      knowledgeManagementPanel.value = "knowledge";
      return;
    }
    if (knowledgeTab.value === "management") {
      if (knowledgeManagementPanel.value !== "knowledge" && knowledgeManagementPanel.value !== "rules") {
        knowledgeManagementPanel.value = "knowledge";
      }
      return;
    }
    if (!options.visibleKnowledgeTabs.value.some((item) => item.id === knowledgeTab.value)) {
      knowledgeTab.value = "management";
      knowledgeManagementPanel.value = "knowledge";
    }
  }

  function isKnownDebugRouteTab(value: string): value is DebugTab {
    return debugTabs.some((tab) => tab.id === value);
  }

  function syncNavigationStateFromRoute(route: RouteLike) {
    const viewId = String(route.meta?.viewId ?? "");
    if (viewId) {
      currentView.value = viewId as AppView;
    }

    if (viewId === "admin") {
      const metaAdminView = String(route.meta?.adminView ?? "");
      const slug = String(route.params?.section ?? "") || route.path.split("/").at(-1) || "";
      const nextAdminView = (metaAdminView || slugToAdminView(slug)) as AdminView;
      if (nextAdminView) {
        adminView.value = nextAdminView;
      }
    }

    if (viewId === "knowledge") {
      const tab = String(route.params?.tab ?? "");
      const viewTab = knowledgeRouteTabToViewTab(tab);
      if (viewTab) {
        knowledgeTab.value = viewTab;
      }
    }

    if (viewId === "debug") {
      const tab = String(route.params?.tab ?? "");
      if (isKnownDebugRouteTab(tab)) {
        debugTab.value = tab;
      }
    }

    if (viewId === "externalServices") {
      const tab = String(route.params?.tab ?? "");
      if (isExternalServiceRouteTab(tab)) {
        externalServiceTab.value = tab;
      }
    }
  }

  function closeSideNavOverlay() {
    sideNavOpen.value = false;
  }

  function refreshSystemStatusLogs() {
    void options.refreshState({ silent: true });
    if (options.hasFeature("knowledge-core")) {
      void options.refreshKnowledgeConsole();
    }
    if (options.hasFeature("maintenance-agent-runbooks")) {
      void options.refreshMaintenanceAgent({ silent: true });
    }
    if (options.hasFeature("agent-gateway") || options.hasFeature("agent-management")) {
      void options.refreshToolManagement({ silent: true });
    }
    void options.refreshBackgroundProcesses({ silent: true });
    void options.refreshMonitorAlerts({ silent: true });
    void options.refreshAuthAdmin();
  }

  function refreshAdminSection(tab: AdminView) {
    void options.refreshAuthAdmin();
    if (["tools", "toolList", "toolStats", "agentPermissions"].includes(tab)) {
      void Promise.resolve(options.refreshToolManagement({ silent: true })).then(() => {
        if (tab === "agentPermissions") {
          options.ensureAgentPermissionGroupsDraft();
        }
      });
    }
    if (tab === "contextManagement") {
      void options.refreshContextCompiler({ silent: true });
    }
    if (tab === "maintenanceAgent") {
      void options.refreshMaintenanceAgent();
    }
    if (tab === "jobs") {
      void options.refreshState({ silent: true });
      void options.refreshMaintenanceAgent({ silent: true });
      void options.refreshBackgroundProcesses({ silent: true });
      void options.refreshMonitorAlerts({ silent: true });
    }
    if (tab === "opsMonitor") {
      void options.refreshBackgroundProcesses({ silent: true });
      void options.refreshClientRuntimeStatus({ silent: true });
      void options.refreshMonitorAlerts({ silent: true });
    }
    if (tab === "logs") {
      refreshSystemStatusLogs();
    }
  }

  function switchView(view: AppView) {
    if (view === "knowledge" && !options.hasFeature("knowledge-core")) {
      currentView.value = "dashboard";
      void appRouter?.push("/");
      closeSideNavOverlay();
      return;
    }
    if (view === "debug" && options.visibleDebugTabs.value.length === 0) {
      currentView.value = "dashboard";
      void appRouter?.push("/");
      closeSideNavOverlay();
      return;
    }
    if (view === "debug" && !options.visibleDebugTabs.value.some((item) => item.id === debugTab.value)) {
      debugTab.value = options.visibleDebugTabs.value[0]?.id || "knowledgeRecall";
    }
    if (view === "knowledge") {
      ensureKnowledgeTabState();
    }
    currentView.value = view;
    void appRouter?.push(
      viewToPath(view, {
        tab: view === "externalServices"
          ? externalServiceTab.value
          : view === "knowledge"
            ? knowledgeTab.value
            : view === "debug"
              ? debugTab.value
              : undefined,
        adminSection: view === "admin" ? adminView.value : undefined,
      }),
    );
    closeSideNavOverlay();
    if (view === "dashboard") {
      void options.refreshDashboardAlertsSnapshot({ silent: true });
    }
    if (view === "knowledge") {
      void options.refreshKnowledgeConsole();
      if (knowledgeTab.value === "wordCloud") {
        void options.refreshWordCloud({ silent: true });
      }
      if (knowledgeTab.value === "management" && knowledgeManagementPanel.value === "rules") {
        void options.refreshExpertRules();
      }
    }
    if (view === "debug") {
      void options.refreshKnowledgeConsole();
    }
    if (view === "admin") {
      refreshAdminSection(adminView.value);
    }
  }

  function openDebugTab(tab: DebugTab) {
    if (!options.visibleDebugTabs.value.some((item) => item.id === tab)) {
      return;
    }
    debugTab.value = tab;
    currentView.value = "debug";
    void appRouter?.push(`/debug/${tab}`);
    closeSideNavOverlay();
    void options.refreshKnowledgeConsole();
    if (tab === "knowledgeRecall") {
      void options.refreshKnowledgeRecallBackendSpaces();
    }
  }

  function openKnowledgeTab(tab: KnowledgeTab) {
    if (!options.visibleKnowledgeTabs.value.some((item) => item.id === tab)) {
      return;
    }
    knowledgeTab.value = tab;
    currentView.value = "knowledge";
    void appRouter?.push(`/knowledge/${tab}`);
    closeSideNavOverlay();
    if (tab === "wordCloud") {
      void options.refreshWordCloud();
    }
    if (tab === "management" && knowledgeManagementPanel.value === "rules") {
      void options.refreshExpertRules();
    }
  }

  function openExternalServiceTab(tab: ExternalServiceTab) {
    externalServiceTab.value = tab;
    currentView.value = "externalServices";
    void appRouter?.push(`/external-services/${tab}`);
    closeSideNavOverlay();
  }

  async function jumpToKnowledgeFileImport() {
    options.error.value = "";
    knowledgeTab.value = "management";
    knowledgeManagementPanel.value = "knowledge";
    switchView("knowledge");
    await nextTick();
    await options.scrollToConfigTarget("knowledge-file-import");
  }

  async function openAdmin(tab: AdminView, navigationOptions: OpenAdminOptions = {}) {
    const nextTab = options.isAdminViewEnabled(tab) ? tab : "jobs";
    adminView.value = nextTab;
    currentView.value = "admin";
    closeSideNavOverlay();
    const path = `/admin/${adminSectionToSlug(nextTab)}`;
    const configTarget = String(navigationOptions.configTarget || "").trim();
    await Promise.resolve(
      appRouter?.push(configTarget ? { path, query: { configTarget } } : path),
    );
    refreshAdminSection(nextTab);
  }

  async function openAgentConfigurationAlert(alertItem: AgentConfigurationAlert) {
    if (alertItem.view === "admin") {
      const targetAdminView = alertItem.adminView || "agentConfig";
      await openAdmin(targetAdminView, {
        configTarget: alertItem.targetId,
      });
      if (targetAdminView === "agentAssignment") {
        return;
      }
    } else {
      switchView(alertItem.view);
      await nextTick();
    }
    await options.scrollToConfigTarget(alertItem.targetId);
  }

  function openDrawer(tab: DrawerTab) {
    let nextTab = tab;
    if (nextTab === "modules" && !options.hasFeature("analysis-runtime")) {
      nextTab = "discovery";
    }
    if (nextTab === "syncDirectories" && !options.hasFeature("knowledge-core")) {
      nextTab = "discovery";
    }
    drawerTab.value = nextTab;
    drawerOpen.value = true;
    if (nextTab === "users") {
      void options.refreshAuthAdmin();
    }
  }

  function closeDrawer() {
    drawerOpen.value = false;
  }

  return {
    adminView,
    bindNavigationRouter,
    closeDrawer,
    closeSideNavOverlay,
    currentView,
    debugTab,
    drawerOpen,
    drawerTab,
    ensureKnowledgeTabState,
    externalServiceTab,
    isKnownDebugRouteTab,
    jumpToKnowledgeFileImport,
    knowledgeManagementPanel,
    knowledgeTab,
    openAdmin,
    openAgentConfigurationAlert,
    openDebugTab,
    openDrawer,
    openExternalServiceTab,
    openKnowledgeTab,
    refreshSystemStatusLogs,
    sideNavOpen,
    syncNavigationStateFromRoute,
    switchView,
    viewTitle,
  };
}
