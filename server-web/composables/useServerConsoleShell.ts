import { computed, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useConsole } from "./useConsole";
import { pickServerConsoleShellPublicContext } from "./console-shell-public-context";
import { pickAgentRetrievalShellContext } from "./console-shell-agent-retrieval-context";
import { pickApprovalFlowShellContext } from "./console-shell-approval-flow-context";
import { pickDebugShellContext } from "./console-shell-debug-context";
import { pickFeedShellContext } from "./console-shell-feed-context";
import { pickKnowledgeShellContext } from "./console-shell-knowledge-context";
import { createConsoleShellPageRefreshController } from "./console-shell-page-refresh-controller";
import { useConsoleShellPreferences } from "./console-shell-preferences";
import { createConsoleShellRouteController } from "./console-shell-route-controller";
import { pickToolManagementShellContext } from "./console-shell-tool-management-context";
import { useWorkspacesConsole } from "./useWorkspacesConsole";

export function useServerConsoleShell() {
  const {
    appearancePresetId,
    appearancePresetCatalogMessage,
    appearancePresetImporting,
    appearanceCycleScheme,
    appearanceCycleSchemeLabel,
    appearanceCycleSchemeOptions,
    appearancePresetLabel,
    appearancePresetSelectionId,
    languageMode,
    languageOptionBarOptions,
    appearancePresetOptionsForCycleScheme,
    appearancePresetOptions,
    msg,
    applyAppearancePreset,
    cycleAppearancePreset,
    toggleAppearanceCycleScheme,
    importAppearancePresetFileToServer,
    refreshAppearancePresetConfigs,
    applyLanguage,
    setAppearanceCycleScheme,
    setAppearancePreset,
    setLanguage,
    toggleLanguage,
    tt,
  } = useConsoleShellPreferences();

  const consoleContext = useConsole();
  const agentRetrievalConsole = pickAgentRetrievalShellContext(consoleContext);
  const approvalFlowConsole = pickApprovalFlowShellContext(consoleContext);
  const debugConsole = pickDebugShellContext(consoleContext);
  const feedConsole = pickFeedShellContext(consoleContext);
  const knowledgeDomainConsole = pickKnowledgeShellContext(consoleContext);
  const toolManagementConsole = pickToolManagementShellContext(consoleContext);
  const publicConsoleContext = pickServerConsoleShellPublicContext(consoleContext);
  const {
    adminView,
    busyKey,
    consoleState,
    currentView,
    debugTab,
    externalServiceTab,
    hasFeature,
    isAuthenticated,
    knowledgeTab,
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
    serverAvailable,
  } = publicConsoleContext;
  const workspacesConsole = useWorkspacesConsole({ autoload: false, globalBusyKey: busyKey });

  const route = useRoute();
  const {
    activeRouteAdminView,
    activeRouteDebugTab,
    activeRouteExternalServiceTab,
    activeRouteFullPath,
    activeRouteKnowledgeTab,
    activeRouteView,
    localizedDebugTabLabel,
    localizedExternalServiceTabLabel,
    localizedKnowledgeTabLabel,
    localizedViewTitle,
  } = createConsoleShellRouteController({
    adminView,
    currentView,
    debugTab,
    externalServiceTab,
    knowledgeTab,
    msg,
    route,
  });
  const serviceUrl = computed(() => consoleState.value?.server.url || msg.value.connecting);
  const serviceStatusLabel = computed(() =>
    serverAvailable.value ? msg.value.topbar.serverAvailable : msg.value.topbar.serverUnavailable
  );
  const {
    pageRefreshAriaLabel,
    pageRefreshBusy,
    pageRefreshTitle,
    refreshCurrentPage,
    trackPageRefreshTask,
  } = createConsoleShellPageRefreshController({
    activeRouteAdminView,
    activeRouteDebugTab,
    activeRouteKnowledgeTab,
    activeRouteView,
    busyKey,
    hasFeature,
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
    routeFullPath: activeRouteFullPath,
  });

  let toolListRouteRefreshSequence = 0;
  const isToolListRoute = computed(() =>
    activeRouteView.value === "admin" && ["tools", "toolList"].includes(activeRouteAdminView.value),
  );
  const toolManagementCatalogLoaded = computed(() => {
    const catalog = toolManagementConsole.toolManagementCatalogState.value;
    return Boolean(
      catalog?.fingerprint ||
      catalog?.toolGroups?.length ||
      catalog?.toolsets?.length ||
      catalog?.tools?.length,
    );
  });

  async function refreshToolListRouteOnEntry(sequence: number, routePath: string) {
    await trackPageRefreshTask(refreshToolManagement({ silent: true }));
    if (sequence !== toolListRouteRefreshSequence || activeRouteFullPath.value !== routePath) {
      return;
    }
    if (!toolManagementCatalogLoaded.value) {
      return;
    }
    await nextTick();
    if (sequence !== toolListRouteRefreshSequence || activeRouteFullPath.value !== routePath) {
      return;
    }
    await refreshCurrentPage();
  }

  watch(
    [isAuthenticated, isToolListRoute, activeRouteFullPath],
    ([authenticated, shouldRefresh, routePath]) => {
      if (!authenticated || !shouldRefresh) {
        return;
      }
      const sequence = ++toolListRouteRefreshSequence;
      void refreshToolListRouteOnEntry(sequence, routePath);
    },
    { immediate: true },
  );

  return {
    ...publicConsoleContext,
    agentRetrievalConsole,
    approvalFlowConsole,
    debugConsole,
    feedConsole,
    knowledgeDomainConsole,
    toolManagementConsole,
    workspacesConsole,
    appearancePresetId,
    appearancePresetCatalogMessage,
    appearancePresetImporting,
    appearanceCycleScheme,
    appearanceCycleSchemeLabel,
    appearanceCycleSchemeOptions,
    appearancePresetLabel,
    appearancePresetSelectionId,
    languageMode,
    languageOptionBarOptions,
    appearancePresetOptionsForCycleScheme,
    appearancePresetOptions,
    msg,
    applyAppearancePreset,
    cycleAppearancePreset,
    toggleAppearanceCycleScheme,
    importAppearancePresetFileToServer,
    refreshAppearancePresetConfigs,
    applyLanguage,
    setAppearanceCycleScheme,
    setAppearancePreset,
    setLanguage,
    toggleLanguage,
    tt,
    activeRouteView,
    activeRouteKnowledgeTab,
    activeRouteDebugTab,
    activeRouteExternalServiceTab,
    activeRouteAdminView,
    serviceUrl,
    serviceStatusLabel,
    pageRefreshBusy,
    pageRefreshTitle,
    pageRefreshAriaLabel,
    refreshCurrentPage,
    localizedViewTitle,
    localizedKnowledgeTabLabel,
    localizedDebugTabLabel,
    localizedExternalServiceTabLabel,
  };
}
