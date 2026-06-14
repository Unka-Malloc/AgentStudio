<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import { toolRiskLabel } from "../../../composables/console-tool-display-utils";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../../i18n/console";
import PactTabs, { type PactTab } from "../../PactTabs.vue";
import FeatureToggle from "../../FeatureToggle.vue";
import ScopeSelector from "../../ScopeSelector.vue";

type PermissionGroup = AgentPermissionsViewContext["settingsDraft"]["value"]["agentPermissionGroups"][number];
type PermissionGroupSection = "overview" | "scopes" | "toolsets" | "exceptions";
type PermissionToolRule = "allow" | "deny";

const props = defineProps<{
  group: PermissionGroup;
}>();

const {
  permissionGroupHasToolset,
  removeAgentPermissionGroup,
  setPermissionGroupToolRule,
  togglePermissionGroupToolset,
  toolManagementTools,
  toolManagementToolsets,
  toolScopes,
} = useAgentPermissionsViewContext();

const activeSection = ref<PermissionGroupSection>("overview");
const selectedExceptionToolId = ref("");
const selectedExceptionRule = ref<PermissionToolRule>("deny");
const locale = computed(() => resolveEffectiveConsoleLocale(currentConsoleLocale.value));
function t(value: string) {
  return localizeConsoleText(value, locale.value);
}

const groupLabelValue = computed({
  get: () => localizeConsoleText(props.group.label, locale.value),
  set: (value: string) => {
    props.group.label = value;
  },
});
const groupDescriptionValue = computed({
  get: () => localizeConsoleText(props.group.description, locale.value),
  set: (value: string) => {
    props.group.description = value;
  },
});
const groupSectionTabs = computed<PactTab[]>(() => [
  { key: "overview", label: t("概览") },
  { key: "scopes", label: t("权限范围") },
  { key: "toolsets", label: t("工具集") },
  { key: "exceptions", label: t("例外") },
]);

const grantableToolsets = computed(() =>
  toolManagementToolsets.value.filter((item) => item.grantable !== false),
);

const selectedScopeLabels = computed(() =>
  props.group.scopeIds
    .map((scopeId) => toolScopes.value.find((scope) => scope.id === scopeId)?.label || scopeId)
    .slice(0, 6),
);

const selectedToolsetLabels = computed(() =>
  props.group.toolsetIds
    .map((toolsetId) => toolManagementToolsets.value.find((toolset) => toolset.id === toolsetId)?.label || toolsetId)
    .slice(0, 6),
);

