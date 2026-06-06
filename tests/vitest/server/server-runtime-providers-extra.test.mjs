import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  createStrategyManagementProvider: vi.fn(),
  createToolSkillManagementProvider: vi.fn(),
  createToolManagementPlatform: vi.fn(),
  createToolManagementStore: vi.fn(),
  createExternalKnowledgeDistillationClient: vi.fn(),
  resolveExternalKnowledgeDistillationConfig: vi.fn(),
  createAgentMemory: vi.fn(),
  createContextRuntime: vi.fn(),
  createMaintenanceAgentService: vi.fn(),
  createKnowledgeSourceService: vi.fn(),
  createAgentWorkspace: vi.fn(),
  createModelDecisionRuntime: vi.fn(),
  callAgentGateway: vi.fn(),
  createEvidenceSufficiencyGate: vi.fn(),
  createKnowledgeAgentSkillRuntime: vi.fn(),
  createGoldenRuleRuntime: vi.fn(),
  createKnowledgeRuleAuthoringRuntime: vi.fn(),
  createKnowledgeSkillRuntime: vi.fn(),
  createAgentEvaluationRuntime: vi.fn(),
  createKnowledgeEvolutionRuntime: vi.fn(),
  createSummarizationRuntime: vi.fn(),
  createAgentExplorationRuntime: vi.fn()
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: mocks.loadSettings
}));

vi.mock("../../../server/platform/specialized/capabilities/strategy-management/strategy-management-provider.mjs", () => ({
  createStrategyManagementProvider: mocks.createStrategyManagementProvider
}));

vi.mock("../../../server/platform/specialized/capabilities/skills/tool-skill-management-provider.mjs", () => ({
  createToolSkillManagementProvider: mocks.createToolSkillManagementProvider
}));

vi.mock("../../../server/platform/specialized/capabilities/tools/tool-management-core/index.mjs", () => ({
  createToolManagementPlatform: mocks.createToolManagementPlatform
}));

vi.mock("../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs", () => ({
  createToolManagementStore: mocks.createToolManagementStore
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs", () => ({
  createExternalKnowledgeDistillationClient: mocks.createExternalKnowledgeDistillationClient,
  resolveExternalKnowledgeDistillationConfig: mocks.resolveExternalKnowledgeDistillationConfig
}));

vi.mock("../../../server/platform/specialized/agent/agent-memory/index.mjs", () => ({
  createAgentMemory: mocks.createAgentMemory
}));

vi.mock("../../../server/platform/specialized/agent/agent-context/interface/index.mjs", () => ({
  createContextRuntime: mocks.createContextRuntime
}));

vi.mock("../../../server/services/agent/maintenance-agent/index.mjs", () => ({
  createMaintenanceAgentService: mocks.createMaintenanceAgentService
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs", () => ({
  createKnowledgeSourceService: mocks.createKnowledgeSourceService
}));

vi.mock("../../../server/platform/specialized/agent/agent-workspace/index.mjs", () => ({
  createAgentWorkspace: mocks.createAgentWorkspace
}));

vi.mock("../../../server/platform/specialized/agent/agent-gateway/model-decision-runtime/index.mjs", () => ({
  createModelDecisionRuntime: mocks.createModelDecisionRuntime
}));

vi.mock("../../../server/platform/specialized/agent/agent-gateway/index.mjs", () => ({
  callAgentGateway: mocks.callAgentGateway
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/evidence-sufficiency-gate/index.mjs", () => ({
  createEvidenceSufficiencyGate: mocks.createEvidenceSufficiencyGate
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/knowledge-agent-skill-runtime/index.mjs", () => ({
  createKnowledgeAgentSkillRuntime: mocks.createKnowledgeAgentSkillRuntime
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/golden-rule-runtime/index.mjs", () => ({
  createGoldenRuleRuntime: mocks.createGoldenRuleRuntime
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/knowledge-rule-authoring-runtime/index.mjs", () => ({
  createKnowledgeRuleAuthoringRuntime: mocks.createKnowledgeRuleAuthoringRuntime
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs", () => ({
  createKnowledgeSkillRuntime: mocks.createKnowledgeSkillRuntime
}));

