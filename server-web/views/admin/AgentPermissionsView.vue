<script setup lang="ts">
import AuthorizationGovernanceCard from "../../components/admin/AuthorizationGovernanceCard.vue";
import AgentPermissionGroupsPanel from "../../components/admin/agent-permissions/AgentPermissionGroupsPanel.vue";
import GrantToolRulePanel from "../../components/admin/agent-permissions/GrantToolRulePanel.vue";
import ToolGrantCreateCard from "../../components/admin/agent-permissions/ToolGrantCreateCard.vue";
import ToolGrantListCard from "../../components/admin/agent-permissions/ToolGrantListCard.vue";
import ToolPolicyPreviewPanel from "../../components/admin/agent-permissions/ToolPolicyPreviewPanel.vue";
import { provideAgentPermissionsView } from "../../composables/agentPermissionsViewContext";
import { useAgentPermissionsViewConsole } from "../../composables/console-agent-permissions-view-controller";

const agentPermissionsView = useAgentPermissionsViewConsole();
provideAgentPermissionsView(agentPermissionsView);
</script>

<template>
  <section class="agent-permissions-layout">
    <AuthorizationGovernanceCard />
    <AgentPermissionGroupsPanel />
    <ToolGrantCreateCard />
    <ToolGrantListCard />
    <GrantToolRulePanel />
    <ToolPolicyPreviewPanel />
  </section>
</template>
