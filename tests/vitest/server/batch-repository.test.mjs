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

const FIXED_NOW = "2026-01-01T00:00:00.000Z";

async function withTempRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-test-"));
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

function buildRawObject(sourceId) {
  return {
    objectId: `obj-${sourceId}`,
    ingestOrigin: "unit-test",
    originalFileName: `${sourceId}.eml`,
    originalRelativePath: `mail/${sourceId}.eml`,
    clientUid: "client-local",
    sourceType: "mail",
    providerId: "provider-local",
    externalId: `${sourceId}-external`,
    syncBatchId: `sync-${sourceId}`,
    contentHash: `sha256-${sourceId}`,
    capturedAt: FIXED_NOW,
    sourceMetadata: { sourceId, nested: { stage: "unit" } },
    archiveFileName: `${sourceId}-archive.eml`,
    originalSourcePath: `/workspace/${sourceId}`,
    sourceContainerPath: `/container/${sourceId}`,
    storageRelativePath: `objects/${sourceId}.bin`,
    sha256: `sha-${sourceId}`,
    byteSize: 12,
    mediaType: "message/rfc822",
    sourceCreatedAt: FIXED_NOW,
    sourceUpdatedAt: FIXED_NOW,
    sourceCollectedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
  };
}

function buildSource({ id, filePath, text, rawObject = null }) {
  return {
    id,
    name: `${id}.eml`,
    path: filePath,
    kind: "mail",
    rawObject,
    sourceCreatedAt: FIXED_NOW,
    sourceUpdatedAt: FIXED_NOW,
    sourceCollectedAt: FIXED_NOW,
    sourceMetadata: {
      kind: "mail",
      sourceId: id,
      project: "pact",
    },
    providerId: "provider-local",
    externalId: `${id}-external`,
    syncBatchId: `sync-${id}`,
    contentHash: rawObject?.contentHash || `content-${id}`,
    capturedAt: FIXED_NOW,
    text,
    mediaType: "text/plain",
  };
}

describe("batch repository initialization", () => {
  it("initializes metadata, lifecycle flags, and artifact paths", async () => {
    await withTempRepository(async ({ root, repository }) => {
      const batchId = "batch-init";
      repository.beginBatch({ batchId, jobId: "job-init", generatedAt: FIXED_NOW, settings: { project: "pact", dryRun: true } });

      const batch = repository.getBatch(batchId);
      expect(batch).not.toBeNull();
      expect(batch).toMatchObject({
        batch_id: batchId,
        job_id: "job-init",
        status: "ingesting",
      });
      expect(repository.hasBatch(batchId)).toBe(true);
      expect(repository.getBatchArtifactPaths(batchId)).toEqual({
        batchId,
        objectRootPath: path.join(root, "objects"),
      });
      expect(repository.objectRootPath).toBe(path.join(root, "objects"));
    });
  });
});

