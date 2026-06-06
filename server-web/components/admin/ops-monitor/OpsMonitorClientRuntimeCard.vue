<script setup lang="ts">
import StatusPill from "../../StatusPill.vue";
import { useOpsMonitorViewContext } from "../../../composables/opsMonitorViewContext";

const {
  clientRuntimeCoolingLabel,
  clientRuntimeCoolingTone,
  clientRuntimeHeatRows,
  clientRuntimeHeatStyle,
  clientRuntimeReasonLabel,
  clientRuntimeSummary,
  clientRuntimeSurfaceText,
  clientRuntimeTaskText,
  formatCompactDate,
} = useOpsMonitorViewContext();
</script>

<template>
  <article class="surface-card client-runtime-card">
    <div class="section-header">
      <div>
        <h3>客户端热力图</h3>
      </div>
      <div class="section-tags">
        <span>客户端 {{ clientRuntimeSummary.totalClients }}</span>
        <span>调用 {{ clientRuntimeSummary.totalCalls }}</span>
        <span>热 {{ clientRuntimeSummary.hotClients }}</span>
        <span>冷却 {{ clientRuntimeSummary.cooledClients }}</span>
      </div>
    </div>
    <div v-if="clientRuntimeHeatRows.length > 0" class="client-runtime-heatmap">
      <div class="client-runtime-heatmap-header">
        <span>客户端</span>
        <span>热度</span>
        <span>工作空间</span>
        <span>上下文</span>
        <span>最近调用</span>
        <span>调用面</span>
      </div>
      <div
        v-for="row in clientRuntimeHeatRows"
        :key="row.clientUid"
        class="client-runtime-heatmap-row"
        :data-heat="row.heatLevel"
      >
        <span>
          <strong>{{ row.clientUid }}</strong>
          <small>{{ row.profileId }} · {{ row.matched ? "命中 profile" : "默认 profile" }}</small>
        </span>
        <span>
          <StatusPill :tone="clientRuntimeCoolingTone(row.coolingState)" :label="clientRuntimeCoolingLabel(row.coolingState)" />
          <small>{{ clientRuntimeReasonLabel(row.coolingReason) }}</small>
          <span class="client-runtime-heatbar" :style="clientRuntimeHeatStyle(row)"><i /></span>
        </span>
        <span>
          <strong>{{ row.workspaceId || "未分配" }}</strong>
          <small>{{ row.retrievalProfileId || "无检索 profile" }}</small>
        </span>
        <span>
          <strong>{{ row.contextProfileId || "未分配" }}</strong>
          <small>{{ row.modelAlias || "未指定模型" }}</small>
        </span>
        <span>
          <strong>{{ row.recentCalls }} / {{ row.totalCalls }}</strong>
          <small>{{ formatCompactDate(row.lastSeenAt) }}</small>
        </span>
        <span>
          <strong>{{ clientRuntimeTaskText(row) }}</strong>
          <small>{{ clientRuntimeSurfaceText(row) }}</small>
        </span>
      </div>
    </div>
    <div v-else class="empty-state">
      <strong>暂无客户端运行时热度</strong>
      <span>带 clientUid 的标准调用进入协议层后会在这里出现。</span>
    </div>
  </article>
</template>
