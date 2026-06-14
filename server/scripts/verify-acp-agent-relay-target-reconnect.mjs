#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACP_METHODS,
  createRequest,
  parseJsonRpcMessage
} from "../platform/common/protocols/acp/index.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceResponseTimeoutMs = Number(process.env.PACT_ACP_RELAY_SOURCE_RESPONSE_TIMEOUT_MS || 120000);
const targetTimeoutMs = Number(process.env.PACT_ACP_RELAY_TARGET_RECONNECT_TIMEOUT_MS || 120000);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
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

async function readJsonlEvents(filePath) {
  return (await fs.readFile(filePath, "utf8").catch(() => ""))
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForJsonlEvent(filePath, predicate, { timeoutMs = 30000, pollMs = 50 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const events = await readJsonlEvents(filePath);
    const match = events.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for JSONL event in ${filePath}.`);
}

async function writeTargetReconnectScript(scriptPath) {
  await fs.writeFile(
    scriptPath,
    `
import fs from "node:fs";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const logPath = process.env.PACT_TARGET_RECONNECT_LOG_PATH || "";
const marker = process.env.PACT_TARGET_RECONNECT_MARKER || "PACT_TARGET_RECONNECT";
const pid = process.pid;
let promptCount = 0;
let currentTargetSessionId = "";
let currentTargetResumeRef = "";

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

function log(event) {
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify({ ...event, pid, at: new Date().toISOString() }) + "\\n", "utf8");
}

async function receive() {
  const next = await iterator.next();
  return next.done ? null : JSON.parse(next.value);
}

function textFromPrompt(value) {
  if (Array.isArray(value)) {
    return value.map((item) => textFromPrompt(item)).filter(Boolean).join("\\n");
  }
  if (value && typeof value === "object") {
    return String(value.text || value.content || value.message || "");
  }
  return String(value || "");
}

process.on("exit", (code) => {
  log({ event: "target_process_exit", code });
});

log({ event: "target_process_started" });

while (true) {
  const message = await receive();
  if (!message) break;
  if (message.method === "initialize") {
    log({
      method: message.method,
      id: message.id,
      relaySessionId: message.params?.relaySessionId || "",
      targetResumeRef: message.params?.targetResumeRef || ""
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "v0.0.1:strategy:target-acp-reconnect-1",
        capabilities: {
          session: ["new", "resume"],
          updates: ["progress"]
        }
      }
    });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    currentTargetSessionId = \`target-reconnect-session-\${pid}\`;
    currentTargetResumeRef = message.method === "session/resume"
      ? \`target-reconnect-resume-after-\${pid}\`
      : \`target-reconnect-resume-initial-\${pid}\`;
    log({
      method: message.method,
      id: message.id,
      relaySessionId: message.params?.relaySessionId || "",
      targetResumeRef: message.params?.targetResumeRef || message.params?.resumeRef || message.params?.sessionId ||
        message.params?._meta?.targetResumeRef || "",
      targetSessionId: currentTargetSessionId,
      nextTargetResumeRef: currentTargetResumeRef
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        targetSessionId: currentTargetSessionId,
        targetResumeRef: currentTargetResumeRef
      }
    });
  } else if (message.method === "session/prompt") {
    promptCount += 1;
    const promptText = textFromPrompt(message.params?.prompt || message.params?.text || message.params?.content);
    const promptOrdinal = /second/i.test(promptText) ? 2 : 1;
    log({
      method: message.method,
      id: message.id,
      relaySessionId: message.params?.relaySessionId || "",
      relayTurnId: message.params?._meta?.relayTurnId || "",
      targetSessionId: currentTargetSessionId,
      targetResumeRef: currentTargetResumeRef,
      promptOrdinal,
      promptPreview: promptText.slice(0, 120)
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        type: "progress",
        phase: promptOrdinal === 1 ? "first_target_process" : "resumed_target_process",
        text: \`target process \${pid} handled prompt \${promptOrdinal}\`
      }
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        stopReason: "completed",
        output: \`\${marker} prompt-\${promptOrdinal} completed by target process \${pid}\`,
        targetSessionId: currentTargetSessionId,
        targetResumeRef: currentTargetResumeRef,
        finalResponseAvailable: true,
        externalCompletionState: "completed",
        finalResponsePolicy: "target_acp_completion"
      }
    });
    if (promptOrdinal === 1) {
      log({
        event: "target_process_exit_after_first_prompt",
        targetSessionId: currentTargetSessionId,
        targetResumeRef: currentTargetResumeRef,
        promptCount
      });
      setTimeout(() => process.exit(0), 30);
    }
  } else {
    log({ method: message.method || "unknown", id: message.id || "" });
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "unsupported target reconnect verifier method" }
    });
  }
}
`,
    "utf8"
  );
}

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-target-reconnect-workspace-"));
const storePath = path.join(workspaceRoot, "source-stdio-store.json");
const targetScriptPath = path.join(workspaceRoot, "target-reconnect.mjs");
const targetLogPath = path.join(workspaceRoot, "target-reconnect.jsonl");
const marker = `PACT_TARGET_RECONNECT_VERIFY_${Date.now()}`;
const virtualAgentId = "stdio.target-reconnect";
const targetId = "stdio.target:reconnect";
const sourceId = "target-reconnect-verifier";
const sourceSessionId = `target-reconnect-${marker}`;
const workspaceId = "target-reconnect-workspace";
await writeTargetReconnectScript(targetScriptPath);

const runtimeOptions = {
  workspaceRoot,
  enableDownstreamClientAspect: false,
  targets: {
    [targetId]: {
      targetId,
      label: "ACP Stdio Reconnect Target",
      transport: {
        type: "stdio",
        protocolStyle: "agent-client-protocol-v1",
        timeoutMs: targetTimeoutMs,
        command: {
          executable: process.execPath,
          args: [targetScriptPath],
          cwd: workspaceRoot,
          timeoutMs: targetTimeoutMs,
          env: {
            PACT_TARGET_RECONNECT_LOG_PATH: targetLogPath,
            PACT_TARGET_RECONNECT_MARKER: marker
          }
        }
      },
      agentProfileId: "pact.acp.target_reconnect.real",
      enabled: true,
      externalServiceId: "external.acp.target-reconnect.real",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      advertisedToolsets: ["target.reconnect"]
    }
  },
  virtualAgents: {
    [virtualAgentId]: {
      virtualAgentId,
      targetId,
      profileId: "pact.acp.target_reconnect.real",
      displayName: "ACP Target Reconnect Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["target.reconnect"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      metadata: {
        public: {
          verifier: "target-reconnect"
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
    { virtualAgentId, sourceId, workspaceId },
    "target-reconnect-init"
  ));
  assert.equal(initialize.result?.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
  assert.equal(initialize.result?.virtualAgentId, virtualAgentId);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.transportType, "stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.protocolStyle, "agent-client-protocol-v1");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.nativeAcpTargetSupported, true);

  const session = await sourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId,
      workspaceId
    },
    "target-reconnect-session-new"
  ));
  assert.match(session.result?.sessionId || "", /^relay_session_/);

  const firstPrompt = await sourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: `${marker} first prompt before target process exit`,
      requestedMode: "ask",
      requestReasoning: false
    },
    "target-reconnect-first-prompt"
  ));
  assert.equal(firstPrompt.result?.responseKind, "final_response");
  assert.equal(firstPrompt.result?.communicationSummary?.summaryKind, "final_response");
  assert.equal(firstPrompt.result?.communicationSummary?.reasoningIncluded, false);
  assert.equal(firstPrompt.result?.targetEvidence?.transportType, "stdio");
  assert.equal(firstPrompt.result?.targetEvidence?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(firstPrompt.result?.targetEvidence?.finalResponseAvailable, true);
  assert.match(firstPrompt.result?.output || "", new RegExp(`${marker} prompt-1`));

  const firstExitMarker = await waitForJsonlEvent(
    targetLogPath,
    (event) => event.event === "target_process_exit_after_first_prompt"
  );
  await waitForJsonlEvent(
    targetLogPath,
    (event) => event.event === "target_process_exit" && event.pid === firstExitMarker.pid
  );
  await new Promise((resolve) => setTimeout(resolve, 300));

  const loadedBeforeResume = await sourceServer.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: session.result.sessionId,
      sourceId,
      sourceSessionId,
      workspaceId,
      virtualAgentId,
      requestReasoning: false
    },
    "target-reconnect-load-before-second-prompt"
  ));
  assert.equal(loadedBeforeResume.result?.relaySessionId, session.result.sessionId);
  assert.equal(loadedBeforeResume.result?.targetResumeRef, firstPrompt.result?.targetEvidence?.targetResumeRef);
  assert.equal(loadedBeforeResume.result?.pendingPermissionRequestCount, 0);

  const secondPrompt = await sourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: `${marker} second prompt after target process restart`,
      requestedMode: "ask",
      requestReasoning: false
    },
    "target-reconnect-second-prompt"
  ));
  assert.equal(secondPrompt.result?.responseKind, "final_response");
  assert.equal(secondPrompt.result?.communicationSummary?.summaryKind, "final_response");
  assert.equal(secondPrompt.result?.communicationSummary?.reasoningIncluded, false);
  assert.equal(secondPrompt.result?.targetEvidence?.transportType, "stdio");
  assert.equal(secondPrompt.result?.targetEvidence?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(secondPrompt.result?.targetEvidence?.finalResponseAvailable, true);
  assert.match(secondPrompt.result?.output || "", new RegExp(`${marker} prompt-2`));
  assert.equal(secondPrompt.result?.sessionId, session.result.sessionId);
  assert.notEqual(secondPrompt.result?.turnId, firstPrompt.result?.turnId);

  const targetEvents = await readJsonlEvents(targetLogPath);
  const processStartEvents = targetEvents.filter((event) => event.event === "target_process_started");
  const processPids = [...new Set(processStartEvents.map((event) => event.pid))];
  const sessionNewEvents = targetEvents.filter((event) => event.method === ACP_METHODS.sessionNew);
  const sessionResumeEvents = targetEvents.filter((event) => event.method === ACP_METHODS.sessionResume);
  const promptEvents = targetEvents.filter((event) => event.method === ACP_METHODS.sessionPrompt);
  const initializeEvents = targetEvents.filter((event) => event.method === ACP_METHODS.initialize);
  const secondPromptEvent = promptEvents.find((event) => event.promptOrdinal === 2);
  const resumeEvent = sessionResumeEvents[0];
  assert.equal(processPids.length >= 2, true, "Target reconnect proof must start a second target process.");
  assert.equal(initializeEvents.length >= 2, true, "Target reconnect proof must initialize the restarted target process.");
  assert.equal(sessionNewEvents.length, 1, "Target reconnect proof must create the target session once.");
  assert.equal(sessionResumeEvents.length, 1, "Target reconnect proof must resume the target session after target process restart.");
  assert.equal(promptEvents.length, 2, "Target reconnect proof must deliver both delegated prompts.");
  assert.equal(resumeEvent?.targetResumeRef, firstPrompt.result?.targetEvidence?.targetResumeRef);
  assert.equal(secondPromptEvent?.pid, processPids[1]);
  assert.notEqual(firstPrompt.result?.targetEvidence?.targetSessionId, secondPrompt.result?.targetEvidence?.targetSessionId);
  assert.notEqual(firstPrompt.result?.targetEvidence?.targetResumeRef, secondPrompt.result?.targetEvidence?.targetResumeRef);

  const loadedAfterResume = await sourceServer.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: session.result.sessionId,
      sourceId,
      sourceSessionId,
      workspaceId,
      virtualAgentId,
      requestReasoning: false
    },
    "target-reconnect-load-after-second-prompt"
  ));
  assert.equal(loadedAfterResume.result?.relaySessionId, session.result.sessionId);
  assert.equal(loadedAfterResume.result?.targetResumeRef, secondPrompt.result?.targetEvidence?.targetResumeRef);
  const sessionGetAfterResume = await sourceServer.request(createRequest(
    ACP_METHODS.pactSessionGet,
    {
      sessionId: session.result.sessionId,
      sourceId,
      sourceSessionId,
      workspaceId,
      virtualAgentId
    },
    "target-reconnect-get-after-second-prompt"
  ));
  assert.equal(sessionGetAfterResume.result?.session?.relaySessionId, session.result.sessionId);
  assert.equal(
    sessionGetAfterResume.result?.turns?.some((turn) => turn.relayTurnId === secondPrompt.result?.turnId),
    true,
    "_pact/session/get after target reconnect must expose the second turn."
  );
  const loadReplayText = JSON.stringify({
    result: loadedAfterResume.result,
    notifications: loadedAfterResume.notifications
  });
  assert.equal(
    loadReplayText.includes("reasoning_trace"),
    false,
    "session/load after target reconnect must not replay reasoning_trace when requestReasoning=false."
  );

  const close = await sourceServer.request(createRequest(
    ACP_METHODS.sessionClose,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId
    },
    "target-reconnect-close"
  ));
  assert.equal(close.result?.lifecycleState, "closed");

  const firstTargetSessionId = firstPrompt.result?.targetEvidence?.targetSessionId || "";
  const secondTargetSessionId = secondPrompt.result?.targetEvidence?.targetSessionId || "";
  const firstTargetResumeRef = firstPrompt.result?.targetEvidence?.targetResumeRef || "";
  const secondTargetResumeRef = secondPrompt.result?.targetEvidence?.targetResumeRef || "";
  const proof = {
    ok: true,
    verifier: "acp-agent-relay-target-reconnect",
    marker,
    relaySessionId: session.result.sessionId,
    firstRelayTurnId: firstPrompt.result?.turnId || "",
    secondRelayTurnId: secondPrompt.result?.turnId || "",
    virtualAgentId,
    targetId,
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    sourceAcpReady: ready.event,
    sourceAcpMethods: [
      ACP_METHODS.initialize,
      ACP_METHODS.sessionNew,
      ACP_METHODS.sessionPrompt,
      ACP_METHODS.sessionLoad,
      ACP_METHODS.pactSessionGet,
      ACP_METHODS.sessionClose
    ],
    targetTransportType: "stdio",
    targetCommunicationMode: "native_acp_stdio",
    nativeAcpTargetSupported: true,
    nativeAcpTargetVerified: true,
    targetReconnectProofAcceptable: true,
    firstPromptProof: {
      responseKind: firstPrompt.result?.responseKind || "",
      summaryKind: firstPrompt.result?.communicationSummary?.summaryKind || "",
      targetSessionId: firstTargetSessionId,
      targetResumeRef: firstTargetResumeRef,
      finalResponseAvailable: firstPrompt.result?.targetEvidence?.finalResponseAvailable === true,
      reasoningIncluded: firstPrompt.result?.communicationSummary?.reasoningIncluded === true
    },
    reconnectProof: {
      targetProcessRestartObserved: processPids.length >= 2,
      firstTargetProcessPid: processPids[0] || null,
      secondTargetProcessPid: processPids[1] || null,
      distinctTargetProcesses: processPids.length >= 2 && processPids[0] !== processPids[1],
      firstTargetExitObserved: targetEvents.some((event) => event.event === "target_process_exit" && event.pid === processPids[0]),
      targetResumeRefPersistedBeforeReconnect: loadedBeforeResume.result?.targetResumeRef === firstTargetResumeRef,
      targetSessionResumeUsed: sessionResumeEvents.length === 1,
      resumeTargetResumeRefMatchedFirst: resumeEvent?.targetResumeRef === firstTargetResumeRef,
      secondPromptDeliveredAfterResume: Boolean(secondPromptEvent && secondPromptEvent.pid === processPids[1]),
      sourceRelaySessionStable: secondPrompt.result?.sessionId === session.result.sessionId,
      distinctRelayTurns: secondPrompt.result?.turnId !== firstPrompt.result?.turnId,
      firstTargetSessionId,
      secondTargetSessionId,
      targetSessionChangedAfterReconnect: firstTargetSessionId !== secondTargetSessionId,
      firstTargetResumeRef,
      secondTargetResumeRef,
      targetResumeRefRefreshedAfterReconnect: firstTargetResumeRef !== secondTargetResumeRef,
      responseKind: secondPrompt.result?.responseKind || "",
      summaryKind: secondPrompt.result?.communicationSummary?.summaryKind || "",
      finalResponseAvailable: secondPrompt.result?.targetEvidence?.finalResponseAvailable === true,
      reasoningIncluded: secondPrompt.result?.communicationSummary?.reasoningIncluded === true,
      sessionLoadAfterReconnectVerified: loadedAfterResume.result?.targetResumeRef === secondTargetResumeRef,
      sessionGetAfterReconnectVerified: sessionGetAfterResume.result?.turns?.some((turn) =>
        turn.relayTurnId === secondPrompt.result?.turnId
      ) === true,
      reasoningTraceReplaySuppressed: loadReplayText.includes("reasoning_trace") === false
    },
    targetMethodProof: {
      methods: targetEvents
        .map((event) => event.method || event.event || "")
        .filter(Boolean),
      initializeCount: initializeEvents.length,
      targetProcessStartCount: processStartEvents.length,
      targetProcessPids: processPids,
      sessionNewCount: sessionNewEvents.length,
      sessionResumeCount: sessionResumeEvents.length,
      promptCount: promptEvents.length,
      usedSessionNew: sessionNewEvents.length === 1,
      usedSessionResumeAfterTargetRestart: sessionResumeEvents.length === 1,
      targetPromptCountAfterReconnect: promptEvents.length
    },
    proof: "pact-source-acp-to-stdio-target-reconnect-resume"
  };
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await stopSourceServer(sourceServer);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
