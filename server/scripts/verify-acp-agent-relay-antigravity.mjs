#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  AcpTargetRegistry,
  AcpVirtualAgentRegistry,
  createAcpRelayRuntime
} from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/index.mjs";
import {
  AntigravityAgentApiClient,
  observeAntigravityConversation,
  waitForAntigravityConversationObservation,
  probeAntigravityIdeCliCapabilities,
  resolveAntigravityAgentApiBinary
} from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import { buildAntigravityRelayProof } from "./acp-agent-relay-antigravity-proof.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const required = process.env.PACT_ACP_RELAY_ANTIGRAVITY_REQUIRED === "1";
const minimumProofLevel = asText(
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL,
  "local_marker_observation"
);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function skip(message) {
  if (required) {
    throw new Error(message);
  }
  console.log(`[acp-agent-relay-antigravity] skipped: ${message}`);
  process.exit(0);
}

async function run(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    ...options,
    maxBuffer: 4 * 1024 * 1024
  });
  return asText(result.stdout || result.stderr);
}

async function listAntigravityLanguageServers() {
  const output = await run("pgrep", ["-fl", "language_server_macos_arm"]).catch(() => "");
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid] = line.split(/\s+/, 1);
      return { pid, command: line };
    })
    .filter((processInfo) => /^\d+$/.test(processInfo.pid));
}

function workspaceFlagForRoot(root) {
  return `file_${root.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/g, "")}`;
}

function extractCsrfToken(commandLine = "") {
  return commandLine.match(/--csrf_token\s+(\S+)/)?.[1] || "";
}

async function listListenPorts(pid) {
  const output = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-p", String(pid)]).catch(() => "");
  const ports = new Set();
  for (const match of output.matchAll(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/g)) {
    ports.add(match[1]);
  }
  return [...ports].sort((a, b) => Number(a) - Number(b));
}

