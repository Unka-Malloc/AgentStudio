<script setup lang="ts">
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";

const {
  busyKey,
  grantToolRuleState,
  handleSelectedToolChange,
  selectedToolManagementTool,
  setGrantToolRule,
  toolGrants,
  toolManagementTools,
} = useAgentPermissionsViewContext();
</script>

<template>
  <article class="surface-card permission-list-card">
    <div class="section-header">
      <div>
        <h3>授权工具例外</h3>
        <p>按工具调整网关授权的允许或未启用规则。</p>
      </div>
      <label class="module-field compact-select-field">
        <span>工具</span>
        <select :value="selectedToolManagementTool?.id || ''" @change="handleSelectedToolChange">
          <option
            v-for="tool in toolManagementTools"
            :key="tool.id"
            :value="tool.id"
          >
            {{ tool.label }}
          </option>
        </select>
      </label>
    </div>
    <div v-if="selectedToolManagementTool" class="job-table compact-job-table grant-tool-rule-table">
      <div class="job-table-header">
        <span>授权</span>
        <span>当前规则</span>
        <span>操作</span>
      </div>
      <div
        v-for="grant in toolGrants"
        :key="`${grant.id}:${selectedToolManagementTool.id}`"
        class="job-row"
      >
        <span>
          <strong>{{ grant.label }}</strong>
          <small>{{ grant.id }}</small>
        </span>
        <span>{{ grantToolRuleState(grant, selectedToolManagementTool.id) }}</span>
        <span class="permission-actions">
          <button
            class="table-action"
            type="button"
            :disabled="busyKey === `grant:${grant.id}`"
            @click="setGrantToolRule(grant, selectedToolManagementTool.id, 'inherit')"
          >
            继承
          </button>
          <button
            class="table-action"
            type="button"
            :disabled="busyKey === `grant:${grant.id}`"
            @click="setGrantToolRule(grant, selectedToolManagementTool.id, 'allow')"
          >
            允许
          </button>
          <button
            class="table-action danger-action"
            type="button"
            :disabled="busyKey === `grant:${grant.id}`"
            @click="setGrantToolRule(grant, selectedToolManagementTool.id, 'deny')"
          >
            未启用
          </button>
        </span>
      </div>
    </div>
    <div v-if="toolGrants.length === 0" class="empty-state">
      <strong>暂无授权</strong>
    </div>
  </article>
</template>
