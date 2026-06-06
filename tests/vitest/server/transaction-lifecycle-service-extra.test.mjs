import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createTransactionLifecycleService } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/transaction-lifecycle-service.mjs";
import { initializeMetadataSchema } from "../../../server/platform/common/storage/schema-manager.mjs";

const REFERENCE_TIME = "2026-06-04T00:00:00.000Z";

function addDays(isoTime, deltaDays) {
  const value = new Date(isoTime);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString();
}

function createTestService() {
  const db = new Database(":memory:");
  initializeMetadataSchema(db);
  const service = createTransactionLifecycleService({ db });
  return {
    db,
    service,
    close() {
      db.close();
    }
  };
}

function insertLineage(db, {
  lineageId,
  title = "lineage",
  normalizedSubject = "",
  cadence = "unknown",
  categories = [],
  keywords = [],
  participantIds = [],
  sourceDepartments = [],
  lifecycleState = "active",
  firstSeenAt,
  lastSeenAt,
  lastBatchId = "",
  lastTransactionId = "",
  lastTransactionRecordId = ""
}) {
  db.prepare(`
    INSERT INTO transaction_lineages (
      lineage_id, title, normalized_subject, cadence, categories_json, keywords_json,
      participant_ids_json, source_departments_json, lifecycle_state, first_seen_at, last_seen_at,
      last_batch_id, last_transaction_id, last_transaction_record_id, occurrence_count, batch_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lineageId,
    title,
    normalizedSubject,
    cadence,
    JSON.stringify(categories),
    JSON.stringify(keywords),
    JSON.stringify(participantIds),
    JSON.stringify(sourceDepartments),
    lifecycleState,
    firstSeenAt,
    lastSeenAt,
    lastBatchId,
    lastTransactionId,
    lastTransactionRecordId,
    0,
    0,
    REFERENCE_TIME,
    REFERENCE_TIME
  );
}

function insertLineageHistory(db, {
  lineageId,
  batchId,
  localTransactionId,
  localTransactionRecordId,
  timestamp,
  participantIds = []
}) {
  const timelineEventId = `timeline-${batchId}-${localTransactionId}`;
  db.prepare(`
    INSERT INTO timeline_events (
      record_id, batch_id, timeline_event_id, timestamp, title, summary,
      type, source, transaction_id, participant_ids_json, time_weight, freshness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `te-${batchId}-${localTransactionId}`,
    batchId,
    timelineEventId,
    timestamp,
    "history event",
    "history event summary",
    "message",
    "mail",
    localTransactionId,
    JSON.stringify(participantIds),
    0.75,
    "current"
  );

  db.prepare(`
    INSERT INTO transaction_lineage_runs (
      record_id, lineage_id, batch_id, local_transaction_id, local_transaction_record_id, stage,
      previous_state, next_state, match_score, match_reasons_json,
      pulled_event_count, pulled_batch_count, pulled_transaction_count,
      matched_batch_id, matched_transaction_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `lr-${batchId}-${localTransactionId}`,
    lineageId,
    batchId,
    localTransactionId,
    localTransactionRecordId,
    "matched",
    "active",
    "active",
    0.89,
    JSON.stringify(["subject-exact"]),
    0,
    0,
    0,
    "",
    "",
    timestamp
  );
}

describe("transaction lifecycle service (SQLite)", () => {
  it("classifies lifecycle states by stale window and interruption window", () => {
    const { db, service, close } = createTestService();
    try {
      insertLineage(db, {
        lineageId: "lineage-active",
        normalizedSubject: "active lineage",
        lastSeenAt: addDays(REFERENCE_TIME, -1),
        firstSeenAt: addDays(REFERENCE_TIME, -7),
        lifecycleState: "active"
      });
      insertLineage(db, {
        lineageId: "lineage-interrupted",
        normalizedSubject: "interrupted lineage",
        lastSeenAt: addDays(REFERENCE_TIME, -95),
        firstSeenAt: addDays(REFERENCE_TIME, -60),
        lifecycleState: "active"
      });
      insertLineage(db, {
        lineageId: "lineage-archived",
        normalizedSubject: "archived lineage",
        lastSeenAt: addDays(REFERENCE_TIME, -181),
        firstSeenAt: addDays(REFERENCE_TIME, -181),
        lifecycleState: "active"
      });

      const refreshed = service.refreshTransactionLineageStates(REFERENCE_TIME, {
        transactionWindowDays: 45,
        staleAfterDays: 180
      });
      const byId = new Map(refreshed.map((item) => [item.lineageId, item.lifecycleState]));

      expect(byId.get("lineage-active")).toBe("active");
      expect(byId.get("lineage-interrupted")).toBe("interrupted");
      expect(byId.get("lineage-archived")).toBe("archived");
    } finally {
      close();
    }
  });

  it("matches lineage by normalized subject and enriches pulled timeline history", () => {
    const { db, service, close } = createTestService();
    try {
      insertLineage(db, {
        lineageId: "lineage-history",
        title: "Tax Report",
        normalizedSubject: "tax report q1",
        cadence: "monthly",
        keywords: ["invoice", "summary"],
        participantIds: ["alice", "bob"],
        sourceDepartments: ["finance"],
        lastSeenAt: addDays(REFERENCE_TIME, -3),
        firstSeenAt: addDays(REFERENCE_TIME, -30),
        lastBatchId: "batch-prev"
      });
      insertLineageHistory(db, {
        lineageId: "lineage-history",
        batchId: "batch-prev",
        localTransactionId: "legacy-1",
        localTransactionRecordId: "record-prev-legacy-1",
        timestamp: addDays(REFERENCE_TIME, -3),
        participantIds: ["alice", "bob"]
      });

      const result = service.resolveTransactionLifecycle({
        batchId: "batch-current",
        transactions: [{
          id: "tx-current",
          title: "Tax Report Q1",
          normalizedSubject: "tax report q1",
          startedAt: addDays(REFERENCE_TIME, -1),
          latestActivityAt: addDays(REFERENCE_TIME, 0),
          cadence: "monthly",
          categories: ["finance"],
          keywords: ["invoice", "summary"],
          participantIds: ["alice", "bob"],
          sourceDepartments: ["finance"]
        }],
        timeline: [{
          id: "timeline-current",
          batchId: "batch-current",
          transactionId: "tx-current",
          timestamp: addDays(REFERENCE_TIME, -1),
          title: "current event",
          summary: "current event"
        }],
        generatedAt: REFERENCE_TIME,
        settings: {
          transactionWindowDays: 45,
          staleAfterDays: 180
        }
      });

      const transaction = result.transactions[0];
      expect(transaction.lifecycle).toMatchObject({
        stage: "matched",
        previousState: "active",
        nextState: "active",
        pulledBatchCount: 1,
        pulledTransactionCount: 1,
        pulledEventCount: 1
      });
      expect(transaction.lifecycle.matchReasons).toContain("normalized-subject-exact");
      expect(result.summary.pulledEventCount).toBe(1);
      expect(result.timeline).toHaveLength(2);
      expect(result.summary.matchedCount).toBe(1);
      expect(result.summary.pulledTransactionCount).toBe(1);
      expect(result.summary.activeLineageCount).toBe(1);
      expect(transaction.timelineEventIds).toEqual(
        expect.arrayContaining([
          "timeline-current",
          expect.stringContaining("history::lineage-history::batch-prev::timeline-")
        ])
      );
    } finally {
      close();
    }
  });

  it("recovers interrupted lineage when matching via subject similarity tokens", () => {
    const { db, service, close } = createTestService();
    try {
      insertLineage(db, {
        lineageId: "lineage-similar",
        title: "Invoice processing report Q1",
        normalizedSubject: "invoice processing report q1",
        cadence: "unknown",
        keywords: ["finance", "invoice"],
        participantIds: ["alice", "bob"],
        lastSeenAt: addDays(REFERENCE_TIME, -150),
        firstSeenAt: addDays(REFERENCE_TIME, -2),
        lifecycleState: "active"
      });

      const result = service.resolveTransactionLifecycle({
        batchId: "batch-current",
        transactions: [{
          id: "tx-current",
          title: "Invoice final processing report q1",
          normalizedSubject: "invoice final processing report q1",
          startedAt: addDays(REFERENCE_TIME, -1),
          latestActivityAt: addDays(REFERENCE_TIME, 0),
          keywords: ["finance", "audit"],
          participantIds: ["alice", "bob"],
          categories: ["long-running", "ops"]
        }],
        generatedAt: REFERENCE_TIME,
        settings: {
          transactionWindowDays: 45
        }
      });

      expect(result.transactions[0].lifecycle).toMatchObject({
        stage: "recovered",
        previousState: "interrupted"
      });
      expect(result.transactions[0].lifecycle.matchReasons).toContain("subject-similar");
      expect(result.transactions[0].lifecycle.pulledEventCount).toBe(0);
      expect(result.summary.recoveredCount).toBe(1);
      expect(result.summary.activeLineageCount).toBe(1);
    } finally {
      close();
    }
  });

  it.each([
    { gapDays: 68, expectedStage: "matched" },
    { gapDays: 69, expectedStage: "new" }
  ])(
    "uses continuity window boundary $gapDays day(s) as match cutoff",
    ({ gapDays, expectedStage }) => {
      const { db, service, close } = createTestService();
      try {
        insertLineage(db, {
          lineageId: "lineage-window",
          title: "Continuity Window",
          normalizedSubject: "continuity window",
          cadence: "weekly",
          lastSeenAt: addDays(REFERENCE_TIME, -gapDays),
          firstSeenAt: addDays(REFERENCE_TIME, -gapDays),
          lastBatchId: "batch-prev"
        });

        const result = service.resolveTransactionLifecycle({
          batchId: "batch-current",
          transactions: [{
            id: "tx-current",
            title: "Continuity Window",
            normalizedSubject: "continuity window",
            startedAt: REFERENCE_TIME,
            latestActivityAt: REFERENCE_TIME,
            cadence: "weekly"
          }],
          generatedAt: REFERENCE_TIME,
          settings: {
            transactionWindowDays: 45,
            staleAfterDays: 180
          }
        });

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].lineageId).toBeDefined();
        expect(result.transactions[0].lifecycle.stage).toBe(expectedStage);
      } finally {
        close();
      }
    }
  );

  it("handles empty input as no-op and still returns timeline defaults", () => {
    const { service, close } = createTestService();
    try {
      const result = service.resolveTransactionLifecycle({
        batchId: "batch-empty",
        transactions: [],
        timeline: [{
          id: "timeline-empty",
          transactionId: "",
          timestamp: REFERENCE_TIME
        }],
        generatedAt: REFERENCE_TIME
      });

      expect(result.transactions).toEqual([]);
      expect(result.timeline).toHaveLength(1);
      expect(result.timeline[0]).toMatchObject({
        id: "timeline-empty",
        timelinePhase: "current",
        originBatchId: "batch-empty",
        originTransactionId: ""
      });
      expect(result.summary).toMatchObject({
        newCount: 0,
        matchedCount: 0,
        recoveredCount: 0,
        pulledEventCount: 0,
        pulledBatchCount: 0,
        pulledTransactionCount: 0,
        activeLineageCount: 0,
        interruptedLineageCount: 0,
        archivedLineageCount: 0
      });
    } finally {
      close();
    }
  });

  it("persists matched lineages and recomputes occurrence/batch aggregates", () => {
    const { db, service, close } = createTestService();
    try {
      insertLineage(db, {
        lineageId: "lineage-persist",
        title: "persisted",
        normalizedSubject: "persist task",
        categories: ["finance"],
        keywords: ["invoice"],
        participantIds: ["alice"],
        sourceDepartments: ["finance"],
        lifecycleState: "active",
        firstSeenAt: addDays(REFERENCE_TIME, -20),
        lastSeenAt: addDays(REFERENCE_TIME, -10),
        lastBatchId: "batch-init",
        lastTransactionId: "tx-init",
        lastTransactionRecordId: "batch-init::transaction::tx-init"
      });

      const baseTx = {
        id: "tx-a",
        title: "Persisted task",
        normalizedSubject: "persist task",
        startedAt: addDays(REFERENCE_TIME, -3),
        latestActivityAt: addDays(REFERENCE_TIME, 0),
        cadence: "unknown",
        categories: ["finance"],
        keywords: ["invoice"],
        participantIds: ["alice", "carol"],
        sourceDepartments: ["finance"],
        lineageId: "lineage-persist",
        lifecycle: {
          stage: "matched",
          previousState: "active",
          nextState: "active",
          matchScore: 0.89,
          matchReasons: ["normalized-subject-exact"],
          pulledEventCount: 0,
          pulledBatchCount: 0,
          pulledTransactionCount: 0
        }
      };

      service.persistTransactionLineages({
        batchId: "batch-a",
        result: {
          transactions: [baseTx]
        }
      });
      service.persistTransactionLineages({
        batchId: "batch-b",
        result: {
          transactions: [
            {
              ...baseTx,
              id: "tx-b",
              startedAt: addDays(REFERENCE_TIME, -30)
            }
          ]
        }
      });

      const lineageRow = db.prepare("SELECT * FROM transaction_lineages WHERE lineage_id = ?").get("lineage-persist");
      const aggregate = db.prepare(
        "SELECT COUNT(*) AS occurrence_count, COUNT(DISTINCT batch_id) AS batch_count FROM transaction_lineage_runs WHERE lineage_id = ?"
      ).all("lineage-persist");
      expect(Number(lineageRow.occurrence_count)).toBe(2);
      expect(Number(aggregate[0].occurrence_count)).toBe(2);
      expect(Number(aggregate[0].batch_count)).toBe(2);
      expect(lineageRow.last_seen_at).toBe(addDays(REFERENCE_TIME, 0));
      expect(lineageRow.last_batch_id).toBe("batch-b");
      expect(lineageRow.last_transaction_id).toBe("tx-b");
      expect(lineageRow.last_transaction_record_id).toBe("batch-b::transaction::tx-b");
      expect(db.prepare("SELECT * FROM transaction_lineage_runs WHERE local_transaction_id = ?").get("tx-b").batch_id).toBe("batch-b");
    } finally {
      close();
    }
  });
});

describe("transaction lifecycle service (fake DB)", () => {
  it("propagates persistence failure from db execute errors", () => {
    const failingRun = vi.fn(() => {
      throw new Error("fake db broken");
    });
    const statement = {
      all: vi.fn(() => []),
      get: vi.fn(() => null),
      run: failingRun
    };
    const service = createTransactionLifecycleService({
      db: {
        prepare: vi.fn(() => statement),
        exec: vi.fn()
      }
    });

    expect(() =>
      service.persistTransactionLineages({
        batchId: "batch-fake",
        result: {
          transactions: [{
            id: "tx-fake",
            title: "Fake Transaction",
            normalizedSubject: "fake transaction",
            startedAt: REFERENCE_TIME,
            latestActivityAt: REFERENCE_TIME,
            lineageId: "lineage-fake",
            lifecycle: {
              stage: "new",
              previousState: "",
              nextState: "active",
              matchScore: 0.0,
              matchReasons: [],
              pulledEventCount: 0,
              pulledBatchCount: 0,
              pulledTransactionCount: 0
            }
          }]
        }
      })
    ).toThrow("fake db broken");
    expect(failingRun).toHaveBeenCalled();
  });
});
