import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  CONTEXT_COMPACTION_PROTOCOL_VERSION,
  createContextCompactionRuntime,
  normalizeCompactionPolicy
} from "../context-compact/index.mjs";
import {
  appendJsonLineSerialized,
  atomicWriteJson
} from "../../../../common/platform-core/state-coordinator.mjs";

export const CONTEXT_RUNTIME_PROTOCOL_VERSION = "v0.0.1:agent:context-1";

const FALLBACK_CONTEXT_PROFILES = [
  {
    profileId: "context-32k",
    label: "32K Context",
    modelAlias: "default",
    contextWindowTokens: 32000,
    outputReserveTokens: 4000,
    toolReserveTokens: 3000,
    fixedMemoryBudget: 1000,
    knowledgeBudget: 8000,
    historyBudget: 7000,
    recentTurnBudget: 6000,
    compression: {
      enabled: true,
      threshold: 0.5,
      targetRatio: 0.22,
      protectLastNTurns: 5,
      summaryMaxTokens: 4000,
      strategy: "deterministic-extractive"
    }
  },
  {
    profileId: "context-128k",
    label: "128K Context",
    modelAlias: "default",
    contextWindowTokens: 128000,
    outputReserveTokens: 8000,
    toolReserveTokens: 12000,
    fixedMemoryBudget: 2200,
    knowledgeBudget: 36000,
    historyBudget: 42000,
    recentTurnBudget: 24000,
    compression: {
      enabled: true,
      threshold: 0.55,
      targetRatio: 0.25,
      protectLastNTurns: 12,
      summaryMaxTokens: 12000,
      strategy: "workbench-reconstruction"
    }
  },
  {
    profileId: "context-1m",
    label: "1M Context",
    modelAlias: "default",
    contextWindowTokens: 1000000,
    outputReserveTokens: 24000,
    toolReserveTokens: 36000,
    fixedMemoryBudget: 6000,
    knowledgeBudget: 320000,
    historyBudget: 360000,
    recentTurnBudget: 180000,
    compression: {
      enabled: true,
      threshold: 0.72,
      targetRatio: 0.42,
      protectLastNTurns: 24,
      summaryMaxTokens: 64000,
      strategy: "workbench-reconstruction"
    }
  }
];

const DEPRECATED_CONTEXT_PROFILE_IDS = new Set([
  "balanced",
  "small-context",
  "deepseek-v3-671b"
]);

function isDeprecatedContextProfile(profile = {}) {
  const profileId = String(profile.profileId || profile.id || "").trim();
  const label = String(profile.label || "").trim();
  return (
    DEPRECATED_CONTEXT_PROFILE_IDS.has(profileId) ||
    label === "Balanced Context" ||
    label === "Small Context" ||
    label === "DeepSeek V3 671B"
  );
}

function sortContextProfiles(profiles = []) {
  return [...profiles].sort((left, right) => {
    const tokenCompare = Number(left.contextWindowTokens || 0) - Number(right.contextWindowTokens || 0);
    if (tokenCompare !== 0) return tokenCompare;
    return String(left.profileId || "").localeCompare(String(right.profileId || ""));
  });
}

class ContextProfileManager {
  constructor() {
    this.profiles = [];
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.profilesDir = path.resolve(__dirname, "../../../../../config/context-profiles");
  }

  loadProfilesSync() {
    let loaded = [];
    if (!fsSync.existsSync(this.profilesDir)) {
      loaded = [];
    } else {
      const files = fsSync.readdirSync(this.profilesDir).sort();
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const content = fsSync.readFileSync(path.join(this.profilesDir, file), "utf8");
            loaded.push(JSON.parse(content));
          } catch (error) {
            console.error(`Failed to load context profile from ${file}:`, error);
          }
        }
      }
    }
    const byId = new Map();
    for (const profile of loaded.filter((profile) => profile && !isDeprecatedContextProfile(profile))) {
      if (profile && typeof profile === "object" && profile.profileId) {
        byId.set(String(profile.profileId), profile);
      }
    }
    for (const profile of FALLBACK_CONTEXT_PROFILES) {
      const profileId = String(profile.profileId);
      if (!byId.has(profileId)) {
        byId.set(profileId, profile);
      }
    }
    this.profiles = sortContextProfiles([...byId.values()]);
  }

  getProfiles() {
    this.loadProfilesSync();
    return this.profiles;
  }
}

const contextProfileManager = new ContextProfileManager();

const DEFAULT_BUDGET_POLICY = {
  mode: "auto",
  fixedMemoryRatio: 0.06,
  expertGuidanceRatio: 0.08,
  knowledgeRatio: 0.38,
  historyRatio: 0.22,
  recentTurnRatio: 0.14,
  toolStateRatio: 0.08
};

const DEFAULT_RANKING_WEIGHTS = {
  queryRelevance: 0.36,
  recency: 0.12,
  evidenceConfidence: 0.18,
  humanExpertBoost: 0.2,
  toolFreshness: 0.06,
  hierarchyLevel: 0.08
};

const DEFAULT_PROTECTED_EVIDENCE_FIELDS = [
  "evidenceId",
  "sourceLocator",
  "snippet",
  "who",
  "what",
  "when",
  "amount",
  "conflict",
  "confidence"
];

const DEFAULT_PLACEMENT_POLICY = {
  criticalEvidenceHeadCount: 8,
  evidenceTailChecklist: true,
  repeatTaskInTail: true
};

const DEFAULT_MODEL_COMPRESSION = {
  enabled: false,
  alias: "",
  maxInputTokens: 24000,
  maxOutputTokens: 4000,
  fallback: "deterministic-extractive"
};

