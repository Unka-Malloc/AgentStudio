import { afterEach, describe, expect, it, vi } from "vitest";

const loadSettingsMock = vi.hoisted(() => vi.fn());
const saveSettingsMock = vi.hoisted(() => vi.fn());
const logRuntimeEventMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock,
  saveSettings: saveSettingsMock
}));

vi.mock("../../../server/platform/common/observability/runtime-logger.mjs", () => ({
  logRuntimeEvent: logRuntimeEventMock
}));

import { createSystemControllerContexts } from "../../../server/platform/common/console/http/controllers/system-controller-contexts.mjs";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function createDomainServices(overrides = {}) {
  return {
    agentRuntimeProvider: {
      getAgentConfigRegistry: vi.fn(),
      callAgentGateway: vi.fn(),
      probeModelConnection: vi.fn(),
      inspectAgentModelRouting: vi.fn()
    },
    getEmailRulesPath: vi.fn((root) => `${root}/rules/email-rules.json`),
    loadEmailRules: vi.fn(),
    saveEmailRules: vi.fn(),
    getExpertVocabularyPath: vi.fn(),
    getExpertVocabularySummary: vi.fn(),
    listExpertVocabularyVersions: vi.fn(),
    loadExpertVocabulary: vi.fn(),
    saveExpertVocabulary: vi.fn(),
    getKnowledgeGuidanceSummary: vi.fn(),
    getKnowledgeTaxonomyPath: vi.fn(),
    listKnowledgeTaxonomyVersions: vi.fn(),
    loadKnowledgeTaxonomy: vi.fn(),
    saveKnowledgeTaxonomy: vi.fn(),
    preprocessWordCloudVocabulary: vi.fn(),
    createDocumentParsingRuntime: vi.fn(),
    toPublicDocumentParsingResult: vi.fn(),
    enhanceAffairTaxonomy: vi.fn(),
    executeConsoleDomainOperation: vi.fn(),
    resumeKnowledgeWordCloudClassificationTasks: vi.fn(async (input) => ({ resumed: input })),
    uploadSessionStore: {
      resolveUploadSessionFiles: vi.fn(),
      deleteUploadSession: vi.fn()
    },
    ...overrides
  };
}

function createContexts(overrides = {}) {
  const consoleDomainServices = overrides.consoleDomainServices || createDomainServices();
  return createSystemControllerContexts({
    userDataPath: "/unit-data",
    runtime: { name: "runtime" },
    moduleManagement: { name: "module-management" },
    jobWorkflowProvider: { name: "jobs" },
    metadataStore: { name: "metadata" },
    storageProvider: { name: "storage" },
    protocolEventBus: { name: "events" },
    securityPermissions: { name: "security" },
    operationAuditStore: overrides.operationAuditStore,
    agentWorkspace: { name: "workspace" },
    contextRuntime: { name: "context" },
    evidenceSufficiencyGate: { name: "evidence" },
    knowledgeAgentSkill: { name: "agent-skill" },
    goldenRuleRuntime: { name: "golden" },
    knowledgeRuleAuthoringRuntime: { name: "authoring" },
    knowledgeSkillRuntime: { name: "skill" },
    agentEvaluationRuntime: { name: "evaluation" },
    modelDecisionRuntime: { name: "model-decision" },
    strategyManagementProvider: { name: "strategy" },
    knowledgeEvolutionRuntime: { name: "evolution" },
    summarizationRuntime: { name: "summary" },
    agentExplorationRuntime: { name: "exploration" },
    clientRuntimeAllocator: { name: "client-runtime" },
    queueMonitor: { name: "queue" },
    getFeatureEntries: overrides.getFeatureEntries || (() => ({ activeFeatureIds: ["feature.a"] })),
    consoleDomainServices
  });
}

