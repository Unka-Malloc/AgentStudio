import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const VECTOR_PROTOCOL_VERSION = "v0.0.1:knowledge:vector-1";
export const SQLITE_VEC_PROVIDER_ID = "sqlite-vec";
export const JSON_FALLBACK_PROVIDER_ID = "builtin:sqlite-json-vector-store";
export const DEFAULT_VECTOR_PROVIDER_ID = SQLITE_VEC_PROVIDER_ID;
export const DEFAULT_SQLITE_VEC_DIMENSION = 128;

const require = createRequire(import.meta.url);

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function hashText(value, length = 32) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, ...parts) {
  return `${prefix}::${hashText(parts.map((part) => String(part || "")).join("\u001f"), 24)}`;
}

function normalizeLimit(value, fallback = 100) {
  const limit = Math.floor(Number(value || fallback));
  if (!Number.isFinite(limit) || limit < 1) {
    return fallback;
  }
  return Math.min(limit, 1000);
}

function normalizeScanLimit(value, fallback = 100000) {
  const limit = Math.floor(Number(value || fallback));
  if (!Number.isFinite(limit) || limit < 1) {
    return fallback;
  }
  return Math.min(limit, 1000000);
}

function normalizeDimension(value, fallback = DEFAULT_SQLITE_VEC_DIMENSION) {
  const dimension = Math.floor(Number(value || fallback));
  if (!Number.isFinite(dimension) || dimension < 8 || dimension > 4096) {
    return fallback;
  }
  return dimension;
}

function normalizeVector(vector) {
  return asArray(vector).map((entry) => Number(entry || 0)).filter((entry) => Number.isFinite(entry));
}

function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  if (!length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function sqliteVecNativePackageName() {
  const platformMap = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows"
  };
  const archMap = {
    x64: "x64",
    arm64: "arm64"
  };
  const platformName = platformMap[process.platform];
  const archName = archMap[process.arch];
  if (!platformName || !archName) {
    throw new Error(`sqlite-vec 不支持当前平台：${process.platform}/${process.arch}`);
  }
  return `sqlite-vec-${platformName}-${archName}`;
}

function sqliteVecExtensionSuffix() {
  if (process.platform === "win32") {
    return "dll";
  }
  if (process.platform === "darwin") {
    return "dylib";
  }
  return "so";
}

function resolveSqliteVecLoadablePath() {
  const sqliteVecEntry = require.resolve("sqlite-vec");
  const nodeModulesRoot = path.dirname(path.dirname(sqliteVecEntry));
  const extensionPath = path.join(
    nodeModulesRoot,
    sqliteVecNativePackageName(),
    `vec0.${sqliteVecExtensionSuffix()}`
  );
  if (!fs.existsSync(extensionPath)) {
    throw new Error(`sqlite-vec 原生扩展不存在：${extensionPath}`);
  }
  return extensionPath;
}

function loadSqliteVec(db) {
  const extensionPath = resolveSqliteVecLoadablePath();
  db.loadExtension(extensionPath);
  const version = db.prepare("SELECT vec_version() AS version").get()?.version || "";
  return {
    extensionPath,
    version
  };
}

function vectorTableName(dimension) {
  return `kc_embedding_vec_${normalizeDimension(dimension)}`;
}

function textFromTarget(target = {}) {
  return normalizeText([
    target.title,
    target.name,
    target.text,
    target.content,
    target.snippet,
    target.summary,
    target.caption,
    target.ocrText,
    target.ocr_text
  ]
    .filter(Boolean)
    .join("\n"));
}

function targetIdFrom(target = {}) {
  return String(target.targetId || target.blockId || target.assetId || target.id || "").trim();
}

function targetTypeFrom(target = {}) {
  if (target.targetType) {
    return String(target.targetType);
  }
  if (target.assetId || target.asset_type || target.assetType) {
    return "asset";
  }
  if (target.blockId || target.block_type || target.blockType) {
    return "block";
  }
  return "target";
}

function modalityFrom(target = {}) {
  if (target.modality) {
    return String(target.modality);
  }
  return targetTypeFrom(target) === "asset" ? "image" : "text";
}

function assertDb(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.exec !== "function") {
    throw new TypeError("createLocalVectorStore requires a better-sqlite3 db instance.");
  }
}

