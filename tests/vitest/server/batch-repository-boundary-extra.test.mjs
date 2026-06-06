import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createBatchRepository } from "../../../server/platform/common/storage/batch-repository.mjs";
import {
  getMetadataDatabasePath,
  initializeMetadataSchema
} from "../../../server/platform/common/storage/schema-manager.mjs";

const FIXED_NOW = "2026-06-05T00:00:00.000Z";

async function withTempRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-boundary-extra-"));
  await fs.mkdir(path.join(root, "metadata"), { recursive: true });

  const db = new Database(getMetadataDatabasePath(root));
  initializeMetadataSchema(db);
  const repository = createBatchRepository({ db, userDataPath: root });

  try {
    return await testCase({ root, db, repository });
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

function buildSource({ id, filePath, text }) {
  return {
    id,
    name: `${id}.txt`,
    path: filePath,
    kind: "document",
    rawObject: null,
    providerId: "provider-boundary",
    externalId: `${id}-external`,
    syncBatchId: `sync-${id}`,
    contentHash: `content-${id}`,
    capturedAt: FIXED_NOW,
    sourceCreatedAt: FIXED_NOW,
    sourceUpdatedAt: FIXED_NOW,
    sourceCollectedAt: FIXED_NOW,
    sourceMetadata: { fixture: id },
    text,
    mediaType: "text/plain"
  };
}

describe("batch repository boundary extra coverage", () => {
  it("clamps path-scoped corpus terms and ignores duplicate corpus-path selectors", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-corpus-path-boundary";
      repository.beginBatch({ batchId, jobId: "job-corpus-path-boundary", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [
          buildSource({ id: "source-a", filePath: "docs/source-a.txt", text: "alpha alpha beta" }),
          buildSource({ id: "source-b", filePath: "docs/sub/source-b.txt", text: "beta gamma" }),
          buildSource({ id: "source-c", filePath: "other/source-c.txt", text: "theta" })
        ],
        warnings: []
      });

      const terms = repository.listSourceCorpusRawTerms({
        corpusPaths: [
          { path: "docs", type: "directory" },
          { path: "docs", type: "directory" },
          { path: "docs/source-a.txt", type: "file" },
          ""
        ],
        limit: 0,
        minFrequency: 1
      });

      expect(terms).toEqual([
        {
          term: "alpha",
          frequency: 2
        }
      ]);
    });
  });

  it("falls back to batch corpus documents for empty queries and clamps page size to one", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-corpus-doc-fallback";
      repository.beginBatch({ batchId, jobId: "job-corpus-doc-fallback", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [
          buildSource({ id: "source-a", filePath: "docs/source-a.txt", text: "alpha alpha beta" }),
          buildSource({ id: "source-b", filePath: "docs/source-b.txt", text: "beta gamma" }),
          buildSource({ id: "source-c", filePath: "docs/source-c.txt", text: "gamma delta" })
        ],
        warnings: []
      });

      const documents = repository.listRawCorpusDocuments({
        batchId,
        query: "",
        limit: -1
      });

      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({
        batchId,
        sourceRef: "source-a",
        sourcePath: "docs/source-a.txt",
        text: "alpha alpha beta"
      });
    });
  });

  it("rolls back source persistence when duplicate source ids violate storage constraints", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-source-rollback";
      repository.beginBatch({ batchId, jobId: "job-source-rollback", generatedAt: FIXED_NOW, settings: {} });

      const badSource = buildSource({
        id: "source-dup",
        filePath: "docs/source-dup.txt",
        text: "alpha"
      });

      expect(() =>
        repository.persistSources({
          batchId,
          sources: [badSource, { ...badSource, path: "docs/source-dup-2.txt" }],
          warnings: []
        })
      ).toThrow();

      expect(repository.getBatch(batchId)).toMatchObject({
        batch_id: batchId,
        status: "ingesting",
        source_count: 0,
        raw_object_count: 0
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_files WHERE batch_id = ?").get(batchId).count).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_document_profiles WHERE batch_id = ?").get(batchId).count).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_vocabulary_batches WHERE batch_id = ?").get(batchId).count).toBe(0);
    });
  });

  it("deduplicates and chunks vocabulary term-stat requests beyond the sqlite variable limit", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-term-stats-boundary";
      repository.beginBatch({ batchId, jobId: "job-term-stats-boundary", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [
          buildSource({ id: "source-a", filePath: "docs/source-a.txt", text: "alpha alpha beta" })
        ],
        warnings: []
      });

      const terms = ["ALPHA", "alpha", ...Array.from({ length: 900 }, (_, index) => `missing-term-${index}`)];
      const stats = repository.listSourceVocabularyTermStatsByTerms({ terms });

      expect(stats).toHaveLength(901);
      expect(stats[0]).toMatchObject({
        term: "alpha",
        frequency: 2,
        documentFrequency: 1
      });
      expect(stats[1]).toEqual({
        term: "missing-term-0",
        frequency: 0,
        documentFrequency: 0,
        bm25Weight: 0
      });
      expect(stats[900]).toEqual({
        term: "missing-term-899",
        frequency: 0,
        documentFrequency: 0,
        bm25Weight: 0
      });
    });
  });
});
