import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  appendJsonLineSerialized,
  atomicWriteJson
} from "../../../../common/platform-core/state-coordinator.mjs";
import { createAgentMemory } from "../../agent-memory/index.mjs";

export const CONTEXT_COMPACTION_PROTOCOL_VERSION = "v0.0.1:agent:context-compaction-1";

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|authorization|cookie|api[-_]?key|client[-_]?secret|csrf/i;
const SENSITIVE_TEXT_PATTERN =
  /(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9._-]+|xox[baprs]-[A-Za-z0-9-]+|(?:(?:api[-_]?key|token|secret|password)\s*[:=]\s*)[^\s"',;]+)/gi;
const ABSOLUTE_PATH_PATTERN =
  /(?:[A-Za-z]:\\[^\s"'<>]+|\/(?:Users|home|var|tmp|private|Volumes|opt|etc)\/[^\s"'<>]+)/g;

const DEFAULT_COMPACTION_POLICY = Object.freeze({
  enabled: true,
  strategy: Object.freeze({
    id: "session-memory-first",
    params: Object.freeze({})
  }),
  summaryReserveTokens: 4000,
  reservedBufferTokens: 13000,
  warningBufferTokens: 20000,
  hardBufferTokens: 2048,
  hardThresholdRatio: 0.98,
  recentMessageProtectionCount: 12,
  recentTurnProtectionCount: 6,
  maxConsecutiveFailures: 3,
  ptlRetryLimit: 3,
  ptlHeadTrimRatio: 0.2,
  modelMaxInputTokens: 24000,
  modelMaxOutputTokens: 4000,
  deterministicTargetRatio: 0.24,
  reinjectionBudgetTokens: 1800,
  maxToolResultTokens: 900,
  maxAttachmentTokens: 600,
  allowAttachmentDehydration: true,
  persistSessionMemory: true,
  persistBoundaries: true,
  microCompaction: true
});

const BUILTIN_COMPACTION_STRATEGIES = Object.freeze([
  Object.freeze({
    id: "session-memory-first",
    label: "Session memory first, then model-assisted, then deterministic fallback"
  }),
  Object.freeze({
    id: "workbench-reconstruction",
    label: "Model-assisted compaction with payload dehydration and workbench state reinjection"
  }),
  Object.freeze({
    id: "model-assisted",
    label: "Model-assisted summary with deterministic fallback"
  }),
  Object.freeze({
    id: "deterministic-extractive",
    label: "Deterministic extractive context summary"
  })
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function normalizeStrategyId(value, fallbackStrategy = DEFAULT_COMPACTION_POLICY.strategy.id) {
  const requested = String(value || "").trim();
  return requested || String(fallbackStrategy || DEFAULT_COMPACTION_POLICY.strategy.id).trim();
}

function normalizeStrategyConfig(value, fallbackStrategy = DEFAULT_COMPACTION_POLICY.strategy.id) {
  const source = typeof value === "string"
    ? { id: value }
    : asObject(value);
  const id = normalizeStrategyId(source.id || source.strategyId || source.name || source.mode, fallbackStrategy);
  const params = {
    ...asObject(source.params),
    ...asObject(source.options),
    ...asObject(source.config)
  };
  return {
    id,
    params
  };
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function estimateContextTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const nonCjkCount = Math.max(0, text.length - cjkCount);
  return Math.max(1, Math.ceil(cjkCount * 0.9 + nonCjkCount / 4));
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function hashValue(value, length = 32) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, length);
}

function redactText(value) {
  return String(value ?? "")
    .replace(SENSITIVE_TEXT_PATTERN, (match) => {
      const prefix = match.match(/^\s*(api[-_]?key|token|secret|password)\s*[:=]/i)?.[0] || "";
      return prefix ? `${prefix}<redacted>` : "<redacted-secret>";
    })
    .replace(ABSOLUTE_PATH_PATTERN, "<redacted-path>");
}

export function redactCompactionValue(value, depth = 0) {
  if (depth > 8) {
    return "<redacted-depth>";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return {
      redacted: true,
      reason: "buffer",
      byteLength: value.length,
      sha256: crypto.createHash("sha256").update(value).digest("hex")
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactCompactionValue(item, depth + 1));
  }
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "<redacted>"
      : redactCompactionValue(nested, depth + 1);
  }
  return output;
}

export function normalizeCompactionPolicy(profile = {}, patch = {}) {
  const profilePolicy = asObject(profile.compactionPolicy);
  const patchPolicy = asObject(patch);
  const source = {
    ...DEFAULT_COMPACTION_POLICY,
    ...profilePolicy,
    ...asObject(profile.compactionStrategy ? { strategy: profile.compactionStrategy } : {}),
    ...patchPolicy
  };
  const compression = asObject(profile.compression);
  const fallbackStrategy = typeof source.strategy === "string"
    ? source.strategy
    : source.strategyId;
  const explicitStrategy =
    patchPolicy.strategy ||
    patchPolicy.strategyId ||
    patchPolicy.compactionStrategy ||
    profile.compactionStrategy ||
    profilePolicy.strategy ||
    profilePolicy.strategyId ||
    profilePolicy.compactionStrategy ||
    null;
  const strategy = normalizeStrategyConfig(explicitStrategy, fallbackStrategy);
  return {
    ...source,
    enabled: source.enabled !== false,
    strategy,
    strategyId: strategy.id,
    summaryReserveTokens: clampNumber(
      source.summaryReserveTokens,
      compression.summaryMaxTokens || DEFAULT_COMPACTION_POLICY.summaryReserveTokens,
      256,
      200000
    ),
    reservedBufferTokens: clampNumber(source.reservedBufferTokens, 13000, 512, 200000),
    warningBufferTokens: clampNumber(source.warningBufferTokens, 20000, 512, 400000),
    hardBufferTokens: clampNumber(source.hardBufferTokens, 2048, 256, 100000),
    hardThresholdRatio: clampNumber(source.hardThresholdRatio, 0.98, 0.5, 1),
    recentMessageProtectionCount: clampNumber(
      source.recentMessageProtectionCount,
      Math.max(4, Number(compression.protectLastNTurns || 6) * 2),
      0,
      500
    ),
    recentTurnProtectionCount: clampNumber(
      source.recentTurnProtectionCount,
      Math.max(2, Number(compression.protectLastNTurns || 6)),
      0,
      250
    ),
    maxConsecutiveFailures: clampNumber(source.maxConsecutiveFailures, 3, 1, 20),
    ptlRetryLimit: clampNumber(source.ptlRetryLimit, 3, 0, 10),
    ptlHeadTrimRatio: clampNumber(source.ptlHeadTrimRatio, 0.2, 0.05, 0.8),
    modelMaxInputTokens: clampNumber(
      source.modelMaxInputTokens,
      profile.modelCompression?.maxInputTokens || DEFAULT_COMPACTION_POLICY.modelMaxInputTokens,
      512,
      2000000
    ),
    modelMaxOutputTokens: clampNumber(
      source.modelMaxOutputTokens,
      profile.modelCompression?.maxOutputTokens || DEFAULT_COMPACTION_POLICY.modelMaxOutputTokens,
      128,
      200000
    ),
    deterministicTargetRatio: clampNumber(
      source.deterministicTargetRatio,
      compression.targetRatio || DEFAULT_COMPACTION_POLICY.deterministicTargetRatio,
      0.05,
      0.9
    ),
    reinjectionBudgetTokens: clampNumber(source.reinjectionBudgetTokens, 1800, 0, 100000),
    maxToolResultTokens: clampNumber(source.maxToolResultTokens, 900, 64, 100000),
    maxAttachmentTokens: clampNumber(source.maxAttachmentTokens, 600, 64, 100000),
    allowAttachmentDehydration: source.allowAttachmentDehydration !== false,
    persistSessionMemory: source.persistSessionMemory !== false,
    persistBoundaries: source.persistBoundaries !== false,
    microCompaction: source.microCompaction !== false
  };
}

export function computeCompactionBudget(profile = {}, policyPatch = {}) {
  const policy = normalizeCompactionPolicy(profile, policyPatch);
  const contextWindowTokens = clampNumber(profile.contextWindowTokens, 32000, 4096, 2000000);
  const outputReserveTokens = clampNumber(
    profile.outputReserveTokens,
    Math.min(4000, Math.floor(contextWindowTokens * 0.15)),
    0,
    contextWindowTokens - 1024
  );
  const summaryReserveTokens = Math.min(
    policy.summaryReserveTokens,
    Math.max(256, contextWindowTokens - outputReserveTokens - 1024)
  );
  const effectiveWindowTokens = Math.max(1024, contextWindowTokens - outputReserveTokens - summaryReserveTokens);
  const warningThresholdTokens = Math.max(512, effectiveWindowTokens - policy.warningBufferTokens);
  const autoCompactThresholdTokens = Math.max(512, effectiveWindowTokens - policy.reservedBufferTokens);
  const hardThresholdTokens = Math.max(
    autoCompactThresholdTokens,
    Math.min(
      Math.floor(contextWindowTokens * policy.hardThresholdRatio),
      Math.max(512, effectiveWindowTokens - policy.hardBufferTokens)
    )
  );
  return {
    contextWindowTokens,
    outputReserveTokens,
    summaryReserveTokens,
    effectiveWindowTokens,
    warningThresholdTokens,
    autoCompactThresholdTokens,
    hardThresholdTokens,
    policy
  };
}

function messageText(message = {}) {
  const content = message.content ?? message.text ?? message.summary ?? "";
  const blockText = asArray(message.blocks)
    .map((block) => block?.text || block?.content || block?.input || block?.name || "")
    .filter(Boolean)
    .join("\n");
  const attachmentText = asArray(message.attachments)
    .map((item) => `${item.name || item.fileName || item.path || item.url || ""} ${item.summary || item.text || ""}`)
    .filter(Boolean)
    .join("\n");
  if (Array.isArray(content)) {
    return [content.map((item) => item?.text || item?.content || JSON.stringify(item)).join("\n"), blockText, attachmentText]
      .filter(Boolean)
      .map(redactEmbeddedPayloads)
      .join("\n");
  }
  if (typeof content === "object" && content !== null) {
    return [JSON.stringify(content), blockText, attachmentText].filter(Boolean).map(redactEmbeddedPayloads).join("\n");
  }
  return [content, blockText, attachmentText].filter(Boolean).map(redactEmbeddedPayloads).join("\n");
}

function normalizeMessage(message = {}, index = 0) {
  const id = String(message.id || message.messageId || message.uuid || `message-${index + 1}`);
  const role = String(message.role || message.type || "user").toLowerCase();
  const text = messageText(message);
  const apiRoundId = String(
    message.apiRoundId ||
    message.roundId ||
    message.requestId ||
    message.conversationTurnId ||
    `round-${Math.max(1, Math.floor(index / 2) + 1)}`
  );
  return {
    ...message,
    id,
    role,
    apiRoundId,
    index,
    text,
    tokenEstimate: estimateContextTokens({ role, text, blocks: message.blocks || [], attachments: message.attachments || [] })
  };
}

function normalizeMessages(messages = []) {
  return asArray(messages).map(normalizeMessage);
}

function normalizeConversationInput(input = {}) {
  if (Array.isArray(input.messages)) {
    return normalizeMessages(input.messages);
  }
  if (Array.isArray(input.transcript)) {
    return normalizeMessages(input.transcript);
  }
  const messages = [];
  if (input.history || input.compressedHistory) {
    messages.push({
      id: "history",
      role: "system",
      apiRoundId: "history",
      content: input.history || input.compressedHistory
    });
  }
  for (const [index, turn] of asArray(input.recentTurns).entries()) {
    messages.push({
      ...turn,
      id: turn.id || turn.messageId || `recent-${index + 1}`,
      apiRoundId: turn.apiRoundId || turn.roundId || `recent-round-${Math.floor(index / 2) + 1}`
    });
  }
  if (input.toolState && Object.keys(asObject(input.toolState)).length) {
    messages.push({
      id: "tool-state",
      role: "tool",
      apiRoundId: "tool-state",
      content: input.toolState
    });
  }
  return normalizeMessages(messages);
}

function toolUseIds(message = {}) {
  const ids = [];
  if (message.toolUseId || message.tool_use_id || message.toolCallId) {
    ids.push(message.toolUseId || message.tool_use_id || message.toolCallId);
  }
  for (const call of asArray(message.toolCalls || message.tool_calls)) {
    ids.push(call.id || call.toolUseId || call.tool_use_id || call.callId);
  }
  for (const block of asArray(message.blocks)) {
    if (block?.type === "tool_use" || block?.type === "tool_call") {
      ids.push(block.id || block.toolUseId || block.tool_use_id || block.callId);
    }
  }
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

function toolResultIds(message = {}) {
  const ids = [];
  if (message.toolUseId || message.tool_use_id || message.toolCallId) {
    ids.push(message.toolUseId || message.tool_use_id || message.toolCallId);
  }
  for (const result of asArray(message.toolResults || message.tool_results)) {
    ids.push(result.toolUseId || result.tool_use_id || result.id || result.callId);
  }
  for (const block of asArray(message.blocks)) {
    if (block?.type === "tool_result") {
      ids.push(block.toolUseId || block.tool_use_id || block.id || block.callId);
    }
  }
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

export function buildMessageGraph(messages = []) {
  const normalized = normalizeMessages(messages);
  const toolGroups = new Map();
  const apiRoundGroups = new Map();
  const assistantMessageGroups = new Map();
  for (const message of normalized) {
    if (!apiRoundGroups.has(message.apiRoundId)) {
      apiRoundGroups.set(message.apiRoundId, []);
    }
    apiRoundGroups.get(message.apiRoundId).push(message.index);

    if (message.role === "assistant" && message.id) {
      if (!assistantMessageGroups.has(message.id)) {
        assistantMessageGroups.set(message.id, []);
      }
      assistantMessageGroups.get(message.id).push(message.index);
    }

    for (const id of toolUseIds(message)) {
      const group = toolGroups.get(id) || { id, uses: [], results: [] };
      group.uses.push(message.index);
      toolGroups.set(id, group);
    }
    if (message.role === "tool" || message.type === "tool_result" || asArray(message.blocks).some((block) => block?.type === "tool_result")) {
      for (const id of toolResultIds(message)) {
        const group = toolGroups.get(id) || { id, uses: [], results: [] };
        group.results.push(message.index);
        toolGroups.set(id, group);
      }
    }
  }
  return {
    messages: normalized,
    toolGroups: [...toolGroups.values()],
    apiRoundGroups: [...apiRoundGroups.entries()].map(([id, indexes]) => ({ id, indexes })),
    assistantMessageGroups: [...assistantMessageGroups.entries()].map(([id, indexes]) => ({ id, indexes }))
  };
}

function groupCrossesCut(indexes = [], cutIndex) {
  if (indexes.length < 2) {
    return false;
  }
  return indexes.some((index) => index < cutIndex) && indexes.some((index) => index >= cutIndex);
}

function adjustCutPointForGraph(graph, proposedCutIndex) {
  let cutIndex = Math.max(0, Math.min(proposedCutIndex, graph.messages.length));
  let changed = true;
  const adjustments = [];
  while (changed) {
    changed = false;
    for (const group of graph.toolGroups) {
      const indexes = [...group.uses, ...group.results].filter(Number.isInteger);
      if (groupCrossesCut(indexes, cutIndex)) {
        const nextCut = Math.min(...indexes);
        if (nextCut < cutIndex) {
          adjustments.push({ reason: "tool_chain_protection", id: group.id, from: cutIndex, to: nextCut });
          cutIndex = nextCut;
          changed = true;
        }
      }
    }
    for (const group of graph.apiRoundGroups) {
      if (groupCrossesCut(group.indexes, cutIndex)) {
        const nextCut = Math.min(...group.indexes);
        if (nextCut < cutIndex) {
          adjustments.push({ reason: "api_round_protection", id: group.id, from: cutIndex, to: nextCut });
          cutIndex = nextCut;
          changed = true;
        }
      }
    }
    for (const group of graph.assistantMessageGroups) {
      if (groupCrossesCut(group.indexes, cutIndex)) {
        const nextCut = Math.min(...group.indexes);
        if (nextCut < cutIndex) {
          adjustments.push({ reason: "assistant_message_id_protection", id: group.id, from: cutIndex, to: nextCut });
          cutIndex = nextCut;
          changed = true;
        }
      }
    }
  }
  return { cutIndex, adjustments };
}

export function chooseCompactionCutPoint(messages = [], { profile = {}, policyPatch = {} } = {}) {
  const graph = buildMessageGraph(messages);
  const policy = normalizeCompactionPolicy(profile, policyPatch);
  const protectedTail = Math.min(policy.recentMessageProtectionCount, Math.max(0, graph.messages.length - 1));
  const proposedCutIndex = Math.max(0, graph.messages.length - protectedTail);
  const adjusted = adjustCutPointForGraph(graph, proposedCutIndex);
  return {
    ...adjusted,
    proposedCutIndex,
    protectedTail,
    compactedCount: adjusted.cutIndex,
    keptCount: Math.max(0, graph.messages.length - adjusted.cutIndex)
  };
}

function extractMatches(text, regex, limit = 20) {
  return [...new Set((String(text || "").match(regex) || []).map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function selectImportantLines(text, limit = 8) {
  const lines = String(text || "")
    .split(/\r?\n|(?<=[。！？.!?])\s+/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const scored = lines.map((line, index) => ({
    line,
    index,
    score:
      /(must|should|never|cannot|todo|fixme|risk|error|failed|decision|approved|evidence|source|scope|rollback|version|必须|不能|不得|风险|错误|失败|决定|证据|来源|审批|版本|回滚)/i.test(line)
        ? 3
        : /(\/[\w./-]+|[A-Za-z]:\\|[A-Z][A-Za-z0-9_/-]+\.(?:mjs|js|ts|tsx|json|rs|dart|swift|md)|\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b)/.test(line)
          ? 2
          : 1
  }));
  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.line);
}

function compactToBudget(text, targetTokens) {
  const safeTarget = Math.max(64, Number(targetTokens || 0));
  const source = redactText(String(text || "").trim());
  if (!source || estimateContextTokens(source) <= safeTarget) {
    return source;
  }
  const lines = selectImportantLines(source, Math.max(6, Math.floor(safeTarget / 90)));
  let output = lines.join("\n");
  while (estimateContextTokens(output) > safeTarget && output.length > 80) {
    output = output.slice(0, Math.floor(output.length * 0.85)).trim();
  }
  return output || source.slice(0, safeTarget * 4);
}

function collectStructuredFacts(messages = [], runtimeState = {}) {
  const joined = messages.map((message) => `${message.role}: ${message.text}`).join("\n");
  return {
    constraints: extractMatches(
      joined,
      /(?:must|should|never|cannot|do not|必须|不能|不得|需要|确保)[^。！？.!?\n]{0,220}/gi,
      24
    ),
    decisions: extractMatches(
      joined,
      /(?:decision|decided|approved|rejected|决定|已确认|已批准|已拒绝)[^。！？.!?\n]{0,220}/gi,
      18
    ),
    risks: extractMatches(
      joined,
      /(?:risk|error|failed|failure|blocked|warning|风险|错误|失败|阻塞|告警)[^。！？.!?\n]{0,220}/gi,
      24
    ),
    todos: extractMatches(
      joined,
      /(?:todo|fixme|pending|next|follow[- ]?up|待办|未完成|下一步|待审批)[^。！？.!?\n]{0,220}/gi,
      24
    ),
    evidenceRefs: extractMatches(
      joined,
      /\b(?:ev|evidence|source|doc|chunk|record|audit|run|job|pkg|version)[-_:#]?[A-Za-z0-9_.:-]{2,80}\b/gi,
      40
    ),
    fileRefs: extractMatches(
      joined,
      /(?:[A-Za-z]:\\[^\s"'<>]+|\/[^\s"'<>]+\.(?:mjs|js|ts|tsx|json|rs|dart|swift|md|yaml|yml)|\b[\w./-]+\.(?:mjs|js|ts|tsx|json|rs|dart|swift|md|yaml|yml)\b)/g,
      32
    ).map(redactText),
    dates: extractMatches(joined, /\b20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b|\b\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}\b/g, 20),
    amounts: extractMatches(joined, /(?:[$€£¥￥]\s*)?\d[\d,]*(?:\.\d+)?\s*(?:美元|美金|人民币|元|GBP|USD|EUR|CNY|%|percent)?/gi, 20),
    knowledgeRefs: [
      runtimeState.knowledgeReference,
      runtimeState.expertVocabularyVersion,
      runtimeState.knowledgeSourceId
    ].map((item) => String(item || "").trim()).filter(Boolean)
  };
}

function normalizeRequiredAnchors(input = {}, runtimeState = {}) {
  const rawAnchors = [
    ...asArray(input.requiredAnchors),
    ...asArray(input.requiredFacts),
    ...asArray(input.protectedAnchors),
    ...asArray(input.compactionQuality?.requiredAnchors),
    ...asArray(runtimeState.requiredAnchors)
  ];
  const seen = new Set();
  return rawAnchors
    .map((anchor) => {
      const source = typeof anchor === "string"
        ? { text: anchor }
        : asObject(anchor);
      const text = normalizeText(source.text || source.value || source.anchor || source.id || "");
      if (!text) {
        return null;
      }
      const id = normalizeText(source.id || source.key || text).slice(0, 120);
      const key = `${id}\u001f${text}`.toLowerCase();
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      return {
        id,
        text: compactToBudget(text, 120)
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function retainedTextForQuality({ summary = "", messagesToKeep = [], reinjection = {} } = {}) {
  return [
    summary,
    ...asArray(messagesToKeep).map((message) =>
      typeof message === "string" ? message : (message.text || message.content || JSON.stringify(message))
    ),
    ...asArray(reinjection.items).map((item) =>
      typeof item?.value === "string" ? item.value : JSON.stringify(item?.value ?? "")
    )
  ].join("\n");
}

function buildCompactionQualityReport({
  input = {},
  runtimeState = {},
  summary = "",
  messagesToKeep = [],
  reinjection = {},
  tokenReport = null
} = {}) {
  const requiredAnchors = normalizeRequiredAnchors(input, runtimeState);
  const retainedRawText = retainedTextForQuality({ summary, messagesToKeep, reinjection });
  const retainedText = normalizeText(retainedRawText).toLowerCase();
  const retained = [];
  const missing = [];
  for (const anchor of requiredAnchors) {
    const matched = anchor.text && retainedText.includes(normalizeText(anchor.text).toLowerCase());
    (matched ? retained : missing).push(anchor);
  }
  const secretMatches = [
    ...(String(retainedRawText || "").match(SENSITIVE_TEXT_PATTERN) || []),
    ...(String(retainedRawText || "").match(ABSOLUTE_PATH_PATTERN) || [])
  ];
  const minimumRetentionRatio = clampNumber(
    input.compactionQuality?.minimumRetentionRatio,
    1,
    0,
    1
  );
  const retentionRatio = requiredAnchors.length
    ? Number((retained.length / requiredAnchors.length).toFixed(6))
    : 1;
  return {
    protocolVersion: "v0.0.1:agent:context-compaction-quality-1",
    requiredAnchorCount: requiredAnchors.length,
    retainedAnchorCount: retained.length,
    missingAnchorCount: missing.length,
    retentionRatio,
    minimumRetentionRatio,
    missingAnchors: missing.slice(0, 20),
    retainedAnchors: retained.slice(0, 20),
    secretLeakCount: secretMatches.length,
    compressionSavingsRatio: Number(tokenReport?.savingsRatio || 0),
    passed: retentionRatio >= minimumRetentionRatio && secretMatches.length === 0
  };
}

function buildDeterministicSummary({
  messages = [],
  runtimeState = {},
  targetTokens,
  compactedRange = {}
}) {
  const facts = collectStructuredFacts(messages, runtimeState);
  const messageSummaries = messages.slice(-60).map((message) => {
    const lines = selectImportantLines(message.text, 4);
    const toolIds = [...toolUseIds(message), ...toolResultIds(message)];
    return {
      id: message.id,
      role: message.role,
      apiRoundId: message.apiRoundId,
      toolIds,
      summary: compactToBudget(lines.join("\n") || message.text, 180)
    };
  }).filter((item) => item.summary || item.toolIds.length);
  const structured = {
    kind: "context_compaction_summary",
    sourceRange: compactedRange,
    taskBrief: runtimeState.taskBrief || runtimeState.task || "",
    activePlan: runtimeState.activePlan || null,
    facts,
    messages: messageSummaries
  };
  const summary = [
    "Context compaction summary. This is auxiliary memory, not canonical evidence.",
    `Source range: ${compactedRange.startMessageId || ""}..${compactedRange.endMessageId || ""}`,
    runtimeState.taskBrief ? `Current task: ${runtimeState.taskBrief}` : "",
    facts.constraints.length ? `Constraints:\n- ${facts.constraints.map(redactText).join("\n- ")}` : "",
    facts.decisions.length ? `Decisions:\n- ${facts.decisions.map(redactText).join("\n- ")}` : "",
    facts.risks.length ? `Risks/errors:\n- ${facts.risks.map(redactText).join("\n- ")}` : "",
    facts.todos.length ? `Open items:\n- ${facts.todos.map(redactText).join("\n- ")}` : "",
    facts.evidenceRefs.length ? `Evidence/source refs: ${facts.evidenceRefs.join(", ")}` : "",
    facts.fileRefs.length ? `File refs: ${facts.fileRefs.join(", ")}` : "",
    facts.knowledgeRefs.length ? `Knowledge refs: ${facts.knowledgeRefs.join(", ")}` : "",
    "Message notes:",
    ...messageSummaries.slice(-24).map((item) => `- [${item.role} ${item.id}] ${item.summary}`)
  ].filter(Boolean).join("\n");
  return {
    summary: compactToBudget(summary, targetTokens),
    structured: redactCompactionValue(structured)
  };
}

function parseModelSummary(value) {
  const text = String(value?.summary || value?.answer || value?.text || value || "").trim();
  if (!text) {
    throw new Error("model_compaction_empty");
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || "";
  if (!candidate) {
    throw new Error("model_compaction_json_missing");
  }
  const parsed = JSON.parse(candidate);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("model_compaction_schema_invalid");
  }
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    throw new Error("model_compaction_summary_missing");
  }
  return {
    summary: parsed.summary,
    structured: parsed
  };
}

function messagesByApiRound(messages = []) {
  const groups = [];
  let current = null;
  for (const message of messages) {
    if (!current || current.apiRoundId !== message.apiRoundId) {
      current = { apiRoundId: message.apiRoundId, messages: [] };
      groups.push(current);
    }
    current.messages.push(message);
  }
  return groups;
}

function modelInputForAttempt(messages = [], attempt = 0, maxInputTokens = 24000) {
  let groups = messagesByApiRound(messages);
  for (let drop = 0; drop < attempt && groups.length > 1; drop += 1) {
    groups = groups.slice(1);
  }
  let candidate = groups.flatMap((group) => group.messages);
  while (candidate.length > 1 && estimateContextTokens(candidate.map((message) => message.text).join("\n")) > maxInputTokens) {
    const nextGroups = messagesByApiRound(candidate).slice(1);
    candidate = nextGroups.length ? nextGroups.flatMap((group) => group.messages) : candidate.slice(1);
  }
  return candidate;
}

function workbenchInputForAttempt(messages = [], attempt = 0, maxInputTokens = 24000, trimRatio = 0.2) {
  let groups = messagesByApiRound(messages);
  const originalGroupCount = groups.length;
  if (attempt > 0 && groups.length > 1) {
    const dropCount = Math.min(
      groups.length - 1,
      Math.max(1, Math.ceil(groups.length * trimRatio * attempt))
    );
    groups = groups.slice(dropCount);
  }
  let droppedGroupCount = originalGroupCount - groups.length;
  let candidate = groups.flatMap((group) => group.messages);
  while (
    candidate.length > 1 &&
    estimateContextTokens(candidate.map((message) => message.text).join("\n")) > maxInputTokens
  ) {
    const nextGroups = messagesByApiRound(candidate);
    const dropCount = Math.min(
      nextGroups.length - 1,
      Math.max(1, Math.ceil(nextGroups.length * trimRatio))
    );
    if (dropCount <= 0) {
      candidate = candidate.slice(1);
      droppedGroupCount += 1;
      continue;
    }
    groups = nextGroups.slice(dropCount);
    droppedGroupCount += dropCount;
    candidate = groups.length ? groups.flatMap((group) => group.messages) : candidate.slice(1);
  }
  return {
    messages: candidate,
    metadata: {
      droppedGroupCount,
      trimRatio,
      inputTokens: estimateContextTokens(candidate.map((message) => message.text).join("\n"))
    }
  };
}

function buildModelPrompt({ messages, runtimeState, targetTokens, compactedRange }) {
  const payload = messages.map((message) => ({
    id: message.id,
    role: message.role,
    apiRoundId: message.apiRoundId,
    text: redactText(message.text),
    toolUseIds: toolUseIds(message),
    toolResultIds: toolResultIds(message)
  }));
  return [
    "You are Pact ContextCompactionRuntime.",
    "Compress context only. Do not invent facts. The output is auxiliary memory, not canonical evidence.",
    "Preserve user constraints, decisions, errors, TODOs, evidence/source ids, dates, amounts, file refs, tool call ids, and knowledge references.",
    "Return strict JSON with keys: summary, constraints, decisions, risks, todos, evidenceRefs, fileRefs, knowledgeRefs.",
    `Target tokens: ${targetTokens}`,
    `Source range: ${compactedRange.startMessageId || ""}..${compactedRange.endMessageId || ""}`,
    runtimeState.taskBrief ? `Current task: ${redactText(runtimeState.taskBrief)}` : "",
    JSON.stringify(payload)
  ].filter(Boolean).join("\n");
}

function buildReinjectionPayload({ input = {}, runtimeState = {}, policy }) {
  const source = {
    ...asObject(input.runtimeState),
    ...runtimeState
  };
  const candidates = [
    ["taskBrief", source.taskBrief || input.taskBrief || input.task || input.query || "", 100],
    ["activePlan", source.activePlan || input.activePlan || input.plan || "", 95],
    ["activeSkill", source.activeSkill || input.activeSkill || "", 88],
    ["activeToolUseIds", source.activeToolUseIds || input.activeToolUseIds || "", 84],
    ["openToolCalls", source.openToolCalls || input.openToolCalls || "", 82],
    ["enabledTools", source.enabledTools || input.enabledTools || input.tools || "", 80],
    ["operationCatalog", source.operationCatalog || input.operationCatalog || "", 75],
    ["currentFiles", source.currentFiles || input.currentFiles || "", 70],
    ["fileAttachments", source.fileAttachments || input.fileAttachments || "", 68],
    ["knowledgeReference", source.knowledgeReference || input.knowledgeReference || "", 65],
    ["mcpServers", source.mcpServers || input.mcpServers || "", 64],
    ["deferredToolDeltas", source.deferredToolDeltas || input.deferredToolDeltas || "", 62],
    ["maintenanceRun", source.maintenanceRun || input.maintenanceRun || "", 60],
    ["recentError", source.recentError || input.recentError || "", 55],
    ["worktreeState", source.worktreeState || input.worktreeState || "", 54],
    ["userConstraints", source.userConstraints || input.userConstraints || "", 50]
  ]
    .map(([key, value, priority]) => ({ key, value: redactCompactionValue(value), priority }))
    .filter((item) => item.value && estimateContextTokens(item.value) > 1);

  const selected = [];
  const dropped = [];
  let usedTokens = 0;
  for (const item of candidates.sort((left, right) => right.priority - left.priority)) {
    const tokens = estimateContextTokens(item.value);
    if (policy.reinjectionBudgetTokens > 0 && selected.length > 0 && usedTokens + tokens > policy.reinjectionBudgetTokens) {
      dropped.push({ key: item.key, reason: "reinjection_budget_exceeded", tokens });
      continue;
    }
    selected.push({ key: item.key, value: item.value, tokens, priority: item.priority });
    usedTokens += tokens;
  }
  return {
    items: selected,
    usedTokens,
    dropped,
    degraded: dropped.length > 0,
    budgetTokens: policy.reinjectionBudgetTokens
  };
}

function dehydrateAttachment(attachment = {}, policy) {
  const ref = attachment.ref || attachment.artifactRef || attachment.path || attachment.url || attachment.name || attachment.fileName || "";
  const summary = compactToBudget(
    attachment.summary || attachment.text || attachment.description || JSON.stringify(attachment),
    policy.maxAttachmentTokens
  );
  return {
    type: attachment.type || attachment.mediaType || "attachment",
    name: attachment.name || attachment.fileName || "",
    ref: redactText(String(ref || "")),
    checksum: attachment.checksum || attachment.sha256 || hashValue({ ref, summary }, 16),
    summary,
    dehydrated: true
  };
}

function isHeavyContentBlock(value = {}) {
  const block = asObject(value);
  const type = String(block.type || block.mediaType || block.kind || "").toLowerCase();
  return /image|document|attachment|binary|pdf|audio|video/.test(type) ||
    Boolean(block.data || block.dataBase64 || block.base64 || block.bytes || block.buffer);
}

function redactEmbeddedPayloads(value) {
  return redactText(value)
    .replace(/data:(?:image|application|audio|video)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[embedded media payload stripped]")
    .replace(/("(?:dataBase64|base64|data|bytes|buffer)"\s*:\s*")[^"]{64,}(")/gi, "$1[large encoded payload stripped]$2")
    .replace(/\b[A-Za-z0-9+/]{240,}={0,2}\b/g, "[large encoded payload stripped]");
}

function dehydrateContentBlock(block = {}, policy) {
  const source = asObject(block);
  const ref = source.ref || source.path || source.url || source.name || source.fileName || "";
  const originalType = String(source.type || source.mediaType || source.kind || "attachment");
  const summary = compactToBudget(
    source.summary || source.text || source.description || source.title || JSON.stringify({
      type: originalType,
      name: source.name || source.fileName || "",
      ref
    }),
    policy.maxAttachmentTokens
  );
  return {
    type: "dehydrated_payload",
    originalType,
    name: source.name || source.fileName || "",
    ref: redactText(String(ref || "")),
    checksum: source.checksum || source.sha256 || hashValue({ originalType, ref, summary }, 16),
    summary,
    dehydrated: true
  };
}

function stripHeavyPayloadsFromMessage(message = {}, policy) {
  let strippedBlockCount = 0;
  let dehydratedAttachmentCount = 0;
  const next = {
    ...message,
    text: redactEmbeddedPayloads(message.text || "")
  };

  if (Array.isArray(message.content)) {
    next.content = message.content.map((item) => {
      if (isHeavyContentBlock(item)) {
        strippedBlockCount += 1;
        return dehydrateContentBlock(item, policy);
      }
      if (typeof item === "string") {
        return redactEmbeddedPayloads(item);
      }
      if (item && typeof item === "object") {
        return {
          ...item,
          text: item.text ? redactEmbeddedPayloads(item.text) : item.text,
          content: typeof item.content === "string" ? redactEmbeddedPayloads(item.content) : item.content
        };
      }
      return item;
    });
  } else if (typeof message.content === "string") {
    next.content = redactEmbeddedPayloads(message.content);
  } else if (isHeavyContentBlock(message.content)) {
    strippedBlockCount += 1;
    next.content = dehydrateContentBlock(message.content, policy);
  }

  if (Array.isArray(message.blocks)) {
    next.blocks = message.blocks.map((block) => {
      if (isHeavyContentBlock(block)) {
        strippedBlockCount += 1;
        return dehydrateContentBlock(block, policy);
      }
      if (block && typeof block === "object") {
        return {
          ...block,
          text: block.text ? redactEmbeddedPayloads(block.text) : block.text,
          content: typeof block.content === "string" ? redactEmbeddedPayloads(block.content) : block.content
        };
      }
      return block;
    });
  }

  if (Array.isArray(message.attachments)) {
    next.attachments = message.attachments.map((attachment) => {
      if (isHeavyContentBlock(attachment) || estimateContextTokens(attachment) > policy.maxAttachmentTokens) {
        dehydratedAttachmentCount += 1;
        return dehydrateAttachment(attachment, policy);
      }
      return attachment;
    });
  }

  const normalized = normalizeMessage(next, message.index || 0);
  return {
    message: {
      ...normalized,
      index: message.index,
      apiRoundId: message.apiRoundId,
      id: message.id
    },
    strippedBlockCount,
    dehydratedAttachmentCount
  };
}

function prepareWorkbenchMessages(messages = [], policy) {
  const prepared = [];
  let strippedBlockCount = 0;
  let dehydratedAttachmentCount = 0;
  for (const message of messages) {
    const result = stripHeavyPayloadsFromMessage(message, policy);
    strippedBlockCount += result.strippedBlockCount;
    dehydratedAttachmentCount += result.dehydratedAttachmentCount;
    prepared.push(result.message);
  }
  const originalTokens = estimateContextTokens(messages.map((message) => message.text).join("\n"));
  const preparedTokens = estimateContextTokens(prepared.map((message) => message.text).join("\n"));
  return {
    messages: prepared,
    strippedBlockCount,
    dehydratedAttachmentCount,
    changedCount: strippedBlockCount + dehydratedAttachmentCount,
    originalTokens,
    preparedTokens,
    savedTokens: Math.max(0, originalTokens - preparedTokens)
  };
}

function summarizeToolResult(message = {}, policy) {
  const text = message.text || "";
  return {
    ...message,
    content: `[tool_result dehydrated: ${compactToBudget(text, policy.maxToolResultTokens)}]`,
    text: compactToBudget(text, policy.maxToolResultTokens),
    dehydrated: true,
    originalTokenEstimate: message.tokenEstimate,
    tokenEstimate: Math.min(message.tokenEstimate, policy.maxToolResultTokens)
  };
}

function microCompactMessages(messages = [], { policy, activeToolUseIds = [] } = {}) {
  if (!policy.microCompaction) {
    return {
      messages,
      changedCount: 0,
      dehydratedAttachments: []
    };
  }
  const activeSet = new Set(asArray(activeToolUseIds).map((item) => String(item)));
  const protectedStart = Math.max(0, messages.length - policy.recentMessageProtectionCount);
  const dehydratedAttachments = [];
  const compacted = messages.map((message, index) => {
    let next = message;
    const messageToolIds = [...toolUseIds(message), ...toolResultIds(message)];
    const isProtected = index >= protectedStart ||
      messageToolIds.some((id) => activeSet.has(id)) ||
      (/error|failed|failure|异常|失败/i.test(message.text) && index >= Math.max(0, messages.length - policy.recentMessageProtectionCount * 2));

    if (!isProtected && (message.role === "tool" || message.type === "tool_result") && message.tokenEstimate > policy.maxToolResultTokens) {
      next = summarizeToolResult(message, policy);
    }

    if (policy.allowAttachmentDehydration && asArray(next.attachments).length) {
      const attachments = next.attachments.map((attachment) => {
        const tokens = estimateContextTokens(attachment);
        if (tokens <= policy.maxAttachmentTokens) {
          return attachment;
        }
        const dehydrated = dehydrateAttachment(attachment, policy);
        dehydratedAttachments.push(dehydrated);
        return dehydrated;
      });
      next = {
        ...next,
        attachments
      };
    }
    return next;
  });
  const changedCount = compacted.filter((message, index) => message !== messages[index]).length;
  return {
    messages: compacted,
    changedCount,
    dehydratedAttachments
  };
}

function publicStrategyConfig(policy = {}) {
  const strategy = asObject(policy.strategy);
  const params = asObject(strategy.params);
  return {
    id: String(strategy.id || policy.strategyId || "").trim(),
    paramKeys: Object.keys(params).sort()
  };
}

function normalizeStrategyOutput(raw = {}, context = {}, fallbackStrategy = "") {
  const output = asObject(raw);
  const summaryResult = asObject(output.summaryResult);
  const summary = String(
    summaryResult.summary ||
      output.summary ||
      output.text ||
      output.content ||
      output.result?.summary ||
      output.result?.text ||
      ""
  ).trim();
  if (!summary) {
    throw new Error("context_compaction_strategy_summary_missing");
  }
  return {
    executionMode: String(
      output.executionMode ||
        output.mode ||
        output.strategy ||
        fallbackStrategy ||
        context.policy?.strategy?.id ||
        "custom"
    ),
    summaryResult: {
      ...summaryResult,
      summary: compactToBudget(summary, context.targetTokens || context.policy?.summaryReserveTokens || 4000),
      structured: redactCompactionValue(
        summaryResult.structured ||
          output.structured ||
          output.data ||
          output.result?.structured ||
          {}
      )
    },
    degradedReasons: asArray(output.degradedReasons),
    modelEvents: asArray(output.modelEvents),
    memoryEvents: asArray(output.memoryEvents),
    preprocessingEvents: asArray(output.preprocessingEvents),
    adapter: output.adapter || null
  };
}

function standardStrategyInput(context = {}) {
  const policy = asObject(context.policy);
  const strategy = asObject(policy.strategy);
  return {
    protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
    strategy: {
      id: String(strategy.id || policy.strategyId || "").trim(),
      params: redactCompactionValue(asObject(strategy.params))
    },
    sessionId: context.sessionId || "",
    source: context.source || "",
    profileId: context.profile?.profileId || "",
    budget: context.budget || {},
    triggerReason: context.triggerReason || "",
    sourceTokens: context.sourceTokens || 0,
    targetTokens: context.targetTokens || 0,
    sourceHash: context.sourceHash || "",
    compactedRange: context.compactedRange || {},
    runtimeState: redactCompactionValue(context.runtimeState || {}),
    messages: context.messages || [],
    compactedMessages: context.compactedMessages || [],
    keptMessages: context.keptOriginal || [],
    helpers: Object.freeze({
      estimateTokens: estimateContextTokens,
      compactToBudget,
      redactText,
      redactValue: redactCompactionValue
    })
  };
}

export function createContextCompactionStrategyAdapter({
  id,
  label = "",
  inputAdapter = null,
  run,
  outputAdapter = null
} = {}) {
  const rawId = String(id || "").trim();
  if (!rawId) {
    throw new Error("context_compaction_strategy_id_required");
  }
  const normalizedId = normalizeStrategyId(rawId);
  if (typeof run !== "function") {
    throw new Error(`context_compaction_strategy_run_required:${normalizedId}`);
  }
  return Object.freeze({
    adapterProtocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
    id: normalizedId,
    label: String(label || normalizedId),
    async run(context = {}) {
      const strategyInput = typeof inputAdapter === "function" ? inputAdapter(context) : standardStrategyInput(context);
      const rawOutput = await run(strategyInput, context);
      const output = typeof outputAdapter === "function"
        ? await outputAdapter(rawOutput, context, strategyInput)
        : rawOutput;
      return normalizeStrategyOutput(output, context, normalizedId);
    }
  });
}

export function listContextCompactionStrategies(extraStrategies = []) {
  const custom = asArray(extraStrategies)
    .map((item) => item?.id || item?.strategyId || item?.name)
    .filter(Boolean)
    .map((id) => Object.freeze({
      id: normalizeStrategyId(id),
      label: String(id),
      custom: true
    }));
  const byId = new Map();
  for (const strategy of [...BUILTIN_COMPACTION_STRATEGIES, ...custom]) {
    byId.set(strategy.id, strategy);
  }
  return [...byId.values()];
}

function publicRecordFromResult(result = {}) {
  return {
    protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
    recordId: result.recordId,
    boundaryId: result.boundary?.boundaryId || "",
    sessionId: result.sessionId || "",
    profileId: result.profileId || "",
    source: result.source || "",
    status: result.status || "",
    triggerReason: result.triggerReason || "",
    strategy: result.strategy || null,
    executionMode: result.executionMode || "",
    degraded: result.degraded === true,
    degradedReasons: result.degradedReasons || [],
    circuitBreaker: result.circuitBreaker || null,
    preprocessingEvents: result.preprocessingEvents || [],
    cutPoint: result.cutPoint || null,
    tokenReport: result.tokenReport || null,
    qualityReport: result.qualityReport || null,
    boundary: result.boundary || null,
    createdAt: result.createdAt || nowIso()
  };
}

async function appendJsonl(filePath, value) {
  await appendJsonLineSerialized(filePath, value);
}

async function readJsonlTail(filePath, limit = 50) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(Number(limit || 50), 1000)))
      .map((line) => JSON.parse(line))
      .reverse();
  } catch {
    return [];
  }
}

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await atomicWriteJson(filePath, value, { trailingNewline: false });
}

export function createContextCompactionRuntime({
  userDataPath,
  agentGatewayCall = null,
  modelCompressor = null,
  agentMemory = null,
  strategies = [],
  compactionStrategies = []
}) {
  const rootPath = path.join(userDataPath, "context-core");
  const recordsPath = path.join(rootPath, "context-compaction-records.jsonl");
  const boundariesPath = path.join(rootPath, "context-compaction-boundaries.jsonl");
  const memoryStore = agentMemory || createAgentMemory({ userDataPath });
  const sessionMemoryPath = memoryStore.sessionMemoryPath;
  const statePath = path.join(rootPath, "context-compaction-state.json");

  async function getState() {
    const state = await readJson(statePath, {});
    return {
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      modelFailureCount: Math.max(0, Number(state.modelFailureCount || 0)),
      autoFailureCount: Math.max(0, Number(state.autoFailureCount || 0)),
      circuitOpenUntil: state.circuitOpenUntil || "",
      updatedAt: state.updatedAt || ""
    };
  }

  async function saveState(patch = {}) {
    const state = {
      ...(await getState()),
      ...patch,
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      updatedAt: nowIso()
    };
    await writeJson(statePath, state);
    return state;
  }

  async function resetFailureState() {
    return saveState({ modelFailureCount: 0, autoFailureCount: 0, circuitOpenUntil: "" });
  }

  async function registerModelFailure(policy) {
    const state = await getState();
    const modelFailureCount = state.modelFailureCount + 1;
    const circuitOpenUntil = modelFailureCount >= policy.maxConsecutiveFailures
      ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
      : state.circuitOpenUntil;
    return saveState({ modelFailureCount, circuitOpenUntil });
  }

  async function registerAutoFailure(policy) {
    const state = await getState();
    const autoFailureCount = state.autoFailureCount + 1;
    const circuitOpenUntil = autoFailureCount >= policy.maxConsecutiveFailures
      ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
      : state.circuitOpenUntil;
    return saveState({ autoFailureCount, circuitOpenUntil });
  }

  async function latestSessionMemory({ sessionId = "", profileId = "", sourceHash = "" } = {}) {
    return memoryStore.latestSessionMemory({ sessionId, profileId, sourceHash });
  }

  async function appendSessionMemory(entry = {}) {
    return memoryStore.appendSessionMemory({
      ...entry,
      sourceProtocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION
    });
  }

  async function listSessionMemory(input = {}) {
    return memoryStore.listSessionMemory(input);
  }

  async function clearSessionMemory(input = {}) {
    const result = await memoryStore.clearSessionMemory(input);
    await resetFailureState();
    return result;
  }

  async function modelAssistedSummary({
    profile,
    policy,
    messages,
    runtimeState,
    targetTokens,
    compactedRange,
    inputForAttempt = null
  }) {
    const attempts = [];
    const maxAttempts = Math.max(1, policy.ptlRetryLimit + 1);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const selected = typeof inputForAttempt === "function"
        ? inputForAttempt(messages, attempt, policy)
        : modelInputForAttempt(messages, attempt, policy.modelMaxInputTokens);
      const attemptMessages = Array.isArray(selected) ? selected : asArray(selected.messages);
      const prompt = buildModelPrompt({
        messages: attemptMessages,
        runtimeState,
        targetTokens,
        compactedRange
      });
      attempts.push({
        attempt,
        messageCount: attemptMessages.length,
        promptTokens: estimateContextTokens(prompt),
        ...asObject(selected.metadata)
      });
      try {
        const response = typeof modelCompressor === "function"
          ? await modelCompressor({
              profile,
              policy,
              messages: attemptMessages,
              runtimeState,
              targetTokens,
              prompt
            })
          : await agentGatewayCall?.({
              alias: profile.modelCompression?.alias || profile.modelAlias,
              modelAlias: profile.modelCompression?.alias || profile.modelAlias,
              question: prompt,
              parameters: {
                temperature: 0,
                max_tokens: Math.max(256, Math.min(policy.modelMaxOutputTokens, targetTokens)),
                stream: false,
                tool_choice: "none"
              }
            });
        const parsed = parseModelSummary(response);
        return {
          ok: true,
          summary: compactToBudget(parsed.summary, targetTokens),
          structured: redactCompactionValue(parsed.structured),
          attempts
        };
      } catch (error) {
        attempts[attempt].error = error instanceof Error ? error.message : "model_compaction_failed";
      }
    }
    throw new Error(attempts.at(-1)?.error || "model_compaction_failed");
  }

  function modelCompressionConfigured(context) {
    return context.profile.modelCompression?.enabled === true || context.input.modelAssisted === true;
  }

  async function runDeterministicStrategy(context) {
    return normalizeStrategyOutput(
      {
        executionMode: "deterministic-extractive",
        summaryResult: buildDeterministicSummary({
          messages: context.compactedMessages,
          runtimeState: context.runtimeState,
          targetTokens: context.targetTokens,
          compactedRange: context.compactedRange
        })
      },
      context,
      "deterministic-extractive"
    );
  }

  async function runModelAssistedStrategy(context) {
    const degradedReasons = [];
    const modelEvents = [];
    if (context.circuitOpen) {
      degradedReasons.push("model_circuit_breaker_open");
      return {
        ...(await runDeterministicStrategy(context)),
        degradedReasons,
        modelEvents
      };
    }

    const modelAllowed =
      modelCompressionConfigured(context) &&
      (typeof modelCompressor === "function" || typeof agentGatewayCall === "function");
    if (!modelAllowed) {
      return runDeterministicStrategy(context);
    }

    try {
      const modelSummary = await modelAssistedSummary({
        profile: context.profile,
        policy: context.policy,
        messages: context.compactedMessages,
        runtimeState: context.runtimeState,
        targetTokens: context.targetTokens,
        compactedRange: context.compactedRange
      });
      modelEvents.push({
        used: true,
        degraded: false,
        attempts: modelSummary.attempts
      });
      await resetFailureState();
      return normalizeStrategyOutput(
        {
          executionMode: "model-assisted",
          summaryResult: modelSummary,
          modelEvents
        },
        context,
        "model-assisted"
      );
    } catch (error) {
      const nextState = await registerModelFailure(context.policy);
      degradedReasons.push(error instanceof Error ? error.message : "model_compaction_failed");
      modelEvents.push({
        used: false,
        degraded: true,
        error: error instanceof Error ? error.message : "model_compaction_failed",
        modelFailureCount: nextState.modelFailureCount
      });
      return {
        ...(await runDeterministicStrategy(context)),
        degradedReasons,
        modelEvents
      };
    }
  }

  async function runWorkbenchReconstructionStrategy(context) {
    const prepared = prepareWorkbenchMessages(context.compactedMessages, context.policy);
    const preprocessingEvents = [{
      type: "payload_dehydration",
      strippedBlockCount: prepared.strippedBlockCount,
      dehydratedAttachmentCount: prepared.dehydratedAttachmentCount,
      originalTokens: prepared.originalTokens,
      preparedTokens: prepared.preparedTokens,
      savedTokens: prepared.savedTokens
    }];
    const preparedContext = {
      ...context,
      compactedMessages: prepared.messages
    };
    const degradedReasons = [];
    const modelEvents = [];
    if (context.circuitOpen) {
      degradedReasons.push("model_circuit_breaker_open");
      return {
        ...(await normalizeStrategyOutput(
          {
            executionMode: "workbench-deterministic",
            summaryResult: buildDeterministicSummary({
              messages: prepared.messages,
              runtimeState: context.runtimeState,
              targetTokens: context.targetTokens,
              compactedRange: context.compactedRange
            }),
            preprocessingEvents
          },
          preparedContext,
          "workbench-deterministic"
        )),
        degradedReasons,
        modelEvents,
        preprocessingEvents
      };
    }

    const modelAllowed =
      modelCompressionConfigured(context) &&
      (typeof modelCompressor === "function" || typeof agentGatewayCall === "function");
    if (!modelAllowed) {
      return normalizeStrategyOutput(
        {
          executionMode: "workbench-deterministic",
          summaryResult: buildDeterministicSummary({
            messages: prepared.messages,
            runtimeState: context.runtimeState,
            targetTokens: context.targetTokens,
            compactedRange: context.compactedRange
          }),
          degradedReasons: ["model_compaction_not_configured"],
          preprocessingEvents
        },
        preparedContext,
        "workbench-deterministic"
      );
    }

    try {
      const modelSummary = await modelAssistedSummary({
        profile: context.profile,
        policy: context.policy,
        messages: prepared.messages,
        runtimeState: context.runtimeState,
        targetTokens: context.targetTokens,
        compactedRange: context.compactedRange,
        inputForAttempt: (messages, attempt, policy) =>
          workbenchInputForAttempt(messages, attempt, policy.modelMaxInputTokens, policy.ptlHeadTrimRatio)
      });
      modelEvents.push({
        used: true,
        degraded: false,
        promptCacheCompatible: true,
        attempts: modelSummary.attempts
      });
      await resetFailureState();
      return normalizeStrategyOutput(
        {
          executionMode: "workbench-reconstruction",
          summaryResult: modelSummary,
          modelEvents,
          preprocessingEvents
        },
        preparedContext,
        "workbench-reconstruction"
      );
    } catch (error) {
      const nextState = await registerModelFailure(context.policy);
      degradedReasons.push(error instanceof Error ? error.message : "model_compaction_failed");
      modelEvents.push({
        used: false,
        degraded: true,
        error: error instanceof Error ? error.message : "model_compaction_failed",
        modelFailureCount: nextState.modelFailureCount
      });
      return normalizeStrategyOutput(
        {
          executionMode: "workbench-deterministic",
          summaryResult: buildDeterministicSummary({
            messages: prepared.messages,
            runtimeState: context.runtimeState,
            targetTokens: context.targetTokens,
            compactedRange: context.compactedRange
          }),
          degradedReasons,
          modelEvents,
          preprocessingEvents
        },
        preparedContext,
        "workbench-deterministic"
      );
    }
  }

  async function runSessionMemoryFirstStrategy(context) {
    const memoryEvents = [];
    if (context.input.useSessionMemory !== false) {
      const memory = await latestSessionMemory({
        sessionId: context.sessionId,
        profileId: context.profile.profileId || "",
        sourceHash: context.sourceHash
      });
      if (memory?.summary) {
        memoryEvents.push({ used: true, memoryId: memory.memoryId, sourceHash: context.sourceHash });
        return normalizeStrategyOutput(
          {
            executionMode: "session-memory",
            summaryResult: {
              summary: memory.summary,
              structured: memory.structured || {},
              memoryId: memory.memoryId
            },
            memoryEvents
          },
          context,
          "session-memory"
        );
      }

      const latestMemory = await latestSessionMemory({
        sessionId: context.sessionId,
        profileId: context.profile.profileId || ""
      });
      if (latestMemory?.summary) {
        memoryEvents.push({
          used: false,
          memoryId: latestMemory.memoryId,
          reason: latestMemory.sourceHash ? "source_hash_mismatch" : "source_hash_missing",
          expectedSourceHash: context.sourceHash,
          actualSourceHash: latestMemory.sourceHash || ""
        });
      }
    }

    const fallback = await runModelAssistedStrategy(context);
    return {
      ...fallback,
      memoryEvents: [
        ...memoryEvents,
        ...asArray(fallback.memoryEvents)
      ]
    };
  }

  const strategyAdapters = new Map([
    ["deterministic-extractive", {
      id: "deterministic-extractive",
      label: "Deterministic extractive context summary",
      run: runDeterministicStrategy
    }],
    ["workbench-reconstruction", {
      id: "workbench-reconstruction",
      label: "Model-assisted compaction with payload dehydration and workbench state reinjection",
      run: runWorkbenchReconstructionStrategy
    }],
    ["model-assisted", {
      id: "model-assisted",
      label: "Model-assisted summary with deterministic fallback",
      run: runModelAssistedStrategy
    }],
    ["session-memory-first", {
      id: "session-memory-first",
      label: "Session memory first with model-assisted fallback",
      run: runSessionMemoryFirstStrategy
    }]
  ]);

  for (const adapter of [...asArray(strategies), ...asArray(compactionStrategies)]) {
    const normalized = adapter?.adapterProtocolVersion === CONTEXT_COMPACTION_PROTOCOL_VERSION
      ? adapter
      : createContextCompactionStrategyAdapter(adapter);
    strategyAdapters.set(normalizeStrategyId(normalized.id), normalized);
  }

  function resolveStrategyAdapter(policy = {}) {
    const strategyId = normalizeStrategyId(policy.strategy?.id || policy.strategyId);
    const adapter = strategyAdapters.get(strategyId);
    if (!adapter) {
      throw new Error(`context_compaction_strategy_unknown:${strategyId}`);
    }
    return adapter;
  }

  async function runConfiguredStrategy(context = {}) {
    const adapter = resolveStrategyAdapter(context.policy);
    const result = await adapter.run(context);
    return {
      ...result,
      strategy: {
        ...publicStrategyConfig(context.policy),
        id: adapter.id,
        label: adapter.label || adapter.id
      }
    };
  }

  async function compactMessages(input = {}) {
    const profile = asObject(input.profile);
    const policy = normalizeCompactionPolicy(profile, input.compactionPolicy || input.policy);
    const budget = computeCompactionBudget(profile, policy);
    const sessionId = String(input.sessionId || input.conversationId || input.threadId || "default");
    const source = String(input.source || input.inputSource || "runtime");
    const createdAt = nowIso();
    const messages = normalizeConversationInput(input);
    const sourceTokens = estimateContextTokens(messages.map((message) => message.text).join("\n"));
    const graph = buildMessageGraph(messages);
    const triggerReason =
      sourceTokens >= budget.hardThresholdTokens
        ? "hard_threshold"
        : sourceTokens >= budget.autoCompactThresholdTokens
          ? "auto_threshold"
          : sourceTokens >= budget.warningThresholdTokens
            ? "warning_threshold"
            : "within_budget";
    const force = input.force === true || input.manual === true;
    const shouldCompact = force || (policy.enabled && sourceTokens >= budget.autoCompactThresholdTokens);
    const state = await getState();
    const circuitOpen = state.circuitOpenUntil && Date.parse(state.circuitOpenUntil) > Date.now();

    if (!shouldCompact) {
      return {
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        status: "skipped",
        source,
        sessionId,
        profileId: profile.profileId || "",
        triggerReason,
        shouldCompact: false,
        compacted: false,
        strategy: publicStrategyConfig(policy),
        executionMode: "",
        createdAt,
        tokenReport: {
          sourceTokens,
          effectiveWindowTokens: budget.effectiveWindowTokens,
          warningThresholdTokens: budget.warningThresholdTokens,
          autoCompactThresholdTokens: budget.autoCompactThresholdTokens,
          hardThresholdTokens: budget.hardThresholdTokens,
          summaryTokens: 0,
          keptTokens: sourceTokens,
          reinjectionTokens: 0,
          savingsRatio: 0
        },
        circuitBreaker: {
          open: Boolean(circuitOpen),
          modelFailureCount: state.modelFailureCount,
          autoFailureCount: state.autoFailureCount,
          openUntil: state.circuitOpenUntil
        }
      };
    }

    try {
      const cutPoint = chooseCompactionCutPoint(messages, { profile, policyPatch: policy });
      const compactedMessages = graph.messages.slice(0, cutPoint.cutIndex);
      const keptOriginal = graph.messages.slice(cutPoint.cutIndex);
      const runtimeState = {
        ...asObject(input.runtimeState),
        taskBrief: input.taskBrief || input.task || input.query || input.runtimeState?.taskBrief || "",
        activePlan: input.activePlan || input.plan || input.runtimeState?.activePlan || null,
        knowledgeReference:
          input.knowledgeReference ||
          input.runtimeState?.knowledgeReference ||
          ""
      };
      const compactedRange = {
        startIndex: compactedMessages[0]?.index ?? 0,
        endIndex: compactedMessages.at(-1)?.index ?? -1,
        startMessageId: compactedMessages[0]?.id || "",
        endMessageId: compactedMessages.at(-1)?.id || "",
        compactedMessageCount: compactedMessages.length
      };
      const targetTokens = Math.max(
        128,
        Math.min(
          policy.summaryReserveTokens,
          Math.floor(Math.max(sourceTokens, 1) * policy.deterministicTargetRatio)
        )
      );
      const sourceHash = hashValue({
        sessionId,
        profileId: profile.profileId || "",
        compactedRange,
        messageIds: compactedMessages.map((message) => message.id),
        sourceTokens,
        taskBrief: runtimeState.taskBrief || "",
        activePlan: runtimeState.activePlan || null,
        knowledgeReference: runtimeState.knowledgeReference || ""
      });

      const strategyResult = await runConfiguredStrategy({
        input,
        profile,
        policy,
        budget,
        sessionId,
        source,
        createdAt,
        messages,
        graph,
        sourceTokens,
        triggerReason,
        state,
        circuitOpen,
        cutPoint,
        compactedMessages,
        keptOriginal,
        runtimeState,
        compactedRange,
        targetTokens,
        sourceHash
      });
      const executionMode = strategyResult.executionMode || "deterministic-extractive";
      const summaryResult = strategyResult.summaryResult;
      const degradedReasons = [...asArray(strategyResult.degradedReasons)];
      const modelEvents = [...asArray(strategyResult.modelEvents)];
      const memoryEvents = [...asArray(strategyResult.memoryEvents)];
      const preprocessingEvents = [...asArray(strategyResult.preprocessingEvents)];
      const strategy = strategyResult.strategy || publicStrategyConfig(policy);

      const reinjection = buildReinjectionPayload({
        input,
        runtimeState,
        policy
      });
      if (reinjection.degraded) {
        degradedReasons.push("reinjection_budget_exceeded");
      }

      const micro = microCompactMessages(keptOriginal, {
        policy,
        activeToolUseIds: input.activeToolUseIds || input.runtimeState?.activeToolUseIds || []
      });
      const messagesToKeep = micro.messages;
      const summary = redactText(summaryResult.summary || "");
      const summaryTokens = estimateContextTokens(summary);
      const keptTokens = estimateContextTokens(messagesToKeep.map((message) => message.text || message.content || "").join("\n"));
      const reinjectionTokens = reinjection.usedTokens;
      const finalTokens = summaryTokens + keptTokens + reinjectionTokens;
      const tokenReport = {
        sourceTokens,
        effectiveWindowTokens: budget.effectiveWindowTokens,
        warningThresholdTokens: budget.warningThresholdTokens,
        autoCompactThresholdTokens: budget.autoCompactThresholdTokens,
        hardThresholdTokens: budget.hardThresholdTokens,
        compactedSourceTokens: estimateContextTokens(compactedMessages.map((message) => message.text).join("\n")),
        summaryTokens,
        keptTokens,
        reinjectionTokens,
        finalTokens,
        savedTokens: Math.max(0, sourceTokens - finalTokens),
        savingsRatio: Number((Math.max(0, sourceTokens - finalTokens) / Math.max(1, sourceTokens)).toFixed(6))
      };
      const qualityReport = buildCompactionQualityReport({
        input,
        runtimeState,
        summary,
        messagesToKeep,
        reinjection,
        tokenReport
      });
      if (!qualityReport.passed) {
        degradedReasons.push(
          qualityReport.missingAnchorCount > 0
            ? "required_anchor_loss"
            : "compaction_quality_failed"
        );
      }
      const boundary = {
        type: "compact_boundary",
        boundaryId: `context_boundary_${crypto.randomUUID()}`,
        profileId: profile.profileId || "",
        sessionId,
        sourceRange: compactedRange,
        lastOriginalMessageId: compactedMessages.at(-1)?.id || "",
        summaryChecksum: hashValue(summary),
        preservedTailCount: messagesToKeep.length,
        tokenReport,
        qualityReport,
        strategy,
        executionMode,
        degraded: degradedReasons.length > 0,
        createdAt
      };
      const boundaryMessage = {
        id: boundary.boundaryId,
        role: "system",
        type: "compact_boundary",
        content: summary,
        boundary,
        reinjection
      };
      const result = {
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        recordId: `context_compaction_${crypto.randomUUID()}`,
        status: "completed",
        source,
        sessionId,
        profileId: profile.profileId || "",
        triggerReason,
        shouldCompact: true,
        compacted: true,
        strategy,
        executionMode,
        degraded: degradedReasons.length > 0,
        degradedReasons,
        modelEvents,
        memoryEvents,
        preprocessingEvents,
        cutPoint,
        boundary,
        boundaryMessage,
        summary,
        structuredSummary: summaryResult.structured || {},
        reinjection,
        messagesToKeep,
        attachmentsToReinject: micro.dehydratedAttachments,
        microCompaction: {
          changedCount: micro.changedCount,
          dehydratedAttachmentCount: micro.dehydratedAttachments.length
        },
        circuitBreaker: {
          open: Boolean(circuitOpen),
          modelFailureCount: (await getState()).modelFailureCount,
          autoFailureCount: (await getState()).autoFailureCount,
          openUntil: (await getState()).circuitOpenUntil
        },
        tokenReport,
        qualityReport,
        createdAt
      };

      if (input.persist !== false) {
        await appendJsonl(recordsPath, publicRecordFromResult(result));
        if (policy.persistBoundaries) {
          await appendJsonl(boundariesPath, {
            ...boundary,
            summaryChecksum: hashValue(summary),
            contentPreview: compactToBudget(summary, 260)
          });
        }
        if (policy.persistSessionMemory) {
          await appendSessionMemory({
            sessionId,
            profileId: profile.profileId || "",
            boundaryId: boundary.boundaryId,
            sourceHash,
            summary,
            structured: summaryResult.structured || {},
            summaryChecksum: boundary.summaryChecksum,
            sourceRange: compactedRange,
            createdAt
          });
        }
      }
      return result;
    } catch (error) {
      const nextState = await registerAutoFailure(policy);
      const failed = {
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        recordId: `context_compaction_${crypto.randomUUID()}`,
        status: "failed",
        source,
        sessionId,
        profileId: profile.profileId || "",
        triggerReason,
        shouldCompact: true,
        compacted: false,
        degraded: true,
        strategy: publicStrategyConfig(policy),
        executionMode: "",
        error: error instanceof Error ? redactText(error.message) : "context_compaction_failed",
        circuitBreaker: {
          open: Boolean(nextState.circuitOpenUntil && Date.parse(nextState.circuitOpenUntil) > Date.now()),
          modelFailureCount: nextState.modelFailureCount,
          autoFailureCount: nextState.autoFailureCount,
          openUntil: nextState.circuitOpenUntil
        },
        createdAt
      };
      if (input.persist !== false) {
        await appendJsonl(recordsPath, publicRecordFromResult(failed));
      }
      throw error;
    }
  }

  async function preview(input = {}) {
    const result = await compactMessages({
      ...input,
      persist: false,
      force: input.force === true || input.manual === true
    });
    return {
      ...result,
      preview: true
    };
  }

  async function run(input = {}) {
    return compactMessages({
      ...input,
      force: input.force !== false
    });
  }

  async function maybeCompact(input = {}) {
    return compactMessages(input);
  }

  async function listRecords(input = {}) {
    const records = await readJsonlTail(recordsPath, input.limit || 50);
    return {
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      path: recordsPath,
      records
    };
  }

  async function listBoundaries(input = {}) {
    const records = await readJsonlTail(boundariesPath, input.limit || 50);
    return {
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      path: boundariesPath,
      boundaries: records
    };
  }

  function listStrategies() {
    const builtinIds = new Set(BUILTIN_COMPACTION_STRATEGIES.map((item) => item.id));
    return {
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      strategies: [...strategyAdapters.values()].map((adapter) => ({
        id: adapter.id,
        label: adapter.label || adapter.id,
        custom: !builtinIds.has(adapter.id)
      }))
    };
  }

  function resumeTranscript(input = {}) {
    const messages = normalizeConversationInput(input);
    let boundaryIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].type === "compact_boundary" || messages[index].boundary?.type === "compact_boundary") {
        boundaryIndex = index;
        break;
      }
    }
    if (boundaryIndex < 0) {
      return {
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        resumed: false,
        messages
      };
    }
    const boundary = messages[boundaryIndex].boundary || {};
    return {
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      resumed: true,
      boundary,
      messages: [
        {
          id: boundary.boundaryId || messages[boundaryIndex].id,
          role: "system",
          type: "compact_boundary",
          content: messages[boundaryIndex].content || messages[boundaryIndex].text || "",
          boundary
        },
        ...messages.slice(boundaryIndex + 1)
      ],
      skippedMessageCount: boundaryIndex
    };
  }

  return {
    protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
    rootPath,
    recordsPath,
    boundariesPath,
    sessionMemoryPath,
    agentMemory: memoryStore,
    statePath,
    computeBudget: computeCompactionBudget,
    normalizePolicy: normalizeCompactionPolicy,
    chooseCutPoint: chooseCompactionCutPoint,
    buildMessageGraph,
    preview,
    run,
    maybeCompact,
    listRecords,
    listBoundaries,
    listStrategies,
    listSessionMemory,
    clearSessionMemory,
    latestSessionMemory,
    resumeTranscript,
    estimateTokens: estimateContextTokens,
    redactValue: redactCompactionValue
  };
}

export default createContextCompactionRuntime;
