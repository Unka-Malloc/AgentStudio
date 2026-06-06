import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const collectProtectedRawObjectPathsMock = vi.hoisted(() => vi.fn(async () => new Set()));
const createImportEntryIdMock = vi.hoisted(() => vi.fn());
const cleanupImportArtifactsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  }))
);
const hydrateImportCheckpointSourcesMock = vi.hoisted(() => vi.fn(async ({ sources = [] } = {}) => sources));
const loadImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => null));
const rawObjectPathsFromSourcesMock = vi.hoisted(() =>
  vi.fn((sources = []) =>
    (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.rawObject?.storageRelativePath || "").trim())
      .filter(Boolean)
  )
);
const saveImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => undefined));
const validateImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => false));
const persistRawMailObjectMock = vi.hoisted(() =>
  vi.fn(async (payload = {}) => ({
    objectId: "object-001",
    storageRelativePath: "objects/raw/object-001.bin",
    ...payload
  }))
);
const execFileMock = vi.hoisted(() =>
  vi.fn((command, args, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    queueMicrotask(() => cb(null, { stdout: "", stderr: "" }));
  })
);
const spawnSyncMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: 1
  }))
);
const indexedCandidateFilesForRootMock = vi.hoisted(() => vi.fn());
const getIndexedSourceFileByEvidenceIdMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/import-resume-store.mjs", () => ({
  createImportEntryId: createImportEntryIdMock,
  hydrateImportCheckpointSources: hydrateImportCheckpointSourcesMock,
  loadImportCheckpointEntry: loadImportCheckpointEntryMock,
  rawObjectPathsFromSources: rawObjectPathsFromSourcesMock,
  saveImportCheckpointEntry: saveImportCheckpointEntryMock,
  validateImportCheckpointEntry: validateImportCheckpointEntryMock,
  collectProtectedRawObjectPaths: collectProtectedRawObjectPathsMock,
  cleanupImportArtifacts: cleanupImportArtifactsMock
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

let createFileRoutingDecision;
let generateNormalizedDocuments;
let getSourceFileEvidence;
let readInputSources;
let searchSourceFiles;

beforeAll(async () => {
  ({
    createFileRoutingDecision,
    readInputSources
  } = await import("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs"));
  ({ generateNormalizedDocuments } = await import(
    "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs"
  ));
  ({
    getSourceFileEvidence,
    searchSourceFiles
  } = await import("../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs"));
});

beforeEach(() => {
  createImportEntryIdMock.mockReset().mockImplementation(() => "entry-0001");
  collectProtectedRawObjectPathsMock.mockReset().mockResolvedValue(new Set());
  cleanupImportArtifactsMock.mockReset().mockResolvedValue({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  });
  hydrateImportCheckpointSourcesMock.mockReset().mockResolvedValue([]);
  loadImportCheckpointEntryMock.mockReset().mockResolvedValue(null);
  rawObjectPathsFromSourcesMock.mockReset().mockImplementation((sources = []) =>
    (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.rawObject?.storageRelativePath || "").trim())
      .filter(Boolean)
  );
  saveImportCheckpointEntryMock.mockReset().mockResolvedValue(undefined);
  validateImportCheckpointEntryMock.mockReset().mockResolvedValue(false);
  persistRawMailObjectMock.mockReset().mockImplementation(async (payload = {}) => ({
    objectId: "object-001",
    storageRelativePath: "objects/raw/object-001.bin",
    ...payload
  }));
  execFileMock.mockReset();
  spawnSyncMock.mockReset().mockReturnValue({ status: 1 });
  indexedCandidateFilesForRootMock.mockReset().mockResolvedValue({
    available: false,
    reason: "index_unavailable"
  });
  getIndexedSourceFileByEvidenceIdMock.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  vi.clearAllMocks();
});

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function eml({ subject, body }) {
  return [
    "From: sender@example.test",
    "To: recipient@example.test",
    `Subject: ${subject}`,
    "Date: Fri, 05 Jun 2026 10:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");
}

async function writeSearchRules(userDataPath, overrides = {}) {
  await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
    schemaVersion: 1,
    updatedAt: overrides.updatedAt || "2026-06-05T00:00:00.000Z",
    maxFileBytes: 256 * 1024,
    maxEvidenceBytes: 16 * 1024,
    maxScanFiles: 100,
    readConcurrency: 2,
    indexConcurrency: 2,
    indexMaxTermsPerFile: 2000,
    cacheTtlMs: 60 * 1000,
    includeKnowledgeSources: false,
    useInvertedIndex: overrides.useInvertedIndex ?? false,
    scanFallbackWhenIndexMissing: overrides.scanFallbackWhenIndexMissing ?? false,
    knowledgeSourceExtensions: [".eml"],
    ignoredDirectories: ["node_modules"],
    scanRoots: overrides.scanRoots || [],
    queryExpansions: [],
    snippetWindow: 120
  });
}

