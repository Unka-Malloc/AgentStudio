import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../common/storage/sqlite-migrations.mjs";
import { createEmbeddingRuntime as createProtocolEmbeddingRuntime } from "../../retrieval/embedding-runtime/index.mjs";
import {
  SQLITE_VEC_PROVIDER_ID,
  createLocalVectorStore as createProtocolLocalVectorStore
} from "../../retrieval/vector-store/LocalVectorStore/index.mjs";
import {
  LEARNING_PROTOCOL_VERSION,
  createLearningRuntime
} from "../../retrieval/learning-runtime/index.mjs";
import { createKnowledgeTaxonomyRuntime } from "../../preprocessing/domain/knowledge-taxonomy/index.mjs";
import {
  evaluateQueryIntentText as evaluateTaxonomyQueryIntentText
} from "../../preprocessing/domain/knowledge-taxonomy/default-taxonomy.mjs";
import {
  asArray,
  clampNumber,
  compactObject,
  hashText,
  normalizeText,
  parseJson,
  stableJson,
  stringifyJson,
  truncateText,
  uniqueStrings
} from "./core-utils.mjs";
import {
  candidateTemporalSource,
  exponentialRecencyScore,
  queryTerms,
  queryTermsForSearch,
  queryMatchQualityScore,
  resolveQueryIntentProfile,
  termPresenceScore,
  tokenOverlapScore
} from "./retrieval-scoring.mjs";
import {
  fuseLocalMirrorWithKnowledgeItems,
  localQueryHitsFromInput
} from "./local-mirror-fusion.mjs";
import {
  hydrateAsset,
  hydrateBlock,
  hydrateDocument,
  hydrateFeedback,
  hydrateLearningRun,
  hydrateProfileDeployment,
  hydrateRetrievalProfile,
  hydrateReviewItem,
  hydrateSection,
  hydrateSuggestion
} from "./row-hydrators.mjs";
import {
  DEFAULT_SETTINGS,
  LICENSE_MANIFEST
} from "./runtime-config.mjs";
import {
  createNoopDocumentOutlineRuntime,
  resolveDocumentOutlineRuntime
} from "./outline-runtime-loader.mjs";
import { buildKnowledgeDocxExport } from "./knowledge-docx-export.mjs";
import { buildKnowledgeMarkdownExport } from "./knowledge-markdown-export.mjs";
import { buildKnowledgeHtmlExport } from "./knowledge-html-export.mjs";

export const KNOWLEDGE_PROTOCOL_VERSION = "pact.knowledge.v1";
export const VECTOR_PROTOCOL_VERSION = "pact.vector.v1";
export const EMBEDDING_PROTOCOL_VERSION = "pact.embedding.v1";
export const ASSET_STORE_PROTOCOL_VERSION = "pact.assetStore.v1";
export const RETRIEVAL_PROTOCOL_VERSION = "pact.retrieval.v1";
export const LEARNING_RUNTIME_PROTOCOL_VERSION = LEARNING_PROTOCOL_VERSION;
export const KNOWLEDGE_SEARCH_AGENT_MESSAGE_PROTOCOL_VERSION = "pact.knowledge-search.agent-message.v1";

function nowIso() {
  return new Date().toISOString();
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSearchResponseProfile(value = "") {
  const normalized = normalizeText(value).toLowerCase().replace(/[_\s]+/g, "-");
  if (["agent", "mcp", "tool", "tool-grant", "machine", "machine-readable"].includes(normalized)) {
    return "agent";
  }
  if (["api", "http", "rpc", "cli", "integration", "service"].includes(normalized)) {
    return "api";
  }
  if (["console", "ui", "human", "control-plane", "management-console"].includes(normalized)) {
    return "console";
  }
  return "";
}

function parseSearchBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function shouldAttachAgentSearchMessage(input = {}) {
  const profile = normalizeSearchResponseProfile(input.responseProfile || input.requestSurface || input.surface || "");
  if (profile === "agent") {
    return input.agentMessage !== false && input.machineReadable !== false;
  }
  return parseSearchBooleanFlag(input.agentMessage ?? input.machineReadable, false);
}

function normalizeSearchTimeRange(input = {}) {
  const source = objectOrEmpty(input.timeRange || input.dateRange || input.temporalRange);
  const from = normalizeText(source.from || source.start || source.startDate || input.from || input.startDate || "");
  const to = normalizeText(source.to || source.end || source.endDate || input.to || input.endDate || "");
  const mode = normalizeText(source.mode || input.timeRangeMode || "");
  return compactObject({
    from,
    to,
    mode
  });
}

function compactSearchReason(reason) {
  if (!reason || typeof reason !== "object" || Array.isArray(reason)) {
    return { kind: normalizeText(reason) };
  }
  return compactObject({
    kind: normalizeText(reason.kind || reason.reason || ""),
    score: Number(reason.score || 0),
    weight: reason.weight === undefined ? undefined : Number(reason.weight || 0),
    timestamp: normalizeText(reason.timestamp || ""),
    intentId: normalizeText(reason.intentId || ""),
    path: Array.isArray(reason.path) ? reason.path : undefined
  });
}

function temporalHintForSearchItem(item = {}) {
  const timeDecayReason = asArray(item.reasons).find((reason) =>
    reason && typeof reason === "object" && normalizeText(reason.kind).toLowerCase() === "time-decay"
  );
  const source = objectOrEmpty(item.source || item.sourceLocator);
  return compactObject({
    timestamp: normalizeText(
      timeDecayReason?.timestamp ||
        source.latestActivityAt ||
        source.sentAt ||
        source.timestamp ||
        source.updatedAt ||
        source.createdAt ||
        ""
    ),
    source: timeDecayReason?.timestamp ? "ranking-time-decay" : ""
  });
}

function buildKnowledgeSearchAgentMessage(result = {}, input = {}) {
  const explain = objectOrEmpty(result.explain);
  const timeRange = normalizeSearchTimeRange(input);
  return {
    protocolVersion: KNOWLEDGE_SEARCH_AGENT_MESSAGE_PROTOCOL_VERSION,
    machineReadable: true,
    responseProfile: "agent",
    query: normalizeText(result.query || input.query || input.q || ""),
    constraints: compactObject({
      batchId: normalizeText(result.batchId || input.batchId || ""),
      sourceIds: uniqueStrings([
        ...asArray(input.scopeSourceIds),
        ...asArray(input.sourceIds)
      ]),
      timeRange: Object.keys(timeRange).length ? timeRange : undefined,
      temporalFilter: Object.keys(timeRange).length
        ? {
            requested: true,
            applied: false,
            reason: "time_range_filter_not_yet_supported_by_knowledge_search"
          }
        : undefined,
      retrievalMode: normalizeText(result.retrievalMode || input.retrievalMode || input.mode || ""),
      keywordOnly: input.keywordOnly === true
    }),
    routing: compactObject({
      retrievalProfileId: normalizeText(result.retrievalProfileId || ""),
      retrievalProfileKey: normalizeText(result.retrievalProfileKey || ""),
      profileRoute: result.profileRoute,
      queryIntent: result.queryIntent,
      hierarchy: result.hierarchy
    }),
    diagnostics: compactObject({
      candidateCount: explain.candidateCount,
      generatedCandidateCount: explain.generatedCandidateCount,
      dedupedCandidateCount: explain.dedupedCandidateCount,
      hierarchyCandidateCount: explain.hierarchyCandidateCount,
      hierarchyBackoffCount: explain.hierarchyBackoffCount,
      fusion: result.fusion
    }),
    items: asArray(result.items || result.results).map((item, index) => compactObject({
      rank: index + 1,
      evidenceId: normalizeText(item.evidenceId || ""),
      documentId: normalizeText(item.documentId || ""),
      itemId: normalizeText(item.itemId || ""),
      title: normalizeText(item.title || ""),
      score: Number(item.score || item.finalScore || item.relevanceScore || 0),
      modalities: asArray(item.modalities),
      source: item.source || item.sourceLocator || null,
      temporal: temporalHintForSearchItem(item),
      reasons: asArray(item.reasons).slice(0, 8).map(compactSearchReason)
    }))
  };
}

function decodeHtmlEntities(value = "") {
  const named = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'"
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    const key = String(entity || "").toLowerCase();
    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : " ";
  });
}

