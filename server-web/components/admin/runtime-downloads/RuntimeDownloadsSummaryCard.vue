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
        <h3>运行时下载</h3>
        <p>按需检测本机能力，只有点击安装时才下载或缓存缺失依赖。</p>
      </div>
      <div class="section-tags">
        <span>已存在 {{ readyCount }}</span>
        <span>安装成功 {{ installedCount }}</span>
        <span>安装失败 {{ failedCount }}</span>
        <span>{{ generatedAtLabel }}</span>
      </div>
    </div>

    <div v-if="loadError" class="status-strip danger">
      <strong>检测失败</strong>
      <span>{{ loadError }}</span>
    </div>

    <dl class="module-status-list">
      <div>
        <dt>触发方式</dt>
        <dd>用户请求</dd>
      </div>
      <div>
        <dt>启动下载</dt>
        <dd>关闭</dd>
      </div>
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
