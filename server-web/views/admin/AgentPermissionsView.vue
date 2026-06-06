<script setup lang="ts">
import { computed, ref } from "vue";
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

type PermissionWorkspaceSection = "groups" | "tokens" | "governance" | "verify";

const activeSection = ref<PermissionWorkspaceSection>("groups");
const workspaceSections: { id: PermissionWorkspaceSection; label: string; description: string }[] = [
  { id: "groups", label: "权限组", description: "维护智能体可调用范围" },
  { id: "tokens", label: "工具令牌", description: "创建、轮换、撤销网关授权" },
  { id: "governance", label: "治理", description: "团队、用户、智能体绑定" },
  { id: "verify", label: "验证", description: "预览一次策略裁决" },
];

const activeSectionHelp = computed(() => {
  switch (activeSection.value) {
    case "groups":
      return "原来的权限范围和工具集没有删除：先在左侧选择权限组，再到右侧的“权限范围”“工具集”“单工具例外”子页查看和维护。未单独列出的工具会继承工具集规则。";
    case "tokens":
      return "原来的工具令牌集中在这里：创建入口在上方，已有令牌在“工具令牌”列表，每条令牌的权限范围和工具集收在自己的展开区，工具级覆盖在“令牌工具例外”。";
    case "governance":
      return "团队、用户策略、智能体绑定和审批仍在治理页；这里影响最终裁决上限，不替代权限组或工具令牌。";
    case "verify":
      return "策略验证只做一次模拟裁决，不会修改权限组、令牌或治理配置。";
    default:
      return "";
  }
});
</script>

<template>
  <section class="agent-permissions-layout">
    <article class="surface-card agent-permissions-command">
      <div class="section-header">
        <div>
          <h2>权限组</h2>
          <p>先选中一个权限组，查看它的权限范围、工具集和单工具例外；工具令牌、治理和验证放在次级入口。</p>
        </div>
      </div>
      <div class="agent-permissions-tabs" role="tablist" aria-label="权限组页面区块">
        <button
          v-for="section in workspaceSections"
          :key="section.id"
          class="drawer-tab"
          :class="{ active: activeSection === section.id }"
          type="button"
          role="tab"
          :aria-selected="activeSection === section.id"
          @click="activeSection = section.id"
        >
          <strong>{{ section.label }}</strong>
          <span>{{ section.description }}</span>
        </button>
      </div>
      <div class="agent-permissions-location-note">
        {{ activeSectionHelp }}
      </div>
    </article>

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
