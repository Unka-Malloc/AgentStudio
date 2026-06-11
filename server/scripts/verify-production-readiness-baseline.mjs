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
 * NOT registered as a reportValidator for the current run's own report
 * (to avoid self-certification). Used for validating external/historical
 * baseline reports only.
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
  if (typeof report.baselineV0_1ClaimAllowed !== "boolean") {
    errors.push("Report missing baselineV0_1ClaimAllowed.");
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
 * Validate a state-machine verifier report.
 * Requires ok === true, machines array covering all definitions,
 * each machine ok === true, and each check status === "passed".
 */
function validateStateMachineReport(report, context = {}) {
  if (!report || typeof report !== "object") {
    return { ok: false, reason: "report_missing_or_invalid" };
  }
  if (report.ok !== true) {
    return { ok: false, reason: "report_failed" };
  }
  if (!Array.isArray(report.machines) || report.machines.length === 0) {
    return { ok: false, reason: "report_no_machines" };
  }

  // Check machine coverage against definitions directory
  if (context.definitionMachineIds && context.definitionMachineIds.length > 0) {
    const reportMachineIds = new Set(report.machines.map(m => m.machineId));
    const missing = context.definitionMachineIds.filter(id => !reportMachineIds.has(id));
    if (missing.length > 0) {
      return { ok: false, reason: "report_scope_mismatch", missingMachineIds: missing };
    }
  }

  // Each machine must have ok === true and pass all checks
  for (const machine of report.machines) {
    if (!machine.machineId || !machine.version) {
      return { ok: false, reason: "report_machine_missing_fields", machineId: machine.machineId || "unknown" };
    }
    if (machine.ok !== true) {
      return { ok: false, reason: "report_machine_failed", failedMachineId: machine.machineId };
    }
    if (!Array.isArray(machine.checks) || machine.checks.length === 0) {
      return { ok: false, reason: "report_machine_missing_checks", machineId: machine.machineId };
    }
    const failedChecks = machine.checks.filter(c => c.status !== "passed");
    if (failedChecks.length > 0) {
      return {
        ok: false,
        reason: "report_check_failed",
        machineId: machine.machineId,
        failedChecks: failedChecks.map(c => c.id)
      };
    }
  }

  // If report has commit field, verify it matches current commit
  if (typeof report.commit === "string" && context.currentCommit && report.commit !== context.currentCommit) {
    return { ok: false, reason: "report_commit_mismatch", reportCommit: report.commit, currentCommit: context.currentCommit };
  }

  // Dirty file count: reject if present
  if (typeof report.dirtyFileCount === "number" && report.dirtyFileCount > 0) {
    return { ok: false, reason: "report_dirty_worktree", dirtyFileCount: report.dirtyFileCount };
  }

  return { ok: true, reason: "report_valid" };
}

/**
 * Get the timestamp from a report (checkedAt or generatedAt).
 */
function getReportTimestamp(report) {
  if (!report) return null;
  return report.checkedAt || report.generatedAt || report.timestamp || null;
}

/**
 * Check if a file exists and read its content synchronously.
 */
function fileExistsAndReadable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Evidence plan: defines required commands and required reports per scope.
 * Aligned with READINESS_SCOPES.requiredEvidence.
 */
const scopeEvidencePlan = {
  "state-machine-core": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/state-machine-core.test.mjs"]],
    requiredReports: [{ path: "build/reports/state-machines/latest.json", producedBy: "npm run server:verify:state-machines" }]
  },
  "state-machine-schema": {
    requiredCommands: [],
    requiredReports: [{ path: "build/reports/state-machines/latest.json", producedBy: "npm run server:verify:state-machines" }]
  },
  "state-machine-verifier": {
    requiredCommands: [["npm", "run", "server:verify:state-machines"]],
    requiredReports: [{ path: "build/reports/state-machines/latest.json", producedBy: "npm run server:verify:state-machines" }]
  },
  "contribution.lifecycle": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/contribution-lifecycle-state-machine.test.mjs"]],
    requiredReports: [],
    requiredFiles: ["server/platform/common/state-machine/definitions/contribution.lifecycle.v1.json"]
  },
  "agentlibrary.loan": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/knowledge-loan-lifecycle-state-machine.test.mjs"]],
    requiredReports: [],
    requiredFiles: ["server/platform/common/state-machine/definitions/agentlibrary.loan.v1.json"]
  },
  "checkpoint.restore": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/checkpoint-restore-lifecycle-state-machine.test.mjs"]],
    requiredReports: [],
    requiredFiles: ["server/platform/common/state-machine/definitions/checkpoint.restore.v1.json"]
  },
  "operation.narrow": {
    requiredCommands: [["npx", "vitest", "run", "tests/vitest/server/operation-state-machine-integration.test.mjs"]],
    requiredReports: [],
    requiredFiles: ["server/platform/common/state-machine/definitions/operation.narrow.v1.json"]
  },
  "production-readiness-baseline": {
    requiredCommands: [
      ["npm", "run", "server:verify:state-machines"],
      ["npx", "vitest", "run", "tests/vitest/server/guard-evaluator-and-scope.test.mjs"],
      ["npx", "vitest", "run", "tests/vitest/server/production-readiness-lifecycle-state-machine.test.mjs"],
      ["npx", "vitest", "run", "tests/vitest/server/production-readiness-baseline-evidence.test.mjs"]
    ],
    requiredReports: [{ path: "build/reports/state-machines/latest.json", producedBy: "npm run server:verify:state-machines" }],
    requiredFiles: [
      "server/platform/common/state-machine/definitions/production.readiness.lifecycle.v1.json",
      "server/platform/specialized/production-readiness/readiness-scope-registry.mjs",
      "server/platform/common/state-machine/guards/guard-evaluator.mjs"
    ]
  },
  "proof-artifacts": {
    requiredCommands: [["npm", "run", "server:verify:state-machines"]],
    requiredReports: [{ path: "build/reports/state-machines/latest.json", producedBy: "npm run server:verify:state-machines" }],
    requiredFiles: ["docs/STATE-MACHINE-TRACEABILITY.md"]
  },
  "docs-config-consistency": {
    requiredCommands: [
      ["npm", "run", "server:verify:docs-governance"],
      ["npm", "run", "server:verify:language-policy"]
    ],
    requiredReports: []
  }
};

