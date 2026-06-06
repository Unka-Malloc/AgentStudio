#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACP_METHODS,
  createError,
  createInMemoryJsonRpcTransport,
  createNotification,
  createRequest,
  createSuccess,
  parseJsonRpcMessage
} from "../platform/common/protocols/acp/index.mjs";
import {
  KERNEL_TOOL_IDS,
  evaluateAuthorizationPolicy
} from "../platform/common/security/authorization/authorization-engine.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolManagementPlatform } from "../platform/specialized/capabilities/tools/tool-management-core/index.mjs";
import { executeConsoleDomainOperation } from "../platform/specialized/console/console-domain-operation-executor.mjs";

function nowIso() {
  return new Date().toISOString();
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function hashPayloadForWrite(pathValue, contentValue = "") {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ path: pathValue, content: contentValue }))
    .digest("hex");
}

function projectByIds(toolCatalog, ids = []) {
  const wanted = new Set(ids);
  return toolCatalog.tools.filter((tool) => wanted.has(tool.id));
}

function parseProtocolPayload(requestBody, url = null) {
  if (requestBody?.length > 0) {
    return JSON.parse(requestBody.toString("utf8"));
  }
  return url ? Object.fromEntries(url.searchParams.entries()) : {};
}

function createCapturedHttpResponse() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = "") {
      if (chunk !== undefined && chunk !== null && chunk !== "") {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      this.ended = true;
    }
  };
}

function capturedJson(response) {
  const text = Buffer.concat(response.chunks || []).toString("utf8").trim();
  return text ? JSON.parse(text) : null;
}

