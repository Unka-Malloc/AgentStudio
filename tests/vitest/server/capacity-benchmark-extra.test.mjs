import { afterEach, describe, expect, it, vi } from "vitest";

const knowledgeCoreHarness = vi.hoisted(() => ({
  ingestSources: vi.fn(),
  search: vi.fn(),
  close: vi.fn()
}));

const governanceHarness = vi.hoisted(() => ({
  register: vi.fn(),
  applySyncBatch: vi.fn()
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs", () => ({
  createKnowledgeCoreMount: vi.fn(async () => knowledgeCoreHarness)
}));

vi.mock("../../../server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs", () => ({
  createDataConnectorGovernance: vi.fn(() => governanceHarness)
}));

import {
  CAPACITY_TARGET_PROFILES,
  PERFORMANCE_CAPACITY_PROTOCOL_VERSION,
  listCapacityBenchmarkTargets,
  runPerformanceCapacityBenchmark
} from "../../../server/platform/specialized/knowledge/performance/capacity-benchmark/index.mjs";

afterEach(() => {
  vi.clearAllMocks();
});

describe("capacity benchmark module", () => {
  it("lists the bundled target profiles", () => {
    const listed = listCapacityBenchmarkTargets();

    expect(listed).toMatchObject({
      ok: true,
      protocolVersion: PERFORMANCE_CAPACITY_PROTOCOL_VERSION
    });
    expect(listed.profiles).toEqual(Object.values(CAPACITY_TARGET_PROFILES));
  });

  it("runs the benchmark on the happy path and preserves the injected rate-limit branch", async () => {
    knowledgeCoreHarness.ingestSources.mockResolvedValueOnce({ documentCount: 2 });
    knowledgeCoreHarness.search.mockImplementation(({ query } = {}) => {
      if (query === "no-match-capacity-benchmark-token") {
        return { items: [] };
      }
      return { items: [{ id: query }] };
    });
    knowledgeCoreHarness.close.mockResolvedValue(undefined);

    governanceHarness.register.mockResolvedValueOnce({ ok: true });
    governanceHarness.applySyncBatch.mockImplementation(async ({ items = [] } = {}) => {
      if (items.length > 2) {
        return {
          ok: false,
          run: {
            status: "rate_limited",
            itemCount: items.length,
            insertedCount: 0,
            nextCursor: "capacity-rate-limit"
          }
        };
      }
      return {
        ok: true,
        run: {
          status: "completed",
          itemCount: items.length,
          insertedCount: items.length,
          nextCursor: "capacity-cursor-1"
        }
      };
    });

    const report = await runPerformanceCapacityBenchmark({
      userDataPath: "/tmp/capacity-benchmark-happy",
      profileId: "pilot",
      targets: {
        documentCount: 2,
        pagesPerDocument: 2,
        imageAssetCount: 1,
        concurrentUploads: 3,
        queryCount: 2,
        externalSyncItemCount: 2,
        maxIngestMs: 5000,
        maxSearchP95Ms: 5000,
        minSearchQps: 1,
        minDistillationDocsPerSec: 1,
        maxExternalSyncMs: 5000,
        maxEstimatedCostUsd: 1
      }
    });

    expect(report).toMatchObject({
      ok: true,
      status: "pass",
      protocolVersion: PERFORMANCE_CAPACITY_PROTOCOL_VERSION
    });
    expect(report.plan).toMatchObject({
      profileId: "pilot",
      documentCount: 2,
      pagesPerDocument: 2,
      imageAssetCount: 1,
      concurrentUploads: 3,
      queryCount: 2,
      externalSyncItemCount: 2,
      failureInjection: {
        rateLimit: true,
        missingQuery: true
      }
    });
    expect(report.metrics.ingest).toMatchObject({
      documentCount: 2,
      pagesPerDocument: 2,
      concurrentUploadTarget: 3
    });
    expect(report.metrics.search).toMatchObject({
      queryCount: 2,
      totalHits: 2,
      missingQueryRecovered: true
    });
    expect(report.metrics.externalSync).toMatchObject({
      itemCount: 2,
      insertedCount: 2,
      rateLimitInjected: true,
      cursor: "capacity-cursor-1"
    });
    expect(report.metrics.distillation.documentCount).toBe(2);
    expect(report.thresholds.status).toBe("pass");
    expect(report.thresholds.checks.every((check) => check.status === "pass")).toBe(true);

    expect(knowledgeCoreHarness.ingestSources).toHaveBeenCalledTimes(1);
    expect(knowledgeCoreHarness.ingestSources).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedAt: expect.any(String),
        sources: [
          expect.objectContaining({
            id: "capacity-doc-0",
            providerId: "capacity-benchmark",
            externalId: "capacity-doc-0",
            sourceMetadata: { pageCount: 2, synthetic: true }
          }),
          expect.objectContaining({
            id: "capacity-doc-1",
            path: "capacity://doc/1"
          })
        ]
      })
    );
    expect(knowledgeCoreHarness.search).toHaveBeenNthCalledWith(1, {
      query: "budget bench-0",
      limit: 10,
      keywordOnly: true
    });
    expect(knowledgeCoreHarness.search).toHaveBeenNthCalledWith(2, {
      query: "security bench-1",
      limit: 10,
      keywordOnly: true
    });
    expect(knowledgeCoreHarness.search).toHaveBeenNthCalledWith(3, {
      query: "no-match-capacity-benchmark-token",
      limit: 5,
      keywordOnly: true
    });
    expect(knowledgeCoreHarness.close).toHaveBeenCalledTimes(1);

    expect(governanceHarness.register).toHaveBeenCalledTimes(1);
    expect(governanceHarness.register).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "capacity-sync",
        sync: expect.objectContaining({
          rateLimit: {
            maxItemsPerSync: 2
          }
        })
      }),
      { actor: "capacity-benchmark" }
    );
    expect(governanceHarness.applySyncBatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      providerId: "capacity-sync",
      syncBatchId: "capacity-sync",
      nextCursor: "capacity-cursor-1",
      items: [
        expect.objectContaining({ externalId: "sync-0" }),
        expect.objectContaining({ externalId: "sync-1" })
      ]
    }));
    expect(governanceHarness.applySyncBatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      providerId: "capacity-sync",
      syncBatchId: "capacity-rate-limit",
      items: expect.arrayContaining([
        expect.objectContaining({ externalId: "sync-0" }),
        expect.objectContaining({ externalId: "sync-1" }),
        expect.objectContaining({ externalId: "overflow" })
      ])
    }));
  });

  it("reports failed thresholds when cost exceeds the plan and skips optional injections", async () => {
    knowledgeCoreHarness.ingestSources.mockResolvedValueOnce({ documentCount: 1 });
    knowledgeCoreHarness.search.mockReturnValue({ items: [] });
    knowledgeCoreHarness.close.mockResolvedValue(undefined);

    governanceHarness.register.mockResolvedValueOnce({ ok: true });
    governanceHarness.applySyncBatch.mockResolvedValueOnce({
      ok: true,
      run: {
        status: "completed",
        itemCount: 1,
        insertedCount: 1,
        nextCursor: "capacity-cursor-1"
      }
    });

    const report = await runPerformanceCapacityBenchmark({
      userDataPath: "/tmp/capacity-benchmark-fail",
      targets: {
        documentCount: 1,
        pagesPerDocument: 1,
        imageAssetCount: 0,
        concurrentUploads: 1,
        queryCount: 1,
        externalSyncItemCount: 1,
        maxIngestMs: 5000,
        maxSearchP95Ms: 5000,
        minSearchQps: 0.001,
        minDistillationDocsPerSec: 0.001,
        maxExternalSyncMs: 5000,
        maxEstimatedCostUsd: 0
      },
      failureInjection: {
        rateLimit: false,
        missingQuery: false
      }
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("failed");
    expect(report.metrics.search.missingQueryRecovered).toBe(true);
    expect(report.metrics.externalSync.rateLimitInjected).toBe(false);
    expect(report.thresholds.status).toBe("failed");
    expect(report.thresholds.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "estimated-cost", status: "fail", target: 0 }),
        expect.objectContaining({ id: "ingest-latency", status: "pass" })
      ])
    );
    expect(knowledgeCoreHarness.search).toHaveBeenCalledTimes(1);
    expect(governanceHarness.applySyncBatch).toHaveBeenCalledTimes(1);
    expect(knowledgeCoreHarness.close).toHaveBeenCalledTimes(1);
  });

  it("rejects missing user data paths and still closes the knowledge core when ingest fails", async () => {
    await expect(runPerformanceCapacityBenchmark()).rejects.toThrow("userDataPath is required.");

    knowledgeCoreHarness.ingestSources.mockRejectedValueOnce(new Error("ingest exploded"));
    knowledgeCoreHarness.close.mockResolvedValue(undefined);

    await expect(runPerformanceCapacityBenchmark({
      userDataPath: "/tmp/capacity-benchmark-ingest-failure"
    })).rejects.toThrow("ingest exploded");
    expect(knowledgeCoreHarness.close).toHaveBeenCalledTimes(1);
  });
});
