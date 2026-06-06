import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMetadataStore: vi.fn(),
  createMountManager: vi.fn(),
  getMountConfigPath: vi.fn(),
  getMountConfigPaths: vi.fn(),
  createJobManager: vi.fn(),
  createProtocolEventBus: vi.fn(),
  createMaintenanceAgentService: vi.fn(),
  createInteractiveServerRuntime: vi.fn(),
  loadDiscoveryConfig: vi.fn(),
  createKnowledgeSourceService: vi.fn()
}));

vi.mock("../../../server/platform/common/storage/metadata-store.mjs", () => ({
  createMetadataStore: mocks.createMetadataStore
}));

vi.mock("../../../server/platform/common/module-manager/mount-manager.mjs", () => ({
  createMountManager: mocks.createMountManager
}));

vi.mock("../../../server/platform/common/module-manager/mount-config.mjs", () => ({
  getMountConfigPath: mocks.getMountConfigPath,
  getMountConfigPaths: mocks.getMountConfigPaths
}));

vi.mock("../../../server/services/client/work-queue-core/jobs/job-manager.mjs", () => ({
  createJobManager: mocks.createJobManager
}));

vi.mock("../../../server/protocols/pubsub/event-bus.mjs", () => ({
  createProtocolEventBus: mocks.createProtocolEventBus
}));

vi.mock("../../../server/services/agent/maintenance-agent/index.mjs", () => ({
  createMaintenanceAgentService: mocks.createMaintenanceAgentService
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", () => ({
  createServerRuntime: mocks.createInteractiveServerRuntime,
  loadDiscoveryConfig: mocks.loadDiscoveryConfig,
  createKnowledgeSourceService: mocks.createKnowledgeSourceService
}));

const { createServerRuntime } = await import("../../../server/platform/common/module-manager/server-runtime.mjs");
const routingTable = await import("../../../server/platform/specialized/knowledge/preprocessing/file-processor/file-routing-table.mjs");
const { createImportWorkerRuntime } = await import("../../../server/services/client/work-queue-core/background-workers/import-worker.mjs");
const { createMaintenanceWorkerRuntime } = await import("../../../server/services/client/work-queue-core/background-workers/maintenance-worker.mjs");
const { createSourceWatcherWorkerRuntime } = await import("../../../server/services/client/work-queue-core/background-workers/source-watcher-worker.mjs");

function resetMocks() {
  vi.clearAllMocks();
}

