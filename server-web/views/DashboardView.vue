<script setup lang="ts">
import { computed } from 'vue';
import { useServerConsoleShellContext } from '../composables/serverConsoleShellContext';
import StatusPill from '../components/StatusPill.vue';
import { knowledgeReviewCanResolveWithDocument } from '../composables/console-knowledge-review-utils';
import { useApprovalFlowViewController, type ApprovalFlowCard } from '../composables/console-approval-flow-view-controller';
import { currentConsoleLocale } from '../i18n/console';
import type { DashboardAlert } from '../types/app';

const {
  busyKey,
  consoleState,
  dashboardAlertInboxId,
  dashboardAlerts,
  dismissDashboardAlert,
  knowledgeConsole,
  openDashboardAlert,
} = useServerConsoleShellContext();

const approvalFlow = useApprovalFlowViewController();
const {
  approvalFlowCards,
  acceptKnowledgeReview,
  approveAuthorization,
  authorizationBusy,
  fuseKnowledgeReviewItem,
  keepBothKnowledgeReview,
  rejectAuthorization,
  rejectKnowledgeReview,
  replaceKnowledgeReview,
  reviewBusy,
  reviewFusionDisabled,
  reviewKeepBothDisabled,
} = approvalFlow;

const clientTotalCount = computed(() => consoleState.value?.clients?.summary?.totalCount || 0);
const clientOfflineCount = computed(() => consoleState.value?.clients?.summary?.offlineCount || 0);
const clientOnlineCount = computed(() => Math.max(0, clientTotalCount.value - clientOfflineCount.value));
const approvalFlowCount = computed(() => approvalFlowCards.value.length);
const dashboardAlertCount = computed(() => dashboardAlerts.value.length);

type DashboardTodoItem =
  | {
      key: string;
      kind: "alert";
      tone: DashboardAlert["tone"];
      label: string;
      title: string;
      summary: string;
      meta: string[];
      alert: DashboardAlert;
    }
  | {
      key: string;
      kind: "approval";
      tone: string;
      label: string;
      title: string;
      summary: string;
      meta: string[];
      card: ApprovalFlowCard;
    };

function alertSourceLabel(alertItem: DashboardAlert) {
  return alertItem.source === "configuration" ? "配置待办" : "运维待办";
}

function alertTodoMeta(alertItem: DashboardAlert) {
  return [
    alertItem.status,
    alertSourceLabel(alertItem),
    alertItem.live === false ? "待确认" : "",
  ].filter(Boolean);
}

const dashboardTodoItems = computed<DashboardTodoItem[]>(() => [
  ...dashboardAlerts.value.map((alertItem) => ({
    key: `alert:${dashboardAlertInboxId(alertItem)}`,
    kind: "alert" as const,
    tone: alertItem.tone,
    label: alertItem.category,
    title: alertItem.title,
    summary: alertItem.detail,
    meta: alertTodoMeta(alertItem),
    alert: alertItem,
  })),
  ...approvalFlowCards.value.map((card) => ({
    key: `approval:${card.key}`,
    kind: "approval" as const,
    tone: card.tone,
    label: card.label,
    title: card.title,
    summary: card.summary,
    meta: card.meta,
    card,
  })),
]);

const dashboardTodoSummary = computed(() => {
  if (currentConsoleLocale.value === "en") {
    if (!dashboardTodoItems.value.length) {
      return "No pending items for this role.";
    }
    return [
      dashboardAlertCount.value ? `${dashboardAlertCount.value} alerts` : "",
      approvalFlowCount.value ? `${approvalFlowCount.value} approvals` : "",
    ].filter(Boolean).join(" · ");
  }
  if (!dashboardTodoItems.value.length) {
    return "当前角色没有待办事项。";
  }
  return [
    dashboardAlertCount.value ? `${dashboardAlertCount.value} 个告警` : "",
    approvalFlowCount.value ? `${approvalFlowCount.value} 个审批` : "",
  ].filter(Boolean).join(" · ");
});

const dashboardTodoStatusLabel = computed(() => {
  if (currentConsoleLocale.value === "en") {
    return dashboardTodoItems.value.length ? `${dashboardTodoItems.value.length} items` : "Cleared";
  }
  return dashboardTodoItems.value.length ? `${dashboardTodoItems.value.length} 项` : "已清空";
});

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

