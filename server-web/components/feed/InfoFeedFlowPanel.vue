<script setup lang="ts">
import { computed } from "vue";
import InfoFeedCurrentUserCard from "./InfoFeedCurrentUserCard.vue";
import InfoFeedParentContextCards from "./InfoFeedParentContextCards.vue";
import InfoFeedPausePanels from "./InfoFeedPausePanels.vue";
import InfoFeedSummaryPanels from "./InfoFeedSummaryPanels.vue";
import InfoFeedTrackGrid from "./InfoFeedTrackGrid.vue";
import InfoFeedTurnCards from "./InfoFeedTurnCards.vue";
import { useFeedViewContext } from "../../composables/feedViewContext";

const { infoFeedCurrentRun } = useFeedViewContext();

const currentRun = computed(() => infoFeedCurrentRun.value);
</script>

<template>
  <div v-if="currentRun" class="info-feed-flow">
    <InfoFeedParentContextCards />

    <InfoFeedTurnCards
      v-for="(turn, turnIndex) in currentRun.turns || []"
      :key="turn.turnId"
      :turn="turn"
      :turn-index="turnIndex"
    />

    <InfoFeedCurrentUserCard />
    <InfoFeedTrackGrid />
    <InfoFeedPausePanels />
    <InfoFeedSummaryPanels />
  </div>
</template>
