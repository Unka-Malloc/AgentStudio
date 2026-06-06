import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hashClientStringMock = vi.hoisted(() => vi.fn());
const serverTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/security/client-strings.mjs", () => ({
  hashClientString: hashClientStringMock,
  serverToken: serverTokenMock
}));

let executeConsoleDomainOperation;
let executeKnowledgeWordCloudOperation;
let wordCloudExecutorModule;

beforeAll(async () => {
  wordCloudExecutorModule = await import("../../../server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs");
  ({ executeKnowledgeWordCloudOperation } = wordCloudExecutorModule);
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));

  hashClientStringMock.mockImplementation((value) => `hash:${String(value)}`);
  serverTokenMock.mockImplementation((namespace, ...values) => `${namespace}:${values.join(":") || "seed"}`);
});

beforeEach(() => {
  vi.restoreAllMocks();
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

function createContext(overrides = {}) {
  return {
    userDataPath: overrides.userDataPath || "/tmp/console-domain-word-cloud-final-extra-6",
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
    discoveryState: overrides.discoveryState || { offlineAfterSeconds: 77 },
    consoleDomainServices: overrides.consoleDomainServices || {}
  };
}

describe("console executor final extra coverage 6", () => {
  it("returns the unregistered payload for unknown operations and delegates word-cloud ops through the domain executor", async () => {
    const unknown = await executeConsoleDomainOperation({
      operationId: "console.unknown.operation",
      input: { any: "value" },
      context: createContext({ userDataPath: "/tmp/unused" })
    });

    expect(unknown).toEqual({
      status: 501,
      payload: {
        ok: false,
        error: {
          code: "console_domain_operation_not_registered",
          message: "Console domain operation is not registered in the specialized executor.",
          details: { operationId: "console.unknown.operation" }
        }
      }
    });

    const delegateSpy = vi
      .spyOn(wordCloudExecutorModule, "executeKnowledgeWordCloudOperation")
      .mockResolvedValue({
        status: 204,
        payload: { ok: true, delegated: "word-cloud" }
      });

    const delegated = await executeConsoleDomainOperation({
      operationId: "knowledge.word_bags.delete",
      input: { wordBagSetId: "set-1", wordBagId: "bag-1" },
      context: createContext()
    });

    expect(delegateSpy).toHaveBeenCalledWith({
      operationId: "knowledge.word_bags.delete",
      input: { wordBagSetId: "set-1", wordBagId: "bag-1" },
      context: expect.any(Object)
    });
    expect(delegated).toEqual({
      status: 204,
      payload: { ok: true, delegated: "word-cloud" }
    });
  });

  it("returns 503 when the word-cloud metadata store is missing", async () => {
    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.get",
      context: {}
    });

    expect(result).toEqual({
      status: 503,
      payload: { ok: false, error: "元数据存储不可用。" }
    });
  });

  it("normalizes save audit actions and allows add/update/delete without a protocol event bus", async () => {
    const metadataStore = createMetadataStore({
      saveKnowledgeWordCloudSet: vi.fn(async ({ wordBagSet }) => ({
        ok: true,
        wordBagSet: {
          wordBagSetId: wordBagSet?.wordBagSetId || "set-save-1",
          title: wordBagSet?.title || "语料词云",
          status: wordBagSet?.status || "draft",
          corpusPaths: [
            { type: "directory", path: "/docs" },
            { type: "file", path: "/docs/readme.md" }
          ],
          ...wordBagSet
        }
      })),
      addKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "added" })),
      updateKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "updated" })),
      deleteKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "deleted" }))
    });
    const appendConsoleOperationLog = vi.fn();
    const context = createContext({
      metadataStore,
      protocolEventBus: {},
      appendConsoleOperationLog
    });

    const saveResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.save",
      input: {
        wordBagSet: { wordBagSetId: "set-save-1", title: "词云集" },
        auditAction: " custom ",
        auditPaths: [
          { path: " /log/a ", type: "file" },
          { path: "/log/a", type: "file" },
          { path: "/log/b", type: "directory" }
        ]
      },
      context
    });

    expect(saveResult).toEqual({
      status: 200,
      payload: expect.objectContaining({
        ok: true,
        wordBagSet: expect.objectContaining({
          wordBagSetId: "set-save-1",
          title: "词云集"
        })
      })
    });
    expect(context.loadEmailRules).toHaveBeenCalledWith(context.userDataPath);
    expect(metadataStore.saveKnowledgeWordCloudSet).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: { defaultRule: "rule-v1" }
      })
    );
    expect(appendConsoleOperationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "knowledge.word_clouds.corpus_paths.save",
        input: expect.objectContaining({
          action: "save",
          changedPathCount: 2,
          corpusPathCount: 2,
          corpusPathTypes: expect.arrayContaining(["directory", "file"])
        }),
        output: expect.objectContaining({
          ok: true,
          wordBagSetId: "set-save-1",
          corpusPathCount: 2
        })
      })
    );

    const addResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.add",
      input: { wordBagSetId: "set-save-1", wordBag: { label: "A" } },
      context
    });
    const updateResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.update",
      input: { wordBagSetId: "set-save-1", wordBagId: "bag-1", patch: { label: "B" } },
      context
    });
    const deleteResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.delete",
      input: { wordBagSetId: "set-save-1", wordBagId: "bag-1" },
      context
    });

    expect(addResult).toEqual({
      status: 201,
      payload: { ok: true, action: "added" }
    });
    expect(updateResult).toEqual({
      status: 200,
      payload: { ok: true, action: "updated" }
    });
    expect(deleteResult).toEqual({
      status: 200,
      payload: { ok: true, action: "deleted" }
    });
  });
});
