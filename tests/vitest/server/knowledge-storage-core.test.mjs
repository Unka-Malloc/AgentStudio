import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKnowledgeCoreMount } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";

function hashSha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-test-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({ userDataPath, outlineEnabled: false });
    return await testCase({
      mount,
      userDataPath,
      storeRoot: path.join(userDataPath, "knowledge-core")
    });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

function buildSearchDocument(input = {}) {
  const documentId = String(input.documentId || `doc-${Math.random().toString(36).slice(2)}`);
  const sectionId = `${documentId}-section`;
  const blockId = `${documentId}-block`;
  return {
    documentId,
    batchId: input.batchId || "batch-manual",
    sourceId: input.sourceId || `source-${documentId}`,
    sourcePath: input.sourcePath || `source/${documentId}.txt`,
    sourceHash: input.sourceHash || `sha-${documentId}`,
    documentType: input.documentType || "message",
    title: input.title || `文档 ${documentId}`,
    summary: input.summary || `摘要 ${documentId}`,
    metadata: {
      fixture: true,
      ...(input.metadata || {})
    },
    sections: [
      {
        sectionId,
        documentId,
        title: "正文",
        level: 1,
        position: 1,
        metadata: { fixture: true }
      }
    ],
    blocks: [
      {
        blockId,
        documentId,
        sectionId,
        blockType: "text",
        title: "正文",
        text: String(input.blockText || "正文内容"),
        snippet: String(input.blockText || "正文内容").slice(0, 40),
        position: 1,
        sourceLocator: {
          batchId: input.batchId || "batch-manual",
          sourceId: input.sourceId || `source-${documentId}`
        },
        metadata: { fixture: true }
      }
    ],
    assets: input.assets || []
  };
}

