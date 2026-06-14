import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createImportEntryIdMock = vi.hoisted(() => vi.fn(() => "entry-0001"));
const persistRawMailObjectMock = vi.hoisted(() =>
  vi.fn(async (payload = {}) => ({
    objectId: "object-001",
    storageRelativePath: "objects/raw/object-001.bin",
    ...payload
  }))
);
const importCheckpointStoreMocks = vi.hoisted(() => ({
  createImportEntryId: createImportEntryIdMock,
  hydrateImportCheckpointSources: vi.fn(async ({ sources = [] } = {}) => sources),
  loadImportCheckpointEntry: vi.fn(async () => null),
  rawObjectPathsFromSources: vi.fn(() => []),
  saveImportCheckpointEntry: vi.fn(async () => undefined),
  validateImportCheckpointEntry: vi.fn(async () => false),
  collectProtectedRawObjectPaths: vi.fn(async () => new Set()),
  cleanupImportArtifacts: vi.fn(async () => ({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  }))
}));
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
const indexedCandidateFilesForRootMock = vi.hoisted(() => vi.fn());
const getIndexedSourceFileByEvidenceIdMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/import-resume-store.mjs", () => ({
  ...importCheckpointStoreMocks
}));

vi.mock("../../../server/platform/common/storage/raw-object-store.mjs", () => ({
  persistRawMailObject: persistRawMailObjectMock
}));

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
    indexedCandidateFilesForRoot: indexedCandidateFilesForRootMock,
    getIndexedSourceFileByEvidenceId: getIndexedSourceFileByEvidenceIdMock
  };
});

import { generateNormalizedDocuments } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import {
  createFileRoutingDecision,
  readInputSources
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";
import {
  createDocumentParsingRuntime
} from "../../../server/platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs";
import {
  decodeMimeEncodedWords,
  extractEmailHeaderValue,
  extractReadableEmailText,
  stripHtmlToReadableText
} from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/mail-readable-text.mjs";
import {
  getEmailRulesPath,
  loadEmailRules,
  saveEmailRules
} from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/email-rules.mjs";
import {
  getExpertVocabularyPath,
  loadExpertVocabulary,
  saveExpertVocabulary
} from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/expert-vocabulary.mjs";
import {
  isSourceEvidenceId,
  searchSourceFiles
} from "../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs";
import { sourceEvidenceIdForPath } from "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs";

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

function eml({ subject, body, from = "sender@example.test", to = "recipient@example.test" }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Fri, 05 Jun 2026 10:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");
}

beforeEach(() => {
  createImportEntryIdMock.mockReset().mockImplementation(() => "entry-0001");
  persistRawMailObjectMock.mockReset();
  importCheckpointStoreMocks.hydrateImportCheckpointSources.mockReset().mockResolvedValue([]);
  importCheckpointStoreMocks.loadImportCheckpointEntry.mockReset().mockResolvedValue(null);
  importCheckpointStoreMocks.rawObjectPathsFromSources.mockReset().mockReturnValue([]);
  importCheckpointStoreMocks.saveImportCheckpointEntry.mockReset().mockResolvedValue(undefined);
  importCheckpointStoreMocks.validateImportCheckpointEntry.mockReset().mockResolvedValue(false);
  importCheckpointStoreMocks.collectProtectedRawObjectPaths.mockReset().mockResolvedValue(new Set());
  importCheckpointStoreMocks.cleanupImportArtifacts.mockReset().mockResolvedValue({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  });
  execFileMock.mockReset();
  spawnSyncMock.mockReset().mockReturnValue({ status: 0 });
  indexedCandidateFilesForRootMock.mockReset().mockResolvedValue({
    available: false,
    reason: "index_unavailable"
  });
  getIndexedSourceFileByEvidenceIdMock.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("normalized documents preprocessing", () => {
  it("writes an empty manifest for empty input and skips email sources without generating docs", async () => {
    await withTempRoot("pact-knowledge-preprocessing-normalized-", async (userDataPath) => {
      const emptyManifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-empty",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [],
        chunks: [],
        analysis: {}
      });

      expect(emptyManifest.documents).toEqual([]);
      expect(emptyManifest.sourceMaterials).toEqual([]);
      expect(emptyManifest.assets).toEqual([]);
      expect(emptyManifest.summary).toMatchObject({
        documentCount: 0,
        sourceMaterialCount: 0,
        assetCount: 0
      });
      await expect(
        fs.stat(path.join(userDataPath, "jobs", "job-empty", "normalized-documents", "manifest.yaml"))
      ).resolves.toBeTruthy();

      const skipped = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-email-skip",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "mail-1",
            name: "mail.eml",
            path: "mail/mail.eml",
            kind: "email",
            text: "ignored"
          }
        ],
        chunks: [],
        analysis: {}
      });

      expect(skipped.documents).toEqual([]);
      expect(skipped.sourceMaterials).toEqual([]);
      expect(skipped.warnings).toEqual([]);
    });
  });

  it("falls back to a source-level document for unknown source kinds", async () => {
    await withTempRoot("pact-knowledge-preprocessing-normalized-", async (userDataPath) => {
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-fallback",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "blob-1",
            name: "notes.bin",
            path: "workspace/notes.bin",
            kind: "blob",
            text: "第一行\n\n第二行"
          }
        ],
        chunks: [],
        analysis: {}
      });

      expect(manifest.documents).toHaveLength(1);
      expect(manifest.documents[0]).toMatchObject({
        granularity: "source"
      });
      expect(manifest.sourceMaterials).toEqual([]);
      expect(manifest.warnings).toEqual([]);
    });
  });
});