function assertEmbeddingRuntime(embeddingRuntime) {
  if (
    !embeddingRuntime ||
    typeof embeddingRuntime.embedText !== "function" ||
    typeof embeddingRuntime.embedImageEvidence !== "function" ||
    typeof embeddingRuntime.embedJointEvidence !== "function"
  ) {
    throw new TypeError(
      "createLocalVectorStore requires an embeddingRuntime with embedText, embedImageEvidence, and embedJointEvidence."
    );
  }
}

export function createLocalVectorStore(options = {}) {
  const { db, embeddingRuntime } = options;
  assertDb(db);
  assertEmbeddingRuntime(embeddingRuntime);

  const providerId = String(options.providerId || options.settings?.providerId || DEFAULT_VECTOR_PROVIDER_ID);
  const sqliteVecDimension = normalizeDimension(
    options.dimension || options.settings?.dimension || embeddingRuntime.defaultDimension || embeddingRuntime.dimensions,
    DEFAULT_SQLITE_VEC_DIMENSION
  );
  const sqliteVecTable = vectorTableName(sqliteVecDimension);
  const preferSqliteVec = options.preferSqliteVec !== false && options.settings?.preferSqliteVec !== false;
  let backend = "sqlite-json-fallback";
  let sqliteVecState = {
    available: false,
    status: preferSqliteVec ? "not-loaded" : "disabled",
    version: "",
    extensionPath: "",
    dimension: sqliteVecDimension,
    table: sqliteVecTable,
    error: preferSqliteVec ? "sqlite-vec has not been initialized yet." : "sqlite-vec disabled by settings."
  };
  const autoEnsureSchema = options.autoEnsureSchema !== false;
  let schemaReady = false;
  let cachedStatements = null;

  function initializeSqliteVec() {
    if (!preferSqliteVec || sqliteVecState.available) {
      return sqliteVecState;
    }
    try {
      const loaded = loadSqliteVec(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS kc_embedding_vec_ids (
          vec_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
          embedding_id TEXT NOT NULL UNIQUE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS ${sqliteVecTable}
        USING vec0(embedding float[${sqliteVecDimension}]);
      `);
      sqliteVecState = {
        available: true,
        status: "loaded",
        version: loaded.version,
        extensionPath: loaded.extensionPath,
        dimension: sqliteVecDimension,
        table: sqliteVecTable,
        error: ""
      };
      backend = "sqlite-vec";
    } catch (error) {
      sqliteVecState = {
        ...sqliteVecState,
        available: false,
        status: "fallback",
        error: error instanceof Error ? error.message : String(error)
      };
      backend = "sqlite-json-fallback";
    }
    return sqliteVecState;
  }

  function ensureSchema() {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

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

      CREATE TABLE IF NOT EXISTS kc_embedding_vec_ids (
        vec_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        embedding_id TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_kc_embeddings_target ON kc_embeddings(target_type, target_id, modality);
      CREATE INDEX IF NOT EXISTS idx_kc_embeddings_provider ON kc_embeddings(provider, modality);
      CREATE INDEX IF NOT EXISTS idx_kc_embeddings_updated ON kc_embeddings(updated_at);
    `);
    initializeSqliteVec();
    schemaReady = true;
    cachedStatements = null;
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      ok: true,
      providerId,
      backend,
      tables: sqliteVecState.available ? ["kc_embeddings", "kc_embedding_vec_ids", sqliteVecTable] : ["kc_embeddings"],
      sqliteVec: sqliteVecState
    };
  }

  function statements() {
    if (!schemaReady) {
      ensureSchema();
    }
    if (!cachedStatements) {
      cachedStatements = {
        upsertEmbedding: db.prepare(`
          INSERT INTO kc_embeddings (
            embedding_id, target_type, target_id, modality, provider, dimension, vector_json,
            content_hash, metadata_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(target_type, target_id, modality, provider) DO UPDATE SET
            dimension = excluded.dimension,
            vector_json = excluded.vector_json,
            content_hash = excluded.content_hash,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `),
        reserveVecRow: db.prepare(`
          INSERT INTO kc_embedding_vec_ids (embedding_id)
          VALUES (?)
          ON CONFLICT(embedding_id) DO NOTHING
        `),
        getVecRow: db.prepare(`
          SELECT vec_rowid
          FROM kc_embedding_vec_ids
          WHERE embedding_id = ?
        `)
      };
    }
    return cachedStatements;
  }

  function upsertOne(record = {}) {
    const targetType = String(record.targetType || "").trim();
    const targetId = String(record.targetId || "").trim();
    const modality = String(record.modality || "text").trim();
    const provider = String(record.provider || record.providerId || "").trim();
    const vector = normalizeVector(record.vector);

    if (!targetType || !targetId) {
      throw new TypeError("Vector upsert requires targetType and targetId.");
    }
    if (!provider) {
      throw new TypeError("Vector upsert requires provider or providerId.");
    }
    if (!vector.length) {
      throw new TypeError("Vector upsert requires a non-empty vector array.");
    }

    const embeddingId = record.embeddingId || stableId("embedding", targetType, targetId, modality, provider);
    statements().upsertEmbedding.run(
      embeddingId,
      targetType,
      targetId,
      modality,
      provider,
      Number(record.dimension || vector.length || 0),
      stringifyJson(vector, []),
      record.contentHash || "",
      stringifyJson(record.metadata || {}),
      record.updatedAt || nowIso()
    );

    if (sqliteVecState.available && vector.length === sqliteVecDimension) {
      const stmt = statements();
      stmt.reserveVecRow.run(embeddingId);
      const vecRow = stmt.getVecRow.get(embeddingId);
      if (vecRow?.vec_rowid) {
        db.prepare(`INSERT OR REPLACE INTO ${sqliteVecTable} (rowid, embedding) VALUES (?, ?)`).run(
          BigInt(vecRow.vec_rowid),
          stringifyJson(vector, [])
        );
      }
    }
  }

  function upsert(input = {}) {
    const records = Array.isArray(input) ? input : asArray(input.items || input.records || input);
    const write = db.transaction((items) => {
      for (const record of items) {
        upsertOne(record);
      }
    });
    write(records);
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      upserted: records.length
    };
  }

  function queryVectorFrom(input = {}) {
    if (Array.isArray(input.vector)) {
      return {
        vector: normalizeVector(input.vector),
        provider: input.provider || input.providerId || "",
        modality: input.modality || "query"
      };
    }
    if (input.evidence) {
      return embeddingRuntime.embedJointEvidence(input.evidence, input.embeddingOptions || {});
    }
    return embeddingRuntime.embedText(input.query || input.text || "", input.embeddingOptions || {});
  }

  function buildEmbeddingFilters(input = {}, tableAlias = "") {
    const clauses = [];
    const params = [];
    const prefix = tableAlias ? `${tableAlias}.` : "";
    const modalities = asArray(input.modalities || input.modality).filter(Boolean).map(String);
    const providers = asArray(input.providers || input.provider).filter(Boolean).map(String);
    const targetTypes = asArray(input.targetTypes || input.targetType).filter(Boolean).map(String);
    const targetIds = asArray(input.targetIds || input.targetId).filter(Boolean).map(String);

    if (modalities.length) {
      clauses.push(`${prefix}modality IN (${placeholders(modalities)})`);
      params.push(...modalities);
    }
    if (providers.length) {
      clauses.push(`${prefix}provider IN (${placeholders(providers)})`);
      params.push(...providers);
    }
    if (targetTypes.length) {
      clauses.push(`${prefix}target_type IN (${placeholders(targetTypes)})`);
      params.push(...targetTypes);
    }
    if (targetIds.length) {
      clauses.push(`${prefix}target_id IN (${placeholders(targetIds)})`);
      params.push(...targetIds);
    }

    return { clauses, params };
  }

  function selectRows(input = {}) {
    const { clauses, params } = buildEmbeddingFilters(input);
    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const scanLimit = normalizeScanLimit(input.scanLimit || options.scanLimit || 100000, 100000);
    return db.prepare(`
      SELECT * FROM kc_embeddings
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, scanLimit);
  }

  function rowsToJsonScanResults({ rows, queryVector, minScore, limit }) {
    return rows
      .map((row) => {
        const vector = normalizeVector(parseJson(row.vector_json, []));
        const score = cosineSimilarity(queryVector, vector);
        return {
          targetType: row.target_type,
          targetId: row.target_id,
          modality: row.modality,
          provider: row.provider,
          dimension: Number(row.dimension || vector.length || 0),
          score: Number(score.toFixed(6)),
          contentHash: row.content_hash,
          metadata: parseJson(row.metadata_json, {}),
          updatedAt: row.updated_at,
          path: "json-cosine-scan"
        };
      })
      .filter((item) => item.score > minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  function searchJsonFallback(input = {}, queryVector = []) {
    const rows = selectRows(input);

    return rowsToJsonScanResults({
      rows,
      queryVector,
      minScore: Number.isFinite(Number(input.minScore)) ? Number(input.minScore) : 0,
      limit: normalizeLimit(input.limit || 100, 100)
    });
  }

  function distanceToScore(distance) {
    const value = Number(distance);
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    return Number((1 / (1 + value)).toFixed(6));
  }

  function searchSqliteVec(input = {}, queryVector = []) {
    if (!sqliteVecState.available || queryVector.length !== sqliteVecDimension) {
      return [];
    }
    const limit = normalizeLimit(input.limit || 100, 100);
    const minScore = Number.isFinite(Number(input.minScore)) ? Number(input.minScore) : 0;
    const candidateLimit = normalizeScanLimit(
      input.vectorK || input.scanLimit || Math.max(limit * 20, 100),
      Math.max(limit * 20, 100)
    );
    const { clauses, params } = buildEmbeddingFilters(input, "e");
    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.prepare(`
      WITH matches AS (
        SELECT rowid AS vec_rowid, distance
        FROM ${sqliteVecTable}
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      )
      SELECT e.*, matches.distance
      FROM matches
      JOIN kc_embedding_vec_ids AS vec_ids ON vec_ids.vec_rowid = matches.vec_rowid
      JOIN kc_embeddings AS e ON e.embedding_id = vec_ids.embedding_id
      ${whereClause}
      ORDER BY matches.distance ASC
      LIMIT ?
    `).all(stringifyJson(queryVector, []), candidateLimit, ...params, limit)
      .map((row) => ({
        targetType: row.target_type,
        targetId: row.target_id,
        modality: row.modality,
        provider: row.provider,
        dimension: Number(row.dimension || sqliteVecDimension || 0),
        score: distanceToScore(row.distance),
        distance: Number(row.distance || 0),
        contentHash: row.content_hash,
        metadata: parseJson(row.metadata_json, {}),
        updatedAt: row.updated_at,
        path: "sqlite-vec"
      }))
      .filter((item) => item.score > minScore)
      .slice(0, limit);
  }

  function mergeSearchResults(primaryResults = [], fallbackResults = [], limit = 100) {
    const merged = new Map();
    for (const result of [...primaryResults, ...fallbackResults]) {
      const key = [result.targetType, result.targetId, result.modality, result.provider].join("\u001f");
      const current = merged.get(key);
      if (!current || Number(result.score || 0) > Number(current.score || 0)) {
        merged.set(key, result);
      }
    }
    return [...merged.values()]
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, limit);
  }

  function search(input = {}) {
    if (!schemaReady) {
      ensureSchema();
    }
    const limit = normalizeLimit(input.limit || 100, 100);
    const queryEmbedding = queryVectorFrom(input);
    const queryVector = normalizeVector(queryEmbedding.vector);
    let sqliteVecResults = [];
    let sqliteVecError = "";

    try {
      sqliteVecResults = searchSqliteVec(input, queryVector);
    } catch (error) {
      sqliteVecError = error instanceof Error ? error.message : String(error);
      sqliteVecState = {
        ...sqliteVecState,
        status: "fallback",
        error: sqliteVecError
      };
      backend = "sqlite-json-fallback";
    }

    const needsFallback =
      !sqliteVecState.available || sqliteVecError || sqliteVecResults.length < limit || input.includeFallback === true;
    const fallbackResults = needsFallback ? searchJsonFallback(input, queryVector) : [];
    const results = mergeSearchResults(sqliteVecResults, fallbackResults, limit);

    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      backend,
      sqliteVec: sqliteVecState,
      queryProvider: queryEmbedding.provider || queryEmbedding.providerId || "",
      results
    };
  }

  function deleteByTargetIds(input = {}) {
    if (!schemaReady) {
      ensureSchema();
    }
    const targetIds = asArray(input.targetIds || input.ids || input.targetId || input).filter(Boolean).map(String);
    if (!targetIds.length) {
      return {
        protocolVersion: VECTOR_PROTOCOL_VERSION,
        providerId,
        deleted: 0
      };
    }

    const clauses = [`target_id IN (${placeholders(targetIds)})`];
    const params = [...targetIds];
    for (const [column, value] of [
      ["target_type", input.targetType],
      ["modality", input.modality],
      ["provider", input.provider || input.providerId]
    ]) {
      if (value) {
        clauses.push(`${column} = ?`);
        params.push(String(value));
      }
    }

    const vecFilter = buildEmbeddingFilters(input, "e");
    const deletedVecRows = sqliteVecState.available
      ? db.prepare(`
          SELECT vec_ids.vec_rowid
          FROM kc_embedding_vec_ids AS vec_ids
          JOIN kc_embeddings AS e ON e.embedding_id = vec_ids.embedding_id
          WHERE ${vecFilter.clauses.join(" AND ")}
        `).all(...vecFilter.params)
      : [];
    if (sqliteVecState.available && deletedVecRows.length) {
      const deleteVec = db.prepare(`DELETE FROM ${sqliteVecTable} WHERE rowid = ?`);
      for (const row of deletedVecRows) {
        deleteVec.run(BigInt(row.vec_rowid));
      }
      db.prepare(`
        DELETE FROM kc_embedding_vec_ids
        WHERE vec_rowid IN (${placeholders(deletedVecRows)})
      `).run(...deletedVecRows.map((row) => row.vec_rowid));
    }

    const result = db.prepare(`DELETE FROM kc_embeddings WHERE ${clauses.join(" AND ")}`).run(...params);
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      deleted: Number(result.changes || 0)
    };
  }

  async function embeddingForTarget(target = {}, input = {}) {
    if (typeof input.embedTarget === "function") {
      return input.embedTarget(target, { embeddingRuntime });
    }
    if (Array.isArray(target.vector)) {
      return {
        provider: target.provider || target.providerId || embeddingRuntime.providerId,
        modality: modalityFrom(target),
        dimension: target.dimension || target.vector.length,
        vector: target.vector
      };
    }
    const modality = modalityFrom(target);
    if (modality === "joint") {
      return embeddingRuntime.embedJointEvidence(target.evidence || target, input.embeddingOptions || {});
    }
    if (modality === "image" || targetTypeFrom(target) === "asset") {
      return embeddingRuntime.embedImageEvidence(target.asset || target, input.embeddingOptions || {});
    }
    return embeddingRuntime.embedText(textFromTarget(target), input.embeddingOptions || {});
  }

  async function reindexTargets(input = {}) {
    if (!schemaReady) {
      ensureSchema();
    }
    const targetIds = asArray(input.targetIds || input.ids).filter(Boolean).map(String);
    const providedTargets = asArray(input.targets || input.items || input.records);
    const targets = [...providedTargets];
    const errors = [];
    let deleted = 0;
    let skipped = 0;

    if (typeof input.resolveTarget === "function" || typeof input.getTarget === "function") {
      const resolver = input.resolveTarget || input.getTarget;
      const providedIds = new Set(providedTargets.map(targetIdFrom).filter(Boolean));
      for (const targetId of targetIds.filter((id) => !providedIds.has(id))) {
        const resolved = await resolver(targetId);
        if (resolved) {
          targets.push(resolved);
        } else if (input.deleteMissing) {
          deleted += deleteByTargetIds({ targetIds: [targetId] }).deleted;
        } else {
          skipped += 1;
        }
      }
    } else if (input.deleteMissing && targetIds.length && !providedTargets.length) {
      deleted += deleteByTargetIds({ targetIds }).deleted;
    }

    let reindexed = 0;
    for (const target of targets) {
      try {
        const targetId = targetIdFrom(target);
        const targetType = targetTypeFrom(target);
        if (!targetId) {
          skipped += 1;
          continue;
        }
        const embedding = await embeddingForTarget(target, input);
        const contentText = textFromTarget(target);
        upsertOne({
          targetType,
          targetId,
          ...embedding,
          contentHash: target.contentHash || hashText(contentText || stringifyJson(target)),
          metadata: compactObject({
            ...(target.metadata || {}),
            documentId: target.documentId,
            sectionId: target.sectionId,
            sourceId: target.sourceId,
            reindexedAt: nowIso()
          })
        });
        reindexed += 1;
      } catch (error) {
        errors.push({
          targetId: targetIdFrom(target),
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      backend,
      requested: targetIds.length || providedTargets.length,
      reindexed,
      deleted,
      skipped,
      errors
    };
  }

  function capabilities() {
    const embeddingCapabilities =
      typeof embeddingRuntime.capabilities === "function" ? embeddingRuntime.capabilities() : null;
    return {
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId,
      providerType: sqliteVecState.available ? "sqlite-vec" : "offline-fallback",
      backend,
      storage: {
        engine: "better-sqlite3",
        table: "kc_embeddings",
        vectorEncoding: sqliteVecState.available ? "sqlite-vec-float" : "json",
        providerColumn: "provider"
      },
      sqliteVec: {
        providerId: SQLITE_VEC_PROVIDER_ID,
        status: sqliteVecState.status,
        bundled: true,
        available: sqliteVecState.available,
        version: sqliteVecState.version,
        dimension: sqliteVecState.dimension,
        table: sqliteVecState.table,
        error: sqliteVecState.error,
        boundary: "sqlite-vec is the primary local vector backend when the native extension loads; JSON cosine scan remains the deterministic fallback."
      },
      operations: {
        ensureSchema: true,
        upsert: true,
        search: sqliteVecState.available ? "sqlite-vec-knn-with-json-fallback" : "in-process-cosine-json-scan",
        deleteByTargetIds: true,
        reindexTargets: true
      },
      modalities: {
        text: true,
        image: true,
        joint: true
      },
      embeddingRuntime: embeddingCapabilities
        ? {
            protocolVersion: embeddingCapabilities.protocolVersion,
            providerId: embeddingCapabilities.providerId,
            providerType: embeddingCapabilities.providerType,
            offlineFallback: embeddingCapabilities.offlineFallback,
            dimensions: embeddingCapabilities.dimensions
          }
        : {
            providerId: embeddingRuntime.providerId || "",
            dimensions: embeddingRuntime.dimensions || embeddingRuntime.defaultDimension || 0
          }
    };
  }

  function health() {
    try {
      if (!schemaReady) {
        ensureSchema();
      }
      const counts = db.prepare(`
        SELECT
          COUNT(*) AS total_count,
          COUNT(DISTINCT target_id) AS target_count,
          COUNT(DISTINCT provider) AS provider_count
        FROM kc_embeddings
      `).get();
      const providers = db.prepare(`
        SELECT provider, modality, COUNT(*) AS count
        FROM kc_embeddings
        GROUP BY provider, modality
        ORDER BY provider ASC, modality ASC
      `).all();
      return {
        protocolVersion: VECTOR_PROTOCOL_VERSION,
        ok: true,
        providerId,
        providerType: sqliteVecState.available ? "sqlite-vec" : "offline-fallback",
        backend,
        databasePath: db.name,
        sqliteVec: sqliteVecState,
        counts: {
          embeddings: Number(counts.total_count || 0),
          targets: Number(counts.target_count || 0),
          providers: Number(counts.provider_count || 0)
        },
        providers: providers.map((row) => ({
          provider: row.provider,
          modality: row.modality,
          count: Number(row.count || 0)
        })),
        capabilities: capabilities()
      };
    } catch (error) {
      return {
        protocolVersion: VECTOR_PROTOCOL_VERSION,
        ok: false,
        providerId,
        backend,
        sqliteVec: sqliteVecState,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const api = {
    protocolVersion: VECTOR_PROTOCOL_VERSION,
    providerId,
    get providerType() {
      return sqliteVecState.available ? "sqlite-vec" : "offline-fallback";
    },
    get backend() {
      return backend;
    },
    ensureSchema,
    upsert,
    search,
    deleteByTargetIds,
    reindexTargets,
    capabilities,
    health
  };

  if (autoEnsureSchema) {
    ensureSchema();
  }

  return api;
}

export default createLocalVectorStore;
