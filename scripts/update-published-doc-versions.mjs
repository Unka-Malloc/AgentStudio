#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const check = args.has("--check") || !write;

if (args.has("--help")) {
  process.stdout.write(`Usage:
  node scripts/update-published-doc-versions.mjs --check
  node scripts/update-published-doc-versions.mjs --write

Synchronizes current package-version references in published package docs from package.json.
CHANGELOG.md is intentionally treated as historical release record and is not rewritten.
`);
  process.exit(0);
}

if (write && args.has("--check")) {
  throw new Error("Use either --check or --write, not both.");
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

function runNpmPackDryRun() {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run --json failed\n${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Expected npm pack JSON to contain one package.");
  }
  return parsed[0];
}

function isMarkdownDoc(filePath) {
  return [".md", ".mdx"].includes(path.extname(filePath).toLowerCase());
}

function replaceVersionSlot({ file, text, findings, rule, pattern, packageVersion }) {
  return text.replace(pattern, (match, before, current, after) => {
    if (current === packageVersion) return match;
    findings.push({
      file,
      rule,
      current,
      expected: packageVersion
    });
    return `${before}${packageVersion}${after}`;
  });
}

function syncText(file, text, packageVersion) {
  const findings = [];
  let next = text;

  next = replaceVersionSlot({
    file,
    text: next,
    findings,
    rule: "package_version_marker",
    pattern: /(<!--\s*pactium:package-version\s*-->)([\s\S]*?)(<!--\s*\/pactium:package-version\s*-->)/g,
    packageVersion
  });

  next = replaceVersionSlot({
    file,
    text: next,
    findings,
    rule: "api_package_version_comment",
    pattern: /(PACTIUM_PACKAGE_VERSION[^\n]*?\/\/\s*")(\d+\.\d+\.\d+)(")/g,
    packageVersion
  });

  next = replaceVersionSlot({
    file,
    text: next,
    findings,
    rule: "migration_patch_version_example",
    pattern: /(\*\*Patch\*\*\s*\()(\d+\.\d+\.\d+)(\)\s*--)/g,
    packageVersion
  });

  return { next, findings };
}

async function main() {
  const packageJson = JSON.parse(await readText("package.json"));
  const packageVersion = packageJson.version;
  const pack = runNpmPackDryRun();
  const historicalDocs = new Set(["CHANGELOG.md"]);
  const publishedDocs = (pack.files || [])
    .map((file) => file.path)
    .filter(isMarkdownDoc)
    .sort();
  const managedDocs = publishedDocs.filter((file) => !historicalDocs.has(file));
  const skippedHistoricalDocs = publishedDocs.filter((file) => historicalDocs.has(file));
  const changed = [];
  const findings = [];

  for (const file of managedDocs) {
    const text = await readText(file);
    const result = syncText(file, text, packageVersion);
    if (result.findings.length === 0) continue;
    findings.push(...result.findings);
    changed.push(file);
    if (write) {
      await fs.writeFile(path.join(root, file), result.next);
    }
  }

  if (check && findings.length > 0) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      checked: "pactium-published-doc-versions",
      package: `${packageJson.name}@${packageVersion}`,
      findings,
      hint: "Run npm run docs:sync-version after updating package.json version."
    }, null, 2)}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checked: "pactium-published-doc-versions",
    mode: write ? "write" : "check",
    package: `${packageJson.name}@${packageVersion}`,
    checkedFiles: managedDocs.length,
    skippedHistoricalDocs,
    changed
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
