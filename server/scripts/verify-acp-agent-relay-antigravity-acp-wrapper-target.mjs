#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  ACP_METHODS,
  createRequest,
  parseJsonRpcMessage
} from "../platform/common/protocols/acp/index.mjs";
import {
  AntigravityAgentApiClient,
  observeAntigravityConversation,
  probeAntigravityIdeCliCapabilities,
  resolveAntigravityAgentApiBinary,
  waitForAntigravityConversationObservation
} from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import { buildAntigravityRelayProof } from "./acp-agent-relay-antigravity-proof.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const required = process.env.PACT_ACP_RELAY_ANTIGRAVITY_REQUIRED === "1";
const responseTimeoutMs = Number(process.env.PACT_ACP_RELAY_SOURCE_RESPONSE_TIMEOUT_MS || 300000);
const useDownstreamClientAspect = process.argv.includes("--downstream-client-aspect") ||
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_WRAPPER_DOWNSTREAM_ASPECT === "1";
const minimumWrapperProofLevel = asText(
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_WRAPPER_MIN_PROOF_LEVEL,
  "local_marker_observation"
);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function skip(message) {
  if (required) {
    throw new Error(message);
  }
  console.log(`[acp-agent-relay-antigravity-acp-wrapper-target] skipped: ${message}`);
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
  return {
    conversationRoot,
    conversations: envConversation
      ? [envConversation, ...candidates.filter((candidate) => candidate.filePath !== envPath)]
      : [
          { id: envConversationId, filePath: envPath, mtimeMs: 0, size: 0, missing: true },
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

function createOutputLineReader(stream, label = "stream") {
  const queue = [];
  const waiters = [];
  let buffer = "";
  stream.setEncoding("utf8");
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
    async receiveLine(waitMs = responseTimeoutMs) {
      if (queue.length > 0) {
        return queue.shift();
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label} line after ${waitMs}ms.`));
        }, waitMs);
        waiters.push((line) => {
          clearTimeout(timeout);
          resolve(line);
        });
      });
    }
  };
}

function spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId }) {
  const child = spawn(process.execPath, [path.join(repoRoot, "server/scripts/acp-agent-relay-source-stdio.mjs")], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(runtimeOptions),
      PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({ sourceId, workspaceId }),
      PACT_ACP_SOURCE_STDIO_STORE_PATH: storePath,
      PACT_ACP_SOURCE_ID: sourceId,
      PACT_ACP_WORKSPACE_ID: workspaceId
    }
  });
  const stdout = createOutputLineReader(child.stdout, "source ACP stdout");
  const stderr = createOutputLineReader(child.stderr, "source ACP stderr");
  return {
    child,
    stdout,
    stderr,
    async waitUntilReady() {
      const ready = JSON.parse(await stderr.receiveLine(30000));
      assert.equal(ready.event, "pact.acp.source_stdio.ready");
      assert.equal(ready.durableStore, true);
      return ready;
    },
    async request(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
      const notifications = [];
      for (let index = 0; index < 180; index += 1) {
        const raw = await stdout.receiveLine();
        const parsed = parseJsonRpcMessage(raw);
        if (parsed.method === ACP_METHODS.sessionUpdate) {
          notifications.push(parsed);
          continue;
        }
        assert.equal(parsed.id, message.id);
        Object.defineProperty(parsed, "notifications", {
          value: notifications,
          enumerable: false
        });
        return parsed;
      }
      throw new Error(`Timed out waiting for source ACP response ${String(message.id)}.`);
    }
  };
}

async function stopSourceServer(handle) {
  if (!handle) {
    return;
  }
  handle.child.stdin.end();
  if (handle.child.exitCode !== null || handle.child.signalCode) {
    return;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      handle.child.kill("SIGTERM");
      resolve();
    }, 5000);
    handle.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const conversation = await latestConversation();
if (!conversation?.id) {
  skip("no Antigravity conversation file found");
}
const binaryPath = await resolveAntigravityAgentApiBinary();
if (!binaryPath) {
  skip("Antigravity language server binary not found");
}
const endpoint = await discoverEndpoint({ conversationId: conversation.id, binaryPath }).catch((error) => {
  if (required) {
    throw error;
  }
  return null;
});
if (!endpoint) {
  skip("no reachable Antigravity Agent API endpoint found");
}
const ideCliCapabilitySnapshot = await probeAntigravityIdeCliCapabilities({
  env: process.env,
  timeoutMs: 3000
});
const beforeSnapshot = await listConversationFiles();
const before =
  beforeSnapshot.conversations.find((item) => item.filePath === conversation.filePath) ||
  (await statConversation(conversation.filePath).catch(() => null));
const marker = `PACT_ANTIGRAVITY_ACP_WRAPPER_TARGET_VERIFY_${Date.now()}`;
const beforeObservation = await observeAntigravityConversation({
  conversationId: conversation.id,
  marker
}).catch(() => null);
const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-antigravity-wrapper-workspace-"));
const storePath = path.join(workspaceRoot, "source-stdio-store.json");
const adapterScriptPath = path.join(repoRoot, "server/scripts/acp-agent-relay-antigravity-agentapi-acp-adapter.mjs");
const virtualAgentId = "antigravity.agentapi-acp-wrapper";
const targetId = "antigravity.agentapi-acp-wrapper:stdio";
const wrapperCommandEnv = {
  PACT_ANTIGRAVITY_AGENTAPI_ACP_ADAPTER_CONFIG_JSON: JSON.stringify({
    binaryPath,
    address: endpoint.address,
    csrfToken: endpoint.csrfToken,
    conversationId: conversation.id,
    model: "flash",
    timeoutMs: 120000
  })
};
const runtimeOptions = useDownstreamClientAspect
  ? {
      workspaceRoot,
      startDownstreamClientAspect: true,
      downstreamClientFrameworkOverrides: [
        {
          frameworkId: "antigravity",
          acp: {
            adapterId: "antigravity-agentapi-acp-stdio-wrapper",
            profileId: "pact.acp.antigravity.agentapi.wrapper",
            transport: "stdio",
            protocolStyle: "agent-client-protocol-v1",
            configurationStrategy: "pact-owned-agentapi-acp-wrapper",
            command: {
              executable: process.execPath,
              args: [adapterScriptPath],
              cwd: repoRoot,
              env: wrapperCommandEnv
            },
            target: {
              targetId,
              label: "Antigravity Agent API ACP stdio wrapper",
              externalServiceId: "external.antigravity.agentapi.acp-wrapper",
              capabilityPolicy: {
                writes: "deny",
                terminal: "deny",
                maxRisk: "read_only"
              }
            },
            virtualAgent: {
              virtualAgentId,
              displayName: "Antigravity Agent API ACP Wrapper",
              visibilityPolicy: "public"
            },
            defaultMode: "ask",
            advertisedModes: ["ask"],
            advertisedModalities: ["text"],
            advertisedDataSources: ["workspace.files"],
            advertisedTools: ["agentapi.sendMessage"],
            reasoningVisibilityPolicy: "never",
            metadata: {
              public: {
                verifier: "antigravity-agentapi-acp-wrapper-target",
                wrapper: "antigravity-agentapi-acp-stdio",
                nativeAntigravityAcp: false,
                endpointSource: endpoint.source
              },
              secret: "must-not-appear"
            }
          }
        }
      ]
    }
  : {
      workspaceRoot,
      startDownstreamClientAspect: false,
      virtualAgents: {
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.antigravity.agentapi.wrapper",
          displayName: "Antigravity Agent API ACP Wrapper",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedModalities: ["text"],
          advertisedDataSources: ["workspace.files"],
          advertisedTools: ["agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          metadata: {
            public: {
              verifier: "antigravity-agentapi-acp-wrapper-target",
              nativeAntigravityAcp: false
            }
          },
          revision: 1
        }
      },
      targets: {
        [targetId]: {
          targetId,
          label: "Antigravity Agent API ACP stdio wrapper",
          transport: {
            type: "stdio",
            protocolStyle: "agent-client-protocol-v1",
            timeoutMs: 120000,
            command: {
              executable: process.execPath,
              args: [adapterScriptPath],
              cwd: repoRoot,
              env: wrapperCommandEnv
            }
          },
          agentProfileId: "pact.acp.antigravity.agentapi.wrapper",
          externalServiceId: "external.antigravity.agentapi.acp-wrapper",
          enabled: true,
          revision: 1,
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          advertisedToolsets: ["agentapi.sendMessage"],
          metadata: {
            public: {
              wrapper: "antigravity-agentapi-acp-stdio",
              nativeAntigravityAcp: false,
              endpointSource: endpoint.source
            }
          }
        }
      }
    };

let sourceServer;
try {
  sourceServer = spawnSourceServer({
    runtimeOptions,
    storePath,
    sourceId: "antigravity-acp-wrapper-target-verifier",
    workspaceId: "antigravity-acp-wrapper-target-workspace"
  });
  const ready = await sourceServer.waitUntilReady();
  const initialize = await sourceServer.request(createRequest(
    ACP_METHODS.initialize,
    { virtualAgentId, sourceId: "antigravity-acp-wrapper-target-verifier" },
    "antigravity-wrapper-init"
  ));
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.targetId, targetId);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.transportType, "stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.protocolStyle, "agent-client-protocol-v1");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.metadata?.nativeAntigravityAcp, false);

	  const targetList = await sourceServer.request(createRequest(
	    ACP_METHODS.pactTargetList,
	    {},
	    "antigravity-wrapper-target-list"
	  ));
	  const targetDescriptor = (targetList.result?.targets || []).find((item) => item.targetId === targetId);
	  assert.ok(targetDescriptor, "source-facing target/list must expose the Antigravity ACP wrapper target.");
	  assert.equal(targetDescriptor.transport?.command, undefined);
	  assert.equal(targetDescriptor.metadata?.nativeAntigravityAcp, false);
  if (useDownstreamClientAspect) {
    assert.equal(targetDescriptor.metadata?.fromAspect, "downstream-client-aspect");
    assert.equal(targetDescriptor.metadata?.frameworkId, "antigravity");
    assert.equal(targetDescriptor.metadata?.adapterId, "antigravity-agentapi-acp-stdio-wrapper");
    assert.equal(targetDescriptor.metadata?.wrapper, "antigravity-agentapi-acp-stdio");
  }

  const agentList = await sourceServer.request(createRequest(
    ACP_METHODS.pactAgentList,
    {},
    "antigravity-wrapper-agent-list"
  ));
  const agentDescriptor = (agentList.result?.virtualAgents || agentList.result?.agents || [])
    .find((item) => item.virtualAgentId === virtualAgentId);
  assert.ok(agentDescriptor, "source-facing agent/list must expose the Antigravity ACP wrapper virtual agent.");
  assert.equal(agentDescriptor.targetId, targetId);
  assert.equal(agentDescriptor.metadata?.nativeAntigravityAcp, false);
  if (useDownstreamClientAspect) {
    assert.equal(agentDescriptor.metadata?.fromAspect, "downstream-client-aspect");
    assert.equal(agentDescriptor.metadata?.frameworkId, "antigravity");
    assert.equal(agentDescriptor.metadata?.adapterId, "antigravity-agentapi-acp-stdio-wrapper");
  }

  const session = await sourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      sourceSessionId: `antigravity-wrapper-${marker}`,
      virtualAgentId,
      mode: "ask"
    },
    "antigravity-wrapper-session-new"
  ));
  assert.equal(session.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "native_acp_stdio");

  const prompt = await sourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result?.sessionId,
      prompt: `${marker}: Pact outbound ACP stdio wrapper should deliver this prompt to Antigravity Agent API. 请只回复一句收到，不修改文件。`,
      requestReasoning: false,
      localObservationMarker: marker
    },
    "antigravity-wrapper-prompt"
  ));
  assert.equal(prompt.result?.targetEvidence?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(prompt.result?.targetEvidence?.finalResponseAvailable, false);
  assert.equal(prompt.result?.targetEvidence?.finalResponsePolicy, "accepted_only");
  assert.equal(prompt.result?.responseKind, "acknowledgement");
  assert.equal(prompt.result?.communicationSummary?.summaryKind, "acknowledgement");
  assert.equal(prompt.result?.targetEvidence?.targetAdapterProvider, "antigravity-agentapi-acp-stdio-wrapper");

  const observationTimeoutMs = Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_TIMEOUT_MS || 15000);
	  const localObservation = await waitForAntigravityConversationObservation({
	    conversationId: conversation.id,
	    marker,
	    afterTranscriptLineCount: beforeObservation?.transcriptLineCount || 0,
    afterMessageMtimeMs: beforeObservation?.latestMessageMtimeMs || 0,
    timeoutMs: Number.isFinite(observationTimeoutMs) ? observationTimeoutMs : 15000,
	    pollIntervalMs: 1000,
	    until: "message"
	  }).catch((error) => ({ error: error.message }));
  const changedConversation = await statConversation(conversation.filePath).catch(() => null);
	  const metadataProbe = await new AntigravityAgentApiClient({
	    binaryPath,
	    address: endpoint.address,
    csrfToken: endpoint.csrfToken
  }).getConversationMetadata(conversation.id).catch(() => null);
	  const proofResult = buildAntigravityRelayProof({
	    before,
	    changedConversation,
	    localObservation,
	    metadataProbe,
	    minimumProofLevel: minimumWrapperProofLevel
	  });
  assert.equal(proofResult.proofMeetsMinimum, true, JSON.stringify({ proofResult, localObservation }));

  const restarted = spawnSourceServer({
    runtimeOptions,
    storePath,
    sourceId: "antigravity-acp-wrapper-target-verifier",
    workspaceId: "antigravity-acp-wrapper-target-workspace"
  });
  const restartReady = await restarted.waitUntilReady();
  const load = await restarted.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: session.result?.sessionId,
      requestReasoning: false
    },
    "antigravity-wrapper-restart-load"
  ));
  const replayText = [
    JSON.stringify(load.result || {}),
    ...load.notifications.map((notification) => JSON.stringify(notification.params || {}))
  ].join("\n");
  assert.equal(replayText.includes("reasoning_trace"), false);
  await stopSourceServer(restarted);

  const close = await sourceServer.request(createRequest(
    ACP_METHODS.sessionClose,
    { sessionId: session.result?.sessionId },
    "antigravity-wrapper-close"
  ));
  assert.equal(close.result?.lifecycleState, "closed");

  console.log(JSON.stringify({
    ok: true,
    verifier: "acp-agent-relay-antigravity-acp-wrapper-target",
    marker,
    conversationId: conversation.id,
    endpoint: endpoint.address,
    endpointSource: endpoint.source,
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
	    sourceAcpReady: ready.event,
	    restartSourceAcpReady: restartReady.event,
    downstreamClientAspectAssemblyUsed: useDownstreamClientAspect,
	    outboundAcpWrapperProcessVerified: true,
	    adapterScriptPath,
    virtualAgentId,
    targetId,
    targetCommunicationMode: "antigravity_agentapi_acp_stdio_wrapper",
    sourceFacingTargetCommunicationMode: "native_acp_stdio",
    nativeAcpTargetSupported: true,
    nativeAcpTargetVerified: true,
    nativeAntigravityAcp: false,
	    antigravityAgentApiReached: true,
	    proofLevel: proofResult.proofLevel,
    minimumProofLevel: proofResult.minimumProofLevel,
	    proofMeetsMinimum: proofResult.proofMeetsMinimum,
    fileChanged: proofResult.fileChanged,
    markerObserved: proofResult.markerObserved,
    changedConversation,
	    localObservation,
    metadataProbe: metadataProbe ? "ok" : null,
    ideCliCapabilitySnapshot,
    relaySessionId: prompt.result?.session?.relaySessionId || session.result?.sessionId,
    relayTurnId: prompt.result?.turn?.relayTurnId,
    responseKind: prompt.result?.responseKind,
    summaryKind: prompt.result?.communicationSummary?.summaryKind,
	    targetDescriptorCommandRedacted: Boolean(targetDescriptor && !targetDescriptor.transport?.command),
    agentDiscoveryProof: {
      agentListed: Boolean(agentDescriptor),
      targetId: agentDescriptor?.targetId || "",
      fromAspect: agentDescriptor?.metadata?.fromAspect || "",
      frameworkId: agentDescriptor?.metadata?.frameworkId || "",
      adapterId: agentDescriptor?.metadata?.adapterId || "",
      nativeAntigravityAcp: agentDescriptor?.metadata?.nativeAntigravityAcp === true
    },
    targetDiscoveryProof: {
      targetListed: Boolean(targetDescriptor),
      targetDescriptorCommandRedacted: Boolean(targetDescriptor && !targetDescriptor.transport?.command),
      fromAspect: targetDescriptor?.metadata?.fromAspect || "",
      frameworkId: targetDescriptor?.metadata?.frameworkId || "",
      adapterId: targetDescriptor?.metadata?.adapterId || "",
      wrapper: targetDescriptor?.metadata?.wrapper || "",
      nativeAntigravityAcp: targetDescriptor?.metadata?.nativeAntigravityAcp === true
    },
	    restartSessionLoadProof: {
      sourceAcpReady: restartReady.event,
      relaySessionId: session.result?.sessionId,
      replayedUpdateCount: Number(load.result?.replayedUpdateCount || 0),
      replayNotificationCount: load.notifications.length,
      requestReasoning: false,
      reasoningTraceReplaySuppressed: !replayText.includes("reasoning_trace")
    },
	    proof: useDownstreamClientAspect
      ? "pact-downstream-client-aspect-to-antigravity-agentapi-acp-stdio-wrapper"
      : "pact-source-acp-to-antigravity-agentapi-acp-stdio-wrapper"
	  }, null, 2));
} finally {
  await stopSourceServer(sourceServer);
}
