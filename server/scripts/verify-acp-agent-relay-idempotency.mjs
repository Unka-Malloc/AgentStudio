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
const targetTimeoutMs = Number(process.env.PACT_ACP_RELAY_IDEMPOTENCY_TARGET_TIMEOUT_MS || 120000);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
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

async function writeTargetScript(scriptPath) {
  await fs.writeFile(
    scriptPath,
    `
import fs from "node:fs";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const logPath = process.env.PACT_IDEMPOTENCY_TARGET_LOG_PATH || "";

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

function log(event) {
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify({ ...event, at: new Date().toISOString() }) + "\\n", "utf8");
}

async function receive() {
  const next = await iterator.next();
  return next.done ? null : JSON.parse(next.value);
}

while (true) {
  const message = await receive();
  if (!message) break;
  if (message.method === "initialize") {
    log({ method: message.method, id: message.id });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "v0.0.1:strategy:target-acp-idempotency-1",
        capabilities: {
          session: ["new", "resume"],
          updates: ["progress"]
        }
      }
    });
  } else if (message.method === "session/new" || message.method === "session/resume") {
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
        targetSessionId: "target-idempotency-session",
        targetResumeRef: "target-idempotency-resume"
      }
    });
  } else if (message.method === "session/prompt") {
    const promptText = String(message.params?.prompt || "");
    log({
      method: message.method,
      id: message.id,
      promptText,
      parentRequestId: message.params?.pactParentRequestId || ""
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        type: "progress",
        phase: "idempotency_target_prompt_received",
        text: "idempotency target prompt received"
      }
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        stopReason: "completed",
        output: "idempotency target completed: " + promptText
      }
    });
  } else if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "unsupported idempotency verifier target method" }
    });
  }
}
`,
    "utf8"
  );
}

async function readTargetEvents(targetLogPath) {
  return (await fs.readFile(targetLogPath, "utf8").catch(() => ""))
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function turnCountFromStore(snapshot = {}, relaySessionId = "") {
  const turns = Object.values(snapshot.turns || {});
  return turns.filter((turn) => turn.relaySessionId === relaySessionId).length;
}

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-idempotency-workspace-"));
const storePath = path.join(workspaceRoot, "source-stdio-store.json");
const targetScriptPath = path.join(workspaceRoot, "target-idempotency.mjs");
const targetLogPath = path.join(workspaceRoot, "target-idempotency-events.jsonl");
const marker = `PACT_ACP_IDEMPOTENCY_VERIFY_${Date.now()}`;
const virtualAgentId = "target.idempotency-real";
const targetId = "target.idempotency:stdio";
const sourceId = "idempotency-verifier";
const sourceSessionId = `idempotency-${marker}`;
const workspaceId = "idempotency-workspace";
const idempotencyKey = `idempotency-key-${marker}`;
const promptText = `${marker}: complete exactly once.`;
const conflictPromptText = `${marker}: conflicting payload must not reach target.`;

await writeTargetScript(targetScriptPath);

const runtimeOptions = {
  workspaceRoot,
  enableDownstreamClientAspect: false,
  targets: {
    [targetId]: {
      targetId,
      label: "Idempotency Stdio Target",
      transport: {
        type: "stdio",
        command: {
          executable: process.execPath,
          args: [targetScriptPath],
          cwd: workspaceRoot,
          timeoutMs: targetTimeoutMs,
          env: {
            PACT_IDEMPOTENCY_TARGET_LOG_PATH: targetLogPath
          }
        }
      },
      agentProfileId: "pact.acp.idempotency.real",
      enabled: true,
      externalServiceId: "external.target.idempotency.real",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      advertisedToolsets: ["target.acp.prompt"]
    }
  },
  virtualAgents: {
    [virtualAgentId]: {
      virtualAgentId,
      targetId,
      profileId: "pact.acp.idempotency.real",
      displayName: "Idempotency Real Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["target.acp.prompt"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      metadata: {
        public: {
          verifier: "idempotency"
        }
      }
    }
  }
};

