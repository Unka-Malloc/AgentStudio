<script setup lang="ts">
import { computed, ref } from "vue";
import BridgeDownloadButton from "./BridgeDownloadButton.vue";
import BrowseSelectButton from "./BrowseSelectButton.vue";
import StatusPill from "./StatusPill.vue";
import { knowledgeExportUrl, normalizedKnowledgeDocumentUrl, type KnowledgeDocumentExportFormat } from "../lib/knowledge-documents";
import type { NormalizedDocumentsManifest, SplitJob } from "../lib/types";

const props = withDefaults(defineProps<{
  canReadKnowledge: boolean;
  canWriteJobs: boolean;
  busyKey: string;
  modeLabel: string;
  modeDescription: string;
  ingestProgress: string;
  ingestJob: SplitJob | null;
  normalizedManifest: NormalizedDocumentsManifest | null;
  jobStatusLabels: Record<string, string>;
  jobStatusTone: (status: string) => string;
  formatBytes: (bytes: number) => string;
  accept?: string;
}>(), {
  accept: "",
});

const emit = defineEmits<{
  select: [files: File[]];
  upload: [];
}>();

const dropActive = ref(false);
const isBusy = computed(() => props.busyKey === "knowledge:ingest");
const exportFormat = ref<KnowledgeDocumentExportFormat>("docx");
const exportUrl = computed(() => knowledgeExportUrl(exportFormat.value));

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function onDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  dropActive.value = true;
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  if (hasDraggedFiles(event)) {
    dropActive.value = true;
  }
}

function onDragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement | null;
  const related = event.relatedTarget as Node | null;
  if (current && related && current.contains(related)) {
    return;
  }
  dropActive.value = false;
}

function onDrop(event: DragEvent) {
  dropActive.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length > 0) {
    emit("select", files);
  }
}
</script>

<template>
  <article
    id="knowledge-file-import"
    class="surface-card ingest-upload-card knowledge-import-card"
    :class="{ active: dropActive }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="knowledge-import-header">
      <h3>文件导入</h3>
      <div class="knowledge-import-header-actions">
        <span class="knowledge-import-mode">{{ modeLabel }}</span>
      </div>
    </div>

    <div class="knowledge-import-dropzone">
      <div class="knowledge-import-dropcopy">
        <strong>拖拽文件到此处</strong>
        <span>{{ modeDescription }}</span>
      </div>
      <div class="knowledge-import-actions">
        <BrowseSelectButton
          kind="local-directory"
          button-class="tool-button tool-button-ghost"
          button-text="选择文件夹"
          :accept="accept"
          :disabled="!canWriteJobs || isBusy"
          plain
          @select="emit('select', $event)"
        />
        <BrowseSelectButton
          kind="local-files"
          button-class="tool-button tool-button-ghost"
          button-text="选择文件"
          :accept="accept"
          :disabled="!canWriteJobs || isBusy"
          multiple
          plain
          @select="emit('select', $event)"
        />
        <button
          class="primary-action knowledge-import-submit"
          type="button"
          :disabled="!canWriteJobs || isBusy"
          @click="emit('upload')"
        >
          {{ isBusy ? "解析中" : "开始解析" }}
        </button>
      </div>
    </div>

    <p v-if="ingestProgress" class="module-note">{{ ingestProgress }}</p>

    <div v-if="ingestJob" class="ingest-queue-card">
      <div class="ingest-queue-row">
        <strong class="ingest-job-id">{{ ingestJob.id }}</strong>
        <div class="ingest-queue-meta">
          <span>{{ ingestJob.stage || "等待开始" }}</span>
          <StatusPill
            :tone="jobStatusTone(String(ingestJob.status))"
            :label="jobStatusLabels[String(ingestJob.status)] || String(ingestJob.status)"
          />
        </div>
      </div>
      <div class="ingest-queue-progress">
        <progress :value="Number(ingestJob.progressPercent || 0)" max="100" />
        <small>{{ Number(ingestJob.progressPercent || 0) }}%</small>
      </div>
    </div>

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

    <div class="knowledge-import-export-row">
      <select v-model="exportFormat" class="knowledge-export-select" :disabled="!canReadKnowledge">
        <option value="docx">DOCX</option>
        <option value="markdown">Markdown</option>
        <option value="html">HTML</option>
      </select>
      <BridgeDownloadButton
        v-if="canReadKnowledge"
        :href="exportUrl"
        label="导出知识库"
        button-class="tool-button tool-button-ghost"
      />
      <button v-else class="tool-button tool-button-ghost" type="button" disabled>
        导出知识库
      </button>
    </div>
  </article>
</template>
