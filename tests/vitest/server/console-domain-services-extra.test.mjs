import { describe, expect, it, vi } from "vitest";

const getAgentConfigRegistryMock = vi.hoisted(() => vi.fn(() => ({ registry: true })));
const createAgentRuntimeProviderMock = vi.hoisted(() => vi.fn((input) => ({ agentRuntime: true, input })));
const executeConsoleDomainOperationMock = vi.hoisted(() => vi.fn());
const buildAgentSettingsConsoleProjectionMock = vi.hoisted(() => vi.fn(async (input) => ({ agentSettings: input })));
const buildClientRuntimeConsoleSummaryMock = vi.hoisted(() => vi.fn());
const buildConsoleClientConnectionsMock = vi.hoisted(() => vi.fn());
const buildConsoleJobsSummaryMock = vi.hoisted(() => vi.fn());
const buildMaintenanceAgentConsoleSummaryMock = vi.hoisted(() => vi.fn());
const buildRuntimeInfoSettingsMock = vi.hoisted(() => vi.fn());
const buildKnowledgeConsoleSummaryMock = vi.hoisted(() => vi.fn());
const buildRuntimeConsoleSummaryMock = vi.hoisted(() => vi.fn());
const buildToolManagementClientConnectionRowsMock = vi.hoisted(() => vi.fn());
const uploadSessionMocks = vi.hoisted(() => ({
  appendUploadSessionChunk: vi.fn(),
  buildCheckpointReceiptFromUploadSession: vi.fn(),
  createOrResumeUploadSession: vi.fn(),
  deleteUploadSession: vi.fn(),
  getUploadSession: vi.fn(),
  resolveUploadSessionFiles: vi.fn()
}));
const dynamicMocks = vi.hoisted(() => ({
  listAvailableAnalysisModules: vi.fn(async () => ["analysis-a"]),
  loadEmailRules: vi.fn(async () => ({ email: "rules" })),
  saveEmailRules: vi.fn(async () => ({ saved: "email" })),
  getExpertVocabularySummary: vi.fn(async () => ({ expert: "summary" })),
  listExpertVocabularyVersions: vi.fn(async () => ["v1"]),
  loadExpertVocabulary: vi.fn(async () => ({ expert: "vocabulary" })),
  saveExpertVocabulary: vi.fn(async () => ({ saved: "expert" })),
  getKnowledgeGuidanceSummary: vi.fn(async () => ({ guidance: true })),
  listKnowledgeTaxonomyVersions: vi.fn(async () => ["t1"]),
  loadKnowledgeTaxonomy: vi.fn(async () => ({ taxonomy: true })),
  saveKnowledgeTaxonomy: vi.fn(async () => ({ saved: "taxonomy" })),
  preprocessWordCloudVocabulary: vi.fn(async () => ({ terms: [] })),
  createDocumentParsingRuntime: vi.fn(async () => ({ parser: true })),
  toPublicDocumentParsingResult: vi.fn(() => ({ public: true })),
  enhanceAffairTaxonomy: vi.fn(async () => ({ enhanced: true })),
  resumeKnowledgeWordCloudClassificationTasks: vi.fn(async () => ({ resumed: true }))
}));

vi.mock("../../../server/platform/specialized/agent/agent-configs/config-registry.mjs", () => ({
  getAgentConfigRegistry: getAgentConfigRegistryMock
}));

vi.mock("../../../server/platform/specialized/agent/agent-runtime-provider.mjs", () => ({
  createAgentRuntimeProvider: createAgentRuntimeProviderMock
}));

vi.mock("../../../server/platform/specialized/console/console-domain-operation-executor.mjs", () => ({
  executeConsoleDomainOperation: executeConsoleDomainOperationMock
}));

vi.mock("../../../server/platform/specialized/console/console-state-projections.mjs", () => ({
  buildAgentSettingsConsoleProjection: buildAgentSettingsConsoleProjectionMock,
  buildClientRuntimeConsoleSummary: buildClientRuntimeConsoleSummaryMock,
  buildConsoleClientConnections: buildConsoleClientConnectionsMock,
  buildConsoleJobsSummary: buildConsoleJobsSummaryMock,
  buildMaintenanceAgentConsoleSummary: buildMaintenanceAgentConsoleSummaryMock,
  buildRuntimeInfoSettings: buildRuntimeInfoSettingsMock
}));

