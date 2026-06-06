<script setup lang="ts">
import { Setting } from "@element-plus/icons-vue";
import { computed, ref, watch } from "vue";
import ConfigFloatingPanel from "../../ConfigFloatingPanel.vue";
import ConfigListSummaryBubble from "../../ConfigListSummaryBubble.vue";
import StatusPill from "../../StatusPill.vue";
import { useRuntimeDownloadsViewContext } from "../../../composables/runtimeDownloadsViewContext";
import {
  runtimeConfigurationGroups,
  saveRuntimeDependencyConfiguration,
  statusLabel,
  statusTone,
  type RuntimeDependency,
  type RuntimeDependencyConfigurationEntry,
} from "../../../lib/runtime-dependencies";

const props = defineProps<{
  item: RuntimeDependency;
}>();

const {
  dependencyStatusForRow,
  loadError,
  loading,
  refreshRuntimeDependencies,
} = useRuntimeDownloadsViewContext();

const panelOpen = ref(false);
const saving = ref(false);
const saveError = ref("");
const saveMessage = ref("");
const draftValues = ref<Record<string, string>>({});
const groups = computed(() => runtimeConfigurationGroups(props.item));
const allEntries = computed(() => groups.value.flatMap((group) => group.entries || []));
const editableEntries = computed(() => allEntries.value.filter((entry) => entry.editable === true));
const editableCount = computed(() => editableEntries.value.length);
const configStatusLabel = computed(() => editableCount.value ? `${editableCount.value} 项可修改` : "只读配置");
const configStatusTone = computed(() => editableCount.value ? "info" : "neutral");
const currentStatus = computed(() => dependencyStatusForRow(props.item));

function initialEntryValue(entry: RuntimeDependencyConfigurationEntry) {
  return String(entry.value || "").trim() === "未配置" ? "" : String(entry.value || "");
}

function entryValue(entry: RuntimeDependencyConfigurationEntry) {
  const key = entry.key;
  if (Object.prototype.hasOwnProperty.call(draftValues.value, key)) {
    return draftValues.value[key];
  }
  return initialEntryValue(entry);
}

function entryState(entry: RuntimeDependencyConfigurationEntry) {
  if (entry.required && !entry.configured && !entryValue(entry)) return "必填未配置";
  return entry.configured === false && !entryValue(entry) ? "未配置" : "已配置";
}

function entryInputType(entry: RuntimeDependencyConfigurationEntry) {
  if (entry.options?.length) return "select";
  const inputType = String(entry.inputType || "").trim();
  if (inputType) return inputType;
  if (entry.key.toLowerCase().includes("url")) return "url";
  return "text";
}

