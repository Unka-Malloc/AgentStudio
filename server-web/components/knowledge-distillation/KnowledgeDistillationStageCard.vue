<script setup lang="ts">
import BridgeDownloadButton from "../BridgeDownloadButton.vue";
import StatusPill from "../StatusPill.vue";
import {
  knowledgeDistillationWorkbenchExportUrl,
  statusLabel,
  statusTone,
  type WorkbenchStage,
} from "../../lib/knowledge-distillation-workbench";

const props = defineProps<{
  busy: string;
  canMaintainKnowledge: boolean;
  index: number;
  runId: string;
  runStatus: string;
  stage: WorkbenchStage;
}>();

const emit = defineEmits<{
  rerun: [stage: WorkbenchStage];
}>();

function exportUrl(format: string) {
  if (!props.runId || props.stage.status !== "completed") {
    return "#";
  }
  return knowledgeDistillationWorkbenchExportUrl(props.runId, props.stage.stageId, format);
}
</script>

<template>
  <article
    class="surface-card distillation-stage-card"
    :class="{ completed: stage.status === 'completed', running: stage.status === 'running' }"
  >
    <div class="distillation-stage-index">{{ index + 1 }}</div>
    <div class="distillation-stage-main">
      <div class="section-header">
        <div>
          <h3>{{ stage.title }}</h3>
          <p>{{ stage.description }}</p>
        </div>
        <StatusPill :tone="stage.tone || statusTone(stage.status)" :label="statusLabel(stage.status)" />
      </div>

      <div class="ingest-queue-progress">
        <progress :value="Number(stage.progressPercent || 0)" max="100" />
        <small>{{ Number(stage.progressPercent || 0) }}%</small>
      </div>

      <section class="distillation-preview-card">
        <div class="compact-section-header">
          <div>
            <h4>结果预览</h4>
            <span>{{ stage.actionLabel }}</span>
          </div>
          <div class="distillation-export-actions">
            <button
              class="tool-button tool-button-ghost"
              type="button"
              :disabled="!canMaintainKnowledge || busy === `rerun:${stage.stageId}` || runStatus === 'running'"
              @click="emit('rerun', stage)"
            >
              {{ busy === `rerun:${stage.stageId}` ? "重跑中" : "重跑本阶段" }}
            </button>
            <BridgeDownloadButton
              v-for="format in (stage.exportFormats || ['markdown', 'docx', 'html', 'json'])"
              :key="`${stage.stageId}:${format}`"
              :href="exportUrl(format)"
              :label="`导出 ${format.toUpperCase()}`"
              button-class="tool-button tool-button-ghost"
              :disabled="stage.status !== 'completed'"
            />
          </div>
        </div>
        <pre>{{ stage.preview || (stage.status === "completed" ? "该阶段已完成，暂无预览文本。" : "等待阶段完成后展示结果预览。") }}</pre>
      </section>

      <dl class="module-status-list distillation-stage-meta">
        <div>
          <dt>任务管理</dt>
          <dd>后台运行，离开页面后可从任务列表恢复查看。</dd>
        </div>
        <div>
          <dt>断点续传</dt>
          <dd>{{ stage.checkpoint?.durable ? "已持久化" : "未启用" }} · {{ stage.checkpoint?.resumable ? "可恢复" : "不可恢复" }}</dd>
        </div>
        <div>
          <dt>指标</dt>
          <dd>{{ stage.metrics ? JSON.stringify(stage.metrics) : "{}" }}</dd>
        </div>
        <div>
          <dt>历史版本</dt>
          <dd>{{ stage.versions?.length || 0 }} 个</dd>
        </div>
      </dl>
      <div v-if="stage.versions?.length" class="stage-version-strip">
        <span
          v-for="version in stage.versions"
          :key="version.versionId"
        >
          {{ version.versionId }} · {{ version.status }} · {{ version.markdownLength || 0 }} 字
        </span>
      </div>
      <p v-if="stage.error" class="module-note danger">{{ stage.error }}</p>
    </div>
  </article>
</template>

<style scoped>
.distillation-stage-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 14px;
  border-radius: 8px;
}

.distillation-stage-index {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.08);
  font-weight: 700;
}

.distillation-stage-card.completed .distillation-stage-index {
  background: rgba(34, 197, 94, 0.14);
}

.distillation-stage-card.running .distillation-stage-index {
  background: rgba(245, 158, 11, 0.16);
}

.distillation-stage-main {
  min-width: 0;
}

.distillation-preview-card {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.24));
  border-radius: 8px;
}

.distillation-preview-card pre {
  max-height: 280px;
  overflow: auto;
  margin: 10px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.distillation-export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.distillation-export-actions .disabled {
  opacity: 0.45;
  pointer-events: none;
}

.distillation-stage-meta {
  margin-top: 12px;
}

.stage-version-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.24));
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.03);
  font-size: 12px;
  white-space: pre-wrap;
}

.stage-version-strip span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
}

.module-note.danger {
  color: #b91c1c;
}
</style>
