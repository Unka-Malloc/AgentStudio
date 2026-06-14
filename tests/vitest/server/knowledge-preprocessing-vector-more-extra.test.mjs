import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const readInputSourcesMock = vi.hoisted(() => vi.fn());
const pipelineRunMock = vi.hoisted(() => vi.fn());
const createKnowledgePipelineMock = vi.hoisted(() =>
  vi.fn(() => ({
    run: pipelineRunMock
  }))
);
const bindDynamicDocumentParsingInvocationMock = vi.hoisted(() => vi.fn());

const execFileMock = vi.hoisted(() =>
  vi.fn((command, args, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    queueMicrotask(() => cb(null, { stdout: "", stderr: "" }));
  })
);
const spawnSyncMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: 0
  }))
);
const getIndexedSourceFileByEvidenceIdMock = vi.hoisted(() => vi.fn());
const indexedCandidateFilesForRootMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  readInputSources: (...args) => readInputSourcesMock(...args)
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/chunking/pipeline.mjs", () => ({
  createKnowledgePipeline: (...args) => createKnowledgePipelineMock(...args)
}));

vi.mock(
  "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs",
  async () => {
    const actual = await vi.importActual(
      "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs"
    );
    return {
      ...actual,
      bindDynamicDocumentParsingInvocation: (...args) =>
        bindDynamicDocumentParsingInvocationMock(...args)
    };
  }
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawnSync: spawnSyncMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs", async () => {
  const actual = await vi.importActual(
    "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
  );
  return {
    ...actual,
    getIndexedSourceFileByEvidenceId: getIndexedSourceFileByEvidenceIdMock,
    indexedCandidateFilesForRoot: indexedCandidateFilesForRootMock
  };
});

let createFileRoutingDecision;
let readInputSources;
let createDocumentParsingRuntime;
let DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID;
let normalizeTaxonomyText;
let normalizeKnowledgeTaxonomy;
let taxonomyIncludesTerm;
let matchedTaxonomyTerms;
let taxonomyPaths;
let taxonomyToExpertVocabularyEntries;
let localClassificationRulesFromTaxonomy;
let queryIntentProfilesFromTaxonomy;
let resolveQueryIntentProfile;
let queryTermsForIntentSearch;
let evaluateQueryIntentText;
let classifyTextByKnowledgeTaxonomy;
let getKnowledgeTaxonomyPath;
let saveKnowledgeTaxonomy;
let listKnowledgeTaxonomyVersions;
let createKnowledgeTaxonomyRuntime;
let createLocalVectorStore;
let isSourceEvidenceId;
let getSourceFileEvidence;

const tempRoots = [];

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return callback(root);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function taxonomyFixture() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    version: 1,
    source: "fixture",
    updatedAt: "2026-06-05T00:00:00.000Z",
    publishedAt: "2026-06-05T00:00:00.000Z",
    fallbackPath: "general/fallback",
    defaultIntent: "general",
    keywordStopwords: ["the"],
    fallbackIntents: [{ intent: "general", terms: ["misc"] }],
    categories: [
      {
        categoryId: "finance-billing",
        path: "finance/billing",
        label: "Billing",
        keywords: ["invoice", "billing"],
        queryTriggers: ["invoice"],
        triggerAliases: {
          invoice: ["bill"]
        },
        weakTerms: ["renewal"],
        contextSignals: ["money"],
        intentLabel: "billing-review"
      },
      {
        categoryId: "legal-contracts",
        path: "legal/contracts",
        label: "Contracts",
        keywords: ["contract"],
        negativeTerms: ["unsubscribe"],
        intentLabel: "contract-review"
      }
    ]
  };
}

