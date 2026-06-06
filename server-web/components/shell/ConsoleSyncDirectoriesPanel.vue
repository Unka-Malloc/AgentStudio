<script setup lang="ts">
import BinaryCheckbox from "../BinaryCheckbox.vue";
import BrowseSelectButton from "../BrowseSelectButton.vue";
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
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";
import { shortId } from "../../composables/console-agent-explore-presentation";

const {
  activeKnowledgeSources,
  addKnowledgeSource,
  busyKey,
  canBrowseServerPaths,
  canWriteJobs,
  deleteKnowledgeSource,
  localSourceForm,
  openLocalSourceDirectoryPicker,
  refreshKnowledgeSource,
  syncLocalSourceLabelFromPath,
  updateKnowledgeSource,
} = useServerConsoleShellContext();
</script>

<template>
  <section class="drawer-panel">
    <div class="panel-header">
      <h4>目录管理</h4>
      <p>填写服务端可访问的本地目录。目录变化后会自动整理并更新知识库，也可以手动同步。</p>
    </div>

    <form class="knowledge-source-form" @submit.prevent="addKnowledgeSource">
      <label class="source-name-field">
        <span>目录名称</span>
        <input v-model="localSourceForm.label" type="text" placeholder="例如：公司共享资料" autocomplete="off" />
      </label>
      <label class="source-path-field">
        <span>本地路径</span>
        <div class="path-field">
          <input
            v-model="localSourceForm.directoryPath"
            type="text"
            placeholder="/Users/you/Documents/Knowledge"
            autocomplete="off"
            @change="syncLocalSourceLabelFromPath"
          />
          <BrowseSelectButton
            kind="server-directory"
            button-class="path-action-button"
            button-text="浏览"
            size="small"
            :disabled="!canBrowseServerPaths"
            plain
            @browse="openLocalSourceDirectoryPicker"
          />
        </div>
      </label>
      <div class="source-sync-row">
        <BinaryCheckbox
          v-model="localSourceForm.autoSync"
          label="自动监听变化"
        />
        <BinaryCheckbox
          v-model="localSourceForm.recursive"
          label="包含子目录"
        />
        <BinaryCheckbox
          v-model="localSourceForm.hydrationEnabled"
          label="自动下载"
        />
        <button
          class="primary-action"
          type="submit"
          :disabled="!canWriteJobs || busyKey === 'knowledge:sources:add'"
        >
          {{ busyKey === "knowledge:sources:add" ? "添加中" : "添加目录" }}
        </button>
      </div>
    </form>

    <div class="knowledge-source-list">
      <article
        v-for="source in activeKnowledgeSources"
        :key="source.sourceId"
        class="knowledge-source-card"
      >
        <div class="knowledge-source-card-header">
          <div>
            <strong>{{ source.label }}</strong>
            <span>{{ source.directoryPath }}</span>
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
          <div>
            <span>{{ splitJobStatusLabel(source.lastJobStatus) }}</span>
            <small>{{ source.lastJobStage || "等待开始" }}</small>
          </div>
          <progress :value="sourceJobProgress(source)" max="100" />
        </div>
        <p v-if="source.error" class="module-note danger-note">{{ source.error }}</p>
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
            class="table-action"
            type="button"
            :disabled="busyKey === `knowledge:source:delete:${source.sourceId}`"
            @click="deleteKnowledgeSource(source)"
          >
            删除
          </button>
        </div>
      </article>
      <div v-if="activeKnowledgeSources.length === 0" class="empty-state">
        <strong>暂无目录</strong>
        <span>添加一个服务端本地目录后，文件变化会自动触发整理任务。</span>
      </div>
    </div>
  </section>
</template>
