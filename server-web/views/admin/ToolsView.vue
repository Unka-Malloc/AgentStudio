<script setup lang="ts">
import { computed } from "vue";
import { useServerConsoleShellContext } from '../../composables/serverConsoleShellContext';
import { formatCompactDate, jsonPreview } from '../../composables/console-format-utils';
import {
  scopeLabel,
  toolRiskLabel,
  toolStatusLabel,
  toolsetLabel,
} from '../../composables/console-tool-display-utils';

const {
  adminView,
  toolManagementConsole,
} = useServerConsoleShellContext();

const {
  activeToolManagementToolCount,
  busyKey,
  internalToolManagementToolCount,
  policyPreviewGrantId,
  policyPreviewProfileId,
  policyPreviewProfileOptionBarOptions,
  policyPreviewResult,
  policyPreviewToolId,
  policyPreviewToolOptionBarOptions,
  previewToolPolicy,
  refreshToolManagement,
  toolGrants,
  toolManagementAuditItems,
  toolManagementCatalogState,
  toolManagementMetricsState,
  toolManagementProfiles,
  toolManagementRiskRows,
  toolManagementStatusRows,
  toolManagementTools,
  toolManagementToolsets,
  toolScopes,
} = toolManagementConsole;

const isStatsView = computed(() => adminView.value === "toolStats");

function percentLabel(value: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) {
    return "0%";
  }
  return `${Math.round((Number(value || 0) / total) * 100)}%`;
}

function renderScopeLabel(scopeId: string) {
  return scopeLabel(scopeId, toolScopes.value);
}

function renderToolsetLabel(toolsetId: string) {
  return toolsetLabel(toolsetId, toolManagementToolsets.value);
}

const toolUsageRows = computed(() => {
  const total = Number(toolManagementMetricsState.value?.callsTotal || 0);
  return [
    ...toolManagementStatusRows.value.map((row) => ({
      dimension: "状态",
      label: row.label,
      value: Number(row.value || 0),
      rate: percentLabel(Number(row.value || 0), total),
    })),
    ...toolManagementRiskRows.value.map((row) => ({
      dimension: "风险",
      label: toolRiskLabel(row.label),
      value: Number(row.value || 0),
      rate: percentLabel(Number(row.value || 0), total),
    })),
  ];
});
</script>

