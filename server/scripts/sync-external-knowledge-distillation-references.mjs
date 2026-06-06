#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const defaultManifestPath = path.join(repoRoot, "external-services/knowledge-distillation-service/reference-frameworks.json");
const PROTOCOL_VERSION = "pact.external-knowledge-distillation.reference-sync.v1";
const STRATEGY = "manifest-pinned-git-reference-sync.v1";

function parseArgs(argv = []) {
  const args = {
    manifestPath: defaultManifestPath,
    only: new Set(),
    sync: false,
    audit: false,
    json: false,
    dryRun: false,
    allowDirty: false,
    requirePresent: false,
    requireCommitMatch: false,
    fetchDepth: 1000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      args.manifestPath = path.resolve(argv[++index] || "");
    } else if (arg === "--only") {
      for (const value of String(argv[++index] || "").split(",")) {
        if (value.trim()) args.only.add(value.trim());
      }
    } else if (arg === "--sync") {
      args.sync = true;
    } else if (arg === "--audit") {
      args.audit = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--allow-dirty") {
      args.allowDirty = true;
    } else if (arg === "--require-present") {
      args.requirePresent = true;
    } else if (arg === "--require-commit-match") {
      args.requireCommitMatch = true;
    } else if (arg === "--fetch-depth") {
      args.fetchDepth = Math.max(1, Number(argv[++index] || 1000) || 1000);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.sync && !args.audit) {
    args.audit = true;
  }
  return args;
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
    stdio: options.stdio || ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout || ""}\n${result.stderr || ""}`.trim());
  }
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function git(args = [], options = {}) {
  return run("git", args, options);
}

function resolveLocalPath(localPath = "") {
  const value = String(localPath || "").trim();
  if (!value) return "";
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function shortHead(resolvedPath = "") {
  const result = git(["-C", resolvedPath, "rev-parse", "--short", "HEAD"], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function dirtyFileCount(resolvedPath = "") {
  const result = git(["-C", resolvedPath, "status", "--short", "--untracked-files=no"], { allowFailure: true });
  if (result.status !== 0) return 0;
  return result.stdout.trim() ? result.stdout.trim().split(/\r?\n/).filter(Boolean).length : 0;
}

function checkoutStatus(framework = {}) {
  const resolvedPath = resolveLocalPath(framework.localPath);
  const exists = Boolean(resolvedPath && fsSync.existsSync(resolvedPath));
  const gitPresent = exists && fsSync.existsSync(path.join(resolvedPath, ".git"));
  const actualCommit = gitPresent ? shortHead(resolvedPath) : "";
  const dirty = gitPresent ? dirtyFileCount(resolvedPath) : 0;
  const expected = String(framework.commit || "").trim();
  const commitMatches = Boolean(expected && actualCommit && actualCommit.startsWith(expected));
  return {
    id: framework.id,
    name: framework.name,
    repo: framework.repo,
    url: framework.url,
    localPath: framework.localPath,
    resolvedPath,
    manifestCommit: expected,
    exists,
    gitPresent,
    actualCommit,
    commitMatches,
    dirtyFileCount: dirty,
    status: !exists
      ? "missing"
      : !gitPresent
        ? "not-git-checkout"
        : !commitMatches
          ? "commit-mismatch"
          : dirty
            ? "verified-dirty"
            : "verified",
    syncCommand: `npm run server:external-kd:sync-references -- --only ${framework.id}`
  };
}

function syncFramework(framework = {}, options = {}) {
  const before = checkoutStatus(framework);
  const actions = [];
  const resolvedPath = before.resolvedPath;
  const parent = path.dirname(resolvedPath);
  const expected = String(framework.commit || "").trim();
  const runGit = (args, cwd = repoRoot, runOptions = {}) => {
    actions.push({ command: `git ${args.join(" ")}`, cwd });
    if (options.dryRun) {
      return { status: 0, stdout: "", stderr: "" };
    }
    return git(args, { cwd, allowFailure: Boolean(runOptions.allowFailure) });
  };

  if (before.exists && !before.gitPresent) {
    return { ...before, action: "skipped-not-git-checkout", actions };
  }
  if (before.gitPresent && before.dirtyFileCount > 0 && !options.allowDirty) {
    return { ...before, action: "skipped-dirty-checkout", actions };
  }
  if (before.commitMatches && before.dirtyFileCount === 0) {
    return { ...before, action: "already-current", actions };
  }

  if (!before.exists) {
    actions.push({ command: `mkdir -p ${parent}`, cwd: repoRoot });
    if (!options.dryRun) {
      fsSync.mkdirSync(parent, { recursive: true });
    }
    runGit(["clone", "--filter=blob:none", "--no-checkout", framework.url, resolvedPath]);
  }

  const fetchDepth = String(options.fetchDepth || 1000);
  const fetchByCommit = runGit(["-C", resolvedPath, "fetch", "--depth", "1", "origin", expected], repoRoot, { allowFailure: true });
  if (fetchByCommit.status !== 0 && !options.dryRun) {
    runGit(["-C", resolvedPath, "fetch", "--tags", "--depth", fetchDepth, "origin"], repoRoot);
  }
  runGit(["-C", resolvedPath, "checkout", "--detach", expected], repoRoot);

  const after = options.dryRun
    ? { ...before, status: "dry-run", commitMatches: before.commitMatches, actualCommit: before.actualCommit }
    : checkoutStatus(framework);
  return {
    ...after,
    action: options.dryRun ? "dry-run-sync-plan" : "synced",
    before,
    actions
  };
}

async function loadManifest(manifestPath = defaultManifestPath) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(Array.isArray(manifest.frameworks), true, "reference-frameworks.json must contain frameworks[]");
  return manifest;
}

function filterFrameworks(frameworks = [], only = new Set()) {
  if (!only.size) return frameworks;
  return frameworks.filter((framework) => only.has(framework.id));
}

function summarize(frameworks = []) {
  return {
    expectedCount: frameworks.length,
    presentCount: frameworks.filter((framework) => framework.exists).length,
    gitCheckoutCount: frameworks.filter((framework) => framework.gitPresent).length,
    commitMatchCount: frameworks.filter((framework) => framework.commitMatches).length,
    dirtyCheckoutCount: frameworks.filter((framework) => framework.dirtyFileCount > 0).length,
    missingCount: frameworks.filter((framework) => !framework.exists).length,
    actionableCount: frameworks.filter((framework) => !framework.commitMatches || !framework.gitPresent || !framework.exists).length
  };
}

function printHuman(report = {}) {
  console.log(`Reference sync strategy: ${report.strategy}`);
  console.log(`Manifest: ${report.manifestPath}`);
  console.log(`Local root: ${report.localRoot}`);
  console.log(`Summary: ${report.summary.commitMatchCount}/${report.summary.expectedCount} pinned checkouts match`);
  for (const framework of report.frameworks) {
    const suffix = framework.commitMatches ? "" : ` -> ${framework.syncCommand}`;
    console.log(`- ${framework.id}: ${framework.status} ${framework.actualCommit || "-"} expected=${framework.manifestCommit}${suffix}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest(options.manifestPath);
  const selected = filterFrameworks(manifest.frameworks, options.only);
  const frameworks = selected.map((framework) => (
    options.sync ? syncFramework(framework, options) : checkoutStatus(framework)
  ));
  const report = {
    protocolVersion: PROTOCOL_VERSION,
    strategy: STRATEGY,
    generatedAt: new Date().toISOString(),
    manifestPath: path.relative(repoRoot, options.manifestPath),
    manifestFrameworkCount: manifest.frameworks.length,
    localRoot: manifest.localRoot || "",
    resolvedLocalRoot: resolveLocalPath(manifest.localRoot || ""),
    dryRun: options.dryRun,
    mode: options.sync ? "sync" : "audit",
    selection: options.only.size ? Array.from(options.only) : ["all"],
    summary: summarize(frameworks),
    frameworks
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  if (options.requirePresent && report.summary.presentCount < report.summary.expectedCount) {
    process.exitCode = 2;
  }
  if (options.requireCommitMatch && report.summary.commitMatchCount < report.summary.expectedCount) {
    process.exitCode = 3;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
