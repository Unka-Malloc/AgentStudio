<script setup lang="ts">
import AgentModelOptionBar from "../../AgentModelOptionBar.vue";
import StatusPill from "../../StatusPill.vue";
import { formatMachineDate } from "../../../composables/console-format-utils";
import { useKnowledgeWordCloudContext } from "../../../composables/knowledgeViewContext";

const {
  busyKey,
  canWriteKnowledge,
  proposeWordCloud,
  selectedWordCloudModel,
  wordCloudMessages,
  wordCloudModelAlias,
  wordCloudModelOptions,
  wordCloudPrompt,
} = useKnowledgeWordCloudContext();
</script>

<template>
  <section class="word-cloud-lower-grid">
    <form class="info-feed-input-dock word-cloud-dialog" @submit.prevent="proposeWordCloud">
      <div class="section-header compact-section-header">
        <div>
          <h3>智能体分组</h3>
        </div>
        <StatusPill
          :tone="selectedWordCloudModel.enabled ? 'success' : 'warning'"
          :label="selectedWordCloudModel.enabled ? '可调用' : '未就绪'"
        />
      </div>
      <textarea
        v-model="wordCloudPrompt"
        spellcheck="false"
      />
      <div class="word-cloud-dialog-controls">
        <AgentModelOptionBar
          v-model="wordCloudModelAlias"
          class="word-cloud-agent-select"
          placeholder=""
          :options="wordCloudModelOptions"
        />
        <button
          class="primary-action word-cloud-agent-submit"
          type="submit"
          :disabled="!canWriteKnowledge || !selectedWordCloudModel.enabled || busyKey === 'knowledge:word-clouds:propose'"
        >
          {{ busyKey === "knowledge:word-clouds:propose" ? "启动中" : "启动分类任务" }}
        </button>
      </div>
      <div class="word-cloud-message-list">
        <article
          v-for="message in wordCloudMessages"
          :key="message.id"
          class="word-cloud-message"
          :data-role="message.role"
        >
          <strong>{{ message.role === "agent" ? "智能体" : message.role === "user" ? "人工监督" : "系统" }}</strong>
          <span>{{ formatMachineDate(message.at, "compact") }}</span>
          <p>{{ message.text }}</p>
        </article>
      </div>
    </form>
  </section>
</template>
