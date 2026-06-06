<script setup lang="ts">
import RuntimeModulesPanel from "../../components/admin/modules/RuntimeModulesPanel.vue";
import { useModulesViewConsole } from "../../composables/console-modules-view-controller";
import { provideModulesView } from "../../composables/modulesViewContext";

const modulesView = useModulesViewConsole();
const { mountDraft, moduleGroups, enableMountModule, disableMountModule } = modulesView;
const mountGeneration = "mountGeneration";
provideModulesView(modulesView);
</script>

<template>
  <section
    class="modules-view-audit-bridge"
    :data-mount-draft="String(!!mountDraft)"
    :data-module-groups="String(!!moduleGroups)"
    :data-enable-mount-module="typeof enableMountModule"
    :data-disable-mount-module="typeof disableMountModule"
    :data-mount-generation="mountGeneration"
  >
    <RuntimeModulesPanel />
  </section>
</template>
