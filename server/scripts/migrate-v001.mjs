#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_COPY_LIMIT_BYTES = 5 * 1024 * 1024;
const SENSITIVE_RECOVERY_FILE_NAMES = new Set([
  ".sealing-key",
  "csrf-hmac-secret.bin",
  "credentials.json",
  "token.json",
  "tokens.json"
]);
const SENSITIVE_RECOVERY_FILE_PATTERNS = [
  /(^|\/)\.env(?:\.[^/]+)?$/iu,
  /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/iu,
  /(^|\/)(?:client_secret|service-account|service_account|api-key|apikey|auth-token|access-token|refresh-token)[^/]*\.(?:json|yaml|yml|txt|env)$/iu,
  /(^|\/)(?:private|secret|client_secret)[^/]*\.pem$/iu,
  /\.(?:key|p12|pfx|jks|keystore)$/iu
];

const RUNTIME_AREAS = [
  {
    id: "auth",
    relativePath: "auth",
    policy: "retain",
    description: "Console accounts, CSRF secret, and auth sqlite state."
  },
  {
    id: "security-authorization",
    relativePath: path.join("security", "authorization"),
    policy: "retain",
    description: "Authorization policies, grants, and audit state."
  },
  {
    id: "agent-workspaces",
    relativePath: "agent-workspaces",
    policy: "retain",
    description: "Sharedspace files, local directory mounts, cloud-drive projections, checkpoints, and sessions."
  },
  {
    id: "code-management",
    relativePath: "code-management",
    policy: "retain",
    description: "Codespace provider manifests, repository targets, changesets, and review receipts."
  },
  {
    id: "knowledge",
    relativePath: "knowledge",
    policy: "retain",
    description: "Knowledge backend manifests, safe upstream refs, and knowledge runtime state."
  },
  {
    id: "operation-audit",
    relativePath: path.join("security", "operation-audit"),
    policy: "retain",
    description: "Operation audit events and receipt references."
  },
  {
    id: "protocol-events",
    relativePath: "protocol-events",
    policy: "retain",
    description: "Protocol event stream used by checkpoint and runtime diagnostics."
  },
  {
    id: "logs",
    relativePath: "logs",
    policy: "retain",
    description: "Runtime logs; retained for diagnostics and not promoted to source."
  }
];

function parseArgs(argv) {
  const options = {
    dataDir: "",
    outputDir: "",
    dryRun: false,
    json: false,
    copyLimitBytes: DEFAULT_COPY_LIMIT_BYTES,
    copyRecoveryFiles: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") {
      options.dataDir = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--copy-limit-bytes") {
      options.copyLimitBytes = Math.max(0, Number(argv[index + 1] || DEFAULT_COPY_LIMIT_BYTES));
      index += 1;
    } else if (arg === "--no-copy-recovery-files") {
      options.copyRecoveryFiles = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`migrate-v001

Create a non-destructive v0.0.1 runtime migration report.

Usage:
  node server/scripts/migrate-v001.mjs [--data-dir PATH] [--output-dir PATH] [--dry-run] [--json]

Options:
  --data-dir PATH          Runtime data dir. Defaults to ServerConfig.getDataDir().
  --output-dir PATH        Report root. Defaults to <data-dir>/migrations/v001.
  --dry-run                Do not write reports or recovery files.
  --copy-limit-bytes N     Copy recovery files up to N bytes. Default: ${DEFAULT_COPY_LIMIT_BYTES}.
  --no-copy-recovery-files Write manifest/report only; do not copy recovery file bytes.
  --json                   Print compact JSON summary to stdout.
`);
}

function runIdFromDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shouldSkipRelative(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized === "migrations" || normalized.startsWith("migrations/");
}

