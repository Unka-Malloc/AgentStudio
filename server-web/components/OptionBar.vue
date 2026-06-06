<script setup lang="ts">
type OptionBarValue = string | number | boolean;
type OptionBarModelValue = OptionBarValue | OptionBarValue[];

type OptionBarOption = {
  value: OptionBarValue;
  label: string;
  disabled?: boolean;
};

withDefaults(defineProps<{
  modelValue: OptionBarModelValue;
  options: OptionBarOption[];
  label?: string;
  placeholder?: string;
  multiple?: boolean;
  collapseTags?: boolean;
  collapseTagsTooltip?: boolean;
  filterable?: boolean;
  teleported?: boolean;
  persistent?: boolean;
  popperClass?: string;
  disabled?: boolean;
  clearable?: boolean;
  size?: string;
}>(), {
  label: "",
  placeholder: "",
  multiple: false,
  collapseTags: false,
  collapseTagsTooltip: true,
  filterable: false,
  teleported: true,
  persistent: false,
  popperClass: "pact-select-popper",
  disabled: false,
  clearable: false,
  size: "default",
});

const emit = defineEmits<{
  "update:modelValue": [value: OptionBarModelValue];
  change: [value: OptionBarModelValue];
}>();

function updateValue(value: OptionBarModelValue) {
  emit("update:modelValue", value);
}

function changeValue(value: OptionBarModelValue) {
  emit("change", value);
}
</script>

<template>
  <label class="option-bar" :data-has-label="Boolean(label)">
    <span v-if="label" class="option-bar-label">{{ label }}</span>
    <el-select
      class="option-bar-select"
      :model-value="modelValue"
      :multiple="multiple"
      :collapse-tags="collapseTags"
      :collapse-tags-tooltip="collapseTagsTooltip"
      :teleported="teleported"
      :filterable="filterable"
      :placeholder="placeholder"
      :persistent="persistent"
      :popper-class="popperClass"
      :disabled="disabled"
      :clearable="clearable"
      :size="size"
      @update:model-value="updateValue"
      @change="changeValue"
    >
      <el-option
        v-for="option in options"
        :key="String(option.value)"
        :label="option.label"
        :value="option.value"
        :disabled="option.disabled"
      />
    </el-select>
  </label>
</template>

<style scoped>
.option-bar {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.option-bar[data-has-label="false"] { gap: 0; }

.option-bar-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.option-bar-select { width: 100%; min-width: 0; }
</style>