const DEFAULT_COMPACTION_POLICY = {
  enabled: true,
  strategy: "session-memory-first",
  summaryReserveTokens: 4000,
  reservedBufferTokens: 13000,
  warningBufferTokens: 20000,
  hardBufferTokens: 2048,
  recentMessageProtectionCount: 12,
  maxConsecutiveFailures: 3,
  ptlRetryLimit: 3,
  ptlHeadTrimRatio: 0.2,
  reinjectionBudgetTokens: 1800,
  maxToolResultTokens: 900,
  maxAttachmentTokens: 600,
  allowAttachmentDehydration: true,
  persistSessionMemory: true,
  persistBoundaries: true,
  microCompaction: true
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampRatio(value, fallback) {
  return clampNumber(value, fallback, 0, 1);
}

function normalizeStringArray(value, fallback = []) {
  const items = asArray(value).map((item) => String(item || "").trim()).filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

export function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const nonCjkCount = Math.max(0, text.length - cjkCount);
  return Math.max(1, Math.ceil(cjkCount * 0.9 + nonCjkCount / 4));
}

function normalizeProfile(profile = {}) {
  const fallback = contextProfileManager.getProfiles()[0];
  const compression = {
    ...fallback.compression,
    ...asObject(profile.compression)
  };
  const budgetPolicy = {
    ...DEFAULT_BUDGET_POLICY,
    ...asObject(profile.budgetPolicy)
  };
  const rankingWeights = {
    ...DEFAULT_RANKING_WEIGHTS,
    ...asObject(profile.rankingWeights)
  };
  const placementPolicy = {
    ...DEFAULT_PLACEMENT_POLICY,
    ...asObject(profile.placementPolicy)
  };
  const modelCompression = {
    ...DEFAULT_MODEL_COMPRESSION,
    ...asObject(profile.modelCompression)
  };
  const compactionPolicy = normalizeCompactionPolicy(
    {
      ...fallback,
      ...profile,
      compression,
      modelCompression
    },
    {
      ...DEFAULT_COMPACTION_POLICY,
      ...asObject(profile.compactionPolicy)
    }
  );
  return {
    ...fallback,
    ...profile,
    profileId: String(profile.profileId || profile.id || fallback.profileId).trim() || fallback.profileId,
    label: String(profile.label || profile.profileId || fallback.label),
    modelAlias: String(profile.modelAlias || profile.model || fallback.modelAlias),
    contextWindowTokens: clampNumber(profile.contextWindowTokens, fallback.contextWindowTokens, 4096, 2000000),
    outputReserveTokens: clampNumber(profile.outputReserveTokens, fallback.outputReserveTokens, 256, 200000),
    toolReserveTokens: clampNumber(profile.toolReserveTokens, fallback.toolReserveTokens, 0, 200000),
    fixedMemoryBudget: clampNumber(profile.fixedMemoryBudget, fallback.fixedMemoryBudget, 0, 100000),
    knowledgeBudget: clampNumber(profile.knowledgeBudget, fallback.knowledgeBudget, 0, 1000000),
    historyBudget: clampNumber(profile.historyBudget, fallback.historyBudget, 0, 1000000),
    recentTurnBudget: clampNumber(profile.recentTurnBudget, fallback.recentTurnBudget, 0, 1000000),
    budgetPolicy: {
      ...budgetPolicy,
      mode: String(budgetPolicy.mode || "auto"),
      fixedMemoryRatio: clampRatio(budgetPolicy.fixedMemoryRatio, DEFAULT_BUDGET_POLICY.fixedMemoryRatio),
      expertGuidanceRatio: clampRatio(budgetPolicy.expertGuidanceRatio, DEFAULT_BUDGET_POLICY.expertGuidanceRatio),
      knowledgeRatio: clampRatio(budgetPolicy.knowledgeRatio, DEFAULT_BUDGET_POLICY.knowledgeRatio),
      historyRatio: clampRatio(budgetPolicy.historyRatio, DEFAULT_BUDGET_POLICY.historyRatio),
      recentTurnRatio: clampRatio(budgetPolicy.recentTurnRatio, DEFAULT_BUDGET_POLICY.recentTurnRatio),
      toolStateRatio: clampRatio(budgetPolicy.toolStateRatio, DEFAULT_BUDGET_POLICY.toolStateRatio)
    },
    rankingWeights: {
      queryRelevance: clampRatio(rankingWeights.queryRelevance, DEFAULT_RANKING_WEIGHTS.queryRelevance),
      recency: clampRatio(rankingWeights.recency, DEFAULT_RANKING_WEIGHTS.recency),
      evidenceConfidence: clampRatio(rankingWeights.evidenceConfidence, DEFAULT_RANKING_WEIGHTS.evidenceConfidence),
      humanExpertBoost: clampRatio(rankingWeights.humanExpertBoost, DEFAULT_RANKING_WEIGHTS.humanExpertBoost),
      toolFreshness: clampRatio(rankingWeights.toolFreshness, DEFAULT_RANKING_WEIGHTS.toolFreshness),
      hierarchyLevel: clampRatio(rankingWeights.hierarchyLevel, DEFAULT_RANKING_WEIGHTS.hierarchyLevel)
    },
    protectedEvidenceFields: normalizeStringArray(profile.protectedEvidenceFields, DEFAULT_PROTECTED_EVIDENCE_FIELDS),
    placementPolicy: {
      ...placementPolicy,
      criticalEvidenceHeadCount: clampNumber(
        placementPolicy.criticalEvidenceHeadCount,
        DEFAULT_PLACEMENT_POLICY.criticalEvidenceHeadCount,
        1,
        50
      ),
      evidenceTailChecklist: placementPolicy.evidenceTailChecklist !== false,
      repeatTaskInTail: placementPolicy.repeatTaskInTail !== false
    },
    modelCompression: {
      ...modelCompression,
      enabled: modelCompression.enabled === true,
      alias: String(modelCompression.alias || ""),
      maxInputTokens: clampNumber(modelCompression.maxInputTokens, DEFAULT_MODEL_COMPRESSION.maxInputTokens, 512, 2000000),
      maxOutputTokens: clampNumber(modelCompression.maxOutputTokens, DEFAULT_MODEL_COMPRESSION.maxOutputTokens, 256, 200000),
      fallback: String(modelCompression.fallback || DEFAULT_MODEL_COMPRESSION.fallback)
    },
    compactionPolicy,
    compression: {
      ...compression,
      enabled: compression.enabled !== false,
      mode: ["deterministic-extractive", "model-assisted", "workbench-reconstruction", "session-memory-first"].includes(String(compression.mode || ""))
        ? String(compression.mode)
        : "deterministic-extractive",
      threshold: clampNumber(compression.threshold, fallback.compression.threshold, 0.1, 0.95),
      targetRatio: clampNumber(compression.targetRatio, fallback.compression.targetRatio, 0.05, 0.9),
      protectLastNTurns: clampNumber(compression.protectLastNTurns, fallback.compression.protectLastNTurns, 0, 200),
      summaryMaxTokens: clampNumber(compression.summaryMaxTokens, fallback.compression.summaryMaxTokens, 256, 200000),
      strategy: String(compression.strategy || fallback.compression.strategy)
    }
  };
}

function normalizeProfiles(profiles) {
  const incoming = asArray(profiles)
    .filter((profile) => profile && !isDeprecatedContextProfile(profile))
    .map(normalizeProfile);
  const byId = new Map();
  for (const profile of incoming) {
    byId.set(profile.profileId, profile);
  }
  return sortContextProfiles([...byId.values()]);
}

function compactText(value, targetTokens) {
  const text = String(value || "").trim();
  if (!text || estimateTokens(text) <= targetTokens) {
    return text;
  }
  const sentences = text
    .split(/(?<=[。！？.!?])\s+|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = [];
  let used = 0;
  for (const sentence of sentences) {
    const score =
      /证据|结论|风险|金额|日期|负责人|未完成|冲突|decision|risk|evidence|todo/i.test(sentence)
        ? 2
        : 1;
    const tokens = estimateTokens(sentence);
    if (used + tokens > targetTokens && selected.length > 0) {
      continue;
    }
    selected.push({ sentence, score, tokens, index: selected.length });
    used += tokens;
    if (used >= targetTokens) {
      break;
    }
  }
  const compacted = selected
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, selected.length))
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence)
    .join("\n");
  return compacted || text.slice(0, Math.max(256, targetTokens * 4));
}

