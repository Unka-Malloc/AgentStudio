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
  discoverAntigravityConnectEndpoint,
  observeAntigravityConversation,
  redactAntigravityConnectEndpoint,
  waitForAntigravityConversationObservation,
  resolveAntigravityAgentApiBinary
} from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import { buildAntigravityRelayProof } from "./acp-agent-relay-antigravity-proof.mjs";
import {
  defaultSourceConnectMinimumProofLevel,
  sourceConnectProofFromPromptResult,
  sourceConnectProofMeetsMinimum,
  strongestSourceConnectProof
} from "./acp-agent-relay-codex-antigravity-proof-level.mjs";
import { buildAcpAgentRelayProofMatrix } from "./acp-agent-relay-proof-matrix.mjs";
import { buildSourceAgentProof } from "./acp-agent-relay-source-agent-proof.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const required = process.env.PACT_ACP_RELAY_ANTIGRAVITY_REQUIRED === "1";
const connectRequired = process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_REQUIRED === "1";
const connectRequested = connectRequired ||
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ENABLED === "1" ||
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE === "1";
const connectDenyPendingCommandsRequired =
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_DENY_PENDING_COMMANDS_REQUIRED === "1";
const sourceResponseTimeoutMs = Number(process.env.PACT_ACP_RELAY_SOURCE_RESPONSE_TIMEOUT_MS || 120000);
const minimumAntigravityProofLevel = asText(
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL,
  "local_marker_observation"
);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function expectedResponseKindForPromptResult(promptResult = {}) {
  const targetEvidence = asObject(promptResult.targetEvidence);
  const summary = asObject(promptResult.communicationSummary, null);
  if (summary?.summaryKind) {
    return asText(summary.summaryKind);
  }
  if (targetEvidence.finalResponseAvailable === true) {
    return "final_response";
  }
  if (targetEvidence.externalCompletionState === "target_error" || promptResult.stopReason === "target_error") {
    return "target_error";
  }
  if (targetEvidence.externalCompletionState === "accepted_only" || promptResult.stopReason === "accepted") {
    return "acknowledgement";
  }
  return asText(promptResult.output || promptResult.outputSummary) ? "status_summary" : "none";
}

function expectedResponseKindForNotification(notification = {}) {
  const params = asObject(notification.params);
  const phase = asText(params.phase);
  if (phase === "accepted") {
    return "acknowledgement";
  }
  if (phase === "completed") {
    return "final_response";
  }
  if (phase === "target_error") {
    return "target_error";
  }
  return asText(params.responseKind);
}

function skip(message) {
  if (required) {
    throw new Error(message);
  }
  console.log(`[acp-agent-relay-codex-antigravity] skipped: ${message}`);
  process.exit(0);
}

async function readCommandOutput(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: repoRoot,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      ...options
    });
    return asText(result.stdout || result.stderr);
  } catch (error) {
    return asText(error.stdout || error.stderr || error.message);
  }
}

async function discoverCodexCliProof(actualSourceProcess, actualSourceTransport) {
  const codexCliPath = await readCommandOutput("sh", ["-lc", "command -v codex"]);
  const codexCliVersion = codexCliPath ? await readCommandOutput("codex", ["--version"]) : "";
  const codexHelpText = codexCliPath ? await readCommandOutput("codex", ["--help"]) : "";
  const codexExecHelpText = codexCliPath ? await readCommandOutput("codex", ["exec", "--help"]) : "";
  return buildSourceAgentProof({
    requestedSourceLabel: "codex",
    actualSourceProcess,
    actualSourceTransport,
    codexCliPath,
    codexCliVersion,
    codexHelpText,
    codexExecHelpText
  });
}