function createFakeVectorDb() {
  const rows = [];
  const vecRows = new Map();

  function upsertRow(record) {
    const key = [record.targetType, record.targetId, record.modality, record.provider].join("\u001f");
    const index = rows.findIndex(
      (row) => [row.target_type, row.target_id, row.modality, row.provider].join("\u001f") === key
    );
    const next = {
      embedding_id: record.embeddingId,
      target_type: record.targetType,
      target_id: record.targetId,
      modality: record.modality,
      provider: record.provider,
      dimension: record.dimension,
      vector_json: JSON.stringify(record.vector),
      content_hash: record.contentHash,
      metadata_json: JSON.stringify(record.metadata || {}),
      updated_at: record.updatedAt
    };
    if (index >= 0) {
      rows[index] = next;
    } else {
      rows.push(next);
    }
  }

  function filterRows(params = []) {
    let targetType = null;
    let provider = null;
    let targetId = null;
    let modality = null;
    if (params.length >= 1) {
      targetType = params[0] || null;
    }
    if (params.length >= 2) {
      provider = params[1] || null;
    }
    if (params.length >= 3) {
      targetId = params[2] || null;
    }
    if (params.length >= 4) {
      modality = params[3] || null;
    }
    return rows.filter((row) => {
      if (targetType && row.target_type !== targetType) return false;
      if (provider && row.provider !== provider) return false;
      if (targetId && row.target_id !== targetId) return false;
      if (modality && row.modality !== modality) return false;
      return true;
    });
  }

  return {
    name: "/tmp/pact-vector-test.db",
    exec: vi.fn(),
    transaction(fn) {
      return (...args) => fn(...args);
    },
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.includes("SELECT vec_version() AS version")) {
        return {
          get: () => ({ version: "1.0.0" })
        };
      }
      if (normalized.startsWith("INSERT INTO kc_embeddings")) {
        return {
          run: (...params) => {
            upsertRow({
              embeddingId: params[0],
              targetType: params[1],
              targetId: params[2],
              modality: params[3],
              provider: params[4],
              dimension: params[5],
              vector: JSON.parse(params[6]),
              contentHash: params[7],
              metadata: JSON.parse(params[8]),
              updatedAt: params[9]
            });
            return { changes: 1 };
          }
        };
      }
      if (normalized.startsWith("INSERT INTO kc_embedding_vec_ids")) {
        return {
          run: (embeddingId) => {
            const rowid = vecRows.size + 1;
            vecRows.set(embeddingId, { vec_rowid: rowid, embedding_id: embeddingId });
            return { changes: 1 };
          }
        };
      }
      if (normalized.startsWith("SELECT vec_rowid FROM kc_embedding_vec_ids")) {
        return {
          get: (embeddingId) => vecRows.get(embeddingId) || null
        };
      }
      if (normalized.startsWith("INSERT OR REPLACE INTO")) {
        return {
          run: () => ({ changes: 1 })
        };
      }
      if (normalized.startsWith("SELECT * FROM kc_embeddings")) {
        return {
          all: (...params) => {
            const limit = Number(params.at(-1) || rows.length);
            return filterRows(params.slice(0, -1)).slice(0, limit);
          }
        };
      }
      if (normalized.startsWith("DELETE FROM kc_embeddings WHERE")) {
        return {
          run: (...params) => {
            const ids = new Set(params.filter((value) => typeof value === "string"));
            const before = rows.length;
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              if (ids.has(rows[index].target_id)) {
                rows.splice(index, 1);
              }
            }
            return { changes: before - rows.length };
          }
        };
      }
      if (normalized.includes("SELECT COUNT(*) AS total_count")) {
        return {
          get: () => ({
            total_count: rows.length,
            target_count: new Set(rows.map((row) => row.target_id)).size,
            provider_count: new Set(rows.map((row) => row.provider)).size
          })
        };
      }
      if (normalized.includes("SELECT provider, modality, COUNT(*) AS count")) {
        return {
          all: () => {
            const grouped = new Map();
            for (const row of rows) {
              const key = `${row.provider}\u001f${row.modality}`;
              grouped.set(key, (grouped.get(key) || 0) + 1);
            }
            return [...grouped.entries()].map(([key, count]) => {
              const [provider, modality] = key.split("\u001f");
              return { provider, modality, count };
            });
          }
        };
      }
      if (normalized.startsWith("WITH matches AS")) {
        return {
          all: () => []
        };
      }
      return {
        run: () => ({ changes: 0 }),
        get: () => null,
        all: () => []
      };
    }
  };
}

