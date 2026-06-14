import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteKnowledgeSourceFileIndex,
  extractIndexTerms,
  getIndexedSourceFileByEvidenceId,
  getSourceFileIndexRun,
  indexedCandidateFilesForRoot,
  indexKnowledgeSourceFiles,
  SOURCE_EVIDENCE_PREFIX,
  sourceEvidenceIdForPath
} from "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs";

async function withTempDir(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-source-file-index-"));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function writeSourceSearchRules(userDataPath, overrides = {}) {
  const rulesPath = path.join(userDataPath, "rules", "source-search-rules.json");
  await fs.mkdir(path.dirname(rulesPath), { recursive: true });
  await fs.writeFile(
    rulesPath,
    `${JSON.stringify({
      schemaVersion: "v0.0.1:schema:definition-1",
      updatedAt: "2026-06-06T00:00:00.000Z",
      maxFileBytes: 5 * 1024 * 1024,
      maxEvidenceBytes: 512 * 1024,
      maxScanFiles: 1000000,
      readConcurrency: 2,
      indexConcurrency: 2,
      indexMaxTermsPerFile: 20000,
      cacheTtlMs: 300000,
      includeKnowledgeSources: true,
      useInvertedIndex: true,
      scanFallbackWhenIndexMissing: false,
      knowledgeSourceExtensions: [".eml", ".txt"],
      ignoredDirectories: [],
      scanRoots: [],
      queryExpansions: [],
      snippetWindow: 220,
      ...overrides
    }, null, 2)}\n`,
    "utf8"
  );
}