function sensitiveRecoveryReason(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const basename = path.posix.basename(normalized);
  if (normalized === "secrets/values" || normalized.startsWith("secrets/values/")) {
    return "secret-store-value";
  }
  if (normalized === "agent-relay/acp-sensitive-payloads.json" || /(^|\/)[^/]*sensitive-payloads[^/]*\.json$/iu.test(normalized)) {
    return "sensitive-payload-store";
  }
  if (normalized.endsWith(".sealing-key") || SENSITIVE_RECOVERY_FILE_NAMES.has(basename)) {
    return "sensitive-recovery-material";
  }
  if (SENSITIVE_RECOVERY_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "sensitive-recovery-material";
  }
  return "";
}

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function collectFiles(rootPath) {
  const files = [];
  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const relative = path.relative(rootPath, entryPath);
      if (!relative || shouldSkipRelative(relative)) continue;
      const stat = await fs.lstat(entryPath).catch(() => null);
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        files.push({
          relativePath: relative,
          kind: "symlink",
          sizeBytes: 0,
          mtime: stat.mtime.toISOString(),
          sha256: ""
        });
        continue;
      }
      if (stat.isDirectory()) {
        await visit(entryPath);
      } else if (stat.isFile()) {
        files.push({
          relativePath: relative,
          kind: "file",
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString(),
          sha256: await sha256File(entryPath)
        });
      }
    }
  }
  await visit(rootPath);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function summarizeAreas(dataDir, files) {
  return RUNTIME_AREAS.map((area) => {
    const areaPath = path.join(dataDir, area.relativePath);
    const areaPrefix = `${area.relativePath.split(path.sep).join("/")}/`;
    const areaFiles = files.filter((file) => {
      const normalized = file.relativePath.split(path.sep).join("/");
      return normalized === area.relativePath.split(path.sep).join("/") || normalized.startsWith(areaPrefix);
    });
    return {
      id: area.id,
      relativePath: area.relativePath,
      policy: area.policy,
      description: area.description,
      present: areaFiles.length > 0,
      fileCount: areaFiles.filter((file) => file.kind === "file").length,
      symlinkCount: areaFiles.filter((file) => file.kind === "symlink").length,
      sizeBytes: areaFiles.reduce((total, file) => total + file.sizeBytes, 0),
      absolutePath: areaPath
    };
  });
}

async function writeRecoveryFiles({ dataDir, runDir, files, copyLimitBytes }) {
  const recoveryRoot = path.join(runDir, "recovery-files");
  const copied = [];
  const skipped = [];
  for (const file of files) {
    if (file.kind !== "file") {
      skipped.push({ relativePath: file.relativePath, reason: file.kind });
      continue;
    }
    const sensitivity = sensitiveRecoveryReason(file.relativePath);
    if (sensitivity) {
      skipped.push({
        relativePath: file.relativePath,
        reason: "sensitive-recovery-material",
        sensitivity,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256
      });
      continue;
    }
    if (file.sizeBytes > copyLimitBytes) {
      skipped.push({ relativePath: file.relativePath, reason: "larger-than-copy-limit", sizeBytes: file.sizeBytes });
      continue;
    }
    const source = path.join(dataDir, file.relativePath);
    const target = path.join(recoveryRoot, file.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    copied.push({ relativePath: file.relativePath, sizeBytes: file.sizeBytes, sha256: file.sha256 });
  }
  return {
    recoveryRoot,
    copied,
    skipped,
    copyLimitBytes
  };
}

function recoveryManifestOnly({ runDir, files, copyLimitBytes }) {
  return {
    recoveryRoot: path.join(runDir, "recovery-files"),
    copied: [],
    skipped: files.map((file) => {
      const sensitivity = sensitiveRecoveryReason(file.relativePath);
      return {
        relativePath: file.relativePath,
        reason: "copy-disabled-for-report",
        ...(sensitivity ? { sensitivity } : {}),
        sizeBytes: file.sizeBytes,
        sha256: file.sha256
      };
    }),
    copyLimitBytes
  };
}

function buildRollbackScript(report) {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `DATA_DIR=${JSON.stringify(report.dataDir)}`,
    `RECOVERY_ROOT=${JSON.stringify(path.join(report.runDir, "recovery-files"))}`,
    'echo "Pact v0.0.1 rollback helper"',
    'echo "Data dir: $DATA_DIR"',
    'echo "Recovery root: $RECOVERY_ROOT"',
    'echo "This script prints exact copy commands and does not overwrite files automatically."',
    'find "$RECOVERY_ROOT" -type f | while read -r file; do',
    '  rel="${file#$RECOVERY_ROOT/}"',
    '  printf "cp %q %q\\n" "$file" "$DATA_DIR/$rel"',
    "done",
    ""
  ].join("\n");
}

