import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeCanonicalValue } from "../canonical/value.js";
import { canonicalEncode } from "../canonical/value.js";
import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { cidForBytes, hashBytes } from "../protocol/hashing.js";
import { asArray, nowIso, safeToken } from "../shared/records.js";
import { loadSqliteStorageDriver, sqliteStorageAvailable } from "./sqlite-capability.js";
import { defaultPactiumDataDir, resolveDataDir, resolveWithin } from "./local-json-storage-port.js";
import {
  ensurePrivateDirectory,
  hardenPrivateRegularFile,
  PRIVATE_FILE_MODE,
  writePrivateFileAtomic
} from "./private-atomic-file.js";

export const PACTIUM_STORAGE_BACKEND_SQLITE = "sqlite";
export { sqliteStorageAvailable };

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

function blockFromRow(row) {
  if (!row) return null;
  return {
    protocol: row.protocol,
    schema: row.schema,
    cid: row.cid,
    codec: row.codec,
    kind: row.kind,
    refs: JSON.parse(row.refs_json || "[]"),
    byteLength: Number(row.byte_length || 0),
    payloadHash: row.payload_hash,
    payloadBase64: row.payload_base64,
    createdAt: row.created_at
  };
}

function cloneBlock(record) {
  return {
    ...record,
    refs: [...asArray(record.refs)],
    bytes: Buffer.from(record.payloadBase64 || "", "base64")
  };
}

function resolveSqliteDatabasePath(dataDir, databasePath) {
  if (!databasePath) return resolveWithin(dataDir, "pactium.sqlite");
  return resolveWithin(dataDir, String(databasePath));
}

