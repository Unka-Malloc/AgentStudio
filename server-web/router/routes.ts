export const knowledgeRouteTabs = [
  "management",
  "wordCloud",
  "maintenance",
  "chunking",
  "distillation",
] as const;

export type KnowledgeTab = typeof knowledgeRouteTabs[number];
export type KnowledgeViewTab = "management" | "wordCloud" | "maintenance";

export function isKnowledgeRouteTab(value: string): value is KnowledgeTab {
  return (knowledgeRouteTabs as readonly string[]).includes(value);
}

export function knowledgeRouteTabToViewTab(value: string): KnowledgeViewTab | null {
  if (value === "chunking" || value === "distillation") {
    return "management";
  }
  if (value === "management" || value === "wordCloud" || value === "maintenance") {
    return value;
  }
  return null;
}

export type DebugTab = "knowledgeRecall" | "agentRetrieval" | "knowledgeDistillation";

export const externalServiceRouteTabs = ["list"] as const;
export type ExternalServiceTab = typeof externalServiceRouteTabs[number];

export function isExternalServiceRouteTab(value: string): value is ExternalServiceTab {
  return (externalServiceRouteTabs as readonly string[]).includes(value);
}

export type AdminSection =
  | "storage"
  | "jobs"
  | "logs"
  | "ops-monitor"
  | "clients"
  | "tools"
  | "toolList"
  | "toolGovernance"
  | "toolStats"
  | "tool-list"
  | "tool-governance"
  | "tool-stats"
  | "modules"
  | "productionHealth"
  | "runtimeDownloads"
  | "strategyManagement"
  | "strategy-management"
  | "versionRelease"
  | "version-release"
  | "versionAssembly"
  | "version-assembly"
  | "agent-permissions"
  | "agent-config"
  | "agent-assignment"
  | "context-management"
  | "maintenance-agent";

/** Maps AppView to its canonical route path. */
export function viewToPath(
  view: string,
  opts?: { tab?: string; adminSection?: string },
): string {
  switch (view) {
    case "dashboard":   return "/";
    case "feed":        return "/feed";
    case "approval":    return "/approval";
    case "sources":     return "/sources";
    case "externalServices":
      return `/external-services/${opts?.tab ?? "list"}`;
    case "workspaces":  return "/workspaces";
    case "knowledge":
      return `/knowledge/${opts?.tab ?? "management"}`;
    case "debug":
      return `/debug/${opts?.tab ?? "knowledgeRecall"}`;
    case "admin":
      return `/admin/${adminSectionToSlug(opts?.adminSection ?? "storage")}`;
    default:            return "/";
  }
}

/** Maps AdminView key to URL slug. */
export function adminSectionToSlug(section: string): string {
  const map: Record<string, string> = {
    storage: "storage",
    jobs: "jobs",
    logs: "logs",
    opsMonitor: "ops-monitor",
    clients: "clients",
    tools: "tool-list",
    toolList: "tool-list",
    toolGovernance: "tool-governance",
    toolStats: "tool-stats",
    modules: "modules",
    productionHealth: "production-health",
    runtimeDownloads: "runtime-downloads",
    strategyManagement: "strategy-management",
    versionRelease: "version-release",
    versionAssembly: "version-assembly",
    agentPermissions: "agent-permissions",
    agentConfig: "agent-config",
    agentAssignment: "agent-assignment",
    contextManagement: "context-management",
    maintenanceAgent: "maintenance-agent",
  };
  return map[section] ?? "storage";
}

/** Maps URL slug back to AdminView key. */
export function slugToAdminView(slug: string): string {
  const map: Record<string, string> = {
    storage: "storage",
    jobs: "jobs",
    logs: "logs",
    "ops-monitor": "opsMonitor",
    clients: "clients",
    tools: "toolList",
    "tool-list": "toolList",
    "tool-governance": "toolGovernance",
    "tool-stats": "toolStats",
    modules: "modules",
    "production-health": "productionHealth",
    "runtime-downloads": "runtimeDownloads",
    "strategy-management": "strategyManagement",
    "version-release": "versionRelease",
    "version-assembly": "versionAssembly",
    "agent-permissions": "agentPermissions",
    "agent-config": "agentConfig",
    "agent-assignment": "agentAssignment",
    "context-management": "contextManagement",
    "maintenance-agent": "maintenanceAgent",
  };
  return map[slug] ?? "storage";
}
