<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import BinaryCheckbox from "../../components/BinaryCheckbox.vue";
import FeatureToggle from "../../components/FeatureToggle.vue";
import StatusPill from "../../components/StatusPill.vue";
import { usePageRefreshHandler } from "../../composables/usePageRefresh";
import {
  getExternalServices,
  type ExternalServiceEntry,
  type ExternalServiceState,
} from "../../lib/external-services-client";
import { getRuntimeInfo } from "../../lib/runtime-info-client";
import type { FeatureRuntimeSummary, RuntimeInfoResponse, RuntimeMountInfo } from "../../lib/types";

type AssemblySelection = Record<string, boolean>;

type AssemblyItem = {
  id: string;
  label: string;
  detail: string;
  enabled: boolean;
  statusLabel: string;
};

const runtimeInfo = ref<RuntimeInfoResponse | null>(null);
const externalServiceState = ref<ExternalServiceState | null>(null);
const loading = ref(false);
const loadError = ref("");

const selectedServices = ref<AssemblySelection>({});
const selectedCapabilities = ref<AssemblySelection>({});
const selectedModules = ref<AssemblySelection>({});

function serviceLabel(entry: ExternalServiceEntry) {
  return entry.displayName || entry.serviceName || entry.serviceId;
}

function serviceDetail(entry: ExternalServiceEntry) {
  const upstream = entry.externalMcp?.upstream;
  const upstreamLabel = [
    upstream?.type,
    upstream?.provider,
    upstream?.transport,
  ].filter(Boolean).join(" / ");
  const toolCount = Number(entry.externalMcp?.toolCount || 0);
  return [
    entry.mode,
    upstreamLabel,
    toolCount ? `${toolCount} 个工具` : "",
  ].filter(Boolean).join(" · ") || entry.description || "外部服务";
}

function mountCapabilityText(mount: RuntimeMountInfo) {
  const capabilities = [
    mount.supportsStructuredDocument ? "结构化文档" : "",
    mount.supportsTextExtraction ? "文本提取" : "",
    mount.supportsBatchHook ? "批次回调" : "",
  ].filter(Boolean);
  return capabilities.length > 0 ? capabilities.join(" / ") : "基础运行";
}

function capabilityItemsFromFeatures(features: FeatureRuntimeSummary | null | undefined): AssemblyItem[] {
  if (!features) {
    return [];
  }
  if (features.activeFeatures?.length) {
    return features.activeFeatures.map((feature) => ({
      id: feature.featureId,
      label: feature.label || feature.featureId,
      detail: [feature.group, feature.reason].filter(Boolean).join(" · ") || "已启用能力",
      enabled: true,
      statusLabel: feature.required ? "必选" : "已启用",
    }));
  }
  return (features.activeFeatureIds || []).map((featureId) => ({
    id: featureId,
    label: featureId,
    detail: features.profileName || features.edition || "已启用能力",
    enabled: true,
    statusLabel: "已启用",
  }));
}

const serviceItems = computed<AssemblyItem[]>(() =>
  (externalServiceState.value?.services || []).map((entry) => {
    const enabled = entry.validationStatus === "valid";
    return {
      id: entry.serviceId,
      label: serviceLabel(entry),
      detail: serviceDetail(entry),
      enabled,
      statusLabel: enabled ? "可用" : "不可用",
    };
  }),
);

const capabilityItems = computed<AssemblyItem[]>(() =>
  capabilityItemsFromFeatures(runtimeInfo.value?.features),
);

const moduleItems = computed<AssemblyItem[]>(() =>
  (runtimeInfo.value?.runtime.mounts || []).map((mount) => {
    const enabled = mount.enabled !== false;
    return {
      id: mount.id || mount.name,
      label: mount.name || mount.id,
      detail: `${mount.kind || "mount"} · ${mountCapabilityText(mount)}`,
      enabled,
      statusLabel: enabled ? "可用" : mount.reason || "不可用",
    };
  }),
);

