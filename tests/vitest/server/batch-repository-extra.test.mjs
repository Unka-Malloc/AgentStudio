import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createBatchRepository } from "../../../server/platform/common/storage/batch-repository.mjs";
import {
  getMetadataDatabasePath,
  initializeMetadataSchema,
} from "../../../server/platform/common/storage/schema-manager.mjs";

const FIRST_GENERATED_AT = "2026-01-01T00:00:00.000Z";
const SECOND_GENERATED_AT = "2026-02-01T00:00:00.000Z";

async function withTempRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-extra-test-"));
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

function buildSource({ id, filePath, text, rawObject = null }) {
  return {
    id,
    name: `${id}.eml`,
    path: filePath,
    kind: "mail",
    rawObject,
    sourceCreatedAt: FIRST_GENERATED_AT,
    sourceUpdatedAt: FIRST_GENERATED_AT,
    sourceCollectedAt: FIRST_GENERATED_AT,
    sourceMetadata: {
      kind: "mail",
      sourceId: id
    },
    providerId: "provider-local",
    externalId: `${id}-external`,
    syncBatchId: `sync-${id}`,
    contentHash: rawObject?.contentHash || `content-${id}`,
    capturedAt: FIRST_GENERATED_AT,
    text,
    mediaType: "text/plain",
  };
}

describe("batch repository extra coverage", () => {
  it("updates an existing batch row when beginBatch is called again for the same batch id", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-upsert";

      repository.beginBatch({
        batchId,
        jobId: "job-initial",
        generatedAt: FIRST_GENERATED_AT,
        settings: { phase: "initial", dryRun: true },
      });

      const initial = repository.getBatch(batchId);
      expect(initial).toMatchObject({
        batch_id: batchId,
        job_id: "job-initial",
        generated_at: FIRST_GENERATED_AT,
      });

      repository.beginBatch({
        batchId,
        jobId: "job-updated",
        generatedAt: SECOND_GENERATED_AT,
        settings: { phase: "updated", dryRun: false },
      });

      const updated = repository.getBatch(batchId);
      expect(updated).toMatchObject({
        batch_id: batchId,
        job_id: "job-updated",
        status: "ingesting",
        generated_at: SECOND_GENERATED_AT,
      });
      expect(updated.created_at).toBe(initial.created_at);
      expect(JSON.parse(updated.settings_json)).toEqual({ phase: "updated", dryRun: false });
      expect(db.prepare("SELECT COUNT(*) AS count FROM import_batches WHERE batch_id = ?").get(batchId).count).toBe(1);
    });
  });

  it("falls back from failed corpus term searches and normalizes empty queries", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-search-fallback";
      repository.beginBatch({
        batchId,
        jobId: "job-search",
        generatedAt: FIRST_GENERATED_AT,
        settings: {},
      });
      repository.persistSources({
        batchId,
        sources: [
          buildSource({ id: "source-a", filePath: "mail/source-a.eml", text: "alpha alpha beta" }),
          buildSource({ id: "source-b", filePath: "mail/source-b.eml", text: "gamma delta" }),
        ],
        warnings: [],
      });

      expect(repository.searchSourceDocuments({ query: "   ", limit: 20 })).toEqual([]);
      expect(repository.searchSourceDocuments({ query: "a", limit: 20 })).toEqual([]);

      const matched = repository.listRawCorpusDocuments({ batchId, query: "alpha", limit: 5 });
      expect(matched).toHaveLength(1);
      expect(matched[0]).toMatchObject({
        batchId,
        sourceRef: "source-a",
        sourcePath: "mail/source-a.eml",
      });

      const fallback = repository.listRawCorpusDocuments({ batchId, query: "not-a-real-term", limit: 5 });
      expect(fallback).toHaveLength(2);
      expect(fallback.map((item) => item.sourceRef)).toEqual(["source-a", "source-b"]);

      const globalTerms = repository.listSourceCorpusRawTerms({
        limit: 10,
        minFrequency: 1,
      });
      expect(globalTerms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: "alpha" }),
          expect.objectContaining({ term: "beta" }),
          expect.objectContaining({ term: "gamma" }),
        ])
      );
    });
  });

  it("chunks term-stat lookups and zero-fills missing terms", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-term-stats";
      repository.beginBatch({
        batchId,
        jobId: "job-term-stats",
        generatedAt: FIRST_GENERATED_AT,
        settings: {},
      });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "source-a", filePath: "mail/source-a.eml", text: "alpha alpha beta" })],
        warnings: [],
      });

      const terms = Array.from({ length: 901 }, (_, index) => `missing-term-${index}`);
      const stats = repository.listSourceVocabularyTermStatsByTerms({ terms });

      expect(stats).toHaveLength(901);
      expect(stats[0]).toMatchObject({ term: "missing-term-0", frequency: 0, documentFrequency: 0, bm25Weight: 0 });
      expect(stats[900]).toMatchObject({ term: "missing-term-900", frequency: 0, documentFrequency: 0, bm25Weight: 0 });
    });
  });

  it("reuses an existing deletion operation for a batch and excludes completed work from the pending list", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-deletion-upsert";

      repository.beginBatch({
        batchId,
        jobId: "job-deletion",
        generatedAt: FIRST_GENERATED_AT,
        settings: {},
      });

      const created = repository.upsertDeletionOperation({
        batchId,
        jobId: "job-deletion",
        status: "running",
        state: { step: 1 },
        error: "",
      });

      expect(repository.getDeletionOperationByBatchId(batchId)).toMatchObject(created);
      expect(repository.getDeletionOperationByBatchId("missing-batch")).toBeNull();

      const updated = repository.upsertDeletionOperation({
        batchId,
        jobId: "job-deletion-retry",
        status: "completed",
        state: { step: 2, finished: true },
        error: "done",
      });

      expect(updated.operationId).toBe(created.operationId);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated).toMatchObject({
        batchId,
        jobId: "job-deletion-retry",
        status: "completed",
        state: { step: 2, finished: true },
        error: "done",
      });

      const pending = repository.listPendingDeletionOperations();
      expect(pending).toEqual([]);
    });
  });

  it("hydrates, updates, and removes deletion operations while handling missing ids", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-deletion-lifecycle";

      repository.beginBatch({
        batchId,
        jobId: "job-deletion",
        generatedAt: FIRST_GENERATED_AT,
        settings: {},
      });

      const created = repository.upsertDeletionOperation({
        batchId,
        jobId: "job-deletion",
        status: "running",
        state: { step: 1 },
        error: "",
      });

      expect(repository.updateDeletionOperation("missing-operation", {
        status: "retrying",
        state: { step: 99 },
        error: "missing",
      })).toBeNull();

      const updated = repository.updateDeletionOperation(created.operationId, {
        status: "retrying",
        state: { step: 2, retried: true },
        error: "again",
      });
      expect(updated).toMatchObject({
        batchId,
        status: "retrying",
        state: { step: 2, retried: true },
        error: "again",
      });
      expect(updated.createdAt).toBe(created.createdAt);

      repository.deleteDeletionOperation(created.operationId);
      expect(repository.getDeletionOperationByBatchId(batchId)).toBeNull();
      expect(repository.listPendingDeletionOperations()).toEqual([]);
    });
  });
});
