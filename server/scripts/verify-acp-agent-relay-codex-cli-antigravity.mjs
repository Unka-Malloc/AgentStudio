#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildCodexCliRelayProof,
  selectCodexAntigravityVerifierResult
} from "./acp-agent-relay-codex-cli-proof.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const connectRequired = process.argv.includes("--connect") ||
  process.env.PACT_ACP_RELAY_CODEX_CLI_CONNECT === "1" ||
  process.env.PACT_ACP_RELAY_REAL_CONNECT === "1";
const timeoutMs = Number(process.env.PACT_ACP_RELAY_CODEX_CLI_TIMEOUT_MS || 900000);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function shellQuote(value = "") {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

async function commandOutput(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: repoRoot,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    ...options
  });
  return asText(result.stdout || result.stderr);
}

async function discoverCodexCli() {
  const codexCliPath = await commandOutput("sh", ["-lc", "command -v codex"]).catch(() => "");
  assert.ok(codexCliPath, "codex CLI must be available on PATH for the Codex CLI participation gate.");
  const codexCliVersion = await commandOutput(codexCliPath, ["--version"]).catch((error) => asText(error.message));
  const fileBytes = await fs.readFile(codexCliPath);
  const codexCliSha256 = createHash("sha256").update(fileBytes).digest("hex");
  return { codexCliPath, codexCliVersion, codexCliSha256 };
}

function relayEnvAssignments(marker) {
  const promptBase = asText(
    process.env.PACT_ACP_RELAY_CODEX_ANTIGRAVITY_PROMPT || process.env.PACT_ACP_RELAY_ANTIGRAVITY_PROMPT,
    "Codex CLI worker is invoking Pact source-facing ACP harness to relay a read-only acknowledgement request to Antigravity."
  );
  const values = {
    PACT_ACP_RELAY_ANTIGRAVITY_REQUIRED: "1",
    PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL:
      process.env.PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL || "conversation_file_and_local_marker_observation",
    PACT_ACP_RELAY_CODEX_ANTIGRAVITY_PROMPT: `${marker}: ${promptBase}`
  };
  const inheritedNames = [
    "ANTIGRAVITY_CONVERSATION_ID",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONVERSATION_ID",
    "PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_TIMEOUT_MS",
    "PACT_ACP_RELAY_SOURCE_RESPONSE_TIMEOUT_MS",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_TIMEOUT_MS",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_TIMEOUT_MS",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_POLL_MS",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_WAIT_FOR_FINAL",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FLUSH_QUEUE",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_DENY_PENDING_COMMANDS",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_DENY_PENDING_COMMANDS_REQUIRED",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FORCE_STOP_STUCK",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FINAL_REQUIRED",
    "PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FINAL_TIMEOUT_MS"
  ];
  for (const name of inheritedNames) {
    if (process.env[name]) {
      values[name] = process.env[name];
    }
  }
  if (connectRequired) {
    values.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_REQUIRED = "1";
    values.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ENABLED = "1";
    values.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_MIN_PROOF_LEVEL =
      process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_MIN_PROOF_LEVEL || "connect_target_error";
  }
  return values;
}

async function writeWorkerScript({ scriptPath, resultPath, marker }) {
  const assignments = Object.entries(relayEnvAssignments(marker))
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" \\\n  ");
  const script = `#!/bin/sh
set -eu
cd ${shellQuote(repoRoot)}
env \\
  ${assignments} \\
  ${shellQuote(process.execPath)} server/scripts/verify-acp-agent-relay-codex-antigravity.mjs > ${shellQuote(resultPath)}
`;
  await fs.writeFile(scriptPath, script, { encoding: "utf8", mode: 0o700 });
}

function codexExecArgs({ workerScriptPath, resultPath, lastMessagePath }) {
  const args = [
    "exec",
    "--cd",
    repoRoot,
    "--output-last-message",
    lastMessagePath,
    "--json"
  ];
  const model = asText(process.env.PACT_ACP_RELAY_CODEX_CLI_MODEL);
  if (model) {
    args.push("--model", model);
  }
  if (process.env.PACT_ACP_RELAY_CODEX_CLI_BYPASS_SANDBOX === "1") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", asText(process.env.PACT_ACP_RELAY_CODEX_CLI_SANDBOX, "danger-full-access"));
  }
  args.push(
    [
      "You are the Codex CLI participation worker for Pact ACP Agent Relay.",
      "Do not edit repository files.",
      `Run exactly this verification command: sh ${shellQuote(workerScriptPath)}`,
      `After it exits, read ${shellQuote(resultPath)} and finish with a compact JSON summary containing ok, verifier, proof, sourceMode, antigravityProofLevel, and sourceConnectProofLevel.`,
      "Do not print credentials or raw CSRF tokens."
    ].join("\n")
  );
  return args;
}

