import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createKnowledgeRepository } from "../../../server/platform/common/storage/knowledge-repository.mjs";
import {
  getMetadataDatabasePath,
  initializeMetadataSchema,
} from "../../../server/platform/common/storage/schema-manager.mjs";

const FIXED_NOW = "2026-06-04T00:00:00.000Z";

async function withKnowledgeRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-repository-test-"));
  const dbPath = getMetadataDatabasePath(root);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  initializeMetadataSchema(db);
  const repository = createKnowledgeRepository({ db });

  try {
    return await testCase({ root, db, dbPath, repository });
  } finally {
    db.close();
    await fs.rm(root, { force: true, recursive: true });
  }
}

function buildResult({
  batchId = "batch-initial",
  includeInvalidRetrievalItem = true,
  idPrefix = "",
}) {
  const safePrefix = idPrefix ? `${idPrefix}-` : "";
  const txId = `${safePrefix}tx-1`;
  const threadId = `${safePrefix}thread-1`;
  const messageId = `${safePrefix}message-1`;
  const personId = `${safePrefix}alice`;

  return {
    generatedAt: FIXED_NOW,
    overview: {
      summary: `Overview ${batchId}`,
    },
    transactions: [
      {
        id: txId,
        title: "Transaction Alpha",
        summary: "A transaction needs review",
        status: "new",
        keywords: ["finance", "invoice", "Finance"],
        categories: ["财务"],
        participantIds: [`person::${personId}`],
        threadIds: [threadId],
        messageIds: [messageId],
        lifecycle: {
          state: "active",
        },
        timeWeight: 0.5,
        freshness: "recent",
        formalUseAllowed: true,
      },
      {
        id: txId,
        title: "Transaction Alpha Duplicate",
        summary: "should be deduped",
        status: "new",
      },
    ],
    threads: [
      {
        id: threadId,
        subject: "Thread Alpha",
        summary: "Important thread",
        status: "open",
        keywords: ["thread", "finance"],
        participantIds: [`person::${personId}`, `person::${safePrefix}bob`],
        senderIds: ["sender-1"],
        messageIds: [messageId, `${safePrefix}message-2`],
        transactionId: txId,
        pendingSignals: ["sig-1"],
        timeWeight: 0.2,
        freshness: "current",
        formalUseAllowed: true,
      },
    ],
    emails: [
      {
        id: messageId,
        subject: "Message One",
        excerpt: "summary of message one",
        status: "processed",
        keywords: ["mail", "thread"],
        sentAt: FIXED_NOW,
        sourceId: "source-1",
        rawObjectId: `${safePrefix}raw-1`,
        threadId,
        transactionId: txId,
        participantIds: [`person::${personId}`],
        chunkIds: ["chunk-legacy"],
        messageIdHeader: `${safePrefix}msg-1`,
      },
    ],
    people: [
      {
        id: personId,
        name: "Alice",
        primaryEmail: "alice@example.com",
        summary: "Ops lead",
        role: "owner",
        topTopics: ["finance", "governance"],
        departments: ["Finance", "finance"],
        participantIds: [],
        sentCount: 3,
        receivedCount: 9,
        transactionCount: 1,
        firstSeenAt: FIXED_NOW,
        lastSeenAt: FIXED_NOW,
        timeWeight: 0.8,
        freshness: "recent",
      },
    ],
    timeline: [
      {
        id: `${safePrefix}timeline-1`,
        title: "Timeline item",
        summary: "timeline summary",
        type: "note",
        source: "mail",
        messageId,
        threadId,
        transactionId: txId,
        participantIds: [`person::${personId}`],
        timestamp: FIXED_NOW,
        lineageId: "lineage-1",
        timeWeight: 0.3,
        freshness: "current",
      },
    ],
    retrieval: {
      jobId: `job-${batchId}`,
      items: [
        {
          id: `retrieval::thread::${threadId}`,
          entityType: "thread",
          text: "Thread evidence snippet",
          snippet: "Thread evidence snippet",
          source: "email",
          timestamp: FIXED_NOW,
          keywords: ["thread", "alpha"],
          participantIds: [`person::${personId}`],
          threadId,
          reviewDueAt: "2026-07-01",
          formalUseAllowed: true,
          transactionId: txId,
        },
        includeInvalidRetrievalItem
          ? {
              id: "invalid-type-id",
              entityType: "invalid",
              text: "should be skipped",
            }
          : null,
      ].filter(Boolean),
    },
    network: {
      nodes: [
        {
          id: `person::${personId}`,
          kind: "person",
          label: "Alice",
          summary: "person node",
          timeWeight: 0.4,
        },
        {
          id: txId,
          kind: "transaction",
          label: "Tx Node",
          summary: "derived tx",
          timeWeight: 0.9,
        },
      ],
      edges: [
        {
          id: "e-person-thread",
          sourceId: `person::${personId}`,
          targetId: threadId,
          relation: "mention",
          weight: 2,
          evidenceIds: [messageId, `${safePrefix}message-2`],
        },
      ],
    },
  };
}

