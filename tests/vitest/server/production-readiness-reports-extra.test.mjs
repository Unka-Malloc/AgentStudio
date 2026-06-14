import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

const buildProductionHealthReportMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/production-readiness/report-reader.mjs", () => ({
  buildProductionHealthReport: buildProductionHealthReportMock
}));

import {
  EXECUTIVE_REPORT_PROTOCOL_VERSION,
  buildExecutiveReport,
  createExecutiveReportStore
} from "../../../server/platform/common/production-readiness/executive-report.mjs";
import {
  SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
  createSampleBusinessPackStore,
  getSampleBusinessPack,
  listSampleBusinessPacks,
  materializeSampleBusinessPack
} from "../../../server/platform/common/production-readiness/sample-business-pack.mjs";

const tempRoots = [];

afterEach(async () => {
  buildProductionHealthReportMock.mockReset();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function sampleHealth(overrides = {}) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    reportType: "v0.0.1:platform:production-health-1",
    generatedAt: "2026-06-01T00:00:00.000Z",
    status: "pass",
    latestReport: {
      runId: "20260601T000000Z",
      reportPath: "docs/reports/history/production-readiness/20260601T000000Z/report.json"
    },
    summary: {
      blockedP0: 0
    },
    coverage: {
      required: ["architecture"],
      byRequirement: {},
      missing: []
    },
    gates: [],
    ...overrides
  };
}

describe("sample business pack production-readiness module", () => {
  it("lists the default pack and resolves the manifest for known and unknown ids", () => {
    const list = listSampleBusinessPacks();
    expect(list).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
      packs: [
        {
          packId: "enterprise-knowledge-pilot",
          assetCount: 7,
          externalServices: [
            { serviceId: "qdrant", role: "vector-store" },
            { serviceId: "metadata", role: "metadata-store" }
          ]
        }
      ]
    });

    const manifest = getSampleBusinessPack();
    expect(manifest).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
      packId: "enterprise-knowledge-pilot",
      businessDomain: "enterprise-knowledge-management",
      assetCount: 7
    });
    expect(manifest.assetCategories).toEqual(
      expect.arrayContaining(["email", "pdf", "ppt", "markdown_project", "external_knowledge_base"])
    );
    expect(getSampleBusinessPack("missing-pack")).toBeNull();
  });

  it("materializes the default pack and writes representative assets and manifest content", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-sample-pack-"));
    tempRoots.push(userDataPath);

    const store = createSampleBusinessPackStore({ userDataPath });
    const materialized = await store.materialize({});

    expect(materialized).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
      packId: "enterprise-knowledge-pilot",
      ingestPlan: expect.any(Array),
      externalServices: expect.any(Array)
    });
    expect(materialized.targetRoot).toContain(path.join(userDataPath, "sample-business-packs"));
    expect(materialized.writtenFiles).toHaveLength(7);

    const writtenByPath = new Map(materialized.writtenFiles.map((file) => [file.relativePath, file.absolutePath]));
    const email = await fs.readFile(writtenByPath.get("mail/vendor-renewal-thread.eml"), "utf8");
    expect(email).toContain("Subject: 供应商续约排期和风险确认");

    const pdf = await fs.readFile(writtenByPath.get("documents/security-review.pdf"));
    expect(pdf.subarray(0, 8).toString("utf8")).toBe("%PDF-1.4");

    const pptx = unzipSync(new Uint8Array(await fs.readFile(writtenByPath.get("documents/roadmap-review.pptx"))));
    expect(strFromU8(pptx["ppt/slides/slide1.xml"])).toContain("知识库试点路线图");

    const markdown = await fs.readFile(writtenByPath.get("markdown-project/README.md"), "utf8");
    expect(markdown).toContain("Enterprise Knowledge Pilot");

    const compose = await fs.readFile(writtenByPath.get("external-knowledge/docker-compose.yml"), "utf8");
    expect(compose).toContain("qdrant/qdrant");
    expect(compose).toContain("postgres:17-alpine");

    const manifest = JSON.parse(await fs.readFile(materialized.manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
      packId: "enterprise-knowledge-pilot"
    });
    expect(manifest.writtenFiles).toHaveLength(7);
  });

  it("rejects unknown packs, unsafe paths, and overwrite collisions while allowing explicit overwrite", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-sample-pack-errors-"));
    tempRoots.push(userDataPath);

    const store = createSampleBusinessPackStore({ userDataPath });

    await expect(store.materialize({ packId: "missing-pack" })).rejects.toThrow(
      /Unknown sample business pack: missing-pack/
    );
    await expect(materializeSampleBusinessPack({ targetRoot: "../../outside" }, { userDataPath })).rejects.toThrow(
      /targetRoot must stay inside the sample business pack data directory\./
    );

    const first = await store.materialize({ targetRoot: "collision" });
    const overwritten = await store.materialize({ targetRoot: "collision", overwrite: true });

    expect(overwritten.targetRoot).toBe(first.targetRoot);
    expect(overwritten.writtenFiles).toHaveLength(first.writtenFiles.length);
    await expect(store.materialize({ targetRoot: "collision" })).rejects.toThrow(
      /Refusing to overwrite existing sample file/
    );
  });
});

