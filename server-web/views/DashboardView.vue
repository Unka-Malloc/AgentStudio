<script setup lang="ts">
import { computed } from 'vue';
import { useServerConsoleShellContext } from '../composables/serverConsoleShellContext';
import ApprovalFlowCardList from '../components/approval/ApprovalFlowCardList.vue';
import SegmentedToggle from '../components/SegmentedToggle.vue';
import StatusPill from '../components/StatusPill.vue';
import { provideApprovalFlowView } from '../composables/approvalFlowViewContext';
import { useApprovalFlowViewController } from '../composables/console-approval-flow-view-controller';
import type { DashboardAlert } from '../types/app';

const {
  busyKey,
  consoleState,
  dashboardAlertCounts,
  dashboardAlertInboxId,
  dashboardAlertSummary,
  dashboardAlerts,
  dashboardConfigurationQueue,
  dismissDashboardAlert,
  dashboardMonitorQueue,
  dashboardPrimaryAlert,
  dashboardSecondaryAlerts,
  knowledgeConsole,
  openDashboardAlert,
} = useServerConsoleShellContext();

const approvalFlow = useApprovalFlowViewController();
provideApprovalFlowView(approvalFlow);
const {
  approvalFlowCards,
  approvalFlowStatus,
  mcpAuthorizationStatusOptionBarOptions,
} = approvalFlow;

const clientTotalCount = computed(() => consoleState.value?.clients?.summary?.totalCount || 0);
const clientOfflineCount = computed(() => consoleState.value?.clients?.summary?.offlineCount || 0);
const clientOnlineCount = computed(() => Math.max(0, clientTotalCount.value - clientOfflineCount.value));
const approvalFlowCount = computed(() => approvalFlowCards.value.length);

function alertBusyKey(alertItem: DashboardAlert) {
  if (alertItem.actionKind === "recover-supervisor") {
    return "background-supervisor:recover";
  }
  return `monitor-alert:ack:${alertItem.alertId}`;
}

function isAlertBusy(alertItem: DashboardAlert) {
  return busyKey.value === alertBusyKey(alertItem);
}

function isDismissBusy(alertItem: DashboardAlert) {
  return busyKey.value === `monitor-alert:ack:${alertItem.alertId}`;
}

function dashboardAlertActionLabel(alertItem: DashboardAlert) {
  if (isAlertBusy(alertItem) && alertItem.actionKind === "recover-supervisor") {
    return "拉起中";
  }
  return alertItem.actionLabel || (alertItem.source === "configuration"
    ? "处理配置"
    : alertItem.tone === "success"
      ? "确认恢复"
      : "查看巡检");
}
</script>

