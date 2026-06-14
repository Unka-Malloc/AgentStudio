<script setup lang="ts">
import { ref } from "vue";
import OptionBar from "../OptionBar.vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  appearancePresetCatalogMessage,
  appearancePresetImporting,
  appearanceCycleScheme,
  appearanceCycleSchemeOptions,
  appearancePresetOptionsForCycleScheme,
  appearancePresetSelectionId,
  importAppearancePresetFileToServer,
  refreshAppearancePresetConfigs,
  languageMode,
  languageOptionBarOptions,
  msg,
  setAppearanceCycleScheme,
  setAppearancePreset,
  setLanguage,
} = useServerConsoleShellContext();

const appearancePresetFileInputRef = ref<HTMLInputElement | null>(null);

async function handleAppearancePresetFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await importAppearancePresetFileToServer(file);
  }
  input.value = "";
}
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
      </div>
      <OptionBar
        :model-value="languageMode"
        :options="languageOptionBarOptions"
        @update:model-value="setLanguage"
        @change="setLanguage"
      />
    </section>
    <section class="module-panel">
      <div class="module-panel-heading">
        <strong>{{ msg.drawer.appearancePreset }}</strong>
      </div>
      <OptionBar
        :model-value="appearanceCycleScheme"
        :label="msg.drawer.theme"
        :options="appearanceCycleSchemeOptions"
        @update:model-value="setAppearanceCycleScheme"
        @change="setAppearanceCycleScheme"
      />
      <OptionBar
        :model-value="appearancePresetSelectionId"
        :label="msg.drawer.appearancePreset"
        :options="appearancePresetOptionsForCycleScheme"
        @update:model-value="setAppearancePreset"
        @change="setAppearancePreset"
      />
      <div class="drawer-inline-actions">
        <button
          class="tool-button tool-button-ghost"
          type="button"
          :disabled="appearancePresetImporting"
          @click="appearancePresetFileInputRef?.click()"
        >
          {{ msg.drawer.importAppearancePresetToServer }}
        </button>
        <button class="tool-button tool-button-ghost" type="button" @click="refreshAppearancePresetConfigs()">
          {{ msg.drawer.reloadAppearancePresets }}
        </button>
        <input
          ref="appearancePresetFileInputRef"
          type="file"
          accept="application/json,.json"
          hidden
          @change="handleAppearancePresetFileChange"
        />
      </div>
      <p v-if="appearancePresetCatalogMessage" class="panel-note">{{ appearancePresetCatalogMessage }}</p>
    </section>
  </section>
</template>