describe("file processor routing and input ingestion", () => {
  it("treats empty buffers as unsupported when text fallback is disabled", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.alloc(0),
      fileName: "mystery",
      allowTextFallback: false
    });

    expect(decision).toMatchObject({
      extension: "",
      kind: "text",
      selectedSource: "unsupported",
      selectedConfidence: 0,
      isReadableText: true,
      routedFileName: "mystery"
    });
    expect(decision.signals).toEqual([]);
  });

  it("keeps pasted text when file paths are missing and reports the failed expansion", async () => {
    await withTempRoot("pact-knowledge-preprocessing-file-", async (userDataPath) => {
      const missingFilePath = path.join(userDataPath, "missing.txt");
      const result = await readInputSources({
        inputText: "  第一段\n第二段  ",
        filePaths: [missingFilePath],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z"
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        id: "pasted-text",
        kind: "text",
        text: "第一段\n第二段"
      });
      expect(result.warnings).toEqual([
        `${path.basename(missingFilePath)} 读取失败：ENOENT: no such file or directory, stat '${missingFilePath}'`
      ]);
      expect(result.failureReasons).toEqual([]);
    });
  });

  it("rejects file manifests outside the hydrated knowledge-source cache", async () => {
    await withTempRoot("pact-knowledge-preprocessing-file-", async (userDataPath) => {
      await expect(
        readInputSources({
          fileManifestPath: path.join(userDataPath, "..", "outside.json"),
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z"
        })
      ).rejects.toThrow("知识源文件清单路径不在允许的自动下载缓存目录中。");
    });
  });
});

describe("document parsing runtime", () => {
  it("normalizes inline source objects even when only source output is requested", async () => {
    const runtime = createDocumentParsingRuntime();
    const result = await runtime.parseDocuments({
      sources: [
        {
          text: "  # 标题  \n\n正文  ",
          warnings: ["  source-warning  "],
          rawObject: {
            objectId: "raw-1",
            uri: "/tmp/raw-1"
          }
        }
      ],
      expectedOutput: "sources",
      documentParsing: {
        dynamicParsing: {
          enabled: false
        }
      }
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      id: "source-1",
      name: "source-1.txt",
      path: "source-1.txt",
      kind: "text",
      text: "# 标题  \n\n正文",
      mediaType: "text/plain",
      rawObject: {
        objectId: "raw-1",
        uri: "/tmp/raw-1"
      }
    });
    expect(result.expectedOutputs).toEqual(["sources"]);
    expect(result.blocks).toEqual([]);
    expect(result.chunks).toEqual([]);
    expect(result.preprocessResult.sources).toHaveLength(1);
    expect(result.warnings).toEqual(["source-warning"]);
  });
});