function syncSelection(bucket: typeof selectedServices, items: AssemblyItem[]) {
  const next: AssemblySelection = {};
  for (const item of items) {
    next[item.id] = itemMustStaySelected(item) || (item.enabled && (bucket.value[item.id] ?? item.enabled));
  }
  bucket.value = next;
}

function syncAllSelections() {
  syncSelection(selectedServices, serviceItems.value);
  syncSelection(selectedCapabilities, capabilityItems.value);
  syncSelection(selectedModules, moduleItems.value);
}

function selectedCount(bucket: AssemblySelection, items: AssemblyItem[]) {
  return items.filter((item) => Boolean(bucket[item.id])).length;
}

const selectedServiceCount = computed(() => selectedCount(selectedServices.value, serviceItems.value));
const selectedCapabilityCount = computed(() => selectedCount(selectedCapabilities.value, capabilityItems.value));
const selectedModuleCount = computed(() => selectedCount(selectedModules.value, moduleItems.value));
const selectedTotalCount = computed(() =>
  selectedServiceCount.value + selectedCapabilityCount.value + selectedModuleCount.value,
);
const totalItemCount = computed(() =>
  serviceItems.value.length + capabilityItems.value.length + moduleItems.value.length,
);

function setSelection(bucket: typeof selectedServices, items: AssemblyItem[], value: boolean) {
  const next: AssemblySelection = {};
  for (const item of items) {
    next[item.id] = itemMustStaySelected(item) || (value && item.enabled);
  }
  bucket.value = next;
}

function itemMustStaySelected(item: AssemblyItem) {
  return item.statusLabel === "必选";
}

function itemToggleDisabled(item: AssemblyItem) {
  return !item.enabled || itemMustStaySelected(item);
}

function setItemSelection(bucket: AssemblySelection, item: AssemblyItem, value: boolean) {
  bucket[item.id] = itemMustStaySelected(item) || (value && item.enabled);
}

function itemToggleAriaLabel(item: AssemblyItem, selected: boolean) {
  if (itemMustStaySelected(item)) {
    return `${item.label} 必选`;
  }
  if (!item.enabled) {
    return `${item.label} 不可用`;
  }
  return selected ? `从版本装配移除 ${item.label}` : `加入版本装配 ${item.label}`;
}

function setServiceSelection(value: boolean) {
  setSelection(selectedServices, serviceItems.value, value);
}

function setCapabilitySelection(value: boolean) {
  setSelection(selectedCapabilities, capabilityItems.value, value);
}

function setModuleSelection(value: boolean) {
  setSelection(selectedModules, moduleItems.value, value);
}

async function refreshVersionAssembly() {
  loading.value = true;
  loadError.value = "";
  const [runtimeResult, servicesResult] = await Promise.allSettled([
    getRuntimeInfo(),
    getExternalServices(),
  ]);

  if (runtimeResult.status === "fulfilled") {
    runtimeInfo.value = runtimeResult.value;
  }
  if (servicesResult.status === "fulfilled") {
    externalServiceState.value = servicesResult.value;
  }

  const errors = [
    runtimeResult.status === "rejected" ? "运行时信息读取失败" : "",
    servicesResult.status === "rejected" ? "服务列表读取失败" : "",
  ].filter(Boolean);
  loadError.value = errors.join("；");
  syncAllSelections();
  loading.value = false;
}

onMounted(() => {
  void refreshVersionAssembly();
});

usePageRefreshHandler(
  (detail) => detail.viewId === "admin" && detail.adminView === "versionAssembly",
  refreshVersionAssembly,
);
</script>

