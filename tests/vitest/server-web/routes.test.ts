import { describe, expect, it } from "vitest";
import {
  adminSectionToSlug,
  isExternalServiceRouteTab,
  isKnowledgeRouteTab,
  knowledgeRouteTabToViewTab,
  slugToAdminView,
  viewToPath,
} from "../../../server-web/router/routes";

describe("server-web route helpers", () => {
  it("maps knowledge route tabs to view tabs", () => {
    expect(isKnowledgeRouteTab("distillation")).toBe(true);
    expect(isKnowledgeRouteTab("unknown")).toBe(false);
    expect(knowledgeRouteTabToViewTab("chunking")).toBe("management");
    expect(knowledgeRouteTabToViewTab("wordCloud")).toBe("wordCloud");
    expect(knowledgeRouteTabToViewTab("unknown")).toBeNull();
    expect(knowledgeRouteTabToViewTab("maintenance")).toBe("maintenance");
  });

  it("normalizes console paths and admin slugs", () => {
    expect(isExternalServiceRouteTab("list")).toBe(true);
    expect(isExternalServiceRouteTab("unknown")).toBe(false);
    expect(viewToPath("externalServices")).toBe("/external-services/list");
    expect(viewToPath("knowledge", { tab: "maintenance" })).toBe("/knowledge/maintenance");
    expect(viewToPath("admin", { adminSection: "runtimeDownloads" })).toBe("/admin/runtime-downloads");
    expect(adminSectionToSlug("agentPermissions")).toBe("agent-permissions");
    expect(slugToAdminView("production-health")).toBe("productionHealth");
    expect(slugToAdminView("missing")).toBe("storage");
    expect(adminSectionToSlug("unknown")).toBe("storage");
    expect(slugToAdminView("tool-stats")).toBe("toolStats");
    expect(viewToPath("knowledge", { tab: "distillation" })).toBe("/knowledge/distillation");
    expect(viewToPath("admin", { adminSection: "unknown" })).toBe("/admin/storage");
    expect(viewToPath("debug", { tab: "agentRetrieval" })).toBe("/debug/agentRetrieval");
  });

  it("covers all route mapping paths", () => {
    expect(viewToPath("dashboard")).toBe("/");
    expect(viewToPath("feed")).toBe("/feed");
    expect(viewToPath("approval")).toBe("/approval");
    expect(viewToPath("sources")).toBe("/sources");
    expect(viewToPath("workspaces")).toBe("/workspaces");
    expect(viewToPath("externalServices", { tab: "list" })).toBe("/external-services/list");
    expect(viewToPath("externalServices", { tab: "custom" })).toBe("/external-services/custom");
    expect(viewToPath("knowledge", { tab: "chunking" })).toBe("/knowledge/chunking");
    expect(viewToPath("knowledge", { tab: "distillation" })).toBe("/knowledge/distillation");
    expect(viewToPath("debug", { tab: "knowledgeDistillation" })).toBe("/debug/knowledgeDistillation");
    expect(viewToPath("admin", { adminSection: "agentPermissions" })).toBe("/admin/agent-permissions");
    expect(viewToPath("admin", { adminSection: "maintenanceAgent" })).toBe("/admin/maintenance-agent");
    expect(viewToPath("admin", { adminSection: "toolStats" })).toBe("/admin/tool-stats");
    expect(viewToPath("unknown-view")).toBe("/");
  });
});
