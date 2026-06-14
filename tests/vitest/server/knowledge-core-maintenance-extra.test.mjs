import { describe, expect, it } from "vitest";
import {
  buildMaintenancePlan,
  compareRetrievalProfiles,
  computeHealthFindings,
  summarizeMaintenanceRuns,
  validateKnowledgeQualityAssertions,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/maintenance.mjs";

describe("computeHealthFindings", () => {
  it("returns snapshot_missing when health input is empty", () => {
    const findings = computeHealthFindings({}, {});

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "health.snapshot_missing",
      severity: "critical",
      title: "Missing health snapshot",
    });
  });

  it("returns healthy finding when no issues are detected", () => {
    const findings = computeHealthFindings(
      {
        protocolVersion: "v0.0.1:knowledge:core-1",
        ok: true,
        counts: {
          documents: 2,
          blocks: 2,
          assets: 1,
          embeddings: 4,
        },
        maintenance: {
          missingAssets: 0,
        },
        settings: {
          retrieval: {
            topK: 20,
            bm25Weight: 0.5,
            vectorWeight: 0.5,
            imageWeight: 0.2,
            recencyWeight: 0.2,
            recencyHalfLifeDays: 14,
          },
          maintenance: {
            reindexBatchSize: 64,
          },
          markdown: {
            includeMachineReadableAppendix: true,
          },
        },
        capabilities: {
          modalities: { image: true },
          storage: {
            structured: true,
            assets: true,
            vector: true,
          },
          licensePolicy: {
            acceptedLicenses: ["MIT", "Apache-2.0"],
            components: [{ id: "core", role: "module", license: "Apache-2.0" }],
          },
        },
      },
      { includeOkFinding: true }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "health.ok",
      severity: "info",
      title: "Knowledge maintenance is healthy",
    });
  });

  it("collects protocol, settings, license, and run-related findings in deterministic order", () => {
    const findings = computeHealthFindings(
      {
        protocolVersion: "v0.0.1:knowledge:core-2",
        ok: false,
        counts: {
          documents: 3,
          blocks: 0,
          assets: 2,
          embeddings: 0,
        },
        maintenance: {
          missingAssets: 2,
          indexStale: true,
          indexAgeHours: 36,
          lastReindexAt: "2026-01-01T00:00:00.000Z",
          staleIndexHours: 12,
        },
        settings: {
          retrieval: {
            topK: 0,
            bm25Weight: -0.2,
            vectorWeight: -0.3,
            imageWeight: 0.1,
            recencyWeight: 1.2,
            recencyHalfLifeDays: 0,
          },
          maintenance: {
            reindexBatchSize: 0,
            staleIndexHours: 0,
          },
          markdown: {
            includeMachineReadableAppendix: false,
          },
        },
        capabilities: {
          modalities: { image: false },
          storage: {
            structured: false,
            assets: false,
            vector: false,
          },
          licensePolicy: {
            acceptedLicenses: ["Apache-2.0"],
            components: [
              { id: "vendor-a", role: "embedding", license: "GPL-3.0" },
            ],
          },
        },
        runs: [
          {
            runId: "run-2026-06-01",
            taskType: "reindex",
            status: "failed",
            startedAt: "2026-06-01T00:00:00.000Z",
            finishedAt: "2026-06-01T00:00:10.000Z",
          },
        ],
      },
      { expectedProtocolVersion: "v0.0.1:knowledge:core-1", maxWeightSum: 0.5 }
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "health.not_ok", severity: "critical" }),
        expect.objectContaining({ id: "protocol.version_mismatch", severity: "warning" }),
        expect.objectContaining({ id: "indexes.embedding_coverage_low", severity: "critical" }),
        expect.objectContaining({ id: "settings.retrieval_weight_negative", severity: "warning" }),
        expect.objectContaining({ id: "settings.retrieval_weights_disabled", severity: "critical" }),
        expect.objectContaining({ id: "license.unaccepted.vendor-a", severity: "critical" }),
        expect.objectContaining({ id: "maintenance.latest_run_failed", severity: "warning" }),
      ])
    );
    expect(findings[0]).toMatchObject({ severity: "critical" });
  });

  it("handles high retrieval weight sums and empty license entries", () => {
    const findings = computeHealthFindings(
      {
        protocolVersion: "v0.0.1:knowledge:core-1",
        ok: true,
        counts: {
          documents: 2,
          blocks: 2,
          assets: 2,
          embeddings: 4,
        },
        settings: {
          retrieval: {
            bm25Weight: 2,
            vectorWeight: 2,
            imageWeight: 0,
          },
          maintenance: {
            reindexBatchSize: 64,
          },
          markdown: {
            includeMachineReadableAppendix: true,
          },
        },
        capabilities: {
          modalities: { image: true },
          storage: {
            structured: true,
            assets: true,
            vector: true,
          },
          licensePolicy: {
            acceptedLicenses: ["MIT"],
            components: [{ id: "empty-license", role: "module", license: "" }],
          },
        },
      },
      { maxWeightSum: 3 }
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "settings.retrieval_weights_high", severity: "info" }),
        expect.objectContaining({ id: "license.unaccepted.empty-license", severity: "critical" }),
      ])
    );
  });

  it("treats internal licenses as accepted runtime components", () => {
    const findings = computeHealthFindings(
      {
        protocolVersion: "v0.0.1:knowledge:core-1",
        ok: true,
        counts: {
          documents: 1,
          blocks: 1,
          assets: 1,
          embeddings: 2,
        },
        settings: {
          retrieval: { topK: 20 },
          maintenance: { reindexBatchSize: 64, staleIndexHours: 24 },
          markdown: { includeMachineReadableAppendix: true },
        },
        capabilities: {
          storage: {
            structured: true,
            assets: true,
            vector: true,
          },
          modalities: {
            image: true,
          },
          licensePolicy: {
            acceptedLicenses: ["MIT"],
            components: [{ id: "internal-component", license: "internal" }],
          },
        },
      },
      { includeOkFinding: true }
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "health.ok", severity: "info" }),
      ])
    );
    expect(findings).toHaveLength(1);
  });
});