/**
 * Evaluate evidence for a single scope.
 * A scope passes only when ALL requiredCommands have exitCode 0,
 * ALL requiredReports pass content validation and freshness,
 * AND ALL requiredFiles exist.
 *
 * @returns {{ status, verificationMode, actualEvidence, failureReasons }}
 */
function evaluateScopeEvidence(scope, evidencePlan, commandResults, reportResults, commit, commandStartTimes, reportValidators, definitionsRegistry) {
  const plan = evidencePlan[scope.scopeId] || { requiredCommands: [], requiredReports: [], requiredFiles: [] };
  const actualEvidence = [];
  const failureReasons = [];

  // Evaluate required commands
  for (const reqCmd of plan.requiredCommands) {
    const cmdKey = reqCmd.join(" ");
    const result = commandResults[cmdKey];
    if (!result) {
      failureReasons.push(`command_not_run: ${cmdKey}`);
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
      failureReasons.push(`command_failed(exitCode=${result.exitCode}): ${cmdKey}`);
    }
  }

  // Evaluate required reports with content validation
  for (const reportEntry of plan.requiredReports) {
    // Support both string (path only) and object { path, producedBy }
    const reportPath = typeof reportEntry === "string" ? reportEntry : reportEntry.path;
    const producedBy = typeof reportEntry === "string" ? undefined : reportEntry.producedBy;
    const reportData = reportResults[reportPath];
    if (!reportData || !reportData.exists) {
      failureReasons.push(`report_missing: ${reportPath}`);
      continue;
    }
    // Content validation
    const validator = reportValidators[reportPath];
    const validationContext = {
      definitionMachineIds: definitionsRegistry,
      currentCommit: commit
    };
    let reportValidation = null;
    if (validator) {
      reportValidation = validator(reportData.data, validationContext);
      if (!reportValidation.ok) {
        failureReasons.push(`report_failed(${reportValidation.reason}): ${reportPath}`);
        continue;
      }
    }
    // Freshness check: if producedBy is specified, only compare against that command
    let fresh = false;
    let freshnessDetail = "stale";
    const reportTimestamp = reportData.data ? getReportTimestamp(reportData.data) : null;
    if (reportTimestamp && commandStartTimes) {
      if (producedBy) {
        const cmdStart = commandStartTimes[producedBy];
        if (cmdStart && reportTimestamp >= cmdStart) {
          fresh = true;
          freshnessDetail = "same-run";
        }
      } else {
        for (const [, cmdStart] of Object.entries(commandStartTimes)) {
          if (reportTimestamp >= cmdStart) {
            fresh = true;
            freshnessDetail = "same-run";
            break;
          }
        }
      }
    }
    if (!fresh) {
      const detail = producedBy ? `report not fresher than producer command ${producedBy}` : `no command start before report timestamp`;
      failureReasons.push(`report_stale(${freshnessDetail}): ${reportPath} (${detail})`);
      continue;
    }
    actualEvidence.push({
      reportPath,
      reportHash: reportData.hash,
      reportGeneratedAt: reportTimestamp,
      reportValidation: reportValidation ? {
        ok: reportValidation.ok,
        reason: reportValidation.reason
      } : null,
      freshness: freshnessDetail,
      generatedForCommit: commit
    });
  }

  // Evaluate required files
  for (const filePath of (plan.requiredFiles || [])) {
    const fullPath = path.join(repoRoot, filePath);
    const content = fileExistsAndReadable(fullPath);
    if (!content) {
      failureReasons.push(`required_file_missing: ${filePath}`);
      continue;
    }
    // For traceability file, check it contains machine IDs from definitions
    if (filePath === "docs/STATE-MACHINE-TRACEABILITY.md" && definitionsRegistry) {
      for (const machineId of definitionsRegistry) {
        if (!content.includes(machineId)) {
          failureReasons.push(`report_scope_mismatch: ${filePath} missing machine ${machineId}`);
          break;
        }
      }
    }
    actualEvidence.push({
      filePath,
      generatedForCommit: commit
    });
  }

  const hasRequirements = plan.requiredCommands.length > 0 || plan.requiredReports.length > 0 || (plan.requiredFiles || []).length > 0;
  const verificationMode = hasRequirements
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
 * Self-discovery: verify every baseline scope has an evidence plan
 * covering all requiredEvidence entries.
 */
function verifyEvidencePlanCoversRegistry() {
  const gaps = [];
  for (const scope of READINESS_SCOPES.baselineScopes()) {
    const plan = scopeEvidencePlan[scope.scopeId];
    if (!plan) {
      gaps.push(`${scope.scopeId}: no evidence plan found`);
      continue;
    }
    const allRequired = scope.requiredEvidence || [];
    let covered = 0;
    for (const evidenceItem of allRequired) {
      const mapped = isEvidenceMapped(evidenceItem, plan);
      if (mapped) covered++;
    }
    if (covered < allRequired.length) {
      const uncovered = allRequired.filter(e => !isEvidenceMapped(e, plan));
      gaps.push(`${scope.scopeId}: ${covered}/${allRequired.length} evidence items covered (missing: ${uncovered.join(", ")})`);
    }
  }
  return { ok: gaps.length === 0, gaps };
}

function evidenceText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => evidenceText(item)).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    return [
      value.path,
      value.producedBy,
      value.filePath,
      value.command
    ].map((item) => evidenceText(item)).filter(Boolean).join(" ");
  }
  return String(value || "");
}

