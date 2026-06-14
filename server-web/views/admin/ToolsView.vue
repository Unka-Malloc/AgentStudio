<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Close, Search } from "@element-plus/icons-vue";
import { useServerConsoleShellContext } from '../../composables/serverConsoleShellContext';
import { formatCompactDate, jsonPreview } from '../../composables/console-format-utils';
import {
  scopeLabel,
  toolRiskLabel,
  toolStatusLabel,
  toolsetLabel,
} from '../../composables/console-tool-display-utils';
import type { ToolManagementTool } from '../../lib/tool-management-client';

const {
  adminView,
  toolManagementConsole,
} = useServerConsoleShellContext();

const {
  activeToolManagementToolCount,
  busyKey,
  defaultAgentToolCount,
  internalToolManagementToolCount,
  policyPreviewGrantId,
  policyPreviewProfileId,
  policyPreviewProfileOptionBarOptions,
  policyPreviewResult,
  policyPreviewToolId,
  policyPreviewToolOptionBarOptions,
  previewToolPolicy,
  refreshToolManagement,
  selectToolForManagement,
  selectedToolManagementToolId,
  selectedToolManagementToolset,
  selectedToolManagementToolsetId,
  selectedToolManagementToolsetTools,
  selectToolManagementToolset,
  toolGrants,
  toolManagementAuditItems,
  toolManagementCatalogState,
  toolManagementMetricsState,
  toolManagementProfiles,
  toolManagementRiskRows,
  toolManagementStatusRows,
  toolManagementToolGroups,
  toolManagementTools,
  toolManagementToolsets,
  toolScopes,
} = toolManagementConsole;

const isCatalogView = computed(() => adminView.value === "toolList" || adminView.value === "tools");
const isGovernanceView = computed(() => adminView.value === "toolGovernance");
const isStatsView = computed(() => adminView.value === "toolStats");
const toolSearchQuery = ref("");
const toolSearchOpen = ref(false);
const normalizedToolSearchQuery = computed(() => toolSearchQuery.value.trim().toLowerCase());

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

function toolSearchText(tool: ToolManagementTool) {
  const tags = Array.isArray(tool.tags) ? tool.tags : [];
  const toolsets = Array.isArray(tool.toolsets) ? tool.toolsets : [];
  const requiredScopes = Array.isArray(tool.requiredScopes) ? tool.requiredScopes : [];
  return [
    tool.label,
    tool.id,
    tool.description,
    tool.source,
    tool.operationId,
    tool.handlerId,
    tags.join(" "),
    toolsets.join(" "),
    toolsets.map(renderToolsetLabel).join(" "),
    requiredScopes.join(" "),
    requiredScopes.map(renderScopeLabel).join(" "),
  ].join(" ").toLowerCase();
}

function toolSearchScore(tool: ToolManagementTool, query: string) {
  const id = tool.id.toLowerCase();
  const label = tool.label.toLowerCase();
  if (id === query) {
    return 100;
  }
  if (label === query) {
    return 90;
  }
  if (id.startsWith(query)) {
    return 80;
  }
  if (label.startsWith(query)) {
    return 70;
  }
  if (id.includes(query)) {
    return 60;
  }
  if (label.includes(query)) {
    return 50;
  }
  return 10;
}

const toolSearchResults = computed(() => {
  const query = normalizedToolSearchQuery.value;
  if (!query) {
    return [];
  }
  const tokens = query.split(/\s+/).filter(Boolean);
  return toolManagementTools.value
    .map((tool) => ({
      tool,
      searchText: toolSearchText(tool),
      score: toolSearchScore(tool, query),
    }))
    .filter((item) => tokens.every((token) => item.searchText.includes(token)))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.tool.label.localeCompare(right.tool.label);
    })
    .slice(0, 10)
    .map((item) => item.tool);
});

const showToolSearchResults = computed(
  () => toolSearchOpen.value && normalizedToolSearchQuery.value.length > 0,
);

function toolSearchToolsetLabel(tool: ToolManagementTool) {
  const currentToolset = tool.toolsets.find((toolsetId) => toolsetId === selectedToolManagementToolsetId.value);
  return renderToolsetLabel(currentToolset || tool.toolsets[0] || "");
}