function createEmbeddingRuntime() {
  return {
    providerId: "embedder-1",
    defaultDimension: 3,
    embedText(text) {
      const score = String(text || "").includes("match") ? 1 : 0;
      return {
        provider: "embedder-1",
        modality: "text",
        dimension: 3,
        vector: [1, score, 0]
      };
    },
    embedImageEvidence(target) {
      return {
        provider: "embedder-1",
        modality: "image",
        dimension: 3,
        vector: [0, 1, Number(target?.weight || 1)]
      };
    },
    embedJointEvidence(target) {
      return {
        provider: "embedder-1",
        modality: "joint",
        dimension: 3,
        vector: [1, 1, Number(target?.weight || 1)]
      };
    },
    capabilities() {
      return {
        protocolVersion: "embed.v1",
        providerId: "embedder-1",
        providerType: "local",
        offlineFallback: true,
        dimensions: 3
      };
    }
  };
}

beforeAll(async () => {
  ({
    createFileRoutingDecision,
    readInputSources
  } = await vi.importActual("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs"));

  ({
    createDocumentParsingRuntime,
    DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID
  } = await import("../../../server/platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs"));

  ({
    normalizeTaxonomyText,
    normalizeKnowledgeTaxonomy,
    taxonomyIncludesTerm,
    matchedTaxonomyTerms,
    taxonomyPaths,
    taxonomyToExpertVocabularyEntries,
    localClassificationRulesFromTaxonomy,
    queryIntentProfilesFromTaxonomy,
    resolveQueryIntentProfile,
    queryTermsForIntentSearch,
    evaluateQueryIntentText,
    classifyTextByKnowledgeTaxonomy
  } = await import("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/default-taxonomy.mjs"));

  ({
    getKnowledgeTaxonomyPath,
    saveKnowledgeTaxonomy,
    listKnowledgeTaxonomyVersions,
    createKnowledgeTaxonomyRuntime
  } = await import("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs"));

  ({ createLocalVectorStore } = await import("../../../server/platform/specialized/knowledge/retrieval/vector-store/LocalVectorStore/index.mjs"));

  ({
    isSourceEvidenceId,
    getSourceFileEvidence
  } = await import("../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs"));
});

