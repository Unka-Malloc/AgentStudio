import { beforeEach, describe, expect, it, vi } from "vitest";

const discoveryMocks = vi.hoisted(() => ({
  buildBootstrapPayload: vi.fn((state = {}) => ({ ok: true, bootstrapFor: state.serverId || "" })),
  getDiscoveryConfigPath: vi.fn((userDataPath) => `${userDataPath}/discovery.json`)
}));

const baselineMocks = vi.hoisted(() => ({
  createV001BaselineProvider: vi.fn(() => ({
    status: vi.fn(async () => ({ ok: true, protocolVersion: "pact.v001.baseline.test" }))
  }))
}));

vi.mock("../../../server/platform/common/platform-core/discovery/config.mjs", () => ({
  buildBootstrapPayload: discoveryMocks.buildBootstrapPayload,
  getDiscoveryConfigPath: discoveryMocks.getDiscoveryConfigPath
}));

vi.mock("../../../server/platform/common/v001/baseline-provider.mjs", () => ({
  createV001BaselineProvider: baselineMocks.createV001BaselineProvider
}));

const { buildConsoleState, buildRuntimeInfo } = await import("../../../server/platform/common/console/http/api-facade.mjs");

const discoveryState = {
  serverId: "server-1",
  offlineAfterSeconds: 90,
  mode: "active"
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("console api facade", () => {
  it("builds console state with default service fallbacks when knowledge-core is disabled", async () => {
    const securityPermissions = {
      getConsoleSummary: vi.fn((request) => ({ actor: request.headers["x-user"] }))
    };
    const storageProvider = {
      getStorageSummary: vi.fn(() => ({ bytes: 42 }))
    };

    const result = await buildConsoleState({
      userDataPath: "/tmp/pact-api-facade",
      distPath: "",
      runtime: { service: "runtime" },
      moduleManagement: { service: "modules" },
      discoveryState,
      jobWorkflowProvider: { service: "jobs" },
      storageProvider,
      serverUrl: "http://127.0.0.1:17000",
      securityPermissions,
      request: { headers: { "x-user": "owner" } },
      maintenanceAgent: null,
      clientRuntimeAllocator: null,
      features: {
        activeFeatureIds: ["agent-workspace"]
      },
      toolSkillManagementProvider: null,
      consoleDomainServices: {}
    });

    expect(result.server).toMatchObject({
      url: "http://127.0.0.1:17000",
      userDataPath: "/tmp/pact-api-facade",
      distPath: ""
    });
    expect(result.runtime).toBeNull();
    expect(result.settings).toEqual({ path: "", value: {} });
    expect(result.agentSelector.options).toEqual([]);
    expect(result.emailRules).toEqual({
      path: "",
      rules: {}
    });
    expect(result.expertVocabulary).toEqual({
      path: "",
      vocabulary: {}
    });
    expect(result.knowledgeTaxonomy).toEqual({
      path: "",
      taxonomy: {},
      guidance: {}
    });
    expect(result.discovery).toEqual({
      path: "/tmp/pact-api-facade/discovery.json",
      value: discoveryState,
      bootstrap: { ok: true, bootstrapFor: "server-1" }
    });
    expect(result.auth).toEqual({ actor: "owner" });
    expect(result.knowledgeConsole).toBeNull();
    expect(result.storage).toEqual({ bytes: 42 });
    expect(result.jobs).toEqual({ summary: {}, items: [] });
    expect(result.clients).toEqual({ summary: {}, items: [] });
    expect(result.v001Baseline).toEqual({ ok: true, protocolVersion: "pact.v001.baseline.test" });
    expect(discoveryMocks.buildBootstrapPayload).toHaveBeenCalledWith(discoveryState);
    expect(baselineMocks.createV001BaselineProvider).toHaveBeenCalledWith({ userDataPath: "/tmp/pact-api-facade" });
  });

  it("uses provided domain services and security/storage fallbacks for knowledge-enabled console state", async () => {
    const domainServices = {
      listAvailableAnalysisModules: vi.fn(async () => [{ id: "analysis-a" }]),
      getEmailRulesPath: vi.fn(() => "/rules/email.json"),
      loadEmailRules: vi.fn(async () => ({ rules: ["r1"] })),
      getExpertVocabularyPath: vi.fn(() => "/rules/vocabulary.json"),
      loadExpertVocabulary: vi.fn(async () => ({ terms: ["term"] })),
      getKnowledgeGuidanceSummary: vi.fn(async () => ({ guidance: true })),
      getKnowledgeTaxonomyPath: vi.fn(() => "/rules/taxonomy.json"),
      loadKnowledgeTaxonomy: vi.fn(async () => ({ taxonomy: ["tax"] })),
      buildToolManagementClientConnectionRows: vi.fn(() => [{ clientUid: "tool-client" }]),
      buildAgentSettingsConsoleProjection: vi.fn(async () => ({
        settings: { path: "/settings.json", value: { theme: "dark" } },
        agentSelector: { options: [{ value: "agent-a" }] },
        agentConfigs: { rootPath: "/agents" }
      })),
      buildConsoleJobsSummary: vi.fn(async ({ limit }) => ({ summary: { limit }, items: [{ id: "job-1" }] })),
      buildConsoleClientConnections: vi.fn(async (input) => ({
        summary: { offlineAfterSeconds: input.offlineAfterSeconds },
        items: input.buildToolManagementClientConnectionRows()
      })),
      buildMaintenanceAgentConsoleSummary: vi.fn(async ({ maintenanceAgent }) => ({ enabled: Boolean(maintenanceAgent) })),
      buildClientRuntimeConsoleSummary: vi.fn(async ({ clientRuntimeAllocator }) => ({ allocator: clientRuntimeAllocator.id })),
      buildRuntimeConsoleSummary: vi.fn(async (input) => ({
        modules: await input.listAvailableAnalysisModules(),
        settings: input.settings,
        featureCount: input.features.activeFeatureIds.length
      })),
      buildKnowledgeConsoleSummary: vi.fn(async (runtime, jobWorkflowProvider) => ({
        runtime: runtime.service,
        jobs: jobWorkflowProvider.service
      }))
    };

    const result = await buildConsoleState({
      userDataPath: "/tmp/pact-api-facade-enabled",
      distPath: "/dist",
      runtime: { service: "runtime" },
      moduleManagement: { service: "modules" },
      discoveryState,
      jobWorkflowProvider: { service: "jobs" },
      storageProvider: null,
      serverUrl: "http://localhost:17001",
      securityPermissions: null,
      request: {},
      maintenanceAgent: { service: "maintenance" },
      clientRuntimeAllocator: { id: "allocator-1" },
      features: {
        activeFeatureIds: ["knowledge-core", "agent-workspace"]
      },
      toolSkillManagementProvider: { service: "skills" },
      consoleDomainServices: domainServices
    });

    expect(result.runtime).toEqual({
      modules: [{ id: "analysis-a" }],
      settings: { theme: "dark" },
      featureCount: 2
    });
    expect(result.emailRules).toEqual({ path: "/rules/email.json", rules: { rules: ["r1"] } });
    expect(result.expertVocabulary).toEqual({ path: "/rules/vocabulary.json", vocabulary: { terms: ["term"] } });
    expect(result.knowledgeTaxonomy).toEqual({
      path: "/rules/taxonomy.json",
      taxonomy: { taxonomy: ["tax"] },
      guidance: { guidance: true }
    });
    expect(result.clients).toEqual({
      summary: { offlineAfterSeconds: 90 },
      items: [{ clientUid: "tool-client" }]
    });
    expect(result.maintenanceAgent).toEqual({ enabled: true });
    expect(result.clientRuntime).toEqual({ allocator: "allocator-1" });
    expect(result.knowledgeConsole).toEqual({ runtime: "runtime", jobs: "jobs" });
    expect(result.auth).toBeNull();
    expect(result.storage).toBeNull();
    expect(domainServices.buildConsoleJobsSummary).toHaveBeenCalledWith({
      jobWorkflowProvider: { service: "jobs" },
      limit: 50
    });
  });

  it("builds focused runtime info with default auth and storage fallbacks", async () => {
    const domainServices = {
      buildRuntimeInfoSettings: vi.fn(async () => ({ runtime: "settings" })),
      listAvailableAnalysisModules: vi.fn(async () => ["module-a"]),
      buildRuntimeConsoleSummary: vi.fn(async (input) => ({
        userDataPath: input.userDataPath,
        settings: input.settings,
        modules: await input.listAvailableAnalysisModules()
      }))
    };

    const result = await buildRuntimeInfo({
      userDataPath: "/tmp/runtime-info",
      distPath: "",
      runtime: { service: "runtime" },
      moduleManagement: null,
      discoveryState,
      storageProvider: null,
      serverUrl: "http://localhost:18000",
      securityPermissions: null,
      request: null,
      features: {
        activeFeatureIds: []
      },
      consoleDomainServices: domainServices
    });

    expect(result).toMatchObject({
      server: {
        url: "http://localhost:18000",
        userDataPath: "/tmp/runtime-info",
        distPath: ""
      },
      runtime: {
        userDataPath: "/tmp/runtime-info",
        settings: { runtime: "settings" },
        modules: ["module-a"]
      },
      auth: null,
      storage: null,
      v001Baseline: { ok: true, protocolVersion: "pact.v001.baseline.test" },
      discovery: { ok: true, bootstrapFor: "server-1" },
      features: { activeFeatureIds: [] }
    });
  });

  it("invokes default domain-service helpers from custom console projections", async () => {
    const result = await buildConsoleState({
      userDataPath: "/tmp/pact-api-facade-default-hooks",
      distPath: "",
      runtime: { service: "runtime" },
      moduleManagement: null,
      discoveryState,
      jobWorkflowProvider: null,
      storageProvider: null,
      serverUrl: "http://127.0.0.1:17002",
      securityPermissions: null,
      request: {},
      maintenanceAgent: null,
      clientRuntimeAllocator: null,
      features: {
        activeFeatureIds: ["knowledge-core"]
      },
      toolSkillManagementProvider: null,
      consoleDomainServices: {
        buildConsoleClientConnections: vi.fn(async (input) => ({
          summary: {},
          items: input.buildToolManagementClientConnectionRows()
        })),
        buildRuntimeConsoleSummary: vi.fn(async (input) => ({
          modules: await input.listAvailableAnalysisModules()
        }))
      }
    });

    expect(result.clients.items).toEqual([]);
    expect(result.runtime).toEqual({ modules: [] });
    expect(result.knowledgeConsole).toBeNull();
  });
});
