<script setup lang="ts" generic="T">
import { useSlots } from 'vue';

const props = defineProps<{
  data: T[];
  rowKey?: string | ((row: T) => string);
  emptyText?: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'scroll', evt: Event): void;
  (e: 'header-dragend', newWidth: number, oldWidth: number, column: any, evt: Event): void;
}>();

function handleScroll(evt: Event) {
  emit('scroll', evt);
}

function handleHeaderDragend(newWidth: number, oldWidth: number, column: any, evt: Event) {
  emit('header-dragend', newWidth, oldWidth, column, evt);
}
</script>

<template>
  <el-table
    :data="data"
    :row-key="rowKey"
    :empty-text="emptyText"
    v-loading="loading"
    border
    stripe
    size="small"
    class="pact-data-table"
    @scroll="handleScroll"
    @header-dragend="handleHeaderDragend"
  >
    <slot />
  </el-table>
</template>

<style>
.pact-data-table.el-table {
  --pact-table-row-bg: var(--bg-surface);
  --pact-table-row-stripe-bg: color-mix(in srgb, var(--bg-subtle) 48%, var(--bg-surface));
  --pact-table-row-hover-bg: var(--bg-subtle);
  --el-table-bg-color: var(--bg-surface);
  --el-table-tr-bg-color: var(--pact-table-row-bg);
  --el-table-border-color: var(--border-subtle);
  --el-table-header-bg-color: var(--bg-subtle);
  --el-table-row-hover-bg-color: var(--pact-table-row-hover-bg);
  --el-table-text-color: var(--text-primary);
  --el-table-header-text-color: var(--text-secondary);
  --el-fill-color-lighter: var(--pact-table-row-stripe-bg);
  background: var(--bg-surface);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.pact-data-table.el-table .el-table__inner-wrapper,
.pact-data-table.el-table .el-table__body-wrapper,
.pact-data-table.el-table .el-scrollbar,
.pact-data-table.el-table .el-scrollbar__view,
.pact-data-table.el-table .el-table__body {
  background: var(--bg-surface);
}

.pact-data-table.el-table th.el-table__cell {
  background: var(--bg-subtle) !important;
  color: var(--text-secondary);
}

.pact-data-table.el-table td.el-table__cell {
  background: var(--pact-table-row-bg) !important;
  color: var(--text-primary);
}

.pact-data-table.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: var(--pact-table-row-stripe-bg) !important;
}

.pact-data-table.el-table .el-table__body tr:hover > td.el-table__cell,
.pact-data-table.el-table .el-table__body tr.hover-row > td.el-table__cell,
.pact-data-table.el-table--enable-row-hover .el-table__body tr:hover > td.el-table__cell {
  background: var(--pact-table-row-hover-bg) !important;
}

.pact-data-table.el-table .el-table__empty-block {
  background: var(--bg-surface);
}

.pact-data-table.el-table .el-table__empty-text {
  color: var(--text-muted);
}

.pact-data-table.el-table--border .el-table__inner-wrapper::after,
.pact-data-table.el-table--border::before,
.pact-data-table.el-table--border::after {
  background-color: var(--border-subtle);
}

.pact-data-table .el-table__cell {
  vertical-align: top;
}

.pact-data-table.el-table--border .el-table__cell {
  border-right: 1px solid var(--border-subtle) !important;
}

.pact-data-table.el-table td.el-table__cell,
.pact-data-table.el-table th.el-table__cell.is-leaf {
  border-bottom: 1px solid var(--border-subtle) !important;
}
</style>
