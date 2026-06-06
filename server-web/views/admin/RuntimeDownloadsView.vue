<script setup lang="ts">
import RuntimeDownloadsPanel from "../../components/admin/runtime-downloads/RuntimeDownloadsPanel.vue";
import { useRuntimeDownloadsViewController } from "../../composables/console-runtime-downloads-view-controller";
import { provideRuntimeDownloadsView } from "../../composables/runtimeDownloadsViewContext";

const runtimeDownloadsView = useRuntimeDownloadsViewController();
provideRuntimeDownloadsView(runtimeDownloadsView);
</script>

<template>
  <RuntimeDownloadsPanel />
</template>
