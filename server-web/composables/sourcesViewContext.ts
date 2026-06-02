import { inject, provide, type InjectionKey } from "vue";
import type { ServerConsoleShellContext } from "./serverConsoleShellContext";

const sourcesViewContextKeys = [
  "activeKnowledgeSources",
  "addKnowledgeSource",
  "busyKey",
  "canBrowseServerPaths",
  "canWriteJobs",
  "deleteKnowledgeSource",
  "localSourceForm",
  "openAdmin",
  "openLocalSourceDirectoryPicker",
  "refreshKnowledgeSource",
  "refreshKnowledgeSources",
  "syncLocalSourceLabelFromPath",
  "updateKnowledgeSource",
] as const;

type SourcesViewContextKey = (typeof sourcesViewContextKeys)[number];

export type SourcesViewContext = Pick<ServerConsoleShellContext, SourcesViewContextKey>;

export function createSourcesViewContext(shell: ServerConsoleShellContext): SourcesViewContext {
  return Object.fromEntries(sourcesViewContextKeys.map((key) => [key, shell[key]])) as SourcesViewContext;
}

const sourcesViewKey = Symbol("sources-view") as InjectionKey<SourcesViewContext>;

export function provideSourcesView(context: SourcesViewContext) {
  provide(sourcesViewKey, context);
}

export function useSourcesViewContext() {
  const context = inject(sourcesViewKey);
  if (!context) {
    throw new Error("Sources view context is not available");
  }
  return context;
}
