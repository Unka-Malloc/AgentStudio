<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AgentModelOptionBar from "../../components/AgentModelOptionBar.vue";
import BinaryCheckbox from "../../components/BinaryCheckbox.vue";
import OptionBar from "../../components/OptionBar.vue";
import StatusPill from "../../components/StatusPill.vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

type DefaultAgentKey =
  | "infoFeedSummaryModelAlias"
  | "agentRetrievalModelAlias"
  | "ruleAuthoringModelAlias"
  | "reviewFusionModelAlias";

const {
  agentExploreAgentOptions,
  agentExploreForm,
  agentSelectorOptions,
  busyKey,
  highlightedConfigTarget,
  infoFeedForm,
  infoFeedModelOptions,
  intelligentModuleDefinitions,
  moduleModelAssignmentSelectOptions,
  moduleModelAssignmentStats,
  moduleModelRef,
  moduleNeedsIntelligence,
  ruleAuthoringForm,
  ruleAuthoringModelOptions,
  saveSettings,
  setModuleModelRef,
  setModuleNeedsIntelligence,
  settingsDraft,
} = useServerConsoleShellContext();
const route = useRoute();
const routeHighlightedConfigTarget = ref("");
let routeHighlightTimer: ReturnType<typeof window.setTimeout> | null = null;

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

function updateModuleEnabled(moduleId: string, enabled: boolean) {
  setModuleNeedsIntelligence(moduleId, enabled);
  if (!enabled) {
    setModuleModelRef(moduleId, "");
  }
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
</script>

<template>
  <section class="agent-assignment-layout">
    <article class="surface-card agent-assignment-panel">
      <div class="section-header agent-assignment-header">
        <div>
          <h3>智能体分配</h3>
          <p>集中维护业务功能和智能能力模块使用的默认智能体。</p>
        </div>
        <div class="agent-assignment-summary" aria-label="智能体分配摘要">
          <span><strong>{{ assignedBusinessCount }}</strong> / {{ businessAssignments.length }} 业务功能</span>
          <span><strong>{{ moduleModelAssignmentStats.assigned }}</strong> / {{ moduleModelAssignmentStats.enabled }} 模块</span>
        </div>
      </div>

      <div class="agent-assignment-list" role="list" aria-label="业务功能默认智能体">
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
          <h3>智能能力模块</h3>
          <p>为需要大模型参与的后台模块指定主智能体，保存后写入服务端配置。</p>
        </div>
      </div>

      <div class="agent-assignment-list" role="list" aria-label="智能能力模块分配">
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
              <StatusPill
                :label="moduleStatus(moduleDefinition.id).label"
                :tone="moduleStatus(moduleDefinition.id).tone"
              />
              <span class="agent-assignment-requirement">{{ moduleRequirementLabel(moduleDefinition.alertRequired) }}</span>
            </div>
            <p>{{ moduleDefinition.description }}</p>
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
              @update:model-value="setModuleModelRef(moduleDefinition.id, String($event))"
            />
          </div>
        </section>
      </div>
    </article>

    <div class="agent-assignment-actions">
      <button class="tool-button" type="button" :disabled="busyKey === 'settings'" @click="saveSettings">
        {{ busyKey === "settings" ? "保存中" : "保存智能体分配" }}
      </button>
    </div>
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

.agent-assignment-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
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

.agent-assignment-requirement {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.agent-assignment-control {
  min-width: 0;
}

.module-assignment-controls {
  display: grid;
  grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
  gap: 12px;
  align-items: end;
  min-width: 0;
}

.agent-assignment-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 860px) {
  .agent-assignment-row,
  .module-assignment-controls {
    grid-template-columns: 1fr;
  }

  .agent-assignment-summary {
    justify-content: flex-start;
    width: 100%;
    margin-left: 0;
  }
}
</style>
