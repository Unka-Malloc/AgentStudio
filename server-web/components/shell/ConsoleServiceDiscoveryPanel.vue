<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";
import {
  normalizeServerAddressUrl,
  probeServerAddressUrl,
  readStoredServerAddresses,
  uniqueServerAddressStrings,
  writeStoredServerAddresses,
} from "../../lib/console-server-addresses";

type ServerAddressValidationStatus = "idle" | "checking" | "available" | "unavailable";

type ServerAddressRow = {
  id: string;
  url: string;
  validationStatus: ServerAddressValidationStatus;
  validationMessage: string;
};

const {
  busyKey,
  consoleState,
  discoveryDraft,
  error,
  msg,
  serverAvailable,
} = useServerConsoleShellContext();

let serverAddressRowSequence = 0;

const serviceIdDisplay = computed(() => discoveryDraft.value.serverId || msg.value.drawer.autoDetected);
const serviceLabelDisplay = computed(() => discoveryDraft.value.serverLabel || msg.value.drawer.autoDetected);

const serverAddressRows = ref<ServerAddressRow[]>([]);
const selectedServerUrl = ref("");
const localSaveMessage = ref("");

const currentDiscoveryUrl = computed(() =>
  discoveryDraft.value.activeServiceUrl ||
  discoveryDraft.value.advertisedBaseUrl ||
  discoveryDraft.value.bootstrapBaseUrl ||
  consoleState.value?.server.url ||
  "",
);

const connectedServerUrl = computed(() =>
  serverAvailable.value ? normalizeServerAddressUrl(consoleState.value?.server.url || currentDiscoveryUrl.value) : "",
);

const selectedServerAddressRow = computed(() => {
  const selectedUrl = normalizeServerAddressUrl(selectedServerUrl.value);
  if (!selectedUrl) {
    return null;
  }
  return serverAddressRows.value.find((row) => normalizeServerAddressUrl(row.url) === selectedUrl) || null;
});

function persistServerAddressRows() {
  const addresses = uniqueServerAddressStrings(
    serverAddressRows.value.map((row) => row.url.trim()).filter(Boolean),
  );
  writeStoredServerAddresses({
    activeUrl: selectedServerUrl.value.trim(),
    addresses,
  });
}

function createServerAddressRow(
  url = "",
  validationStatus: ServerAddressValidationStatus = "idle",
  validationMessage = "",
): ServerAddressRow {
  serverAddressRowSequence += 1;
  return {
    id: `server-address-${Date.now()}-${serverAddressRowSequence}`,
    url,
    validationStatus,
    validationMessage,
  };
}

function hydrateServerAddressRows() {
  const stored = readStoredServerAddresses();
  const currentUrl = normalizeServerAddressUrl(currentDiscoveryUrl.value);
  const storedActiveUrl = normalizeServerAddressUrl(stored.activeUrl);
  const activeUrl = storedActiveUrl || currentUrl;
  const existingRows = new Map(
    serverAddressRows.value
      .map((row) => [normalizeServerAddressUrl(row.url), row] as const)
      .filter(([url]) => Boolean(url)),
  );
  const addresses = uniqueServerAddressStrings([
    ...stored.addresses,
    ...(currentUrl ? [currentUrl] : []),
    ...(activeUrl ? [activeUrl] : []),
  ]);

  serverAddressRows.value = (addresses.length ? addresses : [""]).map((address) => {
    const normalizedAddress = normalizeServerAddressUrl(address);
    const existingRow = normalizedAddress ? existingRows.get(normalizedAddress) : null;
    const isConnectedAddress =
      Boolean(normalizedAddress) &&
      normalizedAddress === connectedServerUrl.value &&
      serverAvailable.value;

    if (existingRow) {
      if (isConnectedAddress) {
        existingRow.validationStatus = "available";
        existingRow.validationMessage = "当前已连接";
      }
      return existingRow;
    }

    return createServerAddressRow(
      address,
      isConnectedAddress ? "available" : "idle",
      isConnectedAddress ? "当前已连接" : "",
    );
  });

  selectedServerUrl.value = activeUrl || normalizeServerAddressUrl(serverAddressRows.value[0]?.url);
}

function addServerAddressRow() {
  serverAddressRows.value.push(createServerAddressRow());
  localSaveMessage.value = "";
  persistServerAddressRows();
}

function removeServerAddressRow(row: ServerAddressRow) {
  if (serverAddressRows.value.length <= 1) {
    return;
  }

  const removedUrl = normalizeServerAddressUrl(row.url);
  const wasSelected = Boolean(removedUrl && removedUrl === normalizeServerAddressUrl(selectedServerUrl.value));
  serverAddressRows.value = serverAddressRows.value.filter((item) => item.id !== row.id);
  if (wasSelected) {
    selectedServerUrl.value = normalizeServerAddressUrl(serverAddressRows.value[0]?.url) || "";
  }

  localSaveMessage.value = "已删除服务端地址。";
  persistServerAddressRows();
}

