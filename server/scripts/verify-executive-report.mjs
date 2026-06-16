#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createExecutiveReportStore, EXECUTIVE_REPORT_PROTOCOL_VERSION } from "../platform/common/production-readiness/executive-report.mjs";
import { createContributionRegistry } from "../platform/specialized/agent/workspace-contribution/index.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

function productionHealth() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    reportType: "v0.0.1:platform:production-health-1",
    generatedAt: "2026-05-22T00:00:00.000Z",
    status: "blocked",
    latestReport: {
      runId: "20260522T000000Z",
      reportPath: "build/reports/production-readiness/20260522T000000Z/report.json"
    },
    summary: { pass: 2, fail: 1, timeout: 0, blockedP0: 1 },
    coverage: { required: ["architecture", "trace-observability"], missing: ["trace-observability"] },
    gates: [
      {
        id: "architecture",
        title: "架构门禁",
        status: "pass",
        blockerLevel: "P0",
        nextStep: ""
      },
      {
        id: "trace-observability",
        title: "内部 Trace 与日志脱敏",
        status: "fail",
        blockerLevel: "P0",
        nextStep: "fix trace redaction"
      }
    ]
  };
}

function contributionReport() {
  const registry = createContributionRegistry({ workspaceId: "workspace-main" });
  const contribution = registry.submitContribution({
    contributorId: "agent-a",
    contributionType: "skill",
    title: "Restricted reuse skill",
    requestedVisibility: "restricted",
    requestedActions: ["read", "install", "execute"]
  }).contribution;
  registry.scanContribution(contribution.contributionId, { actorId: "scanner" });
  registry.reviewContribution(contribution.contributionId, { actorId: "reviewer" });
  registry.previewContribution(contribution.contributionId, { actorId: "reviewer" });
  registry.publishContribution(contribution.contributionId, { actorId: "reviewer" });
  registry.requestPermission(contribution.contributionId, {
    requesterId: "agent-b",
    targetWorkspaceId: "workspace-b",
    actions: ["install"],
    purpose: "reuse"
  });
  registry.grantPermission(contribution.contributionId, {
    granteeId: "agent-b",
    targetWorkspaceId: "workspace-b",
    actions: ["install"]
  });
  registry.recordUsage(contribution.contributionId, {
    actorId: "agent-b",
    workspaceId: "workspace-b",
    action: "skill.used",
    successful: true
  });
  registry.recordRollback(contribution.contributionId, { reason: "bad output" });
  return registry.getContributionReport({ timeRange: "all" });
}

async function verifyReportStore(tempRoot) {
  const store = createExecutiveReportStore({ userDataPath: tempRoot });
  const report = await store.generate({
    productionHealth: productionHealth(),
    contributionReports: [contributionReport()],
    capacity: {
      capacityProfile: "pilot",
      search: { p95Ms: 80, qps: 30 },
      cost: { estimatedUsd: 1.25 }
    },
    evaluation: {
      runCount: 3,
      ragScore: 0.91,
      distillationScore: 0.86,
      unsupportedClaimCount: 1,
      regressions: ["distillation-coverage"]
    },
    trace: {
      spanCount: 120,
      redactionFailures: 1,
      highRiskToolCalls: 2,
      costUsd: 0.4
    }
  });

  assert.equal(report.protocolVersion, EXECUTIVE_REPORT_PROTOCOL_VERSION);
  assert.equal(report.status, "blocked");
  assert.equal(report.productionReadiness.latestRunId, "20260522T000000Z");
  assert.equal(report.assetValue.usageCount, 1);
  assert.equal(report.assetValue.permissionRequestCount, 1);
  assert.equal(report.assetValue.permissionGrantCount, 1);
  assert.equal(report.assetValue.rollbackCount, 1);
  assert.ok(report.assetValue.topReusableAssets.length >= 1);
  assert.ok(report.assetValue.highDemandRestrictedAssets.length >= 1);
  assert.ok(report.risks.some((risk) => risk.type === "production_gate"));
  assert.ok(report.risks.some((risk) => risk.type === "high_demand_restricted_asset"));
  assert.ok(report.risks.some((risk) => risk.type === "rollback_hotspot"));
  assert.ok(report.executiveSummary.keyFindings.includes("permission_demand_exceeds_grants") === false);
  assert.ok(report.executiveSummary.keyFindings.includes("quality_regression_or_unsupported_claims"));
  assert.ok(report.executiveSummary.keyFindings.includes("trace_security_attention_required"));

  const listed = await store.list();
  assert.equal(listed.protocolVersion, EXECUTIVE_REPORT_PROTOCOL_VERSION);
  assert.equal(listed.reports.length, 1);
  assert.equal(listed.reports[0].reportId, report.reportId);
  const loaded = await store.get(report.reportId);
  assert.equal(loaded.reportId, report.reportId);
}

function verifyOperationsAndTools() {
  const operations = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  for (const id of [
    "executive_report.list",
    "executive_report.preview",
    "executive_report.generate"
  ]) {
    assert.ok(operations.has(id), `${id} must be registered`);
  }
  assert.equal(operations.get("executive_report.generate").http.path, "/api/executive-report/generate");
  assert.equal(operations.get("executive_report.preview").target.method, "handleExecutiveReportPreview");

  const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
  const generateTool = catalog.tools.find((tool) => tool.id === "pact.executiveReport.generate");
  assert.ok(generateTool, "executive report generate tool must be exposed");
  assert.ok(generateTool.toolsets.includes("pact.agentLibrary.maintain"));
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-executive-report-"));
  try {
    await verifyReportStore(tempRoot);
    verifyOperationsAndTools();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  console.log("[executive-report] ok");
}

await main();
