<script setup lang="ts">
import OptionBar from "../../OptionBar.vue";
import { useWorkspacesViewContext } from "../../../composables/workspacesViewContext";

const {
  backfillWorkspaceAssets,
  busyKey,
  loadWorkspaceAssetReceipts,
  panel,
  refreshWorkspaceAssets,
  selectWorkspaceAsset,
  selected,
  selectedWorkspaceAsset,
  submitWorkspaceAsset,
  workspaceAssetForm,
  workspaceAssetItems,
  workspaceAssetResult,
} = useWorkspacesViewContext();
</script>

<template>
  <div v-if="selected" class="surface-card drawer-panel workspace-asset-panel">
    <div class="panel-header">
      <h4>统一资产 — {{ selected.title }}</h4>
    </div>

    <div class="asset-workbench-grid">
      <section class="asset-workbench-column">
        <div class="section-header compact">
          <h5>资产目录</h5>
          <button class="table-action" type="button" :disabled="!!busyKey" @click="refreshWorkspaceAssets">
            {{ busyKey === 'ws:assets-list' ? '刷新中…' : '刷新' }}
          </button>
        </div>
        <div class="form-grid compact-grid">
          <OptionBar
            v-model="workspaceAssetForm.targetKind"
            label="Target"
            :options="[
              { value: 'workspaceFolder', label: 'Workspace' },
              { value: 'localDirectory', label: 'Local' },
              { value: 'cloudDrive', label: 'Cloud' },
              { value: 'repository', label: 'Repo' },
              { value: 'codeReview', label: 'Review' },
              { value: 'workspaceContribution', label: 'Contribution' },
            ]"
          />
          <OptionBar
            v-model="workspaceAssetForm.assetKind"
            label="Kind"
            :options="[
              { value: 'file', label: 'File' },
              { value: 'codeChange', label: 'CodeChange' },
              { value: 'workspaceContribution', label: 'Contribution' },
            ]"
          />
        </div>
        <div class="asset-list">
          <button
            v-for="asset in workspaceAssetItems"
            :key="asset.assetRef"
            class="asset-row"
            type="button"
            :class="{ selected: workspaceAssetForm.assetRef === asset.assetRef }"
            @click="selectWorkspaceAsset(asset.assetRef)"
          >
            <span class="asset-row-title">{{ asset.displayName || asset.assetRef }}</span>
            <span>{{ asset.assetKind }} · {{ asset.canonicalState }}</span>
            <code>{{ asset.assetRef }}</code>
          </button>
          <div v-if="workspaceAssetItems.length === 0" class="empty-state compact-empty">
            <strong>暂无登记资产</strong>
          </div>
        </div>
      </section>

      <section class="asset-workbench-column">
        <div class="section-header compact">
          <h5>提交</h5>
          <button class="table-action" type="button" :disabled="!!busyKey" @click="backfillWorkspaceAssets">
            {{ busyKey === 'ws:asset-backfill' ? 'Backfill…' : 'Backfill' }}
          </button>
        </div>
        <div class="form-grid">
          <label><span>Path</span><input v-model="workspaceAssetForm.path" autocomplete="off" /></label>
          <label><span>Provider</span><input v-model="workspaceAssetForm.provider" autocomplete="off" /></label>
          <label><span>Drive Ref</span><input v-model="workspaceAssetForm.driveRef" autocomplete="off" /></label>
          <label><span>Repository</span><input v-model="workspaceAssetForm.repositoryRef" autocomplete="off" /></label>
          <label><span>Branch</span><input v-model="workspaceAssetForm.branch" autocomplete="off" /></label>
        </div>
        <label class="module-field-block">
          <span>Content</span>
          <textarea v-model="workspaceAssetForm.content" rows="5" spellcheck="false"></textarea>
        </label>
        <div class="module-actions">
          <button class="tool-button" type="button" :disabled="!!busyKey" @click="submitWorkspaceAsset">
            {{ busyKey === 'ws:asset-submit' ? '提交中…' : '提交资产' }}
          </button>
          <button class="tool-button tool-button-ghost" type="button" :disabled="!workspaceAssetForm.assetRef || !!busyKey" @click="loadWorkspaceAssetReceipts">
            {{ busyKey === 'ws:asset-receipts' ? '读取中…' : 'Receipt' }}
          </button>
          <button class="tool-button tool-button-ghost" type="button" @click="panel = 'list'">关闭</button>
        </div>
      </section>
    </div>

    <div v-if="selectedWorkspaceAsset" class="asset-detail">
      <div class="section-header compact">
        <h5>{{ selectedWorkspaceAsset.displayName || selectedWorkspaceAsset.assetRef }}</h5>
        <span class="module-note">{{ selectedWorkspaceAsset.assetKind }} · {{ selectedWorkspaceAsset.canonicalState }}</span>
      </div>
      <dl class="meta-list">
        <div><dt>Asset Ref</dt><dd><code>{{ selectedWorkspaceAsset.assetRef }}</code></dd></div>
        <div><dt>Revision</dt><dd><code>{{ selectedWorkspaceAsset.currentRevisionRef }}</code></dd></div>
        <div><dt>Data Class</dt><dd>{{ selectedWorkspaceAsset.dataClass }}</dd></div>
        <div><dt>Updated</dt><dd>{{ selectedWorkspaceAsset.updatedAt }}</dd></div>
      </dl>
      <pre class="config-json-preview">{{ JSON.stringify({
        revisions: selectedWorkspaceAsset.revisions,
        projections: selectedWorkspaceAsset.projections,
        receipts: selectedWorkspaceAsset.receipts,
        lineageLinks: selectedWorkspaceAsset.lineageLinks,
      }, null, 2) }}</pre>
    </div>

    <pre v-if="workspaceAssetResult" class="config-json-preview workspace-asset-result">{{ JSON.stringify(workspaceAssetResult, null, 2) }}</pre>
  </div>
</template>

<style scoped>
.workspace-asset-panel {
  gap: var(--space-4);
}
.asset-workbench-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.1fr);
  gap: var(--space-4);
}
@media (max-width: 980px) {
  .asset-workbench-grid {
    grid-template-columns: 1fr;
  }
}
.asset-workbench-column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}
.section-header.compact {
  align-items: center;
  margin-bottom: 0;
}
.section-header.compact h5 {
  margin: 0;
  font-size: var(--text-base);
}
.compact-grid {
  grid-template-columns: 1fr;
}
.asset-list {
  display: flex;
  max-height: 360px;
  min-height: 120px;
  flex-direction: column;
  gap: var(--space-2);
  overflow: auto;
}
.asset-row {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-s);
  background: var(--bg-surface);
  color: var(--text-primary);
  text-align: left;
}
.asset-row:hover,
.asset-row.selected {
  border-color: var(--accent);
  background: var(--accent-surface);
}
.asset-row-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.asset-row span:not(.asset-row-title) {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.asset-row code,
.asset-detail code {
  overflow-wrap: anywhere;
}
.compact-empty {
  min-height: 100px;
}
.asset-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.workspace-asset-result {
  max-height: 320px;
}
</style>
