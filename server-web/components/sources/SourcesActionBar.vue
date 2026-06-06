<script setup lang="ts">
defineEmits<{
  add: [];
}>();
</script>

<template>
  <div class="sources-action-bar">
    <button
      class="primary-action"
      type="button"
      data-testid="add-data-source-button"
      @click="$emit('add')"
    >
      添加数据源
    </button>
  </div>
</template>
