import { computed, reactive, ref } from "vue";
import { describe, expect, it } from "vitest";
import { createConsoleShellRouteController } from "../../../server-web/composables/console-shell-route-controller";

function messages() {
  return {
    nav: {
      agentAssignment: "Agent assignment",
      agentConfig: "Agent config",
      agentRetrieval: "Agent retrieval",
      approvalFlow: "Approval flow",
      corpusAnalysis: "Corpus analysis",
      contextManagement: "Context management",
      dashboard: "Dashboard",
      debugPanel: "Debug panel",
      devices: "Devices",
      externalServiceConfig: "External service config",
      externalServiceList: "External service list",
      externalServices: "External services",
      feed: "Feed",
      jobs: "Jobs",
      knowledge: "Knowledge",
      knowledgeArchive: "Knowledge archive",
      knowledgeDistillation: "Knowledge distillation",
      knowledgeRecall: "Knowledge recall",
      logs: "Logs",
      maintenanceAgent: "Maintenance agent",
      opsMonitor: "Ops monitor",
      parameterConfig: "Parameter config",
      permissionGroups: "Permission groups",
      productionHealth: "Production health",
      runtimeDownloads: "Runtime downloads",
      sources: "Sources",
      toolList: "Tool list",
      toolStats: "Tool stats",
      workspaces: "Workspaces",
    },
    title: {
      admin: "Admin",
      modules: "Modules",
      storage: "Storage",
    },
  };
}

function createFixture() {
  const route = reactive({
    fullPath: "/console/dashboard",
    meta: { viewId: "dashboard" },
    params: {},
  });
  const controller = createConsoleShellRouteController({
    adminView: ref("tools"),
    currentView: ref("feed"),
    debugTab: ref("knowledgeRecall"),
    externalServiceTab: ref("config"),
    knowledgeTab: ref("management"),
    msg: computed(() => messages() as any),
    route: route as any,
  });

  return { controller, route };
}

describe("console shell route controller extra coverage", () => {
  it("uses route metadata and falls back to current view refs for active route state", () => {
    const { controller, route } = createFixture();

    expect(controller.activeRouteView.value).toBe("dashboard");
    expect(controller.activeRouteFullPath.value).toBe("/console/dashboard");
    expect(controller.localizedViewTitle.value).toBe("Dashboard");

    route.fullPath = "/console/feed";
    route.meta = {};
    expect(controller.activeRouteView.value).toBe("feed");
    expect(controller.activeRouteFullPath.value).toBe("/console/feed");
    expect(controller.localizedViewTitle.value).toBe("Feed");

    route.meta = { viewId: "unknown" };
    expect(controller.localizedViewTitle.value).toBe("");
  });

  it("localizes admin titles for known admin views and default admin fallback", () => {
    const { controller, route } = createFixture();
    const expected = new Map([
      ["agentPermissions", "Permission groups"],
      ["tools", "Tool list"],
      ["toolList", "Tool list"],
      ["toolStats", "Tool stats"],
      ["agentConfig", "Agent config"],
      ["agentAssignment", "Agent assignment"],
      ["contextManagement", "Context management"],
      ["maintenanceAgent", "Maintenance agent"],
      ["clients", "Devices"],
      ["jobs", "Jobs"],
      ["logs", "Logs"],
      ["opsMonitor", "Ops monitor"],
      ["runtimeDownloads", "Runtime downloads"],
      ["productionHealth", "Production health"],
      ["modules", "Modules"],
      ["storage", "Storage"],
    ]);

    for (const [adminView, title] of expected.entries()) {
      route.meta = { viewId: "admin", adminView };
      expect(controller.localizedViewTitle.value).toBe(title);
    }

    route.meta = { viewId: "admin", adminView: "unknown-admin" };
    expect(controller.localizedViewTitle.value).toBe("Admin");
  });

  it("resolves active tabs from route params and localizes known tab labels", () => {
    const { controller, route } = createFixture();

    expect(controller.activeRouteKnowledgeTab.value).toBe("management");
    expect(controller.activeRouteDebugTab.value).toBe("knowledgeRecall");
    expect(controller.activeRouteExternalServiceTab.value).toBe("config");

    route.params = { tab: "wordCloud" };
    expect(controller.activeRouteKnowledgeTab.value).toBe("wordCloud");
    expect(controller.activeRouteDebugTab.value).toBe("wordCloud");
    expect(controller.activeRouteExternalServiceTab.value).toBe("wordCloud");

    expect(controller.localizedKnowledgeTabLabel({ id: "management", label: "fallback" })).toBe("Knowledge archive");
    expect(controller.localizedKnowledgeTabLabel({ id: "wordCloud", label: "fallback" })).toBe("Corpus analysis");
    expect(controller.localizedKnowledgeTabLabel({ id: "maintenance", label: "fallback" })).toBe("Parameter config");
    expect(controller.localizedKnowledgeTabLabel({ id: "custom", label: "Custom" })).toBe("Custom");

    expect(controller.localizedDebugTabLabel({ id: "knowledgeRecall", label: "fallback" })).toBe("Knowledge recall");
    expect(controller.localizedDebugTabLabel({ id: "agentRetrieval", label: "fallback" })).toBe("Agent retrieval");
    expect(controller.localizedDebugTabLabel({ id: "knowledgeDistillation", label: "fallback" })).toBe("Knowledge distillation");
    expect(controller.localizedDebugTabLabel({ id: "custom", label: "Custom" })).toBe("Custom");

    expect(controller.localizedExternalServiceTabLabel({ id: "config", label: "fallback" })).toBe("External service config");
    expect(controller.localizedExternalServiceTabLabel({ id: "list", label: "fallback" })).toBe("External service list");
    expect(controller.localizedExternalServiceTabLabel({ id: "custom", label: "Custom" })).toBe("Custom");
  });

  it("maps non-admin route views to localized titles", () => {
    const { controller, route } = createFixture();
    const expected = new Map([
      ["approval", "Approval flow"],
      ["sources", "Sources"],
      ["externalServices", "External services"],
      ["knowledge", "Knowledge"],
      ["workspaces", "Workspaces"],
      ["debug", "Debug panel"],
    ]);

    for (const [viewId, title] of expected.entries()) {
      route.meta = { viewId };
      expect(controller.localizedViewTitle.value).toBe(title);
    }
  });
});
