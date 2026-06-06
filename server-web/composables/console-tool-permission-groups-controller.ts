import { computed, type ComputedRef, type Ref } from "vue";
import type {
  AgentModelConfig,
  AgentPermissionGroup,
  AgentSettings,
  ToolManagementScope,
  ToolManagementToolset,
} from "../lib/types";
import type { OptionBarOption } from "../types/app";
import { confirmConsoleAction } from "./console-browser-effects";
import {
  normalizeAgentPermissionGroupDraft,
  normalizeAgentPermissionGroupsDraft,
} from "./console-model-utils";

type ConsoleToolPermissionGroupsControllerOptions = {
  settingsDraft: Ref<AgentSettings>;
  toolManagementToolsets: ComputedRef<ToolManagementToolset[]>;
  toolScopes: ComputedRef<ToolManagementScope[]>;
  visibleModelEntries: ComputedRef<AgentModelConfig[]>;
};

export function createConsoleToolPermissionGroupsController(
  options: ConsoleToolPermissionGroupsControllerOptions,
) {
  const defaultAgentPermissionGroups = computed<AgentPermissionGroup[]>(() => {
    const readScopes = options.toolScopes.value
      .filter((scope) => /read|knowledge/i.test(scope.id))
      .map((scope) => scope.id);
    const writeScopes = options.toolScopes.value
      .filter((scope) => /write|execute|tool|maintenance|admin/i.test(scope.id))
      .map((scope) => scope.id);
    const readToolsets = options.toolManagementToolsets.value
      .filter((toolset) => toolset.maxRisk === "read_only" && toolset.grantable !== false)
      .map((toolset) => toolset.id);
    const safeToolsets = options.toolManagementToolsets.value
      .filter((toolset) => ["read_only", "safe_write"].includes(toolset.maxRisk) && toolset.grantable !== false)
      .map((toolset) => toolset.id);
    const allToolsets = options.toolManagementToolsets.value
      .filter((toolset) => toolset.grantable !== false)
      .map((toolset) => toolset.id);
    return [
      {
        id: "agent-permission-knowledge-reader",
        label: "知识读取组",
        description: "只允许读取知识、执行只读召回和健康检查。",
        enabled: true,
        scopeIds: readScopes,
        toolsetIds: readToolsets,
        toolAllow: [],
        toolDeny: [],
      },
      {
        id: "agent-permission-operator",
        label: "运维操作组",
        description: "允许只读和安全写入工具，适合巡检、索引校验和轻量维护。",
        enabled: true,
        scopeIds: [...new Set([...readScopes, ...writeScopes])],
        toolsetIds: safeToolsets,
        toolAllow: [],
        toolDeny: [],
      },
      {
        id: "agent-permission-admin-review",
        label: "管理员审批组",
        description: "保留全部工具集入口，高风险工具仍受审批和策略预览约束。",
        enabled: true,
        scopeIds: options.toolScopes.value.map((scope) => scope.id),
        toolsetIds: allToolsets,
        toolAllow: [],
        toolDeny: [],
      },
    ];
  });

  const agentPermissionGroups = computed<AgentPermissionGroup[]>(() =>
    normalizeAgentPermissionGroupsDraft(options.settingsDraft.value.agentPermissionGroups),
  );

  const agentPermissionGroupOptionBarOptions = computed<OptionBarOption[]>(() => [
    { value: "", label: "未分配" },
    ...agentPermissionGroups.value
      .filter((group) => group.enabled)
      .map((group) => ({
        value: group.id,
        label: group.label || group.id,
      })),
  ]);

  function ensureAgentPermissionGroupsDraft() {
    if (options.settingsDraft.value.agentPermissionGroups?.length) {
      options.settingsDraft.value.agentPermissionGroups = agentPermissionGroups.value;
      return;
    }
    options.settingsDraft.value.agentPermissionGroups = defaultAgentPermissionGroups.value.map((group, index) =>
      normalizeAgentPermissionGroupDraft(group, index),
    );
  }

  function addAgentPermissionGroup() {
    ensureAgentPermissionGroupsDraft();
    const group = normalizeAgentPermissionGroupDraft(
      {
        id: `agent-permission-custom-${Date.now()}`,
        label: "自定义权限组",
        description: "按权限层级和工具明细定义智能体可调用范围。",
        enabled: true,
        scopeIds: [],
        toolsetIds: [],
        toolAllow: [],
        toolDeny: [],
      },
      options.settingsDraft.value.agentPermissionGroups.length,
    );
    options.settingsDraft.value.agentPermissionGroups = [group, ...options.settingsDraft.value.agentPermissionGroups];
  }

  function removeAgentPermissionGroup(group: AgentPermissionGroup) {
    if (!confirmConsoleAction(`删除权限组“${group.label || group.id}”？`)) {
      return;
    }
    options.settingsDraft.value.agentPermissionGroups = agentPermissionGroups.value.filter((item) => item.id !== group.id);
    for (const entry of options.visibleModelEntries.value) {
      if (entry.permissionGroupId === group.id) {
        entry.permissionGroupId = "";
      }
    }
  }

  function permissionGroupLabel(groupId?: string) {
    const normalized = String(groupId || "").trim();
    if (!normalized) {
      return "未分配";
    }
    return agentPermissionGroups.value.find((group) => group.id === normalized)?.label || normalized;
  }

  function setModelEntryPermissionGroup(entry: AgentModelConfig, groupId: string) {
    entry.permissionGroupId = String(groupId || "").trim();
  }

  function permissionGroupHasScope(group: AgentPermissionGroup, scopeId: string) {
    return group.scopeIds.includes(scopeId);
  }

  function permissionGroupHasToolset(group: AgentPermissionGroup, toolsetId: string) {
    return group.toolsetIds.includes(toolsetId);
  }

  function togglePermissionGroupScope(group: AgentPermissionGroup, scopeId: string) {
    const next = new Set(group.scopeIds || []);
    if (next.has(scopeId)) {
      next.delete(scopeId);
    } else {
      next.add(scopeId);
    }
    group.scopeIds = [...next];
  }

  function togglePermissionGroupToolset(group: AgentPermissionGroup, toolsetId: string) {
    const next = new Set(group.toolsetIds || []);
    if (next.has(toolsetId)) {
      next.delete(toolsetId);
    } else {
      next.add(toolsetId);
    }
    group.toolsetIds = [...next];
  }

  return {
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
  };
}
