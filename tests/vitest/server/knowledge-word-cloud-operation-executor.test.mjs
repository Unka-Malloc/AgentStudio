import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeKnowledgeWordCloudOperation } from "../../../server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs";

beforeEach(() => {
  vi.clearAllMocks();
});

function createMetadataStore(overrides = {}) {
  const defaults = {
    getKnowledgeWordCloudState: vi.fn(async (input) => ({ ok: true, input, wordBagSets: [] })),
    saveKnowledgeWordCloudSet: vi.fn(async ({ wordBagSet }) => ({
      ok: true,
      wordBagSet: {
        wordBagSetId: wordBagSet?.wordBagSetId || "set-default",
        title: wordBagSet?.title || "语料词云",
        status: wordBagSet?.status || "draft",
        ...wordBagSet
      }
    })),
    getKnowledgeWordBagTerms: vi.fn(async (input) => ({ ok: true, groups: [], input })),
    exportKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, exportType: "pact.knowledge.word_bags.export" })),
    importKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, wordBagSet: { wordBagSetId: "imported-set" } })),
    addKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "added" })),
    updateKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "updated" })),
    deleteKnowledgeWordBag: vi.fn(async () => ({ ok: true, action: "deleted" }))
  };
  return { ...defaults, ...overrides };
}

function createProtocolEventBus() {
  return {
    publish: vi.fn(async () => ({ ok: true }))
  };
}

function createContext(overrides = {}) {
  const metadataStore = overrides.metadataStore || createMetadataStore();
  return {
    context: {
      metadataStore,
      protocolEventBus: overrides.protocolEventBus || createProtocolEventBus(),
      appendConsoleOperationLog: overrides.appendConsoleOperationLog || vi.fn(),
      loadEmailRules: overrides.loadEmailRules || vi.fn(async () => ({ defaultRule: "rule-v1" })),
      userDataPath: "/tmp/knowledge-word-cloud-test"
    },
    metadataStore
  };
}

describe("knowledge word cloud operation executor", () => {
  it("returns null for removed agent proposal operations", async () => {
    const { context, metadataStore } = createContext();

    await expect(executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: { modelAlias: "agent-v1", prompt: "按主题分类" },
      context
    })).resolves.toBeNull();

    expect(metadataStore.saveKnowledgeWordCloudSet).not.toHaveBeenCalled();
  });

  it("loads word-cloud state with normalized corpus paths and rule context", async () => {
    const { context, metadataStore } = createContext();

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.get",
      input: {
        corpusPath: [
          "directory:/docs",
          { type: "file", path: "/docs/a.md" },
          { type: "file", path: "/docs/a.md" },
          { type: "unknown", path: "/docs/b.md" }
        ]
      },
      context
    });

    expect(result).toMatchObject({ status: 200, payload: { ok: true } });
    expect(metadataStore.getKnowledgeWordCloudState).toHaveBeenCalledWith(expect.objectContaining({
      corpusPaths: [
        { type: "directory", path: "/docs" },
        { type: "file", path: "/docs/a.md" },
        { type: "", path: "/docs/b.md" }
      ],
      rules: { defaultRule: "rule-v1" }
    }));
  });

  it("saves word-cloud state, writes corpus audit logs, and publishes updates", async () => {
    const protocolEventBus = createProtocolEventBus();
    const appendConsoleOperationLog = vi.fn();
    const { context, metadataStore } = createContext({ protocolEventBus, appendConsoleOperationLog });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.save",
      input: {
        auditAction: "add",
        auditPaths: [{ type: "directory", path: "/docs" }],
        wordBagSet: {
          wordBagSetId: "set-1",
          title: "Manual Set",
          corpusPaths: [{ type: "directory", path: "/docs" }],
          wordBags: []
        }
      },
      context
    });

    expect(result.status).toBe(200);
    expect(metadataStore.saveKnowledgeWordCloudSet).toHaveBeenCalledWith(expect.objectContaining({
      rules: { defaultRule: "rule-v1" },
      wordBagSet: expect.objectContaining({ wordBagSetId: "set-1" })
    }));
    expect(appendConsoleOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "knowledge.word_clouds.corpus_paths.add",
      event: "knowledge.word_clouds.corpus_paths.changed",
      status: "ok"
    }));
    expect(protocolEventBus.publish).toHaveBeenCalledWith(
      "knowledge.word_clouds",
      expect.any(Object),
      expect.objectContaining({ type: "knowledge.word_clouds.updated" })
    );
  });

  it("keeps import/export and word-bag mutations metadata-store owned", async () => {
    const protocolEventBus = createProtocolEventBus();
    const { context, metadataStore } = createContext({ protocolEventBus });

    await expect(executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.export",
      input: { wordBagSetId: "set-1" },
      context
    })).resolves.toMatchObject({ status: 200, payload: { exportType: "pact.knowledge.word_bags.export" } });

    await expect(executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.import",
      input: { importPayload: { wordBagSetId: "set-2" } },
      context
    })).resolves.toMatchObject({ status: 201, payload: { ok: true } });

    await expect(executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.add",
      input: { wordBagSetId: "set-1", wordBag: { label: "New" } },
      context
    })).resolves.toMatchObject({ status: 201, payload: { action: "added" } });

    await expect(executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.update",
      input: { wordBagSetId: "set-1", wordBagId: "bag-1", patch: { label: "Updated" } },
      context
    })).resolves.toMatchObject({ status: 200, payload: { action: "updated" } });

    await expect(executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.delete",
      input: { wordBagSetId: "set-1", wordBagId: "bag-1" },
      context
    })).resolves.toMatchObject({ status: 200, payload: { action: "deleted" } });

    expect(metadataStore.addKnowledgeWordBag).toHaveBeenCalledTimes(1);
    expect(protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type)).toEqual(expect.arrayContaining([
      "knowledge.word_clouds.imported",
      "knowledge.word_clouds.word_bag.added",
      "knowledge.word_clouds.word_bag.updated",
      "knowledge.word_clouds.word_bag.deleted"
    ]));
  });

  it("maps metadata-store mutation errors to operation responses", async () => {
    const metadataStore = createMetadataStore({
      exportKnowledgeWordCloudSet: vi.fn(async () => {
        const error = new Error("permission denied");
        error.statusCode = 403;
        error.code = "access_denied";
        throw error;
      })
    });
    const { context } = createContext({ metadataStore });

    await expect(executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.export",
      input: { wordBagSetId: "set-err" },
      context
    })).resolves.toEqual({
      status: 403,
      payload: {
        ok: false,
        code: "access_denied",
        error: "permission denied"
      }
    });
  });
});
