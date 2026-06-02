<script setup lang="ts">
import AgentModelOptionBar from "./AgentModelOptionBar.vue";
import StatusPill from "./StatusPill.vue";
import KnowledgeDistillationRunOverview from "./knowledge-distillation/KnowledgeDistillationRunOverview.vue";
import KnowledgeDistillationStageCard from "./knowledge-distillation/KnowledgeDistillationStageCard.vue";
import {
  useKnowledgeDistillationWorkbench,
  type KnowledgeDistillationWorkbenchProps,
} from "../composables/knowledge-distillation-workbench-controller";
import { statusLabel, statusTone } from "../lib/knowledge-distillation-workbench";

const props = defineProps<KnowledgeDistillationWorkbenchProps>();

const {
  activeJobCompleted,
  activeRunProgress,
  activeRunStages,
  archiveRun,
  busy,
  canStart,
  cancelRun,
  compareResult,
  compareRightRunId,
  compareRuns,
  createOptions,
  deleteRun,
  distillationModelOptions,
  error,
  modelProbeLabel,
  modelProbeTone,
  modelProbeTooltip,
  packageUrl,
  rerunStage,
  resumeRun,
  runs,
  selectRun,
  selectedRun,
  selectedRunId,
  startWorkbenchRun,
} = useKnowledgeDistillationWorkbench(props);
</script>

<template>
  <section class="knowledge-distillation-workbench">
    <article class="surface-card distillation-command-card">
      <div class="section-header">
        <div>
          <h3>知识蒸馏</h3>
          <p>把项目目录的所有文档按阶段转化、导出、索引，再生成一个自包含的大文档。</p>
        </div>
        <div class="source-actions">
          <button
            class="primary-action"
            type="button"
            :disabled="!canStart"
            @click="startWorkbenchRun"
          >
            {{ busy === "create" ? "创建中" : "开始蒸馏" }}
          </button>
        </div>
      </div>

      <p v-if="!activeJobCompleted" class="module-note">
        请先在页面顶部选择项目文件夹并点击“开始解析”。解析完成后，这里会把该解析任务作为蒸馏输入。
      </p>
      <p v-if="error" class="module-note danger">{{ error }}</p>

      <div class="distillation-config-grid">
        <div class="config-field readonly-field">
          <span>模型状态</span>
          <StatusPill
            :label="modelProbeLabel"
            :tone="modelProbeTone"
            :aria-label="modelProbeTooltip"
            :title="modelProbeTooltip"
          />
        </div>
        <AgentModelOptionBar
          v-model="createOptions.modelAlias"
          class="distillation-model-select"
          label="模型"
          placeholder="选择已配置模型"
          :options="distillationModelOptions"
        />
        <label class="config-field">
          <span>优先级</span>
          <select v-model="createOptions.priority">
            <option value="high">高</option>
            <option value="normal">普通</option>
            <option value="low">低</option>
          </select>
        </label>
        <label class="config-field">
          <span>知识上下文预算</span>
          <input v-model.number="createOptions.tokenBudget" type="number" min="1024" step="1024" />
        </label>
        <label class="config-field">
          <span>回包预算</span>
          <input v-model.number="createOptions.payloadBudget" type="number" min="4096" step="4096" />
        </label>
        <label class="config-field">
          <span>原文批次字符</span>
          <input v-model.number="createOptions.rawCorpusBatchMaxCharacters" type="number" min="4096" step="4096" />
        </label>
        <label class="config-field">
          <span>合并策略</span>
          <select v-model="createOptions.mergeStrategy">
            <option value="timeline_then_topic">先时间线后主题</option>
            <option value="topic_then_timeline">先主题后时间线</option>
            <option value="source_order">按源文件顺序</option>
          </select>
        </label>
        <label class="config-field">
          <span>多轮上限</span>
          <input v-model.number="createOptions.maxRounds" type="number" min="1" max="20" />
        </label>
        <label class="config-field">
          <span>时间半衰期（天）</span>
          <input v-model.number="createOptions.timeDecayHalfLifeDays" type="number" min="1" max="3650" />
        </label>
        <label class="config-field">
          <span>时间衰减下限</span>
          <input v-model.number="createOptions.timeDecayFloor" type="number" min="0" max="1" step="0.05" />
        </label>
        <label class="config-field prompt-field">
          <span>蒸馏 Prompt</span>
          <textarea v-model="createOptions.prompt" rows="3" />
        </label>
      </div>

      <div class="distillation-run-selector" v-if="runs.length" role="list" aria-label="知识蒸馏任务">
        <div v-for="run in runs" :key="run.runId" class="distillation-run-listitem" role="listitem">
          <button
            class="distillation-run-item"
            :class="{ active: selectedRunId === run.runId }"
            type="button"
            :aria-current="selectedRunId === run.runId ? 'true' : undefined"
            @click="selectRun(run.runId)"
          >
            <span class="distillation-run-title">{{ run.title }}</span>
            <StatusPill :tone="statusTone(run.status)" :label="statusLabel(run.status)" />
          </button>
        </div>
      </div>
    </article>

    <KnowledgeDistillationRunOverview
      v-if="selectedRun"
      v-model:compare-right-run-id="compareRightRunId"
      :active-run-progress="activeRunProgress"
      :busy="busy"
      :compare-result="compareResult"
      :format-compact-date="formatCompactDate"
      :package-href="packageUrl()"
      :runs="runs"
      :selected-run="selectedRun"
      @archive="archiveRun"
      @cancel="cancelRun"
      @compare="compareRuns"
      @delete="deleteRun"
      @resume="resumeRun"
    />

    <div v-if="selectedRun" class="distillation-stage-feed">
      <KnowledgeDistillationStageCard
        v-for="(stage, index) in activeRunStages"
        :key="stage.stageId"
        :busy="busy"
        :can-maintain-knowledge="canMaintainKnowledge"
        :index="index"
        :run-id="selectedRun.runId"
        :run-status="selectedRun.status"
        :stage="stage"
        @rerun="rerunStage"
      />
    </div>

    <article v-else class="surface-card distillation-empty-card">
      <h3>暂无知识蒸馏任务</h3>
      <p>完成项目解析后点击“开始蒸馏”，这里会按阶段展示每一步的说明、结果预览、导出和断点状态。</p>
    </article>
  </section>
</template>

<style scoped src="./KnowledgeDistillationWorkbench.css"></style>
