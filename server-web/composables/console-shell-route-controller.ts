import { computed, type ComputedRef, type Ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import type { consoleMessages } from "../i18n/console";

type ConsoleShellRouteMessages = (typeof consoleMessages)[keyof typeof consoleMessages];

type LabeledTab = {
  id: string;
  label: string;
};

type ConsoleShellRouteControllerOptions = {
  adminView: Ref<string>;
  currentView: Ref<string>;
  debugTab: Ref<string>;
  externalServiceTab: Ref<string>;
  knowledgeTab: Ref<string>;
  msg: ComputedRef<ConsoleShellRouteMessages>;
  route: RouteLocationNormalizedLoaded;
};

function adminRouteTitle(adminView: string, messages: ConsoleShellRouteMessages) {
  switch (adminView) {
    case "agentPermissions":
      return messages.nav.permissionGroups;
    case "tools":
    case "toolList":
      return messages.nav.toolList;
    case "toolGovernance":
      return messages.nav.toolGovernance;
    case "toolStats":
      return messages.nav.toolStats;
    case "agentConfig":
      return messages.nav.agentConfig;
    case "agentAssignment":
      return messages.nav.agentAssignment;
    case "contextManagement":
      return messages.nav.contextManagement;
    case "maintenanceAgent":
      return messages.nav.maintenanceAgent;
    case "clients":
      return messages.nav.devices;
    case "jobs":
      return messages.nav.jobs;
    case "logs":
      return messages.nav.logs;
    case "opsMonitor":
      return messages.nav.opsMonitor;
    case "runtimeDownloads":
      return messages.nav.runtimeDownloads;
    case "strategyManagement":
      return messages.nav.strategyManagement;
    case "versionRelease":
      return messages.nav.versionRelease;
    case "versionAssembly":
      return messages.nav.versionAssembly;
    case "productionHealth":
      return messages.nav.productionHealth;
    case "modules":
      return messages.title.modules;
    case "storage":
      return messages.title.storage;
    default:
      return messages.title.admin;
  }
}

function routeViewTitle(view: string, messages: ConsoleShellRouteMessages) {
  switch (view) {
    case "dashboard":
      return messages.nav.dashboard;
    case "feed":
      return messages.nav.feed;
    case "approval":
      return messages.nav.approvalFlow;
    case "sources":
      return messages.nav.sources;
    case "externalServices":
      return messages.nav.externalServices;
    case "knowledge":
      return messages.nav.knowledge;
    case "workspaces":
      return messages.nav.workspaces;
    case "debug":
      return messages.nav.debugPanel;
    default:
      return "";
  }
}

export function createConsoleShellRouteController(options: ConsoleShellRouteControllerOptions) {
  const activeRouteView = computed(() => String(options.route.meta?.viewId || options.currentView.value));
  const activeRouteKnowledgeTab = computed(() => String(options.route.params.tab || options.knowledgeTab.value));
  const activeRouteDebugTab = computed(() => String(options.route.params.tab || options.debugTab.value));
  const activeRouteExternalServiceTab = computed(() => String(options.route.params.tab || options.externalServiceTab.value));
  const activeRouteAdminView = computed(() => String(options.route.meta?.adminView || options.adminView.value));
  const activeRouteFullPath = computed(() => options.route.fullPath);

  const localizedViewTitle = computed(() => {
    const messages = options.msg.value;
    if (activeRouteView.value === "admin") {
      return adminRouteTitle(activeRouteAdminView.value, messages);
    }
    return routeViewTitle(activeRouteView.value, messages);
  });

  function localizedKnowledgeTabLabel(tab: LabeledTab) {
    switch (tab.id) {
      case "management":
        return options.msg.value.nav.knowledgeArchive;
      case "wordCloud":
        return options.msg.value.nav.corpusAnalysis;
      case "maintenance":
        return options.msg.value.nav.parameterConfig;
      default:
        return tab.label;
    }
  }

  function localizedDebugTabLabel(tab: LabeledTab) {
    switch (tab.id) {
      case "knowledgeRecall":
        return options.msg.value.nav.knowledgeRecall;
      case "agentRetrieval":
        return options.msg.value.nav.agentRetrieval;
      case "knowledgeDistillation":
        return options.msg.value.nav.knowledgeDistillation;
      default:
        return tab.label;
    }
  }

  function localizedExternalServiceTabLabel(tab: LabeledTab) {
    switch (tab.id) {
      case "config":
        return options.msg.value.nav.externalServiceConfig;
      case "list":
        return options.msg.value.nav.externalServiceList;
      default:
        return tab.label;
    }
  }

  return {
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
  };
}
