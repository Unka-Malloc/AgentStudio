import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSourceFileRegistryStoreMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());
const isSupportedImportFilePathMock = vi.hoisted(() => vi.fn());
const indexKnowledgeSourceFilesMock = vi.hoisted(() => vi.fn());
const deleteKnowledgeSourceFileIndexMock = vi.hoisted(() => vi.fn());
const checkpointTreeIdMock = vi.hoisted(() => vi.fn());
const startCheckpointTreeMock = vi.hoisted(() => vi.fn());
const upsertCheckpointNodeMock = vi.hoisted(() => vi.fn());
const finishCheckpointTreeMock = vi.hoisted(() => vi.fn());
const deleteCheckpointTreeMock = vi.hoisted(() => vi.fn());
const serverTokenMock = vi.hoisted(() => vi.fn());
const atomicWriteJsonMock = vi.hoisted(() => vi.fn());
const fsWatchMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/source-file-registry-store.mjs", () => ({
  createSourceFileRegistryStore: createSourceFileRegistryStoreMock
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...actual.default,
      watch: (...args) => fsWatchMock(...args)
    },
    watch: (...args) => fsWatchMock(...args)
  };
});

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  isSupportedImportFilePath: isSupportedImportFilePathMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs", () => ({
  deleteKnowledgeSourceFileIndex: deleteKnowledgeSourceFileIndexMock,
  indexKnowledgeSourceFiles: indexKnowledgeSourceFilesMock
}));

vi.mock("../../../server/platform/common/data-structure/checkpoint-tree-store.mjs", () => ({
  checkpointTreeId: checkpointTreeIdMock,
  deleteCheckpointTree: deleteCheckpointTreeMock,
  finishCheckpointTree: finishCheckpointTreeMock,
  startCheckpointTree: startCheckpointTreeMock,
  upsertCheckpointNode: upsertCheckpointNodeMock
}));

vi.mock("../../../server/platform/common/security/client-strings.mjs", () => ({
  serverToken: serverTokenMock
}));

vi.mock("../../../server/platform/common/platform-core/state-coordinator.mjs", () => ({
  atomicWriteJson: atomicWriteJsonMock
}));

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: 1,
    version: "mock",
    source: "mock-taxonomy",
    categories: []
  }))
};

const embeddingRuntimeMock = {
  protocolVersion: "pact.embedding.v1",
  embedText: vi.fn((value = "") => ({
    vector: Array.from(String(value)).map(() => 0.01),
    text: String(value),
    model: "mock-text-model",
    dimension: 8
  })),
  embedImageEvidence: vi.fn(() => ({
    vector: Array(8).fill(0.1),
    contentType: "image/mock",
    model: "mock-image-model",
    dimension: 8
  })),
  embedJointEvidence: vi.fn(() => ({
    vector: Array(8).fill(0.2),
    modality: "joint",
    model: "mock-joint-model",
    dimension: 8
  })),
  health: vi.fn(() => ({
    protocolVersion: "pact.embedding.v1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "pact.embedding.v1",
    providers: []
  }))
};

const vectorStoreMock = {
  providerId: "sqlite-vec",
  upsert: vi.fn(),
  deleteByTargetIds: vi.fn(),
  search: vi.fn(() => []),
  health: vi.fn(() => ({
    protocolVersion: "pact.vector.v1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "pact.vector.v1",
    providers: ["sqlite-vec"]
  })),
  close: vi.fn()
};

const learningRuntimeMock = {
  LEARNING_PROTOCOL_VERSION: "pact.learning.v1",
  protocolVersion: "pact.learning.v1",
  health: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    enabled: true,
    safeAutoApplySuggestionTypes: ["retrievalProfile", "rankingRule", "decay"]
  })),
  fuseCandidatesSync: vi.fn(() => ({
    candidates: [],
    runtime: "mock",
    degraded: false,
    explanations: []
  })),
  proposeProfile: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    candidate: {
      profileId: "balanced-candidate",
      topK: 10,
      version: 2,
      weights: { bm25: 0.4, vector: 0.4, image: 0.2 }
    }
  })),
  generateSuggestions: vi.fn(() => [])
};

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary.json",
    emailRulesPath: "/tmp/mock-email-rules.json",
    loadSync: taxonomyRuntimeMock.loadSync
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "pact.embedding.v1",
  createEmbeddingRuntime: vi.fn(() => embeddingRuntimeMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/vector-store/LocalVectorStore/index.mjs", () => ({
  SQLITE_VEC_PROVIDER_ID: "sqlite-vec",
  createLocalVectorStore: vi.fn(() => vectorStoreMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/learning-runtime/index.mjs", () => ({
  LEARNING_PROTOCOL_VERSION: "pact.learning.v1",
  createLearningRuntime: vi.fn(() => learningRuntimeMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/outline-runtime-loader.mjs", () => ({
  createNoopDocumentOutlineRuntime: vi.fn(() => ({
    protocolVersion: "pact.document-outline.v1",
    build: vi.fn(() => ({
      protocolVersion: "pact.document-outline.v1",
      documentId: "",
      nodeCount: 0,
      syntheticNodeCount: 0,
      nodes: [],
      qualityFindings: []
    })),
    rangeContainsPosition: vi.fn(() => false)
  })),
  resolveDocumentOutlineRuntime: vi.fn(async () => ({
    protocolVersion: "pact.document-outline.v1",
    build: vi.fn(() => ({
      protocolVersion: "pact.document-outline.v1",
      documentId: "",
      nodeCount: 0,
      syntheticNodeCount: 0,
      nodes: [],
      qualityFindings: []
    })),
    rangeContainsPosition: vi.fn(() => false)
  }))
}));