function handleAddressInput(row: ServerAddressRow) {
  const normalizedSelectedUrl = normalizeServerAddressUrl(selectedServerUrl.value);
  const normalizedRowUrl = normalizeServerAddressUrl(row.url);

  if (!normalizedRowUrl || normalizedRowUrl !== normalizedSelectedUrl) {
    row.validationStatus = "idle";
    row.validationMessage = "";
  }
  if (normalizedSelectedUrl && normalizedRowUrl !== normalizedSelectedUrl && selectedServerAddressRow.value === row) {
    selectedServerUrl.value = "";
  }

  localSaveMessage.value = "";
  persistServerAddressRows();
}

function isSelectedServerAddress(row: ServerAddressRow) {
  const selectedUrl = normalizeServerAddressUrl(selectedServerUrl.value);
  return Boolean(selectedUrl) && normalizeServerAddressUrl(row.url) === selectedUrl;
}

function canSwitchServerAddress(row: ServerAddressRow) {
  if (isSelectedServerAddress(row)) {
    return true;
  }
  return row.validationStatus === "available" && Boolean(normalizeServerAddressUrl(row.url));
}

function switchButtonTitle(row: ServerAddressRow) {
  if (isSelectedServerAddress(row)) {
    return "当前绑定";
  }
  if (!normalizeServerAddressUrl(row.url)) {
    return "请输入有效的服务端地址";
  }
  if (row.validationStatus !== "available") {
    return "验证通过后才能切换";
  }
  return "切换到此服务端地址";
}

function selectServerAddress(row: ServerAddressRow) {
  if (!canSwitchServerAddress(row)) {
    row.validationMessage = "验证通过后才能切换";
    localSaveMessage.value = "";
    return;
  }

  const nextUrl = normalizeServerAddressUrl(row.url);
  if (!nextUrl) {
    row.validationStatus = "unavailable";
    row.validationMessage = "地址格式无效";
    return;
  }

  selectedServerUrl.value = nextUrl;
  localSaveMessage.value = "已切换本页绑定地址。";
  persistServerAddressRows();
}

function validationStatusLabel(row: ServerAddressRow) {
  if (row.validationStatus === "checking") {
    return "验证中";
  }
  if (row.validationStatus === "available") {
    return "可用";
  }
  if (row.validationStatus === "unavailable") {
    return "不可用";
  }
  return "未验证";
}

function validationStatusTone(row: ServerAddressRow) {
  if (row.validationStatus === "available") {
    return "success";
  }
  if (row.validationStatus === "unavailable") {
    return "danger";
  }
  if (row.validationStatus === "checking") {
    return "warning";
  }
  return "neutral";
}

function sameAsCurrentConnectedBackend(nextUrl: string) {
  return Boolean(nextUrl && connectedServerUrl.value && nextUrl === connectedServerUrl.value);
}

async function validateServerAddress(row: ServerAddressRow) {
  const nextUrl = normalizeServerAddressUrl(row.url);
  localSaveMessage.value = "";

  if (!nextUrl) {
    row.validationStatus = "unavailable";
    row.validationMessage = "地址格式无效";
    persistServerAddressRows();
    return;
  }

  if (sameAsCurrentConnectedBackend(nextUrl)) {
    row.validationStatus = "available";
    row.validationMessage = "当前已连接";
    persistServerAddressRows();
    return;
  }

  row.validationStatus = "checking";
  row.validationMessage = "正在验证";

  if (await probeServerAddressUrl(nextUrl)) {
    row.url = nextUrl;
    row.validationStatus = "available";
    row.validationMessage = "验证通过";
  } else {
    row.validationStatus = "unavailable";
    row.validationMessage = "无法连接";
  }
  persistServerAddressRows();
}

function saveServerDiscovery() {
  const selectedRow = selectedServerAddressRow.value;
  const selectedUrl = normalizeServerAddressUrl(selectedRow?.url || selectedServerUrl.value);

  error.value = "";
  persistServerAddressRows();

  if (!selectedUrl || !selectedRow || selectedRow.validationStatus !== "available") {
    localSaveMessage.value = "已保存到本浏览器；地址验证通过后才能切换。";
    return;
  }

  selectedServerUrl.value = selectedUrl;
  persistServerAddressRows();
  localSaveMessage.value = "已保存本页绑定地址。";
}

watch(
  [currentDiscoveryUrl, connectedServerUrl, serverAvailable],
  hydrateServerAddressRows,
  { immediate: true },
);
</script>

