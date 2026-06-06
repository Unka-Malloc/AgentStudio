<script setup lang="ts">
import { useWorkspacesViewContext } from "../../../composables/workspacesViewContext";

const {
  busyKey,
  hotSwapProfile,
  panel,
  profileForm,
  selected,
} = useWorkspacesViewContext();
</script>

<template>
  <div v-if="selected" class="surface-card drawer-panel">
    <div class="panel-header">
      <h4>热切换 Profile — {{ selected.title }}</h4>
      <p>
        修改后立即生效（Generation 自动递增）。已在运行中的智能体保持旧配置直至本次任务结束，
        新任务将使用更新后的配置。
      </p>
    </div>
    <div class="form-grid">
      <label><span>上下文 Profile ID</span><input v-model="profileForm.contextProfileId" autocomplete="off" placeholder="balanced / context-32k / context-128k 等" /></label>
      <label><span>工具 Grant ID</span><input v-model="profileForm.toolGrantId" autocomplete="off" /></label>
      <label><span>模型别名（agentId）</span><input v-model="profileForm.modelAlias" autocomplete="off" /></label>
      <label>
        <span>自有知识源 IDs（逗号分隔，完整替换）</span>
        <input v-model="profileForm.ownedSourceIds" autocomplete="off" placeholder="source_abc, source_def" />
      </label>
      <label>
        <span>额外包含来源 IDs（在继承基础上增加）</span>
        <input v-model="profileForm.includeSourceIds" autocomplete="off" />
      </label>
      <label>
        <span>排除来源 IDs（从继承结果中剔除）</span>
        <input v-model="profileForm.excludeSourceIds" autocomplete="off" />
      </label>
    </div>
    <div class="module-actions">
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="hotSwapProfile">
        {{ busyKey === 'ws:profile' ? '切换中…' : '热切换 Profile' }}
      </button>
      <button class="tool-button tool-button-ghost" type="button" @click="panel = 'list'">取消</button>
    </div>
  </div>
</template>
