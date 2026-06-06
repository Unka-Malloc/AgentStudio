import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_BINARY_CANDIDATES = Object.freeze([
  "/Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm",
  "/Applications/Antigravity.app/Contents/Resources/bin/language_server",
  path.join(process.env.HOME || "", ".gemini/antigravity/bin/agentapi")
]);

const DEFAULT_IDE_CLI_CANDIDATES = Object.freeze([
  path.join(process.env.HOME || "", ".antigravity-ide/antigravity-ide/bin/antigravity-ide"),
  "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
  "/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity-ide",
  "antigravity-ide",
  "agy-ide"
]);

const DEFAULT_AGENTAPI_COMMANDS = Object.freeze([
  "get-conversation-metadata",
  "new-conversation",
  "send-message"
]);

const FINAL_RESPONSE_COMMANDS = Object.freeze([
  "get-conversation",
  "get-conversation-messages",
  "wait-for-response",
  "stream-conversation"
]);

const ANTIGRAVITY_CONNECT_SERVICE_PATH = "/exa.language_server_pb.LanguageServerService";

const ANTIGRAVITY_CONNECT_STATUS_COMPLETED = new Set([
  "CASCADE_RUN_STATUS_DONE",
  "CASCADE_RUN_STATUS_COMPLETED",
  "CASCADE_RUN_STATUS_FINISHED",
  "CASCADE_RUN_STATUS_IDLE"
]);

const ANTIGRAVITY_CONNECT_STATUS_FAILED = new Set([
  "CASCADE_RUN_STATUS_CANCELLED",
  "CASCADE_RUN_STATUS_ERRORED",
  "CASCADE_RUN_STATUS_FAILED"
]);

const ANTIGRAVITY_TRANSCRIPT_NATURAL_RESPONSE_TYPES = Object.freeze([
  "PLANNER_RESPONSE"
]);

const ANTIGRAVITY_FINAL_RESPONSE_PATTERNS = Object.freeze([
  /\b(done|completed|finished|summary|all tests pass(?:ed)?)\b/i,
  /^收到(?:\s+Pact ACP Relay 验证)?[。.!！?？]*$/u,
  /已完成|完成了|已经完成|改动汇总|测试通过|全部通过|补充完成/u
]);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asBoolean(value, fallback = false) {
  if (value === true || value === "1" || value === "true" || value === "yes") {
    return true;
  }
  if (value === false || value === "0" || value === "false" || value === "no") {
    return false;
  }
  return fallback;
}

function extractJsonPayload(text = "") {
  const output = asText(text);
  if (!output) {
    return null;
  }
  const attempt = (candidate) => {
    if (!candidate) {
      return null;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };
  const direct = attempt(output);
  if (direct !== null) {
    return direct;
  }
  const braceStart = output.indexOf("{");
  const braceEnd = output.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    const payload = attempt(output.slice(braceStart, braceEnd + 1));
    if (payload !== null) {
      return payload;
    }
  }
  const bracketStart = output.indexOf("[");
  const bracketEnd = output.lastIndexOf("]");
  if (bracketStart >= 0 && bracketEnd > bracketStart) {
    const payload = attempt(output.slice(bracketStart, bracketEnd + 1));
    if (payload !== null) {
      return payload;
    }
  }
  return null;
}

function extractTextFromPayload(payload = {}) {
  const input = asObject(payload);
  const candidates = [
    input.text,
    input.message,
    input.content,
    input.response,
    input.output,
    input.summary
  ];
  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text) {
      return text;
    }
  }
  const responses = asArray(input.responses);
  for (let index = responses.length - 1; index >= 0; index -= 1) {
    const response = asObject(responses[index]);
    const text = asText(response.text || response.message || response.content || response.output);
    if (text) {
      return text;
    }
  }
  return "";
}

function extractReferenceFromText(text = "", labels = []) {
  const source = asText(text);
  if (!source) {
    return "";
  }
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:=]\\s*([^\\s,;]+)`, "i");
    const match = source.match(pattern);
    if (match?.[1]) {
      return asText(match[1]);
    }
  }
  return "";
}

export function normalizeAntigravityAgentApiResponse(response = {}, { stdout = "", stderr = "" } = {}) {
  const payload = asObject(response.response || response);
  const conversationId = asText(
    payload.conversationId ||
      payload.conversation_id ||
      payload.recipientId ||
      payload.recipient_id ||
      payload.id ||
      payload.threadId ||
      payload.thread_id ||
      payload.metadata?.conversationId ||
      payload.metadata?.conversation_id ||
      extractReferenceFromText(payload.text || stdout || stderr, [
        "conversation_id",
        "conversation id",
        "conversation",
        "thread_id",
        "thread id",
        "recipient_id",
        "recipient id"
      ])
  );
  const recipientId = asText(
    payload.recipientId ||
      payload.recipient_id ||
      payload.recipient ||
      payload.conversationRecipientId ||
      payload.metadata?.recipientId ||
      payload.metadata?.recipient_id ||
      extractReferenceFromText(payload.text || stdout || stderr, [
        "recipient_id",
        "recipient id",
        "conversation_id",
        "conversation id",
        "thread_id",
        "thread id"
      ]) ||
      conversationId
  );
  const model = asText(payload.model || payload.selectedModel || payload.metadata?.model || "");
  const text = extractTextFromPayload(payload) || asText(stdout || stderr || response.text || "");
  const stopReason = asText(
    payload.stopReason || payload.stop_reason || payload.status || payload.state || (payload.error ? "error" : "completed")
  );
  const reasoning = asArray(payload.reasoning || payload.reasoningTraces || payload.reasoning_trace || payload.thoughts);
  const events = asArray(payload.events || payload.updates);

  return {
    conversationId,
    recipientId,
    model,
    text,
    stopReason,
    reasoning,
    events,
    raw: payload,
    stdout: asText(stdout),
    stderr: asText(stderr)
  };
}

async function pathExists(candidate = "") {
  if (!candidate) {
    return false;
  }
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function normalizedSnippet(value = "", maxLength = 280) {
  const text = asText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function shellQuote(value = "") {
  return `'${asText(value).replace(/'/g, "'\\''")}'`;
}

function parseAntigravityIdeVersion(helpText = "") {
  return asText(asText(helpText).match(/Antigravity IDE\s+([^\r\n]+)/i)?.[1]);
}

function parseAntigravityIdeSubcommands(helpText = "") {
  const commands = [];
  let inSubcommands = false;
  for (const rawLine of asText(helpText).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (/^Subcommands/i.test(line.trim())) {
      inSubcommands = true;
      continue;
    }
    if (!inSubcommands) {
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^\s{2,}([a-z][a-z-]+)\s{2,}/i);
    if (match?.[1]) {
      commands.push(match[1]);
    }
  }
  return [...new Set(commands)];
}

function nativeAcpCommandNamesFromHelp(helpText = "") {
  return parseAntigravityIdeSubcommands(helpText)
    .filter((command) => /(^|[-_])(acp|agent-client-protocol)([-_]|$)/i.test(command));
}

function parseJsonLine(line = "", lineIndex = 0) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return {
      parseError: error.message,
      raw: line,
      lineIndex
    };
  }
}

function normalizeTranscriptEntry(entry = {}, lineIndex = 0) {
  const payload = asObject(entry);
  const content =
    typeof payload.content === "string"
      ? payload.content
      : payload.content === null || payload.content === undefined
        ? ""
        : JSON.stringify(payload.content);
  const error =
    typeof payload.error === "string"
      ? payload.error
      : payload.error === null || payload.error === undefined
        ? ""
        : JSON.stringify(payload.error);
  return {
    lineIndex,
    stepIndex: Number.isFinite(Number(payload.step_index)) ? Number(payload.step_index) : null,
    source: asText(payload.source),
    type: asText(payload.type),
    status: asText(payload.status),
    createdAt: asText(payload.created_at || payload.createdAt),
    content,
    error,
    contentPreview: normalizedSnippet(content || error),
    errorPreview: normalizedSnippet(error),
    hasThinking: Boolean(payload.thinking),
    toolCallCount: asArray(payload.tool_calls || payload.toolCalls).length,
    parseError: asText(payload.parseError)
  };
}

function isNaturalAntigravityTranscriptEntry(entry = {}) {
  const content = asText(entry.content);
  return (
    entry.source === "MODEL" &&
    entry.status === "DONE" &&
    ANTIGRAVITY_TRANSCRIPT_NATURAL_RESPONSE_TYPES.includes(entry.type) &&
    content &&
    content !== "null"
  );
}

function isLikelyFinalAntigravityText(text = "") {
  const content = asText(text);
  return Boolean(content && ANTIGRAVITY_FINAL_RESPONSE_PATTERNS.some((pattern) => pattern.test(content)));
}