const exceptionRows = computed(() => {
  const rows: { toolId: string; label: string; description: string; rule: PermissionToolRule }[] = [];
  for (const toolId of props.group.toolAllow || []) {
    const tool = toolManagementTools.value.find((item) => item.id === toolId);
    rows.push({
      toolId,
      label: tool?.label || toolId,
      description: tool?.description || toolId,
      rule: "allow",
    });
  }
  for (const toolId of props.group.toolDeny || []) {
    const tool = toolManagementTools.value.find((item) => item.id === toolId);
    rows.push({
      toolId,
      label: tool?.label || toolId,
      description: tool?.description || toolId,
      rule: "deny",
    });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
});

const availableExceptionTools = computed(() => {
  const configured = new Set(exceptionRows.value.map((row) => row.toolId));
  return toolManagementTools.value.filter((tool) => !configured.has(tool.id));
});

watch(
  availableExceptionTools,
  (tools) => {
    if (!tools.some((tool) => tool.id === selectedExceptionToolId.value)) {
      selectedExceptionToolId.value = tools[0]?.id || "";
    }
  },
  { immediate: true },
);

function addToolException() {
  if (!selectedExceptionToolId.value) {
    return;
  }
  setPermissionGroupToolRule(props.group, selectedExceptionToolId.value, selectedExceptionRule.value);
}

function ruleLabel(rule: PermissionToolRule) {
  return t(rule === "allow" ? "允许" : "未启用");
}
</script>

<template>
  <article
    class="surface-card agent-permission-group-card"
    :data-enabled="group.enabled"
  >
    <div class="section-header">
      <div class="form-grid compact-form-grid permission-group-title-grid">
        <label>
          <span>{{ t("权限组名称") }}</span>
          <input v-model="groupLabelValue" autocomplete="off" />
        </label>
        <label>
          <span>{{ t("权限组 ID") }}</span>
          <input v-model="group.id" autocomplete="off" />
        </label>
      </div>
      <div class="permission-actions">
        <FeatureToggle
          :model-value="group.enabled"
          :aria-label="t(group.enabled ? '停用权限组' : '启用权限组')"
          @update:model-value="group.enabled = Boolean($event)"
        />
        <button class="table-action danger-action" type="button" @click="removeAgentPermissionGroup(group)">
          {{ t("删除") }}
        </button>
      </div>
    </div>
    <label class="module-field">
      <span>{{ t("说明") }}</span>
      <input v-model="groupDescriptionValue" autocomplete="off" />
    </label>

    <PactTabs v-model="activeSection" :tabs="groupSectionTabs" variant="line" size="small" :aria-label="t('权限组详情')" />

    <section v-if="activeSection === 'overview'" class="agent-permission-detail-section">
      <div class="agent-permission-summary-grid">
        <div>
          <span>{{ t("权限范围") }}</span>
          <strong>{{ group.scopeIds.length }}</strong>
        </div>
        <div>
          <span>{{ t("工具集") }}</span>
          <strong>{{ group.toolsetIds.length }}</strong>
        </div>
        <div>
          <span>{{ t("允许例外") }}</span>
          <strong>{{ group.toolAllow.length }}</strong>
        </div>
        <div>
          <span>{{ t("停用例外") }}</span>
          <strong>{{ group.toolDeny.length }}</strong>
        </div>
      </div>
      <dl class="agent-permission-summary-list">
        <div>
          <dt>{{ t("已选权限范围") }}</dt>
          <dd>{{ selectedScopeLabels.join(" / ") || t("未选择") }}</dd>
        </div>
        <div>
          <dt>{{ t("已选工具集") }}</dt>
          <dd>{{ selectedToolsetLabels.join(" / ") || t("未选择") }}</dd>
        </div>
        <div>
          <dt>{{ t("单工具例外") }}</dt>
          <dd>{{ exceptionRows.length ? `${exceptionRows.length} ${t("项例外")}` : t("无例外，全部继承工具集规则") }}</dd>
        </div>
      </dl>
    </section>

    <section v-else-if="activeSection === 'scopes'" class="agent-permission-detail-section">
      <ScopeSelector
        v-model="group.scopeIds"
        :scopes="toolScopes"
        compact
      />
    </section>

    <section v-else-if="activeSection === 'toolsets'" class="agent-permission-detail-section">
      <div class="scope-grid compact-scope-grid">
        <button
          v-for="toolset in grantableToolsets"
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
    </section>

    <section v-else class="agent-permission-detail-section">
      <div class="permission-exception-toolbar">
        <label class="module-field">
          <span>{{ t("添加工具例外") }}</span>
          <select v-model="selectedExceptionToolId" :disabled="availableExceptionTools.length === 0">
            <option
              v-for="tool in availableExceptionTools"
              :key="tool.id"
              :value="tool.id"
            >
              {{ tool.label }}
            </option>
          </select>
        </label>
        <label class="module-field compact-select-field">
          <span>{{ t("规则") }}</span>
          <select v-model="selectedExceptionRule">
            <option value="deny">{{ t("未启用") }}</option>
            <option value="allow">{{ t("允许") }}</option>
          </select>
        </label>
        <button
          class="tool-button"
          type="button"
          :disabled="!selectedExceptionToolId"
          @click="addToolException"
        >
          {{ t("添加例外") }}
        </button>
      </div>

      <div v-if="exceptionRows.length > 0" class="job-table compact-job-table permission-tool-rule-table">
        <div class="job-table-header">
          <span>{{ t("工具") }}</span>
          <span>{{ t("当前规则") }}</span>
          <span>{{ t("操作") }}</span>
        </div>
        <div
          v-for="row in exceptionRows"
          :key="`${group.id}:${row.toolId}`"
          class="job-row"
        >
          <span>
            <strong>{{ row.label }}</strong>
            <small>{{ row.description }}</small>
          </span>
          <span>{{ ruleLabel(row.rule) }}</span>
          <span class="permission-actions">
            <button
              class="table-action"
              type="button"
              @click="setPermissionGroupToolRule(group, row.toolId, 'inherit')"
            >
              {{ t("继承") }}
            </button>
            <button
              class="table-action"
              type="button"
              @click="setPermissionGroupToolRule(group, row.toolId, 'allow')"
            >
              {{ t("允许") }}
            </button>
            <button
              class="table-action danger-action"
              type="button"
              @click="setPermissionGroupToolRule(group, row.toolId, 'deny')"
            >
              {{ t("未启用") }}
            </button>
          </span>
        </div>
      </div>
      <div v-else-if="toolManagementTools.length === 0" class="empty-state compact-empty-state">
        <strong>{{ t("尚未加载工具目录") }}</strong>
      </div>
      <div v-else class="empty-state compact-empty-state">
        <strong>{{ t("暂无单工具例外") }}</strong>
        <span>{{ t("当前权限组全部继承工具集规则。") }}</span>
      </div>
    </section>
  </article>
</template>
