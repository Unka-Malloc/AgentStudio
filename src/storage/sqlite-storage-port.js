import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalEncode, normalizeCanonicalValue } from "../canonical/value.js";
import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { cidForBytes, hashBytes } from "../protocol/hashing.js";
import { createWeightedLruCache } from "../shared/lru-cache.js";
import { asArray, nowIso, safeToken } from "../shared/records.js";
import { loadSqliteStorageDriver, sqliteStorageAvailable } from "./sqlite-capability.js";
import { defaultPactiumDataDir, resolveDataDir, resolveWithin } from "./local-json-storage-port.js";
import {
  ensurePrivateDirectory,
  hardenPrivateRegularFile,
  PRIVATE_FILE_MODE,
  writePrivateFileAtomic
} from "./private-atomic-file.js";
import {
  decodeStoragePayload,
  DEFAULT_COMPRESSION_THRESHOLD_BYTES,
  encodeStoragePayload,
  MAX_STORAGE_PAYLOAD_BYTES
} from "./storage-codec.js";

export const PACTIUM_STORAGE_BACKEND_SQLITE = "sqlite";
export const PACTIUM_SQLITE_STORAGE_FORMAT = "pactium.sqlite.v2.br1";
export { sqliteStorageAvailable };

const SQLITE_SCHEMA_VERSION = 2;
const DEFAULT_BLOCK_CACHE_ENTRIES = 256;
const DEFAULT_OBJECT_CACHE_ENTRIES = 256;
const DEFAULT_BLOCK_CACHE_BYTES = 32 * 1024 * 1024;
const DEFAULT_OBJECT_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_SCAN_LIMIT = 10_000;
const SQL_BATCH_SIZE = 200;
const TRANSACTION_TOMBSTONE = Symbol("pactium.sqlite.transaction-tombstone");

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  return writePrivateFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function preparePrivateDatabaseFile(filePath) {
  if (await hardenPrivateRegularFile(filePath, { allowMissing: true })) return;
  let handle = null;
  try {
    handle = await fs.open(filePath, "wx", PRIVATE_FILE_MODE);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    await handle?.close();
  }
  await hardenPrivateRegularFile(filePath);
}

async function hardenSqliteSidecars(filePath) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    await hardenPrivateRegularFile(`${filePath}${suffix}`, { allowMissing: true });
  }
}

/* node:coverage ignore next 4 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* node:coverage ignore next 5 */
function isSqliteBusy(error) {
  return error?.code === "SQLITE_BUSY" ||
    Number(error?.errcode || 0) === 5 ||
    /database is locked/i.test(String(error?.message || ""));
}

function asPositiveCacheLimit(value, fallback) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeRefs(refs) {
  return [...new Set(asArray(refs).map((ref) => String(ref || "").trim()).filter(Boolean))];
}