function errorTextForObservation(entry = {}) {
  return asText(entry.errorPreview || entry.contentPreview || entry.error || entry.content);
}

function latestReadableError(entries = []) {
  return latestFrom(entries, (entry) => Boolean(errorTextForObservation(entry)));
}

function resolveAntigravityBrainRoot({ brainRoot = "", env = process.env, homeDir = "" } = {}) {
  const configured = asText(brainRoot || env.PACT_ACP_RELAY_ANTIGRAVITY_BRAIN_ROOT || env.ANTIGRAVITY_BRAIN_ROOT);
  if (configured) {
    return configured;
  }
  const rootHome = asText(homeDir || env.HOME || process.env.HOME);
  return rootHome ? path.join(rootHome, ".gemini/antigravity-ide/brain") : "";
}

export function resolveAntigravityConversationBrainPath(conversationId = "", options = {}) {
  const id = asText(conversationId || options.conversationId);
  if (!id) {
    return "";
  }
  const root = resolveAntigravityBrainRoot(options);
  return root ? path.join(root, id) : "";
}

export function resolveAntigravityTranscriptPath(conversationId = "", options = {}) {
  const explicit = asText(options.transcriptPath);
  if (explicit) {
    return explicit;
  }
  const brainPath = resolveAntigravityConversationBrainPath(conversationId, options);
  return brainPath ? path.join(brainPath, ".system_generated/logs/transcript.jsonl") : "";
}

export function resolveAntigravityMessagesDir(conversationId = "", options = {}) {
  const explicit = asText(options.messagesDir);
  if (explicit) {
    return explicit;
  }
  const brainPath = resolveAntigravityConversationBrainPath(conversationId, options);
  return brainPath ? path.join(brainPath, ".system_generated/messages") : "";
}

export async function readAntigravityTranscriptEntries({
  conversationId = "",
  transcriptPath = "",
  brainRoot = "",
  env = process.env,
  homeDir = "",
  maxEntries = 0
} = {}) {
  const filePath = resolveAntigravityTranscriptPath(conversationId, {
    transcriptPath,
    brainRoot,
    env,
    homeDir
  });
  if (!filePath || !(await pathExists(filePath))) {
    return {
      transcriptPath: filePath,
      lineCount: 0,
      entries: []
    };
  }
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const selectedLines = maxEntries > 0 ? lines.slice(-maxEntries) : lines;
  const lineOffset = lines.length - selectedLines.length;
  return {
    transcriptPath: filePath,
    lineCount: lines.length,
    entries: selectedLines.map((line, index) =>
      normalizeTranscriptEntry(parseJsonLine(line, lineOffset + index), lineOffset + index)
    )
  };
}

export async function readAntigravityConversationMessages({
  conversationId = "",
  messagesDir = "",
  brainRoot = "",
  env = process.env,
  homeDir = "",
  maxEntries = 0
} = {}) {
  const dirPath = resolveAntigravityMessagesDir(conversationId, {
    messagesDir,
    brainRoot,
    env,
    homeDir
  });
  if (!dirPath || !(await pathExists(dirPath))) {
    return {
      messagesDir: dirPath,
      messageCount: 0,
      messages: []
    };
  }
  const entries = await fs.readdir(dirPath).catch(() => []);
  const messages = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry === "read.json" || entry === "cursor.json") {
      continue;
    }
    const filePath = path.join(dirPath, entry);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      continue;
    }
    const payload = await fs.readFile(filePath, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    if (!payload) {
      continue;
    }
    const content = asText(payload.content || payload.text || payload.message);
    messages.push({
      id: asText(payload.id || entry.replace(/\.json$/u, "")),
      filePath,
      sender: asText(payload.sender),
      recipient: asText(payload.recipient),
      priority: asText(payload.priority),
      timestamp: asText(payload.timestamp),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      content,
      contentPreview: normalizedSnippet(content)
    });
  }
  messages.sort((a, b) => a.mtimeMs - b.mtimeMs || a.filePath.localeCompare(b.filePath));
  const selectedMessages = maxEntries > 0 ? messages.slice(-maxEntries) : messages;
  return {
    messagesDir: dirPath,
    messageCount: messages.length,
    messages: selectedMessages
  };
}

export function summarizeAntigravityConversationObservation({
  conversationId = "",
  marker = "",
  transcript = {},
  messages = {},
  afterTranscriptLineCount = 0,
  afterMessageMtimeMs = 0
} = {}) {
  const markerText = asText(marker);
  const transcriptEntries = asArray(transcript.entries);
  const conversationMessages = asArray(messages.messages);
  const messageMatches = markerText
    ? conversationMessages.filter((message) => (
        message.mtimeMs > Number(afterMessageMtimeMs || 0) &&
        asText(message.content).includes(markerText)
      ))
    : [];
  const markerTranscriptEntry = markerText
    ? transcriptEntries.find((entry) => asText(entry.content).includes(markerText))
    : null;
  const minimumLineIndex = markerTranscriptEntry
    ? Number(markerTranscriptEntry.lineIndex) + 1
    : Math.max(0, Number(afterTranscriptLineCount || 0));
  const naturalEntries = transcriptEntries
    .filter((entry) => Number(entry.lineIndex) >= minimumLineIndex)
    .filter(isNaturalAntigravityTranscriptEntry);
  const finalEntries = naturalEntries.filter((entry) => isLikelyFinalAntigravityText(entry.content));
  const errorEntries = transcriptEntries
    .filter((entry) => Number(entry.lineIndex) >= minimumLineIndex)
    .filter((entry) => entry.type === "ERROR_MESSAGE" || Boolean(entry.error));
  const knownErrorEntries = errorEntries;
  const latestProgress = naturalEntries.at(-1) || null;
  const latestFinal = finalEntries.at(-1) || null;
  const latestError = errorEntries.at(-1) || null;
  const latestKnownError = latestReadableError(knownErrorEntries);
  const latestTranscriptEntry = transcriptEntries.at(-1) || null;
  const latestMessage = conversationMessages.at(-1) || null;
  const latestMarkerMessage = messageMatches.at(-1) || null;
  return {
    conversationId: asText(conversationId),
    transcriptPath: asText(transcript.transcriptPath),
    messagesDir: asText(messages.messagesDir),
    transcriptLineCount: Number(transcript.lineCount || transcriptEntries.length || 0),
    messageCount: Number(messages.messageCount || conversationMessages.length || 0),
    afterTranscriptLineCount: Number(afterTranscriptLineCount || 0),
    afterMessageMtimeMs: Number(afterMessageMtimeMs || 0),
    markerObserved: Boolean(messageMatches.length > 0 || markerTranscriptEntry),
    markerMessageObserved: messageMatches.length > 0,
    markerTranscriptObserved: Boolean(markerTranscriptEntry),
    markerMessageCount: messageMatches.length,
    transcriptAdvanced: Number(transcript.lineCount || transcriptEntries.length || 0) > Number(afterTranscriptLineCount || 0),
    latestMessageMtimeMs: Number(latestMessage?.mtimeMs || 0),
    progressAvailable: Boolean(latestProgress),
    finalResponseAvailable: Boolean(latestFinal),
    errorAvailable: Boolean(latestError),
    knownErrorAvailable: Boolean(latestKnownError),
    latestMessage: latestMessage
      ? {
          id: latestMessage.id,
          filePath: latestMessage.filePath,
          sender: latestMessage.sender,
          recipient: latestMessage.recipient,
          timestamp: latestMessage.timestamp,
          mtimeMs: latestMessage.mtimeMs,
          contentPreview: latestMessage.contentPreview
        }
      : null,
    latestProgress: latestProgress
      ? {
          lineIndex: latestProgress.lineIndex,
          stepIndex: latestProgress.stepIndex,
          createdAt: latestProgress.createdAt,
          text: latestProgress.content,
          textPreview: latestProgress.contentPreview
        }
      : null,
    latestFinalResponse: latestFinal
      ? {
          lineIndex: latestFinal.lineIndex,
          stepIndex: latestFinal.stepIndex,
          createdAt: latestFinal.createdAt,
          text: latestFinal.content,
          textPreview: latestFinal.contentPreview
        }
      : null,
    latestError: latestError
      ? {
          lineIndex: latestError.lineIndex,
          stepIndex: latestError.stepIndex,
          source: latestError.source,
          type: latestError.type,
          status: latestError.status,
          createdAt: latestError.createdAt,
          errorPreview: latestError.errorPreview || latestError.contentPreview,
          contentPreview: latestError.contentPreview
        }
      : null,
    latestKnownError: latestKnownError
      ? {
          lineIndex: latestKnownError.lineIndex,
          stepIndex: latestKnownError.stepIndex,
          source: latestKnownError.source,
          type: latestKnownError.type,
          status: latestKnownError.status,
          createdAt: latestKnownError.createdAt,
          errorPreview: latestKnownError.errorPreview || latestKnownError.contentPreview,
          contentPreview: latestKnownError.contentPreview
        }
      : null,
    latestTranscriptEntry: latestTranscriptEntry
      ? {
          lineIndex: latestTranscriptEntry.lineIndex,
          stepIndex: latestTranscriptEntry.stepIndex,
          source: latestTranscriptEntry.source,
          type: latestTranscriptEntry.type,
          status: latestTranscriptEntry.status,
          createdAt: latestTranscriptEntry.createdAt,
          errorPreview: latestTranscriptEntry.errorPreview,
          contentPreview: latestTranscriptEntry.contentPreview
        }
      : null,
    latestMarkerMessage: latestMarkerMessage
      ? {
          id: latestMarkerMessage.id,
          filePath: latestMarkerMessage.filePath,
          sender: latestMarkerMessage.sender,
          recipient: latestMarkerMessage.recipient,
          timestamp: latestMarkerMessage.timestamp,
          mtimeMs: latestMarkerMessage.mtimeMs,
          contentPreview: latestMarkerMessage.contentPreview
        }
      : null
  };
}

