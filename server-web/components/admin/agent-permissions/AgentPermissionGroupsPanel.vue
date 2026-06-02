<script setup lang="ts">
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import AgentPermissionGroupCard from "./AgentPermissionGroupCard.vue";

const {
  addAgentPermissionGroup,
  busyKey,
  ensureAgentPermissionGroupsDraft,
  saveAgentPermissionSettings,
  settingsDraft,
  toolManagementTools,
  toolManagementToolsets,
  toolScopes,
} = useAgentPermissionsViewContext();
</script>

<template>
  <article class="surface-card">
    <div class="section-header">
      <div>
        <h3>权限组</h3>
        <p>权限组是全系统权限配置入口；团队策略、用户策略、智能体绑定、工具授权和单工具例外只在这里维护。</p>
      </div>
      <div class="source-actions">
        <button class="tool-button tool-button-ghost" type="button" @click="ensureAgentPermissionGroupsDraft">
          生成默认组
        </button>
        <button class="tool-button tool-button-ghost" type="button" @click="addAgentPermissionGroup">
          新增权限组
        </button>
        <button class="tool-button" type="button" :disabled="busyKey === 'agent-permissions-save'" @click="saveAgentPermissionSettings">
          {{ busyKey === "agent-permissions-save" ? "保存中" : "保存权限组" }}
        </button>
      </div>
    </div>
    <div class="detail-metrics knowledge-metrics">
      <div>
        <span>权限层级</span>
        <strong>{{ toolScopes.length }}</strong>
      </div>
      <div>
        <span>工具集</span>
        <strong>{{ toolManagementToolsets.length }}</strong>
      </div>
      <div>
        <span>工具</span>
        <strong>{{ toolManagementTools.length }}</strong>
      </div>
      <div>
        <span>预设组</span>
        <strong>{{ settingsDraft.agentPermissionGroups.length }}</strong>
      </div>
    </div>
  </article>

  <AgentPermissionGroupCard
    v-for="group in settingsDraft.agentPermissionGroups"
    :key="group.id"
    :group="group"
  />
  <div v-if="settingsDraft.agentPermissionGroups.length === 0" class="empty-state">
    <strong>暂无权限组</strong>
    <span>先生成默认组或新增自定义权限组。</span>
  </div>
</template>
