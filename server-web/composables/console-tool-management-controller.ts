import { computed, ref, type ComputedRef, type Ref } from "vue";
import type {
  AgentModelConfig,
  AgentSettings,
} from "../lib/types";
import {
  getToolManagementAudit,
  getToolManagementCatalog,
  getToolManagementGrants,
  getToolManagementMetrics,
  previewToolPolicy as previewToolPolicyApi,
  type ToolManagementAuditItem,
  type ToolManagementCatalog,
  type ToolManagementGrant,
  type ToolManagementMetrics,
  type ToolManagementProfile,
  type ToolManagementTool,
  type ToolManagementToolGroup,
  type ToolManagementToolset,
} from "../lib/tool-management-client";
import type { OptionBarOption } from "../types/app";
import { createConsoleToolGrantsController } from "./console-tool-grants-controller";
import { createConsoleToolPermissionGroupsController } from "./console-tool-permission-groups-controller";

type ConsoleToolManagementControllerOptions = {
  clearAllBusy: () => void;
  error: Ref<string>;
  setBusy: (key: string) => void;
  settingsDraft: Ref<AgentSettings>;
  visibleModelEntries: ComputedRef<AgentModelConfig[]>;
};

export function createConsoleToolManagementController(
  options: ConsoleToolManagementControllerOptions,
) {
  const toolManagementCatalogState = ref<ToolManagementCatalog | null>(null);
  const toolManagementGrantsState = ref<ToolManagementGrant[]>([]);
  const toolManagementMetricsState = ref<ToolManagementMetrics | null>(null);
  const toolManagementAuditItems = ref<ToolManagementAuditItem[]>([]);
  const selectedToolManagementToolId = ref("pact.agentLibrary.health");
  const policyPreviewToolId = ref("pact.agentLibrary.health");
  const policyPreviewProfileId = ref("external-knowledge-reader");
  const policyPreviewGrantId = ref("");
  const policyPreviewResult = ref<Record<string, unknown> | null>(null);
  const selectedToolManagementToolsetId = ref("");

  const toolScopes = computed(() => toolManagementCatalogState.value?.scopes || []);
  const toolCatalog = computed(() => toolManagementCatalogState.value?.tools || []);
  const toolManagementTools = computed<ToolManagementTool[]>(() => toolManagementCatalogState.value?.tools || []);
  const toolManagementToolsets = computed<ToolManagementToolset[]>(
    () => toolManagementCatalogState.value?.toolsets || [],
  );
  const toolManagementProfiles = computed<ToolManagementProfile[]>(
    () => toolManagementCatalogState.value?.profiles || [],
  );
  const toolManagementToolGroups = computed<ToolManagementToolGroup[]>(() => {
    const catalogGroups = toolManagementCatalogState.value?.toolGroups;
    if (catalogGroups?.length) {
      return catalogGroups;
    }
    const groups: ToolManagementToolGroup[] = [];
    for (const toolset of toolManagementToolsets.value) {
      const tools = toolManagementTools.value.filter((tool) => tool.toolsets.includes(toolset.id));
      if (!tools.length) {
        continue;
      }
      groups.push({
        id: toolset.id,
        label: toolset.label || toolset.id,
        description: toolset.description || "",
        toolsetId: toolset.id,
        requiredScopes: toolset.requiredScopes || [],
        defaultForAgents: toolset.defaultForAgents === true,
        grantable: toolset.grantable !== false,
        maxRisk: tools.reduce(
          (max, tool) => (riskRank(tool.risk) > riskRank(max) ? tool.risk : max),
          "read_only",
        ),
        toolCount: tools.length,
        activeToolCount: tools.filter((tool) => tool.status === "active").length,
        internalToolCount: tools.filter((tool) => tool.status === "internal").length,
        writeToolCount: tools.filter((tool) => tool.readOnly === false).length,
        sampleToolIds: tools.slice(0, 6).map((tool) => tool.id),
      });
    }
    return groups.sort((left, right) => {
      if (left.defaultForAgents !== right.defaultForAgents) {
        return left.defaultForAgents ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });
  });
  const activeToolManagementToolCount = computed(
    () => toolManagementTools.value.filter((tool) => tool.status === "active").length,
  );
  const internalToolManagementToolCount = computed(
    () => toolManagementTools.value.filter((tool) => tool.status === "internal").length,
  );
  const toolManagementStatusRows = computed(() =>
    Object.entries(toolManagementMetricsState.value?.byStatus || {}).map(([label, value]) => ({
      label,
      value,
    })),
  );
  const toolManagementRiskRows = computed(() =>
    Object.entries(toolManagementMetricsState.value?.byRisk || {}).map(([label, value]) => ({
      label,
      value,
    })),
  );
  const defaultAgentToolsetIds = computed(
    () => new Set(toolManagementToolsets.value.filter((toolset) => toolset.defaultForAgents).map((toolset) => toolset.id)),
  );
  const defaultAgentToolCount = computed(
    () => toolManagementTools.value.filter((tool) => tool.toolsets.some((toolset) => defaultAgentToolsetIds.value.has(toolset))).length,
  );
  const selectedToolManagementToolset = computed(
    () => toolManagementToolGroups.value.find((group) => group.id === selectedToolManagementToolsetId.value) || null,
  );
  const selectedToolManagementToolsetTools = computed<ToolManagementTool[]>(() => {
    if (!selectedToolManagementToolsetId.value) {
      return [];
    }
    return toolManagementTools.value.filter((tool) => tool.toolsets.includes(selectedToolManagementToolsetId.value));
  });

  function riskRank(risk = "read_only") {
    const ranks: Record<string, number> = {
      read_only: 0,
      safe_write: 1,
      repair_write: 2,
      destructive: 3,
    };
    return ranks[String(risk || "read_only")] ?? ranks.read_only;
  }

  const {
    addAgentPermissionGroup,
    agentPermissionGroupOptionBarOptions,
    agentPermissionGroups,
    defaultAgentPermissionGroups,
    ensureAgentPermissionGroupsDraft,
    permissionGroupHasScope,
    permissionGroupHasToolset,
    permissionGroupLabel,
    removeAgentPermissionGroup,
    setModelEntryPermissionGroup,
    togglePermissionGroupScope,
    togglePermissionGroupToolset,
  } = createConsoleToolPermissionGroupsController({
    settingsDraft: options.settingsDraft,
    toolManagementToolsets,
    toolScopes,
    visibleModelEntries: options.visibleModelEntries,
  });

  const selectedToolManagementTool = computed(() => {
    const selectedId = selectedToolManagementToolId.value || policyPreviewToolId.value;
    return toolManagementTools.value.find((tool) => tool.id === selectedId) || toolManagementTools.value[0] || null;
  });

  const policyPreviewCandidateTools = computed(() => {
    if (selectedToolManagementToolsetTools.value.length > 0) {
      return selectedToolManagementToolsetTools.value;
    }
    const profile = toolManagementProfiles.value.find((item) => item.id === policyPreviewProfileId.value);
    const profileToolsets = new Set(profile?.toolsets || []);
    const profileAllow = new Set(profile?.toolAllow || []);
    const profileDeny = new Set(profile?.toolDeny || []);
    const baseTools = profileToolsets.size > 0
      ? toolManagementTools.value.filter((tool) => tool.toolsets.some((toolset) => profileToolsets.has(toolset)))
      : toolManagementTools.value.filter((tool) => tool.toolsets.some((toolset) => defaultAgentToolsetIds.value.has(toolset)));
    return baseTools.filter((tool) => {
      if (profileDeny.has(tool.id)) {
        return false;
      }
      if (profileAllow.size > 0 && !profileAllow.has(tool.id)) {
        return false;
      }
      return true;
    });
  });

  const policyPreviewToolOptionBarOptions = computed<OptionBarOption[]>(() =>
    policyPreviewCandidateTools.value.map((tool) => ({
      value: tool.id,
      label: `${tool.label} / ${tool.id}`,
    })),
  );

  const policyPreviewProfileOptionBarOptions = computed<OptionBarOption[]>(() => [
    { value: "", label: "不绑定档案" },
    ...toolManagementProfiles.value.map((profile) => ({
      value: profile.id,
      label: `${profile.label} / ${profile.id}`,
    })),
  ]);

  function previewToolDefinition() {
    return toolManagementTools.value.find((tool) => tool.id === policyPreviewToolId.value) || null;
  }

  function selectToolForManagement(toolId: string) {
    selectedToolManagementToolId.value = toolId;
    policyPreviewToolId.value = toolId;
  }

  function selectToolManagementToolset(toolsetId: string) {
    selectedToolManagementToolsetId.value = toolsetId;
    const firstTool = selectedToolManagementToolsetTools.value[0] || null;
    if (firstTool) {
      selectToolForManagement(firstTool.id);
    }
  }

  function ensureSelectedToolManagementToolset() {
    const groups = toolManagementToolGroups.value;
    if (groups.length === 0) {
      selectedToolManagementToolsetId.value = "";
      return;
    }

    const selectedGroupStillExists = groups.some((group) => group.id === selectedToolManagementToolsetId.value);
    if (!selectedGroupStillExists) {
      selectedToolManagementToolsetId.value = groups[0].id;
    }

    const visibleTools = selectedToolManagementToolsetTools.value;
    if (visibleTools.length === 0) {
      return;
    }
    const selectedToolStillVisible = visibleTools.some((tool) => tool.id === selectedToolManagementToolId.value);
    if (!selectedToolStillVisible) {
      selectToolForManagement(visibleTools[0].id);
    }
  }

  function policyPreviewGrant() {
    const tool = previewToolDefinition();
    return {
      id: "console-preview-grant",
      label: "Console preview grant",
      enabled: true,
      scopes: tool?.requiredScopes || [],
      toolsets: tool?.toolsets || [],
      toolAllow: [],
      toolDeny: [],
      metadata: {},
    };
  }

  async function refreshToolManagement(optionsArg: { silent?: boolean } = {}) {
    const showBusy = !optionsArg.silent;
    if (showBusy) {
      options.setBusy("tool-management");
    }
    options.error.value = "";

    try {
      const [grants, catalog, audit, metrics] = await Promise.all([
        getToolManagementGrants(),
        getToolManagementCatalog(),
        getToolManagementAudit(50),
        getToolManagementMetrics(),
      ]);
      toolManagementGrantsState.value = grants.grants;
      toolManagementCatalogState.value = catalog;
      toolManagementAuditItems.value = audit.items;
      toolManagementMetricsState.value = metrics.metrics;
      if (!policyPreviewToolId.value && catalog.tools.length > 0) {
        policyPreviewToolId.value = catalog.tools[0].id;
      }
      if (!selectedToolManagementToolId.value && catalog.tools.length > 0) {
        selectedToolManagementToolId.value = catalog.tools[0].id;
      }
      ensureSelectedToolManagementToolset();
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "刷新智能体工具失败。";
    } finally {
      if (showBusy) {
        options.clearAllBusy();
      }
    }
  }

  const {
    copyIssuedToolToken,
    createGrant,
    deleteGrant,
    enabledToolGrantCount,
    grantHasScope,
    grantHasToolset,
    grantToolRuleState,
    issuedToolToken,
    newGrantLabel,
    newGrantScopes,
    newGrantToolsets,
    rotateGrant,
    setGrantToolRule,
    toggleGrantScope,
    toggleGrantToolset,
    toggleNewGrantScope,
    toggleNewGrantToolset,
    toolGrants,
    updateGrant,
  } = createConsoleToolGrantsController({
    clearAllBusy: options.clearAllBusy,
    error: options.error,
    refreshToolManagement,
    setBusy: options.setBusy,
    toolManagementGrantsState,
  });

  async function previewToolPolicy() {
    if (!policyPreviewToolId.value) {
      options.error.value = "请选择需要预览的工具。";
      return;
    }
    options.setBusy("tool-policy-preview");
    options.error.value = "";
    try {
      const payload: Record<string, unknown> = {
        toolId: policyPreviewToolId.value,
        input: {},
        dryRun: false,
      };
      if (policyPreviewGrantId.value.trim()) {
        payload.grantId = policyPreviewGrantId.value.trim();
      } else {
        payload.grant = policyPreviewGrant();
      }
      if (policyPreviewProfileId.value.trim()) {
        payload.profileId = policyPreviewProfileId.value.trim();
      }
      policyPreviewResult.value = await previewToolPolicyApi(payload);
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "工具策略预览失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  return {
    activeToolManagementToolCount,
    addAgentPermissionGroup,
    agentPermissionGroupOptionBarOptions,
    agentPermissionGroups,
    copyIssuedToolToken,
    createGrant,
    defaultAgentPermissionGroups,
    deleteGrant,
    defaultAgentToolCount,
    enabledToolGrantCount,
    ensureAgentPermissionGroupsDraft,
    grantHasScope,
    grantHasToolset,
    grantToolRuleState,
    internalToolManagementToolCount,
    issuedToolToken,
    newGrantLabel,
    newGrantScopes,
    newGrantToolsets,
    permissionGroupHasScope,
    permissionGroupHasToolset,
    permissionGroupLabel,
    policyPreviewGrant,
    policyPreviewGrantId,
    policyPreviewProfileId,
    policyPreviewProfileOptionBarOptions,
    policyPreviewResult,
    policyPreviewToolId,
    policyPreviewToolOptionBarOptions,
    previewToolDefinition,
    previewToolPolicy,
    refreshToolManagement,
    removeAgentPermissionGroup,
    selectedToolManagementToolset,
    selectedToolManagementToolsetId,
    selectedToolManagementToolsetTools,
    selectToolManagementToolset,
    rotateGrant,
    selectToolForManagement,
    selectedToolManagementTool,
    selectedToolManagementToolId,
    setGrantToolRule,
    setModelEntryPermissionGroup,
    toggleGrantScope,
    toggleGrantToolset,
    toggleNewGrantScope,
    toggleNewGrantToolset,
    togglePermissionGroupScope,
    togglePermissionGroupToolset,
    toolCatalog,
    toolGrants,
    toolManagementAuditItems,
    toolManagementCatalogState,
    toolManagementGrantsState,
    toolManagementMetricsState,
    toolManagementProfiles,
    toolManagementRiskRows,
    toolManagementStatusRows,
    toolManagementToolGroups,
    toolManagementTools,
    toolManagementToolsets,
    toolScopes,
    updateGrant,
  };
}
