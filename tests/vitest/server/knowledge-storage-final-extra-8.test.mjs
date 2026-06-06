import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildKnowledgeDocxExport,
  KNOWLEDGE_DOCX_EXPORT_CONTENT_TYPE,
  KNOWLEDGE_DOCX_EXPORT_PACKAGE_TYPE
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-docx-export.mjs";
import {
  buildKnowledgeHtmlExport,
  KNOWLEDGE_HTML_EXPORT_CONTENT_TYPE,
  KNOWLEDGE_HTML_EXPORT_PACKAGE_TYPE
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-html-export.mjs";
import {
  buildKnowledgeMarkdownExport,
  KNOWLEDGE_MARKDOWN_EXPORT_CONTENT_TYPE,
  KNOWLEDGE_MARKDOWN_EXPORT_PACKAGE_TYPE
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-markdown-export.mjs";
import {
  KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
  createKnowledgeBackendPort,
  knowledgeBackendConfigPath
} from "../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs";

const createSourceFileRegistryStoreMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());
const isSupportedImportFilePathMock = vi.hoisted(() => vi.fn());
const checkpointTreeIdMock = vi.hoisted(() => vi.fn());
const startCheckpointTreeMock = vi.hoisted(() => vi.fn());
const upsertCheckpointNodeMock = vi.hoisted(() => vi.fn());
const finishCheckpointTreeMock = vi.hoisted(() => vi.fn());
const deleteCheckpointTreeMock = vi.hoisted(() => vi.fn());
const serverTokenMock = vi.hoisted(() => vi.fn());
const atomicWriteJsonMock = vi.hoisted(() => vi.fn());
const loadSourceSearchRulesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/source-file-registry-store.mjs", () => ({
  createSourceFileRegistryStore: createSourceFileRegistryStoreMock
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  isSupportedImportFilePath: isSupportedImportFilePathMock
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

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/rules/source-search-rules.mjs", () => ({
  loadSourceSearchRules: loadSourceSearchRulesMock
}));

import { createKnowledgeSourceService } from "../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs";
import {
  deleteKnowledgeSourceFileIndex,
  getSourceFileIndexRun,
  indexedCandidateFilesForRoot,
  indexKnowledgeSourceFiles
} from "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs";

function createRegistryStore() {
  return {
    listBySource: vi.fn(() => new Map([["old.txt", { relativePath: "old.txt" }]])),
    applyDelta: vi.fn(),
    syncRegistryFiles: vi.fn(),
    upsertRegistrySource: vi.fn(),
    recordPathAlias: vi.fn(),
    purgePersistedSourcePaths: vi.fn(),
    clearSourceFiles: vi.fn(),
    removeRegistrySource: vi.fn(),
    countRegisteredFiles: vi.fn(() => 0),
    close: vi.fn()
  };
}

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(() => {
  createSourceFileRegistryStoreMock.mockReset();
  loadSettingsMock.mockReset();
  isSupportedImportFilePathMock.mockReset();
  checkpointTreeIdMock.mockReset();
  startCheckpointTreeMock.mockReset();
  upsertCheckpointNodeMock.mockReset();
  finishCheckpointTreeMock.mockReset();
  deleteCheckpointTreeMock.mockReset();
  serverTokenMock.mockReset();
  atomicWriteJsonMock.mockReset();
  loadSourceSearchRulesMock.mockReset();

  createSourceFileRegistryStoreMock.mockImplementation(() => createRegistryStore());
  loadSettingsMock.mockResolvedValue({ search: { enabled: true } });
  isSupportedImportFilePathMock.mockImplementation((filePath) => filePath.endsWith(".txt"));
  checkpointTreeIdMock.mockImplementation((kind, sourceId) => `${kind}:${sourceId}`);
  startCheckpointTreeMock.mockResolvedValue(undefined);
  upsertCheckpointNodeMock.mockResolvedValue(undefined);
  finishCheckpointTreeMock.mockResolvedValue(undefined);
  deleteCheckpointTreeMock.mockResolvedValue(undefined);
  serverTokenMock.mockImplementation((...parts) => parts.filter(Boolean).join(":"));
  atomicWriteJsonMock.mockImplementation(async (filePath, value) => {
    await writeJson(filePath, value);
  });
  loadSourceSearchRulesMock.mockResolvedValue({
    knowledgeSourceExtensions: [".txt"],
    ignoredDirectories: ["node_modules"],
    maxScanFiles: 100,
    maxFileBytes: 1024 * 1024,
    indexMaxTermsPerFile: 100,
    indexConcurrency: 1,
    readConcurrency: 1
  });
});

