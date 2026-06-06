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

const FIRST_GENERATED_AT = "2026-03-01T00:00:00.000Z";

async function withTempWorkspace(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-more-extra-test-"));
  await fs.mkdir(path.join(root, "metadata"), { recursive: true });

  const db = new Database(getMetadataDatabasePath(root));
  initializeMetadataSchema(db);

  try {
    return await testCase({ root, db });
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
    providerId: "provider-local",
    externalId: `${id}-external`,
    syncBatchId: `sync-${id}`,
    contentHash: rawObject?.contentHash || `content-${id}`,
    capturedAt: FIRST_GENERATED_AT,
    text,
    mediaType: "text/plain",
  };
}

async function createSourceFileIndex(userDataPath, {
  fileId = "file-1",
  sourceId = "source-index",
  contentHash = "",
  readablePreview = "",
  terms = [],
} = {}) {
  await fs.mkdir(path.join(userDataPath, "source-file-index"), { recursive: true });
  const indexDb = new Database(path.join(userDataPath, "source-file-index", "source-files.sqlite"));

  try {
    indexDb.exec(`
      CREATE TABLE IF NOT EXISTS source_file_index_files (
        file_id TEXT PRIMARY KEY,
        evidence_id TEXT UNIQUE NOT NULL,
        source_id TEXT NOT NULL,
        root_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        extension TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        from_header TEXT NOT NULL DEFAULT '',
        date_header TEXT NOT NULL DEFAULT '',
        readable_preview TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'indexed',
        error TEXT NOT NULL DEFAULT '',
        indexed_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS source_file_index_terms (
        term TEXT NOT NULL,
        file_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        field TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        first_position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(term, file_id, field)
      );
    `);
    indexDb.prepare(`
      INSERT INTO source_file_index_files (
        file_id, evidence_id, source_id, root_path, absolute_path, relative_path,
        extension, byte_size, mtime_ms, content_hash, title, from_header, date_header,
        readable_preview, status, error, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      `${sourceId}:${fileId}`,
      sourceId,
      userDataPath,
      path.join(userDataPath, "source", `${fileId}.txt`),
      `source/${fileId}.txt`,
      ".txt",
      0,
      0,
      contentHash,
      "Indexed file",
      "",
      "",
      readablePreview,
      "indexed",
      "",
      FIRST_GENERATED_AT
    );
    const insertTerm = indexDb.prepare(`
      INSERT INTO source_file_index_terms (term, file_id, source_id, field, count, first_position)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [index, term] of terms.entries()) {
      insertTerm.run(term.term, fileId, sourceId, "text", term.count, index);
    }
  } finally {
    indexDb.close();
  }
}