describe("batch write/read and list flows", () => {
  it("persists sources/raw objects, restores metadata, and exposes searchable corpus entries", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-read-write";
      repository.beginBatch({ batchId, jobId: "job-read-write", generatedAt: FIXED_NOW, settings: { scope: "read-write" } });

      const sourceWithObject = buildSource({
        id: "source-a",
        filePath: "inbox/source-a.eml",
        text: "alpha alpha beta",
        rawObject: buildRawObject("source-a")
      });
      const sourceWithoutObject = buildSource({
        id: "source-b",
        filePath: "inbox/source-b.eml",
        text: "",
        rawObject: null
      });

      repository.persistSources({
        batchId,
        sources: [sourceWithObject, sourceWithoutObject],
        warnings: [
          { code: "source.warning", detail: "ok" }
        ]
      });

      const batch = repository.getBatch(batchId);
      expect(batch).toMatchObject({
        status: "analyzing",
        source_count: 2,
        raw_object_count: 1,
      });
      expect(repository.hasBatch(batchId)).toBe(true);

      const artifactPaths = repository.listRawObjectStoragePathsByBatch(batchId);
      expect(artifactPaths).toEqual(["objects/source-a.bin"]);

      const storedObject = repository.getRawMailObject("obj-source-a");
      expect(storedObject).toMatchObject({
        object_id: "obj-source-a",
        source_ref: "source-a",
        sha256: "sha-source-a",
        source_metadata_json: JSON.stringify({ sourceId: "source-a", nested: { stage: "unit" } })
      });

      const corpus = repository.listRawCorpusDocuments({ batchId });
      expect(corpus).toEqual([
        expect.objectContaining({
          batchId,
          sourceRef: "source-a",
          sourcePath: "inbox/source-a.eml",
          sourceMetadata: { kind: "mail", sourceId: "source-a", project: "pact" },
          rawObject: expect.objectContaining({
            objectId: "obj-source-a",
            storageRelativePath: "objects/source-a.bin"
          })
        })
      ]);

      const search = repository.searchSourceDocuments({ query: "alpha", limit: 5 });
      expect(search).toEqual([
        expect.objectContaining({
          batchId,
          sourceRef: "source-a",
          sourcePath: "inbox/source-a.eml"
        })
      ]);

      const listTerms = repository.listSourceCorpusRawTerms({ limit: 10, minFrequency: 1 });
      expect(listTerms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: "alpha", frequency: 2 }),
          expect.objectContaining({ term: "beta", frequency: 1 }),
        ])
      );

      expect(repository.searchSourceDocuments({ query: "..", limit: 3 })).toEqual([]);
    });
  });

  it("filters vocabulary sources by path and tolerates traversal-like corpus paths", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-filter";
      repository.beginBatch({ batchId, jobId: "job-filter", generatedAt: FIXED_NOW, settings: {} });

      const included = buildSource({
        id: "source-c",
        filePath: "projects/allowed/corpus-a.txt",
        text: "alpha delta",
        rawObject: buildRawObject("source-c")
      });
      const excluded = buildSource({
        id: "source-d",
        filePath: "projects/external/corpus-b.txt",
        text: "beta",
        rawObject: buildRawObject("source-d")
      });
      repository.persistSources({ batchId, sources: [included, excluded], warnings: [] });

      const directoryMatch = repository.listSourceCorpusRawTerms({
        corpusPaths: [{ path: "projects/allowed", type: "directory" }],
        limit: 20,
        minFrequency: 1,
      });
      expect(directoryMatch).toEqual(expect.arrayContaining([
        expect.objectContaining({ term: "alpha" }),
        expect.objectContaining({ term: "delta" }),
      ]));
      expect(directoryMatch).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ term: "beta" }),
      ]));

      const fileMatch = repository.listSourceCorpusRawTerms({
        corpusPaths: [{ path: "projects/allowed/corpus-a.txt", type: "file" }],
        limit: 10,
        minFrequency: 1,
      });
      expect(fileMatch.some((entry) => entry.term === "alpha")).toBe(true);
      expect(fileMatch.some((entry) => entry.term === "beta")).toBe(false);

      const outsideMatch = repository.listSourceCorpusRawTerms({
        corpusPaths: [{ path: "../outside", type: "directory" }],
        limit: 10,
        minFrequency: 1,
      });
      expect(outsideMatch).toEqual([]);

      db.prepare("UPDATE source_files SET source_metadata_json = ? WHERE source_ref = ?").run("{broken", "source-c");
      const fallbackMetadata = repository.listRawCorpusDocuments({ batchId, query: "alpha" });
      expect(fallbackMetadata[0].sourceMetadata).toEqual({});
    });
  });

  it("computes scoped vocabulary stats and significant terms", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchA = "batch-significant-a";
      repository.beginBatch({ batchId: batchA, jobId: "job-a", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId: batchA,
        sources: [buildSource({ id: "a-source", filePath: "alpha/a.txt", text: "alpha alpha alpha" })],
        warnings: []
      });

      const batchB = "batch-significant-b";
      repository.beginBatch({ batchId: batchB, jobId: "job-b", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId: batchB,
        sources: [buildSource({ id: "b-source", filePath: "beta/b.txt", text: "beta gamma" })],
        warnings: []
      });

      const scoped = repository.getSignificantSourceTerms({
        batchId: batchA,
        limit: 10,
        minForegroundDocumentFrequency: 1,
        minForegroundFiles: 5,
      });
      expect(scoped.ok).toBe(true);
      expect(scoped.terms.map((entry) => entry.term)).toContain("alpha");

      const missingScope = repository.getSignificantSourceTerms({
        limit: 10,
        minForegroundDocumentFrequency: 1,
      });
      expect(missingScope).toMatchObject({ ok: false, error: "scope_required" });

      const termStats = repository.listSourceVocabularyTermStatsByTerms({ terms: ["alpha", "missing-term"] });
      expect(termStats).toEqual([
        expect.objectContaining({ term: "alpha" }),
        expect.objectContaining({ term: "missing-term", frequency: 0, documentFrequency: 0, bm25Weight: 0 }),
      ]);
    });
  });
});