describe("knowledge repository coverage", () => {
  it("initializes schema and exposes empty-state flows", async () => {
    await withKnowledgeRepository(({ repository, db }) => {
      const summary = repository.getStorageSummary();
      expect(summary).toMatchObject({
        itemCount: 0,
        chunkCount: 0,
        evidenceCount: 0,
        graphNodeCount: 0,
        graphEdgeCount: 0,
        pendingReviewCount: 0,
      });

      expect(repository.getItem()).toBeNull();
      expect(repository.search({ query: "missing", limit: 5 })).toEqual({
        query: "missing",
        limit: 5,
        itemTypes: [],
        items: [],
      });
      expect(repository.search({})).toEqual({
        query: "",
        limit: 20,
        itemTypes: [],
        items: [],
      });
      expect(repository.listReviewItems()).toEqual({
        status: "pending",
        items: [],
      });
      expect(repository.getGraph({ seed: "not-exist", depth: 10, limit: 5 })).toEqual({
        seed: "not-exist",
        depth: 3,
        nodes: [],
        edges: [],
      });
      expect(repository.sync()).toMatchObject({
        cursor: "0",
        latestCursor: "0",
        hasMore: false,
        changes: [],
      });

      const indexNames = db
        .prepare("PRAGMA index_list(knowledge_items)")
        .all()
        .map((row) => row.name);
      expect(indexNames).toContain("idx_knowledge_items_type_updated");
      expect(indexNames).toContain("idx_knowledge_items_batch");
    });
  });

  it("builds canonical knowledge and persists item/chunk/evidence/graph records", () => {
    return withKnowledgeRepository(({ repository, db }) => {
      const batchId = "batch-canonical";
      const canonical = repository.buildCanonicalKnowledge({
        batchId,
        result: buildResult({ batchId }),
      });

      expect(canonical.version).toBe(1);
      expect(canonical.batchId).toBe(batchId);
      expect(canonical.collections).toHaveLength(1);
      expect(canonical.items.map((item) => item.itemId)).toContain("transaction::tx-1");
      expect(canonical.items.map((item) => item.itemId)).toContain("thread::thread-1");
      expect(canonical.chunks).toHaveLength(1);
      expect(canonical.evidence).toHaveLength(1);
      expect(canonical.graph.nodes.length).toBe(6);
      expect(canonical.graph.edges.length).toBe(4);

      repository.persistCanonicalKnowledge({
        batchId,
        knowledge: canonical,
      });

      const summary = repository.getStorageSummary();
      expect(summary.itemCount).toBe(5);
      expect(summary.chunkCount).toBe(1);
      expect(summary.evidenceCount).toBe(1);
      expect(summary.graphNodeCount).toBe(6);
      expect(summary.graphEdgeCount).toBe(4);
      expect(summary.pendingReviewCount).toBe(0);

      const transactionItem = repository.getItem({ itemId: "transaction::tx-1" });
      expect(transactionItem).toMatchObject({
        itemId: "transaction::tx-1",
        itemType: "transaction",
        revision: 1,
        tags: ["finance", "invoice"],
        entity: expect.objectContaining({ latestActivityAt: "" }),
      });
      expect(transactionItem.chunks).toEqual([]);
      expect(transactionItem.evidence).toEqual([]);
      expect(transactionItem.graphHints.length).toBeGreaterThan(0);

      const threadItem = repository.getItem({ entityType: "thread", entityId: "thread-1" });
      expect(threadItem).toMatchObject({
        itemId: "thread::thread-1",
        itemType: "thread",
      });
      expect(threadItem.chunks[0]).toMatchObject({
        chunkId: `batch-canonical::chunk::retrieval::thread::thread-1`,
        itemId: "thread::thread-1",
      });
      expect(threadItem.evidence[0]).toMatchObject({
        itemId: "thread::thread-1",
        sourceKind: "thread",
      });

      const searchAll = repository.search({ batchId, query: "finance", limit: 50 });
      expect(searchAll.items.length).toBeGreaterThanOrEqual(2);
      expect(searchAll.items.some((item) => item.itemType === "transaction")).toBe(true);

      const searchOnlyThread = repository.search({
        batchId,
        query: "",
        itemTypes: ["thread"],
        limit: 0,
      });
      expect(searchOnlyThread.itemTypes).toEqual(["thread"]);
      expect(searchOnlyThread.limit).toBe(20);
      expect(searchOnlyThread.items).toEqual([
        expect.objectContaining({ itemId: "thread::thread-1" }),
      ]);

      const graphDepthZero = repository.getGraph({
        seed: "transaction::tx-1",
        depth: -1,
      });
      expect(graphDepthZero.edges).toEqual([]);

      const graphDepthOne = repository.getGraph({
        seed: "transaction::tx-1",
        depth: 1,
        limit: 3,
      });
      expect(graphDepthOne.nodes.some((node) => node.nodeId === "transaction::tx-1")).toBe(true);
      expect(graphDepthOne.nodes.some((node) => node.nodeId === "thread::thread-1")).toBe(true);

      const batchPaths = db
        .prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE batch_id = ?")
        .get(batchId);
      expect(batchPaths.n).toBe(5);
      expect(db.prepare("SELECT COUNT(*) AS n FROM knowledge_graph_edges WHERE batch_id = ?").get(batchId).n).toBe(4);
    });
  });

  it("supports apply/resolve conflicts, duplicates, and review resolution", async () => {
    await withKnowledgeRepository(async ({ repository }) => {
      const batchId = "batch-changes";
      repository.persistCanonicalKnowledge({
        batchId,
        knowledge: repository.buildCanonicalKnowledge({
          batchId,
          result: buildResult({ batchId }),
        }),
      });

      const applied = repository.submitChanges({
        changes: [
          {
            operationId: "op-apply",
            entityType: "transaction",
            entityId: "tx-1",
            baseRevision: 1,
            clientId: "client-1",
            fieldPatch: {
              title: "  Transaction Alpha Updated  ",
              summary: "  updated summary  ",
              status: "in-review",
              tags: ["Finance", "risk", "risk"],
              categories: ["review", "finance", "review"],
              metadata: { shouldIgnore: true },
              relationNotes: "ignored",
              classification: "sensitive",
            },
          },
        ],
      });
      expect(applied.ok).toBe(true);
      expect(applied.accepted).toHaveLength(1);
      expect(applied.conflicts).toHaveLength(0);
      expect(applied.accepted[0].item).toMatchObject({
        itemId: "transaction::tx-1",
        title: "Transaction Alpha Updated",
        status: "in-review",
        tags: ["Finance", "risk"],
        categories: ["review", "finance"],
        metadata: expect.objectContaining({
          clientStructuredPatch: expect.objectContaining({
            classification: "sensitive",
            patchedAt: expect.any(String),
          }),
        }),
      });

      const conflict = repository.submitChanges({
        changes: [
          {
            operationId: "op-conflict",
            entityType: "transaction",
            entityId: "tx-1",
            baseRevision: 1,
            fieldPatch: {
              status: "closed",
            },
          },
        ],
      });
      expect(conflict.ok).toBe(true);
      expect(conflict.conflicts).toHaveLength(1);
      expect(conflict.conflicts[0].reviewItem).toMatchObject({
        status: "pending",
        reason: "revision_conflict",
        entityType: "transaction",
      });

      const missing = repository.submitChanges({
        changes: [
          {
            operationId: "op-missing",
            entityType: "thread",
            entityId: "thread-missing",
            baseRevision: 0,
            fieldPatch: {
              title: "Ghost",
            },
          },
        ],
      });
      expect(missing.ok).toBe(true);
      expect(missing.conflicts).toHaveLength(1);
      expect(missing.conflicts[0].reviewItem.reason).toBe("missing_entity");

      const pending = repository.listReviewItems();
      expect(pending.items).toHaveLength(2);
      const missingReview = pending.items.find((item) => item.reason === "missing_entity");
      expect(missingReview).toBeTruthy();

      const duplicate = repository.submitChanges({
        changes: [
          {
            operationId: "op-apply",
            entityType: "transaction",
            entityId: "tx-1",
            baseRevision: 2,
            fieldPatch: {
              title: "Again",
            },
          },
        ],
      });
      expect(duplicate.duplicates).toHaveLength(1);

      const merged = repository.resolveReviewItem({
        reviewId: missingReview.reviewId,
        resolution: "merge",
        patch: {
          summary: "merged by maintainer",
        },
      });
      expect(merged).toMatchObject({
        reason: "missing_entity",
        status: "resolved",
      });

      const resolved = repository.resolveReviewItem({
        reviewId: pending.items.find((item) => item.reason === "revision_conflict").reviewId,
        resolution: "accept",
        patch: {
          status: "in-review",
          summary: "manual-accept",
        },
      });
      expect(resolved.status).toBe("resolved");

      expect(repository.listReviewItems({ status: "resolved" }).items.length).toBeGreaterThanOrEqual(2);
      expect(repository.listReviewItems({ status: "" }).items.length).toBeGreaterThanOrEqual(2);
      expect(repository.getItem({ itemId: "transaction::tx-1" })).toMatchObject({
        revision: 3,
      });
    });
  });

  it("sync pagination and safe-limit branches", async () => {
    await withKnowledgeRepository(async ({ repository }) => {
      const batchId = "batch-sync";
      repository.persistCanonicalKnowledge({
        batchId,
        knowledge: repository.buildCanonicalKnowledge({
          batchId,
          result: buildResult({ batchId }),
        }),
      });

      const baseline = repository.sync({ limit: 1 });
      expect(baseline.changes).toHaveLength(1);
      expect(baseline.hasMore).toBe(true);
      expect(Number(baseline.cursor)).toBeGreaterThan(0);

      const next = repository.sync({ since: baseline.cursor, limit: 500 });
      expect(Number(next.cursor)).toBeGreaterThan(Number(baseline.cursor));
      expect(next.latestCursor).toBe(baseline.latestCursor);

      const all = repository.sync({ since: next.cursor, limit: 500 });
      expect(all.changes).toHaveLength(0);
      expect(all.hasMore).toBe(false);
    });
  });

  it("handles damaged JSON in persisted records while remaining query-safe", async () => {
    await withKnowledgeRepository(async ({ repository, db }) => {
      const batchId = "batch-bad-json";
      repository.persistCanonicalKnowledge({
        batchId,
        knowledge: repository.buildCanonicalKnowledge({
          batchId,
          result: buildResult({ batchId }),
        }),
      });

      db.prepare(
        `
        UPDATE knowledge_items
        SET tags_json = '{bad', categories_json = '{bad', entity_json = '{bad', metadata_json = '{bad'
        WHERE item_id = 'thread::thread-1'
        `
      ).run();
      db.prepare(
        `
        UPDATE knowledge_evidence
        SET locator_json = '{bad', chunk_id = 'missing-chunk'
        WHERE item_id = 'thread::thread-1'
        `
      ).run();
      db.prepare(
        `
        UPDATE knowledge_graph_edges
        SET evidence_ids_json = '{bad'
        WHERE edge_id IN (
          SELECT edge_id FROM knowledge_graph_edges
          WHERE source_id = ? OR target_id = ? LIMIT 1
        )
        `
      ).run("thread::thread-1", "thread::thread-1");
      db.prepare(
        `
        UPDATE knowledge_graph_nodes
        SET metadata_json = '{bad'
        WHERE node_id IN (
          SELECT node_id FROM knowledge_graph_nodes WHERE item_id = 'thread::thread-1' LIMIT 1
        )
        `
      ).run();

      const threadItem = repository.getItem({ itemId: "thread::thread-1" });
      expect(threadItem.tags).toEqual([]);
      expect(threadItem.categories).toEqual([]);
      expect(threadItem.entity).toEqual({});
      expect(threadItem.metadata).toEqual({});
      expect(threadItem.evidence[0].locator).toEqual({});

      const graph = repository.getGraph({ seed: "thread::thread-1", depth: 2, limit: 20 });
      expect(graph.nodes.some((node) => node.nodeId === "thread::thread-1")).toBe(true);
      expect(graph.edges.length).toBeGreaterThan(0);
    });
  });

  it("rebuilds missing indexes when schema initialization runs again", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-repository-index-"));
    const dbPath = getMetadataDatabasePath(root);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    initializeMetadataSchema(db);

    try {
      const before = db.prepare("PRAGMA index_list(knowledge_items)").all().map((row) => row.name);
      expect(before).toContain("idx_knowledge_items_type_updated");

      db.exec("DROP INDEX idx_knowledge_items_type_updated");
      const afterDrop = db.prepare("PRAGMA index_list(knowledge_items)").all().map((row) => row.name);
      expect(afterDrop).not.toContain("idx_knowledge_items_type_updated");

      initializeMetadataSchema(db);
      const after = db.prepare("PRAGMA index_list(knowledge_items)").all().map((row) => row.name);
      expect(after).toContain("idx_knowledge_items_type_updated");
    } finally {
      db.close();
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it("deletes one batch without touching others", async () => {
    await withKnowledgeRepository(async ({ repository, db }) => {
      repository.persistCanonicalKnowledge({
        batchId: "batch-delete",
        knowledge: repository.buildCanonicalKnowledge({
          batchId: "batch-delete",
          result: buildResult({
            batchId: "batch-delete",
            idPrefix: "delete",
          }),
        }),
      });
      repository.persistCanonicalKnowledge({
        batchId: "batch-keep",
        knowledge: repository.buildCanonicalKnowledge({
          batchId: "batch-keep",
          result: buildResult({
            batchId: "batch-keep",
            idPrefix: "keep",
          }),
        }),
      });

      expect(repository.getStorageSummary().itemCount).toBe(10);
      repository.deleteBatch("batch-delete");
      expect(repository.getStorageSummary().itemCount).toBe(5);
      expect(repository.getItem({ itemId: "transaction::delete-tx-1" })).toBeNull();

      const keep = db.prepare(`
        SELECT COUNT(*) AS n
        FROM knowledge_items
        WHERE batch_id = 'batch-keep'
      `).get();
      expect(keep.n).toBe(5);
    });
  });
});
