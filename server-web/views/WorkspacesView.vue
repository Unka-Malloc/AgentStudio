<script setup lang="ts">
import { onMounted } from 'vue';
import BinaryCheckbox from '../components/BinaryCheckbox.vue';
import StatusPill from '../components/StatusPill.vue';
import SplitToggleCard from '../components/SplitToggleCard.vue';
import WorkspaceDetailPanel from '../components/workspaces/WorkspaceDetailPanel.vue';
import { provideWorkspacesView } from '../composables/workspacesViewContext';
import { useServerConsoleShellContext } from '../composables/serverConsoleShellContext';
import {
  workspaceKnowledgeContextContract,
  workspaceKnowledgeContextSignature,
} from '../lib/workspaces-client';

const { workspacesConsole: workspacesView } = useServerConsoleShellContext();
provideWorkspacesView(workspacesView);

const {
  formatCompactDate,
  workspaces,
  selectedId,
  localError,
  panel,
  shareForm,
  showDeleteModal,
  deleteFolderChecked,
  selected,
  workspaceExpansionSlotId,
  isWorkspaceExpanded,
  toggleWorkspaceCard,
  statusTone,
  copyToClipboard,
  deleteWorkspace,
  openProfile,
  openParent,
  openLocalDir,
  openCloudDrive,
  openCodespace,
} = workspacesView;

onMounted(() => {
  void workspacesView.load();
});

const workspaceKnowledgeContextFields = {
  knowledgeScope: workspaceKnowledgeContextContract.profileScopeField,
  knowledgeSourceIds: workspaceKnowledgeContextContract.sourceIdsField,
  knowledgeSessionId: workspaceKnowledgeContextContract.sessionLinkField,
};

</script>