describe("knowledge storage final extra 8", () => {
  it("exports empty and malformed inputs across docx, html, and markdown", async () => {
    const generatedAt = "2026-06-05T01:02:03.000Z";

    const docx = await buildKnowledgeDocxExport({
      documents: [],
      generatedAt,
      filters: { sourceId: "source-a" },
      includeMachineReadable: true
    });
    expect(docx.contentType).toBe(KNOWLEDGE_DOCX_EXPORT_CONTENT_TYPE);
    expect(docx.fileName).toMatch(/\.docx$/);
    expect(docx.manifest).toMatchObject({
      packageType: KNOWLEDGE_DOCX_EXPORT_PACKAGE_TYPE,
      machineReadableAppendixFormat: "yaml",
      generatedAt,
      documentCount: 0,
      sectionCount: 0,
      blockCount: 0,
      assetCount: 0
    });
    expect(docx.buffer.byteLength).toBeGreaterThan(0);

    const html = buildKnowledgeHtmlExport({
      documents: [],
      generatedAt,
      filters: { batchId: "batch-a" }
    });
    expect(html.contentType).toBe(KNOWLEDGE_HTML_EXPORT_CONTENT_TYPE);
    expect(html.fileName).toMatch(/\.html$/);
    expect(html.buffer.toString("utf8")).toContain("没有可导出的知识文档");

    const markdown = buildKnowledgeMarkdownExport({
      documents: [],
      generatedAt,
      filters: { documentId: "doc-a" }
    });
    expect(markdown.contentType).toBe(KNOWLEDGE_MARKDOWN_EXPORT_CONTENT_TYPE);
    expect(markdown.fileName).toMatch(/\.md$/);
    expect(markdown.buffer.toString("utf8")).toContain("没有可导出的知识文档");

    await expect(buildKnowledgeDocxExport({ documents: [null], generatedAt })).rejects.toThrow(TypeError);
    expect(() => buildKnowledgeHtmlExport({ documents: [null], generatedAt })).toThrow(TypeError);
    expect(() => buildKnowledgeMarkdownExport({ documents: [null], generatedAt })).toThrow(TypeError);
  });

  it("handles missing, updated, and deleted knowledge sources without leaking side effects", async () => {
    await withTempRoot("pact-knowledge-source-service-final-extra-8-", async (root) => {
      const docsA = path.join(root, "docs-a");
      const docsB = path.join(root, "docs-b");
      await fs.mkdir(docsA, { recursive: true });
      await fs.mkdir(docsB, { recursive: true });
      await fs.writeFile(path.join(docsA, "alpha.txt"), "alpha", "utf8");

      const registryStore = createRegistryStore();
      createSourceFileRegistryStoreMock.mockReturnValue(registryStore);

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        watchingEnabled: false
      });

      await expect(service.updateSource("missing-source", { label: "Missing" })).resolves.toBeNull();
      await expect(service.deleteSource("missing-source")).resolves.toBeNull();
      await expect(service.listRegisteredFiles("missing-source")).resolves.toBeNull();

      const created = await service.createSource({
        directoryPath: docsA,
        label: "Docs A",
        autoSync: false,
        hydrationEnabled: false,
        runNow: false
      });

      expect(created).toMatchObject({
        skipped: true,
        reason: "created",
        source: expect.objectContaining({
          directoryPath: docsA,
          label: "Docs A"
        })
      });

      const updated = await service.updateSource(created.source.sourceId, {
        directoryPath: docsB,
        label: "Docs B"
      });

      expect(updated).toMatchObject({
        source: expect.objectContaining({
          sourceId: created.source.sourceId,
          directoryPath: docsB,
          label: "Docs B"
        })
      });
      expect(registryStore.recordPathAlias).toHaveBeenCalledWith({
        sourceId: created.source.sourceId,
        aliasDirectoryPath: docsA,
        canonicalDirectoryPath: docsB
      });
      expect(registryStore.purgePersistedSourcePaths).toHaveBeenCalledWith([
        path.join(docsA, "old.txt")
      ]);
      expect(registryStore.clearSourceFiles).toHaveBeenCalledWith(created.source.sourceId);

      const deleted = await service.deleteSource(created.source.sourceId);
      expect(deleted).toMatchObject({
        deletedSource: expect.objectContaining({
          sourceId: created.source.sourceId,
          directoryPath: docsB
        })
      });
      expect(deleteCheckpointTreeMock).toHaveBeenCalledWith({
        userDataPath: root,
        treeId: `knowledge-source-sync:${created.source.sourceId}`
      });
      expect(registryStore.removeRegistrySource).toHaveBeenCalledWith(created.source.sourceId);

      await expect(service.updateSource(created.source.sourceId, { label: "Again" })).resolves.toBeNull();
      await expect(service.deleteSource(created.source.sourceId)).resolves.toBeNull();

      await service.close();
    });
  });

  it("rebuilds an index, reports search boundary states, and returns a failure object when checkpoint setup fails", async () => {
    await withTempRoot("pact-source-file-index-final-extra-8-", async (root) => {
      const userDataPath = path.join(root, "user-data");
      const sourceDir = path.join(root, "source");
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, "invoice.txt"), "alpha beta invoice", "utf8");

      const source = {
        sourceId: "source-a",
        directoryPath: sourceDir,
        enabled: true,
        recursive: true
      };

      const indexed = await indexKnowledgeSourceFiles({
        userDataPath,
        source,
        reason: "seed",
        force: true
      });
      expect(indexed).toMatchObject({
        skipped: false,
        reason: "seed",
        sourceId: "source-a",
        fileCount: 1,
        indexedCount: 1,
        skippedCount: 0,
        failedCount: 0
      });
      expect(indexed.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

      const candidates = await indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "source-a", label: "Source A" },
        groups: [{ terms: ["alpha"] }]
      });
      expect(candidates).toMatchObject({
        available: true,
        candidateFileCount: 1,
        reason: "indexed"
      });
      expect(candidates.files).toHaveLength(1);
      expect(candidates.files[0].file).toBe(path.join(sourceDir, "invoice.txt"));

      await deleteKnowledgeSourceFileIndex({
        userDataPath,
        sourceId: "source-a"
      });
      await expect(getSourceFileIndexRun({ userDataPath, sourceId: "source-a" })).resolves.toBeNull();
      await expect(indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "source-a" },
        groups: [{ terms: ["alpha"] }]
      })).resolves.toMatchObject({
        available: false,
        reason: "source_not_indexed"
      });
      await expect(indexedCandidateFilesForRoot({
        userDataPath: path.join(root, "fresh-user-data"),
        root: { id: "source-b" },
        groups: [{ terms: ["alpha"] }]
      })).resolves.toMatchObject({
        available: false,
        reason: "index_missing"
      });
      await expect(indexedCandidateFilesForRoot({
        userDataPath,
        root: {},
        groups: [{ terms: ["alpha"] }]
      })).resolves.toMatchObject({
        available: false,
        reason: "missing_source_id"
      });

      startCheckpointTreeMock.mockResolvedValueOnce(undefined);
      startCheckpointTreeMock.mockRejectedValueOnce(new Error("checkpoint boom"));
      const rebuilt = await indexKnowledgeSourceFiles({
        userDataPath,
        source,
        reason: "rebuild",
        force: true
      });
      expect(rebuilt).toMatchObject({
        skipped: false,
        reason: "rebuild",
        sourceId: "source-a",
        fileCount: 0,
        indexedCount: 0,
        skippedCount: 0,
        failedCount: 1,
        error: "checkpoint boom"
      });
    });
  });

  it("repairs missing backend providers and falls back to contract retrieval modes", async () => {
    await withTempRoot("pact-knowledge-backend-port-final-extra-8-", async (root) => {
      const configPath = knowledgeBackendConfigPath(root);
      await writeJson(configPath, {
        schemaVersion: 1,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        updatedAt: "2026-06-05T00:00:00.000Z",
        providers: {
          dify: {
            provider: "dify",
            enabled: true,
            mode: "contract",
            authType: "apiKey",
            secretRef: "secret://pact/knowledge/dify-test",
            endpointRef: "https://dify.example.test",
            datasetPort: true,
            retrievalPort: true,
            evidencePort: true,
            exportPort: true,
            capabilities: ["search"],
            contractSpaces: [
              {
                spaceRef: "dify-space",
                label: "Dify Space",
                description: "Contract fixture",
                dataClass: "internal",
                sensitivity: "normal"
              }
            ]
          },
          box: {
            provider: "box",
            enabled: true,
            mode: "contract"
          }
        }
      });

      const port = createKnowledgeBackendPort({ userDataPath: root });
      const manifest = await port.manifest();
      expect(manifest).toMatchObject({
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        configPath,
        providerCount: 2,
        enabledProviderCount: 2,
        contractMode: true
      });
      expect(manifest.providers).toHaveProperty("dify");
      expect(manifest.providers).toHaveProperty("ragflow");
      expect(manifest.providers).not.toHaveProperty("box");
      expect(manifest.providers.dify.retrievalModes).toEqual([
        { value: "backendContract", label: "Backend Contract" }
      ]);
      expect(manifest.providers.ragflow.retrievalModes).toEqual([
        { value: "backendContract", label: "Backend Contract" }
      ]);

      const search = await port.search({
        provider: "dify",
        query: "alpha",
        limit: 1
      }, {
        subject: {
          subjectId: "agent-1"
        },
        workspaceId: "default"
      });
      expect(search).toMatchObject({
        ok: true,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        query: "alpha",
        retrievalMode: "backendContract",
        backendPort: "KnowledgeBasePort",
        metadataPolicy: "safeMetadataOnly",
        externalKnowledgeBase: {
          used: true,
          mode: "contract",
          contractVerified: true
        }
      });
      expect(search.providers).toEqual(["dify"]);
      expect(search.count).toBe(1);
      expect(search.items[0]).toMatchObject({
        provider: "dify",
        metadataOnly: true,
        contractVerified: true
      });

      expect(await port.getEvidence({})).toBeNull();
      const config = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(config.providers).toHaveProperty("ragflow");
      expect(config.providers).toHaveProperty("box");
    });
  });
});
