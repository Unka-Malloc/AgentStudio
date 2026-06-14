import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../../../../common/config/ServerConfig.mjs";

export const VECTOR_PROTOCOL_VERSION = "v0.0.1:knowledge:vector-1";
export const LANCEDB_PROVIDER_ID = "lancedb";

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function hashText(value, length = 32) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableExternalId(batchId, entityId) {
  return `pact::${hashText(`${batchId}\u001f${entityId}`, 40)}`;
}

function chunkText(chunk = {}) {
  return normalizeText([chunk.title, chunk.text, chunk.snippet, chunk.summary].filter(Boolean).join("\n"));
}

function sourceMetadataById(result = {}) {
  const map = new Map();
  for (const source of asArray(result.sourceFiles)) {
    const sourceId = String(source.id || source.sourceId || source.sourceRef || source.name || "");
    if (!sourceId) {
      continue;
    }
    map.set(sourceId, {
      sourceFileId: sourceId,
      sourceName: source.name || source.originalFileName || "",
      sourcePath: source.path || source.originalRelativePath || "",
      mediaType: source.mediaType || "",
      rawObjectId: source.rawObjectId || "",
      rawObjectSha256: source.rawObjectSha256 || ""
    });
  }
  return map;
}

function recordsFromBatch({ batchId, jobId = "", result = {} } = {}) {
  const sources = sourceMetadataById(result);
  const records = [];
  for (const chunk of asArray(result.chunks || result.knowledge?.chunks || result.retrieval?.items)) {
    const chunkId = String(chunk.chunkId || chunk.id || chunk.retrievalId || "").trim();
    const text = chunkText(chunk);
    if (!chunkId || !text) {
      continue;
    }
    const metadata = chunk.metadata || {};
    const source = sources.get(chunk.sourceId || metadata.sourceId || chunk.source) || {};
    records.push({
      id: stableExternalId(batchId, chunkId),
      batchId,
      jobId: jobId || result.jobId || batchId,
      entityId: chunkId,
      itemId: chunk.itemId || metadata.itemId || "",
      text,
      snippet: chunk.snippet || text.slice(0, 240),
      sourceFileId: source.sourceFileId || metadata.sourceId || "",
      sourceName: source.sourceName || chunk.source || "",
      sourcePath: source.sourcePath || "",
      transactionIds: asArray(metadata.transactionIds || metadata.transactionId).filter(Boolean),
      personIds: asArray(metadata.personIds || metadata.participantIds).filter(Boolean),
      threadIds: asArray(metadata.threadIds || metadata.threadId).filter(Boolean),
      generatedAt: result.generatedAt || nowIso(),
      sourceTimestamp: chunk.timestamp || metadata.timestamp || "",
      retrievalWeights: {
        timeWeight: Number(metadata.timeWeight || chunk.timeWeight || 0),
        formalUseAllowed: Boolean(metadata.formalUseAllowed || chunk.formalUseAllowed)
      },
      metadata: {
        ...metadata,
        provider: LANCEDB_PROVIDER_ID,
        source
      }
    });
  }
  return records;
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export function createLanceDbVectorStore(options = {}) {
  const rootPath = path.join(options.userDataPath || ServerConfig.getDataDir(), "lancedb-vector-store");
  const spoolPath = options.spoolPath || path.join(rootPath, "upserts.json");
  const providerId = String(options.providerId || LANCEDB_PROVIDER_ID);
  const uri = options.uri || options.settings?.uri || process.env.PACT_LANCEDB_URI || "";
  const explicitModel = options.embeddingModel || options.settings?.embeddingModel || process.env.PACT_LANCEDB_EMBEDDING_MODEL || "";

  function ensureSchema() {
    fs.mkdirSync(rootPath, { recursive: true });
    if (!fs.existsSync(spoolPath)) {
      writeJsonArray(spoolPath, []);
    }
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      ok: true,
      providerId,
      backend: "lancedb-adapter-spool",
      rootPath,
      spoolPath
    };
  }

  function upsert(input = {}) {
    ensureSchema();
    const incoming = asArray(input.records || input.items || input).filter((item) => item?.id || item?.entityId || item?.targetId);
    const current = readJsonArray(spoolPath);
    const byId = new Map(current.map((record) => [record.id || stableExternalId(record.batchId, record.entityId), record]));
    for (const item of incoming) {
      const id = item.id || stableExternalId(item.batchId || "", item.entityId || item.targetId || "");
      byId.set(id, {
        ...item,
        id,
        providerId,
        updatedAt: item.updatedAt || nowIso()
      });
    }
    writeJsonArray(spoolPath, [...byId.values()].sort((left, right) => String(left.id).localeCompare(String(right.id))));
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      upserted: incoming.length,
      backend: "lancedb-adapter-spool",
      externalUriConfigured: Boolean(uri)
    };
  }

  function search(input = {}) {
    ensureSchema();
    const query = normalizeText(input.query || input.text || "");
    const limit = Math.max(1, Math.min(Number(input.limit || 20), 200));
    const tokens = new Set((query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []).filter(Boolean));
    const records = readJsonArray(spoolPath);
    const results = records
      .map((record) => {
        const text = normalizeText([record.text, record.snippet, record.sourceName, record.sourcePath].join("\n"));
        const textTokens = new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []).filter(Boolean));
        const hits = [...tokens].filter((token) => textTokens.has(token)).length;
        const score = tokens.size ? hits / tokens.size : 0;
        return {
          targetType: "block",
          targetId: record.entityId,
          score: Number(score.toFixed(6)),
          metadata: record.metadata || {},
          updatedAt: record.updatedAt || "",
          path: "lancedb-adapter-spool"
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      backend: "lancedb-adapter-spool",
      query,
      results
    };
  }

  function deleteByTargetIds(input = {}) {
    ensureSchema();
    const rawIds = input.targetIds ?? input.ids ?? input.targetId ?? [];
    const normalizedIds = Array.isArray(rawIds)
      ? rawIds
      : typeof rawIds === "string" || typeof rawIds === "number"
        ? [rawIds]
        : [];
    const ids = new Set(normalizedIds.filter(Boolean).map(String));
    if (!ids.size) {
      return {
        protocolVersion: VECTOR_PROTOCOL_VERSION,
        providerId,
        deleted: 0
      };
    }
    const records = readJsonArray(spoolPath);
    const remaining = records.filter((record) => !ids.has(String(record.entityId || record.targetId || "")));
    writeJsonArray(spoolPath, remaining);
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      deleted: records.length - remaining.length
    };
  }

  function capabilities() {
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      providerType: "lancedb",
      backend: "lancedb-adapter",
      externalUriConfigured: Boolean(uri),
      noImplicitDownloads: true,
      explicitModelRequired: true,
      embeddingModel: explicitModel,
      operations: {
        ensureSchema: true,
        upsert: true,
        search: true,
        deleteByTargetIds: true,
        onBatchCompleted: true
      },
      framework: {
        lancedb: "external-component-via-js-adapter-or-service",
        hybridSearch: true,
        reranking: "explicitly-configured"
      }
    };
  }

  function health() {
    try {
      ensureSchema();
      return {
        protocolVersion: VECTOR_PROTOCOL_VERSION,
        ok: true,
        degraded: !uri,
        providerId,
        providerType: "lancedb",
        backend: uri ? "lancedb-external" : "lancedb-adapter-spool",
        rootPath,
        spoolPath,
        externalUriConfigured: Boolean(uri),
        explicitModelConfigured: Boolean(explicitModel),
        noImplicitDownloads: true,
        recordCount: readJsonArray(spoolPath).length,
        capabilities: capabilities()
      };
    } catch (error) {
      return {
        protocolVersion: VECTOR_PROTOCOL_VERSION,
        ok: false,
        providerId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function onBatchCompleted({ batchId, jobId, result } = {}) {
    const records = recordsFromBatch({ batchId, jobId, result });
    const upsertResult = upsert({ records });
    const manifestPath = path.join(rootPath, `batch-${hashText(batchId, 16)}.json`);
    await fsp.writeFile(
      manifestPath,
      `${JSON.stringify({ batchId, jobId, recordCount: records.length, generatedAt: nowIso() }, null, 2)}\n`,
      "utf8"
    );
    return {
      ...upsertResult,
      batchId,
      jobId,
      recordCount: records.length,
      manifestPath
    };
  }

  return {
    id: "builtin/lancedb-vector-store",
    kind: "vectorStore",
    enabled: true,
    protocolVersion: VECTOR_PROTOCOL_VERSION,
    providerId,
    ensureSchema,
    upsert,
    search,
    deleteByTargetIds,
    capabilities,
    health,
    onBatchCompleted,
    async reload({ settings = {} } = {}) {
      void settings;
    },
    async close() {}
  };
}

export function createMount({ userDataPath, runtimeOptions = {} } = {}) {
  return createLanceDbVectorStore({
    userDataPath,
    settings: runtimeOptions.vectorStore?.lancedb || runtimeOptions.lancedb || {}
  });
}

export default createLanceDbVectorStore;