async function runCodexCli({ codexCliPath, workerScriptPath, resultPath, lastMessagePath, eventLogPath }) {
  const args = codexExecArgs({ workerScriptPath, resultPath, lastMessagePath });
  const logHandle = await fs.open(eventLogPath, "w");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(codexCliPath, args, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      });
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`codex exec timed out after ${timeoutMs}ms.`));
      }, Number.isFinite(timeoutMs) ? timeoutMs : 900000);
      child.stdout.on("data", (chunk) => {
        logHandle.write(chunk).catch(() => {});
      });
      child.stderr.on("data", (chunk) => {
        logHandle.write(chunk).catch(() => {});
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal: signal || "" });
      });
    });
  } finally {
    await logHandle.close();
  }
}

const { codexCliPath, codexCliVersion, codexCliSha256 } = await discoverCodexCli();
const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-codex-cli-antigravity-"));
const marker = `PACT_CODEX_CLI_ACP_RELAY_VERIFY_${Date.now()}`;
const resultPath = asText(process.env.PACT_ACP_RELAY_CODEX_CLI_RESULT_PATH) ||
  path.join(runRoot, "relay-result.json");
const lastMessagePath = path.join(runRoot, "codex-last-message.txt");
const eventLogPath = path.join(runRoot, "codex-events.jsonl");
const workerScriptPath = path.join(runRoot, "run-relay-verifier.sh");

await writeWorkerScript({ scriptPath: workerScriptPath, resultPath, marker });
const codexRun = await runCodexCli({
  codexCliPath,
  workerScriptPath,
  resultPath,
  lastMessagePath,
  eventLogPath
});
const rawRelayOutput = await fs.readFile(resultPath, "utf8").catch(() => "");
const lastMessage = await fs.readFile(lastMessagePath, "utf8").catch(() => "");
const relayResult = selectCodexAntigravityVerifierResult(rawRelayOutput);
const proof = buildCodexCliRelayProof({
  marker,
  codexCliPath,
  codexCliVersion,
  codexExitCode: codexRun.code,
  codexSignal: codexRun.signal,
  relayResult,
  rawRelayOutput,
  lastMessage,
  connectRequired
});
assert.equal(
  proof.ok,
  true,
  `Codex CLI participation gate must run the relay verifier and satisfy proof gates. diagnostic=${JSON.stringify({
    proof,
    resultPath,
    lastMessagePath,
    eventLogPath
  })}`
);
assert.equal(
  proof.proofMatrix?.allRequiredProofsMet,
  true,
  `Codex CLI participation gate proof matrix must satisfy every required relay proof. diagnostic=${JSON.stringify(proof.proofMatrix)}`
);
assert.equal(
  proof.relayDirectCodexCliAcpSourceVerified,
  false,
  "Codex CLI participation gate must not be confused with native Codex CLI ACP source proof."
);

console.log(JSON.stringify({
  ...proof,
  codexCliSha256,
  resultPath,
  lastMessagePath,
  eventLogPath,
  relayResult: relayResult
    ? {
        ok: relayResult.ok,
        verifier: relayResult.verifier,
        proof: relayResult.proof,
        sourceMode: relayResult.sourceMode,
        sourceAgentProof: relayResult.sourceAgentProof,
        antigravityProofLevel: relayResult.antigravityProofLevel,
        minimumAntigravityProofLevel: relayResult.minimumAntigravityProofLevel,
        antigravityProofMeetsMinimum: relayResult.antigravityProofMeetsMinimum,
        sourceConnectProofLevel: relayResult.sourceConnectProofLevel,
        sourceConnectMinimumProofLevel: relayResult.sourceConnectMinimumProofLevel,
        sourceConnectProofAcceptable: relayResult.sourceConnectProofAcceptable,
        sourceSessionCloseProof: relayResult.sourceSessionCloseProof
      }
    : null
}, null, 2));
