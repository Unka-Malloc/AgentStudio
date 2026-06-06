import { inject, provide, type InjectionKey } from "vue";
import type { ServerConsoleShellContext } from "./serverConsoleShellContext";

const consoleSideNavContextKeys = [
  "activeRouteAdminView",
  "activeRouteDebugTab",
  "activeRouteExternalServiceTab",
  "activeRouteKnowledgeTab",
  "activeRouteView",
  "consoleState",
  "hasAnyFeature",
  "hasFeature",
  "isAuthenticated",
  "jumpToKnowledgeFileImport",
  "knowledgeManagementPanel",
  "localizedDebugTabLabel",
  "localizedExternalServiceTabLabel",
  "localizedKnowledgeTabLabel",
  "msg",
  "openAdmin",
  "openDebugTab",
  "openDrawer",
  "openExternalServiceTab",
  "openKnowledgeManagementPanel",
  "openKnowledgeTab",
  "sideNavOpen",
  "switchView",
  "visibleDebugTabs",
  "visibleKnowledgeTabs",
] as const;

type ConsoleSideNavContextKey = (typeof consoleSideNavContextKeys)[number];

export type ConsoleSideNavContext = Pick<ServerConsoleShellContext, ConsoleSideNavContextKey>;

export function createConsoleSideNavContext(shell: ServerConsoleShellContext): ConsoleSideNavContext {
  return Object.fromEntries(consoleSideNavContextKeys.map((key) => [key, shell[key]])) as ConsoleSideNavContext;
}

const consoleSideNavKey = Symbol("console-side-nav") as InjectionKey<ConsoleSideNavContext>;

export function provideConsoleSideNavContext(context: ConsoleSideNavContext) {
  provide(consoleSideNavKey, context);
}

export function useConsoleSideNavContext() {
  const context = inject(consoleSideNavKey);
  if (!context) {
    throw new Error("Console side nav context is not available");
  }
  return context;
}