<template>
  <section class="version-assembly-layout">
    <article class="surface-card version-assembly-hero">
      <div class="section-header">
        <div>
          <h3>版本装配</h3>
          <p>将当前控制面板发现的服务、能力和模块裁剪为新的服务运行时包副本。</p>
        </div>
        <StatusPill
          :tone="loading ? 'info' : loadError ? 'warning' : 'success'"
          :label="loading ? '同步中' : loadError ? '部分读取' : '已同步'"
        />
      </div>
      <div class="detail-metrics version-assembly-metrics">
        <div>
          <span>服务</span>
          <strong>{{ selectedServiceCount }} / {{ serviceItems.length }}</strong>
        </div>
        <div>
          <span>能力</span>
          <strong>{{ selectedCapabilityCount }} / {{ capabilityItems.length }}</strong>
        </div>
        <div>
          <span>模块</span>
          <strong>{{ selectedModuleCount }} / {{ moduleItems.length }}</strong>
        </div>
        <div>
          <span>装配项</span>
          <strong>{{ selectedTotalCount }} / {{ totalItemCount }}</strong>
        </div>
      </div>
      <div v-if="loadError" class="status-strip warning">
        <strong>读取不完整</strong>
        <span>{{ loadError }}</span>
      </div>
    </article>

    <section class="version-assembly-grid">
      <article class="surface-card version-assembly-selection-card">
        <div class="section-header version-assembly-card-header">
          <div>
            <h3>服务</h3>
            <p>{{ selectedServiceCount }} 个已选择</p>
          </div>
          <div class="version-assembly-card-actions">
            <button class="table-action" type="button" @click="setServiceSelection(true)">全选</button>
            <button class="table-action" type="button" @click="setServiceSelection(false)">清空</button>
          </div>
        </div>
        <div class="version-assembly-list">
          <div v-if="serviceItems.length === 0" class="version-assembly-empty">暂无服务</div>
          <div v-for="item in serviceItems" :key="item.id" class="version-assembly-row">
            <BinaryCheckbox
              :model-value="Boolean(selectedServices[item.id])"
              :label="item.label"
              :disabled="itemToggleDisabled(item)"
              @update:model-value="setItemSelection(selectedServices, item, $event)"
            />
            <FeatureToggle
              :model-value="Boolean(selectedServices[item.id])"
              :aria-label="itemToggleAriaLabel(item, Boolean(selectedServices[item.id]))"
              :disabled="itemToggleDisabled(item)"
              @update:model-value="setItemSelection(selectedServices, item, $event)"
            />
            <p>{{ item.detail }}</p>
          </div>
        </div>
      </article>

      <article class="surface-card version-assembly-selection-card">
        <div class="section-header version-assembly-card-header">
          <div>
            <h3>能力</h3>
            <p>{{ selectedCapabilityCount }} 个已选择</p>
          </div>
          <div class="version-assembly-card-actions">
            <button class="table-action" type="button" @click="setCapabilitySelection(true)">全选</button>
            <button class="table-action" type="button" @click="setCapabilitySelection(false)">清空</button>
          </div>
        </div>
        <div class="version-assembly-list">
          <div v-if="capabilityItems.length === 0" class="version-assembly-empty">暂无能力</div>
          <div v-for="item in capabilityItems" :key="item.id" class="version-assembly-row">
            <BinaryCheckbox
              :model-value="Boolean(selectedCapabilities[item.id])"
              :label="item.label"
              :disabled="itemToggleDisabled(item)"
              @update:model-value="setItemSelection(selectedCapabilities, item, $event)"
            />
            <FeatureToggle
              :model-value="Boolean(selectedCapabilities[item.id])"
              :aria-label="itemToggleAriaLabel(item, Boolean(selectedCapabilities[item.id]))"
              :disabled="itemToggleDisabled(item)"
              @update:model-value="setItemSelection(selectedCapabilities, item, $event)"
            />
            <p>{{ item.detail }}</p>
          </div>
        </div>
      </article>

      <article class="surface-card version-assembly-selection-card">
        <div class="section-header version-assembly-card-header">
          <div>
            <h3>模块</h3>
            <p>{{ selectedModuleCount }} 个已选择</p>
          </div>
          <div class="version-assembly-card-actions">
            <button class="table-action" type="button" @click="setModuleSelection(true)">全选</button>
            <button class="table-action" type="button" @click="setModuleSelection(false)">清空</button>
          </div>
        </div>
        <div class="version-assembly-list">
          <div v-if="moduleItems.length === 0" class="version-assembly-empty">暂无模块</div>
          <div v-for="item in moduleItems" :key="item.id" class="version-assembly-row">
            <BinaryCheckbox
              :model-value="Boolean(selectedModules[item.id])"
              :label="item.label"
              :disabled="itemToggleDisabled(item)"
              @update:model-value="setItemSelection(selectedModules, item, $event)"
            />
            <FeatureToggle
              :model-value="Boolean(selectedModules[item.id])"
              :aria-label="itemToggleAriaLabel(item, Boolean(selectedModules[item.id]))"
              :disabled="itemToggleDisabled(item)"
              @update:model-value="setItemSelection(selectedModules, item, $event)"
            />
            <p>{{ item.detail }}</p>
          </div>
        </div>
      </article>
    </section>

    <article class="surface-card version-assembly-action-card">
      <div class="section-header">
        <div>
          <h3>装配输出</h3>
          <p>生成一个裁剪后的服务运行时包副本，原运行时保持不变。</p>
        </div>
        <button class="primary-action" type="button" disabled>
          生成运行时包副本
        </button>
      </div>
      <div class="status-strip warning">
        <strong>等待后端装配接口</strong>
        <span>当前页面已完成装配清单选择，实际产物生成需要接入服务端版本装配 API。</span>
      </div>
    </article>
  </section>
