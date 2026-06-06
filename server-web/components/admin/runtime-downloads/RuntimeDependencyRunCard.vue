<script setup lang="ts">
import { computed } from "vue";
import { statusLabel, statusTone } from "../../../lib/runtime-dependencies";
import RuntimeDependencyRunDetails from "./RuntimeDependencyRunDetails.vue";

type RunCard = {
  logEntries: Array<{ key: string; level: string; message: string; time: string }>;
  progressState: {
    detail: string;
    label: string;
    progressPercent: number;
    segments: Array<{ key: string; label: string; state: string }>;
  };
  run: {
    latestMessage?: string;
    runId: string;
    status: string;
    targetId: string;
  };
};

const props = defineProps<{
  card: RunCard;
}>();

const label = computed(() => statusLabel(props.card.run.status));
const tone = computed(() => statusTone(props.card.run.status));
</script>

<template>
  <section class="runtime-dependency-run-section">
    <div class="runtime-dependency-run-heading">
      <div class="section-tags">
        <span>{{ card.run.targetId }}</span>
        <span>{{ label }}</span>
      </div>
    </div>
    <div :class="['status-strip', tone]">
      <strong>{{ label }}</strong>
      <span>{{ card.run.latestMessage || "等待进度" }}</span>
    </div>
    <RuntimeDependencyRunDetails
      v-if="card.logEntries.length || card.progressState.segments.length"
      :log-entries="card.logEntries"
      :progress-state="card.progressState"
    />
  </section>
</template>