vi.mock("../../../server/platform/specialized/capabilities/tools/agent-evaluation-runtime/index.mjs", () => ({
  createAgentEvaluationRuntime: mocks.createAgentEvaluationRuntime
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/knowledge-evolution-runtime/index.mjs", () => ({
  createKnowledgeEvolutionRuntime: mocks.createKnowledgeEvolutionRuntime
}));

vi.mock("../../../server/platform/specialized/knowledge/invocation/knowledge-summarization-runtime/index.mjs", () => ({
  createSummarizationRuntime: mocks.createSummarizationRuntime
}));

vi.mock("../../../server/platform/specialized/capabilities/tools/agent-exploration-runtime/index.mjs", () => ({
  createAgentExplorationRuntime: mocks.createAgentExplorationRuntime
}));

const {
  createServerRuntimeProviders,
  createServerToolManagementPlatform,
  createServerToolSkillManagementProvider
} = await import("../../../server/platform/interactive/server-runtime-providers.mjs");

const fixtures = {
  settings: { externalKnowledgeDistillation: { endpointUrl: "https://distill.example" } },
  externalConfig: { endpointUrl: "https://distill.example", apiKey: "unit" },
  toolManagementPlatform: { service: "tool-management-platform" },
  toolSkillManagementProvider: { service: "tool-skill-management-provider" },
  toolManagementStore: { service: "tool-management-store" },
  agentMemory: { service: "agent-memory" },
  contextRuntime: { service: "context-runtime" },
  maintenanceAgent: { service: "maintenance-agent" },
  knowledgeSourceService: { service: "knowledge-source-service" },
  agentWorkspace: { service: "agent-workspace" },
  baseModelDecisionRuntime: { service: "base-model-decision-runtime" },
  strategyManagementProvider: { service: "strategy-management-provider" },
  modelDecisionRuntime: { service: "model-decision-runtime-port" },
  evidenceSufficiencyGate: { service: "evidence-sufficiency-gate" },
  knowledgeAgentSkill: { service: "knowledge-agent-skill" },
  goldenRuleRuntime: { service: "golden-rule-runtime" },
  knowledgeRuleAuthoringRuntime: { service: "knowledge-rule-authoring-runtime" },
  knowledgeSkillRuntime: { service: "knowledge-skill-runtime" },
  agentEvaluationRuntime: { service: "agent-evaluation-runtime" },
  knowledgeEvolutionRuntime: { service: "knowledge-evolution-runtime" },
  summarizationRuntime: { service: "summarization-runtime" },
  agentExplorationRuntime: { service: "agent-exploration-runtime" },
  gatewayResponse: { ok: true, text: "gateway-result" }
};

function runtimeArgs(overrides = {}) {
  return {
    userDataPath: "/tmp/pact-server-runtime-providers-test",
    runtime: { mounts: { knowledgeBase: { service: "knowledge-base" } } },
    jobManager: { service: "job-manager" },
    metadataStore: { service: "metadata-store" },
    protocolEventBus: { service: "event-bus" },
    getDiscoveryState: vi.fn(() => ({ ready: true })),
    getListenUrl: vi.fn(() => "http://127.0.0.1:19000"),
    getControllers: vi.fn(() => ({ documents: {} })),
    operationAuditStore: { service: "audit-store" },
    operationConcurrencyScope: { service: "operation-concurrency" },
    dataStructures: {
      merkleState: { service: "merkle-state" },
      checkpointTree: { service: "checkpoint-tree" }
    },
    queueMonitor: { service: "queue-monitor" },
    runtimeLogger: { service: "runtime-logger" },
    clientRuntimeAllocator: { service: "client-runtime-allocator" },
    securityPermissions: { service: "security-permissions" },
    getToolManagementPlatform: vi.fn(() => fixtures.toolManagementPlatform),
    isFeatureActive: vi.fn(() => true),
    isAnyFeatureActive: vi.fn(() => true),
    ...overrides
  };
}

