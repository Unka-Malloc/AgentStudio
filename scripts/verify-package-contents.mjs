#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

const requiredFiles = [
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "SECURITY.md",
  "bin/pactium.mjs",
  "docs/LICOLITE-ASPECT.md",
  "docs/README.md",
  "docs/TERM.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/protocols/PROFILE.md",
  "docs/protocols/PROTOCOLS.md",
  "examples/record-operation.mjs",
  "package.json",
  "src/aspects/licolite/index.d.ts",
  "src/aspects/licolite/index.js",
  "src/index.d.ts",
  "src/index.js"
];

const deniedExactFiles = new Set([
  "AGENT.md",
  "CONTEXT.md",
  "docs/Manifest.md",
  "docs/QUALITY-GATES.md",
  "docs/RELEASE.md",
  "docs/TOOLING.md",
  "package-lock.json"
]);

const deniedPathPatterns = [
  { pattern: /^\.github\//, reason: "github_workflow_in_package" },
  { pattern: /^\.codex-research\//, reason: "research_cache_in_package" },
  { pattern: /^\.gemini\//, reason: "agent_cache_in_package" },
  { pattern: /^\.impeccable\//, reason: "agent_cache_in_package" },
  { pattern: /^\.kilo\//, reason: "agent_cache_in_package" },
  { pattern: /^build\//, reason: "build_cache_in_package" },
  { pattern: /^coverage\//, reason: "coverage_cache_in_package" },
  { pattern: /^docs\/adr\//, reason: "process_doc_in_package" },
  { pattern: /^docs\/optimization\//, reason: "process_doc_in_package" },
  { pattern: /^node_modules\//, reason: "dependency_cache_in_package" },
  { pattern: /^scripts\//, reason: "release_tooling_in_package" },
  { pattern: /^test-results\//, reason: "test_cache_in_package" },
  { pattern: /^tests\//, reason: "test_fixture_in_package" }
];

const deniedBinaryCacheExtensions = new Set([
  ".app",
  ".AppImage",
  ".asar",
  ".bin",
  ".br",
  ".db",
  ".dmg",
  ".exe",
  ".gz",
  ".msi",
  ".pack",
  ".rar",
  ".sqlite",
  ".tar",
  ".tgz",
  ".wasm",
  ".zip",
  ".zst"
]);

const forbiddenDocLinkPattern = /\]\((?:\.\.\/|\.\/)?(?:AGENT\.md|docs\/(?:adr|optimization|Manifest\.md|QUALITY-GATES\.md|RELEASE\.md|TOOLING\.md)|(?:\.\.\/)?(?:adr|optimization|Manifest\.md|QUALITY-GATES\.md|RELEASE\.md|TOOLING\.md))/i;

function addFinding(findings, file, reason, detail = "") {
  findings.push({ file, reason, detail });
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
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1) {
      throw new Error("Expected npm pack JSON to contain one package.");
    }
    return parsed[0];
  } catch (error) {
    throw new Error(`Could not parse npm pack JSON: ${error.message}\n${result.stdout}`);
  }
}

function verifyRequiredFiles(packageFiles, findings) {
  const packageFileSet = new Set(packageFiles.map((file) => file.path));
  for (const requiredFile of requiredFiles) {
    if (!packageFileSet.has(requiredFile)) {
      addFinding(findings, requiredFile, "missing_required_package_file");
    }
  }
}

function verifyDeniedFiles(packageFiles, findings) {
  for (const file of packageFiles) {
    if (deniedExactFiles.has(file.path)) {
      addFinding(findings, file.path, "process_doc_in_package");
    }
    for (const { pattern, reason } of deniedPathPatterns) {
      if (pattern.test(file.path)) {
        addFinding(findings, file.path, reason);
      }
    }
    if (deniedBinaryCacheExtensions.has(path.extname(file.path))) {
      addFinding(findings, file.path, "binary_or_cache_artifact_in_package");
    }
    if (file.size > 1_000_000) {
      addFinding(findings, file.path, "oversized_package_file", `${file.size} bytes`);
    }
  }
}

function verifyExecutableBins(packageFiles, findings) {
  const binFile = packageFiles.find((file) => file.path === "bin/pactium.mjs");
  if (!binFile) return;
  if ((binFile.mode & 0o111) === 0) {
    addFinding(findings, binFile.path, "bin_file_not_executable", `mode ${binFile.mode.toString(8)}`);
  }
}

async function verifyPublishedDocLinks(packageFiles, findings) {
  const markdownFiles = packageFiles
    .map((file) => file.path)
    .filter((file) => [".md", ".mdx"].includes(path.extname(file).toLowerCase()));

  for (const file of markdownFiles) {
    const text = await readText(file);
    if (forbiddenDocLinkPattern.test(text)) {
      addFinding(
        findings,
        file,
        "published_doc_links_unpublished_process_doc",
        "Published package docs must not link to release, tooling, ADR, optimization, agent, or manifest process documents."
      );
    }
  }
}

async function main() {
  const findings = [];
  const pack = runNpmPackDryRun();
  const packageFiles = pack.files || [];

  verifyRequiredFiles(packageFiles, findings);
  verifyDeniedFiles(packageFiles, findings);
  verifyExecutableBins(packageFiles, findings);
  await verifyPublishedDocLinks(packageFiles, findings);

  if (findings.length > 0) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      checked: "pactium-package-contents",
      package: `${pack.name}@${pack.version}`,
      findings
    }, null, 2)}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checked: "pactium-package-contents",
    package: `${pack.name}@${pack.version}`,
    fileCount: packageFiles.length,
    unpackedSize: pack.unpackedSize
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
