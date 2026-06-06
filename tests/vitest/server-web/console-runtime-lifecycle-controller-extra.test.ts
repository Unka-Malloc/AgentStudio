import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createConsoleRuntimeLifecycleController } from "../../../server-web/composables/console-runtime-lifecycle-controller";
import type { DashboardAlert } from "../../../server-web/types/app";

async function flushLifecycle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createFixture(overrides: {
  session?: { bootstrap: { required: boolean }; session: { authenticated: boolean } };
} = {}) {
  const liveDashboardAlerts = ref<DashboardAlert[]>([
    {
      id: "alert-1",
      level: "warning",
      title: "Storage",
      message: "Review storage",
      createdAt: "2026-06-04T00:00:00.000Z",
    },
  ]);
  const options = {
    authBootstrapping: ref(false),
    clearBrowserLocalStateFromUrl: vi.fn().mockResolvedValue(undefined),
    clearConfigTargetHighlight: vi.fn(),
    clearInfoFeedSummaryStreamTimer: vi.fn(),
    clearPendingRefreshState: vi.fn(),
    liveDashboardAlerts,
    refreshAuthState: vi.fn().mockResolvedValue(
      overrides.session ?? {
        bootstrap: { required: false },
        session: { authenticated: true },
      },
    ),
    refreshCodexOAuthStatus: vi.fn(),
    refreshContextCompiler: vi.fn().mockResolvedValue(undefined),
    refreshKnowledgeConsole: vi.fn().mockResolvedValue(undefined),
    refreshMonitorAlerts: vi.fn().mockResolvedValue(undefined),
    refreshState: vi.fn().mockResolvedValue(undefined),
    restoreAgentExploreState: vi.fn().mockResolvedValue(undefined),
    restoreInfoFeedHistory: vi.fn(),
    startServerEventSubscription: vi.fn(),
    stopAgentExplorePolling: vi.fn(),
    stopAgentExploreSplitResize: vi.fn(),
    stopCodexOAuthPolling: vi.fn(),
    stopKnowledgeLogColumnResize: vi.fn(),
    stopServerEventSubscription: vi.fn(),
    syncDashboardAlertInbox: vi.fn(),
  };
  return {
    controller: createConsoleRuntimeLifecycleController(options),
    options,
  };
}

describe("console runtime lifecycle controller", () => {
  it("bootstraps the full console runtime for an authenticated session", async () => {
    const { controller, options } = createFixture();

    await controller.bootstrapConsoleRuntime();

    expect(options.clearBrowserLocalStateFromUrl).toHaveBeenCalledTimes(1);
    expect(options.authBootstrapping.value).toBe(true);
    expect(options.refreshAuthState).toHaveBeenCalledTimes(1);
    expect(options.refreshState).toHaveBeenCalledWith({ silent: true });
    expect(options.refreshMonitorAlerts).toHaveBeenCalledWith({ silent: true });
    expect(options.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);
    expect(options.refreshContextCompiler).toHaveBeenCalledWith({ silent: true });
    expect(options.restoreAgentExploreState).toHaveBeenCalledTimes(1);
    expect(options.restoreInfoFeedHistory).toHaveBeenCalledTimes(1);
    expect(options.refreshCodexOAuthStatus).toHaveBeenCalledTimes(1);
    expect(options.startServerEventSubscription).toHaveBeenCalledTimes(1);
    expect(options.syncDashboardAlertInbox).toHaveBeenCalledWith(options.liveDashboardAlerts.value);
  });

  it("short-circuits runtime refreshes when bootstrap is required or auth is missing", async () => {
    const bootstrapRequired = createFixture({
      session: { bootstrap: { required: true }, session: { authenticated: true } },
    });
    await bootstrapRequired.controller.bootstrapConsoleRuntime();
    expect(bootstrapRequired.options.refreshState).not.toHaveBeenCalled();
    expect(bootstrapRequired.options.startServerEventSubscription).not.toHaveBeenCalled();

    const unauthenticated = createFixture({
      session: { bootstrap: { required: false }, session: { authenticated: false } },
    });
    await unauthenticated.controller.bootstrapConsoleRuntime();
    expect(unauthenticated.options.refreshState).not.toHaveBeenCalled();
    expect(unauthenticated.options.startServerEventSubscription).not.toHaveBeenCalled();
  });

  it("initializes only once and cleans up when the last mounted owner unmounts", async () => {
    const { controller, options } = createFixture({
      session: { bootstrap: { required: true }, session: { authenticated: true } },
    });

    controller.mountConsoleRuntime();
    controller.mountConsoleRuntime();
    controller.ensureConsoleRuntimeInitialized();
    await flushLifecycle();

    expect(options.clearBrowserLocalStateFromUrl).toHaveBeenCalledTimes(1);
    expect(options.refreshAuthState).toHaveBeenCalledTimes(1);

    controller.ensureConsoleRuntimeInitialized();
    await flushLifecycle();
    expect(options.refreshAuthState).toHaveBeenCalledTimes(1);

    controller.unmountConsoleRuntime();
    expect(options.stopCodexOAuthPolling).not.toHaveBeenCalled();

    controller.unmountConsoleRuntime();
    expect(options.stopCodexOAuthPolling).toHaveBeenCalledTimes(1);
    expect(options.stopAgentExplorePolling).toHaveBeenCalledTimes(1);
    expect(options.stopAgentExploreSplitResize).toHaveBeenCalledTimes(1);
    expect(options.stopKnowledgeLogColumnResize).toHaveBeenCalledTimes(1);
    expect(options.clearInfoFeedSummaryStreamTimer).toHaveBeenCalledTimes(1);
    expect(options.clearPendingRefreshState).toHaveBeenCalledTimes(1);
    expect(options.clearConfigTargetHighlight).toHaveBeenCalledTimes(1);
    expect(options.stopServerEventSubscription).toHaveBeenCalledTimes(1);
  });
});
