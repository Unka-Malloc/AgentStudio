<script setup lang="ts">
import AgentModelOptionBar from "../../AgentModelOptionBar.vue";
import OptionBar from "../../OptionBar.vue";
import { useMaintenanceAgentViewContext } from "../../../composables/maintenanceAgentViewContext";

const {
  agentSelectorOptions,
  busyKey,
  canRunMaintenanceAgent,
  chatMaintenanceAgent,
  currentAgentModelOptionLabel,
  maintenanceAgentConfig,
  maintenanceAgentMessage,
  maintenanceAgentModelAlias,
  maintenanceAgentRunbook,
  maintenanceAgentRunbookOptionBarOptions,
  maintenanceAgentRunbooks,
  runMaintenanceAgentKnowledgeMaintenance,
  runMaintenanceAgentRunbook,
} = useMaintenanceAgentViewContext();
</script>

<template>
  <article class="surface-card maintenance-agent-grid">
    <section class="module-panel">
      <div class="module-panel-heading">
        <strong>对话入口</strong>
        <span>{{ maintenanceAgentConfig?.plannerMode || "fixed_runbook" }} · {{ currentAgentModelOptionLabel(maintenanceAgentModelAlias) || "默认智能体" }}</span>
      </div>
      <AgentModelOptionBar
        v-model="maintenanceAgentModelAlias"
        class="module-field"
        label="巡检智能体"
        include-empty
        :options="agentSelectorOptions"
      />
      <label class="json-editor">
        <span>指令</span>
        <textarea v-model="maintenanceAgentMessage" rows="4" />
      </label>
      <button
        class="tool-button"
        type="button"
        :disabled="!canRunMaintenanceAgent || busyKey === 'maintenance-agent:chat'"
        @click="chatMaintenanceAgent"
      >
        {{ busyKey === "maintenance-agent:chat" ? "执行中" : "发送" }}
      </button>
    </section>

    <section class="module-panel">
      <div class="module-panel-heading">
        <strong>Runbook</strong>
        <span>{{ maintenanceAgentRunbooks.length }}</span>
      </div>
      <OptionBar
        v-model="maintenanceAgentRunbook"
        class="module-field"
        label="选择"
        :options="maintenanceAgentRunbookOptionBarOptions"
      />
      <button
        class="tool-button"
        type="button"
        :disabled="!canRunMaintenanceAgent || busyKey === 'maintenance-agent:run'"
        @click="runMaintenanceAgentRunbook"
      >
        {{ busyKey === "maintenance-agent:run" ? "执行中" : "运行" }}
      </button>
      <div class="maintenance-agent-quick-actions">
        <button
          class="tool-button tool-button-ghost"
          type="button"
          :disabled="!canRunMaintenanceAgent || busyKey === 'maintenance-agent:run'"
          @click="runMaintenanceAgentKnowledgeMaintenance"
        >
          知识库维护巡检
        </button>
        <small class="field-hint">
          知识库维护任务已收敛到智能巡检，运行后进入记录、审批和审计链路。
        </small>
      </div>
    </section>
  </article>
</template>