let createKnowledgeSourceService;
let createKnowledgeCoreMount;

function createRegistryStore() {
  const fingerprintsBySource = new Map();
  const registryFilesBySource = new Map();
  const registrySourcesById = new Map();

  return {
    listBySource: vi.fn((sourceId) => new Map(fingerprintsBySource.get(sourceId) || [])),
    applyDelta: vi.fn(({ sourceId, files = [], removedPaths = [] }) => {
      const next = new Map(fingerprintsBySource.get(sourceId) || []);
      for (const file of files) {
        next.set(file.relativePath, {
          relativePath: file.relativePath,
          byteSize: Number(file.byteSize || 0),
          mtimeMs: Number(file.mtimeMs || 0),
          fingerprint: `${Number(file.byteSize || 0)}:${Number(file.mtimeMs || 0)}`
        });
      }
      for (const relativePath of removedPaths) {
        next.delete(relativePath);
      }
      fingerprintsBySource.set(sourceId, next);
    }),
    syncRegistryFiles: vi.fn((source, scanId, files = [], removedPaths = []) => {
      const next = new Map(registryFilesBySource.get(source.sourceId) || []);
      for (const file of files) {
        next.set(file.relativePath, {
          sourceId: source.sourceId,
          relativePath: file.relativePath,
          absolutePath: path.join(source.directoryPath, file.relativePath),
          extension: path.extname(file.relativePath).toLowerCase(),
          byteSize: Number(file.byteSize || 0),
          mtimeMs: Number(file.mtimeMs || 0),
          fingerprint: `${Number(file.byteSize || 0)}:${Number(file.mtimeMs || 0)}`,
          lastScanId: scanId || "",
          updatedAt: "2026-01-01T00:00:00.000Z"
        });
      }
      for (const relativePath of removedPaths) {
        next.delete(relativePath);
      }
      registryFilesBySource.set(source.sourceId, next);
    }),
    upsertRegistrySource: vi.fn((source) => {
      registrySourcesById.set(source.sourceId, { ...source });
    }),
    recordPathAlias: vi.fn(),
    purgePersistedSourcePaths: vi.fn(),
    clearSourceFiles: vi.fn((sourceId) => {
      fingerprintsBySource.delete(sourceId);
      registryFilesBySource.delete(sourceId);
    }),
    removeRegistrySource: vi.fn((sourceId) => {
      registrySourcesById.delete(sourceId);
      fingerprintsBySource.delete(sourceId);
      registryFilesBySource.delete(sourceId);
    }),
    countRegisteredFiles: vi.fn((sourceId) => {
      const registryFiles = registryFilesBySource.get(sourceId);
      if (registryFiles) {
        return registryFiles.size;
      }
      return (fingerprintsBySource.get(sourceId) || new Map()).size;
    }),
    listRegisteredFiles: vi.fn((sourceId) => {
      const filesBySource = registryFilesBySource.get(sourceId) || new Map();
      return [...filesBySource.values()];
    }),
    close: vi.fn()
  };
}

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-storage-final-third-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-storage-final-third-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: false
    });
    await testCase({ mount, userDataPath });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

