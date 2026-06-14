<script setup lang="ts">
import { useRuntimeDownloadsViewContext } from "../../../composables/runtimeDownloadsViewContext";

const {
  cacheRoot,
  failedCount,
  generatedAtLabel,
  installedCount,
  loadError,
  readyCount,
  sourceConfigPath,
} = useRuntimeDownloadsViewContext();
</script>

<template>
  <article class="surface-card">
    <div class="section-header">
      <div>
        <h3>环境配置</h3>
        <p>集中查看本机运行时、来源路径、安装进展和关联配置。</p>
      </div>
      <div class="section-tags">
        <span>已存在 {{ readyCount }}</span>
        <span>安装成功 {{ installedCount }}</span>
        <span>不可用 {{ failedCount }}</span>
        <span>{{ generatedAtLabel }}</span>
      </div>
    </div>

    <div v-if="loadError" class="status-strip danger">
      <strong>检测失败</strong>
      <span>{{ loadError }}</span>
    </div>

    <dl class="module-status-list">
      <div>
        <dt>缓存目录</dt>
        <dd>{{ cacheRoot || "未读取" }}</dd>
      </div>
      <div>
        <dt>源配置</dt>
        <dd>{{ sourceConfigPath || "未读取" }}</dd>
      </div>
    </dl>
  </article>
</template>