describe("buildMaintenancePlan", () => {
  it("deduplicates actions by id and keeps actionable sort order", () => {
    const plan = buildMaintenancePlan(
      {
        findings: [
          { id: "assets.missing_files", severity: "critical", message: "missing files", title: "Missing files" },
          { id: "assets.missing_files", severity: "critical", message: "missing files duplicate", title: "Missing files" },
          { id: "quality.assertions_failed", severity: "error", message: "quality regression" },
          { id: "settings.topk_invalid", severity: "warning", message: "topk invalid" },
        ],
      },
      { generatedAt: "2026-06-01T00:00:00.000Z" }
    );

    expect(plan.generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(plan.ok).toBe(false);
    expect(plan.status).toBe("action-required");
    expect(plan.findings).toHaveLength(4);
    expect(plan.actions).toHaveLength(3);
    expect(plan.actions.map((action) => action.id)).toEqual([
      "repair-assets",
      "repair-quality-regression",
      "review-maintenance-settings",
    ]);
    expect(plan.actions[0]).toMatchObject({
      relatedFindings: ["assets.missing_files"],
    });
    expect(plan.runbook).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 1,
          actionId: "repair-assets",
          command: "knowledge asset --id <asset-id>",
        }),
        expect.objectContaining({
          step: 2,
          actionId: "repair-quality-regression",
          command: "knowledge search --query <query>",
        }),
        expect.objectContaining({
          step: 3,
          actionId: "review-maintenance-settings",
          command: "knowledge maintenance set --body maintenance.json",
        }),
      ])
    );
  });

  it("adds branch actions for failed quality checks and retrieval regressions", () => {
    const plan = buildMaintenancePlan(
      {
        health: {
          ok: true,
          counts: { documents: 1, blocks: 1, assets: 0, embeddings: 1 },
          protocolVersion: "v0.0.1:knowledge:core-1",
          settings: {
            maintenance: {
              reindexBatchSize: 32,
              staleIndexHours: 24,
            },
            markdown: { includeMachineReadableAppendix: true },
            retrieval: { topK: 20, bm25Weight: 1, vectorWeight: 1, imageWeight: 0 },
          },
          capabilities: { storage: { structured: true, assets: true, vector: true }, modalities: { image: false } },
        },
        quality: { ok: false, failed: 2 },
        retrievalComparison: {
          regressions: [
            { id: "query.alpha.overlap_low", query: "alpha" },
          ],
        },
      },
      { generatedAt: "2026-06-01T00:00:00.001Z" }
    );

    expect(plan.status).toBe("needs-attention");
    expect(plan.ok).toBe(false);
    expect(plan.actions.map((action) => action.id)).toEqual([
      "compare-retrieval-profiles",
      "repair-quality-regression",
    ]);
    expect(plan.runbook[1]).toMatchObject({
      actionId: "repair-quality-regression",
      title: "Investigate failed quality assertions",
    });
  });

  it("maps reindex and unknown findings to explicit maintenance actions", () => {
    const plan = buildMaintenancePlan(
      {
        findings: [
          { id: "indexes.embedding_coverage_low", severity: "critical", message: "embedding coverage too low" },
          { id: "custom.unmapped_finding", severity: "warning", message: "unknown finding id" },
        ],
      },
      { generatedAt: "2026-06-04T00:00:00.000Z" }
    );

    expect(plan.actions).toHaveLength(2);
    expect(plan.actions.map((action) => action.id)).toEqual([
      "reindex-knowledge",
      "inspect-knowledge-health",
    ]);
    expect(plan.actions[0]).toMatchObject({
      id: "reindex-knowledge",
      command: "knowledge maintenance reindex",
      priority: "P0",
    });
    expect(plan.actions[1]).toMatchObject({
      id: "inspect-knowledge-health",
      command: "knowledge health",
      priority: "P2",
    });
  });
});

