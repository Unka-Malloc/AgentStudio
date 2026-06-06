<script setup lang="ts">
import SegmentedProgressBar from "../../SegmentedProgressBar.vue";

type ProgressSegment = {
  key: string;
  label: string;
  state: string;
};

type ProgressState = {
  detail: string;
  label: string;
  progressPercent: number;
  segments: ProgressSegment[];
};

type LogEntry = {
  key: string;
  time: string;
  level: string;
  message: string;
};

defineProps<{
  logEntries: LogEntry[];
  progressState: ProgressState;
}>();
</script>

<template>
  <div class="runtime-dependency-run-details">
    <div v-if="progressState.segments.length" class="runtime-dependency-progress">
      <div class="runtime-dependency-progress-meta">
        <span>{{ progressState.detail || "等待进度" }}</span>
        <strong>{{ progressState.label }}</strong>
      </div>
      <SegmentedProgressBar
        aria-label="运行时依赖安装进度"
        show-labels
        :segments="progressState.segments"
        :value-label="`${progressState.label} · ${Math.round(progressState.progressPercent)}%`"
      />
    </div>
    <div
      v-if="logEntries.length"
      class="runtime-dependency-log-list"
      role="log"
      aria-live="polite"
    >
      <div
        v-for="entry in logEntries"
        :key="entry.key"
        class="runtime-dependency-log-line"
        :data-level="entry.level"
      >
        <time v-if="entry.time">{{ entry.time }}</time>
        <span>{{ entry.level }}</span>
        <p>{{ entry.message }}</p>
      </div>
    </div>
  </div>
</template>
