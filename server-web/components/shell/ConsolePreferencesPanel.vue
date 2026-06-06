<script setup lang="ts">
import OptionBar from "../OptionBar.vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  languageMode,
  languageOptionBarOptions,
  msg,
  setLanguage,
} = useServerConsoleShellContext();
</script>

<template>
  <section class="drawer-panel">
    <div class="panel-header">
      <h4>{{ msg.drawer.preferencesTitle }}</h4>
      <p>{{ msg.drawer.preferencesDescription }}</p>
    </div>
    <section class="module-panel">
      <div class="module-panel-heading">
        <strong>{{ msg.drawer.language }}</strong>
        <span>{{ languageMode === 'en' ? 'English' : '简体中文' }}</span>
      </div>
      <OptionBar
        :model-value="languageMode"
        :label="msg.drawer.language"
        :options="languageOptionBarOptions"
        :teleported="false"
        @update:model-value="setLanguage"
        @change="setLanguage"
      />
    </section>
  </section>
</template>
