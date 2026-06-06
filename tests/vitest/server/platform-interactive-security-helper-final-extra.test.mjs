import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const featureRuntimeState = vi.hoisted(() => ({
  runtime: {
    edition: "unit",
    activeFeatureIds: []
  }
}));

const compositionMocks = vi.hoisted(() => ({
  resolveFeatureRuntimeFromEnv: vi.fn(async () => featureRuntimeState.runtime),
  filterOperationsForFeatures: vi.fn((operations) => operations.filter((operation) => operation.id !== "disabled.operation")),
  publicFeatureRuntime: vi.fn((runtime, operations) => ({
    edition: runtime.edition,
    operationCount: operations.length
  })),
  createProtocolEventBus: vi.fn(() => ({ service: "event-bus" })),
  createCorePlatformProvider: vi.fn(() => ({ service: "core-provider" })),
  registerCorePlatformServices: vi.fn(),
  createDataStructureProvider: vi.fn(() => ({ service: "data-structures" })),
  registerDataStructurePlatformServices: vi.fn(),
  createConsoleAuth: vi.fn(() => ({ ensureInitialOwner: vi.fn(async () => ({ created: true, ownerId: "owner-1" })) })),
  createOperationAuditStore: vi.fn(() => ({ service: "audit-store" })),
  registerSecurityPlatformServices: vi.fn(),
  createSecurityPermissionsProvider: vi.fn(() => ({ service: "permissions" })),
  createModuleManagementProvider: vi.fn(() => ({ service: "module-management" })),
  createServerRuntime: vi.fn(async () => ({ service: "runtime", metadataStore: { service: "metadata-store" } })),
  registerModuleManagementPlatformServices: vi.fn(),
  loadSettings: vi.fn(async () => ({ settings: true })),
  registerStoragePlatformServices: vi.fn(),
  createStorageProvider: vi.fn(() => ({ service: "storage-provider" })),
  createDevopsProvider: vi.fn(() => ({ service: "devops-provider" })),
  registerDevopsPlatformServices: vi.fn(),
  getAgentConfigRegistry: vi.fn(() => ({ refresh: vi.fn(async () => ({ refreshed: true })) })),
  createConsoleDomainServices: vi.fn(() => ({ service: "console-domain" })),
  createPlatformRegistry: vi.fn(() => ({ service: "platform-registry" })),
  createKnowledgeMetadataStoreDomainServices: vi.fn(() => ({ service: "knowledge-metadata" })),
  createKnowledgeBuiltinMountProviders: vi.fn(() => ({ service: "knowledge-mounts" })),
  serverApiOperations: [
    { id: "enabled.operation" },
    { id: "disabled.operation" }
  ]
}));

vi.mock("../../../server/platform/interactive/features/feature-manifest.mjs", () => ({
  resolveFeatureRuntimeFromEnv: compositionMocks.resolveFeatureRuntimeFromEnv,
  filterOperationsForFeatures: compositionMocks.filterOperationsForFeatures,
  publicFeatureRuntime: compositionMocks.publicFeatureRuntime
}));
vi.mock("../../../server/protocols/pubsub/event-bus.mjs", () => ({
  createProtocolEventBus: compositionMocks.createProtocolEventBus
}));
vi.mock("../../../server/platform/common/platform-core/core-platform-provider.mjs", () => ({
  createCorePlatformProvider: compositionMocks.createCorePlatformProvider
}));
vi.mock("../../../server/platform/common/platform-core/register.mjs", () => ({
  registerCorePlatformServices: compositionMocks.registerCorePlatformServices
}));
vi.mock("../../../server/platform/common/data-structure/data-structure-provider.mjs", () => ({
  createDataStructureProvider: compositionMocks.createDataStructureProvider
}));
vi.mock("../../../server/platform/common/data-structure/register.mjs", () => ({
  registerDataStructurePlatformServices: compositionMocks.registerDataStructurePlatformServices
}));
vi.mock("../../../server/platform/common/security/auth/console-auth.mjs", () => ({
  createConsoleAuth: compositionMocks.createConsoleAuth
}));
vi.mock("../../../server/platform/common/security/operation-audit.mjs", () => ({
  createOperationAuditStore: compositionMocks.createOperationAuditStore
}));
vi.mock("../../../server/platform/common/security/register.mjs", () => ({
  registerSecurityPlatformServices: compositionMocks.registerSecurityPlatformServices
}));
vi.mock("../../../server/platform/common/security/security-permissions-provider.mjs", () => ({
  createSecurityPermissionsProvider: compositionMocks.createSecurityPermissionsProvider
}));
vi.mock("../../../server/platform/common/module-manager/module-management-provider.mjs", () => ({
  createModuleManagementProvider: compositionMocks.createModuleManagementProvider
}));
vi.mock("../../../server/platform/common/module-manager/server-runtime.mjs", () => ({
  createServerRuntime: compositionMocks.createServerRuntime
}));
vi.mock("../../../server/platform/common/module-manager/register.mjs", () => ({
  registerModuleManagementPlatformServices: compositionMocks.registerModuleManagementPlatformServices
}));
vi.mock("../../../server/platform/common/operation-dispatcher/operation-registry.mjs", () => ({
  SERVER_API_OPERATIONS: compositionMocks.serverApiOperations
}));
vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: compositionMocks.loadSettings
}));
vi.mock("../../../server/platform/common/storage/register.mjs", () => ({
  registerStoragePlatformServices: compositionMocks.registerStoragePlatformServices
}));
vi.mock("../../../server/platform/common/storage/storage-provider.mjs", () => ({
  createStorageProvider: compositionMocks.createStorageProvider
}));
vi.mock("../../../server/platform/common/devops/devops-provider.mjs", () => ({
  createDevopsProvider: compositionMocks.createDevopsProvider
}));
vi.mock("../../../server/platform/common/devops/register.mjs", () => ({
  registerDevopsPlatformServices: compositionMocks.registerDevopsPlatformServices
}));
vi.mock("../../../server/platform/specialized/agent/agent-configs/config-registry.mjs", () => ({
  getAgentConfigRegistry: compositionMocks.getAgentConfigRegistry
}));
vi.mock("../../../server/platform/specialized/console/console-domain-services.mjs", () => ({
  createConsoleDomainServices: compositionMocks.createConsoleDomainServices
}));
vi.mock("../../../server/platform/interactive/platform-registry.mjs", () => ({
  createPlatformRegistry: compositionMocks.createPlatformRegistry
}));
vi.mock("../../../server/platform/specialized/knowledge/storage/metadata-store-domain-services.mjs", () => ({
  createKnowledgeMetadataStoreDomainServices: compositionMocks.createKnowledgeMetadataStoreDomainServices
}));
vi.mock("../../../server/platform/specialized/knowledge/storage/builtin-mount-providers.mjs", () => ({
  createKnowledgeBuiltinMountProviders: compositionMocks.createKnowledgeBuiltinMountProviders
}));

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn
}));

