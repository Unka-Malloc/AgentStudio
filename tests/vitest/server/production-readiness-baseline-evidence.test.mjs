import { describe, it, expect } from "vitest";
import {
  buildReadinessReport,
  evaluateReadinessGuard
} from "../../../server/platform/specialized/production-readiness/readiness-guard-evaluator.mjs";
import { READINESS_SCOPES } from "../../../server/platform/specialized/production-readiness/readiness-scope-registry.mjs";

/**
 * Pure unit: simulate evaluateScopeEvidence semantics.
 * Replicates the logic from verify-production-readiness-baseline.mjs
 * without requiring actual filesystem or subprocess execution.
 */
function evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit) {
  const plan = evidencePlan[scope.scopeId] || { requiredCommands: [], requiredReports: [] };
  const actualEvidence = [];
  const failureReasons = [];

  for (const reqCmd of plan.requiredCommands) {
    const cmdKey = reqCmd.join(" ");
    const result = commandResults[cmdKey];
    if (!result) {
      failureReasons.push(`Required command not run: ${cmdKey}`);
      continue;
    }
    actualEvidence.push({
      command: cmdKey,
      exitCode: result.exitCode,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      elapsedMs: result.elapsedMs,
      generatedForCommit: commit
    });
    if (result.exitCode !== 0) {
      failureReasons.push(`Required command failed (exitCode=${result.exitCode}): ${cmdKey}`);
    }
  }

  for (const reportPath of plan.requiredReports) {
    const reportData = reportResults[reportPath];
    if (!reportData || !reportData.exists) {
      failureReasons.push(`Required report missing: ${reportPath}`);
      continue;
    }
    actualEvidence.push({
      reportPath,
      reportHash: reportData.hash,
      generatedAt: reportData.generatedAt || null,
      generatedForCommit: commit
    });
  }

  const verificationMode = plan.requiredCommands.length > 0 || plan.requiredReports.length > 0
    ? (failureReasons.length === 0 ? "verified" : "failed")
    : "notRun";

  let status;
  if (scope.baselineV0_1Required) {
    status = failureReasons.length === 0 ? "passed" : "failed";
  } else {
    status = "not_in_baseline_v0_1";
  }

  return { status, verificationMode, actualEvidence, failureReasons };
}

/**
 * Validate a baseline readiness report against expected schema/consistency rules.
 */
function validateBaselineReadinessReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") {
    return { ok: false, errors: ["Report is not a valid object."] };
  }
  if (!report.schemaVersion || report.schemaVersion !== 1) {
    errors.push("Report missing or invalid schemaVersion.");
  }
  if (!report.reportType || report.reportType !== "pact.readiness.report.v0.1") {
    errors.push("Report missing or invalid reportType.");
  }
  if (!report.runId || typeof report.runId !== "string") {
    errors.push("Report missing runId.");
  }
  if (!report.commit || typeof report.commit !== "string") {
    errors.push("Report missing commit.");
  }
  if (!Array.isArray(report.scopes)) {
    errors.push("Report missing scopes array.");
  }
  if (!report.summary || typeof report.summary !== "object") {
    errors.push("Report missing summary.");
  }
  if (!report.guardResults || typeof report.guardResults !== "object") {
    errors.push("Report missing guardResults.");
  }
  return { ok: errors.length === 0, errors };
}

const evidencePlan = {
  "state-machine-core": {
    requiredCommands: [["test", "cmd", "state-machine-core"]],
    requiredReports: ["build/reports/state-machines/latest.json"]
  },
  "state-machine-schema": {
    requiredCommands: [],
    requiredReports: ["build/reports/state-machines/latest.json"]
  },
  "production-readiness-baseline": {
    requiredCommands: [["test", "cmd", "baseline-self-test"]],
    requiredReports: []
  },
  "docs-config-consistency": {
    requiredCommands: [["test", "cmd", "docs-governance"]],
    requiredReports: []
  }
};