<template>
  <section class="dashboard-view">
    <div class="metric-grid">
      <article class="metric-card">
        <div class="metric-card-header">
          <span>邮件 / 文档</span>
        </div>
        <h3>{{ (consoleState?.storage?.emailCount || 0).toLocaleString() }}</h3>
        <p>{{ (consoleState?.storage?.rawObjectCount || 0).toLocaleString() }} 个原始对象</p>
      </article>
      <article class="metric-card">
        <div class="metric-card-header">
          <span>知识事务</span>
          <StatusPill
            :tone="knowledgeConsole?.available ? 'success' : 'neutral'"
            :label="knowledgeConsole?.available ? '已启用' : '未启用'"
            :show-dot="false"
          />
        </div>
        <h3>{{ (consoleState?.storage?.transactionCount || 0).toLocaleString() }}</h3>
        <p>{{ (consoleState?.storage?.threadCount || 0).toLocaleString() }} 条线索</p>
      </article>
      <article class="metric-card">
        <div class="metric-card-header">
          <span>客户端</span>
          <StatusPill
            :tone="clientOnlineCount > 0 ? 'success' : 'neutral'"
            :label="clientTotalCount > 0 ? `${clientOnlineCount} 在线` : '无客户端'"
            :show-dot="false"
          />
        </div>
        <h3>{{ clientTotalCount }}</h3>
        <p>离线 {{ clientOfflineCount }}</p>
      </article>
      <article class="metric-card">
        <div class="metric-card-header">
          <span>任务队列</span>
          <StatusPill
            :tone="(consoleState?.jobs?.summary?.runningCount || 0) > 0 ? 'running' : 'neutral'"
            :label="(consoleState?.jobs?.summary?.runningCount || 0) > 0 ? `${consoleState?.jobs?.summary?.runningCount || 0} 运行中` : '空闲'"
            :show-dot="false"
          />
        </div>
        <h3>{{ (consoleState?.jobs?.summary?.queuedCount || 0) + (consoleState?.jobs?.summary?.runningCount || 0) }}</h3>
        <p>{{ (consoleState?.jobs?.summary?.completedCount || 0).toLocaleString() }} 已完成</p>
      </article>
    </div>
    <article class="surface-card configuration-alert-card">
      <div class="section-header">
        <div>
          <h3>报警</h3>
          <p>{{ dashboardAlertSummary }}</p>
        </div>
        <StatusPill
          :tone="dashboardAlertCounts.total ? 'warning' : 'success'"
          :label="dashboardAlertCounts.total ? `${dashboardAlertCounts.total} 项` : '已就绪'"
        />
      </div>
      <div class="dashboard-alert-counts" role="list" aria-label="报警分类">
        <span class="dashboard-alert-count" data-tone="danger" role="listitem">
          <strong>{{ dashboardAlertCounts.danger }}</strong>
          <span>严重</span>
        </span>
        <span class="dashboard-alert-count" data-tone="warning" role="listitem">
          <strong>{{ dashboardAlertCounts.warning }}</strong>
          <span>警告</span>
        </span>
        <span class="dashboard-alert-count" data-tone="configuration" role="listitem">
          <strong>{{ dashboardAlertCounts.configuration }}</strong>
          <span>配置</span>
        </span>
        <span class="dashboard-alert-count" data-tone="success" role="listitem">
          <strong>{{ dashboardAlertCounts.recovered }}</strong>
          <span>已恢复</span>
        </span>
      </div>
      <div v-if="dashboardAlerts.length" class="dashboard-alert-triage">
        <article
          v-if="dashboardPrimaryAlert"
          class="dashboard-alert-primary"
          :data-tone="dashboardPrimaryAlert.tone"
          :data-live="dashboardPrimaryAlert.live === false ? 'false' : 'true'"
        >
          <div class="dashboard-alert-primary-copy">
            <span class="configuration-alert-category">{{ dashboardPrimaryAlert.category }}</span>
            <strong>{{ dashboardPrimaryAlert.title }}</strong>
            <span>{{ dashboardPrimaryAlert.detail }}</span>
          </div>
          <em>{{ dashboardPrimaryAlert.status }}</em>
          <div class="dashboard-alert-primary-actions">
            <button
              class="configuration-alert-action"
              type="button"
              :disabled="isAlertBusy(dashboardPrimaryAlert)"
              @click="openDashboardAlert(dashboardPrimaryAlert)"
            >
              {{ dashboardAlertActionLabel(dashboardPrimaryAlert) }}
            </button>
            <button
              class="configuration-alert-action danger-action"
              type="button"
              :disabled="isDismissBusy(dashboardPrimaryAlert)"
              @click="dismissDashboardAlert(dashboardPrimaryAlert)"
            >
              {{ isDismissBusy(dashboardPrimaryAlert) ? "确认中" : "确认关闭" }}
            </button>
          </div>
        </article>
        <div class="dashboard-alert-queues">
          <section v-if="dashboardAlertCounts.configuration" class="dashboard-alert-queue">
            <header>
              <strong>配置队列</strong>
              <span>{{ dashboardAlertCounts.configuration }} 项</span>
            </header>
            <ul v-if="dashboardConfigurationQueue.length">
              <li
                v-for="alertItem in dashboardConfigurationQueue.slice(0, 3)"
                :key="dashboardAlertInboxId(alertItem)"
              >
                <span>{{ alertItem.title }}</span>
                <button
                  class="configuration-alert-action"
                  type="button"
                  @click="openDashboardAlert(alertItem)"
                >
                  处理
                </button>
              </li>
            </ul>
            <p v-else>首要配置项已置顶。</p>
          </section>
          <section v-if="dashboardAlertCounts.monitor" class="dashboard-alert-queue">
            <header>
              <strong>巡检队列</strong>
              <span>{{ dashboardAlertCounts.monitor }} 项</span>
            </header>
            <ul v-if="dashboardMonitorQueue.length">
              <li
                v-for="alertItem in dashboardMonitorQueue.slice(0, 3)"
                :key="dashboardAlertInboxId(alertItem)"
              >
                <span>{{ alertItem.title }}</span>
                <button
                  class="configuration-alert-action"
                  type="button"
                  :disabled="isAlertBusy(alertItem)"
                  @click="openDashboardAlert(alertItem)"
                >
                  {{ dashboardAlertActionLabel(alertItem) }}
                </button>
              </li>
            </ul>
            <p v-else>首要巡检项已置顶。</p>
          </section>
        </div>
        <div v-if="dashboardSecondaryAlerts.length" class="dashboard-alert-secondary-list">
          <article
            v-for="alertItem in dashboardSecondaryAlerts"
            :key="dashboardAlertInboxId(alertItem)"
            class="configuration-alert-item"
            :data-tone="alertItem.tone"
            :data-live="alertItem.live === false ? 'false' : 'true'"
          >
            <span class="configuration-alert-category">{{ alertItem.category }}</span>
            <strong>{{ alertItem.title }}</strong>
            <span>{{ alertItem.detail }}</span>
            <em>{{ alertItem.status }}</em>
            <div class="configuration-alert-actions">
              <button
                class="configuration-alert-action"
                type="button"
                :disabled="isAlertBusy(alertItem)"
                @click="openDashboardAlert(alertItem)"
              >
                {{ dashboardAlertActionLabel(alertItem) }}
              </button>
              <button
                class="configuration-alert-action danger-action"
                type="button"
                :disabled="isDismissBusy(alertItem)"
                @click="dismissDashboardAlert(alertItem)"
              >
                {{ isDismissBusy(alertItem) ? "确认中" : "确认关闭" }}
              </button>
            </div>
          </article>
        </div>
      </div>
      <div v-else class="configuration-alert-empty">
        <strong>没有报警</strong>
        <span>空配置、中断和后台巡检当前都没有需要处理的事项。</span>
      </div>
    </article>
    <article class="surface-card configuration-alert-card dashboard-approval-card">
      <div class="section-header">
        <div>
          <h3>审批流</h3>
          <p>统一处理 MCP 授权、知识入库冲突等需要人工决策的事项。</p>
        </div>
        <div class="dashboard-approval-actions">
          <StatusPill
            :tone="approvalFlowCount ? 'warning' : 'success'"
            :label="approvalFlowCount ? `${approvalFlowCount} 项` : '已清空'"
          />
          <SegmentedToggle
            v-model="approvalFlowStatus"
            :options="mcpAuthorizationStatusOptionBarOptions"
            aria-label="审批流状态"
            size="small"
          />
        </div>
      </div>

      <ApprovalFlowCardList />
    </article>
  </section>
</template>
