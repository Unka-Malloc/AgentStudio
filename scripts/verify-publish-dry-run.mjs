#!/usr/bin/env node
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const spec = `${packageJson.name}@${packageJson.version}`;
const registry = packageJson.publishConfig?.registry || "https://registry.npmjs.org/";
const viewTimeoutMs = 20_000;
const publishDryRunTimeoutMs = 120_000;

const existing = spawnSync("npm", ["view", spec, "version", `--registry=${registry}`], {
  encoding: "utf8",
  timeout: viewTimeoutMs
});

if (existing.status === 0) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    checked: "pactium-publish-dry-run",
    package: spec,
    skipped: true,
    reason: "version_already_published"
  }, null, 2)}\n`);
  process.exit(0);
}

const versionCheck = existing.error?.code === "ETIMEDOUT"
  ? "version_check_timeout"
  : "version_not_published";

const dryRun = spawnSync("npm", ["publish", "--dry-run"], {
  encoding: "utf8",
  stdio: "inherit",
  timeout: publishDryRunTimeoutMs
});

if (dryRun.error) {
  process.stderr.write(`npm publish --dry-run failed: ${dryRun.error.message}\n`);
  process.exit(1);
}

if (dryRun.status !== 0) {
  process.exit(dryRun.status ?? 1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checked: "pactium-publish-dry-run",
  package: spec,
  skipped: false,
  versionCheck
}, null, 2)}\n`);