function createOutputLineReader(stream) {
  const queue = [];
  const waiters = [];
  let buffer = "";
  if (stream && typeof stream.setEncoding === "function") {
    stream.setEncoding("utf8");
  }
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (waiters.length > 0) {
        waiters.shift()(line);
      } else {
        queue.push(line);
      }
    }
  });
  return {
    async receiveLine(timeoutMs = 5000) {
      if (queue.length > 0) {
        return queue.shift();
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for process output line after ${timeoutMs}ms.`));
        }, timeoutMs);
        waiters.push((line) => {
          clearTimeout(timeout);
          resolve(line);
        });
      });
    }
  };
}

async function receiveJsonRpcResponseUntilId(lineReader, expectedId, timeoutMs = 5000) {
  const notifications = [];
  for (let index = 0; index < 100; index += 1) {
    const parsed = parseJsonRpcMessage(await lineReader.receiveLine(timeoutMs));
    if (parsed.method === ACP_METHODS.sessionUpdate) {
      notifications.push(parsed);
      continue;
    }
    if (parsed.id === expectedId) {
      Object.defineProperty(parsed, "notifications", {
        value: notifications,
        enumerable: false
      });
      return parsed;
    }
    throw new Error(`Unexpected JSON-RPC response id ${String(parsed.id)} while waiting for ${String(expectedId)}.`);
  }
  throw new Error(`Timed out waiting for JSON-RPC response id ${String(expectedId)}.`);
}

async function stopChildProcess(child, timeoutMs = 5000) {
  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.end();
  }
  if (child.exitCode !== null || child.signalCode) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for child process exit after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

function assertPromptAuditEvidence(result) {
  const data = result?.data || result?.payload?.result?.data || {};
  const audit = data.audit || {};
  assert.match(audit.globalAuditId || "", /^audit:\/\/pact\/acp-agent-relay\/relay_turn_/);
  assert.match(audit.artifactRef || "", /^artifact:\/\/pact\/acp-agent-relay\/relay_turn_/);
  assert.equal(data.turn?.globalAuditId, audit.globalAuditId);
  assert.equal(data.turn?.artifactRef, audit.artifactRef);
  assert.equal(data.targetEvidence?.globalAuditId, audit.globalAuditId);
  assert.equal(data.targetEvidence?.artifactRef, audit.artifactRef);
  assert.equal(data.targetEvidence?.relayTurnId, data.turn?.relayTurnId);
  assert.equal(Array.isArray(data.events) && data.events.length > 0, true);
  assert.equal(data.events.every((event) => event.globalAuditId === audit.globalAuditId), true);
  assert.equal(data.events.every((event) => event.artifactRef === audit.artifactRef), true);
  assert.equal(data.events.every((event) => event.operationId === "acp_agent_relay.prompt.send"), true);
}

async function callAgentRelayHttp({ platform, token, method = "GET", path: requestPath, body = null, headers = {} }) {
  const response = createCapturedHttpResponse();
  const url = new URL(requestPath, "http://127.0.0.1");
  const requestBody = body ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);
  const request = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "acp-agent-relay-verifier",
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
  const handled = await platform.router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url,
    method
  });
  assert.equal(handled, true);
  return {
    status: response.statusCode,
    payload: capturedJson(response)
  };
}

function assertRuntimeExport(moduleInstance, names) {
  const missing = names.filter((name) => Object.hasOwn(moduleInstance, name) === false);
  if (missing.length > 0) {
    throw new Error(
      `[acp-agent-relay] runtime module exists but missing exports: ${missing.join(", ")}`
    );
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function runNodeVerifier(relativeScriptPath, label) {
  const child = spawn(process.execPath, [path.join(repoRoot, relativeScriptPath)], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`${label} failed with ${signal || code}: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

const runtimeModulePath = new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/index.mjs",
  import.meta.url
);
let runtimeModule;
try {
  runtimeModule = await import(runtimeModulePath);
} catch (error) {
  throw new Error(
    `[acp-agent-relay] dynamic import failed: ${error instanceof Error ? error.message : "unknown error"}`
  );
}

assertRuntimeExport(runtimeModule, [
  "ACP_AGENT_RELAY_PROTOCOL_VERSION",
  "AcpClientConnection",
  "AcpSessionDriver",
  "AcpEventNormalizer",
  "AcpPermissionBridge",
  "CodexCliExecConnection",
  "AcpRelayRouter",
  "AcpSourceJsonRpcBridge",
  "AcpSourceJsonRpcService",
  "AcpVirtualAgentRegistry",
  "createFileAcpVirtualAgentRegistryAdapter",
  "AcpTargetRegistry",
  "createFileAcpTargetRegistryAdapter",
  "RelaySessionStore",
  "createAcpSourceJsonRpcLineTransport",
  "createAcpSourceJsonRpcService",
  "createAcpSourceJsonRpcTransportPair",
  "createAcpSourceStdioServer",
  "createAcpSourceStdioServerOptionsFromEnv",
  "createAcpTargetConnection",
  "createCodexCliExecConnection",
  "createFileRelaySessionAdapter",
  "createAcpRelayRuntime",
  "executeAcpAgentRelayOperation",
  "runAcpSourceStdioServerFromEnv"
]);

const acpRelayModuleManifest = JSON.parse(await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/module.json",
  import.meta.url
), "utf8"));
const packageManifest = JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"));
const ciWorkflowText = await fs.readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const codexAntigravityVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-codex-antigravity.mjs",
  import.meta.url
), "utf8");
const codexCliAntigravityVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-codex-cli-antigravity.mjs",
  import.meta.url
), "utf8");
const codexCliTargetVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-codex-cli-target.mjs",
  import.meta.url
), "utf8");
const codexAcpTargetVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-codex-acp-target.mjs",
  import.meta.url
), "utf8");
const downstreamCodexAcpTargetVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-downstream-codex-acp-target.mjs",
  import.meta.url
), "utf8");
const antigravityAcpWrapperTargetVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-antigravity-acp-wrapper-target.mjs",
  import.meta.url
), "utf8");
const antigravityAcpWrapperAdapterText = await fs.readFile(new URL(
  "./acp-agent-relay-antigravity-agentapi-acp-adapter.mjs",
  import.meta.url
), "utf8");
const targetCallbackApprovalVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-target-callback-approval.mjs",
  import.meta.url
), "utf8");
const targetReconnectVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-target-reconnect.mjs",
  import.meta.url
), "utf8");
const targetLoadReconnectVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-target-load-reconnect.mjs",
  import.meta.url
), "utf8");
const idempotencyVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-idempotency.mjs",
  import.meta.url
), "utf8");
const realVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-real.mjs",
  import.meta.url
), "utf8");
const relayMcpScopeVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-mcp-scope.mjs",
  import.meta.url
), "utf8");
const toolManagementRelayVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-tool-management.mjs",
  import.meta.url
), "utf8");
const codexCliProofText = await fs.readFile(new URL(
  "./acp-agent-relay-codex-cli-proof.mjs",
  import.meta.url
), "utf8");
const proofMatrixText = await fs.readFile(new URL(
  "./acp-agent-relay-proof-matrix.mjs",
  import.meta.url
), "utf8");
const realProofBundleText = await fs.readFile(new URL(
  "./acp-agent-relay-real-proof-bundle.mjs",
  import.meta.url
), "utf8");
const stateMachineSpecText = await fs.readFile(new URL(
  "./acp-agent-relay-state-machine-spec.mjs",
  import.meta.url
), "utf8");
const stateMachineVerifierText = await fs.readFile(new URL(
  "./verify-acp-agent-relay-state-machine.mjs",
  import.meta.url
), "utf8");
const stateMachineDocumentText = await fs.readFile(new URL(
  "../../docs/ACP-AGENT-RELAY-STATE-MACHINE.md",
  import.meta.url
), "utf8");
const relayOperationExecutorText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs",
  import.meta.url
), "utf8");
const acpClientConnectionText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-client-connection.mjs",
  import.meta.url
), "utf8");
const relayRuntimeIndexText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/index.mjs",
  import.meta.url
), "utf8");
const antigravityAgentApiClientText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs",
  import.meta.url
), "utf8");
const antigravityAgentApiConnectionText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-connection.mjs",
  import.meta.url
), "utf8");
const targetRegistryText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-target-registry.mjs",
  import.meta.url
), "utf8");
const virtualAgentRegistryText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-virtual-agent-registry.mjs",
  import.meta.url
), "utf8");
const toolManagementHttpText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/tools/tool-management-core/http.mjs",
  import.meta.url
), "utf8");
const operationRegistryText = await fs.readFile(new URL(
  "../platform/common/operation-dispatcher/operation-registry.mjs",
  import.meta.url
), "utf8");
const toolManagementCatalogText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs",
  import.meta.url
), "utf8");
const downstreamClientAspectText = await fs.readFile(new URL(
  "../platform/common/downstream-client-aspect/index.mjs",
  import.meta.url
), "utf8");
const consoleDomainOperationExecutorText = await fs.readFile(new URL(
  "../platform/specialized/console/console-domain-operation-executor.mjs",
  import.meta.url
), "utf8");
const toolSkillManagementProviderText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/skills/tool-skill-management-provider.mjs",
  import.meta.url
), "utf8");
const sourceJsonRpcBridgeText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-json-rpc-bridge.mjs",
  import.meta.url
), "utf8");
const sourceStdioServerText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs",
  import.meta.url
), "utf8");
const relayRuntimeTestText = await fs.readFile(new URL(
  "../../tests/vitest/server/acp-agent-relay-runtime.test.mjs",
  import.meta.url
), "utf8");
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-real"],
  "node server/scripts/verify-acp-agent-relay-real.mjs",
  "ACP relay real gate must stay available as a hard-fail package script."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-mcp-scope"],
  "node server/scripts/verify-acp-agent-relay-mcp-scope.mjs",
  "ACP relay MCP scope verifier must stay available as a package script."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-tool-management"],
  "node server/scripts/verify-acp-agent-relay-tool-management.mjs",
  "ACP relay Tool Management source grant verifier must stay available as a package script."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-real:connect"],
  "node server/scripts/verify-acp-agent-relay-real.mjs --connect",
  "ACP relay Connect real gate must stay available as a hard-fail package script."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-real:codex-cli"],
  "node server/scripts/verify-acp-agent-relay-real.mjs --codex-cli",
  "ACP relay top-level real gate must expose a Codex CLI participation variant."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-real:connect:codex-cli"],
  "node server/scripts/verify-acp-agent-relay-real.mjs --connect --codex-cli",
  "ACP relay top-level Connect real gate must expose a Codex CLI participation variant."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-codex-cli-antigravity"],
  "node server/scripts/verify-acp-agent-relay-codex-cli-antigravity.mjs",
  "ACP relay Codex CLI participation gate must stay available as a package script."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-codex-cli-antigravity:connect"],
  "node server/scripts/verify-acp-agent-relay-codex-cli-antigravity.mjs --connect",
  "ACP relay Codex CLI participation Connect gate must stay available as a package script."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-codex-cli-target"],
  "node server/scripts/verify-acp-agent-relay-codex-cli-target.mjs",
  "ACP relay Codex CLI target gate must stay available as a package script."
);
assert.equal(
  packageManifest.scripts?.["server:verify:acp-agent-relay-state-machine"],
  "node server/scripts/verify-acp-agent-relay-state-machine.mjs",
  "ACP relay state-machine verifier must stay available as a package script."
);
assert.match(
  packageManifest.scripts?.["server:verify:acp-agent-relay"] || "",
  /verify-acp-agent-relay-state-machine\.mjs[\s\S]*verify-acp-agent-relay\.mjs/,
  "Main ACP relay verifier script must run the state-machine verifier before the existing relay gate."
);
assert.match(
  stateMachineSpecText,
  /pact\.acp-agent-relay\.state-machine\.spec\.v1[\s\S]*FrameState[\s\S]*SourceIdentityState[\s\S]*VisibilityState[\s\S]*source_identity_isolation[\s\S]*accepted_only_observation_final_refresh/,
  "ACP relay state-machine spec must enumerate domains and evidence branches including identity isolation and observation final refresh."
);
assert.match(
  stateMachineVerifierText,
  /ACP_AGENT_RELAY_STATE_MACHINE_SPEC[\s\S]*state machine composite tuple[\s\S]*accepted-only observation final refresh evidence/,
  "ACP relay state-machine verifier must validate the documented tuple and accepted-only observation final refresh evidence."
);
assert.match(
  stateMachineDocumentText,
  /RelayState =[\s\S]*FrameState[\s\S]*VisibilityState[\s\S]*accepted-only[\s\S]*turn\.observe[\s\S]*final_refreshed/,
  "ACP relay state-machine document must define the composite tuple and accepted-only observation refresh transition."
);
assert.match(
  stateMachineSpecText,
  /target_callback_parent_binding[\s\S]*target_callback_parent_ambiguous[\s\S]*target_callback_parent_not_found[\s\S]*noRelaySideEffect/,
  "ACP relay state-machine spec must preserve target callback parent-binding fail-closed evidence."
);
assert.match(
  stateMachineDocumentText,
  /target_callback_parent_binding[\s\S]*target_callback_parent_ambiguous[\s\S]*target_callback_parent_not_found[\s\S]*No relay side effect/,
  "ACP relay state-machine document must describe parent-binding fail-closed branches and no relay side effect."
);
assert.match(
  stateMachineSpecText,
  /source_facing_session_cancel_running_prompt[\s\S]*session\/cancel[\s\S]*lateTargetCompletionSuppressed/,
  "ACP relay state-machine spec must preserve source-facing session/cancel running prompt proof evidence."
);
assert.match(
  stateMachineDocumentText,
  /session\/cancel[\s\S]*running delegated prompt[\s\S]*late target completion/,
  "ACP relay state-machine document must describe source-facing running prompt cancellation and late target completion suppression."
);
assert.match(
  ciWorkflowText,
  /run_acp_agent_relay_real:/,
  "CI workflow_dispatch must expose the real ACP relay gate input."
);
assert.match(
  ciWorkflowText,
  /run_acp_agent_relay_real_connect:/,
  "CI workflow_dispatch must expose the Connect real ACP relay gate input."
);
assert.match(
  ciWorkflowText,
  /run_acp_agent_relay_codex_cli:/,
  "CI workflow_dispatch must expose the Codex CLI participation gate input."
);
assert.match(
  ciWorkflowText,
  /acp-agent-relay-real:[\s\S]*runs-on:\s*\[self-hosted,\s*macOS,\s*antigravity\]/,
  "Real ACP relay CI gate must use a self-hosted macOS Antigravity runner."
);
assert.match(
  ciWorkflowText,
  /acp-agent-relay-real:[\s\S]*npm run server:verify:acp-agent-relay-real:connect[\s\S]*npm run server:verify:acp-agent-relay-real/,
  "Real ACP relay CI gate must call the required real verifier scripts."
);
assert.match(
  ciWorkflowText,
  /acp-agent-relay-real:[\s\S]*npm run server:verify:acp-agent-relay-real:connect:codex-cli[\s\S]*npm run server:verify:acp-agent-relay-real:codex-cli/,
  "Real ACP relay CI gate must call the top-level Codex CLI real gate so Codex participation and downstream target communication are verified together."
);
assert.match(
  codexAntigravityVerifierText,
  /sourceAgentProof/,
  "Codex/Antigravity verifier must emit sourceAgentProof provenance."
);
assert.match(
  codexAntigravityVerifierText,
  /directCodexCliAcpSourceVerified[\s\S]*false/,
  "Codex/Antigravity verifier must not claim direct Codex CLI ACP source proof while using the Pact stdio harness."
);
assert.match(
  codexAntigravityVerifierText,
  /codex-orchestrated-source-acp-stdio-process-restart/,
  "Codex/Antigravity verifier proof string must describe the actual Codex-orchestrated Pact source stdio harness."
);
assert.match(
  codexCliAntigravityVerifierText,
  /codex exec|buildCodexCliRelayProof|codexCliSha256/,
  "Codex CLI participation verifier must record and validate the real local codex process."
);
assert.match(
  codexCliAntigravityVerifierText,
  /relayDirectCodexCliAcpSourceVerified[\s\S]*false/,
  "Codex CLI participation verifier must not be confused with native Codex CLI ACP source proof."
);
assert.match(
  proofMatrixText,
  /native_codex_cli_acp_source[\s\S]*unsupported/,
  "ACP relay proof matrix must explicitly distinguish unsupported native Codex CLI ACP source proof from Codex CLI participation."
);
assert.match(
  proofMatrixText,
  /native_antigravity_ide_cli_acp_source[\s\S]*unsupported[\s\S]*chatIsAcpTransport[\s\S]*nativeAcpSourceVerified/,
  "ACP relay proof matrix must explicitly expose unsupported native Antigravity IDE CLI ACP source proof."
);
assert.match(
  proofMatrixText,
  /responseKindMatchesSummary[\s\S]*source_facing_progress_summary[\s\S]*responseKind[\s\S]*summaryKind/,
  "ACP relay proof matrix must require source-facing responseKind to match communicationSummary.summaryKind."
);
assert.match(
  proofMatrixText,
  /isMultiTurnContinuityProven[\s\S]*source_facing_multi_turn_continuity[\s\S]*distinctRelayTurns/,
  "ACP relay proof matrix must require a distinct resumed second prompt on the same source-facing relay session."
);
assert.match(
  proofMatrixText,
  /isSourceIdentityIsolationProven[\s\S]*relay_session_not_found[\s\S]*source_identity_isolation[\s\S]*sessionEnumerationIsolated/,
  "ACP relay proof matrix must require source identity isolation and foreign session spoof rejection evidence."
);
assert.match(
  proofMatrixText,
  /isSourceSessionCloseProofProven[\s\S]*relay_session_closed[\s\S]*source_facing_session_close_terminal/,
  "ACP relay proof matrix must require source-facing session close terminal proof."
);
assert.match(
  codexAntigravityVerifierText,
  /buildAcpAgentRelayProofMatrix[\s\S]*proofMatrix\.allRequiredProofsMet/,
  "Codex/Antigravity verifier must emit and enforce a requirement-by-requirement proof matrix."
);
assert.match(
  codexAntigravityVerifierText,
  /firstResponseKind[\s\S]*secondResponseKind[\s\S]*firstCommunicationSummary[\s\S]*secondCommunicationSummary[\s\S]*proofMatrix\.allRequiredProofsMet/,
  "Codex/Antigravity verifier must feed first and resumed-second prompt summaries into the relay proof matrix."
);
assert.match(
  codexAntigravityVerifierText,
  /antigravityIdeCliCapabilitySnapshot[\s\S]*agentApiCapabilitySnapshot\?\.ideCli/,
  "Codex/Antigravity verifier must feed Antigravity IDE CLI capability evidence into the relay proof matrix."
);
assert.match(
  codexAntigravityVerifierText,
  /foreign-source-spoof-owner-load[\s\S]*relay_session_not_found[\s\S]*sourceIdentityIsolationProof/,
  "Codex/Antigravity verifier must prove foreign source request-body spoofing cannot load the owner relay session."
);
assert.match(
  codexAntigravityVerifierText,
  /sourceSessionCloseProof[\s\S]*codex-session-close[\s\S]*relay_session_closed[\s\S]*codex-closed-session-resume-after-restart/,
  "Codex/Antigravity verifier must prove source-facing session close is terminal across source restart."
);
assert.match(
  codexAntigravityVerifierText,
  /assertSourceCommunicationSummary[\s\S]*responseKind[\s\S]*summaryKind[\s\S]*expectedResponseKindForPromptResult/,
  "Codex/Antigravity verifier must prove source ACP prompt responseKind semantics."
);
assert.match(
  codexAntigravityVerifierText,
  /assertSourceUpdateNotifications[\s\S]*responseKind[\s\S]*expectedResponseKindForNotification/,
  "Codex/Antigravity verifier must prove source ACP session update responseKind semantics."
);
assert.match(
  codexCliProofText,
  /buildAcpAgentRelayProofMatrix[\s\S]*responseKind[\s\S]*firstResponseKind[\s\S]*secondResponseKind[\s\S]*sourceSessionCloseProof[\s\S]*codexCliParticipationProof/,
  "Codex CLI participation proof must attach the relay proof matrix with first, second, and source session close evidence."
);
assert.match(
  codexCliAntigravityVerifierText,
  /proof\.proofMatrix\?\.allRequiredProofsMet/,
  "Codex CLI participation verifier must enforce the proof matrix, not just process exit."
);
assert.match(
  antigravityAgentApiClientText,
  /probeAntigravityIdeCliCapabilities[\s\S]*chat --help[\s\S]*nativeAcpTransportSupported[\s\S]*nativeAcpTargetVerified/,
  "Antigravity Agent API client must probe the Antigravity IDE CLI shape and expose native-ACP capability evidence."
);
assert.match(
  antigravityAgentApiConnectionText,
  /probeIdeCliCapabilities[\s\S]*ideCliCapabilitySnapshot[\s\S]*ideCli:\s*this\.ideCliCapabilitySnapshot[\s\S]*agentApiCapabilitySnapshot/,
  "Antigravity Agent API target evidence must carry the IDE CLI native-ACP capability snapshot."
);
assert.match(
  codexAntigravityVerifierText,
  /ideCliCapabilitySnapshot[\s\S]*agentApiCapabilitySnapshot/,
  "Codex/Antigravity verifier must expose Antigravity IDE CLI capability evidence alongside Agent API evidence."
);
assert.match(
  codexAntigravityVerifierText,
  /listedAgent[\s\S]*targetCommunicationMode[\s\S]*agent_api_proxy[\s\S]*listedTarget[\s\S]*nativeAcpTargetSupported[\s\S]*false/,
  "Codex/Antigravity verifier must prove source-facing agent/list and target/list expose proxy communication metadata."
);
assert.match(
  relayRuntimeTestText,
  /probes Antigravity IDE CLI shape[\s\S]*nativeAcpTransportSupported[\s\S]*nativeAcpTargetVerified/,
  "ACP relay runtime tests must cover Antigravity IDE CLI probing without treating chat as native ACP."
);
assert.match(
  targetRegistryText,
  /protocolStyle[\s\S]*nativeAcpTargetSupported[\s\S]*nativeAcpTargetVerified/,
  "ACP target registry must preserve safe native-ACP transport metadata for source-facing discovery."
);
assert.match(
  relayOperationExecutorText,
  /function targetCommunicationDescriptor[\s\S]*targetCommunicationMode[\s\S]*nativeAcpTargetSupported[\s\S]*nativeAcpTargetVerified/,
  "ACP relay source-facing descriptors must classify target communication mode and native-ACP flags."
);
assert.match(
  relayOperationExecutorText,
  /function targetCommunicationDescriptor[\s\S]*let nativeAcpTargetVerified = false[\s\S]*let nativeAcpSourceVerified = false[\s\S]*nativeAcpTargetVerified/,
  "ACP relay source-facing descriptors must not trust registry-supplied native ACP verification claims."
);
assert.match(
  relayOperationExecutorText,
  /function targetCapabilityDescriptor[\s\S]*targetCommunicationMode[\s\S]*nativeAcpTargetSupported[\s\S]*communication/,
  "ACP target/list descriptors must expose source-safe target communication metadata."
);
assert.match(
  relayOperationExecutorText,
  /function virtualAgentCapabilityDescriptor[\s\S]*targetCommunicationMode[\s\S]*nativeAcpTargetSupported[\s\S]*communication/,
  "ACP agent/list and capabilitiesSnapshot descriptors must expose source-safe target communication metadata."
);
assert.match(
  relayRuntimeTestText,
  /targetCommunicationMode[\s\S]*native_acp_stdio[\s\S]*agent_api_proxy[\s\S]*codex_cli_exec_proxy/,
  "ACP relay runtime tests must cover native ACP stdio, Antigravity Agent API proxy, and Codex CLI exec proxy modes."
);
assert.match(
  relayRuntimeTestText,
  /malicious\.proxy:agentapi[\s\S]*maliciousProxy\.target\.nativeAcpTargetVerified,\s*false[\s\S]*maliciousProxyTarget\.nativeAcpTargetVerified,\s*false/,
  "ACP relay runtime tests must prove source-facing discovery rejects registry-supplied proxy native ACP verification claims."
);
assert.match(
  relayRuntimeTestText,
  /malicious\.native:stdio[\s\S]*maliciousNative\.target\.nativeAcpTargetVerified,\s*false[\s\S]*maliciousNativeTarget\.nativeAcpTargetVerified,\s*false/,
  "ACP relay runtime tests must prove source-facing discovery rejects registry-supplied native ACP verification claims."
);
assert.match(
  codexCliTargetVerifierText,
  /acp-agent-relay-source-stdio\.mjs/,
  "Codex CLI target verifier must route source-facing ACP stdio through Pact relay into the codex-cli-exec target adapter."
);
assert.match(
  codexCliTargetVerifierText,
  /codex\.cli-exec-real[\s\S]*codex-cli-exec/,
  "Codex CLI target verifier must bind a real Codex CLI exec virtual agent and target adapter."
);
assert.match(
  codexCliTargetVerifierText,
  /sourceAcpProtocolVerified[\s\S]*externalResponseProjectedAsKeys[\s\S]*nativeCodexCliAcpSource[\s\S]*false/,
  "Codex CLI target verifier must prove source ACP protocol participation and process-backed target execution without confusing it with native Codex CLI ACP source mode."
);
assert.match(
  codexCliTargetVerifierText,
  /responseKind[\s\S]*final_response[\s\S]*sourceAcpResponseKindProjected/,
  "Codex CLI target verifier must prove source ACP projected responseKind=final_response."
);
assert.match(
  codexCliTargetVerifierText,
  /ACP_METHODS\.pactTargetList[\s\S]*ACP_METHODS\.pactSessionList[\s\S]*ACP_METHODS\.pactSessionGet[\s\S]*ACP_METHODS\.pactTurnList[\s\S]*ACP_METHODS\.pactTurnObserve[\s\S]*ACP_METHODS\.sessionLoad/,
  "Codex CLI target verifier must prove source-facing operational discovery, turn observation, and restart session/load methods."
);
assert.match(
  codexCliTargetVerifierText,
  /sourceAcpOperationalMethodsVerified[\s\S]*sourceAcpSessionLoadAfterRestartVerified[\s\S]*operationalDiscoveryProof[\s\S]*restartSessionLoadProof/,
  "Codex CLI target verifier must expose operational and restart session-load proof fields."
);
assert.match(
  codexCliTargetVerifierText,
  /session\/load after source stdio restart must not replay reasoning_trace[\s\S]*reasoningTraceReplaySuppressed/,
  "Codex CLI target verifier must prove session/load does not replay reasoning_trace when requestReasoning=false."
);
assert.match(
  codexAcpTargetVerifierText,
  /@zed-industries\/codex-acp[\s\S]*protocolStyle: "agent-client-protocol-v1"[\s\S]*nativeAcpTargetVerified: true/,
  "Codex ACP target verifier must route source-facing ACP through Pact into the real codex-acp stdio adapter."
);
assert.match(
  codexAcpTargetVerifierText,
  /sourceAcpProtocolVerified[\s\S]*sourceAcpTransport[\s\S]*responseKind[\s\S]*summaryKind/,
  "Codex ACP target verifier must prove source ACP protocol projection and final response from the native ACP target."
);
assert.match(
  codexAcpTargetVerifierText,
  /ACP_METHODS\.pactTargetList[\s\S]*ACP_METHODS\.pactSessionList[\s\S]*ACP_METHODS\.pactSessionGet[\s\S]*ACP_METHODS\.pactTurnList[\s\S]*ACP_METHODS\.pactTurnObserve[\s\S]*ACP_METHODS\.sessionLoad/,
  "Codex ACP target verifier must prove source-facing operational discovery, turn observation, and session load methods."
);
assert.match(
  codexAcpTargetVerifierText,
  /sourceAcpOperationalMethodsVerified[\s\S]*sourceAcpSessionLoadAfterRestartVerified[\s\S]*operationalDiscoveryProof[\s\S]*restartSessionLoadProof/,
  "Codex ACP target verifier must expose operational and restart session-load proof fields."
);
assert.match(
  codexAcpTargetVerifierText,
  /session\/load after source stdio restart must not replay reasoning_trace[\s\S]*reasoningTraceReplaySuppressed/,
  "Codex ACP target verifier must prove session/load does not replay reasoning_trace when requestReasoning=false."
);
assert.match(codexAcpTargetVerifierText, /final_response/);
assert.match(codexAcpTargetVerifierText, /pact-relay-to-real-codex-acp-stdio-target/);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-codex-acp-target"],
  "node server/scripts/verify-acp-agent-relay-codex-acp-target.mjs",
  "ACP relay package scripts must expose the Codex ACP target verifier."
);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-downstream-codex-acp-target"],
  "node server/scripts/verify-acp-agent-relay-downstream-codex-acp-target.mjs",
  "ACP relay package scripts must expose the downstream-client-aspect Codex ACP target verifier."
);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-antigravity-acp-wrapper-target"],
  "node server/scripts/verify-acp-agent-relay-antigravity-acp-wrapper-target.mjs",
  "ACP relay package scripts must expose the Antigravity Agent API ACP wrapper target verifier."
);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-downstream-antigravity-acp-wrapper-target"],
  "node server/scripts/verify-acp-agent-relay-antigravity-acp-wrapper-target.mjs --downstream-client-aspect",
  "ACP relay package scripts must expose the downstream-client-aspect Antigravity ACP wrapper verifier."
);
assert.match(
  downstreamCodexAcpTargetVerifierText,
  /downstreamClientFrameworkOverrides/,
  "Downstream Codex ACP target verifier must use downstream-client-aspect startup assembly, not a hand-registered target."
);
assert.match(downstreamCodexAcpTargetVerifierText, /codex\.acp-agent/);
assert.match(downstreamCodexAcpTargetVerifierText, /codex\.acp:default/);
assert.match(
  downstreamCodexAcpTargetVerifierText,
  /agentDiscoveryProof[\s\S]*targetDiscoveryProof/,
  "Downstream Codex ACP target verifier must prove source-facing discovery metadata and target command redaction."
);
assert.match(downstreamCodexAcpTargetVerifierText, /fromAspect[\s\S]*downstream-client-aspect/);
assert.match(downstreamCodexAcpTargetVerifierText, /targetDescriptorCommandRedacted/);
assert.match(
  downstreamCodexAcpTargetVerifierText,
  /@zed-industries\/codex-acp/,
  "Downstream Codex ACP target verifier must prefer the pinned project-local codex-acp adapter and emit a stable proof id."
);
assert.match(downstreamCodexAcpTargetVerifierText, /project-local-codex-acp/);
assert.match(downstreamCodexAcpTargetVerifierText, /pact-downstream-client-aspect-to-real-codex-acp-stdio-target/);
assert.match(
  downstreamCodexAcpTargetVerifierText,
  /session\/load after source restart must not replay reasoning_trace[\s\S]*reasoningTraceReplaySuppressed/,
  "Downstream Codex ACP target verifier must prove source restart session/load reasoning suppression."
);
assert.match(
  antigravityAcpWrapperAdapterText,
  /PACT_ANTIGRAVITY_AGENTAPI_ACP_ADAPTER_CONFIG_JSON[\s\S]*ACP_METHODS\.sessionPrompt[\s\S]*externalCompletionState: "accepted_only"[\s\S]*finalResponseAvailable: false[\s\S]*provider: "antigravity-agentapi-acp-stdio-wrapper"/,
  "Antigravity ACP wrapper adapter must accept ACP stdio prompts, call Agent API, and return accepted-only source-safe evidence."
);
assert.match(
  antigravityAcpWrapperAdapterText,
  /nativeAntigravityAcp: false/,
  "Antigravity ACP wrapper adapter must not claim native Antigravity ACP transport."
);
assert.match(
  antigravityAcpWrapperTargetVerifierText,
  /acp-agent-relay-antigravity-agentapi-acp-adapter\.mjs[\s\S]*protocolStyle: "agent-client-protocol-v1"[\s\S]*targetDescriptorCommandRedacted[\s\S]*pact-source-acp-to-antigravity-agentapi-acp-stdio-wrapper/,
  "Antigravity ACP wrapper verifier must route source ACP through Pact into an outbound ACP stdio wrapper and emit a stable proof id."
);
assert.match(
  antigravityAcpWrapperTargetVerifierText,
  /--downstream-client-aspect[\s\S]*PACT_ACP_RELAY_ANTIGRAVITY_WRAPPER_DOWNSTREAM_ASPECT[\s\S]*downstreamClientFrameworkOverrides[\s\S]*pact-downstream-client-aspect-to-antigravity-agentapi-acp-stdio-wrapper/,
  "Antigravity ACP wrapper verifier must support downstream-client-aspect startup assembly and emit the downstream proof id."
);
assert.match(
  antigravityAcpWrapperTargetVerifierText,
  /agentDiscoveryProof[\s\S]*fromAspect[\s\S]*targetDiscoveryProof[\s\S]*adapterId/,
  "Antigravity ACP wrapper verifier must prove source-facing discovery provenance when assembled by downstream-client-aspect."
);
assert.match(antigravityAcpWrapperTargetVerifierText, /downstream-client-aspect/);
assert.match(antigravityAcpWrapperTargetVerifierText, /antigravity-agentapi-acp-stdio-wrapper/);
assert.match(
  antigravityAcpWrapperTargetVerifierText,
  /nativeAntigravityAcp[\s\S]*false[\s\S]*antigravityAgentApiReached[\s\S]*proofMeetsMinimum/,
  "Antigravity ACP wrapper verifier must prove Agent API reachability while explicitly preserving non-native Antigravity ACP status."
);
assert.match(
  antigravityAcpWrapperTargetVerifierText,
  /requestReasoning: false[\s\S]*replayText\.includes\("reasoning_trace"\)[\s\S]*reasoningTraceReplaySuppressed/,
  "Antigravity ACP wrapper verifier must prove restart session/load suppresses reasoning traces by default."
);
assert.match(
  acpClientConnectionText,
  /result\.finalResponseAvailable === false[\s\S]*\?[\s\S]*false[\s\S]*output\.length > 0 \|\| result\.finalResponseAvailable === true/,
  "ACP target client must preserve explicit accepted-only target results instead of converting progress text into final responses."
);
assert.match(
  relayOperationExecutorText,
  /targetAdapterProvider[\s\S]*targetResponse\?\.targetResponse\?\.provider/,
  "ACP relay target evidence must expose the wrapper adapter provider without leaking the full target response object."
);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-target-callback-approval"],
  "node server/scripts/verify-acp-agent-relay-target-callback-approval.mjs",
  "ACP relay package scripts must expose the target callback approval verifier."
);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-target-reconnect"],
  "node server/scripts/verify-acp-agent-relay-target-reconnect.mjs",
  "ACP relay package scripts must expose the target reconnect verifier."
);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-target-load-reconnect"],
  "node server/scripts/verify-acp-agent-relay-target-load-reconnect.mjs",
  "ACP relay package scripts must expose the target load-only reconnect verifier."
);
assert.equal(
  packageManifest.scripts["server:verify:acp-agent-relay-idempotency"],
  "node server/scripts/verify-acp-agent-relay-idempotency.mjs",
  "ACP relay package scripts must expose the source-facing idempotency verifier."
);
assert.match(
  targetCallbackApprovalVerifierText,
  /acp-agent-relay-source-stdio\.mjs[\s\S]*fs\/write_text_file[\s\S]*approval_pending/,
  "Target callback approval verifier must use source-facing ACP stdio and trigger a target-originated write approval callback."
);
assert.match(
  targetCallbackApprovalVerifierText,
  /sessionLoad[\s\S]*sessionResume[\s\S]*pactTurnObserve[\s\S]*sessionRequestPermission/,
  "Target callback approval verifier must prove restart load/resume, same-turn observation, and source permission resolve."
);
assert.match(
  targetCallbackApprovalVerifierText,
  /targetCallbackApprovalProofAcceptable[\s\S]*sameTurn[\s\S]*usedSessionResume[\s\S]*denialProof[\s\S]*approval_denied/,
  "Target callback approval verifier must emit proof evidence for same-turn resume and denial through source approval."
);
assert.match(
  acpClientConnectionText,
  /pactParentRequestId[\s\S]*target_callback_parent_not_found[\s\S]*target_callback_parent_ambiguous/,
  "ACP target connection must bind target callbacks to parent requests and fail closed for missing or ambiguous parents."
);
assert.match(
  targetCallbackApprovalVerifierText,
  /parentBindingProof[\s\S]*target_callback_parent_ambiguous[\s\S]*target_callback_parent_not_found[\s\S]*noRelaySideEffect[\s\S]*pact-source-acp-to-stdio-target-callback-parent-binding-fail-closed/,
  "Target callback verifier must emit parent-binding fail-closed proof for ambiguous and stale explicit parent callbacks."
);
assert.match(
  targetCallbackApprovalVerifierText,
  /sourceCancelProof[\s\S]*session\/cancel[\s\S]*targetCancelObserved[\s\S]*lateTargetCompletionSuppressed[\s\S]*pact-source-acp-to-stdio-target-session-cancel-running-prompt/,
  "Target callback verifier must emit source-facing session/cancel proof for a running delegated prompt."
);
assert.match(
  targetReconnectVerifierText,
  /target_process_exit_after_first_prompt[\s\S]*resumeTargetResumeRefMatchedFirst[\s\S]*pact-source-acp-to-stdio-target-reconnect-resume/,
  "Target reconnect verifier must prove target process restart and session/resume with the previous targetResumeRef."
);
assert.match(targetReconnectVerifierText, /session\/resume/);
assert.match(
  targetReconnectVerifierText,
  /sourceRelaySessionStable[\s\S]*distinctRelayTurns[\s\S]*sessionGetAfterReconnectVerified[\s\S]*reasoningTraceReplaySuppressed/,
  "Target reconnect verifier must prove stable source relay session, distinct turns, restored session visibility, and reasoning suppression."
);
assert.match(
  targetLoadReconnectVerifierText,
  /capabilities:\s*\{[\s\S]*session:\s*\["new", "load"\][\s\S]*session\/resume is intentionally unsupported/,
  "Target load-only reconnect verifier must model a target that supports session/load but not session/resume."
);
assert.match(
  targetLoadReconnectVerifierText,
  /target_process_exit_after_first_prompt[\s\S]*loadTargetResumeRefMatchedFirst[\s\S]*pact-source-acp-to-stdio-target-reconnect-load/,
  "Target load-only reconnect verifier must prove target process restart and session/load with the previous targetResumeRef."
);
assert.match(
  targetLoadReconnectVerifierText,
  /targetSessionLoadUsed[\s\S]*targetSessionResumeNotUsed[\s\S]*usedSessionLoadAfterTargetRestart[\s\S]*usedSessionResumeAfterTargetRestart/,
  "Target load-only reconnect verifier must prove session/load was used and session/resume was not used."
);
assert.match(
  idempotencyVerifierText,
  /acp-agent-relay-source-stdio\.mjs[\s\S]*sessionPrompt[\s\S]*idempotencyKey[\s\S]*sessionLoad[\s\S]*idempotencyReplay/,
  "Idempotency verifier must use source-facing ACP stdio, restart-load the session, and prove duplicate idempotency replay."
);
assert.match(
  idempotencyVerifierText,
  /idempotency_key_conflict[\s\S]*targetNotReawakenedForReplay[\s\S]*targetNotReawakenedForConflict/,
  "Idempotency verifier must prove same-key conflicts fail without re-waking the target."
);
assert.match(
  sourceStdioServerText,
  /PACT_ACP_SOURCE_STDIO_SENSITIVE_PAYLOAD_STORE_PATH[\s\S]*sensitivePayloadStorePathFromEnv[\s\S]*durableSensitivePayloadStore/,
  "Source-facing ACP stdio must persist guarded approval payloads in a sensitive sidecar store when a durable relay store is used."
);
assert.match(
  relayOperationExecutorText,
  /observeTurn[\s\S]*includePendingPermissionRequests[\s\S]*target_observation_unsupported/,
  "ACP relay observe must return a safe turn summary with opt-in pending permission details when target observation is unsupported."
);
assert.match(
  sourceJsonRpcBridgeText,
  /observationAvailable[\s\S]*reasonCode[\s\S]*turn:/,
  "ACP source observe projection must expose unsupported-observation reason codes and safe turn summaries."
);
assert.match(
  sourceJsonRpcBridgeText,
  /turn: normalized\.data\.turn \? sourceTurnSummary\(normalized\.data\.turn\) : null[\s\S]*permissionRequest: normalized\.data\.permissionRequest \? sanitizePermissionRequest/,
  "ACP source prompt and permission responses must project safe turn summaries and sanitized permission requests instead of raw internal state."
);
assert.match(
  relayRuntimeTestText,
  /fakeCodex[\s\S]*codex-cli-exec/,
  "ACP relay runtime tests must cover the Codex CLI exec target adapter without depending on a real model."
);
assert.match(
  toolManagementRelayVerifierText,
  /\/api\/tool-management\/v1\/execute/,
  "ACP relay Tool Management verifier must prove source agents call relay through the Tool Management execute surface."
);
assert.match(
  toolManagementRelayVerifierText,
  /pact\.agentRelay\.session\.create[\s\S]*spoofed-request-source|spoofed-request-source[\s\S]*pact\.agentRelay\.session\.create/,
  "ACP relay Tool Management verifier must create sessions while attempting to spoof source request fields."
);
assert.match(
  toolManagementRelayVerifierText,
  /sourceIdentityBoundByGrant[\s\S]*auditBoundToGrant[\s\S]*metricsBoundToGrant/,
  "ACP relay Tool Management verifier must prove grant-bound source identity, audit, and metrics evidence."
);
assert.match(
  relayOperationExecutorText,
  /__pactToolRuntimeAuthorization[\s\S]*sourceBoundInput[\s\S]*normalizeAcpSourceAuthenticationContext/,
  "ACP relay executor must bind trusted Tool Management source identity before session ownership checks."
);
assert.match(
  relayRuntimeTestText,
  /does not mark empty context or request-body auth fragments as trusted source identity[\s\S]*forged-grant/,
  "ACP relay runtime tests must cover source ACP bridge trusted-context spoofing."
);
assert.match(
  relayRuntimeTestText,
  /keeps source identity isolated across concurrent transports on the shared source ACP service[\s\S]*shared-owner-spoof-foreign-load[\s\S]*shared-foreign-spoof-owner-prompt/,
  "ACP relay runtime tests must prove shared source ACP service transports keep independent source identity bindings."
);
assert.match(
  relayRuntimeTestText,
  /derives prompt audit ids from the relay turn[\s\S]*audit:\/\/spoofed\/source-controlled/,
  "ACP relay runtime tests must cover source-supplied audit id spoofing."
);
assert.match(
  relayOperationExecutorText,
  /function createAuditEvidence[\s\S]*globalAuditId = `audit:\/\/pact\/acp-agent-relay\/\$\{relayTurnId\}`[\s\S]*artifactRef = `artifact:\/\/pact\/acp-agent-relay\/\$\{relayTurnId\}`/,
  "ACP relay prompt audit evidence must derive global ids from the relay turn id."
);
assert.match(
  realProofBundleText,
  /pact\.acp-agent-relay\.real-proof-bundle\.v1/,
  "ACP relay real proof bundle must expose a stable schema."
);
assert.match(
  realProofBundleText,
  /pact\.acp-agent-relay\.real-proof-matrix\.v1/,
  "ACP relay real proof bundle must expose a top-level proof matrix schema."
);
assert.match(
  realProofBundleText,
  /buildTopLevelRealProofMatrix[\s\S]*codex_cli_participation/,
  "ACP relay real proof bundle must recompute top-level Codex CLI participation."
);
assert.match(
  realProofBundleText,
  /summarizeCodexCli[\s\S]*relaySecondResponseKind[\s\S]*buildCodexCliRequirement[\s\S]*relaySecondSummaryKind/,
  "ACP relay real proof bundle must preserve second prompt responseKind evidence in Codex CLI participation summaries."
);
assert.match(
  realProofBundleText,
  /summarizeCodexCliTarget[\s\S]*sourceAcpProtocolVerified[\s\S]*codex_cli_target_communication/,
  "ACP relay real proof bundle must summarize and require source-ACP-to-real-Codex-CLI target communication when requested."
);
assert.match(
  realProofBundleText,
  /summarizeCodexAcpTarget[\s\S]*nativeAcpTargetVerified[\s\S]*codex_acp_target_communication/,
  "ACP relay real proof bundle must summarize and require source-ACP-to-real-Codex-ACP target communication when requested."
);
assert.match(
  realProofBundleText,
  /summarizeDownstreamCodexAcpTarget[\s\S]*downstream_client_aspect_codex_acp_target_communication[\s\S]*downstreamCodexAcpTargetProofAcceptable/,
  "ACP relay real proof bundle must summarize and require downstream-client-aspect assembled Codex ACP target communication when requested."
);
assert.match(
  realProofBundleText,
  /summarizeAntigravityAcpWrapperTarget[\s\S]*buildAntigravityAcpWrapperTargetRequirement[\s\S]*antigravity_agentapi_acp_wrapper_target_communication/,
  "ACP relay real proof bundle must summarize and require Antigravity Agent API ACP wrapper target communication."
);
assert.match(
  realProofBundleText,
  /downstreamCodexAcpTargetProofAcceptable[\s\S]*fromAspect === "downstream-client-aspect"[\s\S]*targetDescriptorCommandRedacted === true[\s\S]*proof === "pact-downstream-client-aspect-to-real-codex-acp-stdio-target"/,
  "ACP relay real proof bundle must require downstream discovery provenance, command redaction, and the stable downstream Codex ACP proof id."
);
assert.match(
  realProofBundleText,
  /antigravityAcpWrapperTargetProofAcceptable[\s\S]*downstreamClientAspectAssemblyUsed === true[\s\S]*targetCommunicationMode === "antigravity_agentapi_acp_stdio_wrapper"[\s\S]*sourceFacingTargetCommunicationMode === "native_acp_stdio"[\s\S]*nativeAntigravityAcp === false[\s\S]*agentDiscoveryProof\?\.fromAspect === "downstream-client-aspect"[\s\S]*targetDiscoveryProof\?\.adapterId === "antigravity-agentapi-acp-stdio-wrapper"[\s\S]*proof === "pact-downstream-client-aspect-to-antigravity-agentapi-acp-stdio-wrapper"/,
  "ACP relay real proof bundle must require downstream-client-aspect assembled Pact-to-wrapper ACP stdio proof while preserving non-native Antigravity ACP status."
);
assert.match(
  realProofBundleText,
  /buildAntigravityCrossRunBindingRequirement[\s\S]*antigravity_cross_run_binding[\s\S]*antigravityCrossRunBindingProofAcceptable/,
  "ACP relay real proof bundle must bind direct Antigravity, Codex-orchestrated Antigravity, and wrapper proofs to the same target conversation."
);
assert.match(
  realProofBundleText,
  /summarizeCommunicationSummary[\s\S]*summarizeCodexAntigravity[\s\S]*responseKind[\s\S]*summarizeCodexCliTarget[\s\S]*sourceAcpResponseKindProjected/,
  "ACP relay real proof bundle must expose safe communication summary and responseKind evidence."
);
assert.match(
  realProofBundleText,
  /summarizeAntigravity[\s\S]*ideCliCapabilitySnapshot[\s\S]*summarizeCodexAntigravity[\s\S]*ideCliCapabilitySnapshot/,
  "ACP relay real proof bundle must preserve Antigravity IDE CLI native-ACP capability evidence."
);
assert.match(
  realProofBundleText,
  /codexCliTargetProofAcceptable[\s\S]*sourceAcpResponseKindProjected[\s\S]*responseKind === "final_response"[\s\S]*summaryKind === "final_response"/,
  "ACP relay real proof bundle must require Codex CLI target responseKind final-response proof."
);
assert.match(
  realProofBundleText,
  /codexCliTargetProofAcceptable[\s\S]*targetCommunicationMode === "codex_cli_exec_proxy"[\s\S]*nativeAcpTargetSupported === false[\s\S]*nativeAcpTargetVerified === false/,
  "ACP relay real proof bundle must require Codex CLI target communication to remain a non-native proxy proof."
);
assert.match(
  realProofBundleText,
  /codexCliTargetProofAcceptable[\s\S]*sourceAcpOperationalMethodsVerified[\s\S]*sourceAcpSessionLoadAfterRestartVerified[\s\S]*restartSessionLoadProof/,
  "ACP relay real proof bundle must require Codex CLI target operational discovery and restart-load evidence."
);
assert.match(
  realProofBundleText,
  /codexCliTargetProofAcceptable[\s\S]*operationalDiscoveryProof\?\.targetCommunicationMode === "codex_cli_exec_proxy"[\s\S]*restartSessionLoadProof\?\.relaySessionId === codexCliTarget\.relaySessionId/,
  "ACP relay real proof bundle must require Codex CLI target restart-load proof to remain bound to the same relay session."
);
assert.match(
  realProofBundleText,
  /codexAcpTargetProofAcceptable[\s\S]*nativeAcpTargetSupported === true[\s\S]*nativeAcpTargetVerified === true[\s\S]*proof === "pact-relay-to-real-codex-acp-stdio-target"/,
  "ACP relay real proof bundle must require Codex ACP target native-ACP proof."
);
assert.match(
  codexCliTargetVerifierText,
  /targetCommunicationMode[\s\S]*nativeAcpTargetSupported[\s\S]*nativeAcpTargetVerified/,
  "Codex CLI target verifier must emit the full source-facing communication field shape."
);
assert.match(
  codexAcpTargetVerifierText,
  /targetCommunicationMode[\s\S]*nativeAcpTargetSupported[\s\S]*nativeAcpTargetVerified/,
  "Codex ACP target verifier must emit the full source-facing communication field shape."
);
assert.match(
  realProofBundleText,
  /sourceAcpOperationalMethodsVerified[\s\S]*sourceAcpSessionLoadAfterRestartVerified[\s\S]*sessionListedAfterRestart[\s\S]*replayNotificationCount/,
  "ACP relay real proof bundle must carry Codex ACP source-facing operational and restart-load evidence."
);
assert.match(
  realProofBundleText,
  /restartSessionLoadProof[\s\S]*reasoningTraceReplaySuppressed[\s\S]*codexAcpTargetProofAcceptable[\s\S]*reasoningTraceReplaySuppressed === true/,
  "ACP relay real proof bundle must carry and require source-facing session/load reasoning suppression evidence."
);
assert.match(
  realProofBundleText,
  /codexAcpTargetProofAcceptable[\s\S]*sourceAcpOperationalMethodsVerified[\s\S]*sourceAcpSessionLoadAfterRestartVerified[\s\S]*targetDescriptorCommandRedacted/,
  "ACP relay real proof bundle must require source-facing operational discovery and restart-load proof for Codex ACP target communication."
);
assert.match(
  realProofBundleText,
  /operationalDiscoveryProof[\s\S]*targetCommunicationMode[\s\S]*nativeAcpTargetSupported[\s\S]*nativeAcpTargetVerifiedByDiscovery/,
  "ACP relay real proof bundle must preserve source-facing Codex ACP target discovery communication metadata."
);
assert.match(
  realProofBundleText,
  /codexAcpTargetProofAcceptable[\s\S]*operationalDiscoveryProof\?\.targetCommunicationMode === "native_acp_stdio"[\s\S]*targetCommunicationMode === "codex_acp_stdio"/,
  "ACP relay real proof bundle must distinguish source-facing generic native ACP discovery from the Codex ACP proof-specific mode."
);
assert.match(
  realProofBundleText,
  /summarizeTargetCallbackApproval[\s\S]*denialProof[\s\S]*target_callback_approval_resume[\s\S]*target_callback_approval_denial/,
  "ACP relay real proof bundle must summarize and require target callback approval suspend/resume plus denial evidence."
);
assert.match(
  realProofBundleText,
  /targetCallbackApprovalProofAcceptable[\s\S]*sameTurn[\s\S]*usedSessionResume[\s\S]*pendingProof\?\.responseKind === "approval_pending"[\s\S]*resolveProof\?\.responseKind === "final_response"/,
  "ACP relay real proof bundle must require same-turn target callback approval resume with pending and final responseKind evidence."
);
assert.match(
  realProofBundleText,
  /targetCallbackApprovalDenialProofAcceptable[\s\S]*denialProof\?\.responseKind === "approval_denied"[\s\S]*denialProof\?\.fileWritten === false[\s\S]*denialProof\?\.noContentLeak/,
  "ACP relay real proof bundle must require target callback denial with no write and no guarded content leak."
);
assert.match(
  realProofBundleText,
  /target_callback_parent_binding[\s\S]*targetCallbackParentBindingProofAcceptable[\s\S]*target_callback_parent_ambiguous[\s\S]*target_callback_parent_not_found[\s\S]*noRelaySideEffect/,
  "ACP relay real proof bundle must require target callback parent-binding fail-closed evidence with no relay side effect."
);
assert.match(
  realProofBundleText,
  /source_facing_session_cancel_running_prompt[\s\S]*sourceFacingCancelProofAcceptable[\s\S]*targetCancelObserved[\s\S]*lateTargetCompletionSuppressed/,
  "ACP relay real proof bundle must require source-facing session/cancel running prompt evidence."
);
assert.match(
  realProofBundleText,
  /summarizeTargetReconnect[\s\S]*target_reconnect_resume_after_process_restart[\s\S]*targetReconnectProofAcceptable/,
  "ACP relay real proof bundle must summarize and require target reconnect resume-after-process-restart evidence."
);
assert.match(
  realProofBundleText,
  /targetReconnectProofAcceptable[\s\S]*targetProcessRestartObserved[\s\S]*resumeTargetResumeRefMatchedFirst[\s\S]*reasoningTraceReplaySuppressed/,
  "ACP relay real proof bundle must require target process restart, targetResumeRef resume matching, and reasoning suppression."
);
assert.match(
  realProofBundleText,
  /summarizeTargetLoadReconnect[\s\S]*target_reconnect_load_only_after_process_restart[\s\S]*targetLoadReconnectProofAcceptable/,
  "ACP relay real proof bundle must summarize and require target reconnect load-only-after-process-restart evidence."
);
assert.match(
  realProofBundleText,
  /targetLoadReconnectProofAcceptable[\s\S]*targetSessionLoadUsed[\s\S]*targetSessionResumeNotUsed[\s\S]*loadTargetResumeRefMatchedFirst[\s\S]*reasoningTraceReplaySuppressed/,
  "ACP relay real proof bundle must require load-only target reconnect to use session/load, avoid session/resume, and suppress reasoning replay."
);
assert.match(
  realProofBundleText,
  /summarizeIdempotency[\s\S]*source_facing_idempotency_replay_conflict[\s\S]*idempotencyProofAcceptable/,
  "ACP relay real proof bundle must summarize and require source-facing idempotency replay/conflict evidence."
);
assert.match(
  realProofBundleText,
  /idempotencyProofAcceptable[\s\S]*replayProof\?\.idempotencyReplay[\s\S]*targetPromptCountAfterReplay === 1[\s\S]*conflictProof\?\.errorCode === "idempotency_key_conflict"/,
  "ACP relay real proof bundle must require duplicate replay without target wake and same-key conflict rejection."
);
assert.match(
  realProofBundleText,
  /relayProofMatrix[\s\S]*proofMatrix[\s\S]*relayProofMatrix/,
  "ACP relay real proof bundle must preserve the relay matrix while recomputing top-level Codex CLI participation."
);
assert.match(
  realProofBundleText,
  /proofMatrixUnsupportedIds/,
  "ACP relay real proof bundle must expose a stable schema and preserve unsupported native Codex ACP source evidence."
);
assert.match(
  realProofBundleText,
  /sourceIdentityIsolationProof[\s\S]*requestBodyOverrideRejected[\s\S]*sessionEnumerationIsolated/,
  "ACP relay real proof bundle must preserve source identity isolation evidence."
);
assert.match(
  realProofBundleText,
  /sourceSessionCloseProof[\s\S]*promptAfterCloseErrorCode[\s\S]*resumeAfterCloseRestartErrorCode/,
  "ACP relay real proof bundle must preserve source-facing close terminal evidence."
);
assert.match(
  realProofBundleText,
  /relayRequiredProofsMet[\s\S]*codexCliProofAcceptable[\s\S]*codexCliTargetProofAcceptable[\s\S]*codexAcpTargetProofAcceptable[\s\S]*allRequiredProofsMet/,
  "ACP relay real proof bundle must distinguish relay-required proofs from top-level Codex CLI participation and both target-communication requirements."
);
assert.match(
  realVerifierText,
  /codexCliRequired[\s\S]*verify-acp-agent-relay-codex-cli-antigravity\.mjs[\s\S]*buildRealRelayProofBundle[\s\S]*PACT_ACP_RELAY_REAL_PROOF_BUNDLE_PATH/,
  "ACP relay real verifier must optionally run Codex CLI participation, build a final machine-readable proof bundle, and support writing it to a configured path."
);
assert.match(
  realVerifierText,
  /PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL[\s\S]*conversation_file_and_local_marker_observation/,
  "ACP relay real verifier must default to Antigravity conversation-file plus local-marker proof, not file-only proof."
);
assert.match(
  codexCliAntigravityVerifierText,
  /PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL[\s\S]*conversation_file_and_local_marker_observation/,
  "Codex CLI participation verifier must default to Antigravity conversation-file plus local-marker proof."
);
assert.match(
  realVerifierText,
  /sourceTurnObserveProofAcceptable[\s\S]*proofMatrixFailedRequiredIds[\s\S]*sourceIdentityIsolationProof/,
  "ACP relay real verifier must explicitly assert source-facing observation and source identity isolation proofs."
);
assert.match(
  realVerifierText,
  /source_facing_multi_turn_continuity[\s\S]*proven/,
  "ACP relay real verifier must explicitly assert source-facing multi-turn continuity."
);
assert.match(
  realVerifierText,
  /source_facing_session_close_terminal[\s\S]*proven/,
  "ACP relay real verifier must explicitly assert source-facing close terminal behavior."
);
assert.match(
  realVerifierText,
  /targetCallbackParentBindingProofAcceptable[\s\S]*target_callback_parent_ambiguous[\s\S]*target_callback_parent_not_found[\s\S]*target_callback_parent_binding[\s\S]*proven/,
  "ACP relay real verifier must explicitly assert target callback parent-binding fail-closed proof."
);
assert.match(
  realVerifierText,
  /sourceFacingCancelProofAcceptable[\s\S]*targetCancelObserved[\s\S]*lateTargetCompletionSuppressed[\s\S]*source_facing_session_cancel_running_prompt[\s\S]*proven/,
  "ACP relay real verifier must explicitly assert source-facing session/cancel running prompt proof."
);
assert.match(
  realVerifierText,
  /verify-acp-agent-relay-target-reconnect\.mjs[\s\S]*targetReconnectResult[\s\S]*targetReconnectProofAcceptable/,
  "ACP relay real verifier must run and consume the target reconnect verifier."
);
assert.match(
  realVerifierText,
  /targetProcessRestartObserved[\s\S]*resumeTargetResumeRefMatchedFirst[\s\S]*sourceRelaySessionStable[\s\S]*target_reconnect_resume_after_process_restart[\s\S]*proven/,
  "ACP relay real verifier must explicitly assert target reconnect resume after process restart."
);
assert.match(
  realVerifierText,
  /verify-acp-agent-relay-target-load-reconnect\.mjs[\s\S]*targetLoadReconnectResult[\s\S]*targetLoadReconnectProofAcceptable/,
  "ACP relay real verifier must run and consume the target load-only reconnect verifier."
);
assert.match(
  realVerifierText,
  /targetSessionLoadUsed[\s\S]*targetSessionResumeNotUsed[\s\S]*reasoningTraceReplaySuppressed[\s\S]*target_reconnect_load_only_after_process_restart[\s\S]*proven/,
  "ACP relay real verifier must explicitly assert target reconnect load-only after process restart."
);
assert.match(
  realVerifierText,
  /native_antigravity_ide_cli_acp_source[\s\S]*unsupported[\s\S]*ideCliCapabilitySnapshot\?\.chatIsAcpTransport[\s\S]*false[\s\S]*ideCliCapabilitySnapshot\?\.nativeAcpSourceVerified/,
  "ACP relay real verifier must explicitly assert bare Antigravity IDE CLI source mode remains unsupported unless verified."
);
assert.match(
  realVerifierText,
  /codexCliRequired[\s\S]*verify-acp-agent-relay-codex-cli-target\.mjs[\s\S]*codexCliTargetResult[\s\S]*buildRealRelayProofBundle/,
  "ACP relay real verifier must run and consume the Codex CLI target verifier when Codex CLI proof is requested."
);
assert.match(
  realVerifierText,
  /codexCliTarget\?\.sourceAcpOperationalMethodsVerified[\s\S]*codexCliTarget\?\.sourceAcpSessionLoadAfterRestartVerified[\s\S]*restartSessionLoadProof\?\.relaySessionId/,
  "ACP relay real verifier must explicitly assert Codex CLI target source-facing operational and restart-load proofs."
);
assert.match(
  realVerifierText,
  /codexCliRequired[\s\S]*verify-acp-agent-relay-codex-acp-target\.mjs[\s\S]*codexAcpTargetResult[\s\S]*buildRealRelayProofBundle/,
  "ACP relay real verifier must run and consume the Codex ACP target verifier when Codex proof is requested."
);
assert.match(
  realVerifierText,
  /codexCliRequired[\s\S]*verify-acp-agent-relay-downstream-codex-acp-target\.mjs[\s\S]*downstreamCodexAcpTargetResult[\s\S]*buildRealRelayProofBundle/,
  "ACP relay real verifier must run and consume the downstream-client-aspect Codex ACP target verifier when Codex proof is requested."
);
assert.match(
  realVerifierText,
  /downstreamCodexAcpTargetProofAcceptable[\s\S]*downstreamClientAspectAssemblyUsed[\s\S]*targetDescriptorCommandRedacted[\s\S]*downstream_client_aspect_codex_acp_target_communication[\s\S]*proven/,
  "ACP relay real verifier must explicitly assert downstream-client-aspect assembled Codex ACP target proof and top-level matrix status."
);
assert.match(
  realVerifierText,
  /verify-acp-agent-relay-antigravity-acp-wrapper-target\.mjs[\s\S]*PACT_ACP_RELAY_ANTIGRAVITY_WRAPPER_DOWNSTREAM_ASPECT[\s\S]*antigravityAcpWrapperTargetResult[\s\S]*buildRealRelayProofBundle/,
  "ACP relay real verifier must run and consume the downstream-client-aspect Antigravity Agent API ACP wrapper target verifier."
);
assert.match(
  realVerifierText,
  /antigravityAcpWrapperTargetProofAcceptable[\s\S]*downstreamClientAspectAssemblyUsed[\s\S]*agentDiscoveryProof\?\.fromAspect[\s\S]*targetDiscoveryProof\?\.adapterId[\s\S]*sourceFacingTargetCommunicationMode[\s\S]*native_acp_stdio[\s\S]*nativeAntigravityAcp[\s\S]*false[\s\S]*antigravity_agentapi_acp_wrapper_target_communication/,
  "ACP relay real verifier must assert downstream-client-aspect Antigravity wrapper target proof and top-level matrix status."
);
assert.match(
  realVerifierText,
  /antigravityCrossRunBindingProofAcceptable[\s\S]*antigravity_cross_run_binding[\s\S]*proven/,
  "ACP relay real verifier must assert Antigravity cross-run binding in the top-level matrix."
);
assert.match(
  realVerifierText,
  /verify-acp-agent-relay-target-callback-approval\.mjs[\s\S]*targetCallbackApprovalResult[\s\S]*targetCallbackApprovalProofAcceptable/,
  "ACP relay real verifier must run and assert the target callback approval verifier."
);
assert.match(
  realVerifierText,
  /verify-acp-agent-relay-idempotency\.mjs[\s\S]*idempotencyResult[\s\S]*idempotencyProofAcceptable/,
  "ACP relay real verifier must run and assert the source-facing idempotency replay/conflict verifier."
);
assert.match(
  realVerifierText,
  /codexAntigravity\?\.responseKind[\s\S]*codexCliTarget\?\.sourceAcpResponseKindProjected[\s\S]*codexCliTarget\?\.responseKind/,
  "ACP relay real verifier must assert responseKind evidence in the final proof bundle."
);
assert.match(
  realVerifierText,
  /antigravity\?\.targetCommunicationMode[\s\S]*"agent_api_proxy"[\s\S]*antigravity\?\.nativeAcpTargetSupported[\s\S]*false[\s\S]*antigravity\?\.nativeAcpTargetVerified[\s\S]*false/,
  "ACP relay real verifier must assert Antigravity Agent API remains a non-native proxy target proof."
);
assert.match(
  realVerifierText,
  /codexAntigravity\?\.targetCommunicationMode[\s\S]*"agent_api_proxy"[\s\S]*codexAntigravity\?\.nativeAcpTargetSupported[\s\S]*false[\s\S]*codexAntigravity\?\.nativeAcpTargetVerified[\s\S]*false/,
  "ACP relay real verifier must assert Codex-to-Antigravity remains a non-native proxy target proof."
);
for (const [pattern, evidence] of [
  [/createRelayMcpGrant/, "child grant issue"],
  [/headers\.Authorization|Authorization/, "target bearer projection"],
  [/tokenPersisted/, "token non-persistence"],
  [/childGrantReissuedAfterConnectionLoss/, "child grant token reissue after connection loss"],
  [/childGrantHasExplicitTtl|relayMcpGrantTtlMs|assertRelayChildGrantTtl/, "explicit child grant TTL"],
  [/childGrantCollisionRejected|relay_mcp_grant_id_collision/, "child grant id collision rejection"],
  [/targetMcpToolCallBoundToRelayTurn|relayChildOperation|requestBindingMismatches/, "target MCP tool call child-operation binding"],
  [/mismatchedChildOperationRejected|relay_child_operation_binding_mismatch/, "target MCP child-operation mismatch rejection"],
  [/revokeRelayMcpGrant|childGrantRevoked/, "child grant revoke"]
]) {
  assert.match(
    relayMcpScopeVerifierText,
    pattern,
    `ACP relay MCP scope verifier must prove ${evidence}.`
  );
}
assert.match(
  await fs.readFile(new URL("../platform/common/mcp/http-mcp-adapter.mjs", import.meta.url), "utf8"),
  /relay_child_operation_binding_mismatch[\s\S]*requestBindingMismatches/,
  "MCP adapter must reject relay child-operation binding mismatches before tool execution."
);
assert.match(
  toolSkillManagementProviderText,
  /relayMcpGrantReuseAllowed[\s\S]*relay_mcp_grant_id_collision/,
  "Tool/Skill provider must reject relay MCP child grant id collisions instead of upserting another owner's grant."
);
assert.match(
  relayOperationExecutorText,
  /relayMcpGrantId:\s*randomId\("relay_mcp"\)/,
  "ACP relay session creation must generate durable relay MCP grant ids inside the platform."
);
assert.match(
  realProofBundleText,
  /verifier:\s*"acp-agent-relay-real"/,
  "ACP relay real proof bundle must identify the top-level verifier."
);
assert.match(
  relayOperationExecutorText,
  /buildCommunicationSummary[\s\S]*communicationSummary/,
  "ACP relay prompt results must expose a source-agent-facing communicationSummary."
);
assert.match(
  relayOperationExecutorText,
  /communicationSummaryKind[\s\S]*summaryKind[\s\S]*finalResponseSummary[\s\S]*acknowledgementSummary/,
  "ACP relay communicationSummary must distinguish final responses from accepted-only acknowledgements."
);
assert.match(
  relayOperationExecutorText,
  /communicationSummaryKind[\s\S]*approval_pending[\s\S]*finalResponseAvailable/,
  "ACP relay communicationSummary classification must prefer approval_pending over final-response availability."
);
assert.match(
  relayOperationExecutorText,
  /responseKindFromCommunicationSummary[\s\S]*responseKind/,
  "ACP relay runtime results must expose responseKind as a top-level source-facing summary discriminator."
);
assert.match(
  sourceJsonRpcBridgeText,
  /const communicationSummary = normalized\.data\.communicationSummary[\s\S]*communicationSummary/,
  "ACP source JSON-RPC bridge must return communicationSummary to source agents."
);
assert.match(
  sourceJsonRpcBridgeText,
  /summaryKind[\s\S]*finalResponseSummary[\s\S]*acknowledgementSummary/,
  "ACP source JSON-RPC bridge must project communication summary response-kind fields."
);
assert.match(
  sourceJsonRpcBridgeText,
  /sourceResponseKind[\s\S]*responseKind/,
  "ACP source JSON-RPC bridge must expose responseKind in prompt, observe, permission, and session update paths."
);
assert.match(
  sourceJsonRpcBridgeText,
  /sourceResponseKind[\s\S]*approval_pending[\s\S]*finalResponseAvailable/,
  "ACP source JSON-RPC responseKind projection must prefer approval_pending over final-response availability."
);
assert.match(
  relayRuntimeTestText,
  /communicationSummary[\s\S]*pendingPermissionRequestCount[\s\S]*targetErrorCode[\s\S]*source ACP/,
  "ACP relay runtime tests must cover communicationSummary for pending, target-error, and source ACP paths."
);
assert.match(
  relayRuntimeTestText,
  /responseKind[\s\S]*acknowledgement[\s\S]*responseKind[\s\S]*final_response/,
  "ACP relay runtime tests must assert top-level responseKind for acknowledgement and final-response paths."
);
assert.match(
  targetRegistryText,
  /acp-target-registry\.json[\s\S]*createFileAcpTargetRegistryAdapter[\s\S]*persistTargets[\s\S]*renameSync/,
  "ACP target registry must provide a file-backed adapter with atomic persistence."
);
assert.match(
  targetRegistryText,
  /constructor\(seedTargets = DEFAULT_MOCK_TARGETS, options = \{\}\)[\s\S]*loadTargets[\s\S]*upsertTarget[\s\S]*this\.persist\(\)/,
  "ACP target registry must load persisted descriptors and persist upserts through the shared registry."
);
assert.match(
  targetRegistryText,
  /patchTarget[\s\S]*disableTarget[\s\S]*enabled:\s*false[\s\S]*disabledReason/,
  "ACP target registry must support disabling stale downstream aspect descriptors without deleting manual registrations."
);
assert.match(
  relayRuntimeIndexText,
  /resolveTargetRegistryAdapter[\s\S]*targetRegistryPath[\s\S]*userDataPath[\s\S]*new AcpTargetRegistry\(options\.targets/,
  "ACP relay runtime must assemble the file-backed target registry adapter from targetRegistryPath or userDataPath."
);
assert.match(
  relayRuntimeTestText,
  /ACP target registry persistence[\s\S]*acp-target-registry\.json[\s\S]*target\.persisted[\s\S]*createAcpRelayRuntime/,
  "ACP relay runtime tests must cover target descriptor persistence across runtime restart."
);
assert.match(
  relayRuntimeTestText,
  /downstream client aspect startup ACP descriptors[\s\S]*unit\.acp:target[\s\S]*enableDownstreamClientAspect:\s*false/,
  "ACP relay runtime tests must cover startup-assembled ACP descriptors being persisted for later target wake."
);
assert.match(
  virtualAgentRegistryText,
  /acp-virtual-agent-registry\.json[\s\S]*createFileAcpVirtualAgentRegistryAdapter[\s\S]*persistAgents[\s\S]*renameSync/,
  "ACP virtual-agent registry must provide a file-backed adapter with atomic persistence."
);
assert.match(
  virtualAgentRegistryText,
  /constructor\(seedAgents = DEFAULT_VIRTUAL_AGENTS, options = \{\}\)[\s\S]*loadAgents[\s\S]*upsertAgent[\s\S]*this\.persist\(\)/,
  "ACP virtual-agent registry must load persisted descriptors and persist upserts through the shared registry."
);
assert.match(
  virtualAgentRegistryText,
  /patchAgent[\s\S]*disableAgent[\s\S]*enabled:\s*false[\s\S]*disabledReason/,
  "ACP virtual-agent registry must support disabling stale downstream aspect descriptors without deleting manual registrations."
);
assert.match(
  relayRuntimeIndexText,
  /resolveVirtualAgentRegistryAdapter[\s\S]*virtualAgentRegistryPath[\s\S]*userDataPath[\s\S]*new AcpVirtualAgentRegistry\(options\.virtualAgents/,
  "ACP relay runtime must assemble the file-backed virtual-agent registry adapter from virtualAgentRegistryPath or userDataPath."
);
assert.match(
  relayOperationExecutorText,
  /acp_agent_relay\.targets\.upsert[\s\S]*upsertTarget[\s\S]*targetCapabilityDescriptor[\s\S]*virtualAgentCapabilityDescriptor/,
  "ACP relay executor must expose a governed target upsert operation returning source-safe descriptors."
);
assert.match(
  relayOperationExecutorText,
  /acp_agent_relay\.virtual_agents\.upsert[\s\S]*upsertVirtualAgent[\s\S]*target_not_found/,
  "ACP relay executor must expose a governed virtual-agent upsert operation bound to an existing target."
);
assert.match(
  relayOperationExecutorText,
  /acp_agent_relay\.downstream_clients\.refresh[\s\S]*refreshDownstreamClients[\s\S]*downstreamClientAssemblyDescriptor[\s\S]*reconcileDownstreamClientDescriptors/,
  "ACP relay executor must expose a governed downstream client aspect refresh operation returning safe assembly descriptors and reconciling stale aspect-owned descriptors."
);
assert.match(
  relayOperationExecutorText,
  /isDownstreamAspectOwned[\s\S]*fromAspect[\s\S]*downstream-client-aspect[\s\S]*downstream_client_aspect_not_assembled/,
  "ACP relay downstream refresh must only disable descriptors owned by the downstream client aspect."
);
assert.match(
  toolManagementHttpText,
  /\/targets[\s\S]*acp_agent_relay\.targets\.upsert/,
  "ACP relay HTTP facade must route target registration through operation-backed Tool Management."
);
assert.match(
  toolManagementHttpText,
  /\/virtual-agents[\s\S]*acp_agent_relay\.virtual_agents\.upsert/,
  "ACP relay HTTP facade must route virtual-agent registration through operation-backed Tool Management."
);
assert.match(
  toolManagementHttpText,
  /\/downstream-clients\/refresh[\s\S]*acp_agent_relay\.downstream_clients\.refresh/,
  "ACP relay HTTP facade must route downstream client aspect refresh through operation-backed Tool Management."
);
assert.match(
  operationRegistryText,
  /acp_agent_relay\.virtual_agents\.upsert[\s\S]*requiredScopes:\s*\["agent_relay:operate"\][\s\S]*acp_agent_relay\.targets\.upsert[\s\S]*requiredScopes:\s*\["agent_relay:operate"\]/,
  "ACP relay target and virtual-agent registration operations must be protected by agent_relay:operate."
);
assert.match(
  operationRegistryText,
  /acp_agent_relay\.downstream_clients\.refresh[\s\S]*requiredScopes:\s*\["agent_relay:operate"\]/,
  "ACP relay downstream client refresh operation must be protected by agent_relay:operate."
);
assert.match(
  toolManagementCatalogText,
  /acp_agent_relay\.virtual_agents\.upsert[\s\S]*pact\.agentRelay\.virtualAgents\.upsert[\s\S]*acp_agent_relay\.targets\.upsert[\s\S]*pact\.agentRelay\.targets\.upsert[\s\S]*agent_relay:operate/,
  "ACP relay target and virtual-agent registration operations must be exposed through the existing Agent Relay toolset scope mapping."
);
assert.match(
  toolManagementCatalogText,
  /acp_agent_relay\.downstream_clients\.refresh[\s\S]*pact\.agentRelay\.downstreamClients\.refresh[\s\S]*agent_relay:operate/,
  "ACP relay downstream client refresh operation must be exposed through the existing Agent Relay toolset scope mapping."
);
assert.match(
  relayRuntimeTestText,
  /persists operation-registered targets and optional virtual agents[\s\S]*acp_agent_relay\.targets\.upsert[\s\S]*acp_agent_relay\.virtual_agents\.upsert[\s\S]*target_not_found/,
  "ACP relay runtime tests must cover governed target and virtual-agent upsert persistence and invalid binding rejection."
);
assert.match(
  relayRuntimeTestText,
  /routes governed target and virtual-agent registration through Tool Management authorization[\s\S]*POST[\s\S]*\/api\/agent-relay\/v1\/targets[\s\S]*PUT[\s\S]*\/api\/agent-relay\/v1\/virtual-agents/,
  "ACP relay HTTP tests must cover Tool Management-authorized target and virtual-agent registration."
);
assert.match(
  relayRuntimeTestText,
  /downstream_clients\.refresh[\s\S]*disabledTargetIds[\s\S]*stale\.acp:target[\s\S]*manual\.acp:target[\s\S]*codex\.refresh-proof[\s\S]*session\.resume[\s\S]*capabilitiesSnapshot[\s\S]*routes downstream client aspect refresh through Tool Management authorization[\s\S]*\/api\/agent-relay\/v1\/downstream-clients\/refresh/,
  "ACP relay runtime and HTTP tests must cover governed downstream client aspect refresh, stale descriptor reconciliation, and post-refresh session resume using refreshed ACP descriptors."
);
assert.match(
  downstreamClientAspectText,
  /fromAspect:\s*"downstream-client-aspect"[\s\S]*aspectProtocolVersion[\s\S]*serviceKind/,
  "Downstream client aspect ACP descriptors must carry public ownership metadata for safe refresh reconciliation."
);
assert.match(
  consoleDomainOperationExecutorText,
  /createAcpRelayRuntime\(\{[\s\S]*userDataPath[\s\S]*storeAdapter/,
  "Console operation executor must pass userDataPath into ACP relay runtime so registry adapters persist governed registrations."
);
assert.match(
  relayOperationExecutorText,
  /function targetCapabilityDescriptor[\s\S]*metadata:\s*asObject\(input\.metadata\?\.public \|\| input\.metadata\?\.safe \|\| \{\}\)/,
  "ACP relay target discovery must return a safe target capability descriptor without raw metadata or transport secrets."
);
assert.match(
  relayOperationExecutorText,
  /function virtualAgentCapabilityDescriptor[\s\S]*metadata:\s*asObject\(agent\.metadata\?\.public \|\| agent\.metadata\?\.safe \|\| \{\}\)/,
  "ACP relay virtual-agent discovery must return safe metadata only."
);
const eventNormalizerText = await fs.readFile(new URL(
  "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-event-normalizer.mjs",
  import.meta.url
), "utf8");
assert.match(
  eventNormalizerText,
  /SENSITIVE_KEY_PATTERN[\s\S]*authorization[\s\S]*csrf[\s\S]*api\[-_]\?key[\s\S]*client\[-_]\?secret/,
  "ACP relay event normalizer must redact common nested credential and CSRF fields."
);
assert.match(
  relayOperationExecutorText,
  /acp_agent_relay\.sessions\.list[\s\S]*acp_agent_relay\.sessions\.get[\s\S]*acp_agent_relay\.turns\.list[\s\S]*acp_agent_relay\.turn\.observe/,
  "ACP relay executor must expose read-side session, turn, and target-observation operations."
);
assert.match(
  sourceJsonRpcBridgeText,
  /ACP_METHODS\.pactTargetList[\s\S]*ACP_METHODS\.targetList[\s\S]*listTargets/,
  "ACP source JSON-RPC bridge must expose source-facing target discovery methods."
);
assert.match(
  sourceJsonRpcBridgeText,
  /ACP_METHODS\.pactSessionList[\s\S]*ACP_METHODS\.sessionList[\s\S]*listSessions[\s\S]*ACP_METHODS\.pactSessionGet[\s\S]*ACP_METHODS\.sessionGet[\s\S]*getSession[\s\S]*ACP_METHODS\.pactTurnList[\s\S]*ACP_METHODS\.turnList[\s\S]*listTurns[\s\S]*ACP_METHODS\.pactTurnObserve[\s\S]*ACP_METHODS\.turnObserve[\s\S]*observeTurn/,
  "ACP source JSON-RPC bridge must expose source-facing relay session, turn, and target-observation methods."
);
assert.match(
  sourceJsonRpcBridgeText,
  /function sourceCommunicationSummary[\s\S]*function sourceTurnSummary[\s\S]*function sourceSessionSummary/,
  "ACP source JSON-RPC bridge must project relay session and turn summaries through a source-facing sanitizer."
);
const acpRelayManifestOperations = new Set(acpRelayModuleManifest.components?.acpAgentRelay?.operations || []);
const operationRegistryIds = new Set(SERVER_API_OPERATIONS.map((operation) => operation.id));
const publicAcpRelayToolOperationIds = [
  "acp_agent_relay.virtual_agents.list",
  "acp_agent_relay.virtual_agents.upsert",
  "acp_agent_relay.targets.list",
  "acp_agent_relay.targets.upsert",
  "acp_agent_relay.downstream_clients.refresh",
  "acp_agent_relay.sessions.list",
  "acp_agent_relay.sessions.get",
  "acp_agent_relay.turns.list",
  "acp_agent_relay.turn.observe",
  "acp_agent_relay.virtual_agent.initialize",
  "acp_agent_relay.session.create",
  "acp_agent_relay.session.resume",
  "acp_agent_relay.session.wake",
  "acp_agent_relay.prompt.send",
  "acp_agent_relay.fs.read_text_file",
  "acp_agent_relay.fs.write_text_file",
  "acp_agent_relay.session.cancel",
  "acp_agent_relay.session.close"
];
const internalAcpRelayOperationIds = ["acp_agent_relay.permission.resolve"];
for (const operationId of [...publicAcpRelayToolOperationIds, ...internalAcpRelayOperationIds]) {
  assert.equal(operationRegistryIds.has(operationId), true, `${operationId} must be registered in SERVER_API_OPERATIONS`);
  assert.equal(acpRelayManifestOperations.has(operationId), true, `${operationId} must be declared in ACP relay module.json`);
}

// 0) Static ACP contract checks (phase-0 framing requirements).
const initializeRequest = createRequest(ACP_METHODS.initialize, { client: "pact.acp-agent-relay-verifier" });
assert.equal(parseJsonRpcMessage(initializeRequest).method, ACP_METHODS.initialize);

const sessionNewRequest = createRequest(ACP_METHODS.sessionNew, { subjectId: "verifier" });
assert.equal(parseJsonRpcMessage(sessionNewRequest).method, ACP_METHODS.sessionNew);

const sessionLoadRequest = createRequest(ACP_METHODS.sessionLoad, { resumeRef: "resume-1" });
assert.equal(parseJsonRpcMessage(sessionLoadRequest).method, ACP_METHODS.sessionLoad);

const sessionPromptRequest = createRequest(ACP_METHODS.sessionPrompt, { prompt: "ping" });
assert.equal(parseJsonRpcMessage(sessionPromptRequest).method, ACP_METHODS.sessionPrompt);

const sessionUpdateNotification = createNotification(ACP_METHODS.sessionUpdate, { type: "progress", text: "ok" });
assert.equal(parseJsonRpcMessage(sessionUpdateNotification).method, ACP_METHODS.sessionUpdate);

const completeResult = createSuccess("rpc-1", { stopReason: "completed" });
assert.equal(completeResult.result.stopReason, "completed");

const rpcError = createError("rpc-1", -32000, "err");
assert.equal(parseJsonRpcMessage(rpcError).error.code, -32000);

const transport = createInMemoryJsonRpcTransport();
await transport.send(initializeRequest);
const transportMessage = await transport.receive();
assert.equal(parseJsonRpcMessage(transportMessage).method, ACP_METHODS.initialize);

assert.equal(ACP_METHODS.sessionLoad, "session/load");
assert.equal(ACP_METHODS.pactTargetList, "_pact/target/list");
assert.equal(ACP_METHODS.targetList, "target/list");
assert.equal(ACP_METHODS.pactSessionList, "_pact/session/list");
assert.equal(ACP_METHODS.sessionList, "session/list");
assert.equal(ACP_METHODS.pactSessionGet, "_pact/session/get");
assert.equal(ACP_METHODS.sessionGet, "session/get");
assert.equal(ACP_METHODS.pactTurnList, "_pact/turn/list");
assert.equal(ACP_METHODS.turnList, "turn/list");
assert.equal(ACP_METHODS.pactTurnObserve, "_pact/turn/observe");
assert.equal(ACP_METHODS.turnObserve, "turn/observe");
const targetListRequest = createRequest(ACP_METHODS.pactTargetList, { sourceId: "verifier" });
assert.equal(parseJsonRpcMessage(targetListRequest).method, ACP_METHODS.pactTargetList);
const sessionListRequest = createRequest(ACP_METHODS.pactSessionList, { sourceId: "verifier" });
assert.equal(parseJsonRpcMessage(sessionListRequest).method, ACP_METHODS.pactSessionList);
const turnObserveRequest = createRequest(ACP_METHODS.pactTurnObserve, { relayTurnId: "turn-1" });
assert.equal(parseJsonRpcMessage(turnObserveRequest).method, ACP_METHODS.pactTurnObserve);

// 1) Build runtime with mock session driver.
const targetId = "shared.mock:stdio";
const workspaceId = "acp-relay-phase0";
const readOnlyVirtualAgentId = "agent.shared.repo-readonly";
const writableVirtualAgentId = "agent.shared.repo-writer";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-agent-relay-"));
const workspaceRoot = path.join(tempRoot, "workspace");
await fs.mkdir(workspaceRoot, { recursive: true });
const allowedPathForWrites = path.join(workspaceRoot, "shared-allowed.txt");
await fs.writeFile(allowedPathForWrites, "baseline", "utf8");

const stdioTargetScript = path.join(tempRoot, "verify-acp-target-stdio.mjs");
await fs.writeFile(
  stdioTargetScript,
  `
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "target.acp.verifier.v1", capabilities: { session: ["new", "resume"], updates: ["progress"] } } });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { targetSessionId: "verify-stdio-target-session", targetResumeRef: "verify-stdio-target-resume" } });
  } else if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { type: "progress", phase: "working", text: "stdio verifier target working" } });
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "completed", output: "stdio verifier target final response" } });
  } else if (message.method === "session/cancel") {
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unsupported" } });
  }
}
`,
  "utf8"
);
const stdioTargetConnection = runtimeModule.createAcpTargetConnection({
  target: {
    targetId: "verify.acp.stdio-target",
    transport: {
      type: "stdio",
      command: {
        executable: process.execPath,
        args: [stdioTargetScript]
      },
      timeoutMs: 1000
    }
  }
});
const stdioInitialize = await stdioTargetConnection.initialize({ relaySessionId: "verify-stdio-relay-session" });
assert.equal(stdioInitialize.ok, true);
assert.equal(stdioInitialize.protocolVersion, "target.acp.verifier.v1");
assert.equal(stdioInitialize.targetSessionId, "verify-stdio-target-session");
const stdioPrompt = await stdioTargetConnection.sendPrompt({
  relaySessionId: "verify-stdio-relay-session",
  prompt: "verify target stdio final response"
});
assert.equal(stdioPrompt.ok, true);
assert.equal(stdioPrompt.stopReason, "completed");
assert.equal(stdioPrompt.outputSummary, "stdio verifier target final response");
assert.equal(stdioPrompt.finalResponseAvailable, true);
assert.equal(stdioPrompt.updates.some((update) => update.phase === "working"), true);
const stdioChild = stdioTargetConnection.transport?.child || null;
await stdioTargetConnection.close();
if (stdioChild && stdioChild.exitCode === null) {
  await Promise.race([
    once(stdioChild, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
}
assert.equal(stdioChild ? stdioChild.exitCode !== null || stdioChild.killed === true : true, true);

const missingStdioTargetConnection = runtimeModule.createAcpTargetConnection({
  target: {
    targetId: "verify.acp.stdio-missing-target",
    transport: {
      type: "stdio",
      command: {
        executable: path.join(tempRoot, "missing-acp-target")
      },
      timeoutMs: 250
    }
  }
});
await assert.rejects(
  missingStdioTargetConnection.initialize({ relaySessionId: "verify-missing-stdio-relay-session" }),
  /Target ACP transport (closed|is closed|refused)/
);
assert.equal(missingStdioTargetConnection.initialized, false);
assert.equal(missingStdioTargetConnection.closed, true);

const sourceToTargetScript = path.join(tempRoot, "verify-source-to-target-acp-stdio.mjs");
const sourceToTargetExitMarker = path.join(tempRoot, "verify-source-to-target-exited.txt");
const sourceToTargetStorePath = path.join(tempRoot, "verify-source-to-target-store.json");
await fs.writeFile(
  sourceToTargetScript,
  `
import fs from "node:fs";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const exitMarker = process.env.PACT_TARGET_EXIT_MARKER || "";

process.on("SIGTERM", () => {
  if (exitMarker) {
    fs.writeFileSync(exitMarker, "sigterm", "utf8");
  }
  process.exit(0);
});

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "target.acp.full-e2e.v1", capabilities: { session: ["new", "resume"], updates: ["progress"] } } });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { targetSessionId: "source-to-target-stdio-session", targetResumeRef: "source-to-target-stdio-resume" } });
  } else if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { type: "progress", phase: "working", text: "target stdio e2e working" } });
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "completed", output: "source stdio reached target stdio final response" } });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unsupported" } });
  }
}
`,
  "utf8"
);
const sourceToTargetVirtualAgentId = "verify.source-to-target-stdio-agent";
const sourceToTargetTargetId = "verify.source-to-target-stdio-target";
const sourceToTargetRuntimeOptions = {
  defaultVirtualAgentId: sourceToTargetVirtualAgentId,
  defaultSourceId: "verify-source-stdio",
  defaultWorkspaceId: workspaceId,
  virtualAgents: {
    [sourceToTargetVirtualAgentId]: {
      virtualAgentId: sourceToTargetVirtualAgentId,
      targetId: sourceToTargetTargetId,
      profileId: "pact.acp.verify.source_to_target_stdio",
      displayName: "Verify Source To Target ACP Stdio",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedTools: ["target.acp.prompt"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      revision: 1
    }
  },
  targets: {
    [sourceToTargetTargetId]: {
      targetId: sourceToTargetTargetId,
      label: "Verify Target ACP Stdio",
      transport: {
        type: "stdio",
        command: {
          executable: process.execPath,
          args: [sourceToTargetScript],
          env: {
            PACT_TARGET_EXIT_MARKER: sourceToTargetExitMarker
          }
        },
        timeoutMs: 1000
      },
      externalServiceId: "external.verify.target-stdio",
      enabled: true,
      revision: 1,
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      advertisedToolsets: ["target.acp.prompt"]
    }
  },
  workspaceRoot
};
const sourceToTargetChild = spawn(process.execPath, ["server/scripts/acp-agent-relay-source-stdio.mjs"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(sourceToTargetRuntimeOptions),
    PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
      sourceId: "verify-source-stdio",
      workspaceId
    }),
    PACT_ACP_SOURCE_STDIO_STORE_PATH: sourceToTargetStorePath
  }
});
const sourceToTargetStdout = createOutputLineReader(sourceToTargetChild.stdout);
const sourceToTargetStderr = createOutputLineReader(sourceToTargetChild.stderr);
const sendSourceToTarget = (message) => {
  sourceToTargetChild.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
};
let sourceToTargetRelaySessionId = "";
let sourceToTargetTargetSessionId = "";
let sourceToTargetTargetResumeRef = "";
const waitForSourceToTargetExitMarker = async () => {
  for (let index = 0; index < 40; index += 1) {
    const marker = await fs.readFile(sourceToTargetExitMarker, "utf8").catch(() => "");
    if (marker) {
      return marker;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for source-to-target stdio child exit marker.");
};
try {
  const ready = JSON.parse(await sourceToTargetStderr.receiveLine());
  assert.equal(ready.event, "pact.acp.source_stdio.ready");
  assert.equal(ready.durableStore, true);
  sendSourceToTarget(createRequest(ACP_METHODS.initialize, { virtualAgentId: sourceToTargetVirtualAgentId }, "verify-source-target-init"));
  const sourceInitialize = parseJsonRpcMessage(await sourceToTargetStdout.receiveLine());
  assert.equal(sourceInitialize.id, "verify-source-target-init");
  assert.equal(sourceInitialize.result.virtualAgentId, sourceToTargetVirtualAgentId);

  sendSourceToTarget(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId: sourceToTargetVirtualAgentId,
      sourceId: "verify-source-stdio",
      sourceSessionId: "verify-source-to-target-stdio-session",
      workspaceId
    },
    "verify-source-target-session-new"
  ));
  const sourceSessionNew = parseJsonRpcMessage(await sourceToTargetStdout.receiveLine());
  assert.equal(sourceSessionNew.id, "verify-source-target-session-new");
  assert.match(sourceSessionNew.result.sessionId, /^relay_session_/);
  sourceToTargetRelaySessionId = sourceSessionNew.result.sessionId;

  sendSourceToTarget(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: sourceSessionNew.result.sessionId,
      prompt: "verify source stdio to target stdio"
    },
    "verify-source-target-prompt"
  ));
  const sourceTargetNotifications = [];
  let sourceTargetPrompt = null;
  for (let index = 0; index < 20; index += 1) {
    const parsed = parseJsonRpcMessage(await sourceToTargetStdout.receiveLine());
    if (parsed.method === ACP_METHODS.sessionUpdate) {
      sourceTargetNotifications.push(parsed);
      continue;
    }
    sourceTargetPrompt = parsed;
    break;
  }
  assert.ok(sourceTargetPrompt, "source stdio prompt must receive a JSON-RPC response");
  assert.equal(sourceTargetPrompt.id, "verify-source-target-prompt");
  assert.equal(sourceTargetPrompt.result.stopReason, "completed");
  assert.equal(sourceTargetPrompt.result.output, "source stdio reached target stdio final response");
  assert.equal(sourceTargetPrompt.result.targetEvidence.externalServiceId, "external.verify.target-stdio");
  assert.equal(sourceTargetPrompt.result.targetEvidence.targetSessionId, "source-to-target-stdio-session");
  assert.equal(sourceTargetPrompt.result.targetEvidence.targetResumeRef, "source-to-target-stdio-resume");
  sourceToTargetTargetSessionId = sourceTargetPrompt.result.targetEvidence.targetSessionId;
  sourceToTargetTargetResumeRef = sourceTargetPrompt.result.targetEvidence.targetResumeRef;
  assert.equal(sourceTargetPrompt.result.targetEvidence.finalResponseAvailable, true);
  assert.equal(sourceTargetNotifications.some((notification) => notification.params?.phase === "working"), true);
  assert.equal(sourceTargetNotifications.some((notification) => notification.params?.type === "completion"), true);

  sendSourceToTarget(createRequest(
    ACP_METHODS.sessionClose,
    {
      sessionId: sourceSessionNew.result.sessionId,
      sourceId: "verify-source-stdio",
      workspaceId
    },
    "verify-source-target-close"
  ));
  const sourceTargetClose = parseJsonRpcMessage(await sourceToTargetStdout.receiveLine());
  assert.equal(sourceTargetClose.id, "verify-source-target-close");
  assert.equal(sourceTargetClose.result.lifecycleState, "closed");
  assert.equal(sourceTargetClose.result.close.ok, true);
  assert.match(await waitForSourceToTargetExitMarker(), /sigterm/);

  sendSourceToTarget(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: sourceSessionNew.result.sessionId,
      prompt: "should fail after source stdio close"
    },
    "verify-source-target-prompt-after-close"
  ));
  const sourceTargetAfterClose = parseJsonRpcMessage(await sourceToTargetStdout.receiveLine());
  assert.equal(sourceTargetAfterClose.id, "verify-source-target-prompt-after-close");
  assert.equal(sourceTargetAfterClose.error.data.code, "relay_session_closed");
} finally {
  const exit = await stopChildProcess(sourceToTargetChild);
  assert.equal(exit.code === 0 || exit.code === null, true);
}

const restartedSourceToTargetChild = spawn(process.execPath, ["server/scripts/acp-agent-relay-source-stdio.mjs"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(sourceToTargetRuntimeOptions),
    PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
      sourceId: "verify-source-stdio",
      workspaceId
    }),
    PACT_ACP_SOURCE_STDIO_STORE_PATH: sourceToTargetStorePath
  }
});
const restartedSourceToTargetStdout = createOutputLineReader(restartedSourceToTargetChild.stdout);
const restartedSourceToTargetStderr = createOutputLineReader(restartedSourceToTargetChild.stderr);
const sendRestartedSourceToTarget = (message) => {
  restartedSourceToTargetChild.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
};
try {
  const ready = JSON.parse(await restartedSourceToTargetStderr.receiveLine());
  assert.equal(ready.event, "pact.acp.source_stdio.ready");
  assert.equal(ready.durableStore, true);

  sendRestartedSourceToTarget(createRequest(
    ACP_METHODS.sessionLoad,
    {
      virtualAgentId: sourceToTargetVirtualAgentId,
      sourceId: "verify-source-stdio",
      sourceSessionId: "verify-source-to-target-stdio-session",
      workspaceId
    },
    "verify-source-target-closed-load-after-restart"
  ));
  const sourceTargetClosedLoad = await receiveJsonRpcResponseUntilId(
    restartedSourceToTargetStdout,
    "verify-source-target-closed-load-after-restart"
  );
  assert.equal(sourceTargetClosedLoad.id, "verify-source-target-closed-load-after-restart");
  assert.equal(sourceTargetClosedLoad.result.sessionId, sourceToTargetRelaySessionId);
  assert.equal(sourceTargetClosedLoad.result.lifecycleState, "closed");
  assert.equal(sourceTargetClosedLoad.result.targetSessionId, sourceToTargetTargetSessionId);
  assert.equal(sourceTargetClosedLoad.result.targetResumeRef, sourceToTargetTargetResumeRef);
  assert.equal(sourceTargetClosedLoad.result.replayedUpdateCount, sourceTargetClosedLoad.notifications.length);
  assert.equal(sourceTargetClosedLoad.notifications.length > 0, true);
  assert.equal(sourceTargetClosedLoad.notifications.some((notification) => notification.params?.phase === "working"), true);
  assert.equal(sourceTargetClosedLoad.notifications.some((notification) => notification.params?.type === "completion"), true);

  sendRestartedSourceToTarget(createRequest(
    ACP_METHODS.sessionResume,
    {
      virtualAgentId: sourceToTargetVirtualAgentId,
      sourceId: "verify-source-stdio",
      sourceSessionId: "verify-source-to-target-stdio-session",
      workspaceId
    },
    "verify-source-target-closed-resume-after-restart"
  ));
  const sourceTargetClosedResume = parseJsonRpcMessage(await restartedSourceToTargetStdout.receiveLine());
  assert.equal(sourceTargetClosedResume.id, "verify-source-target-closed-resume-after-restart");
  assert.equal(sourceTargetClosedResume.error?.data?.code, "relay_session_closed");

  sendRestartedSourceToTarget(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: sourceToTargetRelaySessionId,
      prompt: "should fail after source stdio restart of closed session"
    },
    "verify-source-target-closed-prompt-after-restart"
  ));
  const sourceTargetClosedPrompt = parseJsonRpcMessage(await restartedSourceToTargetStdout.receiveLine());
  assert.equal(sourceTargetClosedPrompt.id, "verify-source-target-closed-prompt-after-restart");
  assert.equal(sourceTargetClosedPrompt.error?.data?.code, "relay_session_closed");
} finally {
  const exit = await stopChildProcess(restartedSourceToTargetChild);
  assert.equal(exit.code === 0 || exit.code === null, true);
}

