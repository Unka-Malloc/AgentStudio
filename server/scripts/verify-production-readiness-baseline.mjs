#!/usr/bin/env node
import { READINESS_SCOPES } from "../platform/specialized/production-readiness/readiness-scope-registry.mjs";
import {
  buildReadinessReport,
  evaluateReadinessGuard
} from "../platform/specialized/production-readiness/readiness-guard-evaluator.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url))
);

function gitValueSync(args) {
  try {
    return execSync(`git ${args.join(" ")}`, { encoding: "utf8", cwd: repoRoot }).trim();
  } catch {
    return "";
  }
}

function sha256File(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return `sha256:${crypto.createHash("sha256").update(data).digest("hex")}`;
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function runVerifier(commandLine) {
  const startedAt = new Date();
  try {
    const result = spawnSync(commandLine[0], commandLine.slice(1), {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000
    });
    const finishedAt = new Date();
    const stdout = result.stdout?.toString() || "";
    const stderr = result.stderr?.toString() || "";
    return {
      command: commandLine.join(" "),
      exitCode: result.status ?? 1,
      signal: result.signal || null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      stdout: stdout.slice(0, 2000),
      stderr: stderr.slice(0, 2000)
    };
  } catch (err) {
    const finishedAt = new Date();
    return {
      command: commandLine.join(" "),
      exitCode: 127,
      signal: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      error: err.message
    };
  }
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

/**
 * Evidence plan: defines required commands and required reports per scope.
 */
const scopeEvidencePlan = {
  "state-machine-core": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/state-machine-core.test.mjs"]],
    requiredReports: ["build/reports/state-machines/latest.json"]
  },
  "state-machine-schema": {
    requiredCommands: [],
    requiredReports: ["build/reports/state-machines/latest.json"]
  },
  "state-machine-verifier": {
    requiredCommands: [["npm", "run", "server:verify:state-machines"]],
    requiredReports: ["build/reports/state-machines/latest.json"]
  },
  "contribution.lifecycle": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/contribution-lifecycle-state-machine.test.mjs"]],
    requiredReports: []
  },
  "agentlibrary.loan": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/knowledge-loan-lifecycle-state-machine.test.mjs"]],
    requiredReports: []
  },
  "checkpoint.restore": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/checkpoint-restore-lifecycle-state-machine.test.mjs"]],
    requiredReports: []
  },
  "operation.narrow": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/operation-state-machine-integration.test.mjs"]],
    requiredReports: []
  },
  "production-readiness-baseline": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/guard-evaluator-and-scope.test.mjs"]],
    requiredReports: []
  },
  "proof-artifacts": {
    requiredCommands: [],
    requiredReports: ["build/reports/state-machines/latest.json"]
  },
  "docs-config-consistency": {
    requiredCommands: [["npm", "run", "server:verify:docs-governance"]],
    requiredReports: []
  }
};

/**
 * Evaluate evidence for a single scope.
 * A scope passes only when ALL requiredCommands have exitCode 0
 * AND ALL requiredReports exist and pass basic freshness validation.
 *
 * @returns {{ status, verificationMode, actualEvidence, failureReasons }}
 */
function evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit) {
  const plan = evidencePlan[scope.scopeId] || { requiredCommands: [], requiredReports: [] };
  const actualEvidence = [];
  const failureReasons = [];

  // Evaluate required commands
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

  // Evaluate required reports
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

async function main() {
  const runId = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "Z");

  const branch = gitValueSync(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  const commit = gitValueSync(["rev-parse", "HEAD"]) || "unknown";
  const dirtyCount = gitValueSync(["status", "--short"])
    .split("\n")
    .filter(Boolean).length;

  // Phase 1: Run all unique required commands (deduplicated by command string)
  const allRequiredCommands = new Map();
  for (const scope of READINESS_SCOPES.allScopes()) {
    const plan = scopeEvidencePlan[scope.scopeId];
    if (!plan) continue;
    for (const cmd of plan.requiredCommands) {
      const key = cmd.join(" ");
      if (!allRequiredCommands.has(key)) {
        allRequiredCommands.set(key, cmd);
      }
    }
  }

  console.log(`[baseline] Running ${allRequiredCommands.size} unique required commands...`);
  const commandResults = {};
  for (const [key, cmd] of allRequiredCommands) {
    console.log(`[baseline]   ${key}`);
    commandResults[key] = runVerifier(cmd);
  }

  // Phase 2: Collect required report freshness
  const reportResults = {};
  const allRequiredReports = new Set();
  for (const scope of READINESS_SCOPES.allScopes()) {
    const plan = scopeEvidencePlan[scope.scopeId];
    if (!plan) continue;
    for (const rp of plan.requiredReports) {
      allRequiredReports.add(rp);
    }
  }
  for (const rp of allRequiredReports) {
    const fullPath = path.join(repoRoot, rp);
    const reportData = readJsonFile(fullPath);
    reportResults[rp] = {
      exists: reportData !== null,
      hash: sha256File(fullPath),
      generatedAt: reportData?.generatedAt || reportData?.checkedAt || null
    };
  }

  // Phase 3: Evaluate each scope
  const scopeResults = {};
  for (const scope of READINESS_SCOPES.allScopes()) {
    const evalResult = evaluateScopeEvidence(
      scope,
      scopeEvidencePlan,
      commandResults,
      reportResults,
      commit
    );
    scopeResults[scope.scopeId] = {
      status: evalResult.status,
      verificationMode: evalResult.verificationMode,
      evidenceMode: evalResult.verificationMode,
      requiredEvidence: scope.requiredEvidence || [],
      actualEvidence: evalResult.actualEvidence,
      failureReasons: evalResult.failureReasons,
      waiver: null
    };
  }

  const report = buildReadinessReport(scopeResults, {
    runId,
    branch,
    commit,
    dirtyFileCount: dirtyCount
  });

  // Write run-id specific reports
  const outputDir = path.join(
    repoRoot,
    "build/reports/production-readiness-baseline",
    runId
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Also write latest.json as a pointer
  const latestPath = path.join(
    repoRoot,
    "build/reports/production-readiness-baseline",
    "latest.json"
  );
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(`Baseline v0.1 claim allowed: ${report.baselineV0_1ClaimAllowed}`);
  console.log(`Production claim allowed: ${report.productionClaimAllowed}`);
  console.log(`Overall status: ${report.overallStatus}`);
  console.log(
    `Baseline: ${report.summary.baselinePassed}/${report.summary.baselineRequiredTotal} passed`
  );
  console.log(
    `Production: ${report.summary.productionPassed}/${report.summary.productionRequiredTotal} passed, ${report.summary.productionMissingOrDeferred} missing/deferred`
  );
  console.log(`Report: ${path.relative(repoRoot, jsonPath)}`);

  if (!report.baselineV0_1ClaimAllowed) {
    process.exitCode = 1;
  }
}

await main();
