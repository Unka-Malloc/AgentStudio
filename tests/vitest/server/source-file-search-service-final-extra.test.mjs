import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessState = vi.hoisted(() => ({
  rgAvailable: false,
  rgMatchesByTerm: new Map()
}));

const execFileMock = vi.hoisted(() =>
  vi.fn((command, args, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    queueMicrotask(() => cb(null, { stdout: "", stderr: "" }));
  })
);

const spawnSyncMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: childProcessState.rgAvailable ? 0 : 1
  }))
);

const getIndexedSourceFileByEvidenceIdMock = vi.hoisted(() => vi.fn());
const indexedCandidateFilesForRootMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawnSync: spawnSyncMock
}));

vi.mock(
  "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs",
  async () => {
    const actual = await vi.importActual(
      "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
    );
    return {
      ...actual,
      getIndexedSourceFileByEvidenceId: getIndexedSourceFileByEvidenceIdMock,
      indexedCandidateFilesForRoot: indexedCandidateFilesForRootMock
    };
  }
);

let getSourceFileEvidence;
let searchSourceFiles;
let sourceEvidenceIdForPath;

beforeAll(async () => {
  ({ getSourceFileEvidence, searchSourceFiles } = await import(
    "../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs"
  ));
  ({ sourceEvidenceIdForPath } = await import(
    "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
  ));
});

beforeEach(() => {
  childProcessState.rgAvailable = false;
  childProcessState.rgMatchesByTerm.clear();
  execFileMock.mockClear();
  spawnSyncMock.mockClear();
  getIndexedSourceFileByEvidenceIdMock.mockReset();
  indexedCandidateFilesForRootMock.mockReset();
  getIndexedSourceFileByEvidenceIdMock.mockResolvedValue(null);
  indexedCandidateFilesForRootMock.mockResolvedValue({
    available: false,
    reason: "index_unavailable"
  });
});

async function withTempUserData(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-source-search-final-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function eml({ subject, body, from = "sender@example.test" }) {
  return [
    `From: ${from}`,
    "To: recipient@example.test",
    `Subject: ${subject}`,
    "Date: Fri, 05 Jun 2026 10:00:00 +0000",
    "Content-Type: text/html; charset=utf-8",
    "",
    body
  ].join("\n");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareRules(userDataPath, extra = {}) {
  await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt: extra.updatedAt || `rules-${Math.random()}`,
    maxFileBytes: 256 * 1024,
    maxEvidenceBytes: 16 * 1024,
    maxScanFiles: 20,
    readConcurrency: 3,
    indexConcurrency: 2,
    indexMaxTermsPerFile: 2000,
    cacheTtlMs: 60 * 1000,
    includeKnowledgeSources: extra.includeKnowledgeSources ?? false,
    useInvertedIndex: extra.useInvertedIndex ?? true,
    scanFallbackWhenIndexMissing: extra.scanFallbackWhenIndexMissing ?? false,
    knowledgeSourceExtensions: [".eml"],
    ignoredDirectories: ["node_modules"],
    scanRoots: extra.scanRoots || [],
    queryExpansions: [
      {
        id: "invoice-alias",
        triggers: ["invoice"],
        terms: ["invoice", "发票"]
      }
    ],
    snippetWindow: 80
  });
}

