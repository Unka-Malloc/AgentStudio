<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue';
import { useServerConsoleShellContext } from '../../composables/serverConsoleShellContext';
import { formatMachineDate } from '../../composables/console-format-utils';
import DataTable from '../../components/DataTable.vue';
import OptionBar from '../../components/OptionBar.vue';
import StatusPill from '../../components/StatusPill.vue';
const {
  adminView,
  busyKey,
  currentView,
  error,
  exportKnowledgeLogRows,
  filteredKnowledgeLogRows,
  goToKnowledgeLogNextPage,
  goToKnowledgeLogPreviousPage,
  handleKnowledgeLogTableScroll,
  isAuthenticated,
  knowledgeLogColumnWidths,
  knowledgeLogCurrentPage,
  knowledgeLogDisplayStatusLabel,
  knowledgeLogFilters,
  knowledgeLogKindOptionBarOptions,
  knowledgeLogPageCount,
  knowledgeLogPageRange,
  knowledgeLogPageSize,
  knowledgeLogPageSizeOptionBarOptions,
  knowledgeLogPageTotal,
  knowledgeLogStatusOptionBarOptions,
  knowledgeLogTableShellRef,
  monitorAlertSummary,
  paginatedKnowledgeLogRows,
  workQueueSummary,
  serverLogRows,
} = useServerConsoleShellContext();

function handleHeaderDragend(newWidth: number, oldWidth: number, column: any) {
  const key = column.property;
  if (key && key in knowledgeLogColumnWidths.value) {
    knowledgeLogColumnWidths.value[key as keyof typeof knowledgeLogColumnWidths.value] = newWidth;
  }
}

function knowledgeLogDetailItems(detail: string) {
  return String(detail || "")
    .split(/\s+·\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
</script>

<template>
          <section id="system-logs" class="surface-card knowledge-log-report">
            <div class="section-header">
              <div>
                <h3>日志记录</h3>
                <p>汇总服务端上传、知识库、任务队列、任务、进程、报警、认证和工具调用日志。</p>
              </div>
              <div class="section-tags">
                <span>总计 {{ serverLogRows.length }}</span>
                <span>筛选 {{ filteredKnowledgeLogRows.length }}</span>
                <span>本页 {{ paginatedKnowledgeLogRows.length }}</span>
                <span>队列 {{ workQueueSummary.total }}</span>
                <span>报警 {{ monitorAlertSummary.visibleCount || monitorAlertSummary.activeCount }}</span>
              </div>
            </div>
            <div class="source-actions knowledge-log-actions">
              <button class="tool-button" type="button" @click="exportKnowledgeLogRows">
                导出 CSV
              </button>
            </div>
            <div class="knowledge-log-filters">
              <label class="knowledge-log-filter-field">
                <span>模糊匹配</span>
                <input v-model="knowledgeLogFilters.fuzzy" type="search" placeholder="任意关键词" />
              </label>
              <OptionBar
                v-model="knowledgeLogFilters.kind"
                label="类型"
                :options="knowledgeLogKindOptionBarOptions"
              />
              <OptionBar
                v-model="knowledgeLogFilters.status"
                label="状态"
                :options="knowledgeLogStatusOptionBarOptions"
              />
              <label class="knowledge-log-filter-field">
                <span>开始日期</span>
                <input v-model="knowledgeLogFilters.from" type="date" />
              </label>
              <label class="knowledge-log-filter-field">
                <span>结束日期</span>
                <input v-model="knowledgeLogFilters.to" type="date" />
              </label>
            </div>
            <div ref="knowledgeLogTableShellRef" class="knowledge-log-table-shell">
              <DataTable
                :data="paginatedKnowledgeLogRows"
                row-key="logId"
                empty-text="暂无系统日志"
                @scroll="handleKnowledgeLogTableScroll"
                @header-dragend="handleHeaderDragend"
              >
                <el-table-column prop="kind" label="类型" :min-width="knowledgeLogColumnWidths.kind">
                  <template #default="{ row }">
                    <span class="knowledge-log-kind">{{ row.kindLabel }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="target" label="对象" :min-width="knowledgeLogColumnWidths.target">
                  <template #default="{ row }">
                    <div class="knowledge-log-target">
                      <span class="mono-compact" :title="row.logId">{{ row.logId }}</span>
                      <small>{{ row.target }}</small>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="time" label="时间" :min-width="knowledgeLogColumnWidths.time">
                  <template #default="{ row }">
                    <span class="knowledge-log-time" :title="formatMachineDate(row.occurredAt, 'full')">
                      {{ formatMachineDate(row.occurredAt, 'full') }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="status" label="状态" :min-width="knowledgeLogColumnWidths.status">
                  <template #default="{ row }">
                    <span class="knowledge-log-status">
                      <StatusPill :tone="row.tone" :label="knowledgeLogDisplayStatusLabel(row)" />
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="progress" label="进度" :min-width="knowledgeLogColumnWidths.progress">
                  <template #default="{ row }">
                    <span class="knowledge-log-progress">
                      {{ Math.round(Number(row.progressPercent || 0)) }}%
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="stage" label="阶段" :min-width="knowledgeLogColumnWidths.stage">
                  <template #default="{ row }">
                    <span class="knowledge-log-stage">{{ row.stage }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="detail" label="详情" :min-width="knowledgeLogColumnWidths.detail">
                  <template #default="{ row }">
                    <ul class="knowledge-log-detail-list" :title="row.detail">
                      <li
                        v-for="(item, index) in knowledgeLogDetailItems(row.detail)"
                        :key="`${row.logId}:detail:${index}`"
                      >
                        {{ item }}
                      </li>
                    </ul>
                  </template>
                </el-table-column>
                <el-table-column prop="error" label="错误" :min-width="knowledgeLogColumnWidths.error">
                  <template #default="{ row }">
                    <span class="knowledge-log-error">{{ row.error }}</span>
                  </template>
                </el-table-column>
              </DataTable>
            </div>
            <div class="knowledge-log-pagination" v-if="knowledgeLogPageTotal > 0">
              <div class="knowledge-log-page-size-control">
                <OptionBar
                  v-model="knowledgeLogPageSize"
                  class="knowledge-log-page-size"
                  :options="knowledgeLogPageSizeOptionBarOptions"
                />
              </div>
              <div
                class="knowledge-log-page-indicator"
                :title="`${knowledgeLogPageRange.start}-${knowledgeLogPageRange.end} / ${knowledgeLogPageTotal}`"
              >
                <span>-</span>
                <span>·</span>
                <strong>{{ knowledgeLogCurrentPage }} / {{ knowledgeLogPageCount }}</strong>
                <span>·</span>
                <span>-</span>
              </div>
              <div class="knowledge-log-pagination-controls">
                <button
                  class="tool-button tool-button-ghost knowledge-log-page-button"
                  type="button"
                  :disabled="knowledgeLogCurrentPage <= 1"
                  @click="goToKnowledgeLogPreviousPage"
                >
                  <span class="knowledge-log-page-icon" aria-hidden="true"><ArrowLeft /></span>
                  <span>上一页</span>
                </button>
                <button
                  class="tool-button tool-button-ghost knowledge-log-page-button"
                  type="button"
                  :disabled="knowledgeLogCurrentPage >= knowledgeLogPageCount"
                  @click="goToKnowledgeLogNextPage"
                >
                  <span>下一页</span>
                  <span class="knowledge-log-page-icon" aria-hidden="true"><ArrowRight /></span>
                </button>
              </div>
            </div>
          </section>
</template>