async function seedLegacyWordCloudSet(db, {
  wordBagSetId = "legacy-cloud-set",
  title = "Legacy Cloud",
} = {}) {
  db.prepare(`
    INSERT INTO knowledge_word_cloud_sets (
      cloud_set_id, title, status, cloud_count, terms_snapshot_json, clouds_json,
      unassigned_terms_json, corpus_paths_json, model_alias, agent_response_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wordBagSetId,
    title,
    "draft",
    1,
    JSON.stringify([
      { term: "alpha", frequency: 3 },
      { term: "beta", frequency: 1, weight: 0.1 },
      { term: "gamma", frequency: 1, quality: "low" }
    ]),
    JSON.stringify([
      {
        wordBagId: "topic-root",
        label: "Topic",
        terms: [{ term: "alpha", frequency: 3 }],
        children: [
          {
            wordBagId: "topic-child",
            label: "Child",
            terms: [{ term: "delta", frequency: 1 }]
          }
        ]
      }
    ]),
    "[]",
    "[]",
    "",
    "{}",
    FIRST_GENERATED_AT,
    FIRST_GENERATED_AT
  );
}

describe("batch repository more extra coverage", () => {
  it("rebuilds vocabulary from the source-file-index fallback and hashes text-only files", async () => {
    await withTempWorkspace(async ({ root, db }) => {
      await createSourceFileIndex(root, {
        sourceId: "source-index",
        fileId: "file-alpha",
        contentHash: "",
        readablePreview: "Alpha preview text for hashing",
        terms: [
          { term: "alpha", count: 3 },
          { term: "beta", count: 2 },
        ],
      });

      const repository = createBatchRepository({ db, userDataPath: root });
      const result = repository.rebuildSourceVocabulary();

      expect(result).toMatchObject({
        ok: true,
        rebuiltBatchCount: 1,
        scannedSourceCount: 1,
      });
      expect(result.sourceVocabularyBatchCount).toBe(1);
      expect(result.sourceVocabularyTermCount).toBeGreaterThanOrEqual(2);

      const summary = repository.getStorageSummary();
      expect(summary.sourceVocabularyBatchCount).toBe(1);
      expect(summary.sourceCorpusRawTermCount).toBeGreaterThanOrEqual(2);

      const terms = repository.listSourceCorpusRawTerms({ limit: 10, minFrequency: 1 });
      expect(terms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: "alpha" }),
          expect.objectContaining({ term: "beta" }),
        ])
      );
    });
  });

  it("refreshes legacy word-cloud JSONL snapshots on repository initialization", async () => {
    await withTempWorkspace(async ({ root, db }) => {
      await seedLegacyWordCloudSet(db);

      createBatchRepository({ db, userDataPath: root });

      const manifestPath = path.join(root, "knowledge-word-clouds", "legacy-cloud-set", "manifest.jsonl");
      const firstManifest = await fs.readFile(manifestPath, "utf8");
      expect(firstManifest).toContain('"file":');

      const legacyManifest = firstManifest
        .split(/\r?\n/g)
        .map((line) => {
          if (!line.includes('"recordType":"wordBagIndex"')) {
            return line;
          }
          return line.replace(/,"file":"[^"]*"/, "");
        })
        .join("\n");
      await fs.writeFile(manifestPath, legacyManifest, "utf8");

      createBatchRepository({ db, userDataPath: root });
      const refreshedManifest = await fs.readFile(manifestPath, "utf8");

      expect(refreshedManifest).toContain('"recordType":"wordBagSet"');
      expect(refreshedManifest).toContain('"recordType":"wordBagIndex"');
      expect(refreshedManifest).toContain('"file":');

      const bagPath = path.join(root, "knowledge-word-clouds", "legacy-cloud-set", "word-bags");
      const bagFiles = await fs.readdir(bagPath);
      expect(bagFiles.length).toBeGreaterThan(0);
    });
  });

  it("routes low-weight terms into the other preset bag", async () => {
    await withTempWorkspace(async ({ root, db }) => {
      const repository = createBatchRepository({ db, userDataPath: root });
      const saved = await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: "cloud-low-weight",
          title: "Low Weight",
          termsSnapshot: [
            { term: "alpha", frequency: 3 },
            { term: "beta", frequency: 1, weight: 0.1 },
            { term: "gamma", frequency: 1, quality: "low" }
          ],
          wordBags: [
            {
              wordBagId: "topic-a",
              label: "Topic A",
              terms: [{ term: "alpha", frequency: 3 }]
            }
          ]
        },
        limit: 50,
      });

      expect(saved).toMatchObject({ ok: true, wordBagSet: { wordBagSetId: "cloud-low-weight" } });

      const wordBagIds = saved.wordBagSet.wordBags.map((wordBag) => wordBag.wordBagId);
      expect(wordBagIds).toEqual(expect.arrayContaining(["topic-a", "default", "other"]));

      const otherWordBag = saved.wordBagSet.wordBags.find((wordBag) => wordBag.wordBagId === "other");
      expect(otherWordBag?.terms.map((term) => term.term)).toEqual(expect.arrayContaining(["beta", "gamma"]));
      expect(otherWordBag?.terms.some((term) => term.quality === "low")).toBe(true);
    });
  });
});
