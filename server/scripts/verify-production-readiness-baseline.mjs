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

/**
 * Run a verifier command and collect rich evidence.
 */
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

// scopeEvidenceMap: maps each scope to verifier commands and expected report paths
const scopeEvidenceMap = {
  "state-machine-core": {
    commands: [["npx", "vitest", "run", "tests/vitest/server/state-machine-core.test.mjs"]],
    reports: ["build/reports/state-machines/latest.json"]
  },
  "state-machine-schema": {
    commands: [],
    reports: ["build/reports/state-machines/latest.json"]
  },
  "state-machine-verifier": {
    commands: [["npm", "run", "server:verify:state-machines"]],
    reports: ["build/reports/state-machines/latest.json"]
  },
  "contribution.lifecycle": {
    commands: [["npx", "vitest", "run", "tests/vitest/server/contribution-lifecycle-state-machine.test.mjs"]],
    reports: []
  },
  "agentlibrary.loan": {
    commands: [["npx", "vitest", "run", "tests/vitest/server/knowledge-loan-lifecycle-state-machine.test.mjs"]],
    reports: []
  },
  "checkpoint.restore": {
    commands: [["npx", "vitest", "run", "tests/vitest/server/checkpoint-restore-lifecycle-state-machine.test.mjs"]],
    reports: []
  },
  "operation.narrow": {
    commands: [["npx", "vitest", "run", "tests/vitest/server/operation-state-machine-integration.test.mjs"]],
    reports: []
  },
  "production-readiness-baseline": {
    commands: [],
    reports: ["build/reports/production-readiness-baseline/latest.json"]
  },
  "proof-artifacts": {
    commands: [],
    reports: ["build/reports/state-machines/latest.json"]
  },
  "docs-config-consistency": {
    commands: [["npm", "run", "server:verify:docs-governance"]],
    reports: []
  }
};

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

  // Run state-machine verifier first to produce fresh evidence
  console.log("[baseline] Running state machine verifier...");
  const smVerifierResult = runVerifier(["npm", "run", "server:verify:state-machines"]);
  const smReport = smVerifierResult.exitCode === 0
    ? readJsonFile(path.join(repoRoot, "build/reports/state-machines/latest.json"))
    : null;

  const scopeResults = {};

  for (const scope of READINESS_SCOPES.allScopes()) {
    const evidence = [];
    const mapping = scopeEvidenceMap[scope.scopeId];
    let verificationMode = "notRun";
    let status = scope.baselineV0_1Required ? "failed" : "not_in_baseline_v0_1";

    // Collect evidence from state machine verifier report (fresh)
    if (smReport?.ok === true && mapping?.reports?.includes("build/reports/state-machines/latest.json")) {
      const reportHash = sha256File(path.join(repoRoot, "build/reports/state-machines/latest.json"));
      evidence.push({
        command: "npm run server:verify:state-machines",
        exitCode: smVerifierResult.exitCode,
        startedAt: smVerifierResult.startedAt,
        finishedAt: smVerifierResult.finishedAt,
        elapsedMs: smVerifierResult.elapsedMs,
        reportPath: "build/reports/state-machines/latest.json",
        reportHash,
        generatedAt: smReport.checkedAt || null,
        generatedForCommit: commit
      });
      verificationMode = "verified";
    }

    // Run scope-specific commands
    if (mapping?.commands?.length > 0) {
      for (const cmd of mapping.commands) {
        const r = runVerifier(cmd);
        evidence.push({
          command: cmd.join(" "),
          exitCode: r.exitCode,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          elapsedMs: r.elapsedMs,
          generatedForCommit: commit
        });
        if (r.exitCode === 0 && verificationMode === "notRun") {
          verificationMode = "verified";
        }
      }
    }

    // Run docs-governance for docs-config-consistency
    if (scope.scopeId === "docs-config-consistency") {
      const r = runVerifier(["npm", "run", "server:verify:docs-governance"]);
      evidence.push({
        command: "npm run server:verify:docs-governance",
        exitCode: r.exitCode,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        elapsedMs: r.elapsedMs,
        generatedForCommit: commit
      });
      if (r.exitCode === 0) verificationMode = "verified";
    }

    // For baseline-required scopes: only accept verified evidence as passed
    if (scope.baselineV0_1Required) {
      if (verificationMode === "verified") {
        status = "passed";
      } else {
        status = "failed";
      }
    }

    scopeResults[scope.scopeId] = {
      status,
      verificationMode,
      evidenceMode: verificationMode,
      requiredEvidence: scope.requiredEvidence || [],
      actualEvidence: evidence,
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
