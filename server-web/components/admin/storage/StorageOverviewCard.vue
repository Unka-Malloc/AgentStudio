<script setup lang="ts">
import { useStorageViewContext } from "../../../composables/storageViewContext";

const {
  activeJobCount,
  attentionClientCount,
  consoleState,
  enabledMountCount,
  enabledMountPercent,
  totalMountCount,
} = useStorageViewContext();
</script>

<template>
  <article class="surface-card detail-card system-overview-card">
    <div class="section-header">
      <div>
        <h3>概览</h3>
      </div>
    </div>

    <section class="metric-grid system-overview-metrics">
      <article class="metric-card" data-tone="primary">
        <div class="metric-card-header">
          <span>数据源</span>
          <strong>{{ enabledMountCount }}/{{ totalMountCount }}</strong>
        </div>
        <h3>{{ enabledMountCount }}</h3>
        <div class="metric-progress">
          <div
            class="metric-progress-bar"
            :style="{ width: `${enabledMountPercent}%` }"
          />
        </div>
        <p>当前可用的导入、解析与索引能力。</p>
      </article>

      <article class="metric-card" data-tone="accent">
        <div class="metric-card-header">
          <span>活跃任务</span>
          <strong>{{ activeJobCount }}</strong>
        </div>
        <h3>{{ consoleState?.jobs?.summary?.totalCount || 0 }}</h3>
        <p>
          运行中
          {{ consoleState?.jobs?.summary?.runningCount || 0 }}，排队
          {{ consoleState?.jobs?.summary?.queuedCount || 0 }}
        </p>
      </article>

      <article class="metric-card" data-tone="neutral">
        <div class="metric-card-header">
          <span>存储批次</span>
          <strong>{{ consoleState?.storage?.batchCount || 0 }}</strong>
        </div>
        <h3>{{ consoleState?.storage?.sourceCount || 0 }}</h3>
        <p>
          邮件 {{ consoleState?.storage?.emailCount || 0 }}，事务
          {{ consoleState?.storage?.transactionCount || 0 }}
        </p>
      </article>

      <article class="metric-card" data-tone="success">
        <div class="metric-card-header">
          <span>待关注</span>
          <strong>{{ consoleState?.clients?.summary?.totalCount || 0 }}</strong>
        </div>
        <h3>{{ attentionClientCount }}</h3>
        <p>任务、设备或服务状态需要处理。</p>
      </article>
    </section>

    <div class="detail-metrics">
      <div>
        <span>原始对象</span>
        <strong>{{ consoleState?.storage?.rawObjectCount || 0 }}</strong>
      </div>
      <div>
        <span>线程</span>
        <strong>{{ consoleState?.storage?.threadCount || 0 }}</strong>
      </div>
      <div>
        <span>人物</span>
        <strong>{{ consoleState?.storage?.peopleCount || 0 }}</strong>
      </div>
      <div>
        <span>检索项</span>
        <strong>{{ consoleState?.storage?.retrievalCount || 0 }}</strong>
      </div>
    </div>

    <dl class="meta-list">
      <div>
        <dt>批次</dt>
        <dd>{{ consoleState?.storage?.batchCount || 0 }}</dd>
      </div>
      <div>
        <dt>数据源</dt>
        <dd>{{ consoleState?.storage?.sourceCount || 0 }}</dd>
      </div>
    </dl>
  </article>
</template>