<template>
  <section
    class="workspaces-view"
    :data-workspace-knowledge-context="workspaceKnowledgeContextSignature"
    :data-knowledge-scope="workspaceKnowledgeContextFields.knowledgeScope"
    :data-knowledge-source-ids="workspaceKnowledgeContextFields.knowledgeSourceIds"
    :data-agent-session-id="workspaceKnowledgeContextFields.knowledgeSessionId"
    :data-workspace-endpoint="workspaceKnowledgeContextContract.workspaceEndpoint"
    :data-workspace-context-endpoint="workspaceKnowledgeContextContract.contextEndpoint"
    :data-workspace-sessions-endpoint="workspaceKnowledgeContextContract.sessionsEndpoint"
    :data-workspace-fork-label="workspaceKnowledgeContextContract.forkActionLabel"
  >
    <div v-if="localError" class="status-strip danger">
      <strong>错误</strong><span>{{ localError }}</span>
      <button class="status-strip-action" type="button" @click="localError = ''">关闭</button>
    </div>

    <!-- ─── Toolbar ──────────────────────────────────────────────────── -->
    <div class="ws-toolbar">
      <h2 class="ws-toolbar-title">智能体工作空间</h2>
      <div class="ws-toolbar-actions">
        <button class="tool-button" type="button" @click="panel = 'create'">新建工作空间</button>
      </div>
    </div>

    <!-- ─── Two-column layout ────────────────────────────────────────── -->
    <div class="ws-layout" :class="{ 'ws-layout-expanded-cards': panel === 'list' }">

      <!-- List column -->
      <div class="ws-list">
        <div v-if="workspaces.length === 0" class="empty-state">
          <strong>暂无工作空间</strong>
          <span>点击"新建工作空间"创建第一个工作空间。</span>
        </div>
        <SplitToggleCard
          v-for="ws in workspaces"
          :key="ws.workspaceId"
          :id="`workspace-${ws.workspaceId}`"
          as="article"
          class="ws-card"
          :class="{ selected: selectedId === ws.workspaceId, expanded: isWorkspaceExpanded(ws) }"
          :expanded="isWorkspaceExpanded(ws)"
          :expanded-label="`收起 ${ws.title || ws.workspaceId.slice(0, 12)} 工作空间详情`"
          :collapsed-label="`展开 ${ws.title || ws.workspaceId.slice(0, 12)} 工作空间详情`"
          @toggle="toggleWorkspaceCard(ws)"
        >
          <template #summary>
            <div class="ws-card-summary">
              <div class="section-header ws-card-summary-header">
                <div class="ws-card-heading">
                  <div class="ws-card-title-row">
                    <h3>{{ ws.title || ws.workspaceId.slice(0, 12) }}</h3>
                    <span v-if="ws.parentWorkspaceId" class="ws-inherited-badge">↳ 继承</span>
                  </div>
                  <p v-if="ws.objective" class="module-note">{{ ws.objective }}</p>
                </div>
                <div class="workspace-status-row">
                  <StatusPill :tone="statusTone(ws.status)" :label="ws.status" />
                </div>
              </div>

              <dl class="meta-list ws-card-meta-list">
                <div>
                  <dt>工作空间 ID</dt>
                  <dd>
                    <div
                      class="ws-copyable-wrapper"
                      data-split-toggle-ignore
                      :data-pact-tooltip="ws.workspaceId"
                      @click.stop="copyToClipboard($event, ws.workspaceId)"
                    >
                      <code class="ws-copyable-code">{{ ws.workspaceId }}</code>
                    </div>
                  </dd>
                </div>
                <div><dt>版本</dt><dd>Generation {{ ws.currentGeneration }}</dd></div>
                <div><dt>上级空间</dt><dd>{{ ws.parentWorkspaceId || '（根，无继承）' }}</dd></div>
                <div v-if="ws.fsPath">
                  <dt>物理路径</dt>
                  <dd>
                    <div
                      class="ws-copyable-wrapper"
                      data-split-toggle-ignore
                      :data-pact-tooltip="ws.fsPath"
                      @click.stop="copyToClipboard($event, ws.fsPath)"
                    >
                      <code class="ws-copyable-code">{{ ws.fsPath }}</code>
                    </div>
                  </dd>
                </div>
                <div><dt>更新时间</dt><dd>{{ formatCompactDate(ws.updatedAt) }}</dd></div>
              </dl>

              <div class="ws-card-counts">
                <span>{{ ws.ownedSourceIds.length }} 个知识源</span>
                <span>{{ ws.summary?.sessionCount ?? 0 }} 个会话</span>
                <span v-if="ws.accessibleWorkspaceIds.length">+ {{ ws.accessibleWorkspaceIds.length }} 共享</span>
              </div>

              <div class="ws-card-actions">
                <button class="table-action" type="button" @click.stop="openProfile(ws)">配置 Profile</button>
                <button class="table-action" type="button" @click.stop="openParent(ws)">设置继承</button>
                <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; openLocalDir()">本机目录</button>
                <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; openCloudDrive()">云盘</button>
                <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; openCodespace()">代码库</button>
                <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; panel = 'share'; shareForm.action = 'share'">共享</button>
              </div>
            </div>
          </template>
          <div
            :id="workspaceExpansionSlotId(ws)"
            class="ws-card-expanded-slot"
            @click.stop
          ></div>
        </SplitToggleCard>
      </div>

      <WorkspaceDetailPanel />
    </div>

    <!-- ── Delete Confirmation Modal ─────────────────────────────── -->
    <div v-if="showDeleteModal" class="pact-modal-overlay">
      <div class="pact-modal">
        <h3>移除工作空间</h3>
        <p style="margin-top: var(--space-2); font-size: 0.9rem; color: var(--text-secondary);">
          确定要移除工作空间 <strong>{{ selected?.title }}</strong> 吗？
          此操作将解除该空间在系统中的注册。
        </p>
        <div style="margin-top: var(--space-3);">
          <BinaryCheckbox
            v-model="deleteFolderChecked"
            label="同时从文件系统中彻底删除物理文件夹及所有快照数据"
          />
        </div>

        <div style="display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-4);">
          <button class="tool-button tool-button-ghost" @click="showDeleteModal = false">取消</button>
          <button class="tool-button danger-action" @click="deleteWorkspace">确认移除</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspaces-view {
  display: flex; flex-direction: column; gap: var(--space-4);
  padding: var(--space-4); min-height: 0;
}
.ws-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
}
.ws-toolbar-title { margin: 0; font-size: 1rem; font-weight: 600; }
.ws-toolbar-actions { display: flex; gap: var(--space-2); }

