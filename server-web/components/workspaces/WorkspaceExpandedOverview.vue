<script setup lang="ts">
import ConfigFoldCard from "../ConfigFoldCard.vue";
import StatusPill from "../StatusPill.vue";
import WorkspaceFileTree from "../WorkspaceFileTree.vue";
import { useWorkspacesViewContext } from "../../composables/workspacesViewContext";

const {
  chainData,
  contextData,
  copyToClipboard,
  formatCompactDate,
  selected,
  selectedId,
  selectedSession,
  sessionContextData,
  statusTone,
  workspaceFilesData,
} = useWorkspacesViewContext();
</script>

<template>
  <template v-if="selected">
    <div class="section-header">
      <div>
        <h3>{{ selected.title }}</h3>
        <p v-if="selected.objective" class="module-note">{{ selected.objective }}</p>
      </div>
      <div class="workspace-status-row">
        <StatusPill :tone="statusTone(selected.status)" :label="selected.status" />
      </div>
    </div>

    <dl class="meta-list">
      <div>
        <dt>工作空间 ID</dt>
        <dd>
          <div class="copyable-wrapper" :data-pact-tooltip="selected.workspaceId" @click="copyToClipboard($event, selected.workspaceId)">
            <code class="copyable-code">{{ selected.workspaceId }}</code>
          </div>
        </dd>
      </div>
      <div><dt>当前代次</dt><dd>Generation {{ selected.currentGeneration }}</dd></div>
      <div><dt>父工作空间</dt><dd>{{ selected.parentWorkspaceId || '（根，无继承）' }}</dd></div>
      <div v-if="selected.fsPath">
        <dt>物理路径</dt>
        <dd>
          <div class="copyable-wrapper" :data-pact-tooltip="selected.fsPath" @click="copyToClipboard($event, selected.fsPath)">
            <code class="copyable-code">{{ selected.fsPath }}</code>
          </div>
        </dd>
      </div>
      <div><dt>更新时间</dt><dd>{{ formatCompactDate(selected.updatedAt) }}</dd></div>
    </dl>

    <section v-if="chainData" class="module-panel workspace-chain-panel">
      <div class="module-panel-heading">
        <strong>继承链</strong>
        <span>{{ chainData.chain.length }} 级</span>
      </div>
      <div class="ws-chain">
        <span
          v-for="(item, i) in chainData.chain"
          :key="item.workspaceId"
          class="ws-chain-item"
          :class="{ 'is-current': item.workspaceId === selectedId }"
        >
          <span v-if="i > 0" class="ws-chain-arrow">›</span>
          <span>{{ item.title || item.workspaceId.slice(0, 12) }}</span>
        </span>
      </div>
    </section>

    <ConfigFoldCard v-if="sessionContextData && selectedSession" title="当前会话线程（切换工作状态）">
      <dl class="meta-list">
        <div><dt>会话 ID</dt><dd><code>{{ sessionContextData.agentSessionId }}</code></dd></div>
        <div><dt>事件数量</dt><dd>{{ sessionContextData.sessionEventCount }} 个</dd></div>
        <div><dt>父会话</dt><dd>{{ sessionContextData.parentSessionId || '（主线会话）' }}</dd></div>
        <div><dt>分叉事件</dt><dd>{{ sessionContextData.forkedFromEventId || '（无）' }}</dd></div>
      </dl>
      <div v-if="selectedSession.events.length" class="ws-session-events">
        <div
          v-for="event in selectedSession.events.slice(-6)"
          :key="event.eventId"
          class="ws-session-event"
        >
          <span>#{{ event.sequence }}</span>
          <strong>{{ event.title || event.type }}</strong>
          <small>{{ formatCompactDate(event.createdAt) }}</small>
        </div>
      </div>
    </ConfigFoldCard>

    <ConfigFoldCard v-if="contextData" title="解析后的运行上下文（智能体可直接使用）">
      <dl class="meta-list">
        <div><dt>知识源数量</dt><dd>{{ contextData.knowledgeSourceIds.length }} 个</dd></div>
        <div v-if="contextData.knowledgeSourceIds.length">
          <dt>知识源 IDs</dt>
          <dd>
            <code v-for="sid in contextData.knowledgeSourceIds" :key="sid" class="workspace-source-id">{{ sid.slice(0, 14) }}…</code>
          </dd>
        </div>
        <div><dt>上下文 Profile</dt><dd>{{ contextData.contextProfileId || '（未设置，使用默认）' }}</dd></div>
        <div><dt>工具 Grant</dt><dd>{{ contextData.toolGrantId || '（未设置，使用默认）' }}</dd></div>
        <div><dt>模型别名</dt><dd>{{ contextData.modelAlias || '（未设置，使用默认）' }}</dd></div>
      </dl>
    </ConfigFoldCard>

    <ConfigFoldCard title="本级 Profile（仅本工作空间自有的差异配置）">
      <pre class="config-json-preview">{{ JSON.stringify(selected.profile, null, 2) || '{}' }}</pre>
    </ConfigFoldCard>

    <ConfigFoldCard v-if="workspaceFilesData?.files" title="工作空间文件树（物理文件）">
      <WorkspaceFileTree :files="workspaceFilesData.files" />
    </ConfigFoldCard>
  </template>
</template>