describe("system controller contexts", () => {
  it("requires configured domain services and providers", () => {
    expect(() => createSystemControllerContexts({ consoleDomainServices: {} })).toThrow(
      "agentRuntimeProvider provider is not configured."
    );
    expect(() => createSystemControllerContexts({
      consoleDomainServices: createDomainServices({ loadEmailRules: null })
    })).toThrow("loadEmailRules provider is not configured.");
    expect(() => createSystemControllerContexts({
      consoleDomainServices: createDomainServices({ uploadSessionStore: { resolveUploadSessionFiles: vi.fn() } })
    })).toThrow("uploadSessionStore provider is not configured.");
  });

  it("builds frozen context helpers with expected dependency groups", () => {
    const services = createDomainServices();
    const contexts = createContexts({ consoleDomainServices: services });
    const authSession = { user: { id: "user-1" } };

    expect(Object.isFrozen(contexts)).toBe(true);
    expect(contexts.executeConsoleDomainOperation).toBe(services.executeConsoleDomainOperation);

    expect(contexts.knowledgeDomainContext(authSession)).toMatchObject({
      runtime: { name: "runtime" },
      metadataStore: { name: "metadata" },
      storageProvider: { name: "storage" },
      protocolEventBus: { name: "events" },
      saveSettings: saveSettingsMock,
      authSession
    });

    expect(contexts.knowledgeWorkflowContext(authSession)).toMatchObject({
      protocolEventBus: { name: "events" },
      metadataStore: { name: "metadata" },
      storageProvider: { name: "storage" },
      runtime: { name: "runtime" },
      loadSettings: loadSettingsMock,
      resolveUploadSessionFiles: services.uploadSessionStore.resolveUploadSessionFiles,
      deleteUploadSession: services.uploadSessionStore.deleteUploadSession,
      getEmailRulesPath: services.getEmailRulesPath,
      createDocumentParsingRuntime: services.createDocumentParsingRuntime,
      agentRuntimeProvider: services.agentRuntimeProvider,
      jobWorkflowProvider: { name: "jobs" },
      contextRuntime: { name: "context" },
      clientRuntimeAllocator: { name: "client-runtime" },
      authSession
    });

    expect(contexts.settingsAgentGatewayContext(authSession, { requestId: "req-1" })).toMatchObject({
      runtime: { name: "runtime" },
      moduleManagement: { name: "module-management" },
      protocolEventBus: { name: "events" },
      contextRuntime: { name: "context" },
      agentWorkspace: { name: "workspace" },
      clientRuntimeAllocator: { name: "client-runtime" },
      agentRuntimeProvider: services.agentRuntimeProvider,
      authSession,
      requestId: "req-1"
    });

    expect(contexts.authorizationFacadeContext(authSession, { request: { method: "POST" } })).toEqual({
      securityPermissions: { name: "security" },
      protocolEventBus: { name: "events" },
      authSession,
      request: { method: "POST" }
    });
    expect(contexts.accessControlContext(authSession, { resourceId: "r-1" })).toEqual({
      securityPermissions: { name: "security" },
      authSession,
      resourceId: "r-1"
    });
  });

  it("writes operation audit entries and logs runtime events without letting audit failures escape", () => {
    const append = vi.fn(() => {
      throw new Error("audit sink unavailable");
    });
    const contexts = createContexts({ operationAuditStore: { append } });

    contexts.appendConsoleOperationLog({
      operationId: "unit.operation",
      risk: "safe_write",
      readOnly: false,
      status: "failed",
      authSession: { user: { id: "user-2" } },
      input: { id: 1 },
      output: { ok: false },
      error: "boom"
    });

    expect(append).toHaveBeenCalledWith({
      transport: "http",
      risk: "safe_write",
      readOnly: false,
      status: "failed",
      actor: { user: { id: "user-2" } },
      operationId: "unit.operation",
      input: { id: 1 },
      output: { ok: false },
      error: "boom"
    });
    expect(logRuntimeEventMock).toHaveBeenCalledWith("warn", "unit.operation", {
      operationId: "unit.operation",
      status: "failed",
      actor: { id: "user-2" },
      input: { id: 1 },
      output: { ok: false },
      error: "boom"
    });
  });

  it("checks feature gates and resumes word cloud tasks with shared runtime dependencies", async () => {
    const services = createDomainServices();
    const contexts = createContexts({ consoleDomainServices: services });

    expect(contexts.isFeatureActive("feature.a")).toBe(true);
    expect(contexts.isFeatureActive("feature.b")).toBe(false);
    expect(createContexts({ getFeatureEntries: () => ({ activeFeatureIds: [] }) }).isFeatureActive("anything")).toBe(true);

    await expect(contexts.resumeKnowledgeWordCloudTasks()).resolves.toMatchObject({
      resumed: {
        userDataPath: "/unit-data",
        metadataStore: { name: "metadata" },
        protocolEventBus: { name: "events" },
        contextRuntime: { name: "context" },
        clientRuntimeAllocator: { name: "client-runtime" },
        queueMonitor: { name: "queue" },
        agentRuntimeProvider: services.agentRuntimeProvider
      }
    });
  });
});