vi.mock("../../../server/platform/specialized/console/knowledge-console-summary.mjs", () => ({
  buildKnowledgeConsoleSummary: buildKnowledgeConsoleSummaryMock
}));

vi.mock("../../../server/platform/specialized/console/runtime-console-summary.mjs", () => ({
  buildRuntimeConsoleSummary: buildRuntimeConsoleSummaryMock
}));

vi.mock("../../../server/platform/specialized/console/tool-management-client-connections.mjs", () => ({
  buildToolManagementClientConnectionRows: buildToolManagementClientConnectionRowsMock
}));

vi.mock("../../../server/protocols/checkpoint/upload-session-store.mjs", () => uploadSessionMocks);

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/analysis-engine-registry.mjs", () => ({
  listAvailableAnalysisModules: dynamicMocks.listAvailableAnalysisModules
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/rules/email-rules.mjs", () => ({
  loadEmailRules: dynamicMocks.loadEmailRules,
  saveEmailRules: dynamicMocks.saveEmailRules
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/rules/expert-vocabulary.mjs", () => ({
  getExpertVocabularySummary: dynamicMocks.getExpertVocabularySummary,
  listExpertVocabularyVersions: dynamicMocks.listExpertVocabularyVersions,
  loadExpertVocabulary: dynamicMocks.loadExpertVocabulary,
  saveExpertVocabulary: dynamicMocks.saveExpertVocabulary
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  getKnowledgeGuidanceSummary: dynamicMocks.getKnowledgeGuidanceSummary,
  listKnowledgeTaxonomyVersions: dynamicMocks.listKnowledgeTaxonomyVersions,
  loadKnowledgeTaxonomy: dynamicMocks.loadKnowledgeTaxonomy,
  saveKnowledgeTaxonomy: dynamicMocks.saveKnowledgeTaxonomy
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/word-cloud/preprocess.mjs", () => ({
  preprocessWordCloudVocabulary: dynamicMocks.preprocessWordCloudVocabulary
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs", () => ({
  createDocumentParsingRuntime: dynamicMocks.createDocumentParsingRuntime,
  toPublicDocumentParsingResult: dynamicMocks.toPublicDocumentParsingResult
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/service.mjs", () => ({
  enhanceAffairTaxonomy: dynamicMocks.enhanceAffairTaxonomy
}));

vi.mock("../../../server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs", () => ({
  resumeKnowledgeWordCloudClassificationTasks: dynamicMocks.resumeKnowledgeWordCloudClassificationTasks
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs", () => ({
  normalizedStoreModule: true
}));

vi.mock("../../../server/platform/specialized/agent/agent-gateway/index.mjs", () => ({
  agentGatewayModule: true
}));

vi.mock("../../../server/platform/specialized/agent/agent-gateway/model-probe/index.mjs", () => ({
  modelProbeModule: true
}));