function scrollSelectedToolIntoView(toolId: string) {
  window.requestAnimationFrame(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>(".tool-list-table [data-tool-id]"))
      .find((element) => element.dataset.toolId === toolId);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

async function jumpToToolSearchResult(tool: ToolManagementTool) {
  const nextToolsetId = tool.toolsets.includes(selectedToolManagementToolsetId.value)
    ? selectedToolManagementToolsetId.value
    : tool.toolsets[0] || "";
  if (nextToolsetId) {
    selectToolManagementToolset(nextToolsetId);
  }
  selectToolForManagement(tool.id);
  toolSearchOpen.value = false;
  await nextTick();
  scrollSelectedToolIntoView(tool.id);
}

async function jumpToFirstToolSearchResult() {
  const firstResult = toolSearchResults.value[0];
  if (firstResult) {
    await jumpToToolSearchResult(firstResult);
  }
}

function clearToolSearch() {
  toolSearchQuery.value = "";
  toolSearchOpen.value = false;
}

function closeToolSearchSoon() {
  window.setTimeout(() => {
    toolSearchOpen.value = false;
  }, 120);
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
    <template v-if="isCatalogView">
      <article class="tool-catalog-workspace">
        <div class="section-header tool-catalog-meta-bar">
          <div class="section-tags">
            <span>目录指纹 {{ toolManagementCatalogState?.fingerprint?.slice(0, 12) || "未加载" }}</span>
            <span>工具集 {{ toolManagementToolGroups.length }}</span>
            <span>原子工具 {{ toolManagementTools.length }}</span>
            <span>默认 {{ defaultAgentToolCount }}</span>
            <span>内部 {{ internalToolManagementToolCount }}</span>
          </div>
          <div class="tool-catalog-search" role="search">
            <label class="tool-catalog-search-field">
              <Search aria-hidden="true" class="tool-catalog-search-icon" />
              <input
                v-model="toolSearchQuery"
                type="search"
                autocomplete="off"
                aria-label="搜索并跳转工具"
                placeholder="搜索工具名称或 ID"
                @focus="toolSearchOpen = true"
                @blur="closeToolSearchSoon"
                @input="toolSearchOpen = true"
                @keydown.enter.prevent="jumpToFirstToolSearchResult"
                @keydown.esc.prevent="toolSearchOpen = false"
              />
              <button
                v-if="toolSearchQuery"
                class="tool-catalog-search-clear"
                type="button"
                aria-label="清空工具搜索"
                @click="clearToolSearch"
              >
                <Close aria-hidden="true" />
              </button>
            </label>
            <div
              v-if="showToolSearchResults"
              class="tool-catalog-search-popover"
              role="listbox"
              aria-label="工具搜索结果"
            >
              <button
                v-for="tool in toolSearchResults"
                :key="tool.id"
                class="tool-catalog-search-option"
                type="button"
                role="option"
                :aria-selected="selectedToolManagementToolId === tool.id"
                @pointerdown.prevent="jumpToToolSearchResult(tool)"
              >
                <span>
                  <strong>{{ tool.label }}</strong>
                  <small>{{ tool.id }}</small>
                </span>
                <em>{{ toolSearchToolsetLabel(tool) }}</em>
              </button>
              <div v-if="toolSearchResults.length === 0" class="tool-catalog-search-empty">
                未找到匹配工具
              </div>
            </div>
          </div>
        </div>

        <div class="tool-catalog-shell">
          <aside class="tool-catalog-index-pane" aria-label="工具集索引">
            <div class="tool-catalog-pane-header">
              <h4>工具集</h4>
              <span>{{ toolManagementToolGroups.length }} 个</span>
            </div>
            <div v-if="toolManagementToolGroups.length === 0" class="empty-state compact">
              <strong>尚未加载工具目录</strong>
            </div>
            <div v-else class="tool-catalog-index-list">
              <button
                v-for="group in toolManagementToolGroups"
                :key="group.id"
                class="tool-catalog-index-item"
                type="button"
                :aria-pressed="selectedToolManagementToolsetId === group.id"
                :data-active="selectedToolManagementToolsetId === group.id"
                @click="selectToolManagementToolset(group.id)"
              >
                <span class="tool-catalog-index-title">
                  <strong>{{ group.label }}</strong>
                  <small>{{ group.id }}</small>
                </span>
                <span class="tool-catalog-index-badges">
                  <span>{{ group.defaultForAgents ? "默认" : group.grantable ? "可授予" : "受限" }}</span>
                  <span>{{ group.toolCount }} 个</span>
                  <span>{{ toolRiskLabel(group.maxRisk) }}</span>
                </span>
                <span class="tool-catalog-index-meta">
                  {{ group.requiredScopes.map(renderScopeLabel).join(" / ") || "未声明权限" }}
                </span>
              </button>
            </div>
          </aside>

          <section class="tool-catalog-detail-pane" aria-label="原子工具">
            <div class="section-header">
              <div>
                <h3>{{ selectedToolManagementToolset?.label || "原子工具" }}</h3>
              </div>
              <div class="section-tags">
                <span>{{ selectedToolManagementToolset ? selectedToolManagementToolset.id : "未选择工具集" }}</span>
                <span>{{ selectedToolManagementToolsetTools.length }} 个</span>
              </div>
            </div>

            <div
              v-if="selectedToolManagementToolset"
              class="job-table compact-job-table tool-list-table"
            >
              <div class="job-table-header">
                <span>工具</span>
                <span>来源</span>
                <span>工具集</span>
                <span>权限层级</span>
                <span>风险</span>
                <span>状态</span>
              </div>
              <div
                v-for="tool in selectedToolManagementToolsetTools"
                :key="tool.id"
                class="job-row"
                :data-active="selectedToolManagementToolId === tool.id"
                :data-tool-id="tool.id"
              >
                <span data-label="工具">
                  <strong>{{ tool.label }}</strong>
                  <small>{{ tool.id }}</small>
                </span>
                <span data-label="来源">
                  <strong>{{ tool.source || "未声明" }}</strong>
                  <small>{{ tool.operationId || "无操作映射" }}</small>
                </span>
                <span data-label="工具集">{{ tool.toolsets.map(renderToolsetLabel).join(" / ") || "未声明" }}</span>
                <span data-label="权限层级">{{ tool.requiredScopes.map(renderScopeLabel).join(" / ") || "未声明" }}</span>
                <span data-label="风险">{{ toolRiskLabel(tool.risk) }}</span>
                <span data-label="状态">{{ toolStatusLabel(tool.status) }}</span>
              </div>
            </div>

            <div v-else-if="toolManagementToolGroups.length === 0" class="empty-state">
              <strong>尚未加载工具目录</strong>
            </div>
            <div v-else class="empty-state">
              <strong>选择左侧工具集后查看原子工具</strong>
            </div>
          </section>
        </div>
      </article>
    </template>

    <article v-else-if="isGovernanceView" class="surface-card">
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
