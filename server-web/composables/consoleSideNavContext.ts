import { computed, inject, onBeforeUnmount, provide, ref, watch, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type { ServerConsoleShellContext } from "./serverConsoleShellContext";
import type { AppView } from "../types/app";

const consoleSideNavContextKeys = [
  "activeRouteAdminView",
  "activeRouteDebugTab",
  "activeRouteExternalServiceTab",
  "activeRouteKnowledgeTab",
  "activeRouteView",
  "activeKnowledgeSources",
  "appearancePresetId",
  "appearanceCycleScheme",
  "appearanceCycleSchemeLabel",
  "appearancePresetLabel",
  "approvalFlowConsole",
  "consoleState",
  "cycleAppearancePreset",
  "feedConsole",
  "hasAnyFeature",
  "hasFeature",
  "isAuthenticated",
  "jumpToKnowledgeFileImport",
  "knowledgeManagementPanel",
  "languageMode",
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
  "refreshKnowledgeSources",
  "sideNavCollapsed",
  "sideNavOpen",
  "switchView",
  "toggleLanguage",
  "toggleAppearanceCycleScheme",
  "tt",
  "visibleDebugTabs",
  "visibleKnowledgeTabs",
  "workspacesConsole",
] as const;

type ConsoleSideNavContextKey = (typeof consoleSideNavContextKeys)[number];

type SideNavDirectoryView = Extract<AppView, "feed" | "approval" | "sources" | "workspaces">;

const sideNavDirectoryViews = new Set<AppView>(["feed", "approval", "sources", "workspaces"]);

function isSideNavDirectoryView(view: unknown): view is SideNavDirectoryView {
  return sideNavDirectoryViews.has(view as AppView);
}

export type ConsoleSideNavContext = Pick<ServerConsoleShellContext, ConsoleSideNavContextKey> & {
  activeSideNavDirectory: ComputedRef<SideNavDirectoryView | "">;
  openSideNavDirectory: (view: AppView) => void;
  returnToPrimarySideNav: () => void;
  setSideNavWidth: (width: number) => void;
  setSideNavDirectoryWidth: (width: number) => void;
  showSideNavDirectory: ComputedRef<boolean>;
  sideNavMinWidth: number;
  sideNavDirectoryMinWidth: number;
  sideNavWidth: Ref<number>;
  sideNavDirectoryWidth: Ref<number>;
};

const SIDE_NAV_MIN_WIDTH = 200;
const SIDE_NAV_DEFAULT_WIDTH = 220;
const SIDE_NAV_WIDTH_STORAGE_KEY = "pact:console:sideNavWidth";
const SIDE_NAV_DIRECTORY_MIN_WIDTH = 220;
const SIDE_NAV_DIRECTORY_DEFAULT_WIDTH = SIDE_NAV_DIRECTORY_MIN_WIDTH;
const SIDE_NAV_DIRECTORY_NARROW_QUERY = "(max-width: 720px)";
const SIDE_NAV_DIRECTORY_WIDTH_STORAGE_KEY = "pact:console:sideNavDirectoryWidth";

function readInitialSideNavWidth() {
  if (typeof window === "undefined") {
    return SIDE_NAV_DEFAULT_WIDTH;
  }
  const stored = Number(window.localStorage.getItem(SIDE_NAV_WIDTH_STORAGE_KEY) || "");
  return Number.isFinite(stored) && stored >= SIDE_NAV_MIN_WIDTH
    ? stored
    : SIDE_NAV_DEFAULT_WIDTH;
}

function readInitialSideNavDirectoryWidth() {
  if (typeof window === "undefined") {
    return SIDE_NAV_DIRECTORY_DEFAULT_WIDTH;
  }
  const stored = Number(window.localStorage.getItem(SIDE_NAV_DIRECTORY_WIDTH_STORAGE_KEY) || "");
  return Number.isFinite(stored) && stored >= SIDE_NAV_DIRECTORY_MIN_WIDTH
    ? stored
    : SIDE_NAV_DIRECTORY_DEFAULT_WIDTH;
}

function isNarrowSideNavDirectoryViewport() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SIDE_NAV_DIRECTORY_NARROW_QUERY).matches
  );
}

export function createConsoleSideNavContext(shell: ServerConsoleShellContext): ConsoleSideNavContext {
  const sideNavDirectoryOpen = ref(false);
  const sideNavDirectoryNarrow = ref(isNarrowSideNavDirectoryViewport());
  const sideNavWidth = ref(readInitialSideNavWidth());
  const sideNavDirectoryWidth = ref(readInitialSideNavDirectoryWidth());
  const activeSideNavDirectory = computed<SideNavDirectoryView | "">(() => {
    const view = shell.activeRouteView.value;
    return isSideNavDirectoryView(view) ? view : "";
  });
  const showSideNavDirectory = computed(() => !!activeSideNavDirectory.value && sideNavDirectoryOpen.value);

  function resetSideNavDirectoryWidth() {
    sideNavDirectoryWidth.value = SIDE_NAV_DIRECTORY_MIN_WIDTH;
  }

  function syncSideNavDirectoryFromRoute(view: unknown) {
    const shouldOpen = isSideNavDirectoryView(view) && !sideNavDirectoryNarrow.value;
    sideNavDirectoryOpen.value = shouldOpen;
    if (shouldOpen) {
      resetSideNavDirectoryWidth();
    }
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mediaQuery = window.matchMedia(SIDE_NAV_DIRECTORY_NARROW_QUERY);
    const handleMediaQueryChange = () => {
      sideNavDirectoryNarrow.value = mediaQuery.matches;
    };

    handleMediaQueryChange();
    mediaQuery.addEventListener("change", handleMediaQueryChange);
    onBeforeUnmount(() => {
      mediaQuery.removeEventListener("change", handleMediaQueryChange);
    });
  }

  watch(
    [shell.activeRouteView, sideNavDirectoryNarrow],
    ([view]) => syncSideNavDirectoryFromRoute(view),
    { immediate: true },
  );

  function openSideNavDirectory(view: AppView) {
    const isDirectoryView = isSideNavDirectoryView(view);
    sideNavDirectoryOpen.value = isDirectoryView;
    if (isDirectoryView) {
      resetSideNavDirectoryWidth();
    }
  }

  function returnToPrimarySideNav() {
    sideNavDirectoryOpen.value = false;
  }

  function setSideNavWidth(width: number) {
    const nextWidth = Math.max(SIDE_NAV_MIN_WIDTH, Math.round(width));
    sideNavWidth.value = nextWidth;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDE_NAV_WIDTH_STORAGE_KEY, String(nextWidth));
    }
  }

  function setSideNavDirectoryWidth(width: number) {
    const nextWidth = Math.max(SIDE_NAV_DIRECTORY_MIN_WIDTH, Math.round(width));
    sideNavDirectoryWidth.value = nextWidth;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDE_NAV_DIRECTORY_WIDTH_STORAGE_KEY, String(nextWidth));
    }
  }

  return {
    ...Object.fromEntries(consoleSideNavContextKeys.map((key) => [key, shell[key]])) as Pick<
      ServerConsoleShellContext,
      ConsoleSideNavContextKey
    >,
    activeSideNavDirectory,
    openSideNavDirectory,
    returnToPrimarySideNav,
    setSideNavWidth,
    setSideNavDirectoryWidth,
    showSideNavDirectory,
    sideNavMinWidth: SIDE_NAV_MIN_WIDTH,
    sideNavDirectoryMinWidth: SIDE_NAV_DIRECTORY_MIN_WIDTH,
    sideNavWidth,
    sideNavDirectoryWidth,
  };
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
