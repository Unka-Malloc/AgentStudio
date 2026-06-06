import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hashClientStringMock = vi.hoisted(() => vi.fn());
const serverTokenMock = vi.hoisted(() => vi.fn());
const getSettingsPathMock = vi.hoisted(() => vi.fn((userDataPath = "") => `${userDataPath}/settings.json`));
const loadSettingsMock = vi.hoisted(() => vi.fn(async () => ({})));
const buildClientConnectionListMock = vi.hoisted(() =>
  vi.fn((registrations = { summary: {}, items: [] }, additionalRows = []) => ({
    summary: registrations?.summary || {},
    items: [...(registrations?.items || []), ...additionalRows]
  }))
);

vi.mock("../../../server/platform/common/security/client-strings.mjs", () => ({
  hashClientString: hashClientStringMock,
  serverToken: serverTokenMock
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  getSettingsPath: getSettingsPathMock,
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/common/console/http/client-connection-list.mjs", () => ({
  buildClientConnectionList: buildClientConnectionListMock
}));

vi.mock("../../../server/platform/common/console/http/api-facade.mjs", () => ({
  buildClientConnectionList: buildClientConnectionListMock,
  buildConsoleState: vi.fn(async () => ({ ok: true })),
  buildRuntimeInfo: vi.fn(async () => ({ ok: true }))
}));

let executeConsoleDomainOperation;
let executeKnowledgeWordCloudOperation;
let buildConsoleClientConnections;
let buildAgentSettingsConsoleProjection;
let buildToolManagementClientConnectionRows;
let wordCloudExecutorModule;

beforeAll(async () => {
  wordCloudExecutorModule = await import("../../../server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs");
  ({ executeKnowledgeWordCloudOperation } = wordCloudExecutorModule);
  ({
    executeConsoleDomainOperation
  } = await import("../../../server/platform/specialized/console/console-domain-operation-executor.mjs"));
  ({
    buildConsoleClientConnections,
    buildAgentSettingsConsoleProjection
  } = await import("../../../server/platform/specialized/console/console-state-projections.mjs"));
  ({ buildToolManagementClientConnectionRows } = await import(
    "../../../server/platform/specialized/console/tool-management-client-connections.mjs"
  ));

  hashClientStringMock.mockImplementation((value) => `hash:${String(value)}`);
  serverTokenMock.mockImplementation((namespace, ...values) => `${namespace}:${values.join(":") || "seed"}`);
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createMetadataStore(overrides = {}) {
  const defaults = {
    getKnowledgeWordCloudState: vi.fn(async () => ({ ok: true, wordBagSets: [] })),
    listSourceCorpusRawTerms: vi.fn(() => []),
    listSourceVocabularyTermStats: vi.fn(() => []),
    rebuildSourceVocabulary: vi.fn(() => ({ sourceCorpusRawTermCount: 0 })),
    saveKnowledgeWordCloudSet: vi.fn(async ({ wordBagSet }) => ({
      ok: true,
      wordBagSet: {
        wordBagSetId: wordBagSet?.wordBagSetId || "set-default",
        title: wordBagSet?.title || "语料词云",
        status: wordBagSet?.status || "draft",
        corpusPaths: wordBagSet?.corpusPaths || [],
        ...wordBagSet
      }
    })),
    getKnowledgeWordBagTerms: vi.fn(async () => ({ ok: true, groups: [] })),
    exportKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, exportType: "pact.knowledge.word_bags.export" })),
    importKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, wordBagSet: { wordBagSetId: "imported-set" } })),
    addKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "added" })),
    updateKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "updated" })),
    deleteKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "deleted" }))
  };
  return { ...defaults, ...overrides };
}