function isApprovalActionVisible(card: ApprovalFlowCard) {
  if (card.kind === "authorization") {
    return card.request.status === "pending";
  }
  return card.review.status === "pending";
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
    <article class="surface-card dashboard-todo-card">
      <div class="section-header">
        <div>
          <h3>待办事项</h3>
          <p>{{ dashboardTodoSummary }}</p>
        </div>
        <StatusPill
          :tone="dashboardTodoItems.length ? 'warning' : 'success'"
          :label="dashboardTodoStatusLabel"
        />
      </div>
      <div v-if="dashboardTodoItems.length" class="dashboard-todo-list">
        <article
          v-for="todo in dashboardTodoItems"
          :key="todo.key"
          class="dashboard-todo-item"
          :data-tone="todo.tone"
          :data-kind="todo.kind"
          :data-live="todo.kind === 'alert' && todo.alert.live === false ? 'false' : 'true'"
        >
          <header class="dashboard-todo-item-header">
            <div>
              <span class="dashboard-todo-kind">{{ todo.label }}</span>
              <strong>{{ todo.title }}</strong>
            </div>
            <div class="dashboard-todo-meta">
              <span v-for="item in todo.meta" :key="`${todo.key}:${item}`">{{ item }}</span>
            </div>
          </header>
          <p>{{ todo.summary }}</p>
          <div v-if="todo.kind === 'alert'" class="dashboard-todo-actions">
            <button
              class="configuration-alert-action"
              type="button"
              :disabled="isAlertBusy(todo.alert)"
              @click="openDashboardAlert(todo.alert)"
            >
              {{ dashboardAlertActionLabel(todo.alert) }}
            </button>
            <button
              class="configuration-alert-action danger-action"
              type="button"
              :disabled="isDismissBusy(todo.alert)"
              @click="dismissDashboardAlert(todo.alert)"
            >
              {{ isDismissBusy(todo.alert) ? "确认中" : "确认关闭" }}
            </button>
          </div>
          <div
            v-else-if="isApprovalActionVisible(todo.card)"
            class="dashboard-todo-actions"
          >
            <template v-if="todo.card.kind === 'authorization'">
              <button
                class="configuration-alert-action"
                type="button"
                :disabled="authorizationBusy(todo.card.request)"
                @click="approveAuthorization(todo.card.request)"
              >
                批准
              </button>
              <button
                class="configuration-alert-action danger-action"
                type="button"
                :disabled="authorizationBusy(todo.card.request)"
                @click="rejectAuthorization(todo.card.request)"
              >
                拒绝
              </button>
            </template>
            <template v-else-if="todo.card.kind === 'review'">
              <template v-if="knowledgeReviewCanResolveWithDocument(todo.card.review)">
                <button
                  v-if="todo.card.review.reason === 'source_path_content_conflict'"
                  class="configuration-alert-action"
                  type="button"
                  :disabled="reviewBusy(todo.card.review)"
                  @click="replaceKnowledgeReview(todo.card.review)"
                >
                  覆盖旧知识
                </button>
                <button
                  class="configuration-alert-action"
                  type="button"
                  :disabled="reviewKeepBothDisabled(todo.card.review)"
                  @click="keepBothKnowledgeReview(todo.card.review)"
                >
                  保留两者
                </button>
                <button
                  class="configuration-alert-action"
                  type="button"
                  :disabled="reviewFusionDisabled(todo.card.review)"
                  @click="fuseKnowledgeReviewItem(todo.card.review)"
                >
                  知识融合
                </button>
              </template>
              <button
                v-else
                class="configuration-alert-action"
                type="button"
                :disabled="reviewBusy(todo.card.review)"
                @click="acceptKnowledgeReview(todo.card.review)"
              >
                接受
              </button>
              <button
                class="configuration-alert-action danger-action"
                type="button"
                :disabled="reviewBusy(todo.card.review)"
                @click="rejectKnowledgeReview(todo.card.review)"
              >
                放弃
              </button>
            </template>
          </div>
        </article>
      </div>
      <div v-else class="configuration-alert-empty dashboard-todo-empty">
        <strong>没有待办事项</strong>
        <span>当前角色没有需要处理的告警、配置或审批事项。</span>
      </div>
    </article>
  </section>
</template>
