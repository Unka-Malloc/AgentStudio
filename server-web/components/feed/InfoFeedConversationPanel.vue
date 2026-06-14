<script setup lang="ts">
import InfoFeedComposerPanel from "./InfoFeedComposerPanel.vue";
import InfoFeedFlowPanel from "./InfoFeedFlowPanel.vue";
import { useFeedViewContext } from "../../composables/feedViewContext";

const {
  infoFeedCurrentRun,
} = useFeedViewContext();
</script>

<template>
  <section class="info-feed-shell">
    <div class="info-feed-dialog">
      <div class="info-feed-render">
        <div v-if="!infoFeedCurrentRun" class="info-feed-empty">
          <strong>信息流</strong>
          <span>输入问题后，会同时启动原文检索和智能规划，最后由总结智能体合并结果。</span>
        </div>
        <InfoFeedFlowPanel v-else />
      </div>

      <div class="info-feed-dialog-divider" aria-hidden="true"></div>

      <InfoFeedComposerPanel />
    </div>
  </section>
</template>