describe("compareRetrievalProfiles", () => {
  it("reports overlap, score, and top-item regressions while computing improvements", () => {
    const baseline = {
      name: "baseline",
      settings: { retrieval: { topK: 20, recencyWeight: 0.5 } },
      results: [
        {
          query: "alpha",
          items: [{ itemId: "a1", score: 1.0, modalities: ["text"] }],
        },
        {
          query: "beta",
          items: [{ itemId: "b1", score: 0.8, modalities: ["text"] }],
        },
        {
          query: "gamma",
          items: [{ itemId: "c1", score: 0.6, modalities: ["text"] }],
        },
        {
          query: "epsilon",
          items: [{ itemId: "e1", score: 0.9, modalities: ["text"] }],
        },
      ],
    };

    const candidate = {
      profileName: "candidate",
      retrievalProfile: { topK: 10 },
      searchResults: {
        alpha: {
          query: "alpha",
          items: [
            { itemId: "a2", score: 0.2, modalities: ["text"] },
          ],
        },
        gamma: {
          query: "gamma",
          items: [
            { itemId: "c1", score: 0.4, modalities: ["text"] },
          ],
        },
        delta: {
          query: "delta",
          items: [
            { itemId: "d1", score: 1.4, modalities: ["text"] },
          ],
        },
        epsilon: {
          query: "epsilon",
          items: [
            { itemId: "e1", score: 1.9, modalities: ["text"] },
            { itemId: "e2", score: 1.5, modalities: ["text"] },
          ],
        },
      },
    };

    const comparison = compareRetrievalProfiles(baseline, candidate, {
      minOverlap: 0.4,
      maxTopScoreDrop: 0.3,
      requireSameTopItem: true,
    });

    expect(comparison.ok).toBe(false);
    expect(comparison.baseline).toMatchObject({ name: "baseline", queryCount: 4 });
    expect(comparison.candidate).toMatchObject({ name: "candidate", queryCount: 4 });
    expect(comparison.regressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "query.alpha.overlap_low" }),
        expect.objectContaining({ id: "query.alpha.score_drop" }),
        expect.objectContaining({ id: "query.alpha.top_item_changed" }),
      ])
    );
    expect(comparison.improvements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "query.delta.new_results" }),
        expect.objectContaining({ id: "query.epsilon.score_improved" }),
      ])
    );
    expect(comparison.summary).toMatchObject({
      queryCount: 5,
      averageOverlap: expect.any(Number),
      changedTopItems: 3,
    });
    expect(comparison.settingsDelta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "retrieval.topK",
          baseline: 20,
          candidate: undefined,
        }),
        expect.objectContaining({
          key: "topK",
          baseline: undefined,
          candidate: 10,
        }),
      ])
    );
  });

  it("supports list-style profile formats and still supports non-regressed comparison", () => {
    const baseline = {
      query: "q1",
      results: [
        { query: "q1", hits: [{ id: "item-a", score: 0.8 }] },
      ],
    };
    const candidate = {
      retrieval: { topK: 8 },
      searchResults: {
        q1: { query: "q1", hits: [{ id: "item-a", score: 1.8 }, { id: "item-b", score: 1.4 }] },
      },
    };

    const comparison = compareRetrievalProfiles(baseline, candidate, {
      minOverlap: 0,
      maxTopScoreDrop: 0.5,
    });

    expect(comparison.ok).toBe(true);
    expect(comparison.improvements[0]).toMatchObject({ id: "query.q1.score_improved" });
    expect(comparison.summary.changedTopItems).toBe(0);
    expect(comparison.regressions).toHaveLength(0);
  });

  it("supports profile query arrays, query maps, and empty non-object profiles", () => {
    const queryArrayBaseline = {
      queries: [
        {
          query: "q-map",
          hits: [{ itemId: "item-1", score: 0.9 }],
        },
        {
          query: "q-only-baseline",
          hits: [{ itemId: "item-2", score: 0.6 }],
        },
      ],
    };
    const queryMapCandidate = {
      results: {
        "q-map": {
          hits: [{ itemId: "item-1", score: 1.2 }],
        },
      },
    };

    const comparison = compareRetrievalProfiles(queryArrayBaseline, queryMapCandidate, {
      minOverlap: 0.5,
      maxTopScoreDrop: 0.5,
    });

    expect(comparison.baseline.queryCount).toBe(2);
    expect(comparison.candidate.queryCount).toBe(1);
    expect(comparison.regressions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "query.q-only-baseline.no_candidate_results" })])
    );
    expect(comparison.improvements).toHaveLength(0);
    expect(comparison.summary.queryCount).toBe(2);

    const emptyProfileComparison = compareRetrievalProfiles({}, "", {});
    expect(emptyProfileComparison.summary).toMatchObject({ queryCount: 0, averageOverlap: 1, averageScoreDelta: 0 });
    expect(emptyProfileComparison.ok).toBe(true);
  });
});