describe("executive report production-readiness module", () => {
  it("uses defaults when input is missing and falls back to the health reader", async () => {
    buildProductionHealthReportMock.mockResolvedValueOnce(sampleHealth());

    const report = await buildExecutiveReport();

    expect(buildProductionHealthReportMock).toHaveBeenCalledTimes(1);
    expect(buildProductionHealthReportMock).toHaveBeenCalledWith({ repoRoot: undefined, reportRoot: undefined });
    expect(report).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: EXECUTIVE_REPORT_PROTOCOL_VERSION,
      timeRange: "all",
      status: "pass",
      executiveSummary: {
        headline: "Pact executive report"
      },
      sourceRefs: {
        productionHealthReport: "docs/reports/history/production-readiness/20260601T000000Z/report.json",
        contributionReportIds: []
      }
    });
    expect(report.reportId).toMatch(/^executive_report_/);
    expect(report.executiveSummary.keyFindings).toEqual([
      "production_status:pass",
      "asset_value_score:0",
      "asset_usage:0"
    ]);

    const fixedGeneratedAt = "2026-06-04T00:00:00.000Z";
    const first = await buildExecutiveReport({
      generatedAt: fixedGeneratedAt,
      productionHealth: sampleHealth()
    });
    const second = await buildExecutiveReport({
      productionHealth: sampleHealth(),
      generatedAt: fixedGeneratedAt
    });

    expect(first.reportId).toBe(second.reportId);
  });

  it("aggregates contribution reports, formats risks, and clamps recommended decisions", async () => {
    const health = sampleHealth({
      status: "partial",
      latestReport: {
        runId: "20260604T010000Z",
        reportPath: "docs/reports/history/production-readiness/20260604T010000Z/report.json"
      },
      summary: {
        blockedP0: 1
      },
      gates: [
        {
          id: "architecture",
          title: "Architecture",
          status: "fail",
          blockerLevel: "P0",
          nextStep: "repair architecture"
        },
        {
          id: "trace-observability",
          title: "Trace",
          status: "warning",
          blockerLevel: "P1",
          nextStep: "improve trace redaction"
        },
        {
          id: "offline-license",
          title: "Offline license",
          status: "partial",
          blockerLevel: "P2",
          nextStep: "recheck license bundle"
        }
      ]
    });

    const report = await buildExecutiveReport({
      generatedAt: "2026-06-04T01:02:03.000Z",
      productionHealth: health,
      contributionReports: [
        {
          workspaceId: "workspace-a",
          acceptedCount: "2",
          usageCount: 4,
          uniqueWorkspaceAdoptions: 1,
          permissionFlowBreakdown: { requested: 3, granted: 1 },
          rollbackCount: 1,
          assetContributionReportV0: 7,
          assetTypeBreakdown: { markdown: 2, pdf: 1 },
          contributorBreakdown: { alice: 2 },
          topReusableAssets: [
            { title: "low", rankScore: 1 },
            { title: "high", rankScore: 9 }
          ],
          highDemandRestrictedAssets: { contributionId: "restricted-1", title: "Restricted spec" },
          rollbackHotspots: [{ assetId: "rollback-1", title: "Rollback hotspot" }],
          underMaintainedAssets: [{ assetId: "legacy-1", title: "Legacy doc" }]
        },
        {
          workspaceId: "workspace-b",
          acceptedCount: 1,
          usageCount: 2,
          uniqueWorkspaceAdoptions: 2,
          permissionRequestCount: 5,
          permissionGrantCount: 4,
          rollbackCount: 0,
          assetContributionReportV0: 3,
          assetTypeBreakdown: { markdown: 1, ppt: 4 },
          contributorBreakdown: { bob: 3 },
          topReusableAssets: [{ title: "mid", rankScore: 8 }],
          highDemandRestrictedAssets: [{ contributionId: "restricted-2", title: "Restricted deck" }],
          rollbackHotspots: [{ contributionId: "rollback-2", title: "Second rollback" }]
        }
      ],
      capacity: {
        status: "degraded",
        profile: "pilot",
        benchmarks: [{ id: "bench-1" }, { id: "bench-2" }],
        ingest: { documentCount: 12 },
        search: { p95Ms: 88, qps: 31 },
        cost: { estimatedUsd: 4.5 },
        failures: ["qps regression"]
      },
      evaluation: {
        runs: [{ id: "run-1" }, { id: "run-2" }],
        passRate: 0.67,
        ragScore: 0.91,
        distillationScore: 0.84,
        agentTaskSuccessRate: 0.75,
        unsupportedClaimCount: 1,
        regressions: ["unsupported-claim"]
      },
      trace: {
        spanCount: 120,
        redactionFailures: 1,
        deniedRequests: 2,
        highRiskToolCalls: 1,
        costUsd: 0.4
      }
    });

    expect(report.status).toBe("blocked");
    expect(report.assetValue).toMatchObject({
      reportCount: 2,
      workspaceCount: 2,
      acceptedCount: 3,
      usageCount: 6,
      uniqueWorkspaceAdoptions: 3,
      permissionRequestCount: 8,
      permissionGrantCount: 5,
      rollbackCount: 1,
      assetContributionReportV0: 10,
      assetTypeBreakdown: { markdown: 3, pdf: 1, ppt: 4 },
      contributorBreakdown: { alice: 2, bob: 3 }
    });
    expect(report.assetValue.topReusableAssets.map((asset) => asset.title)).toEqual(["high", "mid", "low"]);
    expect(report.assetValue.highDemandRestrictedAssets).toHaveLength(2);
    expect(report.assetValue.rollbackHotspots).toHaveLength(2);
    expect(report.assetValue.underMaintainedAssets).toHaveLength(1);

    expect(report.capacityAndCost).toMatchObject({
      benchmarkCount: 2,
      latestStatus: "degraded",
      capacityProfile: "pilot",
      ingestDocuments: 12,
      searchP95Ms: 88,
      qps: 31,
      estimatedCostUsd: 4.5,
      failures: ["qps regression"]
    });
    expect(report.qualityAndEvaluation).toMatchObject({
      runCount: 2,
      passRate: 0.67,
      ragScore: 0.91,
      distillationScore: 0.84,
      agentTaskSuccessRate: 0.75,
      unsupportedClaimCount: 1,
      regressions: ["unsupported-claim"]
    });
    expect(report.traceAndSecurity).toMatchObject({
      spanCount: 120,
      redactionFailures: 1,
      deniedRequests: 2,
      highRiskToolCalls: 1,
      costUsd: 0.4
    });
    expect(report.executiveSummary.keyFindings).toEqual(
      expect.arrayContaining([
        "production_status:partial",
        "asset_value_score:10",
        "asset_usage:6",
        "permission_demand_exceeds_grants",
        "asset_rollbacks_present",
        "quality_regression_or_unsupported_claims",
        "capacity_failures_present",
        "trace_security_attention_required"
      ])
    );
    expect(report.risks).toHaveLength(7);
    expect(report.risks[0]).toMatchObject({
      type: "production_gate",
      severity: "critical",
      id: "architecture"
    });
    expect(report.executiveSummary.recommendedDecisions).toHaveLength(5);
    expect(report.executiveSummary.recommendedDecisions[0]).toMatchObject({
      riskType: "production_gate",
      targetId: "architecture",
      decision: "repair architecture"
    });
    expect(report.sourceRefs.contributionReportIds).toEqual([]);
  });

  it("persists, dedupes, and sorts executive reports newest first", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-executive-report-"));
    tempRoots.push(userDataPath);

    const store = createExecutiveReportStore({ userDataPath });
    expect(await store.list()).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: EXECUTIVE_REPORT_PROTOCOL_VERSION,
      reports: []
    });
    expect(await store.get("missing-report")).toBeNull();

    const first = await store.generate({
      reportId: "report-1",
      generatedAt: "2026-06-04T01:00:00.000Z",
      productionHealth: sampleHealth({
        latestReport: {
          runId: "run-1",
          reportPath: "docs/reports/history/production-readiness/run-1/report.json"
        }
      })
    });
    const second = await store.generate({
      reportId: "report-2",
      generatedAt: "2026-06-04T02:00:00.000Z",
      productionHealth: sampleHealth({
        latestReport: {
          runId: "run-2",
          reportPath: "docs/reports/history/production-readiness/run-2/report.json"
        }
      })
    });
    const replacement = await store.generate({
      reportId: "report-1",
      generatedAt: "2026-06-04T03:00:00.000Z",
      productionHealth: sampleHealth({
        latestReport: {
          runId: "run-3",
          reportPath: "docs/reports/history/production-readiness/run-3/report.json"
        }
      })
    });

    expect(second.reportId).toBe("report-2");
    expect(replacement.reportId).toBe("report-1");

    const listed = await store.list();
    expect(listed.reports).toHaveLength(2);
    expect(listed.reports.map((report) => report.reportId)).toEqual(["report-1", "report-2"]);
    expect(listed.reports[0].generatedAt).toBe("2026-06-04T03:00:00.000Z");
    expect(await store.get("report-1")).toMatchObject({
      reportId: "report-1",
      generatedAt: "2026-06-04T03:00:00.000Z"
    });

    const persisted = JSON.parse(await fs.readFile(path.join(userDataPath, "executive-reports", "reports.json"), "utf8"));
    expect(persisted.protocolVersion).toBe(EXECUTIVE_REPORT_PROTOCOL_VERSION);
    expect(persisted.reports).toHaveLength(2);
    expect(first.status).toBe("pass");
  });
});