const initializeInputs = [];
const connectionFactoryInputs = [];
const connectionBySession = new Map();
let connectionSequence = 0;

const virtualAgentRegistry = new runtimeModule.AcpVirtualAgentRegistry({
  [readOnlyVirtualAgentId]: {
    virtualAgentId: readOnlyVirtualAgentId,
    targetId,
    profileId: "pact.acp.shared.readonly",
    displayName: "Shared Read-only Relay",
    advertisedModes: ["ask"],
    defaultMode: "ask",
    advertisedTools: ["pact.knowledge.search", "fs.readTextFile"],
    reasoningVisibilityPolicy: "requestable",
    capabilityPolicy: {
      writes: "deny",
      terminal: "deny",
      maxRisk: "read_only"
    },
    metadata: {
      public: { verifier: "read-only-public-metadata" },
      csrfToken: "read-only-virtual-agent-csrf-secret",
      apiKey: "read-only-virtual-agent-api-key",
      rawPrompt: "read-only-virtual-agent-raw-prompt",
      transport: { command: "/tmp/read-only-virtual-agent-command" }
    },
    revision: 1
  },
  [writableVirtualAgentId]: {
    virtualAgentId: writableVirtualAgentId,
    targetId,
    profileId: "pact.acp.shared.writer",
    displayName: "Shared Writable Relay",
    advertisedModes: ["ask", "agent", "edit"],
    defaultMode: "agent",
    advertisedTools: ["pact.knowledge.search", "fs.readTextFile", "fs.writeTextFile"],
    reasoningVisibilityPolicy: "requestable",
    capabilityPolicy: {
      writes: "approval_required",
      terminal: "deny",
      maxRisk: "repair_write"
    },
    metadata: {
      public: { verifier: "writer-public-metadata" },
      csrfToken: "writer-virtual-agent-csrf-secret",
      apiKey: "writer-virtual-agent-api-key",
      rawPrompt: "writer-virtual-agent-raw-prompt",
      transport: { command: "/tmp/writer-virtual-agent-command" }
    },
    revision: 2
  }
});

