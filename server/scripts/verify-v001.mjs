#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultSecretRefForProvider,
  localSecretConfigured
} from "../platform/common/security/secrets/local-secret-store.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_OUTPUT_ROOT = "docs/reports/history/v001-readiness";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const EXTERNAL_TARGETS = [
  {
    id: "github",
    phase: "Phase 2",
    verifier: "server:verify:v001-codespace-e2e",
    env: ["PACT_GITHUB_TOKEN", "GITHUB_TOKEN"],
    statusWithoutCredential: "contractVerified"
  },
  {
    id: "gerrit",
    phase: "Phase 2",
    verifier: "server:verify:v001-codespace-e2e",
    env: ["PACT_GERRIT_TOKEN", "PACT_GERRIT_PASSWORD"],
    statusWithoutCredential: "contractVerified"
  },
  {
    id: "dify",
    phase: "Phase 3",
    verifier: "server:verify:v001-knowledge-e2e",
    env: ["PACT_DIFY_API_KEY", "DIFY_API_KEY"],
    statusWithoutCredential: "contractVerified"
  },
  {
    id: "ragflow",
    phase: "Phase 3",
    verifier: "server:verify:v001-knowledge-e2e",
    env: ["PACT_RAGFLOW_API_KEY", "RAGFLOW_API_KEY"],
    statusWithoutCredential: "contractVerified"
  },
  {
    id: "google-drive",
    phase: "Phase 4",
    verifier: "server:verify:v001-cloud-drive-e2e",
    env: ["PACT_GOOGLE_DRIVE_OAUTH_SECRET_REF"],
    statusWithoutCredential: "contractVerified"
  },
  {
    id: "dropbox",
    phase: "Phase 4",
    verifier: "server:verify:v001-cloud-drive-e2e",
    env: ["PACT_DROPBOX_OAUTH_SECRET_REF"],
    statusWithoutCredential: "contractVerified"
  }
];

const LOCAL_PROJECTION_TARGETS = [
  {
    id: "icloud",
    phase: "Phase 4",
    verifier: "server:verify:v001-cloud-drive-e2e",
    releaseStatus: "localProjectionVerified",
    credentialConfigured: false,
    configuredBy: [],
    realE2EVerified: false,
    localProjectionVerified: true,
    credentialRequiredForV001: false
  },
  {
    id: "onedrive",
    phase: "Phase 4",
    verifier: "server:verify:v001-cloud-drive-e2e",
    releaseStatus: "localProjectionVerified",
    credentialConfigured: false,
    configuredBy: [],
    realE2EVerified: false,
    localProjectionVerified: true,
    credentialRequiredForV001: false
  }
];

function parseArgs(argv) {
  const options = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    list: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-root") {
      options.outputRoot = argv[index + 1] || options.outputRoot;
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Math.max(1000, Number(argv[index + 1] || options.timeoutMs));
      index += 1;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`verify-v001

Run v0.0.1 Phase 0-4 gates and write a readiness report.

Usage:
  node server/scripts/verify-v001.mjs [--output-root docs/reports/history/v001-readiness] [--timeout-ms N]
`);
}

function runIdFromDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function commandLabel(command) {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function runCommand(command, { timeoutMs, stream = true }) {
  const startedAt = new Date();
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stream) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stream) process.stderr.write(chunk);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const finishedAt = new Date();
      resolve({
        command: commandLabel(command),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode: Number(code ?? 1),
        signal: signal || "",
        timedOut,
        stdout,
        stderr
      });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      const finishedAt = new Date();
      resolve({
        command: commandLabel(command),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode: 127,
        signal: "",
        timedOut,
        stdout,
        stderr: error instanceof Error ? error.stack || error.message : String(error)
      });
    });
  });
}

