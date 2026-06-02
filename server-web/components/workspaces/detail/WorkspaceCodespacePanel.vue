<script setup lang="ts">
import OptionBar from "../../OptionBar.vue";
import { useWorkspacesViewContext } from "../../../composables/workspacesViewContext";

const {
  busyKey,
  codespaceForm,
  codespaceResult,
  inspectCodespaceStatus,
  panel,
  prepareCodespaceChange,
  selected,
  uploadCodespaceChange,
} = useWorkspacesViewContext();
</script>

<template>
  <div v-if="selected" class="surface-card drawer-panel">
    <div class="panel-header">
      <h4>代码库 — {{ selected.title }}</h4>
      <p>Codespace 统一封装 RepositoryPort 和 ReviewPort；外部凭据只显示 secretRef。</p>
    </div>
    <div class="form-grid">
      <OptionBar
        v-model="codespaceForm.provider"
        label="Provider"
        :options="[{ value: 'github', label: 'GitHub' }, { value: 'gerrit', label: 'Gerrit' }]"
      />
      <label><span>本机 repoId / worktreePath</span><input v-model="codespaceForm.repoId" autocomplete="off" placeholder="/path/to/project" /></label>
      <label><span>Repository Ref</span><input v-model="codespaceForm.repositoryRef" autocomplete="off" placeholder="owner/repo 或 gerrit/project" /></label>
      <label><span>Branch</span><input v-model="codespaceForm.branch" autocomplete="off" placeholder="main" /></label>
      <label><span>Diff Base</span><input v-model="codespaceForm.baseRef" autocomplete="off" /></label>
      <label><span>Diff Head</span><input v-model="codespaceForm.headRef" autocomplete="off" /></label>
    </div>
    <label class="module-field-block">
      <span>ChangeSet Diff</span>
      <textarea v-model="codespaceForm.diff" rows="5" spellcheck="false"></textarea>
    </label>
    <div class="module-actions">
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="inspectCodespaceStatus">
        {{ busyKey === 'ws:codespace-status' ? '读取中…' : '读取状态' }}
      </button>
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="prepareCodespaceChange">
        {{ busyKey === 'ws:codespace-prepare' ? '准备中…' : '准备 ChangeSet' }}
      </button>
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="uploadCodespaceChange">
        {{ busyKey === 'ws:codespace-upload' ? '验证中…' : '上传预检' }}
      </button>
      <button class="tool-button tool-button-ghost" type="button" @click="panel = 'list'">取消</button>
    </div>
    <pre v-if="codespaceResult" class="config-json-preview workspace-codespace-result">{{ JSON.stringify(codespaceResult, null, 2) }}</pre>
  </div>
</template>
