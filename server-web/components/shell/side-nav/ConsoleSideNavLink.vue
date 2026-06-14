<script setup lang="ts">
defineOptions({ name: "ConsoleSideNavLink" });

defineProps<{
  active?: boolean;
  label: string;
  subtle?: boolean;
}>();

const emit = defineEmits<{
  activate: [];
}>();
</script>

<template>
  <button
    class="side-link"
    :class="{ active, 'side-link-subtle': subtle }"
    type="button"
    :aria-label="label"
    @click="emit('activate')"
  >
    <slot name="icon"></slot>
    <span class="side-link-label">{{ label }}</span>
    <slot name="trail"></slot>
  </button>
</template>
