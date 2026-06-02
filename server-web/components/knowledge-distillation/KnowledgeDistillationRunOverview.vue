<script setup lang="ts">
import { computed } from "vue";
import BridgeDownloadButton from "../BridgeDownloadButton.vue";
import StatusPill from "../StatusPill.vue";
import { statusLabel, statusTone, type WorkbenchRun } from "../../lib/knowledge-distillation-workbench";

const props = defineProps<{
  activeRunProgress: number;
  busy: string;
  compareResult: Record<string, unknown> | null;
  compareRightRunId: string;
  formatCompactDate: (value: string) => string;
  packageHref: string;
  runs: WorkbenchRun[];
  selectedRun: WorkbenchRun;
}>();

const emit = defineEmits<{
  archive: [];
  cancel: [];
  compare: [];
  delete: [];
  resume: [];
  "update:compareRightRunId": [runId: string];
}>();

const comparisonRuns = computed(() =>
  props.runs.filter((item) => item.runId !== props.selectedRun.runId),
);

const comparePreview = computed(() =>
  JSON.stringify(props.compareResult?.summary || props.compareResult, null, 2),
);

function updateCompareRun(event: Event) {
  emit("update:compareRightRunId", String((event.target as HTMLSelectElement).value || ""));
}
</script>

<template>
  <article class="surface-card distillation-run-overview">
    <div class="section-header">
      <div>
        <h3>{{ selectedRun.title }}</h3>
        <p>
          {{ selectedRun.runId }} · Job {{ selectedRun.jobId || "n/a" }}
          <span v-if="selectedRun.updatedAt"> · {{ formatCompactDate(selectedRun.updatedAt) }}</span>
        </p>
      </div>
      <div class="source-actions">
        <StatusPill :tone="statusTone(selectedRun.status)" :label="statusLabel(selectedRun.status)" />
        <button
          class="tool-button tool-button-ghost"
          type="button"
          :disabled="busy === 'resume' || selectedRun.status === 'completed'"
          @click="emit('resume')"
        >
          {{ busy === "resume" ? "恢复中" : "继续任务" }}
        </button>
        <button
          class="tool-button tool-button-ghost"
          type="button"
          :disabled="busy === 'cancel' || !['queued', 'running', 'waiting'].includes(selectedRun.status)"
          @click="emit('cancel')"
        >
          {{ busy === "cancel" ? "取消中" : "取消" }}
        </button>
        <button
          class="tool-button tool-button-ghost"
          type="button"
          :disabled="busy === 'archive'"
          @click="emit('archive')"
        >
          {{ busy === "archive" ? "归档中" : "归档" }}
        </button>
        <button
          class="tool-button tool-button-ghost danger-action"
          type="button"
          :disabled="busy === 'delete'"
          @click="emit('delete')"
        >
          {{ busy === "delete" ? "删除中" : "删除" }}
        </button>
        <BridgeDownloadButton
          :href="packageHref"
          label="下载工作台产物包"
          button-class="tool-button tool-button-ghost"
        />
      </div>
    </div>
    <div class="ingest-queue-progress">
      <progress :value="activeRunProgress" max="100" />
      <small>{{ activeRunProgress }}%</small>
    </div>
    <dl class="module-status-list">
      <div>
        <dt>持久化</dt>
        <dd>{{ selectedRun.storage?.rootRelativePath || "knowledge-distillation-workbench" }}</dd>
      </div>
      <div>
        <dt>断点</dt>
        <dd>{{ selectedRun.storage?.checkpointFile || "run.json" }}</dd>
      </div>
      <div>
        <dt>等待</dt>
        <dd>{{ selectedRun.waitingFor ? JSON.stringify(selectedRun.waitingFor) : "无" }}</dd>
      </div>
      <div>
        <dt>模型</dt>
        <dd>{{ selectedRun.modelAlias || "未记录模型" }} · {{ selectedRun.priority || "normal" }}</dd>
      </div>
      <div>
        <dt>队列</dt>
        <dd>{{ selectedRun.taskManagement?.queue || "queue-monitor" }} · {{ selectedRun.taskManagement?.worker || "workbench" }}</dd>
      </div>
    </dl>
    <div v-if="runs.length > 1" class="distillation-compare-row">
      <select :value="compareRightRunId" @change="updateCompareRun">
        <option value="">选择另一个版本比较</option>
        <option
          v-for="run in comparisonRuns"
          :key="run.runId"
          :value="run.runId"
        >
          {{ run.title }} · {{ formatCompactDate(run.updatedAt || "") }}
        </option>
      </select>
      <button
        class="tool-button"
        type="button"
        :disabled="!compareRightRunId || busy === 'compare'"
        @click="emit('compare')"
      >
        {{ busy === "compare" ? "比较中" : "比较版本" }}
      </button>
    </div>
    <pre v-if="compareResult" class="distillation-compare-preview">{{ comparePreview }}</pre>
    <p v-if="selectedRun.error" class="module-note danger">{{ selectedRun.error }}</p>
  </article>
</template>

<style scoped>
.distillation-run-overview {
  border-radius: 8px;
  display: grid;
  gap: var(--space-4);
}

.distillation-run-overview > .section-header {
  margin-bottom: 0;
}

.distillation-compare-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  margin-top: 0;
}

.distillation-compare-row select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.34));
  border-radius: 8px;
  padding: 8px 10px;
  color-scheme: dark;
  background: color-mix(in srgb, var(--bg-subtle, #1c2128) 88%, #000 12%);
  color: var(--text-primary, #e6edf3);
  caret-color: var(--brand, #58a6ff);
}

.distillation-compare-row select option {
  background: var(--bg-subtle, #1c2128);
  color: var(--text-primary, #e6edf3);
}

.distillation-compare-row select:hover {
  border-color: var(--border-strong, rgba(148, 163, 184, 0.48));
}

.distillation-compare-row select:focus {
  border-color: var(--brand, #58a6ff);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.18);
  outline: none;
}

.distillation-compare-preview {
  margin: 0;
  padding: 10px;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.24));
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.03);
  white-space: pre-wrap;
}

.danger-action,
.module-note.danger {
  color: #b91c1c;
}

@media (max-width: 720px) {
  .distillation-compare-row {
    grid-template-columns: 1fr;
  }
}
</style>
