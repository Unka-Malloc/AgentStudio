<script setup lang="ts">
import type { AgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import { toolRiskLabel } from "../../../composables/console-tool-display-utils";
import ConfigFoldCard from "../../ConfigFoldCard.vue";
import FeatureToggle from "../../FeatureToggle.vue";
import ScopeSelector from "../../ScopeSelector.vue";

type PermissionGroup = AgentPermissionsViewContext["settingsDraft"]["value"]["agentPermissionGroups"][number];

defineProps<{
  group: PermissionGroup;
}>();

const {
  busyKey,
  permissionGroupHasToolset,
  permissionGroupToolRuleState,
  removeAgentPermissionGroup,
  setPermissionGroupToolRule,
  togglePermissionGroupToolset,
  toolManagementTools,
  toolManagementToolsets,
  toolScopes,
} = useAgentPermissionsViewContext();
</script>

<template>
  <article
    class="surface-card agent-permission-group-card"
    :data-enabled="group.enabled"
  >
    <div class="section-header">
      <div class="form-grid compact-form-grid permission-group-title-grid">
        <label>
          <span>权限组名称</span>
          <input v-model="group.label" autocomplete="off" />
        </label>
        <label>
          <span>权限组 ID</span>
          <input v-model="group.id" autocomplete="off" />
        </label>
      </div>
      <div class="permission-actions">
        <FeatureToggle
          :model-value="group.enabled"
          :aria-label="group.enabled ? '停用权限组' : '启用权限组'"
          @update:model-value="group.enabled = Boolean($event)"
        />
        <button class="table-action danger-action" type="button" @click="removeAgentPermissionGroup(group)">
          删除
        </button>
      </div>
    </div>
    <label class="module-field">
      <span>说明</span>
      <input v-model="group.description" autocomplete="off" />
    </label>
    <ConfigFoldCard title="第一层：权限控制层级">
      <ScopeSelector
        v-model="group.scopeIds"
        :scopes="toolScopes"
        compact
      />
    </ConfigFoldCard>
    <ConfigFoldCard title="第二层：工具集权限">
      <div class="scope-grid compact-scope-grid">
        <button
          v-for="toolset in toolManagementToolsets.filter((item) => item.grantable !== false)"
          :key="toolset.id"
          class="scope-chip"
          :class="{ active: permissionGroupHasToolset(group, toolset.id) }"
          type="button"
          @click="togglePermissionGroupToolset(group, toolset.id)"
        >
          <strong>{{ toolset.label }}</strong>
          <span>{{ toolRiskLabel(toolset.maxRisk) }}</span>
        </button>
      </div>
    </ConfigFoldCard>
    <ConfigFoldCard title="第三层：单工具例外">
      <div class="job-table compact-job-table permission-tool-rule-table">
        <div class="job-table-header">
          <span>工具</span>
          <span>当前规则</span>
          <span>操作</span>
        </div>
        <div
          v-for="tool in toolManagementTools"
          :key="`${group.id}:${tool.id}`"
          class="job-row"
        >
          <span>
            <strong>{{ tool.label }}</strong>
            <small>{{ tool.id }}</small>
          </span>
          <span>{{ permissionGroupToolRuleState(group, tool.id) }}</span>
          <span class="permission-actions">
            <button
              class="table-action"
              type="button"
              @click="setPermissionGroupToolRule(group, tool.id, 'inherit')"
            >
              继承
            </button>
            <button
              class="table-action"
              type="button"
              @click="setPermissionGroupToolRule(group, tool.id, 'allow')"
            >
              允许
            </button>
            <button
              class="table-action danger-action"
              type="button"
              @click="setPermissionGroupToolRule(group, tool.id, 'deny')"
            >
              未启用
            </button>
          </span>
        </div>
      </div>
      <div v-if="toolManagementTools.length === 0" class="empty-state">
        <strong>尚未加载工具目录</strong>
      </div>
    </ConfigFoldCard>
  </article>
</template>