describe("error recovery", () => {
  it("rolls back analysis transaction when post-persist hook fails", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-analysis-failure";
      repository.beginBatch({ batchId, jobId: "job-failed-analysis", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({ batchId, sources: [], warnings: [] });

      expect(() =>
        repository.persistAnalysis({
          batchId,
          result: {
            people: [],
            emails: [],
            threads: [],
            transactions: [],
            timeline: [],
            retrieval: { items: [] },
            overview: { sourceCount: 0 },
          },
          warnings: [{ code: "phase" }],
          rules: {},
          afterCorePersist: () => {
            throw new Error("analysis hook failed");
          }
        })
      ).toThrow("analysis hook failed");

      const batch = repository.getBatch(batchId);
      expect(batch.status).toBe("analyzing");
      expect(batch.error).toBe("");

      const counts = db.prepare("SELECT COUNT(*) AS count FROM email_messages WHERE batch_id = ?").get(batchId);
      expect(counts.count).toBe(0);
    });
  });

  it("restores malformed JSON in deletion operation state during hydration", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-deletion-json";
      repository.beginBatch({ batchId, jobId: "job-del", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({ batchId, sources: [], warnings: [] });

      const created = repository.upsertDeletionOperation({
        batchId,
        jobId: "job-del",
        status: "running",
        state: { step: 1 },
        error: ""
      });

      db.prepare("UPDATE batch_deletion_operations SET state_json = ? WHERE operation_id = ?").run("{broken", created.operationId);
      const hydrated = repository.getDeletionOperationByBatchId(batchId);
      expect(hydrated).toMatchObject({
        batchId,
        status: "running",
        state: {}
      });

      const pending = repository.listPendingDeletionOperations();
      expect(pending.some((item) => item.operationId === created.operationId)).toBe(true);

      const updated = repository.updateDeletionOperation(created.operationId, {
        status: "retrying",
        state: { step: 2 },
        error: "again"
      });
      expect(updated.status).toBe("retrying");
      expect(updated.state).toEqual({ step: 2 });
    });
  });
});

