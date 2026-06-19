#!/usr/bin/env node
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const spec = `${packageJson.name}@${packageJson.version}`;
const registry = packageJson.publishConfig?.registry || "https://registry.npmjs.org/";

const existing = spawnSync("npm", ["view", spec, "version", `--registry=${registry}`], {
  encoding: "utf8"
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

const dryRun = spawnSync("npm", ["publish", "--dry-run"], {
  encoding: "utf8",
  stdio: "inherit"
});

if (dryRun.status !== 0) {
  process.exit(dryRun.status ?? 1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checked: "pactium-publish-dry-run",
  package: spec,
  skipped: false
}, null, 2)}\n`);
