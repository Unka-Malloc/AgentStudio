<script setup lang="ts">
import OptionBar from "../OptionBar.vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  busyKey,
  discoveryDraft,
  discoveryModeOptionBarOptions,
  msg,
  saveDiscovery,
} = useServerConsoleShellContext();
</script>

<template>
  <form class="drawer-panel" @submit.prevent="saveDiscovery">
    <div class="panel-header">
      <h4>{{ msg.drawer.serviceDiscovery }}</h4>
    </div>

    <div class="form-grid">
      <label>
        <span>{{ msg.drawer.serviceId }}</span>
        <input v-model="discoveryDraft.serverId" autocomplete="off" />
      </label>
      <label>
        <span>{{ msg.drawer.serviceLabel }}</span>
        <input v-model="discoveryDraft.serverLabel" autocomplete="off" />
      </label>
      <label>
        <span>{{ msg.drawer.bootstrapUrl }}</span>
        <input
          v-model="discoveryDraft.bootstrapBaseUrl"
          autocomplete="off"
        />
      </label>
      <label>
        <span>{{ msg.drawer.advertisedUrl }}</span>
        <input
          v-model="discoveryDraft.advertisedBaseUrl"
          autocomplete="off"
        />
      </label>
      <label>
        <span>{{ msg.drawer.activeUrl }}</span>
        <input
          v-model="discoveryDraft.activeServiceUrl"
          autocomplete="off"
        />
      </label>
      <label>
        <span>{{ msg.drawer.forwardUrl }}</span>
        <input
          v-model="discoveryDraft.forwardBaseUrl"
          autocomplete="off"
        />
      </label>
      <OptionBar
        v-model="discoveryDraft.mode"
        :label="msg.drawer.mode"
        :options="discoveryModeOptionBarOptions"
      />
      <label>
        <span>{{ msg.drawer.configVersion }}</span>
        <input
          v-model="discoveryDraft.configVersion"
          autocomplete="off"
        />
      </label>
      <label>
        <span>{{ msg.drawer.refreshSeconds }}</span>
        <input
          v-model.number="discoveryDraft.refreshIntervalSeconds"
          min="5"
          type="number"
        />
      </label>
      <label>
        <span>{{ msg.drawer.checkInSeconds }}</span>
        <input
          v-model.number="discoveryDraft.checkInIntervalSeconds"
          min="5"
          type="number"
        />
      </label>
      <label>
        <span>{{ msg.drawer.offlineSeconds }}</span>
        <input
          v-model.number="discoveryDraft.offlineAfterSeconds"
          min="30"
          type="number"
        />
      </label>
    </div>

    <button
      class="tool-button"
      type="submit"
      :disabled="busyKey === 'discovery'"
    >
      {{ busyKey === "discovery" ? msg.drawer.saving : msg.drawer.saveDiscovery }}
    </button>
  </form>
</template>