describe("word cloud set lifecycle and JSON compatibility", () => {
  it("persists, exports, imports, and recovers malformed snapshot rows", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const saved = await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: "cloud-set-1",
          title: "词袋集合",
          status: "draft",
          wordBags: [
            {
              wordBagId: "topic-news",
              label: "新闻",
              terms: [{ term: "alpha", frequency: 2 }, { term: "beta", frequency: 1 }]
            }
          ]
        },
        limit: 50,
      });
      expect(saved).toMatchObject({ ok: true, wordBagSet: { wordBagSetId: "cloud-set-1" } });

      const added = await repository.addKnowledgeWordBag({
        wordBagSetId: "cloud-set-1",
        parentWordBagId: "topic-news",
        wordBag: {
          wordBagId: "topic-news-sub",
          label: "新闻子类",
          terms: [{ term: "gamma", frequency: 3 }],
        }
      });
      expect(added).toMatchObject({ ok: true, action: "added" });

      const updated = await repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-set-1",
        wordBagId: added.wordBag.wordBagId,
        patch: { summary: "更新后摘要" }
      });
      expect(updated).toMatchObject({ ok: true, action: "updated", wordBag: { wordBagId: added.wordBag.wordBagId, summary: "更新后摘要" } });

      const terms = await repository.getKnowledgeWordBagTerms({
        wordBagSetId: "cloud-set-1",
        wordBagIds: [added.wordBag.wordBagId, "topic-news"]
      });
      expect(terms).toMatchObject({
        ok: true,
        missingWordBagIds: [],
      });
      expect(terms.groups).toHaveLength(2);
      expect(terms.terms.map((item) => item.term)).toEqual(expect.arrayContaining(["alpha", "gamma"]));

      const exported = await repository.exportKnowledgeWordCloudSet({ wordBagSetId: "cloud-set-1" });
      expect(exported).toMatchObject({ ok: true, exportType: "pact.knowledge.word_bags.export", wordBagSet: { wordBagSetId: "cloud-set-1" } });

      const imported = await repository.importKnowledgeWordCloudSet(exported);
      expect(imported).toMatchObject({ ok: true, action: "imported", mode: "copy" });
      expect(imported.wordBagSet.wordBagSetId).not.toBe("cloud-set-1");

      const deleted = await repository.deleteKnowledgeWordBag({
        wordBagSetId: "cloud-set-1",
        wordBagId: added.wordBag.wordBagId
      });
      expect(deleted).toMatchObject({ ok: true, action: "deleted", deletedWordBagId: added.wordBag.wordBagId });

      await expect(repository.importKnowledgeWordCloudSet("not-json")).rejects.toThrow("导入文件不是有效 JSON。");

      db.prepare(
        "UPDATE knowledge_word_cloud_sets SET terms_snapshot_json = ?, clouds_json = ?, unassigned_terms_json = ?, corpus_paths_json = ?, agent_response_json = ? WHERE cloud_set_id = ?"
      ).run(
        "{not-json",
        "{not-json",
        "{not-json",
        "{not-json",
        "{",
        saved.wordBagSet.wordBagSetId
      );

      const fallbackState = await repository.getKnowledgeWordCloudState({ wordBagSetId: saved.wordBagSet.wordBagSetId });
      expect(fallbackState.wordBagSet.wordBagSetId).toBe(saved.wordBagSet.wordBagSetId);
      expect(fallbackState.wordBagSet.wordBags.map((bag) => bag.wordBagId)).toEqual(expect.arrayContaining(["default", "other"]));

      await expect(repository.getKnowledgeWordBagTerms({ wordBagSetId: "cloud-set-1" })).rejects.toThrow("缺少 wordBagId 或 wordBagIds。");
    });
  });
});

