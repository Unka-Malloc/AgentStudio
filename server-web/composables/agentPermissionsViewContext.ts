import { inject, provide, type InjectionKey } from "vue";
import type { useAgentPermissionsViewConsole } from "./console-agent-permissions-view-controller";

export type AgentPermissionsViewContext = ReturnType<typeof useAgentPermissionsViewConsole>;

const agentPermissionsViewKey = Symbol("agent-permissions-view") as InjectionKey<AgentPermissionsViewContext>;

export function provideAgentPermissionsView(context: AgentPermissionsViewContext) {
  provide(agentPermissionsViewKey, context);
}

export function useAgentPermissionsViewContext() {
  const context = inject(agentPermissionsViewKey);
  if (!context) {
    throw new Error("Agent permissions view context is not available");
  }
  return context;
}
