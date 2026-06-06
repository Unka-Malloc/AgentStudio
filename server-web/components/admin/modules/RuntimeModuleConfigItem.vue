<script setup lang="ts">
import BrowseSelectButton from "../../BrowseSelectButton.vue";
import FeatureToggle from "../../FeatureToggle.vue";
import StatusPill from "../../StatusPill.vue";
import {
  currentModulePathPlaceholder,
  moduleAvailabilityLabel,
  moduleCapabilityText,
  moduleStatusText,
  type RuntimeModuleRow,
} from "../../../composables/console-runtime-module-display-utils";
import { useModulesViewContext } from "../../../composables/modulesViewContext";

defineProps<{
  item: RuntimeModuleRow;
}>();

const {
  busyKey,
  canBrowseServerPaths,
  disableMountModule,
  enableMountModule,
  mountDraft,
  openMountPathPicker,
} = useModulesViewContext();
</script>

<template>
  <article
    class="mount-config-item"
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
      <div class="mount-config-actions">
        <FeatureToggle
          :model-value="item.externalEnabled"
          :aria-label="item.externalEnabled ? `关闭${item.label}` : `开启${item.label}`"
          :disabled="
            busyKey === `mount:${item.name}` ||
            (!item.externalEnabled &&
              !String(mountDraft[item.name] || '').trim())
          "
          @update:model-value="$event ? enableMountModule(item.name) : disableMountModule(item.name)"
        />
      </div>
    </div>
  </article>
</template>
