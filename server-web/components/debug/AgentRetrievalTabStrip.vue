<script setup lang="ts">
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";
import {
  agentExploreTabMeta,
  agentExploreTabTitle,
} from "../../composables/console-agent-explore-presentation";

const {
  agentRetrievalTabs: {
    agentExploreActiveTabId,
    agentExploreTabBusy,
    agentExploreTabs,
    closeAgentExploreTab,
    isAgentExploreDraftSession,
    switchAgentExploreTab,
  },
} = useAgentRetrievalViewContext();
</script>

<template>
  <div v-if="agentExploreTabs.length" class="agent-explore-tab-strip" role="tablist" aria-label="智能检索会话">
    <div
      v-for="session in agentExploreTabs"
      :key="session.runId"
      class="agent-explore-tab"
      role="tab"
      tabindex="0"
      :aria-selected="session.runId === agentExploreActiveTabId"
      :data-active="session.runId === agentExploreActiveTabId"
      :data-draft="isAgentExploreDraftSession(session)"
      :data-disabled="agentExploreTabBusy(session)"
      @click="agentExploreTabBusy(session) ? undefined : switchAgentExploreTab(session)"
      @keydown.enter.prevent="agentExploreTabBusy(session) ? undefined : switchAgentExploreTab(session)"
      @keydown.space.prevent="agentExploreTabBusy(session) ? undefined : switchAgentExploreTab(session)"
    >
      <div class="agent-explore-tab-main">
        <strong>{{ agentExploreTabTitle(session) }}</strong>
        <span>{{ agentExploreTabMeta(session) }}</span>
      </div>
      <button
        class="agent-explore-tab-close"
        type="button"
        title="关闭标签"
        :aria-label="`关闭标签 ${agentExploreTabTitle(session)}`"
        :disabled="agentExploreTabBusy(session)"
        @click.stop="closeAgentExploreTab(session)"
      >
        ×
      </button>
    </div>
  </div>
</template>
