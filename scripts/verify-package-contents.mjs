#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

const requiredFiles = [
  "LICENSE",
  "CHANGELOG.md",
  "README.md",
  "README.zh-CN.md",
  "SECURITY.md",
  "bin/pactium.mjs",
  "docs/API.md",
  "docs/FAQ.md",
  "docs/LICOLITE-ASPECT.md",
  "docs/MIGRATION.md",
  "docs/README.md",
  "docs/TERM.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/logo.svg",
  "docs/protocols/CANONICAL-ENCODING.md",
  "docs/protocols/PROFILE.md",
  "docs/protocols/PROTOCOLS.md",
  "docs/protocols/TRUST-ANCHORS.md",
  "examples/README.md",
  "examples/export-proof-bundle.mjs",
  "examples/licolite-signed-operation.mjs",
  "examples/record-operation.mjs",
  "examples/verify-envelope.mjs",
  "examples/workspace-projection.mjs",
  "package.json",
  "src/aspects/licolite/index.d.ts",
  "src/aspects/licolite/index.js",
  "src/http.d.ts",
  "src/index.d.ts",
  "src/index.js"
];

const approvedFiles = new Set([
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "SECURITY.md",
  "bin/pactium.mjs",
  "docs/API.md",
  "docs/FAQ.md",
  "docs/LICOLITE-ASPECT.md",
  "docs/MIGRATION.md",
  "docs/README.md",
  "docs/TERM.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/logo.svg",
  "docs/protocols/CANONICAL-ENCODING.md",
  "docs/protocols/PROFILE.md",
  "docs/protocols/PROTOCOLS.md",
  "docs/protocols/TRUST-ANCHORS.md",
  "examples/README.md",
  "examples/export-proof-bundle.mjs",
  "examples/licolite-signed-operation.mjs",
  "examples/record-operation.mjs",
  "examples/verify-envelope.mjs",
  "examples/workspace-projection.mjs",
  "package.json",
  "src/README.md",
  "src/aspects/licolite/aspect.js",
  "src/aspects/licolite/constants.js",
  "src/aspects/licolite/evidence.js",
  "src/aspects/licolite/index.d.ts",
  "src/aspects/licolite/index.js",
  "src/aspects/licolite/signing.js",
  "src/canonical/value.js",
  "src/core/append-condition.js",
  "src/core/pactium-core.js",
  "src/core/rebuild-state.js",
  "src/core/state-helpers.js",
  "src/core/tracking-cursor.js",
  "src/http.d.ts",
  "src/http.js",
  "src/index-engine/snapshot-merkle-index.js",
  "src/index.d.ts",
  "src/index.js",
  "src/ledger/signed-head.js",
  "src/ledger/transparency-log.js",
  "src/maintenance/task-engine.js",
  "src/proof/bundle-format.js",
  "src/proof/bundle.js",
  "src/proof/envelope.js",
  "src/proof/registry.js",
  "src/protocol/constants.js",
  "src/protocol/hashing.js",
  "src/quality/profile-runner.js",
  "src/repair/planner.js",
  "src/shared/lru-cache.js",
  "src/shared/output-redaction.js",
  "src/shared/records.js",
  "src/storage/local-json-storage-port.js",
  "src/storage/private-atomic-file.js",
  "src/storage/sqlite-capability.js",
  "src/storage/sqlite-storage-port.js",
  "src/storage/storage-port.js",
  "src/verification/failure.js"
]);

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

function normalizePackagePath(filePath) {
  return path.normalize(filePath).replace(/\\/g, "/");
}

function stripLinkDecoration(target) {
  const trimmed = target.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isExternalOrAnchorTarget(target) {
  return (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function resolvePackageLinkTarget(fromFile, rawTarget) {
  const target = stripLinkDecoration(rawTarget);
  if (isExternalOrAnchorTarget(target)) return null;
  const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  if (isExternalOrAnchorTarget(withoutFragment)) return null;
  if (withoutFragment.startsWith("/")) return normalizePackagePath(withoutFragment.slice(1));
  if (path.isAbsolute(withoutFragment)) return null;
  return normalizePackagePath(path.join(path.dirname(fromFile), withoutFragment));
}

function extractLinkedTargets(text) {
  const targets = [];
  const markdownLinkPattern = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
  const htmlLinkPattern = /\b(?:href|src)=["']([^"']+)["']/gi;
  for (const pattern of [markdownLinkPattern, htmlLinkPattern]) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      targets.push(match[1]);
    }
  }
  return targets;
}

function packageContainsTarget(packageFiles, packageFileSet, targetPath) {
  if (packageFileSet.has(targetPath)) return true;
  const directoryPrefix = targetPath.endsWith("/") ? targetPath : `${targetPath}/`;
  return packageFiles.some((file) => file.path.startsWith(directoryPrefix));
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
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Expected npm 12 pack JSON to be a package-keyed object.");
    }
    const packages = Object.values(parsed);
    if (packages.length !== 1 || !packages[0] || typeof packages[0] !== "object") {
      throw new Error("Expected npm 12 pack JSON to contain exactly one package.");
    }
    if (!Array.isArray(packages[0].files)) {
      throw new Error("Expected npm 12 pack JSON package metadata to contain a files array.");
    }
    return packages[0];
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

function verifyApprovedFiles(packageFiles, findings) {
  for (const file of packageFiles) {
    if (!approvedFiles.has(file.path)) {
      addFinding(findings, file.path, "unexpected_package_file");
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
  const packageFileSet = new Set(packageFiles.map((file) => file.path));
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
    for (const target of extractLinkedTargets(text)) {
      const resolvedTarget = resolvePackageLinkTarget(file, target);
      if (!resolvedTarget) continue;
      if (!packageContainsTarget(packageFiles, packageFileSet, resolvedTarget)) {
        addFinding(
          findings,
          file,
          "published_doc_links_missing_package_file",
          `${target} resolves to ${resolvedTarget}, which is not included in the npm package.`
        );
      }
    }
  }
}

async function main() {
  const findings = [];
  const pack = runNpmPackDryRun();
  const packageFiles = pack.files || [];

  verifyRequiredFiles(packageFiles, findings);
  verifyApprovedFiles(packageFiles, findings);
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
