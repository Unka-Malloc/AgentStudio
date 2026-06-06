<script setup lang="ts">
import BinaryCheckbox from "../BinaryCheckbox.vue";
import OptionBar from "../OptionBar.vue";
import StatusPill from "../StatusPill.vue";
import { useWorkspacesViewContext } from "../../composables/workspacesViewContext";

const {
  addCloudDriveExposure,
  applyCloudDriveSync,
  busyKey,
  cloudDriveConnectionOptions,
  cloudDriveData,
  cloudDriveForm,
  cloudDriveResult,
  connectCloudDrive,
  downloadCloudDriveFile,
  listCloudDriveItems,
  listCloudDrivePermissions,
  panel,
  planCloudDriveSync,
  removeCloudDriveExposure,
  selected,
  uploadCloudDriveFile,
} = useWorkspacesViewContext();
</script>

<template>
  <div class="surface-card drawer-panel">
    <div class="panel-header">
      <h4>云盘 — {{ selected?.title }}</h4>
      <p>云盘只作为 Sharedspace 的外部 adapter/projection；OAuth provider 当前显示 contractVerified。</p>
    </div>
    <div class="form-grid">
      <OptionBar
        v-model="cloudDriveForm.provider"
        label="Provider"
        :options="[
          { value: 'icloud', label: 'iCloud' },
          { value: 'onedrive', label: 'OneDrive' },
          { value: 'google-drive', label: 'Google Drive' },
          { value: 'dropbox', label: 'Dropbox' },
        ]"
      />
      <label>
        <span>连接</span>
        <select v-model="cloudDriveForm.driveRef">
          <option value="">按 provider 选择</option>
          <option v-for="drive in cloudDriveConnectionOptions" :key="drive.value" :value="drive.value">{{ drive.label }}</option>
        </select>
      </label>
      <label v-if="cloudDriveForm.provider === 'icloud'">
        <span>iCloud 受控目录</span>
        <input v-model="cloudDriveForm.rootPath" autocomplete="off" placeholder="留空使用系统 iCloud Drive 默认路径" />
      </label>
      <label><span>Pact 根目录</span><input v-model="cloudDriveForm.managedFolderRoot" autocomplete="off" /></label>
      <label><span>公共目录</span><input v-model="cloudDriveForm.publicFolder" autocomplete="off" /></label>
      <label><span>当前客户端</span><input v-model="cloudDriveForm.clientId" autocomplete="off" /></label>
      <label><span>允许客户端</span><input v-model="cloudDriveForm.allowedClients" autocomplete="off" /></label>
      <label><span>文件/文件夹路径</span><input v-model="cloudDriveForm.path" autocomplete="off" placeholder="default 或 public/example.txt" /></label>
      <label><span>上传路径</span><input v-model="cloudDriveForm.uploadPath" autocomplete="off" /></label>
      <label><span>同步目标路径</span><input v-model="cloudDriveForm.targetPath" autocomplete="off" /></label>
    </div>
    <div class="module-panel" style="margin-top: var(--space-4);">
      <div class="module-panel-heading">
        <strong>目录暴露</strong>
        <button class="table-action" type="button" :disabled="!!busyKey" @click="addCloudDriveExposure">添加目录</button>
      </div>
      <BinaryCheckbox v-model="cloudDriveForm.advancedMode" label="高级模式" />
      <div v-if="cloudDriveForm.advancedMode" class="ws-id-list" style="margin-top: var(--space-3);">
        <div v-for="(item, index) in cloudDriveForm.exposedDirectories" :key="item.id" class="module-panel" style="margin-top: var(--space-3);">
          <div class="module-panel-heading">
            <strong>{{ item.name || `目录 ${index + 1}` }}</strong>
            <div class="module-actions" style="margin: 0;">
              <button class="table-action" type="button" @click="item.showPermissions = !item.showPermissions">权限配置</button>
              <button class="table-action" type="button" @click="removeCloudDriveExposure(index)">移除</button>
            </div>
          </div>
          <div class="form-grid">
            <label><span>名称</span><input v-model="item.name" autocomplete="off" /></label>
            <label><span>绑定路径</span><input v-model="item.path" autocomplete="off" /></label>
          </div>
          <div v-if="item.showPermissions" class="form-grid" style="margin-top: var(--space-3);">
            <label>
              <span>访问模式</span>
              <select v-model="item.permissionMode">
                <option value="all">所有人可读</option>
                <option value="allowlist">白名单</option>
                <option value="denylist">黑名单</option>
              </select>
            </label>
            <label v-if="item.permissionMode !== 'all'">
              <span>客户端列表</span>
              <input v-model="item.subjects" autocomplete="off" />
            </label>
          </div>
        </div>
        <p v-if="cloudDriveForm.exposedDirectories.length === 0" class="muted-text">暂无目录。</p>
      </div>
    </div>
    <label class="module-field-block">
      <span>上传内容</span>
      <textarea v-model="cloudDriveForm.uploadContent" rows="4" spellcheck="false"></textarea>
    </label>
    <div class="module-actions">
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="connectCloudDrive">
        {{ busyKey === 'ws:drive-connect' ? '连接中…' : '连接' }}
      </button>
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="listCloudDriveItems">
        {{ busyKey === 'ws:drive-list' ? '读取中…' : '列出' }}
      </button>
      <button class="tool-button" type="button" :disabled="!cloudDriveForm.path.trim() || !!busyKey" @click="downloadCloudDriveFile">
        {{ busyKey === 'ws:drive-download' ? '下载中…' : '下载' }}
      </button>
      <button class="tool-button" type="button" :disabled="!cloudDriveForm.uploadPath.trim() || !!busyKey" @click="uploadCloudDriveFile">
        {{ busyKey === 'ws:drive-upload' ? '上传中…' : '上传' }}
      </button>
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="planCloudDriveSync">
        {{ busyKey === 'ws:drive-sync-plan' ? '规划中…' : '同步计划' }}
      </button>
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="applyCloudDriveSync">
        {{ busyKey === 'ws:drive-sync-apply' ? '应用中…' : '应用同步' }}
      </button>
      <button class="tool-button" type="button" :disabled="!!busyKey" @click="listCloudDrivePermissions">
        {{ busyKey === 'ws:drive-permissions' ? '读取中…' : '权限' }}
      </button>
      <button class="tool-button tool-button-ghost" type="button" @click="panel = 'list'">取消</button>
    </div>
    <div v-if="cloudDriveData?.connections?.length" class="module-panel" style="margin-top: var(--space-4);">
      <div class="module-panel-heading">
        <strong>已连接云盘</strong>
        <span>{{ cloudDriveData.connections.length }} 个</span>
      </div>
      <div class="ws-id-list">
        <div v-for="drive in cloudDriveData.connections" :key="drive.driveRef" class="ws-chain-item" style="justify-content: space-between;">
          <code>{{ drive.driveRef.slice(0, 22) }}</code>
          <span>{{ drive.provider }} · {{ drive.mode }} · {{ drive.directoryMappingCount || 0 }} 个目录</span>
          <StatusPill :tone="drive.contractVerified ? 'info' : 'success'" :label="drive.contractVerified ? 'contractVerified' : 'localAdapterVerified'" />
        </div>
      </div>
    </div>
    <pre v-if="cloudDriveResult" class="config-json-preview" style="margin-top: var(--space-3);">{{ JSON.stringify(cloudDriveResult, null, 2) }}</pre>
  </div>
</template>
