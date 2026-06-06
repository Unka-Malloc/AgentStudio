<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";

defineOptions({ name: "ConsoleSideNavBrand" });

const { consoleState, msg } = useConsoleSideNavContext();
</script>

<template>
  <div class="brand-block" :class="{ 'is-loading': !consoleState }">
    <div class="brand-mark" aria-hidden="true">S</div>
    <div class="brand-text">
      <h1>Pact</h1>
      <p class="brand-subtitle">
        <span v-if="!consoleState" class="brand-loading-label" aria-live="polite">
          {{ msg.loading }}
          <span class="brand-loading-dots" aria-hidden="true">
            <span></span><span></span><span></span>
          </span>
        </span>
        <span v-else>Server Console</span>
      </p>
    </div>
    <div v-if="!consoleState" class="brand-progress-bar" aria-hidden="true">
      <div class="brand-progress-fill"></div>
    </div>
  </div>
</template>
