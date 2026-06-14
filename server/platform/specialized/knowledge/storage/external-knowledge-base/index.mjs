import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ServerConfig } from "../../../../common/config/ServerConfig.mjs";
import Database from "better-sqlite3";
import {
  KNOWLEDGE_PROTOCOL_VERSION,
  createKnowledgeCoreMount
} from "../knowledge-core/index.mjs";
import { createEmbeddingRuntime } from "../../retrieval/embedding-runtime/index.mjs";

export const EXTERNAL_KNOWLEDGE_ADAPTER_PROTOCOL_VERSION = "v0.0.1:external-service:knowledge-adapter-1";
export const DEFAULT_EXTERNAL_COLLECTION = "pact_knowledge";
export const DEFAULT_EXTERNAL_DIMENSION = 128;
const MAX_EXTERNAL_KNOWLEDGE_RESPONSE_BYTES = 4 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

async function readResponseTextWithLimit(response, maxBytes = MAX_EXTERNAL_KNOWLEDGE_RESPONSE_BYTES) {
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`External knowledge backend response exceeded the ${maxBytes} byte limit.`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`External knowledge backend response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function stringifyJson(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

function hashText(value, length = 32) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, ...parts) {
  return `${prefix}::${hashText(parts.map((part) => String(part || "")).join("\u001f"), 24)}`;
}

function deterministicUuid(value = "") {
  const hex = hashText(value, 32).padEnd(32, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${(Number.parseInt(hex.slice(16, 17), 16) & 0x3 | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function normalizeLimit(value, fallback = 20, max = 200) {
  const number = Math.floor(Number(value || fallback));
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(number, max);
}

function normalizeDimension(value, fallback = DEFAULT_EXTERNAL_DIMENSION) {
  const number = Math.floor(Number(value || fallback));
  if (!Number.isFinite(number) || number < 8 || number > 4096) return fallback;
  return number;
}

function tokenize(value = "") {
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu) || []
    )
  ].filter(Boolean);
}

function textScore(query = "", text = "") {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  const targetTokens = new Set(tokenize(text));
  const hits = queryTokens.filter((token) => targetTokens.has(token)).length;
  return hits / queryTokens.length;
}

function joinUrl(baseUrl = "", suffix = "") {
  return `${String(baseUrl || "").replace(/\/+$/u, "")}/${String(suffix || "").replace(/^\/+/u, "")}`;
}

function readRuntimeConfig({ runtimeOptions = {}, settings = {} } = {}) {
  const input =
    settings.externalKnowledgeBase ||
    settings.knowledgeBase?.external ||
    runtimeOptions.externalKnowledgeBase ||
    runtimeOptions.knowledgeBase?.external ||
    {};
  const provider = String(
    input.provider ||
      process.env.PACT_EXTERNAL_KB_PROVIDER ||
      process.env.PACT_EXTERNAL_KNOWLEDGE_PROVIDER ||
      ""
  ).trim().toLowerCase();
  const endpoint = String(
    input.endpoint ||
      input.url ||
      process.env.PACT_EXTERNAL_KB_URL ||
      process.env.PACT_EXTERNAL_KNOWLEDGE_URL ||
      ""
  ).trim();
  return {
    enabled: input.enabled !== false && Boolean(provider && provider !== "disabled" && provider !== "none"),
    provider: provider || "disabled",
    endpoint,
    apiKey: String(input.apiKey || process.env.PACT_EXTERNAL_KB_API_KEY || "").trim(),
    username: String(input.username || process.env.PACT_EXTERNAL_KB_USERNAME || "").trim(),
    password: String(input.password || process.env.PACT_EXTERNAL_KB_PASSWORD || "").trim(),
    collection: String(
      input.collection ||
        input.index ||
        process.env.PACT_EXTERNAL_KB_COLLECTION ||
        process.env.PACT_EXTERNAL_KB_INDEX ||
        DEFAULT_EXTERNAL_COLLECTION
    ).trim(),
    connectionString: String(
      input.connectionString ||
        input.databaseUrl ||
        process.env.PACT_EXTERNAL_KB_CONNECTION_STRING ||
        process.env.DATABASE_URL ||
        ""
    ).trim(),
    dimension: normalizeDimension(input.dimension || process.env.PACT_EXTERNAL_KB_DIMENSION),
    requestTimeoutMs: normalizeLimit(input.requestTimeoutMs || process.env.PACT_EXTERNAL_KB_TIMEOUT_MS, 15000, 120000),
    verifyTls: input.verifyTls !== false,
    batchSize: normalizeLimit(input.batchSize || process.env.PACT_EXTERNAL_KB_BATCH_SIZE, 64, 512)
  };
}

function ensureAdapterSchema(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ekb_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ekb_records (
      record_id TEXT PRIMARY KEY,
      external_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      block_id TEXT NOT NULL DEFAULT '',
      asset_id TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      locator_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      vector_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_ekb_records_batch ON ekb_records(batch_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_ekb_records_target ON ekb_records(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_ekb_records_document ON ekb_records(document_id, section_id);

    CREATE TABLE IF NOT EXISTS ekb_evidence (
      evidence_id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '',
      score REAL NOT NULL DEFAULT 0,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      locator_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      markdown TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
}

function createAdapterStore(rootPath) {
  fs.mkdirSync(rootPath, { recursive: true });
  const db = new Database(path.join(rootPath, "external-knowledge.sqlite"));
  ensureAdapterSchema(db);

  const getStateStmt = db.prepare("SELECT value_json FROM ekb_state WHERE key = ?");
  const setStateStmt = db.prepare(`
    INSERT INTO ekb_state (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `);
  const upsertRecordStmt = db.prepare(`
    INSERT INTO ekb_records (
      record_id, external_id, target_type, target_id, document_id, section_id, block_id,
      asset_id, batch_id, source_id, title, text, snippet, locator_json, payload_json,
      metadata_json, vector_json, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
    ON CONFLICT(record_id) DO UPDATE SET
      external_id = excluded.external_id,
      target_type = excluded.target_type,
      target_id = excluded.target_id,
      document_id = excluded.document_id,
      section_id = excluded.section_id,
      block_id = excluded.block_id,
      asset_id = excluded.asset_id,
      batch_id = excluded.batch_id,
      source_id = excluded.source_id,
      title = excluded.title,
      text = excluded.text,
      snippet = excluded.snippet,
      locator_json = excluded.locator_json,
      payload_json = excluded.payload_json,
      metadata_json = excluded.metadata_json,
      vector_json = excluded.vector_json,
      updated_at = excluded.updated_at,
      deleted_at = ''
  `);
  const getRecordStmt = db.prepare("SELECT * FROM ekb_records WHERE record_id = ? AND deleted_at = ''");
  const getRecordByExternalStmt = db.prepare("SELECT * FROM ekb_records WHERE external_id = ? AND deleted_at = ''");
  const listRecordsStmt = db.prepare("SELECT * FROM ekb_records WHERE deleted_at = '' ORDER BY updated_at DESC LIMIT ?");
  const deleteBatchStmt = db.prepare("UPDATE ekb_records SET deleted_at = ?, updated_at = ? WHERE batch_id = ? AND deleted_at = ''");
  const tombstoneTargetStmt = db.prepare("UPDATE ekb_records SET deleted_at = ?, updated_at = ? WHERE target_id = ? AND deleted_at = ''");
  const countRecordsStmt = db.prepare("SELECT COUNT(*) AS count FROM ekb_records WHERE deleted_at = ''");
  const countTombstonesStmt = db.prepare("SELECT COUNT(*) AS count FROM ekb_records WHERE deleted_at != ''");
  const upsertEvidenceStmt = db.prepare(`
    INSERT INTO ekb_evidence (
      evidence_id, record_id, query, score, reasons_json, locator_json, payload_json, markdown, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(evidence_id) DO UPDATE SET
      query = excluded.query,
      score = excluded.score,
      reasons_json = excluded.reasons_json,
      locator_json = excluded.locator_json,
      payload_json = excluded.payload_json,
      markdown = excluded.markdown,
      created_at = excluded.created_at
  `);
  const getEvidenceStmt = db.prepare("SELECT * FROM ekb_evidence WHERE evidence_id = ?");

  function hydrateRecord(row) {
    if (!row) return null;
    return {
      recordId: row.record_id,
      externalId: row.external_id,
      targetType: row.target_type,
      targetId: row.target_id,
      documentId: row.document_id,
      sectionId: row.section_id || "",
      blockId: row.block_id || "",
      assetId: row.asset_id || "",
      batchId: row.batch_id || "",
      sourceId: row.source_id || "",
      title: row.title || "",
      text: row.text || "",
      snippet: row.snippet || "",
      locator: parseJson(row.locator_json, {}),
      payload: parseJson(row.payload_json, {}),
      metadata: parseJson(row.metadata_json, {}),
      vector: parseJson(row.vector_json, []),
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || ""
    };
  }

  function hydrateEvidence(row) {
    if (!row) return null;
    const payload = parseJson(row.payload_json, {});
    return {
      evidenceId: row.evidence_id,
      recordId: row.record_id,
      query: row.query || "",
      score: Number(row.score || 0),
      reasons: parseJson(row.reasons_json, []),
      locator: parseJson(row.locator_json, {}),
      payload,
      markdown: row.markdown || "",
      createdAt: row.created_at,
      batchId: payload.document?.batchId || payload.record?.batchId || "",
      documentId: payload.document?.documentId || payload.record?.documentId || "",
      sectionId: payload.section?.sectionId || payload.record?.sectionId || "",
      blockId: payload.block?.blockId || payload.record?.blockId || "",
      assetId: payload.asset?.assetId || payload.record?.assetId || "",
      title: payload.block?.title || payload.asset?.title || payload.document?.title || payload.record?.title || "",
      snippet: payload.block?.snippet || payload.asset?.caption || payload.record?.snippet || ""
    };
  }

  function setState(key, value) {
    setStateStmt.run(String(key), stringifyJson(value), nowIso());
  }

  function getState(key, fallback = null) {
    const row = getStateStmt.get(String(key));
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  function upsertRecord(record = {}) {
    upsertRecordStmt.run(
      record.recordId,
      record.externalId,
      record.targetType,
      record.targetId,
      record.documentId,
      record.sectionId || "",
      record.blockId || "",
      record.assetId || "",
      record.batchId || "",
      record.sourceId || "",
      record.title || "",
      record.text || "",
      record.snippet || "",
      stringifyJson(record.locator),
      stringifyJson(record.payload),
      stringifyJson(record.metadata),
      stringifyJson(record.vector, []),
      record.updatedAt || nowIso()
    );
  }

  function saveEvidence(evidence = {}) {
    upsertEvidenceStmt.run(
      evidence.evidenceId,
      evidence.recordId,
      evidence.query || "",
      Number(evidence.score || 0),
      stringifyJson(evidence.reasons, []),
      stringifyJson(evidence.locator),
      stringifyJson(evidence.payload),
      evidence.markdown || "",
      evidence.createdAt || nowIso()
    );
  }

  function searchLocal({ query = "", limit = 20, batchId = "", sourceIds = [] } = {}) {
    const allowedSourceIds = new Set(asArray(sourceIds).map(String).filter(Boolean));
    return listRecordsStmt.all(5000)
      .map(hydrateRecord)
      .filter((record) => !batchId || record.batchId === batchId)
      .filter((record) => !allowedSourceIds.size || allowedSourceIds.has(record.sourceId))
      .map((record) => ({
        recordId: record.recordId,
        externalId: record.externalId,
        score: textScore(query, [record.title, record.text, record.snippet, record.sourceId].join("\n")),
        backendTrace: { backend: "external-knowledge-sidecar" }
      }))
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, normalizeLimit(limit));
  }

  return {
    db,
    rootPath,
    getState,
    setState,
    upsertRecord,
    saveEvidence,
    getRecord(recordId) {
      return hydrateRecord(getRecordStmt.get(String(recordId || "")));
    },
    getRecordByExternalId(externalId) {
      return hydrateRecord(getRecordByExternalStmt.get(String(externalId || "")));
    },
    getEvidence(evidenceId) {
      return hydrateEvidence(getEvidenceStmt.get(String(evidenceId || "")));
    },
    deleteBatch(batchId) {
      const timestamp = nowIso();
      return deleteBatchStmt.run(timestamp, timestamp, String(batchId || "")).changes;
    },
    tombstoneTarget(targetId) {
      const timestamp = nowIso();
      return tombstoneTargetStmt.run(timestamp, timestamp, String(targetId || "")).changes;
    },
    searchLocal,
    counts() {
      return {
        records: Number(countRecordsStmt.get()?.count || 0),
        tombstones: Number(countTombstonesStmt.get()?.count || 0)
      };
    },
    close() {
      db.close();
    }
  };
}

function recordLocator({ document = {}, section = {}, block = {}, asset = {} } = {}) {
  const unifiedSource = document.metadata?.unifiedSource || {};
  return compactObject({
    documentId: document.documentId || "",
    sectionId: section?.sectionId || block.sectionId || asset.sectionId || "",
    blockId: block.blockId || asset.blockId || "",
    assetId: asset.assetId || "",
    sourcePath: document.sourcePath || "",
    sourceId: document.sourceId || "",
    batchId: document.batchId || "",
    sourceType: unifiedSource.sourceType || document.documentType || "",
    providerId: unifiedSource.providerId || "",
    externalId: unifiedSource.externalId || "",
    syncBatchId: unifiedSource.syncBatchId || "",
    contentHash: unifiedSource.contentHash || document.sourceHash || "",
    capturedAt: unifiedSource.capturedAt || document.updatedAt || ""
  });
}

function sourceIdFromDocument(document = {}) {
  return String(document.sourceId || document.metadata?.sourceId || document.sourcePath || "").trim();
}

function textFromBlock(block = {}) {
  return normalizeText([block.title, block.snippet, block.text, block.summary].filter(Boolean).join("\n"));
}

function textFromAsset(asset = {}) {
  return normalizeText([asset.title, asset.caption, asset.ocrText, asset.text, asset.mediaType].filter(Boolean).join("\n"));
}

function recordFromBlock({ document = {}, section = {}, block = {}, embeddingRuntime }) {
  const text = textFromBlock(block);
  if (!block.blockId || !text) return null;
  const recordId = stableId("external-kb-record", "block", block.blockId);
  const vector = embeddingRuntime.embedText({
    title: block.title || document.title || "",
    text,
    metadata: block.metadata || {}
  }).vector;
  return {
    recordId,
    externalId: deterministicUuid(recordId),
    targetType: "block",
    targetId: block.blockId,
    documentId: document.documentId || block.documentId || "",
    sectionId: block.sectionId || section?.sectionId || "",
    blockId: block.blockId,
    assetId: "",
    batchId: document.batchId || "",
    sourceId: sourceIdFromDocument(document),
    title: block.title || document.title || "Knowledge block",
    text,
    snippet: block.snippet || text.slice(0, 360),
    locator: recordLocator({ document, section, block }),
    payload: { document, section: section || null, block, asset: null },
    metadata: {
      sourceLocator: block.sourceLocator || {},
      blockMetadata: block.metadata || {},
      documentMetadata: document.metadata || {}
    },
    vector,
    updatedAt: block.updatedAt || document.updatedAt || nowIso()
  };
}

function recordFromAsset({ document = {}, section = {}, asset = {}, embeddingRuntime }) {
  const text = textFromAsset(asset);
  if (!asset.assetId || !text) return null;
  const recordId = stableId("external-kb-record", "asset", asset.assetId);
  const vector = embeddingRuntime.embedImageEvidence(asset).vector;
  return {
    recordId,
    externalId: deterministicUuid(recordId),
    targetType: "asset",
    targetId: asset.assetId,
    documentId: document.documentId || asset.documentId || "",
    sectionId: asset.sectionId || section?.sectionId || "",
    blockId: asset.blockId || "",
    assetId: asset.assetId,
    batchId: document.batchId || "",
    sourceId: sourceIdFromDocument(document),
    title: asset.title || document.title || "Knowledge asset",
    text,
    snippet: asset.caption || asset.ocrText || asset.text || text.slice(0, 360),
    locator: recordLocator({ document, section, asset }),
    payload: { document, section: section || null, block: null, asset },
    metadata: {
      sourceLocator: asset.sourceLocator || {},
      assetMetadata: asset.metadata || {},
      documentMetadata: document.metadata || {}
    },
    vector,
    updatedAt: asset.updatedAt || document.updatedAt || nowIso()
  };
}

function recordsFromDocumentItem({ item = {}, embeddingRuntime }) {
  if (!item?.documentId) return [];
  const sectionsById = new Map(asArray(item.sections).map((section) => [section.sectionId, section]));
  const records = [];
  for (const block of asArray(item.blocks)) {
    const record = recordFromBlock({
      document: item,
      section: sectionsById.get(block.sectionId) || null,
      block,
      embeddingRuntime
    });
    if (record) records.push(record);
  }
  for (const asset of asArray(item.assets)) {
    const record = recordFromAsset({
      document: item,
      section: sectionsById.get(asset.sectionId) || null,
      asset,
      embeddingRuntime
    });
    if (record) records.push(record);
  }
  return records;
}

function externalPayload(record = {}) {
  return {
    pact_record_id: record.recordId,
    pact_external_id: record.externalId,
    pact_target_type: record.targetType,
    pact_target_id: record.targetId,
    pact_document_id: record.documentId,
    pact_section_id: record.sectionId || "",
    pact_block_id: record.blockId || "",
    pact_asset_id: record.assetId || "",
    pact_batch_id: record.batchId || "",
    pact_source_id: record.sourceId || "",
    pact_deleted: false,
    title: record.title || "",
    text: record.text || "",
    snippet: record.snippet || "",
    locator: record.locator || {},
    metadata: record.metadata || {},
    updated_at: record.updatedAt || nowIso()
  };
}

function evidenceMarkdown(evidence = {}) {
  const payload = evidence.payload || {};
  const document = payload.document || {};
  const block = payload.block || {};
  const asset = payload.asset || {};
  const body = block.text || block.snippet || asset.caption || asset.ocrText || asset.text || evidence.snippet || "";
  return [
    "---",
    "pact_knowledge:",
    `  protocolVersion: ${KNOWLEDGE_PROTOCOL_VERSION}`,
    `  evidenceId: ${evidence.evidenceId}`,
    `  source: external-knowledge-base`,
    "---",
    "",
    `# ${evidence.title || document.title || "Knowledge evidence"}`,
    "",
    body,
    "",
    "## Source",
    "",
    `- documentId: ${evidence.documentId || document.documentId || ""}`,
    `- sectionId: ${evidence.sectionId || ""}`,
    `- blockId: ${evidence.blockId || ""}`,
    `- assetId: ${evidence.assetId || ""}`,
    `- batchId: ${evidence.batchId || document.batchId || ""}`
  ].join("\n");
}

function buildEvidenceFromRecord({ record, query = "", score = 0, backendTrace = {} } = {}) {
  const payload = record.payload || {};
  const document = payload.document || {};
  const section = payload.section || null;
  const block = payload.block || null;
  const asset = payload.asset || null;
  const evidenceId = stableId("external-kb-evidence", query, record.recordId);
  const evidence = {
    evidenceId,
    recordId: record.recordId,
    query,
    batchId: record.batchId || document.batchId || "",
    documentId: record.documentId || document.documentId || "",
    sectionId: record.sectionId || section?.sectionId || "",
    blockId: record.blockId || block?.blockId || "",
    assetId: record.assetId || asset?.assetId || "",
    title: record.title || block?.title || asset?.title || document.title || "Knowledge evidence",
    snippet: record.snippet || block?.snippet || asset?.caption || "",
    score: Number(Math.max(0, Math.min(1, Number(score || 0))).toFixed(4)),
    reasons: [
      {
        kind: "external-knowledge-search",
        score: Number(score || 0),
        backendTrace
      }
    ],
    locator: {
      ...(record.locator || {}),
      query,
      externalRecordId: record.recordId,
      externalBackendId: record.externalId
    },
    payload: {
      record,
      document,
      section,
      blocks: block ? [block] : [],
      block,
      assets: asset ? [asset] : [],
      asset
    },
    createdAt: nowIso()
  };
  return {
    ...evidence,
    markdown: evidenceMarkdown(evidence)
  };
}

function headersForConfig(config = {}, extra = {}) {
  const headers = {
    "content-type": "application/json",
    ...extra
  };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
    headers["api-key"] = config.apiKey;
  }
  if (config.username || config.password) {
    headers.authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  }
  return headers;
}

async function fetchJson(url, options = {}, config = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs || 15000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await readResponseTextWithLimit(response);
    const payload = text.trim() ? parseJson(text, { raw: text }) : {};
    if (!response.ok) {
      const error = new Error(`External knowledge backend request failed: ${response.status} ${response.statusText}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function createDisabledClient(config = {}) {
  return {
    providerId: config.provider || "disabled",
    async ensureSchema() {
      return { ok: false, skipped: true, reason: "external knowledge backend disabled" };
    },
    async upsert() {
      return { upserted: 0, skipped: true, reason: "external knowledge backend disabled" };
    },
    async search() {
      return { results: [], skipped: true, reason: "external knowledge backend disabled" };
    },
    async deleteBatch() {
      return { deleted: 0, skipped: true, reason: "external knowledge backend disabled" };
    },
    async health() {
      return {
        ok: true,
        enabled: false,
        providerId: this.providerId,
        degraded: true,
        reason: "external knowledge backend disabled"
      };
    },
    async close() {}
  };
}

function createQdrantClient(config = {}) {
  const collection = config.collection || DEFAULT_EXTERNAL_COLLECTION;
  const collectionUrl = joinUrl(config.endpoint, `/collections/${encodeURIComponent(collection)}`);

  async function ensureSchema() {
    try {
      await fetchJson(collectionUrl, { method: "GET", headers: headersForConfig(config) }, config);
      return { ok: true, providerId: "qdrant", collection, existing: true };
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    await fetchJson(
      collectionUrl,
      {
        method: "PUT",
        headers: headersForConfig(config),
        body: stringifyJson({
          vectors: {
            size: config.dimension || DEFAULT_EXTERNAL_DIMENSION,
            distance: "Cosine"
          }
        })
      },
      config
    );
    return { ok: true, providerId: "qdrant", collection, created: true };
  }

  function qdrantFilter({ batchId = "", sourceIds = [] } = {}) {
    const must = [
      { key: "pact_deleted", match: { value: false } }
    ];
    if (batchId) {
      must.push({ key: "pact_batch_id", match: { value: batchId } });
    }
    const allowedSourceIds = asArray(sourceIds).filter(Boolean).map(String);
    if (allowedSourceIds.length === 1) {
      must.push({ key: "pact_source_id", match: { value: allowedSourceIds[0] } });
    }
    if (allowedSourceIds.length > 1) {
      must.push({ key: "pact_source_id", match: { any: allowedSourceIds } });
    }
    return { must };
  }

  return {
    providerId: "qdrant",
    ensureSchema,
    async upsert(records = []) {
      if (!records.length) return { providerId: "qdrant", upserted: 0 };
      await ensureSchema();
      const points = records.map((record) => ({
        id: record.externalId || deterministicUuid(record.recordId),
        vector: record.vector,
        payload: externalPayload(record)
      }));
      await fetchJson(
        joinUrl(config.endpoint, `/collections/${encodeURIComponent(collection)}/points?wait=true`),
        {
          method: "PUT",
          headers: headersForConfig(config),
          body: stringifyJson({ points })
        },
        config
      );
      return { providerId: "qdrant", collection, upserted: records.length };
    },
    async search({ query = "", vector = [], limit = 20, batchId = "", sourceIds = [] } = {}) {
      await ensureSchema();
      const payload = await fetchJson(
        joinUrl(config.endpoint, `/collections/${encodeURIComponent(collection)}/points/search`),
        {
          method: "POST",
          headers: headersForConfig(config),
          body: stringifyJson({
            vector,
            limit: normalizeLimit(limit),
            with_payload: true,
            filter: qdrantFilter({ batchId, sourceIds })
          })
        },
        config
      );
      return {
        providerId: "qdrant",
        collection,
        query,
        results: asArray(payload.result).map((item) => ({
          recordId: item.payload?.pact_record_id || "",
          externalId: String(item.id || item.payload?.pact_external_id || ""),
          score: Number(item.score || 0),
          backendTrace: { providerId: "qdrant", collection, id: item.id }
        })).filter((item) => item.recordId || item.externalId)
      };
    },
    async deleteBatch(batchId = "") {
      if (!batchId) return { providerId: "qdrant", deleted: 0 };
      await ensureSchema();
      await fetchJson(
        joinUrl(config.endpoint, `/collections/${encodeURIComponent(collection)}/points/delete?wait=true`),
        {
          method: "POST",
          headers: headersForConfig(config),
          body: stringifyJson({
            filter: qdrantFilter({ batchId })
          })
        },
        config
      );
      return { providerId: "qdrant", collection, deletedBatchId: batchId };
    },
    async health() {
      try {
        const schema = await ensureSchema();
        return {
          ok: true,
          enabled: true,
          providerId: "qdrant",
          backend: "qdrant",
          collection,
          endpointConfigured: Boolean(config.endpoint),
          ...schema
        };
      } catch (error) {
        return {
          ok: false,
          enabled: true,
          degraded: true,
          providerId: "qdrant",
          backend: "qdrant",
          collection,
          endpointConfigured: Boolean(config.endpoint),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async close() {}
  };
}

function createOpenSearchClient(config = {}) {
  const index = config.collection || DEFAULT_EXTERNAL_COLLECTION;
  const indexUrl = joinUrl(config.endpoint, `/${encodeURIComponent(index)}`);

  async function ensureSchema() {
    try {
      await fetchJson(indexUrl, { method: "HEAD", headers: headersForConfig(config) }, config);
      return { ok: true, providerId: "opensearch", index, existing: true };
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    await fetchJson(
      indexUrl,
      {
        method: "PUT",
        headers: headersForConfig(config),
        body: stringifyJson({
          settings: {
            index: {
              knn: true
            }
          },
          mappings: {
            properties: {
              title: { type: "text" },
              text: { type: "text" },
              snippet: { type: "text" },
              embedding: {
                type: "knn_vector",
                dimension: config.dimension || DEFAULT_EXTERNAL_DIMENSION
              },
              pact_batch_id: { type: "keyword" },
              pact_source_id: { type: "keyword" },
              pact_record_id: { type: "keyword" },
              pact_deleted: { type: "boolean" }
            }
          }
        })
      },
      config
    );
    return { ok: true, providerId: "opensearch", index, created: true };
  }

  function filterClauses({ batchId = "", sourceIds = [] } = {}) {
    const filters = [{ term: { pact_deleted: false } }];
    if (batchId) filters.push({ term: { pact_batch_id: batchId } });
    const allowedSourceIds = asArray(sourceIds).filter(Boolean).map(String);
    if (allowedSourceIds.length) filters.push({ terms: { pact_source_id: allowedSourceIds } });
    return filters;
  }

  function hitsFromOpenSearch(payload = {}, scoreWeight = 1, reason = "opensearch") {
    return asArray(payload.hits?.hits).map((hit) => ({
      recordId: hit._source?.pact_record_id || hit._id || "",
      externalId: hit._source?.pact_external_id || hit._id || "",
      score: Number(hit._score || 0) * scoreWeight,
      backendTrace: { providerId: "opensearch", index, id: hit._id, reason }
    })).filter((item) => item.recordId || item.externalId);
  }

  function fuseOpenSearchHits(resultSets = []) {
    const byRecordId = new Map();
    for (const resultSet of resultSets) {
      for (const hit of resultSet) {
        const key = hit.recordId || hit.externalId;
        const current = byRecordId.get(key) || {
          ...hit,
          score: 0,
          backendTrace: {
            providerId: "opensearch",
            index,
            reasons: []
          }
        };
        current.score += Number(hit.score || 0);
        current.backendTrace.reasons.push(hit.backendTrace);
        byRecordId.set(key, current);
      }
    }
    return [...byRecordId.values()].sort((left, right) => right.score - left.score);
  }

  return {
    providerId: "opensearch",
    ensureSchema,
    async upsert(records = []) {
      if (!records.length) return { providerId: "opensearch", upserted: 0 };
      await ensureSchema();
      const body = records.flatMap((record) => [
        { index: { _index: index, _id: record.recordId } },
        {
          ...externalPayload(record),
          embedding: record.vector
        }
      ]).map((line) => stringifyJson(line)).join("\n");
      const result = await fetchJson(
        joinUrl(config.endpoint, "/_bulk"),
        {
          method: "POST",
          headers: headersForConfig(config, { "content-type": "application/x-ndjson" }),
          body: `${body}\n`
        },
        config
      );
      if (result.errors) {
        throw new Error("OpenSearch bulk upsert reported item errors.");
      }
      return { providerId: "opensearch", index, upserted: records.length };
    },
    async search({ query = "", vector = [], limit = 20, batchId = "", sourceIds = [] } = {}) {
      await ensureSchema();
      const size = normalizeLimit(limit);
      const filters = filterClauses({ batchId, sourceIds });
      const lexicalRequest = fetchJson(
        joinUrl(config.endpoint, `/${encodeURIComponent(index)}/_search`),
        {
          method: "POST",
          headers: headersForConfig(config),
          body: stringifyJson({
            size,
            query: {
              bool: {
                filter: filters,
                must: {
                  multi_match: {
                    query,
                    fields: ["title^2", "text", "snippet"]
                  }
                }
              }
            }
          })
        },
        config
      );
      const vectorRequest = fetchJson(
        joinUrl(config.endpoint, `/${encodeURIComponent(index)}/_search`),
        {
          method: "POST",
          headers: headersForConfig(config),
          body: stringifyJson({
            size,
            query: {
              knn: {
                embedding: {
                  vector,
                  k: size,
                  filter: {
                    bool: {
                      filter: filters
                    }
                  }
                }
              }
            }
          })
        },
        config
      );
      const [lexicalResult, vectorResult] = await Promise.allSettled([lexicalRequest, vectorRequest]);
      if (lexicalResult.status === "rejected" && vectorResult.status === "rejected") {
        throw lexicalResult.reason;
      }
      const lexicalHits = lexicalResult.status === "fulfilled"
        ? hitsFromOpenSearch(lexicalResult.value, 0.55, "lexical")
        : [];
      const vectorHits = vectorResult.status === "fulfilled"
        ? hitsFromOpenSearch(vectorResult.value, 0.45, "vector")
        : [];
      return {
        providerId: "opensearch",
        index,
        query,
        results: fuseOpenSearchHits([lexicalHits, vectorHits]).slice(0, size),
        degraded: lexicalResult.status === "rejected" || vectorResult.status === "rejected"
      };
    },
    async deleteBatch(batchId = "") {
      if (!batchId) return { providerId: "opensearch", deleted: 0 };
      await ensureSchema();
      await fetchJson(
        joinUrl(config.endpoint, `/${encodeURIComponent(index)}/_delete_by_query`),
        {
          method: "POST",
          headers: headersForConfig(config),
          body: stringifyJson({
            query: {
              bool: {
                filter: filterClauses({ batchId })
              }
            }
          })
        },
        config
      );
      return { providerId: "opensearch", index, deletedBatchId: batchId };
    },
    async health() {
      try {
        const schema = await ensureSchema();
        return {
          ok: true,
          enabled: true,
          providerId: "opensearch",
          backend: "opensearch",
          index,
          endpointConfigured: Boolean(config.endpoint),
          ...schema
        };
      } catch (error) {
        return {
          ok: false,
          enabled: true,
          degraded: true,
          providerId: "opensearch",
          backend: "opensearch",
          index,
          endpointConfigured: Boolean(config.endpoint),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async close() {}
  };
}

function pgVectorLiteral(vector = []) {
  return `[${asArray(vector).map((value) => Number(value || 0)).join(",")}]`;
}

function createPgVectorClient(config = {}) {
  let pool = null;

  async function loadPg() {
    try {
      const pg = await import("pg");
      return pg.default || pg;
    } catch (error) {
      const wrapped = new Error("pg dependency is required for pgvector external knowledge backend.");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async function getPool() {
    if (pool) return pool;
    const pg = await loadPg();
    pool = new pg.Pool({
      connectionString: config.connectionString || config.endpoint,
      ssl: config.verifyTls === false ? false : undefined
    });
    return pool;
  }

  async function ensureSchema() {
    const resolvedPool = await getPool();
    await resolvedPool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await resolvedPool.query(`
      CREATE TABLE IF NOT EXISTS pact_external_knowledge (
        record_id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        section_id TEXT NOT NULL DEFAULT '',
        block_id TEXT NOT NULL DEFAULT '',
        asset_id TEXT NOT NULL DEFAULT '',
        batch_id TEXT NOT NULL DEFAULT '',
        source_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        snippet TEXT NOT NULL DEFAULT '',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding vector(${config.dimension || DEFAULT_EXTERNAL_DIMENSION}),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await resolvedPool.query("CREATE INDEX IF NOT EXISTS idx_pact_external_knowledge_batch ON pact_external_knowledge(batch_id) WHERE deleted_at IS NULL");
    await resolvedPool.query("CREATE INDEX IF NOT EXISTS idx_pact_external_knowledge_source ON pact_external_knowledge(source_id) WHERE deleted_at IS NULL");
    await resolvedPool.query("CREATE INDEX IF NOT EXISTS idx_pact_external_knowledge_fts ON pact_external_knowledge USING GIN (to_tsvector('simple', title || ' ' || text || ' ' || snippet))");
    return { ok: true, providerId: "pgvector", table: "pact_external_knowledge" };
  }

  return {
    providerId: "pgvector",
    ensureSchema,
    async upsert(records = []) {
      if (!records.length) return { providerId: "pgvector", upserted: 0 };
      await ensureSchema();
      const resolvedPool = await getPool();
      for (const record of records) {
        await resolvedPool.query(
          `
            INSERT INTO pact_external_knowledge (
              record_id, external_id, target_type, target_id, document_id, section_id, block_id,
              asset_id, batch_id, source_id, title, text, snippet, payload, metadata, embedding, updated_at, deleted_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::vector,now(),NULL)
            ON CONFLICT(record_id) DO UPDATE SET
              external_id = excluded.external_id,
              target_type = excluded.target_type,
              target_id = excluded.target_id,
              document_id = excluded.document_id,
              section_id = excluded.section_id,
              block_id = excluded.block_id,
              asset_id = excluded.asset_id,
              batch_id = excluded.batch_id,
              source_id = excluded.source_id,
              title = excluded.title,
              text = excluded.text,
              snippet = excluded.snippet,
              payload = excluded.payload,
              metadata = excluded.metadata,
              embedding = excluded.embedding,
              updated_at = now(),
              deleted_at = NULL
          `,
          [
            record.recordId,
            record.externalId,
            record.targetType,
            record.targetId,
            record.documentId,
            record.sectionId || "",
            record.blockId || "",
            record.assetId || "",
            record.batchId || "",
            record.sourceId || "",
            record.title || "",
            record.text || "",
            record.snippet || "",
            stringifyJson(externalPayload(record)),
            stringifyJson(record.metadata || {}),
            pgVectorLiteral(record.vector)
          ]
        );
      }
      return { providerId: "pgvector", upserted: records.length };
    },
    async search({ query = "", vector = [], limit = 20, batchId = "", sourceIds = [] } = {}) {
      await ensureSchema();
      const resolvedPool = await getPool();
      const clauses = ["deleted_at IS NULL"];
      const params = [pgVectorLiteral(vector), query];
      if (batchId) {
        params.push(batchId);
        clauses.push(`batch_id = $${params.length}`);
      }
      const allowedSourceIds = asArray(sourceIds).filter(Boolean).map(String);
      if (allowedSourceIds.length) {
        params.push(allowedSourceIds);
        clauses.push(`source_id = ANY($${params.length})`);
      }
      params.push(normalizeLimit(limit));
      const result = await resolvedPool.query(
        `
          SELECT
            record_id,
            external_id,
            1 - (embedding <=> $1::vector) +
              ts_rank_cd(to_tsvector('simple', title || ' ' || text || ' ' || snippet), plainto_tsquery('simple', $2)) AS score
          FROM pact_external_knowledge
          WHERE ${clauses.join(" AND ")}
          ORDER BY score DESC
          LIMIT $${params.length}
        `,
        params
      );
      return {
        providerId: "pgvector",
        query,
        results: result.rows.map((row) => ({
          recordId: row.record_id,
          externalId: row.external_id,
          score: Number(row.score || 0),
          backendTrace: { providerId: "pgvector", table: "pact_external_knowledge" }
        }))
      };
    },
    async deleteBatch(batchId = "") {
      if (!batchId) return { providerId: "pgvector", deleted: 0 };
      await ensureSchema();
      const resolvedPool = await getPool();
      const result = await resolvedPool.query(
        "UPDATE pact_external_knowledge SET deleted_at = now(), updated_at = now() WHERE batch_id = $1 AND deleted_at IS NULL",
        [batchId]
      );
      return { providerId: "pgvector", deleted: result.rowCount || 0 };
    },
    async health() {
      try {
        const schema = await ensureSchema();
        return {
          ok: true,
          enabled: true,
          providerId: "pgvector",
          backend: "postgresql-pgvector",
          connectionConfigured: Boolean(config.connectionString || config.endpoint),
          ...schema
        };
      } catch (error) {
        return {
          ok: false,
          enabled: true,
          degraded: true,
          providerId: "pgvector",
          backend: "postgresql-pgvector",
          connectionConfigured: Boolean(config.connectionString || config.endpoint),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async close() {
      if (pool) {
        await pool.end();
        pool = null;
      }
    }
  };
}

function createExternalClient(config = {}) {
  if (!config.enabled) return createDisabledClient(config);
  if (config.provider === "qdrant") return createQdrantClient(config);
  if (config.provider === "opensearch") return createOpenSearchClient(config);
  if (config.provider === "pgvector" || config.provider === "postgres" || config.provider === "postgresql") {
    return createPgVectorClient({ ...config, provider: "pgvector" });
  }
  return createDisabledClient({
    ...config,
    provider: config.provider || "unsupported",
    enabled: false
  });
}

export async function createExternalKnowledgeBaseMount({ userDataPath, runtimeOptions = {} } = {}) {
  const resolvedUserDataPath = userDataPath || ServerConfig.getDataDir();
  const rootPath = path.join(resolvedUserDataPath, "external-knowledge-base");
  const store = createAdapterStore(rootPath);
  const embeddingRuntime = createEmbeddingRuntime({ settings: { dimension: DEFAULT_EXTERNAL_DIMENSION } });
  const core = await createKnowledgeCoreMount({ userDataPath: resolvedUserDataPath, outlineEnabled: true });
  let currentConfig = readRuntimeConfig({ runtimeOptions });
  let externalClient = createExternalClient(currentConfig);

  function capabilities() {
    const coreCapabilities = typeof core.capabilities === "function" ? core.capabilities() : {};
    return {
      ...coreCapabilities,
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      adapterProtocolVersion: EXTERNAL_KNOWLEDGE_ADAPTER_PROTOCOL_VERSION,
      backend: {
        adapterId: "external-knowledge-base",
        backendKind: currentConfig.enabled ? "external" : "external-disabled",
        vendor: currentConfig.provider,
        deployment: currentConfig.endpoint || currentConfig.connectionString ? "operator-configured" : "not-configured",
        profileId: currentConfig.collection || DEFAULT_EXTERNAL_COLLECTION
      },
      supports: {
        ...(coreCapabilities.supports || {}),
        ingestNormalizedDocuments: true,
        search: true,
        evidenceRead: true,
        assetRead: true,
        docxExport: true,
        hierarchy: true,
        relationships: true,
        vectorSearch: ["qdrant", "opensearch", "pgvector", "postgres", "postgresql"].includes(currentConfig.provider),
        lexicalSearch: ["opensearch", "pgvector", "postgres", "postgresql"].includes(currentConfig.provider),
        hybridSearch: ["opensearch", "pgvector", "postgres", "postgresql"].includes(currentConfig.provider),
        metadataFilters: true,
        rerank: false,
        syncMirror: true,
        deleteBatch: true,
        reindex: true
      },
      objectModel: {
        externalIdsStable: true,
        storesSourceTrace: true,
        storesCitations: true,
        storesAssetLocators: true,
        opaqueAssetIds: true
      },
      limits: {
        maxBatchDocuments: 10000,
        maxBlockBytes: 65536,
        maxTopK: 200,
        maxAssetBytes: 52428800
      },
      externalKnowledgeBase: {
        provider: currentConfig.provider,
        enabled: currentConfig.enabled,
        collection: currentConfig.collection,
        dimension: currentConfig.dimension,
        rootPath
      }
    };
  }

  async function health() {
    const coreHealth = typeof core.health === "function" ? await core.health() : null;
    const externalHealth = typeof externalClient.health === "function"
      ? await externalClient.health()
      : { ok: false, error: "external client has no health method" };
    const counts = store.counts();
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      adapterProtocolVersion: EXTERNAL_KNOWLEDGE_ADAPTER_PROTOCOL_VERSION,
      ok: Boolean(coreHealth?.ok !== false && (externalHealth.ok || !currentConfig.enabled)),
      degraded: currentConfig.enabled ? externalHealth.ok === false : true,
      backend: {
        adapterId: "external-knowledge-base",
        provider: currentConfig.provider,
        collection: currentConfig.collection,
        enabled: currentConfig.enabled,
        endpointConfigured: Boolean(currentConfig.endpoint || currentConfig.connectionString)
      },
      counts,
      core: coreHealth,
      external: externalHealth,
      capabilities: capabilities()
    };
  }

  async function upsertExternalRecords(records = []) {
    const uniqueRecords = [...new Map(records.map((record) => [record.recordId, record])).values()];
    for (const record of uniqueRecords) {
      store.upsertRecord(record);
    }
    if (!currentConfig.enabled || !uniqueRecords.length) {
      return {
        providerId: currentConfig.provider,
        upserted: uniqueRecords.length,
        externalSkipped: true
      };
    }
    try {
      return await externalClient.upsert(uniqueRecords);
    } catch (error) {
      return {
        providerId: currentConfig.provider,
        upserted: 0,
        sidecarUpserted: uniqueRecords.length,
        degraded: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function mirrorDocument(documentId = "") {
    const item = typeof core.getItem === "function" ? await core.getItem({ documentId }) : null;
    const records = recordsFromDocumentItem({ item, embeddingRuntime });
    return upsertExternalRecords(records);
  }

  async function syncExternalFromCore({ since = null, full = false } = {}) {
    const startCursor = full ? 0 : Number((since ?? store.getState("coreSyncCursor", 0)) || 0);
    let cursor = startCursor;
    let latestCursor = startCursor;
    let upserted = 0;
    let tombstoned = 0;
    const warnings = [];
    for (let page = 0; page < 200; page += 1) {
      const sync = typeof core.syncMirror === "function"
        ? await core.syncMirror({ since: cursor, limit: 1000 })
        : { changes: [], cursor, latestCursor: cursor, hasMore: false };
      latestCursor = Number(sync.latestCursor || sync.cursor || latestCursor);
      const documentIds = new Set();
      for (const change of asArray(sync.changes)) {
        if (change.action === "delete") {
          tombstoned += store.tombstoneTarget(change.entityId);
          continue;
        }
        if (["document", "section", "block", "asset"].includes(change.kind)) {
          const documentId = change.kind === "document"
            ? change.entityId
            : change.itemId || change.record?.documentId || change.record?.payload?.documentId || "";
          if (documentId) documentIds.add(documentId);
        }
      }
      for (const documentId of documentIds) {
        const result = await mirrorDocument(documentId);
        upserted += Number(result.sidecarUpserted || result.upserted || 0);
        if (result.degraded || result.error) warnings.push(result);
      }
      cursor = Number(sync.cursor || cursor);
      if (!sync.hasMore || cursor >= latestCursor) break;
    }
    store.setState("coreSyncCursor", latestCursor);
    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      adapterProtocolVersion: EXTERNAL_KNOWLEDGE_ADAPTER_PROTOCOL_VERSION,
      cursor: String(latestCursor),
      startedAtCursor: String(startCursor),
      upserted,
      tombstoned,
      warnings
    };
  }

  async function upsertDocuments(input = {}) {
    const result = typeof core.upsertDocuments === "function" ? await core.upsertDocuments(input) : null;
    const documents = asArray(input.documents);
    const records = documents.flatMap((document) => recordsFromDocumentItem({ item: document, embeddingRuntime }));
    const external = records.length
      ? await upsertExternalRecords(records)
      : await syncExternalFromCore({});
    return {
      ...(result || {}),
      externalKnowledgeBase: external
    };
  }

  async function ingestBatch(input = {}) {
    const result = typeof core.ingestBatch === "function" ? await core.ingestBatch(input) : null;
    const external = await syncExternalFromCore({});
    return {
      ...(result || {}),
      externalKnowledgeBase: external
    };
  }

  async function ingestSources(input = {}) {
    const result = typeof core.ingestSources === "function" ? await core.ingestSources(input) : null;
    const external = await syncExternalFromCore({});
    return {
      ...(result || {}),
      externalKnowledgeBase: external
    };
  }

  async function deleteBatch(batchId = "") {
    const normalizedBatchId = typeof batchId === "object" ? String(batchId.batchId || "") : String(batchId || "");
    const coreResult = typeof core.deleteBatch === "function" ? await core.deleteBatch(normalizedBatchId) : { ok: true };
    const sidecarDeleted = store.deleteBatch(normalizedBatchId);
    let external = { deleted: 0, skipped: true };
    if (currentConfig.enabled && typeof externalClient.deleteBatch === "function") {
      try {
        external = await externalClient.deleteBatch(normalizedBatchId);
      } catch (error) {
        external = {
          deleted: 0,
          degraded: true,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    return {
      ...(coreResult || {}),
      batchId: normalizedBatchId,
      externalKnowledgeBase: {
        sidecarDeleted,
        external
      }
    };
  }

  async function search(input = {}) {
    const query = normalizeText(input.query || input.q || "");
    const limit = normalizeLimit(input.limit || input.topK || 20);
    const batchId = String(input.batchId || input.filters?.batchId || "").trim();
    const sourceIds = asArray(input.scopeSourceIds || input.sourceIds || input.filters?.sourceIds).map(String).filter(Boolean);
    const vector = embeddingRuntime.embedText(query).vector;
    let externalResult = null;
    let externalError = null;
    if (currentConfig.enabled && query) {
      try {
        externalResult = await externalClient.search({
          query,
          vector,
          limit,
          batchId,
          sourceIds
        });
      } catch (error) {
        externalError = error instanceof Error ? error.message : String(error);
      }
    }
    const hits = asArray(externalResult?.results);
    const resolvedHits = hits
      .map((hit) => {
        const record = hit.recordId
          ? store.getRecord(hit.recordId)
          : store.getRecordByExternalId(hit.externalId);
        return record ? { hit, record } : null;
      })
      .filter(Boolean);
    const fallbackHits = resolvedHits.length
      ? []
      : store.searchLocal({ query, limit, batchId, sourceIds })
        .map((hit) => ({ hit, record: store.getRecord(hit.recordId) }))
        .filter((entry) => entry.record);
    const selectedHits = (resolvedHits.length ? resolvedHits : fallbackHits).slice(0, limit);

    if (!selectedHits.length) {
      const fallback = typeof core.search === "function"
        ? await core.search(input)
        : { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, query, items: [] };
      return {
        ...fallback,
        retrievalMode: fallback.retrievalMode || "hybrid",
        externalKnowledgeBase: {
          provider: currentConfig.provider,
          enabled: currentConfig.enabled,
          used: false,
          fallback: true,
          error: externalError || "",
          sidecarCount: store.counts().records
        }
      };
    }

    const items = selectedHits.map(({ hit, record }) => {
      const score = Math.max(0, Math.min(1, Number(hit.score || 0)));
      const evidence = buildEvidenceFromRecord({
        record,
        query,
        score,
        backendTrace: hit.backendTrace || {}
      });
      store.saveEvidence(evidence);
      return {
        evidenceId: evidence.evidenceId,
        itemId: evidence.documentId,
        itemType: evidence.payload.document?.documentType || "",
        documentId: evidence.documentId,
        batchId: evidence.batchId,
        title: evidence.title,
        snippet: evidence.snippet,
        score: evidence.score,
        modalities: [
          evidence.blockId ? "text" : "",
          evidence.assetId ? "image" : ""
        ].filter(Boolean),
        source: evidence.locator,
        reasons: evidence.reasons,
        hierarchy: null,
        assets: evidence.payload.assets || []
      };
    });

    return {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      query,
      batchId,
      limit,
      retrievalMode: currentConfig.provider === "qdrant" ? "vector" : "hybrid",
      modalityPolicy: {
        mode: "multimodal",
        text: true,
        image: true,
        filtersAllowed: true
      },
      externalKnowledgeBase: {
        provider: currentConfig.provider,
        enabled: currentConfig.enabled,
        used: Boolean(resolvedHits.length),
        fallback: !resolvedHits.length,
        error: externalError || "",
        resultCount: items.length,
        backend: externalResult ? {
          providerId: externalResult.providerId,
          collection: externalResult.collection || externalResult.index || ""
        } : null
      },
      items
    };
  }

  function getEvidence(input = {}) {
    const evidence = store.getEvidence(input.evidenceId);
    return evidence || (typeof core.getEvidence === "function" ? core.getEvidence(input) : null);
  }

  function renderMarkdown(input = {}) {
    const evidence = input.evidenceId ? store.getEvidence(input.evidenceId) : null;
    if (evidence) {
      return {
        protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
        evidenceId: evidence.evidenceId,
        contentType: "text/markdown; charset=utf-8",
        markdown: evidence.markdown || evidenceMarkdown(evidence)
      };
    }
    return typeof core.renderMarkdown === "function" ? core.renderMarkdown(input) : null;
  }

  async function reindex(input = {}) {
    const coreResult = typeof core.reindex === "function" ? await core.reindex(input) : null;
    store.setState("coreSyncCursor", 0);
    const external = await syncExternalFromCore({ full: true });
    return {
      ...(coreResult || {}),
      externalKnowledgeBase: external
    };
  }

  return {
    id: "external/knowledge-base",
    kind: "knowledgeBase",
    enabled: true,
    protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
    adapterProtocolVersion: EXTERNAL_KNOWLEDGE_ADAPTER_PROTOCOL_VERSION,
    capabilities,
    health,
    getMaintenance: core.getMaintenance,
    setMaintenance: core.setMaintenance,
    ingestBatch,
    ingestSources,
    upsertDocuments,
    deleteBatch,
    search,
    prepareHierarchyReasoning: core.prepareHierarchyReasoning,
    recordFeedback: core.recordFeedback,
    feedbackSince: core.feedbackSince,
    listSuggestions: core.listSuggestions,
    resolveSuggestion: core.resolveSuggestion,
    listReviewItems: core.listReviewItems,
    resolveReviewItem: core.resolveReviewItem,
    runLearningJob: core.runLearningJob,
    learningHealth: core.learningHealth,
    createRetrievalProfileDeployment: core.createRetrievalProfileDeployment,
    listRetrievalProfileDeployments: core.listRetrievalProfileDeployments,
    promoteRetrievalProfileDeployment: core.promoteRetrievalProfileDeployment,
    rollbackRetrievalProfileDeployment: core.rollbackRetrievalProfileDeployment,
    auditHierarchyIndex: core.auditHierarchyIndex,
    getEvidence,
    aggregate: core.aggregate,
    getAssetContent: core.getAssetContent,
    exportDocx: core.exportDocx,
    renderMarkdown,
    getItem: core.getItem,
    getDocumentStructure: core.getDocumentStructure,
    syncMirror: core.syncMirror,
    reindex,
    runMaintenance: core.runMaintenance,
    listMaintenanceRuns: core.listMaintenanceRuns,
    listRetrievalProfiles: core.listRetrievalProfiles,
    getRetrievalProfile: core.getRetrievalProfile,
    async onBatchCompleted({ batchId, result, settings } = {}) {
      if (settings?.knowledgeCoreEnabled === false) {
        return {
          skipped: true,
          reason: "knowledgeCoreEnabled=false"
        };
      }
      return ingestBatch({ batchId, result, settings });
    },
    async reload({ settings = {} } = {}) {
      if (typeof core.reload === "function") {
        await core.reload({ settings });
      }
      currentConfig = readRuntimeConfig({ runtimeOptions, settings });
      if (typeof externalClient.close === "function") {
        await externalClient.close();
      }
      externalClient = createExternalClient(currentConfig);
    },
    async close() {
      if (typeof externalClient.close === "function") {
        await externalClient.close();
      }
      store.close();
      if (typeof core.close === "function") {
        await core.close();
      }
    }
  };
}

export const createMount = createExternalKnowledgeBaseMount;
export default createExternalKnowledgeBaseMount;