describe("repository lifecycle and recovery edges", () => {
  it("falls back to batch listing when raw corpus text search misses", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-fts-fallback";
      repository.beginBatch({ batchId, jobId: "job-fallback", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "fallback-source", filePath: "fallback/doc.txt", text: "searchable terms" })],
        warnings: [],
      });

      const listed = repository.listRawCorpusDocuments({ batchId, query: "not-a-real-term", limit: 5 });
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        batchId,
        sourceRef: "fallback-source",
        sourcePath: "fallback/doc.txt",
      });
    });
  });

  it("filters corpus terms against raw object paths and rejects non-project traversal paths", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-path-filter";
      repository.beginBatch({ batchId, jobId: "job-path-filter", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({
          id: "path-source",
          filePath: "mail/path.txt",
          text: "beta gamma",
          rawObject: {
            ...buildRawObject("path-source"),
            originalSourcePath: "/workspace/projects/safe/path-source.eml",
            originalRelativePath: "mail/path.txt",
          },
        })],
        warnings: [],
      });

      const filtered = repository.listSourceCorpusRawTerms({
        corpusPaths: [{ path: "/workspace/projects", type: "directory" }],
        limit: 20,
        minFrequency: 1,
      });
      expect(filtered.some((entry) => entry.term === "beta")).toBe(true);

      expect(
        repository.listSourceCorpusRawTerms({
          corpusPaths: [{ path: "/var/forbidden", type: "directory" }],
          limit: 20,
          minFrequency: 1,
        })
      ).toEqual([]);
    });
  });

  it("updates batch statuses and records failure state explicitly", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-status";
      repository.beginBatch({ batchId, jobId: "job-status", generatedAt: FIXED_NOW, settings: {} });
      repository.updateBatchStatus(batchId, "queued", "pending");
      expect(repository.getBatch(batchId).status).toBe("queued");

      repository.markBatchFailed(batchId, "forced failure");
      const failed = repository.getBatch(batchId);
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("forced failure");
    });
  });

  it("deletes batch data tables without dropping batch metadata, then deletes batch row", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-delete-records";
      repository.beginBatch({ batchId, jobId: "job-delete-records", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "source-delete", filePath: "delete/source-delete.txt", text: "one two three" })],
        warnings: [],
      });

      expect(repository.getStorageSummary().sourceCount).toBeGreaterThan(0);
      expect(repository.getStorageSummary().sourceCorpusRawTermCount).toBeGreaterThan(0);
      expect(repository.getStorageSummary().sourceVocabularyTermCount).toBeGreaterThan(0);
      expect(repository.hasBatch(batchId)).toBe(true);

      repository.deleteBatchRecords(batchId);

      expect(repository.getStorageSummary().sourceCount).toBe(0);
      expect(repository.getStorageSummary().sourceCorpusRawTermCount).toBe(0);
      expect(repository.getStorageSummary().sourceVocabularyTermCount).toBe(0);
      expect(repository.getStorageSummary().sourceDocumentProfileCount).toBe(0);
      expect(repository.getStorageSummary().preprocessBlockCount).toBe(0);
      expect(repository.getStorageSummary().preprocessChunkCount).toBe(0);
      expect(repository.hasBatch(batchId)).toBe(true);

      const sourceCountByBatch = db
        .prepare("SELECT COUNT(*) AS count FROM source_files WHERE batch_id = ?")
        .get(batchId).count;
      const objectCountByBatch = db
        .prepare("SELECT COUNT(*) AS count FROM raw_mail_objects WHERE batch_id = ?")
        .get(batchId).count;
      const profileCountByBatch = db
        .prepare("SELECT COUNT(*) AS count FROM source_document_profiles WHERE batch_id = ?")
        .get(batchId).count;
      expect([sourceCountByBatch, objectCountByBatch, profileCountByBatch]).toEqual([0, 0, 0]);

      repository.deleteBatchRow(batchId);
      expect(repository.hasBatch(batchId)).toBe(false);
    });
  });

  it("persists preprocess blocks/chunks and completes analysis when no post-hook error", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-analysis-success";
      repository.beginBatch({ batchId, jobId: "job-analysis-success", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "source-1", filePath: "analysis/source-1.txt", text: "x" })],
        warnings: [],
      });

      repository.persistPreprocessResult({
        batchId,
        preprocessResult: {
          blocks: [
            {
              id: "block-1",
              sourceId: "source-1",
              kind: "paragraph",
              level: 1,
              text: "第一段",
              metadata: { sourceName: "analysis/source-1.txt" },
            }
          ],
          chunks: [
            {
              id: "chunk-1",
              sourceId: "source-1",
              title: "块一",
              titlePath: ["analysis", "source-1"],
              blockIds: ["block-1"],
              chunkType: "paragraph",
              content: "块内容",
              tokenCount: 6,
              metadata: { sourceName: "analysis/source-1.txt" },
            }
          ],
        }
      });

      const blockCount = db.prepare("SELECT COUNT(*) AS count FROM preprocess_blocks WHERE batch_id = ?").get(batchId).count;
      const chunkCount = db.prepare("SELECT COUNT(*) AS count FROM preprocess_chunks WHERE batch_id = ?").get(batchId).count;
      expect(blockCount).toBe(1);
      expect(chunkCount).toBe(1);

      repository.persistAnalysis({
        batchId,
        result: {
          people: [],
          emails: [],
          threads: [],
          transactions: [],
          timeline: [
            {
              id: "timeline-1",
              timestamp: FIXED_NOW,
              title: "timeline event",
              summary: "timeline summary",
              type: "event",
              source: "analysis/source.txt",
              messageId: "msg-1",
              threadId: "thr-1",
              transactionId: "tx-1",
              timelinePhase: "current",
              originBatchId: batchId,
              originTransactionId: "tx-1",
              participantIds: ["p-1"],
              timeWeight: 1,
              freshness: 0.4
            },
          ],
          retrieval: { items: [] },
          overview: { sourceCount: 1 },
        },
        warnings: [],
        rules: {},
      });

      const batch = repository.getBatch(batchId);
      expect(batch.status).toBe("completed");
      expect(JSON.parse(batch.overview_json)).toMatchObject({ sourceCount: 1 });
    });
  });

  it("persists retrieval results for all entity types during analysis", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-analysis-retrieval";
      repository.beginBatch({ batchId, jobId: "job-analysis-retrieval", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "src-1", filePath: "analysis/source.txt", text: "base text", rawObject: buildRawObject("src-1") })],
        warnings: [],
      });

      repository.persistAnalysis({
        batchId,
        result: {
          sourceFiles: [{ id: "src-1", rawObjectId: "obj-src-1" }],
          people: [
            {
              id: "p-1",
              name: "Test Person",
              primaryEmail: "p@example.com",
              aliases: ["Alias One"],
              organization: "PACT",
              primaryDepartment: "R&D",
              departments: ["R&D"],
              relation: "author",
              role: "lead",
              sentCount: 0,
              receivedCount: 0,
              ccCount: 0,
              bccCount: 0,
              transactionCount: 0,
              firstSeenAt: FIXED_NOW,
              lastSeenAt: FIXED_NOW,
              topTopics: ["topic"],
              topCounterparties: ["peer"],
              summary: "person summary",
              timeWeight: 1,
              freshness: 0.5,
              formalUseAllowed: true,
            },
          ],
          emails: [
            {
              id: "msg-1",
              sourceId: "src-1",
              rawObjectId: "obj-src-1",
              subject: "Message Subject",
              normalizedSubject: "message subject",
              sentAt: FIXED_NOW,
              excerpt: "excerpt",
              body: "body",
              keywords: ["kw-message"],
              chunkIds: [],
              messageIdHeader: "msg-header",
              inReplyTo: "",
              references: [],
              previousMessageIds: [],
              conversationKey: "",
              threadId: "thr-1",
              transactionId: "tx-1",
              participantIds: ["p-1"],
              timeWeight: 1,
              freshness: 0.5,
              status: "ok",
              formalUseAllowed: true,
              from: { id: "p-1" },
              to: [{ id: "p-2" }],
              cc: [],
              bcc: [],
            },
          ],
          threads: [
            {
              id: "thr-1",
              subject: "Thread Subject",
              normalizedSubject: "thread subject",
              summary: "thread summary",
              messageIds: ["msg-1"],
              participantIds: ["p-1"],
              senderIds: ["p-1"],
              startedAt: FIXED_NOW,
              latestActivityAt: FIXED_NOW,
              keywords: ["kw-thread"],
              status: "open",
              cadence: "daily",
              categories: ["cat-a"],
              pendingSignals: [],
              transactionId: "tx-1",
              timeWeight: 1,
              freshness: 0.5,
              formalUseAllowed: true,
            },
          ],
          transactions: [
            {
              id: "tx-1",
              title: "Transaction",
              normalizedSubject: "transaction",
              summary: "tx summary",
              status: "active",
              startedAt: FIXED_NOW,
              latestActivityAt: FIXED_NOW,
              threadIds: ["thr-1"],
              messageIds: ["msg-1"],
              participantIds: ["p-1"],
              timelineEventIds: [],
              keywords: ["kw-tx"],
              decisions: [],
              pendingItems: [],
              cadence: "weekly",
              categories: ["cat-b"],
              sourceDepartments: ["dept-a"],
              lifecycle: {
                stage: "inbox",
                previousState: "",
                nextState: "",
                matchScore: 0.8,
                matchReasons: ["matched"],
                matchedBatchId: batchId,
                matchedTransactionId: "other-tx",
                pulledEventCount: 1,
                pulledBatchCount: 1,
                pulledTransactionCount: 1,
              },
              sourceSpread: "wide",
              timeWeight: 1,
              freshness: 0.3,
              formalUseAllowed: true,
            },
          ],
          timeline: [],
          retrieval: {
            items: [
              {
                id: "retrieval::message::msg-1",
                entityType: "message",
                title: "Message result",
                text: "message result text",
                snippet: "m snippet",
                timestamp: FIXED_NOW,
                source: "analysis/source.txt",
                keywords: ["kw-message"],
                participantIds: ["p-1"],
                transactionId: "tx-1",
                threadId: "thr-1",
                timeWeight: 1,
                freshness: 0.5,
                status: "ok",
                formalUseAllowed: true,
              },
              {
                id: "retrieval::thread::thr-1",
                entityType: "thread",
                title: "Thread result",
                text: "thread result text",
                snippet: "t snippet",
                timestamp: FIXED_NOW,
                source: "analysis/source.txt",
                keywords: ["kw-thread"],
                participantIds: ["p-1"],
                transactionId: "tx-1",
                threadId: "thr-1",
                timeWeight: 1,
                freshness: 0.5,
                status: "ok",
                formalUseAllowed: true,
              },
              {
                id: "retrieval::transaction::tx-1",
                entityType: "transaction",
                title: "Transaction result",
                text: "transaction result text",
                snippet: "tx snippet",
                timestamp: FIXED_NOW,
                source: "analysis/source.txt",
                keywords: ["kw-tx"],
                participantIds: ["p-1"],
                transactionId: "tx-1",
                threadId: "thr-1",
                timeWeight: 1,
                freshness: 0.5,
                status: "ok",
                formalUseAllowed: true,
              },
              {
                id: "retrieval::person::p-1",
                entityType: "person",
                title: "Person result",
                text: "person result text",
                snippet: "p snippet",
                timestamp: FIXED_NOW,
                source: "analysis/source.txt",
                keywords: ["kw-person"],
                participantIds: ["p-1"],
                transactionId: "tx-1",
                threadId: "thr-1",
                timeWeight: 1,
                freshness: 0.5,
                status: "ok",
                formalUseAllowed: true,
              },
            ],
          },
          overview: { sourceCount: 1 },
        },
        warnings: [],
        rules: {},
      });

      const retrievalCount = db.prepare("SELECT COUNT(*) AS count FROM retrieval_documents WHERE batch_id = ?").get(batchId).count;
      expect(retrievalCount).toBe(4);
      const batch = repository.getBatch(batchId);
      expect(batch.status).toBe("completed");
    });
  });

  it("exposes storage summary after repository operations", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-summary";
      repository.beginBatch({ batchId, jobId: "job-summary", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "summary-source", filePath: "summary/source.txt", text: "alpha" })],
        warnings: [],
      });

      const summary = repository.getStorageSummary();
      expect(summary.sourceCount).toBe(1);
      expect(summary.sourceCorpusRawTermCount).toBeGreaterThan(0);
      expect(summary.sourceVocabularyTermCount).toBeGreaterThan(0);
    });
  });

  it("deletes a pending deletion operation by operation id", async () => {
    await withTempRepository(async ({ repository }) => {
      const created = repository.upsertDeletionOperation({
        batchId: "batch-delete-operation",
        jobId: "job-delete-operation",
        status: "running",
        state: { stage: "queued" },
      });

      const before = repository.listPendingDeletionOperations();
      expect(before.some((item) => item.operationId === created.operationId)).toBe(true);

      repository.deleteDeletionOperation(created.operationId);

      const after = repository.listPendingDeletionOperations();
      expect(after.some((item) => item.operationId === created.operationId)).toBe(false);
    });
  });

  it("rejects word-cloud import payload when type mismatches", async () => {
    await withTempRepository(async ({ repository }) => {
      await expect(
        repository.importKnowledgeWordCloudSet({ exportType: "pact.invalid", wordBagSet: {} })
      ).rejects.toThrow("导入文件类型不匹配。");
    });
  });

  it("rebuilds source vocabulary through repository API", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-rebuild-vocabulary";
      repository.beginBatch({ batchId, jobId: "job-rebuild", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "source-rebuild", filePath: "vocabulary/source.txt", text: "alpha alpha beta" })],
        warnings: [],
      });

      const result = repository.rebuildSourceVocabulary();
      expect(result).toMatchObject({
        ok: true,
        rebuiltBatchCount: 1,
        scannedSourceCount: 1,
      });
      expect(result.sourceVocabularyTermCount).toBeGreaterThan(0);
    });
  });

  it("rolls back preprocess persistence when insert payload is not JSON-serializable", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-preprocess-fail";
      repository.beginBatch({ batchId, jobId: "job-preprocess-fail", generatedAt: FIXED_NOW, settings: {} });

      const circular = [];
      circular.push(circular);
      expect(() =>
        repository.persistPreprocessResult({
          batchId,
          preprocessResult: {
            blocks: [
              {
                id: "valid-block",
                sourceId: "source-preprocess",
                kind: "paragraph",
                level: 1,
                text: "block text",
              },
            ],
            chunks: [
              {
                id: "valid-chunk",
                sourceId: "source-preprocess",
                title: "chunk",
                chunkType: "paragraph",
                content: "chunk text",
                blockIds: circular,
                tokenCount: 2,
                position: 1,
              },
            ],
          },
        })
      ).toThrow(TypeError);

      expect(db.prepare("SELECT COUNT(*) AS count FROM preprocess_chunks WHERE batch_id = ?").get(batchId).count).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM preprocess_blocks WHERE batch_id = ?").get(batchId).count).toBe(0);
    });
  });

  it("skips preprocess blocks with empty ids while still persisting chunks", async () => {
    await withTempRepository(async ({ repository, db }) => {
      const batchId = "batch-preprocess-filter";
      repository.beginBatch({ batchId, jobId: "job-preprocess-filter", generatedAt: FIXED_NOW, settings: {} });

      repository.persistPreprocessResult({
        batchId,
        preprocessResult: {
          blocks: [{ id: "", sourceId: "source-1", kind: "paragraph", level: 1, text: "skip me" }],
          chunks: [
            {
              id: "chunk-filter",
              sourceId: "source-1",
              title: "filtered chunk",
              chunkType: "paragraph",
              content: "chunk text",
              blockIds: [],
              tokenCount: 3,
              position: 1,
            },
            {
              id: "",
              sourceId: "source-1",
              title: "skip chunk",
              chunkType: "paragraph",
              content: "skip text",
              blockIds: [],
              tokenCount: 1,
              position: 2,
            },
          ],
        },
      });

      expect(db.prepare("SELECT COUNT(*) AS count FROM preprocess_blocks WHERE batch_id = ?").get(batchId).count).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM preprocess_chunks WHERE batch_id = ?").get(batchId).count).toBe(1);
    });
  });

  it("rolls back source persistence on JSON serialization failures", async () => {
    await withTempRepository(async ({ repository }) => {
      const batchId = "batch-persist-sources-fail";
      repository.beginBatch({ batchId, jobId: "job-persist-sources-fail", generatedAt: FIXED_NOW, settings: {} });

      const selfRef = {};
      selfRef.loop = selfRef;
      const badSource = buildSource({ id: "self-ref-source", filePath: "bad/source.txt", text: "bad" });
      badSource.sourceMetadata = selfRef;
      expect(() =>
        repository.persistSources({
          batchId,
          sources: [badSource],
          warnings: [],
        })
      ).toThrow(TypeError);
    });
  });
});
