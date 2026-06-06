<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AgentModelOptionBar from "../../components/AgentModelOptionBar.vue";
import BinaryCheckbox from "../../components/BinaryCheckbox.vue";
import OptionBar from "../../components/OptionBar.vue";
import StatusPill from "../../components/StatusPill.vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";
import type { AgentModelConfig, ModelProbeResponse } from "../../lib/types";

type DefaultAgentKey =
  | "infoFeedSummaryModelAlias"
  | "agentRetrievalModelAlias"
  | "ruleAuthoringModelAlias"
  | "reviewFusionModelAlias";

const BATCH_PLACEHOLDER_VALUE = "__pact_agent_assignment_batch_placeholder__";

type AssignmentProbeFailure = {
  key: string;
  label: string;
  message: string;
};

type AssignmentProbeTarget = {
  key: string;
  label: string;
  entry: AgentModelConfig | null;
  usageLabels: string[];
};

const {
  agentExploreAgentOptions,
  agentExploreForm,
  agentSelectorOptions,
  busyKey,
  error,
  highlightedConfigTarget,
  infoFeedForm,
  infoFeedModelOptions,
  intelligentModuleDefinitions,
  modelEntryStatusKey,
  moduleModelAssignmentSelectOptions,
  moduleModelAssignmentStats,
  moduleModelRef,
  moduleNeedsIntelligence,
  parseModelRef,
  ruleAuthoringForm,
  ruleAuthoringModelOptions,
  runModelEntryProbe,
  saveSettings,
  setModuleModelRef,
  setModuleNeedsIntelligence,
  settingsDraft,
  visibleModelEntries,
} = useServerConsoleShellContext();
const route = useRoute();
const routeHighlightedConfigTarget = ref("");
let routeHighlightTimer: ReturnType<typeof window.setTimeout> | null = null;
const activeProbeScope = ref<"" | "business" | "module">("");
const businessProbeFailures = ref<AssignmentProbeFailure[]>([]);
const moduleProbeFailures = ref<AssignmentProbeFailure[]>([]);
const agentAssignmentSaving = computed(() => busyKey.value === "settings" || Boolean(activeProbeScope.value));
const businessSaveButtonText = computed(() => {
  if (activeProbeScope.value === "business") {
    return "检测中";
  }
  return busyKey.value === "settings" ? "保存中" : "保存";
});
const moduleSaveButtonText = computed(() => {
  if (activeProbeScope.value === "module") {
    return "检测中";
  }
  return busyKey.value === "settings" ? "保存中" : "保存";
});

const routeConfigTarget = computed(() => {
  const rawTarget = route.query.configTarget;
  const target = Array.isArray(rawTarget) ? rawTarget[0] : rawTarget;
  return String(target || "").trim();
});

const activeHighlightedConfigTarget = computed(() =>
  String(highlightedConfigTarget.value || routeHighlightedConfigTarget.value || "").trim(),
);

function configTargetIsHighlighted(targetId: string) {
  return activeHighlightedConfigTarget.value === targetId;
}

function clearRouteConfigHighlightTimer() {
  if (typeof window !== "undefined" && routeHighlightTimer) {
    window.clearTimeout(routeHighlightTimer);
  }
  routeHighlightTimer = null;
}

function configTargetElement(targetId: string) {
  if (typeof document === "undefined") {
    return null;
  }
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[data-config-target]"))
      .find((element) => element.dataset.configTarget === targetId) || null
  );
}