function buildMarkdownReport(report) {
  const lines = [
    "# Pact v0.0.1 Runtime Migration Report",
    "",
    `- Run ID: \`${report.runId}\``,
    `- Generated At: \`${report.generatedAt}\``,
    `- Data Dir: \`${report.dataDir}\``,
    `- Mode: \`${report.dryRun ? "dry-run" : "report-and-recovery-point"}\``,
    `- Status: \`${report.status}\``,
    "",
    "## Summary",
    "",
    `- Runtime files scanned: ${report.summary.fileCount}`,
    `- Symlinks recorded: ${report.summary.symlinkCount}`,
    `- Runtime bytes scanned: ${report.summary.sizeBytes}`,
    `- Recovery files copied: ${report.recovery.copied.length}`,
    `- Recovery files skipped: ${report.recovery.skipped.length}`,
    `- Sensitive recovery files skipped: ${report.summary.sensitiveFileCount}`,
    "",
    "## Runtime Areas",
    "",
    "| Area | Present | Files | Symlinks | Bytes | Policy |",
    "| --- | --- | ---: | ---: | ---: | --- |"
  ];
  for (const area of report.areas) {
    lines.push([
      area.id,
      area.present ? "yes" : "no",
      String(area.fileCount),
      String(area.symlinkCount),
      String(area.sizeBytes),
      area.policy
    ].join(" | "));
  }
  lines.push("");
  lines.push("## Migration Policy");
  lines.push("");
  lines.push("- v0.0.1 does not move runtime state back into the repository.");
  lines.push("- Existing data remains in `ServerConfig.getDataDir()` and is retained in place.");
  lines.push("- External provider credentials must remain secret refs; raw token values are not copied into reports.");
  lines.push("- Secret values, sealing keys, CSRF HMAC secrets, and sensitive payload stores are manifest-only and are not copied into recovery files.");
  lines.push("- The recovery point contains small runtime files only; large files are represented by hash and path.");
  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  if (report.warnings.length) {
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  } else {
    lines.push("- none");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(options.dataDir || process.env.PACT_SERVER_DATA_DIR || ServerConfig.getDataDir());
  const outputRoot = path.resolve(options.outputDir || path.join(dataDir, "migrations", "v001"));
  const runId = runIdFromDate();
  const runDir = path.join(outputRoot, runId);
  await fs.mkdir(dataDir, { recursive: true });

  const files = await collectFiles(dataDir);
  const warnings = [];
  if (isInside(repoRoot, dataDir)) {
    warnings.push("Runtime data dir is inside the repository; v0.0.1 expects ServerConfig.getDataDir() outside source.");
  }
  if (await exists(path.join(repoRoot, ".pact-server-data"))) {
    warnings.push("Repository root contains .pact-server-data; this is local runtime state and should not be committed.");
  }

  const report = {
    schemaVersion: "v0.0.1:schema:definition-1",
    reportType: "v0.0.1:platform:migration-report-1",
    runId,
    generatedAt: new Date().toISOString(),
    repoRoot,
    dataDir,
    outputRoot,
    runDir,
    dryRun: options.dryRun,
    status: "ready",
    summary: {
      fileCount: files.filter((file) => file.kind === "file").length,
      symlinkCount: files.filter((file) => file.kind === "symlink").length,
      sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      sensitiveFileCount: files.filter((file) => Boolean(sensitiveRecoveryReason(file.relativePath))).length
    },
    areas: summarizeAreas(dataDir, files),
    runtimeFiles: files,
    recovery: {
      recoveryRoot: path.join(runDir, "recovery-files"),
      copied: [],
      skipped: [],
      copyLimitBytes: options.copyLimitBytes
    },
    warnings
  };

  if (!options.dryRun) {
    await fs.mkdir(runDir, { recursive: true });
    report.recovery = options.copyRecoveryFiles
      ? await writeRecoveryFiles({
          dataDir,
          runDir,
          files,
          copyLimitBytes: options.copyLimitBytes
        })
      : recoveryManifestOnly({
          runDir,
          files,
          copyLimitBytes: options.copyLimitBytes
        });
    const recoveryManifestPath = path.join(runDir, "recovery-manifest.json");
    await fs.writeFile(recoveryManifestPath, `${JSON.stringify(report.recovery, null, 2)}\n`, "utf8");
    const reportJsonPath = path.join(runDir, "migration-report.json");
    const reportMdPath = path.join(runDir, "migration-report.md");
    const rollbackPath = path.join(runDir, "rollback-preview.sh");
    await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(reportMdPath, buildMarkdownReport(report), "utf8");
    await fs.writeFile(rollbackPath, buildRollbackScript(report), { mode: 0o755 });
  }

  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      reportType: report.reportType,
      runId: report.runId,
      status: report.status,
      dataDir: report.dataDir,
      runDir: options.dryRun ? "" : report.runDir,
      fileCount: report.summary.fileCount,
      copiedRecoveryFiles: report.recovery.copied.length,
      warnings: report.warnings
    }, null, 2));
  } else {
    console.log(`Pact v0.0.1 migration report status: ${report.status}`);
    console.log(`Data dir: ${report.dataDir}`);
    if (!options.dryRun) {
      console.log(`Report dir: ${report.runDir}`);
    }
    if (report.warnings.length) {
      console.log(`Warnings: ${report.warnings.length}`);
    }
  }
}

await main();