let firstSourceServer;
let secondSourceServer;
try {
  firstSourceServer = spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId });
  await firstSourceServer.waitUntilReady();

  const initialize = await firstSourceServer.request(createRequest(
    ACP_METHODS.initialize,
    { virtualAgentId, sourceId },
    "idempotency-init"
  ));
  assert.equal(initialize.result?.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.transportType, "stdio");

  const session = await firstSourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId,
      workspaceId
    },
    "idempotency-session-new"
  ));
  assert.match(session.result?.sessionId || "", /^relay_session_/);

  const firstPrompt = await firstSourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: promptText,
      requestedMode: "ask",
      requestReasoning: false,
      idempotencyKey
    },
    "idempotency-first-prompt"
  ));
  assert.equal(firstPrompt.result?.stopReason, "completed");
  assert.equal(firstPrompt.result?.responseKind, "final_response");
  assert.equal(firstPrompt.result?.communicationSummary?.summaryKind, "final_response");
  assert.equal(firstPrompt.result?.idempotencyReplay, false);
  assert.equal(firstPrompt.result?.communicationSummary?.reasoningIncluded, false);
  assert.match(firstPrompt.result?.output || "", /idempotency target completed/);

  const firstTargetEvents = await readTargetEvents(targetLogPath);
  const firstPromptEvents = firstTargetEvents.filter((event) => event.method === "session/prompt");
  assert.equal(firstPromptEvents.length, 1);
  assert.equal(firstPromptEvents[0]?.promptText, promptText);

  const storeAfterFirst = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(turnCountFromStore(storeAfterFirst, session.result.sessionId), 1);

  await stopSourceServer(firstSourceServer);
  firstSourceServer = null;

  secondSourceServer = spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId });
  await secondSourceServer.waitUntilReady();

  const restartInitialize = await secondSourceServer.request(createRequest(
    ACP_METHODS.initialize,
    { virtualAgentId, sourceId, workspaceId },
    "idempotency-restart-init"
  ));
  assert.equal(restartInitialize.result?.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");

  const loaded = await secondSourceServer.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      virtualAgentId,
      requestReasoning: false
    },
    "idempotency-load-after-restart"
  ));
  const loadedSessionId = loaded.result?.relaySessionId || loaded.result?.sessionId;
  assert.equal(loadedSessionId, session.result.sessionId);
  assert.equal(loaded.result?.pendingPermissionRequestCount, 0);

  const loadedSessionGet = await secondSourceServer.request(createRequest(
    ACP_METHODS.pactSessionGet,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "idempotency-session-get-after-restart"
  ));
  assert.equal(loadedSessionGet.result?.session?.relaySessionId, session.result.sessionId);
  assert.equal(loadedSessionGet.result?.turns?.some((turn) => turn.relayTurnId === firstPrompt.result.turnId), true);

  const loadedTurns = await secondSourceServer.request(createRequest(
    ACP_METHODS.pactTurnList,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      virtualAgentId
    },
    "idempotency-turn-list-after-restart"
  ));
  const loadedTurn = (loadedTurns.result?.turns || []).find((turn) => turn.relayTurnId === firstPrompt.result.turnId);
  assert.ok(loadedTurn, "source-facing turn/list after restart must find the first idempotent turn.");
  assert.equal(loadedTurn.responseKind, "final_response");

  const replayPrompt = await secondSourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: promptText,
      requestedMode: "ask",
      requestReasoning: false,
      idempotencyKey
    },
    "idempotency-replay-prompt"
  ));
  assert.equal(replayPrompt.result?.idempotencyReplay, true);
  assert.equal(replayPrompt.result?.turnId, firstPrompt.result.turnId);
  assert.equal(replayPrompt.result?.turn?.relayTurnId, firstPrompt.result.turnId);
  assert.equal(replayPrompt.result?.responseKind, "final_response");
  assert.equal(replayPrompt.result?.communicationSummary?.summaryKind, "final_response");
  assert.equal(replayPrompt.result?.communicationSummary?.relayTurnId, firstPrompt.result.turnId);
  assert.equal(replayPrompt.result?.communicationSummary?.targetSessionId, firstPrompt.result.communicationSummary?.targetSessionId);
  assert.equal(replayPrompt.result?.newEvents?.length || 0, 0);

  const targetEventsAfterReplay = await readTargetEvents(targetLogPath);
  const promptEventsAfterReplay = targetEventsAfterReplay.filter((event) => event.method === "session/prompt");
  assert.equal(promptEventsAfterReplay.length, 1);

  const storeAfterReplay = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(turnCountFromStore(storeAfterReplay, session.result.sessionId), 1);

  const conflict = await secondSourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: conflictPromptText,
      requestedMode: "ask",
      requestReasoning: false,
      idempotencyKey
    },
    "idempotency-conflict-prompt"
  ));
  assert.equal(Boolean(conflict.error), true);
  assert.equal(conflict.error?.data?.code, "idempotency_key_conflict");

  const targetEventsAfterConflict = await readTargetEvents(targetLogPath);
  const promptEventsAfterConflict = targetEventsAfterConflict.filter((event) => event.method === "session/prompt");
  assert.equal(promptEventsAfterConflict.length, 1);

  const storeAfterConflict = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(turnCountFromStore(storeAfterConflict, session.result.sessionId), 1);

  const proof = {
    ok: true,
    verifier: "acp-agent-relay-idempotency",
    marker,
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    targetTransportType: "stdio",
    relaySessionId: session.result.sessionId,
    relayTurnId: firstPrompt.result.turnId,
    idempotencyKey,
    idempotencyProofAcceptable: true,
    firstProof: {
      stopReason: firstPrompt.result.stopReason,
      responseKind: firstPrompt.result.responseKind,
      summaryKind: firstPrompt.result.communicationSummary?.summaryKind,
      idempotencyReplay: firstPrompt.result.idempotencyReplay === true,
      targetPromptCount: firstPromptEvents.length,
      turnCount: turnCountFromStore(storeAfterFirst, session.result.sessionId),
      reasoningIncluded: firstPrompt.result.communicationSummary?.reasoningIncluded === true
    },
    replayProof: {
      idempotencyReplay: replayPrompt.result.idempotencyReplay === true,
      sameTurn: replayPrompt.result.turnId === firstPrompt.result.turnId,
      responseKind: replayPrompt.result.responseKind,
      summaryKind: replayPrompt.result.communicationSummary?.summaryKind,
      targetPromptCountAfterReplay: promptEventsAfterReplay.length,
      turnCountAfterReplay: turnCountFromStore(storeAfterReplay, session.result.sessionId),
      newEventsCount: replayPrompt.result.newEvents?.length || 0,
      usedSourceRestart: loadedSessionId === session.result.sessionId
    },
    loadProof: {
      sourceRestartInitialized: restartInitialize.result?.pactProtocolVersion === "v0.0.1:agent:acp-agent-relay-1",
      relaySessionId: loadedSessionId,
      pendingPermissionRequestCount: Number(loaded.result?.pendingPermissionRequestCount || 0),
      sessionGetMatchedTurn: loadedSessionGet.result?.turns?.some((turn) => turn.relayTurnId === firstPrompt.result.turnId) === true,
      turnListMatchedTurn: Boolean(loadedTurn),
      turnListResponseKind: loadedTurn?.responseKind || ""
    },
    conflictProof: {
      conflictRejected: Boolean(conflict.error),
      errorCode: conflict.error?.data?.code || "",
      targetPromptCountAfterConflict: promptEventsAfterConflict.length,
      turnCountAfterConflict: turnCountFromStore(storeAfterConflict, session.result.sessionId)
    },
    targetMethodProof: {
      promptCount: promptEventsAfterConflict.length,
      methods: targetEventsAfterConflict.map((event) => event.method),
      targetNotReawakenedForReplay: promptEventsAfterReplay.length === firstPromptEvents.length,
      targetNotReawakenedForConflict: promptEventsAfterConflict.length === firstPromptEvents.length
    },
    proof: "pact-source-acp-stdio-idempotency-replay-and-conflict"
  };

  console.log(JSON.stringify(proof, null, 2));
} finally {
  await stopSourceServer(firstSourceServer);
  await stopSourceServer(secondSourceServer);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
