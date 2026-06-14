<script setup lang="ts">
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";

const {
  agentRetrievalProgress: {
    agentExploreProgress,
    agentExploreProgressVisible,
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
</template>
