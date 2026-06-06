import { computed } from 'vue';
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

export function useServerConsoleShell() {
  const {
    themeMode,
    languageMode,
    languageOptionBarOptions,
    msg,
    applyTheme,
    cycleTheme,
    applyLanguage,
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
    consoleState,
    currentView,
    debugTab,
    externalServiceTab,
    hasFeature,
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
  } = createConsoleShellPageRefreshController({
    activeRouteAdminView,
    activeRouteDebugTab,
    activeRouteKnowledgeTab,
    activeRouteView,
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

  return {
    ...publicConsoleContext,
    agentRetrievalConsole,
    approvalFlowConsole,
    debugConsole,
    feedConsole,
    knowledgeDomainConsole,
    toolManagementConsole,
    themeMode,
    languageMode,
    languageOptionBarOptions,
    msg,
    applyTheme,
    cycleTheme,
    applyLanguage,
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