describe("console domain services", () => {
  it("creates a frozen service registry with static providers and upload session store", async () => {
    const { createConsoleDomainServices } = await import("../../../server/platform/specialized/console/console-domain-services.mjs");

    const services = createConsoleDomainServices();

    expect(Object.isFrozen(services)).toBe(true);
    expect(Object.isFrozen(services.uploadSessionStore)).toBe(true);
    expect(createAgentRuntimeProviderMock).toHaveBeenCalledWith({
      getAgentConfigRegistry: getAgentConfigRegistryMock,
      loadAgentGatewayModule: expect.any(Function),
      loadModelProbeModule: expect.any(Function)
    });
    expect(services.getAgentConfigRegistry).toBe(getAgentConfigRegistryMock);
    expect(services.agentRuntimeProvider).toMatchObject({ agentRuntime: true });
    expect(services.executeConsoleDomainOperation).toBe(executeConsoleDomainOperationMock);
    expect(services.buildKnowledgeConsoleSummary).toBe(buildKnowledgeConsoleSummaryMock);
    expect(services.buildRuntimeConsoleSummary).toBe(buildRuntimeConsoleSummaryMock);
    expect(services.uploadSessionStore.createOrResumeUploadSession).toBe(uploadSessionMocks.createOrResumeUploadSession);
    expect(services.uploadSessionStore.resolveUploadSessionFiles).toBe(uploadSessionMocks.resolveUploadSessionFiles);
  });

  it("builds path helpers and injects the real agent config registry into agent settings projection", async () => {
    const { createConsoleDomainServices } = await import("../../../server/platform/specialized/console/console-domain-services.mjs");
    const services = createConsoleDomainServices();

    expect(services.getEmailRulesPath("/data")).toBe("/data/rules/email-rules.json");
    expect(services.getExpertVocabularyPath("/data")).toBe("/data/rules/expert-vocabulary.json");
    expect(services.getKnowledgeTaxonomyPath("/data")).toBe("/data/rules/knowledge-taxonomy.json");

    await expect(services.buildAgentSettingsConsoleProjection({ userDataPath: "/data" })).resolves.toMatchObject({
      agentSettings: {
        userDataPath: "/data",
        getAgentConfigRegistry: getAgentConfigRegistryMock
      }
    });
  });

  it("delegates dynamic knowledge helpers to lazily imported modules", async () => {
    const { createConsoleDomainServices } = await import("../../../server/platform/specialized/console/console-domain-services.mjs");
    const services = createConsoleDomainServices();

    await expect(services.listAvailableAnalysisModules({ kind: "all" })).resolves.toEqual(["analysis-a"]);
    await expect(services.loadEmailRules("/rules.json")).resolves.toEqual({ email: "rules" });
    await expect(services.saveEmailRules("/rules.json", { version: 1 })).resolves.toEqual({ saved: "email" });
    await expect(services.getExpertVocabularySummary("/expert.json")).resolves.toEqual({ expert: "summary" });
    await expect(services.listExpertVocabularyVersions("/expert.json")).resolves.toEqual(["v1"]);
    await expect(services.loadExpertVocabulary("/expert.json")).resolves.toEqual({ expert: "vocabulary" });
    await expect(services.saveExpertVocabulary("/expert.json", {})).resolves.toEqual({ saved: "expert" });
    await expect(services.getKnowledgeGuidanceSummary("/taxonomy.json")).resolves.toEqual({ guidance: true });
    await expect(services.listKnowledgeTaxonomyVersions("/taxonomy.json")).resolves.toEqual(["t1"]);
    await expect(services.loadKnowledgeTaxonomy("/taxonomy.json")).resolves.toEqual({ taxonomy: true });
    await expect(services.saveKnowledgeTaxonomy("/taxonomy.json", {})).resolves.toEqual({ saved: "taxonomy" });
    await expect(services.preprocessWordCloudVocabulary({ text: "hello" })).resolves.toEqual({ terms: [] });
    await expect(services.createDocumentParsingRuntime({ userDataPath: "/data" })).resolves.toEqual({ parser: true });
    expect(await services.toPublicDocumentParsingResult({ ok: true })).toEqual({ public: true });
    await expect(services.enhanceAffairTaxonomy({ subject: "unit" })).resolves.toEqual({ enhanced: true });
    await expect(services.resumeKnowledgeWordCloudClassificationTasks({ limit: 1 })).resolves.toEqual({ resumed: true });

    expect(dynamicMocks.loadEmailRules).toHaveBeenCalledWith("/rules.json");
    expect(dynamicMocks.saveKnowledgeTaxonomy).toHaveBeenCalledWith("/taxonomy.json", {});
  });

  it("exposes lazy module loaders for normalized documents, agent gateway, and model probe", async () => {
    const { createConsoleDomainServices } = await import("../../../server/platform/specialized/console/console-domain-services.mjs");
    const services = createConsoleDomainServices();

    await expect(services.loadNormalizedDocumentStore()).resolves.toMatchObject({ normalizedStoreModule: true });
    await expect(services.loadAgentGatewayModule()).resolves.toMatchObject({ agentGatewayModule: true });
    await expect(services.loadModelProbeModule()).resolves.toMatchObject({ modelProbeModule: true });
  });
});