function takeItemsByBudget(items, budget, stringify = (item) => JSON.stringify(item)) {
  const selected = [];
  let used = 0;
  for (const item of asArray(items)) {
    const tokens = estimateTokens(stringify(item));
    if (selected.length > 0 && used + tokens > budget) {
      continue;
    }
    selected.push(item);
    used += tokens;
    if (used >= budget) {
      break;
    }
  }
  return {
    selected,
    usedTokens: used,
    droppedCount: Math.max(0, asArray(items).length - selected.length)
  };
}

function workspaceSnapshot(workspaceState = {}) {
  const submissions = asArray(workspaceState.submissions)
    .filter((item) => ["accepted", "proposed", "needs_review"].includes(item.status))
    .slice(0, 80);
  const artifacts = asArray(workspaceState.artifacts).slice(0, 20);
  const issues = asArray(workspaceState.issues).filter((item) => item.status !== "resolved").slice(0, 30);
  return {
    workspace: workspaceState.workspace || null,
    submissions: submissions.map((item) => ({
      type: item.type,
      status: item.status,
      confidence: item.confidence,
      summary: item.payload?.claim || item.payload?.summary || item.payload?.title || "",
      evidenceRefs: item.evidenceRefs || []
    })),
    artifacts: artifacts.map((item) => ({
      artifactId: item.artifactId,
      level: item.level,
      title: item.title,
      status: item.status,
      revision: item.revision
    })),
    issues: issues.map((item) => ({
      issueId: item.issueId,
      type: item.type,
      severity: item.severity,
      title: item.title
    }))
  };
}

function citationsFromEvidence(evidenceItems = []) {
  return [
    ...new Map(
      asArray(evidenceItems)
        .map((item) => [
          item.evidenceId || item.id || item.ref || "",
          {
            evidenceId: item.evidenceId || item.id || item.ref || "",
            title: item.title || item.claim || "",
            sourceLocator: item.sourceLocator || item.source || item.hierarchy || null
          }
        ])
        .filter(([key]) => key)
    ).values()
  ];
}

function hashText(value, length = 16) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((item) => item.length >= 2)
    .slice(0, 80);
}

function queryRelevanceScore(queryTokens, text) {
  if (!queryTokens.length) {
    return 0;
  }
  const haystack = normalizeText(text).toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      hits += 1;
    }
  }
  return Math.min(1, hits / Math.max(1, queryTokens.length));
}

function evidenceIdOf(item = {}) {
  return String(item.evidenceId || item.id || item.ref || item.evidence_id || "").trim();
}

function evidenceIdAliasesOf(item = {}) {
  return [
    item.evidenceId,
    item.id,
    item.ref,
    item.evidence_id,
    item.original?.evidenceId,
    item.original?.id,
    item.original?.ref,
    item.original?.evidence_id
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function evidenceMatchesAny(item = {}, evidenceIds = new Set()) {
  if (!evidenceIds.size) {
    return false;
  }
  return evidenceIdAliasesOf(item).some((id) => evidenceIds.has(id));
}

function sourceLocatorOf(item = {}) {
  return item.sourceLocator || item.source || item.hierarchy || item.path || item.url || null;
}

function evidenceTextOf(item = {}) {
  return [
    item.title,
    item.claim,
    item.summary,
    item.snippet,
    item.text,
    item.content,
    item.description
  ].map((value) => String(value || "")).filter(Boolean).join("\n");
}

function timestampScore(item = {}) {
  const value = item.createdAt || item.updatedAt || item.timestamp || item.date || item.serverUpdatedAt;
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) {
    return 0;
  }
  const ageDays = Math.max(0, (Date.now() - time) / 86400000);
  return Number(Math.exp(-ageDays / 90).toFixed(6));
}

function hierarchyScore(item = {}) {
  const level = String(item.hierarchyLevel || item.level || item.kind || item.type || "").toLowerCase();
  if (/(collection|document|section)/.test(level)) {
    return 1;
  }
  if (/(block|evidence|asset|chunk)/.test(level)) {
    return 0.65;
  }
  return 0.5;
}

function confidenceScore(item = {}) {
  const confidence = Number(item.confidence ?? item.score ?? item.combinedScore ?? 0);
  if (!Number.isFinite(confidence)) {
    return 0;
  }
  return Math.max(0, Math.min(1, confidence > 1 ? confidence / 100 : confidence));
}

function humanExpertScore(item = {}) {
  if (item.humanExpert || item.gold || item.humanConfirmed || item.context?.gold || item.context?.humanExpert) {
    return 1;
  }
  return 0;
}

function extractProtectedFacts(item = {}) {
  const text = evidenceTextOf(item);
  const amountMatches = text.match(/(?:[$€£¥￥]\s*)?\d[\d,]*(?:\.\d+)?\s*(?:美元|美金|人民币|元|GBP|USD|EUR|CNY|%|percent)?/gi) || [];
  const dateMatches = text.match(/\b20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b|\b\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}\b/gi) || [];
  const conflict = /冲突|矛盾|不一致|conflict|contradict/i.test(text);
  return {
    who: item.who || item.sender || item.author || item.owner || "",
    what: item.what || item.claim || item.title || "",
    when: item.when || dateMatches.slice(0, 4),
    amount: item.amount || amountMatches.slice(0, 6),
    conflict,
    confidence: item.confidence ?? item.score ?? null
  };
}

