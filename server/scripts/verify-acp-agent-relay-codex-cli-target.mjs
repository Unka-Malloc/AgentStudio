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
  ACP_METHODS,
  createRequest,
  parseJsonRpcMessage
} from "../platform/common/protocols/acp/index.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const timeoutMs = Number(process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_TIMEOUT_MS || 300000);
const sourceResponseTimeoutMs = Number(process.env.PACT_ACP_RELAY_SOURCE_RESPONSE_TIMEOUT_MS || 300000);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

async function commandOutput(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    ...options
  });
  return asText(result.stdout || result.stderr);
}

async function discoverCodexCli() {
  const configured = asText(process.env.PACT_CODEX_CLI_PATH);
  const codexCliPath = configured || await commandOutput("sh", ["-lc", "command -v codex"]).catch(() => "");
  assert.ok(codexCliPath, "codex CLI must be available on PATH for the Codex CLI target verifier.");
  const codexCliVersion = await commandOutput(codexCliPath, ["--version"]).catch((error) => asText(error.message));
  const fileBytes = await fs.readFile(codexCliPath);
  const codexCliSha256 = createHash("sha256").update(fileBytes).digest("hex");
  return { codexCliPath, codexCliVersion, codexCliSha256 };
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

const { codexCliPath, codexCliVersion, codexCliSha256 } = await discoverCodexCli();
const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-codex-cli-target-workspace-"));
const storePath = path.join(workspaceRoot, "source-stdio-store.json");
const marker = `PACT_CODEX_CLI_TARGET_RELAY_VERIFY_${Date.now()}`;
const virtualAgentId = "codex.cli-exec-real";
const targetId = "codex.cli:exec-real";
const sourceId = "codex-cli-target-verifier";
const sourceSessionId = `codex-cli-target-${marker}`;
const workspaceId = "codex-cli-target-workspace";
const runtimeOptions = {
  workspaceRoot,
  enableDownstreamClientAspect: false,
  targets: {
    [targetId]: {
      targetId,
      label: "Codex CLI Exec Real Target",
      transport: {
        type: "codex-cli-exec",
        command: {
          executable: codexCliPath,
          cwd: workspaceRoot,
          timeoutMs,
          sandbox: process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_SANDBOX || "read-only",
          ...(process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_MODEL
            ? { model: process.env.PACT_ACP_RELAY_CODEX_CLI_TARGET_MODEL }
            : {})
        }
      },
      agentProfileId: "pact.acp.codex_cli_exec.real",
      enabled: true,
      externalServiceId: "external.codex.cli.exec.real",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      advertisedToolsets: ["codex.exec"]
    }
  },
  virtualAgents: {
    [virtualAgentId]: {
      virtualAgentId,
      targetId,
      profileId: "pact.acp.codex_cli_exec.real",
      displayName: "Codex CLI Exec Real Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["codex.exec"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      metadata: {
        public: {
          verifier: "codex-cli-exec-target"
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
    "codex-cli-target-init"
  ));
  assert.equal(initialize.result?.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
  assert.equal(initialize.result?.virtualAgentId, virtualAgentId);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.transportType, "codex-cli-exec");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "codex_cli_exec_proxy");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.nativeAcpTargetSupported, false);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.nativeAcpTargetVerified, false);

  const session = await sourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId,
      workspaceId
    },
    "codex-cli-target-session-new"
  ));
  assert.match(session.result?.sessionId || "", /^relay_session_/);
  assert.equal(session.result?.capabilitiesSnapshot?.target?.transportType, "codex-cli-exec");
  assert.equal(session.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "codex_cli_exec_proxy");
  assert.equal(session.result?.capabilitiesSnapshot?.target?.nativeAcpTargetSupported, false);

  const prompt = await sourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: [
        `${marker}`,
        "You are the Codex CLI target in a Pact ACP Relay verification.",
        "Reply with exactly this marker and the word received. Do not edit files and do not run shell commands."
      ].join("\n"),
      requestedMode: "ask",
      requestReasoning: false
    },
    "codex-cli-target-prompt"
  ));
  assert.equal(prompt.result?.targetEvidence?.transportType, "codex-cli-exec");
  assert.equal(prompt.result?.targetEvidence?.targetCommunicationMode, "codex_cli_exec_proxy");
  assert.equal(prompt.result?.targetEvidence?.nativeAcpTargetSupported, false);
  assert.equal(prompt.result?.targetEvidence?.nativeAcpTargetVerified, false);
  assert.equal(prompt.result?.targetEvidence?.externalServiceId, "external.codex.cli.exec.real");
  assert.equal(prompt.result?.targetEvidence?.externalCompletionState, "completed");
  assert.equal(prompt.result?.targetEvidence?.finalResponseAvailable, true);
  assert.equal(prompt.result?.targetEvidence?.targetError, null);
  assert.deepEqual(
    new Set(prompt.result.targetEvidence.externalResponseKeys),
    new Set(["provider", "executable", "exitCode", "signal", "durationMs", "outputPath", "eventLogPath"])
  );
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
    "codex-cli-target-list-targets"
  ));
  const targetDescriptor = (targets.result?.targets || []).find((item) => item.targetId === targetId);
  assert.ok(targetDescriptor, "source-facing target/list must expose the Codex CLI exec target descriptor.");
  assert.equal(targetDescriptor.transportType, "codex-cli-exec");
  assert.equal(targetDescriptor.targetCommunicationMode, "codex_cli_exec_proxy");
  assert.equal(targetDescriptor.nativeAcpTargetSupported, false);
  assert.equal(targetDescriptor.nativeAcpTargetVerified, false);
  assert.equal(targetDescriptor.externalServiceId, "external.codex.cli.exec.real");
  assert.equal(Boolean(targetDescriptor.transport?.command), false, "source-facing target descriptors must not leak target launch command details.");

  const sessions = await sourceServer.request(createRequest(
    ACP_METHODS.pactSessionList,
    {
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-cli-target-list-sessions"
  ));
  const listedSession = (sessions.result?.sessions || []).find((item) => item.relaySessionId === session.result.sessionId);
  assert.ok(listedSession, "source-facing session/list must expose the active Codex CLI exec relay session.");
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
    "codex-cli-target-get-session"
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
    "codex-cli-target-list-turns"
  ));
  const listedTurn = (turns.result?.turns || []).find((item) => item.relayTurnId === prompt.result.turnId);
  assert.ok(listedTurn, "source-facing turn/list must expose the completed Codex CLI exec relay turn.");
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
    "codex-cli-target-observe-turn"
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
    "codex-cli-target-restart-init"
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
    "codex-cli-target-restart-session-load"
  ));
  assert.equal(loaded.result?.relaySessionId, session.result.sessionId);
  assert.equal(loaded.result?.pendingPermissionRequestCount, 0);
  assert.ok(
    loaded.result?.replayedUpdateCount >= 1 || loaded.notifications.some((notification) => notification.method === ACP_METHODS.sessionUpdate),
    "session/load after source stdio restart must replay stored source-safe Codex CLI exec updates."
  );
  const loadReplayText = JSON.stringify({
    result: loaded.result,
    notifications: loaded.notifications
  });
  const loadReasoningTraceReplayed = loadReplayText.includes("reasoning_trace");
  assert.equal(
    loadReasoningTraceReplayed,
    false,
    "session/load after source stdio restart must not replay reasoning_trace for Codex CLI exec when requestReasoning=false."
  );

  const restartSessions = await sourceServer.request(createRequest(
    ACP_METHODS.pactSessionList,
    {
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-cli-target-restart-list-sessions"
  ));
  const listedSessionAfterRestart = (restartSessions.result?.sessions || []).find((item) => item.relaySessionId === session.result.sessionId);
  assert.ok(listedSessionAfterRestart, "source-facing session/list after restart must find the durable Codex CLI exec relay session.");
  assert.equal(listedSessionAfterRestart.latestTurn?.responseKind, "final_response");

  const restartSessionGet = await sourceServer.request(createRequest(
    ACP_METHODS.pactSessionGet,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-cli-target-restart-get-session"
  ));
  assert.equal(restartSessionGet.result?.session?.relaySessionId, session.result.sessionId);
  assert.equal(restartSessionGet.result?.session?.latestTurn?.relayTurnId, prompt.result.turnId);
  assert.equal(restartSessionGet.result?.turns?.some((turn) => turn.relayTurnId === prompt.result.turnId), true);

  const restartTurns = await sourceServer.request(createRequest(
    ACP_METHODS.pactTurnList,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-cli-target-restart-list-turns"
  ));
  const listedTurnAfterRestart = (restartTurns.result?.turns || []).find((item) => item.relayTurnId === prompt.result.turnId);
  assert.ok(listedTurnAfterRestart, "source-facing turn/list after restart must find the completed Codex CLI exec relay turn.");
  assert.equal(listedTurnAfterRestart.responseKind, "final_response");

  const restartTurnObserve = await sourceServer.request(createRequest(
    ACP_METHODS.pactTurnObserve,
    {
      sessionId: session.result.sessionId,
      relayTurnId: prompt.result.turnId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "codex-cli-target-restart-observe-turn"
  ));
  assert.equal(restartTurnObserve.result?.relayTurnId, prompt.result.turnId);
  assert.equal(restartTurnObserve.result?.observed, false);
  assert.equal(restartTurnObserve.result?.reasonCode, "target_observation_unsupported");
  assert.equal(restartTurnObserve.result?.responseKind, "final_response");

  const close = await sourceServer.request(createRequest(
    ACP_METHODS.sessionClose,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId
    },
    "codex-cli-target-close"
  ));
  assert.equal(close.result?.lifecycleState, "closed");

  console.log(JSON.stringify({
    ok: true,
    verifier: "acp-agent-relay-codex-cli-target",
    marker,
    codexCliPath,
    codexCliVersion,
    codexCliSha256,
    relaySessionId: session.result.sessionId,
    relayTurnId: prompt.result.turnId,
    virtualAgentId,
    targetId,
    transportType: prompt.result.targetEvidence.transportType,
    targetCommunicationMode: prompt.result.targetEvidence.targetCommunicationMode,
    nativeAcpTargetSupported: prompt.result.targetEvidence.nativeAcpTargetSupported === true,
    nativeAcpTargetVerified: prompt.result.targetEvidence.nativeAcpTargetVerified === true,
    codexCliTargetProcessVerified: true,
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
      sessionListedAfterRestart: Boolean(listedSessionAfterRestart),
      sessionGetMatchedTurnAfterRestart: restartSessionGet.result?.session?.latestTurn?.relayTurnId === prompt.result.turnId,
      turnListedAfterRestart: Boolean(listedTurnAfterRestart),
      turnObserveReasonCodeAfterRestart: restartTurnObserve.result?.reasonCode || "",
      pendingPermissionRequestCount: Number(loaded.result?.pendingPermissionRequestCount || 0),
      requestReasoning: false,
      reasoningTraceReplaySuppressed: loadReasoningTraceReplayed === false
    },
    responseKind: prompt.result.responseKind,
    summaryKind: prompt.result.communicationSummary.summaryKind,
    communicationSummary: prompt.result.communicationSummary,
    sourceAcpResponseKindProjected: prompt.result.responseKind === prompt.result.communicationSummary.summaryKind,
    sourceAcpFinalResponseProjected: prompt.result.communicationSummary.finalResponseAvailable === true,
    externalResponseProjectedAsKeys: prompt.result.targetEvidence.externalResponseKeys,
    finalResponseAvailable: prompt.result.targetEvidence.finalResponseAvailable,
    nativeCodexCliAcpSource: false,
    proof: "pact-relay-to-real-codex-cli-exec-target"
  }, null, 2));
} finally {
  await stopSourceServer(sourceServer);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
