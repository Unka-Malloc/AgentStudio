<script setup lang="ts">
import AgentRetrievalAnswerPanel from "./AgentRetrievalAnswerPanel.vue";
import AgentRetrievalTraceCard from "./AgentRetrievalTraceCard.vue";
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";

const {
  agentRetrievalWorkspace: {
    agentExploreResult,
    agentExploreSplitDragging,
    agentExploreSplitLeftPercent,
    agentExploreSplitRef,
    agentExploreSplitStyle,
    busyKey,
    handleAgentExploreSplitKeydown,
    startAgentExploreSplitResize,
  },
} = useAgentRetrievalViewContext();
</script>

<template>
  <div
    v-if="agentExploreResult || busyKey === 'knowledge:agent-explore'"
    class="agent-explore-workspace"
    :class="{ 'is-resizing': agentExploreSplitDragging }"
    :style="agentExploreSplitStyle"
    ref="agentExploreSplitRef"
  >
    <AgentRetrievalTraceCard />
    <div
      class="agent-explore-split-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整工具轨迹和检索结果宽度"
      tabindex="0"
      :aria-valuenow="Math.round(agentExploreSplitLeftPercent)"
      aria-valuemin="28"
      aria-valuemax="68"
      @pointerdown="startAgentExploreSplitResize"
      @keydown="handleAgentExploreSplitKeydown"
    >
      <span></span>
    </div>
    <AgentRetrievalAnswerPanel />
  </div>
</template>
