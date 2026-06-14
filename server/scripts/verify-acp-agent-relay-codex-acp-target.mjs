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

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceResponseTimeoutMs = Number(process.env.PACT_ACP_RELAY_SOURCE_RESPONSE_TIMEOUT_MS || 300000);
const targetTimeoutMs = Number(process.env.PACT_ACP_RELAY_CODEX_ACP_TARGET_TIMEOUT_MS || 300000);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function jsonContext(value) {
  return JSON.stringify(value, null, 2);
}

async function commandOutput(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    ...options
  });
  return asText(result.stdout || result.stderr);
}

async function readProjectCodexAcpPackageVersion() {
  const packageJsonPath = path.join(repoRoot, "node_modules", "@zed-industries", "codex-acp", "package.json");
  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    return asText(packageJson.version);
  } catch {
    return "";
  }
}

async function discoverCodexAcpAdapter() {
  const configured = asText(process.env.PACT_CODEX_ACP_PATH);
  const projectLocalPath = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "codex-acp.cmd" : "codex-acp");
  const localPath = configured ||
    await commandOutput("sh", ["-lc", `test -x ${JSON.stringify(projectLocalPath)} && printf %s ${JSON.stringify(projectLocalPath)}`]).catch(() => "") ||
    await commandOutput("sh", ["-lc", "command -v codex-acp"]).catch(() => "");
  if (localPath) {
    const helpText = await commandOutput(localPath, ["--help"]).catch((error) => asText(error.stdout || error.stderr || error.message));
    const adapterPackageVersion = await readProjectCodexAcpPackageVersion();
    return {
      adapterExecutable: localPath,
      adapterArgs: [],
      adapterInvocation: localPath === projectLocalPath ? "project-local-codex-acp" : "local-codex-acp",
      adapterInstalled: true,
      adapterInstallPackage: "@zed-industries/codex-acp",
      adapterPackageVersion,
      adapterHelpText: helpText
    };
  }
  const packageMetadataText = await commandOutput("npm", ["view", "@zed-industries/codex-acp", "version", "bin", "--json"])
    .catch(() => "");
  assert.ok(packageMetadataText, "@zed-industries/codex-acp package metadata must be available for installable ACP adapter proof.");
  const packageMetadata = JSON.parse(packageMetadataText);
  assert.equal(Boolean(packageMetadata.version), true, "@zed-industries/codex-acp package metadata must expose a version.");
  assert.equal(packageMetadata.bin?.["codex-acp"], "bin/codex-acp.js");
  const helpText = await commandOutput("npx", ["--yes", "@zed-industries/codex-acp", "--help"])
    .catch((error) => asText(error.stdout || error.stderr || error.message));
  assert.match(helpText, /codex-acp/i, "codex-acp adapter help must identify the adapter.");
  return {
    adapterExecutable: "npx",
    adapterArgs: ["--yes", "@zed-industries/codex-acp"],
    adapterInvocation: "npx-codex-acp",
    adapterInstalled: false,
    adapterInstallPackage: "@zed-industries/codex-acp",
    adapterPackageVersion: asText(packageMetadata.version),
    adapterHelpText: helpText
  };
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
    async receiveLine(waitMs = sourceResponseTimeoutMs) {
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
  const sourceStdioScriptPath = path.join(repoRoot, "server/scripts/acp-agent-relay-source-stdio.mjs");
  const child = spawn(process.execPath, [sourceStdioScriptPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(runtimeOptions),
      PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
        sourceId,
        workspaceId
      }),
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
      assert.equal(ready.storagePath, storePath);
      return ready;
    },
    async request(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
      const notifications = [];
      for (let index = 0; index < 100; index += 1) {
        const rawResponse = await stdout.receiveLine();
        assert.ok(rawResponse, "source ACP service must return a JSON-RPC frame.");
        const parsed = parseJsonRpcMessage(rawResponse);
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
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      handle.child.kill("SIGTERM");
      resolve();
    }, 5000);
    handle.child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`source ACP stdio server exited with code ${code}`));
      }
    });
  });
}

