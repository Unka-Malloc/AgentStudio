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
const targetTimeoutMs = Number(process.env.PACT_ACP_RELAY_TARGET_CALLBACK_TIMEOUT_MS || 120000);

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
  const pendingResponses = new Map();
  async function receiveResponse(responseId, waitMs = sourceResponseTimeoutMs) {
    const expectedId = asText(responseId);
    if (pendingResponses.has(expectedId)) {
      const response = pendingResponses.get(expectedId);
      pendingResponses.delete(expectedId);
      return response;
    }
    const notifications = [];
    for (let index = 0; index < 100; index += 1) {
      const rawResponse = await stdout.receiveLine(waitMs);
      assert.ok(rawResponse, "source ACP service must return a JSON-RPC frame.");
      const parsed = parseJsonRpcMessage(rawResponse);
      if (parsed.method === ACP_METHODS.sessionUpdate) {
        notifications.push(parsed);
        continue;
      }
      Object.defineProperty(parsed, "notifications", {
        value: notifications.splice(0),
        enumerable: false
      });
      if (asText(parsed.id) === expectedId) {
        return parsed;
      }
      pendingResponses.set(asText(parsed.id), parsed);
    }
    throw new Error(`Timed out waiting for source ACP response ${expectedId}.`);
  }
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
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
    },
    receiveResponse,
    async request(message) {
      this.send(message);
      const response = await receiveResponse(message.id);
      assert.equal(response.id, message.id);
      return response;
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

async function writeTargetCallbackScript(scriptPath) {
  await fs.writeFile(
    scriptPath,
    `
import fs from "node:fs";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const logPath = process.env.PACT_TARGET_CALLBACK_APPROVAL_LOG_PATH || "";

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
        protocolVersion: "v0.0.1:strategy:target-acp-callback-approval-1",
        capabilities: {
          session: ["new", "resume"],
          fs: ["write_text_file"],
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
    if (message.method === "session/new") {
      log({
        method: "session/request_permission:orphan_parent_request",
        parentRequestId: "",
        toolCallId: "target-callback-orphan-parent-tool"
      });
      send({
        jsonrpc: "2.0",
        id: "target-callback-orphan-parent",
        method: "session/request_permission",
        params: {
          action: "command",
          target: "npm test",
          toolCallId: "target-callback-orphan-parent-tool"
        }
      });
      const orphan = await receive();
      log({
        method: "session/request_permission:orphan_parent_response",
        parentRequestId: "",
        errorCode: orphan?.error?.code || "",
        reasonCode: orphan?.error?.data?.reasonCode || ""
      });
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        targetSessionId: "target-callback-approval-session",
        targetResumeRef: "target-callback-approval-resume"
      }
    });
	  } else if (message.method === "session/prompt") {
	    const parentRequestId = message.params?.pactParentRequestId || "";
	    const promptText = String(message.params?.prompt || "");
	    const deny = /deny|denied|approval_denied/i.test(promptText);
	    const staleParent = /stale parent|parent_not_found/i.test(promptText);
	    const cancel = /cancel source prompt|source_session_cancel/i.test(promptText);
	    if (cancel) {
	      log({
	        method: message.method,
	        id: message.id,
	        parentRequestId,
	        promptPreview: promptText.slice(0, 120),
	        cancel
	      });
	      send({
	        jsonrpc: "2.0",
	        method: "session/update",
	        params: {
	          type: "progress",
	          phase: "target_prompt_waiting_for_cancel",
	          text: "target prompt is waiting for source cancel"
	        }
	      });
	      while (true) {
	        const nested = await receive();
	        if (!nested) break;
	        log({
	          method: nested.method || "response",
	          id: nested.id || "",
	          parentRequestId: nested.params?.pactParentRequestId || "",
	          relaySessionId: nested.params?.sessionId || nested.params?.relaySessionId || ""
	        });
	        if (nested.method === "session/cancel") {
	          send({
	            jsonrpc: "2.0",
	            id: nested.id,
	            result: {
	              ok: true,
	              cancelledAt: new Date().toISOString(),
	              targetSessionId: "target-callback-approval-session"
	            }
	          });
	          send({
	            jsonrpc: "2.0",
	            id: message.id,
	            result: {
	              stopReason: "completed",
	              output: "target completed after receiving source cancel"
	            }
	          });
	          break;
	        }
	      }
	      continue;
	    }
	    const writePath = deny
	      ? "notes/target-callback-denied.txt"
	      : staleParent
        ? "notes/target-callback-stale-parent.txt"
      : "notes/target-callback-approved.txt";
    const writeContent = deny
      ? "blocked target callback payload body"
      : staleParent
        ? "stale parent target callback payload body"
      : "approved target callback write";
    const toolCallId = deny
      ? "target-callback-deny-tool"
      : staleParent
        ? "target-callback-stale-parent-tool"
      : "target-callback-write-tool";
    const callbackParentRequestId = staleParent
      ? "stale-parent-request-not-found"
      : parentRequestId;
    log({
      method: message.method,
      id: message.id,
      parentRequestId,
      promptPreview: promptText.slice(0, 120),
      deny,
      staleParent
    });
    log({
      method: "fs/write_text_file:request",
      parentRequestId,
      callbackParentRequestId,
      path: writePath,
      toolCallId,
      deny,
      staleParent
    });
    send({
      jsonrpc: "2.0",
      id: deny ? "target-write-denial-1" : staleParent ? "target-write-stale-parent-1" : "target-write-approval-1",
      method: "fs/write_text_file",
      params: {
        path: writePath,
        content: writeContent,
        toolCallId,
        pactParentRequestId: callbackParentRequestId
      }
    });
    const write = await receive();
    log({
      method: "fs/write_text_file:response",
      parentRequestId,
      callbackParentRequestId,
      toolCallId,
      ok: write?.result?.ok === true,
      path: write?.result?.path || write?.result?.receipt?.path || "",
      errorCode: write?.error?.code || "",
      reasonCode: write?.error?.data?.reasonCode || ""
    });
    if (!write || write.error) {
      if (staleParent) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            stopReason: "completed",
            output: "target callback parent rejected: " + (write?.error?.data?.reasonCode || write?.error?.code || "unknown")
          }
        });
      }
      continue;
    }
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        type: "progress",
        phase: "callback_write_completed",
        text: "target callback write completed"
      }
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        stopReason: "completed",
        output: "target callback approval completed: " + (write.result?.path || write.result?.receipt?.path || "")
      }
    });
  } else if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "unsupported target callback verifier method" }
    });
  }
}
`,
    "utf8"
  );
}

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-target-callback-approval-workspace-"));
const storePath = path.join(workspaceRoot, "source-stdio-store.json");
const targetScriptPath = path.join(workspaceRoot, "target-callback-approval.mjs");
const targetLogPath = path.join(workspaceRoot, "target-callback-events.jsonl");
const marker = `PACT_TARGET_CALLBACK_APPROVAL_VERIFY_${Date.now()}`;
const virtualAgentId = "target.callback-approval-real";
const targetId = "target.callback-approval:stdio";
const sourceId = "target-callback-approval-verifier";
const sourceSessionId = `target-callback-approval-${marker}`;
const denialSourceSessionId = `target-callback-denial-${marker}`;
const staleParentSourceSessionId = `target-callback-stale-parent-${marker}`;
const cancelSourceSessionId = `target-callback-cancel-${marker}`;
const workspaceId = "target-callback-approval-workspace";
const approvedPath = path.join(workspaceRoot, "notes", "target-callback-approved.txt");
const deniedPath = path.join(workspaceRoot, "notes", "target-callback-denied.txt");
const staleParentPath = path.join(workspaceRoot, "notes", "target-callback-stale-parent.txt");
const deniedContent = "blocked target callback payload body";
const staleParentContent = "stale parent target callback payload body";

await writeTargetCallbackScript(targetScriptPath);

const runtimeOptions = {
  workspaceRoot,
  enableDownstreamClientAspect: false,
  targets: {
    [targetId]: {
      targetId,
      label: "Target Callback Approval Stdio Target",
      transport: {
        type: "stdio",
        command: {
          executable: process.execPath,
          args: [targetScriptPath],
          cwd: workspaceRoot,
          timeoutMs: targetTimeoutMs,
          env: {
            PACT_TARGET_CALLBACK_APPROVAL_LOG_PATH: targetLogPath
          }
        }
      },
      agentProfileId: "pact.acp.target_callback_approval.real",
      enabled: true,
      externalServiceId: "external.target.callback.approval.real",
      capabilityPolicy: {
        writes: "approval_required",
        terminal: "deny",
        maxRisk: "repair_write"
      },
      advertisedToolsets: ["target.acp.prompt", "fs.writeTextFile"]
    }
  },
  virtualAgents: {
    [virtualAgentId]: {
      virtualAgentId,
      targetId,
      profileId: "pact.acp.target_callback_approval.real",
      displayName: "Target Callback Approval Real Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["target.acp.prompt", "fs.writeTextFile"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "approval_required",
        terminal: "deny",
        maxRisk: "repair_write"
      },
      metadata: {
        public: {
          verifier: "target-callback-approval"
        }
      }
    }
  }
};

