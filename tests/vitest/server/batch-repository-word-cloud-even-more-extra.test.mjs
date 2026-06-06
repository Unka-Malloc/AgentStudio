import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { createBatchRepository } from "../../../server/platform/common/storage/batch-repository.mjs";
import {
  getMetadataDatabasePath,
  initializeMetadataSchema
} from "../../../server/platform/common/storage/schema-manager.mjs";

async function withTempRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-repository-word-cloud-even-more-"));
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

async function expectWordCloudError(promise, { message, statusCode, code }) {
  await expect(promise).rejects.toMatchObject({
    message,
    statusCode,
    code
  });
}

async function seedWordCloud(repository) {
  return repository.saveKnowledgeWordCloudSet({
    wordBagSet: {
      wordBagSetId: "cloud-boundary",
      title: "Boundary Cloud",
      status: "draft",
      termsSnapshot: [
        { term: "alpha", frequency: 5 },
        { term: "beta", frequency: 4 },
        { term: "gamma", frequency: 3 },
        { term: "delta", frequency: 2 },
        { term: "epsilon", frequency: 1 }
      ],
      wordBags: [
        {
          wordBagId: "topic-root",
          label: "Topic Root",
          terms: [{ term: "alpha", frequency: 5 }],
          children: [
            {
              wordBagId: "topic-child",
              label: "Topic Child",
              terms: [{ term: "beta", frequency: 4 }]
            }
          ]
        },
        {
          wordBagId: "topic-sibling",
          label: "Topic Sibling",
          terms: [{ term: "gamma", frequency: 3 }]
        }
      ]
    },
    limit: 50
  });
}