export async function observeAntigravityConversation({
  conversationId = "",
  marker = "",
  transcriptPath = "",
  messagesDir = "",
  brainRoot = "",
  env = process.env,
  homeDir = "",
  afterTranscriptLineCount = 0,
  afterMessageMtimeMs = 0,
  maxTranscriptEntries = 0,
  maxMessageEntries = 0
} = {}) {
  const [transcript, messages] = await Promise.all([
    readAntigravityTranscriptEntries({
      conversationId,
      transcriptPath,
      brainRoot,
      env,
      homeDir,
      maxEntries: maxTranscriptEntries
    }),
    readAntigravityConversationMessages({
      conversationId,
      messagesDir,
      brainRoot,
      env,
      homeDir,
      maxEntries: maxMessageEntries
    })
  ]);
  return summarizeAntigravityConversationObservation({
    conversationId,
    marker,
    transcript,
    messages,
    afterTranscriptLineCount,
    afterMessageMtimeMs
  });
}

export async function waitForAntigravityConversationObservation({
  timeoutMs = 12000,
  pollIntervalMs = 1000,
  until = "progress",
  ...options
} = {}) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  const satisfied = (observation) => {
    switch (asText(until, "progress")) {
      case "final":
        return observation.finalResponseAvailable === true;
      case "message":
        return observation.markerMessageObserved === true || observation.markerObserved === true;
      case "transcript":
        return observation.transcriptAdvanced === true || observation.markerTranscriptObserved === true;
      case "progress":
      default:
        return observation.progressAvailable === true || observation.finalResponseAvailable === true;
    }
  };
  let latest = await observeAntigravityConversation(options);
  while (!satisfied(latest) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(pollIntervalMs || 1000))));
    latest = await observeAntigravityConversation(options);
  }
  return latest;
}

async function shellWrapperTarget(candidate = "") {
  if (!candidate.endsWith("agentapi")) {
    return "";
  }
  const text = await fs.readFile(candidate, "utf8").catch(() => "");
  if (!text.startsWith("#!")) {
    return "";
  }
  const match =
    text.match(/^\s*exec\s+"([^"]+)"\s+agentapi\b/m) ||
    text.match(/^\s*exec\s+'([^']+)'\s+agentapi\b/m) ||
    text.match(/^\s*exec\s+(\S+)\s+agentapi\b/m);
  return asText(match?.[1]);
}

async function isUsableBinaryCandidate(candidate = "") {
  if (!(await pathExists(candidate))) {
    return false;
  }
  const wrapperTarget = await shellWrapperTarget(candidate);
  if (wrapperTarget && !(await pathExists(wrapperTarget))) {
    return false;
  }
  return true;
}

export async function resolveAntigravityAgentApiBinary({ binaryPath = "", env = process.env } = {}) {
  const candidates = [
    asText(binaryPath),
    asText(env.PACT_ACP_RELAY_ANTIGRAVITY_BINARY),
    asText(env.ANTIGRAVITY_LANGUAGE_SERVER_BINARY),
    asText(env.ANTIGRAVITY_AGENTAPI_BINARY),
    ...DEFAULT_BINARY_CANDIDATES
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await isUsableBinaryCandidate(candidate)) {
      return candidate;
    }
  }
  return candidates[0] || "";
}

export async function resolveAntigravityIdeCliBinary({ binaryPath = "", env = process.env, run = runText } = {}) {
  const candidates = [
    asText(binaryPath),
    asText(env.PACT_ACP_RELAY_ANTIGRAVITY_IDE_CLI),
    asText(env.ANTIGRAVITY_IDE_CLI),
    asText(env.ANTIGRAVITY_CLI),
    ...DEFAULT_IDE_CLI_CANDIDATES
  ].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (candidate.includes("/") && await pathExists(candidate)) {
      return candidate;
    }
    if (!candidate.includes("/")) {
      const resolved = await run("sh", ["-lc", `command -v ${shellQuote(candidate)}`], { env })
        .catch(() => "");
      if (resolved) {
        return resolved.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || candidate;
      }
    }
  }
  return "";
}

export async function probeAntigravityIdeCliCapabilities({
  binaryPath = "",
  env = process.env,
  timeoutMs = 3000,
  run = runText
} = {}) {
  const cliPath = await resolveAntigravityIdeCliBinary({ binaryPath, env, run });
  const checkedCommands = ["--help", "chat --help"];
  if (!cliPath) {
    return {
      provider: "antigravity-ide-cli",
      found: false,
      cliPath: "",
      version: "",
      checkedCommands,
      subcommands: [],
      chatCommandSupported: false,
      chatReadsStdin: false,
      chatIsAcpTransport: false,
      mcpConfigSupported: false,
      nativeAcpCommandNames: [],
      nativeAcpTransportSupported: false,
      nativeAcpTargetVerified: false,
      nativeAcpSourceVerified: false,
      reasonCode: "antigravity_ide_cli_not_found"
    };
  }
  const runOptions = { env, timeout: Number(timeoutMs) || 3000 };
  const helpText = await run(cliPath, ["--help"], runOptions)
    .catch((error) => asText(error.stdout || error.stderr || error.message));
  const chatHelpText = await run(cliPath, ["chat", "--help"], runOptions)
    .catch((error) => asText(error.stdout || error.stderr || error.message));
  const subcommands = parseAntigravityIdeSubcommands(helpText);
  const nativeAcpCommandNames = nativeAcpCommandNamesFromHelp(helpText);
  const nativeAcpText = `${helpText}\n${chatHelpText}`;
  const nativeAcpTransportSupported = nativeAcpCommandNames.length > 0 ||
    /\b(agent client protocol|agent-client-protocol|ACP JSON-RPC|JSON-RPC ACP|ACP stdio|stdio ACP)\b/i.test(nativeAcpText);
  const chatCommandSupported = subcommands.includes("chat") || /Usage:\s+\S+\s+chat\b/i.test(chatHelpText);
  const chatReadsStdin = /To read from stdin/i.test(chatHelpText);
  return {
    provider: "antigravity-ide-cli",
    found: true,
    cliPath,
    version: parseAntigravityIdeVersion(helpText),
    checkedCommands,
    subcommands,
    chatCommandSupported,
    chatReadsStdin,
    chatIsAcpTransport: nativeAcpTransportSupported && /\bchat\b/i.test(nativeAcpCommandNames.join(" ")),
    mcpConfigSupported: /--add-mcp|Model Context Protocol/i.test(helpText),
    nativeAcpCommandNames,
    nativeAcpTransportSupported,
    nativeAcpTargetVerified: false,
    nativeAcpSourceVerified: false,
    reasonCode: nativeAcpTransportSupported
      ? "native_acp_command_advertised_unverified"
      : "native_acp_command_not_advertised"
  };
}

