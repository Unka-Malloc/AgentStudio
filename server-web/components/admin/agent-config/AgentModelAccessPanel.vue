<script setup lang="ts">
import type { AgentModelConfig } from "../../../lib/types";
import { useAgentModelEntryCardContext } from "../../../composables/agentModelEntryCardContext";
import BinaryCheckbox from "../../BinaryCheckbox.vue";
import ConfigFoldCard from "../../ConfigFoldCard.vue";
import OptionBar from "../../OptionBar.vue";

defineProps<{
  entry: AgentModelConfig;
}>();

const {
  agentPermissionGroupOptionBarOptions,
  intelligentModuleDefinitions,
  modelEntryModuleAccess,
  moduleAccessModeOptionBarOptions,
  setModelEntryModuleAccessMode,
  setModelEntryPermissionGroup,
  toggleModelEntryModuleAccess,
} = useAgentModelEntryCardContext();
</script>

<template>
  <ConfigFoldCard title="功能可见性与授权">
    <label class="module-field">
      <span>权限组</span>
      <OptionBar
        :model-value="entry.permissionGroupId || ''"
        :options="agentPermissionGroupOptionBarOptions"
        @update:model-value="setModelEntryPermissionGroup(entry, String($event))"
      />
    </label>
    <OptionBar
      :model-value="modelEntryModuleAccess(entry).mode"
      label="开放范围"
      :options="moduleAccessModeOptionBarOptions"
      @update:model-value="setModelEntryModuleAccessMode(entry, String($event))"
    />
    <div
      v-if="modelEntryModuleAccess(entry).mode === 'selected'"
      class="model-library-module-access-list"
    >
      <BinaryCheckbox
        v-for="moduleDefinition in intelligentModuleDefinitions"
        :key="moduleDefinition.id"
        :model-value="modelEntryModuleAccess(entry).moduleIds.includes(moduleDefinition.id)"
        :label="moduleDefinition.label"
        @update:model-value="toggleModelEntryModuleAccess(entry, moduleDefinition.id, Boolean($event))"
      />
    </div>
    <p class="module-note">
      没有授权给某个功能时，该功能的智能体选项中不会出现这个智能体。
    </p>
  </ConfigFoldCard>
</template>
