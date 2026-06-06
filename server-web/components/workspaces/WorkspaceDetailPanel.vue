<script setup lang="ts">
import WorkspaceCloudDrivePanel from "./WorkspaceCloudDrivePanel.vue";
import WorkspaceExpandedDetail from "./WorkspaceExpandedDetail.vue";
import WorkspaceCodespacePanel from "./detail/WorkspaceCodespacePanel.vue";
import WorkspaceCreatePanel from "./detail/WorkspaceCreatePanel.vue";
import WorkspaceLocalDirectoryPanel from "./detail/WorkspaceLocalDirectoryPanel.vue";
import WorkspaceParentPanel from "./detail/WorkspaceParentPanel.vue";
import WorkspaceProfilePanel from "./detail/WorkspaceProfilePanel.vue";
import WorkspaceSharePanel from "./detail/WorkspaceSharePanel.vue";
import { useWorkspacesViewContext } from "../../composables/workspacesViewContext";

const {
  expandedWorkspaceId,
  panel,
  selected,
} = useWorkspacesViewContext();
</script>

<template>
  <div
    v-if="panel !== 'list' || (selected && expandedWorkspaceId === selected.workspaceId)"
    class="ws-detail"
  >
    <WorkspaceCreatePanel v-if="panel === 'create'" />
    <WorkspaceProfilePanel v-else-if="panel === 'profile' && selected" />
    <WorkspaceParentPanel v-else-if="panel === 'parent' && selected" />
    <WorkspaceSharePanel v-else-if="panel === 'share' && selected" />
    <WorkspaceLocalDirectoryPanel v-else-if="panel === 'localDir' && selected" />
    <WorkspaceCloudDrivePanel v-else-if="panel === 'cloudDrive' && selected" />
    <WorkspaceCodespacePanel v-else-if="panel === 'codespace' && selected" />
    <WorkspaceExpandedDetail v-else-if="panel === 'list' && selected && expandedWorkspaceId === selected.workspaceId" />
    <div v-else class="empty-state">
      <strong>从左侧选择一个工作空间</strong>
      <span>或点击"新建工作空间"。</span>
    </div>
  </div>
</template>

<style>
.ws-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow: auto;
}

.ws-layout.ws-layout-expanded-cards .ws-detail {
  min-height: 0;
  overflow: visible;
}

.ws-detail .ws-id-list {
  list-style: none;
  padding: 0;
  margin: var(--space-1) 0;
  font-size: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.ws-detail .ws-id-list li,
.ws-detail .ws-chain-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.ws-detail .ws-id-list code {
  background: var(--bg-subtle);
  padding: 1px 6px;
  border-radius: 4px;
}

.ws-detail .module-field-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

.ws-detail .module-field-block textarea {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  font-family: var(--font-mono);
}

.ws-detail .workspace-mount-list,
.ws-detail .workspace-codespace-result {
  margin-top: var(--space-4);
}

.ws-detail .workspace-mount-row {
  justify-content: space-between;
}

.ws-detail .config-json-preview {
  font-size: 0.78rem;
  line-height: 1.5;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-s);
  padding: var(--space-3);
  overflow: auto;
  max-height: 240px;
  white-space: pre;
}
</style>