const targetRegistry = new runtimeModule.AcpTargetRegistry({
  [targetId]: {
    targetId,
    label: "Shared Mock Target",
    transport: { type: "mock" },
    agentProfileId: "pact.acp.shared.mock",
    enabled: true,
    revision: 3,
    capabilityPolicy: {
      writes: "approval_required",
      terminal: "deny",
      maxRisk: "repair_write"
    },
    advertisedToolsets: [
      "fs.readTextFile",
      "fs.writeTextFile",
      "pact.knowledge.search"
    ]
  }
});

const router = new runtimeModule.AcpRelayRouter({
  virtualAgentRegistry,
  targetRegistry
});

const normalizer = new runtimeModule.AcpEventNormalizer();
const permissionBridge = new runtimeModule.AcpPermissionBridge({ workspaceRoot });
const store = new runtimeModule.RelaySessionStore();

function sessionDriverFactory({ target, relaySession, route }) {
  const connection = {
    id: `conn_${++connectionSequence}`,
    targetId: asText(target.targetId),
    relaySessionId: asText(relaySession.relaySessionId),
    initialized: false,
    closed: false,
    sentPrompts: [],
    async initialize(params = {}) {
      initializeInputs.push({
        targetId: target.targetId,
        relaySessionId: relaySession.relaySessionId,
        params
      });
      this.initialized = true;
      return {
        ok: true,
        targetId: this.targetId,
        capabilities: {
          session: ["new", "resume", "cancel"],
          updates: ["progress", "reasoning_trace"],
          fs: ["read_text_file", "write_text_file"],
          terminal: false,
          mcp: true
        },
        initializedAt: nowIso()
      };
    },
    async sendPrompt(params = {}) {
      this.sentPrompts.push(params);
      const prompt = asText(params.prompt || params.text);
      return {
        ok: true,
        updates: [
          { type: "progress", phase: "accepted", text: `Relay accepted [${asText(route.effectiveMode, "ask")}]` },
          { type: "progress", phase: "working", text: "Relay target completed delegated work." }
        ],
        reasoning: params.requestReasoning === true
          ? [
              {
                type: "reasoning_trace",
                reason: "mock-target",
                text: `Reasoning trace for: ${prompt}`
              }
            ]
          : [],
        stopReason: "completed",
        text: `target-complete:${prompt}`,
        externalCompletionState: "completed",
        finalResponseAvailable: true
      };
    },
    async cancel() {
      return { ok: true, cancelledAt: nowIso() };
    },
    async close() {
      this.closed = true;
      return { ok: true, closedAt: nowIso() };
    }
  };
  connectionBySession.set(relaySession.relaySessionId, connection);
  connectionFactoryInputs.push({ target, relaySessionId: asText(relaySession.relaySessionId), route });
  return connection;
}

