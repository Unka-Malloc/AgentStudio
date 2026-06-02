<script setup lang="ts">
import { useAgentPermissionsViewContext } from "../../../composables/agentPermissionsViewContext";
import { toolRiskLabel } from "../../../composables/console-tool-display-utils";
import ScopeSelector from "../../ScopeSelector.vue";

const {
  busyKey,
  copyIssuedToolToken,
  createGrant,
  issuedToolToken,
  newGrantLabel,
  newGrantScopes,
  newGrantToolsets,
  toggleNewGrantToolset,
  toolManagementToolsets,
  toolScopes,
} = useAgentPermissionsViewContext();
</script>

<template>
  <article class="surface-card permission-create-card">
    <div class="section-header">
      <div>
        <h3>网关工具授权</h3>
        <p>所有工具令牌、授权范围和撤销操作都在权限组页集中维护。</p>
      </div>
    </div>

    <form class="permission-form" @submit.prevent="createGrant">
      <label class="module-field">
        <span>授权名称</span>
        <input v-model="newGrantLabel" autocomplete="off" />
      </label>

      <ScopeSelector
        v-model="newGrantScopes"
        :scopes="toolScopes"
      />
      <div class="scope-grid">
        <button
          v-for="toolset in toolManagementToolsets.filter((item) => item.grantable !== false)"
          :key="toolset.id"
          class="scope-chip"
          :class="{ active: newGrantToolsets.includes(toolset.id) }"
          type="button"
          @click="toggleNewGrantToolset(toolset.id)"
        >
          <strong>{{ toolset.label }}</strong>
          <span>{{ toolRiskLabel(toolset.maxRisk) }}</span>
        </button>
      </div>

      <button class="tool-button" type="submit" :disabled="busyKey === 'grant:create'">
        {{ busyKey === "grant:create" ? "创建中" : "创建授权" }}
      </button>
    </form>

    <div v-if="issuedToolToken" class="token-panel">
      <div>
        <strong>新令牌只显示一次</strong>
        <p>{{ issuedToolToken }}</p>
      </div>
      <button class="tool-button tool-button-ghost" type="button" @click="copyIssuedToolToken">
        复制
      </button>
    </div>
  </article>
</template>
