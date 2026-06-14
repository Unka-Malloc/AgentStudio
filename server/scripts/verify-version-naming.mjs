#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectGovernedVersionOccurrences,
  collectVersionScanFiles,
  defaultRepoRoot,
  GOVERNED_VERSION_PATTERN,
  lineAndColumn,
  VERSION_SCAN_ROOTS
} from "../platform/common/version-control/version-scan.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const forbiddenPatterns = [
  {
    id: "old-pact-version-token",
    pattern: /\b(?:pact|external-kd)\.[a-zA-Z0-9][a-zA-Z0-9.-]*\.v[0-9]+\b/g,
    message: "Use Governed Version String instead of pact.*.vN or external-kd.*.vN."
  },
  {
    id: "old-dotted-strategy-version",
    pattern: /\b[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\.v[0-9]+\b/g,
    message: "Use v0.0.1:strategy:<subsection>-N instead of dotted .vN strategy names."
  },
  {
    id: "bare-schema-version-field",
    pattern: /(?:"schemaVersion"\s*:\s*1\b|\bschemaVersion\s*:\s*1\b|\bschemaVersion\s*=\s*1\b)/g,
    message: "schemaVersion must be a Governed Version String, not a bare number."
  },
  {
    id: "bare-schema-version-constant",
    pattern: /\b[A-Z0-9_]*SCHEMA_VERSION[A-Z0-9_]*\s*=\s*1\b/g,
    message: "Schema version constants must use Governed Version String values."
  },
  {
    id: "old-version-prefix-field",
    pattern: new RegExp("\\bversion" + "Prefix\\b|v1:" + "pact", "g"),
    message: "Version Governance no longer uses legacy pact prefixes."
  },
  {
    id: "legacy-version-compatibility-alias",
    pattern: new RegExp(
      "旧式\\s+`?pact\\.[^`\\s]+`?.*兼容别" + "名|legacy version " + "alias|version compatibility " + "alias",
      "gi"
    ),
    message: "Migrated legacy version formats must be removed, not kept as compatibility aliases."
  },
  {
    id: "invalid-derived-governed-version",
    pattern: /v[0-9]+\.[0-9]+\.[0-9]+:[^\s"`',)}\]]+\.[a-z][a-z0-9-]*/g,
    message: "Derived versions must be explicit governed versions, not dotted suffixes."
  }
];

function collectGovernedVersionShapeFindings() {
  const findings = [];
  for (const [value, occurrences] of collectGovernedVersionOccurrences({ repoRoot })) {
    if (GOVERNED_VERSION_PATTERN.test(value)) continue;
    for (const occurrence of occurrences) {
      findings.push({
        id: "malformed-governed-version",
        ...occurrence,
        message: "Governed Version String must match v<platform-version>:<domain>:<subsection>-<version>."
      });
    }
  }
  return findings;
}

function verifyVersionNaming() {
  const findings = [];
  for (const filePath of collectVersionScanFiles({ repoRoot: defaultRepoRoot })) {
    const relativePath = path.relative(repoRoot, filePath).split(path.sep).join("/");
    const text = fs.readFileSync(filePath, "utf8");
    for (const check of forbiddenPatterns) {
      for (const match of text.matchAll(check.pattern)) {
        findings.push({
          id: check.id,
          relativePath,
          value: match[0],
          ...lineAndColumn(text, match.index || 0),
          message: check.message
        });
      }
    }
  }
  findings.push(...collectGovernedVersionShapeFindings());

  const report = {
    ok: findings.length === 0,
    checkedAt: new Date().toISOString(),
    checkedRoots: VERSION_SCAN_ROOTS,
    findingCount: findings.length,
    findings
  };
  const reportPath = path.join(repoRoot, "build/reports/version-naming/latest.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const report = verifyVersionNaming();
if (!report.ok) {
  console.error(`[version-naming] failed (${report.findingCount} findings)`);
  for (const finding of report.findings.slice(0, 30)) {
    console.error(`${finding.relativePath}:${finding.line}:${finding.column} [${finding.id}] ${finding.value}`);
  }
  process.exitCode = 1;
} else {
  console.log("[version-naming] ok");
}