const runtime = runtimeModule.createAcpRelayRuntime({
  virtualAgentRegistry,
  targetRegistry,
  router,
  permissionBridge,
  eventNormalizer: normalizer,
  store,
  sessionDriver: {
    async wake({ target, relaySession, route }) {
      const key = asText(relaySession.relaySessionId);
      let connection = connectionBySession.get(key);
      let wakeMode = "reused";
      if (!connection || connection.closed) {
        connection = sessionDriverFactory({ target, relaySession, route });
        wakeMode = relaySession.targetResumeRef ? "resumed" : "created";
      }
      if (!connection.initialized) {
        await connection.initialize({
          relaySessionId: relaySession.relaySessionId,
          targetResumeRef: relaySession.targetResumeRef || ""
        });
      }
      return {
        ok: true,
        connection,
        wakeMode,
        targetSessionId: relaySession.targetSessionId || `target_session_${relaySession.relaySessionId}`,
        targetResumeRef: relaySession.targetResumeRef || `resume_${relaySession.relaySessionId}`,
        wokenAt: nowIso()
      };
    },
    async prompt({ connection, prompt = {}, route = {}, relaySession = {} }) {
      return connection.sendPrompt({
        ...prompt,
        relaySessionId: relaySession.relaySessionId || "",
        virtualAgentId: route.virtualAgent?.virtualAgentId || "",
        targetId: route.target?.targetId || "",
        mode: route.effectiveMode || "ask"
      });
    },
    async cancel({ target = {}, relaySession = {} } = {}) {
      const connection = connectionBySession.get(asText(relaySession.relaySessionId));
      if (!connection) {
        return { ok: true, cancelledAt: nowIso(), alreadyClosed: true };
      }
      return connection.cancel({ relaySessionId: relaySession.relaySessionId, targetId: target.targetId });
    }
  }
});