<template>
  <form class="drawer-panel" @submit.prevent="saveServerDiscovery">
    <div class="panel-header">
      <h4>{{ msg.drawer.serviceDiscovery }}</h4>
    </div>

    <div class="form-grid">
      <label>
        <span>{{ msg.drawer.serviceId }}</span>
        <input :value="serviceIdDisplay" autocomplete="off" readonly />
      </label>
      <label>
        <span>{{ msg.drawer.serviceLabel }}</span>
        <input :value="serviceLabelDisplay" autocomplete="off" readonly />
      </label>
    </div>

    <section class="server-address-manager">
      <div class="server-address-heading">
        <span>{{ msg.drawer.serverUrl }}</span>
      </div>

      <div class="server-address-list">
        <div
          v-for="(row, index) in serverAddressRows"
          :key="row.id"
          class="server-address-row"
          :class="{ 'is-selected': isSelectedServerAddress(row) }"
        >
          <button
            class="server-address-icon-button server-address-switch-button"
            type="button"
            :class="{ active: isSelectedServerAddress(row) }"
            :disabled="!canSwitchServerAddress(row)"
            :title="switchButtonTitle(row)"
            :aria-label="switchButtonTitle(row)"
            @click="selectServerAddress(row)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 4 4 10-10" />
            </svg>
          </button>

          <div class="server-address-input-wrap">
            <input
              v-model="row.url"
              autocomplete="off"
              placeholder="http://127.0.0.1:7228"
              @input="handleAddressInput(row)"
            />
            <span
              class="server-address-status-pill"
              :data-tone="validationStatusTone(row)"
            >
              {{ validationStatusLabel(row) }}
            </span>
          </div>

          <button
            class="server-address-validate-button"
            type="button"
            :disabled="row.validationStatus === 'checking' || !row.url.trim()"
            @click="validateServerAddress(row)"
          >
            {{ row.validationStatus === "checking" ? "验证中" : "验证" }}
          </button>

          <button
            v-if="index === 0"
            class="server-address-icon-button server-url-add-button"
            type="button"
            title="添加服务端地址"
            aria-label="添加服务端地址"
            @click="addServerAddressRow"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            v-else
            class="server-address-icon-button server-url-remove-button"
            type="button"
            title="删除服务端地址"
            aria-label="删除服务端地址"
            @click="removeServerAddressRow(row)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>

          <p v-if="row.validationMessage" class="server-address-row-message">
            {{ row.validationMessage }}
          </p>
        </div>
      </div>
    </section>

    <button
      class="tool-button"
      type="submit"
      :disabled="busyKey === 'discovery'"
    >
      {{ busyKey === "discovery" ? msg.drawer.saving : msg.drawer.saveDiscovery }}
    </button>
    <p v-if="localSaveMessage" class="server-address-save-message">
      {{ localSaveMessage }}
    </p>
  </form>
</template>

<style scoped>
.server-address-manager {
  display: grid;
  gap: var(--space-2);
}

.server-address-heading {
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-weight: 600;
}

.server-address-list {
  display: grid;
  gap: var(--space-2);
}

.server-address-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 64px 36px;
  gap: var(--space-2);
  align-items: center;
}

.server-address-input-wrap {
  position: relative;
  min-width: 0;
}

.server-address-input-wrap input {
  width: 100%;
  min-width: 0;
  padding-right: 72px;
}

.server-address-icon-button,
.server-address-validate-button {
  min-height: 36px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-weight: 700;
  transition:
    background var(--dur-fast) var(--ease-std),
    border-color var(--dur-fast) var(--ease-std),
    color var(--dur-fast) var(--ease-std),
    transform var(--dur-fast) var(--ease-std),
    box-shadow var(--dur-fast) var(--ease-std);
}

.server-address-icon-button {
  display: inline-flex;
  width: 36px;
  min-width: 36px;
  padding: 0;
  align-items: center;
  justify-content: center;
}

.server-address-icon-button svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.server-address-icon-button:hover,
.server-address-validate-button:hover {
  border-color: var(--border-strong);
  background: var(--bg-subtle);
  color: var(--text-primary);
}

.server-address-icon-button.active {
  border-color: var(--brand);
  background: var(--brand-subtle);
  color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand-ring);
}

.server-url-remove-button:hover {
  border-color: var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger);
}

.server-address-icon-button:disabled,
.server-address-validate-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.server-address-status-pill {
  position: absolute;
  top: 50%;
  right: 10px;
  display: inline-flex;
  min-width: 54px;
  min-height: 22px;
  padding: 0 8px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  transform: translateY(-50%);
  pointer-events: none;
}

.server-address-status-pill[data-tone="success"] {
  border-color: var(--success-border);
  background: var(--success-surface);
  color: var(--success);
}

.server-address-status-pill[data-tone="danger"] {
  border-color: var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger);
}

.server-address-status-pill[data-tone="warning"] {
  border-color: var(--warning-border);
  background: var(--warning-surface);
  color: var(--warning);
}

.server-address-row-message {
  grid-column: 2 / -1;
  margin: -2px 0 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-snug);
}

.server-address-save-message {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

@media (max-width: 760px) {
  .server-address-row {
    grid-template-columns: 36px minmax(0, 1fr) 36px;
  }

  .server-address-validate-button {
    grid-column: 2 / 3;
    justify-self: start;
    width: 78px;
  }

  .server-url-add-button,
  .server-url-remove-button {
    grid-column: 3 / 4;
    grid-row: 1 / 2;
  }
}
</style>