export function normalizeAntigravityAgentApiConfig(options = {}, env = process.env) {
  const raw = asObject(options);
  return {
    binaryPath: asText(raw.binaryPath || raw.commandPath || raw.command),
    ideCliPath: asText(
      raw.ideCliPath ||
        raw.antigravityIdeCliPath ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_IDE_CLI ||
        env.ANTIGRAVITY_IDE_CLI ||
        env.ANTIGRAVITY_CLI
    ),
    address: asText(
      raw.address ||
        raw.lsAddress ||
        raw.url ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_LS_ADDRESS ||
        env.ANTIGRAVITY_LS_ADDRESS ||
        env.ANTIGRAVITY_AGENTAPI_ADDRESS
    ),
    csrfToken: asText(
      raw.csrfToken ||
        raw.token ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN ||
        env.ANTIGRAVITY_CSRF_TOKEN ||
        env.ANTIGRAVITY_AGENTAPI_CSRF_TOKEN
    ),
    model: asText(raw.model || env.PACT_ACP_RELAY_ANTIGRAVITY_MODEL || env.ANTIGRAVITY_AGENTAPI_MODEL || "flash"),
    conversationId: asText(raw.conversationId || raw.recipientId || env.PACT_ACP_RELAY_ANTIGRAVITY_CONVERSATION_ID || env.ANTIGRAVITY_CONVERSATION_ID),
    timeoutMs: asNumber(raw.timeoutMs || env.PACT_ACP_RELAY_ANTIGRAVITY_TIMEOUT_MS, 120000),
    localObservationEnabled: raw.localObservationEnabled === true ||
      raw.observeLocalConversation === true ||
      env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_LOCAL === "1",
    localObservationTimeoutMs: asNumber(
      raw.localObservationTimeoutMs || raw.observationTimeoutMs || env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_TIMEOUT_MS,
      12000
    ),
    localObservationPollIntervalMs: asNumber(
      raw.localObservationPollIntervalMs || raw.observationPollIntervalMs || env.PACT_ACP_RELAY_ANTIGRAVITY_OBSERVE_POLL_MS,
      1000
    ),
    localObservationBrainRoot: asText(
      raw.localObservationBrainRoot ||
        raw.brainRoot ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_BRAIN_ROOT ||
        env.ANTIGRAVITY_BRAIN_ROOT
    ),
    connectEnabled: asBoolean(
      raw.connectEnabled ??
        raw.connectObservationEnabled ??
        raw.observeConnectConversation ??
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ENABLED ??
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE,
      false
    ),
    connectAddress: asText(
      raw.connectAddress ||
        raw.rpcAddress ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ADDRESS ||
        env.ANTIGRAVITY_CONNECT_ADDRESS ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_RPC_ADDRESS
    ),
    connectCsrfToken: asText(
      raw.connectCsrfToken ||
        raw.rpcCsrfToken ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_CSRF_TOKEN ||
        env.ANTIGRAVITY_CONNECT_CSRF_TOKEN ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN ||
        env.ANTIGRAVITY_CSRF_TOKEN
    ),
    connectTimeoutMs: asNumber(
      raw.connectTimeoutMs || raw.rpcTimeoutMs || env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_TIMEOUT_MS,
      8000
    ),
    connectObservationTimeoutMs: asNumber(
      raw.connectObservationTimeoutMs ||
        raw.connectObserveTimeoutMs ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_TIMEOUT_MS,
      12000
    ),
    connectObservationPollIntervalMs: asNumber(
      raw.connectObservationPollIntervalMs ||
        raw.connectObservePollIntervalMs ||
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_OBSERVE_POLL_MS,
      1000
    ),
    connectWaitForFinalResponse: asBoolean(
      raw.connectWaitForFinalResponse ??
        raw.waitForConnectFinalResponse ??
        raw.connectWaitForFinal ??
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_WAIT_FOR_FINAL,
      true
    ),
    connectFlushQueuedMessages: asBoolean(
      raw.connectFlushQueuedMessages ??
        raw.flushQueuedMessages ??
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FLUSH_QUEUE,
      false
    ),
    connectDenyPendingCommandInteractions: asBoolean(
      raw.connectDenyPendingCommandInteractions ??
        raw.connectDenyPendingCommandInteraction ??
        raw.denyPendingCommandInteractions ??
        raw.denyPendingCommandInteraction ??
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_DENY_PENDING_COMMANDS,
      false
    ),
    connectForceStopStuckCascade: asBoolean(
      raw.connectForceStopStuckCascade ??
        raw.forceStopStuckCascade ??
        env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FORCE_STOP_STUCK,
      false
    ),
    cwd: asText(raw.cwd || env.PACT_ACP_RELAY_ANTIGRAVITY_CWD || process.cwd())
  };
}

export function extractAntigravityConversationId(response = {}) {
  const payload = asObject(response.response || response);
  const direct = asText(
    payload.conversationId ||
      payload.conversation_id ||
      payload.recipientId ||
      payload.recipient_id ||
      payload?.sendMessage?.recipientId ||
      payload?.sendMessage?.recipient_id ||
      extractReferenceFromText(payload.text || payload.message || payload.content || payload.output, [
        "conversation_id",
        "conversation id",
        "conversation",
        "thread_id",
        "thread id",
        "recipient_id",
        "recipient id"
      ])
  );
  if (direct) {
    return direct;
  }
  const metadata = payload.conversationMetadata?.metadata || payload.metadata;
  return asText(metadata?.conversationId || metadata?.conversation_id || metadata?.id);
}

export function workspaceFlagForRoot(root = "") {
  return `file_${asText(root).replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/g, "")}`;
}

export function extractAntigravityCsrfToken(commandLine = "") {
  return asText(
    commandLine.match(/--csrf_token\s+(\S+)/)?.[1] ||
      commandLine.match(/--csrf_token=(\S+)/)?.[1]
  );
}

async function runText(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    ...options,
    maxBuffer: options.maxBuffer || 4 * 1024 * 1024
  });
  return asText(result.stdout || result.stderr);
}

export async function listAntigravityLanguageServers({ run = runText } = {}) {
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

export async function listAntigravityListenPorts(pid, { run = runText } = {}) {
  const output = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-p", String(pid)]).catch(() => "");
  const ports = new Set();
  for (const match of output.matchAll(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/g)) {
    ports.add(match[1]);
  }
  return [...ports].sort((a, b) => Number(a) - Number(b));
}

function normalizeAntigravityConnectAddress(address = "") {
  const raw = asText(address);
  if (!raw) {
    return null;
  }
  const endpoint = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(endpoint);
  const protocol = parsed.protocol || "https:";
  return {
    protocol,
    hostname: parsed.hostname || "127.0.0.1",
    port: parsed.port || (protocol === "https:" ? "443" : "80"),
    basePath: parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/u, "") : "",
    address: `${parsed.hostname || "127.0.0.1"}:${parsed.port || (protocol === "https:" ? "443" : "80")}`
  };
}

export function redactAntigravityConnectEndpoint(endpoint = {}) {
  const input = asObject(endpoint);
  return {
    address: asText(input.address),
    source: asText(input.source),
    protocol: asText(input.protocol || "connect-json"),
    tls: input.tls !== false,
    hasCsrfToken: Boolean(asText(input.csrfToken))
  };
}

export async function callAntigravityConnectRpc({
  address = "",
  csrfToken = "",
  method = "",
  body = {},
  timeoutMs = 8000
} = {}) {
  const endpoint = normalizeAntigravityConnectAddress(address);
  const rpcMethod = asText(method);
  const token = asText(csrfToken);
  if (!endpoint) {
    throw new Error("Antigravity Connect RPC requires a local address.");
  }
  if (!token) {
    throw new Error("Antigravity Connect RPC requires a CSRF token.");
  }
  if (!rpcMethod) {
    throw new Error("Antigravity Connect RPC requires a method.");
  }
  if (endpoint.protocol !== "https:") {
    throw new Error("Antigravity Connect RPC currently requires an HTTPS endpoint.");
  }

  const payload = JSON.stringify(asObject(body));
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: endpoint.hostname,
      port: endpoint.port,
      method: "POST",
      rejectUnauthorized: false,
      path: `${endpoint.basePath}${ANTIGRAVITY_CONNECT_SERVICE_PATH}/${rpcMethod}`,
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "x-codeium-csrf-token": token,
        "content-length": Buffer.byteLength(payload)
      }
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        const parsed = extractJsonPayload(text);
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
          method: rpcMethod,
          body: parsed === null ? {} : parsed,
          rawText: asText(text)
        });
      });
    });
    request.setTimeout(asNumber(timeoutMs, 8000), () => {
      request.destroy(new Error(`Antigravity Connect RPC ${rpcMethod} timed out.`));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

function extractAntigravityConnectError(result = {}) {
  const body = asObject(result.body);
  return asText(body.message || body.error || result.rawText || `HTTP ${result.statusCode || 0}`);
}

function assertAntigravityConnectOk(result = {}, method = "") {
  if (result.ok) {
    return result;
  }
  throw new Error(`Antigravity Connect RPC ${asText(method || result.method)} failed: ${extractAntigravityConnectError(result)}`);
}

function parseToolArgumentsJson(text = "") {
  const raw = asText(text);
  if (!raw) {
    return {};
  }
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

function maybeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function latestFrom(items = [], predicate = () => true) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return items[index];
    }
  }
  return null;
}

