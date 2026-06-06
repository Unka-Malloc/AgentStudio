<script setup lang="ts">
import { computed } from "vue";
import AgentModelOptionBar from "../AgentModelOptionBar.vue";
import { useFeedViewContext } from "../../composables/feedViewContext";

const {
  continueInfoFeedAfterModelSelection,
  continueInfoFeedAfterRetry,
  highlightedConfigTarget,
  infoFeedCurrentRun,
  infoFeedForm,
  infoFeedModelOptions,
  infoFeedModelSelectionMessage,
  infoFeedNeedsModelSelection,
  infoFeedNeedsRetryContinue,
  infoFeedRetryMessage,
  infoFeedRetryStageLabel,
  selectedInfoFeedModel,
} = useFeedViewContext();

const currentRun = computed(() => infoFeedCurrentRun.value);
</script>

<template>
  <section v-if="infoFeedNeedsModelSelection" class="info-feed-model-pause">
    <div>
      <h3>需要选择可用智能体</h3>
      <p>{{ infoFeedModelSelectionMessage }}</p>
    </div>
    <AgentModelOptionBar
      data-config-target="info-feed-summary-agent"
      :data-config-highlighted="highlightedConfigTarget === 'info-feed-summary-agent'"
      v-model="infoFeedForm.modelAlias"
      label="智能体"
      placeholder="未分配智能体"
      :options="infoFeedModelOptions"
    />
    <button
      class="primary-action"
      type="button"
      :disabled="!selectedInfoFeedModel.enabled"
      @click="continueInfoFeedAfterModelSelection"
    >
      继续
    </button>
  </section>

  <section v-if="infoFeedNeedsRetryContinue" class="info-feed-model-pause info-feed-retry-pause">
    <div>
      <h3>{{ infoFeedRetryStageLabel(currentRun?.pausedForRetry) }}请求中断</h3>
      <p>{{ infoFeedRetryMessage }}</p>
    </div>
    <button
      class="primary-action"
      type="button"
      :disabled="currentRun?.summary.status === 'running'"
      @click="continueInfoFeedAfterRetry"
    >
      继续
    </button>
  </section>
</template>
