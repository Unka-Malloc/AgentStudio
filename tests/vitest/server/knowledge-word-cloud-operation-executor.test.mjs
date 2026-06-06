import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hashClientStringMock = vi.hoisted(() => vi.fn());
const serverTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/security/client-strings.mjs", () => ({
  hashClientString: hashClientStringMock,
  serverToken: serverTokenMock
}));

let executeKnowledgeWordCloudOperation;
let resumeKnowledgeWordCloudClassificationTasks;

beforeAll(async () => {
  ({ executeKnowledgeWordCloudOperation, resumeKnowledgeWordCloudClassificationTasks } = await import(
    "../../../server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs"
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

function createQueueMonitor() {
  return {
    registerStarted: vi.fn(async () => null),
    registerHeartbeat: vi.fn(async () => null),
    registerClosed: vi.fn(async () => null)
  };
}

function createProtocolEventBus() {
  return {
    publish: vi.fn(async () => ({ ok: true }))
  };
}

function createContext(overrides = {}) {
  const metadataStore = overrides.metadataStore || createMetadataStore();
  const context = {
    metadataStore,
    queueMonitor: overrides.queueMonitor || createQueueMonitor(),
    protocolEventBus: overrides.protocolEventBus || createProtocolEventBus(),
    contextRuntime: {},
    clientRuntimeAllocator: {},
    agentRuntimeProvider: {
      callGatewayWithRuntimeSettings: vi.fn(async () => {
        throw new Error("agent runtime not configured");
      })
    },
    appendConsoleOperationLog: overrides.appendConsoleOperationLog || vi.fn(),
    loadEmailRules: overrides.loadEmailRules || vi.fn(async () => ({ defaultRule: "rule-v1" })),
    userDataPath: "/tmp/knowledge-word-cloud-test",
    authSession: { user: { userId: "u1", username: "tester" } },
    preprocessWordCloudVocabulary: overrides.preprocessWordCloudVocabulary
  };
  if (Object.hasOwn(overrides, "agentRuntimeProvider")) {
    context.agentRuntimeProvider = overrides.agentRuntimeProvider;
  }
  return { context, metadataStore };
}

async function waitForMockCalls(mockFn, count = 1, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mockFn.mock.calls.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} calls; only got ${mockFn.mock.calls.length}.`);
}

async function flushAsyncWindows() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("知识词云操作执行器基础分支", () => {
  it("返回 null 当操作未注册", async () => {
    const { context } = createContext();
    const result = await executeKnowledgeWordCloudOperation({
      operationId: "unknown.operation",
      context
    });
    expect(result).toBeNull();
  });

  it("缺少元数据存储时返回 503", async () => {
    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.get",
      context: {}
    });
    expect(result).toEqual({
      status: 503,
      payload: { ok: false, error: "元数据存储不可用。" }
    });
  });

  it("获取词云状态时带上规则上下文", async () => {
    const metadataStore = createMetadataStore({
      getKnowledgeWordCloudState: vi.fn(async () => ({ ok: true }))
    });
    const { context } = createContext({ metadataStore });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.get",
      input: { limit: 7 },
      context
    });

    expect(result.status).toEqual(200);
    expect(metadataStore.getKnowledgeWordCloudState).toHaveBeenCalledWith({
      limit: 7,
      rules: { defaultRule: "rule-v1" }
    });
    expect(result.payload).toEqual({ ok: true });
  });

  it("词袋词汇查询成功与失败路径可回传", async () => {
    const failError = Object.assign(new Error("term query failed"), {
      statusCode: 502,
      code: "term_query_error"
    });
    const metadataStore = createMetadataStore({
      getKnowledgeWordBagTerms: vi.fn(() => ({ ok: true, groups: [] }))
    });
    const { context } = createContext({ metadataStore });

    const okResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.terms",
      input: { wordBagSetId: "set-1", wordBagIds: ["bag-1"] },
      context
    });
    expect(okResult).toEqual({
      status: 200,
      payload: { ok: true, groups: [] }
    });
    metadataStore.getKnowledgeWordBagTerms = vi.fn(() => {
      throw failError;
    });
    const errResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.terms",
      input: { wordBagSetId: "set-1", wordBagIds: ["bag-1"] },
      context
    });
    expect(errResult).toEqual({
      status: 502,
      payload: {
        ok: false,
        code: "term_query_error",
        error: "term query failed"
      }
    });
  });

  it("保存词云时触发审计日志归一化路径", async () => {
    const savedWordBagSet = {
      wordBagSetId: "set-save-1",
      title: "已保存词袋",
      status: "completed",
      corpusPaths: [
        { path: " /docs ", type: "directory" },
        { path: "/notes", type: "file" }
      ],
      wordBags: [],
      termsSnapshot: []
    };
    const metadataStore = createMetadataStore({
      saveKnowledgeWordCloudSet: vi.fn(async () => ({
        ok: true,
        wordBagSet: savedWordBagSet
      }))
    });
    const appendConsoleOperationLog = vi.fn();
    const { context } = createContext({
      metadataStore,
      appendConsoleOperationLog
    });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.save",
      input: {
        wordBagSet: { title: "ignored" },
        auditAction: " add ",
        auditPaths: [
          { path: " /log/a ", type: "file" },
          { path: "/log/a", type: "file" },
          { path: "/log/b", type: "file" }
        ]
      },
      context
    });

    expect(result.status).toBe(200);
    expect(result.payload.wordBagSet.wordBagSetId).toBe("set-save-1");
    expect(appendConsoleOperationLog).toHaveBeenCalledTimes(1);
    expect(appendConsoleOperationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "knowledge.word_clouds.corpus_paths.add",
        input: expect.objectContaining({
          action: "add",
          changedPathCount: 2,
          corpusPathCount: 2,
          corpusPathTypes: expect.arrayContaining(["directory", "file"]),
          changedPaths: [
            { type: "file", path: "/log/a", basename: "a" },
            { type: "file", path: "/log/b", basename: "b" }
          ]
        }),
        output: expect.objectContaining({
          ok: true,
          wordBagSetId: "set-save-1",
          corpusPathCount: 2
        })
      })
    );
  });

  it("导入、导出、增删词包的错误分支都会被统一映射为错误响应", async () => {
    const failError = Object.assign(new Error("permission denied"), {
      statusCode: 403,
      code: "access_denied"
    });
    const metadataStore = createMetadataStore({
      exportKnowledgeWordCloudSet: vi.fn(() => {
        throw failError;
      }),
      importKnowledgeWordCloudSet: vi.fn(() => {
        throw failError;
      }),
      addKnowledgeWordBag: vi.fn(() => {
        throw failError;
      }),
      updateKnowledgeWordBag: vi.fn(() => {
        throw failError;
      }),
      deleteKnowledgeWordBag: vi.fn(() => {
        throw failError;
      })
    });
    const { context } = createContext({ metadataStore });

    const exportResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.export",
      input: { wordBagSetId: "set-err" },
      context
    });
    const importResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.import",
      input: { value: "x" },
      context
    });
    const addResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.add",
      input: { wordBagSetId: "set-err", wordBag: {} },
      context
    });
    const updateResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.update",
      input: { wordBagSetId: "set-err", wordBagId: "bag-1", patch: {} },
      context
    });
    const deleteResult = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_bags.delete",
      input: { wordBagSetId: "set-err", wordBagId: "bag-1" },
      context
    });

    for (const item of [exportResult, importResult, addResult, updateResult, deleteResult]) {
      expect(item).toEqual({
        status: 403,
        payload: {
          ok: false,
          code: "access_denied",
          error: "permission denied"
        }
      });
    }
  });

  it("词云提案缺少模型或意图会返回 400", async () => {
    const { context } = createContext();

    const noModel = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: { prompt: "按话题分类" },
      context
    });
    expect(noModel).toEqual({
      status: 400,
      payload: {
        ok: false,
        error: "请选择用于生成词云的智能体。"
      }
    });

    const noPrompt = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: { modelAlias: "agent" },
      context
    });
    expect(noPrompt).toEqual({
      status: 400,
      payload: {
        ok: false,
        error: "请输入词云分组意图。"
      }
    });
  });

  it("词云提案会在未命中词频且有范围时尝试重建，仍为空则返回 409", async () => {
    const metadataStore = createMetadataStore({
      listSourceCorpusRawTerms: vi.fn(() => []),
      rebuildSourceVocabulary: vi.fn(() => ({ sourceCorpusRawTermCount: 7 })),
      getKnowledgeWordCloudState: vi.fn(async () => ({ ok: true })),
      listSourceVocabularyTermStats: vi.fn(() => [])
    });
    const { context } = createContext({ metadataStore });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: {
        modelAlias: "agent-v1",
        prompt: "新闻词云",
        corpusPath: "directory:/workspace/docs"
      },
      context
    });

    expect(result).toEqual({
      status: 409,
      payload: {
        ok: false,
        error: "语料词频表已刷新，但这些语料范围还无话解析到可用文档。"
      }
    });
    expect(metadataStore.rebuildSourceVocabulary).toHaveBeenCalledTimes(1);
    expect(context.queueMonitor.registerStarted).not.toHaveBeenCalled();
  });

  it("词云提案成功后会进入异步分类任务并落库为已完成", async () => {
    const metadataStore = createMetadataStore({
      listSourceCorpusRawTerms: vi.fn(() => [
        { term: "Alpha", frequency: 5 },
        { term: "Beta", frequency: 3 }
      ]),
      listSourceVocabularyTermStats: vi.fn(() => [
        { term: "alpha", frequency: 12, documentFrequency: 2, bm25Weight: 0.7 },
        { term: "beta", frequency: 8, documentFrequency: 1, bm25Weight: 0.2 }
      ])
    });
    const protocolEventBus = createProtocolEventBus();
    const queueMonitor = createQueueMonitor();
    const preprocessWordCloudVocabulary = vi.fn(() => ({
      ok: true,
      intentTerms: ["alpha", "beta"],
      targetTerms: [
        { term: "alpha", frequency: 5, weight: 0.91, intentScore: 0.5 },
        { term: "beta", frequency: 3, weight: 0.67, intentScore: 0.2 }
      ],
      lowQualityTerms: [],
      allTerms: [
        { term: "alpha", frequency: 5, weight: 0.91, intentScore: 0.5 },
        { term: "beta", frequency: 3, weight: 0.67, intentScore: 0.2 }
      ],
      agentTerms: [
        { term: "alpha", frequency: 5, weight: 0.91, intentScore: 0.5 }
      ],
      summary: {
        sourceCount: 2,
        limitApplied: 300,
        allCount: 2,
        modelCount: 1,
        targetCount: 2,
        lowQualityCount: 0,
        intentSignal: 2,
        intentPromoted: 0,
        totalConsidered: 2
      }
    }));
    const agentRuntimeProvider = {
      callGatewayWithRuntimeSettings: vi.fn(async () => ({
        answer: JSON.stringify({
          title: "AI 结果",
          wordBags: [
            {
              wordBagId: "topic-1",
              label: "核心主题",
              relation: "overlap",
              terms: [{ term: "alpha", frequency: 5, weight: 1 }]
            }
          ],
          defaultTerms: [{ term: "beta", frequency: 3, weight: 0.66 }]
        }),
        upstream: { adapter: "mock-llm" }
      }))
    };

    const { context } = createContext({
      metadataStore,
      protocolEventBus,
      queueMonitor,
      agentRuntimeProvider,
      preprocessWordCloudVocabulary
    });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: {
        modelAlias: "agent-v1",
        prompt: "按主题分类",
        corpusPath: [
          "file:/tmp/sample.txt",
          { path: "/tmp/sample.txt", type: "file" },
          { path: "", type: "directory" }
        ],
        minFrequency: 2,
        limit: 300,
        modelTermLimit: 1200
      },
      context
    });

    expect(result.status).toBe(202);
    expect(result.payload.ok).toBe(true);
    expect(result.payload.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "alpha", frequency: 5 }),
        expect.objectContaining({ term: "beta", frequency: 3 })
      ])
    );
    expect(metadataStore.listSourceCorpusRawTerms).toHaveBeenCalledWith(expect.objectContaining({
      corpusPaths: [
        { type: "file", path: "/tmp/sample.txt" }
      ],
      minFrequency: 2,
      limit: 100000,
      rules: { defaultRule: "rule-v1" }
    }));
    expect(preprocessWordCloudVocabulary).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "按主题分类",
      limit: 300,
      modelTermLimit: 1200,
      minFrequency: 2
    }));

    await waitForMockCalls(metadataStore.saveKnowledgeWordCloudSet, 2);
    await flushAsyncWindows();
    const completedSave = metadataStore.saveKnowledgeWordCloudSet.mock.calls[1]?.[0];
    expect(completedSave).toMatchObject({
      limit: 1,
      wordBagSet: expect.objectContaining({
        status: "completed",
        title: "AI 结果",
        agentResponse: expect.objectContaining({
          parsedModel: expect.objectContaining({
            fallbackMode: false
          }),
          parsed: expect.any(Object)
        })
      })
    });
    const eventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
    expect(eventTypes).toContain("knowledge.word_clouds.queued");
    expect(eventTypes).toContain("knowledge.word_clouds.proposed");
    expect(queueMonitor.registerStarted).toHaveBeenCalledTimes(1);
    expect(queueMonitor.registerHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "model_call" })
    );
    expect(queueMonitor.registerClosed).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "closed", status: "completed" })
    );
  });

  it("词云提案在智能体返回不可解析内容时降级持久化并标记 degraded", async () => {
    const metadataStore = createMetadataStore({
      listSourceCorpusRawTerms: vi.fn(() => [
        { term: "Alpha", frequency: 5 }
      ]),
      listSourceVocabularyTermStats: vi.fn(() => [])
    });
    const protocolEventBus = createProtocolEventBus();
    const queueMonitor = createQueueMonitor();
    const preprocessWordCloudVocabulary = vi.fn(() => ({
      ok: true,
      intentTerms: ["alpha"],
      targetTerms: [{ term: "alpha", frequency: 5, weight: 1, intentScore: 0.6 }],
      lowQualityTerms: [],
      allTerms: [{ term: "alpha", frequency: 5, weight: 1, intentScore: 0.6 }],
      agentTerms: [{ term: "alpha", frequency: 5 }],
      summary: {
        sourceCount: 1,
        limitApplied: 300,
        allCount: 1,
        modelCount: 1,
        targetCount: 1,
        lowQualityCount: 0,
        intentSignal: 1,
        intentPromoted: 1,
        totalConsidered: 1
      }
    }));
    const agentRuntimeProvider = {
      callGatewayWithRuntimeSettings: vi.fn(async () => ({ answer: "not-json" }))
    };
    const { context } = createContext({
      metadataStore,
      protocolEventBus,
      queueMonitor,
      agentRuntimeProvider,
      preprocessWordCloudVocabulary
    });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: {
        modelAlias: "agent-v1",
        prompt: "按主题降级",
        corpusPaths: [
          { path: "/tmp/sample.txt", type: "file" }
        ]
      },
      context
    });

    expect(result.status).toBe(202);
    await waitForMockCalls(metadataStore.saveKnowledgeWordCloudSet, 2);
    await flushAsyncWindows();
    const fallbackSave = metadataStore.saveKnowledgeWordCloudSet.mock.calls[1]?.[0];
    expect(fallbackSave).toMatchObject({
      wordBagSet: expect.objectContaining({
        status: "completed",
        agentResponse: expect.objectContaining({
          fallback: true,
          fallbackReason: "智能体没有返回可解析的词云 JSON。",
          parsedModel: expect.objectContaining({
            fallbackMode: true
          })
        })
      })
    });
    const eventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
    expect(eventTypes).toContain("knowledge.word_clouds.proposed");
  });

  it("词云提案会解析 fenced JSON、去重嵌套词袋，并合并默认与其它词项", async () => {
    const terms = [
      { term: "Alpha", frequency: 5, weight: 0.9, quality: "normal" },
      { term: "Beta", frequency: 3, weight: 0.4, quality: "normal" },
      { term: "Gamma", frequency: 2, weight: 0.1, quality: "low" },
      { term: "Delta", frequency: 1, weight: 0.2, quality: "normal" }
    ];
    const metadataStore = createMetadataStore({
      listSourceCorpusRawTerms: vi.fn(() => terms),
      listSourceVocabularyTermStats: vi.fn(() => [
        { term: "alpha", frequency: 5 },
        { term: "beta", frequency: 3 },
        { term: "gamma", frequency: 2 },
        { term: "delta", frequency: 1 }
      ])
    });
    const preprocessWordCloudVocabulary = vi.fn(() => ({
      ok: true,
      intentTerms: ["alpha", "beta"],
      targetTerms: terms,
      lowQualityTerms: [{ term: "Gamma", count: 2, weight: "bad-number" }],
      allTerms: terms,
      agentTerms: terms,
      summary: {
        sourceCount: 4,
        limitApplied: 300,
        allCount: 4,
        modelCount: 4,
        targetCount: 4,
        lowQualityCount: 1,
        intentSignal: 2,
        intentPromoted: 0,
        totalConsidered: 4
      }
    }));
    const agentRuntimeProvider = {
      callGatewayWithRuntimeSettings: vi.fn(async () => ({
        text: [
          "模型输出如下：",
          "```json",
          JSON.stringify({
            title: "  Fenced Result  ",
            wordBags: [
              {
                id: "dup",
                label: "默认",
                relation: "",
                terms: [
                  { term: "Alpha", count: 5, weight: 0.8 },
                  { term: "Alpha", frequency: 99 },
                  { term: "" }
                ],
                groups: [
                  {
                    id: "dup",
                    label: "Nested",
                    terms: [{ term: "Beta", weight: 0.5 }]
                  }
                ]
              },
              {
                id: "dup",
                label: "其它",
                terms: [{ term: "Gamma", count: 2, weight: "NaN" }]
              }
            ],
            defaultTerms: [{ term: "Delta", count: 1 }],
            otherTerms: [{ term: "Gamma", count: 2 }]
          }),
          "```"
        ].join("\n"),
        upstream: { adapter: "mock-fenced-json" }
      }))
    };
    const { context } = createContext({
      metadataStore,
      agentRuntimeProvider,
      preprocessWordCloudVocabulary
    });

    const result = await executeKnowledgeWordCloudOperation({
      operationId: "knowledge.word_clouds.propose",
      input: {
        modelAlias: "agent-v1",
        message: "词云 创建 财务主题",
        corpusPath: [
          ["directory:/tmp/corpus", ""],
          { type: "file", path: "/tmp/corpus/a.txt" },
          { type: "unknown", path: "/tmp/corpus/b.txt" },
          { type: "file", path: "/tmp/corpus/a.txt" }
        ],
        minFrequency: "not-a-number",
        limit: 10,
        modelTermLimit: 10
      },
      context
    });

    expect(result.status).toBe(202);
    expect(metadataStore.listSourceCorpusRawTerms).toHaveBeenCalledWith(expect.objectContaining({
      corpusPaths: [
        { type: "directory", path: "/tmp/corpus" },
        { type: "file", path: "/tmp/corpus/a.txt" },
        { type: "", path: "/tmp/corpus/b.txt" }
      ],
      minFrequency: 1
    }));

    await waitForMockCalls(metadataStore.saveKnowledgeWordCloudSet, 2);
    await flushAsyncWindows();
    const completedSave = metadataStore.saveKnowledgeWordCloudSet.mock.calls[1]?.[0]?.wordBagSet;
    expect(completedSave).toMatchObject({
      status: "completed",
      title: "Fenced Result",
      agentResponse: expect.objectContaining({
        upstream: { adapter: "mock-fenced-json" },
        parsedModel: expect.objectContaining({
          fallbackMode: false
        })
      })
    });
    expect(completedSave.wordBags.map((bag) => bag.wordBagId)).toEqual([
      "dup",
      "dup-2"
    ]);
    expect(completedSave.wordBags.find((bag) => bag.label === "默认").terms.map((term) => term.term))
      .toEqual(expect.arrayContaining(["alpha", "delta"]));
    expect(completedSave.wordBags.find((bag) => bag.label === "其它").terms.map((term) => term.term))
      .toContain("gamma");
    expect(completedSave.wordBags[0].children[0]).toMatchObject({
      wordBagId: "dup",
      label: "Nested",
      terms: [expect.objectContaining({ term: "beta" })]
    });
  });

  it("恢复词云任务会跳过无效队列项并对有效项失败分支落库", async () => {
    const metadataStore = createMetadataStore({
      getKnowledgeWordCloudState: vi.fn(async () => ({
        wordBagSets: [
          {
            status: "draft",
            agentResponse: {
              run: { runId: "missing-model", prompt: "valid", modelAlias: "" }
            }
          },
          {
            status: "queued",
            wordBagSetId: "set-1",
            modelAlias: "agent-v1",
            agentResponse: {
              run: {
                runId: "resume-run-1",
                queueId: "queue-resume-1",
                prompt: "resume intent"
              }
            },
            termsSnapshot: []
          }
        ]
      })),
      listSourceCorpusRawTerms: vi.fn(() => []),
      listSourceVocabularyTermStats: vi.fn(() => [])
    });
    const protocolEventBus = createProtocolEventBus();
    const queueMonitor = createQueueMonitor();

    await resumeKnowledgeWordCloudClassificationTasks({
      userDataPath: "/tmp/knowledge-word-cloud-test",
      metadataStore,
      protocolEventBus,
      contextRuntime: {},
      clientRuntimeAllocator: {},
      queueMonitor,
      agentRuntimeProvider: null
    });

    await flushAsyncWindows();
    await waitForMockCalls(metadataStore.saveKnowledgeWordCloudSet, 1);
    expect(queueMonitor.registerHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "resume" })
    );
    expect(metadataStore.saveKnowledgeWordCloudSet).toHaveBeenCalledWith(
      expect.objectContaining({
        wordBagSet: expect.objectContaining({
          status: "failed"
        })
      })
    );
    const eventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
    expect(eventTypes).toContain("knowledge.word_clouds.failed");
  });
});
