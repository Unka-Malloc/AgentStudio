<script setup lang="ts">
import ConsoleAuthUsersPanel from "./ConsoleAuthUsersPanel.vue";
import ConsolePreferencesPanel from "./ConsolePreferencesPanel.vue";
import ConsoleServiceDiscoveryPanel from "./ConsoleServiceDiscoveryPanel.vue";
import ConsoleSyncDirectoriesPanel from "./ConsoleSyncDirectoriesPanel.vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  closeDrawer,
  drawerOpen,
  drawerTab,
  hasFeature,
  isAuthenticated,
  msg,
  openDrawer,
} = useServerConsoleShellContext();
</script>

<template>
  <div v-if="isAuthenticated && drawerOpen" class="drawer-backdrop" @click="closeDrawer()"></div>

  <aside v-if="isAuthenticated" class="config-drawer" :class="{ open: drawerOpen }">
    <header class="drawer-header">
      <div>
        <h3>{{ msg.drawer.title }}</h3>
      </div>
      <button
        class="tool-button tool-button-ghost"
        type="button"
        @click="closeDrawer()"
      >
        {{ msg.close }}
      </button>
    </header>

    <div class="drawer-tabs">
      <button
        class="drawer-tab"
        :class="{ active: drawerTab === 'preferences' }"
        type="button"
        @click="openDrawer('preferences')"
      >
        {{ msg.drawer.preferences }}
      </button>
      <button
        class="drawer-tab"
        :class="{ active: drawerTab === 'discovery' }"
        type="button"
        @click="openDrawer('discovery')"
      >
        {{ msg.drawer.serviceDiscovery }}
      </button>
      <button
        v-if="hasFeature('analysis-runtime')"
        class="drawer-tab"
        :class="{ active: drawerTab === 'users' }"
        type="button"
        @click="openDrawer('users')"
      >
        {{ msg.drawer.users }}
      </button>
      <button
        v-if="hasFeature('knowledge-core')"
        class="drawer-tab"
        :class="{ active: drawerTab === 'syncDirectories' }"
        type="button"
        @click="openDrawer('syncDirectories')"
      >
        {{ msg.drawer.directories }}
      </button>
    </div>

    <div class="drawer-content">
      <ConsolePreferencesPanel v-if="drawerTab === 'preferences'" />
      <ConsoleServiceDiscoveryPanel v-else-if="drawerTab === 'discovery'" />
      <ConsoleAuthUsersPanel v-else-if="drawerTab === 'users'" />
      <ConsoleSyncDirectoriesPanel v-else-if="drawerTab === 'syncDirectories' && hasFeature('knowledge-core')" />
    </div>
  </aside>
</template>