async function listConversationFiles() {
  const envConversationId = asText(
    process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONVERSATION_ID || process.env.ANTIGRAVITY_CONVERSATION_ID
  );
  const conversationRoot = path.join(os.homedir(), ".gemini/antigravity-ide/conversations");
  const entries = await fs.readdir(conversationRoot).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith(".pb")) {
      continue;
    }
    const filePath = path.join(conversationRoot, entry);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) {
      candidates.push({
        id: entry.replace(/\.pb$/u, ""),
        filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!envConversationId) {
    return { conversationRoot, conversations: candidates };
  }

  const envPath = path.join(conversationRoot, `${envConversationId}.pb`);
  const envConversation = candidates.find((candidate) => candidate.filePath === envPath);
  if (envConversation) {
    return {
      conversationRoot,
      conversations: [envConversation, ...candidates.filter((candidate) => candidate.filePath !== envPath)]
    };
  }

  return {
    conversationRoot,
    conversations: [
      {
        id: envConversationId,
        filePath: envPath,
        mtimeMs: 0,
        size: 0,
        missing: true
      },
      ...candidates
    ]
  };
}

async function latestConversation() {
  const snapshot = await listConversationFiles();
  return snapshot.conversations[0] || null;
}

async function statConversation(filePath) {
  const stat = await fs.stat(filePath);
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
}

async function discoverEndpoint({ conversationId, binaryPath }) {
  const envAddress = asText(process.env.PACT_ACP_RELAY_ANTIGRAVITY_LS_ADDRESS || process.env.ANTIGRAVITY_LS_ADDRESS);
  const envToken = asText(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN || process.env.ANTIGRAVITY_CSRF_TOKEN);
  if (envAddress && envToken) {
    const client = new AntigravityAgentApiClient({ binaryPath, address: envAddress, csrfToken: envToken });
    await client.getConversationMetadata(conversationId);
    return { address: envAddress, csrfToken: envToken, source: "env" };
  }

  const workspaceFlag = workspaceFlagForRoot(repoRoot);
  const servers = await listAntigravityLanguageServers();
  const ordered = [
    ...servers.filter((server) => server.command.includes(workspaceFlag)),
    ...servers.filter((server) => !server.command.includes(workspaceFlag))
  ];
  const seen = new Set();
  for (const server of ordered) {
    if (seen.has(server.pid)) {
      continue;
    }
    seen.add(server.pid);
    const csrfToken = extractCsrfToken(server.command);
    if (!csrfToken) {
      continue;
    }
    const ports = await listListenPorts(server.pid);
    for (const port of ports) {
      const address = `127.0.0.1:${port}`;
      const client = new AntigravityAgentApiClient({ binaryPath, address, csrfToken });
      const metadata = await client.getConversationMetadata(conversationId).catch(() => null);
      const workspaces = metadata?.response?.conversationMetadata?.metadata?.workspaces || [];
      const workspaceMatches = workspaces.some((workspace) =>
        asText(workspace.workspaceFolderAbsoluteUri).includes(repoRoot)
      );
      if (metadata && (workspaceMatches || server.command.includes(workspaceFlag))) {
        return { address, csrfToken, source: `pid:${server.pid}` };
      }
      if (metadata) {
        return { address, csrfToken, source: `pid:${server.pid}:fallback` };
      }
    }
  }
  return null;
}

async function waitForConversationChange(beforeSnapshot = [], timeoutMs = 45000) {
  const beforeByPath = new Map(
    beforeSnapshot.map((conversation) => [conversation.filePath, conversation])
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await listConversationFiles();
    for (const current of snapshot.conversations) {
      const previous = beforeByPath.get(current.filePath);
      if (!previous || current.mtimeMs > previous.mtimeMs || current.size > previous.size) {
        return { changedConversation: current, snapshot };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const snapshot = await listConversationFiles();
  for (const current of snapshot.conversations) {
    const previous = beforeByPath.get(current.filePath);
    if (!previous || current.mtimeMs > previous.mtimeMs || current.size > previous.size) {
      return { changedConversation: current, snapshot };
    }
  }
  return { changedConversation: null, snapshot };
}

const conversation = await latestConversation();
if (!conversation?.id) {
  skip("no Antigravity conversation file found");
}

const binaryPath = await resolveAntigravityAgentApiBinary();
if (!binaryPath) {
  skip("Antigravity language server binary not found");
}
const ideCliCapabilitySnapshot = await probeAntigravityIdeCliCapabilities({
  env: process.env,
  timeoutMs: 3000
});

const endpoint = await discoverEndpoint({ conversationId: conversation.id, binaryPath }).catch((error) => {
  if (required) {
    throw error;
  }
  return null;
});
if (!endpoint) {
  skip("no reachable Antigravity Agent API endpoint found");
}

const agentApiClient = new AntigravityAgentApiClient({
  binaryPath,
  address: endpoint.address,
  csrfToken: endpoint.csrfToken
});

const beforeSnapshot = await listConversationFiles();
const before =
  beforeSnapshot.conversations.find((item) => item.filePath === conversation.filePath) ||
  (await statConversation(conversation.filePath).catch(() => null));
const marker = `PACT_ACP_RELAY_REAL_VERIFY_${Date.now()}`;
const beforeObservation = await observeAntigravityConversation({
  conversationId: conversation.id,
  marker
}).catch(() => null);
const targetId = "antigravity.agentapi:local";
const virtualAgentId = "antigravity.agentapi-real";
const runtime = createAcpRelayRuntime({
  virtualAgentRegistry: new AcpVirtualAgentRegistry({
    [virtualAgentId]: {
      virtualAgentId,
      targetId,
      profileId: "pact.acp.antigravity.agentapi.real",
      displayName: "Antigravity Agent API Real Relay",
      advertisedModes: ["ask", "agent"],
      defaultMode: "agent",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["agentapi.sendMessage"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      revision: 1
    }
  }),
  targetRegistry: new AcpTargetRegistry({
    [targetId]: {
      targetId,
      label: "Local Antigravity Agent API",
      transport: {
        type: "antigravity-agentapi",
        address: endpoint.address,
        csrfToken: endpoint.csrfToken,
        binaryPath,
        conversationId: conversation.id,
        model: "flash",
        timeoutMs: 120000
      },
      agentProfileId: "pact.acp.antigravity.agentapi.real",
      externalServiceId: "external.antigravity.agentapi.local",
      enabled: true,
      revision: 1,
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      advertisedToolsets: ["agentapi.sendMessage"],
      metadata: {
        conversationId: conversation.id,
        endpointSource: endpoint.source
      }
    }
  }),
  workspaceRoot: repoRoot
});

const sessionResult = await runtime.execute("acp_agent_relay.session.create", {
  sourceId: "codex.verify",
  sourceSessionId: `codex-${marker}`,
  workspaceId: `file:${repoRoot}`,
  virtualAgentId,
  requestedMode: "ask"
});
assert.equal(sessionResult.ok, true);

const promptResult = await runtime.execute("acp_agent_relay.prompt.send", {
  relaySessionId: sessionResult.data.session.relaySessionId,
  prompt: `${marker}: 请只回复一句“收到 Pact ACP Relay 验证”，不要修改任何文件。`,
  requestReasoning: false
});
assert.equal(promptResult.ok, true);
assert.match(promptResult.data.stopReason, /^(accepted|completed)$/);
assert.ok(promptResult.data.turn?.relayTurnId);
assert.equal(promptResult.data.targetEvidence?.transportType, "antigravity-agentapi");
assert.equal(promptResult.data.targetEvidence?.targetCommunicationMode, "agent_api_proxy");
assert.equal(promptResult.data.targetEvidence?.nativeAcpTargetSupported, false);
assert.equal(promptResult.data.targetEvidence?.nativeAcpTargetVerified, false);
assert.equal(promptResult.data.targetEvidence?.externalServiceId, "external.antigravity.agentapi.local");
assert.equal(promptResult.data.targetEvidence?.externalAccepted, true);
assert.equal(promptResult.data.targetEvidence?.externalCompletionState, "accepted_only");
assert.equal(promptResult.data.targetEvidence?.finalResponseAvailable, false);
assert.equal(promptResult.data.targetEvidence?.finalResponsePolicy, "accepted_only");
assert.equal(promptResult.data.targetEvidence?.agentApiCapabilitySnapshot?.finalResponseReadSupported, false);
assert.equal(promptResult.data.targetEvidence?.agentApiCapabilitySnapshot?.commands?.sendMessage, true);
assert.equal(promptResult.data.targetEvidence?.agentApiCapabilitySnapshot?.commands?.waitForResponse, false);
assert.equal(promptResult.data.targetEvidence?.agentApiCapabilitySnapshot?.commands?.streamConversation, false);
assert.equal(promptResult.data.targetEvidence?.agentApiCapabilitySnapshot?.ideCli?.nativeAcpTransportSupported, false);
assert.equal(promptResult.data.targetEvidence?.agentApiCapabilitySnapshot?.ideCli?.nativeAcpTargetVerified, false);
assert.equal(ideCliCapabilitySnapshot.nativeAcpTransportSupported, false);
assert.equal(ideCliCapabilitySnapshot.nativeAcpTargetVerified, false);
assert.equal(ideCliCapabilitySnapshot.chatIsAcpTransport, false);
if (ideCliCapabilitySnapshot.found) {
  assert.equal(ideCliCapabilitySnapshot.chatCommandSupported, true);
}
assert.equal(
  promptResult.data.targetEvidence?.externalResponseKeys?.includes("sendMessage"),
  true,
  "Antigravity agentapi send-message response must be observed"
);
assert.equal(
  promptResult.data.events.some((event) => event.redactedPayload?.phase === "accepted"),
  true
);

const afterResult = await waitForConversationChange(beforeSnapshot.conversations, 8000);
const changedConversation = afterResult.changedConversation?.id === conversation.id
  ? afterResult.changedConversation
  : null;
const observationTimeoutMs = Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_TIMEOUT_MS || 15000);
const localObservation = await waitForAntigravityConversationObservation({
  conversationId: conversation.id,
  marker,
  afterTranscriptLineCount: beforeObservation?.transcriptLineCount || 0,
  afterMessageMtimeMs: beforeObservation?.latestMessageMtimeMs || 0,
  timeoutMs: Number.isFinite(observationTimeoutMs) ? observationTimeoutMs : 15000,
  pollIntervalMs: 1000,
  until: "message"
}).catch((error) => ({
  error: error.message
}));
const conversationReferences = [
  promptResult.data.session.targetResumeRef,
  promptResult.data.session.targetSessionId,
  conversation.id
].filter(Boolean);
let metadataProbe = null;
for (const conversationReference of conversationReferences) {
  metadataProbe = await agentApiClient.getConversationMetadata(conversationReference).catch(() => null);
  if (metadataProbe) {
    break;
  }
}
const proofResult = buildAntigravityRelayProof({
  before,
  changedConversation,
  localObservation,
  metadataProbe,
  minimumProofLevel
});
assert.ok(
  proofResult.ok,
  `Antigravity relay prompt must produce a target conversation state change or local marker observation. diagnostic=${JSON.stringify({
    changedConversation: afterResult.changedConversation
      ? {
          id: afterResult.changedConversation.id,
          filePath: afterResult.changedConversation.filePath,
          mtimeMs: afterResult.changedConversation.mtimeMs,
          size: afterResult.changedConversation.size
        }
      : null,
    localObservation,
    metadataProbe: metadataProbe ? "ok" : null
  })}`
);
assert.equal(
  proofResult.proofMeetsMinimum,
  true,
  `Antigravity relay proof must meet the configured minimum proof level. diagnostic=${JSON.stringify({
    proofLevel: proofResult.proofLevel,
    minimumProofLevel: proofResult.minimumProofLevel,
    proof: proofResult.proof,
    changedConversation: afterResult.changedConversation
      ? {
          id: afterResult.changedConversation.id,
          filePath: afterResult.changedConversation.filePath,
          mtimeMs: afterResult.changedConversation.mtimeMs,
          size: afterResult.changedConversation.size
        }
      : null,
    localObservation,
    metadataProbe: metadataProbe ? "ok" : null
  })}`
);
if (proofResult.fileChanged) {
  assert.equal(
    changedConversation.mtimeMs > before.mtimeMs || changedConversation.size > before.size,
    true,
    "Antigravity conversation file must change after relay prompt"
  );
}
assert.ok(metadataProbe, "Antigravity Agent API metadata probe should remain available as diagnostic evidence after relay prompt");

console.log(
  JSON.stringify(
    {
      ok: true,
      verifier: "acp-agent-relay-antigravity",
      marker,
      conversationId: conversation.id,
      endpoint: endpoint.address,
      endpointSource: endpoint.source,
      targetCommunicationMode: promptResult.data.targetEvidence?.targetCommunicationMode || "",
      nativeAcpTargetSupported: promptResult.data.targetEvidence?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: promptResult.data.targetEvidence?.nativeAcpTargetVerified === true,
      proof: proofResult.proof,
      proofLevel: proofResult.proofLevel,
      minimumProofLevel: proofResult.minimumProofLevel,
      proofMeetsMinimum: proofResult.proofMeetsMinimum,
      before,
      after: changedConversation,
      changedConversationFile: changedConversation?.filePath || null,
      localObservation,
      metadataProbe: proofResult.metadataProbeDiagnostic,
      agentApiCapabilitySnapshot: promptResult.data.targetEvidence?.agentApiCapabilitySnapshot || null,
      ideCliCapabilitySnapshot,
      targetEvidence: promptResult.data.targetEvidence,
      relaySessionId: promptResult.data.session.relaySessionId,
      relayTurnId: promptResult.data.turn.relayTurnId
    },
    null,
    2
  )
);
