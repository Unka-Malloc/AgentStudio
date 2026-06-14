<script setup lang="ts">
import AgentModelOptionBar from "../AgentModelOptionBar.vue";
import OptionBar from "../OptionBar.vue";
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";

const {
  agentRetrievalForm: {
    agentExploreAgentOptions,
    agentExploreForm,
    busyKey,
    contextWindowOptionBarOptions,
    highlightedConfigTarget,
    runKnowledgeAgentExplore,
    selectedAgentExploreModel,
    thinkingModeOptionBarOptions,
  },
} = useAgentRetrievalViewContext();
</script>

<template>
  <form class="agent-explore-form" @submit.prevent="runKnowledgeAgentExplore">
    <label class="full-row">
      <span>问题</span>
      <input
        v-model="agentExploreForm.query"
        type="search"
        placeholder="例如：帮我找 Atlas 模块最近的部署记录，并说明哪些证据真正相关"
      />
    </label>
    <AgentModelOptionBar
      class="wide-field"
      data-config-target="agent-explore-agent"
      :data-config-highlighted="highlightedConfigTarget === 'agent-explore-agent'"
      v-model="agentExploreForm.modelAlias"
      label="智能体"
      placeholder="未分配智能体"
      :options="agentExploreAgentOptions"
    />
    <div class="agent-debug-parameter-grid full-row">
      <OptionBar
        v-model="agentExploreForm.contextProfileId"
        label="上下文窗口"
        :options="contextWindowOptionBarOptions"
      />
      <OptionBar
        v-model="agentExploreForm.thinkingMode"
        label="Thinking"
        :options="thinkingModeOptionBarOptions"
      />
      <label>
        <span>循环轮数</span>
        <input v-model.number="agentExploreForm.maxIterations" type="number" min="1" max="8" />
      </label>
      <label>
        <span>每次召回</span>
        <input v-model.number="agentExploreForm.limit" type="number" min="1" max="20" />
      </label>
      <label>
        <span>temperature</span>
        <input v-model.number="agentExploreForm.temperature" type="number" min="0" max="2" step="0.1" />
      </label>
      <label>
        <span>max_tokens</span>
        <input v-model.number="agentExploreForm.maxTokens" type="number" min="128" step="128" />
      </label>
      <label>
        <span>tool_choice</span>
        <input v-model="agentExploreForm.toolChoice" autocomplete="off" />
      </label>
    </div>
    <button
      class="primary-action full-row"
      type="submit"
      :disabled="busyKey === 'knowledge:agent-explore' || !agentExploreForm.query.trim() || !selectedAgentExploreModel.enabled"
    >
      {{ busyKey === "knowledge:agent-explore" ? "检索中" : "开始检索" }}
    </button>
  </form>
</template>