function setupMockReturns() {
  const externalClient = {
    createRun: vi.fn(async (input) => ({ created: input })),
    getRun: vi.fn(async (input) => ({ run: input })),
    queryEvidence: vi.fn(async (input) => ({ evidence: input }))
  };

  mocks.loadSettings.mockResolvedValue(fixtures.settings);
  mocks.createToolManagementPlatform.mockReturnValue(fixtures.toolManagementPlatform);
  mocks.createToolSkillManagementProvider.mockReturnValue(fixtures.toolSkillManagementProvider);
  mocks.createToolManagementStore.mockReturnValue(fixtures.toolManagementStore);
  mocks.resolveExternalKnowledgeDistillationConfig.mockReturnValue(fixtures.externalConfig);
  mocks.createExternalKnowledgeDistillationClient.mockReturnValue(externalClient);
  mocks.createAgentMemory.mockReturnValue(fixtures.agentMemory);
  mocks.createContextRuntime.mockReturnValue(fixtures.contextRuntime);
  mocks.createMaintenanceAgentService.mockReturnValue(fixtures.maintenanceAgent);
  mocks.createKnowledgeSourceService.mockReturnValue(fixtures.knowledgeSourceService);
  mocks.createAgentWorkspace.mockReturnValue(fixtures.agentWorkspace);
  mocks.createModelDecisionRuntime.mockReturnValue(fixtures.baseModelDecisionRuntime);
  mocks.callAgentGateway.mockResolvedValue(fixtures.gatewayResponse);
  mocks.createEvidenceSufficiencyGate.mockReturnValue(fixtures.evidenceSufficiencyGate);
  mocks.createKnowledgeAgentSkillRuntime.mockReturnValue(fixtures.knowledgeAgentSkill);
  mocks.createGoldenRuleRuntime.mockReturnValue(fixtures.goldenRuleRuntime);
  mocks.createKnowledgeRuleAuthoringRuntime.mockReturnValue(fixtures.knowledgeRuleAuthoringRuntime);
  mocks.createKnowledgeSkillRuntime.mockReturnValue(fixtures.knowledgeSkillRuntime);
  mocks.createAgentEvaluationRuntime.mockReturnValue(fixtures.agentEvaluationRuntime);
  mocks.createKnowledgeEvolutionRuntime.mockReturnValue(fixtures.knowledgeEvolutionRuntime);
  mocks.createSummarizationRuntime.mockReturnValue(fixtures.summarizationRuntime);
  mocks.createAgentExplorationRuntime.mockReturnValue(fixtures.agentExplorationRuntime);
  mocks.createStrategyManagementProvider.mockReturnValue({
    ...fixtures.strategyManagementProvider,
    createModelDecisionRuntimePort: vi.fn(() => fixtures.modelDecisionRuntime)
  });

  return { externalClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PACT_MAINTENANCE_WORKER_EXTERNAL;
  delete process.env.PACT_SOURCE_WATCHER_EXTERNAL;
  setupMockReturns();
});

