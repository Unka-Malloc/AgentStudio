<script setup lang="ts">
import { computed } from "vue";
import BridgeDownloadButton from "../BridgeDownloadButton.vue";
import OptionBar from "../OptionBar.vue";
import UploadFileListCard from "../UploadFileListCard.vue";
import { jobStatusLabels } from "../../composables/console-defaults";
import { formatBytes, jobStatusTone, jsonPreview } from "../../composables/console-format-utils";
import { useKnowledgeIngestContext, useKnowledgeViewContext } from "../../composables/knowledgeViewContext";
import { normalizedKnowledgeDocumentUrl, previewKnowledgeDocuments } from "../../lib/knowledge-documents";

const {
  busyKey,
  canSubmitKnowledgeIngest,
  canWriteJobs,
  documentPreviewResult,
  ingestFiles,
  ingestJob,
  ingestProgress,
  knowledgeIngestTargetDisplaySummary,
  knowledgeIngestTargetOptions,
  knowledgeIngestTargetValidationMessage,
  knowledgeIngestTargetValues,
  knowledgeLibraryBusy,
  normalizedManifest,
  onIngestFilesSelected,
  setKnowledgeIngestTargetValues,
  uploadFilesToKnowledge,
} = useKnowledgeIngestContext();
const knowledgeViewContext = useKnowledgeViewContext();

const knowledgeIngestTargetLoading = computed(() => knowledgeLibraryBusy.value === "spaces");
const knowledgeIngestTargetSelectDisabled = computed(() =>
  knowledgeIngestTargetLoading.value || knowledgeIngestTargetOptions.value.length === 0,
);
const knowledgeIngestTargetPlaceholder = computed(() =>
  knowledgeIngestTargetLoading.value
    ? "正在检测知识库"
    : knowledgeIngestTargetOptions.value.length === 0
      ? "暂无可选知识库"
      : "请选择入库目标",
);
const knowledgeIngestTargetWarning = computed(() =>
  knowledgeIngestTargetLoading.value
    ? ""
    : knowledgeIngestTargetOptions.value.length === 0
      ? "未检测到可用知识库。"
      : knowledgeIngestTargetValidationMessage.value,
);
const knowledgeIngestTargetReadiness = computed(() => {
  if (knowledgeIngestTargetLoading.value) {
    return { value: "检测中", tone: "neutral" };
  }
  return knowledgeIngestTargetWarning.value
    ? { value: "待选择", tone: "warning" }
    : { value: "已选择", tone: "success" };
});
const canSubmitKnowledgeIngestWithTarget = computed(() =>
  canSubmitKnowledgeIngest.value && !knowledgeIngestTargetSelectDisabled.value,
);
const knowledgeIngestReadinessItems = computed(() => [
  {
    key: "target",
    label: "目标",
    value: knowledgeIngestTargetReadiness.value.value,
    tone: knowledgeIngestTargetReadiness.value.tone,
  },
  {
    key: "files",
    label: "文件",
    value: ingestFiles.value.length ? `${ingestFiles.value.length} 个` : "待上传",
    tone: ingestFiles.value.length ? "success" : "neutral",
  },
  {
    key: "jobs",
    label: "任务",
    value: canWriteJobs.value ? "可创建" : "无写入权限",
    tone: canWriteJobs.value ? "success" : "warning",
  },
]);

async function previewKnowledgeDocumentParsing() {
  const dynamicParsingPreviewConfig = knowledgeViewContext.ingest.dynamicParsingPreviewConfig;
  documentPreviewResult.value = await previewKnowledgeDocuments(ingestFiles.value, {
    pipelineId: dynamicParsingPreviewConfig.pipelineId,
    expectedOutputs: ["preprocessResult", "chunks", "structureArtifacts", "granularityFragments"],
    contextBudget: dynamicParsingPreviewConfig.contextBudget,
    payloadBudget: dynamicParsingPreviewConfig.payloadBudget,
    granularity: dynamicParsingPreviewConfig.granularity,
    dynamicParsing: dynamicParsingPreviewConfig.dynamicParsing,
  });
}
</script>

<template>
  <article id="knowledge-file-import" class="surface-card ingest-upload-card">
    <div class="section-header">
      <div>
        <h3>知识归档</h3>
      </div>
    </div>
    <div class="knowledge-ingest-target-select-panel">
      <OptionBar
        label="入库目标"
        :placeholder="knowledgeIngestTargetPlaceholder"
        :model-value="knowledgeIngestTargetValues"
        :options="knowledgeIngestTargetOptions"
        multiple
        collapse-tags
        clearable
        :disabled="knowledgeIngestTargetSelectDisabled"
        @update:model-value="setKnowledgeIngestTargetValues"
      />
      <span>{{ knowledgeIngestTargetDisplaySummary }}</span>
    </div>
    <p v-if="knowledgeIngestTargetWarning" class="module-note warning-note">
      {{ knowledgeIngestTargetWarning }}
    </p>
    <div class="knowledge-ingest-readiness" aria-label="入库准备状态">
      <span
        v-for="item in knowledgeIngestReadinessItems"
        :key="item.key"
        class="knowledge-ingest-readiness-pill"
        :data-tone="item.tone"
      >
        <strong>{{ item.label }}</strong>
        <span>{{ item.value }}</span>
      </span>
    </div>
    <div class="knowledge-ingest-section-spacer" aria-hidden="true"></div>
    <UploadFileListCard
      :files="ingestFiles"
      :can-submit="canSubmitKnowledgeIngestWithTarget"
      :can-write-jobs="canWriteJobs"
      :busy-key="busyKey"
      :ingest-job="ingestJob"
      :ingest-progress="ingestProgress"
      :job-status-labels="jobStatusLabels"
      :job-status-tone="jobStatusTone"
      :format-bytes="formatBytes"
      @select="onIngestFilesSelected"
      @upload="uploadFilesToKnowledge"
      @preview="previewKnowledgeDocumentParsing"
    />
    <section v-if="documentPreviewResult" class="knowledge-document-preview-panel">
      <header class="knowledge-document-preview-header">
        <strong>解析预览</strong>
        <span>JSON</span>
      </header>
      <pre class="module-json-preview">{{ jsonPreview(documentPreviewResult) }}</pre>
    </section>
    <div v-if="normalizedManifest" class="job-table compact-job-table normalized-table">
      <div class="job-table-header">
        <span>生成文档</span>
        <span>类型</span>
        <span>大小</span>
      </div>
      <div
        v-for="doc in [...normalizedManifest.documents, ...normalizedManifest.sourceMaterials]"
        :key="doc.documentId"
        class="job-row"
      >
        <BridgeDownloadButton
          :href="normalizedKnowledgeDocumentUrl(normalizedManifest.batchId, doc.documentId)"
          :label="doc.title"
          button-class="bridge-download-link"
        />
        <span>{{ doc.granularity }}</span>
        <span>{{ formatBytes(doc.byteSize) }}</span>
      </div>
    </div>
  </article>
</template>