describe("summarizeMaintenanceRuns", () => {
  it("computes status counts, success rate, durations and failure warnings", () => {
    const summary = summarizeMaintenanceRuns(
      [
        {
          run_id: "run-failed",
          task_type: "reindex",
          status: "failed",
          started_at: "2026-06-03T10:00:00.000Z",
          finished_at: "2026-06-03T10:00:02.000Z",
        },
        {
          run_id: "run-success",
          task_type: "maintenance",
          status: "completed",
          started_at: "2026-06-03T10:01:00.000Z",
          finishedAt: "2026-06-03T10:01:10.000Z",
        },
      ],
      { maxFailureRate: 0.2 }
    );

    expect(summary.total).toBe(2);
    expect(summary.byStatus).toEqual({ failed: 1, completed: 1 });
    expect(summary.byTaskType).toEqual({ reindex: 1, maintenance: 1 });
    expect(summary.completedRuns).toBe(1);
    expect(summary.failedRuns).toBe(1);
    expect(summary.successRate).toBe(0.5);
    expect(summary.averageDurationMs).toBe(6000);
    expect(summary.warnings).toEqual(["Failure rate 0.5000 exceeds 0.2."]);
  });

  it("marks no-success run summary with latest-run failure", () => {
    const summary = summarizeMaintenanceRuns({
      runs: [
        {
          status: "failed",
          startedAt: "2026-06-04T00:00:00.000Z",
          taskType: "cleanup",
        },
      ],
    }, {
      maxFailureRate: 0,
    });

    expect(summary.total).toBe(1);
    expect(summary.lastSuccessfulRun).toBeNull();
    expect(summary.lastFailedRun?.status).toBe("failed");
    expect(summary.warnings).toEqual([
      "No successful maintenance run is present.",
      "The latest maintenance run failed.",
      "Failure rate 1.0000 exceeds 0."
    ]);
  });
});

