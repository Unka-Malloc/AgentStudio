<script setup lang="ts">
import BinaryCheckbox from '../components/BinaryCheckbox.vue';
import StatusPill from '../components/StatusPill.vue';
import SplitToggleCard from '../components/SplitToggleCard.vue';
import HistorySessionPanel from '../components/HistorySessionPanel.vue';
import WorkspaceDetailPanel from '../components/workspaces/WorkspaceDetailPanel.vue';
import { provideWorkspacesView } from '../composables/workspacesViewContext';
import { useWorkspacesConsole } from '../composables/useWorkspacesConsole';
import {
  workspaceKnowledgeContextContract,
  workspaceKnowledgeContextSignature,
} from '../lib/workspaces-client';

const workspacesView = useWorkspacesConsole();
provideWorkspacesView(workspacesView);

const {
  formatCompactDate,
  workspaces,
  sessions,
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
  sessionItems,
  statusTone,
  selectSession,
  forkSession,
  deleteWorkspace,
  openProfile,
  openParent,
  openLocalDir,
  openCloudDrive,
  openCodespace,
} = workspacesView;

const workspaceKnowledgeContextFields = {
  knowledgeScope: workspaceKnowledgeContextContract.profileScopeField,
  knowledgeSourceIds: workspaceKnowledgeContextContract.sourceIdsField,
  knowledgeSessionId: workspaceKnowledgeContextContract.sessionLinkField,
};

const workspaceKnowledgeContextDebug = {
  knowledgeScope: "knowledgeScope",
  knowledgeSourceIds: "knowledgeSourceIds",
  agentSessionId: "agentSessionId",
  workspaceEndpoint: "/api/agent-workspaces",
  contextEndpoint: "/context",
  sessionsEndpoint: "/api/agent-sessions",
  forkActionLabel: "分叉",
};
</script>

<template>
  <section
    class="workspaces-view"
    :data-workspace-knowledge-context="workspaceKnowledgeContextSignature"
    :data-knowledge-scope="workspaceKnowledgeContextFields.knowledgeScope"
    :data-knowledge-source-ids="workspaceKnowledgeContextFields.knowledgeSourceIds"
    :data-agent-session-id="workspaceKnowledgeContextFields.knowledgeSessionId"
    :data-workspace-endpoint="workspaceKnowledgeContextDebug.workspaceEndpoint"
    :data-workspace-context-endpoint="workspaceKnowledgeContextDebug.contextEndpoint"
    :data-workspace-sessions-endpoint="workspaceKnowledgeContextDebug.sessionsEndpoint"
    :data-workspace-fork-label="workspaceKnowledgeContextDebug.forkActionLabel"
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

    <HistorySessionPanel
      :items="sessionItems"
      title="会话线程"
      :subtitle="sessions.length ? `${sessions.length} 个可继续会话` : '暂无会话'"
      max-height="260px"
      open
      @select="selectSession"
      @action="forkSession"
    />

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
          as="article"
          class="ws-card"
          :class="{ selected: selectedId === ws.workspaceId, expanded: isWorkspaceExpanded(ws) }"
          :expanded="isWorkspaceExpanded(ws)"
          :expanded-label="`收起 ${ws.title || ws.workspaceId.slice(0, 12)} 工作空间详情`"
          :collapsed-label="`展开 ${ws.title || ws.workspaceId.slice(0, 12)} 工作空间详情`"
          @toggle="toggleWorkspaceCard(ws)"
        >
          <template #summary>
            <div class="ws-card-head">
              <div class="ws-card-title">
                <strong>{{ ws.title || ws.workspaceId.slice(0, 12) }}</strong>
                <span v-if="ws.parentWorkspaceId" class="ws-inherited-badge">↳ 继承</span>
              </div>
              <div class="ws-card-head-actions">
                <StatusPill :tone="statusTone(ws.status)" :label="ws.status" />
              </div>
            </div>
            <p v-if="ws.objective" class="ws-card-obj">{{ ws.objective }}</p>
            <div class="ws-card-meta">
              <span>Gen {{ ws.currentGeneration }}</span>
              <span>{{ ws.ownedSourceIds.length }} 个知识源</span>
              <span>{{ ws.summary?.sessionCount ?? 0 }} 个会话</span>
              <span v-if="ws.accessibleWorkspaceIds.length">+ {{ ws.accessibleWorkspaceIds.length }} 共享</span>
              <span>{{ formatCompactDate(ws.updatedAt) }}</span>
            </div>
            <div class="ws-card-actions">
              <button class="table-action" type="button" @click.stop="openProfile(ws)">配置 Profile</button>
              <button class="table-action" type="button" @click.stop="openParent(ws)">设置继承</button>
              <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; openLocalDir()">本机目录</button>
              <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; openCloudDrive()">云盘</button>
              <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; openCodespace()">代码库</button>
              <button class="table-action" type="button" @click.stop="selectedId = ws.workspaceId; panel = 'share'; shareForm.action = 'share'">共享</button>
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
.ws-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.ws-card-title { display: flex; align-items: center; gap: var(--space-2); }
.ws-card-head-actions { display: flex; align-items: center; gap: var(--space-2); }
.ws-inherited-badge {
  font-size: 0.7rem; color: var(--info); border: 1px solid var(--info);
  padding: 1px 6px; border-radius: 4px;
}
.ws-card-obj { font-size: 0.8rem; color: var(--text-secondary); margin: var(--space-1) 0 0; }
.ws-card-meta { display: flex; flex-wrap: wrap; gap: var(--space-2); font-size: 0.75rem; color: var(--text-secondary); margin-top: var(--space-1); }
.ws-card-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
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
