<script setup lang="ts">
import RuntimeModuleGroup from "./RuntimeModuleGroup.vue";
import { useModulesViewContext } from "../../../composables/modulesViewContext";

const {
  consoleState,
  enabledMountCount,
  moduleGroups,
  totalMountCount,
} = useModulesViewContext();
</script>

<template>
  <section class="modules-layout">
    <article class="surface-card module-mount-card">
      <div class="module-card-meta module-card-meta-right">
        <h3 class="module-card-title">外置模块</h3>
        <div class="section-tags">
          <span>运行代次 {{ consoleState?.runtime?.mountGeneration || 0 }}</span>
          <span>启用 {{ enabledMountCount }}/{{ totalMountCount }}</span>
        </div>
      </div>

      <div class="mount-config-list">
        <RuntimeModuleGroup
          v-for="group in moduleGroups"
          :key="group.id"
          :group="group"
        />
      </div>
    </article>
  </section>
</template>