function entryControlId(entry: RuntimeDependencyConfigurationEntry) {
  return `runtime-config-${props.item.id}-${entry.key}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

function resetDraft() {
  draftValues.value = Object.fromEntries(
    editableEntries.value.map((entry) => [entry.key, initialEntryValue(entry)]),
  );
  saveError.value = "";
  saveMessage.value = "";
}

function openPanel() {
  resetDraft();
  panelOpen.value = true;
}

function closePanel() {
  panelOpen.value = false;
}

function updateDraft(key: string, value: string) {
  draftValues.value = {
    ...draftValues.value,
    [key]: value,
  };
}

async function refreshDetection() {
  saveError.value = "";
  saveMessage.value = "";
  await refreshRuntimeDependencies({ silent: true });
  if (loadError.value) {
    saveError.value = loadError.value;
    return;
  }
  resetDraft();
  saveMessage.value = "已重新检测运行时配置。";
}

async function saveConfig() {
  if (!editableEntries.value.length || saving.value) return;
  saving.value = true;
  saveError.value = "";
  saveMessage.value = "";
  try {
    await saveRuntimeDependencyConfiguration(
      props.item.id,
      editableEntries.value.map((entry) => ({
        key: entry.key,
        value: draftValues.value[entry.key] ?? "",
      })),
    );
    await refreshRuntimeDependencies({ silent: true });
    if (loadError.value) {
      saveError.value = `配置已保存，但重新检测失败：${loadError.value}`;
    } else {
      saveMessage.value = "配置已保存。";
    }
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

watch(() => props.item, () => {
  if (panelOpen.value) resetDraft();
});
</script>

<template>
  <button
    class="tool-button tool-button-ghost runtime-dependency-config-button"
    type="button"
    :aria-label="`配置 ${item.label}`"
    @click="openPanel"
  >
    <Setting aria-hidden="true" />
    <span>配置</span>
  </button>

  <ConfigFloatingPanel
    :open="panelOpen"
    :title="`${item.label} 配置`"
    subtitle="修改平台本地源配置；系统 PATH、环境变量和命令行参数在此展示来源状态。"
    :status-label="configStatusLabel"
    :status-tone="configStatusTone"
    :verifying="loading"
    verify-label="重新检测"
    verifying-label="检测中"
    @close="closePanel"
    @verify="refreshDetection"
  >
    <template #toolbar>
      <ConfigListSummaryBubble
        :title="item.label"
        :groups="groups"
        button-label="概览"
        button-class="tool-button tool-button-ghost runtime-dependency-config-summary-button"
      />
    </template>

    <div v-if="saveError" class="runtime-config-alert is-danger">{{ saveError }}</div>
    <div v-if="saveMessage" class="runtime-config-alert is-info">{{ saveMessage }}</div>

    <form class="runtime-config-form" @submit.prevent="saveConfig">
      <section
        v-for="group in groups"
        :key="`${group.kind || ''}:${group.title}`"
        class="runtime-config-section"
      >
        <div class="runtime-config-section-header">
          <h4>{{ group.title }}</h4>
          <span>{{ group.kind === "source" ? "写入本地源配置" : "当前检测到的配置来源" }}</span>
        </div>
        <div class="runtime-config-grid">
          <label
            v-for="entry in group.entries || []"
            :key="`${group.title}:${entry.key}:${entry.label}`"
            :class="{ 'runtime-config-field-wide': entryInputType(entry) === 'textarea' }"
            class="runtime-config-field"
            :for="entryControlId(entry)"
          >
            <span class="runtime-config-field-label">
              <span>{{ entry.label || entry.key }}</span>
              <small>{{ entryState(entry) }}</small>
            </span>
            <select
              v-if="entryInputType(entry) === 'select'"
              :id="entryControlId(entry)"
              :disabled="entry.editable !== true"
              :value="entryValue(entry)"
              @change="updateDraft(entry.key, ($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="option in entry.options || []"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label || option.value }}
              </option>
            </select>
            <textarea
              v-else-if="entryInputType(entry) === 'textarea'"
              :id="entryControlId(entry)"
              :disabled="entry.editable !== true"
              :value="entryValue(entry)"
              spellcheck="false"
              @input="updateDraft(entry.key, ($event.target as HTMLTextAreaElement).value)"
            />
            <input
              v-else
              :id="entryControlId(entry)"
              :disabled="entry.editable !== true"
              :type="entryInputType(entry) === 'url' ? 'url' : 'text'"
              :value="entryValue(entry)"
              autocomplete="off"
              @input="updateDraft(entry.key, ($event.target as HTMLInputElement).value)"
            />
            <code>{{ entry.key }}</code>
            <small v-if="entry.source || entry.description" class="runtime-config-field-detail">
              {{ [entry.source, entry.description].filter(Boolean).join("；") }}
            </small>
          </label>
        </div>
      </section>

      <div v-if="groups.length === 0" class="empty-state">
        <strong>暂无配置项</strong>
        <span>当前运行时未返回配置字段。</span>
      </div>

      <footer class="runtime-config-footer">
        <StatusPill :tone="statusTone(currentStatus)" :label="statusLabel(currentStatus)" />
        <div>
          <button class="tool-button tool-button-ghost" type="button" @click="closePanel">
            取消
          </button>
          <button
            class="primary-action"
            type="submit"
            :disabled="saving || editableEntries.length === 0"
          >
            {{ saving ? "保存中" : "保存配置" }}
          </button>
        </div>
      </footer>
    </form>
  </ConfigFloatingPanel>
</template>

<style scoped>
.runtime-dependency-config-button svg,
.runtime-dependency-config-summary-button :deep(svg) {
  width: 14px;
  height: 14px;
}

.runtime-config-alert {
  padding: var(--space-2-5) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  line-height: 1.5;
}

.runtime-config-alert.is-danger {
  border: 1px solid var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger);
}

.runtime-config-alert.is-info {
  border: 1px solid var(--info-border);
  background: var(--info-surface);
  color: var(--info);
}

.runtime-config-form {
  display: grid;
  gap: var(--space-4);
}

.runtime-config-section {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.runtime-config-section-header {
  display: grid;
  gap: var(--space-1);
}

.runtime-config-section-header h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
}

.runtime-config-section-header span {
  color: var(--text-muted);
  font-size: var(--text-md);
  line-height: 1.45;
}

.runtime-config-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.runtime-config-field {
  display: grid;
  gap: var(--space-1-5);
  min-width: 0;
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
}

.runtime-config-field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.runtime-config-field-label span {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-config-field-label small {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

.runtime-config-field input,
.runtime-config-field select,
.runtime-config-field textarea {
  width: 100%;
  min-height: 34px;
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font: inherit;
  font-weight: var(--font-normal);
}

.runtime-config-field textarea {
  min-height: 92px;
  padding: var(--space-2-5);
  resize: vertical;
  line-height: 1.5;
}

.runtime-config-field input:focus,
.runtime-config-field select:focus,
.runtime-config-field textarea:focus {
  border-color: var(--brand);
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-subtle);
}

.runtime-config-field input:disabled,
.runtime-config-field select:disabled,
.runtime-config-field textarea:disabled {
  background: var(--bg-inset);
  color: var(--text-muted);
}

.runtime-config-field code {
  min-width: 0;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  overflow-wrap: anywhere;
}

.runtime-config-field-detail {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.runtime-config-field-wide {
  grid-column: span 3;
}

.runtime-config-footer {
  position: sticky;
  bottom: 0;
  z-index: var(--z-raised);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-xs);
}

.runtime-config-footer > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 760px) {
  .runtime-config-grid {
    grid-template-columns: 1fr;
  }

  .runtime-config-field-wide {
    grid-column: auto;
  }
}
</style>
