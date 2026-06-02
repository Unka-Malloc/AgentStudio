import type { Ref } from "vue";
import type { DashboardAlert, RefreshStateOptions } from "../types/app";

type SilentRefreshOptions = {
  silent?: boolean;
};

type ConsoleAuthSessionSnapshot = {
  bootstrap: {
    required: boolean;
  };
  session: {
    authenticated: boolean;
  };
};

type ConsoleRuntimeLifecycleControllerOptions = {
  authBootstrapping: Ref<boolean>;
  clearBrowserLocalStateFromUrl: () => Promise<unknown>;
  clearConfigTargetHighlight: () => void;
  clearInfoFeedSummaryStreamTimer: () => void;
  clearPendingRefreshState: () => void;
  liveDashboardAlerts: Ref<DashboardAlert[]>;
  refreshAuthState: () => Promise<ConsoleAuthSessionSnapshot | null | undefined>;
  refreshCodexOAuthStatus: () => void | Promise<unknown>;
  refreshContextCompiler: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshKnowledgeConsole: () => void | Promise<void>;
  refreshMonitorAlerts: (options?: SilentRefreshOptions) => void | Promise<void>;
  refreshState: (options?: RefreshStateOptions) => void | Promise<void>;
  restoreAgentExploreState: () => void | Promise<void>;
  restoreInfoFeedHistory: () => void;
  startServerEventSubscription: () => void;
  stopAgentExplorePolling: () => void;
  stopAgentExploreSplitResize: () => void;
  stopCodexOAuthPolling: () => void;
  stopKnowledgeLogColumnResize: () => void;
  stopServerEventSubscription: () => void;
  syncDashboardAlertInbox: (items: DashboardAlert[]) => void;
};

export function createConsoleRuntimeLifecycleController(options: ConsoleRuntimeLifecycleControllerOptions) {
  let consoleLifecycleRefCount = 0;
  let consoleLifecycleInitInProgress: Promise<void> | null = null;
  let consoleLifecycleInitialized = false;

  async function bootstrapConsoleRuntime() {
    await options.clearBrowserLocalStateFromUrl();
    options.authBootstrapping.value = true;
    const session = await options.refreshAuthState();
    if (!session?.bootstrap.required && session?.session.authenticated) {
      await options.refreshState({ silent: true });
      await options.refreshMonitorAlerts({ silent: true });
      await options.refreshKnowledgeConsole();
      await options.refreshContextCompiler({ silent: true });
      await options.restoreAgentExploreState();
      options.restoreInfoFeedHistory();
      void options.refreshCodexOAuthStatus();
      options.startServerEventSubscription();
      options.syncDashboardAlertInbox(options.liveDashboardAlerts.value);
    }
  }

  function ensureConsoleRuntimeInitialized() {
    if (consoleLifecycleInitialized) {
      return;
    }
    if (consoleLifecycleInitInProgress) {
      return;
    }
    consoleLifecycleInitInProgress = (async () => {
      try {
        await bootstrapConsoleRuntime();
        consoleLifecycleInitialized = true;
      } catch (nextError) {
        consoleLifecycleInitialized = false;
        throw nextError;
      } finally {
        consoleLifecycleInitInProgress = null;
      }
    })();
  }

  function cleanupConsoleRuntime() {
    options.stopCodexOAuthPolling();
    options.stopAgentExplorePolling();
    options.stopAgentExploreSplitResize();
    options.stopKnowledgeLogColumnResize();
    options.clearInfoFeedSummaryStreamTimer();
    options.clearPendingRefreshState();
    options.clearConfigTargetHighlight();
    options.stopServerEventSubscription();
    consoleLifecycleInitialized = false;
    consoleLifecycleInitInProgress = null;
  }

  function mountConsoleRuntime() {
    consoleLifecycleRefCount += 1;
    ensureConsoleRuntimeInitialized();
  }

  function unmountConsoleRuntime() {
    if (consoleLifecycleRefCount > 0) {
      consoleLifecycleRefCount -= 1;
    }
    if (consoleLifecycleRefCount > 0) {
      return;
    }
    cleanupConsoleRuntime();
  }

  return {
    bootstrapConsoleRuntime,
    cleanupConsoleRuntime,
    ensureConsoleRuntimeInitialized,
    mountConsoleRuntime,
    unmountConsoleRuntime,
  };
}
