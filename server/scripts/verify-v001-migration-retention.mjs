#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function parseArgs(argv) {
  const options = {
    outputDir: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      options.outputDir = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`verify-v001-migration-retention

Verify that v0.0.1 runtime retention reports do not copy secret material.

Usage:
  node server/scripts/verify-v001-migration-retention.mjs [--output-dir PATH]
`);
      process.exit(0);
    }
  }
  return options;
}

async function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootPath) {
  const files = [];
  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  await visit(rootPath);
  return files;
}

async function latestReport(outputDir) {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const runDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outputDir, entry.name))
    .sort();
  assert.ok(runDirs.length > 0, "migration verifier should create a run directory");
  const reportPath = path.join(runDirs.at(-1), "migration-report.json");
  return {
    runDir: runDirs.at(-1),
    report: JSON.parse(await fs.readFile(reportPath, "utf8"))
  };
}

const options = parseArgs(process.argv.slice(2));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-v001-retention-"));
const dataDir = path.join(tempRoot, "data");
const outputDir = options.outputDir ? path.resolve(options.outputDir) : path.join(tempRoot, "out");

const secretNeedles = [
  "FAKE_TOKEN_FOR_MIGRATION_RETENTION_TEST",
  "FAKE_SEALING_KEY_FOR_MIGRATION_RETENTION_TEST",
  "FAKE_CSRF_SECRET_FOR_MIGRATION_RETENTION_TEST",
  "FAKE_SENSITIVE_PROMPT_FOR_MIGRATION_RETENTION_TEST"
];

try {
  await writeFile(dataDir, "auth/console-auth.sqlite", "sqlite-placeholder\n");
  await writeFile(dataDir, "auth/csrf-hmac-secret.bin", secretNeedles[2]);
  await writeFile(dataDir, "security/authorization/grants.json", JSON.stringify({ grants: [] }, null, 2));
  await writeFile(dataDir, "security/capability-kernel/verify.sealing-key", secretNeedles[1]);
  await writeFile(dataDir, "security/capability-kernel/verify.sealed.json", JSON.stringify({ sealed: true }, null, 2));
  await writeFile(dataDir, "secrets/registry.json", JSON.stringify({ refs: { "secret://pact/test": { redacted: "***test" } } }, null, 2));
  await writeFile(dataDir, "secrets/values/fake.json", JSON.stringify({ payload: { token: secretNeedles[0] } }, null, 2));
  await writeFile(dataDir, "agent-relay/acp-sensitive-payloads.json", JSON.stringify({ payloads: { pending: { prompt: secretNeedles[3] } } }, null, 2));

  const result = spawnSync(process.execPath, [
    "server/scripts/migrate-v001.mjs",
    "--data-dir",
    dataDir,
    "--output-dir",
    outputDir,
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "ready");

  const { runDir, report } = await latestReport(outputDir);
  assert.equal(report.summary.sensitiveFileCount, 4);

  const skippedByPath = new Map(report.recovery.skipped.map((entry) => [entry.relativePath, entry]));
  for (const relativePath of [
    "auth/csrf-hmac-secret.bin",
    "security/capability-kernel/verify.sealing-key",
    "secrets/values/fake.json",
    "agent-relay/acp-sensitive-payloads.json"
  ]) {
    assert.equal(skippedByPath.get(relativePath)?.reason, "sensitive-recovery-material", `${relativePath} must be skipped as sensitive material`);
  }

  assert.equal(await exists(path.join(runDir, "recovery-files", "auth", "console-auth.sqlite")), true);
  assert.equal(await exists(path.join(runDir, "recovery-files", "auth", "csrf-hmac-secret.bin")), false);
  assert.equal(await exists(path.join(runDir, "recovery-files", "security", "capability-kernel", "verify.sealing-key")), false);
  assert.equal(await exists(path.join(runDir, "recovery-files", "secrets", "values", "fake.json")), false);
  assert.equal(await exists(path.join(runDir, "recovery-files", "agent-relay", "acp-sensitive-payloads.json")), false);

  const outputFiles = await collectFiles(outputDir);
  for (const filePath of outputFiles) {
    const content = await fs.readFile(filePath, "utf8").catch(() => "");
    for (const needle of secretNeedles) {
      assert.equal(content.includes(needle), false, `${filePath} must not contain copied secret material`);
    }
  }

  console.log("v0.0.1 migration retention verification passed");
  console.log(`Migration report: ${path.relative(repoRoot, path.join(runDir, "migration-report.md"))}`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