// 2) Multiple virtual inbound agents map to same concrete target with different policies.
const routeRead = await runtime.router.resolveForSourceSession({
  virtualAgentId: readOnlyVirtualAgentId,
  workspaceId,
  sourceId: "source-read",
  sourceSessionId: "src-read",
  requestedMode: "ask",
  prompt: "shared target mapping"
});
const routeWrite = await runtime.router.resolveForSourceSession({
  virtualAgentId: writableVirtualAgentId,
  workspaceId,
  sourceId: "source-write",
  sourceSessionId: "src-write",
  requestedMode: "agent",
  prompt: "shared target mapping"
});
assert.equal(routeRead.ok, true);
assert.equal(routeWrite.ok, true);
assert.equal(routeRead.route.target.targetId, targetId);
assert.equal(routeWrite.route.target.targetId, targetId);
assert.notEqual(routeRead.route.decision.writesPolicy.writes, routeWrite.route.decision.writesPolicy.writes);
assert.deepEqual(routeWrite.route.decision.advertisedTools, [
  "pact.knowledge.search",
  "fs.readTextFile",
  "fs.writeTextFile"
]);

const virtualAgents = await runtime.execute("acp_agent_relay.virtual_agents.list", {});
assert.equal(virtualAgents.ok, true);
assert.equal(
  virtualAgents.data.virtualAgents.some((agent) => agent.virtualAgentId === readOnlyVirtualAgentId),
  true
);
assert.equal(
  virtualAgents.data.virtualAgents.some((agent) => agent.virtualAgentId === writableVirtualAgentId),
  true
);
const listedWritableVirtualAgent = virtualAgents.data.virtualAgents.find(
  (agent) => agent.virtualAgentId === writableVirtualAgentId
);
assert.deepEqual(listedWritableVirtualAgent.metadata, { verifier: "writer-public-metadata" });
for (const forbidden of [
  "writer-virtual-agent-csrf-secret",
  "writer-virtual-agent-api-key",
  "writer-virtual-agent-raw-prompt",
  "writer-virtual-agent-command",
  "read-only-virtual-agent-csrf-secret",
  "read-only-virtual-agent-api-key",
  "read-only-virtual-agent-raw-prompt",
  "read-only-virtual-agent-command"
]) {
  assert.equal(JSON.stringify(virtualAgents.data.virtualAgents).includes(forbidden), false);
}

const initRead = await runtime.execute("acp_agent_relay.virtual_agent.initialize", {
  virtualAgentId: readOnlyVirtualAgentId
});
const initWrite = await runtime.execute("acp_agent_relay.virtual_agent.initialize", {
  virtualAgentId: writableVirtualAgentId
});
assert.equal(initRead.ok, true);
assert.equal(initWrite.ok, true);
assert.equal(initRead.data.capabilities.writes, "deny");
assert.equal(initWrite.data.capabilities.writes, "approval_required");
assert.deepEqual(initWrite.data.capabilities.tools, routeWrite.route.decision.advertisedTools);
assert.deepEqual(initWrite.data.capabilitiesSnapshot.metadata, { verifier: "writer-public-metadata" });
for (const forbidden of [
  "writer-virtual-agent-csrf-secret",
  "writer-virtual-agent-api-key",
  "writer-virtual-agent-raw-prompt",
  "writer-virtual-agent-command"
]) {
  assert.equal(JSON.stringify(initWrite.data).includes(forbidden), false);
}

const readOnlyBoundaryTargetId = "shared.mock:target-read-only-boundary";
const writeVirtualReadOnlyTargetId = "agent.shared.writer-target-read-only";
targetRegistry.upsertTarget({
  targetId: readOnlyBoundaryTargetId,
  label: "Shared Read-only Boundary Target",
  transport: { type: "mock" },
  externalServiceId: "external.acp.read-only-boundary",
  enabled: true,
  revision: 1,
  capabilityPolicy: {
    writes: "deny",
    terminal: "deny",
    maxRisk: "read_only"
  },
  advertisedToolsets: ["fs.readTextFile"]
});
virtualAgentRegistry.upsertAgent({
  virtualAgentId: writeVirtualReadOnlyTargetId,
  targetId: readOnlyBoundaryTargetId,
  profileId: "pact.acp.shared.writer_readonly_boundary",
  displayName: "Writable Virtual Read-only Target Boundary",
  advertisedModes: ["ask"],
  defaultMode: "ask",
  advertisedTools: ["fs.readTextFile", "fs.writeTextFile"],
  reasoningVisibilityPolicy: "never",
  capabilityPolicy: {
    writes: "approval_required",
    terminal: "deny",
    maxRisk: "repair_write"
  },
  revision: 1
});
const initBoundary = await runtime.execute("acp_agent_relay.virtual_agent.initialize", {
  virtualAgentId: writeVirtualReadOnlyTargetId
});
assert.equal(initBoundary.ok, true);
assert.deepEqual(initBoundary.data.capabilities.tools, ["fs.readTextFile"]);
assert.equal(initBoundary.data.capabilities.writes, "deny");
assert.equal(initBoundary.data.capabilities.maxRisk, "read_only");
const boundarySession = await runtime.execute("acp_agent_relay.session.create", {
  virtualAgentId: writeVirtualReadOnlyTargetId,
  sourceId: "source-boundary",
  sourceSessionId: "src-boundary",
  workspaceId
});
assert.equal(boundarySession.ok, true);
const boundaryWrite = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: boundarySession.data.session.relaySessionId,
  prompt: "target policy should deny",
  fileWrites: [
    {
      path: "shared-allowed.txt",
      content: "target denied",
      approval: {
        approved: true,
        approvalId: "target-boundary",
        payloadHash: hashPayloadForWrite("shared-allowed.txt", "target denied")
      }
    }
  ]
});
assert.equal(boundaryWrite.ok, true);
assertPromptAuditEvidence(boundaryWrite);
assert.equal(boundaryWrite.data.receipts[0].reasonCode, "effective_policy_write_denied");
assert.equal(boundaryWrite.data.targetEvidence.externalServiceId, "external.acp.read-only-boundary");
assert.deepEqual(boundaryWrite.data.targetEvidence.advertisedTools, ["fs.readTextFile"]);
assert.equal(boundaryWrite.data.targetEvidence.effectiveWrites, "deny");
assert.equal(boundaryWrite.data.targetEvidence.effectiveMaxRisk, "read_only");

