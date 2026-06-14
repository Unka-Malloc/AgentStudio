// @vitest-environment jsdom
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleWordCloudCorpusController } from "../../../server-web/composables/console-word-cloud-corpus-controller";
import type {
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
  KnowledgeWordCloudTerm,
} from "../../../server-web/lib/types";

const wordCloudClient = vi.hoisted(() => ({
  getKnowledgeWordClouds: vi.fn(),
  saveKnowledgeWordClouds: vi.fn(),
  rebuildSourceVocabulary: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-word-cloud-client", () => ({
  getKnowledgeWordClouds: wordCloudClient.getKnowledgeWordClouds,
  rebuildSourceVocabulary: wordCloudClient.rebuildSourceVocabulary,
  saveKnowledgeWordClouds: wordCloudClient.saveKnowledgeWordClouds,
}));

function createDefaultWordCloudSetFixture(terms: KnowledgeWordCloudTerm[] = []): KnowledgeWordCloudSet {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    wordBagSetId: "draft-set",
    title: "语料词云",
    status: "draft",
    wordBagCount: 0,
    termsSnapshot: [...terms],
    wordBags: [],
    unassignedTerms: [...terms],
    corpusPaths: [],
    modelAlias: "",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

function createFixture(overrides: Record<string, unknown> = {}) {
  const busyKey = ref("");
  const error = ref("");
  const wordCloudCorpusPaths = ref<KnowledgeWordCloudCorpusPath[]>([]);
  const wordCloudDraft = ref<KnowledgeWordCloudSet | null>(null);
  const wordCloudMessages = ref<Array<{ id: string; role: string; text: string; at: string }>>([]);
  const wordCloudModelAlias = ref("model-1");
  const wordCloudState = ref<KnowledgeWordCloudState | null>(null);
  const wordCloudTerms = ref<KnowledgeWordCloudTerm[]>([{ term: "alpha", frequency: 1 }]);

  const options = {
    applySavedWordCloudSet: vi.fn(),
    autoAbsorbWordCloudTerms: vi.fn(() => 0),
    busyKey,
    canReadKnowledge: ref(true),
    canWriteKnowledge: ref(true),
    clearAllBusy: vi.fn(() => {
      busyKey.value = "";
    }),
    createDefaultWordCloudSet: vi.fn((terms?: KnowledgeWordCloudTerm[]) => createDefaultWordCloudSetFixture(terms)),
    error,
    setBusy: vi.fn((key: string) => {
      busyKey.value = key;
    }),
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudMessages,
    wordCloudModelAlias,
    wordCloudState,
    wordCloudTerms,
    ...overrides,
  };

  return {
    controller: createConsoleWordCloudCorpusController(options as any),
    options: options as typeof options & Record<string, any>,
  };
}

describe("console word cloud corpus controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("暴露公开 API 并正确标记路径标签与摘要", () => {
    const { controller, options } = createFixture();

    expect(controller).toEqual(expect.objectContaining({
      addWordCloudCorpusPaths: expect.any(Function),
      clearWordCloudCorpusPaths: expect.any(Function),
      persistWordCloudCorpusPaths: expect.any(Function),
      preferredWordCloudCorpusPaths: expect.any(Function),
      refreshWordCloudCorpusTerms: expect.any(Function),
      removeWordCloudCorpusPath: expect.any(Function),
      resolveWordCloudCorpusPathsForQuery: expect.any(Function),
      setWordCloudDraftCorpusPaths: expect.any(Function),
      wordCloudCorpusPathLabel: expect.any(Function),
      wordCloudCorpusPathSummary: expect.any(Object),
    }));

    expect(controller.wordCloudCorpusPathLabel({ path: "/tmp/file.txt", type: "file" } as any)).toBe("文件");
    expect(controller.wordCloudCorpusPathLabel({ path: "/tmp/folder", type: "directory" } as any)).toBe("目录");

    expect(controller.wordCloudCorpusPathSummary.value).toBe("");
    options.wordCloudCorpusPaths.value = [{ path: "/tmp", type: "directory" }];
    expect(controller.wordCloudCorpusPathSummary.value).toBe("已绑定 1 个目录/文件");
  });

  it("优先按显式参数、草稿、状态和当前绑定路径解析语料范围", () => {
    const { controller, options } = createFixture();

    options.wordCloudCorpusPaths.value = [{ path: "/bound", type: "directory" }];

    expect(controller.resolveWordCloudCorpusPathsForQuery({
      corpusPaths: ["  /explicit  ", { path: "/explicit/file", type: "file" }, ""],
    })).toEqual([
      { path: "/explicit", type: "" },
      { path: "/explicit/file", type: "file" },
    ]);

    options.wordCloudDraft.value = {
      wordBagSetId: "draft-1",
      title: "draft",
      status: "draft",
      wordBagCount: 0,
      termsSnapshot: [],
      wordBags: [],
      corpusPaths: [{ path: "/draft", type: "directory" }],
      unassignedTerms: [],
    };
    expect(controller.resolveWordCloudCorpusPathsForQuery()).toEqual([{ path: "/draft", type: "directory" }]);

    options.wordCloudDraft.value = null;
    options.wordCloudState.value = {
      terms: [{ term: "state", frequency: 1 }],
      corpusPaths: [{ path: "/state", type: "file" }],
      wordBagSet: null,
    };
    expect(controller.resolveWordCloudCorpusPathsForQuery()).toEqual([{ path: "/state", type: "file" }]);

    options.wordCloudState.value = {
      terms: [{ term: "state", frequency: 1 }],
      corpusPaths: [],
      wordBagSet: {
        wordBagSetId: "set-1",
        title: "state",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [{ path: "/bag", type: "directory" }],
      },
    };
    expect(controller.resolveWordCloudCorpusPathsForQuery()).toEqual([{ path: "/bag", type: "directory" }]);

    options.wordCloudState.value = { terms: [{ term: "state", frequency: 1 }], corpusPaths: [], wordBagSet: null };
    expect(controller.resolveWordCloudCorpusPathsForQuery()).toEqual([{ path: "/bound", type: "directory" }]);
  });

  it("在无草稿时会创建默认词云草稿并刷新语料路径", () => {
    const { controller, options } = createFixture();

    controller.setWordCloudDraftCorpusPaths();

    expect(options.createDefaultWordCloudSet).toHaveBeenCalledWith(options.wordCloudTerms.value);
    expect(options.wordCloudDraft.value).toEqual(expect.objectContaining({
      corpusPaths: [],
      termsSnapshot: options.wordCloudTerms.value,
      unassignedTerms: options.wordCloudTerms.value,
    }));
    expect(options.wordCloudDraft.value?.updatedAt).toBeTruthy();

    options.wordCloudCorpusPaths.value = [
      { path: " /a ", type: "directory" },
      { path: "/a", type: "directory" },
      { path: "/b", type: "file" },
    ];
    controller.setWordCloudDraftCorpusPaths();
    expect(options.wordCloudDraft.value?.corpusPaths).toEqual([
      { path: "/a", type: "directory" },
      { path: "/b", type: "file" },
    ]);
  });

  it("持久化会写入规范化后的语料路径并在失败时保留错误", async () => {
    const { controller, options } = createFixture();
    options.wordCloudDraft.value = {
      wordBagSetId: "draft-1",
      title: "draft",
      status: "draft",
      wordBagCount: 0,
      termsSnapshot: [],
      wordBags: [{ wordBagId: "bag-1", label: "词包", terms: [] }],
      unassignedTerms: [],
      modelAlias: "old-model",
    };
    options.wordCloudTerms.value = [{ term: "from-state", frequency: 2 }];
    wordCloudClient.saveKnowledgeWordClouds.mockResolvedValue({
      ok: true,
      wordBagSet: {
        wordBagSetId: "saved-1",
        title: "saved",
        status: "ready",
        wordBagCount: 1,
        termsSnapshot: [{ term: "saved", frequency: 1 }],
        wordBags: [],
        corpusPaths: [{ path: "/saved", type: "directory" }],
      },
    });

    await controller.persistWordCloudCorpusPaths([
      { path: " /one ", type: "directory" },
      { path: "/one", type: "directory" },
      { path: "/two", type: "file" },
    ], {
      auditAction: "add",
      auditPaths: [{ path: " /audit ", type: "file" }],
    });

    expect(wordCloudClient.saveKnowledgeWordClouds).toHaveBeenCalledWith({
      wordBagSet: expect.objectContaining({
        wordBagCount: 1,
        termsSnapshot: [{ term: "from-state", frequency: 2 }],
        corpusPaths: [
          { path: "/one", type: "directory" },
          { path: "/two", type: "file" },
        ],
        modelAlias: "model-1",
      }),
      auditAction: "add",
      auditPaths: [{ path: "/audit", type: "file" }],
      limit: 100000,
      minFrequency: 1,
    });
    expect(options.applySavedWordCloudSet).toHaveBeenCalledWith(expect.objectContaining({ wordBagSetId: "saved-1" }), {
      fallbackCorpusPaths: [
        { path: "/one", type: "directory" },
        { path: "/two", type: "file" },
      ],
    });
    expect(options.error.value).toBe("");

    wordCloudClient.saveKnowledgeWordClouds.mockRejectedValueOnce(new Error("保存失败"));
    await controller.persistWordCloudCorpusPaths([]);
    expect(options.error.value).toBe("保存失败");
  });

  it("刷新会处理重试、静默、重建和错误回退分支", async () => {
    const { controller, options } = createFixture();

    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [],
      corpusPaths: [],
      wordBagSet: {
        wordBagSetId: "saved-1",
        title: "saved",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [{ path: "/saved", type: "file" }],
      },
    });
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [{ term: "saved-term", frequency: 3 }],
      corpusPaths: [{ path: "/saved", type: "file" }],
      wordBagSet: {
        wordBagSetId: "saved-1",
        title: "saved",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [{ term: "saved-term", frequency: 3 }],
        wordBags: [],
        corpusPaths: [{ path: "/saved", type: "file" }],
      },
    });

    const terms = await controller.refreshWordCloudCorpusTerms();
    expect(terms).toEqual([{ term: "saved-term", frequency: 3 }]);
    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenNthCalledWith(1, {
      limit: 100000,
      minFrequency: 1,
      corpusPaths: [],
    });
    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenNthCalledWith(2, {
      limit: 100000,
      minFrequency: 1,
      corpusPaths: [{ path: "/saved", type: "file" }],
    });
    expect(options.setBusy).toHaveBeenCalledWith("knowledge:word-clouds:scope");
    expect(options.clearAllBusy).toHaveBeenCalled();
    expect(options.autoAbsorbWordCloudTerms).toHaveBeenCalledWith(expect.objectContaining({
      corpusPaths: [],
      termsSnapshot: [{ term: "saved-term", frequency: 3 }],
      unassignedTerms: [{ term: "saved-term", frequency: 3 }],
    }));
    expect(options.wordCloudCorpusPaths.value).toEqual([]);
    expect(options.wordCloudMessages.value[0].text).toBe("已按绑定路径读取 1 个语料词。");
    expect(options.error.value).toBe("");

    options.setBusy.mockClear();
    options.clearAllBusy.mockClear();
    wordCloudClient.getKnowledgeWordClouds.mockClear();
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [{ term: "silent", frequency: 1 }],
      corpusPaths: [{ path: "/silent", type: "directory" }],
      wordBagSet: {
        wordBagSetId: "set-2",
        title: "silent",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [{ path: "/silent", type: "directory" }],
      },
    });
    await controller.refreshWordCloudCorpusTerms({ silent: true, corpusPaths: [{ path: "/silent", type: "directory" }] });
    expect(options.setBusy).not.toHaveBeenCalled();
    expect(options.clearAllBusy).not.toHaveBeenCalled();

    options.wordCloudState.value = {
      terms: [{ term: "fallback", frequency: 9 }],
      corpusPaths: [{ path: "/fallback", type: "file" }],
      wordBagSet: null,
    };
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [{ term: "fallback", frequency: 9 }],
      corpusPaths: [{ path: "/fallback", type: "file" }],
      wordBagSet: {
        wordBagSetId: "set-2",
        title: "fallback",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [{ term: "fallback", frequency: 9 }],
        wordBags: [],
        corpusPaths: [{ path: "/fallback", type: "file" }],
      },
    });
    options.autoAbsorbWordCloudTerms.mockImplementationOnce(() => {
      throw new Error("读取失败");
    });
    await expect(controller.refreshWordCloudCorpusTerms({ corpusPaths: [{ path: "/fail", type: "directory" }] })).resolves.toEqual([{ term: "fallback", frequency: 9 }]);
    expect(options.error.value).toBe("读取失败");
    expect(options.wordCloudMessages.value[0].text).toBe("读取失败");

    options.wordCloudState.value = null;
    options.wordCloudMessages.value = [];
    wordCloudClient.getKnowledgeWordClouds.mockReset();
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [],
      corpusPaths: [],
      wordBagSet: {
        wordBagSetId: "set-3",
        title: "rebuild",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [],
      },
    });
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [{ term: "rebuilt", frequency: 4 }],
      corpusPaths: [{ path: "/rebuild", type: "directory" }],
      wordBagSet: {
        wordBagSetId: "set-3",
        title: "rebuild",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [{ term: "rebuilt", frequency: 4 }],
        wordBags: [],
        corpusPaths: [{ path: "/rebuild", type: "directory" }],
      },
    });
    wordCloudClient.rebuildSourceVocabulary.mockResolvedValue({});
    await controller.refreshWordCloudCorpusTerms({
      forceRebuild: true,
      corpusPaths: [{ path: "/rebuild", type: "directory" }],
    });
    expect(wordCloudClient.rebuildSourceVocabulary).toHaveBeenCalledTimes(1);
    expect(options.wordCloudMessages.value.map((item) => item.text)).toContain("已重建并读取 1 个语料词。");

    wordCloudClient.getKnowledgeWordClouds.mockReset();
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [],
      corpusPaths: [],
      wordBagSet: {
        wordBagSetId: "set-4",
        title: "rebuild-empty",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [],
      },
    });
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [],
      corpusPaths: [],
      wordBagSet: {
        wordBagSetId: "set-4",
        title: "rebuild-empty",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [],
      },
    });
    wordCloudClient.rebuildSourceVocabulary.mockResolvedValue({});
    await controller.refreshWordCloudCorpusTerms({
      forceRebuild: true,
      corpusPaths: [{ path: "/rebuild-empty", type: "directory" }],
    });
    expect(options.wordCloudMessages.value.map((item) => item.text)).toContain("语料范围重建后仍无可用词频。请确认目录下存在已入库文档。");
  });

  it("增删清空语料路径会去重、持久化并在可读时刷新", async () => {
    const { controller, options } = createFixture();

    wordCloudClient.saveKnowledgeWordClouds.mockResolvedValue({
      ok: true,
      wordBagSet: {
        wordBagSetId: "saved",
        title: "saved",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [],
      },
    });
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValue({
      terms: [{ term: "x", frequency: 1 }],
      corpusPaths: [],
      wordBagSet: {
        wordBagSetId: "saved",
        title: "saved",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [],
      },
    });

    await controller.addWordCloudCorpusPaths([
      { path: " /tmp ", type: "directory" },
      { path: "/TMP", type: "directory" },
      { path: "/file", type: "file" },
    ]);
    expect(options.wordCloudCorpusPaths.value).toEqual([
      { path: "/tmp", type: "directory" },
      { path: "/file", type: "file" },
    ]);
    expect(wordCloudClient.saveKnowledgeWordClouds).toHaveBeenCalledTimes(1);
    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenCalledTimes(1);

    await controller.addWordCloudCorpusPaths([
      { path: "/tmp", type: "directory" },
      { path: "/file", type: "file" },
    ]);
    expect(wordCloudClient.saveKnowledgeWordClouds).toHaveBeenCalledTimes(1);
    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenCalledTimes(1);

    wordCloudClient.saveKnowledgeWordClouds.mockClear();
    wordCloudClient.getKnowledgeWordClouds.mockClear();
    await controller.removeWordCloudCorpusPath(0);
    expect(options.wordCloudCorpusPaths.value).toEqual([{ path: "/file", type: "file" }]);
    expect(wordCloudClient.saveKnowledgeWordClouds).toHaveBeenCalledWith(expect.objectContaining({
      auditAction: "remove",
      auditPaths: [{ path: "/tmp", type: "directory" }],
    }));
    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenCalledTimes(1);

    wordCloudClient.saveKnowledgeWordClouds.mockClear();
    wordCloudClient.getKnowledgeWordClouds.mockClear();
    await controller.clearWordCloudCorpusPaths();
    expect(options.wordCloudCorpusPaths.value).toEqual([]);
    expect(wordCloudClient.saveKnowledgeWordClouds).toHaveBeenCalledWith(expect.objectContaining({
      auditAction: "clear",
      auditPaths: [{ path: "/file", type: "file" }],
    }));
    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenCalledTimes(1);
  });

  it("在无写权限或无读权限时会短路并保持状态", async () => {
    const { controller, options } = createFixture();

    options.canWriteKnowledge.value = false;
    await controller.persistWordCloudCorpusPaths([{ path: "/skip", type: "directory" }]);
    expect(wordCloudClient.saveKnowledgeWordClouds).not.toHaveBeenCalled();

    options.canReadKnowledge.value = false;
    await expect(controller.refreshWordCloudCorpusTerms()).resolves.toEqual([]);
    expect(wordCloudClient.getKnowledgeWordClouds).not.toHaveBeenCalled();

    options.wordCloudCorpusPaths.value = [{ path: "/unchanged", type: "directory" }];
    wordCloudClient.saveKnowledgeWordClouds.mockResolvedValue({
      ok: true,
      wordBagSet: {
        wordBagSetId: "saved",
        title: "saved",
        status: "ready",
        wordBagCount: 0,
        termsSnapshot: [],
        wordBags: [],
        corpusPaths: [],
      },
    });
    await controller.addWordCloudCorpusPaths([{ path: "/x", type: "directory" }]);
    expect(options.wordCloudCorpusPaths.value).toEqual([
      { path: "/unchanged", type: "directory" },
      { path: "/x", type: "directory" },
    ]);
  });
});