export function createSqliteStoragePort({
  dataDir = "",
  userDataPath = "",
  databasePath = "",
  inMemory = false
} = {}) {
  if (inMemory) {
    throw new Error("SQLite storage backend does not support inMemory mode; use createStoragePort({ inMemory: true }).");
  }
  const resolvedDataDir = resolveDataDir(dataDir || userDataPath || defaultPactiumDataDir());
  let resolvedDatabasePath = resolveSqliteDatabasePath(resolvedDataDir, databasePath);
  const memoryBlocks = new Map();
  const memoryObjects = new Map();
  let initialized = false;
  let db = null;
  let sqliteProvider = "";
  let inTransaction = false;
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
    await execWithBusyRetry(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS blocks (
        cid TEXT PRIMARY KEY,
        protocol TEXT NOT NULL,
        schema TEXT NOT NULL,
        codec TEXT NOT NULL,
        kind TEXT NOT NULL,
        refs_json TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_base64 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS protocol_objects (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      );
    `);
    await hardenPrivateRegularFile(resolvedDatabasePath);
    await hardenSqliteSidecars(resolvedDatabasePath);
    if (!manifest) {
      await writeJsonAtomic(manifestPath(), {
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        storageBackend: PACTIUM_STORAGE_BACKEND_SQLITE,
        sqlitePath: relativeSqlitePath(),
        sqliteProvider,
        createdAt: nowIso(),
        latestSchemaOnly: true,
        historicalMigration: false
      });
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

  async function putBlock(value, { codec = "pactium-canonical", kind = "protocol-material", refs = [] } = {}) {
    await ensureInitialized();
    const bytes = codec === "raw"
      ? Buffer.from(value || "")
      : Buffer.from(canonicalEncode(value));
    const cid = cidForBytes(bytes);
    const payloadHash = `sha256:${hashBytes(bytes)}`;
    const record = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      cid,
      codec,
      kind,
      refs: [...new Set(asArray(refs).map((ref) => String(ref || "").trim()).filter(Boolean))],
      byteLength: bytes.length,
      payloadHash,
      payloadBase64: bytes.toString("base64"),
      createdAt: nowIso()
    };
    const existing = await getBlock(cid);
    if (existing) {
      /* node:coverage ignore next 4 */
      if (existing.payloadHash !== payloadHash || existing.payloadBase64 !== record.payloadBase64) {
        throw new Error(`CAS collision or replacement attempt for ${cid}`);
      }
      return { ...existing, deduped: true };
    }
    database().prepare(`
      INSERT INTO blocks (cid, protocol, schema, codec, kind, refs_json, byte_length, payload_hash, payload_base64, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.cid,
      record.protocol,
      record.schema,
      record.codec,
      record.kind,
      JSON.stringify(record.refs),
      record.byteLength,
      record.payloadHash,
      record.payloadBase64,
      record.createdAt
    );
    memoryBlocks.set(cid, record);
    return { ...record, deduped: false };
  }

  async function getBlock(cid) {
    await ensureInitialized();
    if (memoryBlocks.has(cid)) return cloneBlock(memoryBlocks.get(cid));
    const row = database().prepare("SELECT * FROM blocks WHERE cid = ?").get(String(cid || ""));
    const record = blockFromRow(row);
    if (!record) return null;
    const bytes = Buffer.from(String(record.payloadBase64 || ""), "base64");
    const payloadHash = `sha256:${hashBytes(bytes)}`;
    /* node:coverage ignore next 4 */
    if (payloadHash !== record.payloadHash || cidForBytes(bytes) !== record.cid) {
      throw new Error(`CAS block integrity failure for ${cid}`);
    }
    memoryBlocks.set(record.cid, record);
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
      for (const ref of [...asArray(block.refs)].reverse()) {
        if (!seen.has(ref)) stack.push(ref);
      }
    }
    return { protocol: PACTIUM_PROTOCOL, rootCid, blockCount: blocks.length, missing, blocks };
  }

  async function putProtocolObject(scope, key, value) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    const storedValue = normalizeCanonicalValue(value);
    database().prepare(`
      INSERT INTO protocol_objects (scope, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(normalizedScope, normalizedKey, JSON.stringify(storedValue), nowIso());
    memoryObjects.set(`${normalizedScope}/${normalizedKey}`, storedValue);
    return normalizeCanonicalValue(storedValue);
  }

  async function getProtocolObject(scope, key, fallback = null) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    const memoryKey = `${normalizedScope}/${normalizedKey}`;
    if (memoryObjects.has(memoryKey)) return normalizeCanonicalValue(memoryObjects.get(memoryKey));
    const row = database().prepare("SELECT value_json FROM protocol_objects WHERE scope = ? AND key = ?")
      .get(normalizedScope, normalizedKey);
    if (!row) return fallback;
    const value = normalizeCanonicalValue(JSON.parse(row.value_json));
    memoryObjects.set(memoryKey, value);
    return normalizeCanonicalValue(value);
  }

  async function deleteProtocolObject(scope, key) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    memoryObjects.delete(`${normalizedScope}/${normalizedKey}`);
    database().prepare("DELETE FROM protocol_objects WHERE scope = ? AND key = ?").run(normalizedScope, normalizedKey);
  }

  async function listProtocolObjectKeys(scope) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const prefix = `${normalizedScope}/`;
    const keys = new Set();
    for (const compoundKey of memoryObjects.keys()) {
      if (compoundKey.startsWith(prefix)) keys.add(compoundKey.slice(prefix.length));
    }
    const rows = database().prepare("SELECT key FROM protocol_objects WHERE scope = ? ORDER BY key").all(normalizedScope);
    for (const row of rows) keys.add(row.key);
    return [...keys];
  }

  function clearCache() {
    memoryObjects.clear();
  }

  async function runWriteTransaction(task, timeoutMs) {
    database().exec(`PRAGMA busy_timeout = ${Math.max(1, Number(timeoutMs || 10000))}`);
    await execWithBusyRetry("BEGIN IMMEDIATE", { timeoutMs });
    inTransaction = true;
    try {
      const result = await task();
      database().exec("COMMIT");
      return result;
    } catch (error) {
      /* node:coverage ignore next 7 */
      try {
        database().exec("ROLLBACK");
      } catch (_) {
        // Preserve the original task error.
      }
      memoryBlocks.clear();
      memoryObjects.clear();
      throw error;
    } finally {
      inTransaction = false;
    }
  }

  async function withWriteLock(task, { timeoutMs = 10000 } = {}) {
    await ensureInitialized();
    if (inTransaction && transactionContext.getStore() === transactionToken) return task();
    const run = writeLane.catch(() => null).then(() => transactionContext.run(
      transactionToken,
      () => runWriteTransaction(task, timeoutMs)
    ));
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
    clearCache,
    withWriteLock(...args) { return runOperation(() => withWriteLock(...args)); },
    close,
    pruneBlocks() { return 0; },
    pruneProtocolObjects() { return 0; }
  });
}
