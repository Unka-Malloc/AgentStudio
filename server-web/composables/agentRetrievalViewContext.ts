import { inject, provide, type InjectionKey } from "vue";
import type { useDebugViewConsole } from "./useDebugViewConsole";

type DebugViewConsole = ReturnType<typeof useDebugViewConsole>;

const agentRetrievalViewContextKeys = [
  "agentRetrievalAnswer",
  "agentRetrievalForm",
  "agentRetrievalPage",
  "agentRetrievalProgress",
  "agentRetrievalTabs",
  "agentRetrievalTrace",
  "agentRetrievalWorkspace",
] as const satisfies readonly (keyof DebugViewConsole)[];

type AgentRetrievalViewContextKey = (typeof agentRetrievalViewContextKeys)[number];

export type AgentRetrievalViewContext = Pick<DebugViewConsole, AgentRetrievalViewContextKey>;

export function createAgentRetrievalViewContext(debugView: DebugViewConsole): AgentRetrievalViewContext {
  return Object.fromEntries(agentRetrievalViewContextKeys.map((key) => [key, debugView[key]])) as AgentRetrievalViewContext;
}

const agentRetrievalViewKey = Symbol("agent-retrieval-view") as InjectionKey<AgentRetrievalViewContext>;

export function provideAgentRetrievalView(context: AgentRetrievalViewContext) {
  provide(agentRetrievalViewKey, context);
}

export function useAgentRetrievalViewContext() {
  const context = inject(agentRetrievalViewKey);
  if (!context) {
    throw new Error("Agent retrieval view context is not available");
  }
  return context;
}
