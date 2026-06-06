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

const FIXED_NOW = "2026-06-05T00:00:00.000Z";

async function withTempRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-final-extra-10-"));
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

function buildSource({ id, filePath, text, contentHash = "", rawObject = null }) {
  return {
    id,
    name: `${id}.txt`,
    path: filePath,
    kind: "document",
    rawObject,
    providerId: "provider-final-extra",
    externalId: `${id}-external`,
    syncBatchId: `sync-${id}`,
    contentHash: contentHash || rawObject?.contentHash || `content-${id}`,
    capturedAt: FIXED_NOW,
    sourceCreatedAt: FIXED_NOW,
    sourceUpdatedAt: FIXED_NOW,
    sourceCollectedAt: FIXED_NOW,
    sourceMetadata: { fixture: id },
    text,
    mediaType: "text/plain",
  };
}

async function seedSourceFileIndex(root, { files = [], terms = [] } = {}) {
  const indexRoot = path.join(root, "source-file-index");
  await fs.mkdir(indexRoot, { recursive: true });

  const indexDb = new Database(path.join(indexRoot, "source-files.sqlite"));
  try {
    indexDb.exec(`
      CREATE TABLE IF NOT EXISTS source_file_index_files (
        file_id TEXT,
        source_id TEXT,
        content_hash TEXT,
        readable_preview TEXT,
        status TEXT
      );
      CREATE TABLE IF NOT EXISTS source_file_index_terms (
        file_id TEXT,
        term TEXT,
        count INTEGER
      );
    `);
    indexDb.exec("DELETE FROM source_file_index_files");
    indexDb.exec("DELETE FROM source_file_index_terms");

    const insertFile = indexDb.prepare(`
      INSERT INTO source_file_index_files (file_id, source_id, content_hash, readable_preview, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const file of files) {
      insertFile.run(
        file.fileId,
        file.sourceId,
        file.contentHash || "",
        file.readablePreview || "",
        file.status || "indexed"
      );
    }

    const insertTerm = indexDb.prepare(`
      INSERT INTO source_file_index_terms (file_id, term, count)
      VALUES (?, ?, ?)
    `);
    for (const term of terms) {
      insertTerm.run(term.fileId, term.term, term.count);
    }
  } finally {
    indexDb.close();
  }
}

async function findWordBagFile(root, wordBagSetId, wordBagId) {
  const manifestPath = path.join(root, "knowledge-word-clouds", wordBagSetId, "manifest.jsonl");
  const manifest = await fs.readFile(manifestPath, "utf8");
  for (const line of manifest.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const record = JSON.parse(trimmed);
    if (record.recordType === "wordBagIndex" && record.wordBagId === wordBagId) {
      return path.join(root, "knowledge-word-clouds", wordBagSetId, record.file);
    }
  }
  throw new Error(`missing word bag file for ${wordBagSetId}:${wordBagId}`);
}

describe("batch repository final extra coverage 10", () => {
  it("covers source-file-index fallback and source vocabulary edge cases", async () => {
    await withTempRepository(async ({ root, repository }) => {
      await seedSourceFileIndex(root);

      const emptyFallback = repository.rebuildSourceVocabulary();
      expect(emptyFallback).toMatchObject({
        ok: true,
        rebuiltBatchCount: 0,
        scannedSourceCount: 0,
      });

      await seedSourceFileIndex(root, {
        files: [
          {
            fileId: "file-empty-key",
            sourceId: "source-empty-key",
            contentHash: "",
            readablePreview: "",
            status: "indexed",
          },
        ],
      });

      const noFileKeyFallback = repository.rebuildSourceVocabulary();
      expect(noFileKeyFallback).toMatchObject({
        ok: true,
        rebuiltBatchCount: 0,
        scannedSourceCount: 1,
      });
      expect(noFileKeyFallback.sourceVocabularyBatchCount).toBe(0);

      await seedSourceFileIndex(root, {
        files: [
          {
            fileId: "file-invalid-terms",
            sourceId: "source-invalid-terms",
            contentHash: "hash-invalid-terms",
            readablePreview: "preview text",
            status: "indexed",
          },
        ],
        terms: [
          { fileId: "file-invalid-terms", term: "", count: 3 },
          { fileId: "file-invalid-terms", term: "x".repeat(129), count: 2 },
          { fileId: "file-invalid-terms", term: "zero", count: 0 },
        ],
      });

      const invalidTermFallback = repository.rebuildSourceVocabulary();
      expect(invalidTermFallback).toMatchObject({
        ok: true,
        rebuiltBatchCount: 0,
        scannedSourceCount: 1,
      });

      repository.beginBatch({
        batchId: "batch-source-vocabulary-edge",
        jobId: "job-source-vocabulary-edge",
        generatedAt: FIXED_NOW,
        settings: {},
      });
      repository.persistSources({
        batchId: "batch-source-vocabulary-edge",
        sources: [
          buildSource({
            id: "duplicate-a",
            filePath: "docs/duplicate-a.txt",
            text: "alpha beta",
            contentHash: "shared-content-hash",
          }),
          buildSource({
            id: "duplicate-b",
            filePath: "docs/duplicate-b.txt",
            text: "gamma delta",
            contentHash: "shared-content-hash",
          }),
          buildSource({
            id: "long-term",
            filePath: "docs/long-term.txt",
            text: `${"x".repeat(129)} omega`,
            contentHash: "unique-content-hash",
          }),
        ],
        warnings: [],
      });

      const terms = repository.listSourceCorpusRawTerms({ limit: 10, minFrequency: 1 });
      expect(terms.map((item) => item.term)).toEqual(expect.arrayContaining(["alpha", "beta", "omega"]));
      expect(terms.some((item) => item.term === "gamma")).toBe(false);
    });
  });

  it("covers word cloud guard rails, structural validation, and JSONL recovery paths", async () => {
    await withTempRepository(async ({ root, repository }) => {
      await expect(repository.getKnowledgeWordBagTerms({
        wordBagSetId: "missing-word-bag-set",
        wordBagId: "topic-gamma",
      })).rejects.toMatchObject({
        code: "word_bag_set_not_found",
        statusCode: 404,
      });

      await expect(repository.updateKnowledgeWordBag({
        wordBagId: "topic-gamma",
        patch: { label: "No set id" },
      })).rejects.toMatchObject({
        code: "word_bag_set_id_required",
        statusCode: 400,
      });

      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-guards",
        patch: { label: "No bag id" },
      })).rejects.toMatchObject({
        code: "word_bag_id_required",
        statusCode: 400,
      });

      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "missing-word-cloud-set",
        wordBagId: "topic-gamma",
        patch: { childWordBagIds: [] },
      })).rejects.toMatchObject({
        code: "word_bag_set_not_found",
        statusCode: 404,
      });

      const saved = await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: "word-cloud-guards",
          title: "Word Cloud Guards",
          termsSnapshot: [
            { term: "alpha", frequency: 3 },
            { term: "beta", frequency: 1, quality: "low" },
          ],
          wordBags: [
            {
              wordBagId: "topic-gamma",
              label: "Gamma",
              terms: [{ term: "gamma", frequency: 2 }],
            },
            {
              wordBagId: "removed-bag",
              label: "Removed",
              terms: [{ term: "delta", frequency: 1 }],
            },
            {
              wordBagId: "dup-bag",
              label: "Duplicate",
              terms: [{ term: "epsilon", frequency: 1 }],
            },
          ],
        },
        limit: 50,
      });

      expect(saved).toMatchObject({ ok: true, wordBagSet: { wordBagSetId: "word-cloud-guards" } });

      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-guards",
        wordBagId: "default",
        patch: { label: "Renamed default", childWordBagIds: [] },
      })).rejects.toMatchObject({
        code: "preset_word_bag_title_update_forbidden",
        statusCode: 409,
      });

      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-guards",
        wordBagId: "topic-gamma",
        patch: { childWordBagIds: ["missing-child"] },
      })).rejects.toMatchObject({
        code: "child_word_bag_not_found",
        statusCode: 404,
      });

      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-guards",
        wordBagId: "topic-gamma",
        patch: { parentWordBagId: "missing-parent" },
      })).rejects.toMatchObject({
        code: "parent_word_bag_not_found",
        statusCode: 404,
      });

      const duplicateBagFile = await findWordBagFile(root, "word-cloud-guards", "dup-bag");
      const duplicateRecord = JSON.parse((await fs.readFile(duplicateBagFile, "utf8")).trim());
      duplicateRecord.terms = [{ term: "alpha", frequency: 1 }];
      await fs.writeFile(duplicateBagFile, `${JSON.stringify(duplicateRecord)}\n`, "utf8");

      const removedBagFile = await findWordBagFile(root, "word-cloud-guards", "removed-bag");
      const removedRecord = JSON.parse((await fs.readFile(removedBagFile, "utf8")).trim());
      removedRecord.terms = [{ term: "zeta", frequency: 1, removed: true }];
      await fs.writeFile(removedBagFile, `${JSON.stringify(removedRecord)}\n`, "utf8");

      const deletedRemoved = await repository.deleteKnowledgeWordBag({
        wordBagSetId: "word-cloud-guards",
        wordBagId: "removed-bag",
      });
      expect(deletedRemoved).toMatchObject({
        ok: true,
        action: "deleted",
        deletedWordBagId: "removed-bag",
      });

      const deletedDuplicate = await repository.deleteKnowledgeWordBag({
        wordBagSetId: "word-cloud-guards",
        wordBagId: "dup-bag",
      });
      expect(deletedDuplicate).toMatchObject({
        ok: true,
        action: "deleted",
        deletedWordBagId: "dup-bag",
      });

      await expect(repository.deleteKnowledgeWordBag({
        wordBagSetId: "word-cloud-guards",
        wordBagId: "default",
      })).rejects.toMatchObject({
        code: "preset_word_bag_delete_forbidden",
        statusCode: 409,
      });

      const terms = await repository.getKnowledgeWordBagTerms({
        wordBagSetId: "word-cloud-guards",
        wordBagIds: ["topic-gamma", "missing-child"],
        includeChildren: false,
      });
      expect(terms).toMatchObject({
        ok: true,
        missingWordBagIds: ["missing-child"],
      });
      expect(terms.groups).toHaveLength(1);
      expect(terms.groups[0]).toMatchObject({
        wordBagId: "topic-gamma",
        includeChildren: false,
      });
    });
  });

  it("covers word cloud imports, generated nested bags, significant terms, and rollback guards", async () => {
    await withTempRepository(async ({ db, repository }) => {
      expect(repository.listSourceVocabularyTermStatsByTerms({ terms: ["", "   "] })).toEqual([]);
      expect(repository.getSignificantSourceTerms({})).toMatchObject({
        ok: false,
        error: "scope_required",
        terms: [],
      });

      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: "{bad-json",
      })).rejects.toMatchObject({ code: "word_bag_import_invalid_json", statusCode: 400 });
      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: [],
      })).rejects.toMatchObject({ code: "word_bag_import_invalid_payload", statusCode: 400 });
      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: {
          exportType: "pact.knowledge.word_bags.other",
          wordBagSet: {},
        },
      })).rejects.toMatchObject({ code: "word_bag_import_type_mismatch", statusCode: 400 });
      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: {
          exportType: "pact.knowledge.word_bags.export",
        },
      })).rejects.toMatchObject({ code: "word_bag_import_missing_set", statusCode: 400 });

      await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: "word-cloud-imports",
          title: "Word Cloud Imports",
          termsSnapshot: [
            { term: "alpha", frequency: 6 },
            { term: "beta", frequency: 4 },
            { term: "gamma", frequency: 3 },
            { term: "delta", frequency: 2 },
            { term: "noise", frequency: 1, weight: 0.02 },
          ],
          wordBags: [
            {
              wordBagId: "topic-alpha",
              label: "Alpha",
              terms: [{ term: "alpha", frequency: 6 }],
              children: [
                {
                  wordBagId: "topic-beta",
                  label: "Beta",
                  terms: [{ term: "beta", frequency: 4 }],
                },
              ],
            },
          ],
        },
      });

      const exported = await repository.exportKnowledgeWordCloudSet({});
      expect(exported).toMatchObject({
        ok: true,
        exportType: "pact.knowledge.word_bags.export",
        wordBagSet: { wordBagSetId: "word-cloud-imports" },
      });
      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: exported,
        mode: "overwrite",
      })).resolves.toMatchObject({
        ok: true,
        action: "imported",
        mode: "overwrite",
        importedFromWordBagSetId: "word-cloud-imports",
      });
      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: exported,
        mode: "copy",
      })).resolves.toMatchObject({
        ok: true,
        action: "imported",
        mode: "copy",
      });

      const added = await repository.addKnowledgeWordBag({
        wordBagSetId: "word-cloud-imports",
        wordBag: {
          label: "Generated",
          terms: [{ term: "gamma", frequency: 3 }],
          groups: [
            {
              label: "Nested generated",
              terms: [{ term: "delta", frequency: 2 }],
            },
          ],
        },
      });
      expect(added).toMatchObject({ ok: true, action: "added" });
      expect(added.wordBag.wordBagId).toMatch(/^word-bag-/);
      expect(added.wordBag.children[0].wordBagId).toMatch(/^word-bag-/);

      const grouped = await repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-imports",
        wordBagId: added.wordBag.wordBagId,
        patch: {
          groups: [
            {
              label: "Replacement group",
              terms: [{ term: "beta", frequency: 4 }],
            },
          ],
        },
      });
      const replacementChildId = grouped.wordBag.children[0].wordBagId;
      expect(replacementChildId).toMatch(/^word-bag-/);

      const wordBagsUpdate = await repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-imports",
        wordBagId: added.wordBag.wordBagId,
        patch: {
          wordBags: [
            {
              label: "WordBags child",
              terms: [{ term: "delta", frequency: 2 }],
            },
          ],
        },
      });
      const wordBagsChildId = wordBagsUpdate.wordBag.children[0].wordBagId;
      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-imports",
        wordBagId: added.wordBag.wordBagId,
        patch: { childWordBagIds: [wordBagsChildId] },
      })).resolves.toMatchObject({ ok: true, action: "updated" });
      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "word-cloud-imports",
        wordBagId: wordBagsChildId,
        patch: { parentWordBagId: "" },
      })).resolves.toMatchObject({
        ok: true,
        action: "updated",
        wordBag: { parentWordBagId: "" },
      });

      await expect(repository.deleteKnowledgeWordBag({ wordBagSetId: "", wordBagId: "x" }))
        .rejects.toMatchObject({ code: "word_bag_set_id_required", statusCode: 400 });

      const foregroundBatchId = "batch-significant-foreground";
      repository.beginBatch({ batchId: foregroundBatchId, jobId: "job-significant-foreground", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId: foregroundBatchId,
        sources: [
          buildSource({ id: "foreground-a", filePath: "docs/foreground-a.txt", text: "alpha alpha beta" }),
          buildSource({ id: "foreground-b", filePath: "docs/foreground-b.txt", text: "alpha beta" }),
        ],
        warnings: [],
      });
      repository.beginBatch({ batchId: "batch-significant-background", jobId: "job-significant-background", generatedAt: FIXED_NOW, settings: {} });
      repository.persistSources({
        batchId: "batch-significant-background",
        sources: [
          buildSource({ id: "background-a", filePath: "docs/background-a.txt", text: "beta common" }),
          buildSource({ id: "background-b", filePath: "docs/background-b.txt", text: "common" }),
        ],
        warnings: [],
      });

      expect(repository.getSignificantSourceTerms({
        batchId: foregroundBatchId,
        minForegroundDocumentFrequency: 3,
      })).toMatchObject({
        ok: true,
        terms: [],
      });
      const significant = repository.getSignificantSourceTerms({
        batchId: foregroundBatchId,
        minForegroundDocumentFrequency: 1,
      });
      expect(significant).toMatchObject({ ok: true, foregroundDocumentCount: 2 });
      expect(significant.terms.map((item) => item.term)).toContain("alpha");

      db.exec(`
        CREATE TRIGGER fail_source_file_delete
        BEFORE DELETE ON source_files
        BEGIN
          SELECT RAISE(ABORT, 'blocked source delete');
        END;
      `);
      expect(() => repository.persistSources({
        batchId: foregroundBatchId,
        sources: [
          buildSource({ id: "foreground-replacement", filePath: "docs/replacement.txt", text: "replacement" }),
        ],
        warnings: [],
      })).toThrow(/blocked source delete/);
      db.exec("DROP TRIGGER fail_source_file_delete");

      db.exec(`
        CREATE TRIGGER fail_source_vocabulary_clear
        BEFORE DELETE ON source_vocabulary_terms
        BEGIN
          SELECT RAISE(ABORT, 'blocked vocabulary clear');
        END;
      `);
      expect(() => repository.rebuildSourceVocabulary()).toThrow(/blocked vocabulary clear/);
      db.exec("DROP TRIGGER fail_source_vocabulary_clear");
    });
  });
});
