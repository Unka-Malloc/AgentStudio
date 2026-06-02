<script setup lang="ts">
import AgentRetrievalDebugPanel from '../components/debug/AgentRetrievalDebugPanel.vue';
import KnowledgeDistillationDebugPanel from '../components/debug/KnowledgeDistillationDebugPanel.vue';
import KnowledgeRecallDebugPanel from '../components/debug/KnowledgeRecallDebugPanel.vue';
import { createAgentRetrievalViewContext, provideAgentRetrievalView } from '../composables/agentRetrievalViewContext';
import { createDebugViewContext, provideDebugView } from '../composables/debugViewContext';
import { useDebugViewConsole } from '../composables/useDebugViewConsole';

const debugView = useDebugViewConsole();
provideDebugView(createDebugViewContext(debugView));
provideAgentRetrievalView(createAgentRetrievalViewContext(debugView));

const { activeDebugTab } = debugView;
</script>

<template>
  <section class="debug-panel-shell">
    <KnowledgeRecallDebugPanel v-if="activeDebugTab === 'knowledgeRecall'" />
    <KnowledgeDistillationDebugPanel v-if="activeDebugTab === 'knowledgeDistillation'" />
    <AgentRetrievalDebugPanel v-if="activeDebugTab === 'agentRetrieval'" />
  </section>
</template>