describe("server runtime providers", () => {
  it("forwards bottom-platform factory arguments for tool management and tool skills", () => {
    const platformInput = {
      userDataPath: "/tmp/tools",
      operations: [{ id: "tool.echo" }],
      featureRuntime: { service: "features" },
      controllers: { tools: {} },
      operationAuditStore: { service: "audit" },
      operationConcurrencyScope: { service: "concurrency" },
      protocolEventBus: { service: "events" },
      consoleAuth: { service: "console-auth" },
      securityPermissions: { service: "security" },
      logger: { service: "logger" }
    };

    expect(createServerToolManagementPlatform(platformInput)).toBe(fixtures.toolManagementPlatform);
    expect(mocks.createToolManagementPlatform).toHaveBeenCalledWith({
      ...platformInput,
      strategyManagementProvider: null
    });

    const skillInput = {
      toolManagementPlatform: fixtures.toolManagementPlatform,
      userDataPath: "/tmp/tools",
      securityPermissions: { service: "security" },
      logger: { service: "logger" }
    };
    expect(createServerToolSkillManagementProvider(skillInput)).toBe(fixtures.toolSkillManagementProvider);
    expect(mocks.createToolSkillManagementProvider).toHaveBeenCalledWith(skillInput);
  });

  it("constructs all enabled runtime providers and wires gateway and distillation callbacks", async () => {
    const { externalClient } = setupMockReturns();
    const args = runtimeArgs();
    process.env.PACT_MAINTENANCE_WORKER_EXTERNAL = "1";
    process.env.PACT_SOURCE_WATCHER_EXTERNAL = "1";

    const providers = await createServerRuntimeProviders(args);

    expect(providers).toMatchObject({
      contextRuntime: fixtures.contextRuntime,
      maintenanceAgent: fixtures.maintenanceAgent,
      knowledgeSourceService: fixtures.knowledgeSourceService,
      agentWorkspace: fixtures.agentWorkspace,
      modelDecisionRuntime: fixtures.modelDecisionRuntime,
      evidenceSufficiencyGate: fixtures.evidenceSufficiencyGate,
      knowledgeAgentSkill: fixtures.knowledgeAgentSkill,
      goldenRuleRuntime: fixtures.goldenRuleRuntime,
      knowledgeRuleAuthoringRuntime: fixtures.knowledgeRuleAuthoringRuntime,
      knowledgeSkillRuntime: fixtures.knowledgeSkillRuntime,
      agentEvaluationRuntime: fixtures.agentEvaluationRuntime,
      knowledgeEvolutionRuntime: fixtures.knowledgeEvolutionRuntime,
      summarizationRuntime: fixtures.summarizationRuntime,
      agentExplorationRuntime: fixtures.agentExplorationRuntime
    });
    expect(providers.strategyManagementProvider).toMatchObject(fixtures.strategyManagementProvider);
    expect(Object.isFrozen(providers)).toBe(true);

    expect(mocks.createAgentMemory).toHaveBeenCalledWith({ userDataPath: args.userDataPath });
    expect(mocks.createContextRuntime).toHaveBeenCalledWith(expect.objectContaining({
      userDataPath: args.userDataPath,
      agentMemory: fixtures.agentMemory,
      clientRuntimeAllocator: args.clientRuntimeAllocator,
      agentGatewayCall: expect.any(Function)
    }));
    expect(mocks.createToolManagementStore).toHaveBeenCalledWith({ userDataPath: args.userDataPath });
    expect(mocks.createMaintenanceAgentService).toHaveBeenCalledWith(expect.objectContaining({
      userDataPath: args.userDataPath,
      runtime: args.runtime,
      jobManager: args.jobManager,
      metadataStore: args.metadataStore,
      protocolEventBus: args.protocolEventBus,
      getDiscoveryState: args.getDiscoveryState,
      getListenUrl: args.getListenUrl,
      contextRuntime: fixtures.contextRuntime,
      getControllers: args.getControllers,
      operationAuditStore: args.operationAuditStore,
      operationConcurrencyScope: args.operationConcurrencyScope,
      toolManagementStore: fixtures.toolManagementStore,
      queueMonitor: args.queueMonitor,
      schedulerEnabled: false,
      logger: args.runtimeLogger
    }));
    expect(mocks.createKnowledgeSourceService).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      jobManager: args.jobManager,
      protocolEventBus: args.protocolEventBus,
      watchingEnabled: false
    });
    expect(mocks.createAgentWorkspace).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      merkleState: args.dataStructures.merkleState,
      checkpointTreeApi: args.dataStructures.checkpointTree
    });
    expect(mocks.createStrategyManagementProvider).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      modelDecisionRuntime: fixtures.baseModelDecisionRuntime,
      getToolManagementPlatform: args.getToolManagementPlatform
    });

    const modelDecisionRuntimeArgs = mocks.createModelDecisionRuntime.mock.calls[0][0];
    await expect(modelDecisionRuntimeArgs.agentGatewayCall({ task: "decide" }))
      .resolves.toBe(fixtures.gatewayResponse);
    expect(mocks.callAgentGateway).toHaveBeenLastCalledWith(expect.objectContaining({
      input: { task: "decide" },
      userDataPath: args.userDataPath,
      clientRuntimeAllocator: args.clientRuntimeAllocator,
      strategyProvider: expect.objectContaining(fixtures.strategyManagementProvider),
      settings: fixtures.settings,
      contextRuntime: fixtures.contextRuntime,
      contextCompactionSource: "model-decision-runtime"
    }));

    const contextRuntimeArgs = mocks.createContextRuntime.mock.calls[0][0];
    await expect(contextRuntimeArgs.agentGatewayCall({ task: "context" }))
      .resolves.toBe(fixtures.gatewayResponse);
    expect(mocks.callAgentGateway).toHaveBeenLastCalledWith(expect.objectContaining({
      input: { task: "context" },
      userDataPath: args.userDataPath,
      clientRuntimeAllocator: args.clientRuntimeAllocator,
      strategyProvider: expect.objectContaining(fixtures.strategyManagementProvider),
      settings: fixtures.settings
    }));

    expect(mocks.createKnowledgeAgentSkillRuntime).toHaveBeenCalledWith({
      runtime: args.runtime,
      evidenceGate: fixtures.evidenceSufficiencyGate,
      modelDecisionRuntime: fixtures.modelDecisionRuntime
    });
    expect(mocks.createGoldenRuleRuntime).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      knowledgeCore: args.runtime.mounts.knowledgeBase
    });
    expect(mocks.createKnowledgeRuleAuthoringRuntime).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      goldenRuleRuntime: fixtures.goldenRuleRuntime,
      modelDecisionRuntime: fixtures.modelDecisionRuntime
    });
    expect(mocks.createKnowledgeSkillRuntime).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      runtime: args.runtime,
      modelDecisionRuntime: fixtures.modelDecisionRuntime,
      goldenRuleRuntime: fixtures.goldenRuleRuntime
    });
    expect(mocks.createAgentEvaluationRuntime).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      knowledgeAgentSkill: fixtures.knowledgeAgentSkill
    });

    const evolutionArgs = mocks.createKnowledgeEvolutionRuntime.mock.calls[0][0];
    expect(evolutionArgs).toMatchObject({
      userDataPath: args.userDataPath,
      knowledgeCore: args.runtime.mounts.knowledgeBase,
      agentEvaluationRuntime: fixtures.agentEvaluationRuntime,
      modelDecisionRuntime: fixtures.modelDecisionRuntime,
      knowledgeSkillRuntime: fixtures.knowledgeSkillRuntime,
      goldenRuleRuntime: fixtures.goldenRuleRuntime
    });
    await expect(evolutionArgs.knowledgeDistillationService.createRun({ topic: "rules" }))
      .resolves.toEqual({ created: { topic: "rules" } });
    await expect(evolutionArgs.knowledgeDistillationService.getRun({ runId: "run-1" }))
      .resolves.toEqual({ run: { runId: "run-1" } });
    await expect(evolutionArgs.knowledgeDistillationService.queryEvidence({ query: "evidence" }))
      .resolves.toEqual({ evidence: { query: "evidence" } });
    expect(mocks.resolveExternalKnowledgeDistillationConfig).toHaveBeenCalledWith({
      input: { topic: "rules" },
      settings: fixtures.settings
    });
    expect(mocks.createExternalKnowledgeDistillationClient).toHaveBeenCalledWith(fixtures.externalConfig);
    expect(externalClient.createRun).toHaveBeenCalledWith({ topic: "rules" });
    expect(externalClient.getRun).toHaveBeenCalledWith({ runId: "run-1" });
    expect(externalClient.queryEvidence).toHaveBeenCalledWith({ query: "evidence" });

    expect(mocks.createSummarizationRuntime).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      runtime: args.runtime,
      agentWorkspace: fixtures.agentWorkspace,
      contextRuntime: fixtures.contextRuntime,
      protocolEventBus: args.protocolEventBus,
      clientRuntimeAllocator: args.clientRuntimeAllocator
    });

    const explorationArgs = mocks.createAgentExplorationRuntime.mock.calls[0][0];
    expect(explorationArgs).toMatchObject({
      userDataPath: args.userDataPath,
      runtime: args.runtime,
      agentWorkspace: fixtures.agentWorkspace,
      contextRuntime: fixtures.contextRuntime,
      knowledgeSkillRuntime: fixtures.knowledgeSkillRuntime,
      knowledgeRuleAuthoringRuntime: fixtures.knowledgeRuleAuthoringRuntime,
      clientRuntimeAllocator: args.clientRuntimeAllocator,
      securityPermissions: args.securityPermissions
    });
    await expect(explorationArgs.agentGatewayCall({ task: "explore" }))
      .resolves.toBe(fixtures.gatewayResponse);
    expect(mocks.callAgentGateway).toHaveBeenLastCalledWith(expect.objectContaining({
      input: { task: "explore" },
      contextCompactionSource: "agent-exploration-runtime"
    }));
  });

  it("leaves feature providers disabled and rejects gateway calls when agent gateway is inactive", async () => {
    const args = runtimeArgs({
      dataStructures: null,
      isFeatureActive: vi.fn(() => false),
      isAnyFeatureActive: vi.fn(() => false)
    });

    const providers = await createServerRuntimeProviders(args);

    expect(providers).toMatchObject({
      contextRuntime: fixtures.contextRuntime,
      maintenanceAgent: null,
      knowledgeSourceService: null,
      agentWorkspace: null,
      modelDecisionRuntime: fixtures.modelDecisionRuntime,
      evidenceSufficiencyGate: null,
      knowledgeAgentSkill: null,
      goldenRuleRuntime: null,
      knowledgeRuleAuthoringRuntime: null,
      knowledgeSkillRuntime: null,
      agentEvaluationRuntime: null,
      knowledgeEvolutionRuntime: null,
      summarizationRuntime: null,
      agentExplorationRuntime: null
    });
    expect(providers.strategyManagementProvider).toMatchObject(fixtures.strategyManagementProvider);
    expect(mocks.createAgentMemory).toHaveBeenCalledOnce();
    expect(mocks.createContextRuntime).toHaveBeenCalledOnce();
    expect(mocks.createMaintenanceAgentService).not.toHaveBeenCalled();
    expect(mocks.createKnowledgeSourceService).not.toHaveBeenCalled();
    expect(mocks.createToolManagementStore).toHaveBeenCalledWith({ userDataPath: args.userDataPath });
    expect(mocks.createAgentWorkspace).not.toHaveBeenCalled();
    expect(mocks.createModelDecisionRuntime).not.toHaveBeenCalled();
    expect(mocks.createEvidenceSufficiencyGate).not.toHaveBeenCalled();
    expect(mocks.createAgentExplorationRuntime).not.toHaveBeenCalled();
    expect(mocks.createStrategyManagementProvider).toHaveBeenCalledWith({
      userDataPath: args.userDataPath,
      modelDecisionRuntime: null,
      getToolManagementPlatform: args.getToolManagementPlatform
    });

    const contextRuntimeArgs = mocks.createContextRuntime.mock.calls[0][0];
    await expect(contextRuntimeArgs.agentGatewayCall({ task: "blocked" }))
      .rejects.toThrow("AgentGateway feature is not active in this feature edition.");
    expect(mocks.callAgentGateway).not.toHaveBeenCalled();
    expect(mocks.loadSettings).toHaveBeenCalledWith(args.userDataPath);
    expect(args.isFeatureActive).toHaveBeenCalledWith("agent-gateway");
  });
});
