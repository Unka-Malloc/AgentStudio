<script setup lang="ts">
import BrowseSelectButton from "../../BrowseSelectButton.vue";
import { useKnowledgeWordCloudContext } from "../../../composables/knowledgeViewContext";

const {
  addManualWordCloud,
  busyKey,
  canBrowseServerPaths,
  canWriteKnowledge,
  clearWordCloudCorpusPaths,
  openWordCloudCorpusDirectoryPicker,
  openWordCloudCorpusFilePicker,
  removeWordCloudCorpusPath,
  saveWordCloud,
  wordCloudCardRows,
  wordCloudCorpusPathLabel,
  wordCloudCorpusPathSummary,
  wordCloudCorpusPaths,
  wordCloudDraft,
  wordCloudTerms,
} = useKnowledgeWordCloudContext();
</script>

<template>
  <div class="section-header">
    <div>
      <h3>词云</h3>
      <p>{{ wordCloudDraft?.title || "语料词云" }} · {{ wordCloudTerms.length }} 个语料词 · {{ wordCloudCardRows.length }} 张卡片</p>
    </div>
    <div class="source-actions">
      <BrowseSelectButton
        kind="server-directory"
        button-class="tool-button tool-button-ghost"
        button-text="浏览目录"
        :disabled="!canBrowseServerPaths || busyKey === 'knowledge:word-clouds:scope'"
        @browse="openWordCloudCorpusDirectoryPicker"
      />
      <BrowseSelectButton
        kind="server-file"
        button-class="tool-button tool-button-ghost"
        button-text="浏览文件"
        :disabled="!canBrowseServerPaths || busyKey === 'knowledge:word-clouds:scope'"
        @browse="openWordCloudCorpusFilePicker"
      />
      <button class="tool-button" type="button" @click="addManualWordCloud">
        新增词云
      </button>
      <button
        class="primary-action"
        type="button"
        :disabled="!canWriteKnowledge || busyKey === 'knowledge:word-clouds:save'"
        @click="saveWordCloud"
      >
        {{ busyKey === "knowledge:word-clouds:save" ? "保存中" : "保存" }}
      </button>
    </div>
  </div>

  <div class="word-cloud-corpus-scope">
    <div>
      <strong>语料范围</strong>
      <span v-if="wordCloudCorpusPathSummary">{{ wordCloudCorpusPathSummary }}</span>
    </div>
    <div v-if="wordCloudCorpusPaths.length" class="word-cloud-corpus-path-list">
      <span
        v-for="(item, index) in wordCloudCorpusPaths"
        :key="`${item.type}:${item.path}`"
        class="word-cloud-corpus-path"
      >
        <em>{{ wordCloudCorpusPathLabel(item) }}</em>
        <span>{{ item.path }}</span>
        <button type="button" aria-label="移除语料路径" @click="removeWordCloudCorpusPath(index)">×</button>
      </span>
      <button class="inline-link" type="button" @click="clearWordCloudCorpusPaths">
        清空
      </button>
    </div>
  </div>
</template>