beforeEach(async () => {
  createSourceFileRegistryStoreMock.mockReset();
  loadSettingsMock.mockReset();
  isSupportedImportFilePathMock.mockReset();
  indexKnowledgeSourceFilesMock.mockReset();
  deleteKnowledgeSourceFileIndexMock.mockReset();
  checkpointTreeIdMock.mockReset();
  startCheckpointTreeMock.mockReset();
  upsertCheckpointNodeMock.mockReset();
  finishCheckpointTreeMock.mockReset();
  deleteCheckpointTreeMock.mockReset();
  serverTokenMock.mockReset();
  atomicWriteJsonMock.mockReset();
  fsWatchMock.mockReset();

  taxonomyRuntimeMock.loadSync.mockClear();
  embeddingRuntimeMock.embedText.mockClear();
  vectorStoreMock.upsert.mockClear();
  learningRuntimeMock.health.mockClear();

  loadSettingsMock.mockResolvedValue({ search: { enabled: true } });
  isSupportedImportFilePathMock.mockImplementation((filePath) => /\.txt$/.test(String(filePath || "")));
  indexKnowledgeSourceFilesMock.mockResolvedValue({
    indexedAt: "2026-01-01T00:00:00.000Z",
    snapshotHash: "indexed-snapshot",
    indexedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    checkpointTreeId: "checkpoint-source-index"
  });
  deleteKnowledgeSourceFileIndexMock.mockResolvedValue(undefined);
  checkpointTreeIdMock.mockImplementation((kind, sourceId) => `${kind}:${sourceId}`);
  startCheckpointTreeMock.mockResolvedValue(undefined);
  upsertCheckpointNodeMock.mockResolvedValue(undefined);
  finishCheckpointTreeMock.mockResolvedValue(undefined);
  deleteCheckpointTreeMock.mockResolvedValue(undefined);
  serverTokenMock.mockImplementation((...parts) => parts.filter(Boolean).join(":"));
  atomicWriteJsonMock.mockImplementation(async (filePath, value) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  });
  createSourceFileRegistryStoreMock.mockImplementation(() => createRegistryStore());
  vi.useRealTimers();

  if (!createKnowledgeSourceService) {
    ({ createKnowledgeSourceService } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs"));
  }
  if (!createKnowledgeCoreMount) {
    ({ createKnowledgeCoreMount } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs"));
  }
});

describe("knowledge source service storage final third coverage", () => {
  it("marks watcher as partial when scanWatchDirectories exceeds the hard cap", async () => {
    await withTempDir(async (root) => {
      const sourceRoot = path.join(root, "watched-source");
      await fs.mkdir(sourceRoot);
      for (let index = 0; index < 2050; index += 1) {
        await fs.mkdir(path.join(sourceRoot, `dir-${String(index).padStart(4, "0")}`));
      }

      fsWatchMock.mockImplementation(() => ({
        close: vi.fn(),
        on: vi.fn()
      }));
      try {
        const service = createKnowledgeSourceService({
          userDataPath: root,
          jobManager: {
            getJob: vi.fn(async () => null),
            createJob: vi.fn()
          },
          watchingEnabled: true
        });

        const created = await service.createSource({
          directoryPath: sourceRoot,
          label: "Watched Source",
          hydrationEnabled: false,
          runNow: false
        });

        expect(created.source).toMatchObject({
          watcherStatus: "partial",
          watcherCount: 2000
        });
        expect(fsWatchMock).toHaveBeenCalledTimes(2000);
        await service.close();
      } finally {
        fsWatchMock.mockReset();
      }
    });
  });

  it("honors hydration replace modes, writes manifest, and reuses hydrated file on forced refresh", async () => {
    await withTempDir(async (root) => {
      const sourceRoot = path.join(root, "hydration-source");
      await fs.mkdir(sourceRoot);
      const placeholderPath = path.join(sourceRoot, "placeholder.txt");
      const legacyPath = path.join(sourceRoot, "legacy.gdoc");
      await fs.writeFile(placeholderPath, "", "utf8");
      await fs.writeFile(legacyPath, "legacy placeholder", "utf8");

      await writeJson(path.join(root, "knowledge-sources", "source-hydration.json"), {
        schemaVersion: 1,
        placeholderExtensionsMode: "replace",
        placeholderTextSignaturesMode: "replace",
        placeholderExtensions: [".txt"],
        placeholderTextSignatures: [
          {
            id: "marker",
            pattern: "NEED-HYDRATE",
            flags: "i",
            extensions: [".txt"]
          }
        ]
      });

      const tracePath = path.join(sourceRoot, "placeholder.txt.hydration.trace");
      const hydrateScript =
        "const fs = require('node:fs');" +
        "const targetPath = process.argv[1];" +
        "const trace = process.argv[2];" +
        "fs.appendFileSync(trace, 'used\\n');" +
        "fs.writeFileSync(targetPath, 'hydrated-content');";

      const jobInputs = [];
      const jobManager = {
        getJob: vi.fn(async () => null),
        createJob: vi.fn(async (input) => {
          jobInputs.push(input);
          return {
            id: `job-${jobInputs.length}`,
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: "2026-01-01T00:00:00.000Z"
          };
        })
      };

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: sourceRoot,
        label: "Hydration",
        hydrationEnabled: true,
        hydrationCommand: process.execPath,
        hydrationArgs: ["-e", hydrateScript, "{{targetPath}}", "{{sourcePath}}.hydration.trace"],
        runNow: false
      });

      const first = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(first.source.lastHydrationStatus).toBe("hydrated");
      expect(jobInputs).toHaveLength(1);
      expect(first.source.lastHydrationFailedCount).toBe(0);
      expect(await fs.readFile(tracePath, "utf8")).toBe("used\n");

      const manifestPath = path.join(
        root,
        "knowledge-sources",
        "hydrated",
        created.source.sourceId,
        first.source.lastSnapshotHash,
        "file-manifest.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      expect(manifest.files).toHaveLength(1);
      expect(manifest.files[0]).toMatchObject({ relativePath: "placeholder.txt" });
      expect(manifest.hydration).toMatchObject({
        commandHydratedCount: 1,
        reusedHydratedCount: 0,
        failedCount: 0,
        skippedCount: 0
      });
      expect(manifest.hydration.commandHydratedCount).toBeGreaterThan(0);
      expect(first.source.lastSnapshotHash).toBeTruthy();

      const second = await service.refreshSource(created.source.sourceId, { reason: "manual", force: true });
      expect(second.source.lastHydrationStatus).toBe("hydrated");
      expect(jobInputs).toHaveLength(2);
      const traceAfterSecond = await fs.readFile(tracePath, "utf8");
      expect(traceAfterSecond).toBe("used\n");

      const secondManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      expect(secondManifest.hydration.reusedHydratedCount).toBeGreaterThan(0);
      await service.close();
    });
  });

  it("returns hydration_empty when placeholders exist but no hydration command is configured", async () => {
    await withTempDir(async (root) => {
      const sourceRoot = path.join(root, "empty-hydration-source");
      await fs.mkdir(sourceRoot);
      await fs.writeFile(path.join(sourceRoot, "placeholder.gdoc"), "https://docs.google.com", "utf8");

      const createJob = vi.fn();
      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob
        },
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: sourceRoot,
        label: "No Hydration Command",
        hydrationEnabled: true,
        runNow: false
      });

      const hydrationEmpty = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(hydrationEmpty.skipped).toBe(true);
      expect(hydrationEmpty.reason).toBe("hydration_empty");
      expect(hydrationEmpty.source.lastHydrationStatus).toBe("partial");
      expect(hydrationEmpty.source.error).toBe("可解析文件都需要先完成云端文件自动下载。" );
      expect(createJob).not.toHaveBeenCalled();
      await service.close();
    });
  });
});