const {
  createServerCompositionRoot,
  ensureConsoleOwner
} = await import("../../../server/platform/interactive/composition-root.mjs");
const {
  CAPABILITY_SECURITY_HELPER_PROTOCOL_VERSION,
  capabilitySecurityHelperScriptPath,
  createCommandCapabilitySecurityClient
} = await import("../../../server/platform/common/security/authorization/capability-security-helper-client.mjs");
const {
  INTERACTIVE_INTERFACE_MANIFEST,
  listInteractivePlatformRegistryInterfaces,
  listInteractiveProductApiInterfaces
} = await import("../../../server/platform/interactive/interface-manifest.mjs");

function spawnResult({ stdout = "{}", stderr = "", code = 0, error = null, stayOpen = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (error) {
      child.emit("error", error);
      return;
    }
    if (stdout) {
      child.stdout.emit("data", stdout);
    }
    if (stderr) {
      child.stderr.emit("data", stderr);
    }
    if (!stayOpen) {
      child.emit("close", code);
    }
  });
  return child;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  featureRuntimeState.runtime = {
    edition: "unit",
    activeFeatureIds: []
  };
});

describe("interactive composition root final extra coverage", () => {
  it("lists product and platform interfaces from the interactive manifest", () => {
    expect(INTERACTIVE_INTERFACE_MANIFEST.layer).toBe("server/platform/interactive");
    expect(listInteractiveProductApiInterfaces()).toEqual(expect.arrayContaining([
      "loadSettings",
      "createKnowledgeSourceService",
      "dispatchOperation"
    ]));
    expect(listInteractivePlatformRegistryInterfaces()).toEqual(expect.arrayContaining([
      "security.auth.console",
      "core.provider",
      "storage.metadataStore"
    ]));
  });

  it("builds a composition root without knowledge providers and wires public helpers", async () => {
    const root = await createServerCompositionRoot({
      userDataPath: "/tmp/pact-unit-root",
      runtimeOptions: { port: 0 },
      runtimeLogger: { info: vi.fn() }
    });

    expect(compositionMocks.createServerRuntime).toHaveBeenCalledWith(expect.objectContaining({
      userDataPath: "/tmp/pact-unit-root",
      metadataStoreDomainServices: {},
      builtinMountProviders: {},
      runtimeOptions: expect.objectContaining({
        featureEdition: "unit",
        featureRuntime: featureRuntimeState.runtime
      })
    }));
    expect(root.activeApiOperations).toEqual([{ id: "enabled.operation" }]);
    expect(root.allApiOperationCount).toBe(2);
    expect(root.publicFeatures()).toMatchObject({ edition: "unit", operationCount: 2 });
    expect(root.isFeatureActive("knowledge-core")).toBe(false);
    expect(root.isAnyFeatureActive("missing", "knowledge-core")).toBe(false);
    expect(compositionMocks.registerCorePlatformServices).toHaveBeenCalledWith(root.platformRegistry, expect.objectContaining({
      protocolEventBus: root.protocolEventBus,
      coreProvider: root.coreProvider
    }));
  });

  it("loads knowledge providers only when the feature is active and handles owner creation", async () => {
    featureRuntimeState.runtime = {
      edition: "enterprise",
      activeFeatureIds: ["knowledge-core", "devops"]
    };
    const root = await createServerCompositionRoot({
      userDataPath: "/tmp/pact-unit-knowledge",
      runtimeOptions: {}
    });

    expect(compositionMocks.createKnowledgeMetadataStoreDomainServices).toHaveBeenCalled();
    expect(compositionMocks.createKnowledgeBuiltinMountProviders).toHaveBeenCalledWith({
      userDataPath: "/tmp/pact-unit-knowledge"
    });
    expect(compositionMocks.createServerRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      metadataStoreDomainServices: { service: "knowledge-metadata" },
      builtinMountProviders: { service: "knowledge-mounts" }
    }));
    expect(root.isFeatureActive("knowledge-core")).toBe(true);
    expect(root.isAnyFeatureActive("missing", "devops")).toBe(true);

    await expect(ensureConsoleOwner({ consoleAuth: root.consoleAuth, enabled: false })).resolves.toEqual({ created: false });
    await expect(ensureConsoleOwner({ consoleAuth: root.consoleAuth, enabled: true })).resolves.toMatchObject({
      created: true,
      ownerId: "owner-1"
    });
  });
});

