<script setup lang="ts">
import BrowseSelectButton from "../BrowseSelectButton.vue";
import StatusPill from "../StatusPill.vue";
import {
  currentModulePathPlaceholder,
  moduleAvailabilityLabel,
  moduleCapabilityText,
  moduleStatusText,
} from "../../composables/console-runtime-module-display-utils";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  busyKey,
  canBrowseServerPaths,
  consoleState,
  enabledMountCount,
  isMountPathEditing,
  moduleGroups,
  mountDraft,
  openMountPathPicker,
  reloadModules,
  saveMountModules,
  toggleMountPathEdit,
  totalMountCount,
} = useServerConsoleShellContext();
</script>

<template>
  <section class="drawer-panel">
    <div class="panel-header">
      <h4>模块管理</h4>
      <p>运行代次 {{ consoleState?.runtime?.mountGeneration || 0 }}，可用 {{ enabledMountCount }}/{{ totalMountCount }}</p>
    </div>

    <div class="drawer-actions">
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

    <section
      v-for="group in moduleGroups"
      :key="group.id"
      class="module-panel"
    >
      <div class="module-panel-heading">
        <strong>{{ group.label }}</strong>
        <span>{{ group.description }}</span>
      </div>

      <article
        v-for="item in group.rows"
        :key="item.name"
        class="mount-config-item drawer-mount-item"
        :data-enabled="item.externalEnabled"
      >
        <div class="mount-config-main">
          <div class="mount-config-heading">
            <strong>{{ item.label }}</strong>
            <StatusPill
              :enabled="item.externalEnabled"
              :label="moduleAvailabilityLabel(item)"
            />
          </div>
          <p>{{ item.description }}</p>
          <dl class="module-status-list">
            <div>
              <dt>运行实例</dt>
              <dd>{{ item.runtimeMount?.id || "未加载" }}</dd>
            </div>
            <div>
              <dt>能力</dt>
              <dd>{{ moduleCapabilityText(item) }}</dd>
            </div>
            <div>
              <dt>运行状态</dt>
              <dd>{{ moduleStatusText(item) }}</dd>
            </div>
          </dl>
        </div>

        <div class="mount-config-controls">
          <label class="module-field">
            <span>模块路径</span>
            <div class="path-field">
              <input
                v-model="mountDraft[item.name]"
                autocomplete="off"
                :disabled="!isMountPathEditing(item.name)"
                :placeholder="currentModulePathPlaceholder(item)"
              />
              <BrowseSelectButton
                kind="server-file"
                button-class="path-action-button"
                button-text="浏览"
                size="small"
                :disabled="!canBrowseServerPaths"
                plain
                @browse="openMountPathPicker(item.name)"
              />
            </div>
          </label>
          <button
            class="tool-button tool-button-ghost compact-action"
            type="button"
            :disabled="busyKey === `mount:${item.name}`"
            @click="toggleMountPathEdit(item)"
          >
            {{ isMountPathEditing(item.name) ? "确认" : "修改" }}
          </button>
        </div>
      </article>
    </section>
  </section>
</template>