describe("mail-readable-text rules", () => {
  it("decodes encoded words, strips html, and ignores attachment-only noise", () => {
    const raw = [
      "From: Ops <ops@example.test>",
      "To: Team <team@example.test>",
      "Subject: =?UTF-8?B?UmVwb3J0?=",
      "Date: Fri, 05 Jun 2026 10:00:00 +0000",
      'Content-Type: multipart/mixed; boundary="mix"',
      "",
      "--mix",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Hello=2C world! https://example.test/?utm_source=spam",
      "--mix",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<div>HTML <b>body</b><br><img alt=\"inline note\"></div>",
      "--mix",
      "Content-Type: application/octet-stream",
      "Content-Disposition: attachment; filename=\"report.bin\"",
      "",
      "BINARY-DATA",
      "--mix--"
    ].join("\n");

    expect(decodeMimeEncodedWords("=?UTF-8?B?SGVsbG8=?=")).toBe("Hello");
    expect(extractEmailHeaderValue(raw, "Subject")).toBe("Report");
    expect(stripHtmlToReadableText("<div>One<br>Two</div>")).toBe("One Two");
    expect(extractReadableEmailText(raw)).toContain("Hello, world!");
    expect(extractReadableEmailText(raw)).not.toContain("utm_source");
    expect(extractReadableEmailText(raw)).not.toContain("BINARY-DATA");
    expect(extractReadableEmailText("")).toBe("");
  });
});

describe("email rules and expert vocabulary normalization", () => {
  it("loads malformed email rules into a normalized shape and saves deduped updates", async () => {
    await withTempRoot("pact-knowledge-preprocessing-rules-", async (userDataPath) => {
      const rulesPath = getEmailRulesPath(userDataPath);
      await writeJson(rulesPath, {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        reportSeries: [
          {
            id: "weekly",
            label: " Weekly ",
            enabled: true,
            cadence: "weekly",
            keywords: ["  Quarterly  ", "quarterly", ""]
          }
        ],
        synonymDictionary: [
          {
            canonical: "Billing",
            terms: [" Billing ", "billing", "Invoice"]
          }
        ],
        departmentDictionary: [
          {
            department: "Finance",
            keywords: [" AP ", "ap", "  "]
          }
        ],
        keywordStopwords: ["  the  ", "THE", ""],
        transactionMergeRules: {
          highSimilarity: 2,
          mediumSimilarity: 0,
          mediumParticipantOverlap: "not-a-number",
          highParticipantOverlap: 0.9
        }
      });

      const loaded = await loadEmailRules(userDataPath);
      expect(loaded.reportSeries).toEqual([
        {
          id: "weekly",
          label: "Weekly",
          enabled: true,
          cadence: "weekly",
          keywords: ["Quarterly"]
        }
      ]);
      expect(loaded.synonymDictionary).toEqual([
        {
          canonical: "Billing",
          enabled: true,
          terms: ["Billing", "Invoice"]
        }
      ]);
      expect(loaded.departmentDictionary).toEqual([
        {
          department: "Finance",
          enabled: true,
          keywords: ["AP"],
          emailKeywords: []
        }
      ]);
      expect(loaded.keywordStopwords).toEqual(["the"]);
      expect(loaded.transactionMergeRules.highSimilarity).toBeGreaterThan(0);
      expect(loaded.transactionMergeRules.highSimilarity).toBeLessThanOrEqual(1);

      const saved = await saveEmailRules(userDataPath, {
        synonymDictionary: [
          {
            canonical: "Payment",
            terms: [" Payment ", "payment", "Pay"]
          }
        ],
        transactionMergeRules: {
          highSimilarity: 0.31
        }
      });

      expect(saved.synonymDictionary).toEqual([
        {
          canonical: "Payment",
          enabled: true,
          terms: ["Payment", "Pay"]
        }
      ]);
      expect(saved.transactionMergeRules.highSimilarity).toBe(0.31);
      await expect(fs.readFile(rulesPath, "utf8")).resolves.toContain("\"canonical\": \"Payment\"");
    });
  });

  it("loads and saves expert vocabulary entries with stable normalization", async () => {
    await withTempRoot("pact-knowledge-preprocessing-vocab-", async (userDataPath) => {
      const vocabPath = getExpertVocabularyPath(userDataPath);
      await writeJson(vocabPath, {
        schemaVersion: "v0.0.1:schema:definition-1",
        version: 3,
        updatedAt: "2026-06-05T00:00:00.000Z",
        publishedAt: "2026-06-05T00:00:00.000Z",
        source: "custom",
        entries: [
          {
            path: " finance / payables ",
            label: " Payables ",
            keywords: ["Invoice", "invoice", ""],
            domains: ["https://AP.Example.test/path"],
            status: "retired",
            notes: "  note  "
          },
          {
            path: "",
            label: "missing path",
            keywords: ["orphan"]
          }
        ]
      });

      const loaded = await loadExpertVocabulary(userDataPath);
      expect(loaded.version).toBe(3);
      expect(loaded.entries).toEqual([
        {
          id: expect.any(String),
          pathSegments: ["finance", "payables"],
          label: "Payables",
          keywords: ["Invoice"],
          domains: ["ap.example.test"],
          status: "retired",
          notes: "note"
        },
        {
          id: expect.any(String),
          pathSegments: ["missing path"],
          label: "missing path",
          keywords: ["orphan"],
          domains: [],
          status: "active",
          notes: ""
        }
      ]);

      const saved = await saveExpertVocabulary(userDataPath, {
        entries: [
          {
            path: "ops/alerts",
            terms: ["Alert", "alert"],
            emailDomains: ["OPS.EXAMPLE.TEST"]
          }
        ]
      });

      expect(saved.version).toBe(4);
      expect(saved.entries[0]).toMatchObject({
        pathSegments: ["ops", "alerts"],
        label: "alerts",
        keywords: ["Alert"],
        domains: ["ops.example.test"],
        status: "active"
      });
      await expect(fs.readFile(vocabPath, "utf8")).resolves.toContain("\"ops\"");
    });
  });
});

