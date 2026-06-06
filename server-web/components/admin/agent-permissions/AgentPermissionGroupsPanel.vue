<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import AgentPermissionGroupCard from "./AgentPermissionGroupCard.vue";

const {
  addAgentPermissionGroup,
  busyKey,
  ensureAgentPermissionGroupsDraft,
  saveAgentPermissionSettings,
  settingsDraft,
  toolManagementToolsets,
  toolScopes,
} = useAgentPermissionsViewContext();

const selectedGroupId = ref("");
const permissionGroups = computed(() => settingsDraft.value.agentPermissionGroups || []);
const activeGroup = computed(() =>
  permissionGroups.value.find((group) => group.id === selectedGroupId.value) || permissionGroups.value[0],
);
const enabledGroupCount = computed(() => permissionGroups.value.filter((group) => group.enabled).length);

watch(
  permissionGroups,
  (groups) => {
    if (groups.length === 0) {
      selectedGroupId.value = "";
      return;
    }
    if (!groups.some((group) => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups[0]?.id || "";
    }
  },
  { immediate: true },
);

function exceptionCount(group: { toolAllow?: string[]; toolDeny?: string[] }) {
  return (group.toolAllow?.length || 0) + (group.toolDeny?.length || 0);
}

async function handleAddPermissionGroup() {
  addAgentPermissionGroup();
  await nextTick();
  selectedGroupId.value = permissionGroups.value[0]?.id || "";
}

async function handleEnsurePermissionGroupsDraft() {
  ensureAgentPermissionGroupsDraft();
  await nextTick();
  selectedGroupId.value = activeGroup.value?.id || permissionGroups.value[0]?.id || "";
}
</script>

<template>
  <section class="agent-permission-workbench">
    <article class="surface-card agent-permission-workbench-header">
      <div class="section-header">
        <div>
          <h3>权限组配置</h3>
          <p>左侧选择一个权限组，右侧只展示当前组的摘要和编辑项。</p>
        </div>
        <div class="source-actions">
          <button class="tool-button tool-button-ghost" type="button" @click="handleEnsurePermissionGroupsDraft">
            生成默认组
          </button>
          <button class="tool-button tool-button-ghost" type="button" @click="handleAddPermissionGroup">
            新增权限组
          </button>
          <button class="tool-button" type="button" :disabled="busyKey === 'agent-permissions-save'" @click="saveAgentPermissionSettings">
            {{ busyKey === "agent-permissions-save" ? "保存中" : "保存权限组" }}
          </button>
        </div>
      </div>
      <div class="detail-metrics knowledge-metrics">
        <div>
          <span>权限层级</span>
          <strong>{{ toolScopes.length }}</strong>
        </div>
        <div>
          <span>工具集</span>
          <strong>{{ toolManagementToolsets.length }}</strong>
        </div>
        <div>
          <span>预设组</span>
          <strong>{{ settingsDraft.agentPermissionGroups.length }}</strong>
        </div>
        <div>
          <span>启用组</span>
          <strong>{{ enabledGroupCount }}</strong>
        </div>
      </div>
    </article>

    <div v-if="settingsDraft.agentPermissionGroups.length > 0" class="agent-permission-workbench-body">
      <aside class="surface-card agent-permission-group-list" aria-label="权限组列表">
        <button
          v-for="group in settingsDraft.agentPermissionGroups"
          :key="group.id"
          class="agent-permission-group-list-item"
          :class="{ active: activeGroup?.id === group.id }"
          :data-enabled="group.enabled"
          type="button"
          @click="selectedGroupId = group.id"
        >
          <span class="agent-permission-group-list-title">
            <strong>{{ group.label || group.id }}</strong>
            <em>{{ group.enabled ? "启用" : "停用" }}</em>
          </span>
          <span class="agent-permission-group-list-description">{{ group.description || group.id }}</span>
          <span class="agent-permission-group-list-stats">
            <span>范围 {{ group.scopeIds.length }}</span>
            <span>工具集 {{ group.toolsetIds.length }}</span>
            <span>例外 {{ exceptionCount(group) }}</span>
          </span>
        </button>
      </aside>

      <AgentPermissionGroupCard
        v-if="activeGroup"
        :key="activeGroup.id"
        :group="activeGroup"
      />
    </div>

    <div v-else class="surface-card empty-state">
      <strong>暂无权限组</strong>
      <span>先生成默认组或新增自定义权限组。</span>
    </div>
  </section>
</template>