function normalizeEvidenceItem(item = {}, { queryTokens = [], profile } = {}) {
  const evidenceId = evidenceIdOf(item);
  const text = evidenceTextOf(item);
  const snippet = compactText(item.snippet || item.text || item.summary || item.claim || "", 180);
  const components = {
    queryRelevance: queryRelevanceScore(queryTokens, text),
    recency: timestampScore(item),
    evidenceConfidence: confidenceScore(item),
    humanExpertBoost: humanExpertScore(item),
    toolFreshness: item.toolFreshness || item.fromLatestTool ? 1 : 0,
    hierarchyLevel: hierarchyScore(item)
  };
  const weights = profile.rankingWeights;
  const score = Object.entries(components).reduce(
    (total, [key, value]) => total + Number(value || 0) * Number(weights[key] || 0),
    0
  );
  return {
    evidenceId,
    title: String(item.title || item.claim || evidenceId || "untitled").slice(0, 180),
    sourceLocator: sourceLocatorOf(item),
    snippet,
    protectedFacts: extractProtectedFacts(item),
    confidence: confidenceScore(item),
    humanConfirmed: humanExpertScore(item) > 0,
    hierarchyLevel: item.hierarchyLevel || item.level || item.kind || "",
    score: Number(score.toFixed(6)),
    scoreBreakdown: components,
    original: item
  };
}

function selectByBudget(items, budget, stringify = (item) => JSON.stringify(item)) {
  const selected = [];
  const dropped = [];
  let used = 0;
  for (const item of asArray(items)) {
    const tokens = estimateTokens(stringify(item));
    if (selected.length > 0 && used + tokens > budget) {
      dropped.push({ item, tokens, reason: "budget_exceeded" });
      continue;
    }
    selected.push(item);
    used += tokens;
    if (used >= budget) {
      continue;
    }
  }
  return {
    selected,
    dropped,
    usedTokens: used,
    droppedCount: dropped.length
  };
}

function collectProtectedEvidenceIds(input = {}, expertGuidanceItems = []) {
  return normalizeStringArray([
    ...asArray(input.requiredEvidenceIds),
    ...asArray(input.requiredEvidenceRefs),
    ...asArray(input.protectedEvidenceIds),
    ...asArray(input.mustKeepEvidenceIds),
    ...asArray(input.evidenceRefs),
    ...asArray(input.citations).map((item) => typeof item === "string" ? item : item?.evidenceId),
    ...asArray(expertGuidanceItems).flatMap((item) => item.evidenceRefs || [])
  ]);
}

function selectEvidenceByBudget(items, budget, protectedEvidenceIds = [], stringify = (item) => JSON.stringify(item)) {
  const protectedSet = new Set(protectedEvidenceIds);
  const selected = [];
  const dropped = [];
  const selectedKeys = new Set();
  let used = 0;

  for (const item of asArray(items)) {
    if (!evidenceMatchesAny(item, protectedSet)) {
      continue;
    }
    const key = evidenceIdOf(item) || JSON.stringify(item);
    if (selectedKeys.has(key)) {
      continue;
    }
    const tokens = estimateTokens(stringify(item));
    selected.push({
      ...item,
      protectedEvidence: true,
      protectionReason: "required_evidence"
    });
    selectedKeys.add(key);
    used += tokens;
  }

  for (const item of asArray(items)) {
    const key = evidenceIdOf(item) || JSON.stringify(item);
    if (selectedKeys.has(key)) {
      continue;
    }
    const tokens = estimateTokens(stringify(item));
    if (selected.length > 0 && used + tokens > budget) {
      dropped.push({ item, tokens, reason: "budget_exceeded" });
      continue;
    }
    selected.push(item);
    selectedKeys.add(key);
    used += tokens;
    if (used >= budget) {
      continue;
    }
  }

  return {
    selected,
    dropped,
    usedTokens: used,
    droppedCount: dropped.length,
    protectedEvidenceIds: selected
      .filter((item) => item.protectedEvidence)
      .map((item) => item.evidenceId)
      .filter(Boolean),
    protectedEvidenceCount: selected.filter((item) => item.protectedEvidence).length,
    protectedEvidenceBudgetOverrun: used > budget && selected.some((item) => item.protectedEvidence)
  };
}

function normalizeExpertGuidance(input = {}) {
  return [
    ...asArray(input.expertGuidance),
    ...asArray(input.humanFeedback),
    ...asArray(input.feedback).filter((item) => item?.context?.gold || item?.context?.humanExpert)
  ].map((item, index) => {
    const context = asObject(item.context);
    const selected = asObject(item.selectedOption || context.selectedOption);
    return {
      guidanceId: String(item.guidanceId || item.feedbackId || item.id || `expert-${index + 1}`),
      query: String(item.query || context.query || item.sourceQuery || ""),
      label: String(item.label || selected.label || item.selectedLabel || ""),
      instruction: String(item.instruction || selected.followUpQuestion || item.followUpQuestion || item.summary || ""),
      reason: String(item.reason || context.reason || ""),
      evidenceRefs: normalizeStringArray(item.evidenceRefs || context.evidenceRefs),
      createdAt: item.createdAt || context.createdAt || ""
    };
  }).filter((item) => item.label || item.instruction || item.evidenceRefs.length);
}

function normalizeMemoryBlocks(input = {}, budget = 1000) {
  const blocks = [
    ...asArray(input.memoryBlocks),
    input.systemMemory || input.memory
      ? { blockId: "system-memory", label: "System Memory", content: input.systemMemory || input.memory }
      : null
  ].filter(Boolean).map((item, index) => ({
    blockId: String(item.blockId || item.id || `memory-${index + 1}`),
    label: String(item.label || item.title || item.type || "Memory"),
    content: compactText(item.content || item.text || item.summary || item.value || "", budget)
  })).filter((item) => item.content);
  return blocks;
}

