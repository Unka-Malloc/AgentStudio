import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let executeConsoleDomainOperation;
let executeKnowledgeWordCloudOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
  ({ executeKnowledgeWordCloudOperation } = await import(
    "../../../server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs"
  ));
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

function createContext(overrides = {}) {
  return {
    metadataStore: overrides.metadataStore || createMetadataStore(),
    protocolEventBus: overrides.protocolEventBus || { publish: vi.fn(async () => ({ ok: true })) },
    queueMonitor: overrides.queueMonitor || {
      registerStarted: vi.fn(async () => null),
      registerHeartbeat: vi.fn(async () => null),
      registerClosed: vi.fn(async () => null)
    },
    appendConsoleOperationLog: overrides.appendConsoleOperationLog || vi.fn(),
    loadEmailRules: overrides.loadEmailRules || vi.fn(async () => ({ defaultRule: "rule-v1" })),
    userDataPath: overrides.userDataPath || "/tmp/console-domain-word-cloud-test",
    authSession: overrides.authSession || { user: { userId: "u-1", username: "tester" } },
    contextRuntime: overrides.contextRuntime || {},
    clientRuntimeAllocator: overrides.clientRuntimeAllocator || {},
    agentRuntimeProvider: overrides.agentRuntimeProvider || null,
    preprocessWordCloudVocabulary: overrides.preprocessWordCloudVocabulary
  };
}

describe("console-domain word cloud routes", () => {
  it("routes knowledge.word_clouds.get through the specialized executor and normalizes null input", async () => {
    const metadataStore = createMetadataStore({
      getKnowledgeWordCloudState: vi.fn(async () => ({ ok: true, wordBagSets: [{ wordBagSetId: "set-1" }] }))
    });
    const loadEmailRules = vi.fn(async () => ({ defaultRule: "rule-v2" }));

    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.word_clouds.get",
      input: null,
      context: createContext({ metadataStore, loadEmailRules })
    });

    expect(result).toEqual({
      status: 200,
      payload: { ok: true, wordBagSets: [{ wordBagSetId: "set-1" }] }
    });
    expect(metadataStore.getKnowledgeWordCloudState).toHaveBeenCalledWith({
      rules: { defaultRule: "rule-v2" }
    });
    expect(loadEmailRules).toHaveBeenCalledWith("/tmp/console-domain-word-cloud-test");
  });
});

describe("knowledge word cloud boundary handling", () => {
  it("normalizes save inputs and skips audit logging when auditAction is blank", async () => {
    const metadataStore = createMetadataStore({
      saveKnowledgeWordCloudSet: vi.fn(async ({ wordBagSet }) => ({
        ok: true,
        wordBagSet: {
          wordBagSetId: "set-save-1",
          title: "Saved set",
          status: "completed",
          corpusPaths: wordBagSet?.corpusPaths || [],
          ...wordBagSet
        }
      }))
    });
    const appendConsoleOperationLog = vi.fn();
    const protocolEventBus = { publish: vi.fn(async () => ({ ok: true })) };

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.save",
      input: {
        wordBagSet: { title: "Saved set" },
        auditAction: "   ",
        corpusPaths: [
          "file:/docs/alpha.txt",
          { path: "/docs/alpha.txt", type: "file" },
          "directory:/docs",
          { path: "/docs", type: "directory" }
        ]
      },
      context: createContext({
        metadataStore,
        appendConsoleOperationLog,
        protocolEventBus
      })
    });

    expect(result).toEqual({
      status: 200,
      payload: expect.objectContaining({
        ok: true,
        wordBagSet: expect.objectContaining({ wordBagSetId: "set-save-1" })
      })
    });
    expect(metadataStore.saveKnowledgeWordCloudSet).toHaveBeenCalledWith(
      expect.objectContaining({
        corpusPaths: [
          { type: "file", path: "/docs/alpha.txt" },
          { type: "directory", path: "/docs" }
        ],
        rules: { defaultRule: "rule-v1" }
      })
    );
    expect(appendConsoleOperationLog).not.toHaveBeenCalled();
    expect(protocolEventBus.publish).toHaveBeenCalledWith(
      "knowledge.word_clouds",
      expect.any(Object),
      expect.objectContaining({ type: "knowledge.word_clouds.updated" })
    );
  });

  it("returns the empty-vocabulary 409 branch without trying to rebuild when no corpus scope is provided", async () => {
    const metadataStore = createMetadataStore({
      listSourceCorpusRawTerms: vi.fn(() => []),
      rebuildSourceVocabulary: vi.fn(() => ({ sourceCorpusRawTermCount: 9 }))
    });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: {
        modelAlias: "agent-v1",
        prompt: "按主题分类"
      },
      context: createContext({ metadataStore })
    });

    expect(result).toEqual({
      status: 409,
      payload: {
        ok: false,
        error: "语料词频表为空，请先完成文档入库并重建语料词频。"
      }
    });
    expect(metadataStore.rebuildSourceVocabulary).not.toHaveBeenCalled();
  });

  it("publishes the import/add/update/delete success events", async () => {
    const metadataStore = createMetadataStore({
      importKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, wordBagSet: { wordBagSetId: "imported-set" } })),
      addKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "added" })),
      updateKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "updated" })),
      deleteKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "deleted" }))
    });
    const protocolEventBus = { publish: vi.fn(async () => ({ ok: true })) };

    const importResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.import",
      input: { value: "payload" },
      context: createContext({ metadataStore, protocolEventBus })
    });
    const addResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.add",
      input: { wordBagSetId: "set-1", wordBag: { label: "A" } },
      context: createContext({ metadataStore, protocolEventBus })
    });
    const updateResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.update",
      input: { wordBagSetId: "set-1", wordBagId: "bag-1", patch: { label: "B" } },
      context: createContext({ metadataStore, protocolEventBus })
    });
    const deleteResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.delete",
      input: { wordBagSetId: "set-1", wordBagId: "bag-1" },
      context: createContext({ metadataStore, protocolEventBus })
    });

    expect(importResult).toEqual({
      status: 201,
      payload: { ok: true, wordBagSet: { wordBagSetId: "imported-set" } }
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
    expect(protocolEventBus.publish.mock.calls.map((call) => call[2]?.type)).toEqual([
      "knowledge.word_clouds.imported",
      "knowledge.word_clouds.word_bag.added",
      "knowledge.word_clouds.word_bag.updated",
      "knowledge.word_clouds.word_bag.deleted"
    ]);
  });

  it("falls back to a 500 mutation error when the operation status code is not in the HTTP error range", async () => {
    const badStatusError = Object.assign(new Error("word bag query failed"), {
      statusCode: 302,
      code: "redirected"
    });
    const metadataStore = createMetadataStore({
      getKnowledgeWordBagTerms: vi.fn(() => {
        throw badStatusError;
      })
    });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.terms",
      input: { wordBagSetId: "set-err", wordBagIds: ["bag-1"] },
      context: createContext({ metadataStore })
    });

    expect(result).toEqual({
      status: 500,
      payload: {
        ok: false,
        code: "redirected",
        error: "word bag query failed"
      }
    });
  });
});