function normalizeStringSet(values) {
  return [...new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function cloneBlock(record) {
  if (!record) return null;
  const bytes = Buffer.from(record.bytes);
  return {
    protocol: record.protocol,
    schema: record.schema,
    cid: record.cid,
    codec: record.codec,
    kind: record.kind,
    refs: [...record.refs],
    byteLength: record.byteLength,
    storedByteLength: record.storedByteLength,
    compression: record.compression,
    payloadHash: record.payloadHash,
    payloadBase64: bytes.toString("base64"),
    bytes,
    createdAt: record.createdAt
  };
}

function resolveSqliteDatabasePath(dataDir, databasePath) {
  if (!databasePath) return resolveWithin(dataDir, "pactium.sqlite");
  return resolveWithin(dataDir, String(databasePath));
}

function placeholders(length) {
  return Array.from({ length }, () => "?").join(", ");
}

function chunks(values, size = SQL_BATCH_SIZE) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

export function createSqliteStoragePort({
  dataDir = "",
  userDataPath = "",
  databasePath = "",
  inMemory = false,
  compressionThresholdBytes = DEFAULT_COMPRESSION_THRESHOLD_BYTES,
  maximumPayloadBytes = MAX_STORAGE_PAYLOAD_BYTES,
  blockCacheEntries = DEFAULT_BLOCK_CACHE_ENTRIES,
  objectCacheEntries = DEFAULT_OBJECT_CACHE_ENTRIES,
  blockCacheBytes = DEFAULT_BLOCK_CACHE_BYTES,
  objectCacheBytes = DEFAULT_OBJECT_CACHE_BYTES
} = {}) {
  if (inMemory) {
    throw new Error("SQLite storage backend does not support inMemory mode; use createStoragePort({ inMemory: true }).");
  }
  const resolvedDataDir = resolveDataDir(dataDir || userDataPath || defaultPactiumDataDir());
  let resolvedDatabasePath = resolveSqliteDatabasePath(resolvedDataDir, databasePath);
  const blockCacheLimit = asPositiveCacheLimit(blockCacheEntries, DEFAULT_BLOCK_CACHE_ENTRIES);
  const objectCacheLimit = asPositiveCacheLimit(objectCacheEntries, DEFAULT_OBJECT_CACHE_ENTRIES);
  const memoryBlocks = createWeightedLruCache({
    maxEntries: blockCacheLimit,
    maxWeight: asPositiveCacheLimit(blockCacheBytes, DEFAULT_BLOCK_CACHE_BYTES),
    weightOf: (record) => Number(record?.byteLength || 0)
  });
  const memoryObjects = createWeightedLruCache({
    maxEntries: objectCacheLimit,
    maxWeight: asPositiveCacheLimit(objectCacheBytes, DEFAULT_OBJECT_CACHE_BYTES)
  });
  let initialized = false;
  let db = null;
  let sqliteProvider = "";
  let inTransaction = false;
  let transactionCache = null;
  let writeLane = Promise.resolve();
  let initializationPromise = null;
  let closePromise = null;
  let lifecycleState = "open";
  const activeOperations = new Set();
  const transactionContext = new AsyncLocalStorage();
  const transactionToken = {};

  function manifestPath() {
    return resolveWithin(resolvedDataDir, "pactium-manifest.json");
  }

  function relativeSqlitePath() {
    const relative = path.relative(resolvedDataDir, resolvedDatabasePath);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative
      : resolvedDatabasePath;
  }

  function closedStorageError() {
    const error = new Error("Pactium SQLite storage is closed.");
    error.code = "PACTIUM_STORAGE_CLOSED";
    return error;
  }

  function reentrantCloseError() {
    const error = new Error("Pactium SQLite storage cannot close from inside its own write transaction.");
    error.code = "PACTIUM_REENTRANT_CLOSE";
    return error;
  }

  function currentTransactionCache() {
    return inTransaction && transactionContext.getStore() === transactionToken
      ? transactionCache
      : null;
  }

  function database() {
    if (!db) throw new Error("SQLite storage backend is not initialized.");
    return db;
  }

  /* node:coverage ignore next 11 */
  async function execWithBusyRetry(sql, { timeoutMs = 10000, retryMs = 25 } = {}) {
    const started = Date.now();
    while (true) {
      try {
        return database().exec(sql);
      } catch (error) {
        if (!isSqliteBusy(error) || Date.now() - started >= timeoutMs) throw error;
        await sleep(retryMs);
      }
    }
  }

  function tableColumns(tableName) {
    return database().prepare(`PRAGMA table_info(${tableName})`).all().map((row) => String(row.name));
  }

  function validateCurrentSchema() {
    const expected = new Map([
      ["blocks", [
        "cid", "codec", "kind", "compression", "raw_length", "payload", "created_at"
      ]],
      ["block_refs", ["parent_cid", "ordinal", "child_cid"]],
      ["protocol_objects", [
        "scope", "key", "compression", "raw_length", "value_hash", "payload", "updated_at"
      ]]
    ]);
    for (const [tableName, expectedColumns] of expected.entries()) {
      const actualColumns = tableColumns(tableName);
      if (actualColumns.length !== expectedColumns.length ||
          expectedColumns.some((column, index) => actualColumns[index] !== column)) {
        throw new Error(`Pactium latest-schema-only boundary rejected non-current SQLite table ${tableName}.`);
      }
    }
    const applicationTables = database().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => String(row.name));
    if (applicationTables.join("\0") !== [...expected.keys()].sort().join("\0")) {
      throw new Error("Pactium latest-schema-only boundary rejected non-current SQLite application tables.");
    }
    const userVersionRow = database().prepare("PRAGMA user_version").get();
    const userVersion = Number(userVersionRow?.user_version || 0);
    const autoVacuumRow = database().prepare("PRAGMA auto_vacuum").get();
    const autoVacuum = Number(autoVacuumRow?.auto_vacuum || 0);
    if (userVersion !== SQLITE_SCHEMA_VERSION || autoVacuum !== 2) {
      throw new Error("Pactium latest-schema-only boundary rejected a non-current SQLite storage format.");
    }
  }

  async function initializeStorage() {
    const driver = loadSqliteStorageDriver(true);
    await ensurePrivateDirectory(resolvedDataDir);
    const manifest = await readJson(manifestPath());
    if (manifest) {
      if (manifest.protocol !== PACTIUM_PROTOCOL || manifest.schema !== PACTIUM_SCHEMA_VERSION) {
        throw new Error("Pactium latest-schema-only boundary rejected a non-current protocol data directory.");
      }
      const manifestBackend = String(manifest.storageBackend || "json");
      if (manifestBackend !== PACTIUM_STORAGE_BACKEND_SQLITE) {
        throw new Error(`Pactium data directory uses ${manifestBackend} storage backend; SQLite storage backend cannot open it.`);
      }
      if (manifest.storageFormat !== PACTIUM_SQLITE_STORAGE_FORMAT) {
        throw new Error("Pactium latest-schema-only boundary rejected a non-current SQLite manifest.");
      }
      const manifestDatabasePath = resolveSqliteDatabasePath(resolvedDataDir, manifest.sqlitePath || "pactium.sqlite");
      if (databasePath && resolvedDatabasePath !== manifestDatabasePath) {
        throw new Error(`Pactium SQLite manifest uses database ${manifestDatabasePath}; configured databasePath cannot open it.`);
      }
      resolvedDatabasePath = manifestDatabasePath;
      if (!(await fileExists(resolvedDatabasePath))) {
        throw new Error(`SQLite storage manifest exists but database is missing: ${resolvedDatabasePath}`);
      }
    } else {
      const historicalLayoutHints = [
        resolveWithin(resolvedDataDir, "operation-ledger"),
        resolveWithin(resolvedDataDir, "checkpoint-trees"),
        resolveWithin(resolvedDataDir, "state-substrate")
      ];
      for (const historicalPath of historicalLayoutHints) {
        if (await fileExists(historicalPath)) {
          throw new Error("Historical Pactium data directory detected. Pactium performs no data migration.");
        }
      }
    }

    await ensurePrivateDirectory(path.dirname(resolvedDatabasePath));
    await preparePrivateDatabaseFile(resolvedDatabasePath);
    await hardenSqliteSidecars(resolvedDatabasePath);
    db = driver.open(resolvedDatabasePath);
    sqliteProvider = driver.providerId;
    db.exec("PRAGMA busy_timeout = 10000;");
    const applicationTables = database().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    if (!manifest && applicationTables.length === 0) {
      await execWithBusyRetry(`
        PRAGMA auto_vacuum = INCREMENTAL;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
      `);
      await execWithBusyRetry(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS blocks (
          cid TEXT PRIMARY KEY,
          codec TEXT NOT NULL,
          kind TEXT NOT NULL,
          compression TEXT NOT NULL CHECK (compression IN ('none', 'br-v1')),
          raw_length INTEGER NOT NULL CHECK (raw_length >= 0),
          payload BLOB NOT NULL,
          created_at TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS block_refs (
          parent_cid TEXT NOT NULL REFERENCES blocks(cid) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          child_cid TEXT NOT NULL,
          PRIMARY KEY (parent_cid, child_cid)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS block_refs_by_child ON block_refs(child_cid, parent_cid);
        CREATE TABLE IF NOT EXISTS protocol_objects (
          scope TEXT NOT NULL,
          key TEXT NOT NULL,
          compression TEXT NOT NULL CHECK (compression IN ('none', 'br-v1')),
          raw_length INTEGER NOT NULL CHECK (raw_length >= 0),
          value_hash TEXT NOT NULL,
          payload BLOB NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scope, key)
        ) WITHOUT ROWID;
        PRAGMA user_version = ${SQLITE_SCHEMA_VERSION};
        COMMIT;
      `);
    } else {
      await execWithBusyRetry(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
      `);
    }
    validateCurrentSchema();
    await hardenPrivateRegularFile(resolvedDatabasePath);
    await hardenSqliteSidecars(resolvedDatabasePath);
    if (!manifest) {
      let concurrentManifest = await readJson(manifestPath());
      if (!concurrentManifest) {
        const candidateManifest = {
          protocol: PACTIUM_PROTOCOL,
          schema: PACTIUM_SCHEMA_VERSION,
          storageBackend: PACTIUM_STORAGE_BACKEND_SQLITE,
          storageFormat: PACTIUM_SQLITE_STORAGE_FORMAT,
          sqlitePath: relativeSqlitePath(),
          sqliteProvider,
          createdAt: nowIso(),
          latestSchemaOnly: true,
          historicalMigration: false
        };
        try {
          await writeJsonAtomic(manifestPath(), candidateManifest);
          concurrentManifest = candidateManifest;
        } catch (error) {
          concurrentManifest = await readJson(manifestPath());
          if (!concurrentManifest) throw error;
        }
      }
      if (concurrentManifest.protocol !== PACTIUM_PROTOCOL ||
          concurrentManifest.schema !== PACTIUM_SCHEMA_VERSION ||
          concurrentManifest.storageBackend !== PACTIUM_STORAGE_BACKEND_SQLITE ||
          concurrentManifest.storageFormat !== PACTIUM_SQLITE_STORAGE_FORMAT) {
        throw new Error("Pactium concurrent SQLite initialization produced a non-current manifest.");
      }
      const concurrentDatabasePath = resolveSqliteDatabasePath(
        resolvedDataDir,
        concurrentManifest.sqlitePath || "pactium.sqlite"
      );
      if (concurrentDatabasePath !== resolvedDatabasePath) {
        throw new Error("Pactium concurrent SQLite initialization selected a different database path.");
      }
    }
    initialized = true;
  }

  function closingOwnedTransaction() {
    return lifecycleState === "closing" && transactionContext.getStore() === transactionToken;
  }

  async function ensureInitialized() {
    if (lifecycleState !== "open" && !closingOwnedTransaction()) throw closedStorageError();
    if (initialized) return;
    if (!initializationPromise) {
      initializationPromise = initializeStorage()
        .catch((error) => {
          initialized = false;
          const failedDatabase = db;
          db = null;
          sqliteProvider = "";
          try {
            failedDatabase?.close?.();
          } catch {
            // Preserve the initialization error; the failed driver handle is not reusable.
          }
          throw error;
        })
        .finally(() => {
          initializationPromise = null;
        });
    }
    await initializationPromise;
    if (lifecycleState !== "open" && !closingOwnedTransaction()) throw closedStorageError();
  }

  function runOperation(task) {
    if (lifecycleState !== "open" && !closingOwnedTransaction()) {
      return Promise.reject(closedStorageError());
    }
    let result;
    try {
      result = task();
    } catch (error) {
      return Promise.reject(error);
    }
    let tracked;
    tracked = Promise.resolve(result).finally(() => {
      activeOperations.delete(tracked);
    });
    activeOperations.add(tracked);
    return tracked;
  }

  function readRefs(cid) {
    return database().prepare(`
      SELECT child_cid FROM block_refs
      WHERE parent_cid = ?
      ORDER BY ordinal, child_cid
    `).all(cid).map((row) => String(row.child_cid));
  }

  function readRefsForParents(parentCids) {
    const normalizedParents = normalizeStringSet(parentCids);
    const refsByParent = new Map(normalizedParents.map((cid) => [cid, []]));
    for (const batch of chunks(normalizedParents)) {
      if (batch.length === 0) continue;
      const rows = database().prepare(`
        SELECT parent_cid, child_cid FROM block_refs
        WHERE parent_cid IN (${placeholders(batch.length)})
        ORDER BY parent_cid, ordinal, child_cid
      `).all(...batch);
      for (const row of rows) refsByParent.get(String(row.parent_cid))?.push(String(row.child_cid));
    }
    return refsByParent;
  }

  function blockFromRow(row) {
    if (!row) return null;
    const bytes = decodeStoragePayload(row.payload, {
      compression: row.compression,
      rawLength: row.raw_length,
      maximumRawLength: maximumPayloadBytes
    });
    const payloadHash = `sha256:${hashBytes(bytes)}`;
    if (cidForBytes(bytes) !== row.cid) {
      throw new Error(`CAS block integrity failure for ${row.cid}`);
    }
    return {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      cid: row.cid,
      codec: row.codec,
      kind: row.kind,
      refs: readRefs(row.cid),
      byteLength: Number(row.raw_length || 0),
      storedByteLength: Buffer.from(row.payload).length,
      compression: row.compression,
      payloadHash,
      bytes,
      createdAt: row.created_at
    };
  }

  function readBlockRecord(cid) {
    const row = database().prepare("SELECT * FROM blocks WHERE cid = ?").get(String(cid || ""));
    return blockFromRow(row);
  }

  function cacheBlock(record) {
    const transaction = currentTransactionCache();
    if (transaction) transaction.blocks.set(record.cid, record);
    else memoryBlocks.set(record.cid, record, record.byteLength);
  }

  function cachedBlock(cid) {
    const transaction = currentTransactionCache();
    if (transaction?.deletedBlocks.has(cid)) return null;
    if (transaction?.blocks.has(cid)) return transaction.blocks.get(cid);
    return memoryBlocks.get(cid);
  }

  function insertMissingRefs(cid, refs) {
    const existingRows = database().prepare(`
      SELECT ordinal, child_cid FROM block_refs
      WHERE parent_cid = ?
      ORDER BY ordinal, child_cid
    `).all(cid);
    const existing = new Set(existingRows.map((row) => String(row.child_cid)));
    let nextOrdinal = existingRows.reduce((maximum, row) => Math.max(maximum, Number(row.ordinal)), -1) + 1;
    const missing = [];
    for (const ref of refs) {
      if (existing.has(ref)) continue;
      missing.push([cid, nextOrdinal, ref]);
      nextOrdinal += 1;
      existing.add(ref);
    }
    for (const batch of chunks(missing)) {
      if (batch.length === 0) continue;
      database().prepare(`
        INSERT OR IGNORE INTO block_refs (parent_cid, ordinal, child_cid)
        VALUES ${batch.map(() => "(?, ?, ?)").join(", ")}
      `).run(...batch.flat());
    }
    return readRefs(cid);
  }

  async function putBlock(value, { codec = "pactium-canonical", kind = "protocol-material", refs = [] } = {}) {
    await ensureInitialized();
    const bytes = codec === "raw"
      ? Buffer.from(value || "")
      : Buffer.from(canonicalEncode(value));
    const cid = cidForBytes(bytes);
    const payloadHash = `sha256:${hashBytes(bytes)}`;
    const normalizedRefs = normalizeRefs(refs);
    let existing = cachedBlock(cid) || readBlockRecord(cid);
    if (existing) {
      if (existing.payloadHash !== payloadHash || !existing.bytes.equals(bytes)) {
        throw new Error(`CAS collision or replacement attempt for ${cid}`);
      }
      existing = { ...existing, refs: insertMissingRefs(cid, normalizedRefs) };
      cacheBlock(existing);
      return { ...cloneBlock(existing), deduped: true };
    }

    const encoded = encodeStoragePayload(bytes, {
      compressionThresholdBytes,
      maximumRawLength: maximumPayloadBytes
    });
    const createdAt = nowIso();
    const result = database().prepare(`
      INSERT INTO blocks (
        cid, codec, kind, compression, raw_length, payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cid) DO NOTHING
    `).run(
      cid,
      codec,
      kind,
      encoded.compression,
      encoded.rawLength,
      encoded.payload,
      createdAt
    );
    if (Number(result?.changes || 0) === 0) {
      existing = readBlockRecord(cid);
      if (!existing || existing.payloadHash !== payloadHash || !existing.bytes.equals(bytes)) {
        throw new Error(`CAS collision or replacement attempt for ${cid}`);
      }
      existing = { ...existing, refs: insertMissingRefs(cid, normalizedRefs) };
      cacheBlock(existing);
      return { ...cloneBlock(existing), deduped: true };
    }

    const record = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      cid,
      codec,
      kind,
      refs: insertMissingRefs(cid, normalizedRefs),
      byteLength: bytes.length,
      storedByteLength: encoded.payload.length,
      compression: encoded.compression,
      payloadHash,
      bytes,
      createdAt
    };
    cacheBlock(record);
    return { ...cloneBlock(record), deduped: false };
  }

  async function getBlock(cid) {
    await ensureInitialized();
    const normalizedCid = String(cid || "");
    const cached = cachedBlock(normalizedCid);
    if (cached) return cloneBlock(cached);
    const record = readBlockRecord(normalizedCid);
    if (!record) return null;
    cacheBlock(record);
    return cloneBlock(record);
  }

  async function hasBlock(cid) {
    return Boolean(await getBlock(cid));
  }

  async function walk(rootCid) {
    const missing = [];
    const blocks = [];
    const seen = new Set();
    const stack = [String(rootCid || "").trim()].filter(Boolean);
    while (stack.length > 0) {
      const cid = stack.pop();
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const block = await getBlock(cid);
      if (!block) {
        missing.push(cid);
        continue;
      }
      blocks.push(block);
      for (const ref of [...block.refs].reverse()) {
        if (!seen.has(ref)) stack.push(ref);
      }
    }
    return { protocol: PACTIUM_PROTOCOL, rootCid, blockCount: blocks.length, missing, blocks };
  }

  function cachedProtocolObject(memoryKey) {
    const transaction = currentTransactionCache();
    if (transaction?.objects.has(memoryKey)) return transaction.objects.get(memoryKey);
    return memoryObjects.get(memoryKey);
  }

  function cacheProtocolObject(memoryKey, value, byteLength = 0) {
    const transaction = currentTransactionCache();
    if (transaction) {
      transaction.objects.set(memoryKey, value);
      transaction.objectWeights.set(memoryKey, byteLength);
    }
    else if (value === TRANSACTION_TOMBSTONE) memoryObjects.delete(memoryKey);
    else memoryObjects.set(memoryKey, value, byteLength);
  }

  function protocolObjectFromRow(row) {
    if (!row) return null;
    const bytes = decodeStoragePayload(row.payload, {
      compression: row.compression,
      rawLength: row.raw_length,
      maximumRawLength: maximumPayloadBytes
    });
    const valueHash = `sha256:${hashBytes(bytes)}`;
    if (valueHash !== row.value_hash) {
      throw new Error("Pactium protocol object integrity failure.");
    }
    return normalizeCanonicalValue(JSON.parse(bytes.toString("utf8")));
  }

  async function putProtocolObject(scope, key, value) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    const memoryKey = `${normalizedScope}/${normalizedKey}`;
    const storedValue = normalizeCanonicalValue(value);
    const bytes = Buffer.from(canonicalEncode(storedValue));
    const valueHash = `sha256:${hashBytes(bytes)}`;
    const encoded = encodeStoragePayload(bytes, {
      compressionThresholdBytes,
      maximumRawLength: maximumPayloadBytes
    });
    const result = database().prepare(`
      INSERT INTO protocol_objects (
        scope, key, compression, raw_length, value_hash, payload, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET
        compression = excluded.compression,
        raw_length = excluded.raw_length,
        value_hash = excluded.value_hash,
        payload = excluded.payload,
        updated_at = excluded.updated_at
      WHERE protocol_objects.value_hash <> excluded.value_hash
    `).run(
      normalizedScope,
      normalizedKey,
      encoded.compression,
      encoded.rawLength,
      valueHash,
      encoded.payload,
      nowIso()
    );
    if (Number(result?.changes || 0) === 0) {
      const row = database().prepare(`
        SELECT compression, raw_length, value_hash, payload
        FROM protocol_objects WHERE scope = ? AND key = ?
      `).get(normalizedScope, normalizedKey);
      const existingBytes = decodeStoragePayload(row?.payload, {
        compression: row?.compression,
        rawLength: row?.raw_length,
        maximumRawLength: maximumPayloadBytes
      });
      if (row?.value_hash !== valueHash || !existingBytes.equals(bytes)) {
        throw new Error(`Protocol object content-hash collision for ${memoryKey}`);
      }
    }
    cacheProtocolObject(memoryKey, storedValue, bytes.length);
    return normalizeCanonicalValue(storedValue);
  }

  async function getProtocolObject(scope, key, fallback = null) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    const memoryKey = `${normalizedScope}/${normalizedKey}`;
    const cached = cachedProtocolObject(memoryKey);
    if (cached === TRANSACTION_TOMBSTONE) return fallback;
    if (cached !== undefined) return normalizeCanonicalValue(cached);
    const row = database().prepare(`
      SELECT compression, raw_length, value_hash, payload
      FROM protocol_objects WHERE scope = ? AND key = ?
    `).get(normalizedScope, normalizedKey);
    if (!row) return fallback;
    const value = protocolObjectFromRow(row);
    cacheProtocolObject(memoryKey, value, Number(row.raw_length || 0));
    return normalizeCanonicalValue(value);
  }

  async function deleteProtocolObject(scope, key) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    const memoryKey = `${normalizedScope}/${normalizedKey}`;
    database().prepare("DELETE FROM protocol_objects WHERE scope = ? AND key = ?").run(normalizedScope, normalizedKey);
    cacheProtocolObject(memoryKey, TRANSACTION_TOMBSTONE);
  }

  async function listProtocolObjectKeys(scope) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const rows = database().prepare("SELECT key FROM protocol_objects WHERE scope = ? ORDER BY key").all(normalizedScope);
    return rows.map((row) => String(row.key));
  }

  function clearCache() {
    if (lifecycleState !== "open" && !closingOwnedTransaction()) throw closedStorageError();
    memoryBlocks.clear();
    memoryObjects.clear();
  }

  function promoteTransactionCache(staged) {
    for (const cid of staged.deletedBlocks) memoryBlocks.delete(cid);
    for (const [cid, record] of staged.blocks.entries()) {
      if (!staged.deletedBlocks.has(cid)) memoryBlocks.set(cid, record, record.byteLength);
    }
    for (const [memoryKey, value] of staged.objects.entries()) {
      if (value === TRANSACTION_TOMBSTONE) memoryObjects.delete(memoryKey);
      else memoryObjects.set(memoryKey, value, Number(staged.objectWeights.get(memoryKey) || 0));
    }
  }

  async function runWriteTransaction(task, timeoutMs) {
    database().exec(`PRAGMA busy_timeout = ${Math.max(1, Number(timeoutMs || 10000))}`);
    await execWithBusyRetry("BEGIN IMMEDIATE", { timeoutMs });
    inTransaction = true;
    const staged = {
      blocks: new Map(),
      objects: new Map(),
      objectWeights: new Map(),
      deletedBlocks: new Set()
    };
    transactionCache = staged;
    try {
      const result = await task();
      database().exec("COMMIT");
      promoteTransactionCache(staged);
      return result;
    } catch (error) {
      /* node:coverage ignore next 7 */
      try {
        database().exec("ROLLBACK");
      } catch (_) {
        // Preserve the original task error.
      }
      throw error;
    } finally {
      transactionCache = null;
      inTransaction = false;
    }
  }

  async function withWriteLock(task, { timeoutMs = 10000 } = {}) {
    await ensureInitialized();
    if (currentTransactionCache()) return task();
    const run = writeLane.catch(() => null).then(() => transactionContext.run(
      transactionToken,
      () => runWriteTransaction(task, timeoutMs)
    ));
    writeLane = run.catch(() => null);
    return run;
  }

  async function scanBlocks({ afterCid = "", limit = 1000, kinds = [] } = {}) {
    await ensureInitialized();
    const requestedLimit = Number(limit);
    const normalizedLimit = Number.isSafeInteger(requestedLimit)
      ? Math.max(1, Math.min(MAX_SCAN_LIMIT, requestedLimit))
      : 1000;
    const normalizedKinds = normalizeStringSet(kinds);
    const kindClause = normalizedKinds.length > 0
      ? ` AND kind IN (${placeholders(normalizedKinds.length)})`
      : "";
    const rows = database().prepare(`
      SELECT cid, codec, kind, compression, raw_length, length(payload) AS stored_length,
             created_at
      FROM blocks
      WHERE cid > ?${kindClause}
      ORDER BY cid
      LIMIT ?
    `).all(String(afterCid || ""), ...normalizedKinds, normalizedLimit + 1);
    const hasMore = rows.length > normalizedLimit;
    const page = hasMore ? rows.slice(0, normalizedLimit) : rows;
    const refsByParent = readRefsForParents(page.map((row) => String(row.cid)));
    const items = page.map((row) => ({
      cid: String(row.cid),
      codec: String(row.codec),
      kind: String(row.kind),
      compression: String(row.compression),
      byteLength: Number(row.raw_length || 0),
      storedByteLength: Number(row.stored_length || 0),
      payloadHash: String(row.cid).slice("cid:".length),
      createdAt: String(row.created_at),
      refs: refsByParent.get(String(row.cid)) || []
    }));
    return {
      supported: true,
      items,
      nextCursor: hasMore ? items.at(-1)?.cid || "" : "",
      done: !hasMore
    };
  }

  function existingCids(cids) {
    const existing = new Set();
    for (const batch of chunks(cids)) {
      if (batch.length === 0) continue;
      const rows = database().prepare(`
        SELECT cid FROM blocks WHERE cid IN (${placeholders(batch.length)})
      `).all(...batch);
      for (const row of rows) existing.add(String(row.cid));
    }
    return existing;
  }

  function markReachable(seedCids) {
    const reachable = new Set();
    const missing = new Set();
    let frontier = [...seedCids];
    while (frontier.length > 0) {
      const batch = frontier.splice(0, SQL_BATCH_SIZE).filter((cid) => !reachable.has(cid));
      if (batch.length === 0) continue;
      const present = existingCids(batch);
      for (const cid of batch) {
        if (present.has(cid)) reachable.add(cid);
        else missing.add(cid);
      }
      if (present.size === 0) continue;
      const parents = [...present];
      const rows = database().prepare(`
        SELECT parent_cid, child_cid FROM block_refs
        WHERE parent_cid IN (${placeholders(parents.length)})
        ORDER BY parent_cid, ordinal, child_cid
      `).all(...parents);
      for (const row of rows) {
        const childCid = String(row.child_cid);
        if (!reachable.has(childCid) && !missing.has(childCid)) frontier.push(childCid);
      }
    }
    return { reachable, missing: [...missing].sort() };
  }

  async function collectGarbageInTransaction({
    roots = [],
    retain = [],
    sweepKinds = [],
    createdBefore = "",
    dryRun = true
  } = {}) {
    const seedCids = normalizeStringSet([...asArray(roots), ...asArray(retain)]);
    const eligibleKinds = normalizeStringSet(sweepKinds);
    if (seedCids.length === 0 || eligibleKinds.length === 0) {
      return {
        supported: true,
        aborted: true,
        reason: seedCids.length === 0 ? "no-retention-roots" : "no-sweep-kinds",
        dryRun: Boolean(dryRun),
        reachableCount: 0,
        candidateCount: 0,
        candidateBytes: 0,
        deletedCount: 0,
        deletedBytes: 0,
        missing: []
      };
    }
    const marked = markReachable(seedCids);
    if (marked.missing.length > 0) {
      return {
        supported: true,
        aborted: true,
        reason: "incomplete-reachable-graph",
        dryRun: Boolean(dryRun),
        reachableCount: marked.reachable.size,
        candidateCount: 0,
        candidateBytes: 0,
        deletedCount: 0,
        deletedBytes: 0,
        missing: marked.missing
      };
    }
    const cutoffMs = createdBefore ? Date.parse(createdBefore) : Number.NaN;
    if (createdBefore && Number.isNaN(cutoffMs)) {
      return {
        supported: true,
        aborted: true,
        reason: "invalid-created-before",
        dryRun: Boolean(dryRun),
        reachableCount: marked.reachable.size,
        candidateCount: 0,
        candidateBytes: 0,
        deletedCount: 0,
        deletedBytes: 0,
        missing: []
      };
    }
    let cursor = "";
    let candidateCount = 0;
    let candidateBytes = 0;
    const candidatePreview = [];
    const transaction = currentTransactionCache();
    while (true) {
      const rows = database().prepare(`
        SELECT cid, kind, raw_length, length(payload) AS stored_length, created_at
        FROM blocks
        WHERE cid > ? AND kind IN (${placeholders(eligibleKinds.length)})
        ORDER BY cid
        LIMIT 1000
      `).all(cursor, ...eligibleKinds);
      if (rows.length === 0) break;
      cursor = String(rows.at(-1).cid);
      const candidates = rows.filter((row) => {
        if (marked.reachable.has(String(row.cid))) return false;
        if (!Number.isNaN(cutoffMs) && Date.parse(String(row.created_at)) >= cutoffMs) return false;
        return true;
      });
      candidateCount += candidates.length;
      candidateBytes += candidates.reduce((total, row) => total + Number(row.stored_length || 0), 0);
      for (const row of candidates) {
        if (candidatePreview.length >= 100) break;
        candidatePreview.push({
          cid: String(row.cid),
          kind: String(row.kind),
          byteLength: Number(row.raw_length || 0),
          storedByteLength: Number(row.stored_length || 0),
          createdAt: String(row.created_at)
        });
      }
      if (!dryRun) {
        for (const batch of chunks(candidates.map((row) => String(row.cid)))) {
          if (batch.length === 0) continue;
          database().prepare(`DELETE FROM blocks WHERE cid IN (${placeholders(batch.length)})`).run(...batch);
          for (const cid of batch) {
            transaction?.deletedBlocks.add(cid);
            transaction?.blocks.delete(cid);
          }
        }
      }
      if (rows.length < 1000) break;
    }
    return {
      supported: true,
      aborted: false,
      reason: "",
      dryRun: Boolean(dryRun),
      reachableCount: marked.reachable.size,
      candidateCount,
      candidateBytes,
      deletedCount: dryRun ? 0 : candidateCount,
      deletedBytes: dryRun ? 0 : candidateBytes,
      missing: [],
      candidates: candidatePreview,
      candidatesTruncated: candidateCount > candidatePreview.length
    };
  }

  async function collectGarbage(options = {}) {
    await ensureInitialized();
    if (currentTransactionCache()) return collectGarbageInTransaction(options);
    return withWriteLock(() => collectGarbageInTransaction(options), options);
  }

  async function reclaimDatabasePages({ pages = 256 } = {}) {
    await ensureInitialized();
    if (currentTransactionCache()) {
      return { supported: true, deferred: true, reclaimedPages: 0 };
    }
    const requestedPages = Number(pages);
    const normalizedPages = Number.isSafeInteger(requestedPages)
      ? Math.max(1, Math.min(100_000, requestedPages))
      : 256;
    const run = writeLane.catch(() => null).then(() => {
      const beforeRow = database().prepare("PRAGMA freelist_count").get();
      const before = Number(beforeRow?.freelist_count || 0);
      database().exec(`PRAGMA incremental_vacuum(${normalizedPages})`);
      const afterRow = database().prepare("PRAGMA freelist_count").get();
      const after = Number(afterRow?.freelist_count || 0);
      return { supported: true, deferred: false, reclaimedPages: Math.max(0, before - after) };
    });
    writeLane = run.catch(() => null);
    return run;
  }

  function close() {
    if (transactionContext.getStore() === transactionToken) {
      return Promise.reject(reentrantCloseError());
    }
    if (lifecycleState === "closed") return Promise.resolve();
    if (closePromise) return closePromise;
    lifecycleState = "closing";
    const admittedOperations = [...activeOperations];
    closePromise = (async () => {
      await Promise.allSettled(admittedOperations);
      await initializationPromise?.catch(() => null);
      await writeLane.catch(() => null);
      const activeDatabase = db;
      activeDatabase?.close?.();
      db = null;
      initialized = false;
      inTransaction = false;
      transactionCache = null;
      memoryBlocks.clear();
      memoryObjects.clear();
      lifecycleState = "closed";
    })().catch((error) => {
      closePromise = null;
      throw error;
    });
    return closePromise;
  }

  return Object.freeze({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    storageFormat: PACTIUM_SQLITE_STORAGE_FORMAT,
    atomicTransactions: true,
    dataDir: resolvedDataDir,
    get sqlitePath() { return resolvedDatabasePath; },
    get sqliteProvider() { return sqliteProvider; },
    inMemory: false,
    storageBackend: PACTIUM_STORAGE_BACKEND_SQLITE,
    initialize() { return runOperation(ensureInitialized); },
    putBlock(...args) { return runOperation(() => putBlock(...args)); },
    getBlock(...args) { return runOperation(() => getBlock(...args)); },
    hasBlock(...args) { return runOperation(() => hasBlock(...args)); },
    walk(...args) { return runOperation(() => walk(...args)); },
    putProtocolObject(...args) { return runOperation(() => putProtocolObject(...args)); },
    getProtocolObject(...args) { return runOperation(() => getProtocolObject(...args)); },
    deleteProtocolObject(...args) { return runOperation(() => deleteProtocolObject(...args)); },
    listProtocolObjectKeys(...args) { return runOperation(() => listProtocolObjectKeys(...args)); },
    scanBlocks(...args) { return runOperation(() => scanBlocks(...args)); },
    collectGarbage(...args) { return runOperation(() => collectGarbage(...args)); },
    reclaimDatabasePages(...args) { return runOperation(() => reclaimDatabasePages(...args)); },
    clearCache,
    withWriteLock(...args) { return runOperation(() => withWriteLock(...args)); },
    close,
    pruneBlocks() { return 0; },
    pruneProtocolObjects() { return 0; }
  });
}
