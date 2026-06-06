<script setup lang="ts">
import BinaryCheckbox from "../BinaryCheckbox.vue";
import BrowseSelectButton from "../BrowseSelectButton.vue";
import type { DataSourceType } from "../../composables/sources-view-controller";
import { useSourcesViewContext } from "../../composables/sourcesViewContext";

defineProps<{
  open: boolean;
  selectedType: DataSourceType;
}>();

defineEmits<{
  close: [];
  "update:selectedType": [value: DataSourceType];
  submit: [];
}>();

const {
  busyKey,
  canBrowseServerPaths,
  canWriteJobs,
  localSourceForm,
  openLocalSourceDirectoryPicker,
  syncLocalSourceLabelFromPath,
} = useSourcesViewContext();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="data-source-dialog-backdrop"
      @click.self="$emit('close')"
    >
      <section
        class="data-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-data-source-title"
        data-testid="add-data-source-dialog"
        @keydown.esc="$emit('close')"
      >
        <header class="data-source-dialog-header">
          <div>
            <h3 id="add-data-source-title">添加数据源</h3>
            <p>先选择数据源类型，再填写该类型需要的配置。</p>
          </div>
          <button
            class="dialog-close-button"
            type="button"
            aria-label="关闭"
            title="关闭"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>

        <form class="data-source-dialog-body" @submit.prevent="$emit('submit')">
          <label class="data-source-type-field">
            <span>数据源类型</span>
            <select
              :value="selectedType"
              data-testid="data-source-type-select"
              autofocus
              @change="$emit('update:selectedType', ($event.target as HTMLSelectElement).value as DataSourceType)"
            >
              <option disabled value="">请选择数据源类型</option>
              <option value="localDirectory">本地目录</option>
              <option value="client">客户端接入</option>
            </select>
          </label>

          <section
            v-if="selectedType === 'localDirectory'"
            class="data-source-config-panel"
            data-testid="local-directory-config"
          >
            <label class="source-name-field">
              <span>目录名称</span>
              <input
                v-model="localSourceForm.label"
                type="text"
                placeholder="例如：公司共享资料"
                autocomplete="off"
              />
            </label>
            <label class="source-path-field">
              <span>本地路径</span>
              <div class="path-field">
                <input
                  v-model="localSourceForm.directoryPath"
                  type="text"
                  placeholder="/Users/you/Documents/Knowledge"
                  autocomplete="off"
                  @change="syncLocalSourceLabelFromPath"
                />
                <BrowseSelectButton
                  kind="server-directory"
                  button-class="path-action-button"
                  button-text="浏览"
                  size="small"
                  :disabled="!canBrowseServerPaths"
                  plain
                  @browse="openLocalSourceDirectoryPicker"
                />
              </div>
            </label>
            <div class="source-sync-row">
              <BinaryCheckbox
                v-model="localSourceForm.autoSync"
                label="自动监听变化"
              />
              <BinaryCheckbox
                v-model="localSourceForm.recursive"
                label="包含子目录"
              />
              <BinaryCheckbox
                v-model="localSourceForm.hydrationEnabled"
                label="自动下载"
              />
            </div>
          </section>

          <section
            v-else-if="selectedType === 'client'"
            class="data-source-config-panel"
            data-testid="client-source-config"
          >
            <div class="data-source-config-note">
              <strong>客户端接入</strong>
              <span>客户端无需在这里创建固定记录。客户端完成接入并上报后，会自动出现在客户端列表和请求统计表中。</span>
            </div>
          </section>

          <footer
            v-if="selectedType"
            class="data-source-dialog-actions"
          >
            <button
              class="tool-button tool-button-ghost"
              type="button"
              @click="$emit('close')"
            >
              取消
            </button>
            <button
              v-if="selectedType === 'localDirectory'"
              class="primary-action"
              type="submit"
              :disabled="!canWriteJobs || busyKey === 'knowledge:sources:add'"
            >
              {{ busyKey === "knowledge:sources:add" ? "添加中" : "添加数据源" }}
            </button>
            <button
              v-else-if="selectedType === 'client'"
              class="primary-action"
              type="submit"
            >
              查看客户端
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