describe("capability security command helper final extra coverage", () => {
  it("sends helper requests with protocol metadata and parses JSON responses", async () => {
    childProcessMocks.spawn.mockReturnValueOnce(spawnResult({
      stdout: '{"ok":true,"credentialId":"cred-1"}'
    }));
    const client = createCommandCapabilitySecurityClient({
      dataDir: "/tmp/pact-helper",
      command: "node",
      args: ["helper.mjs"],
      env: { UNIT: "1" },
      timeoutMs: 1000
    });

    await expect(client.issue({
      capabilityKey: "key-1"
    })).resolves.toMatchObject({
      ok: true,
      credentialId: "cred-1"
    });
    expect(childProcessMocks.spawn).toHaveBeenCalledWith("node", ["helper.mjs"], expect.objectContaining({
      stdio: ["pipe", "pipe", "pipe"],
      env: expect.objectContaining({ UNIT: "1" })
    }));
    const input = JSON.parse(childProcessMocks.spawn.mock.results[0].value.stdin.end.mock.calls[0][0]);
    expect(input).toMatchObject({
      protocolVersion: CAPABILITY_SECURITY_HELPER_PROTOCOL_VERSION,
      action: "issueCapabilityKey",
      dataDir: "/tmp/pact-helper",
      backend: expect.any(String),
      bindingBackend: expect.any(String),
      capabilityKey: "key-1"
    });
    expect(client.provider).toBe("command-helper");
    expect(capabilitySecurityHelperScriptPath()).toContain("server/scripts/pact-capability-security-helper.mjs");

    childProcessMocks.spawn.mockImplementation(() => spawnResult({ stdout: '{"ok":true}' }));
    await expect(client.bindCapabilityKey({ capabilityKey: "key-1" })).resolves.toMatchObject({ ok: true });
    await expect(client.verifyCapabilityKeyBinding({ capabilityKey: "key-1" })).resolves.toMatchObject({ ok: true });
    await expect(client.verifyCapabilityAndBinding({ capabilityKey: "key-1" })).resolves.toMatchObject({ ok: true });
    await expect(client.invalidateCapabilityCredential({ credentialId: "cred-1" })).resolves.toMatchObject({ ok: true });
    await expect(client.invalidateCredential({ credentialId: "cred-1" })).resolves.toMatchObject({ ok: true });
    await expect(client.invalidateCapabilityKeyBinding({ capabilityKey: "key-1" })).resolves.toMatchObject({ ok: true });
    expect(childProcessMocks.spawn.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(client.close()).toBeUndefined();
  });

  it("surfaces non-zero exits, spawn errors, invalid JSON, and timeouts", async () => {
    childProcessMocks.spawn.mockReturnValueOnce(spawnResult({
      code: 2,
      stderr: "denied"
    }));
    const client = createCommandCapabilitySecurityClient({ command: "helper", args: [], timeoutMs: 1000 });
    await expect(client.verify()).rejects.toThrow("denied");

    childProcessMocks.spawn.mockReturnValueOnce(spawnResult({
      stdout: "not-json"
    }));
    await expect(client.describe()).rejects.toThrow("Capability security helper returned invalid JSON");

    childProcessMocks.spawn.mockReturnValueOnce(spawnResult({
      error: new Error("spawn failed")
    }));
    await expect(client.invalidate()).rejects.toThrow("spawn failed");

    vi.useFakeTimers();
    childProcessMocks.spawn.mockReturnValueOnce(spawnResult({ stayOpen: true }));
    const pending = expect(client.verifyCapabilityAndBinding({ timeout: true }))
      .rejects.toThrow("Capability security helper timed out: helper");
    await vi.advanceTimersByTimeAsync(1001);
    await pending;
    expect(childProcessMocks.spawn.mock.results.at(-1).value.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