const mismatchVirtualAgentId = "agent.shared.external-service-mismatch";
virtualAgentRegistry.upsertAgent({
  virtualAgentId: mismatchVirtualAgentId,
  targetId: readOnlyBoundaryTargetId,
  profileId: "pact.acp.shared.external_service_mismatch",
  displayName: "External Service Mismatch Boundary",
  advertisedModes: ["ask"],
  defaultMode: "ask",
  advertisedTools: ["fs.readTextFile"],
  reasoningVisibilityPolicy: "never",
  capabilityPolicy: {
    writes: "deny",
    terminal: "deny",
    maxRisk: "read_only"
  },
  metadata: {
    expectedExternalServiceId: "external.acp.expected-service"
  },
  revision: 1
});
const mismatchSession = await runtime.execute("acp_agent_relay.session.create", {
  virtualAgentId: mismatchVirtualAgentId,
  sourceId: "source-mismatch",
  sourceSessionId: "src-mismatch",
  workspaceId
});
assert.equal(mismatchSession.ok, false);
assert.equal(mismatchSession.error.code, "target_external_service_mismatch");

// 3) Durable wake + policy recalculation.
const createReadSession = await runtime.execute("acp_agent_relay.session.create", {
  virtualAgentId: readOnlyVirtualAgentId,
  sourceId: "source-read",
  sourceSessionId: "read-session-1",
  workspaceId
});
const createWriteSession = await runtime.execute("acp_agent_relay.session.create", {
  virtualAgentId: writableVirtualAgentId,
  sourceId: "source-write",
  sourceSessionId: "write-session-1",
  workspaceId,
  targetResumeRef: "res-001",
  sourceSubjectId: "subject-a",
  relayMcpGrantId: "grant-phase0"
});
assert.equal(createReadSession.ok, true);
assert.equal(createWriteSession.ok, true);

const writeSessionId = createWriteSession.data.session.relaySessionId;

await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: writeSessionId,
  prompt: "first prompt"
});

const firstConnection = connectionBySession.get(writeSessionId);
assert.ok(firstConnection);
const firstSessionState = await runtime.store.getSession(writeSessionId);
const firstPolicyRevision = firstSessionState.policyRevision;
assert.equal(firstSessionState.policyRevision, routeWrite.route.policyRevision);

// Simulate target shutdown and policy revision bump.
await firstConnection.close();
virtualAgentRegistry.upsertAgent({
  ...virtualAgentRegistry.getAgent(writableVirtualAgentId),
  revision: 9
});

const wakeAfterDowngrade = await runtime.execute("acp_agent_relay.session.wake", { sessionId: writeSessionId });
assert.equal(wakeAfterDowngrade.ok, true);
assert.equal(wakeAfterDowngrade.data.wake.wakeMode, "resumed");
const secondConnection = connectionBySession.get(writeSessionId);
assert.equal(firstConnection !== secondConnection, true);
const secondSessionState = await runtime.store.getSession(writeSessionId);
assert.notEqual(secondSessionState.policyRevision, firstPolicyRevision);

// 4) Reasoning visibility: default-hidden, explicit request returns dedicated channel.
const defaultReasoning = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: writeSessionId,
  prompt: "reasoning off"
});
assert.equal(defaultReasoning.ok, true);
assertPromptAuditEvidence(defaultReasoning);
assert.equal(
  defaultReasoning.data.events.some((event) => event.type === "reasoning_trace"),
  false
);

const completedTargetText = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: writeSessionId,
  prompt: "final response capable target",
  idempotencyKey: "verify-final-response-capable-target"
});
assert.equal(completedTargetText.ok, true);
assert.equal(completedTargetText.data.stopReason, "completed");
assert.equal(completedTargetText.data.outputSummary, "target-complete:final response capable target");
assert.equal(completedTargetText.data.targetEvidence.externalCompletionState, "completed");
assert.equal(completedTargetText.data.targetEvidence.finalResponseAvailable, true);
const completedTargetTextEvent = completedTargetText.data.events.find((event) => event.type === "completion");
assert.ok(completedTargetTextEvent);
assert.equal(
  completedTargetTextEvent.redactedPayload.outputSummary,
  "target-complete:final response capable target"
);
const completedTargetTextReplay = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: writeSessionId,
  prompt: "final response capable target",
  idempotencyKey: "verify-final-response-capable-target"
});
assert.equal(completedTargetTextReplay.ok, true);
assert.equal(completedTargetTextReplay.data.idempotencyReplay, true);
assert.equal(completedTargetTextReplay.data.turn.relayTurnId, completedTargetText.data.turn.relayTurnId);
assert.equal(completedTargetTextReplay.data.outputSummary, completedTargetText.data.outputSummary);
assert.equal(completedTargetTextReplay.data.targetEvidence.finalResponseAvailable, true);
assert.equal(completedTargetTextReplay.data.newEvents.length, 0);

const explicitReasoning = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: writeSessionId,
  prompt: "reasoning on",
  requestReasoning: true,
  fileWrites: [
    {
      path: "shared-allowed.txt",
      content: "reasoning policy check",
      approval: {
        approved: false,
        approvalId: "approval-pending-check",
        payloadHash: hashPayloadForWrite("shared-allowed.txt", "reasoning policy check")
      }
    }
  ]
});
assert.equal(explicitReasoning.ok, true);
assertPromptAuditEvidence(explicitReasoning);
assert.equal(explicitReasoning.data.stopReason, "approval_pending");
assert.equal(explicitReasoning.data.turn.status, "approval_pending");
assert.equal(
  explicitReasoning.data.events.some((event) => event.type === "reasoning_trace"),
  false
);
const explicitReasoningRequest = explicitReasoning.data.pendingPermissionRequests[0];
assert.equal(explicitReasoningRequest.details.content, undefined);
assert.equal(explicitReasoningRequest.details.promptText, undefined);
assert.match(explicitReasoningRequest.details.contentHash, /^[a-f0-9]{64}$/);
assert.match(explicitReasoningRequest.details.contentRef, /^sensitive:\/\/pact\/acp-agent-relay\/write-content\//);
assert.match(explicitReasoningRequest.details.promptHash, /^[a-f0-9]{64}$/);
assert.match(explicitReasoningRequest.details.promptRef, /^sensitive:\/\/pact\/acp-agent-relay\/prompt\//);
assert.equal(JSON.stringify(explicitReasoning.data.turn.metadata?.pendingPrompt || {}).includes("reasoning on"), false);
assert.equal(JSON.stringify(explicitReasoning.data.turn.metadata?.pendingPrompt || {}).includes("reasoning policy check"), false);
const resumedReasoning = await runtime.execute("acp_agent_relay.permission.resolve", {
  requestId: explicitReasoningRequest.requestId,
  approved: true,
  approvalId: "approval-pending-check",
  payloadHash: explicitReasoningRequest.details.payloadHash
});
assert.equal(resumedReasoning.ok, true);
assertPromptAuditEvidence(resumedReasoning);
assert.equal(
  resumedReasoning.data.events.some((event) => event.type === "reasoning_trace"),
  true
);

// 5) Transcript retention must use global ids / artifact refs only.
const retentionTurn = await runtime.store.createTurn({
  relaySessionId: writeSessionId,
  operationId: "acp_agent_relay.prompt.send",
  promptFingerprint: "fp-retention-1",
  effectiveMode: "ask"
});
const completionEvent = normalizer.completion({
  stopReason: "completed",
  outputSummary: "global-audit-only transcript reference",
  targetError: {
    code: "diagnostic",
    csrfToken: "nested-csrf-secret",
    apiKey: "nested-api-key-secret",
    headers: {
      authorization: "Bearer nested-bearer-secret",
      clientSecret: "nested-client-secret"
    }
  },
  receipts: [
    {
      action: "diagnostic",
      refreshToken: "nested-refresh-token-secret",
      nested: { accessToken: "nested-access-token-secret" }
    }
  ]
});
const retentionEvent = await runtime.store.recordEvent(retentionTurn.relayTurnId, {
  ...completionEvent,
  globalAuditId: "audit://acp/test/001",
  artifactRef: "artifact://acp/test/001"
});
assert.equal(retentionEvent.globalAuditId, "audit://acp/test/001");
assert.equal(retentionEvent.artifactRef, "artifact://acp/test/001");
assert.equal("rawTranscript" in retentionEvent.redactedPayload, false);
assert.equal("rawPrompt" in retentionEvent.redactedPayload, false);
const retentionPayloadText = JSON.stringify(retentionEvent.redactedPayload);
for (const forbidden of [
  "nested-csrf-secret",
  "nested-api-key-secret",
  "nested-bearer-secret",
  "nested-client-secret",
  "nested-refresh-token-secret",
  "nested-access-token-secret"
]) {
  assert.equal(retentionPayloadText.includes(forbidden), false);
}
assert.equal(retentionEvent.redactedPayload.targetError.csrfToken, "<redacted>");
assert.equal(retentionEvent.redactedPayload.targetError.apiKey, "<redacted>");
assert.equal(retentionEvent.redactedPayload.targetError.headers.authorization, "<redacted>");
assert.equal(retentionEvent.redactedPayload.receipts[0].refreshToken, "<redacted>");
assert.equal(retentionEvent.redactedPayload.receipts[0].nested.accessToken, "<redacted>");

const relayDir = new URL("../platform/specialized/capabilities/agent-relay/acp-agent-relay/", import.meta.url);
const relayFiles = await fs.readdir(relayDir);
const localRetentionCandidates = relayFiles.filter((name) => /transcript|retention/.test(name));
assert.equal(localRetentionCandidates.length, 0, "phase 0/1 should not introduce relay-local transcript-retention artifacts");

// 6) Policy/operation kernel: unknown virtual, revoked target, and ABAC denies fail closed.
const unknownSession = await runtime.execute("acp_agent_relay.session.create", {
  virtualAgentId: "agent.not-found",
  sourceId: "source-unknown",
  sourceSessionId: "unknown"
});
assert.equal(unknownSession.ok, false);
assert.equal(unknownSession.error.code, "virtual_agent_unknown");

const baseAuthorizationOperation = {
  id: "acp_agent_relay.prompt.send",
  requiredScopes: ["agent_relay:operate"],
  safety: {
    risk: "repair_write",
    readOnly: false,
    destructive: false,
    blocked: false,
    reason: "",
    resolveRisk: () => "repair_write"
  }
};
const subject = {
  allowedWorkspaceIds: [workspaceId],
  allowedDataClasses: ["public"],
  allowedEgress: ["internal"],
  scopes: ["agent_relay:operate"],
  maxRisk: "repair_write"
};
const allowedPolicy = evaluateAuthorizationPolicy({
  operation: baseAuthorizationOperation,
  subject,
  input: { workspaceId, dataClass: "public", requestedEgress: "internal" }
});
assert.equal(allowedPolicy.allowed, true);

const deniedWorkspacePolicy = evaluateAuthorizationPolicy({
  operation: baseAuthorizationOperation,
  subject,
  input: { workspaceId: "other-workspace", dataClass: "public", requestedEgress: "internal" }
});
assert.equal(deniedWorkspacePolicy.allowed, false);
assert.equal(deniedWorkspacePolicy.reasonCode, "workspace_not_allowed");

const deniedDataClassPolicy = evaluateAuthorizationPolicy({
  operation: baseAuthorizationOperation,
  subject,
  input: { workspaceId, dataClass: "private", requestedEgress: "internal" }
});
assert.equal(deniedDataClassPolicy.allowed, false);
assert.equal(deniedDataClassPolicy.reasonCode, "data_class_not_allowed");

const deniedEgressPolicy = evaluateAuthorizationPolicy({
  operation: baseAuthorizationOperation,
  subject,
  input: { workspaceId, dataClass: "public", requestedEgress: "internet" }
});
assert.equal(deniedEgressPolicy.allowed, false);
assert.equal(deniedEgressPolicy.reasonCode, "egress_not_allowed");

targetRegistry.upsertTarget({
  ...targetRegistry.getTarget(targetId),
  status: { ...targetRegistry.getTarget(targetId)?.status, enabled: false }
});
const revokedTargetSession = await runtime.execute("acp_agent_relay.session.create", {
  virtualAgentId: writableVirtualAgentId,
  sourceId: "source-write",
  sourceSessionId: "revoked-session"
});
assert.equal(revokedTargetSession.ok, false);
assert.equal(revokedTargetSession.error.code, "target_disabled");
targetRegistry.upsertTarget({
  ...targetRegistry.getTarget(targetId),
  enabled: true
});

// 7) File write policy: approval + receipt; denied virtual agent and denied paths fail closed.
const deniedPathWritePrompt = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createWriteSession.data.session.relaySessionId,
  prompt: "bad write",
  fileWrites: [
    {
      path: "../outside.txt",
      content: "nope",
      approval: {
        approved: true,
        approvalId: "approval-bad",
        payloadHash: hashPayloadForWrite("../outside.txt", "nope")
      }
    }
  ]
});
assert.equal(deniedPathWritePrompt.ok, true);
assert.equal(deniedPathWritePrompt.data.receipts[0].status, "denied");
assert.equal(deniedPathWritePrompt.data.receipts[0].reasonCode, "path_denied");

const readOnlyWriteAttempt = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createReadSession.data.session.relaySessionId,
  prompt: "ro write",
  fileWrites: [
    {
      path: "shared-allowed.txt",
      content: "read-only payload",
      approval: {
        approved: true,
        approvalId: "approval-ro",
        payloadHash: hashPayloadForWrite("shared-allowed.txt", "read-only payload")
      }
    }
  ]
});
assert.equal(readOnlyWriteAttempt.ok, true);
assert.equal(readOnlyWriteAttempt.data.receipts[0].status, "denied");
assert.equal(readOnlyWriteAttempt.data.receipts[0].reasonCode, "effective_policy_write_denied");

const approvedPayload = "approved payload";
const writeApproved = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createWriteSession.data.session.relaySessionId,
  prompt: "approved write",
  fileWrites: [
    {
      path: "shared-allowed.txt",
      content: approvedPayload,
      approval: {
        approved: true,
        approvalId: "approval-ok",
        payloadHash: hashPayloadForWrite("shared-allowed.txt", approvedPayload)
      }
    }
  ]
});
assert.equal(writeApproved.ok, true);
assert.equal(writeApproved.data.receipts[0].status, "completed");
assert.equal(await fs.readFile(allowedPathForWrites, "utf8"), approvedPayload);

const pendingWrite = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createWriteSession.data.session.relaySessionId,
  prompt: "pending approval",
  fileWrites: [
    {
      path: "shared-allowed.txt",
      content: "pending payload",
      approval: {
        approved: false,
        approvalId: "approval-pending",
        payloadHash: hashPayloadForWrite("shared-allowed.txt", "pending payload")
      }
    }
  ]
});
assert.equal(pendingWrite.ok, true);
assert.equal(pendingWrite.data.receipts[0].status, "pending_approval");

const idempotentConnection = connectionBySession.get(writeSessionId);
assert.ok(idempotentConnection);
const idempotentPromptCountBefore = idempotentConnection.sentPrompts.length;
const idempotentTurnsBefore = (await runtime.store.listTurns(writeSessionId)).length;
const idempotentPrompt = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createWriteSession.data.session.relaySessionId,
  prompt: "idempotent completed prompt",
  idempotencyKey: "verify-completed-idempotency"
});
assert.equal(idempotentPrompt.ok, true);
assert.equal(idempotentPrompt.data.stopReason, "completed");
assert.equal(idempotentPrompt.data.idempotencyReplay === true, false);
assert.equal(idempotentConnection.sentPrompts.length, idempotentPromptCountBefore + 1);

const idempotentReplay = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createWriteSession.data.session.relaySessionId,
  prompt: "idempotent completed prompt",
  idempotencyKey: "verify-completed-idempotency"
});
assert.equal(idempotentReplay.ok, true);
assert.equal(idempotentReplay.data.idempotencyReplay, true);
assert.equal(idempotentReplay.data.turn.relayTurnId, idempotentPrompt.data.turn.relayTurnId);
assert.equal(idempotentReplay.data.newEvents.length, 0);
assert.equal(idempotentConnection.sentPrompts.length, idempotentPromptCountBefore + 1);
assert.equal((await runtime.store.listTurns(writeSessionId)).length, idempotentTurnsBefore + 1);

const idempotentConflict = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createWriteSession.data.session.relaySessionId,
  prompt: "same key but different request",
  idempotencyKey: "verify-completed-idempotency"
});
assert.equal(idempotentConflict.ok, false);
assert.equal(idempotentConflict.error.code, "idempotency_key_conflict");
assert.equal(idempotentConnection.sentPrompts.length, idempotentPromptCountBefore + 1);
assert.equal((await runtime.store.listTurns(writeSessionId)).length, idempotentTurnsBefore + 1);

// 8) Terminal remains denied in Phase 1, regardless of explicit request.
const deniedTerminal = await runtime.execute("acp_agent_relay.prompt.send", {
  sessionId: createWriteSession.data.session.relaySessionId,
  prompt: "needs shell",
  terminal: { command: "rm -rf /tmp" },
  approval: { approved: true, approvalId: "approval-term-override", payloadHash: "override" }
});
assert.equal(deniedTerminal.ok, true);
assert.equal(
  deniedTerminal.data.events.some(
    (event) => event.type === "denial" && event.redactedPayload.reasonCode === "phase1_terminal_denied"
  ),
  true
);