describe("knowledge core storage final third coverage", () => {
  it("falls back to active retrieval profile when explicit profile keys are missing", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const activeProfile = mount.getRetrievalProfile();
      const queried = mount.getRetrievalProfile({
        profileId: "missing-id",
        profileKey: "missing@999"
      });
      expect(queried.profileId).toBe(activeProfile.profileId);
      expect(queried.profileKey).toBe(activeProfile.profileKey);
    });
  });

  it("rolls back a canary deployment to active profile when baseline profile key no longer exists", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const active = mount.getRetrievalProfile({});
      const canary = mount.createRetrievalProfileDeployment({
        profile: {
          profileId: "canary-rollback",
          version: 2,
          topK: 12,
          weights: {
            bm25: 0.6,
            vector: 0.25,
            image: 0.15,
            graph: 0,
            feedbackBoost: 0.1
          }
        },
        status: "canary",
        trafficPercent: 100,
        baselineProfileKey: "missing@999"
      });

      const promoted = mount.promoteRetrievalProfileDeployment({ deploymentId: canary.deploymentId, reason: "integration-test" });
      expect(promoted.activeProfile.active).toBe(true);
      expect(promoted.activeProfile.profileId).toBe("canary-rollback");

      const rolledBack = mount.rollbackRetrievalProfileDeployment({ deploymentId: canary.deploymentId, reason: "integration-test" });
      expect(rolledBack.deployment.status).toBe("rolled_back");
      expect(rolledBack.deployment.trafficPercent).toBe(0);
      expect(rolledBack.activeProfile.active).toBe(true);
      expect(rolledBack.activeProfile.profileKey).toBe(promoted.activeProfile.profileKey);
      expect(rolledBack.activeProfile.profileKey).not.toBe(active.profileKey);
      expect(rolledBack.deployment.baselineProfileKey).toBe("missing@999");
    });
  });
});
