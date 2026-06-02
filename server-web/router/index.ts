import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import { isExternalServiceRouteTab, isKnowledgeRouteTab } from "./routes";
export type { AdminSection, DebugTab, ExternalServiceTab, KnowledgeTab } from "./routes";
export { adminSectionToSlug, slugToAdminView, viewToPath } from "./routes";

const validDebugTabs = new Set(["knowledgeRecall", "agentRetrieval", "knowledgeDistillation"]);

const routes: RouteRecordRaw[] = [
  // Agent workspace
  { path: "/workspaces", component: () => import("../views/WorkspacesView.vue"), meta: { viewId: "workspaces" } },

  // Core views
  { path: "/", component: () => import("../views/DashboardView.vue"), meta: { viewId: "dashboard" } },
  { path: "/feed", component: () => import("../views/FeedView.vue"), meta: { viewId: "feed" } },
  { path: "/approval", component: () => import("../views/ApprovalFlowView.vue"), meta: { viewId: "approval" } },
  { path: "/sources", component: () => import("../views/SourcesView.vue"), meta: { viewId: "sources" } },
  { path: "/intelligence", redirect: "/" },

  // External service management
  { path: "/external-services", redirect: "/external-services/list" },
  {
    path: "/external-services/:tab",
    component: () => import("../views/ExternalServicesView.vue"),
    beforeEnter: (to) =>
      isExternalServiceRouteTab(String(to.params.tab)) ? true : "/external-services/list",
    meta: { viewId: "externalServices" },
  },

  // Knowledge sub-tabs
  { path: "/knowledge", redirect: "/knowledge/management" },
  {
    path: "/knowledge/:tab",
    component: () => import("../views/KnowledgeView.vue"),
    beforeEnter: (to) =>
      isKnowledgeRouteTab(String(to.params.tab)) ? true : "/knowledge/management",
    meta: { viewId: "knowledge" },
  },

  // Debug sub-tabs
  {
    path: "/debug",
    redirect: "/debug/knowledgeRecall",
  },
  {
    path: "/debug/:tab",
    component: () => import("../views/DebugView.vue"),
    beforeEnter: (to) =>
      validDebugTabs.has(String(to.params.tab)) ? true : "/debug/knowledgeRecall",
    meta: { viewId: "debug" },
  },

  // Admin views
  { path: "/admin", redirect: "/admin/storage" },
  { path: "/admin/storage", component: () => import("../views/admin/StorageView.vue"), meta: { viewId: "admin", adminView: "storage" } },
  { path: "/admin/jobs", component: () => import("../views/admin/JobsView.vue"), meta: { viewId: "admin", adminView: "jobs" } },
  { path: "/admin/logs", component: () => import("../views/admin/LogsView.vue"), meta: { viewId: "admin", adminView: "logs" } },
  { path: "/admin/ops-monitor", component: () => import("../views/admin/OpsMonitorView.vue"), meta: { viewId: "admin", adminView: "opsMonitor" } },
  { path: "/admin/runtime-downloads", component: () => import("../views/admin/RuntimeDownloadsView.vue"), meta: { viewId: "admin", adminView: "runtimeDownloads" } },
  { path: "/admin/production-health", component: () => import("../views/admin/ProductionHealthView.vue"), meta: { viewId: "admin", adminView: "productionHealth" } },
  { path: "/admin/clients", component: () => import("../views/admin/ClientsView.vue"), meta: { viewId: "admin", adminView: "clients" } },
  { path: "/admin/tools", redirect: "/admin/tool-list" },
  { path: "/admin/tool-list", component: () => import("../views/admin/ToolsView.vue"), meta: { viewId: "admin", adminView: "toolList" } },
  { path: "/admin/tool-stats", component: () => import("../views/admin/ToolsView.vue"), meta: { viewId: "admin", adminView: "toolStats" } },
  { path: "/admin/modules", component: () => import("../views/admin/ModulesView.vue"), meta: { viewId: "admin", adminView: "modules" } },
  { path: "/admin/agent-management", redirect: "/admin/agent-config" },
  { path: "/admin/agent-permissions", component: () => import("../views/admin/AgentPermissionsView.vue"), meta: { viewId: "admin", adminView: "agentPermissions" } },
  { path: "/admin/agent-config", component: () => import("../views/admin/AgentConfigView.vue"), meta: { viewId: "admin", adminView: "agentConfig" } },
  { path: "/admin/agent-assignment", component: () => import("../views/admin/AgentAssignmentView.vue"), meta: { viewId: "admin", adminView: "agentAssignment" } },
  { path: "/admin/context-management", component: () => import("../views/admin/ContextManagementView.vue"), meta: { viewId: "admin", adminView: "contextManagement" } },
  { path: "/admin/maintenance-agent", component: () => import("../views/admin/MaintenanceAgentView.vue"), meta: { viewId: "admin", adminView: "maintenanceAgent" } },

  // Catch-all → dashboard
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  // Hash history works without server-side routing configuration
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  if (to.path.startsWith("/knowledge/") && !isKnowledgeRouteTab(String(to.params.tab))) {
    return { path: "/knowledge/management", replace: true };
  }
  if (to.path.startsWith("/debug/") && !validDebugTabs.has(String(to.params.tab))) {
    return { path: "/debug/knowledgeRecall", replace: true };
  }
  if (to.path.startsWith("/external-services/") && !isExternalServiceRouteTab(String(to.params.tab))) {
    return { path: "/external-services/list", replace: true };
  }
  return true;
});