function createOutputLineReader(stream) {
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
    async receiveLine(timeoutMs = 30000) {
      if (queue.length > 0) {
        return queue.shift();
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for source ACP stdio line after ${timeoutMs}ms.`));
        }, timeoutMs);
        waiters.push((line) => {
          clearTimeout(timeout);
          resolve(line);
        });
      });
    }
  };
}

function assertSourceUpdateNotifications(notifications = []) {
  assert.equal(notifications.length > 0, true);
  assert.equal(notifications.every((notification) => notification.method === ACP_METHODS.sessionUpdate), true);
  assert.equal(notifications.every((notification) => Object.hasOwn(notification, "id") === false), true);
  const progressAccepted = notifications.filter(
    (notification) => notification.params?.type === "progress" && notification.params?.phase === "accepted"
  );
  assert.equal(progressAccepted.length, 1);
  const completion = notifications.find((notification) => notification.params?.type === "completion");
  assert.ok(completion);
  assert.equal(typeof completion.params.phase, "string");
  assert.notEqual(completion.params.phase, "[object Object]");
  assert.equal(
    completion.params.responseKind,
    expectedResponseKindForNotification(completion),
    "source ACP completion notifications must expose responseKind instead of relying on text output."
  );
}

function assertPromptStopReasonIsSourceSafe(promptResult = {}) {
  const stopReason = asText(promptResult.stopReason);
  assert.equal(["accepted", "completed", "target_error"].includes(stopReason), true);
  if (stopReason === "target_error") {
    assert.equal(Boolean(promptResult.targetEvidence?.targetError), true, "target_error prompt results must expose targetError evidence.");
    assert.equal(asText(promptResult.targetEvidence?.targetError?.message).length > 0, true);
  }
}

function assertSourceCommunicationSummary(promptResult = {}, label = "prompt") {
  const summary = asObject(promptResult.communicationSummary, null);
  const targetEvidence = asObject(promptResult.targetEvidence);
  const targetError = asObject(targetEvidence.targetError, null);
  assert.equal(Boolean(summary), true, `${label} must expose source-facing communicationSummary.`);
  assert.equal(asText(summary.summaryKind).length > 0, true, `${label} communicationSummary must expose summaryKind.`);
  assert.equal(
    asText(promptResult.responseKind),
    asText(summary.summaryKind),
    `${label} top-level responseKind must match communicationSummary.summaryKind.`
  );
  assert.equal(
    asText(promptResult.responseKind),
    expectedResponseKindForPromptResult(promptResult),
    `${label} responseKind must match target completion evidence.`
  );
  assert.equal(summary.relayTurnId, promptResult.turnId, `${label} communicationSummary must identify the relay turn.`);
  assert.equal(summary.stopReason, promptResult.stopReason, `${label} communicationSummary must match stopReason.`);
  if (targetEvidence.targetSessionId) {
    assert.equal(summary.targetSessionId, targetEvidence.targetSessionId, `${label} communicationSummary must identify the target session.`);
  }
  if (targetEvidence.externalCompletionState) {
    assert.equal(
      summary.externalCompletionState,
      targetEvidence.externalCompletionState,
      `${label} communicationSummary must match target completion state.`
    );
  }
  if (targetEvidence.finalResponsePolicy) {
    assert.equal(
      summary.finalResponsePolicy,
      targetEvidence.finalResponsePolicy,
      `${label} communicationSummary must match final response policy.`
    );
  }
  if (targetError?.code) {
    assert.equal(summary.targetErrorCode, targetError.code, `${label} communicationSummary must carry target error code.`);
    assert.equal(asText(summary.targetErrorMessage).length > 0, true, `${label} communicationSummary must carry target error message.`);
  }
  if (summary.summaryKind === "final_response") {
    assert.equal(asText(summary.finalResponseSummary).length > 0, true, `${label} final_response must populate finalResponseSummary.`);
    assert.equal(asText(summary.acknowledgementSummary), "", `${label} final_response must not populate acknowledgementSummary.`);
  }
  if (summary.summaryKind === "acknowledgement") {
    assert.equal(asText(summary.finalResponseSummary), "", `${label} acknowledgement must not populate finalResponseSummary.`);
    assert.equal(asText(summary.acknowledgementSummary).length > 0, true, `${label} acknowledgement must populate acknowledgementSummary.`);
  }
}

function notificationSummary(notifications = []) {
  return notifications.map((notification) => ({
    type: notification.params?.type || "",
    phase: notification.params?.phase || "",
    responseKind: notification.params?.responseKind || ""
  }));
}

function formalDenyActionEvidence(promptResult = {}) {
  const targetEvidence = promptResult?.targetEvidence || {};
  const actions = targetEvidence.connectConversationObservation?.actions || [];
  const receipts = targetEvidence?.targetInteractionReceipts || [];
  const receipt = receipts.find(
    (candidate) => candidate.status === "denied" && candidate.externalInteraction?.provider === "antigravity-connect"
  ) || null;
  const sourceReceipts = promptResult?.receipts || [];
  const events = promptResult?.events || [];
  const matchingSourceReceipt = receipt
    ? sourceReceipts.find((candidate) => candidate.requestId === receipt.requestId)
    : null;
  const matchingDenialEvent = receipt
    ? events.find((event) =>
        event.type === "denial" &&
          event.redactedPayload?.requestId === receipt.requestId &&
          event.globalAuditId === targetEvidence.globalAuditId &&
          event.artifactRef === targetEvidence.artifactRef
      )
    : null;
  return {
    actionObserved: actions.some(
      (action) => action.type === "handleCascadeUserInteraction.denyCommand" && action.ok === true
    ),
    receiptObserved: Boolean(receipt),
    requestIdObserved: Boolean(receipt?.requestId),
    sourceReceiptObserved: Boolean(matchingSourceReceipt),
    auditObserved: Boolean(
      matchingDenialEvent &&
        targetEvidence.globalAuditId &&
        targetEvidence.artifactRef &&
        targetEvidence.relayTurnId === promptResult.turnId
    ),
    actions,
    receipts,
    receiptRequestId: receipt?.requestId || "",
    matchingDenialEvent: matchingDenialEvent
      ? {
          eventId: matchingDenialEvent.eventId,
          globalAuditId: matchingDenialEvent.globalAuditId,
          artifactRef: matchingDenialEvent.artifactRef,
          relayTurnId: targetEvidence.relayTurnId,
          operationId: matchingDenialEvent.operationId
        }
      : null
  };
}

function sourceTurnObserveProofFromResult(observeResult = {}, label = "turn.observe") {
  const targetObservation = asObject(observeResult?.targetObservation, null);
  const communicationSummary = asObject(observeResult?.communicationSummary, null);
  const targetError = asObject(communicationSummary?.targetError, null);
  const proof = {
    label,
    relaySessionId: asText(observeResult?.relaySessionId),
    relayTurnId: asText(observeResult?.relayTurnId),
    observed: observeResult?.observed === true,
    refreshed: observeResult?.refreshed === true,
    stopReason: asText(observeResult?.stopReason),
    responseKind: asText(observeResult?.responseKind),
    summaryKind: asText(communicationSummary?.summaryKind),
    communicationSummaryTurnId: asText(communicationSummary?.relayTurnId),
    targetObservationAvailable: Boolean(targetObservation),
    markerObserved: targetObservation?.markerObserved === true ||
      targetObservation?.markerMessageObserved === true ||
      targetObservation?.markerTranscriptObserved === true,
    transcriptAdvanced: targetObservation?.transcriptAdvanced === true,
    progressAvailable: targetObservation?.progressAvailable === true,
    finalResponseAvailable: targetObservation?.finalResponseAvailable === true ||
      communicationSummary?.finalResponseAvailable === true,
    targetErrorAvailable: Boolean(
      targetObservation?.errorAvailable === true ||
        targetObservation?.knownErrorAvailable === true ||
        targetError?.code ||
        communicationSummary?.targetErrorCode
    )
  };
  if (!proof.observed || !proof.relayTurnId || proof.communicationSummaryTurnId !== proof.relayTurnId) {
    return { ...proof, proofLevel: "none", proofAcceptable: false };
  }
  if (proof.finalResponseAvailable) {
    return { ...proof, proofLevel: "local_final_response", proofAcceptable: true };
  }
  if (proof.targetErrorAvailable) {
    return { ...proof, proofLevel: "local_target_error", proofAcceptable: true };
  }
  if (proof.progressAvailable || proof.transcriptAdvanced) {
    return { ...proof, proofLevel: "local_progress", proofAcceptable: true };
  }
  if (proof.markerObserved) {
    return { ...proof, proofLevel: "local_marker_observation", proofAcceptable: true };
  }
  return { ...proof, proofLevel: "none", proofAcceptable: false };
}

function truncatedText(value = "", maxLength = 500) {
  const text = asText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function redactedObservationForOutput(observation = {}) {
  const latestProgress = observation.latestProgress
    ? {
        ...observation.latestProgress,
        text: undefined,
        textPreview: truncatedText(observation.latestProgress.textPreview || observation.latestProgress.text)
      }
    : null;
  const latestFinalResponse = observation.latestFinalResponse
    ? {
        ...observation.latestFinalResponse,
        text: undefined,
        textPreview: truncatedText(observation.latestFinalResponse.textPreview || observation.latestFinalResponse.text)
      }
    : null;
  const latestError = observation.latestError
    ? {
        ...observation.latestError,
        errorPreview: truncatedText(observation.latestError.errorPreview || observation.latestError.contentPreview),
        contentPreview: truncatedText(observation.latestError.contentPreview)
      }
    : null;
  const latestKnownError = observation.latestKnownError
    ? {
        ...observation.latestKnownError,
        errorPreview: truncatedText(observation.latestKnownError.errorPreview || observation.latestKnownError.contentPreview),
        contentPreview: truncatedText(observation.latestKnownError.contentPreview)
      }
    : null;
  return {
    conversationId: observation.conversationId,
    transcriptPath: observation.transcriptPath,
    messagesDir: observation.messagesDir,
    transcriptLineCount: observation.transcriptLineCount,
    messageCount: observation.messageCount,
    afterTranscriptLineCount: observation.afterTranscriptLineCount,
    afterMessageMtimeMs: observation.afterMessageMtimeMs,
    markerObserved: observation.markerObserved,
    markerMessageObserved: observation.markerMessageObserved,
    markerTranscriptObserved: observation.markerTranscriptObserved,
    markerMessageCount: observation.markerMessageCount,
    transcriptAdvanced: observation.transcriptAdvanced,
    progressAvailable: observation.progressAvailable,
    finalResponseAvailable: observation.finalResponseAvailable,
    errorAvailable: observation.errorAvailable,
    knownErrorAvailable: observation.knownErrorAvailable,
    latestMessage: observation.latestMessage,
    latestProgress,
    latestFinalResponse,
    latestError,
    latestKnownError,
    latestTranscriptEntry: observation.latestTranscriptEntry,
    latestMarkerMessage: observation.latestMarkerMessage
  };
}

function redactedConnectStepForOutput(step = {}) {
  if (!step || typeof step !== "object") {
    return null;
  }
  const diagnostics = step.diagnostics && typeof step.diagnostics === "object" ? step.diagnostics : null;
  return {
    ordinal: step.ordinal,
    stepIndex: step.stepIndex,
    metadataIndex: step.metadataIndex,
    trajectoryId: step.trajectoryId,
    cascadeId: step.cascadeId,
    type: step.type,
    status: step.status,
    source: step.source,
    createdAt: step.createdAt,
    completedAt: step.completedAt,
    plannerResponseStopReason: step.plannerResponseStopReason || "",
    diagnostics: diagnostics
      ? {
          hasSystemMessage: diagnostics.hasSystemMessage === true,
          hasUserInput: diagnostics.hasUserInput === true,
          hasAddCascadeInput: diagnostics.hasAddCascadeInput === true,
          plannerResponseStopReason: diagnostics.plannerResponseStopReason || "",
          contentSourcePath: diagnostics.contentSourcePath || "",
          errorSourcePath: diagnostics.errorSourcePath || ""
        }
      : null,
    toolCall: step.toolCall
      ? {
          id: step.toolCall.id,
          name: step.toolCall.name,
          originalName: step.toolCall.originalName,
          argumentsPreview: truncatedText(step.toolCall.argumentsPreview)
        }
      : null,
    runCommand: step.runCommand
      ? {
          commandLinePreview: truncatedText(step.runCommand.commandLine),
          cwd: step.runCommand.cwd,
          blocking: step.runCommand.blocking
        }
      : null,
    requestedInteraction: step.requestedInteraction
      ? {
          kind: step.requestedInteraction.kind,
          permission: step.requestedInteraction.permission
            ? {
                action: step.requestedInteraction.permission.action,
                targetPreview: truncatedText(step.requestedInteraction.permission.target),
                persistSuggestionType: step.requestedInteraction.permission.persistSuggestionType,
                suggestedPersistPattern: step.requestedInteraction.permission.suggestedPersistPattern
              }
            : null
        }
      : null,
    errorPreview: truncatedText(step.errorPreview || step.error),
    contentPreview: truncatedText(step.contentPreview || step.content)
  };
}

function redactedConnectObservationForOutput(observation = {}) {
  if (!observation || typeof observation !== "object") {
    return null;
  }
  return {
    conversationId: observation.conversationId,
    endpoint: observation.endpoint,
    runStatus: observation.runStatus,
    stepCount: observation.stepCount,
    afterStepCount: observation.afterStepCount,
    trajectoryAdvanced: observation.trajectoryAdvanced,
    statusCounts: observation.statusCounts,
    running: observation.running,
    completed: observation.completed,
    failed: observation.failed,
    pendingInteraction: observation.pendingInteraction,
    blockedByPendingInteraction: observation.blockedByPendingInteraction,
    markerObserved: observation.markerObserved,
    progressAvailable: observation.progressAvailable,
    finalResponseAvailable: observation.finalResponseAvailable,
    latestStep: redactedConnectStepForOutput(observation.latestStep),
    waitingInteractionStep: redactedConnectStepForOutput(observation.waitingInteractionStep),
    latestError: redactedConnectStepForOutput(observation.latestError),
    latestKnownError: redactedConnectStepForOutput(observation.latestKnownError),
    latestProgress: redactedConnectStepForOutput(observation.latestProgress),
    latestFinalResponse: redactedConnectStepForOutput(observation.latestFinalResponse),
    actions: observation.actions || []
  };
}

async function waitForStrictConnectFinalObservation(client, {
  conversationId = "",
  marker = "",
  afterStepCount = 0,
  timeoutMs = 60000,
  pollIntervalMs = 1000
} = {}) {
  if (!client) {
    return null;
  }
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  let latest = await client.observeConnectTrajectory({
    conversationId,
    marker,
    afterStepCount
  }).catch((error) => ({ error: error.message }));
  while (!latest?.finalResponseAvailable && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(pollIntervalMs || 1000))));
    latest = await client.observeConnectTrajectory({
      conversationId,
      marker,
      afterStepCount
    }).catch((error) => ({ error: error.message }));
  }
  return latest;
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
  const conversationRoot = path.join(os.homedir(), ".gemini/antigravity-ide/conversations");
  const entries = await fs.readdir(conversationRoot).catch(() => []);
  const conversations = [];
  for (const entry of entries) {
    if (!entry.endsWith(".pb")) {
      continue;
    }
    const filePath = path.join(conversationRoot, entry);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) {
      conversations.push({
        id: entry.replace(/\.pb$/u, ""),
        filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
    }
  }
  conversations.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { conversationRoot, conversations };
}

async function latestConversation() {
  const envConversationId = asText(
    process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONVERSATION_ID || process.env.ANTIGRAVITY_CONVERSATION_ID
  );
  const conversationRoot = path.join(os.homedir(), ".gemini/antigravity-ide/conversations");
  if (envConversationId) {
    return { id: envConversationId, filePath: path.join(conversationRoot, `${envConversationId}.pb`) };
  }
  const entries = await fs.readdir(conversationRoot).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith(".pb")) {
      continue;
    }
    const filePath = path.join(conversationRoot, entry);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) {
      candidates.push({ id: entry.replace(/\.pb$/u, ""), filePath, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

async function waitForConversationChange(beforeSnapshot = [], timeoutMs = 12000) {
  const beforeByPath = new Map(beforeSnapshot.map((conversationFile) => [conversationFile.filePath, conversationFile]));
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
  return { changedConversation: null, snapshot };
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

async function probeUnsupportedFinalResponseCommands(client) {
  const commands = [
    "get-conversation",
    "get-conversation-messages",
    "wait-for-response",
    "stream-conversation"
  ];
  const results = [];
  for (const command of commands) {
    const startedAt = Date.now();
    try {
      await client.runAgentApi([command, conversation.id], { timeoutMs: 8000 });
      results.push({ command, supported: true, error: "" });
    } catch (error) {
      const rawMessage = asText(error.agentApiResponse?.error || error.stdout || error.stderr || error.message);
      let parsedMessage = "";
      try {
        parsedMessage = asText(JSON.parse(rawMessage)?.error);
      } catch {
        parsedMessage = "";
      }
      const message = parsedMessage || rawMessage;
      results.push({
        command,
        supported: false,
        error: message,
        elapsedMs: Date.now() - startedAt
      });
    }
  }
  return results;
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

const connectEndpoint = connectRequested
  ? await discoverAntigravityConnectEndpoint({
      conversationId: conversation.id,
      workspaceRoot: repoRoot
    }).catch((error) => {
      if (connectRequired) {
        throw error;
      }
      return null;
    })
  : null;
if (connectRequired && !connectEndpoint) {
  throw new Error("no reachable Antigravity Connect RPC endpoint found");
}
const connectEnabled = Boolean(connectEndpoint);
const connectProbeClient = connectEndpoint
  ? new AntigravityAgentApiClient({
      binaryPath,
      address: endpoint.address,
      csrfToken: endpoint.csrfToken,
      conversationId: conversation.id,
      connectAddress: connectEndpoint.address,
      connectCsrfToken: connectEndpoint.csrfToken,
      connectEnabled: true
    })
  : null;

const sourceStdioScriptPath = path.join(repoRoot, "server/scripts/acp-agent-relay-source-stdio.mjs");
const actualSourceProcess = `${process.execPath} ${sourceStdioScriptPath}`;
const actualSourceTransport = "pact-source-facing-acp-stdio";
const sourceAgentProof = await discoverCodexCliProof(actualSourceProcess, actualSourceTransport);
assert.equal(
  sourceAgentProof.directCodexCliAcpSourceVerified,
  false,
  "This verifier must not claim direct Codex CLI ACP source proof while it starts Pact's source-facing stdio harness."
);
assert.equal(sourceAgentProof.sourceAgentKind, "pact-source-acp-stdio-verifier");

const virtualAgentId = "antigravity.codex-source-agentapi-real";
const targetId = "antigravity.agentapi:codex-source-local";
const sourceId = "codex.source-acp.verify";
const marker = `PACT_CODEX_SOURCE_ACP_REAL_VERIFY_${Date.now()}`;
const delegatedPrompt = asText(
  process.env.PACT_ACP_RELAY_CODEX_ANTIGRAVITY_PROMPT || process.env.PACT_ACP_RELAY_ANTIGRAVITY_PROMPT
);
const sourceSessionId = `codex-source-${marker}`;
const warmupPromptText = `${marker}: Codex 编排的 Pact source-facing ACP stdio harness 正在建立一个可持久恢复的 relay session。请只回复一句收到，不修改任何文件。`;
const promptText = delegatedPrompt
  ? `${marker}: ${delegatedPrompt}`
  : connectDenyPendingCommandsRequired
    ? `${marker}: Codex 编排的 Pact source-facing ACP harness 已恢复同一个 relay session。为了验证 Pact 对 Antigravity Connect 目标侧命令交互的拒绝回执，请尝试执行只读命令 pwd，并等待权限结果。不要修改任何文件。`
  : `${marker}: Codex 编排的 Pact source-facing ACP stdio 进程已重启，并通过 session/load 与 session/resume 恢复同一个 relay session 后中转到 Antigravity。请只回复一句收到，不修改任何文件。`;
const runtimeOptions = {
  defaultVirtualAgentId: virtualAgentId,
  defaultSourceId: sourceId,
  defaultWorkspaceId: `file:${repoRoot}`,
  virtualAgents: {
    [virtualAgentId]: {
      virtualAgentId,
      targetId,
      profileId: "pact.acp.codex_source.antigravity.real",
      displayName: "Codex-Orchestrated Source ACP Harness to Antigravity",
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
        public: { verifier: "codex-antigravity-public-metadata" },
        csrfToken: "codex-antigravity-virtual-agent-csrf-secret",
        apiKey: "codex-antigravity-virtual-agent-api-key",
        rawPrompt: "codex-antigravity-virtual-agent-raw-prompt",
        transport: { command: "/tmp/codex-antigravity-virtual-agent-command" }
      },
      revision: 1
    }
  },
  targets: {
    [targetId]: {
      targetId,
      label: "Local Antigravity Agent API for Codex Source ACP",
      transport: {
        type: "antigravity-agentapi",
        address: endpoint.address,
        csrfToken: endpoint.csrfToken,
        binaryPath,
        conversationId: conversation.id,
        model: "flash",
        timeoutMs: 120000,
        localObservationEnabled: true,
        localObservationTimeoutMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_TIMEOUT_MS || 15000),
        localObservationPollIntervalMs: 1000,
        connectEnabled,
        connectAddress: connectEndpoint?.address || "",
        connectCsrfToken: connectEndpoint?.csrfToken || "",
        connectTimeoutMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_TIMEOUT_MS || 8000),
        connectObservationTimeoutMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_TIMEOUT_MS || 30000),
        connectObservationPollIntervalMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_POLL_MS || 1000),
        connectWaitForFinalResponse: !["0", "false", "no", "off"].includes(
          asText(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_WAIT_FOR_FINAL).toLowerCase()
        ),
        connectFlushQueuedMessages: process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FLUSH_QUEUE === "1",
        connectDenyPendingCommandInteractions:
          process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_DENY_PENDING_COMMANDS === "1",
        connectForceStopStuckCascade: process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FORCE_STOP_STUCK === "1"
      },
      agentProfileId: "pact.acp.codex_source.antigravity.real",
      externalServiceId: "external.antigravity.agentapi.local",
      enabled: true,
      revision: 1,
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      advertisedToolsets: ["agentapi.sendMessage"],
      metadata: { conversationId: conversation.id, endpointSource: endpoint.source }
    }
  },
  workspaceRoot: repoRoot
};

const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-codex-antigravity-"));
const storagePath = path.join(storeRoot, "acp-source-stdio-store.json");
const beforeConversationObservation = await observeAntigravityConversation({
  conversationId: conversation.id,
  maxTranscriptEntries: 1,
  maxMessageEntries: 1
});
const beforeConnectObservation = connectProbeClient
  ? await connectProbeClient.observeConnectTrajectory({
      conversationId: conversation.id,
      afterStepCount: 0,
      timeoutMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_TIMEOUT_MS || 8000)
    }).catch((error) => ({
      error: error.message
    }))
  : null;
const beforeConversationSnapshot = await listConversationFiles();
const beforeConversation =
  beforeConversationSnapshot.conversations.find((item) => item.filePath === conversation.filePath) ||
  (await fs.stat(conversation.filePath).then((stat) => ({
    id: conversation.id,
    filePath: conversation.filePath,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  })).catch(() => null));

function spawnSourceServer({
  serverSourceId = sourceId,
  serverWorkspaceId = `file:${repoRoot}`
} = {}) {
  const child = spawn(process.execPath, [sourceStdioScriptPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(runtimeOptions),
      PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
        sourceId: serverSourceId,
        workspaceId: serverWorkspaceId
      }),
      PACT_ACP_SOURCE_STDIO_STORE_PATH: storagePath,
      PACT_ACP_SOURCE_ID: serverSourceId,
      PACT_ACP_WORKSPACE_ID: serverWorkspaceId
    }
  });
  const output = createOutputLineReader(child.stdout);
  const diagnostics = createOutputLineReader(child.stderr);
  return {
    child,
    output,
    diagnostics,
    async waitUntilReady() {
      const ready = JSON.parse(await diagnostics.receiveLine());
      assert.equal(ready.event, "pact.acp.source_stdio.ready");
      assert.equal(ready.durableStore, true);
      assert.equal(ready.storagePath, storagePath);
      assert.equal(ready.sourceId, serverSourceId);
      assert.equal(ready.workspaceId, serverWorkspaceId);
      return ready;
    },
    async request(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
      const notifications = [];
      for (let index = 0; index < 100; index += 1) {
        const rawResponse = await output.receiveLine(
          Number.isFinite(sourceResponseTimeoutMs) ? sourceResponseTimeoutMs : 120000
        );
        assert.ok(rawResponse, "source ACP service must return a JSON-RPC response frame");
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
  handle.child.stdin.end();
  if (handle.child.exitCode !== null || handle.child.signalCode) {
    return;
  }
  await new Promise((resolve, reject) => {
    handle.child.once("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`source ACP stdio server exited with code ${code}`));
      }
    });
    setTimeout(() => {
      handle.child.kill("SIGTERM");
      resolve();
    }, 5000).unref();
  });
}

let initialize;
let agentList;
let targetList;
let sessionNew;
let firstPrompt;
let sourceSessionList;
let sourceSessionGet;
let sourceTurnList;
let sessionLoad;
let sessionResume;
let prompt;
let promptObservation;
let sourceTurnObserveProof;
let sessionClose;
let promptAfterClose;
let closedSessionLoadAfterRestart;
let resumeAfterCloseRestart;
let promptAfterCloseRestart;
let persistedSession;
let persistedPermissionRequests = [];
let sourceIdentityIsolationProof;
let sourceSessionCloseProof;
try {
  const firstSourceServer = spawnSourceServer();
  try {
    await firstSourceServer.waitUntilReady();
    initialize = await firstSourceServer.request(createRequest(ACP_METHODS.initialize, { virtualAgentId, sourceId }, "codex-init"));
    assert.equal(initialize.id, "codex-init");
    assert.equal(initialize.result.protocolVersion, 1);
    assert.equal(initialize.result.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
    assert.equal(initialize.result.virtualAgentId, virtualAgentId);
    assert.deepEqual(initialize.result.capabilities?.tools, ["agentapi.sendMessage"]);
    assert.equal(initialize.result.capabilities?.writes, "deny");
    assert.equal(initialize.result.capabilities?.terminal, "deny");
    assert.equal(initialize.result.capabilities?.maxRisk, "read_only");
    assert.equal(initialize.result.capabilities?.finalResponse?.policy, connectEnabled ? "connect_trajectory_if_observed" : "accepted_only");
    assert.equal(
      initialize.result.virtualAgents?.some((agent) => agent.virtualAgentId === virtualAgentId),
      true,
      "source-facing initialize must expose the available virtual agent capability catalog."
    );

    agentList = await firstSourceServer.request(
      createRequest(
        ACP_METHODS.agentList,
        {
          sourceId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-agent-list"
      )
    );
    assert.equal(agentList.id, "codex-agent-list");
    const listedAgent = agentList.result.virtualAgents?.find((agent) => agent.virtualAgentId === virtualAgentId);
    assert.ok(listedAgent, "source-facing agent/list must expose the Antigravity virtual agent.");
    assert.deepEqual(listedAgent.capabilities?.tools, ["agentapi.sendMessage"]);
    assert.deepEqual(listedAgent.capabilities?.dataSources, ["workspace.files"]);
    assert.equal(listedAgent.capabilities?.writes, "deny");
    assert.equal(listedAgent.capabilities?.terminal, "deny");
    assert.equal(listedAgent.capabilities?.finalResponse?.policy, connectEnabled ? "connect_trajectory_if_observed" : "accepted_only");
    assert.equal(listedAgent.target?.transportType, "antigravity-agentapi");
    assert.equal(listedAgent.target?.targetCommunicationMode, "agent_api_proxy");
    assert.equal(listedAgent.target?.nativeAcpTargetSupported, false);
    assert.equal(listedAgent.target?.nativeAcpTargetVerified, false);
    assert.deepEqual(listedAgent.metadata, { verifier: "codex-antigravity-public-metadata" });
    assert.equal(JSON.stringify(agentList.result).includes("csrf"), false);
    assert.equal(JSON.stringify(agentList.result).includes("token"), false);
    assert.equal(JSON.stringify(agentList.result).includes("codex-antigravity-virtual-agent-api-key"), false);
    assert.equal(JSON.stringify(agentList.result).includes("codex-antigravity-virtual-agent-raw-prompt"), false);
    assert.equal(JSON.stringify(agentList.result).includes("codex-antigravity-virtual-agent-command"), false);

    targetList = await firstSourceServer.request(
      createRequest(
        ACP_METHODS.pactTargetList,
        {
          sourceId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-target-list"
      )
    );
    assert.equal(targetList.id, "codex-target-list");
    const listedTarget = targetList.result.targets?.find((target) => target.targetId === targetId);
    assert.ok(listedTarget, "source-facing target/list must expose the Antigravity target capability descriptor.");
    assert.equal(listedTarget.transportType, "antigravity-agentapi");
    assert.equal(listedTarget.targetCommunicationMode, "agent_api_proxy");
    assert.equal(listedTarget.nativeAcpTargetSupported, false);
    assert.equal(listedTarget.nativeAcpTargetVerified, false);
    assert.deepEqual(listedTarget.capabilities?.toolsets, ["agentapi.sendMessage"]);
    assert.equal(listedTarget.capabilities?.writes, "deny");
    assert.equal(listedTarget.capabilities?.terminal, "deny");
    assert.equal(listedTarget.capabilities?.finalResponse?.policy, connectEnabled ? "connect_trajectory_if_observed" : "accepted_only");
    assert.equal(JSON.stringify(targetList.result).includes("csrf"), false);
    assert.equal(JSON.stringify(targetList.result).includes("token"), false);
    assert.equal(JSON.stringify(targetList.result).includes("binaryPath"), false);
    assert.equal(JSON.stringify(targetList.result).includes("\"transport\":"), false);

    sessionNew = await firstSourceServer.request(
      createRequest(
        ACP_METHODS.sessionNew,
        {
          virtualAgentId,
          sourceId,
          sourceSessionId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-session-new"
      )
    );
    assert.equal(sessionNew.id, "codex-session-new");
    assert.match(sessionNew.result.sessionId, /^relay_session_/);
    assert.deepEqual(sessionNew.result.capabilities?.tools, ["agentapi.sendMessage"]);
    assert.equal(sessionNew.result.capabilities?.finalResponse?.policy, connectEnabled ? "connect_trajectory_if_observed" : "accepted_only");
    assert.equal(sessionNew.result.capabilitiesSnapshot?.target?.transportType, "antigravity-agentapi");
    assert.equal(sessionNew.result.capabilitiesSnapshot?.target?.targetCommunicationMode, "agent_api_proxy");
    assert.equal(sessionNew.result.capabilitiesSnapshot?.target?.nativeAcpTargetSupported, false);
    assert.equal(sessionNew.result.capabilitiesSnapshot?.target?.nativeAcpTargetVerified, false);
    assert.deepEqual(sessionNew.result.capabilitiesSnapshot?.metadata, { verifier: "codex-antigravity-public-metadata" });
    assert.equal(JSON.stringify(sessionNew.result).includes("csrf"), false);
    assert.equal(JSON.stringify(sessionNew.result).includes("token"), false);
    assert.equal(JSON.stringify(sessionNew.result).includes("codex-antigravity-virtual-agent-api-key"), false);
    assert.equal(JSON.stringify(sessionNew.result).includes("codex-antigravity-virtual-agent-raw-prompt"), false);
    assert.equal(JSON.stringify(sessionNew.result).includes("codex-antigravity-virtual-agent-command"), false);

    firstPrompt = await firstSourceServer.request(
      createRequest(
        ACP_METHODS.sessionPrompt,
        {
          sessionId: sessionNew.result.sessionId,
          prompt: warmupPromptText,
          localObservationMarker: marker,
          requestReasoning: false
        },
        "codex-first-prompt"
      )
    );
    assert.equal(firstPrompt.id, "codex-first-prompt");
    assertSourceUpdateNotifications(firstPrompt.notifications);
    assertPromptStopReasonIsSourceSafe(firstPrompt.result);
    assertSourceCommunicationSummary(firstPrompt.result, "firstPrompt");
    assert.equal(firstPrompt.result.targetEvidence?.externalServiceId, "external.antigravity.agentapi.local");
    assert.equal(firstPrompt.result.targetEvidence?.targetSessionId, conversation.id);
    assert.equal(firstPrompt.result.targetEvidence?.targetResumeRef, conversation.id);

    sourceSessionList = await firstSourceServer.request(
      createRequest(
        ACP_METHODS.pactSessionList,
        {
          sourceId,
          workspaceId: `file:${repoRoot}`,
          virtualAgentId,
          limit: 10
        },
        "codex-session-list"
      )
    );
    assert.equal(sourceSessionList.id, "codex-session-list");
    const listedSession = sourceSessionList.result.sessions?.find(
      (session) => session.relaySessionId === sessionNew.result.sessionId
    );
    assert.ok(listedSession, "source-facing session/list must expose the current relay session summary.");
    assert.equal(listedSession.sourceId, sourceId);
    assert.equal(listedSession.virtualAgentId, virtualAgentId);
    assert.equal(listedSession.turnCount >= 1, true);
    assert.equal(listedSession.latestTurn?.communicationSummary?.reasoningIncluded, false);
    assert.equal(
      listedSession.latestTurn?.responseKind,
      listedSession.latestTurn?.communicationSummary?.summaryKind,
      "source-facing session/list latestTurn must preserve responseKind."
    );
    assert.equal(JSON.stringify(sourceSessionList.result).includes("targetSessionId"), false);
    assert.equal(JSON.stringify(sourceSessionList.result).includes("targetResumeRef"), false);
    assert.equal(JSON.stringify(sourceSessionList.result).includes("relayMcpGrantId"), false);

    sourceSessionGet = await firstSourceServer.request(
      createRequest(
        ACP_METHODS.pactSessionGet,
        {
          sessionId: sessionNew.result.sessionId,
          sourceId,
          workspaceId: `file:${repoRoot}`,
          virtualAgentId
        },
        "codex-session-get"
      )
    );
    assert.equal(sourceSessionGet.id, "codex-session-get");
    assert.equal(sourceSessionGet.result.session?.relaySessionId, sessionNew.result.sessionId);
    assert.equal(sourceSessionGet.result.turns?.some((turn) => turn.relayTurnId === firstPrompt.result.turnId), true);
    assert.equal(
      sourceSessionGet.result.turns?.find((turn) => turn.relayTurnId === firstPrompt.result.turnId)
        ?.communicationSummary?.reasoningIncluded,
      false
    );
    assert.equal(
      sourceSessionGet.result.turns?.find((turn) => turn.relayTurnId === firstPrompt.result.turnId)
        ?.responseKind,
      sourceSessionGet.result.turns?.find((turn) => turn.relayTurnId === firstPrompt.result.turnId)
        ?.communicationSummary?.summaryKind,
      "source-facing session/get turns must preserve responseKind."
    );
    assert.equal(JSON.stringify(sourceSessionGet.result).includes("targetSessionId"), false);
    assert.equal(JSON.stringify(sourceSessionGet.result).includes("targetResumeRef"), false);
    assert.equal(JSON.stringify(sourceSessionGet.result).includes("relayMcpGrantId"), false);

    sourceTurnList = await firstSourceServer.request(
      createRequest(
        ACP_METHODS.pactTurnList,
        {
          sessionId: sessionNew.result.sessionId,
          sourceId,
          workspaceId: `file:${repoRoot}`,
          virtualAgentId,
          limit: 10
        },
        "codex-turn-list"
      )
    );
    assert.equal(sourceTurnList.id, "codex-turn-list");
    assert.equal(sourceTurnList.result.relaySessionId, sessionNew.result.sessionId);
    assert.equal(sourceTurnList.result.turns?.some((turn) => turn.relayTurnId === firstPrompt.result.turnId), true);
    assert.equal(
      sourceTurnList.result.turns?.find((turn) => turn.relayTurnId === firstPrompt.result.turnId)
        ?.responseKind,
      sourceTurnList.result.turns?.find((turn) => turn.relayTurnId === firstPrompt.result.turnId)
        ?.communicationSummary?.summaryKind,
      "source-facing turn/list must preserve responseKind."
    );
    assert.equal(JSON.stringify(sourceTurnList.result).includes("\"reasoning\":"), false);
    assert.equal(JSON.stringify(sourceTurnList.result).includes("targetSessionId"), false);
    assert.equal(JSON.stringify(sourceTurnList.result).includes("targetResumeRef"), false);
    assert.equal(JSON.stringify(sourceTurnList.result).includes("relayMcpGrantId"), false);
  } finally {
    await stopSourceServer(firstSourceServer);
  }

  const storeSnapshot = JSON.parse(await fs.readFile(storagePath, "utf8"));
  persistedSession = storeSnapshot.sessions?.[sessionNew.result.sessionId];
  assert.ok(persistedSession, "source ACP stdio process restart verifier must persist the relay session");
  assert.equal(persistedSession.targetSessionId, conversation.id);
  assert.equal(persistedSession.targetResumeRef, conversation.id);

  const foreignSourceId = `${sourceId}.foreign`;
  const foreignSourceServer = spawnSourceServer({ serverSourceId: foreignSourceId });
  try {
    await foreignSourceServer.waitUntilReady();
    const foreignInitialize = await foreignSourceServer.request(
      createRequest(
        ACP_METHODS.initialize,
        {
          virtualAgentId,
          sourceId,
          workspaceId: `file:${repoRoot}`
        },
        "foreign-source-init"
      )
    );
    assert.equal(foreignInitialize.id, "foreign-source-init");
    assert.equal(foreignInitialize.result.sourceIdentity?.sourceId, foreignSourceId);

    const foreignSpoofedLoad = await foreignSourceServer.request(
      createRequest(
        ACP_METHODS.sessionLoad,
        {
          sessionId: sessionNew.result.sessionId,
          virtualAgentId,
          sourceId,
          sourceSessionId,
          workspaceId: `file:${repoRoot}`
        },
        "foreign-source-spoof-owner-load"
      )
    );
    assert.equal(foreignSpoofedLoad.id, "foreign-source-spoof-owner-load");
    assert.equal(foreignSpoofedLoad.error?.data?.code, "relay_session_not_found");

    const foreignSpoofedList = await foreignSourceServer.request(
      createRequest(
        ACP_METHODS.pactSessionList,
        {
          sourceId,
          workspaceId: `file:${repoRoot}`,
          virtualAgentId,
          limit: 10
        },
        "foreign-source-spoof-owner-list"
      )
    );
    assert.equal(foreignSpoofedList.id, "foreign-source-spoof-owner-list");
    const spoofedSessionListOwnerVisible = (foreignSpoofedList.result.sessions || [])
      .some((session) => session.relaySessionId === sessionNew.result.sessionId);
    assert.equal(spoofedSessionListOwnerVisible, false);
    sourceIdentityIsolationProof = {
      ownerSourceId: sourceId,
      foreignSourceId,
      relaySessionId: sessionNew.result.sessionId,
      foreignInitializeSourceId: foreignInitialize.result.sourceIdentity?.sourceId || "",
      spoofedLoadErrorCode: foreignSpoofedLoad.error?.data?.code || "",
      requestBodyOverrideRejected: foreignSpoofedLoad.error?.data?.code === "relay_session_not_found",
      sessionEnumerationIsolated: !spoofedSessionListOwnerVisible,
      spoofedSessionListOwnerVisible
    };
  } finally {
    await stopSourceServer(foreignSourceServer);
  }

  const secondSourceServer = spawnSourceServer();
  try {
    await secondSourceServer.waitUntilReady();
    initialize = await secondSourceServer.request(createRequest(ACP_METHODS.initialize, { virtualAgentId, sourceId }, "codex-reinit"));
    assert.equal(initialize.id, "codex-reinit");
    assert.equal(initialize.result.protocolVersion, 1);
    assert.equal(initialize.result.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
    assert.equal(initialize.result.virtualAgentId, virtualAgentId);

    sessionLoad = await secondSourceServer.request(
      createRequest(
        ACP_METHODS.sessionLoad,
        {
          virtualAgentId,
          sourceId,
          sourceSessionId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-session-load"
      )
    );
    assert.equal(sessionLoad.id, "codex-session-load");
    assert.equal(sessionLoad.result.sessionId, sessionNew.result.sessionId);
    assert.equal(sessionLoad.result.targetSessionId, conversation.id);
    assert.equal(sessionLoad.result.targetResumeRef, conversation.id);
    assert.deepEqual(sessionLoad.result.capabilities?.tools, ["agentapi.sendMessage"]);
    assert.equal(sessionLoad.result.capabilitiesSnapshot?.target?.transportType, "antigravity-agentapi");
    assert.equal(sessionLoad.result.capabilitiesSnapshot?.target?.targetCommunicationMode, "agent_api_proxy");
    assert.deepEqual(sessionLoad.result.capabilitiesSnapshot?.metadata, { verifier: "codex-antigravity-public-metadata" });
    assert.equal(sessionLoad.result.capabilitiesSnapshotError, "");
    assert.equal(JSON.stringify(sessionLoad.result).includes("csrf"), false);
    assert.equal(JSON.stringify(sessionLoad.result).includes("token"), false);
    assert.equal(JSON.stringify(sessionLoad.result).includes("codex-antigravity-virtual-agent-api-key"), false);
    assert.equal(JSON.stringify(sessionLoad.result).includes("codex-antigravity-virtual-agent-raw-prompt"), false);
    assert.equal(JSON.stringify(sessionLoad.result).includes("codex-antigravity-virtual-agent-command"), false);

    sessionResume = await secondSourceServer.request(
      createRequest(
        ACP_METHODS.sessionResume,
        {
          virtualAgentId,
          sourceId,
          sourceSessionId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-session-resume"
      )
    );
    assert.equal(sessionResume.id, "codex-session-resume");
    assert.equal(sessionResume.result.sessionId, sessionNew.result.sessionId);
    assert.equal(sessionResume.result.targetSessionId, conversation.id);
    assert.equal(sessionResume.result.targetResumeRef, conversation.id);
    assert.deepEqual(sessionResume.result.capabilities?.tools, ["agentapi.sendMessage"]);
    assert.equal(sessionResume.result.capabilitiesSnapshot?.target?.transportType, "antigravity-agentapi");
    assert.equal(sessionResume.result.capabilitiesSnapshot?.target?.targetCommunicationMode, "agent_api_proxy");
    assert.deepEqual(sessionResume.result.capabilitiesSnapshot?.metadata, { verifier: "codex-antigravity-public-metadata" });
    assert.equal(sessionResume.result.capabilitiesSnapshotError, "");
    assert.equal(JSON.stringify(sessionResume.result).includes("csrf"), false);
    assert.equal(JSON.stringify(sessionResume.result).includes("token"), false);
    assert.equal(JSON.stringify(sessionResume.result).includes("codex-antigravity-virtual-agent-api-key"), false);
    assert.equal(JSON.stringify(sessionResume.result).includes("codex-antigravity-virtual-agent-raw-prompt"), false);
    assert.equal(JSON.stringify(sessionResume.result).includes("codex-antigravity-virtual-agent-command"), false);
    assert.equal(JSON.stringify(sessionResume.result).includes("token"), false);

    prompt = await secondSourceServer.request(
      createRequest(
        ACP_METHODS.sessionPrompt,
        {
          sessionId: sessionResume.result.sessionId,
          prompt: promptText,
          localObservationMarker: marker,
          requestReasoning: false
        },
        "codex-prompt"
      )
    );
    assert.equal(prompt.id, "codex-prompt");
    assertSourceUpdateNotifications(prompt.notifications);
    assertPromptStopReasonIsSourceSafe(prompt.result);
    assertSourceCommunicationSummary(prompt.result, "prompt");
    assert.equal(prompt.result.targetEvidence?.transportType, "antigravity-agentapi");
    assert.equal(prompt.result.targetEvidence?.targetCommunicationMode, "agent_api_proxy");
    assert.equal(prompt.result.targetEvidence?.nativeAcpTargetSupported, false);
    assert.equal(prompt.result.targetEvidence?.nativeAcpTargetVerified, false);
    assert.equal(prompt.result.targetEvidence?.externalServiceId, "external.antigravity.agentapi.local");
    assert.equal(prompt.result.targetEvidence?.targetSessionId, conversation.id);
    assert.equal(prompt.result.targetEvidence?.targetResumeRef, conversation.id);
    assert.equal(prompt.result.targetEvidence?.externalAccepted, true);
    assert.equal(["accepted_only", "completed", "target_error"].includes(prompt.result.targetEvidence?.externalCompletionState), true);
    if (prompt.result.targetEvidence?.finalResponseAvailable) {
      assert.equal(prompt.result.targetEvidence?.finalResponsePolicy, "connect_trajectory");
    } else if (prompt.result.targetEvidence?.externalCompletionState === "target_error") {
      assert.equal(prompt.result.targetEvidence?.finalResponsePolicy, "target_error");
      assert.equal(Boolean(prompt.result.targetEvidence?.targetError), true);
    } else {
      assert.equal(prompt.result.targetEvidence?.externalCompletionState, "accepted_only");
      assert.equal(["accepted_only", "pull_or_stream"].includes(prompt.result.targetEvidence?.finalResponsePolicy), true);
    }
    assert.equal(prompt.result.targetEvidence?.agentApiCapabilitySnapshot?.finalResponseReadSupported, false);
    assert.equal(prompt.result.targetEvidence?.agentApiCapabilitySnapshot?.commands?.sendMessage, true);
    assert.equal(prompt.result.targetEvidence?.agentApiCapabilitySnapshot?.commands?.waitForResponse, false);
    assert.equal(prompt.result.targetEvidence?.agentApiCapabilitySnapshot?.commands?.streamConversation, false);
    assert.deepEqual(prompt.result.targetEvidence?.capabilitiesSnapshot?.capabilities?.tools, ["agentapi.sendMessage"]);
    assert.equal(prompt.result.targetEvidence?.capabilitiesSnapshot?.capabilities?.writes, "deny");
    assert.equal(prompt.result.targetEvidence?.capabilitiesSnapshot?.capabilities?.finalResponse?.policy, connectEnabled ? "connect_trajectory_if_observed" : "accepted_only");
    assert.equal(prompt.result.targetEvidence?.externalResponseKeys?.includes("sendMessage"), true);
    assert.equal(prompt.result.targetEvidence?.localConversationObservation?.markerMessageObserved, true);

    promptObservation = await secondSourceServer.request(
      createRequest(
        ACP_METHODS.pactTurnObserve,
        {
          sessionId: sessionResume.result.sessionId,
          relayTurnId: prompt.result.turnId,
          marker,
          wait: true,
          until: "message",
          timeoutMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_TIMEOUT_MS || 15000)
        },
        "codex-turn-observe"
      )
    );
    assert.equal(promptObservation.id, "codex-turn-observe");
    assert.equal(promptObservation.result.relaySessionId, sessionResume.result.sessionId);
    assert.equal(promptObservation.result.relayTurnId, prompt.result.turnId);
    assert.equal(promptObservation.result.observed, true);
    assert.equal(promptObservation.result.turn?.relayTurnId, prompt.result.turnId);
    assert.equal(promptObservation.result.communicationSummary?.relayTurnId, prompt.result.turnId);
    assert.equal(
      promptObservation.result.responseKind,
      promptObservation.result.communicationSummary?.summaryKind,
      "source-facing turn.observe must preserve top-level responseKind."
    );
    assert.equal(
      promptObservation.result.turn?.responseKind,
      promptObservation.result.turn?.communicationSummary?.summaryKind,
      "source-facing turn.observe turn summary must preserve responseKind."
    );
    assert.equal(promptObservation.result.targetObservation?.markerObserved, true);
    assert.equal(
      promptObservation.result.targetObservation?.markerMessageObserved ||
        promptObservation.result.targetObservation?.markerTranscriptObserved,
      true
    );
    assert.equal(JSON.stringify(promptObservation.result).includes("csrf"), false);
    assert.equal(JSON.stringify(promptObservation.result).includes("token"), false);
    assert.equal(JSON.stringify(promptObservation.result).includes("binaryPath"), false);
    assert.equal(JSON.stringify(promptObservation.result).includes("transcriptPath"), false);
    assert.equal(JSON.stringify(promptObservation.result).includes("messagesDir"), false);
    assert.equal(JSON.stringify(promptObservation.result).includes('"content":'), false);
    if (promptObservation.result.targetObservation?.latestFinalResponse) {
      assert.equal(promptObservation.result.targetObservation.latestFinalResponse.text, undefined);
    }
    sourceTurnObserveProof = sourceTurnObserveProofFromResult(promptObservation.result, "prompt");
    assert.equal(
      sourceTurnObserveProof.proofAcceptable,
      true,
      `Source-facing ACP _pact/turn/observe must expose a safe Antigravity observation proof. diagnostic=${JSON.stringify(sourceTurnObserveProof)}`
    );

    const promptStoreSnapshot = JSON.parse(await fs.readFile(storagePath, "utf8"));
    persistedPermissionRequests = Object.values(promptStoreSnapshot.permissionRequests || {})
      .filter((request) => request.relayTurnId === prompt.result.turnId);

    sessionClose = await secondSourceServer.request(
      createRequest(
        ACP_METHODS.sessionClose,
        {
          sessionId: sessionResume.result.sessionId,
          sourceId,
          sourceSessionId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-session-close"
      )
    );
    assert.equal(sessionClose.id, "codex-session-close");
    assert.equal(sessionClose.result.lifecycleState, "closed");
    assert.equal(sessionClose.result.close.ok, true);

    promptAfterClose = await secondSourceServer.request(
      createRequest(
        ACP_METHODS.sessionPrompt,
        {
          sessionId: sessionResume.result.sessionId,
          prompt: "should fail after Codex source closes the Antigravity relay session"
        },
        "codex-prompt-after-close"
      )
    );
    assert.equal(promptAfterClose.id, "codex-prompt-after-close");
    assert.equal(promptAfterClose.error?.data?.code, "relay_session_closed");
  } finally {
    await stopSourceServer(secondSourceServer);
  }

  const thirdSourceServer = spawnSourceServer();
  try {
    await thirdSourceServer.waitUntilReady();
    closedSessionLoadAfterRestart = await thirdSourceServer.request(
      createRequest(
        ACP_METHODS.sessionLoad,
        {
          virtualAgentId,
          sourceId,
          sourceSessionId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-closed-session-load-after-restart"
      )
    );
    assert.equal(closedSessionLoadAfterRestart.id, "codex-closed-session-load-after-restart");
    assert.equal(closedSessionLoadAfterRestart.result.sessionId, sessionNew.result.sessionId);
    assert.equal(closedSessionLoadAfterRestart.result.lifecycleState, "closed");
    assert.equal(closedSessionLoadAfterRestart.result.targetSessionId, conversation.id);
    assert.equal(closedSessionLoadAfterRestart.result.targetResumeRef, conversation.id);

    resumeAfterCloseRestart = await thirdSourceServer.request(
      createRequest(
        ACP_METHODS.sessionResume,
        {
          virtualAgentId,
          sourceId,
          sourceSessionId,
          workspaceId: `file:${repoRoot}`
        },
        "codex-closed-session-resume-after-restart"
      )
    );
    assert.equal(resumeAfterCloseRestart.id, "codex-closed-session-resume-after-restart");
    assert.equal(resumeAfterCloseRestart.error?.data?.code, "relay_session_closed");

    promptAfterCloseRestart = await thirdSourceServer.request(
      createRequest(
        ACP_METHODS.sessionPrompt,
        {
          sessionId: sessionNew.result.sessionId,
          prompt: "should fail after Codex source restarts a closed Antigravity relay session"
        },
        "codex-closed-session-prompt-after-restart"
      )
    );
    assert.equal(promptAfterCloseRestart.id, "codex-closed-session-prompt-after-restart");
    assert.equal(promptAfterCloseRestart.error?.data?.code, "relay_session_closed");
  } finally {
    await stopSourceServer(thirdSourceServer);
  }
  sourceSessionCloseProof = {
    relaySessionId: sessionNew.result.sessionId,
    closedSessionId: sessionClose.result.sessionId,
    closeLifecycleState: sessionClose.result.lifecycleState,
    closeOk: sessionClose.result.close?.ok === true,
    promptAfterCloseErrorCode: promptAfterClose.error?.data?.code || "",
    closedSessionLoadAfterRestartLifecycleState: closedSessionLoadAfterRestart.result.lifecycleState,
    resumeAfterCloseRestartErrorCode: resumeAfterCloseRestart.error?.data?.code || "",
    promptAfterCloseRestartErrorCode: promptAfterCloseRestart.error?.data?.code || ""
  };
  assert.equal(sourceSessionCloseProof.closedSessionId, sourceSessionCloseProof.relaySessionId);
  assert.equal(sourceSessionCloseProof.closeLifecycleState, "closed");
  assert.equal(sourceSessionCloseProof.closeOk, true);
  assert.equal(sourceSessionCloseProof.promptAfterCloseErrorCode, "relay_session_closed");
  assert.equal(sourceSessionCloseProof.closedSessionLoadAfterRestartLifecycleState, "closed");
  assert.equal(sourceSessionCloseProof.resumeAfterCloseRestartErrorCode, "relay_session_closed");
  assert.equal(sourceSessionCloseProof.promptAfterCloseRestartErrorCode, "relay_session_closed");
} finally {
  await fs.rm(storeRoot, { force: true, recursive: true });
}

const client = new AntigravityAgentApiClient({
  binaryPath,
  address: endpoint.address,
  csrfToken: endpoint.csrfToken
});
const metadataProbe = await client.getConversationMetadata(conversation.id);
assert.ok(metadataProbe?.response?.conversationMetadata);
const afterConversationChange = await waitForConversationChange(beforeConversationSnapshot.conversations, 8000);
const changedConversation = afterConversationChange.changedConversation?.id === conversation.id
  ? afterConversationChange.changedConversation
  : null;
if (changedConversation && beforeConversation?.filePath === changedConversation.filePath) {
  assert.equal(
    changedConversation.mtimeMs > beforeConversation.mtimeMs || changedConversation.size > beforeConversation.size,
    true,
    "Antigravity conversation file should move after Codex source ACP relay prompt when the file is observable."
  );
}
const finalResponseCapabilityProbe = await probeUnsupportedFinalResponseCommands(client);
assert.equal(
  finalResponseCapabilityProbe.some((candidate) => candidate.supported),
  false,
  "Current Antigravity Agent API must not be marked final-response-capable without a supported pull/wait/stream command."
);
assert.equal(
  finalResponseCapabilityProbe.every((candidate) => candidate.error),
  true,
  "Current Antigravity Agent API final-response probes should report why pull/wait/stream is unavailable."
);
const observationTimeoutMs = Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_TIMEOUT_MS || 15000);
const antigravityObservation = await waitForAntigravityConversationObservation({
  conversationId: conversation.id,
  marker,
  afterTranscriptLineCount: beforeConversationObservation.transcriptLineCount,
  afterMessageMtimeMs: beforeConversationObservation.latestMessageMtimeMs,
  timeoutMs: Number.isFinite(observationTimeoutMs) ? observationTimeoutMs : 15000,
  pollIntervalMs: 1000,
  until: "message"
});
assert.equal(
  antigravityObservation.markerMessageObserved,
  true,
  "Antigravity local conversation messages should contain the delegated ACP marker after send-message returns."
);
const proofResult = buildAntigravityRelayProof({
  before: beforeConversation,
  changedConversation,
  localObservation: antigravityObservation,
  metadataProbe,
  minimumProofLevel: minimumAntigravityProofLevel
});
assert.equal(
  proofResult.ok,
  true,
  `Codex source ACP relay prompt must produce target conversation-file or local marker proof. diagnostic=${JSON.stringify({
    changedConversation: afterConversationChange.changedConversation
      ? {
          id: afterConversationChange.changedConversation.id,
          filePath: afterConversationChange.changedConversation.filePath,
          mtimeMs: afterConversationChange.changedConversation.mtimeMs,
          size: afterConversationChange.changedConversation.size
        }
      : null,
    antigravityObservation: redactedObservationForOutput(antigravityObservation),
    metadataProbe: metadataProbe ? "ok" : null
  })}`
);
assert.equal(
  proofResult.proofMeetsMinimum,
  true,
  `Codex source ACP relay prompt must meet the configured Antigravity proof level. diagnostic=${JSON.stringify({
    proof: proofResult.proof,
    proofLevel: proofResult.proofLevel,
    minimumProofLevel: proofResult.minimumProofLevel,
    changedConversation: afterConversationChange.changedConversation
      ? {
          id: afterConversationChange.changedConversation.id,
          filePath: afterConversationChange.changedConversation.filePath,
          mtimeMs: afterConversationChange.changedConversation.mtimeMs,
          size: afterConversationChange.changedConversation.size
        }
      : null,
    antigravityObservation: redactedObservationForOutput(antigravityObservation),
    metadataProbe: metadataProbe ? "ok" : null
  })}`
);
if (process.env.PACT_ACP_RELAY_ANTIGRAVITY_TRANSCRIPT_REQUIRED === "1") {
  assert.equal(
    antigravityObservation.transcriptAdvanced || antigravityObservation.progressAvailable,
    true,
    "Antigravity transcript must advance when transcript observation is required."
  );
}
if (process.env.PACT_ACP_RELAY_ANTIGRAVITY_FINAL_RESPONSE_REQUIRED === "1") {
  assert.equal(
    antigravityObservation.finalResponseAvailable,
    true,
    "Antigravity transcript must expose a likely final natural-language response when final response observation is required."
  );
}
const connectObservation = connectProbeClient
  ? await connectProbeClient.observeConnectTrajectory({
      conversationId: conversation.id,
      marker,
      afterStepCount: beforeConnectObservation?.stepCount || 0,
      timeoutMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_TIMEOUT_MS || 8000)
    }).catch((error) => ({
      error: error.message
    }))
  : null;
const strictConnectFinalObservation = process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FINAL_REQUIRED === "1" && connectProbeClient
  ? await waitForStrictConnectFinalObservation(connectProbeClient, {
      conversationId: conversation.id,
      marker,
      afterStepCount: beforeConnectObservation?.stepCount || 0,
      timeoutMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FINAL_TIMEOUT_MS ||
        process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_TIMEOUT_MS ||
        60000),
      pollIntervalMs: Number(process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_POLL_MS || 1000)
    })
  : null;
const sourceConnectProofs = [
  sourceConnectProofFromPromptResult(firstPrompt.result, "firstPrompt"),
  sourceConnectProofFromPromptResult(prompt.result, "prompt")
];
const bestSourceConnectProof = strongestSourceConnectProof(sourceConnectProofs);
const sourceConnectMinimumProofLevel = defaultSourceConnectMinimumProofLevel({
  connectRequired,
  finalRequired: process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FINAL_REQUIRED === "1",
  denyPendingCommandsRequired: connectDenyPendingCommandsRequired,
  envMinimum: process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_MIN_PROOF_LEVEL
});
const sourceConnectProofAcceptable = sourceConnectProofMeetsMinimum(
  bestSourceConnectProof?.proofLevel,
  sourceConnectMinimumProofLevel
);
if (connectRequired) {
  assert.equal(Boolean(connectObservation && !connectObservation.error), true, "Antigravity Connect trajectory must be observable.");
  assert.equal(
    connectObservation.trajectoryAdvanced ||
      connectObservation.pendingInteraction ||
      prompt.result.targetEvidence?.connectConversationObservation?.trajectoryAdvanced ||
      prompt.result.targetEvidence?.connectConversationObservation?.blockedByPendingInteraction ||
      prompt.result.targetEvidence?.connectConversationObservation?.finalResponseAvailable,
    true,
    "Antigravity Connect observation must show trajectory progress, a pending interaction, or final response evidence."
  );
  assert.equal(
    connectObservation.markerObserved === true,
    true,
    `Antigravity Connect observation must show the delegated prompt marker in the current trajectory. diagnostic=${JSON.stringify({
      connect: redactedConnectObservationForOutput(connectObservation),
      firstSourceConnect: redactedConnectObservationForOutput(firstPrompt.result.targetEvidence?.connectConversationObservation),
      sourceConnect: redactedConnectObservationForOutput(prompt.result.targetEvidence?.connectConversationObservation)
    })}`
  );
  assert.notEqual(
    bestSourceConnectProof?.proofLevel,
    "none",
    `Source-facing ACP prompt result must carry Antigravity Connect evidence for the delegated marker. diagnostic=${JSON.stringify({
      sourceConnectProofs,
      connect: redactedConnectObservationForOutput(connectObservation),
      firstSourceConnect: redactedConnectObservationForOutput(firstPrompt.result.targetEvidence?.connectConversationObservation),
      sourceConnect: redactedConnectObservationForOutput(prompt.result.targetEvidence?.connectConversationObservation)
    })}`
  );
  assert.notEqual(
    bestSourceConnectProof?.proofLevel,
    "connect_marker_only",
    `Source-facing ACP Connect proof must be stronger than a marker-only observation. diagnostic=${JSON.stringify({
      sourceConnectProofs,
      connect: redactedConnectObservationForOutput(connectObservation),
      firstSourceConnect: redactedConnectObservationForOutput(firstPrompt.result.targetEvidence?.connectConversationObservation),
      sourceConnect: redactedConnectObservationForOutput(prompt.result.targetEvidence?.connectConversationObservation)
    })}`
  );
  assert.equal(
    sourceConnectProofAcceptable,
    true,
    `Source-facing ACP Connect proof must meet the configured minimum proof level. diagnostic=${JSON.stringify({
      minimumProofLevel: sourceConnectMinimumProofLevel,
      bestSourceConnectProof,
      sourceConnectProofs,
      connect: redactedConnectObservationForOutput(connectObservation),
      firstSourceConnect: redactedConnectObservationForOutput(firstPrompt.result.targetEvidence?.connectConversationObservation),
      sourceConnect: redactedConnectObservationForOutput(prompt.result.targetEvidence?.connectConversationObservation)
    })}`
  );
}
if (process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FINAL_REQUIRED === "1") {
  const sourceFinalEvidence = [
    firstPrompt.result,
    prompt.result
  ].find((result) =>
    result?.targetEvidence?.finalResponseAvailable === true &&
      result?.targetEvidence?.finalResponsePolicy === "connect_trajectory" &&
      asText(result.output)
  );
  const finalRequiredDiagnostic = {
    strictConnect: redactedConnectObservationForOutput(strictConnectFinalObservation),
    connect: redactedConnectObservationForOutput(connectObservation),
    sourceConnect: redactedConnectObservationForOutput(prompt.result.targetEvidence?.connectConversationObservation),
    localConversation: redactedObservationForOutput(antigravityObservation),
    sourceLocalConversation: redactedObservationForOutput(prompt.result.targetEvidence?.localConversationObservation)
  };
  assert.equal(
    strictConnectFinalObservation?.finalResponseAvailable ||
      connectObservation?.finalResponseAvailable ||
      prompt.result.targetEvidence?.connectConversationObservation?.finalResponseAvailable,
    true,
    `Antigravity Connect trajectory must expose a likely final natural-language response when final response observation is required. diagnostic=${JSON.stringify(finalRequiredDiagnostic)}`
  );
  assert.equal(
    Boolean(sourceFinalEvidence),
    true,
    "At least one source-facing ACP prompt result must receive the Antigravity Connect final response when final response observation is required."
  );
  assert.equal(
    sourceFinalEvidence?.targetEvidence?.finalResponsePolicy,
    "connect_trajectory",
    "Source-facing ACP prompt result must identify Connect trajectory as the final-response source."
  );
  assert.equal(sourceFinalEvidence?.stopReason, "completed");
  assert.equal(Boolean(asText(sourceFinalEvidence?.output)), true, "Source-facing ACP prompt result must expose final output text.");
}
const formalDenyEvidence = [
  firstPrompt.result,
  prompt.result
].map((result) => formalDenyActionEvidence(result));
if (connectDenyPendingCommandsRequired) {
  const formalDenyWithRequestId = formalDenyEvidence.find((candidate) => candidate.requestIdObserved) || null;
  const persistedDenyRequest = formalDenyWithRequestId
    ? persistedPermissionRequests.find((request) =>
        request.requestId === formalDenyWithRequestId.receiptRequestId &&
          request.requestedAction === "terminal" &&
          request.status === "denied" &&
          request.decisionId === "target-interaction-policy"
      )
    : null;
  const formalDenyDiagnostic = JSON.stringify({
    formalDenyEvidence,
    persistedPermissionRequests,
    connect: redactedConnectObservationForOutput(connectObservation),
    sourceConnect: redactedConnectObservationForOutput(prompt.result.targetEvidence?.connectConversationObservation),
    targetEvidence: prompt.result.targetEvidence
  });
  assert.equal(
    formalDenyEvidence.some((candidate) => candidate.actionObserved),
    true,
    `Antigravity Connect formal command-denial action must be observed when pending-command deny verification is required. diagnostic=${formalDenyDiagnostic}`
  );
  assert.equal(
    formalDenyEvidence.some((candidate) => candidate.receiptObserved),
    true,
    `Antigravity Connect formal command-denial receipt must be audited when pending-command deny verification is required. diagnostic=${formalDenyDiagnostic}`
  );
  assert.equal(
    formalDenyEvidence.some((candidate) => candidate.requestIdObserved),
    true,
    `Antigravity Connect command-denial receipt must include a Pact permission request id. diagnostic=${formalDenyDiagnostic}`
  );
  assert.equal(
    formalDenyEvidence.some((candidate) => candidate.sourceReceiptObserved),
    true,
    `Antigravity Connect command-denial receipt must be returned in the source-facing ACP prompt result. diagnostic=${formalDenyDiagnostic}`
  );
  assert.equal(
    formalDenyEvidence.some((candidate) => candidate.auditObserved),
    true,
    `Antigravity Connect command-denial receipt must be tied to the relay turn audit event. diagnostic=${formalDenyDiagnostic}`
  );
  assert.equal(
    Boolean(persistedDenyRequest),
    true,
    `Antigravity Connect command-denial receipt must be persisted as a denied terminal permissionRequest. diagnostic=${formalDenyDiagnostic}`
  );
}

const proofMatrix = buildAcpAgentRelayProofMatrix({
  sourceAgentProof,
  sourceImplementation: "pact-source-stdio-server",
  sourceMode: sourceAgentProof.sourceMode,
  sessionId: sessionNew.result.sessionId,
  loadedSessionId: sessionLoad.result.sessionId,
  resumedSessionId: sessionResume.result.sessionId,
  persistedTargetSessionId: persistedSession.targetSessionId,
  persistedTargetResumeRef: persistedSession.targetResumeRef,
  agentCatalogCount: agentList.result.virtualAgents?.length || 0,
  antigravityProofLevel: proofResult.proofLevel,
  minimumAntigravityProofLevel: proofResult.minimumProofLevel,
  antigravityProofMeetsMinimum: proofResult.proofMeetsMinimum,
  firstResponseKind: firstPrompt.result.responseKind,
  secondResponseKind: prompt.result.responseKind,
  responseKind: prompt.result.responseKind,
  firstCommunicationSummary: firstPrompt.result.communicationSummary,
  secondCommunicationSummary: prompt.result.communicationSummary,
  communicationSummary: prompt.result.communicationSummary,
  sourceTurnObserve: promptObservation.result,
  sourceIdentityIsolationProof,
  sourceSessionCloseProof,
  antigravityIdeCliCapabilitySnapshot: prompt.result.targetEvidence?.agentApiCapabilitySnapshot?.ideCli || null,
  connectRequired,
  sourceConnectProofLevel: bestSourceConnectProof?.proofLevel || "none",
  sourceConnectMinimumProofLevel,
  sourceConnectProofAcceptable
});
assert.equal(
  proofMatrix.allRequiredProofsMet,
  true,
  `Codex/Antigravity relay proof matrix must satisfy every required proof. diagnostic=${JSON.stringify(proofMatrix)}`
);

console.log(
  JSON.stringify(
    {
      ok: true,
      verifier: "acp-agent-relay-codex-antigravity",
      marker,
      conversationId: conversation.id,
      endpoint: endpoint.address,
      endpointSource: endpoint.source,
      connectEndpoint: connectEndpoint ? redactAntigravityConnectEndpoint(connectEndpoint) : null,
      proof: `codex-orchestrated-source-acp-stdio-process-restart-and-${proofResult.proof}`,
      targetCommunicationMode: prompt.result.targetEvidence?.targetCommunicationMode || "",
      nativeAcpTargetSupported: prompt.result.targetEvidence?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: prompt.result.targetEvidence?.nativeAcpTargetVerified === true,
      sourceImplementation: "pact-source-stdio-server",
      sourceMode: sourceAgentProof.sourceMode,
      sourceAgentProof,
      antigravityProofLevel: proofResult.proofLevel,
      minimumAntigravityProofLevel: proofResult.minimumProofLevel,
      antigravityProofMeetsMinimum: proofResult.proofMeetsMinimum,
      metadataProbe: proofResult.metadataProbeDiagnostic,
      delegatedPrompt: Boolean(delegatedPrompt),
      beforeConversation,
      beforeConversationObservation: redactedObservationForOutput(beforeConversationObservation),
      beforeConnectObservation: redactedConnectObservationForOutput(beforeConnectObservation),
      changedConversation: changedConversation
        ? {
            id: changedConversation.id,
            filePath: changedConversation.filePath,
            mtimeMs: changedConversation.mtimeMs,
            size: changedConversation.size
          }
        : null,
      antigravityObservation: redactedObservationForOutput(antigravityObservation),
      connectObservation: redactedConnectObservationForOutput(connectObservation),
      strictConnectFinalObservation: redactedConnectObservationForOutput(strictConnectFinalObservation),
      sourceConnectProofLevel: bestSourceConnectProof?.proofLevel || "none",
      sourceConnectMinimumProofLevel,
      sourceConnectProofAcceptable,
      sourceTurnObserveProofLevel: sourceTurnObserveProof?.proofLevel || "none",
      sourceTurnObserveProofAcceptable: sourceTurnObserveProof?.proofAcceptable === true,
      sourceTurnObserveProof,
      sourceIdentityIsolationProof,
      sourceSessionCloseProof,
      proofMatrix,
      sourceConnectProofs,
      finalResponseCapabilityProbe,
      agentApiCapabilitySnapshot: prompt.result.targetEvidence?.agentApiCapabilitySnapshot || null,
      ideCliCapabilitySnapshot: prompt.result.targetEvidence?.agentApiCapabilitySnapshot?.ideCli || null,
      sessionId: sessionNew.result.sessionId,
      agentCatalogCount: agentList.result.virtualAgents?.length || 0,
      agentCatalog: (agentList.result.virtualAgents || []).map((agent) => ({
        virtualAgentId: agent.virtualAgentId,
        targetId: agent.targetId,
        tools: agent.capabilities?.tools || [],
        dataSources: agent.capabilities?.dataSources || [],
        writes: agent.capabilities?.writes || "",
        terminal: agent.capabilities?.terminal || "",
        maxRisk: agent.capabilities?.maxRisk || "",
        finalResponsePolicy: agent.capabilities?.finalResponse?.policy || "",
        transportType: agent.target?.transportType || "",
        targetCommunicationMode: agent.target?.targetCommunicationMode || "",
        nativeAcpTargetSupported: agent.target?.nativeAcpTargetSupported === true,
        nativeAcpTargetVerified: agent.target?.nativeAcpTargetVerified === true
      })),
      firstTurnId: firstPrompt.result.turnId,
      firstResponseKind: firstPrompt.result.responseKind,
      firstPromptUpdateCount: firstPrompt.notifications.length,
      firstPromptUpdates: notificationSummary(firstPrompt.notifications),
      firstCommunicationSummary: firstPrompt.result.communicationSummary,
      firstTargetEvidence: firstPrompt.result.targetEvidence,
      secondTurnId: prompt.result.turnId,
      secondResponseKind: prompt.result.responseKind,
      secondCommunicationSummary: prompt.result.communicationSummary,
      loadedSessionId: sessionLoad.result.sessionId,
      resumedSessionId: sessionResume.result.sessionId,
      closedSessionId: sourceSessionCloseProof.closedSessionId,
      closeLifecycleState: sourceSessionCloseProof.closeLifecycleState,
      promptAfterCloseErrorCode: sourceSessionCloseProof.promptAfterCloseErrorCode,
      closedSessionLoadAfterRestartLifecycleState: sourceSessionCloseProof.closedSessionLoadAfterRestartLifecycleState,
      resumeAfterCloseRestartErrorCode: sourceSessionCloseProof.resumeAfterCloseRestartErrorCode,
      promptAfterCloseRestartErrorCode: sourceSessionCloseProof.promptAfterCloseRestartErrorCode,
      persistedPermissionRequests: persistedPermissionRequests.map((request) => ({
        requestId: request.requestId,
        relayTurnId: request.relayTurnId,
        targetToolCallId: request.targetToolCallId,
        requestedAction: request.requestedAction,
        status: request.status,
        decisionId: request.decisionId,
        action: request.details?.action || "",
        targetAction: request.details?.targetAction || "",
        connectStepIndex: request.details?.connectStepIndex,
        provider: request.details?.externalInteraction?.provider || ""
      })),
      persistedTargetSessionId: persistedSession.targetSessionId,
      persistedTargetResumeRef: persistedSession.targetResumeRef,
      persistedCapabilitiesSnapshot: persistedSession.capabilitiesSnapshot
        ? {
            virtualAgentId: persistedSession.capabilitiesSnapshot.virtualAgentId,
            transportType: persistedSession.capabilitiesSnapshot.target?.transportType || "",
            targetCommunicationMode: persistedSession.capabilitiesSnapshot.target?.targetCommunicationMode || "",
            nativeAcpTargetSupported: persistedSession.capabilitiesSnapshot.target?.nativeAcpTargetSupported === true,
            nativeAcpTargetVerified: persistedSession.capabilitiesSnapshot.target?.nativeAcpTargetVerified === true,
            tools: persistedSession.capabilitiesSnapshot.capabilities?.tools || [],
            finalResponsePolicy: persistedSession.capabilitiesSnapshot.capabilities?.finalResponse?.policy || ""
          }
        : null,
      turnId: prompt.result.turnId,
      responseKind: prompt.result.responseKind,
      updateCount: prompt.notifications.length,
      updates: notificationSummary(prompt.notifications),
      communicationSummary: prompt.result.communicationSummary,
      sourceTurnObserve: {
        relaySessionId: promptObservation.result.relaySessionId,
        relayTurnId: promptObservation.result.relayTurnId,
        observed: promptObservation.result.observed,
        refreshed: promptObservation.result.refreshed,
        stopReason: promptObservation.result.stopReason,
        responseKind: promptObservation.result.responseKind,
        outputSummary: promptObservation.result.outputSummary,
        communicationSummary: promptObservation.result.communicationSummary,
        turn: promptObservation.result.turn,
        targetObservation: promptObservation.result.targetObservation
      },
      formalDenyEvidence,
      targetEvidence: prompt.result.targetEvidence
    },
    null,
    2
  )
);