async function gitValue(args) {
  const result = await runCommand(["git", ...args], { timeoutMs: 15000, stream: false });
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeStageEvidence(runDir, stageId, commandResults) {
  const evidencePath = path.join(runDir, `${stageId}.log`);
  const lines = [];
  for (const result of commandResults) {
    lines.push(`# ${result.command}`);
    lines.push(`startedAt=${result.startedAt}`);
    lines.push(`finishedAt=${result.finishedAt}`);
    lines.push(`elapsedMs=${result.elapsedMs}`);
    lines.push(`exitCode=${result.exitCode}`);
    if (result.signal) lines.push(`signal=${result.signal}`);
    if (result.timedOut) lines.push("timedOut=true");
    lines.push("");
    lines.push("## stdout");
    lines.push(result.stdout.trim() || "(empty)");
    lines.push("");
    lines.push("## stderr");
    lines.push(result.stderr.trim() || "(empty)");
    lines.push("");
  }
  await fs.writeFile(evidencePath, `${lines.join("\n")}\n`, "utf8");
  return path.relative(repoRoot, evidencePath);
}

function statusForResults(results) {
  if (results.some((result) => result.timedOut)) return "timeout";
  if (results.some((result) => result.exitCode !== 0)) return "fail";
  return "pass";
}

async function externalCredentialStatus() {
  const statuses = [];
  for (const target of EXTERNAL_TARGETS) {
    const configuredBy = target.env.filter((name) => Boolean(process.env[name]));
    const secretRef = defaultSecretRefForProvider(target.id);
    const configuredByLocalSecret = await localSecretConfigured({
      provider: target.id,
      secretRef
    }).catch(() => false);
    if (configuredByLocalSecret) {
      configuredBy.push(`local-secret-store:${secretRef}`);
    }
    statuses.push({
      ...target,
      credentialConfigured: configuredBy.length > 0,
      configuredBy,
      releaseStatus: configuredBy.length > 0 ? "credentialConfigured" : target.statusWithoutCredential,
      realE2EVerified: false
    });
  }
  return statuses;
}

function localProjectionStatus() {
  return LOCAL_PROJECTION_TARGETS.map((target) => ({ ...target }));
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildMarkdownReport(report) {
  const lines = [
    "# Pact v0.0.1 Readiness Report",
    "",
    `- Run ID: \`${report.runId}\``,
    `- Generated At: \`${report.generatedAt}\``,
    `- Branch: \`${report.git.branch || "unknown"}\``,
    `- Commit: \`${report.git.commit || "unknown"}\``,
    `- Dirty Files: \`${report.git.dirtyFileCount}\``,
    `- Overall Status: \`${report.overallStatus}\``,
    `- Release Claim: \`${report.releaseClaim}\``,
    "",
    "## Phase Gates",
    "",
    "| Phase | Status | Verification Mode | Evidence |",
    "| --- | --- | --- | --- |"
  ];
  for (const stage of report.stages) {
    lines.push([
      markdownEscape(stage.title),
      stage.status,
      stage.verificationMode,
      stage.evidencePath ? `\`${markdownEscape(stage.evidencePath)}\`` : ""
    ].join(" | "));
  }
  lines.push("");
  lines.push("## Cloud Drive Local Projection Evidence");
  lines.push("");
  lines.push("| Provider | Phase | Release Status | Local Projection Verified | Remote OAuth Required For v0.0.1 | Remote E2E Verified | Verifier |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const target of report.localProjectionProviders) {
    lines.push([
      target.id,
      target.phase,
      target.releaseStatus,
      target.localProjectionVerified ? "yes" : "no",
      target.credentialRequiredForV001 ? "yes" : "no",
      target.realE2EVerified ? "yes" : "no",
      target.verifier
    ].join(" | "));
  }
  lines.push("");
  lines.push("## External Provider Evidence");
  lines.push("");
  lines.push("| Provider | Phase | Release Status | Real Credential Configured | Real E2E Verified | Contract Verifier |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const target of report.externalProviders) {
    lines.push([
      target.id,
      target.phase,
      target.releaseStatus,
      target.credentialConfigured ? "yes" : "no",
      target.realE2EVerified ? "yes" : "no",
      target.verifier
    ].join(" | "));
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `pass` means the v0.0.1 single-node implementation and contract-mode adapters passed their automated verifier.");
  lines.push("- v0.0.1 cloud-drive release scope is iCloud and OneDrive local directory projection. This is not a claim of remote cloud API sync.");
  lines.push("- Providers without real credentials remain `contractVerified`; this is not a claim of real upstream upload, search, sync, PR, Gerrit change, or production readiness.");
  lines.push("- Runtime migration evidence is non-destructive: data remains in `ServerConfig.getDataDir()` and reports are written separately.");
  return `${lines.join("\n")}\n`;
}

async function runStage(stage, options, runDir) {
  console.log(`\n[v001] ${stage.id}: ${stage.title}`);
  const commandResults = [];
  for (const command of stage.commands) {
    console.log(`[v001] running ${commandLabel(command)}`);
    const result = await runCommand(command, { timeoutMs: options.timeoutMs });
    commandResults.push(result);
    if (result.exitCode !== 0) break;
  }
  const evidencePath = await writeStageEvidence(runDir, stage.id, commandResults);
  return {
    id: stage.id,
    title: stage.title,
    verificationMode: stage.verificationMode,
    status: statusForResults(commandResults),
    evidencePath,
    commands: commandResults.map((result) => ({
      command: result.command,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      elapsedMs: result.elapsedMs
    }))
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = runIdFromDate();
  const outputRoot = path.resolve(repoRoot, options.outputRoot);
  const runDir = path.join(outputRoot, runId);
  await ensureDir(runDir);

  const stages = [
    {
      id: "migration",
      title: "Phase 5 secret-safe migration retention report",
      verificationMode: "verified",
      commands: [[
        process.execPath,
        "server/scripts/verify-v001-migration-retention.mjs",
        "--output-dir",
        path.join(runDir, "migration")
      ]]
    },
    {
      id: "phase0",
      title: "Phase 0 baseline",
      verificationMode: "verified",
      commands: [["npm", "run", "server:verify:v001-baseline", "--silent"]]
    },
    {
      id: "phase1",
      title: "Phase 1 local directory",
      verificationMode: "verified",
      commands: [["npm", "run", "server:verify:v001-local-dir-e2e", "--silent"]]
    },
    {
      id: "phase2",
      title: "Phase 2 codespace",
      verificationMode: "mixed-contractVerified",
      commands: [["npm", "run", "server:verify:v001-codespace-e2e", "--silent"]]
    },
    {
      id: "phase3",
      title: "Phase 3 knowledge backend",
      verificationMode: "mixed-contractVerified",
      commands: [["npm", "run", "server:verify:v001-knowledge-e2e", "--silent"]]
    },
    {
      id: "phase4",
      title: "Phase 4 cloud drive",
      verificationMode: "mixed-contractVerified",
      commands: [["npm", "run", "server:verify:v001-cloud-drive-e2e", "--silent"]]
    },
    {
      id: "release-governance",
      title: "Phase 5 recent release governance gates",
      verificationMode: "verified",
      commands: [
        ["npm", "run", "server:verify:context-runtime", "--silent"],
        ["npm", "run", "server:verify:authorization-capabilities", "--silent"],
        ["npm", "run", "server:verify:feature-profiles", "--silent"],
        ["npm", "run", "server:verify:agent-client-support-targets", "--silent"],
        ["npm", "run", "server:verify:frontend-feature-registry", "--silent"]
      ]
    },
    {
      id: "release-crosscutting",
      title: "Phase 5 crosscutting registry and UI build",
      verificationMode: "verified",
      commands: [
        ["npm", "run", "server:verify:protocol-operations", "--silent"],
        ["npm", "run", "server:verify:tool-management", "--silent"],
        ["npm", "run", "server:verify:operation-policy", "--silent"],
        ["npm", "run", "server:verify:mcp-http", "--silent"],
        ["npm", "run", "build:renderer:raw", "--silent"]
      ]
    }
  ];

  if (options.list) {
    for (const stage of stages) {
      console.log(`${stage.id}\t${stage.title}`);
    }
    return;
  }

  const stageResults = [];
  for (const stage of stages) {
    stageResults.push(await runStage(stage, options, runDir));
  }

  const externalProviders = await externalCredentialStatus();
  const localProjectionProviders = localProjectionStatus();
  const allPass = stageResults.every((stage) => stage.status === "pass");
  const missingRealCredentials = externalProviders.filter((target) => !target.credentialConfigured);
  const report = {
    schemaVersion: "v0.0.1:schema:definition-1",
    reportType: "v0.0.1:production-readiness:readiness-report-1",
    runId,
    generatedAt: new Date().toISOString(),
    repoRoot,
    mode: "single-node-v001",
    git: {
      branch: await gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: await gitValue(["rev-parse", "HEAD"]),
      dirtyFileCount: Number((await gitValue(["status", "--short"])).split("\n").filter(Boolean).length)
    },
    overallStatus: allPass ? "pass" : "fail",
    releaseClaim: allPass
      ? "single-node-deliverable-with-localProjection-cloud-drives-and-contractVerified-external-providers"
      : "blocked-by-failing-v001-verifier",
    productionReady: false,
    productionReadyReason: missingRealCredentials.length
      ? "real external provider credentials are not configured; contract-mode evidence is not production readiness"
      : "real external provider credentials are configured but this verifier does not claim live upstream E2E",
    stages: stageResults,
    localProjectionProviders,
    externalProviders
  };

  const jsonPath = path.join(runDir, "report.json");
  const mdPath = path.join(runDir, "report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, buildMarkdownReport(report), "utf8");

  console.log(`\nPact v0.0.1 readiness report written: ${path.relative(repoRoot, mdPath)}`);
  console.log(`Pact v0.0.1 readiness JSON written: ${path.relative(repoRoot, jsonPath)}`);
  console.log(`Pact v0.0.1 readiness status: ${report.overallStatus}`);
  if (missingRealCredentials.length) {
    console.log(`External providers still contractVerified only: ${missingRealCredentials.map((target) => target.id).join(", ")}`);
  }

  if (!allPass) {
    process.exitCode = 1;
  }
}

await main();