describe("source-file-search final extra coverage", () => {
  it("uses indexed candidates, reports cache hits, and skips ripgrep when index is available", async () => {
    await withTempUserData(async (userDataPath) => {
      const root = path.join(userDataPath, "mail");
      await fs.mkdir(root, { recursive: true });
      const indexedFile = path.join(root, "indexed.eml");
      await fs.writeFile(indexedFile, eml({
        subject: "Indexed invoice",
        body: "<p>invoice 发票 已确认</p><script>invoice hidden</script>"
      }), "utf8");
      await prepareRules(userDataPath, {
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
      indexedCandidateFilesForRootMock.mockResolvedValue({
        available: true,
        candidateFileCount: 1,
        files: [{ file: indexedFile, root: { id: "mail-root", relativePath: "mail", extensions: [".eml"] } }]
      });

      const first = await searchSourceFiles({
        userDataPath,
        query: "invoice",
        limit: 5
      });
      const second = await searchSourceFiles({
        userDataPath,
        query: "invoice",
        limit: 5
      });

      expect(spawnSyncMock).not.toHaveBeenCalled();
      expect(execFileMock).not.toHaveBeenCalled();
      expect(indexedCandidateFilesForRootMock).toHaveBeenCalledTimes(1);
      expect(first.explain.candidateSearch).toBe("sqlite-inverted-index");
      expect(first.explain.invertedIndex).toMatchObject({
        enabled: true,
        used: true,
        unavailableSources: [],
        scanFallbackWhenIndexMissing: false
      });
      expect(first.explain.queryGroups[0]).toMatchObject({
        queryTerm: "invoice",
        expansionIds: ["invoice-alias"],
        termCount: 2
      });
      expect(first.items[0]).toMatchObject({
        title: "Indexed invoice",
        relevanceTier: "high",
        contextEligible: true
      });
      expect(second.fromCache).toBe(true);
      expect(second.items[0].evidenceId).toBe(first.items[0].evidenceId);
    });
  });

  it("records knowledge-source index unavailability and respects no-fallback policy", async () => {
    await withTempUserData(async (userDataPath) => {
      const knowledgeRoot = path.join(userDataPath, "external-source");
      await fs.mkdir(knowledgeRoot, { recursive: true });
      await fs.writeFile(path.join(knowledgeRoot, "skipped.eml"), eml({
        subject: "Should not scan",
        body: "invoice appears here but index fallback is disabled"
      }), "utf8");
      await prepareRules(userDataPath, {
        includeKnowledgeSources: true,
        scanFallbackWhenIndexMissing: false,
        scanRoots: []
      });
      await writeJson(path.join(userDataPath, "knowledge-sources", "sources.json"), {
        sources: [
          {
            sourceId: "source-a",
            label: "External Source",
            directoryPath: knowledgeRoot,
            enabled: true,
            lastIndexSnapshotHash: "hash-a",
            lastIndexAt: "2026-06-05T00:00:00.000Z",
            lastIndexStatus: "failed"
          }
        ]
      });
      indexedCandidateFilesForRootMock.mockResolvedValue({
        available: false,
        reason: "stale_index"
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "invoice",
        limit: 10
      });

      expect(result.items).toHaveLength(0);
      expect(result.explain.scannedFiles).toBe(0);
      expect(result.explain.invertedIndex.unavailableSources).toEqual([
        {
          sourceId: "source-a",
          reason: "stale_index"
        }
      ]);
      expect(result.explain.invertedIndex.scanFallbackWhenIndexMissing).toBe(false);
    });
  });

  it("falls back to scanning knowledge-source files when configured and omits oversize results", async () => {
    await withTempUserData(async (userDataPath) => {
      const knowledgeRoot = path.join(userDataPath, "external-source");
      await fs.mkdir(knowledgeRoot, { recursive: true });
      await fs.writeFile(path.join(knowledgeRoot, "hit.eml"), eml({
        subject: "Fallback invoice",
        body: "invoice body text"
      }), "utf8");
      await fs.writeFile(path.join(knowledgeRoot, "large.eml"), "x".repeat(300 * 1024), "utf8");
      await prepareRules(userDataPath, {
        includeKnowledgeSources: true,
        scanFallbackWhenIndexMissing: true,
        scanRoots: []
      });
      await writeJson(path.join(userDataPath, "knowledge-sources", "sources.json"), {
        sources: [
          {
            sourceId: "source-b",
            label: "External Source",
            directoryPath: knowledgeRoot,
            enabled: true
          },
          {
            sourceId: "disabled",
            directoryPath: knowledgeRoot,
            enabled: false
          }
        ]
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "invoice",
        returnAll: true
      });

      expect(result.limit).toBe("all");
      expect(result.explain.candidateSearch).toBe("js-directory-walk");
      expect(result.explain.invertedIndex.unavailableSources).toEqual([
        {
          sourceId: "source-b",
          reason: "index_unavailable"
        }
      ]);
      expect(result.explain.skippedLargeFiles).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].source.relativePath).toContain("external-source/hit.eml");
    });
  });

  it("reads evidence through the indexed evidence locator and returns null when preview fails", async () => {
    await withTempUserData(async (userDataPath) => {
      const root = path.join(userDataPath, "mail");
      await fs.mkdir(root, { recursive: true });
      const evidenceFile = path.join(root, "indexed-evidence.eml");
      await fs.writeFile(evidenceFile, eml({
        subject: "Indexed Evidence",
        body: "Body with ``` fenced marker"
      }), "utf8");
      await prepareRules(userDataPath);
      const evidenceId = sourceEvidenceIdForPath(userDataPath, evidenceFile);
      getIndexedSourceFileByEvidenceIdMock.mockResolvedValueOnce({
        file: evidenceFile,
        root: { id: "mail-root" }
      });

      const evidence = await getSourceFileEvidence({
        userDataPath,
        evidenceId
      });

      expect(evidence).toMatchObject({
        evidenceId,
        title: "Indexed Evidence",
        batchId: "",
        locator: {
          relativePath: "mail/indexed-evidence.eml"
        }
      });
      expect(evidence.markdown).toContain("`\u200b`` fenced marker");
      expect(evidence.payload.document.metadata).toMatchObject({
        from: "sender@example.test",
        date: "Fri, 05 Jun 2026 10:00:00 +0000",
        truncated: false
      });

      getIndexedSourceFileByEvidenceIdMock.mockResolvedValueOnce({
        file: path.join(root, "missing.eml")
      });
      await expect(getSourceFileEvidence({
        userDataPath,
        evidenceId: "source-evidence::missing"
      })).resolves.toBeNull();
    });
  });
});