describe("source file index service extra coverage", () => {
  it("creates stable source evidence ids from user data relative paths", async () => {
    await withTempDir(async (root) => {
      const userDataPath = path.join(root, "user-data");
      const firstPath = path.join(root, "sources", "alpha.eml");
      const secondPath = path.join(root, "sources", "beta.eml");

      const first = sourceEvidenceIdForPath(userDataPath, firstPath);

      expect(first).toMatch(new RegExp(`^${SOURCE_EVIDENCE_PREFIX}[a-f0-9]{32}$`));
      expect(sourceEvidenceIdForPath(userDataPath, firstPath)).toBe(first);
      expect(sourceEvidenceIdForPath(userDataPath, secondPath)).not.toBe(first);
    });
  });

  it("extracts normalized English terms and Han ngrams with counts", () => {
    const terms = extractIndexTerms("Alpha alpha 中文测试 beta-test", "raw", 50);
    const byTerm = new Map(terms.map((item) => [item.term, item]));

    expect(byTerm.get("alpha")).toMatchObject({ field: "raw", count: 2, firstPosition: 0 });
    expect(byTerm.get("中文测试")).toMatchObject({ field: "raw", count: 2 });
    expect(byTerm.get("中文")).toMatchObject({ field: "raw", count: 1 });
    expect(byTerm.get("测试")).toMatchObject({ field: "raw", count: 1 });
    expect(byTerm.get("beta-test")).toMatchObject({ field: "raw", count: 1 });
  });

  it("honors Han term limits when building ngrams", () => {
    expect(extractIndexTerms("中文测试样本", "raw", 3).map((item) => item.term)).toEqual([
      "中文测试样本",
      "中文",
      "文测"
    ]);
  });

  it("indexes source files, searches indexed candidates, reuses unchanged snapshots, and deletes the index", async () => {
    await withTempDir(async (root) => {
      const userDataPath = path.join(root, "user-data");
      const sourceDir = path.join(root, "managed-source");
      const mailPath = path.join(sourceDir, "mail", "invoice.eml");
      const notesPath = path.join(sourceDir, "notes.txt");
      await writeText(
        mailPath,
        [
          "From: ops@example.test",
          "Subject: Invoice Status",
          "Date: Thu, 04 Jun 2026 10:00:00 +0000",
          "",
          "<p>Invoice alpha payment evidence.</p>"
        ].join("\n")
      );
      await writeText(notesPath, "Deployment beta checklist and release notes.");
      await writeText(path.join(sourceDir, "node_modules", "ignored.txt"), "invoice should be ignored");

      const source = {
        sourceId: "source-a",
        directoryPath: sourceDir,
        enabled: true,
        recursive: true
      };

      const indexed = await indexKnowledgeSourceFiles({
        userDataPath,
        source,
        reason: "unit-test",
        force: true
      });

      expect(indexed).toMatchObject({
        skipped: false,
        reason: "unit-test",
        sourceId: "source-a",
        fileCount: 2,
        indexedCount: 2,
        skippedCount: 0,
        failedCount: 0
      });
      expect(indexed.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

      const invoiceCandidates = await indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "source-a", label: "Source A" },
        groups: [{ terms: ["invoice"] }]
      });
      expect(invoiceCandidates).toMatchObject({
        available: true,
        candidateFileCount: 1,
        reason: "indexed"
      });
      expect(invoiceCandidates.files.map((entry) => path.basename(entry.file))).toEqual(["invoice.eml"]);

      const noMatch = await indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "source-a" },
        groups: [{ terms: ["missing-token"] }]
      });
      expect(noMatch).toMatchObject({
        available: true,
        files: [],
        candidateFileCount: 0,
        reason: "no_index_match"
      });

      const evidence = await getIndexedSourceFileByEvidenceId({
        userDataPath,
        evidenceId: sourceEvidenceIdForPath(userDataPath, mailPath)
      });
      expect(evidence).toMatchObject({
        file: mailPath,
        root: {
          id: "source-a",
          label: "source-a",
          sourceKind: "knowledge-source-index"
        }
      });

      const run = await getSourceFileIndexRun({ userDataPath, sourceId: "source-a" });
      expect(run).toMatchObject({
        source_id: "source-a",
        status: "indexed",
        reason: "unit-test",
        file_count: 2,
        indexed_count: 2
      });

      const reused = await indexKnowledgeSourceFiles({
        userDataPath,
        source,
        reason: "unit-test",
        force: false
      });
      expect(reused).toMatchObject({
        skipped: true,
        reason: "unchanged",
        sourceId: "source-a",
        fileCount: 2,
        indexedCount: 2
      });

      const refreshed = await indexKnowledgeSourceFiles({
        userDataPath,
        source,
        reason: "unit-test-refresh",
        force: true
      });
      expect(refreshed).toMatchObject({
        skipped: false,
        sourceId: "source-a",
        fileCount: 2,
        indexedCount: 2,
        skippedCount: 0,
        failedCount: 0
      });

      const allCandidates = await indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "source-a" },
        groups: [{ terms: [" "] }]
      });
      expect(allCandidates).toMatchObject({
        available: true,
        candidateFileCount: 2,
        tokenCountByGroup: [0],
        reason: "indexed"
      });
      expect(allCandidates.files.map((entry) => path.basename(entry.file)).sort()).toEqual([
        "invoice.eml",
        "notes.txt"
      ]);

      await fs.rm(notesPath);
      const pruned = await indexKnowledgeSourceFiles({
        userDataPath,
        source,
        reason: "unit-test-prune",
        force: true
      });
      expect(pruned).toMatchObject({
        skipped: false,
        sourceId: "source-a",
        fileCount: 1,
        indexedCount: 1,
        skippedCount: 0,
        failedCount: 0
      });
      await expect(getIndexedSourceFileByEvidenceId({
        userDataPath,
        evidenceId: sourceEvidenceIdForPath(userDataPath, notesPath)
      })).resolves.toBeNull();

      await deleteKnowledgeSourceFileIndex({ userDataPath, sourceId: "source-a" });
      await expect(getSourceFileIndexRun({ userDataPath, sourceId: "source-a" })).resolves.toBeNull();
      await expect(indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "source-a" },
        groups: [{ terms: ["invoice"] }]
      })).resolves.toMatchObject({
        available: false,
        files: [],
        reason: "source_not_indexed"
      });
    });
  });

  it("reports missing index states before a source has been indexed", async () => {
    await withTempDir(async (root) => {
      const userDataPath = path.join(root, "user-data");

      await expect(indexedCandidateFilesForRoot({
        userDataPath,
        root: {},
        groups: []
      })).resolves.toMatchObject({
        available: false,
        files: [],
        candidateFileCount: 0,
        reason: "missing_source_id"
      });
      await expect(indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "source-a" },
        groups: []
      })).resolves.toMatchObject({
        available: false,
        files: [],
        candidateFileCount: 0,
        reason: "index_missing"
      });
      await expect(getIndexedSourceFileByEvidenceId({
        userDataPath,
        evidenceId: `${SOURCE_EVIDENCE_PREFIX}missing`
      })).resolves.toBeNull();
      await expect(getSourceFileIndexRun({
        userDataPath,
        sourceId: "source-a"
      })).resolves.toBeNull();
      await expect(deleteKnowledgeSourceFileIndex({
        userDataPath,
        sourceId: ""
      })).resolves.toBeUndefined();
    });
  });

  it("uses scan-root extensions when source extensions are not configured and records oversized files", async () => {
    await withTempDir(async (root) => {
      const userDataPath = path.join(root, "user-data");
      const sourceDir = path.join(root, "managed-source");
      const smallPath = path.join(sourceDir, "small.txt");
      const largePath = path.join(sourceDir, "large.txt");

      await writeText(smallPath, "small searchable text");
      await writeText(largePath, "x".repeat(2048));
      await writeSourceSearchRules(userDataPath, {
        maxFileBytes: 1024,
        knowledgeSourceExtensions: [],
        scanRoots: [
          {
            id: "fallback-root",
            label: "Fallback root",
            relativePath: "managed-source",
            extensions: ["txt"],
            enabled: true
          }
        ]
      });

      const result = await indexKnowledgeSourceFiles({
        userDataPath,
        source: {
          sourceId: "fallback-source",
          directoryPath: sourceDir,
          enabled: true,
          recursive: true
        },
        reason: "fallback-extensions",
        force: true
      });

      expect(result).toMatchObject({
        skipped: false,
        sourceId: "fallback-source",
        fileCount: 2,
        indexedCount: 1,
        skippedCount: 1,
        failedCount: 0
      });
      await expect(indexedCandidateFilesForRoot({
        userDataPath,
        root: { id: "fallback-source" },
        groups: [{ terms: ["small"] }]
      })).resolves.toMatchObject({
        available: true,
        candidateFileCount: 1,
        reason: "indexed"
      });
    });
  });

  it("skips disabled or incomplete source definitions without opening an index", async () => {
    await withTempDir(async (root) => {
      const userDataPath = path.join(root, "user-data");

      await expect(indexKnowledgeSourceFiles({
        userDataPath,
        source: { sourceId: "disabled", directoryPath: root, enabled: false }
      })).resolves.toMatchObject({
        skipped: true,
        reason: "not_indexable",
        sourceId: "disabled",
        fileCount: 0
      });

      await expect(indexKnowledgeSourceFiles({
        userDataPath,
        source: { sourceId: "", directoryPath: root, enabled: true }
      })).resolves.toMatchObject({
        skipped: true,
        reason: "not_indexable",
        sourceId: ""
      });
    });
  });
});