beforeEach(() => {
  readInputSourcesMock.mockReset().mockResolvedValue({
    sources: [],
    warnings: [],
    failureReasons: []
  });
  pipelineRunMock.mockReset().mockResolvedValue({
    generatedAt: "2026-06-05T00:00:00.000Z",
    sources: [],
    blocks: [
      {
        id: "block-1",
        sourceId: "source-1",
        sourceName: "demo.md",
        kind: "paragraph",
        text: "正文内容"
      }
    ],
    chunks: [
      {
        id: "chunk-1",
        sourceId: "source-1",
        sourceName: "demo.md",
        chunkType: "semantic",
        title: "正文",
        content: "正文内容",
        sourceStartLine: 1,
        sourceEndLine: 1,
        sourceRange: {
          startLine: 1,
          endLine: 1
        },
        tokenCount: 2,
        charCount: 4
      }
    ],
    warnings: ["pipeline-warning"]
  });
  createKnowledgePipelineMock.mockReset().mockReturnValue({
    run: pipelineRunMock
  });
  bindDynamicDocumentParsingInvocationMock.mockReset().mockReturnValue({
    structureArtifacts: [{ id: "artifact-1" }],
    granularityFragments: [{ id: "fragment-1" }],
    chunks: [
      {
        id: "chunk-1",
        sourceId: "source-1",
        sourceName: "demo.md",
        chunkType: "dynamic",
        title: "动态",
        content: "动态正文",
        sourceStartLine: 1,
        sourceEndLine: 1,
        sourceRange: {
          startLine: 1,
          endLine: 1
        },
        tokenCount: 2,
        charCount: 4
      }
    ],
    policy: { mode: "dynamic" },
    payload: { status: "ok" },
    backendTrace: ["dynamic-trace"]
  });
  execFileMock.mockReset();
  spawnSyncMock.mockReset().mockReturnValue({ status: 0 });
  getIndexedSourceFileByEvidenceIdMock.mockReset();
  indexedCandidateFilesForRootMock.mockReset();
  getIndexedSourceFileByEvidenceIdMock.mockResolvedValue(null);
  indexedCandidateFilesForRootMock.mockResolvedValue({
    available: false,
    reason: "index_unavailable"
  });
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("file processor routing and ingestion extras", () => {
  it("routes readable text through text sniffing and loads file manifests from the hydrated cache", async () => {
    const routeDecision = createFileRoutingDecision({
      buffer: Buffer.from("第一行\n第二行"),
      fileName: "note",
      allowTextFallback: true
    });

    expect(routeDecision.isReadableText).toBe(true);
    expect(["text-sniff", "text-fallback"]).toContain(routeDecision.selectedSource);
    expect(routeDecision.kind).toBe("text");

    await withTempRoot("pact-knowledge-manifest-", async (userDataPath) => {
      const hydratedRoot = path.join(userDataPath, "knowledge-sources", "hydrated");
      const docPath = path.join(hydratedRoot, "docs", "example.txt");
      const manifestPath = path.join(hydratedRoot, "manifest.json");
      await writeText(docPath, "manifest source text");
      await writeJson(manifestPath, {
        files: [
          {
            absolutePath: docPath,
            relativePath: "docs/example.txt"
          }
        ]
      });

      const result = await readInputSources({
        userDataPath,
        fileManifestPath: manifestPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z"
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        kind: "text",
        path: expect.stringMatching(/docs\/example\.txt$/)
      });
      expect(result.warnings).toEqual([]);
      expect(result.failureReasons).toEqual([]);
    });
  });
});

describe("document parsing runtime extras", () => {
  it("applies dynamic parsing artifacts when the dynamic pipeline is selected", async () => {
    const runtime = createDocumentParsingRuntime();
    const result = await runtime.parseDocuments({
      sources: [
        {
          text: "  # 标题  \n\n正文  ",
          warnings: [" source-warning "]
        }
      ],
      expectedOutput: ["preprocess"],
      documentParsing: {
        dynamicParsing: {
          enabled: true
        }
      }
    });

    expect(readInputSourcesMock).not.toHaveBeenCalled();
    expect(createKnowledgePipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineRunMock).toHaveBeenCalledTimes(1);
    expect(bindDynamicDocumentParsingInvocationMock).toHaveBeenCalledTimes(1);
    expect(result.expectedOutputs).toEqual(expect.arrayContaining(["sources", "blocks", "chunks", "preprocessResult"]));
    expect(result.dynamicParsing).toEqual({ mode: "dynamic" });
    expect(result.payload).toEqual({ status: "ok" });
    expect(result.backendTrace).toEqual(["dynamic-trace"]);
    expect(result.structureArtifacts).toHaveLength(1);
    expect(result.granularityFragments).toHaveLength(1);
    expect(result.preprocessResult.blocks).toHaveLength(1);
    expect(result.preprocessResult.chunks).toHaveLength(1);
    expect(result.warnings).toEqual(["source-warning"]);
  });
});

describe("knowledge taxonomy extras", () => {
  it("normalizes taxonomy text, profiles, and classification behavior", () => {
    const taxonomy = normalizeKnowledgeTaxonomy(taxonomyFixture());

    expect(normalizeTaxonomyText("  Foo\u00a0Bar  ")).toBe("Foo Bar");
    expect(taxonomyIncludesTerm("Invoice renewal note", "invoice")).toBe(true);
    expect(matchedTaxonomyTerms("invoice renewal note", ["invoice", "contract"])).toEqual(["invoice"]);
    expect(taxonomyPaths(taxonomy)).toEqual(["finance/billing", "legal/contracts", "general/fallback"]);
    expect(taxonomyToExpertVocabularyEntries(taxonomy)).toHaveLength(2);
    expect(localClassificationRulesFromTaxonomy(taxonomy)).toHaveLength(2);

    const profiles = queryIntentProfilesFromTaxonomy(taxonomy);
    expect(profiles).toHaveLength(1);
    const resolvedProfile = resolveQueryIntentProfile("invoice", profiles);
    expect(resolvedProfile).toMatchObject({
      intentId: "finance-billing",
      queryAnchorTerms: ["bill"]
    });

    const profile = profiles[0];
    expect(queryTermsForIntentSearch(["seed"], resolvedProfile, 5)).toEqual(["seed", "bill"]);
    expect(evaluateQueryIntentText("bill and invoice 120 usd", profile)).toMatchObject({
      aligned: true,
      contextHits: ["money"]
    });
    expect(classifyTextByKnowledgeTaxonomy("invoice renewal", { taxonomy })).toMatchObject({
      path: "finance/billing",
      intentLabel: "billing-review"
    });
  });
});

describe("knowledge taxonomy runtime and persistence extras", () => {
  it("archives prior versions and reuses the cached runtime guidance", async () => {
    await withTempRoot("pact-taxonomy-runtime-", async (userDataPath) => {
      const rulesDir = path.join(userDataPath, "rules");
      const taxonomyPath = path.join(rulesDir, "knowledge-taxonomy.json");
      await writeJson(taxonomyPath, taxonomyFixture());

      const saved = await saveKnowledgeTaxonomy(userDataPath, {
        source: "custom",
        categories: [
          {
            categoryId: "finance-payables",
            path: "finance/payables",
            label: "Payables",
            keywords: ["invoice"],
            queryTriggers: ["invoice"]
          }
        ]
      });

      expect(saved.version).toBe(2);
      expect(saved.categories).toHaveLength(1);
      expect(getKnowledgeTaxonomyPath(userDataPath)).toBe(taxonomyPath);

      const versions = await listKnowledgeTaxonomyVersions(userDataPath);
      expect(versions.current.version).toBe(2);
      expect(versions.history).toHaveLength(1);

      const runtime = createKnowledgeTaxonomyRuntime(userDataPath);
      const first = runtime.loadSync();
      const second = runtime.loadSync();
      expect(first).toBe(second);
      expect(first.guidance.compiled.categoryCount).toBeGreaterThan(0);
    });
  });
});

describe("local vector store extras", () => {
  it("covers vector store fallback boundaries, embedding modes, and health failures", async () => {
    expect(() => createLocalVectorStore({
      db: null,
      embeddingRuntime: createEmbeddingRuntime()
    })).toThrow("better-sqlite3 db instance");
    expect(() => createLocalVectorStore({
      db: createFakeVectorDb(),
      embeddingRuntime: {}
    })).toThrow("embeddingRuntime");

    const db = createFakeVectorDb();
    const embeddingRuntime = createEmbeddingRuntime();
    const store = createLocalVectorStore({
      db,
      embeddingRuntime,
      dimension: "invalid",
      providerId: "vector-boundary",
      scanLimit: "invalid",
      preferSqliteVec: true
    });

    expect(store.providerType).toBe("offline-fallback");
    expect(store.backend).toBe("sqlite-json-fallback");
    expect(store.capabilities()).toMatchObject({
      providerId: "vector-boundary",
      providerType: "offline-fallback",
      sqliteVec: {
        available: false,
        status: "fallback"
      },
      embeddingRuntime: {
        providerId: "embedder-1",
        dimensions: 3
      }
    });

    const reindexed = await store.reindexTargets({
      targetIds: ["asset-1", "block-1", "joint-1", "missing-1"],
      targets: [
        {
          assetId: "asset-1",
          title: "asset title",
          assetType: "image",
          weight: 2,
          metadata: { kind: "asset" }
        },
        {
          blockId: "block-1",
          content: "block text",
          blockType: "paragraph",
          metadata: { kind: "block" }
        },
        {
          id: "joint-1",
          targetType: "asset",
          modality: "joint",
          evidence: { weight: 3 },
          metadata: { kind: "joint" }
        },
        {
          id: "",
          title: "skipped"
        },
        {
          id: "bad-embedding",
          targetType: "block",
          provider: "embedder-1",
          vector: []
        }
      ]
    });

    expect(reindexed).toMatchObject({
      requested: 4,
      reindexed: 3,
      skipped: 1
    });
    expect(reindexed.errors).toEqual([
      { targetId: "bad-embedding", message: "Vector upsert requires a non-empty vector array." }
    ]);

    const filteredEvidenceSearch = store.search({
      evidence: { weight: 2 },
      provider: "embedder-1",
      targetTypes: ["asset", "block"],
      modalities: ["image", "joint", "text"],
      minScore: -1,
      limit: 0,
      scanLimit: 0
    });
    expect(filteredEvidenceSearch.queryProvider).toBe("embedder-1");

    const evidenceSearch = store.search({
      evidence: { weight: 2 },
      minScore: -1,
      limit: 0,
      scanLimit: 0
    });
    expect(evidenceSearch.queryProvider).toBe("embedder-1");
    expect(evidenceSearch.results.map((result) => result.targetId)).toEqual(
      expect.arrayContaining(["asset-1", "block-1", "joint-1"])
    );

    expect(store.deleteByTargetIds({
      targetId: "block-1",
      targetType: "block",
      modality: "text",
      providerId: "embedder-1"
    })).toMatchObject({ deleted: 1 });

    const failingHealthStore = createLocalVectorStore({
      db: {
        name: "/tmp/failing-vector.db",
        exec: vi.fn(() => {
          throw new Error("schema unavailable");
        }),
        prepare: vi.fn()
      },
      embeddingRuntime,
      preferSqliteVec: false,
      autoEnsureSchema: false
    });
    expect(failingHealthStore.health()).toMatchObject({
      ok: false,
      error: "schema unavailable"
    });
  });

  it("upserts, searches, deletes, and reindexes through the json fallback backend", async () => {
    const db = createFakeVectorDb();
    const embeddingRuntime = createEmbeddingRuntime();
    const store = createLocalVectorStore({
      db,
      embeddingRuntime,
      preferSqliteVec: false,
      autoEnsureSchema: false
    });

    expect(store.providerType).toBe("offline-fallback");
    expect(store.capabilities().backend).toBe("sqlite-json-fallback");
    expect(store.upsert([
      {
        targetType: "doc",
        targetId: "target-1",
        provider: "embedder-1",
        modality: "text",
        dimension: 3,
        vector: [1, 0, 0],
        contentHash: "hash-1",
        metadata: { sectionId: "section-1" }
      },
      {
        targetType: "doc",
        targetId: "target-2",
        provider: "embedder-1",
        modality: "text",
        dimension: 3,
        vector: [1, 1, 0],
        contentHash: "hash-2",
        metadata: { sectionId: "section-2" }
      }
    ])).toMatchObject({ upserted: 2 });

    const search = store.search({
      vector: [1, 0, 0],
      limit: 10,
      includeFallback: true
    });
    expect(search.backend).toBe("sqlite-json-fallback");
    expect(search.results).toHaveLength(2);
    expect(search.results[0]).toMatchObject({
      targetId: "target-1",
      path: "json-cosine-scan"
    });

    expect(store.deleteByTargetIds({ targetIds: ["target-1"], provider: "embedder-1" })).toMatchObject({
      deleted: 1
    });
    expect(store.deleteByTargetIds({ targetIds: [] })).toMatchObject({
      deleted: 0
    });

    const reindexed = await store.reindexTargets({
      targetIds: ["target-1", "target-2"],
      deleteMissing: true,
      resolveTarget: async (targetId) => {
        if (targetId === "target-1") {
          return {
            targetType: "doc",
            targetId: "target-1",
            provider: "embedder-1",
            vector: [0, 1, 0],
            metadata: { sourceId: "source-1" }
          };
        }
        return null;
      }
    });

    expect(reindexed).toMatchObject({
      requested: 2,
      reindexed: 1,
      deleted: 1,
      skipped: 0
    });
    expect(store.health()).toMatchObject({
      ok: true,
      counts: {
        embeddings: 1,
        targets: 1,
        providers: 1
      }
    });
  });
});

describe("source file evidence extras", () => {
  it("recognizes source evidence ids and opens indexed evidence previews", async () => {
    expect(isSourceEvidenceId("source-evidence::abc123")).toBe(true);
    expect(isSourceEvidenceId("not-an-evidence-id")).toBe(false);

    await withTempRoot("pact-source-evidence-", async (userDataPath) => {
      const filePath = path.join(userDataPath, "mail", "evidence.eml");
      await writeText(
        filePath,
        [
          "From: Ops <ops@example.test>",
          "To: Team <team@example.test>",
          "Subject: Evidence preview",
          "Date: Fri, 05 Jun 2026 10:00:00 +0000",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "This body contains the snippet we want to surface."
        ].join("\n")
      );
      getIndexedSourceFileByEvidenceIdMock.mockResolvedValueOnce({
        file: filePath
      });

      const evidence = await getSourceFileEvidence({
        userDataPath,
        evidenceId: "source-evidence::mail/evidence.eml"
      });

      expect(evidence).toMatchObject({
        evidenceId: "source-evidence::mail/evidence.eml",
        title: "Evidence preview",
      snippet: expect.stringContaining("snippet we want to surface")
      });
      expect(evidence.payload.blocks[0].text).toContain("Evidence preview");
      expect(await getSourceFileEvidence({
        userDataPath,
        evidenceId: "not-an-evidence-id"
      })).toBeNull();
    });
  });
});