function createDomainContext(overrides = {}) {
  return {
    userDataPath: overrides.userDataPath || "/tmp/console-domain-word-cloud-final-extra-5",
    authSession: overrides.authSession || { user: { userId: "u-1", username: "tester" } },
    metadataStore: overrides.metadataStore || createMetadataStore(),
    protocolEventBus: overrides.protocolEventBus || { publish: vi.fn(async () => ({ ok: true })) },
    queueMonitor: overrides.queueMonitor || {
      registerStarted: vi.fn(async () => null),
      registerHeartbeat: vi.fn(async () => null),
      registerClosed: vi.fn(async () => null)
    },
    appendConsoleOperationLog: overrides.appendConsoleOperationLog || vi.fn(),
    loadEmailRules: overrides.loadEmailRules || vi.fn(async () => ({ defaultRule: "rule-v1" })),
    contextRuntime: overrides.contextRuntime || {},
    clientRuntimeAllocator: overrides.clientRuntimeAllocator || {},
    agentRuntimeProvider: overrides.agentRuntimeProvider || null,
    toolSkillManagementProvider: overrides.toolSkillManagementProvider,
    storageProvider: overrides.storageProvider,
    discoveryState: overrides.discoveryState || { offlineAfterSeconds: 77 },
    consoleDomainServices: overrides.consoleDomainServices || {}
  };
}

describe("console-domain executor delegation and status handling", () => {
  it("returns provider-missing and passthrough status codes for tool management operations", async () => {
    const missingProvider = await executeConsoleDomainOperation({
      operationId: "authorization.grants.create",
      input: { scope: "console:read" },
      context: createDomainContext()
    });
    expect(missingProvider).toEqual({
      status: 503,
      payload: { error: "Tool/Skill management provider is unavailable." }
    });

    const provider = {
      createAuthorizationGrant: vi.fn(async () => ({ grant: { grantId: "grant-1" }, token: "token-1" })),
      revokeAuthorizationGrant: vi.fn(async () => null),
      createMcpAuthorizationRequest: vi.fn(() => ({ requestId: "req-1" })),
      listMcpAuthorizationRequests: vi.fn(() => [{ requestId: "req-1" }]),
      resolveMcpAuthorizationRequest: vi.fn(async () => ({ success: false }))
    };

    const created = await executeConsoleDomainOperation({
      operationId: "authorization.grants.create",
      input: { scope: "console:read" },
      context: createDomainContext({ toolSkillManagementProvider: provider })
    });
    expect(created).toEqual({
      status: 201,
      payload: expect.objectContaining({
        ok: true,
        grant: { grantId: "grant-1" },
        token: "token-1"
      })
    });
    expect(provider.createAuthorizationGrant).toHaveBeenCalledWith({ scope: "console:read" });

    const revoked = await executeConsoleDomainOperation({
      operationId: "authorization.grants.revoke",
      input: { grantId: "missing" },
      context: createDomainContext({ toolSkillManagementProvider: provider })
    });
    expect(revoked).toEqual({
      status: 404,
      payload: { error: "授权 grant 不存在。" }
    });

    const requestResult = await executeConsoleDomainOperation({
      operationId: "tool_management.mcp.request_authorization",
      input: { clientId: "client-1" },
      context: createDomainContext({ toolSkillManagementProvider: provider })
    });
    expect(requestResult).toEqual({
      status: 200,
      payload: { requestId: "req-1" }
    });
    expect(provider.createMcpAuthorizationRequest).toHaveBeenCalledWith(
      { clientId: "client-1" },
      { request: null }
    );

    const resolveResult = await executeConsoleDomainOperation({
      operationId: "tool_management.mcp.resolve_request",
      input: { requestId: "req-1" },
      context: createDomainContext({ toolSkillManagementProvider: provider })
    });
    expect(resolveResult).toEqual({
      status: 404,
      payload: { error: "Request not found or already resolved." }
    });

    const passthrough = await executeConsoleDomainOperation({
      operationId: "tool_management.http.passthrough",
      context: createDomainContext()
    });
    expect(passthrough).toEqual({
      status: 503,
      payload: { error: "Tool/Skill management provider is unavailable." }
    });
  });

  it("delegates knowledge and client-connection operations while preserving returned status", async () => {
    const knowledgeSpy = vi
      .spyOn(wordCloudExecutorModule, "executeKnowledgeWordCloudOperation")
      .mockResolvedValue({
        status: 207,
        payload: { ok: true, delegated: true }
      });
    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.word_clouds.import",
      input: { payload: "x" },
      context: createDomainContext({
        consoleDomainServices: {}
      })
    });
    expect(knowledgeSpy).toHaveBeenCalledWith({
      operationId: "knowledge.word_clouds.import",
      input: { payload: "x" },
      context: expect.any(Object)
    });
    expect(result).toEqual({
      status: 207,
      payload: { ok: true, delegated: true }
    });

    knowledgeSpy.mockRestore();
  });
});