describe("Baseline Evidence - evaluateScopeEvidence", () => {
  it("baseline scope passes when all required commands succeed and reports exist", () => {
    const commit = "abc123";
    const commandResults = {
      "test cmd state-machine-core": {
        exitCode: 0,
        startedAt: "2025-01-01T00:00:00Z",
        finishedAt: "2025-01-01T00:00:05Z",
        elapsedMs: 5000
      }
    };
    const reportResults = {
      "build/reports/state-machines/latest.json": {
        exists: true,
        hash: "sha256:abcdef",
        generatedAt: "2025-01-01T00:00:00Z"
      }
    };

    const scope = READINESS_SCOPES.getScope("state-machine-core");
    const result = evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit);

    expect(result.status).toBe("passed");
    expect(result.verificationMode).toBe("verified");
    expect(result.failureReasons).toEqual([]);
    expect(result.actualEvidence.length).toBe(2);
  });

  it("production-readiness-baseline self-scope passes via self-test command", () => {
    const commit = "abc123";
    const commandResults = {
      "test cmd baseline-self-test": {
        exitCode: 0,
        startedAt: "2025-01-01T00:00:00Z",
        finishedAt: "2025-01-01T00:00:01Z",
        elapsedMs: 1000
      }
    };
    const reportResults = {};

    const scope = READINESS_SCOPES.getScope("production-readiness-baseline");
    const result = evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit);

    expect(result.status).toBe("passed");
    expect(result.verificationMode).toBe("verified");
    expect(result.failureReasons).toEqual([]);
  });

  it("scope must fail when required command exitCode is non-zero", () => {
    const commit = "abc123";
    const commandResults = {
      "test cmd state-machine-core": {
        exitCode: 1,
        startedAt: "2025-01-01T00:00:00Z",
        finishedAt: "2025-01-01T00:00:05Z",
        elapsedMs: 5000
      }
    };
    const reportResults = {
      "build/reports/state-machines/latest.json": {
        exists: true,
        hash: "sha256:abcdef",
        generatedAt: "2025-01-01T00:00:00Z"
      }
    };

    const scope = READINESS_SCOPES.getScope("state-machine-core");
    const result = evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit);

    expect(result.status).toBe("failed");
    expect(result.verificationMode).toBe("failed");
    expect(result.failureReasons.length).toBeGreaterThan(0);
  });

  it("scope must fail when required report is missing", () => {
    const commit = "abc123";
    const commandResults = {
      "test cmd state-machine-core": {
        exitCode: 0,
        startedAt: "2025-01-01T00:00:00Z",
        finishedAt: "2025-01-01T00:00:05Z",
        elapsedMs: 5000
      }
    };
    const reportResults = {
      "build/reports/state-machines/latest.json": {
        exists: false,
        hash: null,
        generatedAt: null
      }
    };

    const scope = READINESS_SCOPES.getScope("state-machine-schema");
    const result = evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit);

    expect(result.status).toBe("failed");
    expect(result.failureReasons.length).toBeGreaterThan(0);
    expect(result.failureReasons.some(r => r.includes("Required report missing"))).toBe(true);
  });

  it("docs-config-consistency is not duplicated by running same command twice", () => {
    const commit = "abc123";
    const commandResults = {
      "test cmd docs-governance": {
        exitCode: 0,
        startedAt: "2025-01-01T00:00:00Z",
        finishedAt: "2025-01-01T00:00:01Z",
        elapsedMs: 1000
      }
    };
    const reportResults = {};

    const scope = READINESS_SCOPES.getScope("docs-config-consistency");
    const result = evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit);

    expect(result.status).toBe("passed");
    // Docs-governance should only be in evidence once via the plan
    expect(result.actualEvidence.filter(e => e.command === "test cmd docs-governance").length).toBe(1);
  });

  it("evidence includes exitCode, startedAt, finishedAt, elapsedMs, generatedForCommit", () => {
    const commit = "abc123";
    const commandResults = {
      "test cmd state-machine-core": {
        exitCode: 0,
        startedAt: "2025-01-01T00:00:00Z",
        finishedAt: "2025-01-01T00:00:05Z",
        elapsedMs: 5000
      }
    };
    const reportResults = {
      "build/reports/state-machines/latest.json": {
        exists: true,
        hash: "sha256:abcdef",
        generatedAt: "2025-01-01T00:00:00Z"
      }
    };

    const scope = READINESS_SCOPES.getScope("state-machine-core");
    const result = evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit);

    const cmdEvidence = result.actualEvidence.find(e => e.command);
    expect(cmdEvidence.exitCode).toBe(0);
    expect(cmdEvidence.startedAt).toBeTruthy();
    expect(cmdEvidence.finishedAt).toBeTruthy();
    expect(typeof cmdEvidence.elapsedMs).toBe("number");
    expect(cmdEvidence.generatedForCommit).toBe(commit);

    const reportEvidence = result.actualEvidence.find(e => e.reportPath);
    expect(reportEvidence.reportPath).toBeTruthy();
    expect(reportEvidence.reportHash).toBeTruthy();
    expect(reportEvidence.generatedForCommit).toBe(commit);
  });
});

describe("Baseline Evidence - validateBaselineReadinessReport", () => {
  it("accepts valid report", () => {
    const report = {
      schemaVersion: 1,
      reportType: "pact.readiness.report.v0.1",
      runId: "test-run",
      commit: "abc123",
      scopes: [],
      summary: {},
      guardResults: {}
    };
    const result = validateBaselineReadinessReport(report);
    expect(result.ok).toBe(true);
  });

  it("rejects null report", () => {
    const result = validateBaselineReadinessReport(null);
    expect(result.ok).toBe(false);
  });

  it("rejects report with missing schemaVersion", () => {
    const report = {
      reportType: "pact.readiness.report.v0.1",
      runId: "test-run",
      commit: "abc123",
      scopes: [],
      summary: {},
      guardResults: {}
    };
    const result = validateBaselineReadinessReport(report);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects report with invalid reportType", () => {
    const report = {
      schemaVersion: 1,
      reportType: "wrong.type",
      runId: "test-run",
      commit: "abc123",
      scopes: [],
      summary: {},
      guardResults: {}
    };
    const result = validateBaselineReadinessReport(report);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("reportType"))).toBe(true);
  });

  it("rejects report with missing scopes", () => {
    const report = {
      schemaVersion: 1,
      reportType: "pact.readiness.report.v0.1",
      runId: "test-run",
      commit: "abc123",
      summary: {},
      guardResults: {}
    };
    const result = validateBaselineReadinessReport(report);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("scopes"))).toBe(true);
  });
});