function summarizeToolState(toolState = {}, budget = 2000) {
  const previous = asArray(toolState.previousToolResults).slice(-8).map((item) => ({
    tool: item.tool || item.name || "",
    ok: item.ok !== false,
    arguments: item.arguments || undefined,
    count: item.count ?? item.resultCount ?? undefined,
    evidenceId: item.evidenceId || item.evidence?.evidenceId || "",
    error: item.error || ""
  }));
  const summary = {
    iteration: toolState.iteration || "",
    activeTool: toolState.activeTool || "",
    previousToolResults: previous,
    pending: toolState.pending || []
  };
  return {
    ...summary,
    compactText: compactText(JSON.stringify(summary), budget)
  };
}

function computeBudgets(profile) {
  const usableTokens = Math.max(
    1024,
    profile.contextWindowTokens - profile.outputReserveTokens - profile.toolReserveTokens
  );
  const policy = profile.budgetPolicy;
  const proposed = {
    fixedMemory: Math.min(profile.fixedMemoryBudget, Math.floor(usableTokens * policy.fixedMemoryRatio)),
    expertGuidance: Math.floor(usableTokens * policy.expertGuidanceRatio),
    knowledge: Math.min(profile.knowledgeBudget, Math.floor(usableTokens * policy.knowledgeRatio)),
    history: Math.min(profile.historyBudget, Math.floor(usableTokens * policy.historyRatio)),
    recentTurns: Math.min(profile.recentTurnBudget, Math.floor(usableTokens * policy.recentTurnRatio)),
    toolState: Math.floor(usableTokens * policy.toolStateRatio)
  };
  return {
    usableTokens,
    fixedMemory: Math.max(256, proposed.fixedMemory),
    expertGuidance: Math.max(256, proposed.expertGuidance),
    knowledge: Math.max(512, proposed.knowledge),
    history: Math.max(256, proposed.history),
    recentTurns: Math.max(256, proposed.recentTurns),
    toolState: Math.max(128, proposed.toolState)
  };
}

function criticalEvidenceIndex(evidencePack = [], profile) {
  return evidencePack
    .slice(0, profile.placementPolicy.criticalEvidenceHeadCount)
    .map((item, index) => ({
      rank: index + 1,
      evidenceId: item.evidenceId,
      title: item.title,
      sourceLocator: item.sourceLocator,
      protectedFacts: item.protectedFacts,
      score: item.score
    }));
}

function sectionTokenReport(pack = {}) {
  return {
    memoryBlocks: estimateTokens(pack.memoryBlocks || []),
    expertGuidance: estimateTokens(pack.expertGuidance || []),
    criticalEvidenceIndex: estimateTokens(pack.criticalEvidenceIndex || []),
    evidencePack: estimateTokens(pack.evidencePack || []),
    toolStateSummary: estimateTokens(pack.toolStateSummary || {}),
    compressedHistory: estimateTokens(pack.compressedHistory || ""),
    recentTurns: estimateTokens(pack.recentTurns || []),
    tailChecklist: estimateTokens(pack.tailChecklist || {})
  };
}

