import { inject, provide, type InjectionKey } from "vue";
import type { useWorkspacesConsole } from "./useWorkspacesConsole";

export type WorkspacesViewContext = ReturnType<typeof useWorkspacesConsole>;

const workspacesViewKey = Symbol("workspaces-view") as InjectionKey<WorkspacesViewContext>;

export function provideWorkspacesView(context: WorkspacesViewContext) {
  provide(workspacesViewKey, context);
}

export function useWorkspacesViewContext() {
  const context = inject(workspacesViewKey);
  if (!context) {
    throw new Error("Workspaces view context is not available");
  }
  return context;
}