async function waitForNextFrame() {
  if (typeof window === "undefined") {
    return;
  }
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function revealRouteConfigTarget(targetId: string) {
  const target = String(targetId || "").trim();
  if (!target) {
    return;
  }
  clearRouteConfigHighlightTimer();
  routeHighlightedConfigTarget.value = target;
  await nextTick();
  await waitForNextFrame();
  configTargetElement(target)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  if (typeof window === "undefined") {
    return;
  }
  routeHighlightTimer = window.setTimeout(() => {
    if (routeHighlightedConfigTarget.value === target) {
      routeHighlightedConfigTarget.value = "";
    }
    routeHighlightTimer = null;
  }, 4000);
}

watch(
  routeConfigTarget,
  (target) => {
    void revealRouteConfigTarget(target);
  },
  { immediate: true },
);

function defaultAgentValue(key: DefaultAgentKey, fallback = "") {
  return String(settingsDraft.value.agentExploreDefaults?.[key] || fallback || "").trim();
}

function setDefaultAgentValue(key: DefaultAgentKey, value: string) {
  businessProbeFailures.value = [];
  const modelAlias = String(value || "").trim();
  settingsDraft.value.agentExploreDefaults = {
    ...settingsDraft.value.agentExploreDefaults,
    [key]: modelAlias,
  };
  if (key === "infoFeedSummaryModelAlias") {
    infoFeedForm.value.modelAlias = modelAlias;
  } else if (key === "agentRetrievalModelAlias") {
    agentExploreForm.value.modelAlias = modelAlias;
  } else if (key === "ruleAuthoringModelAlias") {
    ruleAuthoringForm.value.modelAlias = modelAlias;
  }
}

function selectedOptionStatus(options: Array<{ value?: unknown; enabled?: boolean; disabledReason?: string }>, value: string) {
  const modelAlias = String(value || "").trim();
  if (!modelAlias) {
    return { label: "未分配", tone: "warning" };
  }
  const option = options.find((item) => String(item.value || "").trim() === modelAlias);
  if (!option?.enabled) {
    return { label: "不可用", tone: "danger" };
  }
  return { label: "已分配", tone: "success" };
}

function optionValue(option: { value?: unknown }) {
  return String(option.value || "").trim();
}

function optionLabel(option: { value?: unknown; label?: string }) {
  return String(option.label || optionValue(option)).trim();
}

function optionIsEnabled(option: { enabled?: boolean; disabled?: boolean }) {
  return option.enabled !== false && option.disabled !== true;
}

const businessAssignments = computed(() => [
  {
    id: "info-feed-summary-agent",
    title: "信息流智能体",
    description: "信息流最终报告的默认总结智能体，负责融合原文检索、智能规划和附件结果。",
    value: defaultAgentValue("infoFeedSummaryModelAlias", infoFeedForm.value.modelAlias),
    options: infoFeedModelOptions.value,
    update: (value: string) => setDefaultAgentValue("infoFeedSummaryModelAlias", value),
  },
  {
    id: "agent-explore-agent",
    title: "知识检索智能体",
    description: "智能检索默认智能体，负责规划工具调用、打开证据并生成回答。",
    value: defaultAgentValue("agentRetrievalModelAlias", agentExploreForm.value.modelAlias),
    options: agentExploreAgentOptions.value,
    update: (value: string) => setDefaultAgentValue("agentRetrievalModelAlias", value),
  },
  {
    id: "rule-authoring-agent",
    title: "创建规则智能体",
    description: "规则生成对话模式的默认智能体，用于根据需求生成规则草稿。",
    value: defaultAgentValue("ruleAuthoringModelAlias", ruleAuthoringForm.value.modelAlias),
    options: ruleAuthoringModelOptions.value,
    update: (value: string) => setDefaultAgentValue("ruleAuthoringModelAlias", value),
  },
  {
    id: "knowledge-review-fusion-agent",
    title: "知识融合智能体",
    description: "审批流知识融合默认智能体，用于合并多路知识证据和结构化结果。",
    value: defaultAgentValue("reviewFusionModelAlias"),
    options: agentSelectorOptions.value,
    update: (value: string) => setDefaultAgentValue("reviewFusionModelAlias", value),
  },
]);

const assignedBusinessCount = computed(() =>
  businessAssignments.value.filter((item) => String(item.value || "").trim()).length,
);

const businessBatchValue = computed(() => {
  const values = businessAssignments.value.map((item) => String(item.value || "").trim());
  const firstValue = values[0] || "";
  return firstValue && values.every((value) => value === firstValue) ? firstValue : "";
});

const businessBatchOptions = computed(() => {
  const assignments = businessAssignments.value;
  if (!assignments.length) {
    return [];
  }
  const optionMaps = assignments.map((assignment) =>
    new Map(
      assignment.options
        .filter((option) => optionValue(option) && optionIsEnabled(option))
        .map((option) => [optionValue(option), option]),
    ),
  );
  const firstOptions = assignments[0]?.options || [];
  return firstOptions
    .filter((option) => {
      const value = optionValue(option);
      return Boolean(value && optionMaps.every((optionMap) => optionMap.has(value)));
    })
    .map((option) => ({
      value: optionValue(option),
      label: optionLabel(option),
    }));
});

const businessBatchSelectValue = computed(() => businessBatchValue.value || BATCH_PLACEHOLDER_VALUE);
const businessBatchSelectOptions = computed(() => [
  { value: BATCH_PLACEHOLDER_VALUE, label: "选择智能体", disabled: true },
  { value: "", label: "清空分配" },
  ...businessBatchOptions.value,
]);

function applyBusinessBatch(value: string | number | boolean | Array<string | number | boolean>) {
  const nextValue = Array.isArray(value) ? value[0] : value;
  const modelAlias = String(nextValue || "").trim();
  if (modelAlias === BATCH_PLACEHOLDER_VALUE) {
    return;
  }
  for (const assignment of businessAssignments.value) {
    assignment.update(modelAlias);
  }
}

function moduleAssignmentOptions(moduleId: string) {
  return [
    { value: "", label: "未分配" },
    ...moduleModelAssignmentSelectOptions(moduleId).map((option) => ({
      value: option.value,
      label: option.label,
      disabled: !option.enabled,
    })),
  ];
}

const moduleBatchValue = computed(() => {
  const values = intelligentModuleDefinitions.map((moduleDefinition) => moduleModelRef(moduleDefinition.id));
  const firstValue = values[0] || "";
  return firstValue && values.every((value) => value === firstValue) ? firstValue : "";
});

const moduleBatchOptions = computed(() => {
  const moduleIds = intelligentModuleDefinitions.map((moduleDefinition) => moduleDefinition.id);
  if (!moduleIds.length) {
    return [];
  }
  const optionMaps = moduleIds.map((moduleId) =>
    new Map(
      moduleModelAssignmentSelectOptions(moduleId)
        .filter((option) => option.value && option.enabled)
        .map((option) => [String(option.value || "").trim(), option]),
    ),
  );
  return moduleModelAssignmentSelectOptions(moduleIds[0] || "")
    .filter((option) => {
      const value = String(option.value || "").trim();
      return Boolean(value && option.enabled && optionMaps.every((optionMap) => optionMap.has(value)));
    })
    .map((option) => ({
      value: String(option.value || "").trim(),
      label: option.label,
    }));
});

const moduleBatchSelectValue = computed(() => moduleBatchValue.value || BATCH_PLACEHOLDER_VALUE);
const moduleBatchSelectOptions = computed(() => [
  { value: BATCH_PLACEHOLDER_VALUE, label: "选择智能体", disabled: true },
  { value: "", label: "清空分配" },
  ...moduleBatchOptions.value,
]);

function applyModuleBatch(value: string | number | boolean | Array<string | number | boolean>) {
  moduleProbeFailures.value = [];
  const nextValue = Array.isArray(value) ? value[0] : value;
  const refValue = String(nextValue || "").trim();
  if (refValue === BATCH_PLACEHOLDER_VALUE) {
    return;
  }
  for (const moduleDefinition of intelligentModuleDefinitions) {
    setModuleModelRef(moduleDefinition.id, refValue);
  }
}

function updateModuleEnabled(moduleId: string, enabled: boolean) {
  moduleProbeFailures.value = [];
  setModuleNeedsIntelligence(moduleId, enabled);
  if (!enabled) {
    setModuleModelRef(moduleId, "");
  }
}

function updateModuleModelRef(moduleId: string, value: string) {
  moduleProbeFailures.value = [];
  setModuleModelRef(moduleId, value);
}

function moduleStatus(moduleId: string) {
  if (!moduleNeedsIntelligence(moduleId)) {
    return { label: "已关闭", tone: "neutral" };
  }
  return moduleModelRef(moduleId)
    ? { label: "已分配", tone: "success" }
    : { label: "未分配", tone: "warning" };
}

function moduleRequirementLabel(alertRequired?: boolean) {
  return alertRequired === false ? "可选" : "建议分配";
}

function modelEntryIdentityValues(entry: AgentModelConfig) {
  return [
    modelEntryStatusKey(entry),
    entry.uid,
    entry.instanceId,
    entry.alias,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function modelEntryDisplayLabel(entry: AgentModelConfig) {
  const name = String(entry.label || entry.agentName || entry.alias || modelEntryStatusKey(entry)).trim();
  const modelName = String(entry.model || entry.engine || "").trim();
  return modelName && modelName !== name ? `${name} · ${modelName}` : name;
}

function resolveModelEntry(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  const directMatch = visibleModelEntries.value.find((entry) =>
    modelEntryIdentityValues(entry).includes(normalized),
  );
  if (directMatch) {
    return directMatch;
  }
  const parsed = parseModelRef(normalized);
  if (!parsed.provider && !parsed.model) {
    return null;
  }
  return visibleModelEntries.value.find((entry) =>
    String(entry.provider || "").trim() === parsed.provider &&
      modelEntryIdentityValues(entry).includes(parsed.model),
  ) || null;
}

function addProbeTarget(
  targets: Map<string, AssignmentProbeTarget>,
  value: string,
  usageLabel: string,
  fallbackLabel: string,
) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return;
  }
  const entry = resolveModelEntry(normalized);
  const key = entry ? modelEntryStatusKey(entry) : normalized;
  const current = targets.get(key);
  if (current) {
    if (!current.usageLabels.includes(usageLabel)) {
      current.usageLabels.push(usageLabel);
    }
    return;
  }
  targets.set(key, {
    key,
    label: entry ? modelEntryDisplayLabel(entry) : fallbackLabel || normalized,
    entry,
    usageLabels: [usageLabel],
  });
}

function formatProbeFailure(target: AssignmentProbeTarget, result?: ModelProbeResponse | null, fallback = "") {
  const usageText = target.usageLabels.length ? `（用于：${target.usageLabels.join("、")}）` : "";
  return {
    key: target.key,
    label: `${target.label}${usageText}`,
    message: String(result?.message || fallback || "模型连通性检测失败。").trim(),
  };
}

async function probeAssignmentTargets(targets: AssignmentProbeTarget[]) {
  const failures: AssignmentProbeFailure[] = [];
  await Promise.all(targets.map(async (target) => {
    if (!target.entry) {
      failures.push(formatProbeFailure(target, null, "未找到对应的大模型配置。"));
      return;
    }
    try {
      const result = await runModelEntryProbe(target.entry);
      if (!result.ok) {
        failures.push(formatProbeFailure(target, result));
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "模型连通性检测失败。";
      failures.push(formatProbeFailure(target, null, message));
    }
  }));
  return failures.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

async function saveAssignmentsAfterProbe(
  scope: "business" | "module",
  targets: AssignmentProbeTarget[],
  failureRef: typeof businessProbeFailures,
) {
  if (activeProbeScope.value || busyKey.value === "settings") {
    return;
  }
  activeProbeScope.value = scope;
  failureRef.value = [];
  error.value = "";
  try {
    const failures = await probeAssignmentTargets(targets);
    if (failures.length) {
      failureRef.value = failures;
      error.value = `智能体分配保存前连通性检测失败：${failures.map((item) => item.label).join("、")}`;
      return;
    }
    activeProbeScope.value = "";
    await saveSettings();
  } finally {
    if (activeProbeScope.value === scope) {
      activeProbeScope.value = "";
    }
  }
}

function businessProbeTargets() {
  const targets = new Map<string, AssignmentProbeTarget>();
  for (const assignment of businessAssignments.value) {
    const value = String(assignment.value || "").trim();
    if (!value) {
      continue;
    }
    const label = optionLabel(assignment.options.find((option) => optionValue(option) === value) || { value });
    addProbeTarget(targets, value, assignment.title, label);
  }
  return [...targets.values()];
}

function moduleProbeTargets() {
  const targets = new Map<string, AssignmentProbeTarget>();
  for (const moduleDefinition of intelligentModuleDefinitions) {
    if (!moduleNeedsIntelligence(moduleDefinition.id)) {
      continue;
    }
    const value = moduleModelRef(moduleDefinition.id);
    if (!value) {
      continue;
    }
    const option = moduleAssignmentOptions(moduleDefinition.id).find((item) => String(item.value || "").trim() === value);
    addProbeTarget(targets, value, moduleDefinition.label, String(option?.label || value).trim());
  }
  return [...targets.values()];
}

async function saveBusinessAssignments() {
  await saveAssignmentsAfterProbe("business", businessProbeTargets(), businessProbeFailures);
}

async function saveModuleAssignments() {
  await saveAssignmentsAfterProbe("module", moduleProbeTargets(), moduleProbeFailures);
}
</script>

<template>
  <section class="agent-assignment-layout">
    <article class="surface-card agent-assignment-panel">
      <div class="section-header agent-assignment-header">
        <div>
          <h3>智能体业务</h3>
          <p>集中维护业务功能使用的默认智能体。</p>
        </div>
        <div class="agent-assignment-header-actions">
          <div class="agent-assignment-summary" aria-label="智能体分配摘要">
            <span><strong>{{ assignedBusinessCount }}</strong> / {{ businessAssignments.length }} 业务功能</span>
          </div>
          <button
            class="tool-button agent-assignment-save-button"
            type="button"
            :disabled="agentAssignmentSaving"
            aria-label="保存智能体业务配置"
            @click="saveBusinessAssignments"
          >
            {{ businessSaveButtonText }}
          </button>
        </div>
      </div>

      <div v-if="businessProbeFailures.length" class="agent-assignment-probe-alert" role="alert">
        <strong>连通性检测失败，未保存</strong>
        <ul>
          <li v-for="failure in businessProbeFailures" :key="failure.key">
            <span>{{ failure.label }}</span>
            <small>{{ failure.message }}</small>
          </li>
        </ul>
      </div>

      <div class="agent-assignment-list" role="list" aria-label="智能体业务默认智能体">
        <section class="agent-assignment-row agent-assignment-batch-row" role="listitem">
          <div class="agent-assignment-main">
            <div class="agent-assignment-title-row">
              <h4>默认</h4>
            </div>
          </div>
          <div class="agent-assignment-batch-control">
            <span>一键分配到</span>
            <OptionBar
              :model-value="businessBatchSelectValue"
              :options="businessBatchSelectOptions"
              @update:model-value="applyBusinessBatch"
            />
          </div>
        </section>
        <section
          v-for="assignment in businessAssignments"
          :key="assignment.id"
          class="agent-assignment-row"
          role="listitem"
          :data-config-target="assignment.id"
          :data-config-highlighted="configTargetIsHighlighted(assignment.id)"
        >
          <div class="agent-assignment-main">
            <div class="agent-assignment-title-row">
              <h4>{{ assignment.title }}</h4>
              <StatusPill
                :label="selectedOptionStatus(assignment.options, assignment.value).label"
                :tone="selectedOptionStatus(assignment.options, assignment.value).tone"
              />
            </div>
            <p>{{ assignment.description }}</p>
          </div>
          <AgentModelOptionBar
            class="agent-assignment-control"
            :model-value="assignment.value"
            :options="assignment.options"
            include-empty
            empty-label="未分配智能体"
            label="默认智能体"
            @update:model-value="assignment.update(String($event))"
          />
        </section>
      </div>
    </article>

    <article class="surface-card agent-assignment-panel">
      <div class="section-header agent-assignment-header">
        <div>
          <h3>智能体辅助模块</h3>
          <p>为需要大模型参与的后台模块指定主智能体，保存后写入服务端配置。</p>
        </div>
        <div class="agent-assignment-header-actions">
          <div class="agent-assignment-summary" aria-label="智能体辅助模块摘要">
            <span><strong>{{ moduleModelAssignmentStats.assigned }}</strong> / {{ moduleModelAssignmentStats.enabled }} 模块</span>
          </div>
          <button
            class="tool-button agent-assignment-save-button"
            type="button"
            :disabled="agentAssignmentSaving"
            aria-label="保存智能体辅助模块配置"
            @click="saveModuleAssignments"
          >
            {{ moduleSaveButtonText }}
          </button>
        </div>
      </div>

      <div v-if="moduleProbeFailures.length" class="agent-assignment-probe-alert" role="alert">
        <strong>连通性检测失败，未保存</strong>
        <ul>
          <li v-for="failure in moduleProbeFailures" :key="failure.key">
            <span>{{ failure.label }}</span>
            <small>{{ failure.message }}</small>
          </li>
        </ul>
      </div>

      <div class="agent-assignment-list" role="list" aria-label="智能体辅助模块分配">
        <section class="agent-assignment-row agent-assignment-batch-row" role="listitem">
          <div class="agent-assignment-main">
            <div class="agent-assignment-title-row">
              <h4>默认</h4>
            </div>
          </div>
          <div class="agent-assignment-batch-control">
            <span>一键分配到</span>
            <OptionBar
              :model-value="moduleBatchSelectValue"
              :options="moduleBatchSelectOptions"
              @update:model-value="applyModuleBatch"
            />
          </div>
        </section>
        <section
          v-for="moduleDefinition in intelligentModuleDefinitions"
          :key="moduleDefinition.id"
          class="agent-assignment-row module-assignment-row"
          role="listitem"
          :data-config-target="`module-agent-${moduleDefinition.id}`"
          :data-config-highlighted="configTargetIsHighlighted(`module-agent-${moduleDefinition.id}`)"
        >
          <div class="agent-assignment-main">
            <div class="agent-assignment-title-row">
              <h4>{{ moduleDefinition.label }}</h4>
            </div>
            <p>{{ moduleDefinition.description }}</p>
            <div class="agent-assignment-card-tags" aria-label="模块标签">
              <StatusPill
                :label="moduleStatus(moduleDefinition.id).label"
                :tone="moduleStatus(moduleDefinition.id).tone"
              />
              <span class="agent-assignment-card-tag">{{ moduleRequirementLabel(moduleDefinition.alertRequired) }}</span>
              <span class="agent-assignment-card-tag">
                设计模块：{{ moduleDefinition.designedModule || moduleDefinition.id }}
              </span>
            </div>
          </div>
          <div class="module-assignment-controls">
            <BinaryCheckbox
              :model-value="moduleNeedsIntelligence(moduleDefinition.id)"
              label="启用智能体"
              @update:model-value="updateModuleEnabled(moduleDefinition.id, Boolean($event))"
            />
            <OptionBar
              :model-value="moduleModelRef(moduleDefinition.id)"
              :options="moduleAssignmentOptions(moduleDefinition.id)"
              label="主智能体"
              :disabled="!moduleNeedsIntelligence(moduleDefinition.id)"
              @update:model-value="updateModuleModelRef(moduleDefinition.id, String($event))"
            />
          </div>
        </section>
      </div>
    </article>

  </section>
</template>

<style scoped>
.agent-assignment-layout {
  display: grid;
  gap: 18px;
}

.agent-assignment-panel {
  border-radius: 8px;
}

.agent-assignment-header {
  gap: 16px;
  align-items: flex-start;
}

.agent-assignment-header p {
  max-width: 68ch;
}

.agent-assignment-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.agent-assignment-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.agent-assignment-summary span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.agent-assignment-summary strong {
  color: var(--text-primary);
}

.agent-assignment-save-button {
  min-width: 72px;
}

.agent-assignment-probe-alert {
  display: grid;
  gap: 8px;
  margin: -2px 0 14px;
  padding: 12px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-surface);
  color: var(--danger);
}

.agent-assignment-probe-alert strong {
  color: var(--danger);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

.agent-assignment-probe-alert ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.agent-assignment-probe-alert li {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.agent-assignment-probe-alert span {
  color: var(--text-primary);
  font-weight: var(--font-semibold);
}

.agent-assignment-probe-alert small {
  color: var(--danger);
  font-size: var(--text-xs);
  line-height: 1.45;
}

.agent-assignment-list {
  display: grid;
  margin-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.agent-assignment-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
  gap: 18px;
  align-items: center;
  min-width: 0;
  margin-inline: -12px;
  padding: 16px 12px;
  border: 1px solid transparent;
  border-bottom-color: var(--border-subtle);
  border-radius: 8px;
  scroll-margin: 96px;
}

.agent-assignment-row[data-config-highlighted="true"] {
  border-color: var(--brand);
  background: color-mix(in srgb, var(--brand) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 24%, transparent);
}

.agent-assignment-batch-row {
  background: var(--bg-subtle);
}

.agent-assignment-main {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.agent-assignment-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.agent-assignment-title-row h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: 700;
}

.agent-assignment-main p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}

.agent-assignment-card-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 4px;
}

.agent-assignment-card-tag {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.2;
  white-space: normal;
}

.agent-assignment-control {
  min-width: 0;
}

.agent-assignment-batch-control {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  min-width: 0;
}

.agent-assignment-batch-control > span {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  white-space: nowrap;
}

.module-assignment-controls {
  display: grid;
  grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
  gap: 12px;
  align-items: end;
  min-width: 0;
}

@media (max-width: 860px) {
  .agent-assignment-row,
  .agent-assignment-batch-control,
  .module-assignment-controls {
    grid-template-columns: 1fr;
  }

  .agent-assignment-header-actions {
    justify-content: flex-start;
    width: 100%;
    margin-left: 0;
  }

  .agent-assignment-summary {
    justify-content: flex-start;
    margin-left: 0;
  }
}
</style>
