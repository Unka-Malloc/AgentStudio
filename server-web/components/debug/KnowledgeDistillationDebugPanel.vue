<script setup lang="ts">
import AgentModelOptionBar from "../AgentModelOptionBar.vue";
import BrowseSelectButton from "../BrowseSelectButton.vue";
import SegmentedProgressBar from "../SegmentedProgressBar.vue";
import UploadFileListCard from "../UploadFileListCard.vue";
import { formatFileSize } from "../../composables/console-debug-distillation-utils";
import { useDebugViewContext } from "../../composables/debugViewContext";
import { shortId } from "../../composables/console-agent-explore-presentation";

const {
  distillationBusy,
  distillationError,
  distillationFile,
  distillationFileLabel,
  distillationModelAlias,
  distillationModelLabel,
  distillationModelOptions,
  distillationModelReady,
  distillationProgressSegments,
  distillationProgressSummary,
  distillationResultFiles,
  distillationRunId,
  distillationStatusMessage,
  distillationStep,
  handleDebugDistillationFileSelected,
  startDebugKnowledgeDistillation,
} = useDebugViewContext();
</script>

<template>
  <article class="surface-card debug-panel-card knowledge-distillation-debug-card">
    <div class="section-header">
      <div>
        <h3>知识蒸馏</h3>
        <p>上传文件后生成核心提炼文档，结果可下载为 Markdown 或整包。</p>
      </div>
      <div class="section-tags">
        <span>{{ distillationStep === "completed" ? "已完成" : distillationStep === "failed" ? "失败" : "调试模式" }}</span>
        <span v-if="distillationModelLabel">{{ distillationModelLabel }}</span>
        <span v-if="distillationRunId">Run {{ shortId(distillationRunId) }}</span>
      </div>
    </div>

    <form class="debug-parameter-panel distillation-debug-form" @submit.prevent="startDebugKnowledgeDistillation">
      <div class="full-row distillation-upload-field">
        <span>上传文件</span>
        <small>{{ distillationFileLabel }}</small>
      </div>
      <AgentModelOptionBar
        v-model="distillationModelAlias"
        class="full-row distillation-model-field"
        label="模型"
        placeholder="选择模型"
        :options="distillationModelOptions"
        empty-library-label="当前模型库为空，请前往配置模型。"
      />
      <div class="full-row distillation-debug-actions">
        <BrowseSelectButton
          kind="local-files"
          button-type="primary"
          button-text="选择文件"
          button-class="distillation-file-picker-button"
          :multiple="false"
          plain
          @select="handleDebugDistillationFileSelected"
        />
        <button
          class="primary-action distillation-start-action"
          type="submit"
          :disabled="distillationBusy || !distillationFile || !distillationModelReady"
        >
          {{ distillationBusy ? "蒸馏中" : "开始蒸馏" }}
        </button>
      </div>
    </form>

    <div class="distillation-debug-progress" :data-state="distillationStep">
      <div class="distillation-progress-header">
        <span>{{ distillationStatusMessage }}</span>
        <strong>{{ distillationProgressSummary }}</strong>
      </div>
      <SegmentedProgressBar
        aria-label="知识蒸馏阶段进度"
        show-labels
        :segments="distillationProgressSegments"
        :value-label="distillationProgressSummary"
      />
    </div>

    <UploadFileListCard
      v-if="distillationResultFiles.length"
      class="distillation-result-file-list"
      mode="download"
      title="蒸馏结果"
      :result-files="distillationResultFiles"
      :format-bytes="formatFileSize"
    />

    <div v-if="distillationError" class="debug-error-note">
      {{ distillationError }}
    </div>
  </article>
</template>
