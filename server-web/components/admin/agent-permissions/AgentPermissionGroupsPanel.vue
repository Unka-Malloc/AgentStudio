<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../../i18n/console";
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
const locale = computed(() => resolveEffectiveConsoleLocale(currentConsoleLocale.value));
const labels = computed(() => ({
  add: localizeConsoleText("新增", locale.value),
  disabled: localizeConsoleText("停用", locale.value),
  enabled: localizeConsoleText("启用", locale.value),
  exceptions: localizeConsoleText("例外", locale.value),
  generateDefaultGroups: localizeConsoleText("生成默认组", locale.value),
  groups: localizeConsoleText("组", locale.value),
  layers: localizeConsoleText("层级", locale.value),
  noPermissionGroups: localizeConsoleText("暂无权限组", locale.value),
  permissionGroupList: localizeConsoleText("权限组列表", locale.value),
  save: localizeConsoleText("保存", locale.value),
  saving: localizeConsoleText("保存中", locale.value),
  scopes: localizeConsoleText("范围", locale.value),
  emptyHint: localizeConsoleText('点击"生成默认组"快速创建预设权限配置。', locale.value),
  toolsets: localizeConsoleText("工具集", locale.value),
}));

watch(
  permissionGroups,
  (groups) => {
    if (groups.length === 0) { selectedGroupId.value = ""; return; }
    if (!groups.some((group) => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups[0]?.id || "";
    }
  },
  { immediate: true },
);

function exceptionCount(group: { toolAllow?: string[]; toolDeny?: string[] }) {
  return (group.toolAllow?.length || 0) + (group.toolDeny?.length || 0);
}

function localizePermissionGroupText(value: string) {
  return localizeConsoleText(value, locale.value);
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
    <div class="agent-permission-toolbar">
      <div class="agent-permission-toolbar-metrics">
        <span>{{ labels.layers }} <strong>{{ toolScopes.length }}</strong></span>
        <span>{{ labels.toolsets }} <strong>{{ toolManagementToolsets.length }}</strong></span>
        <span>{{ labels.groups }} <strong>{{ settingsDraft.agentPermissionGroups.length }}</strong></span>
        <span>{{ labels.enabled }} <strong>{{ enabledGroupCount }}</strong></span>
      </div>
      <div class="agent-permission-toolbar-actions">
        <button class="tool-button tool-button-ghost" type="button" @click="handleEnsurePermissionGroupsDraft">{{ labels.generateDefaultGroups }}</button>
        <button class="tool-button tool-button-ghost" type="button" @click="handleAddPermissionGroup">{{ labels.add }}</button>
        <button class="tool-button" type="button" :disabled="busyKey === 'agent-permissions-save'" @click="saveAgentPermissionSettings">
          {{ busyKey === "agent-permissions-save" ? labels.saving : labels.save }}
        </button>
      </div>
    </div>

    <div v-if="settingsDraft.agentPermissionGroups.length > 0" class="agent-permission-workbench-body">
      <aside class="agent-permission-group-list" :aria-label="labels.permissionGroupList">
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
            <strong>{{ localizePermissionGroupText(group.label || group.id) }}</strong>
            <em>{{ group.enabled ? labels.enabled : labels.disabled }}</em>
          </span>
          <span class="agent-permission-group-list-stats">
            <span>{{ group.scopeIds.length }} {{ labels.scopes }}</span>
            <span>{{ group.toolsetIds.length }} {{ labels.toolsets }}</span>
            <span v-if="exceptionCount(group)">{{ exceptionCount(group) }} {{ labels.exceptions }}</span>
          </span>
        </button>
      </aside>

      <AgentPermissionGroupCard v-if="activeGroup" :key="activeGroup.id" :group="activeGroup" />
    </div>

    <div v-else class="empty-state">
      <strong>{{ labels.noPermissionGroups }}</strong>
      <span>{{ labels.emptyHint }}</span>
    </div>
  </section>
</template>