describe("knowledge word cloud executor bad payload handling", () => {
  it("normalizes empty save payloads and wraps import/export failures with status codes", async () => {
    const metadataStore = createMetadataStore({
      exportKnowledgeWordCloudSet: vi.fn(() => {
        throw Object.assign(new Error("bad export payload"), {
          statusCode: 422,
          code: "bad_export_payload"
        });
      }),
      importKnowledgeWordCloudSet: vi.fn(() => {
        throw Object.assign(new Error("bad import payload"), {
          statusCode: 400,
          code: "bad_import_payload"
        });
      })
    });
    const context = createDomainContext({ metadataStore });

    const saveResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.save",
      input: null,
      context
    });
    expect(saveResult).toEqual({
      status: 200,
      payload: expect.objectContaining({
        ok: true,
        wordBagSet: expect.objectContaining({
          status: "draft"
        })
      })
    });
    expect(metadataStore.saveKnowledgeWordCloudSet).toHaveBeenCalledWith({
      rules: { defaultRule: "rule-v1" }
    });

    const exportResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.export",
      input: "not-an-object",
      context
    });
    expect(exportResult).toEqual({
      status: 422,
      payload: {
        ok: false,
        code: "bad_export_payload",
        error: "bad export payload"
      }
    });

    const importResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.import",
      input: "still-not-an-object",
      context
    });
    expect(importResult).toEqual({
      status: 400,
      payload: {
        ok: false,
        code: "bad_import_payload",
        error: "bad import payload"
      }
    });
  });

  it("rejects malformed propose payloads with 400 responses", async () => {
    const context = createDomainContext({
      metadataStore: createMetadataStore({
        listSourceCorpusRawTerms: vi.fn(() => [{ term: "alpha", frequency: 1 }]),
        listSourceVocabularyTermStats: vi.fn(() => [{ term: "alpha", frequency: 1 }])
      })
    });

    await expect(
      executeKnowledgeWordCloudOperation({
        operationId: "knowledge.word_clouds.propose",
        input: { prompt: "按主题分类" },
        context
      })
    ).resolves.toEqual({
      status: 400,
      payload: { ok: false, error: "请选择用于生成词云的智能体。" }
    });

    await expect(
      executeKnowledgeWordCloudOperation({
        operationId: "knowledge.word_clouds.propose",
        input: { modelAlias: "agent-v1" },
        context
      })
    ).resolves.toEqual({
      status: 400,
      payload: { ok: false, error: "请输入词云分组意图。" }
    });
  });
});

describe("console client projections and tool management client connections", () => {
  it("returns empty projections for invalid inputs and swallows tool connection provider failures", async () => {
    loadSettingsMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    const projection = await buildAgentSettingsConsoleProjection({
      userDataPath: "/unit",
      getAgentConfigRegistry: () => ({})
    });
    expect(projection).toEqual({
      settings: {
        path: "/unit/settings.json",
        value: {}
      },
      agentSelector: expect.objectContaining({
        schemaVersion: 1,
        source: "agent-configs",
        options: []
      }),
      agentConfigs: {
        rootPath: "",
        modelListPath: "",
        agentListPath: "",
        modelManifest: {},
        agentManifest: {}
      }
    });

    const connectionRows = await buildConsoleClientConnections();
    expect(connectionRows).toEqual({
      summary: {},
      items: []
    });

    expect(
      buildToolManagementClientConnectionRows(
        {
          listMcpClientConnections: vi.fn(() => {
            throw new Error("provider failed");
          })
        },
        { offlineAfterSeconds: 15 }
      )
    ).toEqual([]);

    expect(buildToolManagementClientConnectionRows({}, { offlineAfterSeconds: 15 })).toEqual([]);
    expect(buildClientConnectionListMock).toHaveBeenCalledWith({ summary: {}, items: [] }, []);
  });
});