function normalizeConnectRunCommand(step = {}) {
  const runCommand = objectOrNull(step.runCommand);
  if (!runCommand) {
    return null;
  }
  return {
    commandLine: asText(runCommand.commandLine),
    proposedCommandLine: asText(runCommand.proposedCommandLine),
    cwd: asText(runCommand.cwd),
    waitMsBeforeAsync: maybeNumber(runCommand.waitMsBeforeAsync, null),
    blocking: runCommand.blocking === true
  };
}

function normalizeConnectRequestedInteraction(step = {}) {
  const requestedInteraction = objectOrNull(step.requestedInteraction);
  if (!requestedInteraction) {
    return null;
  }
  const permission = objectOrNull(requestedInteraction.permission);
  if (permission) {
    const resource = asObject(permission.resource);
    return {
      kind: "permission",
      permission: {
        action: asText(resource.action),
        target: asText(resource.target),
        persistSuggestionType: asText(permission.persistSuggestionType),
        suggestedPersistPattern: asText(permission.suggestedPersistPattern)
      }
    };
  }
  return {
    kind: "unknown",
    keys: Object.keys(requestedInteraction).sort()
  };
}

function firstNonEmptyText(values = []) {
  for (const value of values) {
    const text = asText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function stringifyObject(value = null) {
  if (!value || typeof value !== "object") {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function firstNonEmptyTextCandidate(candidates = []) {
  for (const candidate of candidates) {
    const text = asText(candidate?.value);
    if (text) {
      return {
        text,
        sourcePath: asText(candidate?.sourcePath)
      };
    }
  }
  return {
    text: "",
    sourcePath: ""
  };
}

function normalizeConnectContentDetails(step = {}) {
  const userInput = asObject(step.userInput, null);
  const addCascadeInput = asObject(step.addCascadeInput, null);
  const addCascadeInputInput = asObject(addCascadeInput?.input, null);
  const addCascadeInputUserInput = asObject(addCascadeInput?.userInput, null);
  const candidate = firstNonEmptyTextCandidate([
    { sourcePath: "content", value: typeof step.content === "string" ? step.content : "" },
    { sourcePath: "plannerResponse.modifiedResponse", value: step.plannerResponse?.modifiedResponse },
    { sourcePath: "plannerResponse.response", value: step.plannerResponse?.response },
    { sourcePath: "systemMessage.agentMessage.content", value: step.systemMessage?.agentMessage?.content },
    { sourcePath: "systemMessage.renderInfo.markdown", value: step.systemMessage?.renderInfo?.markdown },
    { sourcePath: "systemMessage.message", value: step.systemMessage?.message },
    { sourcePath: "userInput.content", value: userInput?.content },
    { sourcePath: "userInput.text", value: userInput?.text },
    { sourcePath: "userInput.message", value: userInput?.message },
    { sourcePath: "userInput.prompt", value: userInput?.prompt },
    { sourcePath: "userInput.input", value: typeof userInput?.input === "string" ? userInput.input : "" },
    { sourcePath: "addCascadeInput.content", value: addCascadeInput?.content },
    { sourcePath: "addCascadeInput.text", value: addCascadeInput?.text },
    { sourcePath: "addCascadeInput.message", value: addCascadeInput?.message },
    { sourcePath: "addCascadeInput.prompt", value: addCascadeInput?.prompt },
    { sourcePath: "addCascadeInput.input", value: typeof addCascadeInput?.input === "string" ? addCascadeInput.input : "" },
    { sourcePath: "addCascadeInput.input.content", value: addCascadeInputInput?.content },
    { sourcePath: "addCascadeInput.input.text", value: addCascadeInputInput?.text },
    { sourcePath: "addCascadeInput.input.message", value: addCascadeInputInput?.message },
    { sourcePath: "addCascadeInput.input.prompt", value: addCascadeInputInput?.prompt },
    { sourcePath: "addCascadeInput.userInput.content", value: addCascadeInputUserInput?.content },
    { sourcePath: "addCascadeInput.userInput.text", value: addCascadeInputUserInput?.text },
    { sourcePath: "addCascadeInput.userInput.message", value: addCascadeInputUserInput?.message },
    { sourcePath: "addCascadeInput.userInput.prompt", value: addCascadeInputUserInput?.prompt }
  ]);
  if (candidate.text) {
    return candidate;
  }
  const userInputJson = stringifyObject(userInput);
  if (userInputJson) {
    return {
      text: userInputJson,
      sourcePath: "userInput"
    };
  }
  const addCascadeInputJson = stringifyObject(addCascadeInput);
  if (addCascadeInputJson) {
    return {
      text: addCascadeInputJson,
      sourcePath: "addCascadeInput"
    };
  }
  return {
    text: "",
    sourcePath: ""
  };
}

function normalizeConnectErrorDetails(step = {}) {
  const errorMessage = asObject(step.errorMessage, null);
  const errorMessageError = asObject(errorMessage?.error, null);
  const directError = asObject(step.error, null);
  const candidate = firstNonEmptyTextCandidate([
    { sourcePath: "error", value: typeof step.error === "string" ? step.error : "" },
    { sourcePath: "errorMessage", value: typeof step.errorMessage === "string" ? step.errorMessage : "" },
    { sourcePath: "errorMessage.error.userErrorMessage", value: errorMessageError?.userErrorMessage },
    { sourcePath: "errorMessage.error.modelErrorMessage", value: errorMessageError?.modelErrorMessage },
    { sourcePath: "errorMessage.error.shortError", value: errorMessageError?.shortError },
    { sourcePath: "errorMessage.error.message", value: errorMessageError?.message },
    { sourcePath: "errorMessage.error.fullError", value: errorMessageError?.fullError },
    { sourcePath: "errorMessage.userErrorMessage", value: errorMessage?.userErrorMessage },
    { sourcePath: "errorMessage.modelErrorMessage", value: errorMessage?.modelErrorMessage },
    { sourcePath: "errorMessage.shortError", value: errorMessage?.shortError },
    { sourcePath: "errorMessage.message", value: errorMessage?.message },
    { sourcePath: "errorMessage.fullError", value: errorMessage?.fullError },
    { sourcePath: "error.userErrorMessage", value: directError?.userErrorMessage },
    { sourcePath: "error.modelErrorMessage", value: directError?.modelErrorMessage },
    { sourcePath: "error.shortError", value: directError?.shortError },
    { sourcePath: "error.message", value: directError?.message },
    { sourcePath: "error.fullError", value: directError?.fullError },
    {
      sourcePath: "message",
      value: typeof step.message === "string" && asText(step.type).includes("ERROR") ? step.message : ""
    }
  ]);
  if (candidate.text) {
    return candidate;
  }
  const errorMessageJson = stringifyObject(errorMessage);
  if (errorMessageJson) {
    return {
      text: errorMessageJson,
      sourcePath: "errorMessage"
    };
  }
  const directErrorJson = stringifyObject(directError);
  if (directErrorJson) {
    return {
      text: directErrorJson,
      sourcePath: "error"
    };
  }
  return {
    text: "",
    sourcePath: ""
  };
}

function normalizeConnectTrajectoryStep(step = {}, ordinal = 0) {
  const metadata = asObject(step.metadata);
  const sourceTrajectoryStepInfo = asObject(metadata.sourceTrajectoryStepInfo);
  const toolCall = asObject(metadata.toolCall);
  const toolArguments = parseToolArgumentsJson(toolCall.argumentsJson);
  const contentDetails = normalizeConnectContentDetails(step);
  const content = contentDetails.text;
  const errorDetails = normalizeConnectErrorDetails(step);
  const error = errorDetails.text;
  const runCommand = normalizeConnectRunCommand(step);
  const plannerResponseStopReason = asText(step.plannerResponse?.stopReason);
  return {
    ordinal,
    stepIndex: maybeNumber(step.stepIndex ?? step.step_index ?? sourceTrajectoryStepInfo.stepIndex, ordinal),
    metadataIndex: maybeNumber(sourceTrajectoryStepInfo.metadataIndex, null),
    trajectoryId: asText(sourceTrajectoryStepInfo.trajectoryId),
    cascadeId: asText(sourceTrajectoryStepInfo.cascadeId),
    type: asText(step.type || step.stepType || step.cortexStepType),
    status: asText(step.status || step.stepStatus || step.cortexStepStatus),
    source: asText(metadata.source),
    createdAt: asText(metadata.createdAt),
    viewableAt: asText(metadata.viewableAt),
    completedAt: asText(metadata.completedAt || metadata.finishedGeneratingAt || metadata.lastCompletedChunkAt),
    generatorModel: asText(metadata.generatorModel),
    plannerResponseStopReason,
    toolCall: toolCall.name || toolCall.originalName
      ? {
          id: asText(toolCall.id),
          name: asText(toolCall.name || toolCall.originalName),
          originalName: asText(toolCall.originalName),
          argumentsPreview: normalizedSnippet(toolCall.argumentsJson)
        }
      : null,
    toolArguments: Object.keys(toolArguments).length > 0
      ? {
          commandLine: asText(toolArguments.CommandLine || toolArguments.commandLine),
          cwd: asText(toolArguments.Cwd || toolArguments.cwd),
          toolAction: asText(toolArguments.toolAction),
          toolSummary: asText(toolArguments.toolSummary)
        }
      : null,
    runCommand,
    requestedInteraction: normalizeConnectRequestedInteraction(step),
    content,
    error,
    contentPreview: normalizedSnippet(content || error),
    errorPreview: normalizedSnippet(error),
    diagnostics: {
      hasSystemMessage: Boolean(objectOrNull(step.systemMessage)),
      hasUserInput: Boolean(objectOrNull(step.userInput)),
      hasAddCascadeInput: Boolean(objectOrNull(step.addCascadeInput)),
      plannerResponseStopReason,
      contentSourcePath: contentDetails.sourcePath,
      errorSourcePath: errorDetails.sourcePath
    }
  };
}

export function normalizeAntigravityCascadeTrajectory(payload = {}, { conversationId = "" } = {}) {
  const root = asObject(payload.cascadeTrajectory || payload.trajectory || payload);
  const steps = asArray(root.steps || payload.steps)
    .map((step, index) => normalizeConnectTrajectoryStep(step, index));
  const runStatus = asText(root.runStatus || root.status || payload.runStatus || payload.status);
  const statusCounts = steps.reduce((accumulator, step) => {
    const key = step.status || "unknown";
    accumulator[key] = Number(accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const waitingInteractionStep = latestFrom(steps, (step) =>
    step.status === "CORTEX_STEP_STATUS_WAITING" && Boolean(step.requestedInteraction)
  );
  const latestStep = steps.at(-1) || null;
  const latestPlannerResponse = latestFrom(steps, (step) =>
    step.type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE" &&
      step.status === "CORTEX_STEP_STATUS_DONE" &&
      Boolean(step.content)
  );
  const latestFinalResponse = latestFrom(steps, (step) =>
    step.type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE" &&
      step.status === "CORTEX_STEP_STATUS_DONE" &&
      isLikelyFinalAntigravityText(step.content)
  );
  const errorSteps = steps.filter((step) =>
    step.type === "CORTEX_STEP_TYPE_ERROR_MESSAGE" || Boolean(step.error)
  );
  const latestError = errorSteps.at(-1) || null;
  const latestKnownError = latestReadableError(errorSteps);
  return {
    conversationId: asText(conversationId || latestStep?.cascadeId || waitingInteractionStep?.cascadeId),
    runStatus,
    stepCount: steps.length,
    statusCounts,
    completed: ANTIGRAVITY_CONNECT_STATUS_COMPLETED.has(runStatus),
    failed: ANTIGRAVITY_CONNECT_STATUS_FAILED.has(runStatus),
    running: runStatus === "CASCADE_RUN_STATUS_RUNNING",
    pendingInteraction: Boolean(waitingInteractionStep),
    blockedByPendingInteraction: Boolean(waitingInteractionStep),
    latestStep,
    waitingInteractionStep,
    latestError,
    latestKnownError,
    latestProgress: latestPlannerResponse,
    latestFinalResponse,
    progressAvailable: Boolean(latestPlannerResponse),
    finalResponseAvailable: Boolean(latestFinalResponse),
    steps
  };
}

export function summarizeAntigravityConnectObservation({
  conversationId = "",
  marker = "",
  trajectory = {},
  afterStepCount = 0
} = {}) {
  const normalized = trajectory?.steps ? trajectory : normalizeAntigravityCascadeTrajectory(trajectory, { conversationId });
  const steps = asArray(normalized.steps);
  const baseline = Math.max(0, Number(afterStepCount || 0));
  const newSteps = steps.slice(Math.min(baseline, steps.length));
  const progress = latestFrom(newSteps, (step) =>
    step.type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE" &&
      step.status === "CORTEX_STEP_STATUS_DONE" &&
      Boolean(step.content)
  );
  const finalResponse = latestFrom(newSteps, (step) =>
    step.type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE" &&
      step.status === "CORTEX_STEP_STATUS_DONE" &&
      isLikelyFinalAntigravityText(step.content)
  );
  const errorSteps = newSteps.filter((step) =>
    step.type === "CORTEX_STEP_TYPE_ERROR_MESSAGE" || Boolean(step.error)
  );
  const knownErrorSteps = newSteps.filter((step) =>
    step.type === "CORTEX_STEP_TYPE_ERROR_MESSAGE" || Boolean(step.error)
  );
  const latestStrictError = errorSteps.at(-1) || null;
  const latestKnownError = latestReadableError(knownErrorSteps);
  const markerText = asText(marker);
  const markerObserved = markerText
    ? steps.some((step) =>
        asText(step.content).includes(markerText) ||
          asText(step.toolArguments?.commandLine).includes(markerText) ||
          asText(step.runCommand?.commandLine).includes(markerText)
      )
    : false;
  return {
    conversationId: asText(conversationId || normalized.conversationId),
    runStatus: normalized.runStatus,
    stepCount: normalized.stepCount,
    afterStepCount: baseline,
    trajectoryAdvanced: normalized.stepCount > baseline,
    statusCounts: normalized.statusCounts,
    running: normalized.running,
    completed: normalized.completed,
    failed: normalized.failed,
    pendingInteraction: normalized.pendingInteraction,
    blockedByPendingInteraction: normalized.blockedByPendingInteraction,
    markerObserved,
    progressAvailable: Boolean(progress),
    finalResponseAvailable: Boolean(finalResponse),
    latestStep: normalized.latestStep,
    waitingInteractionStep: normalized.waitingInteractionStep,
    latestError: latestStrictError,
    latestKnownError,
    latestProgress: progress,
    latestFinalResponse: finalResponse
  };
}

export function buildAntigravityCascadeUserInteractionDecision({
  conversationId = "",
  cascadeId = "",
  step = {},
  approved = false
} = {}) {
  const interactionStep = asObject(step, null);
  const id = asText(cascadeId || conversationId || interactionStep?.cascadeId);
  const trajectoryId = asText(interactionStep?.trajectoryId);
  const stepIndex = maybeNumber(interactionStep?.stepIndex, null);
  if (!id) {
    throw new Error("HandleCascadeUserInteraction requires a conversation id.");
  }
  if (!trajectoryId) {
    throw new Error("HandleCascadeUserInteraction requires an interaction trajectory id.");
  }
  if (!Number.isFinite(stepIndex)) {
    throw new Error("HandleCascadeUserInteraction requires an interaction step index.");
  }
  return {
    cascadeId: id,
    interaction: {
      trajectoryId,
      stepIndex,
      permission: {
        approved: approved === true
      }
    }
  };
}

export async function discoverAntigravityConnectEndpoint({
  conversationId = "",
  connectAddress = "",
  connectCsrfToken = "",
  workspaceRoot = process.cwd(),
  env = process.env,
  run = runText
} = {}) {
  const envAddress = asText(
    connectAddress ||
      env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ADDRESS ||
      env.ANTIGRAVITY_CONNECT_ADDRESS ||
      env.PACT_ACP_RELAY_ANTIGRAVITY_RPC_ADDRESS
  );
  const envToken = asText(
    connectCsrfToken ||
      env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_CSRF_TOKEN ||
      env.ANTIGRAVITY_CONNECT_CSRF_TOKEN ||
      env.PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN ||
      env.ANTIGRAVITY_CSRF_TOKEN
  );
  const probeConversationId = asText(conversationId);
  if (envAddress && envToken) {
    if (probeConversationId) {
      const metadata = await callAntigravityConnectRpc({
        address: envAddress,
        csrfToken: envToken,
        method: "GetConversationMetadata",
        body: { conversationId: probeConversationId },
        timeoutMs: 4000
      });
      assertAntigravityConnectOk(metadata, "GetConversationMetadata");
    }
    return {
      address: normalizeAntigravityConnectAddress(envAddress)?.address || envAddress,
      csrfToken: envToken,
      source: "env",
      protocol: "connect-json",
      tls: true
    };
  }
  if (!probeConversationId) {
    return null;
  }

  const workspaceFlag = workspaceFlagForRoot(workspaceRoot);
  const servers = await listAntigravityLanguageServers({ run });
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
    const csrfToken = extractAntigravityCsrfToken(server.command);
    if (!csrfToken) {
      continue;
    }
    const ports = await listAntigravityListenPorts(server.pid, { run });
    for (const port of ports) {
      const address = `127.0.0.1:${port}`;
      const metadata = await callAntigravityConnectRpc({
        address,
        csrfToken,
        method: "GetConversationMetadata",
        body: { conversationId: probeConversationId },
        timeoutMs: 4000
      }).catch(() => null);
      if (!metadata?.ok) {
        continue;
      }
      const workspaces = metadata.body?.conversationMetadata?.metadata?.workspaces || [];
      const workspaceMatches = workspaces.some((workspace) =>
        asText(workspace.workspaceFolderAbsoluteUri).includes(workspaceRoot)
      );
      const source = workspaceMatches || server.command.includes(workspaceFlag)
        ? `pid:${server.pid}`
        : `pid:${server.pid}:fallback`;
      return {
        address,
        csrfToken,
        source,
        protocol: "connect-json",
        tls: true
      };
    }
  }
  return null;
}

export async function discoverAntigravityAgentApiEndpoint({
  conversationId = "",
  binaryPath = "",
  workspaceRoot = process.cwd(),
  env = process.env,
  run = runText
} = {}) {
  const resolvedBinaryPath = await resolveAntigravityAgentApiBinary({ binaryPath, env });
  const envAddress = asText(env.PACT_ACP_RELAY_ANTIGRAVITY_LS_ADDRESS || env.ANTIGRAVITY_LS_ADDRESS);
  const envToken = asText(env.PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN || env.ANTIGRAVITY_CSRF_TOKEN);
  if (envAddress && envToken) {
    const client = new AntigravityAgentApiClient({
      binaryPath: resolvedBinaryPath,
      address: envAddress,
      csrfToken: envToken
    });
    await client.getConversationMetadata(conversationId);
    return { address: envAddress, csrfToken: envToken, source: "env", binaryPath: resolvedBinaryPath };
  }

  const workspaceFlag = workspaceFlagForRoot(workspaceRoot);
  const servers = await listAntigravityLanguageServers({ run });
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
    const csrfToken = extractAntigravityCsrfToken(server.command);
    if (!csrfToken) {
      continue;
    }
    const ports = await listAntigravityListenPorts(server.pid, { run });
    for (const port of ports) {
      const address = `127.0.0.1:${port}`;
      const client = new AntigravityAgentApiClient({
        binaryPath: resolvedBinaryPath,
        address,
        csrfToken
      });
      const metadata = await client.getConversationMetadata(conversationId).catch(() => null);
      const workspaces = metadata?.response?.conversationMetadata?.metadata?.workspaces || [];
      const workspaceMatches = workspaces.some((workspace) =>
        asText(workspace.workspaceFolderAbsoluteUri).includes(workspaceRoot)
      );
      if (metadata && (workspaceMatches || server.command.includes(workspaceFlag))) {
        return { address, csrfToken, source: `pid:${server.pid}`, binaryPath: resolvedBinaryPath };
      }
      if (metadata) {
        return { address, csrfToken, source: `pid:${server.pid}:fallback`, binaryPath: resolvedBinaryPath };
      }
    }
  }
  return null;
}

export function parseAntigravityAgentApiCommands(text = "") {
  const commands = [];
  let inCommands = false;
  for (const rawLine of asText(text).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (/^Available Commands:/i.test(line.trim())) {
      inCommands = true;
      continue;
    }
    if (!inCommands) {
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^\s{2,}([a-z][a-z-]+)\b/);
    if (match?.[1]) {
      commands.push(match[1]);
    }
  }
  return [...new Set(commands)];
}

function commandKey(command = "") {
  return asText(command).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function createAntigravityAgentApiCapabilitySnapshot({
  availableCommands = DEFAULT_AGENTAPI_COMMANDS,
  finalResponseCapabilityProbe = [],
  completionState = "accepted_only"
} = {}) {
  const commands = new Set(availableCommands.length > 0 ? availableCommands : DEFAULT_AGENTAPI_COMMANDS);
  for (const result of finalResponseCapabilityProbe) {
    if (result?.supported && result?.command) {
      commands.add(result.command);
    }
  }
  const commandCapabilities = {};
  for (const command of [...DEFAULT_AGENTAPI_COMMANDS, ...FINAL_RESPONSE_COMMANDS]) {
    commandCapabilities[commandKey(command)] = commands.has(command);
  }
  const finalResponseReadSupported = FINAL_RESPONSE_COMMANDS.some((command) => commandCapabilities[commandKey(command)]);
  return {
    provider: "antigravity-agentapi",
    commands: commandCapabilities,
    availableCommands: [...commands].sort(),
    finalResponseReadSupported,
    finalResponsePolicy: finalResponseReadSupported
      ? "pull_or_stream"
      : completionState === "completed"
        ? "inline_response"
        : "accepted_only",
    unsupportedFinalResponseCommands: FINAL_RESPONSE_COMMANDS.filter((command) => !commands.has(command))
  };
}

function extractAgentApiErrorMessage(error = {}) {
  const rawMessage = asText(error.agentApiResponse?.error || error.stdout || error.stderr || error.message);
  let parsedMessage = "";
  try {
    parsedMessage = asText(JSON.parse(rawMessage)?.error);
  } catch {
    parsedMessage = "";
  }
  return parsedMessage || rawMessage;
}

export async function probeAntigravityAgentApiCapabilities(client, {
  conversationId = "",
  timeoutMs = 8000,
  probeFinalResponseCommands = true
} = {}) {
  const usageText = await client.commandUsage({ timeoutMs }).catch((error) => extractAgentApiErrorMessage(error));
  const availableCommands = parseAntigravityAgentApiCommands(usageText);
  const finalResponseCapabilityProbe = [];
  if (probeFinalResponseCommands && conversationId) {
    for (const command of FINAL_RESPONSE_COMMANDS) {
      const startedAt = Date.now();
      try {
        await client.runAgentApi([command, conversationId], { timeoutMs });
        finalResponseCapabilityProbe.push({ command, supported: true, error: "", elapsedMs: Date.now() - startedAt });
      } catch (error) {
        finalResponseCapabilityProbe.push({
          command,
          supported: false,
          error: extractAgentApiErrorMessage(error),
          elapsedMs: Date.now() - startedAt
        });
      }
    }
  }
  return {
    usageText,
    availableCommands,
    finalResponseCapabilityProbe,
    snapshot: createAntigravityAgentApiCapabilitySnapshot({
      availableCommands,
      finalResponseCapabilityProbe
    })
  };
}

export class AntigravityAgentApiClient {
  constructor(options = {}) {
    this.options = normalizeAntigravityAgentApiConfig(options);
    this.env = asObject(options.env, process.env);
    this.logger = asObject(options.logger, {});
  }

  async binaryPath() {
    return resolveAntigravityAgentApiBinary({ binaryPath: this.options.binaryPath, env: this.env });
  }

  async runAgentApi(args = [], options = {}) {
    const address = asText(options.address || this.options.address);
    const csrfToken = asText(options.csrfToken || this.options.csrfToken);
    if (!address) {
      throw new Error("Antigravity Agent API requires ANTIGRAVITY_LS_ADDRESS.");
    }
    if (!csrfToken) {
      throw new Error("Antigravity Agent API requires ANTIGRAVITY_CSRF_TOKEN.");
    }

    const binary = await this.binaryPath();
    if (!binary) {
      throw new Error("Antigravity language server binary was not found.");
    }

    const executableArgs = binary.endsWith("agentapi") ? args : ["agentapi", ...args];
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync(binary, executableArgs, {
        cwd: asText(options.cwd || this.options.cwd || process.cwd()),
        env: {
          ...process.env,
          ...this.env,
          ...asObject(options.env),
          ANTIGRAVITY_LS_ADDRESS: address,
          ANTIGRAVITY_CSRF_TOKEN: csrfToken
        },
        maxBuffer: 4 * 1024 * 1024,
        timeout: asNumber(options.timeoutMs || this.options.timeoutMs, 120000)
      });
      stdout = asText(result.stdout);
      stderr = asText(result.stderr);
    } catch (error) {
      stdout = asText(error.stdout);
      stderr = asText(error.stderr);
      const output = asText(stdout || stderr || error.message);
      const parsed = extractJsonPayload(output);
      if (parsed?.error) {
        const agentError = new Error(asText(parsed.error, "Antigravity Agent API call failed."));
        agentError.agentApiResponse = parsed;
        agentError.stdout = stdout;
        agentError.stderr = stderr;
        throw agentError;
      }
      error.stdout = stdout;
      error.stderr = stderr;
      throw error;
    }
    const output = asText(stdout || stderr);
    if (!output) {
      return { response: {}, rawText: "", stdout: "", stderr: "" };
    }
    const parsed = extractJsonPayload(output);
    if (parsed?.error) {
      const agentError = new Error(asText(parsed.error, "Antigravity Agent API call failed."));
      agentError.agentApiResponse = parsed;
      throw agentError;
    }
    const normalized = objectOrNull(parsed) || { text: output };
    return {
      ...normalized,
      response: normalized.response || normalized,
      rawText: output,
      stdout: asText(stdout),
      stderr: asText(stderr)
    };
  }

  async getConversationMetadata(conversationId, options = {}) {
    const id = asText(conversationId || this.options.conversationId);
    if (!id) {
      throw new Error("get-conversation-metadata requires a conversation id.");
    }
    return this.runAgentApi(["get-conversation-metadata", id], options);
  }

  async commandUsage(options = {}) {
    try {
      return (await this.runAgentApi([], options)).rawText || "";
    } catch (error) {
      return asText(error.stdout || error.stderr || error.message);
    }
  }

  async probeCapabilities(options = {}) {
    return probeAntigravityAgentApiCapabilities(this, options);
  }

  async probeIdeCliCapabilities(options = {}) {
    return probeAntigravityIdeCliCapabilities({
      binaryPath: options.binaryPath || this.options.ideCliPath,
      env: this.env,
      timeoutMs: options.timeoutMs || 3000,
      run: options.run || runText
    });
  }

  async discoverConnectEndpoint(options = {}) {
    return discoverAntigravityConnectEndpoint({
      conversationId: options.conversationId || this.options.conversationId,
      connectAddress: options.connectAddress || this.options.connectAddress,
      connectCsrfToken: options.connectCsrfToken || this.options.connectCsrfToken,
      workspaceRoot: options.workspaceRoot || options.cwd || this.options.cwd,
      env: this.env,
      run: options.run || runText
    });
  }

  async runConnectRpc(method, body = {}, options = {}) {
    const endpoint = options.endpoint || await this.discoverConnectEndpoint({
      conversationId: options.conversationId || body.conversationId || body.cascadeId || this.options.conversationId,
      connectAddress: options.connectAddress,
      connectCsrfToken: options.connectCsrfToken,
      workspaceRoot: options.workspaceRoot,
      cwd: options.cwd
    });
    if (!endpoint) {
      throw new Error("Antigravity Connect RPC endpoint was not found.");
    }
    const result = await callAntigravityConnectRpc({
      address: endpoint.address,
      csrfToken: endpoint.csrfToken,
      method,
      body,
      timeoutMs: options.timeoutMs || this.options.connectTimeoutMs
    });
    assertAntigravityConnectOk(result, method);
    return {
      ...result,
      endpoint: redactAntigravityConnectEndpoint(endpoint)
    };
  }

  async getCascadeTrajectory({ conversationId = "", cascadeId = "", ...options } = {}) {
    const id = asText(cascadeId || conversationId || this.options.conversationId);
    if (!id) {
      throw new Error("GetCascadeTrajectory requires a conversation id.");
    }
    const result = await this.runConnectRpc("GetCascadeTrajectory", { cascadeId: id }, {
      ...options,
      conversationId: id
    });
    return {
      ...result,
      trajectory: normalizeAntigravityCascadeTrajectory(result.body, { conversationId: id })
    };
  }

  async observeConnectTrajectory({ conversationId = "", cascadeId = "", marker = "", afterStepCount = 0, ...options } = {}) {
    const id = asText(cascadeId || conversationId || this.options.conversationId);
    const trajectory = await this.getCascadeTrajectory({ conversationId: id, ...options });
    return {
      ...summarizeAntigravityConnectObservation({
        conversationId: id,
        marker,
        trajectory: trajectory.trajectory,
        afterStepCount
      }),
      endpoint: trajectory.endpoint
    };
  }

  async waitForConnectTrajectoryObservation({
    conversationId = "",
    cascadeId = "",
    marker = "",
    afterStepCount = 0,
    timeoutMs = 12000,
    pollIntervalMs = 1000,
    until = "progress",
    ...options
  } = {}) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
    const satisfied = (observation) => {
      switch (asText(until, "progress")) {
        case "final":
          return observation.finalResponseAvailable === true || observation.completed === true;
        case "idle":
          return observation.completed === true || observation.failed === true || observation.pendingInteraction === true;
        case "trajectory":
          return observation.trajectoryAdvanced === true || observation.pendingInteraction === true;
        case "progress":
        default:
          return observation.progressAvailable === true ||
            observation.finalResponseAvailable === true ||
            observation.pendingInteraction === true;
      }
    };
    let latest = await this.observeConnectTrajectory({
      conversationId,
      cascadeId,
      marker,
      afterStepCount,
      ...options
    });
    while (!satisfied(latest) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(pollIntervalMs || 1000))));
      latest = await this.observeConnectTrajectory({
        conversationId,
        cascadeId,
        marker,
        afterStepCount,
        ...options
      });
    }
    return latest;
  }

  async sendAllQueuedMessages({ conversationId = "", cascadeId = "", cascadeConfig = null, ...options } = {}) {
    const id = asText(cascadeId || conversationId || this.options.conversationId);
    if (!id) {
      throw new Error("SendAllQueuedMessages requires a conversation id.");
    }
    const body = { cascadeId: id };
    if (cascadeConfig && typeof cascadeConfig === "object") {
      body.cascadeConfig = cascadeConfig;
    }
    return this.runConnectRpc("SendAllQueuedMessages", body, {
      ...options,
      conversationId: id
    });
  }

  async waitForConversationFullyIdle({
    conversationId = "",
    inactivityTimeoutSeconds = 3,
    stabilizationDurationSeconds = 1,
    returnOnExecutorError = true,
    ...options
  } = {}) {
    const id = asText(conversationId || this.options.conversationId);
    if (!id) {
      throw new Error("WaitForConversationFullyIdle requires a conversation id.");
    }
    return this.runConnectRpc("WaitForConversationFullyIdle", {
      conversationId: id,
      inactivityTimeoutSeconds,
      stabilizationDurationSeconds,
      returnOnExecutorError
    }, {
      ...options,
      conversationId: id,
      timeoutMs: options.timeoutMs || this.options.connectObservationTimeoutMs
    });
  }

  async cancelCascadeInvocation({ conversationId = "", cascadeId = "", ...options } = {}) {
    const id = asText(cascadeId || conversationId || this.options.conversationId);
    if (!id) {
      throw new Error("CancelCascadeInvocation requires a conversation id.");
    }
    return this.runConnectRpc("CancelCascadeInvocation", { cascadeId: id }, {
      ...options,
      conversationId: id
    });
  }

  async forceStopCascadeTree({ conversationId = "", ...options } = {}) {
    const id = asText(conversationId || this.options.conversationId);
    if (!id) {
      throw new Error("ForceStopCascadeTree requires a conversation id.");
    }
    return this.runConnectRpc("ForceStopCascadeTree", { conversationId: id }, {
      ...options,
      conversationId: id
    });
  }

  async denyCascadeUserInteraction({ conversationId = "", cascadeId = "", step = {}, ...options } = {}) {
    const id = asText(cascadeId || conversationId || this.options.conversationId);
    const body = buildAntigravityCascadeUserInteractionDecision({
      conversationId: id,
      step,
      approved: false
    });
    return this.runConnectRpc("HandleCascadeUserInteraction", body, {
      ...options,
      conversationId: id
    });
  }

  async newConversation({ prompt = "", model = "", ...options } = {}) {
    const content = asText(prompt);
    if (!content) {
      throw new Error("new-conversation requires a prompt.");
    }
    const selectedModel = asText(model || this.options.model);
    const args = ["new-conversation"];
    if (selectedModel) {
      args.push(`--model=${selectedModel}`);
    }
    args.push(content);
    return this.runAgentApi(args, options);
  }

  async sendMessage({ recipientId = "", content = "", ...options } = {}) {
    const id = asText(recipientId || this.options.conversationId);
    const text = asText(content);
    if (!id) {
      throw new Error("send-message requires a recipient id.");
    }
    if (!text) {
      throw new Error("send-message requires content.");
    }
    return this.runAgentApi(["send-message", id, text], options);
  }
}

export function createAntigravityAgentApiClient(options = {}) {
  return new AntigravityAgentApiClient(options);
}