describe("batch repository word cloud even more coverage", () => {
  it("covers import/export validation and copy/overwrite import modes", async () => {
    await withTempRepository(async ({ repository }) => {
      await expectWordCloudError(repository.exportKnowledgeWordCloudSet({ wordBagSetId: "missing" }), {
        message: "词袋集合不存在。",
        statusCode: 404,
        code: "word_bag_set_not_found"
      });
      await expectWordCloudError(repository.importKnowledgeWordCloudSet("not-json"), {
        message: "导入文件不是有效 JSON。",
        statusCode: 400,
        code: "word_bag_import_invalid_json"
      });
      await expectWordCloudError(repository.importKnowledgeWordCloudSet([]), {
        message: "导入内容必须是词袋导出对象。",
        statusCode: 400,
        code: "word_bag_import_invalid_payload"
      });
      await expectWordCloudError(repository.importKnowledgeWordCloudSet({ exportType: "other", wordBagSet: {} }), {
        message: "导入文件类型不匹配。",
        statusCode: 400,
        code: "word_bag_import_type_mismatch"
      });
      await expectWordCloudError(repository.importKnowledgeWordCloudSet({ exportType: "pact.knowledge.word_bags.export" }), {
        message: "导入内容缺少 wordBagSet。",
        statusCode: 400,
        code: "word_bag_import_missing_set"
      });

      await seedWordCloud(repository);
      const exportedLatest = await repository.exportKnowledgeWordCloudSet();
      expect(exportedLatest).toMatchObject({
        ok: true,
        exportType: "pact.knowledge.word_bags.export",
        wordBagSet: {
          wordBagSetId: "cloud-boundary"
        }
      });

      const copied = await repository.importKnowledgeWordCloudSet({
        importPayload: JSON.stringify(exportedLatest)
      });
      expect(copied).toMatchObject({
        ok: true,
        action: "imported",
        mode: "copy",
        importedFromWordBagSetId: "cloud-boundary"
      });
      expect(copied.wordBagSet.wordBagSetId).not.toBe("cloud-boundary");

      const overwritten = await repository.importKnowledgeWordCloudSet({
        mode: "overwrite",
        wordBagExport: exportedLatest
      });
      expect(overwritten).toMatchObject({
        ok: true,
        action: "imported",
        mode: "overwrite",
        importedFromWordBagSetId: "cloud-boundary",
        wordBagSet: {
          wordBagSetId: "cloud-boundary"
        }
      });
    });
  });

  it("covers add/update/delete word bag validation and structural mutation branches", async () => {
    await withTempRepository(async ({ repository }) => {
      await seedWordCloud(repository);

      await expectWordCloudError(repository.addKnowledgeWordBag({ wordBag: { wordBagId: "x" } }), {
        message: "缺少 wordBagSetId。",
        statusCode: 400,
        code: "word_bag_set_id_required"
      });
      await expectWordCloudError(repository.addKnowledgeWordBag({ wordBagSetId: "missing", wordBag: { wordBagId: "x" } }), {
        message: "词袋集合不存在。",
        statusCode: 404,
        code: "word_bag_set_not_found"
      });
      await expectWordCloudError(repository.addKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        parentWordBagId: "missing-parent",
        wordBag: { wordBagId: "topic-new", label: "New" }
      }), {
        message: "父词袋不存在。",
        statusCode: 404,
        code: "parent_word_bag_not_found"
      });
      await expectWordCloudError(repository.addKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBag: { wordBagId: "topic-root", label: "Duplicate" }
      }), {
        message: "词袋 ID 已存在：topic-root",
        statusCode: 409,
        code: "word_bag_id_duplicate"
      });

      const added = await repository.addKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBag: {
          title: "Generated Id Bag",
          terms: [{ term: "delta" }]
        }
      });
      expect(added.wordBag.wordBagId).toMatch(/^word-bag-/);

      await expectWordCloudError(repository.updateKnowledgeWordBag({ wordBagSetId: "cloud-boundary" }), {
        message: "缺少 wordBagId。",
        statusCode: 400,
        code: "word_bag_id_required"
      });
      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "missing",
        wordBagId: "topic-root",
        patch: { summary: "x" }
      }), {
        message: "词袋集合不存在。",
        statusCode: 404,
        code: "word_bag_set_not_found"
      });
      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "missing",
        patch: { children: [] }
      }), {
        message: "词袋不存在。",
        statusCode: 404,
        code: "word_bag_not_found"
      });
      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "default",
        patch: { title: "Cannot rename preset" }
      }), {
        message: "预设词袋标题不能更改。",
        statusCode: 409,
        code: "preset_word_bag_title_update_forbidden"
      });
      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "topic-root",
        patch: { childWordBagIds: ["missing-child"] }
      }), {
        message: "子词袋不存在：missing-child",
        statusCode: 404,
        code: "child_word_bag_not_found"
      });
      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "topic-root",
        patch: { parentWordBagId: "topic-child" }
      }), {
        message: "父词袋不存在，或不能移动到自己的子树里。",
        statusCode: 404,
        code: "parent_word_bag_not_found"
      });

      const reordered = await repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "topic-root",
        patch: {
          children: [
            {
              wordBagId: "topic-child",
              label: "Child Replaced",
              terms: [{ term: "epsilon" }]
            },
            {
              label: "Inserted Child",
              terms: [{ term: "delta" }]
            }
          ],
          layout: {
            x: 200,
            y: -10,
            width: 4,
            height: 150,
            zIndex: 99,
            color: "red"
          },
          relation: "absorbs",
          absorbThreshold: 5
        }
      });
      expect(reordered).toMatchObject({
        ok: true,
        action: "updated",
          wordBag: {
            wordBagId: "topic-root",
            relation: "absorbs",
            x: 84,
            y: 0,
            width: 12,
          height: 90,
          zIndex: 60,
          color: "red"
        }
      });
      expect(reordered.wordBag.children.map((child) => child.label)).toEqual(["Child Replaced", "Inserted Child"]);
      expect(reordered.wordBag.children[1].wordBagId).toMatch(/^word-bag-/);

      const moved = await repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "topic-sibling",
        patch: { parentWordBagId: "topic-root" }
      });
      expect(moved.wordBag.parentWordBagId).toBe("topic-root");

      await expectWordCloudError(repository.deleteKnowledgeWordBag({ wordBagSetId: "cloud-boundary" }), {
        message: "缺少 wordBagId。",
        statusCode: 400,
        code: "word_bag_id_required"
      });
      await expectWordCloudError(repository.deleteKnowledgeWordBag({ wordBagSetId: "missing", wordBagId: "topic-root" }), {
        message: "词袋集合不存在。",
        statusCode: 404,
        code: "word_bag_set_not_found"
      });
      await expectWordCloudError(repository.deleteKnowledgeWordBag({ wordBagSetId: "cloud-boundary", wordBagId: "default" }), {
        message: "预设词袋不能删除。",
        statusCode: 409,
        code: "preset_word_bag_delete_forbidden"
      });
      await expectWordCloudError(repository.deleteKnowledgeWordBag({ wordBagSetId: "cloud-boundary", wordBagId: "missing" }), {
        message: "词袋不存在。",
        statusCode: 404,
        code: "word_bag_not_found"
      });

      const deleted = await repository.deleteKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: added.wordBag.wordBagId
      });
      expect(deleted).toMatchObject({
        ok: true,
        action: "deleted",
        deletedWordBagId: added.wordBag.wordBagId,
        defaultWordBagId: "default"
      });
      expect(deleted.returnedTermCount).toBeGreaterThan(0);
    });
  });

  it("covers word bag term lookup defaults, dedupe, missing ids, and target hydration", async () => {
    await withTempRepository(async ({ repository }) => {
      await expectWordCloudError(repository.getKnowledgeWordBagTerms({ wordBagId: "missing" }), {
        message: "词袋集合不存在。",
        statusCode: 404,
        code: "word_bag_set_not_found"
      });

      await seedWordCloud(repository);
      const terms = await repository.getKnowledgeWordBagTerms({
        ids: "topic-root, topic-root topic-child missing",
        includeChildren: false
      });
      expect(terms).toMatchObject({
        ok: true,
        wordBagSetId: "cloud-boundary",
        includeChildren: false,
        requestedWordBagIds: ["topic-root", "topic-child", "missing"],
        missingWordBagIds: ["missing"]
      });
      expect(terms.groups).toHaveLength(2);
      expect(terms.groups[0]).toMatchObject({
        wordBagId: "topic-root",
        includeChildren: false,
        sourceWordBagIds: ["topic-root"]
      });
      expect(terms.terms.map((term) => term.term)).toEqual(expect.arrayContaining(["alpha", "beta"]));

      const targetedState = await repository.getKnowledgeWordCloudState({
        wordBagSetId: "cloud-boundary",
        wordBagId: "topic-child",
        setLimit: 1,
        termLimit: 3
      });
      expect(targetedState).toMatchObject({
        ok: true
      });
      expect(targetedState.wordBagSet.wordBagSetId).toBe("cloud-boundary");
      expect(targetedState.wordBagSet.wordBags).toHaveLength(1);
      expect(targetedState.wordBagSet.wordBags[0].wordBagId).toBe("topic-child");
      expect(targetedState.wordBagSets).toHaveLength(1);
      expect(targetedState.terms.length).toBeLessThanOrEqual(3);
    });
  });

  it("covers JSONL word-bag update, target misses, and snapshot fallback when manifest parsing fails", async () => {
    await withTempRepository(async ({ root, repository }) => {
      await seedWordCloud(repository);

      const updated = await repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "topic-root",
        patch: {
          title: "Retitled Topic",
          description: "Updated through the per-bag JSONL path",
          relation: "related",
          x: 14,
          y: 15,
          width: 44,
          height: 33,
          zIndex: 6,
          color: "blue",
          terms: ["alpha", "ALPHA", { term: "delta" }],
          removedTerms: ["beta", ""]
        }
      });
      expect(updated).toMatchObject({
        ok: true,
        action: "updated",
        wordBag: {
          wordBagId: "topic-root",
          label: "Retitled Topic",
          summary: "Updated through the per-bag JSONL path",
          relation: "related",
          x: 14,
          y: 15,
          width: 44,
          height: 33,
          zIndex: 6,
          color: "blue"
        }
      });
      expect(updated.wordBag.terms.map((term) => term.term)).toEqual(["alpha", "delta"]);
      expect(updated.wordBag.removedTerms.map((term) => term.term)).toEqual(["beta"]);

      const withChildren = await repository.getKnowledgeWordBagTerms({
        wordBagSetId: "cloud-boundary",
        wordBagIds: ["topic-root"]
      });
      expect(withChildren.includeChildren).toBe(true);
      expect(withChildren.groups[0].sourceWordBagIds).toEqual(["topic-root", "topic-child"]);

      const missingTarget = await repository.getKnowledgeWordCloudState({
        wordBagSetId: "cloud-boundary",
        wordBagId: "missing-target"
      });
      expect(missingTarget.wordBagSet.wordBags).toEqual([]);

      const manifestPath = path.join(root, "knowledge-word-clouds", "cloud-boundary", "manifest.jsonl");
      await fs.writeFile(manifestPath, "{bad-json}\n", "utf8");
      const fallback = await repository.getKnowledgeWordCloudState({ wordBagSetId: "cloud-boundary" });
      expect(fallback.wordBagSet.wordBags.map((wordBag) => wordBag.wordBagId)).toEqual(
        expect.arrayContaining(["topic-root", "default", "other"])
      );

      await expectWordCloudError(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-boundary",
        wordBagId: "topic-root",
        patch: { summary: "manifest is unavailable" }
      }), {
        message: "词袋集合不存在。",
        statusCode: 404,
        code: "word_bag_set_not_found"
      });
    });
  });

  it("covers copy import id collisions and legacy word-bag normalization inputs", async () => {
    await withTempRepository(async ({ repository }) => {
      await seedWordCloud(repository);
      const exported = await repository.exportKnowledgeWordCloudSet({ wordBagSetId: "cloud-boundary" });
      const suffix = (1234).toString(36);
      await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: `cloud-boundary-import-${suffix}`,
          title: "Occupied Import Id",
          termsSnapshot: [{ term: "occupied", frequency: 1 }],
          wordBags: [{ wordBagId: "occupied-bag", label: "Occupied", terms: ["occupied"] }]
        }
      });

      const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
      try {
        const copied = await repository.importKnowledgeWordCloudSet({
          mode: "copy",
          wordBagExport: {
            ...exported,
            wordBagSet: {
              ...exported.wordBagSet,
              termsSnapshot: [
                { term: "", frequency: 10 },
                { term: "Zeta", frequency: 4.8, weight: -1 },
                { term: "zeta", frequency: 9 }
              ],
              wordBags: [
                {
                  id: "legacy-root",
                  title: "Legacy Root",
                  terms: ["Zeta", "", { term: "Unknown", frequency: 2 }],
                  subgroups: [
                    {
                      cloudId: "legacy-child",
                      title: "Legacy Child",
                      terms: [{ term: "Zeta", removed: true }]
                    }
                  ]
                }
              ],
              corpusPaths: "docs/a.txt, docs/a.txt\nfolder",
              agentModelAlias: "model-alias-from-import",
              agentResponse: "ignored"
            }
          }
        });

        expect(copied).toMatchObject({
          ok: true,
          action: "imported",
          mode: "copy",
          importedFromWordBagSetId: "cloud-boundary",
          wordBagSet: {
            wordBagSetId: `cloud-boundary-import-${suffix}-1`,
            modelAlias: "model-alias-from-import",
            agentResponse: {}
          }
        });
        expect(copied.wordBagSet.termsSnapshot).toEqual([
          { term: "Zeta", frequency: 4, weight: 0, quality: "", removed: false }
        ]);
        expect(copied.wordBagSet.wordBags[0]).toMatchObject({
          wordBagId: "legacy-root",
          label: "Legacy Root",
          children: [expect.objectContaining({ wordBagId: "legacy-child" })]
        });
        expect(copied.wordBagSet.corpusPaths).toEqual([
          { path: "docs/a.txt", type: "" },
          { path: "folder", type: "" }
        ]);
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });
});