describe("knowledge file processing and search final extra coverage", () => {
  it("keeps empty input empty and produces an empty normalized manifest", async () => {
    await withTempRoot("pact-knowledge-file-processing-search-final-extra-", async (userDataPath) => {
      const routing = createFileRoutingDecision({
        buffer: Buffer.alloc(0),
        fileName: "mystery",
        allowTextFallback: false
      });

      expect(routing).toMatchObject({
        extension: "",
        kind: "text",
        selectedSource: "unsupported",
        selectedConfidence: 0,
        isReadableText: true,
        routedFileName: "mystery"
      });
      expect(routing.signals).toEqual([]);

      await expect(readInputSources({
        userDataPath,
        generatedAt: "2026-06-05T00:00:00.000Z",
        settings: {},
        inputText: "   ",
        filePaths: [],
        uploadedFiles: []
      })).rejects.toThrow("没有可处理的内容");

      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-empty",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [],
        chunks: [],
        analysis: {}
      });

      expect(manifest.documents).toEqual([]);
      expect(manifest.sourceMaterials).toEqual([]);
      expect(manifest.assets).toEqual([]);
      expect(manifest.warnings).toEqual([]);
      expect(manifest.summary).toEqual({
        documentCount: 0,
        sourceMaterialCount: 0,
        assetCount: 0,
        byGranularity: {}
      });
      await expect(
        fs.stat(path.join(userDataPath, "jobs", "job-empty", "normalized-documents", "manifest.yaml"))
      ).resolves.toBeTruthy();
    });
  });

  it("routes HTML files and preserves normalized source material output", async () => {
    await withTempRoot("pact-knowledge-file-processing-search-final-extra-", async (userDataPath) => {
      const htmlSourcePath = path.join(userDataPath, "workspace", "docs", "page.html");
      await writeText(
        htmlSourcePath,
        [
          "<html>",
          "  <body>",
          "    <h1>Guide</h1>",
          "    <p>Body line one.</p>",
          "    <p>Body line two.</p>",
          "  </body>",
          "</html>"
        ].join("\n")
      );

      const routing = createFileRoutingDecision({
        buffer: Buffer.from("<html><body>Guide</body></html>", "utf8"),
        fileName: "workspace/docs/page.html",
        declaredFileNames: ["workspace/docs/page.html"]
      });

      expect(routing).toMatchObject({
        extension: ".html",
        selectedSource: "declared-path",
        routedFileName: "workspace/docs/page.html"
      });

      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-html",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "md-1",
            name: "",
            path: "workspace/docs/page.html",
            originalRelativePath: "incoming/docs/page.html",
            kind: "document",
            mediaType: "text/html",
            originalBuffer: Buffer.from(await fs.readFile(htmlSourcePath)),
            text: "Guide\n\nBody line one.\n\nBody line two."
          }
        ],
        chunks: [
          {
            id: "chunk-1",
            sourceId: "md-1",
            titlePath: ["Overview"],
            content: "Body line one.\n\nBody line two.",
            text: "Body line one.\n\nBody line two.",
            metadata: {
              sourceRange: "1-4",
              sourceLocator: "overview"
            }
          }
        ],
        analysis: {}
      });

      expect(manifest.documents).toHaveLength(3);
      expect(manifest.documents[0]).toMatchObject({
        adapterId: "builtin/html-adapter",
        granularity: "page",
        title: "workspace/docs/page.html - HTML 页面"
      });
      expect(manifest.documents.map((entry) => entry.granularity)).toEqual([
        "page",
        "section",
        "block"
      ]);
      expect(manifest.sourceMaterials).toHaveLength(1);
      expect(manifest.sourceMaterials[0]).toMatchObject({
        adapterId: "builtin/html-adapter",
        granularity: "source-material",
        title: "workspace/docs/page.html 原始材料"
      });
      expect(manifest.assets).toEqual([]);
      expect(manifest.warnings).toEqual([]);
      expect(manifest.summary).toMatchObject({
        documentCount: 3,
        sourceMaterialCount: 1,
        assetCount: 0,
        byGranularity: {
          page: 1,
          section: 1,
          block: 1
        }
      });
      await expect(
        fs.stat(path.join(userDataPath, "jobs", "job-html", "normalized-documents", "sources"))
      ).resolves.toBeTruthy();
    });
  });

  it("returns hits and misses through directory walking search", async () => {
    await withTempRoot("pact-knowledge-file-processing-search-final-extra-", async (userDataPath) => {
      const mailRoot = path.join(userDataPath, "mail");
      await fs.mkdir(mailRoot, { recursive: true });
      await writeText(
        path.join(mailRoot, "hit.eml"),
        eml({
          subject: "Invoice ready",
          body: "The invoice body includes the searchable term."
        })
      );
      await writeText(
        path.join(mailRoot, "miss.eml"),
        eml({
          subject: "Status update",
          body: "Nothing useful lives here."
        })
      );
      await writeSearchRules(userDataPath, {
        useInvertedIndex: false,
        scanRoots: [
          {
            id: "mail-root",
            label: "Mail Root",
            relativePath: "mail",
            extensions: [".eml"],
            enabled: true
          }
        ]
      });

      const hit = await searchSourceFiles({
        userDataPath,
        query: "invoice",
        limit: 10
      });
      const miss = await searchSourceFiles({
        userDataPath,
        query: "does-not-exist",
        limit: 10
      });

      expect(hit.explain.candidateSearch).toBe("js-directory-walk");
      expect(hit.explain.scannedFiles).toBe(2);
      expect(hit.items).toHaveLength(1);
      expect(hit.items[0]).toMatchObject({
        title: "Invoice ready",
        relevanceTier: "high",
        contextEligible: true,
        source: expect.objectContaining({
          relativePath: "mail/hit.eml"
        })
      });

      expect(miss.explain.candidateSearch).toBe("js-directory-walk");
      expect(miss.explain.scannedFiles).toBe(2);
      expect(miss.items).toHaveLength(0);
      expect(miss.explain.matchedUniqueFiles).toBe(0);
    });
  });

  it("ignores out-of-bounds roots and falls back when indexed candidates are unreadable", async () => {
    await withTempRoot("pact-knowledge-file-processing-search-final-extra-", async (userDataPath) => {
      const validRoot = path.join(userDataPath, "mail");
      await fs.mkdir(validRoot, { recursive: true });
      await writeText(
        path.join(validRoot, "existing.eml"),
        eml({
          subject: "Existing file",
          body: "This file should not be returned in the boundary case."
        })
      );

      await writeSearchRules(userDataPath, {
        useInvertedIndex: false,
        scanRoots: [
          {
            id: "outside-root",
            label: "Outside Root",
            relativePath: "../outside",
            extensions: [".eml"],
            enabled: true
          }
        ]
      });

      const boundary = await searchSourceFiles({
        userDataPath,
        query: "existing",
        limit: 10
      });

      expect(boundary.items).toHaveLength(0);
      expect(boundary.explain.scannedFiles).toBe(0);

      await writeSearchRules(userDataPath, {
        useInvertedIndex: true,
        scanRoots: [
          {
            id: "mail-root",
            label: "Mail Root",
            relativePath: "mail",
            extensions: [".eml"],
            enabled: true
          }
        ]
      });
      indexedCandidateFilesForRootMock.mockResolvedValueOnce({
        available: true,
        candidateFileCount: 1,
        files: [
          {
            file: path.join(validRoot, "missing.eml"),
            root: {
              id: "mail-root",
              relativePath: "mail",
              extensions: [".eml"]
            }
          }
        ]
      });

      const fallback = await searchSourceFiles({
        userDataPath,
        query: "existing",
        limit: 10
      });

      expect(fallback.explain.candidateSearch).toBe("sqlite-inverted-index");
      expect(fallback.explain.candidateFileCount).toBe(1);
      expect(fallback.explain.scannedFiles).toBe(1);
      expect(fallback.items).toHaveLength(0);

      await expect(getSourceFileEvidence({
        userDataPath,
        evidenceId: "not-an-evidence-id"
      })).resolves.toBeNull();

      getIndexedSourceFileByEvidenceIdMock.mockResolvedValueOnce({
        file: path.join(validRoot, "missing.evidence.eml")
      });
      await expect(getSourceFileEvidence({
        userDataPath,
        evidenceId: "source-evidence::missing"
      })).resolves.toBeNull();
    });
  });
});