</template>

<style scoped>
.version-assembly-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.version-assembly-hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.version-assembly-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.version-assembly-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  gap: var(--space-4);
}

.version-assembly-grid > .surface-card + .surface-card {
  margin-top: 0;
}

.version-assembly-selection-card,
.version-assembly-action-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.version-assembly-selection-card {
  --version-assembly-row-height: 76px;
  --version-assembly-row-gap: var(--space-2);
  --version-assembly-list-max-height: 832px;
  max-height: calc(var(--version-assembly-list-max-height) + 160px);
  overflow: hidden;
}

.version-assembly-card-header {
  align-items: flex-start;
  gap: var(--space-3);
}

.version-assembly-card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.version-assembly-list {
  display: flex;
  flex-direction: column;
  gap: var(--version-assembly-row-gap, var(--space-2));
  max-height: var(--version-assembly-list-max-height);
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--space-1);
}

.version-assembly-row {
  min-width: 0;
  min-height: var(--version-assembly-row-height, 76px);
  max-height: var(--version-assembly-row-height, 76px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  overflow: hidden;
}

.version-assembly-row :deep(.binary-checkbox) {
  justify-self: start;
  max-width: 100%;
  min-width: 0;
  padding: 0;
  border-color: transparent;
  background: transparent;
  overflow: hidden;
}

.version-assembly-row :deep(.binary-checkbox:hover:not(:disabled)),
.version-assembly-row :deep(.binary-checkbox[data-checked="true"]),
.version-assembly-row :deep(.binary-checkbox[data-checked="true"]:hover:not(:disabled)) {
  border-color: transparent;
  background: transparent;
}

.version-assembly-row :deep(.binary-checkbox-label) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.version-assembly-row :deep(.feature-toggle) {
  justify-self: end;
}

.version-assembly-row p {
  grid-column: 1 / -1;
  min-width: 0;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-assembly-empty {
  min-height: 72px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-weight: var(--font-semibold);
}

@media (max-width: 1180px) {
  .version-assembly-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .version-assembly-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .version-assembly-card-header,
  .version-assembly-action-card > .section-header {
    align-items: stretch;
  }
}
</style>
