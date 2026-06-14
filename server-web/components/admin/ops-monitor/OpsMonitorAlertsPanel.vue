<script setup lang="ts">
import ConfigFoldCard from "../../ConfigFoldCard.vue";
import StatusPill from "../../StatusPill.vue";
import { useOpsMonitorViewContext } from "../../../composables/opsMonitorViewContext";

const {
  acknowledgeMonitorAlert,
  busyKey,
  canAdminMaintenanceAgent,
  formatCompactDate,
  monitorAlertConfigText,
  monitorAlertDetailBullets,
  monitorAlertHistoryRows,
  monitorAlertMergeKey,
  monitorAlertSeverityLabel,
  monitorAlertSeverityTone,
  monitorAlertState,
  monitorAlertSummary,
  saveMonitorAlertConfig,
  shouldIncludeMonitorAlertLifecycle,
  visibleMonitorAlerts,
} = useOpsMonitorViewContext();
</script>

<template>
  <article class="surface-card" style="display: flex; flex-direction: column; gap: 16px;">
    <div class="section-header">
      <div>
        <h3>监控报警</h3>
      </div>
      <div class="section-tags">
        <span>{{ monitorAlertState?.status || "未读取" }}</span>
        <span>可见 {{ visibleMonitorAlerts.length }}</span>
        <span>严重 {{ monitorAlertSummary.criticalCount }}</span>
        <span>历史 {{ monitorAlertHistoryRows.length }}</span>
      </div>
    </div>
    <div class="job-table compact-job-table monitor-alert-table monitor-alert-active-table">
      <div class="job-table-header">
        <span>级别</span>
        <span>报警</span>
        <span>状态</span>
      </div>
      <div
        v-for="alert in visibleMonitorAlerts"
        :key="monitorAlertMergeKey(alert)"
        class="job-row"
      >
        <StatusPill
          class="monitor-alert-severity-pill"
          :tone="monitorAlertSeverityTone(alert.severity)"
          :label="monitorAlertSeverityLabel(alert.severity)"
        />
        <div class="monitor-alert-detail">
          <strong>{{ alert.title }}</strong>
          <ul class="monitor-alert-detail-list">
            <li
              v-for="(bullet, bulletIndex) in monitorAlertDetailBullets(alert, shouldIncludeMonitorAlertLifecycle(alert))"
              :key="`${alert.alertId}:${bullet.label}:${bulletIndex}`"
            >
              <span>{{ bullet.label }}：</span>
              <span>{{ bullet.text }}</span>
            </li>
          </ul>
        </div>
        <span>
          {{ formatCompactDate(alert.recoveredAt || alert.lastSeenAt || alert.firstSeenAt) }}
          <button
            v-if="alert.ackRequired && !alert.acknowledgedAt"
            class="tool-button tool-button-ghost"
            type="button"
            :disabled="busyKey === `monitor-alert:ack:${alert.alertId}`"
            @click="acknowledgeMonitorAlert(alert.alertId)"
          >
            {{ busyKey === `monitor-alert:ack:${alert.alertId}` ? "确认中" : "确认关闭" }}
          </button>
        </span>
      </div>
    </div>
    <div v-if="visibleMonitorAlerts.length === 0" class="empty-state">
      <strong>暂无当前报警</strong>
    </div>
    <ConfigFoldCard
      title="历史记录"
      :subtitle="`${monitorAlertHistoryRows.length} 条`"
      open
    >
      <div class="job-table compact-job-table monitor-alert-table monitor-alert-history-table">
        <div class="job-table-header">
          <span>级别</span>
          <span>报警</span>
          <span>状态</span>
        </div>
        <div
          v-for="alert in monitorAlertHistoryRows"
          :key="monitorAlertMergeKey(alert)"
          class="job-row"
        >
          <StatusPill
            class="monitor-alert-severity-pill"
            :tone="monitorAlertSeverityTone(alert.severity)"
            :label="monitorAlertSeverityLabel(alert.severity)"
          />
          <div class="monitor-alert-detail">
            <strong>{{ alert.title }}</strong>
            <ul class="monitor-alert-detail-list">
              <li
                v-for="(bullet, bulletIndex) in monitorAlertDetailBullets(alert, shouldIncludeMonitorAlertLifecycle(alert))"
                :key="`${alert.alertId}:${bullet.label}:${bulletIndex}`"
              >
                <span>{{ bullet.label }}：</span>
                <span>{{ bullet.text }}</span>
              </li>
            </ul>
          </div>
          <span>
            {{ formatCompactDate(alert.recoveredAt || alert.lastSeenAt || alert.firstSeenAt) }}
            <button
              v-if="alert.ackRequired && !alert.acknowledgedAt"
              class="tool-button tool-button-ghost"
              type="button"
              :disabled="busyKey === `monitor-alert:ack:${alert.alertId}`"
              @click="acknowledgeMonitorAlert(alert.alertId)"
            >
              {{ busyKey === `monitor-alert:ack:${alert.alertId}` ? "确认中" : "确认关闭" }}
            </button>
          </span>
        </div>
      </div>
      <div v-if="monitorAlertHistoryRows.length === 0" class="empty-state">
        <strong>暂无历史记录</strong>
      </div>
    </ConfigFoldCard>
    <ConfigFoldCard title="报警报文配置 JSON" open>
      <div class="monitor-alert-config-editor json-editor">
        <textarea
          v-model="monitorAlertConfigText"
          rows="14"
          spellcheck="false"
          aria-label="报警报文配置 JSON"
        />
        <div class="monitor-alert-config-actions">
          <button
            class="primary-action"
            type="button"
            :disabled="!canAdminMaintenanceAgent || busyKey === 'monitor-alerts:save'"
            @click="saveMonitorAlertConfig"
          >
            {{ busyKey === "monitor-alerts:save" ? "保存中" : "保存报警配置" }}
          </button>
        </div>
      </div>
    </ConfigFoldCard>
  </article>
</template>
