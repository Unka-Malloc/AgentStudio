<script setup lang="ts">
import HistorySessionPanel from "../HistorySessionPanel.vue";
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";

const {
  agentRetrievalProgress: {
    agentExploreHistoryPanelItems,
    agentExploreProgress,
    agentExploreProgressVisible,
    deleteAgentExploreHistoryItem,
    selectAgentExploreHistoryItem,
  },
} = useAgentRetrievalViewContext();
</script>

<template>
  <div
    v-if="agentExploreProgressVisible"
    class="agent-explore-progress"
  >
    <div class="agent-explore-progress-header">
      <span>检索进度</span>
      <strong>{{ agentExploreProgress.label }}</strong>
    </div>
    <div class="agent-explore-progress-track">
      <span :style="{ width: `${agentExploreProgress.percent}%` }"></span>
    </div>
  </div>

  <HistorySessionPanel
    title="历史会话"
    :subtitle="`${agentExploreHistoryPanelItems.length} 条，滚动查看`"
    :items="agentExploreHistoryPanelItems"
    @select="selectAgentExploreHistoryItem"
    @delete="deleteAgentExploreHistoryItem"
  />
</template>
