<script setup lang="ts">
import ConfigFoldCard from "../ConfigFoldCard.vue";
import StatusPill from "../StatusPill.vue";
import { useWorkspacesViewContext } from "../../composables/workspacesViewContext";

const {
  busyKey,
  cloudDriveData,
  codespaceData,
  localDirMountData,
  openCloudDrive,
  openCodespace,
  openLocalDir,
  syncLocalDirectory,
} = useWorkspacesViewContext();
</script>

<template>
  <ConfigFoldCard title="本机目录 mount（v0.0.1）">
    <div class="checkpoint-toolbar">
      <div>
        <strong>{{ localDirMountData?.count ?? 0 }} 个受控目录</strong>
      </div>
      <button class="table-action" type="button" :disabled="!!busyKey" @click="openLocalDir">连接目录</button>
    </div>
    <div v-if="localDirMountData?.mounts?.length" class="ws-id-list workspace-stack-list">
      <div v-for="mount in localDirMountData.mounts" :key="mount.mountRef" class="ws-chain-item workspace-resource-row">
        <code>{{ mount.mountRef.slice(0, 22) }}</code>
        <span>{{ mount.sourceRootName }} -> {{ mount.targetPath || '根目录' }}</span>
        <StatusPill :tone="mount.status === 'active' ? 'success' : 'neutral'" :label="mount.status" />
        <button class="table-action" type="button" :disabled="!!busyKey" @click="syncLocalDirectory(mount)">
          {{ busyKey === `ws:local-dir-sync:${mount.mountRef}` ? '同步中…' : '同步' }}
        </button>
      </div>
    </div>
    <div v-else class="checkpoint-empty">当前工作空间还没有连接本机目录。</div>
  </ConfigFoldCard>

  <ConfigFoldCard title="云盘 Cloud Drive（v0.0.1）">
    <div class="checkpoint-toolbar">
      <div>
        <strong>{{ cloudDriveData?.connectedProviderCount ?? 0 }} / {{ cloudDriveData?.providerCount ?? 0 }} 个 provider 已连接</strong>
      </div>
      <button class="table-action" type="button" :disabled="!!busyKey" @click="openCloudDrive">打开工作台</button>
    </div>
    <div v-if="cloudDriveData?.connections?.length" class="ws-id-list workspace-stack-list">
      <div v-for="drive in cloudDriveData.connections" :key="drive.driveRef" class="ws-chain-item workspace-resource-row">
        <code>{{ drive.driveRef.slice(0, 22) }}</code>
        <span>{{ drive.provider }} · {{ drive.mode }} · {{ drive.rootName || drive.secretRef }}</span>
        <StatusPill :tone="drive.contractVerified ? 'info' : 'success'" :label="drive.contractVerified ? 'contractVerified' : 'localAdapterVerified'" />
      </div>
    </div>
    <div v-else class="checkpoint-empty">当前工作空间还没有连接云盘。</div>
  </ConfigFoldCard>

  <ConfigFoldCard title="代码库 Codespace（v0.0.1）">
    <div class="checkpoint-toolbar">
      <div>
        <strong>{{ codespaceData?.enabledProviderCount ?? 0 }} / {{ codespaceData?.providerCount ?? 0 }} 个 provider 可用</strong>
      </div>
      <button class="table-action" type="button" :disabled="!!busyKey" @click="openCodespace">打开工作台</button>
    </div>
    <div v-if="codespaceData?.providers" class="ws-id-list workspace-stack-list">
      <div v-for="provider in codespaceData.providers" :key="provider.provider" class="ws-chain-item workspace-resource-row">
        <code>{{ provider.provider }}</code>
        <span>{{ provider.mode }} · {{ provider.secretRef }}</span>
        <StatusPill :tone="provider.enabled ? 'success' : 'neutral'" :label="provider.enabled ? 'enabled' : 'disabled'" />
      </div>
    </div>
    <div v-else class="checkpoint-empty">Codespace provider manifest 尚未加载。</div>
  </ConfigFoldCard>
</template>
