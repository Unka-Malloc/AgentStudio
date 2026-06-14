import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  createKnowledgeCoreMount: vi.fn()
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: mocks.loadSettings
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs", () => ({
  createKnowledgeCoreMount: mocks.createKnowledgeCoreMount
}));

import { createPlatformRegistry } from "../../../server/platform/interactive/platform-registry.mjs";
import { createAgentRuntimeProvider } from "../../../server/platform/specialized/agent/agent-runtime-provider.mjs";
import { registerStoragePlatformServices } from "../../../server/platform/common/storage/register.mjs";
import { createKnowledgeBuiltinMountProviders } from "../../../server/platform/specialized/knowledge/storage/builtin-mount-providers.mjs";
import { createKnowledgeMetadataStoreDomainServices } from "../../../server/platform/specialized/knowledge/storage/metadata-store-domain-services.mjs";

describe("small platform entrypoints final coverage", () => {
  it("validates and delegates agent runtime provider calls through supplied loaders", async () => {
    expect(() => createAgentRuntimeProvider()).toThrow("agent runtime provider is missing getAgentConfigRegistry.");

    const registry = {
      refresh: vi.fn(async () => undefined),
      getModelLibraryAgents: vi.fn(() => [{ id: "agent-1" }]),
      getModelLibraryEntries: vi.fn(() => [{ id: "entry-1" }])
    };
    const gatewayModule = {
      publicAgentGatewayConfig: vi.fn((settings) => ({ type: "config", settings })),
      publicAgentGatewayRegistry: vi.fn((settings) => ({ type: "registry", settings })),
      callAgentGateway: vi.fn(async (input) => ({ type: "call", input })),
      inspectAgentModelRouting: vi.fn(async (input) => ({ type: "routing", input }))
    };
    const modelProbeModule = {
      probeModelConnection: vi.fn(async (input) => ({ type: "probe", input }))
    };
    const provider = createAgentRuntimeProvider({
      getAgentConfigRegistry: vi.fn(() => registry),
      loadAgentGatewayModule: vi.fn(async () => gatewayModule),
      loadModelProbeModule: vi.fn(async () => modelProbeModule)
    });
    mocks.loadSettings.mockResolvedValue({ settingsId: "runtime-settings" });

    expect(provider.describe()).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:agent:runtime-1"
    });
    expect(provider.describe().capabilities).toContain("agent.gateway.call");
    expect(provider.getAgentConfigRegistry()).toBe(registry);
    await expect(provider.loadAgentGatewayModule()).resolves.toBe(gatewayModule);
    await expect(provider.publicAgentGatewayConfig({ a: 1 })).resolves.toEqual({
      type: "config",
      settings: { a: 1 }
    });
    await expect(provider.publicAgentGatewayRegistry({ b: 2 })).resolves.toEqual({
      type: "registry",
      settings: { b: 2 }
    });
    await expect(provider.callAgentGateway({ prompt: "hi" })).resolves.toEqual({
      type: "call",
      input: { prompt: "hi" }
    });
    await expect(provider.probeModelConnection({ model: "m" })).resolves.toEqual({
      type: "probe",
      input: { model: "m" }
    });
    await expect(provider.inspectAgentModelRouting({ route: "r" })).resolves.toEqual({
      type: "routing",
      input: { route: "r" }
    });

    const runtimeCall = await provider.callGatewayWithRuntimeSettings({
      userDataPath: "/tmp/pact-agent-runtime-provider-test",
      input: { task: "run" },
      contextRuntime: { context: true },
      clientRuntimeAllocator: { allocator: true },
      contextCompactionSource: "unit"
    });
    expect(registry.refresh).toHaveBeenCalledWith({
      settingsFallback: { settingsId: "runtime-settings" }
    });
    expect(runtimeCall.input).toMatchObject({
      settings: {
        settingsId: "runtime-settings",
        modelLibraryAgents: [{ id: "agent-1" }],
        modelLibraryEntries: [{ id: "entry-1" }]
      },
      input: { task: "run" },
      userDataPath: "/tmp/pact-agent-runtime-provider-test",
      contextRuntime: { context: true },
      contextCompactionSource: "unit",
      clientRuntimeAllocator: { allocator: true }
    });
  });

  it("registers storage platform services with metadata-store fallback details", () => {
    const registry = createPlatformRegistry({ scope: "unit" });
    const metadataStore = {
      databasePath: "/tmp/metadata.sqlite",
      objectRootPath: "/tmp/raw"
    };
    const storageProvider = {
      protocolVersion: "v0.0.1:test:storage-1",
      getMetadataStore: vi.fn(() => metadataStore),
      listCapabilities: vi.fn(() => ({
        capabilities: [{ id: "metadata" }, { id: "raw-objects" }]
      }))
    };

    const registered = registerStoragePlatformServices(registry, {
      storageProvider,
      userDataPath: "/tmp/pact-data"
    });

    expect(registered.map((entry) => entry.id)).toEqual(["storage.provider", "storage.metadataStore"]);
    expect(registry.get("storage.provider")).toMatchObject({
      platform: "storage",
      kind: "provider",
      value: storageProvider,
      metadata: {
        protocolVersion: "v0.0.1:test:storage-1",
        capabilityIds: ["metadata", "raw-objects"]
      }
    });
    expect(registry.get("storage.metadataStore")).toMatchObject({
      platform: "storage",
      kind: "repository",
      value: metadataStore,
      metadata: {
        userDataPath: "/tmp/pact-data",
        databasePath: "/tmp/metadata.sqlite",
        objectRootPath: "/tmp/raw"
      }
    });
  });

  it("creates knowledge builtin providers and domain service factories", async () => {
    const mount = { protocolVersion: "v0.0.1:test:knowledge-1" };
    mocks.createKnowledgeCoreMount.mockResolvedValue(mount);
    const providers = createKnowledgeBuiltinMountProviders({ userDataPath: "/tmp/pact-knowledge" });

    await expect(providers.knowledgeBase.builtinFactory({
      runtimeOptions: {
        featureRuntime: {
          activeFeatureIds: ["knowledge-outline-reasoning"]
        }
      }
    })).resolves.toBe(mount);
    expect(mocks.createKnowledgeCoreMount).toHaveBeenLastCalledWith({
      userDataPath: "/tmp/pact-knowledge",
      outlineEnabled: true
    });

    await expect(providers.knowledgeBase.minimalFactory({
      runtimeOptions: {
        featureRuntime: {
          activeFeatureIds: ["other-feature"]
        }
      }
    })).resolves.toBe(mount);
    expect(mocks.createKnowledgeCoreMount).toHaveBeenLastCalledWith({
      userDataPath: "/tmp/pact-knowledge",
      outlineEnabled: false
    });

    const domainServices = createKnowledgeMetadataStoreDomainServices();
    const textIndexing = domainServices.createTextIndexingService();
    expect(textIndexing.buildSearchTerms("Alpha beta", textIndexing.compileRuleSet({}))).toEqual(["alpha", "beta"]);
    expect(typeof domainServices.createSearchService).toBe("function");
    expect(typeof domainServices.createTransactionLifecycleService).toBe("function");
    expect(typeof domainServices.loadRules).toBe("function");
  });
});