<template>
  <section class="tools-layout">
    <article v-if="!isStatsView" class="surface-card">
      <div class="section-header">
        <div>
          <h3>工具列表</h3>
        </div>
        <div class="section-tags">
          <span>目录指纹 {{ toolManagementCatalogState?.fingerprint?.slice(0, 12) || "未加载" }}</span>
          <span>可执行 {{ activeToolManagementToolCount }}</span>
          <span>内部 {{ internalToolManagementToolCount }}</span>
        </div>
      </div>

      <div class="job-table compact-job-table tool-list-table">
        <div class="job-table-header">
          <span>工具</span>
          <span>来源</span>
          <span>工具集</span>
          <span>权限层级</span>
          <span>风险</span>
          <span>状态</span>
        </div>
        <div
          v-for="tool in toolManagementTools"
          :key="tool.id"
          class="job-row"
        >
          <span>
            <strong>{{ tool.label }}</strong>
            <small>{{ tool.id }}</small>
          </span>
          <span>
            <strong>{{ tool.source || "未声明" }}</strong>
            <small>{{ tool.operationId || "无操作映射" }}</small>
          </span>
          <span>{{ tool.toolsets.map(renderToolsetLabel).join(" / ") || "未声明" }}</span>
          <span>{{ tool.requiredScopes.map(renderScopeLabel).join(" / ") || "未声明" }}</span>
          <span>{{ toolRiskLabel(tool.risk) }}</span>
          <span>{{ toolStatusLabel(tool.status) }}</span>
        </div>
      </div>

      <div v-if="toolManagementTools.length === 0" class="empty-state">
        <strong>尚未加载工具目录</strong>
      </div>
    </article>

    <article v-if="!isStatsView" class="surface-card">
      <div class="section-header">
        <div>
          <h3>工具治理</h3>
        </div>
        <div class="section-tags">
          <span>档案 {{ toolManagementProfiles.length }}</span>
          <span>授权 {{ toolGrants.length }}</span>
        </div>
      </div>

      <div class="form-grid compact-form-grid">
        <label>
          <span>工具</span>
          <select v-model="policyPreviewToolId">
            <option
              v-for="option in policyPreviewToolOptionBarOptions"
              :key="String(option.value)"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>智能体档案</span>
          <select v-model="policyPreviewProfileId">
            <option
              v-for="option in policyPreviewProfileOptionBarOptions"
              :key="String(option.value)"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>授权 ID</span>
          <input v-model="policyPreviewGrantId" autocomplete="off" placeholder="留空时使用模拟授权" />
        </label>
      </div>
      <div class="source-actions">
        <button
          class="tool-button"
          type="button"
          :disabled="busyKey === 'tool-policy-preview'"
          @click="previewToolPolicy"
        >
          {{ busyKey === "tool-policy-preview" ? "评估中" : "评估策略" }}
        </button>
      </div>
      <pre v-if="policyPreviewResult">{{ jsonPreview(policyPreviewResult) }}</pre>
    </article>

    <template v-else>
      <article class="surface-card">
        <div class="section-header">
          <div>
            <h3>工具统计</h3>
          </div>
          <div class="section-tags">
            <span>目录指纹 {{ toolManagementCatalogState?.fingerprint?.slice(0, 12) || "未加载" }}</span>
            <span>工具 {{ activeToolManagementToolCount }}/{{ toolManagementTools.length }}</span>
          </div>
        </div>

        <div class="detail-metrics knowledge-metrics">
          <div>
            <span>调用总量</span>
            <strong>{{ toolManagementMetricsState?.callsTotal || 0 }}</strong>
          </div>
          <div>
            <span>拒绝</span>
            <strong>{{ toolManagementMetricsState?.byStatus?.denied || 0 }}</strong>
          </div>
          <div>
            <span>限流</span>
            <strong>{{ toolManagementMetricsState?.rateLimitedTotal || 0 }}</strong>
          </div>
          <div>
            <span>平均耗时</span>
            <strong>{{ Math.round(toolManagementMetricsState?.averageDurationMs || 0) }}ms</strong>
          </div>
        </div>

        <div class="job-table compact-job-table tool-stats-table">
          <div class="job-table-header">
            <span>维度</span>
            <span>项目</span>
            <span>数量</span>
            <span>使用率</span>
          </div>
          <div
            v-for="row in toolUsageRows"
            :key="`${row.dimension}:${row.label}`"
            class="job-row"
          >
            <span>{{ row.dimension }}</span>
            <span>{{ row.label }}</span>
            <span>{{ row.value }}</span>
            <span>{{ row.rate }}</span>
          </div>
        </div>

        <div v-if="toolUsageRows.length === 0" class="empty-state">
          <strong>暂无工具统计</strong>
        </div>
      </article>

      <article class="surface-card">
        <div class="section-header">
          <div>
            <h3>最近调用</h3>
          </div>
        </div>
        <div class="job-table compact-job-table tool-audit-table">
          <div class="job-table-header">
            <span>执行</span>
            <span>工具</span>
            <span>状态</span>
            <span>耗时</span>
            <span>时间</span>
          </div>
          <div
            v-for="item in toolManagementAuditItems"
            :key="item.toolExecutionId"
            class="job-row"
          >
            <span>
              <strong>{{ item.toolExecutionId }}</strong>
              <small>{{ item.traceId || "无 trace" }}</small>
            </span>
            <span>{{ item.toolId }}</span>
            <span>{{ item.status }}{{ item.errorCode ? ` / ${item.errorCode}` : "" }}</span>
            <span>{{ item.durationMs }}ms</span>
            <span>{{ formatCompactDate(item.finishedAt || item.startedAt) }}</span>
          </div>
        </div>
        <div v-if="toolManagementAuditItems.length === 0" class="empty-state">
          <strong>暂无工具调用记录</strong>
        </div>
      </article>
    </template>
  </section>
</template>
