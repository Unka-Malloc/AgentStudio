<script setup lang="ts">
import AgentRetrievalForm from "./AgentRetrievalForm.vue";
import AgentRetrievalProgressAndHistory from "./AgentRetrievalProgressAndHistory.vue";
import AgentRetrievalTabStrip from "./AgentRetrievalTabStrip.vue";
import AgentRetrievalWorkspace from "./AgentRetrievalWorkspace.vue";
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";

const {
  agentRetrievalPage: { resetKnowledgeAgentExplore },
} = useAgentRetrievalViewContext();
</script>

<template>
  <article class="surface-card agent-explore-card agent-explore-home debug-panel-card">
    <div class="section-header">
      <div>
        <h3>智能检索</h3>
        <p>调试智能体如何规划工具调用、压缩上下文、打开证据并生成最终回答。</p>
      </div>
      <div class="section-actions">
        <button class="tool-button" type="button" @click="resetKnowledgeAgentExplore">
          新会话
        </button>
      </div>
    </div>
    <AgentRetrievalTabStrip />
    <AgentRetrievalForm />
    <AgentRetrievalProgressAndHistory />
    <AgentRetrievalWorkspace />
  </article>
</template>