let firstSourceServer;
let secondSourceServer;
let thirdSourceServer;
let fourthSourceServer;
try {
  firstSourceServer = spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId });
  await firstSourceServer.waitUntilReady();

  const initialize = await firstSourceServer.request(createRequest(
    ACP_METHODS.initialize,
    { virtualAgentId, sourceId },
    "target-callback-approval-init"
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
    "target-callback-approval-session-new"
  ));
  assert.match(session.result?.sessionId || "", /^relay_session_/);
  assert.equal(session.result?.capabilitiesSnapshot?.target?.transportType, "stdio");

  const pending = await firstSourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: `${marker}: trigger target-originated write callback approval.`,
      requestedMode: "ask",
      requestReasoning: false
    },
    "target-callback-approval-prompt"
  ));
  assert.equal(pending.result?.stopReason, "approval_pending");
  assert.equal(pending.result?.responseKind, "approval_pending");
  assert.equal(pending.result?.communicationSummary?.summaryKind, "approval_pending");
  assert.equal(pending.result?.communicationSummary?.pendingPermissionRequestCount, 1);
  assert.equal(pending.result?.pendingPermissionRequests?.length, 1);
  assert.equal(pending.result?.pendingPermissionRequests?.[0]?.requestedAction, "fs.writeTextFile");
  assert.equal(pending.result?.pendingPermissionRequests?.[0]?.targetToolCallId, "target-callback-write-tool");
  assert.equal(pending.result?.pendingPermissionRequests?.[0]?.details?.path, "notes/target-callback-approved.txt");
  assert.equal(await fs.readFile(approvedPath, "utf8").catch(() => ""), "");

  const pendingRequest = pending.result.pendingPermissionRequests[0];
  const pendingNotifications = pending.notifications.map((notification) => ({
    type: notification.params?.type || "",
    phase: notification.params?.phase || "",
    responseKind: notification.params?.responseKind || ""
  }));
  assert.equal(pendingNotifications.some((notification) => notification.phase === "approval_pending"), true);

  await stopSourceServer(firstSourceServer);
  firstSourceServer = null;

  secondSourceServer = spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId });
  await secondSourceServer.waitUntilReady();

  const loadedPending = await secondSourceServer.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId
    },
    "target-callback-approval-load-pending"
  ));
  assert.equal(loadedPending.result?.sessionId, session.result.sessionId);
  assert.equal(loadedPending.result?.pendingPermissionRequestCount, 1);
  assert.equal(loadedPending.result?.pendingPermissionRequests?.[0]?.requestId, pendingRequest.requestId);

  const resumedPending = await secondSourceServer.request(createRequest(
    ACP_METHODS.sessionResume,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId,
      workspaceId
    },
    "target-callback-approval-resume-pending"
  ));
  assert.equal(resumedPending.result?.sessionId, session.result.sessionId);
  assert.equal(resumedPending.result?.lifecycleState, "approval_pending");
  assert.equal(resumedPending.result?.pendingPermissionRequestCount, 1);
  assert.equal(resumedPending.result?.pendingPermissionRequests?.[0]?.requestId, pendingRequest.requestId);

  const pendingObservation = await secondSourceServer.request(createRequest(
    ACP_METHODS.pactTurnObserve,
    {
      sessionId: session.result.sessionId,
      relayTurnId: pending.result.turnId,
      sourceId,
      workspaceId,
      includePendingPermissionRequests: true
    },
    "target-callback-approval-observe-pending"
  ));
  assert.equal(
    Boolean(pendingObservation.error),
    false,
    `pending turn observation must not fail: ${JSON.stringify(pendingObservation.error)}`
  );
  const pendingObservationTurnId = asText(
    pendingObservation.result?.relayTurnId ||
      pendingObservation.result?.turnId ||
      pendingObservation.result?.turn?.relayTurnId ||
      pendingObservation.result?.turnSummary?.relayTurnId
  );
  assert.equal(
    pendingObservationTurnId,
    pending.result.turnId,
    `pending turn observation must reference the same relay turn: ${JSON.stringify(pendingObservation.result)}`
  );
  assert.equal(pendingObservation.result?.observed, false);
  assert.equal(pendingObservation.result?.reasonCode, "target_observation_unsupported");
  assert.equal(pendingObservation.result?.turn?.relayTurnId, pending.result.turnId);
  assert.equal(pendingObservation.result?.turn?.responseKind, "approval_pending");
  assert.equal(pendingObservation.result?.turn?.communicationSummary?.relayTurnId, pending.result.turnId);
  assert.equal(pendingObservation.result?.turn?.communicationSummary?.summaryKind, "approval_pending");
  assert.equal(pendingObservation.result?.turn?.pendingPermissionRequests?.[0]?.requestId, pendingRequest.requestId);

  const resolved = await secondSourceServer.request(createRequest(
    ACP_METHODS.sessionRequestPermission,
    {
      sessionId: session.result.sessionId,
      requestId: pendingRequest.requestId,
      approved: true,
      approvalId: "target-callback-approval-real-verifier",
      payloadHash: pendingRequest.details.payloadHash
    },
    "target-callback-approval-resolve"
  ));
  assert.equal(
    Boolean(resolved.error),
    false,
    `source permission resolve must not fail: ${JSON.stringify(resolved.error)}`
  );
  assert.equal(resolved.result?.requestId, pendingRequest.requestId);
  assert.equal(resolved.result?.permissionRequest?.status, "completed");
  assert.equal(resolved.result?.turnId, pending.result.turnId);
  assert.equal(resolved.result?.stopReason, "completed");
  assert.equal(resolved.result?.responseKind, "final_response");
  assert.equal(resolved.result?.communicationSummary?.summaryKind, "final_response");
  assert.match(resolved.result?.output || "", /target callback approval completed/);
  assert.equal(await fs.readFile(approvedPath, "utf8"), "approved target callback write");
  assert.equal(resolved.result?.receipts?.some((receipt) => receipt.requestId === pendingRequest.requestId), true);
  assert.equal(
    resolved.notifications.some(
      (notification) => notification.params?.type === "completion" && notification.params?.responseKind === "final_response"
    ),
    true
  );

  await stopSourceServer(secondSourceServer);
  secondSourceServer = null;

  thirdSourceServer = spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId });
  await thirdSourceServer.waitUntilReady();

  const loadedCompleted = await thirdSourceServer.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId
    },
    "target-callback-approval-load-completed"
  ));
  assert.equal(loadedCompleted.result?.sessionId, session.result.sessionId);
  assert.equal(loadedCompleted.result?.pendingPermissionRequestCount, 0);

  const sessionGet = await thirdSourceServer.request(createRequest(
    ACP_METHODS.pactSessionGet,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId,
      includePendingPermissionRequests: true
    },
    "target-callback-approval-session-get"
  ));
  const completedTurn = sessionGet.result?.turns?.find((turn) => turn.relayTurnId === pending.result.turnId);
  assert.ok(completedTurn, "restarted source ACP session/get must expose the resumed relay turn.");
  assert.equal(completedTurn.responseKind, "final_response");
  assert.equal(completedTurn.communicationSummary?.summaryKind, "final_response");
  assert.equal(completedTurn.pendingPermissionCount, 0);
  assert.equal(completedTurn.permissionRequestCount >= 1, true);

  const storeSnapshot = JSON.parse(await fs.readFile(storePath, "utf8"));
  const storedRequest = storeSnapshot.permissionRequests?.[pendingRequest.requestId];
  assert.equal(storedRequest?.status, "completed");
  assert.equal(storedRequest?.relayTurnId, pending.result.turnId);
  assert.equal(storedRequest?.details?.receipt?.status, "completed");
  assert.equal(storedRequest?.details?.receipt?.path, "notes/target-callback-approved.txt");

  const denialSession = await thirdSourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId: denialSourceSessionId,
      workspaceId
    },
    "target-callback-denial-session-new"
  ));
  assert.match(denialSession.result?.sessionId || "", /^relay_session_/);
  assert.notEqual(denialSession.result?.sessionId, session.result.sessionId);

  const denialPending = await thirdSourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: denialSession.result.sessionId,
      prompt: `${marker}: trigger target-originated write callback and deny it.`,
      requestedMode: "ask",
      requestReasoning: false
    },
    "target-callback-denial-prompt"
  ));
  assert.equal(denialPending.result?.stopReason, "approval_pending");
  assert.equal(denialPending.result?.responseKind, "approval_pending");
  assert.equal(denialPending.result?.communicationSummary?.summaryKind, "approval_pending");
  assert.equal(denialPending.result?.pendingPermissionRequests?.length, 1);
  assert.equal(denialPending.result?.pendingPermissionRequests?.[0]?.requestedAction, "fs.writeTextFile");
  assert.equal(denialPending.result?.pendingPermissionRequests?.[0]?.targetToolCallId, "target-callback-deny-tool");
  assert.equal(denialPending.result?.pendingPermissionRequests?.[0]?.details?.path, "notes/target-callback-denied.txt");
  assert.equal(JSON.stringify(denialPending.result).includes(deniedContent), false);
  assert.equal(await fs.readFile(deniedPath, "utf8").catch(() => ""), "");

  const denialPendingRequest = denialPending.result.pendingPermissionRequests[0];
  const denialPendingNotifications = denialPending.notifications.map((notification) => ({
    type: notification.params?.type || "",
    phase: notification.params?.phase || "",
    responseKind: notification.params?.responseKind || ""
  }));
  assert.equal(denialPendingNotifications.some((notification) => notification.phase === "approval_pending"), true);

  await stopSourceServer(thirdSourceServer);
  thirdSourceServer = null;

  fourthSourceServer = spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId });
  await fourthSourceServer.waitUntilReady();

  const loadedDenialPending = await fourthSourceServer.request(createRequest(
    ACP_METHODS.sessionLoad,
    {
      sessionId: denialSession.result.sessionId,
      sourceId,
      workspaceId
    },
    "target-callback-denial-load-pending"
  ));
  assert.equal(loadedDenialPending.result?.sessionId, denialSession.result.sessionId);
  assert.equal(loadedDenialPending.result?.pendingPermissionRequestCount, 1);
  assert.equal(loadedDenialPending.result?.pendingPermissionRequests?.[0]?.requestId, denialPendingRequest.requestId);

  const resumedDenialPending = await fourthSourceServer.request(createRequest(
    ACP_METHODS.sessionResume,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId: denialSourceSessionId,
      workspaceId
    },
    "target-callback-denial-resume-pending"
  ));
  assert.equal(resumedDenialPending.result?.sessionId, denialSession.result.sessionId);
  assert.equal(resumedDenialPending.result?.lifecycleState, "approval_pending");
  assert.equal(resumedDenialPending.result?.pendingPermissionRequestCount, 1);
  assert.equal(resumedDenialPending.result?.pendingPermissionRequests?.[0]?.requestId, denialPendingRequest.requestId);

  const denied = await fourthSourceServer.request(createRequest(
    ACP_METHODS.sessionRequestPermission,
    {
      sessionId: denialSession.result.sessionId,
      requestId: denialPendingRequest.requestId,
      approved: false,
      approvalId: "target-callback-denial-real-verifier",
      reason: "source denied target callback write"
    },
    "target-callback-denial-resolve"
  ));
  assert.equal(
    Boolean(denied.error),
    false,
    `source permission denial must not fail: ${JSON.stringify(denied.error)}`
  );
  assert.equal(denied.result?.requestId, denialPendingRequest.requestId);
  assert.equal(denied.result?.permissionRequest?.status, "denied");
  assert.equal(denied.result?.turnId, denialPending.result.turnId);
  assert.equal(denied.result?.stopReason, "approval_denied");
  assert.equal(denied.result?.responseKind, "approval_denied");
  assert.equal(denied.result?.communicationSummary?.summaryKind, "approval_denied");
  assert.equal(JSON.stringify(denied.result).includes(deniedContent), false);
  assert.equal(await fs.readFile(deniedPath, "utf8").catch(() => ""), "");
  assert.equal(denied.notifications.some((notification) => notification.params?.type === "denial"), true);
  assert.equal(
    denied.notifications.some(
      (notification) => notification.params?.type === "completion" && notification.params?.phase === "approval_denied"
    ),
    true
  );

  const denialStoreSnapshot = JSON.parse(await fs.readFile(storePath, "utf8"));
  const deniedStoredRequest = denialStoreSnapshot.permissionRequests?.[denialPendingRequest.requestId];
  assert.equal(deniedStoredRequest?.status, "denied");
  assert.equal(deniedStoredRequest?.relayTurnId, denialPending.result.turnId);
  assert.equal(deniedStoredRequest?.details?.receipt?.status, "denied");
  assert.equal(deniedStoredRequest?.details?.receipt?.reasonCode, "approval_denied");
  assert.equal(deniedStoredRequest?.details?.receipt?.path, "notes/target-callback-denied.txt");
  assert.equal(JSON.stringify(deniedStoredRequest).includes(deniedContent), false);

  const staleParentSession = await fourthSourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId: staleParentSourceSessionId,
      workspaceId
    },
    "target-callback-stale-parent-session-new"
  ));
  assert.match(staleParentSession.result?.sessionId || "", /^relay_session_/);
  assert.notEqual(staleParentSession.result?.sessionId, session.result.sessionId);
  assert.notEqual(staleParentSession.result?.sessionId, denialSession.result.sessionId);

  const staleParentPrompt = await fourthSourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: staleParentSession.result.sessionId,
      prompt: `${marker}: trigger target-originated write callback with stale parent request id.`,
      requestedMode: "ask",
      requestReasoning: false
    },
    "target-callback-stale-parent-prompt"
  ));
  assert.equal(
    Boolean(staleParentPrompt.error),
    false,
    `stale parent prompt must complete after target callback parent rejection: ${JSON.stringify(staleParentPrompt.error)}`
  );
  assert.equal(staleParentPrompt.result?.responseKind, "final_response");
  assert.equal(staleParentPrompt.result?.communicationSummary?.summaryKind, "final_response");
  assert.match(staleParentPrompt.result?.output || "", /target callback parent rejected/);
  assert.equal(staleParentPrompt.result?.pendingPermissionRequests?.length || 0, 0);
  assert.equal(JSON.stringify(staleParentPrompt.result).includes(staleParentContent), false);
  assert.equal(await fs.readFile(staleParentPath, "utf8").catch(() => ""), "");

	  const parentBindingStoreSnapshot = JSON.parse(await fs.readFile(storePath, "utf8"));
	  const permissionRequestsAfterParentBinding = Object.values(parentBindingStoreSnapshot.permissionRequests || {});
	  assert.equal(permissionRequestsAfterParentBinding.length, 2);

	  const cancelSession = await fourthSourceServer.request(createRequest(
	    ACP_METHODS.sessionNew,
	    {
	      virtualAgentId,
	      sourceId,
	      sourceSessionId: cancelSourceSessionId,
	      workspaceId
	    },
	    "target-callback-cancel-session-new"
	  ));
	  assert.match(cancelSession.result?.sessionId || "", /^relay_session_/);
	  assert.notEqual(cancelSession.result?.sessionId, session.result.sessionId);
	  assert.notEqual(cancelSession.result?.sessionId, denialSession.result.sessionId);
	  assert.notEqual(cancelSession.result?.sessionId, staleParentSession.result.sessionId);

	  const cancelPromptRequest = createRequest(
	    ACP_METHODS.sessionPrompt,
	    {
	      sessionId: cancelSession.result.sessionId,
	      prompt: `${marker}: cancel source prompt while target ACP prompt is running.`,
	      requestedMode: "ask",
	      requestReasoning: false
	    },
	    "target-callback-cancel-prompt"
	  );
	  fourthSourceServer.send(cancelPromptRequest);
	  await waitForJsonlEvent(
	    targetLogPath,
	    (event) => event.method === "session/prompt" && event.cancel === true,
	    { timeoutMs: targetTimeoutMs }
	  );

	  const cancelResponse = await fourthSourceServer.request(createRequest(
	    ACP_METHODS.sessionCancel,
	    {
	      sessionId: cancelSession.result.sessionId,
	      sourceId,
	      sourceSessionId: cancelSourceSessionId,
	      workspaceId
	    },
	    "target-callback-session-cancel"
	  ));
	  assert.equal(Boolean(cancelResponse.error), false, `session/cancel must not fail: ${JSON.stringify(cancelResponse.error)}`);
	  assert.equal(cancelResponse.result?.cancel?.ok, true);
	  assert.equal(cancelResponse.result?.lifecycleState, "dormant");
	  assert.equal(cancelResponse.result?.cancelledTurns?.length, 1);
	  assert.equal(cancelResponse.result?.cancelledTurns?.[0]?.turn?.stopReason, "cancelled");
	  assert.equal(cancelResponse.result?.cancelledTurns?.[0]?.responseKind, "cancelled");

	  const targetCancelEvent = await waitForJsonlEvent(
	    targetLogPath,
	    (event) => event.method === "session/cancel" && event.relaySessionId === "target-callback-approval-session",
	    { timeoutMs: targetTimeoutMs }
	  );
	  assert.equal(targetCancelEvent.method, "session/cancel");

	  const cancelledPrompt = await fourthSourceServer.receiveResponse("target-callback-cancel-prompt", targetTimeoutMs);
	  assert.equal(Boolean(cancelledPrompt.error), false, `cancelled prompt must return a source result: ${JSON.stringify(cancelledPrompt.error)}`);
	  assert.equal(cancelledPrompt.result?.turnId, cancelResponse.result?.cancelledTurns?.[0]?.turn?.relayTurnId);
	  assert.equal(cancelledPrompt.result?.stopReason, "cancelled");
	  assert.equal(cancelledPrompt.result?.responseKind, "cancelled");
	  assert.equal(cancelledPrompt.result?.communicationSummary?.summaryKind, "cancelled");
	  assert.equal(cancelledPrompt.result?.communicationSummary?.reasoningIncluded, false);
	  assert.match(cancelledPrompt.result?.output || "", /cancelled by the source agent/);
	  assert.equal(JSON.stringify(cancelledPrompt.result).includes("target completed after receiving source cancel"), false);

	  const cancelLoaded = await fourthSourceServer.request(createRequest(
	    ACP_METHODS.sessionLoad,
	    {
	      sessionId: cancelSession.result.sessionId,
	      sourceId,
	      workspaceId
	    },
	    "target-callback-cancel-load"
	  ));
	  assert.equal(cancelLoaded.result?.sessionId, cancelSession.result.sessionId);
	  assert.equal(cancelLoaded.result?.lifecycleState, "dormant");
	  assert.equal(cancelLoaded.result?.pendingPermissionRequestCount, 0);

	  const cancelStoreSnapshot = JSON.parse(await fs.readFile(storePath, "utf8"));
	  const cancelledStoreTurn = Object.values(cancelStoreSnapshot.turns || {})
	    .find((turn) => turn.relayTurnId === cancelledPrompt.result.turnId);
	  assert.equal(cancelledStoreTurn?.status, "cancelled");
	  assert.equal(cancelledStoreTurn?.stopReason, "cancelled");
	  assert.equal(
	    Object.values(cancelStoreSnapshot.permissionRequests || {}).length,
	    permissionRequestsAfterParentBinding.length
	  );

	  const targetEvents = await readJsonlEvents(targetLogPath);
  const targetMethods = targetEvents.map((event) => event.method);
	  const promptEvents = targetEvents.filter((event) => event.method === "session/prompt");
	  const targetCancelEvents = targetEvents.filter((event) => event.method === "session/cancel");
	  const callbackRequestEvents = targetEvents.filter((event) => event.method === "fs/write_text_file:request");
	  const writeResponses = targetEvents.filter((event) => event.method === "fs/write_text_file:response");
	  const orphanParentResponses = targetEvents.filter((event) => event.method === "session/request_permission:orphan_parent_response");
	  const staleParentRequests = callbackRequestEvents.filter((event) => event.toolCallId === "target-callback-stale-parent-tool");
	  const staleParentResponses = writeResponses.filter((event) => event.toolCallId === "target-callback-stale-parent-tool");
  assert.equal(targetMethods.includes("session/new"), true);
  assert.equal(targetMethods.includes("session/resume"), true);
  assert.equal(promptEvents.length >= 3, true);
  assert.equal(writeResponses.some((event) => event.ok === true && event.path === "notes/target-callback-approved.txt"), true);
  assert.equal(
    callbackRequestEvents.some(
      (event) => event.path === "notes/target-callback-denied.txt" && event.toolCallId === "target-callback-deny-tool"
    ),
    true
  );
  assert.equal(promptEvents.every((event) => asText(event.parentRequestId).length > 0), true);
  assert.equal(
    writeResponses.some((event) =>
      promptEvents.some((promptEvent) => promptEvent.deny !== true && event.parentRequestId === promptEvent.parentRequestId)
    ),
    true
  );
  assert.equal(
    orphanParentResponses.some(
      (event) => Number(event.errorCode) === -32601 && event.reasonCode === "target_callback_parent_ambiguous"
    ),
    true
  );
  assert.equal(staleParentRequests.length, 1);
  assert.equal(staleParentRequests[0]?.callbackParentRequestId, "stale-parent-request-not-found");
  assert.equal(
    staleParentResponses.some(
      (event) =>
        event.toolCallId === "target-callback-stale-parent-tool" &&
        Number(event.errorCode) === -32601 &&
        event.reasonCode === "target_callback_parent_not_found"
    ),
    true
  );
	  assert.equal(
	    permissionRequestsAfterParentBinding.some((request) => request.details?.path === "notes/target-callback-stale-parent.txt"),
	    false
	  );
	  assert.equal(targetCancelEvents.length >= 1, true);
	  assert.equal(promptEvents.some((event) => event.cancel === true), true);

  const proof = {
    ok: true,
    verifier: "acp-agent-relay-target-callback-approval",
    marker,
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    targetTransportType: "stdio",
    targetCallbackApprovalProofAcceptable: true,
    sameTurn: resolved.result.turnId === pending.result.turnId,
    usedSessionResume: targetMethods.includes("session/resume"),
    storedRequestStatus: storedRequest?.status || "",
    relaySessionId: session.result.sessionId,
    relayTurnId: pending.result.turnId,
    requestId: pendingRequest.requestId,
    targetToolCallId: pendingRequest.targetToolCallId,
    pendingProof: {
      stopReason: pending.result.stopReason,
      responseKind: pending.result.responseKind,
      summaryKind: pending.result.communicationSummary?.summaryKind,
      pendingPermissionRequestCount: pending.result.communicationSummary?.pendingPermissionRequestCount,
      persistedAfterRestart: loadedPending.result?.pendingPermissionRequests?.[0]?.requestId === pendingRequest.requestId
    },
    pendingTurnObservationProof: {
      observed: pendingObservation.result.observed,
      reasonCode: pendingObservation.result.reasonCode,
      relayTurnId: pendingObservation.result.turn?.relayTurnId || "",
      responseKind: pendingObservation.result.turn?.responseKind || "",
      summaryKind: pendingObservation.result.turn?.communicationSummary?.summaryKind || "",
      requestId: pendingObservation.result.turn?.pendingPermissionRequests?.[0]?.requestId || ""
    },
    resolveProof: {
      stopReason: resolved.result.stopReason,
      responseKind: resolved.result.responseKind,
      summaryKind: resolved.result.communicationSummary?.summaryKind,
      sameTurn: resolved.result.turnId === pending.result.turnId,
      receiptCompleted: resolved.result.permissionRequest?.status === "completed",
      fileWritten: true
    },
    denialProof: {
      stopReason: denied.result.stopReason,
      responseKind: denied.result.responseKind,
      summaryKind: denied.result.communicationSummary?.summaryKind,
      sameTurn: denied.result.turnId === denialPending.result.turnId,
      pendingResponseKind: denialPending.result.responseKind,
      pendingSummaryKind: denialPending.result.communicationSummary?.summaryKind,
      pendingPersistedAfterRestart:
        loadedDenialPending.result?.pendingPermissionRequests?.[0]?.requestId === denialPendingRequest.requestId,
      sessionResumedAfterRestart: resumedDenialPending.result?.sessionId === denialSession.result.sessionId,
      permissionRequestStatus: denied.result.permissionRequest?.status,
      storedRequestStatus: deniedStoredRequest?.status || "",
      receiptReasonCode: deniedStoredRequest?.details?.receipt?.reasonCode || "",
      fileWritten: false,
      noContentLeak:
        !JSON.stringify(denialPending.result).includes(deniedContent) &&
        !JSON.stringify(denied.result).includes(deniedContent) &&
        !JSON.stringify(deniedStoredRequest).includes(deniedContent),
      deniedFilePath: "notes/target-callback-denied.txt",
      callbackRequestObserved: callbackRequestEvents.some(
        (event) => event.path === "notes/target-callback-denied.txt" && event.toolCallId === "target-callback-deny-tool"
      ),
      denialNotificationObserved: denied.notifications.some((notification) => notification.params?.type === "denial"),
      completionNotificationObserved: denied.notifications.some(
        (notification) => notification.params?.type === "completion" && notification.params?.phase === "approval_denied"
      )
    },
    restartProof: {
      sessionLoaded: loadedCompleted.result?.sessionId === session.result.sessionId,
      pendingPermissionRequestCount: loadedCompleted.result?.pendingPermissionRequestCount,
      turnRecovered: Boolean(completedTurn),
      responseKind: completedTurn.responseKind,
      summaryKind: completedTurn.communicationSummary?.summaryKind,
      storedRequestStatus: storedRequest?.status || ""
    },
	    parentBindingProof: {
	      parentRequestIdsBound: promptEvents.every((event) => asText(event.parentRequestId).length > 0),
      ambiguousRejected: orphanParentResponses.some(
        (event) => Number(event.errorCode) === -32601 && event.reasonCode === "target_callback_parent_ambiguous"
      ),
      ambiguousErrorCode: -32601,
      ambiguousReasonCode: "target_callback_parent_ambiguous",
      notFoundRejected: staleParentResponses.some(
        (event) =>
          event.toolCallId === "target-callback-stale-parent-tool" &&
          Number(event.errorCode) === -32601 &&
          event.reasonCode === "target_callback_parent_not_found"
      ),
      notFoundErrorCode: -32601,
      notFoundReasonCode: "target_callback_parent_not_found",
      staleParentRequestId: "stale-parent-request-not-found",
      rejectedFileWritten: false,
      callbackHandlerInvoked: false,
      noRelaySideEffect:
        permissionRequestsAfterParentBinding.length === 2 &&
        staleParentPrompt.result?.pendingPermissionRequests?.length !== 1 &&
        !(await fs.readFile(staleParentPath, "utf8").catch(() => "")) &&
        !permissionRequestsAfterParentBinding.some((request) => request.details?.path === "notes/target-callback-stale-parent.txt") &&
        !JSON.stringify(staleParentPrompt.result).includes(staleParentContent),
      permissionRequestCountAfterRejectedCallbacks: permissionRequestsAfterParentBinding.length,
      expectedPermissionRequestCount: 2,
	      proof: "pact-source-acp-to-stdio-target-callback-parent-binding-fail-closed"
	    },
	    sourceCancelProof: {
	      relaySessionId: cancelSession.result.sessionId,
	      relayTurnId: cancelledPrompt.result.turnId,
	      sourceAcpCancelMethod: "session/cancel",
	      sourceCancelResponseOk: cancelResponse.result?.cancel?.ok === true,
	      sourceCancelLifecycleState: cancelResponse.result?.lifecycleState,
	      targetCancelObserved: targetCancelEvents.length >= 1,
	      targetCancelTargetSessionId: targetCancelEvent.relaySessionId,
	      cancelledTurnsCount: cancelResponse.result?.cancelledTurns?.length || 0,
	      cancelledTurnStopReason: cancelResponse.result?.cancelledTurns?.[0]?.turn?.stopReason || "",
	      cancelledTurnResponseKind: cancelResponse.result?.cancelledTurns?.[0]?.responseKind || "",
	      promptStopReason: cancelledPrompt.result?.stopReason || "",
	      promptResponseKind: cancelledPrompt.result?.responseKind || "",
	      promptSummaryKind: cancelledPrompt.result?.communicationSummary?.summaryKind || "",
	      promptReasoningIncluded: cancelledPrompt.result?.communicationSummary?.reasoningIncluded === true,
	      lateTargetCompletionSuppressed: !JSON.stringify(cancelledPrompt.result).includes("target completed after receiving source cancel"),
	      pendingPermissionRequestCountAfterCancel: cancelLoaded.result?.pendingPermissionRequestCount || 0,
	      storedTurnStatus: cancelledStoreTurn?.status || "",
	      storedTurnStopReason: cancelledStoreTurn?.stopReason || "",
	      permissionRequestCountAfterCancel: Object.values(cancelStoreSnapshot.permissionRequests || {}).length,
	      expectedPermissionRequestCountAfterCancel: permissionRequestsAfterParentBinding.length,
	      proof: "pact-source-acp-to-stdio-target-session-cancel-running-prompt"
	    },
	    targetMethodProof: {
	      methods: targetMethods,
	      usedSessionResume: targetMethods.includes("session/resume"),
	      usedSessionCancel: targetMethods.includes("session/cancel"),
	      promptCount: promptEvents.length,
	      parentRequestIdsBound: promptEvents.every((event) => asText(event.parentRequestId).length > 0),
	      callbackResponseCompleted: writeResponses.some((event) => event.ok === true),
	      callbackRequestCount: callbackRequestEvents.length,
	      targetCancelCount: targetCancelEvents.length,
	      denialCallbackRequested: callbackRequestEvents.some(
	        (event) => event.path === "notes/target-callback-denied.txt" && event.toolCallId === "target-callback-deny-tool"
	      )
    },
    proof: "pact-source-acp-to-stdio-target-callback-approval-resume-and-denial"
  };

  console.log(JSON.stringify(proof, null, 2));
} finally {
  await stopSourceServer(firstSourceServer);
  await stopSourceServer(secondSourceServer);
  await stopSourceServer(thirdSourceServer);
  await stopSourceServer(fourthSourceServer);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