describe("source-file-search service", () => {
  it("uses indexed candidate files when the inverted index is available", async () => {
    await withTempRoot("pact-knowledge-preprocessing-search-", async (userDataPath) => {
      const sourceDir = path.join(userDataPath, "mail");
      await fs.mkdir(sourceDir, { recursive: true });
      const sourcePath = path.join(sourceDir, "indexed.eml");
      await writeText(
        sourcePath,
        eml({
          subject: "Alpha bulletin",
          body: "alpha body token"
        })
      );
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        maxFileBytes: 256 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 100,
        readConcurrency: 2,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: true,
        useInvertedIndex: true,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml"],
        ignoredDirectories: [],
        scanRoots: [],
        queryExpansions: [],
        snippetWindow: 120
      });
      await writeJson(path.join(userDataPath, "knowledge-sources", "sources.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            sourceId: "mail-root",
            directoryPath: sourceDir,
            label: "Mail Root",
            enabled: true,
            lastIndexSnapshotHash: "snapshot-1"
          }
        ]
      });
      indexedCandidateFilesForRootMock.mockResolvedValue({
        available: true,
        candidateFileCount: 1,
        files: [
          {
            file: sourcePath,
            root: {
              id: "mail-root",
              sourceKind: "knowledge-source",
              directoryPath: sourceDir,
              extensions: [".eml"],
              enabled: true
            }
          }
        ]
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "alpha",
        limit: 10
      });

      expect(isSourceEvidenceId(result.items[0].evidenceId)).toBe(true);
      expect(result.explain.candidateSearch).toBe("sqlite-inverted-index");
      expect(result.explain.invertedIndex.used).toBe(true);
      expect(result.explain.highRelevanceCount).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        title: "Alpha bulletin",
        relevanceTier: "high"
      });
      expect(sourceEvidenceIdForPath(userDataPath, sourcePath)).toBe(result.items[0].evidenceId);
    });
  });

  it("falls back to a directory walk when the query is empty", async () => {
    await withTempRoot("pact-knowledge-preprocessing-search-", async (userDataPath) => {
      const sourceDir = path.join(userDataPath, "mail");
      await fs.mkdir(sourceDir, { recursive: true });
      await writeText(
        path.join(sourceDir, "visible.eml"),
        eml({
          subject: "Visible subject",
          body: "plain text only"
        })
      );
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        maxFileBytes: 256 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 100,
        readConcurrency: 2,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: false,
        useInvertedIndex: true,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml"],
        ignoredDirectories: [],
        scanRoots: [
          {
            id: "mail-root",
            label: "Mail Root",
            relativePath: "mail",
            extensions: [".eml"],
            enabled: true
          }
        ],
        queryExpansions: [],
        snippetWindow: 120
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "",
        limit: 10
      });

      expect(result.explain.candidateSearch).toBe("js-directory-walk");
      expect(result.explain.queryGroups).toEqual([]);
      expect(result.items).toEqual([]);
      expect(result.explain.scannedFiles).toBeGreaterThan(0);
    });
  });
});
