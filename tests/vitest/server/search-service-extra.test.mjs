import { describe, expect, it, vi } from "vitest";
import { createSearchService } from "../../../server/platform/specialized/knowledge/retrieval/search-service.mjs";

function row(overrides = {}) {
  return {
    retrieval_id: "item-1",
    batch_id: "batch-1",
    entity_type: "transaction",
    entity_id: "entity-1",
    title: "Invoice Alpha",
    snippet: "invoice alpha paid",
    timestamp: "2026-06-05T00:00:00.000Z",
    source: "email",
    search_terms_json: JSON.stringify(["invoice", "alpha"]),
    time_weight: 0.8,
    freshness: "current",
    status: "active",
    formal_use_allowed: 1,
    review_due_at: "2026-06-12T00:00:00.000Z",
    transaction_id: "",
    thread_id: "",
    raw_object_id: "",
    ...overrides
  };
}

function createDbFixture(rows) {
  const calls = [];
  return {
    calls,
    db: {
      prepare: vi.fn((sql) => ({
        all: vi.fn((...params) => {
          calls.push({ sql, params });
          return rows;
        })
      }))
    }
  };
}

describe("knowledge retrieval search service", () => {
  it("uses FTS search with batch/source/entity filters and final-score sorting", () => {
    const fixture = createDbFixture([
      row({
        retrieval_id: "low-time",
        search_terms_json: JSON.stringify(["invoice", "alpha"]),
        time_weight: 0.5,
        timestamp: "2026-06-04T00:00:00.000Z",
        transaction_id: "tx-low"
      }),
      row({
        retrieval_id: "high-time",
        search_terms_json: JSON.stringify(["invoice", "alpha"]),
        time_weight: 0.9,
        timestamp: "2026-06-03T00:00:00.000Z",
        raw_object_id: "raw-1"
      })
    ]);

    const result = createSearchService({ db: fixture.db }).search({
      query: "invoice alpha",
      limit: 1,
      batchId: "batch-1",
      sourceIds: ["source-a", "source-b"],
      entityTypes: ["Transaction", "transaction", "People"],
      formalOnly: true
    });

    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0].sql).toContain("retrieval_fts MATCH ?");
    expect(fixture.calls[0].sql).toContain("d.batch_id = ?");
    expect(fixture.calls[0].sql).toContain("d.source_id IN (?, ?)");
    expect(fixture.calls[0].sql).toContain("d.entity_type IN (?, ?)");
    expect(fixture.calls[0].sql).toContain("d.formal_use_allowed = 1");
    expect(fixture.calls[0].params).toEqual([
      '"invoice" OR "alpha"',
      "batch-1",
      "source-a",
      "source-b",
      "transaction",
      "people",
      8
    ]);
    expect(result).toMatchObject({
      query: "invoice alpha",
      batchId: "batch-1",
      limit: 1,
      formalOnly: true,
      entityTypes: ["transaction", "people"]
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      itemId: "high-time",
      relevanceScore: 1,
      timeWeight: 0.9,
      finalScore: 0.9,
      rawObjectId: "raw-1"
    });
  });

  it("falls back to LIKE search when query has no FTS tokens", () => {
    const fixture = createDbFixture([
      row({
        retrieval_id: "like-newer",
        search_terms_json: "not-json",
        time_weight: 0.3,
        timestamp: "2026-06-05T00:00:00.000Z",
        thread_id: "thread-1"
      })
    ]);

    const result = createSearchService({ db: fixture.db }).search({
      query: "!!!",
      limit: "2",
      sourceIds: [],
      entityTypes: [],
      rules: {
        keywordStopwords: ["ignored"]
      }
    });

    expect(fixture.calls[0].sql).toContain("d.title LIKE ?");
    expect(fixture.calls[0].sql).not.toContain("retrieval_fts MATCH");
    expect(fixture.calls[0].params).toEqual(["%!!!%", "%!!!%", "%!!!%", 16]);
    expect(result.items[0]).toMatchObject({
      itemId: "like-newer",
      relevanceScore: 1,
      finalScore: 0.3,
      threadId: "thread-1"
    });
  });

  it("returns recency-ordered rows for empty queries and clamps limits", () => {
    const fixture = createDbFixture([
      row({
        retrieval_id: "older",
        timestamp: "2026-06-01T00:00:00.000Z",
        time_weight: 0.4,
        formal_use_allowed: 0
      }),
      row({
        retrieval_id: "newer",
        timestamp: "2026-06-05T00:00:00.000Z",
        time_weight: 0.4,
        formal_use_allowed: 1
      })
    ]);

    const result = createSearchService({ db: fixture.db }).search({
      query: "   ",
      limit: 2000
    });

    expect(fixture.calls[0].sql).toContain("FROM retrieval_documents d");
    expect(fixture.calls[0].sql).not.toContain("WHERE");
    expect(fixture.calls[0].params).toEqual([400]);
    expect(result.query).toBe("");
    expect(result.limit).toBe(200);
    expect(result.items.map((item) => item.itemId)).toEqual(["newer", "older"]);
    expect(result.items.map((item) => item.formalUseAllowed)).toEqual([true, false]);
  });
});