export function createContextRuntime({
  userDataPath,
  modelCompressor = null,
  agentGatewayCall = null,
  agentMemory = null,
  clientRuntimeAllocator = null,
  strategies = [],
  compactionStrategies = []
}) {
  const rootPath = path.join(userDataPath, "context-core");
  const profilesPath = path.join(rootPath, "context-profiles.json");
  const buildRecordsPath = path.join(rootPath, "context-build-records.jsonl");
  const evaluationRunsPath = path.join(rootPath, "context-evaluation-runs.jsonl");
  const compactionRuntime = createContextCompactionRuntime({
    userDataPath,
    modelCompressor,
    agentGatewayCall,
    agentMemory,
    strategies,
    compactionStrategies
  });

  async function readProfiles() {
    try {
      const parsed = JSON.parse(await fs.readFile(profilesPath, "utf8"));
      return normalizeProfiles(parsed.profiles || parsed);
    } catch {
      return normalizeProfiles(contextProfileManager.getProfiles());
    }
  }

  async function writeProfiles(profiles) {
    const normalized = normalizeProfiles(profiles);
    await atomicWriteJson(profilesPath, {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      updatedAt: new Date().toISOString(),
      profiles: normalized
    });
    return normalized;
  }

  async function listProfiles() {
    const profiles = await readProfiles();
    return {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      profiles,
      defaults: contextProfileManager.getProfiles(),
      path: profilesPath
    };
  }

  async function saveProfiles(input = {}) {
    const profiles = await writeProfiles(input.profiles || input.value || input);
    return {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      profiles,
      path: profilesPath
    };
  }

  async function resolveProfile(input = {}) {
    const profiles = await readProfiles();
    const explicitTarget = String(input.contextProfileId || input.profileId || input.modelAlias || input.model || "").trim();
    const allocation = !explicitTarget && typeof clientRuntimeAllocator?.resolve === "function"
      ? await clientRuntimeAllocator.resolve(input)
      : null;
    const target = String(
      explicitTarget ||
        allocation?.contextProfileId ||
        allocation?.modelAlias ||
        ""
    ).trim();
    return (
      profiles.find((profile) => profile.profileId === target) ||
      profiles.find((profile) => profile.modelAlias === target) ||
      profiles.find((profile) => profile.profileId === "context-128k") ||
      profiles[0] ||
      normalizeProfile(contextProfileManager.getProfiles().find((profile) => profile.profileId === "context-128k") || contextProfileManager.getProfiles()[0])
    );
  }

  async function compact(input = {}) {
    const profile = await resolveProfile(input);
    if (Array.isArray(input.messages) || Array.isArray(input.transcript) || input.runtimeState || input.force === true) {
      return compactionRuntime.run({
        ...input,
        profile
      });
    }
    const targetTokens = Math.min(
      Number(input.targetTokens || 0) || profile.compression.summaryMaxTokens,
      profile.compression.summaryMaxTokens
    );
    const sourceText = String(input.text || input.content || "");
    const summary = compactText(sourceText, targetTokens);
    return {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      profileId: profile.profileId,
      strategy: profile.compression.strategy,
      sourceTokens: estimateTokens(sourceText),
      summaryTokens: estimateTokens(summary),
      summary
    };
  }

  async function previewCompaction(input = {}) {
    const profile = await resolveProfile(input);
    return compactionRuntime.preview({
      ...input,
      profile
    });
  }

  async function runCompaction(input = {}) {
    const profile = await resolveProfile(input);
    return compactionRuntime.run({
      ...input,
      profile
    });
  }

  async function listCompactionRecords(input = {}) {
    return compactionRuntime.listRecords(input);
  }

  async function listCompactionStrategies() {
    return compactionRuntime.listStrategies();
  }

  async function listSessionMemory(input = {}) {
    return compactionRuntime.listSessionMemory(input);
  }

  async function clearSessionMemory(input = {}) {
    return compactionRuntime.clearSessionMemory(input);
  }

  async function modelCompressText({ profile, text, targetTokens, kind, citations = [] }) {
    const sourceText = String(text || "");
    if (
      !sourceText ||
      profile.modelCompression.enabled !== true ||
      !["model-assisted", "workbench-reconstruction", "session-memory-first"].includes(profile.compression.mode)
    ) {
      return {
        used: false,
        degraded: false,
        summary: compactText(sourceText, targetTokens),
        error: ""
      };
    }
    try {
      const prompt = [
        "你是 Pact 本地上下文压缩器。只压缩上下文，不新增事实。",
        "必须保留 evidenceId、文件路径、日期、金额、冲突和人类专家意见。",
        "如果输入中存在引用编号，输出必须保留原编号。",
        `压缩对象：${kind}`,
        `目标 token：${targetTokens}`,
        citations.length ? `必须保护的引用：${citations.join(", ")}` : "",
        "",
        sourceText
      ].filter(Boolean).join("\n");
      const response = typeof modelCompressor === "function"
        ? await modelCompressor({
            profile,
            kind,
            text: sourceText,
            targetTokens,
            citations,
            prompt
          })
        : await agentGatewayCall?.({
            alias: profile.modelCompression.alias || profile.modelAlias,
            modelAlias: profile.modelCompression.alias || profile.modelAlias,
            question: prompt,
            parameters: {
              temperature: 0,
              max_tokens: Math.max(256, Math.min(profile.modelCompression.maxOutputTokens, targetTokens)),
              stream: false,
              tool_choice: "none"
            }
          });
      const summary = String(response?.summary || response?.answer || response?.text || "").trim();
      if (!summary) {
        throw new Error("模型压缩没有返回摘要。");
      }
      return {
        used: true,
        degraded: false,
        summary: compactText(summary, targetTokens),
        error: ""
      };
    } catch (error) {
      return {
        used: false,
        degraded: true,
        summary: compactText(sourceText, targetTokens),
        error: error instanceof Error ? error.message : "model_compression_failed"
      };
    }
  }

  async function appendJsonl(filePath, value) {
    await appendJsonLineSerialized(filePath, value);
  }

  async function readJsonlTail(filePath, limit = 50) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(Number(limit || 50), 1000)))
        .map((line) => JSON.parse(line))
        .reverse();
    } catch {
      return [];
    }
  }

  async function listBuildRecords(input = {}) {
    const records = await readJsonlTail(buildRecordsPath, input.limit || 50);
    return {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      path: buildRecordsPath,
      records
    };
  }

  async function writeBuildRecord(record) {
    await appendJsonl(buildRecordsPath, record);
    return record;
  }

  function compactionMessagesFromAssembleInput(input = {}) {
    if (Array.isArray(input.messages) || Array.isArray(input.transcript)) {
      return input.messages || input.transcript;
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
    return messages;
  }

  async function assemble(input = {}) {
    const allocationResult = typeof clientRuntimeAllocator?.apply === "function"
      ? await clientRuntimeAllocator.apply(input, {
          taskType: input.taskType || input.operationId || "context.assemble",
          surface: input.inputSource || "context-core"
        })
      : null;
    input = allocationResult?.input || input;
    const profile = await resolveProfile(input);
    const budgets = computeBudgets(profile);
    const taskBrief = String(input.taskBrief || input.task || input.query || "").trim();
    const queryTokens = tokenize(taskBrief);
    const sharedSnapshot = workspaceSnapshot(input.workspaceState || {});
    const privateText = String(input.privateSummary || input.privateState?.summary || "");
    const memoryBlocks = normalizeMemoryBlocks(input, budgets.fixedMemory);
    const expertGuidance = selectByBudget(
      normalizeExpertGuidance(input),
      budgets.expertGuidance,
      (item) => `${item.label}\n${item.instruction}\n${item.reason}\n${item.evidenceRefs?.join(",") || ""}`
    );
    const protectedEvidenceIds = collectProtectedEvidenceIds(input, expertGuidance.selected);
    const normalizedEvidence = asArray(input.retrievedEvidence || input.evidence || [])
      .map((item) => normalizeEvidenceItem(item, { queryTokens, profile }))
      .sort((left, right) => right.score - left.score);
    const selectedEvidence = selectEvidenceByBudget(
      normalizedEvidence,
      budgets.knowledge,
      protectedEvidenceIds,
      (item) => [
        item.evidenceId,
        item.title,
        item.snippet,
        JSON.stringify(item.protectedFacts),
        JSON.stringify(item.sourceLocator)
      ].join("\n")
    );
    const evidencePack = selectedEvidence.selected.map((item) => ({
      evidenceId: item.evidenceId,
      title: item.title,
      sourceLocator: item.sourceLocator,
      snippet: item.snippet,
      protectedFacts: item.protectedFacts,
      confidence: item.confidence,
      humanConfirmed: item.humanConfirmed,
      protectedEvidence: item.protectedEvidence === true,
      protectionReason: item.protectionReason || "",
      hierarchyLevel: item.hierarchyLevel,
      score: item.score,
      scoreBreakdown: item.scoreBreakdown
    }));
    const recentTurns = selectByBudget(input.recentTurns || [], budgets.recentTurns);
    let compressedHistory = compactText(
      String(input.history || input.compressedHistory || ""),
      budgets.history
    );
    const privateSummary = compactText(
      privateText || JSON.stringify(input.privateState || {}),
      Math.min(budgets.history, 4000)
    );
    const modelCompressionEvents = [];
    const protectedCitationIds = [
      ...protectedEvidenceIds,
      ...selectedEvidence.selected.map((item) => item.evidenceId),
      ...expertGuidance.selected.flatMap((item) => item.evidenceRefs || [])
    ].filter(Boolean);
    const historyCompression = await modelCompressText({
      profile,
      text: compressedHistory,
      targetTokens: budgets.history,
      kind: "history",
      citations: protectedCitationIds
    });
    compressedHistory = historyCompression.summary;
    if (historyCompression.used || historyCompression.degraded) {
      modelCompressionEvents.push({ kind: "history", ...historyCompression, summary: undefined });
    }
    let toolStateSummary = summarizeToolState(asObject(input.toolState), budgets.toolState);
    const toolCompression = await modelCompressText({
      profile,
      text: toolStateSummary.compactText,
      targetTokens: budgets.toolState,
      kind: "tool_state",
      citations: protectedCitationIds
    });
    toolStateSummary = {
      ...toolStateSummary,
      compactText: toolCompression.summary
    };
    if (toolCompression.used || toolCompression.degraded) {
      modelCompressionEvents.push({ kind: "tool_state", ...toolCompression, summary: undefined });
    }
    const compactionMessages = compactionMessagesFromAssembleInput(input);
    let runtimeCompaction = {
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      status: "skipped",
      compacted: false,
      triggerReason: "no_messages"
    };
    if (compactionMessages.length) {
      try {
        runtimeCompaction = await compactionRuntime.maybeCompact({
          profile,
          messages: compactionMessages,
          sessionId: input.sessionId || input.conversationId || input.threadId || input.agentId || "context-core",
          inputSource: input.inputSource || "context-core",
          taskBrief,
          runtimeState: {
            ...(asObject(input.runtimeState)),
            taskBrief,
            activePlan: input.activePlan || input.plan || input.runtimeState?.activePlan || null,
            enabledTools: input.enabledTools || input.tools || input.runtimeState?.enabledTools || [],
            currentFiles: input.currentFiles || input.runtimeState?.currentFiles || [],
            knowledgeReference:
              input.knowledgeReference ||
              input.runtimeState?.knowledgeReference ||
              ""
          },
          persist: input.record !== false && input.persistCompaction !== false
        });
        if (runtimeCompaction.compacted && runtimeCompaction.summary) {
          compressedHistory = compactText(
            [
              runtimeCompaction.summary,
              compressedHistory
            ].filter(Boolean).join("\n\n"),
            budgets.history
          );
        }
      } catch (error) {
        runtimeCompaction = {
          protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
          status: "failed",
          compacted: false,
          degraded: true,
          error: error instanceof Error ? error.message : "context_compaction_failed"
        };
      }
    }
    const pack = {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      profileId: profile.profileId,
      clientRuntimeAllocation: allocationResult?.allocation || input.clientRuntimeAllocation || null,
      workspaceContext: input.workspaceContext || null,
      workspaceGeneration: input.workspaceContext?.currentGeneration || null,
      roleId: input.roleId || "",
      agentId: input.agentId || "",
      taskBrief,
      memoryBlocks,
      expertGuidance: expertGuidance.selected,
      criticalEvidenceIndex: criticalEvidenceIndex(evidencePack, profile),
      evidencePack,
      protectedEvidenceIds,
      sharedSnapshot,
      privateSummary,
      recentTurns: recentTurns.selected,
      retrievedKnowledge: evidencePack,
      compressedHistory,
      toolStateSummary,
      toolState: toolStateSummary,
      compaction: runtimeCompaction,
      citations: citationsFromEvidence(evidencePack),
      placement: {
        head: ["taskBrief", "memoryBlocks", "expertGuidance", "criticalEvidenceIndex"],
        body: ["evidencePack", "toolStateSummary", "compressedHistory"],
        tail: ["recentTurns", "tailChecklist"]
      },
      tailChecklist: {
        taskBrief: profile.placementPolicy.repeatTaskInTail ? taskBrief : "",
        evidenceIds: evidencePack.map((item) => item.evidenceId).filter(Boolean),
        requiredEvidenceIds: protectedEvidenceIds,
        rules: [
          "Use evidenceId citations exactly as supplied.",
          "Do not treat compressed summaries as canonical evidence.",
          "If required evidence is missing, say so and call tools when allowed."
        ]
      },
      contextBuildRecordId: ""
    };
    const sourceTokens = estimateTokens({
      taskBrief,
      systemMemory: input.systemMemory || input.memory || "",
      expertGuidance: input.expertGuidance || input.humanFeedback || input.feedback || [],
      retrievedEvidence: input.retrievedEvidence || input.evidence || [],
      history: input.history || input.compressedHistory || "",
      recentTurns: input.recentTurns || [],
      toolState: input.toolState || {}
    });
    let totalTokens = estimateTokens(pack);
    let compressed = false;
    const usableTokens = Math.max(
      1024,
      profile.contextWindowTokens - profile.outputReserveTokens - profile.toolReserveTokens
    );
    const thresholdTokens = Math.floor(profile.contextWindowTokens * profile.compression.threshold);
    let compressionDroppedEvidenceIds = [];
    if (profile.compression.enabled && totalTokens > thresholdTokens) {
      pack.compressedHistory = compactText(compressedHistory, Math.floor(profile.historyBudget * profile.compression.targetRatio));
      pack.privateSummary = compactText(privateSummary, Math.floor(Math.min(profile.historyBudget, 4000) * profile.compression.targetRatio));
      const nextKnowledgeBudget = Math.max(512, Math.floor(budgets.knowledge * profile.compression.targetRatio));
      const nextKnowledge = selectEvidenceByBudget(pack.evidencePack, nextKnowledgeBudget, protectedEvidenceIds);
      pack.evidencePack = nextKnowledge.selected;
      compressionDroppedEvidenceIds = nextKnowledge.dropped.map((entry) => entry.item.evidenceId).filter(Boolean);
      pack.retrievedKnowledge = nextKnowledge.selected;
      pack.criticalEvidenceIndex = criticalEvidenceIndex(pack.evidencePack, profile);
      pack.citations = citationsFromEvidence(pack.evidencePack);
      pack.tailChecklist.evidenceIds = pack.evidencePack.map((item) => item.evidenceId).filter(Boolean);
      totalTokens = estimateTokens(pack);
      compressed = true;
    }
    const sectionTokens = sectionTokenReport(pack);
    const droppedEvidenceIds = selectedEvidence.dropped
      .map((entry) => entry.item.evidenceId)
      .filter(Boolean)
      .concat(compressionDroppedEvidenceIds);
    const record = {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      recordId: `context-build-${crypto.randomUUID?.() || hashText(`${Date.now()}-${Math.random()}`)}`,
      createdAt: new Date().toISOString(),
      profileId: profile.profileId,
      inputSource: String(input.inputSource || input.source || "runtime"),
      roleId: pack.roleId,
      agentId: pack.agentId,
      taskBriefPreview: taskBrief.slice(0, 240),
      strategy: profile.compression.strategy,
      compressionMode: profile.compression.mode,
      modelCompressionEvents,
      runtimeCompaction: {
        status: runtimeCompaction.status,
        compacted: runtimeCompaction.compacted === true,
        strategy: runtimeCompaction.strategy || null,
        executionMode: runtimeCompaction.executionMode || "",
        triggerReason: runtimeCompaction.triggerReason || "",
        degraded: runtimeCompaction.degraded === true,
        boundaryId: runtimeCompaction.boundary?.boundaryId || "",
        tokenReport: runtimeCompaction.tokenReport || null
      },
      triggerReason: compressed ? "threshold_exceeded" : "within_budget",
      sourceTokens,
      totalTokens,
      sectionTokens,
      budgets,
      preservedEvidenceIds: pack.evidencePack.map((item) => item.evidenceId).filter(Boolean),
      droppedEvidenceIds,
      droppedKnowledgeCount: droppedEvidenceIds.length,
      droppedRecentTurnCount: recentTurns.droppedCount,
      droppedExpertGuidanceCount: expertGuidance.droppedCount,
      protectedEvidenceIds,
      protectedEvidenceCount: selectedEvidence.protectedEvidenceCount,
      protectedEvidenceBudgetOverrun: selectedEvidence.protectedEvidenceBudgetOverrun,
      humanExpertGuidanceCount: pack.expertGuidance.length,
      protectedEvidenceFields: profile.protectedEvidenceFields
    };
    pack.contextBuildRecordId = record.recordId;
    pack.budgetReport = {
      contextWindowTokens: profile.contextWindowTokens,
      usableTokens,
      totalTokens,
      sourceTokens,
      thresholdTokens,
      compressed,
      compressionMode: profile.compression.mode,
      strategy: profile.compression.strategy,
      modelCompression: {
        enabled: profile.modelCompression.enabled,
        alias: profile.modelCompression.alias,
        used: modelCompressionEvents.some((event) => event.used),
        degraded: modelCompressionEvents.some((event) => event.degraded),
        fallback: profile.modelCompression.fallback,
        events: modelCompressionEvents
      },
      compaction: {
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        enabled: profile.compactionPolicy.enabled,
        status: runtimeCompaction.status,
        compacted: runtimeCompaction.compacted === true,
        strategy: runtimeCompaction.strategy || null,
        executionMode: runtimeCompaction.executionMode || "",
        triggerReason: runtimeCompaction.triggerReason || "",
        degraded: runtimeCompaction.degraded === true,
        degradedReasons: runtimeCompaction.degradedReasons || [],
        boundaryId: runtimeCompaction.boundary?.boundaryId || "",
        tokenReport: runtimeCompaction.tokenReport || null,
        circuitBreaker: runtimeCompaction.circuitBreaker || null
      },
      budgets,
      sectionTokens,
      contextBuildRecordId: record.recordId,
      droppedKnowledgeCount: droppedEvidenceIds.length,
      droppedRecentTurnCount: recentTurns.droppedCount,
      droppedExpertGuidanceCount: expertGuidance.droppedCount,
      protectedEvidenceIds,
      protectedEvidenceCount: selectedEvidence.protectedEvidenceCount,
      protectedEvidenceBudgetOverrun: selectedEvidence.protectedEvidenceBudgetOverrun,
      outputReserveTokens: profile.outputReserveTokens,
      toolReserveTokens: profile.toolReserveTokens
    };
    if (input.record !== false) {
      await writeBuildRecord(record);
    }
    return pack;
  }

  async function preview(input = {}) {
    const pack = await assemble({
      ...input,
      inputSource: input.inputSource || "preview"
    });
    return {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      contextPack: pack,
      budgetReport: pack.budgetReport
    };
  }

  async function runEvaluation(input = {}) {
    const profiles = asArray(input.profiles || input.profileIds).length
      ? asArray(input.profiles || input.profileIds)
      : [input.contextProfileId || "context-128k"];
    const cases = asArray(input.cases).length ? asArray(input.cases) : [];
    const startedAt = new Date().toISOString();
    const results = [];
    for (const profileRef of profiles) {
      const contextProfileId = typeof profileRef === "string" ? profileRef : profileRef.profileId || profileRef.contextProfileId;
      for (const testCase of cases) {
        const pack = await assemble({
          ...testCase,
          contextProfileId,
          inputSource: "context-evaluation"
        });
        const retained = new Set([
          ...asArray(pack.evidencePack).map((item) => item.evidenceId),
          ...asArray(pack.citations).map((item) => item.evidenceId)
        ].filter(Boolean));
        const required = normalizeStringArray(testCase.requiredEvidenceIds);
        const hitCount = required.filter((id) => retained.has(id)).length;
        results.push({
          caseId: testCase.caseId || testCase.id || hashText(testCase.taskBrief || testCase.query || JSON.stringify(testCase)),
          profileId: pack.profileId,
          requiredEvidenceIds: required,
          retainedEvidenceIds: [...retained],
          requiredEvidenceRecall: required.length ? Number((hitCount / required.length).toFixed(6)) : 1,
          totalTokens: pack.budgetReport.totalTokens,
          compressed: pack.budgetReport.compressed,
          contextBuildRecordId: pack.contextBuildRecordId
        });
      }
    }
    const run = {
      protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
      runId: input.runId || `context-eval-${crypto.randomUUID?.() || hashText(startedAt)}`,
      startedAt,
      completedAt: new Date().toISOString(),
      caseCount: cases.length,
      profileCount: profiles.length,
      metrics: {
        averageRequiredEvidenceRecall: results.length
          ? Number((results.reduce((total, item) => total + item.requiredEvidenceRecall, 0) / results.length).toFixed(6))
          : 1,
        averageTokens: results.length
          ? Math.round(results.reduce((total, item) => total + item.totalTokens, 0) / results.length)
          : 0
      },
      results
    };
    await appendJsonl(evaluationRunsPath, run);
    return run;
  }

  return {
    protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
    rootPath,
    profilesPath,
    buildRecordsPath,
    evaluationRunsPath,
    compactionRuntime,
    listProfiles,
    saveProfiles,
    resolveProfile,
    preview,
    listBuildRecords,
    runEvaluation,
    assemble,
    compact,
    previewCompaction,
    runCompaction,
    listCompactionRecords,
    listCompactionStrategies,
    listSessionMemory,
    clearSessionMemory,
    estimateTokens
  };
}

export default createContextRuntime;