describe("validateKnowledgeQualityAssertions", () => {
  it("passes normal assertions and records markdown metadata warning", () => {
    const result = validateKnowledgeQualityAssertions(
      [
        {
          id: "search-pass",
          query: "alpha",
          minItems: 2,
          maxItems: 3,
          minScore: 0.6,
          requiredTerms: ["alpha", "result"],
          forbiddenTerms: ["forbidden"],
          requiredModalities: ["text", "image"],
          requiredItemIds: ["item-a", "item-b"],
        },
        {
          id: "markdown-warning",
          markdown: "plain markdown output without front matter",
        },
      ],
      {
        searchResults: {
          alpha: {
            items: [
              {
                itemId: "item-a",
                score: 1.2,
                modalities: ["text"],
                assets: [{ assetId: "asset-a", readable: true }],
              },
              {
                itemId: "item-b",
                score: 0.7,
                modalities: ["image"],
                assets: [{ assetId: "asset-b", readable: true }],
              },
            ],
            markdown: "alpha result",
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ total: 2, passed: 2, failed: 0, skipped: 0 });
    expect(result.results[1].status).toBe("passed");
    expect(result.results[1].warnings).toEqual([
      "Markdown was provided without front matter metadata."
    ]);
  });

  it("fails when markdown metadata and readability checks break", () => {
    const result = validateKnowledgeQualityAssertions(
      [
        {
          id: "markdown-meta",
          target: "markdown",
          requireMarkdownMetadata: true,
          requiredMetadataKeys: ["protocolVersion", "evidenceId"],
          requiredAssetRefs: ["/api/knowledge/assets/missing"],
          expected: {
            metadata: {
              protocolVersion: "v0.0.1:knowledge:core-1",
              evidenceId: "expected-evidence",
            },
            assetRefs: ["/api/knowledge/assets/missing"],
          },
          requiredAssetIds: ["asset-2"],
          requireReadableAssets: true,
        },
      ],
      {
        markdown: `---
pact_knowledge:
  protocolVersion: v0.0.1:knowledge:core-1
---

a paragraph with alpha
`,
        rendered: {
          markdown: `---
pact_knowledge:
  protocolVersion: v0.0.1:knowledge:core-1
---

a paragraph with alpha
`,
          assets: [{ assetId: "asset-2" }],
        },
        assetReadability: {
          "asset-2": {
            assetId: "asset-2",
            readable: false,
            byteLength: 0,
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].failures).toEqual(
      expect.arrayContaining([
        "Markdown is missing a parseable JSON metadata block.",
        "Markdown metadata is missing key: evidenceId.",
        "Markdown metadata evidenceId did not match expected value.",
        "Markdown is missing required asset reference: /api/knowledge/assets/missing.",
        "Asset is not marked readable: asset-2.",
      ])
    );
  });

  it("checks metadata scalar parsing, missing metadata keys, and value-path mismatches", () => {
    const result = validateKnowledgeQualityAssertions(
      [
        {
          id: "markdown-metadata-edge",
          target: "health",
          requireMarkdownMetadata: true,
          requiredMetadataKeys: ["", "count", "enabled", "values"],
          requiredAssetRefs: ["/api/knowledge/assets/required.json"],
          expected: {
            metadata: {
              "count.sub": 99,
              "values": ["alpha", "beta"],
            },
            assetRefs: ["/api/knowledge/assets/required.json"],
          },
        },
      ],
      {
        health: {
          markdown: `---
pact_knowledge:
  count: 3
  enabled: true
  values: [alpha, beta]
---

payload for metadata parsing.
`,
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.results[0].failures).toEqual(
      expect.arrayContaining([
        "Markdown metadata is missing key: .",
        "Markdown is missing a parseable JSON metadata block.",
        "Markdown metadata count.sub did not match expected value.",
        "Markdown is missing required asset reference: /api/knowledge/assets/required.json.",
      ])
    );
  });

  it("uses array-based readability payloads and array assertions targets", () => {
    const result = validateKnowledgeQualityAssertions(
      [
        {
          id: "asset-array-readability",
          target: "asset",
          requiredAssetIds: ["asset-1", "asset-2"],
          requireReadableAssets: true,
          assetReadability: [
            { id: "asset-1", readable: true, byteLength: 12 },
            { id: "asset-2", ok: false, readable: true, byteLength: 0 },
          ],
        },
      ],
      {
        asset: {
          markdown: "asset payload baseline",
          assets: [{ assetId: "asset-1", readable: true }],
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.results[0].failures).toEqual(
      expect.arrayContaining([
        "Asset is not marked readable: asset-2.",
        "Missing required asset id: asset-2.",
      ])
    );
  });

  it("reports missing metadata when markdown content lacks front matter", () => {
    const result = validateKnowledgeQualityAssertions(
      [
        {
          id: "markdown-front-matter-missing",
          target: "markdown",
          requireMarkdownMetadata: true,
        },
      ],
      { markdown: "plain markdown text without metadata envelope" }
    );

    expect(result.ok).toBe(false);
    expect(result.results[0].failures).toEqual(
      expect.arrayContaining([
        "Markdown is missing front matter metadata.",
        "Markdown is missing a parseable JSON metadata block.",
      ])
    );
  });

  it("marks assertions as skipped when no assertions are given", () => {
    const result = validateKnowledgeQualityAssertions([], {}, { skipEmpty: true });
    expect(result).toMatchObject({ ok: true, total: 0, passed: 0, failed: 0, skipped: 1 });
  });
});
