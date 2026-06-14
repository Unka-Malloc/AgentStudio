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

const FIXED_NOW = "2026-06-04T00:00:00.000Z";

async function withTempRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-final-"));
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

function buildSource({ id, text, pathName = `${id}.txt`, rawObject = null }) {
  return {
    id,
    name: `${id}.txt`,
    path: pathName,
    kind: "document",
    rawObject,
    providerId: "provider-final",
    externalId: `${id}-external`,
    syncBatchId: "sync-final",
    contentHash: rawObject?.contentHash || `content-${id}`,
    capturedAt: FIXED_NOW,
    sourceCreatedAt: FIXED_NOW,
    sourceUpdatedAt: FIXED_NOW,
    sourceCollectedAt: FIXED_NOW,
    sourceMetadata: { fixture: id },
    text,
    mediaType: "text/plain"
  };
}

async function createSourceFileIndex(root, { malformed = false } = {}) {
  const indexRoot = path.join(root, "source-file-index");
  await fs.mkdir(indexRoot, { recursive: true });
  const indexPath = path.join(indexRoot, "source-files.sqlite");
  await fs.rm(indexPath, { force: true });
  const indexDb = new Database(indexPath);
  try {
    if (malformed) {
      indexDb.exec("CREATE TABLE unrelated (id TEXT)");
      return;
    }
    indexDb.exec(`
      CREATE TABLE source_file_index_files (
        file_id TEXT,
        source_id TEXT,
        content_hash TEXT,
        readable_preview TEXT,
        status TEXT
      );
      CREATE TABLE source_file_index_terms (
        file_id TEXT,
        term TEXT,
        count INTEGER
      );
    `);
    const insertFile = indexDb.prepare(`
      INSERT INTO source_file_index_files (file_id, source_id, content_hash, readable_preview, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertFile.run("", "source-empty-id", "hash-empty-id", "ignored", "indexed");
    insertFile.run("file-empty-key", "source-empty-key", "", "", "indexed");
    insertFile.run("file-a", "source-a", "HASH-A", "alpha beta", "indexed");
    insertFile.run("file-a-duplicate", "source-b", "HASH-A", "duplicate beta", "indexed");
    insertFile.run("file-text-key", "source-c", "", "fallback text key", "indexed");
    insertFile.run("file-pending", "source-d", "HASH-D", "pending ignored", "pending");

    const insertTerm = indexDb.prepare("INSERT INTO source_file_index_terms (file_id, term, count) VALUES (?, ?, ?)");
    insertTerm.run("unknown-file", "orphan", 3);
    insertTerm.run("file-a", "", 3);
    insertTerm.run("file-a", "x".repeat(129), 3);
    insertTerm.run("file-a", "zero", 0);
    insertTerm.run("file-a", "alpha", 5);
    insertTerm.run("file-a", "beta", 2);
    insertTerm.run("file-a-duplicate", "duplicate", 9);
    insertTerm.run("file-text-key", "fallback", 4);
  } finally {
    indexDb.close();
  }
}

async function expectWordCloudError(promise, { message, statusCode, code }) {
  await expect(promise).rejects.toMatchObject({ message, statusCode, code });
}

describe("batch repository final coverage", () => {
  it("backfills a legacy word-cloud snapshot into JSONL files during repository init", async () => {
    await withTempRepository(async ({ root, db }) => {
      const wordBagSetId = "legacy-migration-set";
      db.prepare(`
        INSERT INTO knowledge_word_cloud_sets (
          cloud_set_id, title, status, cloud_count, terms_snapshot_json, clouds_json,
          unassigned_terms_json, corpus_paths_json, model_alias, agent_response_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        wordBagSetId,
        "Legacy Migration",
        "draft",
        1,
        JSON.stringify([
          { term: "alpha", frequency: 4 },
          { term: "beta", frequency: 2 }
        ]),
        JSON.stringify([
          {
            wordBagId: "topic-root",
            label: "Topic Root",
            terms: [{ term: "alpha", frequency: 4 }],
            children: [
              {
                wordBagId: "topic-child",
                label: "Topic Child",
                terms: [{ term: "beta", frequency: 2 }]
              }
            ]
          }
        ]),
        "[]",
        "[]",
        "",
        "{}",
        FIXED_NOW,
        FIXED_NOW
      );

      const repository = createBatchRepository({ db, userDataPath: root });
      const manifestPath = path.join(root, "knowledge-word-clouds", wordBagSetId, "manifest.jsonl");
      const manifest = await fs.readFile(manifestPath, "utf8");

      expect(manifest).toContain('"recordType":"wordBagSet"');
      expect(manifest).toContain('"recordType":"wordBagIndex"');
      expect(manifest).toContain('"file":');

      const state = await repository.getKnowledgeWordCloudState({ wordBagSetId });
      expect(state.wordBagSet).toMatchObject({
        wordBagSetId,
        title: "Legacy Migration"
      });
      expect(state.wordBagSet.wordBags.map((wordBag) => wordBag.wordBagId)).toEqual([
        "topic-root",
        "default",
        "other"
      ]);
      expect(state.wordBagSet.wordBags[0].children).toEqual([
        expect.objectContaining({ wordBagId: "topic-child" })
      ]);
    });
  });

  it("falls back to the stored snapshot when a JSONL word-bag file becomes corrupted", async () => {
    await withTempRepository(async ({ root, repository }) => {
      const wordBagSetId = "corrupt-jsonl-set";
      await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId,
          title: "Corrupt JSONL",
          termsSnapshot: [
            { term: "alpha", frequency: 3 },
            { term: "beta", frequency: 1 }
          ],
          wordBags: [
            {
              wordBagId: "topic-root",
              label: "Topic Root",
              terms: [{ term: "alpha", frequency: 3 }],
              children: [
                {
                  wordBagId: "topic-child",
                  label: "Topic Child",
                  terms: [{ term: "beta", frequency: 1 }]
                }
              ]
            }
          ]
        }
      });

      const bagDirectory = path.join(root, "knowledge-word-clouds", wordBagSetId, "word-bags");
      const bagFile = (await fs.readdir(bagDirectory)).map((name) => path.join(bagDirectory, name))
        .find((filePath) => path.basename(filePath).startsWith("topic-root-"));
      expect(bagFile).toBeTruthy();
      await fs.writeFile(bagFile, "{not-json}\n", "utf8");

      const state = await repository.getKnowledgeWordCloudState({ wordBagSetId });
      expect(state.wordBagSet.termsSnapshot).toEqual([
        { term: "alpha", frequency: 3, weight: 0, quality: "", removed: false },
        { term: "beta", frequency: 1, weight: 0, quality: "", removed: false }
      ]);
      expect(state.wordBagSet.wordBags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            wordBagId: "topic-child"
          })
        ])
      );

      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId,
        wordBagId: "topic-root",
        patch: { summary: "still broken" }
      })).rejects.toMatchObject({
        message: "词袋文件不存在或无法解析。",
        statusCode: 404,
        code: "word_bag_file_not_found"
      });
    });
  });

  it("clamps document pagination and keeps malformed deletion operations readable", async () => {
    await withTempRepository(async ({ db, repository }) => {
      const batchId = "batch-pagination-delete";
      repository.beginBatch({ batchId, jobId: "job-pagination", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [
          buildSource({ id: "source-a", text: "alpha alpha beta", pathName: "docs/source-a.txt" }),
          buildSource({ id: "source-b", text: "alpha gamma", pathName: "docs/source-b.txt" }),
          buildSource({ id: "source-c", text: "delta", pathName: "docs/source-c.txt" })
        ],
        warnings: []
      });

      const limited = repository.listRawCorpusDocuments({ batchId, query: "alpha", limit: -1 });
      expect(limited).toHaveLength(1);
      expect(limited[0]).toMatchObject({
        batchId,
        sourceRef: "source-a",
        sourcePath: "docs/source-a.txt"
      });

      const created = repository.upsertDeletionOperation({
        batchId,
        jobId: "job-pagination",
        status: "running",
        state: { step: 1 },
        error: ""
      });
      repository.upsertDeletionOperation({
        batchId: "batch-completed-delete",
        jobId: "job-completed",
        status: "completed",
        state: { finished: true },
        error: "done"
      });
      db.prepare(`
        UPDATE batch_deletion_operations
        SET state_json = ?, status = ?
        WHERE operation_id = ?
      `).run("{broken", "retrying", created.operationId);

      const pending = repository.listPendingDeletionOperations();
      expect(pending).toEqual([
        expect.objectContaining({
          batchId,
          operationId: created.operationId,
          status: "retrying",
          state: {}
        })
      ]);

      repository.deleteDeletionOperation(created.operationId);
      expect(repository.getDeletionOperationByBatchId(batchId)).toBeNull();
      expect(repository.listPendingDeletionOperations()).toEqual([]);
      expect(() => repository.deleteBatchRecords("missing-batch")).not.toThrow();
    });
  });

  it("covers default tokenizer stopwords, CJK bigrams, and source-file-index vocabulary fallback", async () => {
    await withTempRepository(async ({ root, repository }) => {
      const batchId = "batch-tokenizer-final";
      repository.beginBatch({ batchId, jobId: "job-tokenizer", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [
          buildSource({
            id: "tokenized-source",
            text: "alpha alpha beta 中文测试"
          }),
          buildSource({
            id: "empty-source",
            text: ""
          })
        ],
        warnings: [],
        rules: { keywordStopwords: ["alpha", "中文"] }
      });

      const terms = repository.listSourceCorpusRawTerms({ limit: 20, minFrequency: 1 });
      expect(terms.map((entry) => entry.term)).toEqual(expect.arrayContaining(["beta", "文测", "测试"]));
      expect(terms.map((entry) => entry.term)).not.toContain("alpha");
      expect(terms.map((entry) => entry.term)).not.toContain("中文");

      repository.deleteBatchRecords(batchId);
      repository.deleteBatchRow(batchId);
      await createSourceFileIndex(root);
      const rebuilt = repository.rebuildSourceVocabulary();
      expect(rebuilt).toMatchObject({
        ok: true,
        rebuiltBatchCount: 1,
        scannedSourceCount: 4
      });
      expect(repository.listSourceCorpusRawTerms({ limit: 20, minFrequency: 1 }))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ term: "alpha", frequency: 5 }),
          expect.objectContaining({ term: "beta", frequency: 2 }),
          expect.objectContaining({ term: "fallback", frequency: 4 })
        ]));
      expect(repository.listSourceCorpusRawTerms({ query: "a", limit: 2, minFrequency: 1 }).map((entry) => entry.term))
        .toEqual(["alpha", "fallback"]);

      await createSourceFileIndex(root, { malformed: true });
      const malformedRebuild = repository.rebuildSourceVocabulary();
      expect(malformedRebuild).toMatchObject({
        ok: true,
        rebuiltBatchCount: 0,
        scannedSourceCount: 0
      });
    });
  });

  it("covers word cloud JSONL target, malformed manifest, missing entry, and missing record branches", async () => {
    await withTempRepository(async ({ root, repository }) => {
      await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: "cloud-jsonl-final",
          title: "JSONL Final",
          termsSnapshot: [
            { term: "alpha", frequency: 5 },
            { term: "beta", frequency: 4 },
            { term: "gamma", frequency: 3 }
          ],
          wordBags: [
            {
              wordBagId: "topic-root",
              label: "Topic Root",
              terms: [{ term: "alpha" }],
              children: [
                {
                  wordBagId: "topic-child",
                  label: "Topic Child",
                  terms: [{ term: "beta", removed: true }]
                }
              ]
            }
          ],
          corpusPaths: ["", "docs/a", "docs/a", { path: "docs/b.md", type: "file" }]
        }
      });

      const targetState = await repository.getKnowledgeWordCloudState({
        wordBagSetId: "cloud-jsonl-final",
        targetWordBagId: "missing-target"
      });
      expect(targetState.wordBagSet.wordBags).toEqual([]);

      const rootTerms = await repository.getKnowledgeWordBagTerms({
        wordBagSetId: "cloud-jsonl-final",
        wordBagIds: "topic-root,topic-root topic-child",
        includeChildren: false
      });
      expect(rootTerms).toMatchObject({
        ok: true,
        includeChildren: false,
        requestedWordBagIds: ["topic-root", "topic-child"],
        missingWordBagIds: []
      });
      expect(rootTerms.terms).toEqual(expect.arrayContaining([
        expect.objectContaining({ term: "beta", removed: true })
      ]));

      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "missing-cloud",
        wordBagId: "topic-root",
        patch: { summary: "missing row" }
      }), {
        message: "词袋集合不存在。",
        statusCode: 404,
        code: "word_bag_set_not_found"
      });

      const cloudRoot = path.join(root, "knowledge-word-clouds", "cloud-jsonl-final");
      const manifestPath = path.join(cloudRoot, "manifest.jsonl");
      const originalManifest = await fs.readFile(manifestPath, "utf8");

      await fs.writeFile(manifestPath, JSON.stringify({
        recordType: "wordBagSet",
        schemaVersion: "v0.0.1:schema:definition-1",
        wordBagSetId: "cloud-jsonl-final"
      }) + "\n", "utf8");
      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-jsonl-final",
        wordBagId: "topic-root",
        patch: { summary: "missing entry" }
      }), {
        message: "词袋不存在。",
        statusCode: 404,
        code: "word_bag_not_found"
      });

      await fs.writeFile(manifestPath, originalManifest, "utf8");
      const staleState = await repository.getKnowledgeWordCloudState({ wordBagSetId: "cloud-jsonl-final" });
      const topicRoot = staleState.wordBagSet.wordBags.find((wordBag) => wordBag.wordBagId === "topic-root");
      const staleFile = path.join(cloudRoot, "word-bags", "stale.jsonl");
      await fs.mkdir(path.dirname(staleFile), { recursive: true });
      await fs.writeFile(staleFile, "{}\n", "utf8");
      const rewrittenManifest = originalManifest.replace(
        /"wordBagId":"topic-root","parentWordBagId":"([^"]*)","childWordBagIds":\[[^\]]*\],"file":"([^"]+)"/,
        "\"wordBagId\":\"topic-root\",\"parentWordBagId\":\"$1\",\"childWordBagIds\":[],\"file\":\"word-bags/stale.jsonl\""
      );
      await fs.writeFile(manifestPath, rewrittenManifest, "utf8");
      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-jsonl-final",
        wordBagId: "topic-root",
        patch: { summary: "bad file" }
      }), {
        message: "词袋文件不存在或无法解析。",
        statusCode: 404,
        code: "word_bag_file_not_found"
      });

      await fs.writeFile(manifestPath, originalManifest, "utf8");
      const moved = await repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-jsonl-final",
        wordBagId: "topic-child",
        patch: { parentWordBagId: "", terms: [{ term: "gamma" }] }
      });
      expect(moved).toMatchObject({
        ok: true,
        action: "updated",
        wordBag: { wordBagId: "topic-child", parentWordBagId: "" }
      });
      expect(topicRoot).toBeTruthy();
    });
  });

  it("rolls back rebuild and delete transactions when repository storage is closed", async () => {
    await withTempRepository(async ({ db, repository }) => {
      const batchId = "batch-rollback-final";
      repository.beginBatch({ batchId, jobId: "job-rollback", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId,
        sources: [buildSource({ id: "rollback-source", text: "alpha beta" })],
        warnings: []
      });

      db.close();
      expect(() => repository.rebuildSourceVocabulary()).toThrow();
      expect(() => repository.deleteBatchRecords(batchId)).toThrow();
    });
  });
});
