<script setup lang="ts">
import { useServerConsoleShellContext } from '../../composables/serverConsoleShellContext';
import { jobStatusLabels } from '../../composables/console-defaults';
import { formatCompactDate, jobStatusTone } from '../../composables/console-format-utils';
import { jobElapsed } from '../../composables/console-job-display-utils';
import { queueLifecycleLabel } from '../../composables/console-status-utils';
import StatusPill from '../../components/StatusPill.vue';
const {
  adminView,
  busyKey,
  consoleState,
  currentView,
  deleteJob,
  isAuthenticated,
  workQueueRows,
  workQueueSummary,
  queueMonitorState,
  recentJobs,
} = useServerConsoleShellContext();
</script>

<template>
          <section id="jobs" class="surface-card jobs-card">
            <div class="section-header">
              <div>
                <h3>任务队列</h3>
              </div>
              <div class="section-tags">
                <span>队列 {{ workQueueSummary.total }}</span>
                <span>活跃 {{ workQueueSummary.active }}</span>
                <span>中断 {{ workQueueSummary.interrupted }}</span>
                <span>恢复 {{ workQueueSummary.recovered }}</span>
              </div>
            </div>

            <section class="queue-status-section">
              <div class="section-header compact-section-header">
                <div>
                  <h4>队列状态</h4>
                </div>
                <div class="section-tags">
                  <span>监控项 {{ queueMonitorState?.summary.totalCount || 0 }}</span>
                  <span>打开 {{ queueMonitorState?.summary.openCount || 0 }}</span>
                </div>
              </div>
              <div class="job-table compact-job-table work-queue-table">
                <div class="job-table-header">
                  <span>队列</span>
                  <span>来源</span>
                  <span>状态</span>
                  <span>心跳 / 更新时间</span>
                  <span>说明</span>
                </div>
                <div
                  v-for="row in workQueueRows"
                  :key="row.rowId"
                  class="job-row"
                >
                  <span>
                    <strong>{{ row.label }}</strong>
                    <small>{{ row.queueId }}</small>
                  </span>
                  <span>
                    <strong>{{ row.sourceLabel }}</strong>
                    <small>{{ row.kind }} · {{ row.ownerId || "无 owner" }}</small>
                  </span>
                  <StatusPill :tone="row.tone" :label="queueLifecycleLabel(row.lifecycleStatus || row.status)" />
                  <span>
                    <strong>{{ formatCompactDate(row.lastHeartbeatAt || row.updatedAt || row.startedAt) }}</strong>
                    <small>{{ row.updatedAt ? `更新 ${formatCompactDate(row.updatedAt)}` : "无更新时间" }}</small>
                  </span>
                  <span>
                    <strong>{{ row.phase || row.status }}</strong>
                    <small>{{ row.detail }}</small>
                  </span>
                </div>
              </div>
	              <div v-if="workQueueRows.length === 0" class="empty-state">
	                <strong>暂无队列记录</strong>
	                <span>当前没有导入解析、知识蒸馏、智能巡检或队列监控记录。</span>
	              </div>
	            </section>

            <div class="section-header compact-section-header">
              <div>
                <h4>任务记录</h4>
              </div>
              <div class="section-tags">
                <span>总计 {{ consoleState?.jobs?.summary?.totalCount || 0 }}</span>
                <span>完成 {{ consoleState?.jobs?.summary?.completedCount || 0 }}</span>
                <span>失败 {{ consoleState?.jobs?.summary?.failedCount || 0 }}</span>
              </div>
            </div>
            <div class="table-shell">
              <table class="jobs-table">
                <thead>
                  <tr>
                    <th>任务 ID</th>
                    <th>队列 ID</th>
                    <th>状态</th>
                    <th>进度</th>
                    <th>耗时</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody v-if="recentJobs.length > 0">
                  <tr v-for="item in recentJobs" :key="item.id">
                    <td>
                      <div class="primary-cell">
                        <strong>{{ item.id }}</strong>
                        <span>{{ item.stage }}</span>
                      </div>
                    </td>
                    <td>
                      <span class="url-badge">{{ item.queueId || "未登记" }}</span>
                    </td>
                    <td>
	                      <StatusPill :tone="jobStatusTone(item.status)" :label="jobStatusLabels[item.status]" />
                    </td>
                    <td class="progress-cell">
                      <div class="progress-track">
                        <div
                          class="progress-fill"
                          :style="{ width: `${item.progressPercent}%` }"
                        />
                      </div>
                      <span>{{ item.progressPercent }}%</span>
                    </td>
                    <td>
                      <div class="time-cell">
                        <strong>{{ jobElapsed(item) }}</strong>
                        <span>{{ formatCompactDate(item.updatedAt) }}</span>
                      </div>
                    </td>
                    <td>
                      <button
                        class="table-action"
                        type="button"
                        :disabled="busyKey === `job:${item.id}`"
                        @click="deleteJob(item.id)"
                      >
                        {{ busyKey === `job:${item.id}` ? "处理中" : "删除" }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div v-if="recentJobs.length === 0" class="empty-state">
                <strong>暂无任务记录</strong>
                <span>当前筛选条件下没有匹配任务。</span>
              </div>
            </div>
          </section>
</template>
