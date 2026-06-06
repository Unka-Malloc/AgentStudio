<script setup lang="ts">
import RuntimeModuleGroup from "./RuntimeModuleGroup.vue";
import { useModulesViewContext } from "../../../composables/modulesViewContext";

const {
  busyKey,
  consoleState,
  enabledMountCount,
  moduleGroups,
  reloadModules,
  saveMountModules,
  totalMountCount,
} = useModulesViewContext();
</script>

<template>
  <section class="modules-layout">
    <article class="surface-card module-mount-card">
      <div class="module-card-meta module-card-meta-right">
        <h3 class="module-card-title">外置模块</h3>
        <div class="module-card-header-actions">
          <div class="section-tags">
            <span>运行代次 {{ consoleState?.runtime?.mountGeneration || 0 }}</span>
            <span>启用 {{ enabledMountCount }}/{{ totalMountCount }}</span>
          </div>
          <div class="module-actions">
            <button
              class="tool-button tool-button-ghost"
              type="button"
              :disabled="busyKey === 'module-reload'"
              @click="reloadModules"
            >
              {{ busyKey === "module-reload" ? "重载中" : "重载模块" }}
            </button>
            <button
              class="tool-button"
              type="button"
              :disabled="busyKey === 'mounts'"
              @click="saveMountModules"
            >
              {{ busyKey === "mounts" ? "保存中" : "保存配置" }}
            </button>
          </div>
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
