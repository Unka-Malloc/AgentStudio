#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const syncScript = path.join(repoRoot, "server/scripts/sync-external-knowledge-distillation-references.mjs");

function runJson(args = []) {
  const result = spawnSync(process.execPath, [syncScript, ...args, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`reference sync ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`.trim());
  }
  return JSON.parse(result.stdout);
}

const audit = runJson(["--audit", "--require-present", "--require-commit-match"]);
assert.equal(audit.protocolVersion, "pact.external-knowledge-distillation.reference-sync.v1");
assert.equal(audit.strategy, "manifest-pinned-git-reference-sync.v1");
assert.equal(audit.mode, "audit");
assert.equal(audit.summary.expectedCount >= 6, true);
assert.equal(audit.summary.presentCount, audit.summary.expectedCount);
assert.equal(audit.summary.gitCheckoutCount, audit.summary.expectedCount);
assert.equal(audit.summary.commitMatchCount, audit.summary.expectedCount);
assert.equal(audit.frameworks.every((framework) => framework.syncCommand.includes("--only")), true);
assert.equal(audit.frameworks.some((framework) => framework.id === "graphrag" && framework.status === "verified"), true);
assert.equal(audit.frameworks.some((framework) => framework.id === "docling" && framework.resolvedPath.endsWith("docling")), true);

const one = runJson(["--audit", "--only", "graphrag"]);
assert.equal(one.summary.expectedCount, 1);
assert.equal(one.frameworks[0].id, "graphrag");
assert.equal(one.frameworks[0].commitMatches, true);

const dryRun = runJson(["--sync", "--dry-run", "--only", "graphrag"]);
assert.equal(dryRun.mode, "sync");
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.summary.expectedCount, 1);
assert.equal(["already-current", "dry-run-sync-plan"].includes(dryRun.frameworks[0].action), true);

console.log("external knowledge distillation reference framework verification passed");
