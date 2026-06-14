<script setup lang="ts">
import { computed } from "vue";
import BridgeDownloadButton from "../BridgeDownloadButton.vue";
import OptionBar from "../OptionBar.vue";
import UploadFileListCard from "../UploadFileListCard.vue";
import { jobStatusLabels } from "../../composables/console-defaults";
import { formatBytes, jobStatusTone, jsonPreview } from "../../composables/console-format-utils";
import { useKnowledgeIngestContext } from "../../composables/knowledgeViewContext";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../i18n/console";
import { normalizedKnowledgeDocumentUrl, previewKnowledgeDocuments } from "../../lib/knowledge-documents";

const {
  busyKey,
  canSubmitKnowledgeIngest,
  canWriteJobs,
  documentPreviewResult,
  dynamicParsingPreviewConfig,
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

const locale = computed(() => resolveEffectiveConsoleLocale(currentConsoleLocale.value));
function t(value: string) {
  return localizeConsoleText(value, locale.value);
}

const knowledgeIngestTargetLoading = computed(() => knowledgeLibraryBusy.value === "spaces");
const knowledgeIngestTargetSelectDisabled = computed(() =>
  knowledgeIngestTargetLoading.value || knowledgeIngestTargetOptions.value.length === 0,
);
const knowledgeIngestTargetPlaceholder = computed(() =>
  t(
    knowledgeIngestTargetLoading.value
      ? "正在检测知识库"
      : knowledgeIngestTargetOptions.value.length === 0
        ? "暂无可选知识库"
        : "请选择入库目标",
  ),
);
const knowledgeIngestTargetWarning = computed(() =>
  knowledgeIngestTargetLoading.value
    ? ""
    : knowledgeIngestTargetOptions.value.length === 0
      ? t("未检测到可用知识库。")
      : t(knowledgeIngestTargetValidationMessage.value),
);
const knowledgeIngestTargetReadiness = computed(() => {
  if (knowledgeIngestTargetLoading.value) {
    return { value: t("检测中"), tone: "neutral" };
  }
  return knowledgeIngestTargetWarning.value
    ? { value: t("待选择"), tone: "warning" }
    : { value: t("已选择"), tone: "success" };
});
const canSubmitKnowledgeIngestWithTarget = computed(() =>
  canSubmitKnowledgeIngest.value && !knowledgeIngestTargetSelectDisabled.value,
);
const knowledgeIngestReadinessItems = computed(() => [
  {
    key: "target",
    label: t("目标"),
    value: knowledgeIngestTargetReadiness.value.value,
    tone: knowledgeIngestTargetReadiness.value.tone,
  },
  {
    key: "files",
    label: t("文件"),
    value: ingestFiles.value.length ? t(`${ingestFiles.value.length} 个文件`) : t("待上传"),
    tone: ingestFiles.value.length ? "success" : "neutral",
  },
  {
    key: "jobs",
    label: t("任务"),
    value: canWriteJobs.value ? t("可创建") : t("无写入权限"),
    tone: canWriteJobs.value ? "success" : "warning",
  },
]);

async function previewKnowledgeDocumentParsing() {
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
        <h3>{{ t("知识归档") }}</h3>
      </div>
    </div>
    <div class="knowledge-ingest-target-select-panel">
      <OptionBar
        :label="t('入库目标')"
        :placeholder="knowledgeIngestTargetPlaceholder"
        :model-value="knowledgeIngestTargetValues"
        :options="knowledgeIngestTargetOptions"
        multiple
        collapse-tags
        clearable
        :disabled="knowledgeIngestTargetSelectDisabled"
        @update:model-value="setKnowledgeIngestTargetValues"
      />
      <span>{{ t(knowledgeIngestTargetDisplaySummary) }}</span>
    </div>
    <p v-if="knowledgeIngestTargetWarning" class="module-note warning-note">
      {{ knowledgeIngestTargetWarning }}
    </p>
    <div class="knowledge-ingest-readiness" :aria-label="t('入库准备状态')">
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
        <strong>{{ t("解析预览") }}</strong>
        <span>{{ t("JSON") }}</span>
      </header>
      <pre class="module-json-preview">{{ jsonPreview(documentPreviewResult) }}</pre>
    </section>
    <div v-if="normalizedManifest" class="job-table compact-job-table normalized-table">
      <div class="job-table-header">
        <span>{{ t("生成文档") }}</span>
        <span>{{ t("类型") }}</span>
        <span>{{ t("大小") }}</span>
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
