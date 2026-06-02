<script setup lang="ts">
import BinaryCheckbox from "../../BinaryCheckbox.vue";
import { useWorkspacesViewContext } from "../../../composables/workspacesViewContext";

const {
  busyKey,
  connectLocalDirectory,
  localDirForm,
  localDirMountData,
  panel,
  selected,
  syncLocalDirectory,
} = useWorkspacesViewContext();
</script>

<template>
  <div v-if="selected" class="surface-card drawer-panel">
    <div class="panel-header">
      <h4>本机目录 — {{ selected.title }}</h4>
      <p>连接后配置写入服务端数据目录，后续同步通过 mountRef 执行。</p>
    </div>
    <div class="form-grid">
      <label><span>本机目录路径 *</span><input v-model="localDirForm.sourcePath" autocomplete="off" placeholder="/path/to/workspace-folder" /></label>
      <label><span>工作空间目标路径</span><input v-model="localDirForm.targetPath" autocomplete="off" placeholder="mirror" /></label>
      <label><span>文件上限</span><input v-model.number="localDirForm.maxFiles" type="number" min="1" max="10000" /></label>
      <BinaryCheckbox v-model="localDirForm.deleteExtraneous" label="同步时清理目标中的多余文件" />
    </div>
    <div class="module-actions">
      <button class="tool-button" type="button" :disabled="!localDirForm.sourcePath.trim() || !!busyKey" @click="connectLocalDirectory">
        {{ busyKey === 'ws:local-dir-connect' ? '连接中…' : '连接目录' }}
      </button>
      <button class="tool-button tool-button-ghost" type="button" @click="panel = 'list'">取消</button>
    </div>
    <div v-if="localDirMountData?.mounts?.length" class="module-panel workspace-mount-list">
      <div class="module-panel-heading">
        <strong>已连接 mount</strong>
        <span>{{ localDirMountData.mounts.length }} 个</span>
      </div>
      <div class="ws-id-list">
        <div v-for="mount in localDirMountData.mounts" :key="mount.mountRef" class="ws-chain-item workspace-mount-row">
          <code>{{ mount.mountRef.slice(0, 22) }}</code>
          <span>{{ mount.sourceRootName }} -> {{ mount.targetPath || '根目录' }}</span>
          <button class="table-action" type="button" :disabled="!!busyKey" @click="syncLocalDirectory(mount)">
            {{ busyKey === `ws:local-dir-sync:${mount.mountRef}` ? '同步中…' : '同步' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
