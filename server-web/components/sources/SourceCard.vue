<script setup lang="ts">
import StatusPill from "../StatusPill.vue";
import { formatBytes, formatCompactDate } from "../../composables/console-format-utils";
import {
  sourceDownloadStatusLabel,
  sourceIndexStatusLabel,
  sourceJobProgress,
  sourceSyncLabel,
  sourceSyncTone,
} from "../../composables/console-knowledge-source-utils";
import { splitJobStatusLabel } from "../../composables/console-job-display-utils";
import { useSourcesViewContext } from "../../composables/sourcesViewContext";
import { shortId } from "../../composables/console-agent-explore-presentation";
import type { KnowledgeSource } from "../../lib/types";

defineProps<{
  source: KnowledgeSource;
}>();

const {
  busyKey,
  deleteKnowledgeSource,
  refreshKnowledgeSource,
  updateKnowledgeSource,
} = useSourcesViewContext();
</script>

<template>
  <article :id="`source-${source.sourceId}`" class="knowledge-source-card surface-card source-card">
    <div class="knowledge-source-card-header source-card-header source-card-title-row">
      <div>
        <h3>{{ source.label }}</h3>
        <p>{{ source.directoryPath }}</p>
      </div>
      <StatusPill :tone="sourceSyncTone(source)" :label="sourceSyncLabel(source)" />
    </div>

    <dl class="meta-list source-meta-list">
      <div>
        <dt>文件</dt>
        <dd>{{ source.lastFileCount || 0 }} 个 / {{ formatBytes(source.lastTotalBytes) }}</dd>
      </div>
      <div>
        <dt>最近扫描</dt>
        <dd>{{ formatCompactDate(source.lastScanAt) || "未扫描" }}</dd>
      </div>
      <div>
        <dt>监听</dt>
        <dd>{{ source.watcherStatus }} / {{ source.watcherCount || 0 }}</dd>
      </div>
      <div>
        <dt>自动下载</dt>
        <dd>
          {{ sourceDownloadStatusLabel(source) }}
          / {{ source.lastHydratedFileCount || 0 }} 可入库
          <template v-if="source.lastHydrationFailedCount"> / {{ source.lastHydrationFailedCount }} 待处理</template>
        </dd>
      </div>
      <div>
        <dt>原文索引</dt>
        <dd>
          {{ sourceIndexStatusLabel(source) }}
          / {{ source.lastIndexedFileCount || 0 }} 文件
          <template v-if="source.lastIndexFailedCount"> / {{ source.lastIndexFailedCount }} 失败</template>
        </dd>
      </div>
      <div>
        <dt>最近任务</dt>
        <dd>{{ source.lastJobId || "无" }}</dd>
      </div>
      <div>
        <dt>断点树</dt>
        <dd>
          同步 {{ shortId(source.lastSyncCheckpointTreeId) }}
          / 索引 {{ shortId(source.lastIndexCheckpointTreeId) }}
        </dd>
      </div>
    </dl>

    <p
      v-if="source.lastHydrationFailureSamples?.length"
      class="module-note warning-note"
    >
      待下载：{{ source.lastHydrationFailureSamples.slice(0, 3).map((item) => `${item.relativePath || "文件"}：${item.reason || "未下载"}`).join("；") }}
    </p>
    <p v-if="source.lastIndexError" class="module-note warning-note">
      原文索引：{{ source.lastIndexError }}
    </p>

    <div v-if="source.lastJobId" class="source-progress">
      <div class="source-progress-header">
        <span>{{ splitJobStatusLabel(source.lastJobStatus) }}</span>
        <small>{{ source.lastJobStage || "等待开始" }}</small>
      </div>
      <progress :value="sourceJobProgress(source)" max="100" />
    </div>
    <p v-if="source.error" class="module-note danger-note source-error-note">{{ source.error }}</p>

    <div class="source-actions">
      <button
        class="tool-button"
        type="button"
        :disabled="busyKey === `knowledge:source:refresh:${source.sourceId}`"
        @click="refreshKnowledgeSource(source)"
      >
        同步目录
      </button>
      <button
        class="tool-button tool-button-ghost"
        type="button"
        :disabled="busyKey === `knowledge:source:refresh:${source.sourceId}`"
        @click="refreshKnowledgeSource(source, true)"
      >
        重新整理
      </button>
      <button
        class="tool-button tool-button-ghost"
        type="button"
        :disabled="busyKey === `knowledge:source:${source.sourceId}`"
        @click="updateKnowledgeSource(source, { enabled: !source.enabled })"
      >
        {{ source.enabled ? "暂停" : "启用" }}
      </button>
      <button
        class="table-action danger-action source-delete-action"
        type="button"
        :disabled="busyKey === `knowledge:source:delete:${source.sourceId}`"
        @click="deleteKnowledgeSource(source)"
      >
        删除
      </button>
    </div>
  </article>
</template>
