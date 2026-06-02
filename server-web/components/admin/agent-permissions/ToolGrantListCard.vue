<script setup lang="ts">
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import { toolsetLabel } from "../../../composables/console-tool-display-utils";
import FeatureToggle from "../../FeatureToggle.vue";
import ScopeSelector from "../../ScopeSelector.vue";

const {
  busyKey,
  deleteGrant,
  enabledToolGrantCount,
  formatCompactDate,
  grantHasToolset,
  rotateGrant,
  toggleGrantToolset,
  toolGrants,
  toolManagementToolsets,
  toolScopes,
  updateGrant,
} = useAgentPermissionsViewContext();

function grantToolsetLabel(toolsetId: string) {
  return toolsetLabel(toolsetId, toolManagementToolsets.value);
}
</script>

<template>
  <article class="surface-card permission-list-card">
    <div class="section-header">
      <div>
        <h3>授权列表</h3>
      </div>
      <div class="section-tags">
        <span>启用 {{ enabledToolGrantCount }}</span>
        <span>总计 {{ toolGrants.length }}</span>
      </div>
    </div>

    <div class="permission-list" v-if="toolGrants.length > 0">
      <article
        v-for="grant in toolGrants"
        :key="grant.id"
        class="permission-card"
        :data-enabled="grant.enabled"
      >
        <div class="permission-card-main">
          <label class="module-field">
            <span>名称</span>
            <input v-model="grant.label" autocomplete="off" @change="updateGrant(grant, { label: grant.label })" />
          </label>
          <dl class="module-status-list">
            <div>
              <dt>令牌</dt>
              <dd>{{ grant.tokenPrefix || "未生成" }}</dd>
            </div>
            <div>
              <dt>最近使用</dt>
              <dd>{{ grant.lastUsedAt ? formatCompactDate(grant.lastUsedAt) : "未使用" }}</dd>
            </div>
            <div>
              <dt>工具集</dt>
              <dd>{{ (grant.toolsets || []).map(grantToolsetLabel).join(" / ") || "未声明" }}</dd>
            </div>
          </dl>
        </div>

        <div class="permission-card-controls">
          <ScopeSelector
            :model-value="grant.scopes"
            :scopes="toolScopes"
            :disabled="busyKey === `grant:${grant.id}`"
            @update:model-value="(v) => updateGrant(grant, { scopes: v })"
            compact
          />
          <div class="scope-grid compact-scope-grid">
            <button
              v-for="toolset in toolManagementToolsets.filter((item) => item.grantable !== false)"
              :key="toolset.id"
              class="scope-chip"
              :class="{ active: grantHasToolset(grant, toolset.id) }"
              type="button"
              :disabled="busyKey === `grant:${grant.id}`"
              @click="toggleGrantToolset(grant, toolset.id)"
            >
              <strong>{{ toolset.label }}</strong>
            </button>
          </div>
          <div class="permission-actions">
            <FeatureToggle
              :model-value="grant.enabled"
              on-label="授权已启用"
              off-label="授权已停用"
              :aria-label="grant.enabled ? '停用授权' : '启用授权'"
              :disabled="busyKey === `grant:${grant.id}`"
              @update:model-value="updateGrant(grant, { enabled: $event })"
            />
            <button class="table-action" type="button" :disabled="busyKey === `grant:${grant.id}`" @click="rotateGrant(grant)">
              轮换
            </button>
            <button class="table-action danger-action" type="button" :disabled="busyKey === `grant:${grant.id}`" @click="deleteGrant(grant)">
              撤销
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <strong>暂无工具授权</strong>
      <span>创建授权后，智能体才能调用受限工具入口。</span>
    </div>
  </article>
</template>
