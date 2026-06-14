<script setup lang="ts">
import { computed, ref } from "vue";
import PactTabs, { type PactTab } from "../../components/PactTabs.vue";
import AuthorizationGovernanceCard from "../../components/admin/AuthorizationGovernanceCard.vue";
import AgentPermissionGroupsPanel from "../../components/admin/agent-permissions/AgentPermissionGroupsPanel.vue";
import GrantToolRulePanel from "../../components/admin/agent-permissions/GrantToolRulePanel.vue";
import ToolGrantCreateCard from "../../components/admin/agent-permissions/ToolGrantCreateCard.vue";
import ToolGrantListCard from "../../components/admin/agent-permissions/ToolGrantListCard.vue";
import ToolPolicyPreviewPanel from "../../components/admin/agent-permissions/ToolPolicyPreviewPanel.vue";
import { provideAgentPermissionsView } from "../../composables/agentPermissionsViewContext";
import { useAgentPermissionsViewConsole } from "../../composables/console-agent-permissions-view-controller";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../i18n/console";

const agentPermissionsView = useAgentPermissionsViewConsole();
provideAgentPermissionsView(agentPermissionsView);

const activeSection = ref("groups");

const locale = computed(() => resolveEffectiveConsoleLocale(currentConsoleLocale.value));
const sectionTabs = computed<PactTab[]>(() => [
  { key: "groups", label: localizeConsoleText("权限组", locale.value) },
  { key: "tokens", label: localizeConsoleText("工具令牌", locale.value) },
  { key: "governance", label: localizeConsoleText("治理", locale.value) },
  { key: "verify", label: localizeConsoleText("策略验证", locale.value) },
]);
</script>

<template>
  <section class="agent-permissions-layout">
    <header class="agent-permissions-header">
      <PactTabs v-model="activeSection" :tabs="sectionTabs" variant="line" size="default" />
    </header>

    <AgentPermissionGroupsPanel v-if="activeSection === 'groups'" />

    <section v-else-if="activeSection === 'tokens'" class="agent-permissions-stack">
      <ToolGrantCreateCard />
      <ToolGrantListCard />
      <GrantToolRulePanel />
    </section>

    <AuthorizationGovernanceCard v-else-if="activeSection === 'governance'" />

    <ToolPolicyPreviewPanel v-else />
  </section>
</template>
