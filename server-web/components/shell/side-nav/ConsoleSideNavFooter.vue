<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";

defineOptions({ name: "ConsoleSideNavFooter" });

const { msg, openDrawer, sideNavOpen } = useConsoleSideNavContext();

function openPreferences() {
  sideNavOpen.value = false;
  openDrawer("preferences");
}
</script>

<template>
  <div class="side-nav-footer">
    <button class="side-cta" type="button" @click="openPreferences">
      <span class="side-cta-label">{{ msg.nav.systemConfig }}</span>
    </button>
  </div>
</template>