function decodeQuotedPrintableText(value = "") {
  const text = String(value || "");
  if (!/=[0-9a-f]{2}|=\r?\n/i.test(text)) {
    return text;
  }
  const encoded = text
    .replace(/=\r?\n/g, "")
    .replace(/%(?![0-9a-f]{2})/gi, "%25")
    .replace(/=([0-9a-f]{2})/gi, "%$1");
  try {
    return decodeURIComponent(encoded);
  } catch {
    return text
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
}

function stripEmailTransportHeaders(value = "") {
  const text = String(value || "");
  const withoutEnvelope = text.replace(/^[\s\S]{0,12000}?\r?\n\r?\n/, (headers) => {
    const headerLines = headers.split(/\r?\n/);
    const headerLike = headerLines.filter((line) =>
      /^(from|to|cc|bcc|subject|date|message-id|mime-version|content-|dkim-|received|return-path|reply-to|sender|list-|x-)[^:]*:/i.test(line)
    ).length;
    return headerLike >= 3 ? "\n" : headers;
  });
  return withoutEnvelope
    .replace(/^--[^\s]+.*$/gm, " ")
    .replace(/^(content-type|content-transfer-encoding|content-disposition|content-id|mime-version):[^\n]*(?:\n[ \t][^\n]*)*/gim, " ")
    .replace(/^[-_]{20,}$/gm, " ");
}

function stripHtmlToVisibleText(value = "", maxLength = 20000) {
  const decoded = decodeHtmlEntities(decodeQuotedPrintableText(value));
  const bodyMatch = decoded.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const html = bodyMatch ? bodyMatch[1] : decoded;
  return normalizeText(
    html
      .replace(/<head[\s\S]*?(?:<\/head>|<body\b[^>]*>|$)/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<meta\b[^>]*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<img\b[^>]*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|tr|td|li|h[1-6]|section|article|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\bhttps?:\/\/\S+/gi, " ")
      .replace(/\b[\w.-]+\/[\w./?&=%#:+-]+\.(?:png|jpe?g|gif|webp|svg)\b/gi, " ")
  ).slice(0, maxLength);
}

function looksLikeHtmlMarkup(value = "") {
  return /<\/?(?:html|head|body|meta|table|tr|td|div|span|p|a|img|script|style)\b/i.test(String(value || ""));
}

function cleanVisibleIndexText(value = "", maxLength = 20000) {
  const decoded = decodeQuotedPrintableText(stripEmailTransportHeaders(value));
  const visible = looksLikeHtmlMarkup(decoded)
    ? stripHtmlToVisibleText(decoded, maxLength)
    : normalizeText(decodeHtmlEntities(decoded)).slice(0, maxLength);
  return normalizeText(
    visible
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^https?:\/\//i.test(line) && !/\.(?:png|jpe?g|gif|webp|svg)(?:\W|$)/i.test(line))
      .join("\n")
  ).slice(0, maxLength);
}

function firstEmailAddress(value = "") {
  const decoded = decodeHtmlEntities(String(value || ""));
  const angle = decoded.match(/<([^<>@\s]+@[^<>\s]+)>/);
  const direct = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return normalizeText(angle?.[1] || direct?.[0] || "").toLowerCase();
}

function htmlMetaContent(value = "", name = "") {
  const escapedName = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta\\b(?=[^>]*\\bname=["']${escapedName}["'])(?=[^>]*\\bcontent=(["'])([\\s\\S]*?)\\1)[^>]*>`,
    "i"
  );
  return decodeHtmlEntities(pattern.exec(String(value || ""))?.[2] || "");
}

function emailHeaderValue(value = "", headerName = "") {
  const escapedName = String(headerName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(value || "").match(new RegExp(`(?:^|\\n)${escapedName}\\s*:\\s*([^\\n]+)`, "i"));
  return decodeHtmlEntities(match?.[1] || "");
}

function extractEmailAddressFromDocumentText(value = "", kind = "senderEmail") {
  const text = String(value || "");
  if (kind === "recipientEmail") {
    return (
      firstEmailAddress(htmlMetaContent(text, "Message:To-Email")) ||
      firstEmailAddress(htmlMetaContent(text, "Message-To")) ||
      firstEmailAddress(htmlMetaContent(text, "Message:Raw-Header:Delivered-To")) ||
      firstEmailAddress(emailHeaderValue(text, "Delivered-To")) ||
      firstEmailAddress(emailHeaderValue(text, "To"))
    );
  }
  return (
    firstEmailAddress(htmlMetaContent(text, "Message:From-Email")) ||
    firstEmailAddress(htmlMetaContent(text, "Message-From")) ||
    firstEmailAddress(htmlMetaContent(text, "Message:From")) ||
    firstEmailAddress(emailHeaderValue(text, "From"))
  );
}

function emailDomain(address = "") {
  const value = firstEmailAddress(address);
  return value.includes("@") ? value.split("@").pop() || "" : "";
}

function aggregateCategoryForMetric({ taxonomy = {}, metric = "", categoryId = "", categoryPath = "" } = {}) {
  const requestedId =
    normalizeText(categoryId) ||
    (metric === "email_advertising_by_sender" ? "marketing_promo" : "");
  const requestedPath = normalizeText(categoryPath);
  const categories = asArray(taxonomy.categories);
  return categories.find((category) => {
    if (requestedId && category.categoryId === requestedId) {
      return true;
    }
    if (requestedPath && category.path === requestedPath) {
      return true;
    }
    return false;
  }) || null;
}

function categoryTerms(category = {}) {
  return [
    category.label,
    ...(category.keywords || []),
    ...(category.strongTerms || []),
    ...(category.primaryTerms || []),
    ...(category.anchorTerms || []),
    ...(category.requiredTerms || []),
    ...(category.queryTriggers || []),
    ...(category.expansionTerms || [])
  ].filter(Boolean);
}

function categoryPrimaryTerms(category = {}) {
  return [
    category.label,
    ...(category.primaryTerms || []),
    ...(category.anchorTerms || []),
    ...(category.requiredTerms || []),
    ...(category.strongTerms || [])
  ].filter(Boolean);
}

function aggregateTokenSet(value = "") {
  return new Set(
    String(value || "")
      .toLowerCase()
      .match(/[\p{L}\p{N}_+-]+/gu) || []
  );
}

function aggregateTermMatches(haystackLower = "", tokenSet = new Set(), terms = [], limit = 16) {
  const result = [];
  const seen = new Set();
  for (const term of uniqueStrings(terms, 240)) {
    const normalized = normalizeText(term).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    const matched = normalized.includes(" ")
      ? haystackLower.includes(normalized)
      : haystackLower.includes(normalized) || tokenSet.has(normalized);
    if (!matched) {
      continue;
    }
    seen.add(normalized);
    result.push(term);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function documentMatchesAggregateCategory({ title = "", text = "", category = null } = {}) {
  if (!category) {
    return { matches: true, score: 0, positiveHits: [], negativeHits: [] };
  }
  const haystack = `${title}\n${text}`;
  const haystackLower = haystack.toLowerCase();
  const tokenSet = aggregateTokenSet(haystackLower);
  const primaryHits = aggregateTermMatches(haystackLower, tokenSet, categoryPrimaryTerms(category), 12);
  const positiveHits = aggregateTermMatches(haystackLower, tokenSet, categoryTerms(category), 12);
  const negativeHits = aggregateTermMatches(haystackLower, tokenSet, category.negativeTerms || [], 12);
  const minPrimaryHits = Math.max(1, Number(category.minPrimaryHits || 1));
  const minPositiveHits = Math.max(1, Number(category.minPositiveHits || 1));
  const negativeDominance = Math.max(1, Number(category.negativeDominance || 2));
  const negativeDominates =
    negativeHits.length >= negativeDominance &&
    primaryHits.length < minPrimaryHits + 1;
  const matches =
    primaryHits.length >= minPrimaryHits &&
    positiveHits.length >= minPositiveHits &&
    !negativeDominates;
  const score = positiveHits.length
    ? Math.min(1, (primaryHits.length * 1.5 + positiveHits.length * 0.8) / Math.max(4, minPositiveHits * 2))
    : 0;
  return {
    matches,
    score: Number(score.toFixed(6)),
    positiveHits,
    negativeHits
  };
}

function stableId(prefix, ...parts) {
  return `${prefix}::${hashText(parts.map((part) => String(part || "")).join("\u001f"), 24)}`;
}

function normalizeSourcePathKey(value) {
  return normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeEmailTitleFamily(value) {
  return normalizeText(value)
    .replace(/\.(?:eml|msg|mbox)$/i, "")
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .replace(/\s+\d+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function looksLikeMailSource(value = "") {
  return /\.(?:eml|msg|mbox)$/i.test(normalizeText(value));
}

function sourceContentHash(source = {}, text = "") {
  return normalizeText(
    source.rawObjectSha256 ||
      source.rawObject?.sha256 ||
      source.sha256 ||
      source.contentSha256 ||
      source.sourceHash ||
      (text ? hashText(text, 64) : "")
  );
}

function sourcePathKey(source = {}) {
  return normalizeSourcePathKey(
    source.path ||
      source.originalRelativePath ||
      source.rawObject?.originalRelativePath ||
      source.name ||
      source.id ||
      ""
  );
}

function canonicalSourceKey(source = {}, text = "") {
  const contentHash = sourceContentHash(source, text);
  if (contentHash) {
    return `hash:${contentHash}`;
  }
  const pathKey = sourcePathKey(source);
  return pathKey ? `path:${pathKey}` : "";
}

function documentIdForSource(source = {}, text = "") {
  const key = canonicalSourceKey(source, text);
  return key
    ? stableId("document", "source", key)
    : stableId("document", "source", source.id || source.name || Math.random());
}

function boundedIndexText(parts = [], maxLength = 8000) {
  return normalizeText(parts.filter(Boolean).join("\n")).slice(0, maxLength);
}

function categoryPath(parts = []) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(" > ");
}

function metadataIndexText(metadata = {}) {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }
  return Object.entries(metadata)
    .flatMap(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, ...value.map((item) => String(item || ""))];
      }
      if (value && typeof value === "object") {
        return [key, JSON.stringify(value)];
      }
      return [key, String(value || "")];
    })
    .join(" ");
}

function hierarchyId(nodeType, targetId) {
  return `${nodeType}::${String(targetId || "")}`;
}

function hierarchyLevel(nodeType) {
  if (nodeType === "collection") return 0;
  if (nodeType === "document") return 1;
  if (nodeType === "section") return 2;
  if (nodeType === "outline") return 3;
  return 9;
}

function hierarchyLevelWeight(nodeType) {
  if (nodeType === "collection") return 1;
  if (nodeType === "document") return 0.95;
  if (nodeType === "section") return 0.85;
  if (nodeType === "outline") return 0.82;
  return 0.7;
}

function mediaExtension(mediaType = "") {
  if (/png/i.test(mediaType)) return ".png";
  if (/jpe?g/i.test(mediaType)) return ".jpg";
  if (/webp/i.test(mediaType)) return ".webp";
  if (/gif/i.test(mediaType)) return ".gif";
  if (/bmp/i.test(mediaType)) return ".bmp";
  return ".bin";
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS kc_collections (
      collection_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      collection_type TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_documents (
      document_id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      document_type TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      source_hash TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_sections (
      section_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      title TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS kc_blocks (
      block_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      block_type TEXT NOT NULL DEFAULT 'text',
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      source_locator_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_assets (
      asset_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      block_id TEXT NOT NULL DEFAULT '',
      asset_type TEXT NOT NULL DEFAULT 'image',
      media_type TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      ocr_text TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      relative_path TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      byte_size INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      source_locator_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_embeddings (
      embedding_id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      modality TEXT NOT NULL DEFAULT 'text',
      provider TEXT NOT NULL DEFAULT '',
      dimension INTEGER NOT NULL DEFAULT 0,
      vector_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(target_type, target_id, modality, provider)
    );

    CREATE TABLE IF NOT EXISTS kc_evidence_packs (
      evidence_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL DEFAULT '',
      document_id TEXT NOT NULL DEFAULT '',
      section_id TEXT NOT NULL DEFAULT '',
      block_id TEXT NOT NULL DEFAULT '',
      asset_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      score REAL NOT NULL DEFAULT 0,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      locator_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      markdown TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_relationships (
      relationship_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_hierarchy_nodes (
      hierarchy_id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      target_id TEXT NOT NULL,
      parent_hierarchy_id TEXT NOT NULL DEFAULT '',
      collection_id TEXT NOT NULL DEFAULT '',
      document_id TEXT NOT NULL DEFAULT '',
      section_id TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      category_path TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_sync_log (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'upsert',
      entity_id TEXT NOT NULL DEFAULT '',
      item_id TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      server_updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS kc_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_maintenance_runs (
      run_id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS kc_feedback (
      feedback_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL DEFAULT '',
      query TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      item_id TEXT NOT NULL DEFAULT '',
      evidence_id TEXT NOT NULL DEFAULT '',
      result_rank INTEGER NOT NULL DEFAULT 0,
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_retrieval_profiles (
      profile_key TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 0,
      weights_json TEXT NOT NULL DEFAULT '{}',
      top_k INTEGER NOT NULL DEFAULT 20,
      fusion_mode TEXT NOT NULL DEFAULT 'reciprocal_rank',
      reranker_json TEXT NOT NULL DEFAULT '{}',
      thresholds_json TEXT NOT NULL DEFAULT '{}',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kc_knowledge_suggestions (
      suggestion_id TEXT PRIMARY KEY,
      suggestion_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      proposed_patch_json TEXT NOT NULL DEFAULT '{}',
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      resolution_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS kc_review_items (
      review_id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'knowledge-core',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'medium',
      operation_id TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      current_record_json TEXT NOT NULL DEFAULT '{}',
      incoming_record_json TEXT NOT NULL DEFAULT '{}',
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      resolution_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS kc_learning_runs (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      metrics_before_json TEXT NOT NULL DEFAULT '{}',
      metrics_after_json TEXT NOT NULL DEFAULT '{}',
      candidate_profile_json TEXT NOT NULL DEFAULT '{}',
      generated_suggestions_json TEXT NOT NULL DEFAULT '[]',
      output_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS kc_retrieval_profile_deployments (
      deployment_id TEXT PRIMARY KEY,
      profile_key TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      traffic_percent REAL NOT NULL DEFAULT 0,
      baseline_profile_key TEXT NOT NULL DEFAULT '',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      gate_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT ''
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS kc_blocks_fts USING fts5(
      block_id UNINDEXED,
      title,
      text,
      snippet,
      metadata,
      tokenize = 'unicode61 remove_diacritics 0'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS kc_assets_fts USING fts5(
      asset_id UNINDEXED,
      title,
      text,
      ocr_text,
      caption,
      metadata,
      tokenize = 'unicode61 remove_diacritics 0'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS kc_hierarchy_fts USING fts5(
      hierarchy_id UNINDEXED,
      title,
      summary,
      text,
      category_path,
      metadata,
      tokenize = 'unicode61 remove_diacritics 0'
    );

    CREATE INDEX IF NOT EXISTS idx_kc_documents_batch ON kc_documents(batch_id, document_type);
    CREATE INDEX IF NOT EXISTS idx_kc_blocks_doc ON kc_blocks(document_id, section_id, position);
    CREATE INDEX IF NOT EXISTS idx_kc_assets_doc ON kc_assets(document_id, section_id, block_id);
    CREATE INDEX IF NOT EXISTS idx_kc_embeddings_target ON kc_embeddings(target_type, target_id, modality);
    CREATE INDEX IF NOT EXISTS idx_kc_evidence_doc ON kc_evidence_packs(document_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_sync_log_cursor ON kc_sync_log(cursor);
    CREATE INDEX IF NOT EXISTS idx_kc_sync_log_batch ON kc_sync_log(batch_id, cursor);
    CREATE INDEX IF NOT EXISTS idx_kc_feedback_created ON kc_feedback(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_feedback_action ON kc_feedback(action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_profiles_active ON kc_retrieval_profiles(active, profile_id, version DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_suggestions_status ON kc_knowledge_suggestions(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_review_items_status ON kc_review_items(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_learning_runs_status ON kc_learning_runs(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_profile_deployments_status ON kc_retrieval_profile_deployments(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kc_profile_deployments_profile ON kc_retrieval_profile_deployments(profile_id, version);
    CREATE INDEX IF NOT EXISTS idx_kc_hierarchy_batch_level ON kc_hierarchy_nodes(batch_id, level, node_type);
    CREATE INDEX IF NOT EXISTS idx_kc_hierarchy_document ON kc_hierarchy_nodes(document_id, section_id);
    CREATE INDEX IF NOT EXISTS idx_kc_hierarchy_parent ON kc_hierarchy_nodes(parent_hierarchy_id);
  `);

  // Version-controlled migrations — add new steps here as the schema evolves.
  runMigrations(db, [
    // version 1: baseline — all tables above were created by the initial db.exec.
    { version: 1, up: () => {} }
  ]);
}

function createKnowledgeStore({ db, rootPath, taxonomyRuntime = null, outlineRuntime = createNoopDocumentOutlineRuntime() }) {
  ensureSchema(db);
  const assetRoot = path.join(rootPath, "assets");
  fs.mkdirSync(assetRoot, { recursive: true });

  let embeddingRuntime = createProtocolEmbeddingRuntime({
    settings: DEFAULT_SETTINGS,
    licenseManifest: LICENSE_MANIFEST
  });
  let vectorStore = createProtocolLocalVectorStore({
    db,
    embeddingRuntime,
    providerId: SQLITE_VEC_PROVIDER_ID
  });
  let learningRuntime = createLearningRuntime({
    settings: DEFAULT_SETTINGS.learning
  });

  function activeTaxonomy() {
    return typeof taxonomyRuntime?.loadSync === "function"
      ? taxonomyRuntime.loadSync()
      : null;
  }

  function refreshProtocolModules(settings = DEFAULT_SETTINGS) {
    embeddingRuntime = createProtocolEmbeddingRuntime({
      settings,
      licenseManifest: LICENSE_MANIFEST
    });
    vectorStore = createProtocolLocalVectorStore({
      db,
      embeddingRuntime,
      providerId: settings?.vectorStore?.providerId || SQLITE_VEC_PROVIDER_ID
    });
    learningRuntime = createLearningRuntime({
      settings: settings?.learning || DEFAULT_SETTINGS.learning
    });
  }

  const upsertCollectionStmt = db.prepare(`
    INSERT INTO kc_collections (
      collection_id, title, collection_type, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(collection_id) DO UPDATE SET
      title = excluded.title,
      collection_type = excluded.collection_type,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const insertDocumentStmt = db.prepare(`
    INSERT INTO kc_documents (
      document_id, collection_id, batch_id, source_id, document_type, title, summary,
      source_path, source_hash, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSectionStmt = db.prepare(`
    INSERT INTO kc_sections (
      section_id, document_id, title, level, position, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertBlockStmt = db.prepare(`
    INSERT INTO kc_blocks (
      block_id, document_id, section_id, block_type, title, text, snippet, position,
      source_locator_json, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAssetStmt = db.prepare(`
    INSERT INTO kc_assets (
      asset_id, document_id, section_id, block_id, asset_type, media_type, title, text,
      ocr_text, caption, relative_path, sha256, byte_size, width, height,
      source_locator_json, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBlockFtsStmt = db.prepare(`
    INSERT INTO kc_blocks_fts (block_id, title, text, snippet, metadata)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertAssetFtsStmt = db.prepare(`
    INSERT INTO kc_assets_fts (asset_id, title, text, ocr_text, caption, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const upsertHierarchyNodeStmt = db.prepare(`
    INSERT INTO kc_hierarchy_nodes (
      hierarchy_id, node_type, level, target_id, parent_hierarchy_id, collection_id,
      document_id, section_id, batch_id, title, summary, text, category_path,
      metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hierarchy_id) DO UPDATE SET
      node_type = excluded.node_type,
      level = excluded.level,
      target_id = excluded.target_id,
      parent_hierarchy_id = excluded.parent_hierarchy_id,
      collection_id = excluded.collection_id,
      document_id = excluded.document_id,
      section_id = excluded.section_id,
      batch_id = excluded.batch_id,
      title = excluded.title,
      summary = excluded.summary,
      text = excluded.text,
      category_path = excluded.category_path,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const deleteHierarchyFtsStmt = db.prepare("DELETE FROM kc_hierarchy_fts WHERE hierarchy_id = ?");
  const insertHierarchyFtsStmt = db.prepare(`
    INSERT INTO kc_hierarchy_fts (hierarchy_id, title, summary, text, category_path, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const countHierarchyNodesStmt = db.prepare("SELECT COUNT(*) AS count FROM kc_hierarchy_nodes");
  const insertSyncLogStmt = db.prepare(`
    INSERT INTO kc_sync_log (
      kind, action, entity_id, item_id, batch_id, revision, server_updated_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectSyncLogStmt = db.prepare(`
    SELECT * FROM kc_sync_log
    WHERE cursor > ?
    ORDER BY cursor ASC
    LIMIT ?
  `);
  const selectMaxSyncCursorStmt = db.prepare("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM kc_sync_log");
  const upsertReviewItemStmt = db.prepare(`
    INSERT INTO kc_review_items (
      review_id, source, status, reason, severity, operation_id, batch_id,
      entity_id, entity_type, title, summary, current_record_json,
      incoming_record_json, evidence_refs_json, created_at, updated_at,
      resolved_at, resolution_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(review_id) DO UPDATE SET
      source = excluded.source,
      status = excluded.status,
      reason = excluded.reason,
      severity = excluded.severity,
      operation_id = excluded.operation_id,
      batch_id = excluded.batch_id,
      entity_id = excluded.entity_id,
      entity_type = excluded.entity_type,
      title = excluded.title,
      summary = excluded.summary,
      current_record_json = excluded.current_record_json,
      incoming_record_json = excluded.incoming_record_json,
      evidence_refs_json = excluded.evidence_refs_json,
      updated_at = excluded.updated_at,
      resolved_at = excluded.resolved_at,
      resolution_json = excluded.resolution_json
  `);
  const selectReviewItemStmt = db.prepare("SELECT * FROM kc_review_items WHERE review_id = ?");
  const listReviewItemsStmt = db.prepare(`
    SELECT * FROM kc_review_items
    WHERE (? = '' OR status = ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const selectDocumentConflictRowStmt = db.prepare(`
    SELECT document_id, collection_id, batch_id, source_id, document_type, title,
           summary, source_path, source_hash, metadata_json, created_at, updated_at
    FROM kc_documents
    WHERE document_id = ?
  `);
  function deleteVectorTargetsByIds(targetIds = []) {
    const ids = asArray(targetIds).map((item) => String(item || "").trim()).filter(Boolean);
    if (ids.length === 0 || !vectorStore || typeof vectorStore.deleteByTargetIds !== "function") {
      return;
    }
    vectorStore.deleteByTargetIds({
      targetIds: ids
    });
  }

  const deleteBatchStmt = db.transaction((batchId) => {
    const timestamp = nowIso();
    const documentRows = db.prepare("SELECT document_id FROM kc_documents WHERE batch_id = ?").all(batchId);
    const sectionRows = db.prepare("SELECT section_id, document_id FROM kc_sections WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?)").all(batchId);
    const blockRows = db.prepare("SELECT block_id, document_id FROM kc_blocks WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?)").all(batchId);
    const assetRows = db.prepare("SELECT asset_id, document_id FROM kc_assets WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?)").all(batchId);
    deleteVectorTargetsByIds([
      ...blockRows.map((row) => row.block_id),
      ...assetRows.map((row) => row.asset_id)
    ]);
    db.prepare("DELETE FROM kc_evidence_packs WHERE batch_id = ?").run(batchId);
    db.prepare("DELETE FROM kc_embeddings WHERE target_id IN (SELECT block_id FROM kc_blocks WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?))").run(batchId);
    db.prepare("DELETE FROM kc_embeddings WHERE target_id IN (SELECT asset_id FROM kc_assets WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?))").run(batchId);
    db.prepare("DELETE FROM kc_blocks_fts WHERE block_id IN (SELECT block_id FROM kc_blocks WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?))").run(batchId);
    db.prepare("DELETE FROM kc_assets_fts WHERE asset_id IN (SELECT asset_id FROM kc_assets WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?))").run(batchId);
    db.prepare("DELETE FROM kc_hierarchy_fts WHERE hierarchy_id IN (SELECT hierarchy_id FROM kc_hierarchy_nodes WHERE batch_id = ?)").run(batchId);
    db.prepare("DELETE FROM kc_hierarchy_nodes WHERE batch_id = ?").run(batchId);
    db.prepare("DELETE FROM kc_assets WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?)").run(batchId);
    db.prepare("DELETE FROM kc_blocks WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?)").run(batchId);
    db.prepare("DELETE FROM kc_sections WHERE document_id IN (SELECT document_id FROM kc_documents WHERE batch_id = ?)").run(batchId);
    db.prepare("DELETE FROM kc_relationships WHERE source_id LIKE ? OR target_id LIKE ?").run(`%${batchId}%`, `%${batchId}%`);
    db.prepare("DELETE FROM kc_documents WHERE batch_id = ?").run(batchId);
    for (const row of assetRows) {
      appendMirrorChange({
        kind: "tombstone",
        action: "delete",
        entityId: row.asset_id,
        itemId: row.document_id,
        batchId,
        payload: { targetKind: "asset", assetId: row.asset_id, documentId: row.document_id },
        at: timestamp
      });
    }
    for (const row of blockRows) {
      appendMirrorChange({
        kind: "tombstone",
        action: "delete",
        entityId: row.block_id,
        itemId: row.document_id,
        batchId,
        payload: { targetKind: "block", blockId: row.block_id, documentId: row.document_id },
        at: timestamp
      });
    }
    for (const row of sectionRows) {
      appendMirrorChange({
        kind: "tombstone",
        action: "delete",
        entityId: row.section_id,
        itemId: row.document_id,
        batchId,
        payload: { targetKind: "section", sectionId: row.section_id, documentId: row.document_id },
        at: timestamp
      });
    }
    for (const row of documentRows) {
      appendMirrorChange({
        kind: "tombstone",
        action: "delete",
        entityId: row.document_id,
        itemId: row.document_id,
        batchId,
        payload: { targetKind: "document", documentId: row.document_id },
        at: timestamp
      });
    }
  });
  const selectSettingsStmt = db.prepare("SELECT value_json FROM kc_settings WHERE key = ?");
  const upsertSettingsStmt = db.prepare(`
    INSERT INTO kc_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `);
  const insertFeedbackStmt = db.prepare(`
    INSERT INTO kc_feedback (
      feedback_id, client_id, query, action, item_id, evidence_id, result_rank,
      context_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feedback_id) DO UPDATE SET
      client_id = excluded.client_id,
      query = excluded.query,
      action = excluded.action,
      item_id = excluded.item_id,
      evidence_id = excluded.evidence_id,
      result_rank = excluded.result_rank,
      context_json = excluded.context_json,
      created_at = excluded.created_at
  `);
  const selectFeedbackStmt = db.prepare(`
    SELECT * FROM kc_feedback
    WHERE created_at >= ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const upsertProfileStmt = db.prepare(`
    INSERT INTO kc_retrieval_profiles (
      profile_key, profile_id, version, active, weights_json, top_k, fusion_mode,
      reranker_json, thresholds_json, metrics_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_key) DO UPDATE SET
      profile_id = excluded.profile_id,
      version = excluded.version,
      active = excluded.active,
      weights_json = excluded.weights_json,
      top_k = excluded.top_k,
      fusion_mode = excluded.fusion_mode,
      reranker_json = excluded.reranker_json,
      thresholds_json = excluded.thresholds_json,
      metrics_json = excluded.metrics_json,
      updated_at = excluded.updated_at
  `);
  const deactivateProfilesStmt = db.prepare("UPDATE kc_retrieval_profiles SET active = 0, updated_at = ? WHERE profile_id = ?");
  const selectProfileStmt = db.prepare("SELECT * FROM kc_retrieval_profiles WHERE profile_key = ?");
  const selectActiveProfileStmt = db.prepare(`
    SELECT * FROM kc_retrieval_profiles
    WHERE active = 1
    ORDER BY version DESC
    LIMIT 1
  `);
  const selectLatestProfileByIdStmt = db.prepare(`
    SELECT * FROM kc_retrieval_profiles
    WHERE profile_id = ?
    ORDER BY version DESC
    LIMIT 1
  `);
  const insertSuggestionStmt = db.prepare(`
    INSERT INTO kc_knowledge_suggestions (
      suggestion_id, suggestion_type, confidence, proposed_patch_json, evidence_refs_json,
      status, created_at, updated_at, resolved_at, resolution_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(suggestion_id) DO UPDATE SET
      suggestion_type = excluded.suggestion_type,
      confidence = excluded.confidence,
      proposed_patch_json = excluded.proposed_patch_json,
      evidence_refs_json = excluded.evidence_refs_json,
      status = excluded.status,
      updated_at = excluded.updated_at,
      resolved_at = excluded.resolved_at,
      resolution_json = excluded.resolution_json
  `);
  const selectSuggestionStmt = db.prepare("SELECT * FROM kc_knowledge_suggestions WHERE suggestion_id = ?");
  const listSuggestionsStmt = db.prepare(`
    SELECT * FROM kc_knowledge_suggestions
    WHERE (? = '' OR status = ?)
    ORDER BY updated_at DESC, confidence DESC
    LIMIT ?
  `);
  const insertLearningRunStmt = db.prepare(`
    INSERT INTO kc_learning_runs (
      run_id, status, input_json, metrics_before_json, metrics_after_json,
      candidate_profile_json, generated_suggestions_json, output_json, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = excluded.status,
      metrics_before_json = excluded.metrics_before_json,
      metrics_after_json = excluded.metrics_after_json,
      candidate_profile_json = excluded.candidate_profile_json,
      generated_suggestions_json = excluded.generated_suggestions_json,
      output_json = excluded.output_json,
      finished_at = excluded.finished_at
  `);
  const selectLearningRunStmt = db.prepare("SELECT * FROM kc_learning_runs WHERE run_id = ?");
  const listLearningRunsStmt = db.prepare(`
    SELECT * FROM kc_learning_runs
    ORDER BY started_at DESC
    LIMIT ?
  `);
  const upsertProfileDeploymentStmt = db.prepare(`
    INSERT INTO kc_retrieval_profile_deployments (
      deployment_id, profile_key, profile_id, version, status, traffic_percent,
      baseline_profile_key, metrics_json, gate_json, reason, created_at, updated_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(deployment_id) DO UPDATE SET
      profile_key = excluded.profile_key,
      profile_id = excluded.profile_id,
      version = excluded.version,
      status = excluded.status,
      traffic_percent = excluded.traffic_percent,
      baseline_profile_key = excluded.baseline_profile_key,
      metrics_json = excluded.metrics_json,
      gate_json = excluded.gate_json,
      reason = excluded.reason,
      updated_at = excluded.updated_at,
      finished_at = excluded.finished_at
  `);
  const selectProfileDeploymentStmt = db.prepare("SELECT * FROM kc_retrieval_profile_deployments WHERE deployment_id = ?");
  const listProfileDeploymentsStmt = db.prepare(`
    SELECT * FROM kc_retrieval_profile_deployments
    WHERE (? = '' OR status = ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const selectCanaryDeploymentStmt = db.prepare(`
    SELECT * FROM kc_retrieval_profile_deployments
    WHERE status = 'canary' AND traffic_percent > 0
    ORDER BY updated_at DESC
    LIMIT 1
  `);

  function getSettings() {
    const row = selectSettingsStmt.get("default");
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(row ? parseJson(row.value_json, {}) : {})
    };
    const maintenance = {
      ...(DEFAULT_SETTINGS.maintenance || {}),
      ...(merged.maintenance || {})
    };
    if (
      maintenance.staleIndexHours === undefined &&
      maintenance.staleIndexAfterHours !== undefined
    ) {
      maintenance.staleIndexHours = maintenance.staleIndexAfterHours;
    }
    delete maintenance.staleIndexAfterHours;
    return {
      ...merged,
      maintenance
    };
  }

  function setSettings(patch = {}) {
    const current = getSettings();
    const next = {
      ...current,
      ...patch,
      embeddingModel: {
        ...current.embeddingModel,
        ...(patch.embeddingModel || {})
      },
      retrieval: {
        ...current.retrieval,
        ...(patch.retrieval || {})
      },
      learning: {
        ...current.learning,
        ...(patch.learning || {})
      },
      maintenance: {
        ...current.maintenance,
        ...(patch.maintenance || {})
      },
      markdown: {
        ...current.markdown,
        ...(patch.markdown || {})
      }
    };
    upsertSettingsStmt.run("default", stringifyJson(next), nowIso());
    refreshProtocolModules(next);
    return next;
  }

  refreshProtocolModules(getSettings());

  function profileKey(profileId, version) {
    return `${String(profileId || "balanced")}@${Number(version || 1)}`;
  }

  function profileFromSettings(settings = getSettings()) {
    return {
      profileId: settings.retrieval?.retrievalProfileId || "balanced",
      version: 1,
      active: true,
      weights: {
        bm25: Number(settings.retrieval?.bm25Weight ?? 0.55),
        vector: Number(settings.retrieval?.vectorWeight ?? 0.3),
        image: Number(settings.retrieval?.imageWeight ?? 0.15),
        graph: Number(settings.retrieval?.graphWeight ?? 0.05),
        feedbackBoost: Number(settings.retrieval?.feedbackBoost ?? 0.08)
      },
      topK: Number(settings.retrieval?.topK || 20),
      fusionMode: "reciprocal_rank",
      reranker: {
        provider: "builtin:deterministic-rrf",
        model: "",
        explicitModelRequired: true
      },
      thresholds: {
        minScore: 0,
        maxLatencyMs: 1500,
        minRecallDelta: 0,
        minNdcgDelta: 0,
        minMrrDelta: 0
      },
      metrics: {
        mrrAtK: 0,
        ndcgAtK: 0,
        recallAtK: 0,
        latencyP95Ms: 0
      }
    };
  }

  function persistRetrievalProfile(profile = {}, { active = false, timestamp = nowIso() } = {}) {
    const normalized = {
      ...profileFromSettings(),
      ...profile,
      weights: {
        ...profileFromSettings().weights,
        ...(profile.weights || {})
      },
      reranker: {
        ...profileFromSettings().reranker,
        ...(profile.reranker || {})
      },
      thresholds: {
        ...profileFromSettings().thresholds,
        ...(profile.thresholds || {})
      },
      metrics: {
        ...profileFromSettings().metrics,
        ...(profile.metrics || {})
      }
    };
    normalized.profileId = String(normalized.profileId || "balanced");
    normalized.version = Math.max(1, Number(normalized.version || 1));
    if (active) {
      deactivateProfilesStmt.run(timestamp, normalized.profileId);
    }
    upsertProfileStmt.run(
      profileKey(normalized.profileId, normalized.version),
      normalized.profileId,
      normalized.version,
      active || normalized.active ? 1 : 0,
      stringifyJson(normalized.weights),
      Number(normalized.topK || 20),
      normalized.fusionMode || "reciprocal_rank",
      stringifyJson(normalized.reranker),
      stringifyJson(normalized.thresholds),
      stringifyJson(normalized.metrics),
      normalized.createdAt || timestamp,
      timestamp
    );
    return hydrateRetrievalProfile(
      selectProfileStmt.get(profileKey(normalized.profileId, normalized.version))
    );
  }

  function ensureDefaultRetrievalProfile() {
    const active = hydrateRetrievalProfile(selectActiveProfileStmt.get());
    if (active) {
      return active;
    }
    return persistRetrievalProfile(profileFromSettings(), {
      active: true,
      timestamp: nowIso()
    });
  }

  function resolveRetrievalProfile({ profileId = "", profileKey: requestedKey = "" } = {}) {
    ensureDefaultRetrievalProfile();
    if (requestedKey) {
      const profile = hydrateRetrievalProfile(selectProfileStmt.get(String(requestedKey)));
      if (profile) {
        return profile;
      }
    }
    if (profileId) {
      const profile = hydrateRetrievalProfile(selectLatestProfileByIdStmt.get(String(profileId)));
      if (profile) {
        return profile;
      }
    }
    return hydrateRetrievalProfile(selectActiveProfileStmt.get()) || profileFromSettings();
  }

  function profileBucket(clientId = "", deploymentId = "") {
    const hash = hashText([clientId, deploymentId].join("\u001f"), 8);
    return (Number.parseInt(hash, 16) % 10000) / 100;
  }

  function resolveSearchProfile(input = {}) {
    const explicitProfileKey = String(input.profileKey || input.retrievalProfileKey || "").trim();
    const explicitProfileId = String(input.retrievalProfileId || input.profileId || "").trim();
    const activeProfile = resolveRetrievalProfile({
      profileId: explicitProfileId,
      profileKey: explicitProfileKey
    });
    if (explicitProfileKey || explicitProfileId || getSettings().learning?.canaryEnabled === false) {
      return {
        profile: activeProfile,
        deployment: null,
        routedBy: explicitProfileKey ? "explicit_profile_key" : explicitProfileId ? "explicit_profile_id" : "active"
      };
    }
    const clientId = String(input.clientId || input.client_id || "").trim();
    if (!clientId) {
      return {
        profile: activeProfile,
        deployment: null,
        routedBy: "active"
      };
    }
    const deployment = hydrateProfileDeployment(selectCanaryDeploymentStmt.get());
    if (!deployment) {
      return {
        profile: activeProfile,
        deployment: null,
        routedBy: "active"
      };
    }
    const bucket = profileBucket(clientId, deployment.deploymentId);
    if (bucket <= deployment.trafficPercent) {
      const profile = resolveRetrievalProfile({
        profileKey: deployment.profileKey
      });
      return {
        profile: profile || activeProfile,
        deployment,
        routedBy: "canary",
        bucket
      };
    }
    return {
      profile: activeProfile,
      deployment,
      routedBy: "active_control",
      bucket
    };
  }

  function retrievalSettingsFromProfile(settings, profile) {
    if (!profile) {
      return settings.retrieval || {};
    }
    return {
      ...(settings.retrieval || {}),
      topK: profile.topK || settings.retrieval?.topK || 20,
      bm25Weight: profile.weights?.bm25 ?? settings.retrieval?.bm25Weight,
      vectorWeight: profile.weights?.vector ?? settings.retrieval?.vectorWeight,
      imageWeight: profile.weights?.image ?? settings.retrieval?.imageWeight,
      graphWeight: profile.weights?.graph ?? settings.retrieval?.graphWeight,
      feedbackBoost: profile.weights?.feedbackBoost ?? settings.retrieval?.feedbackBoost,
      retrievalProfileId: profile.profileId || settings.retrieval?.retrievalProfileId || "balanced"
    };
  }

  function persistSuggestion(suggestion = {}, { status = "", timestamp = nowIso() } = {}) {
    const record = {
      suggestionId:
        suggestion.suggestionId ||
        stableId("suggestion", suggestion.type || "rankingRule", stringifyJson(suggestion.proposedPatch), timestamp),
      type: suggestion.type || suggestion.suggestionType || "rankingRule",
      confidence: Number(suggestion.confidence || 0),
      proposedPatch: suggestion.proposedPatch || suggestion.patch || {},
      evidenceRefs: asArray(suggestion.evidenceRefs),
      status: status || suggestion.status || "pending",
      createdAt: suggestion.createdAt || timestamp,
      updatedAt: timestamp,
      resolvedAt: suggestion.resolvedAt || "",
      resolution: suggestion.resolution || {}
    };
    insertSuggestionStmt.run(
      record.suggestionId,
      record.type,
      record.confidence,
      stringifyJson(record.proposedPatch),
      stringifyJson(record.evidenceRefs, []),
      record.status,
      record.createdAt,
      record.updatedAt,
      record.resolvedAt,
      stringifyJson(record.resolution)
    );
    const persisted = hydrateSuggestion(selectSuggestionStmt.get(record.suggestionId));
    appendMirrorChange({
      kind: "suggestion",
      action: persisted.status,
      entityId: persisted.suggestionId,
      itemId: persisted.suggestionId,
      payload: persisted,
      at: timestamp
    });
    return persisted;
  }

  async function storeAssetBuffer(buffer, mediaType) {
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const extension = mediaExtension(mediaType);
    const relativePath = path.join("assets", sha256.slice(0, 2), `${sha256}${extension}`);
    const absolutePath = path.join(rootPath, relativePath);
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    if (!fs.existsSync(absolutePath)) {
      await fsp.writeFile(absolutePath, buffer);
    }
    return {
      relativePath: relativePath.split(path.sep).join("/"),
      sha256,
      byteSize: buffer.length
    };
  }

  async function assetFromDataUrl(dataUrl, mediaTypeHint = "") {
    const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      return null;
    }
    const mediaType = mediaTypeHint || match[1] || "application/octet-stream";
    const buffer = Buffer.from(match[2], "base64");
    const stored = await storeAssetBuffer(buffer, mediaType);
    return {
      mediaType,
      ...stored
    };
  }

  function appendMirrorChange({
    kind,
    action = "upsert",
    entityId = "",
    itemId = "",
    batchId = "",
    revision = 0,
    payload = {},
    at = nowIso()
  }) {
    insertSyncLogStmt.run(
      kind,
      action,
      String(entityId || ""),
      String(itemId || ""),
      String(batchId || ""),
      Number(revision || 0),
      at,
      stringifyJson(payload)
    );
  }

  function upsertHierarchyNode(node = {}) {
    const nodeType = String(node.nodeType || "").trim();
    const targetId = String(node.targetId || "").trim();
    if (!nodeType || !targetId) {
      return null;
    }
    const timestamp = node.updatedAt || nowIso();
    const id = hierarchyId(nodeType, targetId);
    const metadata = node.metadata || {};
    const record = {
      hierarchyId: id,
      nodeType,
      level: Number(node.level ?? hierarchyLevel(nodeType)),
      targetId,
      parentHierarchyId: node.parentHierarchyId || "",
      collectionId: node.collectionId || "",
      documentId: node.documentId || "",
      sectionId: node.sectionId || "",
      batchId: node.batchId || "",
      title: normalizeText(node.title || ""),
      summary: truncateText(node.summary || "", 1200),
      text: boundedIndexText([node.text || "", metadataIndexText(metadata)]),
      categoryPath: categoryPath(node.categoryPath || []),
      metadata,
      updatedAt: timestamp
    };
    upsertHierarchyNodeStmt.run(
      record.hierarchyId,
      record.nodeType,
      record.level,
      record.targetId,
      record.parentHierarchyId,
      record.collectionId,
      record.documentId,
      record.sectionId,
      record.batchId,
      record.title,
      record.summary,
      record.text,
      record.categoryPath,
      stringifyJson(record.metadata),
      record.updatedAt
    );
    deleteHierarchyFtsStmt.run(record.hierarchyId);
    insertHierarchyFtsStmt.run(
      record.hierarchyId,
      record.title,
      record.summary,
      record.text,
      record.categoryPath,
      stringifyJson(record.metadata)
    );
    return record;
  }

  function outlineParentHierarchyId(node = {}, document = {}) {
    const parentNodeType = String(node.parentNodeType || "").trim();
    const parentTargetId = String(node.parentTargetId || "").trim();
    if (parentNodeType && parentTargetId) {
      return hierarchyId(parentNodeType, parentTargetId);
    }
    return hierarchyId("document", document.documentId || node.documentId || "");
  }

  function sourceRangeFromMetadata(metadata = {}) {
    return metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata.sourceRange || {}
      : {};
  }

  function sourceRangeContainsPosition(range = {}, position = 0) {
    const blockStart = Number(range.blockStart || 0);
    const blockEnd = Number(range.blockEnd || 0);
    const current = Number(position || 0);
    return blockStart > 0 && blockEnd > 0 && current >= blockStart && current <= blockEnd;
  }

  function upsertCollectionHierarchyNode(collection = {}, documents = []) {
    return upsertHierarchyNode({
      nodeType: "collection",
      targetId: collection.collectionId || collection.collection_id,
      collectionId: collection.collectionId || collection.collection_id,
      title: collection.title,
      summary: collection.collectionType || collection.collection_type,
      text: documents.map((document) => `${document.title || ""}\n${document.summary || ""}`).join("\n"),
      categoryPath: [collection.collectionType || collection.collection_type, collection.title],
      metadata: collection.metadata || parseJson(collection.metadata_json, {})
    });
  }

  function buildDocumentHierarchy({ document = {}, sections = [], blocks = [], assets = [] } = {}) {
    const settings = getSettings();
    const indexBlocks = asArray(blocks).map((block) => ({
      ...block,
      text: searchableBlockText(block),
      snippet: searchableBlockSnippet(block)
    }));
    const outline = outlineRuntime.build({
      document,
      sections,
      blocks: indexBlocks,
      assets,
      settings: settings.retrieval || {}
    });
    const documentText = boundedIndexText([
      document.summary || "",
      sections.map((section) => section.title || "").join("\n"),
      indexBlocks.map((block) => `${block.title || ""}\n${block.snippet || block.text || ""}`).join("\n"),
      assets.map((asset) => `${asset.title || ""}\n${asset.caption || asset.ocrText || asset.text || ""}`).join("\n")
    ]);
    upsertHierarchyNode({
      nodeType: "document",
      targetId: document.documentId,
      parentHierarchyId: hierarchyId("collection", document.collectionId),
      collectionId: document.collectionId,
      documentId: document.documentId,
      batchId: document.batchId || "",
      title: document.title || "未命名知识文档",
      summary: document.summary || "",
      text: documentText,
      categoryPath: [
        document.collectionTitle || document.collectionId,
        document.documentType || "",
        document.metadata?.categories,
        document.metadata?.keywords,
        document.title || ""
      ],
      metadata: {
        ...(document.metadata || {}),
        sourceId: document.sourceId || "",
        sourceHash: document.sourceHash || "",
        outline: {
          protocolVersion: outline.protocolVersion,
          nodeCount: outline.nodeCount,
          syntheticNodeCount: outline.syntheticNodeCount,
          qualityFindings: outline.qualityFindings
        }
      }
    });
    for (const node of outline.nodes) {
      upsertHierarchyNode({
        ...node,
        parentHierarchyId: outlineParentHierarchyId(node, document),
        collectionId: document.collectionId,
        documentId: document.documentId,
        batchId: document.batchId || ""
      });
    }
    return outline;
  }

  function rebuildHierarchyIndex() {
    db.prepare("DELETE FROM kc_hierarchy_fts").run();
    db.prepare("DELETE FROM kc_hierarchy_nodes").run();
    const collections = db.prepare("SELECT * FROM kc_collections ORDER BY updated_at DESC").all();
    for (const collection of collections) {
      const documents = db.prepare("SELECT * FROM kc_documents WHERE collection_id = ? ORDER BY updated_at DESC LIMIT 30").all(collection.collection_id);
      upsertCollectionHierarchyNode({
        collectionId: collection.collection_id,
        title: collection.title,
        collectionType: collection.collection_type,
        metadata: parseJson(collection.metadata_json, {})
      }, documents);
    }
    const documents = db.prepare("SELECT * FROM kc_documents ORDER BY updated_at DESC").all();
    for (const row of documents) {
      const document = hydrateDocument(row);
      const sections = db.prepare("SELECT * FROM kc_sections WHERE document_id = ? ORDER BY position ASC").all(row.document_id).map(hydrateSection);
      const blocks = db.prepare("SELECT * FROM kc_blocks WHERE document_id = ? ORDER BY position ASC").all(row.document_id).map(hydrateBlock);
      const assets = db.prepare("SELECT * FROM kc_assets WHERE document_id = ? ORDER BY asset_id ASC").all(row.document_id).map(hydrateAsset);
      buildDocumentHierarchy({ document, sections, blocks, assets });
    }
    return {
      ok: true,
      nodeCount: countHierarchyNodesStmt.get()?.count || 0
    };
  }

  function ensureHierarchyIndexReady() {
    const nodeCount = Number(countHierarchyNodesStmt.get()?.count || 0);
    const documentCount = Number(db.prepare("SELECT COUNT(*) AS count FROM kc_documents").get()?.count || 0);
    if (documentCount > 0 && nodeCount === 0) {
      rebuildHierarchyIndex();
    }
  }

  function looksLikeHtml(value = "") {
    return looksLikeHtmlMarkup(value);
  }

  function searchableText(value = "", maxLength = 20000) {
    const raw = String(value || "");
    if (!raw) {
      return "";
    }
    return cleanVisibleIndexText(raw, maxLength);
  }

  function searchableBlockText(block = {}, maxLength = 20000) {
    return searchableText(block.text || block.snippet || "", maxLength);
  }

  function searchableBlockSnippet(block = {}) {
    return searchableText(block.snippet || "", 1400) ||
      searchableText(block.text || "", 1400) ||
      truncateText(block.text || "");
  }

  function rebuildSearchIndexes() {
    db.prepare("DELETE FROM kc_blocks_fts").run();
    db.prepare("DELETE FROM kc_assets_fts").run();
    const blocks = db.prepare("SELECT * FROM kc_blocks ORDER BY block_id ASC").all();
    const assets = db.prepare("SELECT * FROM kc_assets ORDER BY asset_id ASC").all();
    for (const block of blocks) {
      insertBlockFtsStmt.run(
        block.block_id,
        block.title || "",
        searchableBlockText(hydrateBlock(block)),
        searchableBlockSnippet(hydrateBlock(block)),
        block.metadata_json || "{}"
      );
    }
    for (const asset of assets) {
      insertAssetFtsStmt.run(
        asset.asset_id,
        asset.title || "",
        searchableText(asset.text || "", 12000),
        searchableText(asset.ocr_text || "", 12000),
        searchableText(asset.caption || "", 12000),
        asset.metadata_json || "{}"
      );
    }
    return {
      blockFtsRows: blocks.length,
      assetFtsRows: assets.length
    };
  }

  function insertBlock(block) {
    const timestamp = nowIso();
    const indexText = searchableBlockText(block);
    const indexSnippet = searchableBlockSnippet(block);
    insertBlockStmt.run(
      block.blockId,
      block.documentId,
      block.sectionId || "",
      block.blockType || "text",
      block.title || "",
      block.text || "",
      block.snippet || truncateText(block.text || ""),
      Number(block.position || 0),
      stringifyJson(block.sourceLocator),
      stringifyJson(block.metadata),
      timestamp,
      timestamp
    );
    insertBlockFtsStmt.run(
      block.blockId,
      block.title || "",
      indexText,
      indexSnippet,
      stringifyJson(block.metadata)
    );
    const embeddingInput = [block.title, indexText, indexSnippet].filter(Boolean).join("\n");
    const embedding = embeddingRuntime.embedText(embeddingInput);
    vectorStore.upsert({
      targetType: "block",
      targetId: block.blockId,
      ...embedding,
      contentHash: hashText(embeddingInput),
      metadata: {
        documentId: block.documentId,
        sectionId: block.sectionId || "",
        blockType: block.blockType || "text"
      }
    });
    appendMirrorChange({
      kind: "block",
      entityId: block.blockId,
      itemId: block.documentId,
      batchId: block.sourceLocator?.batchId || "",
      payload: {
        blockId: block.blockId,
        documentId: block.documentId,
        sectionId: block.sectionId || "",
        blockType: block.blockType || "text",
        title: block.title || "",
        text: block.text || "",
        snippet: block.snippet || truncateText(block.text || ""),
        position: Number(block.position || 0),
        sourceLocator: block.sourceLocator || {},
        metadata: block.metadata || {},
        updatedAt: timestamp
      },
      at: timestamp
    });
  }

  function insertAsset(asset) {
    const timestamp = nowIso();
    insertAssetStmt.run(
      asset.assetId,
      asset.documentId,
      asset.sectionId || "",
      asset.blockId || "",
      asset.assetType || "image",
      asset.mediaType || "",
      asset.title || "",
      asset.text || "",
      asset.ocrText || "",
      asset.caption || "",
      asset.relativePath || "",
      asset.sha256 || "",
      Number(asset.byteSize || 0),
      Number(asset.width || 0),
      Number(asset.height || 0),
      stringifyJson(asset.sourceLocator),
      stringifyJson(asset.metadata),
      timestamp,
      timestamp
    );
    insertAssetFtsStmt.run(
      asset.assetId,
      asset.title || "",
      asset.text || "",
      asset.ocrText || "",
      asset.caption || "",
      stringifyJson(asset.metadata)
    );
    const embedding = embeddingRuntime.embedImageEvidence(asset);
    vectorStore.upsert({
      targetType: "asset",
      targetId: asset.assetId,
      ...embedding,
      contentHash: hashText([asset.title, asset.caption, asset.ocrText, asset.sha256].join("\n")),
      metadata: {
        documentId: asset.documentId,
        sectionId: asset.sectionId || "",
        assetType: asset.assetType || "image"
      }
    });
    appendMirrorChange({
      kind: "asset",
      entityId: asset.assetId,
      itemId: asset.documentId,
      batchId: asset.sourceLocator?.batchId || "",
      payload: {
        assetId: asset.assetId,
        documentId: asset.documentId,
        sectionId: asset.sectionId || "",
        blockId: asset.blockId || "",
        assetType: asset.assetType || "image",
        mediaType: asset.mediaType || "",
        title: asset.title || "",
        text: asset.text || "",
        ocrText: asset.ocrText || "",
        caption: asset.caption || "",
        sha256: asset.sha256 || "",
        byteSize: Number(asset.byteSize || 0),
        width: Number(asset.width || 0),
        height: Number(asset.height || 0),
        sourceLocator: asset.sourceLocator || {},
        metadata: asset.metadata || {},
        updatedAt: timestamp
      },
      at: timestamp
    });
  }

  function deleteKnowledgeDocumentsById(documentIds = []) {
    const ids = asArray(documentIds).map((item) => String(item || "").trim()).filter(Boolean);
    if (ids.length === 0) {
      return;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const blockRows = db.prepare(`
      SELECT block_id FROM kc_blocks WHERE document_id IN (${placeholders})
    `).all(...ids);
    const assetRows = db.prepare(`
      SELECT asset_id FROM kc_assets WHERE document_id IN (${placeholders})
    `).all(...ids);
    deleteVectorTargetsByIds([
      ...blockRows.map((row) => row.block_id),
      ...assetRows.map((row) => row.asset_id)
    ]);
    db.prepare(`
      DELETE FROM kc_evidence_packs
      WHERE document_id IN (${placeholders})
    `).run(...ids);
    db.prepare(`
      DELETE FROM kc_embeddings
      WHERE target_id IN (SELECT block_id FROM kc_blocks WHERE document_id IN (${placeholders}))
    `).run(...ids);
    db.prepare(`
      DELETE FROM kc_embeddings
      WHERE target_id IN (SELECT asset_id FROM kc_assets WHERE document_id IN (${placeholders}))
    `).run(...ids);
    db.prepare(`
      DELETE FROM kc_blocks_fts
      WHERE block_id IN (SELECT block_id FROM kc_blocks WHERE document_id IN (${placeholders}))
    `).run(...ids);
    db.prepare(`
      DELETE FROM kc_assets_fts
      WHERE asset_id IN (SELECT asset_id FROM kc_assets WHERE document_id IN (${placeholders}))
    `).run(...ids);
    db.prepare(`
      DELETE FROM kc_hierarchy_fts
      WHERE hierarchy_id IN (
        SELECT hierarchy_id FROM kc_hierarchy_nodes WHERE document_id IN (${placeholders})
      )
    `).run(...ids);
    db.prepare(`
      DELETE FROM kc_hierarchy_nodes
      WHERE document_id IN (${placeholders})
    `).run(...ids);
    db.prepare(`DELETE FROM kc_assets WHERE document_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM kc_blocks WHERE document_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM kc_sections WHERE document_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM kc_documents WHERE document_id IN (${placeholders})`).run(...ids);
  }

  function upsertKnowledgeDocument(document) {
    deleteKnowledgeDocumentsById([document.documentId]);
    const timestamp = nowIso();
    upsertCollectionStmt.run(
      document.collectionId,
      document.collectionTitle || document.collectionId,
      document.collectionType || "batch",
      stringifyJson(document.collectionMetadata),
      timestamp,
      timestamp
    );
    insertDocumentStmt.run(
      document.documentId,
      document.collectionId,
      document.batchId || "",
      document.sourceId || "",
      document.documentType || "",
      document.title || "未命名知识文档",
      document.summary || "",
      document.sourcePath || "",
      document.sourceHash || "",
      stringifyJson(document.metadata),
      timestamp,
      timestamp
    );
    appendMirrorChange({
      kind: "document",
      entityId: document.documentId,
      itemId: document.documentId,
      batchId: document.batchId || "",
      payload: {
        documentId: document.documentId,
        collectionId: document.collectionId,
        batchId: document.batchId || "",
        sourceId: document.sourceId || "",
        documentType: document.documentType || "",
        itemType: document.documentType || "",
        title: document.title || "未命名知识文档",
        summary: document.summary || "",
        sourcePath: document.sourcePath || "",
        sourceHash: document.sourceHash || "",
        metadata: document.metadata || {},
        createdAt: timestamp,
        updatedAt: timestamp
      },
      at: timestamp
    });
    for (const section of document.sections || []) {
      insertSectionStmt.run(
        section.sectionId,
        document.documentId,
        section.title || document.title || "正文",
        Number(section.level || 1),
        Number(section.position || 0),
        stringifyJson(section.metadata)
      );
      appendMirrorChange({
        kind: "section",
        entityId: section.sectionId,
        itemId: document.documentId,
        batchId: document.batchId || "",
        payload: {
          sectionId: section.sectionId,
          documentId: document.documentId,
          title: section.title || document.title || "正文",
          level: Number(section.level || 1),
          position: Number(section.position || 0),
          metadata: section.metadata || {},
          updatedAt: timestamp
        },
        at: timestamp
      });
    }
    for (const block of document.blocks || []) {
      insertBlock(block);
    }
    for (const asset of document.assets || []) {
      insertAsset(asset);
    }
    upsertCollectionHierarchyNode({
      collectionId: document.collectionId,
      title: document.collectionTitle || document.collectionId,
      collectionType: document.collectionType || "collection",
      metadata: document.collectionMetadata || {}
    }, [document]);
    buildDocumentHierarchy({
      document,
      sections: asArray(document.sections),
      blocks: asArray(document.blocks),
      assets: asArray(document.assets)
    });
  }

  function buildSourceDocument(source, batchId, generatedAt) {
    const text = normalizeText(source.text || "");
    const contentHash = sourceContentHash(source, text);
    const sourceKey = canonicalSourceKey(source, text);
    const documentId = documentIdForSource(source, text);
    const sectionId = stableId("section", documentId, "source");
    const blockId = stableId("block", documentId, "body");
    const sourcePath = source.path || source.originalRelativePath || source.rawObject?.originalRelativePath || "";
    const visibleText = searchableText(text, 20000);
    const unifiedSource = compactObject({
      clientUid: source.clientUid || source.rawObject?.clientUid || "",
      sourceType: source.sourceType || source.rawObject?.sourceType || source.kind || "",
      providerId: source.providerId || source.rawObject?.providerId || "",
      externalId: source.externalId || source.rawObject?.externalId || "",
      syncBatchId: source.syncBatchId || source.rawObject?.syncBatchId || "",
      originalFileName: source.originalFileName || source.rawObject?.originalFileName || "",
      originalRelativePath: source.originalRelativePath || source.rawObject?.originalRelativePath || "",
      contentHash: source.contentHash || source.rawObject?.contentHash || contentHash,
      capturedAt: source.capturedAt || source.rawObject?.capturedAt || source.sourceCollectedAt || generatedAt || "",
      rawObjectId: source.rawObjectId || source.rawObject?.objectId || "",
      storageRelativePath: source.storageRelativePath || source.rawObject?.storageRelativePath || "",
      metadata: source.sourceMetadata || source.rawObject?.sourceMetadata || {}
    });
    const blocks = [];
    if (text) {
      blocks.push({
        blockId,
        documentId,
        sectionId,
        blockType: source.kind === "image" ? "mixed" : "text",
        title: source.name || "来源正文",
        text,
        snippet: truncateText(visibleText || text),
        position: 1,
        sourceLocator: {
          batchId,
          sourceId: source.id || "",
          sourcePath,
          sourceKind: source.kind || "",
          ...unifiedSource
        },
        metadata: {
          parserId: source.documentParserId || "",
          mediaType: source.mediaType || "",
          createdAt: source.sourceCreatedAt || "",
          updatedAt: source.sourceUpdatedAt || "",
          collectedAt: source.sourceCollectedAt || generatedAt || "",
          unifiedSource
        }
      });
    }
    for (const [index, embedded] of asArray(source.embeddedDocuments).entries()) {
      const embeddedText = normalizeText(embedded.text || "");
      if (!embeddedText) continue;
      blocks.push({
        blockId: stableId("block", documentId, "embedded", embedded.id || index),
        documentId,
        sectionId,
        blockType: "attachment",
        title: embedded.metadata?.resourceName || embedded.id || `嵌入内容 ${index + 1}`,
        text: embeddedText,
        snippet: truncateText(embeddedText),
        position: 20 + index,
        sourceLocator: {
          batchId,
          sourceId: source.id || "",
          embeddedId: embedded.id || ""
        },
        metadata: embedded.metadata || {}
      });
    }
    return {
      documentId,
      collectionId: `batch::${batchId}`,
      collectionTitle: `Job ${batchId}`,
      collectionType: "job",
      batchId,
      sourceId: source.id || "",
      documentType: source.kind || "source",
      title: source.name || sourcePath || "来源文档",
      summary: truncateText(visibleText || text || `${source.kind || "source"} ${source.name || ""}`),
      sourcePath,
      sourceHash: contentHash,
      metadata: compactObject({
        source: "sourceFiles",
        canonicalSourceKey: sourceKey,
        unifiedSource,
        clientUid: unifiedSource.clientUid || "",
        sourceType: unifiedSource.sourceType || "",
        providerId: unifiedSource.providerId || "",
        externalId: unifiedSource.externalId || "",
        syncBatchId: unifiedSource.syncBatchId || "",
        contentHash: unifiedSource.contentHash || "",
        capturedAt: unifiedSource.capturedAt || "",
        mediaType: source.mediaType || "",
        rawObjectId: source.rawObjectId || source.rawObject?.objectId || "",
        rawObjectSha256: contentHash,
        originalFileName: source.originalFileName || source.rawObject?.originalFileName || "",
        originalRelativePath:
          source.originalRelativePath || source.rawObject?.originalRelativePath || ""
      }),
      sections: [
        {
          sectionId,
          documentId,
          title: source.name || "来源文档",
          level: 1,
          position: 1,
          metadata: {
            sourceKind: source.kind || ""
          }
        }
      ],
      blocks,
      assets: []
    };
  }

  function buildTransactionDocument(transaction, result, batchId) {
    const documentId = stableId("document", batchId, "transaction", transaction.id);
    const sectionId = stableId("section", documentId, "overview");
    const relatedEmails = asArray(result.emails).filter((email) =>
      asArray(transaction.messageIds).includes(email.id)
    );
    const timelineItems = asArray(result.timeline).filter((event) =>
      asArray(transaction.timelineEventIds).includes(event.id) ||
      event.transactionId === transaction.id
    );
    const body = [
      `事务：${transaction.title || transaction.id}`,
      transaction.summary ? `概述：${transaction.summary}` : "",
      transaction.status ? `状态：${transaction.status}` : "",
      transaction.cadence ? `节奏：${transaction.cadence}` : "",
      asArray(transaction.categories).length ? `分类：${transaction.categories.join("、")}` : "",
      asArray(transaction.keywords).length ? `关键词：${transaction.keywords.join("、")}` : "",
      asArray(transaction.decisions).length ? `决策：${transaction.decisions.join("；")}` : "",
      asArray(transaction.pendingItems).length ? `待办：${transaction.pendingItems.join("；")}` : "",
      timelineItems.length
        ? `时间线：\n${timelineItems.map((event) => `- ${event.timestamp || ""} ${event.title || ""} ${event.summary || ""}`).join("\n")}`
        : "",
      relatedEmails.length
        ? `关联邮件：\n${relatedEmails.map((email) => `- ${email.sentAt || ""} ${email.subject || ""}: ${email.excerpt || ""}`).join("\n")}`
        : ""
    ].filter(Boolean).join("\n\n");
    return {
      documentId,
      collectionId: `batch::${batchId}`,
      collectionTitle: `Job ${batchId}`,
      collectionType: "job",
      batchId,
      sourceId: transaction.id || "",
      documentType: "transaction",
      title: transaction.title || "未命名事务",
      summary: transaction.summary || "",
      sourcePath: "",
      sourceHash: "",
      metadata: compactObject({
        source: "analysis.transaction",
        startedAt: transaction.startedAt || "",
        latestActivityAt: transaction.latestActivityAt || "",
        lineageId: transaction.lineageId || "",
        participantIds: transaction.participantIds || [],
        threadIds: transaction.threadIds || [],
        messageIds: transaction.messageIds || []
      }),
      sections: [
        {
          sectionId,
          documentId,
          title: "事务概览",
          level: 1,
          position: 1,
          metadata: {}
        }
      ],
      blocks: [
        {
          blockId: stableId("block", documentId, "overview"),
          documentId,
          sectionId,
          blockType: "event",
          title: transaction.title || "事务概览",
          text: body,
          snippet: truncateText(body),
          position: 1,
          sourceLocator: {
            batchId,
            transactionId: transaction.id || ""
          },
          metadata: {
            categories: transaction.categories || [],
            keywords: transaction.keywords || []
          }
        }
      ],
      assets: []
    };
  }

  function buildMessageDocument(message, batchId) {
    const documentId = stableId("document", batchId, "message", message.id);
    const sectionId = stableId("section", documentId, "message");
    const body = [
      `主题：${message.subject || ""}`,
      message.sentAt ? `时间：${message.sentAt}` : "",
      message.excerpt ? `摘要：${message.excerpt}` : "",
      message.body || ""
    ].filter(Boolean).join("\n\n");
    return {
      documentId,
      collectionId: `batch::${batchId}`,
      collectionTitle: `Job ${batchId}`,
      collectionType: "job",
      batchId,
      sourceId: message.id || "",
      documentType: "message",
      title: message.subject || "未命名邮件",
      summary: message.excerpt || "",
      sourcePath: message.sourceId || "",
      sourceHash: "",
      metadata: compactObject({
        source: "analysis.message",
        sentAt: message.sentAt || "",
        threadId: message.threadId || "",
        transactionId: message.transactionId || "",
        rawObjectId: message.rawObjectId || "",
        participantIds: message.participantIds || []
      }),
      sections: [
        {
          sectionId,
          documentId,
          title: "邮件正文",
          level: 1,
          position: 1,
          metadata: {}
        }
      ],
      blocks: [
        {
          blockId: stableId("block", documentId, "body"),
          documentId,
          sectionId,
          blockType: "event",
          title: message.subject || "邮件正文",
          text: body,
          snippet: truncateText(body),
          position: 1,
          sourceLocator: {
            batchId,
            messageId: message.id || "",
            rawObjectId: message.rawObjectId || ""
          },
          metadata: {
            keywords: message.keywords || []
          }
        }
      ],
      assets: []
    };
  }

  function buildNormalizedDocument(manifestEntry, batchId) {
    const documentId = stableId("document", batchId, "normalized", manifestEntry.documentId || manifestEntry.relativePath);
    const sectionId = stableId("section", documentId, "manifest");
    const text = [
      `归一化文档：${manifestEntry.title || manifestEntry.documentId || ""}`,
      `粒度：${manifestEntry.granularity || ""}`,
      `适配器：${manifestEntry.adapterId || ""}`,
      `路径：${manifestEntry.relativePath || ""}`,
      asArray(manifestEntry.warnings).length ? `风险提示：${manifestEntry.warnings.join("；")}` : ""
    ].filter(Boolean).join("\n");
    return {
      documentId,
      collectionId: `batch::${batchId}`,
      collectionTitle: `Job ${batchId}`,
      collectionType: "job",
      batchId,
      sourceId: manifestEntry.sourceId || "",
      documentType: "normalized-docx",
      title: manifestEntry.title || manifestEntry.documentId || "归一化 DOCX",
      summary: truncateText(text),
      sourcePath: manifestEntry.relativePath || "",
      sourceHash: manifestEntry.sha256 || "",
      metadata: {
        source: "normalizedDocuments.manifest",
        adapterId: manifestEntry.adapterId || "",
        granularity: manifestEntry.granularity || "",
        sourceMaterialRelativePath: manifestEntry.sourceMaterialRelativePath || "",
        warnings: manifestEntry.warnings || []
      },
      sections: [
        {
          sectionId,
          documentId,
          title: "归一化文档元数据",
          level: 1,
          position: 1,
          metadata: {}
        }
      ],
      blocks: [
        {
          blockId: stableId("block", documentId, "manifest"),
          documentId,
          sectionId,
          blockType: "attachment",
          title: manifestEntry.title || "归一化文档元数据",
          text,
          snippet: truncateText(text),
          position: 1,
          sourceLocator: {
            batchId,
            normalizedDocumentId: manifestEntry.documentId || "",
            relativePath: manifestEntry.relativePath || ""
          },
          metadata: manifestEntry
        }
      ],
      assets: []
    };
  }

  async function documentsFromBatch({ batchId, result = {} }) {
    const generatedAt = result.generatedAt || nowIso();
    const documents = [];
    for (const source of asArray(result.sourceFiles)) {
      const document = buildSourceDocument(source, batchId, generatedAt);
      const visualElements = asArray(source.visualElements)
        .filter((entry) => ["image", "table"].includes(String(entry?.kind || "")))
        .sort((a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0));
      if (source.imageDataUrl) {
        const storedAsset = await assetFromDataUrl(source.imageDataUrl, source.mediaType || "");
        if (storedAsset) {
          const assetBlockId = stableId("block", document.documentId, "image-asset");
          const imageText = [
            `图片：${source.name || source.path || ""}`,
            source.text ? `OCR/说明：${source.text}` : "OCR/说明：当前图片没有可用 OCR 文本，召回将依赖文件名、来源和图片资产元数据。"
          ].join("\n");
          if (!document.blocks.some((block) => block.blockId === assetBlockId)) {
            document.blocks.push({
              blockId: assetBlockId,
              documentId: document.documentId,
              sectionId: document.sections[0].sectionId,
              blockType: "image",
              title: source.name || "图片资产",
              text: imageText,
              snippet: truncateText(imageText),
              position: 5,
              sourceLocator: {
                batchId,
                sourceId: source.id || "",
                sourcePath: source.path || ""
              },
              metadata: {
                mediaType: source.mediaType || "",
                visualRisk: source.text ? "" : "missing-ocr-or-caption"
              }
            });
          }
          document.assets.push({
            assetId: stableId("asset", document.documentId, storedAsset.sha256),
            documentId: document.documentId,
            sectionId: document.sections[0].sectionId,
            blockId: assetBlockId,
            assetType: "image",
            mediaType: storedAsset.mediaType,
            title: source.name || "图片资产",
            text: imageText,
            ocrText: source.text || "",
            caption: source.text ? truncateText(source.text, 180) : `${source.name || "图片"}，缺少 OCR/视觉说明。`,
            relativePath: storedAsset.relativePath,
            sha256: storedAsset.sha256,
            byteSize: storedAsset.byteSize,
            sourceLocator: {
              batchId,
              sourceId: source.id || "",
              sourcePath: source.path || ""
            },
            metadata: {
              originalRelativePath: source.originalRelativePath || "",
              rawObjectSha256: source.rawObjectSha256 || ""
            }
          });
        }
      }
      for (const element of visualElements) {
        const sequence = Number(element.sequence || 0);
        const page = Number(element.page || 0);
        const index = Number(element.index || 0);
        const position = 100 + sequence;
        if (element.kind === "table") {
          const rows = asArray(element.rows).map((row) => asArray(row).map((cell) => String(cell ?? "")));
          const tableText = normalizeText(
            [
              `表格：${element.title || `Table ${sequence || index}`}`,
              page ? `页码：${page}` : "",
              element.markdown || element.text || rows.map((row) => row.join(" | ")).join("\n")
            ].filter(Boolean).join("\n")
          );
          if (!tableText) {
            continue;
          }
          document.blocks.push({
            blockId: stableId("block", document.documentId, "visual-table", sequence || index),
            documentId: document.documentId,
            sectionId: document.sections[0].sectionId,
            blockType: "table",
            title: element.title || `表格 ${sequence || index}`,
            text: tableText,
            snippet: truncateText(tableText),
            position,
            sourceLocator: {
              batchId,
              sourceId: source.id || "",
              sourcePath: source.path || "",
              page,
              tableIndex: index,
              visualSequence: sequence
            },
            metadata: {
              page,
              tableIndex: index,
              visualSequence: sequence,
              rowCount: Number(element.rowCount || rows.length || 0),
              columnCount: Number(element.columnCount || rows.reduce((max, row) => Math.max(max, row.length), 0)),
              rows,
              bbox: element.bbox || [],
              extractionMethod: element.extractionMethod || ""
            }
          });
          continue;
        }

        if (element.kind === "image") {
          const storedAsset = await assetFromDataUrl(element.imageDataUrl || element.dataUrl || "", element.mediaType || "");
          if (!storedAsset) {
            continue;
          }
          const assetBlockId = stableId("block", document.documentId, "visual-image", sequence || index);
          const imageText = [
            `图片：${element.title || `Image ${sequence || index}`}`,
            page ? `页码：${page}` : "",
            element.width || element.height ? `尺寸：${element.width || 0}x${element.height || 0}` : "",
            "说明：PDF 内嵌图片，已按页面顺序提取为知识资产。"
          ].filter(Boolean).join("\n");
          document.blocks.push({
            blockId: assetBlockId,
            documentId: document.documentId,
            sectionId: document.sections[0].sectionId,
            blockType: "image",
            title: element.title || `图片 ${sequence || index}`,
            text: imageText,
            snippet: truncateText(imageText),
            position,
            sourceLocator: {
              batchId,
              sourceId: source.id || "",
              sourcePath: source.path || "",
              page,
              imageIndex: index,
              visualSequence: sequence
            },
            metadata: {
              mediaType: storedAsset.mediaType,
              page,
              imageIndex: index,
              visualSequence: sequence,
              width: Number(element.width || 0),
              height: Number(element.height || 0),
              bbox: element.bbox || [],
              extractionMethod: element.extractionMethod || ""
            }
          });
          document.assets.push({
            assetId: stableId("asset", document.documentId, "visual-image", sequence || index, storedAsset.sha256),
            documentId: document.documentId,
            sectionId: document.sections[0].sectionId,
            blockId: assetBlockId,
            assetType: "image",
            mediaType: storedAsset.mediaType,
            title: element.title || `图片 ${sequence || index}`,
            text: imageText,
            ocrText: "",
            caption: `PDF 第 ${page || "未知"} 页图片 ${index || sequence || ""}`.trim(),
            relativePath: storedAsset.relativePath,
            sha256: storedAsset.sha256,
            byteSize: storedAsset.byteSize,
            width: Number(element.width || 0),
            height: Number(element.height || 0),
            sourceLocator: {
              batchId,
              sourceId: source.id || "",
              sourcePath: source.path || "",
              page,
              imageIndex: index,
              visualSequence: sequence
            },
            metadata: {
              originalRelativePath: source.originalRelativePath || "",
              rawObjectSha256: source.rawObjectSha256 || "",
              bbox: element.bbox || [],
              extractionMethod: element.extractionMethod || ""
            }
          });
        }
      }
      documents.push(document);
    }
    for (const transaction of asArray(result.transactions)) {
      documents.push(buildTransactionDocument(transaction, result, batchId));
    }
    for (const message of asArray(result.emails)) {
      documents.push(buildMessageDocument(message, batchId));
    }
    for (const entry of asArray(result.normalizedDocuments?.documents)) {
      documents.push(buildNormalizedDocument(entry, batchId));
    }
    return documents;
  }

  function sourceHashForDocument(document = {}) {
    const metadata = document.metadata || {};
    return normalizeText(document.sourceHash || metadata.rawObjectSha256 || "").toLowerCase();
  }

  function sourceHashForRow(row = {}) {
    const metadata = parseJson(row.metadata_json, {});
    return normalizeText(row.source_hash || metadata.rawObjectSha256 || "").toLowerCase();
  }

  function sourcePathKeyForDocument(document = {}) {
    const metadata = document.metadata || {};
    return normalizeSourcePathKey(
      metadata.originalRelativePath ||
        document.sourcePath ||
        document.sourceId ||
        document.title ||
        ""
    );
  }

  function sourcePathKeyForRow(row = {}) {
    const metadata = parseJson(row.metadata_json, {});
    return normalizeSourcePathKey(
      metadata.originalRelativePath ||
        row.source_path ||
        row.source_id ||
        row.title ||
        ""
    );
  }

  function knowledgeDocumentDedupKey(document = {}) {
    const sourceHash = sourceHashForDocument(document);
    if (sourceHash) {
      return `hash:${sourceHash}`;
    }
    const metadata = document.metadata || {};
    const canonicalKey = normalizeText(metadata.canonicalSourceKey || "");
    if (canonicalKey) {
      return canonicalKey;
    }
    const sourcePath = sourcePathKeyForDocument(document);
    return sourcePath ? `path:${sourcePath}` : "";
  }

  function preferredDocument(left, right) {
    if (!left) {
      return right;
    }
    const leftPath = normalizeText(left.metadata?.originalRelativePath || left.sourcePath || left.title || "");
    const rightPath = normalizeText(right.metadata?.originalRelativePath || right.sourcePath || right.title || "");
    const duplicateSuffix = /\s+\d+\.eml$/i;
    const leftPenalty = duplicateSuffix.test(leftPath) ? 1 : 0;
    const rightPenalty = duplicateSuffix.test(rightPath) ? 1 : 0;
    if (leftPenalty !== rightPenalty) {
      return leftPenalty < rightPenalty ? left : right;
    }
    if (leftPath.length !== rightPath.length) {
      return leftPath.length <= rightPath.length ? left : right;
    }
    return right;
  }

  function dedupeIncomingDocuments(documents = []) {
    const byKey = new Map();
    const passthrough = [];
    for (const document of documents) {
      const key = knowledgeDocumentDedupKey(document);
      if (!key) {
        passthrough.push(document);
        continue;
      }
      byKey.set(key, preferredDocument(byKey.get(key), document));
    }
    const deduped = [];
    const duplicateGroups = [];
    for (const [key, groupValue] of byKey.entries()) {
      const group = asArray(documents).filter((document) => knowledgeDocumentDedupKey(document) === key);
      const keep = groupValue;
      deduped.push(keep);
      const duplicates = group.filter((document) => document !== keep);
      if (duplicates.length > 0) {
        duplicateGroups.push({
          key,
          keep,
          duplicates
        });
      }
    }
    return {
      documents: [...passthrough, ...deduped],
      duplicateGroups
    };
  }

  function compactReviewDocument(document = {}) {
    return {
      documentId: document.documentId || "",
      collectionId: document.collectionId || "",
      batchId: document.batchId || "",
      sourceId: document.sourceId || "",
      documentType: document.documentType || "",
      title: document.title || "",
      summary: truncateText(document.summary || "", 520),
      sourcePath: document.sourcePath || "",
      sourceHash: document.sourceHash || "",
      metadata: document.metadata || {},
      sectionCount: asArray(document.sections).length,
      blockCount: asArray(document.blocks).length,
      assetCount: asArray(document.assets).length,
      textPreview: truncateText(
        asArray(document.blocks)
          .map((block) => searchableBlockSnippet(block) || searchableBlockText(block))
          .filter(Boolean)
          .join("\n"),
        900
      )
    };
  }

  function reviewDocumentFromRow(row = {}) {
    const metadata = parseJson(row.metadata_json, {});
    return {
      documentId: row.document_id || "",
      collectionId: row.collection_id || "",
      batchId: row.batch_id || "",
      sourceId: row.source_id || "",
      documentType: row.document_type || "",
      title: row.title || "",
      summary: truncateText(row.summary || "", 520),
      sourcePath: row.source_path || "",
      sourceHash: row.source_hash || "",
      metadata,
      updatedAt: row.updated_at || "",
      createdAt: row.created_at || ""
    };
  }

  function sourceConflictRowsForDocument(document = {}) {
    const documentId = String(document.documentId || "");
    const incomingHash = sourceHashForDocument(document);
    const incomingPathKey = sourcePathKeyForDocument(document);
    if (!incomingHash && !incomingPathKey) {
      return [];
    }
    const sameIdRow = documentId ? selectDocumentConflictRowStmt.get(documentId) : null;
    const sameIdRows = [];
    if (sameIdRow) {
      const rowHash = sourceHashForRow(sameIdRow);
      const rowPathKey = sourcePathKeyForRow(sameIdRow);
      const hashMatches = incomingHash && rowHash && rowHash === incomingHash;
      const pathMatches = incomingPathKey && rowPathKey && rowPathKey === incomingPathKey;
      const sameKnownSource =
        (!incomingHash || !rowHash || hashMatches) &&
        (!incomingPathKey || !rowPathKey || pathMatches);
      if (!sameKnownSource) {
        sameIdRows.push(sameIdRow);
      }
    }
    return db.prepare(`
      SELECT document_id, collection_id, batch_id, source_id, document_type, title,
             summary, source_path, source_hash, metadata_json, created_at, updated_at
      FROM kc_documents
      WHERE document_id != ?
    `).all(documentId).filter((row) => {
      const rowHash = sourceHashForRow(row);
      const rowPathKey = sourcePathKeyForRow(row);
      return (
        (incomingHash && rowHash && rowHash === incomingHash) ||
        (incomingPathKey && rowPathKey && rowPathKey === incomingPathKey)
      );
    }).concat(sameIdRows);
  }

  function ingestConflictReason({ document, rows }) {
    const incomingHash = sourceHashForDocument(document);
    const incomingPathKey = sourcePathKeyForDocument(document);
    const samePathDifferentContent = rows.filter((row) => {
      const rowPathKey = sourcePathKeyForRow(row);
      const rowHash = sourceHashForRow(row);
      return incomingPathKey && rowPathKey === incomingPathKey && rowHash !== incomingHash;
    });
    if (samePathDifferentContent.length > 0) {
      return {
        reason: "source_path_content_conflict",
        severity: "high",
        rows: samePathDifferentContent,
        summary: "同一个来源路径已经存在不同内容。为避免覆盖旧知识，需要人工决定采用新版本、保留两份或忽略本次录入。"
      };
    }
    const sameContentRows = rows.filter((row) => {
      const rowHash = sourceHashForRow(row);
      return incomingHash && rowHash === incomingHash;
    });
    if (sameContentRows.length > 0) {
      return {
        reason: "duplicate_source_document",
        severity: "medium",
        rows: sameContentRows,
        summary: "新录入内容与已有知识来源内容相同。系统暂不重复入库，等待人工确认是否仍要保留两份。"
      };
    }
    return null;
  }

  function recordIngestConflict({ document, conflict, timestamp = nowIso() }) {
    const currentDocuments = conflict.rows.map(reviewDocumentFromRow);
    const currentIds = currentDocuments.map((item) => item.documentId).filter(Boolean);
    const reviewId = stableId(
      "kc-review",
      "ingest",
      conflict.reason,
      sourcePathKeyForDocument(document),
      sourceHashForDocument(document),
      currentIds.join("|")
    );
    const existing = hydrateReviewItem(selectReviewItemStmt.get(reviewId));
    if (existing && existing.status !== "pending") {
      return existing;
    }
    const incomingDocument = compactReviewDocument(document);
    const currentRecord = {
      kind: "knowledge-ingest-conflict",
      documents: currentDocuments,
      recommendedActions:
        conflict.reason === "source_path_content_conflict"
          ? ["replace", "merge", "keep_both", "reject"]
          : ["merge", "keep_both", "reject"]
    };
    const incomingRecord = {
      document: incomingDocument,
      documentSnapshot: document
    };
    const evidenceRefs = [
      ...currentDocuments.map((item) => ({
        kind: "document",
        documentId: item.documentId,
        batchId: item.batchId,
        sourcePath: item.sourcePath,
        sourceHash: item.sourceHash
      })),
      {
        kind: "incomingDocument",
        documentId: incomingDocument.documentId,
        batchId: incomingDocument.batchId,
        sourcePath: incomingDocument.sourcePath,
        sourceHash: incomingDocument.sourceHash
      }
    ];
    upsertReviewItemStmt.run(
      reviewId,
      "knowledge-core",
      "pending",
      conflict.reason,
      conflict.severity,
      stableId("operation", "knowledge-ingest", reviewId),
      document.batchId || "",
      document.documentId || "",
      "document",
      `录入冲突：${document.title || document.sourcePath || document.documentId || "未命名文档"}`,
      conflict.summary,
      stringifyJson(currentRecord),
      stringifyJson(incomingRecord),
      stringifyJson(evidenceRefs, []),
      existing?.createdAt || timestamp,
      timestamp,
      "",
      "{}"
    );
    const reviewItem = hydrateReviewItem(selectReviewItemStmt.get(reviewId));
    appendMirrorChange({
      kind: "reviewItem",
      action: "upsert",
      entityId: reviewItem.reviewId,
      itemId: reviewItem.entityId,
      batchId: reviewItem.batchId || "",
      payload: reviewItem,
      at: timestamp
    });
    return reviewItem;
  }

  function recordIncomingDuplicateReviewItem({ key = "", keep = {}, duplicate = {}, timestamp = nowIso() } = {}) {
    const reviewId = stableId(
      "kc-review",
      "incoming-duplicate",
      key,
      keep.documentId || "",
      duplicate.documentId || "",
      sourcePathKeyForDocument(duplicate),
      sourceHashForDocument(duplicate)
    );
    const existing = hydrateReviewItem(selectReviewItemStmt.get(reviewId));
    if (existing && existing.status !== "pending") {
      return existing;
    }
    const keptDocument = compactReviewDocument(keep);
    const duplicateDocument = compactReviewDocument(duplicate);
    const currentRecord = {
      kind: "knowledge-ingest-deduplication",
      duplicateKey: key,
      documents: [keptDocument],
      recommendedActions: ["merge", "keep_both", "reject"]
    };
    const incomingRecord = {
      document: duplicateDocument,
      documentSnapshot: duplicate,
      duplicateKey: key
    };
    const evidenceRefs = [
      {
        kind: "keptIncomingDocument",
        documentId: keptDocument.documentId,
        batchId: keptDocument.batchId,
        sourcePath: keptDocument.sourcePath,
        sourceHash: keptDocument.sourceHash
      },
      {
        kind: "deduplicatedIncomingDocument",
        documentId: duplicateDocument.documentId,
        batchId: duplicateDocument.batchId,
        sourcePath: duplicateDocument.sourcePath,
        sourceHash: duplicateDocument.sourceHash
      }
    ];
    upsertReviewItemStmt.run(
      reviewId,
      "knowledge-core",
      "pending",
      "duplicate_source_document",
      "medium",
      stableId("operation", "knowledge-deduplication", reviewId),
      duplicate.batchId || keep.batchId || "",
      duplicate.documentId || "",
      "document",
      `重复来源：${duplicate.title || duplicate.sourcePath || duplicate.documentId || "未命名文档"}`,
      "同一批录入中存在重复来源内容。系统默认只入库一份，重复项已进入审核队列，可由人工决定保留两份或忽略。",
      stringifyJson(currentRecord),
      stringifyJson(incomingRecord),
      stringifyJson(evidenceRefs, []),
      existing?.createdAt || timestamp,
      timestamp,
      "",
      "{}"
    );
    const reviewItem = hydrateReviewItem(selectReviewItemStmt.get(reviewId));
    appendMirrorChange({
      kind: "reviewItem",
      action: "upsert",
      entityId: reviewItem.reviewId,
      itemId: reviewItem.entityId,
      batchId: reviewItem.batchId || "",
      payload: reviewItem,
      at: timestamp
    });
    return reviewItem;
  }

  function recordIngestConflictsForDocument(document = {}) {
    const rows = sourceConflictRowsForDocument(document);
    const conflict = ingestConflictReason({ document, rows });
    if (!conflict) {
      return [];
    }
    return [recordIngestConflict({ document, conflict })];
  }

  const ingestTransaction = db.transaction((input) => {
    const documents = Array.isArray(input) ? input : asArray(input?.documents);
    const duplicateGroups = Array.isArray(input) ? [] : asArray(input?.duplicateGroups);
    const acceptedDocuments = [];
    const reviewItems = [];
    for (const group of duplicateGroups) {
      for (const duplicate of asArray(group.duplicates)) {
        const reviewItem = recordIncomingDuplicateReviewItem({
          key: group.key || "",
          keep: group.keep || {},
          duplicate
        });
        if (reviewItem) {
          reviewItems.push(reviewItem);
        }
      }
    }
    for (const document of documents) {
      const conflicts = recordIngestConflictsForDocument(document).filter(Boolean);
      if (conflicts.length > 0) {
        reviewItems.push(...conflicts);
        continue;
      }
      upsertKnowledgeDocument(document);
      acceptedDocuments.push(document);
    }
    return {
      acceptedDocuments,
      reviewItems
    };
  });

  async function ingestBatch({ batchId, result = {} }) {
    const resolvedBatchId = String(batchId || result.batchId || "").trim();
    if (!resolvedBatchId) {
      throw new Error("knowledge.ingest.batch 缺少 batchId。");
    }
    const documents = await documentsFromBatch({
      batchId: resolvedBatchId,
      result
    });
    const dedupedDocuments = dedupeIncomingDocuments(documents);
    deleteBatchStmt(resolvedBatchId);
    const ingestResult = ingestTransaction(dedupedDocuments);
    const acceptedDocuments = ingestResult.acceptedDocuments || [];
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      batchId: resolvedBatchId,
      documentCount: acceptedDocuments.length,
      receivedDocumentCount: documents.length,
      skippedConflictCount: ingestResult.reviewItems.length,
      deduplicatedIncomingCount: documents.length - dedupedDocuments.documents.length,
      reviewItems: ingestResult.reviewItems,
      blockCount: acceptedDocuments.reduce((sum, document) => sum + document.blocks.length, 0),
      assetCount: acceptedDocuments.reduce((sum, document) => sum + document.assets.length, 0)
    };
  }

  async function ingestSources({ batchId, sources = [], generatedAt = nowIso() } = {}) {
    const resolvedBatchId = String(batchId || "").trim();
    if (!resolvedBatchId) {
      throw new Error("knowledge.ingest.sources 缺少 batchId。");
    }
    const documents = [];
    for (const source of asArray(sources)) {
      const document = buildSourceDocument(
        {
          ...source,
          rawObjectId: source.rawObjectId || source.rawObject?.objectId || "",
          rawObjectSha256: source.rawObjectSha256 || source.rawObject?.sha256 || "",
          rawObjectByteSize: source.rawObjectByteSize || source.rawObject?.byteSize || 0,
          originalFileName: source.originalFileName || source.rawObject?.originalFileName || "",
          originalRelativePath:
            source.originalRelativePath || source.rawObject?.originalRelativePath || ""
        },
        resolvedBatchId,
        generatedAt
      );
      documents.push(document);
    }
    const dedupedDocuments = dedupeIncomingDocuments(documents);
    const ingestResult = ingestTransaction(dedupedDocuments);
    const acceptedDocuments = ingestResult.acceptedDocuments || [];
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      batchId: resolvedBatchId,
      documentCount: acceptedDocuments.length,
      receivedDocumentCount: documents.length,
      skippedConflictCount: ingestResult.reviewItems.length,
      deduplicatedIncomingCount: documents.length - dedupedDocuments.documents.length,
      reviewItems: ingestResult.reviewItems,
      blockCount: acceptedDocuments.reduce((sum, document) => sum + document.blocks.length, 0),
      assetCount: acceptedDocuments.reduce((sum, document) => sum + document.assets.length, 0),
      mode: "incremental-source"
    };
  }

  function upsertDocuments({ documents = [], collectionId = "" } = {}) {
    const normalizedDocuments = asArray(documents).map((document, index) => ({
      ...document,
      collectionId: document.collectionId || collectionId || "manual",
      collectionTitle: document.collectionTitle || collectionId || "Manual Knowledge",
      documentId: document.documentId || stableId("document", "manual", document.title || index)
    }));
    const dedupedDocuments = dedupeIncomingDocuments(normalizedDocuments);
    const ingestResult = ingestTransaction(dedupedDocuments);
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      documentCount: ingestResult.acceptedDocuments.length,
      receivedDocumentCount: normalizedDocuments.length,
      skippedConflictCount: ingestResult.reviewItems.length,
      deduplicatedIncomingCount: normalizedDocuments.length - dedupedDocuments.documents.length,
      reviewItems: ingestResult.reviewItems
    };
  }

  function loadDocument(documentId) {
    return hydrateDocument(db.prepare("SELECT * FROM kc_documents WHERE document_id = ?").get(documentId));
  }

  function loadSection(sectionId) {
    return hydrateSection(db.prepare("SELECT * FROM kc_sections WHERE section_id = ?").get(sectionId));
  }

  function loadBlocksForDocument(documentId, limit = 20) {
    return db.prepare(`
      SELECT * FROM kc_blocks
      WHERE document_id = ?
      ORDER BY position ASC, block_id ASC
      LIMIT ?
    `).all(documentId, limit).map(hydrateBlock);
  }

  function loadAssetsForScope({ documentId, sectionId = "", blockId = "", limit = 12 }) {
    return db.prepare(`
      SELECT * FROM kc_assets
      WHERE document_id = ?
        AND (? = '' OR section_id = ?)
        AND (? = '' OR block_id = ?)
      ORDER BY title ASC, asset_id ASC
      LIMIT ?
    `).all(documentId, sectionId, sectionId, blockId, blockId, limit).map(hydrateAsset);
  }

  function loadDocumentsForDocxExport({ documentId = "", batchId = "", sourceId = "", limit = 500 } = {}) {
    const clauses = [];
    const args = [];
    const safeLimit = Math.max(1, Math.min(Number(limit || 500), 2000));
    if (normalizeText(documentId)) {
      clauses.push("document_id = ?");
      args.push(normalizeText(documentId));
    }
    if (normalizeText(batchId)) {
      clauses.push("batch_id = ?");
      args.push(normalizeText(batchId));
    }
    if (normalizeText(sourceId)) {
      clauses.push("source_id = ?");
      args.push(normalizeText(sourceId));
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT * FROM kc_documents
      ${where}
      ORDER BY updated_at DESC, document_id ASC
      LIMIT ?
    `).all(...args, safeLimit);
    return rows.map(hydrateDocument).filter(Boolean).map((document) => ({
      ...document,
      sections: db.prepare(`
        SELECT * FROM kc_sections
        WHERE document_id = ?
        ORDER BY position ASC, section_id ASC
      `).all(document.documentId).map(hydrateSection),
      blocks: db.prepare(`
        SELECT * FROM kc_blocks
        WHERE document_id = ?
        ORDER BY section_id ASC, position ASC, block_id ASC
      `).all(document.documentId).map(hydrateBlock),
      assets: db.prepare(`
        SELECT * FROM kc_assets
        WHERE document_id = ?
        ORDER BY section_id ASC, block_id ASC, title ASC, asset_id ASC
      `).all(document.documentId).map(hydrateAsset)
    }));
  }

  async function exportDocx({
    documentId = "",
    batchId = "",
    sourceId = "",
    limit = 500,
    includeMachineReadable = false
  } = {}) {
    const filters = {
      documentId: normalizeText(documentId),
      batchId: normalizeText(batchId),
      sourceId: normalizeText(sourceId),
      limit: Math.max(1, Math.min(Number(limit || 500), 2000))
    };
    const documents = loadDocumentsForDocxExport(filters);
    return buildKnowledgeDocxExport({
      documents,
      generatedAt: nowIso(),
      filters,
      includeMachineReadable
    });
  }

  function exportMarkdown({
    documentId = "",
    batchId = "",
    sourceId = "",
    limit = 500
  } = {}) {
    const filters = {
      documentId: normalizeText(documentId),
      batchId: normalizeText(batchId),
      sourceId: normalizeText(sourceId),
      limit: Math.max(1, Math.min(Number(limit || 500), 2000))
    };
    const documents = loadDocumentsForDocxExport(filters);
    return buildKnowledgeMarkdownExport({ documents, generatedAt: nowIso(), filters });
  }

  function exportHtml({
    documentId = "",
    batchId = "",
    sourceId = "",
    limit = 500
  } = {}) {
    const filters = {
      documentId: normalizeText(documentId),
      batchId: normalizeText(batchId),
      sourceId: normalizeText(sourceId),
      limit: Math.max(1, Math.min(Number(limit || 500), 2000))
    };
    const documents = loadDocumentsForDocxExport(filters);
    return buildKnowledgeHtmlExport({ documents, generatedAt: nowIso(), filters });
  }

  function loadAssetsForBatch({ batchId = "", limit = 8 }) {
    if (!batchId) {
      return [];
    }
    return db.prepare(`
      SELECT a.*
      FROM kc_assets a
      JOIN kc_documents d ON d.document_id = a.document_id
      WHERE d.batch_id = ?
      ORDER BY a.updated_at DESC, a.asset_id ASC
      LIMIT ?
    `).all(batchId, limit).map(hydrateAsset);
  }

  function bestSnippetForQuery(text = "", query = "", candidate = null, maxLength = 420) {
    const cleaned = searchableText(text, 12000);
    if (!cleaned) {
      return "";
    }
    const terms = [
      ...queryTerms(query),
      ...asArray(candidate?.intentAlignment?.queryAnchorHits),
      ...asArray(candidate?.intentAlignment?.positiveHits)
    ].map((term) => normalizeText(term).toLowerCase()).filter((term) => term.length >= 2);
    const lower = cleaned.toLowerCase();
    let bestIndex = -1;
    for (const term of terms) {
      const index = lower.indexOf(term);
      if (index >= 0 && (bestIndex < 0 || index < bestIndex)) {
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      return truncateText(cleaned, maxLength);
    }
    const start = Math.max(0, bestIndex - Math.floor(maxLength * 0.35));
    const end = Math.min(cleaned.length, start + maxLength);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < cleaned.length ? "…" : "";
    return `${prefix}${cleaned.slice(start, end).trim()}${suffix}`;
  }

  function visibleIntentText(value, maxLength = 1600) {
    return cleanVisibleIndexText(value, maxLength);
  }

  function candidateIntentText(candidate = {}, { strict = false } = {}) {
    const row = candidate.row || {};
    const documentMetadata = parseJson(row.document_metadata_json, {});
    const metadata = parseJson(row.metadata_json, {});
    const sourceLocator = parseJson(row.source_locator_json, {});
    const metadataSurface = strict
      ? {
          categories: metadata.categories || documentMetadata.categories || [],
          keywords: metadata.keywords || documentMetadata.keywords || [],
          documentType: row.document_type || documentMetadata.documentType || "",
          mediaType: row.media_type || metadata.mediaType || "",
          originalRelativePath: documentMetadata.originalRelativePath || ""
        }
      : {
          ...documentMetadata,
          ...metadata,
          ...sourceLocator
        };
    return [
      row.document_title,
      row.title,
      strict ? "" : searchableText(row.snippet, 1200),
      strict ? "" : visibleIntentText(row.text, 2400),
      row.ocr_text,
      row.caption,
      row.media_type,
      row.source_path,
      stableJson(metadataSurface)
    ].filter(Boolean).join("\n");
  }

  function candidateResultDedupeKey(candidate = {}) {
    const row = candidate.row || {};
    const sourceLocator = parseJson(row.source_locator_json, {});
    const documentMetadata = parseJson(row.document_metadata_json, {});
    const sourceHash =
      normalizeText(row.document_source_hash || row.source_hash || documentMetadata.rawObjectSha256 || "");
    const sourcePath =
      row.document_source_path ||
      sourceLocator.sourcePath ||
      sourceLocator.sourceId ||
      documentMetadata.originalRelativePath ||
      documentMetadata.sourcePath ||
      "";
    const titleFamily = normalizeEmailTitleFamily(row.document_title || row.title || sourcePath);
    if (
      candidate.targetType !== "asset" &&
      titleFamily.length >= 12 &&
      (looksLikeMailSource(row.document_title || row.title || "") || looksLikeMailSource(sourcePath))
    ) {
      return `mail-title::${titleFamily}`;
    }
    if (sourceHash) {
      if (candidate.targetType === "asset" && row.asset_id) {
        return `hash::${sourceHash.toLowerCase()}::asset::${row.asset_id}`;
      }
      return `hash::${sourceHash.toLowerCase()}::text`;
    }
    if (!sourcePath && !row.title) {
      return "";
    }
    return [
      normalizeText(sourcePath || row.document_id || "").toLowerCase(),
      normalizeText(row.document_title || row.title || "").toLowerCase()
    ].join("::");
  }

  function dedupeResultCandidates(candidates = []) {
    const seen = new Set();
    const result = [];
    for (const candidate of candidates) {
      const key = candidateResultDedupeKey(candidate);
      if (key && seen.has(key)) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      result.push(candidate);
    }
    return result;
  }

  function evaluateCandidateIntent(candidate, intentProfile) {
    if (!intentProfile) {
      return {
        intentId: "",
        aligned: true,
        score: 0,
        positiveHits: [],
        negativeHits: []
      };
    }
    const alignment = evaluateTaxonomyQueryIntentText(candidateIntentText(candidate), intentProfile);
    if (!alignment.aligned) {
      return alignment;
    }
    const strictAlignment = evaluateTaxonomyQueryIntentText(
      candidateIntentText(candidate, { strict: true }),
      intentProfile
    );
    const lexicalReason = ["bm25", "like", "image-bm25", "image-like", "hierarchy-backoff"].includes(candidate.reason);
    const guardedVectorBodyHit =
      ["text-vector", "image-vector"].includes(candidate.reason) &&
      Number(candidate.lexicalHint || 0) >= 0.2;
    const strongBodyLexicalHit =
      (lexicalReason || guardedVectorBodyHit) &&
      Number(candidate.score || 0) >= 0.45 &&
      (alignment.queryAnchorHits || []).length > 0 &&
      (alignment.negativeHits || []).length === 0;
    return {
      ...alignment,
      aligned: strictAlignment.aligned || strongBodyLexicalHit,
      strictAnchorHits: strictAlignment.anchorHits || [],
      strictQueryAnchorHits: strictAlignment.queryAnchorHits || []
    };
  }

  function specificQueryTermsForIntent(query, intentProfile) {
    if (!intentProfile) {
      return [];
    }
    const baseTerms = new Set(queryTerms(query));
    const intentTerms = new Set([
      ...queryTerms((intentProfile.matchedTriggers || []).join(" ")),
      ...queryTerms((intentProfile.queryAnchorTerms || []).join(" "))
    ]);
    return [...baseTerms]
      .filter((term) => term.length >= 2 && !intentTerms.has(term))
      .slice(0, 24);
  }

  function candidateMatchesSpecificQuery(candidate, specificTerms = []) {
    if (!specificTerms.length) {
      return true;
    }
    const surface = candidateIntentText(candidate);
    const normalizedSurface = surface.toLowerCase();
    const candidateTerms = new Set(queryTerms(surface));
    return specificTerms.some((term) =>
      candidateTerms.has(term) || normalizedSurface.includes(String(term || "").toLowerCase())
    );
  }

  function candidateAllowedByQueryIntent(candidate, intentProfile, specificTerms = []) {
    if (!intentProfile) {
      return true;
    }
    const alignment = candidate.intentAlignment || evaluateCandidateIntent(candidate, intentProfile);
    candidate.intentAlignment = alignment;
    const hasSpecificTerms = specificTerms.length > 0;
    const specificMatched = candidateMatchesSpecificQuery(candidate, specificTerms);
    const aligned =
      alignment.aligned ||
      (
        hasSpecificTerms &&
        specificMatched &&
        (alignment.queryAnchorHits || []).length > 0 &&
        alignment.score >= Math.min(0.2, Number(intentProfile.minAlignmentScore ?? 0.25))
      );
    return aligned &&
      alignment.score >= Number(intentProfile.minAlignmentScore ?? 0.25) &&
      specificMatched;
  }

  function lexicalBlockCandidates({ query, queryTokens, batchId = "", sourceIds = [], limit = 120 }) {
    const filters = [];
    const params = [];
    if (batchId) {
      filters.push("d.batch_id = ?");
      params.push(batchId);
    }
    if (sourceIds.length > 0) {
      filters.push(`d.source_id IN (${sourceIds.map(() => "?").join(", ")})`);
      params.push(...sourceIds);
    }
    const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
    const candidates = [];
    const seenBlockIds = new Set();
    const qualityTerms = queryTerms(query);
    const normalizedQuery = normalizeText(query);
    if (queryTokens.length) {
      const matchQuery = queryTokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
      try {
        for (const candidate of db.prepare(`
          SELECT
            b.*,
            d.batch_id,
            d.title AS document_title,
            d.source_path AS document_source_path,
            d.source_hash AS document_source_hash,
            d.metadata_json AS document_metadata_json,
            d.created_at AS document_created_at,
            d.updated_at AS document_updated_at,
            bm25(kc_blocks_fts, 6.0, 1.0, 1.0, 0.5) AS lexical_rank
          FROM kc_blocks_fts
          JOIN kc_blocks b ON b.block_id = kc_blocks_fts.block_id
          JOIN kc_documents d ON d.document_id = b.document_id
          WHERE kc_blocks_fts MATCH ?${where}
          ORDER BY lexical_rank ASC
          LIMIT ?
        `).all(matchQuery, ...params, limit).map((row) => ({
          targetType: "block",
          row,
          score: Math.max(0.05, tokenOverlapScore(`${row.title}\n${searchableText(row.text, 6000)}`, queryTokens)),
          reason: "bm25"
        }))) {
          seenBlockIds.add(candidate.row.block_id);
          candidates.push(candidate);
        }
      } catch {
        // Fall through to LIKE if the FTS query contains unsupported syntax.
      }
    }
    const tokenLikeTerms = qualityTerms
      .filter((term) => term.length >= 2)
      .slice(0, 8);
    if (tokenLikeTerms.length > 0 && candidates.length < limit) {
      const tokenWhere = tokenLikeTerms
        .map(() => "(b.title LIKE ? OR b.text LIKE ? OR b.snippet LIKE ?)")
        .join(" AND ");
      const tokenParams = tokenLikeTerms.flatMap((term) => {
        const likeTerm = `%${term}%`;
        return [likeTerm, likeTerm, likeTerm];
      });
      for (const candidate of db.prepare(`
        SELECT
          b.*,
          d.batch_id,
          d.title AS document_title,
          d.source_path AS document_source_path,
          d.source_hash AS document_source_hash,
          d.metadata_json AS document_metadata_json,
          d.created_at AS document_created_at,
          d.updated_at AS document_updated_at,
          0 AS lexical_rank
        FROM kc_blocks b
        JOIN kc_documents d ON d.document_id = b.document_id
        WHERE ${tokenWhere}${where}
        ORDER BY b.updated_at DESC
        LIMIT ?
      `).all(...tokenParams, ...params, limit).map((row) => {
        const surface = `${row.title}\n${searchableText(row.text, 6000)}`;
        return {
          targetType: "block",
          row,
          score: Math.max(
            queryTokens.length ? tokenOverlapScore(surface, queryTokens) : 0.6,
            queryMatchQualityScore(query, surface, qualityTerms).score
          ),
          reason: "token-like"
        };
      })) {
        if (normalizedQuery && Number(candidate.score || 0) <= 0) {
          continue;
        }
        if (seenBlockIds.has(candidate.row.block_id)) {
          continue;
        }
        seenBlockIds.add(candidate.row.block_id);
        candidates.push(candidate);
      }
    }
    if (candidates.length > 0) {
      return candidates.slice(0, limit);
    }
    const like = `%${normalizedQuery}%`;
    return db.prepare(`
      SELECT
        b.*,
        d.batch_id,
        d.title AS document_title,
        d.source_path AS document_source_path,
        d.source_hash AS document_source_hash,
        d.metadata_json AS document_metadata_json,
        d.created_at AS document_created_at,
        d.updated_at AS document_updated_at,
        0 AS lexical_rank
      FROM kc_blocks b
      JOIN kc_documents d ON d.document_id = b.document_id
      WHERE (? = '' OR b.title LIKE ? OR b.text LIKE ? OR b.snippet LIKE ?)${where}
      ORDER BY b.updated_at DESC
      LIMIT ?
    `).all(normalizedQuery, like, like, like, ...params, limit).map((row) => ({
      targetType: "block",
      row,
      score: Math.max(
        queryTokens.length ? tokenOverlapScore(`${row.title}\n${searchableText(row.text, 6000)}`, queryTokens) : 0.6,
        queryMatchQualityScore(query, `${row.title}\n${searchableText(row.text, 6000)}`, qualityTerms).score
      ),
      reason: "like"
    })).filter((candidate) => !normalizedQuery || Number(candidate.score || 0) > 0);
  }

  function lexicalAssetCandidates({ query, queryTokens, batchId = "", sourceIds = [], limit = 120 }) {
    const filters = [];
    const params = [];
    if (batchId) {
      filters.push("d.batch_id = ?");
      params.push(batchId);
    }
    if (sourceIds.length > 0) {
      filters.push(`d.source_id IN (${sourceIds.map(() => "?").join(", ")})`);
      params.push(...sourceIds);
    }
    const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
    const candidates = [];
    const seenAssetIds = new Set();
    const qualityTerms = queryTerms(query);
    const normalizedQuery = normalizeText(query);
    if (queryTokens.length) {
      const matchQuery = queryTokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
      try {
        for (const candidate of db.prepare(`
          SELECT
            a.*,
            d.batch_id,
            d.title AS document_title,
            d.source_path AS document_source_path,
            d.source_hash AS document_source_hash,
            d.metadata_json AS document_metadata_json,
            d.created_at AS document_created_at,
            d.updated_at AS document_updated_at,
            bm25(kc_assets_fts, 5.0, 1.0, 1.0, 1.0, 0.5) AS lexical_rank
          FROM kc_assets_fts
          JOIN kc_assets a ON a.asset_id = kc_assets_fts.asset_id
          JOIN kc_documents d ON d.document_id = a.document_id
          WHERE kc_assets_fts MATCH ?${where}
          ORDER BY lexical_rank ASC
          LIMIT ?
        `).all(matchQuery, ...params, limit).map((row) => ({
          targetType: "asset",
          row,
          score: Math.max(0.05, tokenOverlapScore(`${row.title}\n${row.text}\n${row.ocr_text}\n${row.caption}`, queryTokens)),
          reason: "image-bm25"
        }))) {
          seenAssetIds.add(candidate.row.asset_id);
          candidates.push(candidate);
        }
      } catch {}
    }
    const tokenLikeTerms = qualityTerms
      .filter((term) => term.length >= 2)
      .slice(0, 8);
    if (tokenLikeTerms.length > 0 && candidates.length < limit) {
      const tokenWhere = tokenLikeTerms
        .map(() => "(a.title LIKE ? OR a.text LIKE ? OR a.ocr_text LIKE ? OR a.caption LIKE ?)")
        .join(" AND ");
      const tokenParams = tokenLikeTerms.flatMap((term) => {
        const likeTerm = `%${term}%`;
        return [likeTerm, likeTerm, likeTerm, likeTerm];
      });
      for (const candidate of db.prepare(`
        SELECT
          a.*,
          d.batch_id,
          d.title AS document_title,
          d.source_path AS document_source_path,
          d.source_hash AS document_source_hash,
          d.metadata_json AS document_metadata_json,
          d.created_at AS document_created_at,
          d.updated_at AS document_updated_at
        FROM kc_assets a
        JOIN kc_documents d ON d.document_id = a.document_id
        WHERE ${tokenWhere}${where}
        ORDER BY a.updated_at DESC
        LIMIT ?
      `).all(...tokenParams, ...params, limit).map((row) => {
        const surface = `${row.title}\n${row.text}\n${row.ocr_text}\n${row.caption}`;
        return {
          targetType: "asset",
          row,
          score: Math.max(
            queryTokens.length ? tokenOverlapScore(surface, queryTokens) : 0.5,
            queryMatchQualityScore(query, surface, qualityTerms).score
          ),
          reason: "image-token-like"
        };
      })) {
        if (normalizedQuery && Number(candidate.score || 0) <= 0) {
          continue;
        }
        if (seenAssetIds.has(candidate.row.asset_id)) {
          continue;
        }
        seenAssetIds.add(candidate.row.asset_id);
        candidates.push(candidate);
      }
    }
    if (candidates.length > 0) {
      return candidates.slice(0, limit);
    }
    const like = `%${normalizedQuery}%`;
    return db.prepare(`
      SELECT
        a.*,
        d.batch_id,
        d.title AS document_title,
        d.source_path AS document_source_path,
        d.source_hash AS document_source_hash,
        d.metadata_json AS document_metadata_json,
        d.created_at AS document_created_at,
        d.updated_at AS document_updated_at
      FROM kc_assets a
      JOIN kc_documents d ON d.document_id = a.document_id
      WHERE (? = '' OR a.title LIKE ? OR a.text LIKE ? OR a.ocr_text LIKE ? OR a.caption LIKE ?)${where}
      ORDER BY a.updated_at DESC
      LIMIT ?
    `).all(normalizedQuery, like, like, like, like, ...params, limit).map((row) => ({
      targetType: "asset",
      row,
      score: Math.max(
        queryTokens.length ? tokenOverlapScore(`${row.title}\n${row.text}\n${row.ocr_text}\n${row.caption}`, queryTokens) : 0.5,
        queryMatchQualityScore(query, `${row.title}\n${row.text}\n${row.ocr_text}\n${row.caption}`, qualityTerms).score
      ),
      reason: "image-like"
    })).filter((candidate) => !normalizedQuery || Number(candidate.score || 0) > 0);
  }

  function vectorCandidateSurface(row = {}, targetType = "block") {
    if (targetType === "asset") {
      return [
        row.title || "",
        searchableText(row.text || "", 6000),
        searchableText(row.ocr_text || "", 6000),
        searchableText(row.caption || "", 6000),
        row.document_title || ""
      ].join("\n");
    }
    return [
      row.title || "",
      searchableText(row.text || "", 6000),
      searchableText(row.snippet || "", 1200),
      row.document_title || ""
    ].join("\n");
  }

  function vectorCandidates({ query, queryTokens = [], batchId = "", sourceIds = [], limit = 120, settings = DEFAULT_SETTINGS }) {
    const blockById = new Map(
      db.prepare(`
        SELECT
          b.*,
          d.batch_id,
          d.source_id AS document_source_id,
          d.title AS document_title,
          d.source_path AS document_source_path,
          d.source_hash AS document_source_hash,
          d.metadata_json AS document_metadata_json,
          d.created_at AS document_created_at,
          d.updated_at AS document_updated_at
        FROM kc_blocks b
        JOIN kc_documents d ON d.document_id = b.document_id
        WHERE (? = '' OR d.batch_id = ?)
      `).all(batchId, batchId)
        .filter((row) => sourceIds.length === 0 || sourceIds.includes(row.document_source_id))
        .map((row) => [row.block_id, row])
    );
    const assetById = new Map(
      db.prepare(`
        SELECT
          a.*,
          d.batch_id,
          d.source_id AS document_source_id,
          d.title AS document_title,
          d.source_path AS document_source_path,
          d.source_hash AS document_source_hash,
          d.metadata_json AS document_metadata_json,
          d.created_at AS document_created_at,
          d.updated_at AS document_updated_at
        FROM kc_assets a
        JOIN kc_documents d ON d.document_id = a.document_id
        WHERE (? = '' OR d.batch_id = ?)
      `).all(batchId, batchId)
        .filter((row) => sourceIds.length === 0 || sourceIds.includes(row.document_source_id))
        .map((row) => [row.asset_id, row])
    );
    const vectorResult = vectorStore.search({ query, limit: limit * 2 });
    const vectorItems = Array.isArray(vectorResult) ? vectorResult : vectorResult.results || [];
    return vectorItems
      .map((candidate) => {
        const row = candidate.targetType === "block"
          ? blockById.get(candidate.targetId)
          : assetById.get(candidate.targetId);
        if (!row) return null;
        const lexicalHint = queryTokens.length
          ? tokenOverlapScore(vectorCandidateSurface(row, candidate.targetType), queryTokens)
          : 0;
        if (
          settings.retrieval?.vectorLexicalGuard !== false &&
          queryTokens.length > 0 &&
          lexicalHint < Number(settings.retrieval?.vectorLexicalMinScore ?? 0.01)
        ) {
          return null;
        }
        return {
          targetType: candidate.targetType,
          row,
          score: Math.max(Number(candidate.score || 0), lexicalHint),
          lexicalHint,
          reason: candidate.targetType === "asset" ? "image-vector" : "text-vector"
        };
      })
      .filter(Boolean)
      .slice(0, limit);
  }

  function hydrateHierarchyNode(row, queryTokens = []) {
    if (!row) return null;
    const metadata = parseJson(row.metadata_json, {});
    const rawScore = queryTokens.length
      ? termPresenceScore(`${row.title}\n${row.summary}\n${row.text}\n${row.category_path}`, queryTokens)
      : 0.5;
    return {
      hierarchyId: row.hierarchy_id,
      nodeType: row.node_type,
      level: Number(row.level || hierarchyLevel(row.node_type)),
      targetId: row.target_id,
      parentHierarchyId: row.parent_hierarchy_id,
      collectionId: row.collection_id,
      documentId: row.document_id,
      sectionId: row.section_id,
      batchId: row.batch_id,
      title: row.title,
      summary: row.summary,
      categoryPath: row.category_path,
      metadata,
      score: Number((Math.max(0.02, rawScore) * hierarchyLevelWeight(row.node_type)).toFixed(6))
    };
  }

  function hierarchyNodeCandidates({ query, queryTokens, batchId = "", sourceIds = [], limit = 40 }) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 40), 200));
    const filters = [];
    const params = [];
    if (batchId) {
      filters.push("h.batch_id = ?");
      params.push(batchId);
    }
    if (sourceIds.length > 0) {
      // hierarchy_nodes join to documents; filter by document's source_id
      filters.push(`EXISTS (SELECT 1 FROM kc_documents hd WHERE hd.document_id = h.document_id AND hd.source_id IN (${sourceIds.map(() => "?").join(", ")}))`);
      params.push(...sourceIds);
    }
    const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
    const candidates = [];
    const seenHierarchyIds = new Set();
    if (queryTokens.length) {
      const matchQuery = queryTokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
      try {
        const rows = db.prepare(`
          SELECT h.*, bm25(kc_hierarchy_fts, 8.0, 4.0, 3.0, 2.0, 1.0) AS lexical_rank
          FROM kc_hierarchy_fts
          JOIN kc_hierarchy_nodes h ON h.hierarchy_id = kc_hierarchy_fts.hierarchy_id
          WHERE kc_hierarchy_fts MATCH ?${where}
          ORDER BY h.level ASC, lexical_rank ASC, h.updated_at DESC
          LIMIT ?
        `).all(matchQuery, ...params, safeLimit);
        for (const row of rows) {
          seenHierarchyIds.add(row.hierarchy_id);
          candidates.push(hydrateHierarchyNode(row, queryTokens));
        }
      } catch {
        // Fall through to LIKE if the FTS tokenizer cannot parse the query.
      }
    }
    const tokenLikeTerms = queryTerms(query)
      .filter((term) => term.length >= 2)
      .slice(0, 8);
    if (tokenLikeTerms.length > 0 && candidates.length < safeLimit) {
      const tokenWhere = tokenLikeTerms
        .map(() => "(h.title LIKE ? OR h.summary LIKE ? OR h.text LIKE ? OR h.category_path LIKE ?)")
        .join(" AND ");
      const tokenParams = tokenLikeTerms.flatMap((term) => {
        const like = `%${term}%`;
        return [like, like, like, like];
      });
      const rows = db.prepare(`
        SELECT h.*
        FROM kc_hierarchy_nodes h
        WHERE ${tokenWhere}${where}
        ORDER BY h.level ASC, h.updated_at DESC
        LIMIT ?
      `).all(...tokenParams, ...params, safeLimit);
      for (const row of rows) {
        if (seenHierarchyIds.has(row.hierarchy_id)) {
          continue;
        }
        seenHierarchyIds.add(row.hierarchy_id);
        candidates.push(hydrateHierarchyNode(row, queryTokens));
      }
    }
    if (candidates.length) {
      return candidates.slice(0, safeLimit);
    }
    const terms = queryTerms(query).slice(0, 16);
    const likeClauses = terms.map(() => "(h.title LIKE ? OR h.summary LIKE ? OR h.text LIKE ? OR h.category_path LIKE ?)");
    const likeParams = terms.flatMap((term) => {
      const like = `%${term}%`;
      return [like, like, like, like];
    });
    const likeWhere = likeClauses.length ? likeClauses.join(" OR ") : "1 = 1";
    return db.prepare(`
      SELECT h.*
      FROM kc_hierarchy_nodes h
      WHERE (? = '' OR ${likeWhere})${where}
      ORDER BY h.level ASC, h.updated_at DESC
      LIMIT ?
    `).all(normalizeText(query), ...likeParams, ...params, safeLimit)
      .map((row) => hydrateHierarchyNode(row, queryTokens));
  }

  function sourceScopedHierarchyNodes(nodes = [], sourceIds = []) {
    const scopedSourceIds = new Set(uniqueStrings(sourceIds, 500));
    if (!scopedSourceIds.size) {
      return nodes;
    }
    const sourceStmt = db.prepare("SELECT source_id FROM kc_documents WHERE document_id = ?");
    return nodes.filter((node) => {
      const documentId = String(node.documentId || "").trim();
      if (!documentId) {
        return false;
      }
      const sourceId = String(sourceStmt.get(documentId)?.source_id || "").trim();
      return scopedSourceIds.has(sourceId);
    });
  }

  function hierarchyNodesByIds(ids = [], { sourceIds = [] } = {}) {
    const uniqueIds = uniqueStrings(ids, 120);
    if (!uniqueIds.length) {
      return [];
    }
    const placeholders = uniqueIds.map(() => "?").join(",");
    return sourceScopedHierarchyNodes(db.prepare(`
      SELECT * FROM kc_hierarchy_nodes
      WHERE hierarchy_id IN (${placeholders}) OR target_id IN (${placeholders})
      ORDER BY level ASC, updated_at DESC
    `).all(...uniqueIds, ...uniqueIds).map((row) => hydrateHierarchyNode(row, [])), sourceIds);
  }

  function compactHierarchyNodesForReasoning({ query = "", batchId = "", sourceIds = [], limit = 80 } = {}) {
    ensureHierarchyIndexReady();
    const safeLimit = Math.max(8, Math.min(Number(limit || 80), 200));
    const queryTokens = queryTerms(query);
    const candidates = hierarchyNodeCandidates({
      query,
      queryTokens,
      batchId,
      sourceIds,
      limit: safeLimit
    });
    if (candidates.length) {
      return candidates.slice(0, safeLimit);
    }
    const scopedSourceIds = uniqueStrings(sourceIds, 500);
    const sourceFilter = scopedSourceIds.length
      ? ` AND EXISTS (SELECT 1 FROM kc_documents cd WHERE cd.document_id = kc_hierarchy_nodes.document_id AND cd.source_id IN (${scopedSourceIds.map(() => "?").join(", ")}))`
      : "";
    const rows = db.prepare(`
      SELECT *
      FROM kc_hierarchy_nodes
      WHERE (? = '' OR batch_id = ?)${sourceFilter}
      ORDER BY level ASC, updated_at DESC
      LIMIT ?
    `).all(batchId, batchId, ...scopedSourceIds, safeLimit);
    return rows.map((row) => hydrateHierarchyNode(row, queryTokens));
  }

  function compactTreeForReasoning({ query = "", batchId = "", sourceIds = [], limit = 80 } = {}) {
    const nodes = compactHierarchyNodesForReasoning({ query, batchId, sourceIds, limit });
    return nodes.map((node) => ({
      nodeId: node.hierarchyId,
      targetId: node.targetId,
      nodeType: node.nodeType,
      title: node.title,
      summary: node.summary,
      documentId: node.documentId,
      sectionId: node.sectionId,
      sourceRange: sourceRangeFromMetadata(node.metadata),
      parentNodeId: node.parentHierarchyId || "",
      score: node.score || 0
    }));
  }

  function nestCompactTreeForReasoning(nodes = []) {
    const byId = new Map(
      asArray(nodes).map((node) => [node.nodeId, { ...node, children: [] }])
    );
    const roots = [];
    for (const node of byId.values()) {
      const parent = byId.get(node.parentNodeId);
      if (parent && parent.nodeId !== node.nodeId) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  function deterministicHierarchyReasoning({ query = "", nodes = [], limit = 8 } = {}) {
    const terms = queryTerms(query);
    const ranked = asArray(nodes)
      .map((node) => {
        const sourceRange = node.sourceRange || sourceRangeFromMetadata(node.metadata);
        const text = [
          node.title,
          node.summary,
          node.categoryPath,
          JSON.stringify(sourceRange || {})
        ].filter(Boolean).join("\n");
        return {
          nodeId: node.nodeId || node.hierarchyId,
          targetId: node.targetId || "",
          score: termPresenceScore(text, terms),
          title: node.title || "",
          sourceRange
        };
      })
      .filter((node) => node.nodeId && node.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(Number(limit || 8), 24)));
    return {
      selectedNodeIds: ranked.map((node) => node.nodeId),
      nodeScores: Object.fromEntries(ranked.map((node) => [node.nodeId, Number(node.score.toFixed(6))])),
      reason: ranked.length ? "deterministic tree term overlap" : "no matching hierarchy nodes",
      confidence: ranked.length ? Math.max(...ranked.map((node) => node.score)) : 0
    };
  }

  function normalizeHierarchyReasoningDecision(decision = {}, compactTree = []) {
    const rawDecision = decision.decision || decision;
    const selectedIds = uniqueStrings(
      rawDecision.selectedNodeIds ||
        rawDecision.nodeIds ||
        rawDecision.node_list ||
        rawDecision.nodeList ||
        rawDecision.answer ||
        [],
      24
    );
    const knownIds = new Set(compactTree.map((node) => node.nodeId).filter(Boolean));
    const nodeIdByTargetId = new Map(
      compactTree
        .filter((node) => node.targetId && node.nodeId)
        .map((node) => [String(node.targetId), node.nodeId])
    );
    const filteredIds = selectedIds
      .map((id) => (knownIds.has(id) ? id : nodeIdByTargetId.get(id) || ""))
      .filter(Boolean);
    return {
      enabled: true,
      usedModel: Boolean(decision.usedModel),
      degraded: Boolean(decision.degraded) || (Boolean(decision.usedModel) && Boolean(rawDecision.rawText) && !filteredIds.length),
      selectedNodeIds: filteredIds,
      nodeScores: rawDecision.nodeScores || rawDecision.scores || {},
      reason: rawDecision.reason || rawDecision.thinking || (rawDecision.rawText ? "invalid_hierarchy_router_json" : ""),
      confidence: Number(rawDecision.confidence || 0),
      audit: decision.audit || null
    };
  }

  async function prepareHierarchyReasoning({
    query = "",
    batchId = "",
    sourceIds = [],
    limit = 80,
    modelEnabled = false,
    modelDecisionRuntime = null
  } = {}) {
    const settings = getSettings();
    const compactTree = compactTreeForReasoning({
      query,
      batchId,
      sourceIds,
      limit: settings.retrieval.outlineMaxTreeNodes || limit
    });
    if (!compactTree.length) {
      return {
        enabled: true,
        usedModel: false,
        degraded: true,
        selectedNodeIds: [],
        reason: "empty_hierarchy_tree",
        compactTree
      };
    }
    if (modelDecisionRuntime && typeof modelDecisionRuntime.decide === "function") {
      try {
        const decision = await modelDecisionRuntime.decide({
          roleId: "hierarchy_tree_router",
          modelEnabled: modelEnabled === true,
        input: {
          query,
          tree: nestCompactTreeForReasoning(compactTree),
          nodes: compactTree,
          expected: {
              responseShape: {
                selectedNodeIds: ["node id"],
                reason: "short routing rationale",
                confidence: 0.0
              }
            }
          }
        });
        return {
          ...normalizeHierarchyReasoningDecision(decision, compactTree),
          compactTree
        };
      } catch (error) {
        return {
          enabled: true,
          usedModel: false,
          degraded: true,
          ...deterministicHierarchyReasoning({ query, nodes: compactTree, limit: 8 }),
          reason: `model_decision_failed:${error instanceof Error ? error.message : String(error)}`,
          compactTree
        };
      }
    }
    return {
      enabled: true,
      usedModel: false,
      degraded: false,
      ...deterministicHierarchyReasoning({ query, nodes: compactTree, limit: 8 }),
      compactTree
    };
  }

  function buildHierarchyPlan({ query, queryTokens, batchId = "", sourceIds = [], settings, safeLimit, reasoningDecision = null }) {
    const hierarchySettings = settings.retrieval || {};
    if (hierarchySettings.hierarchicalIndexEnabled === false) {
      return {
        enabled: false,
        policy: "disabled",
        enforced: false,
        selectedDocumentIds: new Set(),
        selectedSectionIds: new Set(),
        nonOutlineDocumentIds: new Set(),
        outlineDocumentIds: new Set(),
        outlineRoutes: [],
        documentScores: new Map(),
        sectionScores: new Map(),
        outlineScores: new Map(),
        nodes: [],
        reasoning: {
          enabled: false
        },
        selected: {
          collections: [],
          documents: [],
          sections: [],
          outlines: []
        }
      };
    }
    ensureHierarchyIndexReady();
    const branchTopK = Math.max(3, Math.min(Number(hierarchySettings.hierarchyBranchTopK || 12), 50));
    const hierarchyQueryTerms = queryTerms(query);
    let nodes = hierarchyNodeCandidates({
      query,
      queryTokens: hierarchyQueryTerms.length ? hierarchyQueryTerms : queryTokens,
      batchId,
      sourceIds,
      limit: Math.max(branchTopK * 4, safeLimit * 3, 30)
    }).sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.level - right.level;
    });
    const reasoningNodeIds = uniqueStrings(reasoningDecision?.selectedNodeIds || [], branchTopK);
    const reasoningNodes = hierarchyNodesByIds(reasoningNodeIds, { sourceIds });
    if (reasoningNodes.length) {
      const reasoningIds = new Set(reasoningNodes.map((node) => node.hierarchyId));
      nodes = [
        ...reasoningNodes.map((node) => ({
          ...node,
          score: Math.max(
            Number(node.score || 0),
            Number(reasoningDecision?.nodeScores?.[node.hierarchyId] || reasoningDecision?.confidence || 0.75)
          )
        })),
        ...nodes.filter((node) => !reasoningIds.has(node.hierarchyId))
      ];
    }
    const topScore = Math.max(0, ...nodes.map((node) => Number(node.score || 0)));
    const threshold = topScore > 0 ? Math.max(0.04, topScore * 0.42) : 0;
    const selectedNodes = reasoningNodes.length
      ? nodes.filter((node) => reasoningNodeIds.includes(node.hierarchyId)).slice(0, branchTopK)
      : nodes.filter((node) => node.score >= threshold).slice(0, branchTopK);
    const selectedCollections = selectedNodes.filter((node) => node.nodeType === "collection");
    const selectedDocuments = selectedNodes.filter((node) => node.nodeType === "document");
    const selectedSections = selectedNodes.filter((node) => node.nodeType === "section");
    const selectedOutlines = selectedNodes.filter((node) => node.nodeType === "outline");
    const selectedDocumentIds = new Set(selectedDocuments.map((node) => node.documentId || node.targetId).filter(Boolean));
    const selectedSectionIds = new Set(selectedSections.map((node) => node.sectionId || node.targetId).filter(Boolean));
    const nonOutlineDocumentIds = new Set(selectedDocumentIds);
    const outlineDocumentIds = new Set();
    const outlineRoutes = [];
    const documentScores = new Map();
    const sectionScores = new Map();
    const outlineScores = new Map();

    for (const node of selectedDocuments) {
      const documentId = node.documentId || node.targetId;
      selectedDocumentIds.add(documentId);
      documentScores.set(documentId, Math.max(documentScores.get(documentId) || 0, node.score));
    }
    for (const node of selectedSections) {
      if (node.documentId) {
        selectedDocumentIds.add(node.documentId);
        nonOutlineDocumentIds.add(node.documentId);
        documentScores.set(node.documentId, Math.max(documentScores.get(node.documentId) || 0, node.score * 0.92));
      }
      const sectionId = node.sectionId || node.targetId;
      selectedSectionIds.add(sectionId);
      sectionScores.set(sectionId, Math.max(sectionScores.get(sectionId) || 0, node.score));
    }
    for (const node of selectedOutlines) {
      if (node.documentId) {
        selectedDocumentIds.add(node.documentId);
        outlineDocumentIds.add(node.documentId);
        documentScores.set(node.documentId, Math.max(documentScores.get(node.documentId) || 0, node.score * 0.82));
      }
      const sourceRange = sourceRangeFromMetadata(node.metadata);
      outlineScores.set(node.hierarchyId, Math.max(outlineScores.get(node.hierarchyId) || 0, node.score));
      outlineRoutes.push({
        hierarchyId: node.hierarchyId,
        title: node.title,
        documentId: node.documentId || "",
        sectionId: node.sectionId || "",
        score: node.score,
        sourceRange,
        origin: node.metadata?.outlineOrigin || "",
        quality: node.metadata?.quality || {}
      });
    }
    if (!selectedDocuments.length && !selectedSections.length) {
      for (const node of selectedCollections) {
        const rows = db.prepare(`
          SELECT h.*
          FROM kc_hierarchy_nodes h
          WHERE h.node_type = 'document'
            AND h.collection_id = ?
            AND (? = '' OR h.batch_id = ?)
          ORDER BY h.updated_at DESC
          LIMIT ?
        `).all(node.collectionId || node.targetId, batchId, batchId, branchTopK);
        for (const row of rows) {
          const documentId = row.document_id || row.target_id;
          selectedDocumentIds.add(documentId);
          nonOutlineDocumentIds.add(documentId);
          documentScores.set(documentId, Math.max(documentScores.get(documentId) || 0, node.score * 0.75));
        }
      }
    }
    if (!selectedDocumentIds.size && nodes.length) {
      for (const node of nodes.filter((entry) => entry.nodeType === "document").slice(0, branchTopK)) {
        const documentId = node.documentId || node.targetId;
        selectedDocumentIds.add(documentId);
        nonOutlineDocumentIds.add(documentId);
        documentScores.set(documentId, Math.max(documentScores.get(documentId) || 0, node.score));
      }
    }
    return {
      enabled: true,
      policy: "coarse_to_fine",
      enforced: selectedDocumentIds.size > 0,
      topScore,
      threshold,
      selectedDocumentIds,
      selectedSectionIds,
      nonOutlineDocumentIds,
      outlineDocumentIds,
      outlineRoutes,
      documentScores,
      sectionScores,
      outlineScores,
      nodes,
      reasoning: reasoningDecision
        ? {
            enabled: true,
            usedModel: Boolean(reasoningDecision.usedModel),
            degraded: Boolean(reasoningDecision.degraded),
            selectedNodeIds: reasoningNodeIds,
            reason: reasoningDecision.reason || "",
            confidence: Number(reasoningDecision.confidence || 0)
          }
        : {
            enabled: false
          },
      selected: {
        collections: selectedCollections.slice(0, branchTopK),
        documents: selectedDocuments.slice(0, branchTopK),
        sections: selectedSections.slice(0, branchTopK),
        outlines: selectedOutlines.slice(0, branchTopK)
      }
    };
  }

  function hierarchyRouteForCandidate(candidate, plan) {
    if (!plan?.enabled || !candidate?.row) {
      return null;
    }
    const row = candidate.row;
    const documentScore = plan.documentScores.get(row.document_id) || 0;
    const sectionScore = row.section_id ? plan.sectionScores.get(row.section_id) || 0 : 0;
    const outlineRoute = outlineRouteForRow(row, plan);
    const outlineScore = outlineRoute?.score || 0;
    const score = Math.max(documentScore, sectionScore, outlineScore);
    if (score <= 0) {
      return null;
    }
    return {
      documentId: row.document_id || "",
      sectionId: row.section_id || "",
      score,
      outlineRoute,
      path: [
        row.batch_id ? `batch:${row.batch_id}` : "",
        row.document_id ? `document:${row.document_id}` : "",
        row.section_id ? `section:${row.section_id}` : "",
        outlineRoute?.hierarchyId ? `outline:${outlineRoute.hierarchyId}` : ""
      ].filter(Boolean).join(" > ")
    };
  }

  function outlineRouteForRow(row = {}, plan = {}) {
    const position = Number(row.position || 0);
    for (const route of asArray(plan.outlineRoutes)) {
      if (route.documentId && route.documentId !== row.document_id) {
        continue;
      }
      if (sourceRangeContainsPosition(route.sourceRange, position)) {
        return route;
      }
    }
    return null;
  }

  function candidateAllowedByHierarchy(candidate, plan) {
    if (!plan?.enabled || !plan.enforced) {
      return true;
    }
    const row = candidate?.row || {};
    const outlineRoute = outlineRouteForRow(row, plan);
    if (outlineRoute) {
      return true;
    }
    if (
      plan.outlineDocumentIds?.has?.(row.document_id) &&
      !plan.nonOutlineDocumentIds?.has?.(row.document_id) &&
      !(row.section_id && plan.selectedSectionIds.has(row.section_id))
    ) {
      return false;
    }
    return plan.selectedDocumentIds.has(row.document_id) ||
      (row.section_id && plan.selectedSectionIds.has(row.section_id));
  }

  function hierarchyBackoffCandidates({ plan, limit = 16 }) {
    if (!plan?.enabled || !plan.enforced) {
      return [];
    }
    const safeLimit = Math.max(1, Math.min(Number(limit || 16), 80));
    const outlineRoutes = asArray(plan.outlineRoutes)
      .filter((route) => route.documentId && sourceRangeContainsPosition(route.sourceRange, Number(route.sourceRange?.blockStart || 0)))
      .slice(0, safeLimit);
    const candidates = [];
    if (outlineRoutes.length) {
      const perRouteLimit = Math.max(1, Math.ceil(safeLimit / outlineRoutes.length));
      for (const route of outlineRoutes) {
        const start = Number(route.sourceRange?.blockStart || 0);
        const end = Number(route.sourceRange?.blockEnd || 0);
        const rows = db.prepare(`
          SELECT
            b.*,
            d.batch_id,
            d.title AS document_title,
            d.source_path AS document_source_path,
            d.source_hash AS document_source_hash,
            d.metadata_json AS document_metadata_json,
            d.created_at AS document_created_at,
            d.updated_at AS document_updated_at
          FROM kc_blocks b
          JOIN kc_documents d ON d.document_id = b.document_id
          WHERE b.document_id = ?
            AND (? <= 0 OR b.position >= ?)
            AND (? <= 0 OR b.position <= ?)
          ORDER BY b.position ASC, b.updated_at DESC
          LIMIT ?
        `).all(route.documentId, start, start, end, end, perRouteLimit);
        for (const row of rows) {
          candidates.push({
            targetType: "block",
            row,
            score: Math.max(0.05, Number(route.score || 0.12) * 0.84),
            reason: "hierarchy-outline-backoff"
          });
        }
      }
      if (candidates.length >= safeLimit) {
        return candidates.slice(0, safeLimit);
      }
    }
    const documentIds = [
      ...(plan.nonOutlineDocumentIds?.size ? [...plan.nonOutlineDocumentIds] : []),
      ...[...plan.selectedDocumentIds].filter((id) => !plan.outlineDocumentIds?.has?.(id))
    ].slice(0, safeLimit);
    for (const documentId of documentIds) {
      const rows = db.prepare(`
        SELECT
          b.*,
          d.batch_id,
          d.title AS document_title,
          d.source_path AS document_source_path,
          d.source_hash AS document_source_hash,
          d.metadata_json AS document_metadata_json,
          d.created_at AS document_created_at,
          d.updated_at AS document_updated_at
        FROM kc_blocks b
        JOIN kc_documents d ON d.document_id = b.document_id
        WHERE b.document_id = ?
        ORDER BY b.position ASC, b.updated_at DESC
        LIMIT ?
      `).all(documentId, Math.max(1, Math.ceil(safeLimit / Math.max(1, documentIds.length))));
      const documentScore = plan.documentScores.get(documentId) || 0.12;
      for (const row of rows) {
        candidates.push({
          targetType: "block",
          row,
          score: Math.max(0.05, documentScore * 0.72),
          reason: "hierarchy-backoff"
        });
      }
    }
    return candidates.slice(0, safeLimit);
  }

  function serializeHierarchyPlan(plan, limit = 8) {
    if (!plan?.enabled) {
      return {
        enabled: false,
        policy: plan?.policy || "disabled",
        enforced: false
      };
    }
    const summarize = (node) => ({
      hierarchyId: node.hierarchyId,
      nodeType: node.nodeType,
      level: node.level,
      targetId: node.targetId,
      documentId: node.documentId,
      sectionId: node.sectionId,
      title: node.title,
      categoryPath: node.categoryPath,
      score: node.score
    });
    return {
      enabled: true,
      policy: plan.policy,
      enforced: plan.enforced,
      topScore: Number((plan.topScore || 0).toFixed(6)),
      threshold: Number((plan.threshold || 0).toFixed(6)),
      selected: {
        collections: plan.selected.collections.map(summarize).slice(0, limit),
        documents: plan.selected.documents.map(summarize).slice(0, limit),
        sections: plan.selected.sections.map(summarize).slice(0, limit),
        outlines: asArray(plan.selected.outlines).map(summarize).slice(0, limit)
      },
      outlineRoutes: asArray(plan.outlineRoutes).slice(0, limit).map((route) => ({
        hierarchyId: route.hierarchyId,
        title: route.title,
        documentId: route.documentId,
        sectionId: route.sectionId,
        score: Number(route.score || 0),
        sourceRange: route.sourceRange || {},
        origin: route.origin || "",
        quality: route.quality || {}
      })),
      reasoning: {
        enabled: Boolean(plan.reasoning?.enabled),
        usedModel: Boolean(plan.reasoning?.usedModel),
        degraded: Boolean(plan.reasoning?.degraded),
        selectedNodeIds: asArray(plan.reasoning?.selectedNodeIds).slice(0, limit),
        reason: plan.reasoning?.reason || "",
        confidence: Number(plan.reasoning?.confidence || 0)
      },
      candidates: plan.nodes.map(summarize).slice(0, limit)
    };
  }

  function renderEvidenceMarkdown(evidence) {
    const payload = evidence.payload || {};
    const document = payload.document || {};
    const section = payload.section || {};
    const blocks = asArray(payload.blocks);
    const assets = asArray(payload.assets);
    const machineReadable = {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      evidenceId: evidence.evidenceId,
      score: evidence.score,
      documentId: document.documentId || "",
      documentType: document.documentType || "",
      sectionId: section.sectionId || "",
      modalities: [
        blocks.length ? "text" : "",
        assets.length ? "image" : ""
      ].filter(Boolean),
      source: evidence.locator || {},
      reasons: evidence.reasons || []
    };
    const lines = [
      "---",
      "pact_knowledge:",
      `  protocolVersion: ${machineReadable.protocolVersion}`,
      `  evidenceId: ${machineReadable.evidenceId}`,
      `  score: ${Number(machineReadable.score || 0).toFixed(4)}`,
      `  documentId: ${machineReadable.documentId}`,
      `  documentType: ${machineReadable.documentType}`,
      `  sectionId: ${machineReadable.sectionId}`,
      `  modalities: [${machineReadable.modalities.join(", ")}]`,
      "---",
      "",
      `# ${evidence.title || document.title || "知识证据"}`,
      "",
      evidence.snippet ? `> ${evidence.snippet}` : "",
      "",
      "## 命中文本",
      "",
      ...(blocks.length
        ? blocks.flatMap((block) => [
            `### ${block.title || block.blockType || "文本片段"}`,
            "",
            block.text || block.snippet || "",
            ""
          ])
        : ["暂无文本片段。", ""]),
      assets.length ? "## 相关图片" : "",
      "",
      ...assets.flatMap((asset) => [
        asset.assetId ? `![${asset.title || "image"}](/api/knowledge/assets/${encodeURIComponent(asset.assetId)})` : `**${asset.title || "图片资产"}**`,
        "",
        asset.caption ? `说明：${asset.caption}` : "说明：缺少视觉说明。",
        asset.ocrText ? `OCR：${asset.ocrText}` : "OCR：缺失。",
        asset.sourceLocator ? `来源：\`${JSON.stringify(asset.sourceLocator)}\`` : "",
        ""
      ]),
      "## 来源定位",
      "",
      "```json",
      JSON.stringify(machineReadable, null, 2),
      "```",
      ""
    ].filter((line) => line !== undefined);
    return lines.join("\n");
  }

  function saveEvidence(candidate, query, combinedScore, reasons) {
    const row = candidate.row;
    const isAsset = candidate.targetType === "asset";
    const block = isAsset ? null : hydrateBlock(row);
    const asset = isAsset ? hydrateAsset(row) : null;
    const documentId = row.document_id;
    const sectionId = row.section_id || "";
    const document = loadDocument(documentId);
    const section = loadSection(sectionId);
    const blocks = block
      ? [block]
      : db.prepare(`
          SELECT * FROM kc_blocks
          WHERE document_id = ? AND (? = '' OR section_id = ?)
          ORDER BY position ASC, block_id ASC
          LIMIT 3
        `).all(documentId, sectionId, sectionId).map(hydrateBlock);
    let assets = asset
      ? [asset]
      : loadAssetsForScope({ documentId, sectionId, limit: 8 });
    if (!asset && assets.length === 0) {
      assets = loadAssetsForBatch({ batchId: document?.batchId || "", limit: 8 });
    }
    const unifiedSource = document?.metadata?.unifiedSource || {};
    const snippet = truncateText(
      (block ? bestSnippetForQuery(`${block.title || ""}\n${block.snippet || ""}\n${block.text || ""}`, query, candidate) : "") ||
        (block ? searchableBlockSnippet(block) || searchableBlockText(block, 1200) : "") ||
        asset?.caption ||
        asset?.ocrText ||
        asset?.text ||
        document?.summary ||
        ""
    );
    const evidenceId = stableId("evidence", query, candidate.targetType, isAsset ? asset.assetId : block.blockId);
    const evidence = {
      evidenceId,
      batchId: document?.batchId || "",
      documentId,
      sectionId,
      blockId: block?.blockId || asset?.blockId || "",
      assetId: asset?.assetId || "",
      title: block?.title || asset?.title || document?.title || "知识证据",
      snippet,
      score: Number(combinedScore.toFixed(4)),
      reasons,
      locator: compactObject({
        query,
        documentId,
        sectionId,
        blockId: block?.blockId || "",
        assetId: asset?.assetId || "",
        sourcePath: document?.sourcePath || "",
        sourceId: document?.sourceId || "",
        batchId: document?.batchId || "",
        sourceType: unifiedSource.sourceType || document?.documentType || "",
        providerId: unifiedSource.providerId || "",
        externalId: unifiedSource.externalId || "",
        syncBatchId: unifiedSource.syncBatchId || "",
        contentHash: unifiedSource.contentHash || document?.sourceHash || "",
        capturedAt: unifiedSource.capturedAt || document?.updatedAt || "",
        originalFileName: unifiedSource.originalFileName || "",
        chatRef: unifiedSource.sourceType === "chat"
          ? compactObject({
              providerId: unifiedSource.providerId || "",
              externalId: unifiedSource.externalId || "",
              syncBatchId: unifiedSource.syncBatchId || ""
            })
          : undefined,
        fileRef: unifiedSource.sourceType && unifiedSource.sourceType !== "chat"
          ? compactObject({
              providerId: unifiedSource.providerId || "",
              externalId: unifiedSource.externalId || "",
              storageRelativePath: unifiedSource.storageRelativePath || "",
              originalFileName: unifiedSource.originalFileName || ""
            })
          : undefined
      }),
      payload: {
        document,
        section,
        blocks,
        assets
      }
    };
    const markdown = renderEvidenceMarkdown(evidence);
    db.prepare(`
      INSERT INTO kc_evidence_packs (
        evidence_id, batch_id, document_id, section_id, block_id, asset_id, title,
        snippet, score, reasons_json, locator_json, payload_json, markdown, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(evidence_id) DO UPDATE SET
        score = excluded.score,
        reasons_json = excluded.reasons_json,
        locator_json = excluded.locator_json,
        payload_json = excluded.payload_json,
        markdown = excluded.markdown,
        created_at = excluded.created_at
    `).run(
      evidence.evidenceId,
      evidence.batchId,
      evidence.documentId,
      evidence.sectionId,
      evidence.blockId,
      evidence.assetId,
      evidence.title,
      evidence.snippet,
      evidence.score,
      stringifyJson(evidence.reasons, []),
      stringifyJson(evidence.locator),
      stringifyJson(evidence.payload),
      markdown,
      nowIso()
    );
    return {
      ...evidence,
      markdown
    };
  }

  function search(input = {}) {
    const baseSettings = getSettings();
    const retrievalMode = String(input.retrievalMode || input.mode || "").trim().toLowerCase();
    const keywordOnly = input.keywordOnly === true || retrievalMode === "keyword" || retrievalMode === "lexical";
    const learningEnabled = !keywordOnly && input.learningEnabled !== false && baseSettings.learning?.enabled !== false;
    const profileRoute = learningEnabled
      ? resolveSearchProfile(input)
      : { profile: null, deployment: null, routedBy: "learning_disabled" };
    const activeProfile = profileRoute.profile;
    const settings = {
      ...baseSettings,
      retrieval: {
        ...(baseSettings.retrieval || {}),
        ...(learningEnabled ? retrievalSettingsFromProfile(baseSettings, activeProfile) : {}),
        ...(input.retrievalProfile || input.profile?.retrieval || {})
      }
    };
    const query = normalizeText(input.query || input.q || "");
    const safeLimit = Math.max(1, Math.min(Number(input.limit || settings.retrieval.topK || 20), 100));
    const candidateLimit = Math.max(safeLimit * 8, 80);
    const batchId = String(input.batchId || "").trim();
    const scopeSourceIds = asArray(input.scopeSourceIds || input.sourceIds || []).map((id) => String(id || "").trim()).filter(Boolean);
    const taxonomy = activeTaxonomy();
    const modalityPolicy = {
      mode: "multimodal",
      text: true,
      image: true,
      filtersAllowed: false
    };
    const queryIntent = resolveQueryIntentProfile(query, taxonomy);
    const queryTokens = queryTermsForSearch(query, queryIntent);
    const queryQualityTerms = queryTerms(query);
    const specificTerms = specificQueryTermsForIntent(query, queryIntent);
    const recencyReferenceMs = Date.now();
    const hierarchyReasoningRequested =
      input.hierarchyReasoning === true ||
      settings.retrieval.hierarchyReasoningEnabled === true;
    const hierarchyReasoningDecision = hierarchyReasoningRequested
      ? input.hierarchyReasoningDecision || {
          enabled: true,
          usedModel: false,
          degraded: false,
          ...deterministicHierarchyReasoning({
            query,
            nodes: compactTreeForReasoning({
              query,
              batchId,
              limit: settings.retrieval.outlineMaxTreeNodes || 80
            }),
            limit: 8
          })
        }
      : null;
    const hierarchyPlan = buildHierarchyPlan({
      query,
      queryTokens,
      batchId,
      sourceIds: scopeSourceIds,
      settings,
      safeLimit,
      reasoningDecision: hierarchyReasoningDecision
    });
    const merged = new Map();
    const feedbackBoostWeight = clampNumber(settings.retrieval.feedbackBoost, 0, 1, 0.08);
    const graphWeight = clampNumber(settings.retrieval.graphWeight, 0, 1, 0.05);
    const feedbackScoreStmt = feedbackBoostWeight > 0
      ? db.prepare(`
          SELECT COALESCE(SUM(
            CASE
              WHEN lower(replace(action, '-', '_')) IN ('open', 'copy', 'export', 'thumb_up', 'thumbup') THEN 1
              WHEN lower(replace(action, '-', '_')) IN ('thumb_down', 'thumbdown') THEN -1
              ELSE 0
            END
          ), 0) AS score
          FROM kc_feedback
          WHERE evidence_id = ? OR item_id IN (?, ?, ?)
        `)
      : null;
    const graphHintStmt = graphWeight > 0
      ? db.prepare(`
          SELECT COUNT(*) AS count, COALESCE(SUM(weight), 0) AS score
          FROM kc_relationships
          WHERE source_id IN (?, ?, ?) OR target_id IN (?, ?, ?)
        `)
      : null;

    function addCandidate(candidate, weight) {
      const id = candidate.targetType === "asset" ? candidate.row.asset_id : candidate.row.block_id;
      const key = `${candidate.targetType}::${id}`;
      const row = candidate.row || {};
      const current = merged.get(key) || {
        ...candidate,
        combinedScore: 0,
        reasons: []
      };
      current.combinedScore += Number(candidate.score || 0) * weight;
      current.reasons.push({
        kind: candidate.reason,
        score: Number(candidate.score || 0),
        weight
      });
      if (!current.recency?.applied) {
        const recencyWeight = clampNumber(settings.retrieval.recencyWeight, 0, 1, 0.08);
        const temporalSource = candidateTemporalSource(candidate.row || {});
        if (recencyWeight > 0 && temporalSource.timestamp > 0) {
          const recencyScore = exponentialRecencyScore(
            temporalSource.timestamp,
            recencyReferenceMs,
            settings.retrieval
          );
          current.combinedScore += recencyScore * recencyWeight;
          current.recency = {
            applied: true,
            mode: "exponential_half_life",
            score: Number(recencyScore.toFixed(6)),
            weight: recencyWeight,
            timestamp: temporalSource.value,
            halfLifeDays: clampNumber(settings.retrieval.recencyHalfLifeDays, 1, 3650, 45)
          };
        }
      }
      if (!current.queryMatchQuality?.applied) {
        const queryMatchWeight = clampNumber(settings.retrieval.queryMatchWeight, 0, 1, 0.12);
        if (queryMatchWeight > 0) {
          const matchQuality = queryMatchQualityScore(
            query,
            candidateIntentText(candidate),
            queryQualityTerms
          );
          current.combinedScore += matchQuality.score * queryMatchWeight;
          current.queryMatchQuality = {
            applied: true,
            ...matchQuality,
            weight: queryMatchWeight
          };
          current.reasons.push({
            kind: "query-match-quality",
            score: matchQuality.score,
            coverage: matchQuality.coverage,
            orderedCoverage: matchQuality.orderedCoverage,
            proximity: matchQuality.proximity,
            exactPhrase: matchQuality.exactPhrase,
            weight: queryMatchWeight
          });
        }
      }
      if (!current.feedback?.applied && feedbackScoreStmt) {
        const evidenceId = stableId("evidence", query, candidate.targetType, id);
        const rawFeedbackScore = Number(
          feedbackScoreStmt.get(evidenceId, id, row.document_id || "", row.section_id || "")?.score || 0
        );
        if (rawFeedbackScore !== 0) {
          const feedbackScore = clampNumber(rawFeedbackScore / 5, -1, 1, 0);
          current.combinedScore += feedbackScore * feedbackBoostWeight;
          current.feedback = {
            applied: true,
            score: Number(feedbackScore.toFixed(6)),
            rawScore: rawFeedbackScore,
            weight: feedbackBoostWeight
          };
          current.reasons.push({
            kind: "feedback-boost",
            score: Number(feedbackScore.toFixed(6)),
            rawScore: rawFeedbackScore,
            weight: feedbackBoostWeight
          });
        }
      }
      if (!current.graphHint?.applied && graphHintStmt) {
        const graphIds = [id, row.document_id || "", row.section_id || ""]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .slice(0, 3);
        if (graphIds.length) {
          const padded = [graphIds[0] || "", graphIds[1] || "", graphIds[2] || ""];
          const graphHint = graphHintStmt.get(...padded, ...padded);
          const graphCount = Number(graphHint?.count || 0);
          const rawGraphScore = Number(graphHint?.score || 0);
          if (graphCount > 0 && rawGraphScore > 0) {
            const graphScore = clampNumber(rawGraphScore / Math.max(1, graphCount), 0, 1, 0);
            current.combinedScore += graphScore * graphWeight;
            current.graphHint = {
              applied: true,
              score: Number(graphScore.toFixed(6)),
              relationCount: graphCount,
              weight: graphWeight
            };
            current.reasons.push({
              kind: "graph-hint",
              score: Number(graphScore.toFixed(6)),
              relationCount: graphCount,
              weight: graphWeight
            });
          }
        }
      }
      const hierarchyRoute = hierarchyRouteForCandidate(candidate, hierarchyPlan);
      if (hierarchyRoute) {
        const hierarchyWeight = Number(settings.retrieval.hierarchyWeight || 0.18);
        current.combinedScore += Number(hierarchyRoute.score || 0) * hierarchyWeight;
        current.hierarchyRoute = hierarchyRoute;
        current.reasons.push({
          kind: "hierarchy-route",
          score: Number(hierarchyRoute.score || 0),
          weight: hierarchyWeight,
          path: hierarchyRoute.path
        });
      }
      if (queryIntent) {
        const alignment = candidate.intentAlignment || evaluateCandidateIntent(candidate, queryIntent);
        candidate.intentAlignment = alignment;
        current.intentAlignment = alignment;
        if (alignment.score > 0) {
          const intentWeight = 0.42;
          current.combinedScore += alignment.score * intentWeight;
          current.reasons.push({
            kind: "query-intent-alignment",
            intentId: alignment.intentId,
            score: alignment.score,
            weight: intentWeight,
            positiveHits: alignment.positiveHits,
            anchorHits: alignment.anchorHits,
            queryAnchorHits: alignment.queryAnchorHits,
            strictAnchorHits: alignment.strictAnchorHits,
            strictQueryAnchorHits: alignment.strictQueryAnchorHits,
            negativeHits: alignment.negativeHits
          });
        }
      }
      merged.set(key, current);
    }

    const generatedCandidates = [];
    for (const candidate of lexicalBlockCandidates({ query, queryTokens, batchId, sourceIds: scopeSourceIds, limit: candidateLimit })) {
      generatedCandidates.push(candidate);
    }
    for (const candidate of lexicalAssetCandidates({ query, queryTokens, batchId, sourceIds: scopeSourceIds, limit: candidateLimit })) {
      generatedCandidates.push(candidate);
    }
    if (query && !keywordOnly) {
      for (const candidate of vectorCandidates({ query, queryTokens, batchId, sourceIds: scopeSourceIds, limit: candidateLimit, settings })) {
        generatedCandidates.push(candidate);
      }
    }
    const intentFilteredCandidates = queryIntent
      ? generatedCandidates.filter((candidate) => candidateAllowedByQueryIntent(candidate, queryIntent, specificTerms))
      : generatedCandidates;
    const hierarchyFilteredCandidates = hierarchyPlan.enforced
      ? intentFilteredCandidates.filter((candidate) => candidateAllowedByHierarchy(candidate, hierarchyPlan))
      : intentFilteredCandidates;
    const branchCandidates = hierarchyPlan.enforced
      ? hierarchyFilteredCandidates
      : intentFilteredCandidates;
    const rawBackoffCandidates = hierarchyPlan.enforced
      ? hierarchyBackoffCandidates({
          plan: hierarchyPlan,
          limit: settings.retrieval.hierarchyBackoffLimit || 16
        })
      : [];
    const backoffCandidates = queryIntent
      ? rawBackoffCandidates.filter((candidate) => candidateAllowedByQueryIntent(candidate, queryIntent, specificTerms))
      : rawBackoffCandidates;
    const fineCandidates = [
      ...branchCandidates,
      ...(
        branchCandidates.length < Number(settings.retrieval.hierarchyMinBranchCandidates || 3)
          ? backoffCandidates
          : []
      )
    ];

    for (const candidate of fineCandidates) {
      if (candidate.targetType === "asset") {
        addCandidate(candidate, Number(settings.retrieval.imageWeight || 0.15));
        continue;
      }
      if (candidate.reason === "text-vector") {
        addCandidate(candidate, Number(settings.retrieval.vectorWeight || 0.3));
        continue;
      }
      addCandidate(candidate, Number(settings.retrieval.bm25Weight || 0.55));
    }

    const fused = learningEnabled && typeof learningRuntime.fuseCandidatesSync === "function"
      ? learningRuntime.fuseCandidatesSync({
          query,
          profile: activeProfile,
          candidates: [...merged.values()],
          explain: Boolean(input.explain)
        })
      : {
          runtime: "builtin-score-sort",
          candidates: [...merged.values()].sort((left, right) => right.combinedScore - left.combinedScore),
          explanations: []
        };
    const fusedScoreByKey = new Map(asArray(fused.explanations).map((entry) => [entry.key, entry.fusedScore]));
    function localCandidateKey(candidate) {
      const id = candidate.targetType === "asset" ? candidate.row.asset_id : candidate.row.block_id;
      return `${candidate.targetType}::${id}`;
    }
    const rankedCandidates = dedupeResultCandidates(fused.candidates);

    let items = rankedCandidates
      .slice(0, safeLimit)
      .map((candidate) => {
        const combinedScore = Number(
          fusedScoreByKey.get(localCandidateKey(candidate)) || candidate.combinedScore || candidate.score || 0
        );
        const evidenceReasons = candidate.recency?.applied
          ? [
              ...(candidate.reasons || []),
              {
                kind: "time-decay",
                mode: candidate.recency.mode,
                score: candidate.recency.score,
                weight: candidate.recency.weight,
                timestamp: candidate.recency.timestamp,
                halfLifeDays: candidate.recency.halfLifeDays
              }
            ]
          : candidate.reasons;
        const evidence = saveEvidence(candidate, query, combinedScore, evidenceReasons);
        const document = evidence.payload.document || {};
        return {
          evidenceId: evidence.evidenceId,
          itemId: document.documentId || evidence.documentId,
          itemType: document.documentType || "",
          documentId: evidence.documentId,
          batchId: evidence.batchId,
          title: evidence.title,
          snippet: evidence.snippet,
          score: evidence.score,
          modalities: [
            evidence.payload.blocks?.length ? "text" : "",
            evidence.payload.assets?.length ? "image" : ""
          ].filter(Boolean),
          source: evidence.locator,
          reasons: evidence.reasons,
          hierarchy: candidate.hierarchyRoute || hierarchyRouteForCandidate(candidate, hierarchyPlan) || null,
          assets: evidence.payload.assets || []
        };
      });
    const localQueryHits = localQueryHitsFromInput(input);
    const localFusion = fuseLocalMirrorWithKnowledgeItems({
      items,
      localHits: localQueryHits,
      query,
      settings,
      limit: safeLimit,
      explain: Boolean(input.explain),
      referenceMs: recencyReferenceMs
    });
    items = localFusion.items;

    const responseProfile = normalizeSearchResponseProfile(input.responseProfile || input.requestSurface || input.surface || "") || "api";
    const result = {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      responseProfile,
      query,
      batchId,
      limit: safeLimit,
      retrievalMode: keywordOnly ? "keyword" : "hybrid",
      modalityPolicy,
      learningEnabled,
      retrievalProfileId: activeProfile?.profileId || settings.retrieval.retrievalProfileId || "balanced",
      retrievalProfileVersion: activeProfile?.version || 1,
      retrievalProfileKey: activeProfile?.profileKey || "",
      profileRoute: {
        routedBy: profileRoute.routedBy,
        bucket: profileRoute.bucket,
        deploymentId: profileRoute.deployment?.deploymentId || "",
        deploymentStatus: profileRoute.deployment?.status || "",
        trafficPercent: profileRoute.deployment?.trafficPercent || 0
      },
      retrievalProfile: settings.retrieval,
      queryIntent: queryIntent
        ? {
            intentId: queryIntent.intentId,
            label: queryIntent.label,
            taxonomyPath: queryIntent.taxonomyPath,
            taxonomyVersion: taxonomy?.version || 0,
            enforced: true
          }
        : null,
      hierarchy: serializeHierarchyPlan(hierarchyPlan),
      learningRuntime: {
        protocolVersion: LEARNING_RUNTIME_PROTOCOL_VERSION,
        runtime: fused.runtime || "builtin-deterministic-fallback",
        degraded: fused.degraded !== false
      },
      fusion: localFusion.fusion || {
        mode: "server-index-only",
        localQueryRemoteCalls: false,
        serverItemCount: items.length,
        localHitCount: 0,
        localMergedCount: 0,
        localAppendedCount: 0
      },
      explain: input.explain
        ? {
            fusionMode: activeProfile?.fusionMode || "reciprocal_rank",
            candidateCount: merged.size,
            dedupedCandidateCount: rankedCandidates.length,
            generatedCandidateCount: generatedCandidates.length,
            intentCandidateCount: intentFilteredCandidates.length,
            specificQueryTerms: specificTerms,
            hierarchyCandidateCount: hierarchyFilteredCandidates.length,
            hierarchyBackoffCount: backoffCandidates.length,
            hierarchy: serializeHierarchyPlan(hierarchyPlan, 12),
            localMirrorFusion: localFusion.fusion,
            explanations: asArray(fused.explanations).slice(0, safeLimit)
          }
        : undefined,
      items
    };
    if (shouldAttachAgentSearchMessage(input)) {
      result.responseProfile = "agent";
      result.agentMessage = buildKnowledgeSearchAgentMessage(result, input);
    }
    return result;
  }

  function recordFeedback(input = {}) {
    const timestamp = input.createdAt || nowIso();
    const action = String(input.action || input.event || "").trim().replace(/-/g, "_");
    if (!action) {
      throw new Error("knowledge.feedback.record 缺少 action。");
    }
    const feedbackId =
      String(input.feedbackId || "").trim() ||
      stableId(
        "feedback",
        input.clientId || "",
        input.query || "",
        action,
        input.evidenceId || input.itemId || "",
        timestamp
      );
    insertFeedbackStmt.run(
      feedbackId,
      String(input.clientId || ""),
      normalizeText(input.query || input.q || ""),
      action,
      String(input.itemId || ""),
      String(input.evidenceId || ""),
      Number(input.resultRank || input.rank || 0),
      stringifyJson(input.context || {}),
      timestamp
    );
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      feedback: hydrateFeedback(db.prepare("SELECT * FROM kc_feedback WHERE feedback_id = ?").get(feedbackId))
    };
  }

  function feedbackSince({ windowHours = 168, limit = 1000 } = {}) {
    const sinceDate = new Date(Date.now() - Math.max(1, Number(windowHours || 168)) * 60 * 60 * 1000);
    return selectFeedbackStmt
      .all(sinceDate.toISOString(), Math.max(1, Math.min(Number(limit || 1000), 10000)))
      .map(hydrateFeedback);
  }

  function listSuggestions({ status = "pending", limit = 100 } = {}) {
    const normalizedStatus = String(status || "").trim();
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      status: normalizedStatus,
      items: listSuggestionsStmt
        .all(normalizedStatus, normalizedStatus, Math.max(1, Math.min(Number(limit || 100), 500)))
        .map(hydrateSuggestion)
    };
  }

  function resolveSuggestion({ suggestionId, resolution = "reject", patch = {} } = {}) {
    const current = hydrateSuggestion(selectSuggestionStmt.get(String(suggestionId || "")));
    if (!current) {
      return null;
    }
    const timestamp = nowIso();
    const action = String(resolution || "").trim() || "reject";
    let appliedProfile = null;
    if ((action === "accept" || action === "merge") && current.type === "retrievalProfile") {
      const proposedProfile = action === "merge" ? { ...(current.proposedPatch || {}), ...(patch || {}) } : current.proposedPatch;
      appliedProfile = persistRetrievalProfile(proposedProfile, {
        active: true,
        timestamp
      });
    }
    insertSuggestionStmt.run(
      current.suggestionId,
      current.type,
      current.confidence,
      stringifyJson(current.proposedPatch),
      stringifyJson(current.evidenceRefs, []),
      action === "accept" || action === "merge" ? "resolved" : "rejected",
      current.createdAt,
      timestamp,
      timestamp,
      stringifyJson({
        resolution: action,
        patch,
        appliedProfile
      })
    );
    const resolved = hydrateSuggestion(selectSuggestionStmt.get(current.suggestionId));
    appendMirrorChange({
      kind: "suggestion",
      action: resolved.status,
      entityId: resolved.suggestionId,
      itemId: resolved.suggestionId,
      payload: resolved,
      at: timestamp
    });
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      ...resolved,
      appliedProfile
    };
  }

  function listReviewItems({ status = "pending", limit = 100 } = {}) {
    const normalizedStatus = String(status || "").trim();
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      status: normalizedStatus,
      items: listReviewItemsStmt
        .all(normalizedStatus, normalizedStatus, Math.max(1, Math.min(Number(limit || 100), 500)))
        .map(hydrateReviewItem)
    };
  }

  function resolveReviewItem({ reviewId, resolution = "reject", patch = {} } = {}) {
    const current = hydrateReviewItem(selectReviewItemStmt.get(String(reviewId || "")));
    if (!current) {
      return null;
    }

    const timestamp = nowIso();
    const action = String(resolution || "").trim() || "reject";
    const incomingDocument = current.incomingRecord?.documentSnapshot || null;
    const currentDocuments = asArray(current.currentRecord?.documents);
    let resolvedDocument = null;
    let resolutionError = "";

    if (["accept", "replace"].includes(action)) {
      if (incomingDocument?.documentId) {
        const deleteIds = currentDocuments.map((item) => item.documentId).filter(Boolean);
        if (deleteIds.length > 0) {
          deleteKnowledgeDocumentsById(deleteIds);
        }
        upsertKnowledgeDocument(incomingDocument);
        resolvedDocument = loadDocument(incomingDocument.documentId);
      } else {
        resolutionError = "incoming_document_missing";
      }
    } else if (["keep_both", "merge"].includes(action)) {
      if (incomingDocument?.documentId) {
        upsertKnowledgeDocument(incomingDocument);
        resolvedDocument = loadDocument(incomingDocument.documentId);
      } else {
        resolutionError = "incoming_document_missing";
      }
    }

    const resolved = ["accept", "replace", "keep_both", "merge"].includes(action) && !resolutionError;
    const nextStatus = resolved ? "resolved" : "rejected";
    const resolutionRecord = {
      resolution: action,
      patch: patch || {},
      resolvedDocumentId: resolvedDocument?.documentId || "",
      error: resolutionError
    };
    upsertReviewItemStmt.run(
      current.reviewId,
      current.source || "knowledge-core",
      nextStatus,
      current.reason,
      current.severity || "medium",
      current.operationId || "",
      current.batchId || "",
      current.entityId || "",
      current.entityType || "",
      current.title || "",
      current.summary || "",
      stringifyJson(current.currentRecord),
      stringifyJson(current.incomingRecord),
      stringifyJson(current.evidenceRefs, []),
      current.createdAt,
      timestamp,
      timestamp,
      stringifyJson(resolutionRecord)
    );
    const reviewItem = hydrateReviewItem(selectReviewItemStmt.get(current.reviewId));
    appendMirrorChange({
      kind: "reviewItem",
      action: nextStatus,
      entityId: reviewItem.reviewId,
      itemId: reviewItem.entityId,
      batchId: reviewItem.batchId || "",
      payload: reviewItem,
      at: timestamp
    });
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      ...reviewItem,
      resolvedDocument
    };
  }

  function runLearningJob(input = {}) {
    const timestamp = nowIso();
    const runId = input.runId || stableId("learning", Date.now(), Math.random());
    const learningSettings = getSettings().learning || {};
    if (input.force !== true && learningSettings.enabled === false) {
      const output = {
        protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
        runId,
        status: "skipped",
        reason: "learning-disabled"
      };
      insertLearningRunStmt.run(
        runId,
        "skipped",
        stringifyJson(input),
        "{}",
        "{}",
        "{}",
        "[]",
        stringifyJson(output),
        timestamp,
        nowIso()
      );
      return output;
    }
    const activeProfile = resolveRetrievalProfile({
      profileId: input.retrievalProfileId || ""
    });
    const feedback = feedbackSince({
      windowHours: input.feedbackWindowHours || learningSettings.feedbackWindowHours || 168,
      limit: input.feedbackLimit || 1000
    });
    insertLearningRunStmt.run(
      runId,
      "running",
      stringifyJson(input),
      "{}",
      "{}",
      "{}",
      "[]",
      "{}",
      timestamp,
      ""
    );
    try {
      const proposal = learningRuntime.proposeProfile({
        activeProfile,
        feedback
      });
      const generatedSuggestions = [
        ...learningRuntime.generateSuggestions({
          feedback,
          activeProfile
        })
      ];
      const evaluationRequired = learningSettings.requireEvaluationBeforeProfileActivation !== false;
      const shouldAutoApply =
        input.autoApply !== false &&
        learningSettings.autoApplyRetrievalProfiles !== false &&
        feedback.length >= Number(learningSettings.minFeedbackForAutoTune || 1) &&
        (evaluationRequired ? proposal.autoApplicable : true);
      let activeProfileAfter = activeProfile;
      let candidateProfile = proposal.candidate;
      if (shouldAutoApply) {
        activeProfileAfter = persistRetrievalProfile(candidateProfile, {
          active: true,
          timestamp
        });
        candidateProfile = activeProfileAfter;
      } else {
        candidateProfile = persistRetrievalProfile(candidateProfile, {
          active: false,
          timestamp
        });
        generatedSuggestions.unshift({
          suggestionId: `suggestion::retrievalProfile::${candidateProfile.profileId}-${candidateProfile.version}`,
          type: "retrievalProfile",
          confidence: proposal.autoApplicable ? 0.78 : 0.48,
          proposedPatch: candidateProfile,
          evidenceRefs: [],
          status: "pending"
        });
      }
      const persistedSuggestions = generatedSuggestions.map((suggestion) => persistSuggestion(suggestion, { timestamp }));
      const output = {
        protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
        runId,
        status: "completed",
        feedbackCount: feedback.length,
        evaluationRequired,
        evaluationPassed: proposal.autoApplicable,
        autoAppliedProfileVersion: shouldAutoApply ? activeProfileAfter?.version || 0 : 0,
        activeProfile: activeProfileAfter,
        candidateProfile,
        generatedSuggestions: persistedSuggestions,
        generatedSuggestionCount: persistedSuggestions.length,
        counts: proposal.counts,
        metricsBefore: proposal.metricsBefore,
        metricsAfter: proposal.metricsAfter
      };
      insertLearningRunStmt.run(
        runId,
        "completed",
        stringifyJson(input),
        stringifyJson(proposal.metricsBefore),
        stringifyJson(proposal.metricsAfter),
        stringifyJson(candidateProfile),
        stringifyJson(persistedSuggestions, []),
        stringifyJson(output),
        timestamp,
        nowIso()
      );
      return output;
    } catch (error) {
      const output = {
        error: error instanceof Error ? error.message : String(error)
      };
      insertLearningRunStmt.run(
        runId,
        "failed",
        stringifyJson(input),
        "{}",
        "{}",
        "{}",
        "[]",
        stringifyJson(output),
        timestamp,
        nowIso()
      );
      return {
        protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
        runId,
        status: "failed",
        ...output
      };
    }
  }

  function ensureDeploymentProfile(input = {}) {
    const requestedKey = String(input.profileKey || input.retrievalProfileKey || input.profile?.profileKey || "").trim();
    if (requestedKey) {
      const profile = hydrateRetrievalProfile(selectProfileStmt.get(requestedKey));
      if (profile) {
        return profile;
      }
    }
    if (input.profile && typeof input.profile === "object") {
      return persistRetrievalProfile(input.profile, {
        active: false,
        timestamp: input.timestamp || nowIso()
      });
    }
    return null;
  }

  function upsertProfileDeployment(record = {}) {
    const timestamp = record.updatedAt || nowIso();
    const profile = ensureDeploymentProfile({
      profileKey: record.profileKey,
      profile: record.profile,
      timestamp
    });
    if (!profile) {
      throw new Error("retrieval profile deployment 缺少 profile 或 profileKey。");
    }
    const activeProfile = resolveRetrievalProfile();
    const deploymentId =
      String(record.deploymentId || "").trim() ||
      stableId("profileDeployment", profile.profileKey, record.status || "canary", timestamp);
    upsertProfileDeploymentStmt.run(
      deploymentId,
      profile.profileKey,
      profile.profileId,
      Number(profile.version || 1),
      String(record.status || "canary"),
      clampNumber(record.trafficPercent, 0, 100, Number(getSettings().learning?.canaryTrafficPercent || 10)),
      String(record.baselineProfileKey || activeProfile?.profileKey || ""),
      stringifyJson(record.metrics || {}),
      stringifyJson(record.gate || {}),
      String(record.reason || ""),
      record.createdAt || timestamp,
      timestamp,
      record.finishedAt || ""
    );
    const deployment = hydrateProfileDeployment(selectProfileDeploymentStmt.get(deploymentId));
    appendMirrorChange({
      kind: "retrieval_profile_deployment",
      action: deployment.status,
      entityId: deployment.deploymentId,
      itemId: deployment.profileKey,
      payload: deployment,
      at: timestamp
    });
    return deployment;
  }

  function listRetrievalProfileDeployments({ status = "", limit = 50 } = {}) {
    const normalizedStatus = String(status || "").trim();
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      deployments: listProfileDeploymentsStmt
        .all(normalizedStatus, normalizedStatus, Math.max(1, Math.min(Number(limit || 50), 500)))
        .map(hydrateProfileDeployment)
    };
  }

  function promoteRetrievalProfileDeployment({ deploymentId, reason = "" } = {}) {
    const current = hydrateProfileDeployment(selectProfileDeploymentStmt.get(String(deploymentId || "")));
    if (!current) {
      return null;
    }
    const profile = hydrateRetrievalProfile(selectProfileStmt.get(current.profileKey));
    if (!profile) {
      return null;
    }
    const timestamp = nowIso();
    const activeProfile = persistRetrievalProfile(profile, {
      active: true,
      timestamp
    });
    const deployment = upsertProfileDeployment({
      ...current,
      profile: activeProfile,
      status: "active",
      trafficPercent: 100,
      reason: reason || current.reason || "promoted_after_canary",
      updatedAt: timestamp
    });
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      deployment,
      activeProfile
    };
  }

  function rollbackRetrievalProfileDeployment({ deploymentId, reason = "" } = {}) {
    const current = hydrateProfileDeployment(selectProfileDeploymentStmt.get(String(deploymentId || "")));
    if (!current) {
      return null;
    }
    const baselineProfile = hydrateRetrievalProfile(selectProfileStmt.get(current.baselineProfileKey)) || resolveRetrievalProfile();
    const timestamp = nowIso();
    const activeProfile = baselineProfile
      ? persistRetrievalProfile(baselineProfile, {
          active: true,
          timestamp
        })
      : null;
    const deployment = upsertProfileDeployment({
      ...current,
      profileKey: current.profileKey,
      status: "rolled_back",
      trafficPercent: 0,
      reason: reason || current.reason || "manual_or_metric_rollback",
      updatedAt: timestamp,
      finishedAt: timestamp
    });
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      deployment,
      activeProfile
    };
  }

  function auditHierarchyIndex(input = {}) {
    ensureHierarchyIndexReady();
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 500));
    const splitThreshold = Math.max(5, Math.min(Number(input.splitThreshold || 80), 5000));
    const counts = db.prepare(`
      SELECT node_type AS nodeType, COUNT(*) AS count
      FROM kc_hierarchy_nodes
      GROUP BY node_type
    `).all();
    const missingDocumentNodes = db.prepare(`
      SELECT d.document_id AS documentId, d.title AS title, d.collection_id AS collectionId
      FROM kc_documents d
      LEFT JOIN kc_hierarchy_nodes h
        ON h.node_type = 'document' AND h.target_id = d.document_id
      WHERE h.hierarchy_id IS NULL
      LIMIT ?
    `).all(limit);
    const missingSectionNodes = db.prepare(`
      SELECT s.section_id AS sectionId, s.document_id AS documentId, s.title AS title
      FROM kc_sections s
      LEFT JOIN kc_hierarchy_nodes h
        ON h.node_type = 'section' AND h.target_id = s.section_id
      WHERE h.hierarchy_id IS NULL
      LIMIT ?
    `).all(limit);
    const orphanNodes = db.prepare(`
      SELECT child.hierarchy_id AS hierarchyId, child.node_type AS nodeType, child.target_id AS targetId,
             child.parent_hierarchy_id AS parentHierarchyId, child.title AS title
      FROM kc_hierarchy_nodes child
      LEFT JOIN kc_hierarchy_nodes parent
        ON child.parent_hierarchy_id = parent.hierarchy_id
      WHERE child.parent_hierarchy_id != '' AND parent.hierarchy_id IS NULL
      LIMIT ?
    `).all(limit);
    const emptyCoarseNodes = db.prepare(`
      SELECT hierarchy_id AS hierarchyId, node_type AS nodeType, target_id AS targetId, title
      FROM kc_hierarchy_nodes
      WHERE level <= 3
        AND length(trim(coalesce(title, '') || coalesce(summary, '') || coalesce(text, '') || coalesce(category_path, ''))) < 8
      LIMIT ?
    `).all(limit);
    const overloadedBranches = db.prepare(`
      SELECT parent_hierarchy_id AS parentHierarchyId, COUNT(*) AS documentCount
      FROM kc_hierarchy_nodes
      WHERE node_type = 'document' AND parent_hierarchy_id != ''
      GROUP BY parent_hierarchy_id
      HAVING COUNT(*) > ?
      ORDER BY documentCount DESC
      LIMIT ?
    `).all(splitThreshold, limit);

    const findings = [];
    const addFinding = (code, severity, rows, suggestionType, proposedPatch, confidence = 0.68) => {
      if (!rows.length) return;
      findings.push({
        findingId: stableId("hierarchyFinding", code, stringifyJson(rows.slice(0, 8))),
        code,
        severity,
        count: rows.length,
        samples: rows.slice(0, 8),
        suggestionType,
        confidence,
        proposedPatch,
        recommendedAction: proposedPatch.action,
        evidenceRefs: []
      });
    };

    addFinding("missing_document_hierarchy_nodes", "medium", missingDocumentNodes, "hierarchyRepair", {
      action: "rebuild_hierarchy_index",
      target: "documents"
    });
    addFinding("missing_section_hierarchy_nodes", "medium", missingSectionNodes, "hierarchyRepair", {
      action: "rebuild_hierarchy_index",
      target: "sections"
    });
    addFinding("orphan_hierarchy_nodes", "high", orphanNodes, "hierarchyRepair", {
      action: "repair_orphan_parents"
    }, 0.76);
    addFinding("empty_coarse_hierarchy_nodes", "medium", emptyCoarseNodes, "coarseNodeEnrichment", {
      action: "enrich_title_summary_or_category_path"
    });
    addFinding("overloaded_hierarchy_branches", "medium", overloadedBranches, "taxonomySplit", {
      action: "review_split_branch",
      splitThreshold
    }, 0.58);

    const suggestions = findings.map((finding) => ({
      suggestionId: stableId("suggestion", finding.suggestionType, finding.findingId),
      type: finding.suggestionType,
      confidence: finding.confidence,
      proposedPatch: {
        ...finding.proposedPatch,
        findingId: finding.findingId,
        count: finding.count,
        samples: finding.samples
      },
      evidenceRefs: finding.evidenceRefs,
      status: "pending"
    }));
    const persistedSuggestions = input.persistSuggestions === true
      ? suggestions.map((suggestion) => persistSuggestion(suggestion))
      : [];
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      ok: findings.length === 0,
      metrics: {
        nodeCounts: counts,
        missingDocumentNodeCount: missingDocumentNodes.length,
        missingSectionNodeCount: missingSectionNodes.length,
        orphanNodeCount: orphanNodes.length,
        emptyCoarseNodeCount: emptyCoarseNodes.length,
        overloadedBranchCount: overloadedBranches.length,
        splitThreshold
      },
      findings,
      suggestions,
      persistedSuggestions,
      policy: {
        canonicalTaxonomyMutationsAllowed: false,
        suggestionReviewRequired: true
      }
    };
  }

  async function learningHealth() {
    const runtimeHealth =
      typeof learningRuntime.health === "function" ? await learningRuntime.health() : null;
    const activeProfile = resolveRetrievalProfile();
    const feedbackCount = Number(db.prepare("SELECT COUNT(*) AS count FROM kc_feedback").get()?.count || 0);
    const pendingSuggestionCount = Number(
      db.prepare("SELECT COUNT(*) AS count FROM kc_knowledge_suggestions WHERE status = 'pending'").get()?.count || 0
    );
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      ok: true,
      degraded: runtimeHealth?.degraded !== false,
      activeProfile,
      feedbackCount,
      pendingSuggestionCount,
      recentRuns: listLearningRunsStmt.all(8).map(hydrateLearningRun),
      deployments: listRetrievalProfileDeployments({ limit: 8 }).deployments,
      learningRuntime: runtimeHealth,
      boundaries: {
        autoAppliesRetrievalProfiles: getSettings().learning?.autoApplyRetrievalProfiles !== false,
        requiresEvaluationBeforeProfileActivation: getSettings().learning?.requireEvaluationBeforeProfileActivation !== false,
        canaryEnabled: getSettings().learning?.canaryEnabled !== false,
        autoAppliesCanonicalFacts: false,
        requiresReviewForEntityRelationsTaxonomy: true
      }
    };
  }

  function getEvidence({ evidenceId }) {
    const row = db.prepare("SELECT * FROM kc_evidence_packs WHERE evidence_id = ?").get(String(evidenceId || ""));
    if (!row) return null;
    return {
      evidenceId: row.evidence_id,
      batchId: row.batch_id,
      documentId: row.document_id,
      sectionId: row.section_id,
      blockId: row.block_id,
      assetId: row.asset_id,
      title: row.title,
      snippet: row.snippet,
      score: Number(row.score || 0),
      reasons: parseJson(row.reasons_json, []),
      locator: parseJson(row.locator_json, {}),
      payload: parseJson(row.payload_json, {}),
      markdown: row.markdown,
      createdAt: row.created_at
    };
  }

  function saveDocumentEvidence({ documentId = "", query = "", score = 0.5, reasons = [] } = {}) {
    const document = loadDocument(documentId);
    if (!document) {
      return null;
    }
    const blocks = db.prepare(`
      SELECT * FROM kc_blocks
      WHERE document_id = ?
      ORDER BY position ASC, block_id ASC
      LIMIT 3
    `).all(documentId).map(hydrateBlock);
    const assets = loadAssetsForScope({ documentId, sectionId: "", limit: 8 });
    const snippet = truncateText(
      blocks.map((block) => block.snippet || block.text || "").find(Boolean) ||
        document.summary ||
        ""
    );
    const evidence = {
      evidenceId: stableId("evidence", query || "aggregate", "document", documentId),
      batchId: document.batchId || "",
      documentId,
      sectionId: "",
      blockId: blocks[0]?.blockId || "",
      assetId: "",
      title: document.title || "知识证据",
      snippet,
      score: Number(Math.max(0, Math.min(1, Number(score || 0.5))).toFixed(4)),
      reasons,
      locator: compactObject({
        query,
        documentId,
        sourcePath: document.sourcePath || "",
        sourceId: document.sourceId || "",
        batchId: document.batchId || ""
      }),
      payload: {
        document,
        section: null,
        blocks,
        assets
      }
    };
    const markdown = renderEvidenceMarkdown(evidence);
    db.prepare(`
      INSERT INTO kc_evidence_packs (
        evidence_id, batch_id, document_id, section_id, block_id, asset_id, title,
        snippet, score, reasons_json, locator_json, payload_json, markdown, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(evidence_id) DO UPDATE SET
        score = excluded.score,
        reasons_json = excluded.reasons_json,
        locator_json = excluded.locator_json,
        payload_json = excluded.payload_json,
        markdown = excluded.markdown,
        created_at = excluded.created_at
    `).run(
      evidence.evidenceId,
      evidence.batchId,
      evidence.documentId,
      evidence.sectionId,
      evidence.blockId,
      evidence.assetId,
      evidence.title,
      evidence.snippet,
      evidence.score,
      stringifyJson(evidence.reasons, []),
      stringifyJson(evidence.locator),
      stringifyJson(evidence.payload),
      markdown,
      nowIso()
    );
    return {
      ...evidence,
      markdown
    };
  }

  function aggregate(input = {}) {
    const metric = String(input.metric || input.kind || "").trim() || "email_advertising_by_sender";
    const groupBy = String(input.groupBy || input.group_by || "senderEmail").trim();
    const limit = Math.max(1, Math.min(Number(input.limit || 10), 50));
    const batchId = String(input.batchId || "").trim();
    const query = normalizeText(input.query || input.q || "");
    const classification = String(input.classification || input.category || "").trim().toLowerCase();
    const documentType = String(input.documentType || input.document_type || "email").trim();
    const taxonomy = activeTaxonomy();
    const category = aggregateCategoryForMetric({
      taxonomy,
      metric,
      categoryId: input.categoryId || input.category_id || (classification === "advertising" ? "marketing_promo" : ""),
      categoryPath: input.categoryPath || input.category_path || ""
    });
    const rows = db.prepare(`
      SELECT
        d.document_id,
        d.batch_id,
        d.document_type,
        d.title,
        d.summary,
        d.source_path,
        d.metadata_json,
        d.created_at,
        d.updated_at,
        (
          SELECT substr(b.text, 1, 16000)
          FROM kc_blocks b
          WHERE b.document_id = d.document_id
          ORDER BY b.position ASC
          LIMIT 1
        ) AS text,
        (
          SELECT ep.evidence_id
          FROM kc_evidence_packs ep
          WHERE ep.document_id = d.document_id
          ORDER BY ep.created_at DESC
          LIMIT 1
        ) AS evidence_id
      FROM kc_documents d
      WHERE (? = '' OR d.batch_id = ?)
        AND (? = '' OR d.document_type = ?)
      ORDER BY d.updated_at DESC
      LIMIT 20000
    `).all(batchId, batchId, documentType, documentType);
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
    const groups = new Map();
    let matchedDocumentCount = 0;
    for (const row of rows) {
      const text = String(row.text || "");
      const searchable = `${row.title}\n${row.summary}\n${text}`.toLowerCase();
      const advertisingMetric = metric === "email_advertising_by_sender" || classification === "advertising";
      let categoryMatch = { matches: true, score: 0, positiveHits: [], negativeHits: [] };
      if (advertisingMetric || category) {
        categoryMatch = documentMatchesAggregateCategory({
          title: row.title,
          text,
          category
        });
        if (!categoryMatch.matches) {
          continue;
        }
      }
      if (queryTerms.length && !queryTerms.every((term) => searchable.includes(term))) {
        continue;
      }
      let key = "";
      if (groupBy === "senderDomain") {
        key = emailDomain(extractEmailAddressFromDocumentText(text, "senderEmail"));
      } else if (groupBy === "recipientEmail") {
        key = extractEmailAddressFromDocumentText(text, "recipientEmail");
      } else if (groupBy === "recipientDomain") {
        key = emailDomain(extractEmailAddressFromDocumentText(text, "recipientEmail"));
      } else if (groupBy === "documentType") {
        key = row.document_type;
      } else {
        key = extractEmailAddressFromDocumentText(text, "senderEmail");
      }
      key = key || "unknown";
      matchedDocumentCount += 1;
      const current = groups.get(key) || {
        key,
        label: key,
        count: 0,
        evidenceRefs: [],
        examples: []
      };
      current.count += 1;
      if (row.evidence_id && !current.evidenceRefs.includes(row.evidence_id)) {
        current.evidenceRefs.push(row.evidence_id);
      }
      if (current.examples.length < 5) {
        current.examples.push({
          documentId: row.document_id,
          evidenceId: row.evidence_id || "",
          title: row.title,
          updatedAt: row.updated_at,
          sourcePath: row.source_path,
          categoryScore: Number(categoryMatch.score || 0),
          categoryHits: asArray(categoryMatch.positiveHits).slice(0, 6)
        });
      }
      groups.set(key, current);
    }
    const sortedGroups = [...groups.values()]
      .sort((left, right) => right.count - left.count || String(left.key).localeCompare(String(right.key)))
      .slice(0, limit);
    for (const group of sortedGroups) {
      for (const example of asArray(group.examples)) {
        if (example.evidenceId) {
          continue;
        }
        const evidence = saveDocumentEvidence({
          documentId: example.documentId,
          query: `aggregate:${metric}:${groupBy}:${group.key}`,
          score: example.categoryScore || 0.5,
          reasons: [
            {
              kind: "knowledge-aggregate",
              metric,
              groupBy,
              groupKey: group.key,
              categoryId: category?.categoryId || "",
              categoryPath: category?.path || ""
            }
          ]
        });
        if (evidence?.evidenceId) {
          example.evidenceId = evidence.evidenceId;
          if (!group.evidenceRefs.includes(evidence.evidenceId)) {
            group.evidenceRefs.push(evidence.evidenceId);
          }
        }
      }
    }
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      ok: true,
      metric,
      groupBy,
      filters: {
        batchId,
        documentType,
        classification: classification || (metric === "email_advertising_by_sender" ? "advertising" : ""),
        query,
        categoryId: category?.categoryId || "",
        categoryPath: category?.path || ""
      },
      taxonomy: taxonomy
        ? {
            checksum: taxonomy.checksum || "",
            version: taxonomy.version || 0,
            source: taxonomy.source || ""
          }
        : null,
      scannedDocumentCount: rows.length,
      matchedDocumentCount,
      groups: sortedGroups,
      topGroup: sortedGroups[0] || null,
      methodology:
        `Counts are computed over canonical knowledge documents. The aggregate category is resolved from knowledge-taxonomy/expert-vocabulary/email-rules at runtime (${category?.categoryId || "none"}${category?.path ? `: ${category.path}` : ""}); sender/recipient fields are parsed from email metadata/header text.`
    };
  }

  function renderMarkdown(input = {}) {
    let evidence = input.evidenceId ? getEvidence({ evidenceId: input.evidenceId }) : null;
    if (!evidence && (input.query || input.q)) {
      const result = search({
        query: input.query || input.q,
        limit: 1,
        batchId: input.batchId || ""
      });
      evidence = result.items[0]?.evidenceId ? getEvidence({ evidenceId: result.items[0].evidenceId }) : null;
    }
    if (!evidence) {
      return null;
    }
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      evidenceId: evidence.evidenceId,
      contentType: "text/markdown; charset=utf-8",
      markdown: evidence.markdown || renderEvidenceMarkdown(evidence)
    };
  }

  async function getAssetContent({ assetId }) {
    const asset = hydrateAsset(
      db.prepare("SELECT * FROM kc_assets WHERE asset_id = ?").get(String(assetId || ""))
    );
    if (!asset || !asset.relativePath) {
      return null;
    }
    const root = path.resolve(rootPath);
    const absolutePath = path.resolve(rootPath, asset.relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      throw new Error("知识库资产路径越界。");
    }
    const buffer = await fsp.readFile(absolutePath);
    return {
      asset,
      buffer,
      contentType: asset.mediaType || "application/octet-stream",
      fileName: path.basename(asset.relativePath)
    };
  }

  function getItem({ itemId, documentId } = {}) {
    const id = String(documentId || itemId || "").trim();
    const document = loadDocument(id);
    if (!document) return null;
    return {
      ...document,
      sections: db.prepare(`
        SELECT * FROM kc_sections
        WHERE document_id = ?
        ORDER BY position ASC, section_id ASC
      `).all(id).map(hydrateSection),
      blocks: loadBlocksForDocument(id, 100),
      assets: loadAssetsForScope({ documentId: id, limit: 100 })
    };
  }

  function compactStructureNode(node = {}) {
    const metadata = node.metadata || {};
    return {
      hierarchyId: node.hierarchyId,
      nodeId: node.hierarchyId,
      nodeType: node.nodeType,
      targetId: node.targetId,
      parentNodeId: node.parentHierarchyId || "",
      level: node.level,
      documentId: node.documentId || "",
      sectionId: node.sectionId || "",
      batchId: node.batchId || "",
      title: node.title || "",
      summary: node.summary || "",
      categoryPath: node.categoryPath || "",
      sourceRange: sourceRangeFromMetadata(metadata),
      origin: metadata.outlineOrigin || metadata.source || "",
      quality: metadata.quality || {},
      metadata: compactObject({
        outlineOrigin: metadata.outlineOrigin || "",
        sourceId: metadata.sourceId || "",
        sourceHash: metadata.sourceHash || "",
        position: metadata.position || 0
      }),
      children: []
    };
  }

  function getDocumentStructure({ documentId = "", maxNodes = 120 } = {}) {
    ensureHierarchyIndexReady();
    const id = String(documentId || "").trim();
    const document = loadDocument(id);
    if (!document) {
      return null;
    }
    let rows = db.prepare(`
      SELECT *
      FROM kc_hierarchy_nodes
      WHERE document_id = ?
      ORDER BY level ASC, target_id ASC
      LIMIT ?
    `).all(id, Math.max(1, Math.min(Number(maxNodes || 120), 500)));
    if (!rows.length) {
      const sections = db.prepare("SELECT * FROM kc_sections WHERE document_id = ? ORDER BY position ASC").all(id).map(hydrateSection);
      const blocks = db.prepare("SELECT * FROM kc_blocks WHERE document_id = ? ORDER BY position ASC").all(id).map(hydrateBlock);
      const assets = db.prepare("SELECT * FROM kc_assets WHERE document_id = ? ORDER BY asset_id ASC").all(id).map(hydrateAsset);
      buildDocumentHierarchy({ document, sections, blocks, assets });
      rows = db.prepare(`
        SELECT *
        FROM kc_hierarchy_nodes
        WHERE document_id = ?
        ORDER BY level ASC, target_id ASC
        LIMIT ?
      `).all(id, Math.max(1, Math.min(Number(maxNodes || 120), 500)));
    }
    const nodes = rows
      .map((row) => hydrateHierarchyNode(row))
      .filter((node) => ["document", "section", "outline"].includes(node?.nodeType));
    const byId = new Map(nodes.map((node) => [node.hierarchyId, compactStructureNode(node)]));
    const roots = [];
    for (const node of nodes) {
      const item = byId.get(node.hierarchyId);
      const parent = byId.get(node.parentHierarchyId);
      if (parent && parent.hierarchyId !== item.hierarchyId) {
        parent.children.push(item);
      } else {
        roots.push(item);
      }
    }
    const sortTree = (items = []) => {
      items.sort((left, right) => {
        const leftPosition = Number(left.sourceRange?.blockStart || left.metadata?.position || 0);
        const rightPosition = Number(right.sourceRange?.blockStart || right.metadata?.position || 0);
        if (leftPosition !== rightPosition) return leftPosition - rightPosition;
        if (left.level !== right.level) return left.level - right.level;
        return String(left.title || left.targetId).localeCompare(String(right.title || right.targetId));
      });
      for (const item of items) {
        sortTree(item.children);
      }
      return items;
    };
    const documentRoot = byId.get(hierarchyId("document", id));
    const tree = sortTree(documentRoot ? [documentRoot] : roots);
    const documentNode = nodes.find((node) => node.nodeType === "document");
    const nodeCounts = nodes.reduce((counts, node) => {
      counts[node.nodeType] = (counts[node.nodeType] || 0) + 1;
      return counts;
    }, {});
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      document,
      nodeCount: nodes.length,
      sourceStats: {
        nodeCounts,
        syntheticNodeCount: nodes.filter((node) => node.metadata?.quality?.synthetic === true).length,
        outlineNodeCount: nodeCounts.outline || 0,
        sectionNodeCount: nodeCounts.section || 0
      },
      qualityFindings: asArray(documentNode?.metadata?.outline?.qualityFindings),
      tree,
      nodes: nodes.map(compactStructureNode)
    };
  }

  function hydrateSyncRow(row) {
    return {
      cursor: String(row.cursor),
      kind: row.kind,
      action: row.action,
      entityId: row.entity_id || "",
      itemId: row.item_id || "",
      batchId: row.batch_id || "",
      revision: Number(row.revision || 0),
      serverUpdatedAt: row.server_updated_at,
      record: parseJson(row.payload_json, {})
    };
  }

  function ensureMirrorLogSeeded() {
    const currentCursor = Number(selectMaxSyncCursorStmt.get()?.cursor || 0);
    if (currentCursor > 0) {
      return;
    }
    const documentCount = Number(db.prepare("SELECT COUNT(*) AS count FROM kc_documents").get()?.count || 0);
    if (documentCount === 0) {
      return;
    }
    const timestamp = nowIso();
    for (const row of db.prepare("SELECT * FROM kc_documents ORDER BY updated_at ASC, document_id ASC").all()) {
      const document = hydrateDocument(row);
      appendMirrorChange({
        kind: "document",
        entityId: document.documentId,
        itemId: document.documentId,
        batchId: document.batchId || "",
        payload: document,
        at: document.updatedAt || timestamp
      });
    }
    for (const row of db.prepare("SELECT * FROM kc_sections ORDER BY document_id ASC, position ASC, section_id ASC").all()) {
      const section = hydrateSection(row);
      const document = loadDocument(section.documentId);
      appendMirrorChange({
        kind: "section",
        entityId: section.sectionId,
        itemId: section.documentId,
        batchId: document?.batchId || "",
        payload: {
          ...section,
          updatedAt: timestamp
        },
        at: timestamp
      });
    }
    for (const row of db.prepare("SELECT * FROM kc_blocks ORDER BY updated_at ASC, document_id ASC, position ASC, block_id ASC").all()) {
      const block = hydrateBlock(row);
      const document = loadDocument(block.documentId);
      appendMirrorChange({
        kind: "block",
        entityId: block.blockId,
        itemId: block.documentId,
        batchId: document?.batchId || "",
        payload: block,
        at: block.updatedAt || timestamp
      });
    }
    for (const row of db.prepare("SELECT * FROM kc_assets ORDER BY updated_at ASC, document_id ASC, asset_id ASC").all()) {
      const asset = hydrateAsset(row);
      const document = loadDocument(asset.documentId);
      const { relativePath, ...publicAsset } = asset;
      appendMirrorChange({
        kind: "asset",
        entityId: asset.assetId,
        itemId: asset.documentId,
        batchId: document?.batchId || "",
        payload: publicAsset,
        at: asset.updatedAt || timestamp
      });
    }
  }

  function syncMirror({ since = 0, limit = 500 } = {}) {
    const safeSince = Math.max(0, Number(since || 0));
    const safeLimit = Math.max(1, Math.min(Number(limit || 500), 2000));
    if (safeSince === 0) {
      ensureMirrorLogSeeded();
    }
    const rows = selectSyncLogStmt.all(safeSince, safeLimit);
    const maxCursor = Number(selectMaxSyncCursorStmt.get()?.cursor || 0);
    const lastCursor = rows.length > 0 ? Number(rows[rows.length - 1].cursor || 0) : safeSince;
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      scope: "mirror",
      cursor: String(Math.max(lastCursor, safeSince)),
      latestCursor: String(maxCursor),
      hasMore: rows.length >= safeLimit && lastCursor < maxCursor,
      cachePolicy: {
        scope: "mirror",
        storesFullEvidence: true,
        storesNormalizedDocuments: true,
        storesOriginalAttachments: false,
        primaryReadableFormat: "markdown"
      },
      changes: rows.map(hydrateSyncRow)
    };
  }

  function reindex(input = {}) {
    const runId = stableId("maintenance", "reindex", Date.now(), Math.random());
    const startedAt = nowIso();
    const settings = getSettings();
    const batchSize = Math.floor(clampNumber(
      input.batchSize ?? input.reindexBatchSize ?? settings.maintenance?.reindexBatchSize,
      1,
      5000,
      DEFAULT_SETTINGS.maintenance.reindexBatchSize
    ));
    db.prepare(`
      INSERT INTO kc_maintenance_runs (run_id, task_type, status, input_json, output_json, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, "reindex", "running", stringifyJson(input), "{}", startedAt);
    const textIndex = rebuildSearchIndexes();
    const blocks = db.prepare("SELECT * FROM kc_blocks").all().map(hydrateBlock);
    const assets = db.prepare("SELECT * FROM kc_assets").all().map(hydrateAsset);
    for (let index = 0; index < blocks.length; index += batchSize) {
      vectorStore.deleteByTargetIds({
        targetIds: blocks.slice(index, index + batchSize).map((block) => block.blockId)
      });
    }
    for (let index = 0; index < assets.length; index += batchSize) {
      vectorStore.deleteByTargetIds({
        targetIds: assets.slice(index, index + batchSize).map((asset) => asset.assetId)
      });
    }
    db.prepare("DELETE FROM kc_embeddings").run();
    for (let index = 0; index < blocks.length; index += batchSize) {
      for (const block of blocks.slice(index, index + batchSize)) {
        const text = [block.title, searchableBlockText(block), searchableBlockSnippet(block)].filter(Boolean).join("\n");
        vectorStore.upsert({
          targetType: "block",
          targetId: block.blockId,
          ...embeddingRuntime.embedText(text),
          contentHash: hashText(text),
          metadata: {
            documentId: block.documentId,
            sectionId: block.sectionId,
            blockType: block.blockType
          }
        });
      }
    }
    for (let index = 0; index < assets.length; index += batchSize) {
      for (const asset of assets.slice(index, index + batchSize)) {
        vectorStore.upsert({
          targetType: "asset",
          targetId: asset.assetId,
          ...embeddingRuntime.embedImageEvidence(asset),
          contentHash: hashText([asset.title, asset.caption, asset.ocrText, asset.sha256].join("\n")),
          metadata: {
            documentId: asset.documentId,
            sectionId: asset.sectionId,
            assetType: asset.assetType
          }
        });
      }
    }
    const hierarchy = rebuildHierarchyIndex();
    const output = {
      batchSize,
      blockEmbeddings: blocks.length,
      assetEmbeddings: assets.length,
      blockBatches: Math.ceil(blocks.length / batchSize),
      assetBatches: Math.ceil(assets.length / batchSize),
      ...textIndex,
      hierarchyNodes: hierarchy.nodeCount
    };
    db.prepare(`
      UPDATE kc_maintenance_runs
      SET status = ?, output_json = ?, finished_at = ?
      WHERE run_id = ?
    `).run("completed", stringifyJson(output), nowIso(), runId);
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      runId,
      status: "completed",
      ...output
    };
  }

  function validateAssets() {
    const assets = db.prepare("SELECT * FROM kc_assets ORDER BY asset_id ASC").all().map(hydrateAsset);
    const missing = [];
    const shaMismatch = [];
    const unsafePaths = [];
    const root = path.resolve(rootPath);
    for (const asset of assets) {
      if (!asset.relativePath) {
        missing.push({
          assetId: asset.assetId,
          reason: "missing-relative-path"
        });
        continue;
      }
      const absolutePath = path.resolve(rootPath, asset.relativePath);
      if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
        unsafePaths.push({
          assetId: asset.assetId,
          relativePath: asset.relativePath
        });
        continue;
      }
      if (!fs.existsSync(absolutePath)) {
        missing.push({
          assetId: asset.assetId,
          relativePath: asset.relativePath,
          reason: "missing-file"
        });
        continue;
      }
      const buffer = fs.readFileSync(absolutePath);
      const actualSha256 = createHash("sha256").update(buffer).digest("hex");
      if (asset.sha256 && actualSha256 !== asset.sha256) {
        shaMismatch.push({
          assetId: asset.assetId,
          expectedSha256: asset.sha256,
          actualSha256
        });
      }
    }
    return {
      checkedAssets: assets.length,
      missing,
      shaMismatch,
      unsafePaths,
      ok: missing.length === 0 && shaMismatch.length === 0 && unsafePaths.length === 0
    };
  }

  function repairMissingThumbnails() {
    const updateAssetMetadataStmt = db.prepare(`
      UPDATE kc_assets
      SET metadata_json = ?, updated_at = ?
      WHERE asset_id = ?
    `);
    const assets = db.prepare("SELECT * FROM kc_assets ORDER BY asset_id ASC").all().map(hydrateAsset);
    let repaired = 0;
    for (const asset of assets) {
      if (!String(asset.mediaType || "").startsWith("image/")) {
        continue;
      }
      if (asset.metadata?.thumbnailRelativePath) {
        continue;
      }
      const nextMetadata = {
        ...(asset.metadata || {}),
        thumbnailRelativePath: asset.relativePath || "",
        thumbnailPolicy: "source-image-reused",
        thumbnailUpdatedAt: nowIso()
      };
      updateAssetMetadataStmt.run(stringifyJson(nextMetadata), nowIso(), asset.assetId);
      repaired += 1;
    }
    return {
      repaired,
      policy: "source-image-reused"
    };
  }

  function deleteOrphanObjects() {
    const orphanEmbeddings = db.prepare(`
      SELECT embedding_id FROM kc_embeddings
      WHERE (target_type = 'block' AND target_id NOT IN (SELECT block_id FROM kc_blocks))
         OR (target_type = 'asset' AND target_id NOT IN (SELECT asset_id FROM kc_assets))
    `).all().map((row) => row.embedding_id);
    const orphanEvidence = db.prepare(`
      SELECT evidence_id FROM kc_evidence_packs
      WHERE document_id != '' AND document_id NOT IN (SELECT document_id FROM kc_documents)
    `).all().map((row) => row.evidence_id);
    const deleteEmbeddingStmt = db.prepare("DELETE FROM kc_embeddings WHERE embedding_id = ?");
    const deleteEvidenceStmt = db.prepare("DELETE FROM kc_evidence_packs WHERE evidence_id = ?");
    const transaction = db.transaction(() => {
      for (const embeddingId of orphanEmbeddings) {
        deleteEmbeddingStmt.run(embeddingId);
      }
      for (const evidenceId of orphanEvidence) {
        deleteEvidenceStmt.run(evidenceId);
      }
    });
    transaction();
    return {
      deletedEmbeddings: orphanEmbeddings.length,
      deletedEvidencePacks: orphanEvidence.length
    };
  }

  function sourceDedupKeyForRow(row = {}) {
    const metadata = parseJson(row.metadata_json, {});
    const sourceMarker = normalizeText(metadata.source || row.document_type || "");
    const isSourceMaterial = sourceMarker === "sourceFiles" || Boolean(metadata.rawObjectId);
    if (!isSourceMaterial) {
      return "";
    }
    const sourceHash = normalizeText(row.source_hash || metadata.rawObjectSha256 || "");
    if (sourceHash) {
      return `source-hash:${sourceHash.toLowerCase()}`;
    }
    const pathKey = normalizeSourcePathKey(
      row.source_path || metadata.originalRelativePath || row.source_id || row.title || ""
    );
    return pathKey ? `source-path:${pathKey}` : "";
  }

  function preferredSourceRow(left, right) {
    if (!left) {
      return right;
    }
    const leftMetadata = parseJson(left.metadata_json, {});
    const rightMetadata = parseJson(right.metadata_json, {});
    const leftPath = normalizeText(leftMetadata.originalRelativePath || left.source_path || left.title || "");
    const rightPath = normalizeText(rightMetadata.originalRelativePath || right.source_path || right.title || "");
    const duplicateSuffix = /\s+\d+\.eml$/i;
    const leftPenalty = duplicateSuffix.test(leftPath) ? 1 : 0;
    const rightPenalty = duplicateSuffix.test(rightPath) ? 1 : 0;
    if (leftPenalty !== rightPenalty) {
      return leftPenalty < rightPenalty ? left : right;
    }
    if (leftPath.length !== rightPath.length) {
      return leftPath.length <= rightPath.length ? left : right;
    }
    const leftUpdated = Date.parse(left.updated_at || "") || 0;
    const rightUpdated = Date.parse(right.updated_at || "") || 0;
    return rightUpdated >= leftUpdated ? right : left;
  }

  function chunked(values = [], size = 400) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size));
    }
    return chunks;
  }

  function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(Math.trunc(parsed), max));
  }

  function getSqliteTableBytes(tableNames = []) {
    const names = asArray(tableNames).map(normalizeText).filter(Boolean);
    if (names.length === 0) {
      return {};
    }
    try {
      const placeholders = names.map(() => "?").join(", ");
      const rows = db.prepare(`
        SELECT name, COALESCE(SUM(pgsize), 0) AS bytes
        FROM dbstat
        WHERE name IN (${placeholders})
        GROUP BY name
      `).all(...names);
      return Object.fromEntries(rows.map((row) => [row.name, Number(row.bytes || 0)]));
    } catch {
      return {};
    }
  }

  function fileMtimeMs(filePath) {
    try {
      return fs.statSync(filePath).mtimeMs || 0;
    } catch {
      return 0;
    }
  }

  function directorySizeBytes(dirPath) {
    let total = 0;
    try {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const childPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += directorySizeBytes(childPath);
        } else if (entry.isFile()) {
          total += fs.statSync(childPath).size || 0;
        }
      }
    } catch {
      return total;
    }
    return total;
  }

  function readJsonFileSync(filePath, fallback = {}) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  function listDistillationReports(maxReports) {
    const knowledgeSkillsPath = path.join(path.dirname(rootPath), "knowledge-skills");
    try {
      const entries = fs.readdirSync(knowledgeSkillsPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && /^distillation-report-.+\.json$/i.test(entry.name))
        .map((entry) => {
          const filePath = path.join(knowledgeSkillsPath, entry.name);
          const stat = fs.statSync(filePath);
          return {
            path: filePath,
            name: entry.name,
            bytes: Number(stat.size || 0),
            mtimeMs: Number(stat.mtimeMs || 0)
          };
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(Math.max(0, maxReports));
    } catch {
      return [];
    }
  }

  function listCleanableJobArtifacts(input = {}) {
    if (input.includeJobArtifacts !== true) {
      return [];
    }
    const jobsPath = path.join(path.dirname(rootPath), "jobs");
    const now = Date.now();
    const olderThanHours = clampInteger(input.jobOlderThanHours, 24, 0, 24 * 365 * 10);
    const allowedStatuses = new Set(
      asArray(input.jobStatuses).length > 0
        ? asArray(input.jobStatuses).map((status) => normalizeText(status).toLowerCase()).filter(Boolean)
        : ["failed", "canceled", "cancelled"]
    );
    try {
      return fs.readdirSync(jobsPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const jobPath = path.join(jobsPath, entry.name);
          const meta = readJsonFileSync(path.join(jobPath, "meta.json"), {});
          const status = normalizeText(meta.status).toLowerCase();
          const updatedMs =
            Date.parse(meta.updatedAt || meta.finishedAt || meta.createdAt || "") ||
            fileMtimeMs(jobPath);
          const ageHours = updatedMs > 0 ? (now - updatedMs) / 3600000 : Number.POSITIVE_INFINITY;
          return {
            jobId: entry.name,
            path: jobPath,
            status,
            updatedAt: meta.updatedAt || meta.finishedAt || meta.createdAt || "",
            ageHours,
            bytes: directorySizeBytes(jobPath)
          };
        })
        .filter((item) =>
          allowedStatuses.has(item.status) &&
          item.status !== "running" &&
          item.status !== "queued" &&
          item.status !== "processing" &&
          item.ageHours >= olderThanHours
        )
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, clampInteger(input.maxJobArtifacts, 50, 1, 1000));
    } catch {
      return [];
    }
  }

  function listCleanableHydrationCaches(input = {}) {
    if (input.includeHydrationCaches === false) {
      return [];
    }
    const hydratedRoot = path.join(path.dirname(rootPath), "knowledge-sources", "hydrated");
    const now = Date.now();
    const olderThanHours = clampInteger(input.hydrationCacheOlderThanHours, 168, 1, 24 * 365 * 10);
    const maxCaches = clampInteger(input.maxHydrationCaches, 200, 1, 10000);
    const caches = [];
    try {
      for (const sourceEntry of fs.readdirSync(hydratedRoot, { withFileTypes: true })) {
        if (!sourceEntry.isDirectory()) {
          continue;
        }
        const sourcePath = path.join(hydratedRoot, sourceEntry.name);
        for (const cacheEntry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
          if (!cacheEntry.isDirectory()) {
            continue;
          }
          const cachePath = path.join(sourcePath, cacheEntry.name);
          const mtimeMs = fileMtimeMs(cachePath);
          const ageHours = mtimeMs > 0 ? (now - mtimeMs) / 3600000 : Number.POSITIVE_INFINITY;
          if (ageHours < olderThanHours) {
            continue;
          }
          caches.push({
            sourceId: sourceEntry.name,
            cacheId: cacheEntry.name,
            path: cachePath,
            ageHours,
            bytes: directorySizeBytes(cachePath)
          });
        }
      }
    } catch {
      return [];
    }
    return caches
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, maxCaches);
  }

  function runSqliteCheckpoint({ truncate = true } = {}) {
    try {
      const pragma = truncate ? "wal_checkpoint(TRUNCATE)" : "wal_checkpoint(PASSIVE)";
      return {
        ok: true,
        rows: db.pragma(pragma)
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "sqlite checkpoint failed"
      };
    }
  }

  function runGarbageCleanup(input = {}) {
    const dryRun = input.dryRun !== false && input.dry_run !== false;
    const keepSyncLogRows = clampInteger(input.keepSyncLogRows, 5000, 0, 10000000);
    const keepDuplicateReviewItems = clampInteger(input.keepDuplicateReviewItems, 500, 0, 1000000);
    const keepMaintenanceRuns = clampInteger(input.keepMaintenanceRuns, 100, 10, 100000);
    const maxDistillationReports = clampInteger(input.maxDistillationReports, 5, 0, 10000);
    const includeCheckpoint = input.checkpoint !== false;
    const includeVacuum = input.vacuum === true;
    const pruneReviewReasons = (
      asArray(input.pruneReviewReasons).length > 0
        ? asArray(input.pruneReviewReasons)
        : ["duplicate_source_document"]
    ).map(normalizeText).filter(Boolean);
    const maxCursor = Number(selectMaxSyncCursorStmt.get()?.cursor || 0);
    const syncDeleteCursor = Math.max(0, maxCursor - keepSyncLogRows);
    const syncLogTotal = Number(db.prepare("SELECT COUNT(*) AS count FROM kc_sync_log").get()?.count || 0);
    const syncLogDeleteCount = syncDeleteCursor > 0
      ? Number(db.prepare("SELECT COUNT(*) AS count FROM kc_sync_log WHERE cursor <= ?").get(syncDeleteCursor)?.count || 0)
      : 0;
    const reviewReasonPlaceholders = pruneReviewReasons.map(() => "?").join(", ");
    const duplicateReviewTotal = pruneReviewReasons.length > 0
      ? Number(db.prepare(`
          SELECT COUNT(*) AS count
          FROM kc_review_items
          WHERE status = 'pending'
            AND reason IN (${reviewReasonPlaceholders})
        `).get(...pruneReviewReasons)?.count || 0)
      : 0;
    const duplicateReviewDeleteCount = Math.max(0, duplicateReviewTotal - keepDuplicateReviewItems);
    const duplicateReviewIds = duplicateReviewDeleteCount > 0 && pruneReviewReasons.length > 0
      ? db.prepare(`
          SELECT review_id
          FROM kc_review_items
          WHERE status = 'pending'
            AND reason IN (${reviewReasonPlaceholders})
          ORDER BY updated_at ASC, created_at ASC, review_id ASC
          LIMIT ?
        `).all(...pruneReviewReasons, duplicateReviewDeleteCount).map((row) => row.review_id)
      : [];
    const maintenanceTotal = Number(db.prepare("SELECT COUNT(*) AS count FROM kc_maintenance_runs").get()?.count || 0);
    const maintenanceDeleteCount = Math.max(0, maintenanceTotal - keepMaintenanceRuns);
    const maintenanceRunIds = maintenanceDeleteCount > 0
      ? db.prepare(`
          SELECT run_id
          FROM kc_maintenance_runs
          ORDER BY started_at ASC, run_id ASC
          LIMIT ?
        `).all(maintenanceDeleteCount).map((row) => row.run_id)
      : [];
    const distillationReports = listDistillationReports(maxDistillationReports);
    const jobArtifacts = listCleanableJobArtifacts(input);
    const hydrationCaches = listCleanableHydrationCaches(input);
    const tableNames = [
      "kc_sync_log",
      "kc_review_items",
      "kc_maintenance_runs",
      "kc_blocks_fts_data",
      "kc_hierarchy_fts_data"
    ];
    const tableBytesBefore = getSqliteTableBytes(tableNames);
    const planned = {
      syncLogRows: syncLogDeleteCount,
      syncLogCutoffCursor: syncDeleteCursor,
      duplicateReviewItems: duplicateReviewIds.length,
      duplicateReviewReasons: pruneReviewReasons,
      maintenanceRuns: maintenanceRunIds.length,
      distillationReports: distillationReports.length,
      jobArtifacts: jobArtifacts.length,
      jobArtifactBytes: jobArtifacts.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
      hydrationCaches: hydrationCaches.length,
      hydrationCacheBytes: hydrationCaches.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
      sqliteCheckpoint: includeCheckpoint,
      sqliteVacuum: includeVacuum
    };
    const examples = {
      duplicateReviewItemIds: duplicateReviewIds.slice(0, 10),
      distillationReports: distillationReports.slice(0, 10).map((item) => ({
        name: item.name,
        bytes: item.bytes
      })),
      jobArtifacts: jobArtifacts.slice(0, 10).map((item) => ({
        jobId: item.jobId,
        status: item.status,
        updatedAt: item.updatedAt,
        bytes: item.bytes
      })),
      hydrationCaches: hydrationCaches.slice(0, 10).map((item) => ({
        sourceId: item.sourceId,
        cacheId: item.cacheId,
        bytes: item.bytes
      }))
    };
    const before = {
      syncLogRows: syncLogTotal,
      duplicateReviewItems: duplicateReviewTotal,
      maintenanceRuns: maintenanceTotal,
      sqliteTableBytes: tableBytesBefore
    };
    const applied = {
      syncLogRows: 0,
      duplicateReviewItems: 0,
      maintenanceRuns: 0,
      distillationReports: 0,
      jobArtifacts: 0,
      jobArtifactBytes: 0,
      hydrationCaches: 0,
      hydrationCacheBytes: 0,
      sqliteCheckpoint: null,
      sqliteVacuum: null
    };
    if (!dryRun) {
      const transaction = db.transaction(() => {
        if (syncLogDeleteCount > 0) {
          applied.syncLogRows = db.prepare("DELETE FROM kc_sync_log WHERE cursor <= ?").run(syncDeleteCursor).changes;
        }
        for (const ids of chunked(duplicateReviewIds)) {
          const placeholders = ids.map(() => "?").join(", ");
          applied.duplicateReviewItems += db.prepare(`
            DELETE FROM kc_review_items WHERE review_id IN (${placeholders})
          `).run(...ids).changes;
        }
        for (const ids of chunked(maintenanceRunIds)) {
          const placeholders = ids.map(() => "?").join(", ");
          applied.maintenanceRuns += db.prepare(`
            DELETE FROM kc_maintenance_runs WHERE run_id IN (${placeholders})
          `).run(...ids).changes;
        }
      });
      transaction();
      for (const report of distillationReports) {
        try {
          fs.rmSync(report.path, { force: true });
          applied.distillationReports += 1;
        } catch {
          // Best-effort filesystem cleanup; database changes above are already complete.
        }
      }
      for (const artifact of jobArtifacts) {
        try {
          fs.rmSync(artifact.path, { recursive: true, force: true });
          applied.jobArtifacts += 1;
          applied.jobArtifactBytes += Number(artifact.bytes || 0);
        } catch {
          // Keep going so one locked directory does not block unrelated cleanup.
        }
      }
      for (const cache of hydrationCaches) {
        try {
          fs.rmSync(cache.path, { recursive: true, force: true });
          applied.hydrationCaches += 1;
          applied.hydrationCacheBytes += Number(cache.bytes || 0);
        } catch {
          // Best effort; active or locked hydration caches are left in place.
        }
      }
      if (includeCheckpoint) {
        applied.sqliteCheckpoint = runSqliteCheckpoint({ truncate: true });
      }
      if (includeVacuum) {
        try {
          db.exec("VACUUM");
          applied.sqliteVacuum = { ok: true };
        } catch (error) {
          applied.sqliteVacuum = {
            ok: false,
            error: error instanceof Error ? error.message : "sqlite vacuum failed"
          };
        }
      }
    }
    const after = dryRun
      ? null
      : {
          syncLogRows: Number(db.prepare("SELECT COUNT(*) AS count FROM kc_sync_log").get()?.count || 0),
          duplicateReviewItems: pruneReviewReasons.length > 0
            ? Number(db.prepare(`
                SELECT COUNT(*) AS count
                FROM kc_review_items
                WHERE status = 'pending'
                  AND reason IN (${reviewReasonPlaceholders})
              `).get(...pruneReviewReasons)?.count || 0)
            : 0,
          maintenanceRuns: Number(db.prepare("SELECT COUNT(*) AS count FROM kc_maintenance_runs").get()?.count || 0),
          sqliteTableBytes: getSqliteTableBytes(tableNames)
        };
    return {
      ok: true,
      dryRun,
      before,
      planned,
      applied,
      after,
      options: {
        keepSyncLogRows,
        keepDuplicateReviewItems,
        keepMaintenanceRuns,
        maxDistillationReports,
        includeJobArtifacts: input.includeJobArtifacts === true,
        jobStatuses: asArray(input.jobStatuses).length > 0 ? asArray(input.jobStatuses) : ["failed", "canceled", "cancelled"],
        jobOlderThanHours: clampInteger(input.jobOlderThanHours, 24, 0, 24 * 365 * 10),
        includeHydrationCaches: input.includeHydrationCaches !== false,
        hydrationCacheOlderThanHours: clampInteger(input.hydrationCacheOlderThanHours, 168, 1, 24 * 365 * 10),
        checkpoint: includeCheckpoint,
        vacuum: includeVacuum
      },
      notes: [
        "默认不删除 raw objects，也不删除可续传上传会话。",
        "压缩 kc_sync_log 后，早于 syncLogCutoffCursor 的客户端需要做一次完整同步。",
        "jobArtifacts 只有 includeJobArtifacts=true 时才会清理，且默认只清理已失败或取消的旧任务目录。",
        "hydrationCaches 默认只清理 168 小时以前的知识源自动下载缓存。",
        "VACUUM 默认关闭；开启后会重写 SQLite 文件，可能耗时较长。"
      ],
      examples
    };
  }

  function deduplicateSourceDocuments(input = {}) {
    const dryRun = Boolean(input.dryRun || input.dry_run);
    const rows = db.prepare(`
      SELECT document_id, batch_id, source_id, document_type, title, source_path,
             source_hash, metadata_json, updated_at
      FROM kc_documents
      ORDER BY updated_at DESC, document_id ASC
    `).all();
    const groups = new Map();
    for (const row of rows) {
      const key = sourceDedupKeyForRow(row);
      if (!key) {
        continue;
      }
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }
    const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1);
    const deleteIds = [];
    const examples = [];
    for (const [key, group] of duplicateGroups) {
      const keep = group.reduce((current, row) => preferredSourceRow(current, row), null);
      const duplicates = group.filter((row) => row.document_id !== keep.document_id);
      deleteIds.push(...duplicates.map((row) => row.document_id));
      if (examples.length < 10) {
        examples.push({
          key,
          kept: {
            documentId: keep.document_id,
            title: keep.title,
            sourcePath: keep.source_path,
            batchId: keep.batch_id
          },
          deleted: duplicates.slice(0, 8).map((row) => ({
            documentId: row.document_id,
            title: row.title,
            sourcePath: row.source_path,
            batchId: row.batch_id
          })),
          duplicateCount: duplicates.length
        });
      }
    }
    if (!dryRun && deleteIds.length > 0) {
      for (const ids of chunked(deleteIds)) {
        deleteKnowledgeDocumentsById(ids);
      }
      rebuildSearchIndexes();
      rebuildHierarchyIndex();
    }
    return {
      dryRun,
      scannedDocuments: rows.length,
      duplicateGroupCount: duplicateGroups.length,
      deletedDocumentCount: dryRun ? 0 : deleteIds.length,
      wouldDeleteDocumentCount: deleteIds.length,
      remainingSourceDocumentEstimate: rows.length - deleteIds.length,
      examples
    };
  }

  function compareRetrievalProfiles(input = {}) {
    const queries = asArray(input.queries).map(normalizeText).filter(Boolean);
    const fallbackQueries = queries.length > 0
      ? queries
      : db.prepare("SELECT title FROM kc_documents WHERE title != '' ORDER BY updated_at DESC LIMIT 3")
          .all()
          .map((row) => row.title)
          .filter(Boolean);
    const profiles = asArray(input.profiles).length > 0
      ? asArray(input.profiles)
      : [
          {
            id: "balanced",
            retrieval: getSettings().retrieval
          },
          {
            id: "lexical-heavy",
            retrieval: {
              ...getSettings().retrieval,
              bm25Weight: 0.8,
              vectorWeight: 0.15,
              imageWeight: 0.05
            }
          },
          {
            id: "multimodal-heavy",
            retrieval: {
              ...getSettings().retrieval,
              bm25Weight: 0.35,
              vectorWeight: 0.35,
              imageWeight: 0.3
            }
          }
        ];
    const comparisons = fallbackQueries.map((query) => ({
      query,
      profiles: profiles.map((profile) => {
        const result = search({
          query,
          limit: Number(input.limit || 5),
          retrievalProfile: profile.retrieval || profile
        });
        return {
          profileId: profile.id || profile.name || "profile",
          topEvidenceIds: result.items.map((item) => item.evidenceId),
          topDocumentIds: result.items.map((item) => item.documentId),
          topScore: result.items[0]?.score || 0,
          imageHitCount: result.items.filter((item) => item.modalities.includes("image")).length,
          resultCount: result.items.length
        };
      })
    }));
    return {
      queryCount: fallbackQueries.length,
      comparisons
    };
  }

  function validateKnowledgeQualityAssertions(input = {}) {
    const settings = getSettings();
    const requireOcrOrCaption =
      input.requireOcrOrCaption ??
      settings.maintenance?.requireOcrOrCaption ??
      DEFAULT_SETTINGS.maintenance.requireOcrOrCaption;
    const rows = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM kc_documents d WHERE NOT EXISTS (
          SELECT 1 FROM kc_blocks b WHERE b.document_id = d.document_id
        )) AS documents_without_blocks,
        (SELECT COALESCE(SUM(n - 1), 0) FROM (
          SELECT COUNT(*) AS n
          FROM kc_documents
          WHERE source_hash != ''
            AND json_extract(metadata_json, '$.source') = 'sourceFiles'
          GROUP BY source_hash
          HAVING n > 1
        )) AS duplicate_source_hash_documents,
        (SELECT COUNT(*) FROM kc_assets WHERE asset_type = 'image' AND caption = '' AND ocr_text = '') AS images_without_text,
        (SELECT COUNT(*) FROM kc_evidence_packs WHERE markdown NOT LIKE '%pact_knowledge:%') AS evidence_without_machine_metadata,
        (SELECT COUNT(*) FROM kc_embeddings) AS embedding_count,
        ((SELECT COUNT(*) FROM kc_blocks) + (SELECT COUNT(*) FROM kc_assets)) AS embeddable_count
    `).get();
    const findings = [];
    if (Number(rows.documents_without_blocks || 0) > 0) {
      findings.push({
        code: "documents_without_blocks",
        severity: "error",
        count: Number(rows.documents_without_blocks || 0)
      });
    }
    if (Number(rows.duplicate_source_hash_documents || 0) > 0) {
      findings.push({
        code: "duplicate_source_hash_documents",
        severity: "error",
        count: Number(rows.duplicate_source_hash_documents || 0)
      });
    }
    if (requireOcrOrCaption !== false && Number(rows.images_without_text || 0) > 0) {
      findings.push({
        code: "images_without_ocr_or_caption",
        severity: "warning",
        count: Number(rows.images_without_text || 0)
      });
    }
    if (Number(rows.evidence_without_machine_metadata || 0) > 0) {
      findings.push({
        code: "evidence_without_machine_metadata",
        severity: "error",
        count: Number(rows.evidence_without_machine_metadata || 0)
      });
    }
    if (Number(rows.embedding_count || 0) < Number(rows.embeddable_count || 0)) {
      findings.push({
        code: "missing_embeddings",
        severity: "warning",
        count: Number(rows.embeddable_count || 0) - Number(rows.embedding_count || 0)
      });
    }
    return {
      ok: findings.every((finding) => finding.severity !== "error"),
      findings,
      metrics: {
        documentsWithoutBlocks: Number(rows.documents_without_blocks || 0),
        duplicateSourceHashDocuments: Number(rows.duplicate_source_hash_documents || 0),
        imagesWithoutText: Number(rows.images_without_text || 0),
        evidenceWithoutMachineMetadata: Number(rows.evidence_without_machine_metadata || 0),
        embeddingCount: Number(rows.embedding_count || 0),
        embeddableCount: Number(rows.embeddable_count || 0)
      }
    };
  }

  function listMaintenanceRuns({ limit = 50 } = {}) {
    return db.prepare(`
      SELECT * FROM kc_maintenance_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(Number(limit || 50), 500))).map((row) => ({
      runId: row.run_id,
      taskType: row.task_type,
      status: row.status,
      input: parseJson(row.input_json, {}),
      output: parseJson(row.output_json, {}),
      startedAt: row.started_at,
      finishedAt: row.finished_at
    }));
  }

  function recordMaintenanceTask(taskType, input, execute) {
    const runId = stableId("maintenance", taskType, Date.now(), Math.random());
    const startedAt = nowIso();
    db.prepare(`
      INSERT INTO kc_maintenance_runs (run_id, task_type, status, input_json, output_json, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, taskType, "running", stringifyJson(input), "{}", startedAt);
    try {
      const output = execute();
      db.prepare(`
        UPDATE kc_maintenance_runs
        SET status = ?, output_json = ?, finished_at = ?
        WHERE run_id = ?
      `).run("completed", stringifyJson(output), nowIso(), runId);
      return {
        protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
        runId,
        taskType,
        status: "completed",
        output
      };
    } catch (error) {
      const output = {
        error: error instanceof Error ? error.message : "maintenance task failed"
      };
      db.prepare(`
        UPDATE kc_maintenance_runs
        SET status = ?, output_json = ?, finished_at = ?
        WHERE run_id = ?
      `).run("failed", stringifyJson(output), nowIso(), runId);
      return {
        protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
        runId,
        taskType,
        status: "failed",
        output
      };
    }
  }

  function runMaintenance(input = {}) {
    const taskType = String(input.taskType || input.task || "validate_assets")
      .trim()
      .replace(/-/g, "_");
    if (taskType === "reindex" || taskType === "rebuild_index") {
      return reindex(input);
    }
    if (taskType === "validate_assets") {
      return recordMaintenanceTask(taskType, input, validateAssets);
    }
    if (taskType === "repair_missing_thumbnails" || taskType === "repair_thumbnails") {
      return recordMaintenanceTask(taskType, input, repairMissingThumbnails);
    }
    if (taskType === "delete_orphan_objects" || taskType === "cleanup_orphans") {
      return recordMaintenanceTask(taskType, input, deleteOrphanObjects);
    }
    if (taskType === "garbage_cleanup" || taskType === "cleanup_garbage" || taskType === "gc" || taskType === "compact_storage") {
      return recordMaintenanceTask(taskType, input, () => runGarbageCleanup(input));
    }
    if (taskType === "deduplicate_sources" || taskType === "dedupe_sources") {
      return recordMaintenanceTask(taskType, input, () => deduplicateSourceDocuments(input));
    }
    if (taskType === "compare_retrieval_profiles") {
      return recordMaintenanceTask(taskType, input, () => compareRetrievalProfiles(input));
    }
    if (taskType === "validate_quality") {
      return recordMaintenanceTask(taskType, input, () => validateKnowledgeQualityAssertions(input));
    }
    if (taskType === "learning_run" || taskType === "learn" || taskType === "auto_tune_retrieval") {
      return recordMaintenanceTask(taskType, input, () => runLearningJob(input));
    }
    if (taskType === "reembed_by_model_version") {
      return recordMaintenanceTask(taskType, input, () => {
        if (input.embeddingModel || input.modelVersion) {
          setSettings({
            embeddingModel: {
              ...(getSettings().embeddingModel || {}),
              ...(input.embeddingModel || {}),
              version: input.modelVersion || input.embeddingModel?.version || ""
            }
          });
        }
        return reindex({
          ...input,
          reason: "reembed_by_model_version"
        });
      });
    }
    return recordMaintenanceTask(taskType || "unknown", input, () => ({
      ok: false,
      error: `未知知识库维护任务：${taskType}`
    }));
  }

  function health() {
    const settings = getSettings();
    const taxonomy = activeTaxonomy();
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM kc_collections) AS collection_count,
        (SELECT COUNT(*) FROM kc_documents) AS document_count,
        (SELECT COUNT(*) FROM kc_sections) AS section_count,
        (SELECT COUNT(*) FROM kc_blocks) AS block_count,
        (SELECT COUNT(*) FROM kc_assets) AS asset_count,
        (SELECT COUNT(*) FROM kc_embeddings) AS embedding_count,
        (SELECT COUNT(*) FROM kc_hierarchy_nodes) AS hierarchy_count,
        (SELECT COUNT(*) FROM kc_evidence_packs) AS evidence_count,
        (SELECT COUNT(*) FROM kc_review_items WHERE status = 'pending') AS pending_review_count
    `).get();
    const lastReindexAt = db.prepare(`
      SELECT finished_at
      FROM kc_maintenance_runs
      WHERE task_type = 'reindex'
        AND status = 'completed'
        AND finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `).get()?.finished_at || "";
    const missingAssets = db.prepare(`
      SELECT relative_path FROM kc_assets
      WHERE relative_path != ''
    `).all().filter((row) => !fs.existsSync(path.join(rootPath, row.relative_path))).length;
    const quality = validateKnowledgeQualityAssertions();
    const missingEmbeddingCount = Math.max(
      0,
      Number(counts.block_count || 0) + Number(counts.asset_count || 0) - Number(counts.embedding_count || 0)
    );
    const staleIndexHours = Math.floor(clampNumber(
      settings.maintenance?.staleIndexHours,
      1,
      8760,
      DEFAULT_SETTINGS.maintenance.staleIndexHours
    ));
    const lastReindexMs = Date.parse(lastReindexAt);
    const indexAgeHours = Number.isFinite(lastReindexMs)
      ? Number(((Date.now() - lastReindexMs) / 3_600_000).toFixed(2))
      : null;
    const indexStale =
      missingEmbeddingCount > 0 ||
      (indexAgeHours !== null && indexAgeHours > staleIndexHours);
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      ok: missingAssets === 0 && quality.ok,
      rootPath,
      databasePath: db.name,
      taxonomy: taxonomy
        ? {
            path: taxonomyRuntime?.path || "",
            expertVocabularyPath: taxonomyRuntime?.expertVocabularyPath || "",
            emailRulesPath: taxonomyRuntime?.emailRulesPath || "",
            version: taxonomy.version,
            source: taxonomy.source,
            checksum: taxonomy.checksum || "",
            categoryCount: taxonomy.categories?.length || 0,
            guidance: taxonomy.guidance || null
          }
        : null,
      counts: {
        collections: Number(counts.collection_count || 0),
        documents: Number(counts.document_count || 0),
        sections: Number(counts.section_count || 0),
        blocks: Number(counts.block_count || 0),
        assets: Number(counts.asset_count || 0),
        embeddings: Number(counts.embedding_count || 0),
        hierarchyNodes: Number(counts.hierarchy_count || 0),
        evidencePacks: Number(counts.evidence_count || 0),
        pendingReviewItems: Number(counts.pending_review_count || 0)
      },
      maintenance: {
        missingAssets,
        missingEmbeddingCount,
        staleIndexHours,
        lastReindexAt,
        indexAgeHours,
        indexStale,
        qualityFindings: quality.findings,
        recentRuns: listMaintenanceRuns({ limit: 8 })
      },
      protocolModules: {
        embedding: typeof embeddingRuntime.health === "function" ? embeddingRuntime.health() : null,
        vector: typeof vectorStore.health === "function" ? vectorStore.health() : null,
        learning: {
          protocolVersion: LEARNING_RUNTIME_PROTOCOL_VERSION,
          providerId: "builtin:deterministic-learning-runtime",
          enabled: settings.learning?.enabled !== false,
          externalRuntime: "javascript-adapter-required"
        }
      },
      capabilities: capabilities()
    };
  }

  function capabilities() {
    const taxonomy = activeTaxonomy();
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      internalProtocols: {
        vector: VECTOR_PROTOCOL_VERSION,
        embedding: EMBEDDING_PROTOCOL_VERSION,
        assetStore: ASSET_STORE_PROTOCOL_VERSION,
        retrieval: RETRIEVAL_PROTOCOL_VERSION,
        learning: LEARNING_RUNTIME_PROTOCOL_VERSION
      },
      storage: {
        structured: "sqlite",
        assets: "filesystem",
        vector: vectorStore.providerId,
        learning: "sqlite-feedback-profile-store",
        hierarchyIndex: "sqlite-fts5-coarse-to-fine"
      },
      retrievalPolicy: {
        modes: [
          { value: "hybrid", label: "Hybrid" },
          { value: "keyword", label: "Keyword" }
        ],
        defaultMode: "hybrid",
        hierarchicalIndex: true,
        coarseToFineRequired: true,
        taxonomyPath: taxonomyRuntime?.path || "",
        expertVocabularyPath: taxonomyRuntime?.expertVocabularyPath || "",
        emailRulesPath: taxonomyRuntime?.emailRulesPath || "",
        taxonomyVersion: taxonomy?.version || 0,
        taxonomyCategoryCount: taxonomy?.categories?.length || 0,
        taxonomyGuidance: taxonomy?.guidance || null,
        taxonomyIntentGate: true,
        coarseLevels: ["collection", "document", "section"],
        fineLevels: ["block", "asset"],
        agentToolsUseHierarchy: true
      },
      retrievalModes: [
        { value: "hybrid", label: "Hybrid" },
        { value: "keyword", label: "Keyword" }
      ],
      protocolModules: {
        embedding: typeof embeddingRuntime.capabilities === "function" ? embeddingRuntime.capabilities() : null,
        vector: typeof vectorStore.capabilities === "function" ? vectorStore.capabilities() : null,
        learning: typeof learningRuntime.capabilities === "function" ? learningRuntime.capabilities() : null
      },
      modalities: {
        text: true,
        image: true,
        mixedTextImage: true,
        imageEmbedding: "fallback-ocr-caption",
        jointEmbedding: "fallback-evidence-fusion"
      },
      maintenanceTasks: [
        "reindex",
        "validate_assets",
        "repair_missing_thumbnails",
        "delete_orphan_objects",
        "garbage_cleanup",
        "deduplicate_sources",
        "compare_retrieval_profiles",
        "validate_quality",
        "reembed_by_model_version",
        "learning_run"
      ],
      learning: {
        feedback: true,
        retrievalProfiles: true,
        profileDeployments: true,
        canaryRouting: true,
        rollback: true,
        suggestions: true,
        reviewBeforeCanonicalMutation: true,
        autoApplyRetrievalProfiles: true,
        evaluationBeforeActivation: true
      },
      knowledgePartitions: {
        corpusExport: {
          role: "raw-materials-to-normalized-docx",
          format: "docx",
          interface: "jobs.normalized_documents + knowledge.export.docx",
          purpose: "external-knowledge-corpus"
        },
        agentContext: {
          role: "accepted-knowledge-to-agent-context",
          interface: "knowledge.search + evidence packs + context runtime",
          purpose: "grounded-agent-reference"
        }
      },
      outputFormats: ["json", "markdown", "docx"],
      hotSwitching: true,
      licensePolicy: LICENSE_MANIFEST
    };
  }

  return {
    getSettings,
    setSettings,
    ingestBatch,
    ingestSources,
    upsertDocuments,
    deleteBatch(batchId) {
      deleteBatchStmt(String(batchId || ""));
      return {
        ok: true,
        batchId
      };
    },
    search,
    prepareHierarchyReasoning,
    recordFeedback,
    feedbackSince,
    listSuggestions,
    resolveSuggestion,
    listReviewItems,
    resolveReviewItem,
    runLearningJob,
    learningHealth,
    createRetrievalProfileDeployment: upsertProfileDeployment,
    listRetrievalProfileDeployments,
    promoteRetrievalProfileDeployment,
    rollbackRetrievalProfileDeployment,
    auditHierarchyIndex,
    getEvidence,
    aggregate,
    getAssetContent,
    exportDocx,
    exportMarkdown,
    exportHtml,
    renderMarkdown,
    getItem,
    getDocumentStructure,
    syncMirror,
    reindex,
    runMaintenance,
    listMaintenanceRuns,
    listRetrievalProfiles({ limit = 50 } = {}) {
      return db.prepare(`
        SELECT * FROM kc_retrieval_profiles
        ORDER BY active DESC, profile_id ASC, version DESC
        LIMIT ?
      `).all(Math.max(1, Math.min(Number(limit || 50), 500))).map(hydrateRetrievalProfile);
    },
    getRetrievalProfile: resolveRetrievalProfile,
    validateAssets,
    compareRetrievalProfiles,
    validateKnowledgeQualityAssertions,
    health,
    capabilities,
    close() {
      db.close();
    }
  };
}

export async function createKnowledgeCoreMount({ userDataPath, outlineEnabled = true } = {}) {
  const rootPath = path.join(userDataPath, "knowledge-core");
  fs.mkdirSync(rootPath, { recursive: true });
  const db = new Database(path.join(rootPath, "knowledge.sqlite"));
  const taxonomyRuntime = createKnowledgeTaxonomyRuntime(userDataPath);
  const outlineRuntime = await resolveDocumentOutlineRuntime({ enabled: outlineEnabled });
  const store = createKnowledgeStore({ db, rootPath, taxonomyRuntime, outlineRuntime });

  return {
    id: "builtin/knowledge-core",
    kind: "knowledgeBase",
    enabled: true,
    protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
    capabilities: store.capabilities,
    health: store.health,
    getMaintenance: store.getSettings,
    setMaintenance: store.setSettings,
    ingestBatch: store.ingestBatch,
    upsertDocuments: store.upsertDocuments,
    deleteBatch: store.deleteBatch,
    search: store.search,
    prepareHierarchyReasoning: store.prepareHierarchyReasoning,
    recordFeedback: store.recordFeedback,
    feedbackSince: store.feedbackSince,
    listSuggestions: store.listSuggestions,
    resolveSuggestion: store.resolveSuggestion,
    listReviewItems: store.listReviewItems,
    resolveReviewItem: store.resolveReviewItem,
    runLearningJob: store.runLearningJob,
    learningHealth: store.learningHealth,
    createRetrievalProfileDeployment: store.createRetrievalProfileDeployment,
    listRetrievalProfileDeployments: store.listRetrievalProfileDeployments,
    promoteRetrievalProfileDeployment: store.promoteRetrievalProfileDeployment,
    rollbackRetrievalProfileDeployment: store.rollbackRetrievalProfileDeployment,
    auditHierarchyIndex: store.auditHierarchyIndex,
    getEvidence: store.getEvidence,
    aggregate: store.aggregate,
    getAssetContent: store.getAssetContent,
    exportDocx: store.exportDocx,
    exportMarkdown: store.exportMarkdown,
    exportHtml: store.exportHtml,
    renderMarkdown: store.renderMarkdown,
    getItem: store.getItem,
    getDocumentStructure: store.getDocumentStructure,
    syncMirror: store.syncMirror,
    reindex: store.reindex,
    runMaintenance: store.runMaintenance,
    listMaintenanceRuns: store.listMaintenanceRuns,
    listRetrievalProfiles: store.listRetrievalProfiles,
    getRetrievalProfile: store.getRetrievalProfile,
    ingestSources: store.ingestSources,
    async onBatchCompleted({ batchId, result, settings }) {
      if (settings?.knowledgeCoreEnabled === false) {
        return {
          skipped: true,
          reason: "knowledgeCoreEnabled=false"
        };
      }
      return store.ingestBatch({
        batchId,
        result,
        settings
      });
    },
    async reload({ settings } = {}) {
      if (settings?.knowledgeCore) {
        store.setSettings(settings.knowledgeCore);
      }
    },
    async close() {
      store.close();
    }
  };
}

export const createMount = createKnowledgeCoreMount;
export default createKnowledgeCoreMount;
