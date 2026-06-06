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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-focused-extra-2-"));
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

async function seedWordCloudSet(repository, wordBagSetId, title) {
  await repository.saveKnowledgeWordCloudSet({
    wordBagSet: {
      wordBagSetId,
      title,
      termsSnapshot: [
        { term: "alpha", frequency: 3 },
        { term: "beta", frequency: 1 }
      ],
      wordBags: [
        {
          wordBagId: "seed-root",
          label: "Seed Root",
          terms: [{ term: "alpha", frequency: 3 }]
        }
      ]
    }
  });
}

function manifestLine(record) {
  return JSON.stringify(record);
}

describe("batch repository focused extra coverage 2", () => {
  it("rebuilds stale JSONL manifests when the file is missing or lacks file markers", async () => {
    await withTempRepository(async ({ root, db, repository }) => {
      const missingSetId = "cloud-refresh-missing";
      const staleSetId = "cloud-refresh-stale";

      await seedWordCloudSet(repository, missingSetId, "Missing Manifest");
      await seedWordCloudSet(repository, staleSetId, "Stale Manifest");

      const missingManifestPath = path.join(root, "knowledge-word-clouds", missingSetId, "manifest.jsonl");
      await fs.rm(missingManifestPath, { force: true });

      const staleManifestPath = path.join(root, "knowledge-word-clouds", staleSetId, "manifest.jsonl");
      await fs.writeFile(
        staleManifestPath,
        [
          manifestLine({
            recordType: "wordBagSet",
            schemaVersion: 1,
            wordBagSetId: staleSetId,
            title: "Stale Manifest",
            updatedAt: FIXED_NOW,
            wordBagCount: 1
          }),
          manifestLine({
            recordType: "wordBagIndex",
            schemaVersion: 1,
            wordBagSetId: staleSetId,
            wordBagId: "seed-root",
            parentWordBagId: "",
            childWordBagIds: [],
            order: 0,
            depth: 0
          })
        ].join("\n") + "\n",
        "utf8"
      );

      createBatchRepository({ db, userDataPath: root });

      const refreshedMissingManifest = await fs.readFile(missingManifestPath, "utf8");
      const refreshedStaleManifest = await fs.readFile(staleManifestPath, "utf8");
      expect(refreshedMissingManifest).toContain('"file":');
      expect(refreshedStaleManifest).toContain('"file":');

      const missingState = await repository.getKnowledgeWordCloudState({ wordBagSetId: missingSetId });
      const staleState = await repository.getKnowledgeWordCloudState({ wordBagSetId: staleSetId });

      expect(missingState.wordBagSet.wordBags.map((wordBag) => wordBag.wordBagId)).toEqual([
        "seed-root",
        "default",
        "other"
      ]);
      expect(staleState.wordBagSet.wordBags.map((wordBag) => wordBag.wordBagId)).toEqual([
        "seed-root",
        "default",
        "other"
      ]);
    });
  });

  it("hydrates mixed JSONL rows, missing files, duplicates, and parent-child attachment edges", async () => {
    await withTempRepository(async ({ root, repository }) => {
      const wordBagSetId = "cloud-jsonl-tree";
      await seedWordCloudSet(repository, wordBagSetId, "JSONL Tree");

      const cloudRoot = path.join(root, "knowledge-word-clouds", wordBagSetId);
      const bagRoot = path.join(cloudRoot, "word-bags");
      await fs.mkdir(bagRoot, { recursive: true });

      await fs.writeFile(
        path.join(cloudRoot, "manifest.jsonl"),
        [
          manifestLine({
            recordType: "wordBagSet",
            schemaVersion: 1,
            wordBagSetId,
            title: "JSONL Tree",
            updatedAt: FIXED_NOW,
            wordBagCount: 3
          }),
          manifestLine({
            recordType: "wordBagIndex",
            schemaVersion: 1,
            wordBagSetId,
            wordBagId: "root",
            parentWordBagId: "",
            childWordBagIds: ["linked-child", "fallback-child", "linked-child"],
            file: "word-bags/root.jsonl",
            order: "not-a-number",
            depth: "also-not-a-number"
          }),
          manifestLine({
            recordType: "wordBagIndex",
            schemaVersion: 1,
            wordBagSetId,
            wordBagId: "linked-child",
            parentWordBagId: "root",
            childWordBagIds: ["leaf-child"],
            file: "word-bags/linked.jsonl",
            order: 1,
            depth: 1
          }),
          manifestLine({
            recordType: "wordBagIndex",
            schemaVersion: 1,
            wordBagSetId,
            wordBagId: "linked-child",
            parentWordBagId: "root",
            childWordBagIds: ["leaf-child"],
            file: "word-bags/linked.jsonl",
            order: 2,
            depth: 1
          }),
          manifestLine({
            recordType: "wordBagIndex",
            schemaVersion: 1,
            wordBagSetId,
            wordBagId: "orphan-child",
            parentWordBagId: "root",
            file: "word-bags/orphan.jsonl",
            order: 3,
            depth: 1
          }),
          manifestLine({
            recordType: "wordBagIndex",
            schemaVersion: 1,
            wordBagSetId,
            wordBagId: "missing-file",
            parentWordBagId: "root",
            file: "word-bags/missing.jsonl",
            order: 4,
            depth: 1
          }),
          manifestLine({
            recordType: "wordBagIndex",
            schemaVersion: 1,
            wordBagSetId,
            wordBagId: "ignored",
            parentWordBagId: "root"
          })
        ].join("\n") + "\n",
        "utf8"
      );

      await fs.writeFile(
        path.join(bagRoot, "root.jsonl"),
        [
          "",
          manifestLine({ recordType: "ignored", value: 1 }),
          manifestLine({ recordType: "wordBag", wordBag: { label: "Missing Id" } }),
          manifestLine({
            recordType: "wordBag",
            wordBag: {
              wordBagId: "root",
              label: "Root",
              childWordBagIds: ["linked-child", "fallback-child", "linked-child"],
              children: [{ wordBagId: "leaf-child" }]
            }
          })
        ].join("\n") + "\n",
        "utf8"
      );

      await fs.writeFile(
        path.join(bagRoot, "linked.jsonl"),
        [
          manifestLine({
            recordType: "wordBag",
            wordBag: {
              wordBagId: "linked-child",
              label: "Linked",
              childWordBagIds: ["leaf-child"],
              parentWordBagId: ""
            }
          })
        ].join("\n") + "\n",
        "utf8"
      );

      await fs.writeFile(
        path.join(bagRoot, "orphan.jsonl"),
        [
          manifestLine({
            recordType: "wordBag",
            wordBag: {
              wordBagId: "orphan-child",
              label: "Orphan",
              parentWordBagId: "root"
            }
          })
        ].join("\n") + "\n",
        "utf8"
      );

      const fullState = await repository.getKnowledgeWordCloudState({ wordBagSetId });
      expect(fullState.wordBagSet.wordBags.map((wordBag) => wordBag.wordBagId)).toEqual(
        expect.arrayContaining(["root", "default", "other"])
      );

      const rootBag = fullState.wordBagSet.wordBags.find((wordBag) => wordBag.wordBagId === "root");
      expect(rootBag).toBeTruthy();
      expect(rootBag.wordBagId).toBe("root");
      expect(rootBag.childWordBagIds).toEqual(expect.arrayContaining(["linked-child", "fallback-child"]));
      expect(rootBag.children.map((wordBag) => wordBag.wordBagId)).toEqual([
        "linked-child",
        "orphan-child"
      ]);

      const targetedState = await repository.getKnowledgeWordCloudState({
        wordBagSetId,
        wordBagId: "not-present"
      });
      expect(targetedState.wordBagSet.wordBags).toEqual([]);
      expect(targetedState.wordBagSet.wordBagCount).toBe(0);
    });
  });
});