function normalizeEvidenceText(value) {
  return evidenceText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function evidenceIncludes(value, keyword) {
  return evidenceText(value).toLowerCase().includes(keyword);
}

/**
 * Check if a requiredEvidence item maps to something in the evidence plan.
 * Matches against command strings, report paths, and file paths using
 * normalized keyword matching.
 */
function isEvidenceMapped(evidenceItem, plan) {
  const normalized = normalizeEvidenceText(evidenceItem);

  // Match against commands
  for (const cmd of (plan.requiredCommands || [])) {
    const cmdStr = normalizeEvidenceText(cmd);
    if (cmdStr.includes(normalized) || normalized.includes(cmdStr)) return true;
  }

  // Match against reports
  for (const rp of (plan.requiredReports || [])) {
    const rpNorm = normalizeEvidenceText(rp);
    if (rpNorm.includes(normalized) || normalized.includes(rpNorm)) return true;
  }

  // Match against files
  for (const fp of (plan.requiredFiles || [])) {
    const fpNorm = normalizeEvidenceText(fp);
    if (fpNorm.includes(normalized) || normalized.includes(fpNorm)) return true;
  }

  // Keyword expansions for abstract evidence names
  const keywordExpansions = {
    "c1schemavalidation": ["state-machines", "verifystatemachines", "verifier", "statemachinecore", "statemachine"],
    "statemachinedefinitionschematest": ["state-machine-core", "statemachinecore", "statemachine", "state-machines"],
    "statemachineverifier": ["state-machine-verifier", "verifystatemachines", "state-machines", "statemachinecore"],
    "verifierunittests": ["verifystatemachines", "state-machines", "state-machine-verifier"],
    "readinessscoperegistry": ["readinessscoperegistry", "productionreadiness", "guard-evaluator", "guardevaluator"],
    "guardevaluator": ["guardevaluator", "guard-evaluator", "guard"],
  };

  if (keywordExpansions[normalized]) {
    for (const kw of keywordExpansions[normalized]) {
      for (const cmd of (plan.requiredCommands || [])) {
        if (evidenceIncludes(cmd, kw)) return true;
      }
      for (const fp of (plan.requiredFiles || [])) {
        if (evidenceIncludes(fp, kw)) return true;
      }
      for (const rp of (plan.requiredReports || [])) {
        if (evidenceIncludes(rp, kw)) return true;
      }
    }
  }

  return false;
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

  // Phase 0: Self-discovery check (gaps in evidence plan are fatal)
  const registryCheck = verifyEvidencePlanCoversRegistry();
  if (!registryCheck.ok) {
    console.error("[baseline] Evidence plan gaps detected:");
    for (const gap of registryCheck.gaps) {
      console.error(`  - ${gap}`);
    }
    console.error("[baseline] Fix these gaps for evidence plan to fully cover registry.");
    process.exitCode = 1;
    return;
  }

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
  const commandStartTimes = {};
  for (const [key, cmd] of allRequiredCommands) {
    console.log(`[baseline]   ${key}`);
    const startTime = new Date().toISOString();
    commandStartTimes[key] = startTime;
    commandResults[key] = runVerifier(cmd);
  }

  // Phase 2: Collect required report freshness and content
  const reportResults = {};
  const allRequiredReports = new Set();
  for (const scope of READINESS_SCOPES.allScopes()) {
    const plan = scopeEvidencePlan[scope.scopeId];
    if (!plan) continue;
    for (const rp of plan.requiredReports) {
      const path = typeof rp === "string" ? rp : rp.path;
      allRequiredReports.add(path);
    }
  }
  for (const rp of allRequiredReports) {
    const fullPath = path.join(repoRoot, rp);
    const reportData = readJsonFile(fullPath);
    reportResults[rp] = {
      exists: reportData !== null,
      data: reportData,
      hash: sha256File(fullPath),
      generatedAt: reportData?.generatedAt || reportData?.checkedAt || null
    };
  }

  // Report content validators
  const reportValidators = {
    "build/reports/state-machines/latest.json": validateStateMachineReport
  };

  // Discover machine IDs from definitions directory for traceability check
  const definitionsDir = path.join(repoRoot, "server/platform/common/state-machine/definitions");
  const definitionsRegistry = [];
  try {
    const defFiles = fs.readdirSync(definitionsDir).filter(f => f.endsWith(".json"));
    for (const file of defFiles) {
      try {
        const def = JSON.parse(fs.readFileSync(path.join(definitionsDir, file), "utf8"));
        if (def.machineId) definitionsRegistry.push(def.machineId);
      } catch {}
    }
  } catch {}

  // Phase 3: Evaluate each scope
  const scopeResults = {};
  for (const scope of READINESS_SCOPES.allScopes()) {
    const evalResult = evaluateScopeEvidence(
      scope,
      scopeEvidencePlan,
      commandResults,
      reportResults,
      commit,
      commandStartTimes,
      reportValidators,
      definitionsRegistry
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