function createJobManagerFixture(overrides = {}) {
  return {
    scanPersistedQueue: vi.fn(async () => ({ scanned: 2 })),
    listJobs: vi.fn(async () => ({ summary: { total: 1 } })),
    close: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("small zero entrypoints final extra coverage", () => {
  it("creates common server runtime views, delegates mount operations, and closes resources", async () => {
    resetMocks();
    const metadataStore = { close: vi.fn() };
    const mountExecutionView = {
      mounts: { documentParser: { id: "parser" } },
      postCommitHooks: [{ name: "hook-a" }],
      runtimeOptions: { profile: "default" },
      resolveDocumentRoute: vi.fn()
    };
    const mountManager = {
      mounts: mountExecutionView.mounts,
      runtimeOptions: mountExecutionView.runtimeOptions,
      generation: 7,
      createExecutionView: vi.fn(() => mountExecutionView),
      applyMountConfig: vi.fn(async (config, options) => ({ applied: config, options })),
      reloadMounts: vi.fn(async (options) => ({ reloaded: options })),
      refreshMounts: vi.fn(async (options) => ({ refreshed: options })),
      close: vi.fn(async () => undefined)
    };
    mocks.createMetadataStore.mockReturnValue(metadataStore);
    mocks.createMountManager.mockResolvedValue(mountManager);
    mocks.getMountConfigPath.mockReturnValue("/tmp/pact/mounts.json");
    mocks.getMountConfigPaths.mockReturnValue(["/tmp/pact/mounts.json"]);

    const runtime = await createServerRuntime({
      userDataPath: "/tmp/pact",
      runtimeOptions: { profile: "default" },
      metadataStoreDomainServices: { service: "domain" },
      builtinMountProviders: { knowledgeBase: { service: "kb" } }
    });

    expect(mocks.createMetadataStore).toHaveBeenCalledWith({
      userDataPath: "/tmp/pact",
      domainServices: { service: "domain" }
    });
    expect(mocks.createMountManager).toHaveBeenCalledWith({
      userDataPath: "/tmp/pact",
      runtimeOptions: { profile: "default" },
      builtinMountProviders: { knowledgeBase: { service: "kb" } }
    });
    expect(runtime).toMatchObject({
      userDataPath: "/tmp/pact",
      metadataStore,
      mountConfigPath: "/tmp/pact/mounts.json",
      mountConfigPaths: ["/tmp/pact/mounts.json"],
      mountManager
    });
    expect(runtime.mounts).toBe(mountExecutionView.mounts);
    expect(runtime.postCommitHooks).toEqual([{ name: "hook-a" }]);
    expect(runtime.runtimeOptions).toEqual({ profile: "default" });
    expect(runtime.mountGeneration).toBe(7);
    expect(runtime.createExecutionView()).toMatchObject({
      userDataPath: "/tmp/pact",
      metadataStore,
      mounts: mountExecutionView.mounts
    });
    await expect(runtime.applyMountConfig({ modules: {} }, { settings: {} })).resolves.toEqual({
      applied: { modules: {} },
      options: { settings: {} }
    });
    await expect(runtime.reloadMounts({ reason: "unit" })).resolves.toEqual({
      reloaded: { reason: "unit" }
    });
    await expect(runtime.refreshMounts({ reason: "unit" })).resolves.toEqual({
      refreshed: { reason: "unit" }
    });
    await runtime.close();
    expect(metadataStore.close).toHaveBeenCalledOnce();
    expect(mountManager.close).toHaveBeenCalledOnce();
  });

  it("closes metadata store when mount manager creation fails", async () => {
    resetMocks();
    const metadataStore = { close: vi.fn() };
    mocks.createMetadataStore.mockReturnValue(metadataStore);
    mocks.createMountManager.mockRejectedValue(new Error("mount failed"));

    await expect(createServerRuntime({ userDataPath: "/tmp/fail" })).rejects.toThrow("mount failed");
    expect(metadataStore.close).toHaveBeenCalledOnce();
  });

  it("exposes file processor routing table functions and dynamic route target proxies", () => {
    expect(routingTable.FILE_PROCESSOR_ROUTE_TABLE_VERSION).toBe(2);
    const defaultTable = routingTable.getFileProcessorDefaultRoutingTable();
    const extensionRoutes = routingTable.getFileProcessorDefaultExtensionRouteTargets();
    const kindRoutes = routingTable.getFileProcessorDefaultKindRouteTargets();
    const mediaTypeRoutes = routingTable.getFileProcessorDefaultMediaTypeRouteTargets();
    expect(Object.keys(defaultTable.extensionRoutes).length).toBeGreaterThan(0);
    expect(Object.keys(extensionRoutes).length).toBeGreaterThan(0);
    expect(Object.keys(kindRoutes).length).toBeGreaterThan(0);
    expect(Object.keys(mediaTypeRoutes).length).toBeGreaterThan(0);

    const extensionKey = Object.keys(extensionRoutes)[0];
    const kindKey = Object.keys(kindRoutes)[0];
    expect(extensionKey in routingTable.FILE_PROCESSOR_DEFAULT_EXTENSION_ROUTE_TARGETS).toBe(true);
    expect(kindKey in routingTable.FILE_PROCESSOR_DEFAULT_KIND_ROUTE_TARGETS).toBe(true);
    expect(routingTable.FILE_PROCESSOR_DEFAULT_EXTENSION_ROUTE_TARGETS[extensionKey]).toEqual(extensionRoutes[extensionKey]);
    expect(routingTable.FILE_PROCESSOR_DEFAULT_KIND_ROUTE_TARGETS[kindKey]).toEqual(kindRoutes[kindKey]);
    expect(Object.keys(routingTable.FILE_PROCESSOR_DEFAULT_EXTENSION_ROUTE_TARGETS)).toContain(extensionKey);
    expect(Object.getOwnPropertyDescriptor(
      routingTable.FILE_PROCESSOR_DEFAULT_EXTENSION_ROUTE_TARGETS,
      extensionKey
    )).toMatchObject({
      enumerable: true,
      configurable: true,
      value: extensionRoutes[extensionKey]
    });
  });

  it("runs import worker ticks and closes job manager and event bus", async () => {
    resetMocks();
    const eventBus = { close: vi.fn(async () => undefined) };
    const jobManager = createJobManagerFixture();
    mocks.createProtocolEventBus.mockReturnValue(eventBus);
    mocks.createJobManager.mockReturnValue(jobManager);

    const runtime = await createImportWorkerRuntime({ userDataPath: "/tmp/import-worker" });
    await expect(runtime.tick()).resolves.toEqual({
      status: "running",
      details: {
        mode: "external_import_queue_worker",
        scan: { scanned: 2 },
        jobs: { total: 1 }
      }
    });
    expect(runtime.mode).toBe("active");
    expect(mocks.createJobManager).toHaveBeenCalledWith({
      userDataPath: "/tmp/import-worker",
      processingEnabled: true,
      protocolEventBus: eventBus
    });
    await runtime.close();
    expect(jobManager.close).toHaveBeenCalledOnce();
    expect(eventBus.close).toHaveBeenCalledOnce();
  });

  it("runs maintenance worker ticks with discovery fallback and closes dependencies", async () => {
    resetMocks();
    const eventBus = { close: vi.fn(async () => undefined) };
    const jobManager = createJobManagerFixture();
    const serverRuntime = {
      metadataStore: { id: "metadata-store" },
      close: vi.fn(async () => undefined)
    };
    const maintenanceAgent = {
      start: vi.fn(async () => undefined),
      tickScheduler: vi.fn(async () => undefined),
      getConsoleSummary: vi.fn(async () => ({
        config: { enabled: true },
        activeRunId: "run-active",
        queuedRunIds: ["run-queued"],
        pendingApprovalCount: 3,
        nextRunAt: "2026-06-05T00:00:00.000Z",
        latestRun: { status: "completed" }
      })),
      close: vi.fn(async () => undefined)
    };
    mocks.createProtocolEventBus.mockReturnValue(eventBus);
    mocks.createJobManager.mockReturnValue(jobManager);
    mocks.createInteractiveServerRuntime.mockResolvedValue(serverRuntime);
    mocks.loadDiscoveryConfig.mockRejectedValue(new Error("missing config"));
    mocks.createMaintenanceAgentService.mockReturnValue(maintenanceAgent);

    const runtime = await createMaintenanceWorkerRuntime({ userDataPath: "/tmp/maintenance-worker" });
    await expect(runtime.tick()).resolves.toEqual({
      status: "running",
      details: {
        mode: "external_maintenance_scheduler",
        enabled: true,
        activeRunId: "run-active",
        queuedRunIds: ["run-queued"],
        pendingApprovalCount: 3,
        nextRunAt: "2026-06-05T00:00:00.000Z",
        latestRunStatus: "completed"
      }
    });
    expect(mocks.createMaintenanceAgentService).toHaveBeenCalledWith(expect.objectContaining({
      userDataPath: "/tmp/maintenance-worker",
      runtime: serverRuntime,
      jobManager,
      metadataStore: serverRuntime.metadataStore,
      protocolEventBus: eventBus,
      schedulerEnabled: true
    }));
    const serviceInput = mocks.createMaintenanceAgentService.mock.calls[0][0];
    expect(serviceInput.getDiscoveryState()).toEqual({});
    expect(serviceInput.getListenUrl()).toBe("");
    await runtime.close();
    expect(maintenanceAgent.close).toHaveBeenCalledOnce();
    expect(jobManager.close).toHaveBeenCalledOnce();
    expect(serverRuntime.close).toHaveBeenCalledOnce();
    expect(eventBus.close).toHaveBeenCalledOnce();
  });

  it("runs source watcher ticks and closes watcher dependencies", async () => {
    resetMocks();
    const eventBus = { close: vi.fn(async () => undefined) };
    const jobManager = createJobManagerFixture();
    const knowledgeSourceService = {
      start: vi.fn(async () => undefined),
      reconcileWatchers: vi.fn(async () => ({ summary: { active: 2 } })),
      close: vi.fn(async () => undefined)
    };
    mocks.createProtocolEventBus.mockReturnValue(eventBus);
    mocks.createJobManager.mockReturnValue(jobManager);
    mocks.createKnowledgeSourceService.mockResolvedValue(knowledgeSourceService);

    const runtime = await createSourceWatcherWorkerRuntime({ userDataPath: "/tmp/source-watcher" });
    await expect(runtime.tick()).resolves.toEqual({
      status: "running",
      details: {
        mode: "external_source_watcher",
        sources: { active: 2 }
      }
    });
    expect(mocks.createKnowledgeSourceService).toHaveBeenCalledWith({
      userDataPath: "/tmp/source-watcher",
      jobManager,
      protocolEventBus: eventBus,
      watchingEnabled: true
    });
    await runtime.close();
    expect(knowledgeSourceService.close).toHaveBeenCalledOnce();
    expect(jobManager.close).toHaveBeenCalledOnce();
    expect(eventBus.close).toHaveBeenCalledOnce();
  });
});