const adapter = await discoverCodexAcpAdapter();
const codexCliPath = await commandOutput("sh", ["-lc", "command -v codex"]).catch(() => "");
assert.ok(codexCliPath, "codex CLI must be available because codex-acp delegates to Codex.");
const codexCliVersion = await commandOutput(codexCliPath, ["--version"]).catch((error) => asText(error.message));
const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-codex-acp-target-workspace-"));
const storePath = path.join(workspaceRoot, "source-stdio-store.json");
const marker = `PACT_CODEX_ACP_TARGET_RELAY_VERIFY_${Date.now()}`;
const virtualAgentId = "codex.acp-real";
const targetId = "codex.acp:real";
const sourceId = "codex-acp-target-verifier";
const sourceSessionId = `codex-acp-target-${marker}`;
const workspaceId = "codex-acp-target-workspace";
const runtimeOptions = {
  workspaceRoot,
  enableDownstreamClientAspect: false,
  targets: {
    [targetId]: {
      targetId,
      label: "Codex ACP Real Target",
      transport: {
        type: "stdio",
        protocolStyle: "agent-client-protocol-v1",
        command: {
          executable: adapter.adapterExecutable,
          args: adapter.adapterArgs,
          cwd: workspaceRoot,
          timeoutMs: targetTimeoutMs,
          env: {
            CODEX_HOME: process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
          }
        }
      },
      agentProfileId: "pact.acp.codex.real",
      enabled: true,
      externalServiceId: "external.codex.acp.real",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      advertisedToolsets: ["codex.session"]
    }
  },
  virtualAgents: {
    [virtualAgentId]: {
      virtualAgentId,
      targetId,
      profileId: "pact.acp.codex.real",
      displayName: "Codex ACP Real Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["codex.session"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      metadata: {
        public: {
          verifier: "codex-acp-target"
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
    sourceId,
    workspaceId
  });
  const ready = await sourceServer.waitUntilReady();

  const initialize = await sourceServer.request(createRequest(
    ACP_METHODS.initialize,
    { virtualAgentId, sourceId },
    "codex-acp-target-init"
  ));
  assert.equal(initialize.result?.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
  assert.equal(initialize.result?.virtualAgentId, virtualAgentId);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.transportType, "stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.protocolStyle, "agent-client-protocol-v1");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.nativeAcpTargetSupported, true);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.nativeAcpTargetVerified, false);

  const session = await sourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId,
      workspaceId
    },
    "codex-acp-target-session-new"
  ));
  assert.match(session.result?.sessionId || "", /^relay_session_/);
  assert.equal(session.result?.capabilitiesSnapshot?.target?.transportType, "stdio");
  assert.equal(session.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(session.result?.capabilitiesSnapshot?.target?.nativeAcpTargetSupported, true);

  const prompt = await sourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: [
        `${marker}`,
        "You are the Codex ACP target in a Pact ACP Relay verification.",
        "Reply with exactly this marker and the word received. Do not edit files and do not run shell commands."
      ].join("\n"),
      requestedMode: "ask",
      requestReasoning: false
    },
    "codex-acp-target-prompt"
  ));
  assert.equal(prompt.result?.targetEvidence?.transportType, "stdio");
  assert.equal(prompt.result?.targetEvidence?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(prompt.result?.targetEvidence?.nativeAcpTargetSupported, true);
  assert.equal(prompt.result?.targetEvidence?.externalServiceId, "external.codex.acp.real");
  assert.equal(
    prompt.result?.targetEvidence?.externalCompletionState,
    "completed",
    `codex-acp target must complete the prompt: ${jsonContext(prompt.result?.targetEvidence)}`
  );
  assert.equal(
    prompt.result?.targetEvidence?.finalResponseAvailable,
    true,
    `codex-acp final response must be projected from ACP updates: ${jsonContext({
      result: prompt.result,
      notifications: prompt.notifications
    })}`
  );
  assert.equal(prompt.result?.targetEvidence?.targetError, null);
  assert.match(prompt.result.output || prompt.result.communicationSummary?.outputSummary || "", new RegExp(marker));
  assert.equal(prompt.result.responseKind, "final_response");
  assert.equal(prompt.result.communicationSummary.summaryKind, "final_response");
  assert.equal(prompt.result.communicationSummary.reasoningIncluded, false);
  assert.equal(prompt.result.communicationSummary.targetId, targetId);
  assert.equal(prompt.result.communicationSummary.finalResponseAvailable, true);
  const completionNotification = prompt.notifications.find((notification) => notification.params?.type === "completion");
  assert.ok(completionNotification);
  assert.equal(completionNotification.params?.responseKind, "final_response");

  const targets = await sourceServer.request(createRequest(
    ACP_METHODS.pactTargetList,
    {
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-acp-target-list-targets"
  ));
  const targetDescriptor = (targets.result?.targets || []).find((item) => item.targetId === targetId);
  assert.ok(targetDescriptor, "source-facing target/list must expose the Codex ACP target descriptor.");
  assert.equal(targetDescriptor.transportType, "stdio");
  assert.equal(targetDescriptor.protocolStyle, "agent-client-protocol-v1");
  assert.equal(targetDescriptor.targetCommunicationMode, "native_acp_stdio");
  assert.equal(targetDescriptor.nativeAcpTargetSupported, true);
  assert.equal(targetDescriptor.nativeAcpTargetVerified, false);
  assert.equal(targetDescriptor.externalServiceId, "external.codex.acp.real");
  assert.equal(Boolean(targetDescriptor.transport?.command), false, "source-facing target descriptors must not leak target launch command details.");

  const sessions = await sourceServer.request(createRequest(
    ACP_METHODS.pactSessionList,
    {
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-acp-target-list-sessions"
  ));
  const listedSession = (sessions.result?.sessions || []).find((item) => item.relaySessionId === session.result.sessionId);
  assert.ok(listedSession, "source-facing session/list must expose the active relay session.");
  assert.equal(listedSession.targetId, targetId);
  assert.equal(listedSession.latestTurn?.responseKind, "final_response");

  const sessionGet = await sourceServer.request(createRequest(
    ACP_METHODS.pactSessionGet,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-acp-target-get-session"
  ));
  assert.equal(sessionGet.result?.session?.relaySessionId, session.result.sessionId);
  assert.equal(sessionGet.result?.session?.latestTurn?.relayTurnId, prompt.result.turnId);
  assert.equal(sessionGet.result?.turns?.some((turn) => turn.relayTurnId === prompt.result.turnId), true);

  const turns = await sourceServer.request(createRequest(
    ACP_METHODS.pactTurnList,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-acp-target-list-turns"
  ));
  const listedTurn = (turns.result?.turns || []).find((item) => item.relayTurnId === prompt.result.turnId);
  assert.ok(listedTurn, "source-facing turn/list must expose the completed Codex ACP relay turn.");
  assert.equal(listedTurn.responseKind, "final_response");
  assert.equal(listedTurn.communicationSummary?.summaryKind, "final_response");

  const turnObserve = await sourceServer.request(createRequest(
    ACP_METHODS.pactTurnObserve,
    {
      sessionId: session.result.sessionId,
      relayTurnId: prompt.result.turnId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-acp-target-observe-turn"
  ));
  assert.equal(turnObserve.result?.relayTurnId, prompt.result.turnId);
  assert.equal(turnObserve.result?.observed, false);
  assert.equal(turnObserve.result?.reasonCode, "target_observation_unsupported");
  assert.equal(turnObserve.result?.responseKind, "final_response");
  assert.equal(turnObserve.result?.turn?.responseKind, "final_response");

  await stopSourceServer(sourceServer);
  sourceServer = spawnSourceServer({
    runtimeOptions,
    storePath,
    sourceId,
    workspaceId
  });
  const restartReady = await sourceServer.waitUntilReady();

  const restartInitialize = await sourceServer.request(createRequest(
    ACP_METHODS.initialize,
    {
      virtualAgentId,
      sourceId,
      workspaceId
    },
    "codex-acp-target-restart-init"
  ));
  assert.equal(restartInitialize.result?.virtualAgentId, virtualAgentId);

  const loaded = await sourceServer.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: session.result.sessionId,
      sourceId,
      sourceSessionId,
      workspaceId,
      virtualAgentId,
      requestReasoning: false
    },
    "codex-acp-target-restart-session-load"
  ));
  assert.equal(loaded.result?.relaySessionId, session.result.sessionId);
  assert.equal(loaded.result?.targetResumeRef, prompt.result.targetEvidence?.targetResumeRef || prompt.result.communicationSummary?.targetResumeRef || loaded.result?.targetResumeRef);
  assert.equal(loaded.result?.pendingPermissionRequestCount, 0);
  assert.ok(
    loaded.result?.replayedUpdateCount >= 1 || loaded.notifications.some((notification) => notification.method === ACP_METHODS.sessionUpdate),
    "session/load after source stdio restart must replay stored source-safe updates."
  );
  const loadReplayText = JSON.stringify({
    result: loaded.result,
    notifications: loaded.notifications
  });
  const loadReasoningTraceReplayed = loadReplayText.includes("reasoning_trace");
  assert.equal(
    loadReasoningTraceReplayed,
    false,
    "session/load after source stdio restart must not replay reasoning_trace when requestReasoning=false."
  );

  const restartSessions = await sourceServer.request(createRequest(
    ACP_METHODS.sessionList,
    {
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-acp-target-restart-list-sessions"
  ));
  assert.equal(
    restartSessions.result?.sessions?.some((item) => item.relaySessionId === session.result.sessionId),
    true,
    "session/list after source stdio restart must find the durable relay session."
  );

  const close = await sourceServer.request(createRequest(
    ACP_METHODS.sessionClose,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId
    },
    "codex-acp-target-close"
  ));
  assert.equal(close.result?.lifecycleState, "closed");

  console.log(JSON.stringify({
    ok: true,
    verifier: "acp-agent-relay-codex-acp-target",
    marker,
    codexCliPath,
    codexCliVersion,
    adapterExecutable: adapter.adapterExecutable,
    adapterArgs: adapter.adapterArgs,
    adapterInvocation: adapter.adapterInvocation,
    adapterInstalled: adapter.adapterInstalled,
    adapterInstallPackage: adapter.adapterInstallPackage,
    adapterPackageVersion: adapter.adapterPackageVersion || "",
    relaySessionId: session.result.sessionId,
    relayTurnId: prompt.result.turnId,
    virtualAgentId,
    targetId,
    transportType: prompt.result.targetEvidence.transportType,
    codexAcpTargetProcessVerified: true,
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    sourceAcpReady: ready.event,
    sourceAcpMethods: [
      ACP_METHODS.initialize,
      ACP_METHODS.sessionNew,
      ACP_METHODS.sessionPrompt,
      ACP_METHODS.pactTargetList,
      ACP_METHODS.pactSessionList,
      ACP_METHODS.pactSessionGet,
      ACP_METHODS.pactTurnList,
      ACP_METHODS.pactTurnObserve,
      ACP_METHODS.sessionLoad,
      ACP_METHODS.sessionClose
    ],
    sourceAcpOperationalMethodsVerified: true,
    sourceAcpSessionLoadAfterRestartVerified: true,
    operationalDiscoveryProof: {
      targetListed: Boolean(targetDescriptor),
      sessionListed: Boolean(listedSession),
      sessionGetMatchedTurn: sessionGet.result?.session?.latestTurn?.relayTurnId === prompt.result.turnId,
      turnListed: Boolean(listedTurn),
      turnObserveReasonCode: turnObserve.result?.reasonCode || "",
      targetDescriptorCommandRedacted: Boolean(targetDescriptor && !targetDescriptor.transport?.command),
      targetCommunicationMode: targetDescriptor?.targetCommunicationMode || "",
      nativeAcpTargetSupported: targetDescriptor?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerifiedByDiscovery: targetDescriptor?.nativeAcpTargetVerified === true
    },
    restartSessionLoadProof: {
      sourceAcpReady: restartReady.event,
      relaySessionId: loaded.result?.relaySessionId || "",
      targetResumeRef: loaded.result?.targetResumeRef || "",
      replayedUpdateCount: Number(loaded.result?.replayedUpdateCount || 0),
      replayNotificationCount: loaded.notifications.length,
      sessionListedAfterRestart: restartSessions.result?.sessions?.some((item) => item.relaySessionId === session.result.sessionId) === true,
      pendingPermissionRequestCount: Number(loaded.result?.pendingPermissionRequestCount || 0),
      requestReasoning: false,
      reasoningTraceReplaySuppressed: loadReasoningTraceReplayed === false
    },
    responseKind: prompt.result.responseKind,
    summaryKind: prompt.result.communicationSummary.summaryKind,
    communicationSummary: prompt.result.communicationSummary,
    sourceAcpResponseKindProjected: prompt.result.responseKind === prompt.result.communicationSummary.summaryKind,
    sourceAcpFinalResponseProjected: prompt.result.communicationSummary.finalResponseAvailable === true,
    finalResponseAvailable: prompt.result.targetEvidence.finalResponseAvailable,
    nativeCodexCliAcpSource: false,
    targetCommunicationMode: "codex_acp_stdio",
    nativeAcpTargetSupported: true,
    nativeAcpTargetVerified: true,
    proof: "pact-relay-to-real-codex-acp-stdio-target"
  }, null, 2));
} finally {
  await stopSourceServer(sourceServer);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