describe("knowledge-core store", () => {
  it("reads default settings and deep-merges patch updates", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const before = mount.getMaintenance();
      expect(before.retrieval?.topK).toBe(20);

      const after = mount.setMaintenance({
        retrieval: { topK: 13, bm25Weight: 0.42 },
        maintenance: { staleIndexHours: 18 },
        markdown: { includeMachineReadableAppendix: false },
        learning: { minFeedbackForAutoTune: 2 }
      });

      expect(after.retrieval.topK).toBe(13);
      expect(after.retrieval.bm25Weight).toBe(0.42);
      expect(after.maintenance.staleIndexHours).toBe(18);
      expect(after.markdown.includeMachineReadableAppendix).toBe(false);
      expect(after.learning.minFeedbackForAutoTune).toBe(2);

      const current = mount.getMaintenance();
      expect(current.retrieval.topK).toBe(13);
      expect(current.markdown.includeMachineReadableAppendix).toBe(false);
      expect(current.maintenance.staleIndexHours).toBe(18);
    });
  });

  it("rejects batch ingest when batchId is missing", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await expect(mount.ingestBatch({ result: {} })).rejects.toThrow("knowledge.ingest.batch 缺少 batchId。" );
    });
  });

  it("deduplicates duplicated batch sources and emits review items", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const result = await mount.ingestBatch({
        batchId: "batch-dedup",
        result: {
          sourceFiles: [
            { id: "source-1", path: "duplicate.txt", name: "duplicate", text: "first copy" },
            { id: "source-2", path: "duplicate.txt", name: "duplicate", text: "first copy" }
          ]
        }
      });

      expect(result.receivedDocumentCount).toBe(2);
      expect(result.documentCount).toBe(1);
      expect(result.deduplicatedIncomingCount).toBe(1);
      expect(result.skippedConflictCount).toBe(1);
      expect(result.reviewItems).toHaveLength(1);
      expect(result.reviewItems[0].reason).toBe("duplicate_source_document");
    });
  });

  it("surfaces source-path content conflicts and skips conflicted ingest", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await mount.ingestBatch({
        batchId: "batch-conflict-a",
        result: {
          sourceFiles: [{ id: "source-1", path: "same.txt", name: "same", text: "old content" }]
        }
      });

      const result = await mount.ingestBatch({
        batchId: "batch-conflict-b",
        result: {
          sourceFiles: [{ id: "source-2", path: "same.txt", name: "same", text: "new different content" }]
        }
      });

      expect(result.documentCount).toBe(0);
      expect(result.skippedConflictCount).toBe(1);
      expect(result.reviewItems).toHaveLength(1);
      expect(result.reviewItems[0].reason).toBe("source_path_content_conflict");
    });
  });

  it("validates ingestSources argument requirements and mode tag", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await expect(mount.ingestSources({ sources: [] })).rejects.toThrow("knowledge.ingest.sources 缺少 batchId。" );

      const result = await mount.ingestSources({
        batchId: "batch-sources",
        sources: [{
          id: "source-image",
          path: "image.txt",
          name: "image",
          text: "source ingest text"
        }]
      });

      expect(result.mode).toBe("incremental-source");
      expect(result.documentCount).toBe(1);
      expect(result.receivedDocumentCount).toBe(1);
    });
  });

  it("normalizes upserted documents and deduplicates by source key", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const sourcePath = "manual-normalize.txt";
      const firstDoc = buildSearchDocument({
        documentId: "doc-normalize",
        sourcePath,
        sourceHash: `manual-hash-${sourcePath}`,
        sourceId: "normalize-1",
        blockText: "one two three"
      });
      const duplicatedDoc = buildSearchDocument({
        documentId: "doc-normalize-dup",
        sourcePath: "manual-normalize-other.txt",
        sourceHash: "manual-hash-manual-normalize-dup",
        sourceId: "normalize-2",
        blockText: "one two three"
      });

      const result = await mount.upsertDocuments({
        documents: [firstDoc, duplicatedDoc]
      });

      expect(result.documentCount).toBe(2);
      expect(result.receivedDocumentCount).toBe(2);
      expect(result.deduplicatedIncomingCount).toBe(0);
      expect(result.skippedConflictCount).toBe(0);
      expect(result).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        documentCount: 2,
        receivedDocumentCount: 2,
        skippedConflictCount: 0
      });

      const stored = mount.getItem({ documentId: "doc-normalize" });
      expect(stored.collectionId).toBe("manual");
      expect(stored.sections).toHaveLength(1);
    });
  });

  it("searches in keyword mode with batch filtering and deterministic sorting", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await mount.upsertDocuments({
        documents: [
          buildSearchDocument({
            documentId: "doc-kws-high",
            batchId: "batch-filter",
            sourceId: "source-high",
            blockText: "alpha alpha alpha beta"
          }),
          buildSearchDocument({
            documentId: "doc-kws-low",
            batchId: "batch-filter",
            sourceId: "source-low",
            blockText: "alpha"
          }),
          buildSearchDocument({
            documentId: "doc-other-batch",
            batchId: "batch-other",
            sourceId: "source-other",
            blockText: "alpha"
          })
        ]
      });

      const result = await mount.search({
        query: "alpha",
        batchId: "batch-filter",
        scopeSourceIds: ["source-high", "source-low", "source-other"],
        keywordOnly: true,
        limit: 2
      });

      expect(result.protocolVersion).toBe("pact.knowledge.v1");
      expect(result.learningEnabled).toBe(false);
      expect(result.retrievalMode).toBe("keyword");
      expect(result.profileRoute).toMatchObject({ routedBy: "learning_disabled" });
      expect(result.batchId).toBe("batch-filter");
      expect(result.limit).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].itemId).toBe("doc-kws-high");
      expect(result.items.every((item) => item.batchId === "batch-filter")).toBe(true);
      expect(result.hierarchy).toBeDefined();

      const agentResult = await mount.search({
        query: "alpha",
        batchId: "batch-filter",
        agentMessage: true,
        keywordOnly: true,
        limit: 1
      });
      expect(agentResult.responseProfile).toBe("agent");
      expect(agentResult.agentMessage).toMatchObject({
        protocolVersion: "pact.knowledge-search.agent-message.v1",
        query: "alpha",
        constraints: {
          batchId: "batch-filter"
        }
      });
    });
  });

  it("records feedback and filters recent feedback by time window", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      expect(() => mount.recordFeedback({ clientId: "c1", query: "q" })).toThrow("knowledge.feedback.record 缺少 action。");

      const oldCreatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      await mount.recordFeedback({
        clientId: "c1",
        query: "old query",
        action: "open",
        itemId: "item-old",
        createdAt: oldCreatedAt
      });

      const fresh = await mount.recordFeedback({
        clientId: "c1",
        query: "new query",
        action: "search-miss",
        itemId: "item-new"
      });

      expect(fresh.feedback.action).toBe("search_miss");

      const recent = await mount.feedbackSince({ windowHours: 1, limit: 20 });
      const itemIds = recent.map((entry) => entry.query);
      expect(itemIds).toContain("new query");
      expect(itemIds).not.toContain("old query");
    });
  });

  it("stores and resolves retrieval-profile suggestions", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      expect(mount.resolveSuggestion({ suggestionId: "not-exist" })).toBeNull();

      const output = await mount.runLearningJob({ autoApply: false });
      expect(output.status).toBe("completed");
      expect(output.generatedSuggestionCount).toBeGreaterThan(0);

      const suggestions = mount.listSuggestions({ status: "pending" });
      expect(suggestions.status).toBe("pending");
      expect(suggestions.items.length).toBeGreaterThanOrEqual(1);
      const pending = suggestions.items[0];
      expect(pending.status).toBe("pending");

      const merged = await mount.resolveSuggestion({ suggestionId: pending.suggestionId, resolution: "accept" });
      expect(merged.suggestionId).toBe(pending.suggestionId);
      expect(merged.status).toBe("resolved");
      expect(merged.appliedProfile?.profileId).toBeDefined();

      const afterMerge = mount.listSuggestions({ status: "resolved", limit: 10 });
      expect(afterMerge.items.map((entry) => entry.suggestionId)).toContain(pending.suggestionId);
    });
  });

  it("emits review items and can resolve duplicate-source review records", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const result = await mount.ingestSources({
        batchId: "batch-review",
        sources: [
          { id: "r1", path: "review.txt", text: "review content" },
          { id: "r2", path: "review.txt", text: "review content" }
        ]
      });
      expect(result.reviewItems).toHaveLength(1);

      const list = mount.listReviewItems();
      expect(list.status).toBe("pending");
      expect(list.items).toHaveLength(1);

      const review = await mount.resolveReviewItem({
        reviewId: list.items[0].reviewId,
        resolution: "keep_both"
      });
      expect(review?.status).toBe("resolved");
      expect(review?.resolvedDocument?.documentId).toBeTruthy();
      expect(review?.resolvedDocument?.status ?? "resolved").toBe("resolved");

      const missing = await mount.resolveReviewItem({ reviewId: "does-not-exist" });
      expect(missing).toBeNull();
    });
  });

  it("runs learning job skip path when learning is disabled", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      mount.setMaintenance({
        learning: { enabled: false }
      });

      const output = await mount.runLearningJob();
      expect(output.status).toBe("skipped");
      expect(output.reason).toBe("learning-disabled");
    });
  });

  it("aggregates documents by groupBy fields and sorts by count", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await mount.upsertDocuments({
        documents: [
          buildSearchDocument({
            documentId: "agg-a1",
            batchId: "agg",
            documentType: "email",
            blockText: "From: alpha@example.com\nalpha report"
          }),
          buildSearchDocument({
            documentId: "agg-a2",
            batchId: "agg",
            documentType: "email",
            blockText: "From: alpha@example.com\nalpha follow up"
          }),
          buildSearchDocument({
            documentId: "agg-b1",
            batchId: "agg",
            documentType: "email",
            blockText: "From: beta@example.org\nbeta report"
          })
        ]
      });

      const result = await mount.aggregate({
        metric: "custom-metric",
        groupBy: "senderDomain",
        batchId: "agg",
        documentType: "email"
      });

      expect(result.metric).toBe("custom-metric");
      expect(result.scannedDocumentCount).toBe(3);
      expect(result.matchedDocumentCount).toBe(3);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0]).toMatchObject({ key: "example.com", count: 2 });
      expect(result.groups[1]).toMatchObject({ key: "example.org", count: 1 });
      expect(result.topGroup).toEqual(expect.objectContaining({ key: "example.com", count: 2 }));
      expect(result.ok).toBe(true);
    });
  });

  it("returns asset content and errors for unsafe paths", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const validText = "hello world";
      const validSha = hashSha256(validText);
      const assetDirectory = path.join(storeRoot, "assets", "safe");
      await fs.mkdir(assetDirectory, { recursive: true });
      await fs.writeFile(path.join(assetDirectory, "ok.txt"), validText, "utf8");

      const validDoc = buildSearchDocument({
        documentId: "asset-ok",
        batchId: "asset-batch",
        sourceId: "asset-source-ok",
        sourcePath: "asset/source/ok.txt",
        sourceHash: "asset-ok-sha",
        blockText: "asset-safe-token"
      });
      validDoc.assets = [
        {
          assetId: "asset-ok-id",
          documentId: validDoc.documentId,
          sectionId: validDoc.sections[0].sectionId,
          blockId: validDoc.blocks[0].blockId,
          assetType: "image",
          mediaType: "text/plain",
          title: "ok asset",
          text: "asset payload",
          ocrText: "",
          caption: "asset caption",
          relativePath: "assets/safe/ok.txt",
          sha256: validSha,
          byteSize: Buffer.byteLength(validText),
          sourceLocator: {
            batchId: "asset-batch",
            sourceId: "asset-source-ok"
          }
        }
      ];

      await mount.upsertDocuments({ documents: [validDoc] });
      const item = mount.getItem({ documentId: "asset-ok" });
      const validAssetId = item?.assets?.[0]?.assetId;
      expect(validAssetId).toBe("asset-ok-id");

      const content = await mount.getAssetContent({ assetId: validAssetId });
      expect(content?.asset?.assetId).toBe("asset-ok-id");
      expect(content.fileName).toBe("ok.txt");
      expect(content.contentType).toBe("text/plain");
      expect(content.buffer.toString()).toBe(validText);
      await expect(mount.getAssetContent({ assetId: "not-exist" })).resolves.toBeNull();

      const unsafeDoc = buildSearchDocument({
        documentId: "asset-unsafe",
        batchId: "asset-unsafe-batch",
        sourceId: "asset-source-unsafe",
        sourcePath: "asset/source/unsafe.txt",
        sourceHash: "asset-unsafe-sha",
        blockText: "unsafe-asset-token"
      });
      unsafeDoc.assets = [
        {
          assetId: "asset-unsafe-id",
          documentId: unsafeDoc.documentId,
          sectionId: unsafeDoc.sections[0].sectionId,
          blockId: unsafeDoc.blocks[0].blockId,
          assetType: "image",
          mediaType: "text/plain",
          title: "unsafe asset",
          text: "unsafe asset text",
          ocrText: "",
          caption: "unsafe",
          relativePath: "../outside/unsafe.txt",
          sha256: hashSha256("unsafe"),
          byteSize: Buffer.byteLength("unsafe"),
          sourceLocator: {
            batchId: "asset-batch",
            sourceId: "asset-source-unsafe"
          }
        }
      ];
      await mount.upsertDocuments({ documents: [unsafeDoc] });
      await expect(mount.getAssetContent({ assetId: "asset-unsafe-id" })).rejects.toThrow("知识库资产路径越界。");
    });
  });

  it("validates assets and reports missing/mismatch/unsafe paths", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const baseDirectory = path.join(storeRoot, "assets", "validate");
      await fs.mkdir(baseDirectory, { recursive: true });

      const validPath = "assets/validate/valid.txt";
      const validContent = "valid-content";
      await fs.writeFile(path.join(storeRoot, validPath), validContent, "utf8");

      const mismatchPath = "assets/validate/mismatch.txt";
      await fs.writeFile(path.join(storeRoot, mismatchPath), "stored-content", "utf8");

      const missingPath = "assets/validate/missing.txt";

      const docs = [
        {
          ...buildSearchDocument({
            documentId: "asset-validate-ok",
            batchId: "validate-assets",
            sourcePath: "validate/valid",
            sourceHash: "sha-valid",
            blockText: "alpha"
          }),
          assets: [
            {
              assetId: "asset-validate-ok-id",
              documentId: "asset-validate-ok",
              sectionId: `asset-validate-ok-section`,
              blockId: `asset-validate-ok-block`,
              assetType: "image",
              mediaType: "text/plain",
              title: "valid",
              text: "valid",
              ocrText: "",
              caption: "valid",
              relativePath: validPath,
              sha256: hashSha256(validContent),
              byteSize: Buffer.byteLength(validContent),
              width: 0,
              height: 0,
              sourceLocator: { batchId: "validate-assets" },
              metadata: {}
            }
          ]
        },
        {
          ...buildSearchDocument({
            documentId: "asset-validate-missing-relative",
            batchId: "validate-assets",
            sourcePath: "validate/missing-rel",
            sourceHash: "sha-missing-relative",
            blockText: "alpha"
          }),
          assets: [
            {
              assetId: "asset-validate-missing-relative-id",
              documentId: "asset-validate-missing-relative",
              sectionId: "asset-validate-missing-relative-section",
              blockId: "asset-validate-missing-relative-block",
              assetType: "image",
              mediaType: "text/plain",
              title: "missing relative",
              text: "missing",
              ocrText: "",
              caption: "missing relative",
              relativePath: "",
              sha256: hashSha256("missing-relative"),
              byteSize: 12,
              width: 0,
              height: 0,
              sourceLocator: { batchId: "validate-assets" },
              metadata: {}
            }
          ]
        },
        {
          ...buildSearchDocument({
            documentId: "asset-validate-missing-file",
            batchId: "validate-assets",
            sourcePath: "validate/missing",
            sourceHash: "sha-missing-file",
            blockText: "alpha"
          }),
          assets: [
            {
              assetId: "asset-validate-missing-file-id",
              documentId: "asset-validate-missing-file",
              sectionId: "asset-validate-missing-file-section",
              blockId: "asset-validate-missing-file-block",
              assetType: "image",
              mediaType: "text/plain",
              title: "missing file",
              text: "missing",
              ocrText: "",
              caption: "missing file",
              relativePath: missingPath,
              sha256: hashSha256("missing"),
              byteSize: 7,
              width: 0,
              height: 0,
              sourceLocator: { batchId: "validate-assets" },
              metadata: {}
            }
          ]
        },
        {
          ...buildSearchDocument({
            documentId: "asset-validate-mismatch",
            batchId: "validate-assets",
            sourcePath: "validate/mismatch",
            sourceHash: "sha-mismatch",
            blockText: "alpha"
          }),
          assets: [
            {
              assetId: "asset-validate-mismatch-id",
              documentId: "asset-validate-mismatch",
              sectionId: "asset-validate-mismatch-section",
              blockId: "asset-validate-mismatch-block",
              assetType: "image",
              mediaType: "text/plain",
              title: "mismatch",
              text: "mismatch",
              ocrText: "",
              caption: "mismatch",
              relativePath: mismatchPath,
              sha256: hashSha256("expected-other-content"),
              byteSize: Buffer.byteLength("stored-content"),
              width: 0,
              height: 0,
              sourceLocator: { batchId: "validate-assets" },
              metadata: {}
            }
          ]
        },
        {
          ...buildSearchDocument({
            documentId: "asset-validate-unsafe",
            batchId: "validate-assets",
            sourcePath: "validate/unsafe",
            sourceHash: "sha-unsafe",
            blockText: "alpha"
          }),
          assets: [
            {
              assetId: "asset-validate-unsafe-id",
              documentId: "asset-validate-unsafe",
              sectionId: "asset-validate-unsafe-section",
              blockId: "asset-validate-unsafe-block",
              assetType: "image",
              mediaType: "text/plain",
              title: "unsafe",
              text: "unsafe",
              ocrText: "",
              caption: "unsafe",
              relativePath: "../outside-validate.txt",
              sha256: hashSha256("unsafe"),
              byteSize: 5,
              width: 0,
              height: 0,
              sourceLocator: { batchId: "validate-assets" },
              metadata: {}
            }
          ]
        }
      ];

      for (const doc of docs) {
        await mount.upsertDocuments({ documents: [doc] });
      }

      const result = await mount.runMaintenance({ taskType: "validate_assets" });
      expect(result.taskType).toBe("validate_assets");
      expect(result.status).toBe("completed");
      expect(result.output.checkedAssets).toBe(5);
      expect(result.output.missing.map((entry) => entry.assetId)).toEqual(
        expect.arrayContaining(["asset-validate-missing-relative-id", "asset-validate-missing-file-id"])
      );
      expect(result.output.unsafePaths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetId: "asset-validate-unsafe-id",
            relativePath: "../outside-validate.txt"
          })
        ])
      );
      expect(result.output.shaMismatch).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetId: "asset-validate-mismatch-id"
          })
        ])
      );
    });
  });

  it("returns maintenance failure for unknown task type", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const result = await mount.runMaintenance({ taskType: "mystery-cleanup" });
      expect(result.status).toBe("completed");
      expect(result.output).toEqual({ ok: false, error: "未知知识库维护任务：mystery_cleanup" });
    });
  });
});