// 9) MCP scope: only relay-scoped projection, no source MCP credential leak.
const toolCatalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
for (const operationId of publicAcpRelayToolOperationIds) {
  const tool = toolCatalog.tools.find((candidate) => candidate.operationId === operationId);
  assert.equal(Boolean(tool), true, `${operationId} must be exposed through the Pact agent relay toolset`);
  assert.equal(tool.toolsets.includes("pact.agent.relay"), true, `${operationId} must stay under pact.agent.relay`);
  assert.equal(
    KERNEL_TOOL_IDS.includes(tool.id),
    true,
    `${operationId} must be registered as an Authorization Kernel tool capability`
  );
  assert.equal(
    tool.requiredScopes.every((scope) => ["agent_relay:view", "agent_relay:operate"].includes(scope)),
    true,
    `${operationId} must not require scopes outside the agent relay boundary`
  );
}
assert.equal(
  toolCatalog.tools.some((tool) => tool.operationId === "acp_agent_relay.permission.resolve"),
  false,
  "internal ACP relay permission resolve operation must not be exposed as a Tool Management catalog tool"
);
const writeRoute = await runtime.router.resolveForSourceSession({
  virtualAgentId: writableVirtualAgentId,
  workspaceId,
  sourceId: "source-write",
  sourceSessionId: "write-session-2"
});
const effectiveRelayTools = writeRoute.route.decision.advertisedTools;
const projectedTools = projectByIds(toolCatalog, effectiveRelayTools);
const projectedToolIds = new Set(projectedTools.map((tool) => tool.id));
assert.equal([...effectiveRelayTools].filter((toolId) => projectedToolIds.has(toolId)).length > 0, true);
assert.equal(
  projectedTools.every((tool) => effectiveRelayTools.includes(tool.id)),
  true
);
assert.equal(
  projectedTools.some((tool) => tool.id === "pact.storage.write"),
  false,
  "source MCP write tool should not be projected unless explicitly advertised"
);
const boundaryMcpRoute = await runtime.router.resolveForSourceSession({
  virtualAgentId: writeVirtualReadOnlyTargetId,
  workspaceId,
  sourceId: "source-boundary",
  sourceSessionId: "boundary-mcp-session",
  sourceSubjectId: "boundary-subject",
  sourceIdentity: {
    sourceId: "source-boundary",
    sourceSessionId: "boundary-mcp-session",
    workspaceId,
    virtualAgentId: writeVirtualReadOnlyTargetId,
    sourceSubjectId: "boundary-subject",
    sourceMcpConfig: { servers: { secret: { command: "source-mcp-secret" } } },
    sourceMcpToken: "source-mcp-token-secret",
    upstreamToken: "upstream-token-secret",
    workspaceRoot: "/tmp/source-workspace-secret",
    transport: { csrfToken: "transport-secret" },
    csrfToken: "csrf-secret"
  }
});
assert.equal(boundaryMcpRoute.ok, true);
assert.equal(boundaryMcpRoute.route.virtualAgent.advertisedTools.includes("fs.writeTextFile"), true);
assert.equal(boundaryMcpRoute.route.decision.advertisedTools.includes("fs.writeTextFile"), false);
assert.deepEqual(boundaryMcpRoute.route.decision.advertisedTools, ["fs.readTextFile"]);
assert.deepEqual(boundaryMcpRoute.route.sourceIdentity, {
  sourceId: "source-boundary",
  sourceSessionId: "boundary-mcp-session",
  workspaceId,
  virtualAgentId: writeVirtualReadOnlyTargetId,
  sourceSubjectId: "boundary-subject"
});
for (const forbidden of [
  "sourceMcpConfig",
  "sourceMcpToken",
  "upstreamToken",
  "workspaceRoot",
  "source-mcp-secret",
  "source-mcp-token-secret",
  "upstream-token-secret",
  "transport-secret",
  "csrf-secret"
]) {
  assert.equal(JSON.stringify(boundaryMcpRoute.route).includes(forbidden), false);
}

assert.equal(
  connectionFactoryInputs.every(
    (entry) =>
      !Object.hasOwn(entry.route || {}, "sourceMcpConfig") &&
      !Object.hasOwn(entry.route || {}, "sourceMcpToken") &&
      !Object.hasOwn(entry.route || {}, "upstreamToken") &&
      !Object.hasOwn(entry.route || {}, "workspaceRoot") &&
      !Object.hasOwn(entry.route || {}, "transport") &&
      !Object.hasOwn(entry.route || {}, "csrfToken") &&
      !Object.hasOwn(entry.route?.sourceIdentity || {}, "sourceMcpConfig") &&
      !Object.hasOwn(entry.route?.sourceIdentity || {}, "sourceMcpToken") &&
      !Object.hasOwn(entry.route?.sourceIdentity || {}, "upstreamToken") &&
      !Object.hasOwn(entry.route?.sourceIdentity || {}, "workspaceRoot") &&
      !Object.hasOwn(entry.route?.sourceIdentity || {}, "transport") &&
      !Object.hasOwn(entry.route?.sourceIdentity || {}, "csrfToken")
  ),
  true
);
assert.equal(
  initializeInputs.every((item) => item.params.sourceToken === undefined && item.params.workspaceRoot === undefined),
  true
);

const internalDenied = await runtimeModule.executeAcpAgentRelayOperation(
  "acp_agent_relay.permission.resolve",
  {},
  { runtime }
);
assert.equal(internalDenied.ok, false);
assert.equal(internalDenied.error.code, "permission_request_required");

// 10) REST facade: /api/agent-relay/v1 is a Tool Management-mediated surface.
const httpUserDataPath = path.join(tempRoot, "http-user-data");
let httpPlatform = null;
const httpProvider = {
  handleToolManagementHttpRequest(args) {
    return httpPlatform.router.handleToolManagementHttpRequest(args);
  }
};
const httpControllers = {
  system: {
    async handleToolManagementPassthrough({ operation, request, response, requestBody, url, params = {} }) {
      const operationResult = await executeConsoleDomainOperation({
        operationId: operation?.id || "",
        input: {
          ...parseProtocolPayload(requestBody, url),
          ...(params && typeof params === "object" ? params : {})
        },
        context: {
          userDataPath: httpUserDataPath,
          workspaceRoot,
          request,
          response,
          requestBody,
          url,
          method: operation?.http?.method || request?.method || "GET",
          toolSkillManagementProvider: httpProvider
        }
      });
      if (operationResult.payload?.__responseHandled) {
        return;
      }
      response.writeHead(operationResult.status || 200, { "content-type": "application/json" });
      response.end(JSON.stringify(operationResult.payload ?? operationResult));
    }
  }
};
httpPlatform = createToolManagementPlatform({
  userDataPath: httpUserDataPath,
  operations: SERVER_API_OPERATIONS,
  controllers: httpControllers,
  securityPermissions: {
    evaluatePolicy() {
      return {
        effect: "allow",
        allowed: true,
        reasonCode: "verifier_allowed",
        redactedReason: "Allowed by ACP agent relay verifier.",
        missingScopes: [],
        missingToolsets: [],
        evaluatedLayers: ["verifier"],
        createdAt: nowIso(),
        effectivePolicySnapshot: {
          policyRevision: {
            protocolVersion: "pact.verifier.authorization.v1",
            revision: 1,
            updatedAt: nowIso()
          }
        }
      };
    },
    getGovernancePolicyRevision() {
      return {
        protocolVersion: "pact.verifier.authorization.v1",
        revision: 1,
        updatedAt: nowIso()
      };
    },
    appendDecision() {}
  },
  logger: {
    debug() {},
    info() {},
    warn() {},
    error() {}
  }
});

const { token: httpToken } = await httpPlatform.store.createGrant({
  label: "ACP Agent Relay HTTP verifier",
  toolsets: ["pact.agent.relay"],
  scopes: ["agent_relay:view", "agent_relay:operate"],
  maxRisk: "repair_write"
});

const httpList = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "GET",
  path: "/api/agent-relay/v1/virtual-agents"
});
assert.equal(httpList.status, 200);
assert.equal(httpList.payload.status, "ok");
assert.equal(httpList.payload.result.ok, true);
assert.equal(
  httpList.payload.result.data.virtualAgents.some((agent) => agent.virtualAgentId === "antigravity.multimodal-coding"),
  true
);

const httpCreate = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: "/api/agent-relay/v1/sessions",
  body: {
    virtualAgentId: "antigravity.multimodal-coding",
    sourceId: "codex-http",
    sourceSessionId: "http-source-session",
    workspaceId: "http-workspace"
  }
});
assert.equal(httpCreate.status, 200);
assert.equal(httpCreate.payload.status, "ok");
assert.equal(httpCreate.payload.result.ok, true);
const httpRelaySessionId = httpCreate.payload.result.data.session.relaySessionId;
assert.ok(httpRelaySessionId);

const httpPrompt = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpRelaySessionId)}/prompt`,
  headers: {
    "x-pact-safety-confirm": "true"
  },
  body: {
    prompt: "http delegated prompt",
    requestReasoning: true
  }
});
assert.equal(httpPrompt.status, 200);
assert.equal(httpPrompt.payload.status, "ok");
assert.equal(httpPrompt.payload.result.ok, true);
assertPromptAuditEvidence(httpPrompt.payload.result);
assert.equal(httpPrompt.payload.result.data.outputSummary.includes("http delegated prompt"), true);
assert.equal(
  httpPrompt.payload.result.data.events.some((event) => event.type === "reasoning_trace"),
  true
);

const httpTargets = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "GET",
  path: "/api/agent-relay/v1/targets"
});
assert.equal(httpTargets.status, 200);
assert.equal(httpTargets.payload.status, "ok");
assert.equal(httpTargets.payload.result.ok, true);
assert.equal(
  httpTargets.payload.result.data.targets.some((target) => target.targetId === "mock.antigravity:stdio"),
  true
);
assert.equal(JSON.stringify(httpTargets.payload.result.data.targets).includes("csrf"), false);
assert.equal(JSON.stringify(httpTargets.payload.result.data.targets).includes("binaryPath"), false);
assert.equal(JSON.stringify(httpTargets.payload.result.data.targets).includes("command"), false);

const httpSessions = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "GET",
  path: "/api/agent-relay/v1/sessions?sourceId=codex-http"
});
assert.equal(httpSessions.status, 200);
assert.equal(httpSessions.payload.status, "ok");
assert.equal(httpSessions.payload.result.ok, true);
assert.equal(httpSessions.payload.result.data.sessions.length, 1);
assert.equal(httpSessions.payload.result.data.sessions[0].relaySessionId, httpRelaySessionId);
assert.equal(httpSessions.payload.result.data.sessions[0].turnCount, 1);
assert.equal(httpSessions.payload.result.data.sessions[0].pendingPermissionCount, 0);

const httpSessionDetails = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "GET",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpRelaySessionId)}`
});
assert.equal(httpSessionDetails.status, 200);
assert.equal(httpSessionDetails.payload.status, "ok");
assert.equal(httpSessionDetails.payload.result.ok, true);
assert.equal(httpSessionDetails.payload.result.data.session.relaySessionId, httpRelaySessionId);
assert.equal(httpSessionDetails.payload.result.data.session.latestTurn.relayTurnId, httpPrompt.payload.result.data.turn.relayTurnId);
assert.equal(httpSessionDetails.payload.result.data.turns.length, 1);
assert.equal(
  httpSessionDetails.payload.result.data.turns[0].communicationSummary.relayTurnId,
  httpPrompt.payload.result.data.turn.relayTurnId
);

const httpTurns = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "GET",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpRelaySessionId)}/turns`
});
assert.equal(httpTurns.status, 200);
assert.equal(httpTurns.payload.status, "ok");
assert.equal(httpTurns.payload.result.ok, true);
assert.equal(httpTurns.payload.result.data.relaySessionId, httpRelaySessionId);
assert.equal(httpTurns.payload.result.data.turns.length, 1);
assert.equal(httpTurns.payload.result.data.turns[0].relayTurnId, httpPrompt.payload.result.data.turn.relayTurnId);

const httpTurnObserve = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpRelaySessionId)}/turns/${encodeURIComponent(httpPrompt.payload.result.data.turn.relayTurnId)}/observe`
});
assert.equal(httpTurnObserve.status, 200);
assert.equal(httpTurnObserve.payload.status, "ok");
assert.equal(httpTurnObserve.payload.result.ok, true);
assert.equal(httpTurnObserve.payload.result.data.observed, false);
assert.equal(httpTurnObserve.payload.result.data.reasonCode, "target_observation_unsupported");

const httpInternalResolve = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpRelaySessionId)}/permission/resolve`,
  body: {
    approved: true,
    approvalId: "verifier-should-not-be-usable"
  }
});
assert.equal(httpInternalResolve.status, 404);
assert.equal(
  JSON.stringify(httpInternalResolve.payload || {}).includes("acp_agent_relay.permission.resolve"),
  false,
  "HTTP permission resolve denial must not leak the internal operation id"
);

const persistedStorePath = path.join(httpUserDataPath, "agent-relay", "acp-relay-store.json");
const persistedStore = JSON.parse(await fs.readFile(persistedStorePath, "utf8"));
for (const permissionRequest of Object.values(persistedStore.permissionRequests || {})) {
  assert.equal(permissionRequest.details?.content, undefined);
  assert.equal(permissionRequest.details?.promptText, undefined);
  assert.equal(permissionRequest.details?.rawPrompt, undefined);
  assert.equal(permissionRequest.details?.rawResponse, undefined);
}
for (const turn of Object.values(persistedStore.turns || {})) {
  assert.equal(turn.metadata?.pendingPrompt?.promptText, undefined);
}
assert.equal(Boolean(persistedStore.sessions[httpRelaySessionId]), true);
const persistedTurn = Object.values(persistedStore.turns).find((turn) => turn.relaySessionId === httpRelaySessionId);
assert.equal(Boolean(persistedTurn), true);
assert.equal(persistedTurn.globalAuditId, httpPrompt.payload.result.data.audit.globalAuditId);
assert.equal(persistedTurn.artifactRef, httpPrompt.payload.result.data.audit.artifactRef);
assert.equal(
  (persistedStore.events[persistedTurn.relayTurnId] || []).every(
    (event) => event.globalAuditId === httpPrompt.payload.result.data.audit.globalAuditId
  ),
  true
);

const httpCloseCreate = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: "/api/agent-relay/v1/sessions",
  body: {
    virtualAgentId: "antigravity.multimodal-coding",
    sourceId: "codex-http-close",
    sourceSessionId: "http-close-source-session",
    workspaceId: "http-close-workspace"
  }
});
assert.equal(httpCloseCreate.status, 200);
assert.equal(httpCloseCreate.payload.status, "ok");
assert.equal(httpCloseCreate.payload.result.ok, true);
const httpCloseRelaySessionId = httpCloseCreate.payload.result.data.session.relaySessionId;
assert.ok(httpCloseRelaySessionId);

const httpPendingBeforeClose = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpCloseRelaySessionId)}/prompt`,
  headers: {
    "x-pact-safety-confirm": "true"
  },
  body: {
    prompt: "http verifier pending write before close",
    fileWrites: [{ path: "notes/http-verifier-pending-close.txt", content: "must not be written after close" }]
  }
});
assert.equal(httpPendingBeforeClose.status, 200);
assert.equal(httpPendingBeforeClose.payload.status, "ok");
assert.equal(httpPendingBeforeClose.payload.result.ok, true);
assert.equal(httpPendingBeforeClose.payload.result.data.stopReason, "approval_pending");
const httpPendingBeforeCloseRequest = httpPendingBeforeClose.payload.result.data.pendingPermissionRequests[0];
assert.equal(httpPendingBeforeCloseRequest.status, "pending");
await assert.rejects(
  fs.readFile(path.join(workspaceRoot, "notes", "http-verifier-pending-close.txt"), "utf8"),
  /ENOENT/
);

const httpClose = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpCloseRelaySessionId)}/close`
});
assert.equal(httpClose.status, 200);
assert.equal(httpClose.payload.status, "ok");
assert.equal(httpClose.payload.result.ok, true);
assert.equal(httpClose.payload.result.data.session.lifecycleState, "closed");
assert.equal(httpClose.payload.result.data.cancelledTurns.length, 1);
assert.equal(httpClose.payload.result.data.cancelledTurns[0].turn.stopReason, "cancelled");

const httpPromptAfterClose = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: `/api/agent-relay/v1/sessions/${encodeURIComponent(httpCloseRelaySessionId)}/prompt`,
  headers: {
    "x-pact-safety-confirm": "true"
  },
  body: {
    prompt: "must fail after HTTP close"
  }
});
assert.equal(httpPromptAfterClose.status, 400);
assert.equal(httpPromptAfterClose.payload.status, "failed");
assert.equal(httpPromptAfterClose.payload.result.ok, false);
assert.equal(httpPromptAfterClose.payload.result.error.code, "relay_session_closed");
assert.equal(httpPromptAfterClose.payload.result.error.details.lifecycleState, "closed");

const httpReadAfterClose = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: "/api/agent-relay/v1/fs/read-text-file",
  body: {
    sessionId: httpCloseRelaySessionId,
    path: "facts.txt"
  }
});
assert.equal(httpReadAfterClose.status, 400);
assert.equal(httpReadAfterClose.payload.status, "failed");
assert.equal(httpReadAfterClose.payload.result.ok, false);
assert.equal(httpReadAfterClose.payload.result.error.code, "relay_session_closed");
assert.equal(httpReadAfterClose.payload.result.error.details.lifecycleState, "closed");

const httpWriteAfterClose = await callAgentRelayHttp({
  platform: httpPlatform,
  token: httpToken,
  method: "POST",
  path: "/api/agent-relay/v1/fs/write-text-file",
  headers: {
    "x-pact-safety-confirm": "true"
  },
  body: {
    virtualAgentId: "antigravity.multimodal-coding",
    sourceId: "codex-http-close",
    sourceSessionId: "http-close-source-session",
    workspaceId: "http-close-workspace",
    path: "notes/http-verifier-after-close.txt",
    content: "must not be written after close"
  }
});
assert.equal(httpWriteAfterClose.status, 400);
assert.equal(httpWriteAfterClose.payload.status, "failed");
assert.equal(httpWriteAfterClose.payload.result.ok, false);
assert.equal(httpWriteAfterClose.payload.result.error.code, "relay_session_closed");
assert.equal(httpWriteAfterClose.payload.result.error.details.lifecycleState, "closed");
await assert.rejects(
  fs.readFile(path.join(workspaceRoot, "notes", "http-verifier-after-close.txt"), "utf8"),
  /ENOENT/
);

const persistedStoreAfterClose = JSON.parse(await fs.readFile(persistedStorePath, "utf8"));
assert.equal(
  persistedStoreAfterClose.permissionRequests[httpPendingBeforeCloseRequest.requestId].status,
  "cancelled"
);
assert.equal(
  persistedStoreAfterClose.permissionRequests[httpPendingBeforeCloseRequest.requestId].decisionId,
  "source-session-close"
);
httpPlatform.close();

const relayMcpScopeOutput = await runNodeVerifier(
  "server/scripts/verify-acp-agent-relay-mcp-scope.mjs",
  "ACP relay MCP scope verifier"
);
assert.match(
  relayMcpScopeOutput,
  /"ok":\s*true[\s\S]*"verifier":\s*"acp-agent-relay-mcp-scope"/,
  "Unified ACP relay verifier must execute the relay MCP scope verifier."
);

console.log("[acp-agent-relay] ok");

await fs.rm(tempRoot, { recursive: true, force: true });