.ws-layout {
  display: grid; grid-template-columns: 320px 1fr; gap: var(--space-4); min-height: 0; flex: 1;
}
.ws-layout.ws-layout-expanded-cards { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 900px) { .ws-layout { grid-template-columns: 1fr; } }
.ws-list  { display: flex; flex-direction: column; gap: 0; overflow: auto; }
.ws-layout.ws-layout-expanded-cards .ws-list { overflow: visible; }

.ws-card {
  --split-toggle-card-radius: var(--radius-m);
  --split-toggle-card-bg: var(--bg-surface);
  --split-toggle-card-open-bg: var(--accent-surface);
  --split-toggle-card-open-border-color: var(--accent);
  --split-toggle-card-padding: var(--space-3);
  --split-toggle-card-main-gap: var(--space-1);
  --split-toggle-card-body-gap: var(--space-3);
  --split-toggle-card-toggle-width: 58px;
  --split-toggle-card-toggle-padding: 24px 0;
  --split-toggle-card-toggle-hover-color: var(--accent);
  --split-toggle-card-focus-color: var(--accent);
  position: relative;
  transition: border-color 0.15s, background-color 0.15s;
}
.ws-card + .ws-card { margin-top: -1px; }
.ws-card:not(:first-of-type) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.ws-card:not(:last-of-type) {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.ws-card:hover { --split-toggle-card-border-color: var(--border-accent); }
.ws-card.selected {
  --split-toggle-card-border-color: var(--accent);
  --split-toggle-card-bg: var(--accent-surface);
  z-index: 1;
}
.ws-card.expanded {
  --split-toggle-card-open-border-color: var(--accent);
  --split-toggle-card-open-bg: var(--accent-surface);
  z-index: 2;
}
.ws-card-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.ws-card-summary-header {
  margin-bottom: 0;
}
.ws-card-heading {
  min-width: 0;
}
.ws-card-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}
.ws-card-title-row h3 {
  margin: 0;
  color: var(--brand);
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.workspace-status-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-shrink: 0;
}
.ws-inherited-badge {
  font-size: 0.7rem; color: var(--info); border: 1px solid var(--info);
  padding: 1px 6px; border-radius: 4px;
}
.ws-card-meta-list {
  gap: var(--space-2);
}
.ws-card-meta-list > div {
  grid-template-columns: minmax(112px, 160px) minmax(0, 1fr);
}
.ws-card-meta-list dd {
  min-width: 0;
}
.ws-card-counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.ws-card-actions {
  display: flex;
  flex-direction: row-reverse;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
.ws-card-actions .table-action {
  height: 34px;
  padding: 0 var(--space-3);
  font-size: var(--text-base);
  color: var(--text-primary);
}
.ws-copyable-wrapper {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  cursor: copy;
}
.ws-copyable-wrapper::after {
  content: attr(data-pact-tooltip);
  position: absolute;
  top: -28px;
  left: 0;
  background: var(--pact-copy-popover-bg);
  color: var(--pact-copy-popover-fg);
  border: 1px solid var(--pact-copy-popover-border);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.1s ease-out, transform 0.1s ease-out;
  z-index: 100;
  box-shadow: var(--pact-copy-popover-shadow);
}
.ws-copyable-wrapper:hover::after {
  opacity: 1;
  transform: translateY(0);
}
.ws-copyable-code {
  user-select: all;
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background-color 0.15s, color 0.15s;
}
.ws-copyable-wrapper:active .ws-copyable-code {
  background: var(--accent);
  color: var(--bg-surface);
}
.ws-card-expanded-slot { margin-top: 0; }
.pact-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
  animation: fade-in 0.2s ease-out;
}
.pact-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-l);
  padding: var(--space-4);
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  animation: slide-up 0.3s var(--ease-out);
}
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

</style>
