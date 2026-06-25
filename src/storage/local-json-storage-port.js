import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { canonicalEncode, normalizeCanonicalValue } from "../canonical/value.js";
import { cidForBytes, hashBytes, hexFromCid } from "../protocol/hashing.js";
import { asArray, nowIso, safeToken } from "../shared/records.js";

export const PACTIUM_STORAGE_BACKEND_JSON = "json";

export function defaultPactiumDataDir() {
  return path.join(os.homedir(), ".pactium");
}

export function resolveDataDir(dataDir = "") {
  const configured = String(dataDir || process.env.PACTIUM_DATA_DIR || defaultPactiumDataDir());
  const expanded = configured === "~" || configured.startsWith("~/") || configured.startsWith(`~${path.sep}`)
    ? path.join(os.homedir(), configured.slice(2))
    : configured;
  return path.resolve(expanded);
}

export function resolveWithin(root, ...segments) {
  const base = path.resolve(String(root || defaultPactiumDataDir()));
  const target = path.resolve(base, ...segments.map((segment) => String(segment || "")));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Path escapes Pactium data directory: ${target}`);
  }
  return target;
}

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

/* node:coverage ignore next 11 */
async function fsyncDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    const dirFd = await fs.open(dir, "r");
    await dirFd.sync();
    await dirFd.close();
  } catch (_) {
    // best-effort directory fsync
  }
}

/* node:coverage ignore next 10 */
async function fsyncFile(filePath) {
  try {
    const fd = await fs.open(filePath, "r+");
    await fd.sync();
    await fd.close();
  } catch (_) {
    // best-effort file fsync (file may be read-only or already renamed)
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  // Write to temp file with explicit fd for fsync
  const fd = await fs.open(tmpPath, "w");
  try {
    await fd.writeFile(content, "utf8");
    await fd.sync();
  } finally {
    await fd.close();
  }
  await fs.rename(tmpPath, filePath);
  await fsyncDir(filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processIsAlive(pid) {
  if (!pid || pid === process.pid) return Boolean(pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function createJsonStoragePort({ dataDir = "", userDataPath = "", inMemory = false } = {}) {
  const resolvedDataDir = resolveDataDir(dataDir || userDataPath);
  const memoryBlocks = new Map();
  const memoryObjects = new Map();
  let initialized = false;

  function manifestPath() {
    return resolveWithin(resolvedDataDir, "pactium-manifest.json");
  }

  function blockPath(cid) {
    const hex = hexFromCid(cid);
    return resolveWithin(resolvedDataDir, "cas", hex.slice(0, 2), `${hex}.json`);
  }

  function objectPath(scope, key) {
    return resolveWithin(resolvedDataDir, "protocol", safeToken(scope), `${safeToken(key)}.json`);
  }

  function lockPath(name = "write") {
    return resolveWithin(resolvedDataDir, "locks", `${safeToken(name)}.lock`);
  }

  function lockOwnerPath(lockDir) {
    return path.join(lockDir, "owner.json");
  }

  async function ensureInitialized() {
    if (initialized) return;
    initialized = true;
    if (inMemory) return;
    await fs.mkdir(resolvedDataDir, { recursive: true });
    const manifest = await readJson(manifestPath());
    if (manifest) {
      if (manifest.protocol !== PACTIUM_PROTOCOL || manifest.schema !== PACTIUM_SCHEMA_VERSION) {
        throw new Error("Pactium latest-schema-only boundary rejected a non-current protocol data directory.");
      }
      const manifestBackend = String(manifest.storageBackend || PACTIUM_STORAGE_BACKEND_JSON);
      if (manifestBackend !== PACTIUM_STORAGE_BACKEND_JSON) {
        throw new Error(`Pactium data directory uses ${manifestBackend} storage backend; JSON storage backend cannot open it.`);
      }
      return;
    }
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
    await writeJsonAtomic(manifestPath(), {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      storageBackend: PACTIUM_STORAGE_BACKEND_JSON,
      createdAt: nowIso(),
      latestSchemaOnly: true,
      historicalMigration: false
    });
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
    memoryBlocks.set(cid, record);
    if (!inMemory) await writeJsonAtomic(blockPath(cid), record);
    return { ...record, deduped: false };
  }

  async function getBlock(cid) {
    await ensureInitialized();
    if (memoryBlocks.has(cid)) {
      const cached = memoryBlocks.get(cid);
      return {
        ...cached,
        refs: [...asArray(cached.refs)],
        bytes: Buffer.from(cached.payloadBase64 || "", "base64")
      };
    }
    if (inMemory) return null;
    const record = await readJson(blockPath(cid));
    if (!record) return null;
    const bytes = Buffer.from(String(record.payloadBase64 || ""), "base64");
    const payloadHash = `sha256:${hashBytes(bytes)}`;
    if (payloadHash !== record.payloadHash || cidForBytes(bytes) !== record.cid) {
      throw new Error(`CAS block integrity failure for ${cid}`);
    }
    const cloned = { ...record, refs: [...asArray(record.refs)] };
    memoryBlocks.set(cid, cloned);
    return { ...cloned, bytes };
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
    const stored = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      value: storedValue,
      updatedAt: nowIso()
    };
    // Store a canonical clone internally and return a separate canonical clone
    // so that callers mutating the returned value cannot poison the cache.
    memoryObjects.set(`${normalizedScope}/${normalizedKey}`, storedValue);
    if (!inMemory) await writeJsonAtomic(objectPath(normalizedScope, normalizedKey), stored);
    return normalizeCanonicalValue(storedValue);
  }

  function clearCache() {
    memoryObjects.clear();
  }

  async function readLockOwner(lockDir) {
    let owner = null;
    let ownerMissing = false;
    let ownerUnreadable = false;
    let rawError = null;
    try {
      owner = await readJson(lockOwnerPath(lockDir), null);
    } catch (error) {
      ownerUnreadable = true;
      rawError = error?.message || String(error);
    }
    // readJson returns null for ENOENT (file missing) — distinguish from
    // unreadable (parse/permission errors). A JSON null value is treated as
    // missing because it is not a valid owner object.
    if (owner === null && !ownerUnreadable) {
      ownerMissing = true;
    }
    const stats = await fs.stat(lockDir).catch(() => null);
    return {
      owner,
      ownerMissing,
      ownerUnreadable,
      mtimeMs: Number(stats?.mtimeMs || 0),
      rawError
    };
  }

  async function removeStaleLock(lockDir, staleMs) {
    const first = await readLockOwner(lockDir);
    if (!first.mtimeMs) return false;

    // --- Ownerless lock directory (owner.json missing) ---
    // A lock directory without owner.json is a dirty/stale artifact. Use
    // directory mtimeMs as the age signal; double-stat to avoid TOCTOU races.
    if (first.ownerMissing) {
      const ageMs = Date.now() - first.mtimeMs;
      if (ageMs < staleMs) return false; // fresh dirty lock — don't remove
      // Double-check: re-read stat to confirm mtime is stable
      const stats2 = await fs.stat(lockDir).catch(() => null);
      if (!stats2) return false;
      if (Math.abs(Number(stats2.mtimeMs) - first.mtimeMs) > 100) return false; // mtime changed
      // Confirm owner.json is still absent
      const recheck = await readJson(lockOwnerPath(lockDir), undefined);
      if (recheck !== null) return false; // owner.json appeared between reads
      await fs.rm(lockDir, { recursive: true, force: true });
      return true;
    }

    // --- Unreadable/malformed owner.json ---
    // A lock with an unreadable owner.json (parse error, permission denied) is
    // treated like a dirty artifact. Use directory mtimeMs for age; double-read
    // to confirm the file is still unreadable before cleaning.
    if (first.ownerUnreadable) {
      const ageMs = Date.now() - first.mtimeMs;
      if (ageMs < staleMs) return false; // fresh unreadable lock — don't remove
      // Double-check: re-read to confirm still unreadable and mtime stable
      const latest = await readLockOwner(lockDir);
      if (!latest.ownerUnreadable) return false; // became readable between checks
      if (Math.abs(latest.mtimeMs - first.mtimeMs) > 100) return false; // mtime changed
      await fs.rm(lockDir, { recursive: true, force: true });
      return true;
    }

    // --- Owner present — normal staleness check ---
    const owner = first.owner;
    // Gracefully handle malformed owner.json: extract fields safely, never crash.
    const pid = typeof owner?.pid === "number" ? owner.pid : Number(owner?.pid || 0);
    // Prefer heartbeatAtMs for staleness; fall back to createdAtMs, then directory mtime.
    // A fresh heartbeatAtMs means the lock is still active even if createdAtMs is old.
    const lastActivityMs = typeof owner?.heartbeatAtMs === "number"
      ? owner.heartbeatAtMs
      : typeof owner?.createdAtMs === "number"
        ? owner.createdAtMs
        : Number(owner?.heartbeatAtMs || owner?.createdAtMs || 0) || first.mtimeMs;
    const ageMs = Date.now() - lastActivityMs;
    if (ageMs < staleMs && processIsAlive(pid)) {
      return false; // process is alive and has recent activity — not stale
    }
    // If no process alive and age exceeds stale threshold, proceed to double-read check
    const latest = await readLockOwner(lockDir);
    if (latest.ownerMissing || latest.ownerUnreadable) {
      // Owner went missing or became unreadable between reads.
      // Use directory mtime for staleness with double-check pattern.
      const dirAgeMs = Date.now() - latest.mtimeMs;
      if (dirAgeMs < staleMs) return false;
      const statsCheck = await fs.stat(lockDir).catch(() => null);
      if (!statsCheck) return false;
      if (Math.abs(Number(statsCheck.mtimeMs) - latest.mtimeMs) > 100) return false;
      // If ownerMissing, confirm file is still absent; if ownerUnreadable, re-confirm
      if (latest.ownerMissing) {
        const recheck = await readJson(lockOwnerPath(lockDir), undefined);
        if (recheck !== null) return false;
      } else {
        const recheck = await readLockOwner(lockDir);
        if (!recheck.ownerUnreadable) return false;
      }
      await fs.rm(lockDir, { recursive: true, force: true });
      return true;
    }
    // Compare owner identity fields as STRINGS — fencingToken is a UUID, not a number.
    // Using Number() on UUID produces NaN, and NaN !== NaN is always true,
    // which would prevent stale lock cleanup.
    const sameOwner = String(latest.owner?.ownerId || "") === String(owner?.ownerId || "") &&
      String(latest.owner?.fencingToken || "") === String(owner?.fencingToken || "") &&
      String(latest.owner?.processStartKey || "") === String(owner?.processStartKey || "");
    if (!sameOwner) return false; // owner changed between reads — do not delete
    await fs.rm(lockDir, { recursive: true, force: true });
    return true;
  }

  async function withWriteLock(task, {
    name = "write",
    timeoutMs = 10000,
    retryMs = 25,
    staleMs = 30000
  } = {}) {
    await ensureInitialized();
    if (inMemory) return task();
    const locksDir = resolveWithin(resolvedDataDir, "locks");
    await fs.mkdir(locksDir, { recursive: true });
    const targetLockPath = lockPath(name);
    const ownerId = crypto.randomUUID();
    const startedAt = Date.now();
    let acquired = false;
    while (!acquired) {
      try {
        await fs.mkdir(targetLockPath);
        acquired = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        await removeStaleLock(targetLockPath, staleMs).catch(() => false);
        if (Date.now() - startedAt >= timeoutMs) {
          const lockError = new Error(`Timed out acquiring Pactium data directory write lock: ${targetLockPath}`);
          lockError.code = "PACTIUM_WRITE_LOCK_TIMEOUT";
          lockError.details = {
            protocol: PACTIUM_PROTOCOL,
            lockType: "pactium.write-lock",
            dataDir: resolvedDataDir,
            lockPath: targetLockPath,
            timeoutMs,
            retryMs,
            staleMs
          };
          throw lockError;
        }
        await sleep(retryMs);
      }
    }
    const fencingToken = crypto.randomUUID();
    const processStartKey = crypto.randomUUID();
    await writeJsonAtomic(lockOwnerPath(targetLockPath), {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      lockType: "pactium.write-lock",
      ownerId,
      fencingToken,
      pid: process.pid,
      host: os.hostname(),
      processStartKey,
      createdAt: nowIso(),
      createdAtMs: Date.now(),
      heartbeatAt: nowIso(),
      heartbeatAtMs: Date.now()
    });
    // Start heartbeat interval to keep the lock fresh
    const heartbeatMs = Math.max(100, Math.min(staleMs / 4, 5000));
    const heartbeat = setInterval(async () => {
      try {
        const current = await readJson(lockOwnerPath(targetLockPath), null);
        // Verify owner identity with fencingToken and processStartKey,
        // not just ownerId, to prevent accidental cross-process reuse.
        if (!current ||
            current.ownerId !== ownerId ||
            current.fencingToken !== fencingToken ||
            current.processStartKey !== processStartKey) {
          clearInterval(heartbeat);
          return;
        }
        await writeJsonAtomic(lockOwnerPath(targetLockPath), {
          ...current,
          heartbeatAt: nowIso(),
          heartbeatAtMs: Date.now()
        });
      } catch (_) {
        /* node:coverage ignore next 5 */
        // Stop heartbeat on any error — don't leak the interval.
        // If the lock dir was removed externally, there's nothing to heartbeat.
        try { clearInterval(heartbeat); } catch (_) { /* ignore */ }
      }
    }, heartbeatMs);
    try {
      return await task();
    } finally {
      try { clearInterval(heartbeat); } catch (_) { /* ignore */ }
      // Release lock: confirm owner identity including fencingToken and
      // processStartKey. If any identity field has changed, another process
      // holds this lock — do not delete.
      const owner = await readJson(lockOwnerPath(targetLockPath), null).catch(() => null);
      if (owner &&
          owner.ownerId === ownerId &&
          owner.fencingToken === fencingToken &&
          owner.processStartKey === processStartKey) {
        await fs.rm(targetLockPath, { recursive: true, force: true });
      }
    }
  }

  function pruneBlocks(predicate = () => false) {
    if (!inMemory) return 0;
    let pruned = 0;
    for (const [cid, record] of memoryBlocks.entries()) {
      if (predicate(record)) {
        memoryBlocks.delete(cid);
        pruned += 1;
      }
    }
    return pruned;
  }

  function pruneProtocolObjects(predicate = () => false) {
    if (!inMemory) return 0;
    let pruned = 0;
    for (const [compoundKey, value] of memoryObjects.entries()) {
      const [scope = "", key = ""] = compoundKey.split("/");
      if (predicate({ scope, key, value })) {
        memoryObjects.delete(compoundKey);
        pruned += 1;
      }
    }
    return pruned;
  }

  async function getProtocolObject(scope, key, fallback = null) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    const memoryKey = `${normalizedScope}/${normalizedKey}`;
    if (memoryObjects.has(memoryKey)) {
      // Return a canonical clone to prevent callers from mutating stored state.
      return normalizeCanonicalValue(memoryObjects.get(memoryKey));
    }
    if (inMemory) return fallback;
    const stored = await readJson(objectPath(normalizedScope, normalizedKey));
    if (!stored) return fallback;
    if (stored.protocol !== PACTIUM_PROTOCOL || stored.schema !== PACTIUM_SCHEMA_VERSION) {
      throw new Error("Pactium latest-schema-only boundary rejected protocol material.");
    }
    // Cache a canonical clone and return a separate canonical clone so that
    // callers mutating the returned value cannot poison the cache.
    const diskClone = normalizeCanonicalValue(stored.value);
    memoryObjects.set(memoryKey, diskClone);
    return normalizeCanonicalValue(diskClone);
  }

  async function deleteProtocolObject(scope, key) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const normalizedKey = safeToken(key);
    const memoryKey = `${normalizedScope}/${normalizedKey}`;
    memoryObjects.delete(memoryKey);
    if (!inMemory) {
      const filePath = objectPath(normalizedScope, normalizedKey);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  async function listProtocolObjectKeys(scope) {
    await ensureInitialized();
    const normalizedScope = safeToken(scope);
    const prefix = `${normalizedScope}/`;
    const memoryKeys = new Set();
    for (const compoundKey of memoryObjects.keys()) {
      if (compoundKey.startsWith(prefix)) {
        memoryKeys.add(compoundKey.slice(prefix.length));
      }
    }
    if (inMemory) return [...memoryKeys];
    // Scan disk directory for JSON files
    try {
      const dirPath = objectPath(normalizedScope, "__dir__").replace(/[/\\][^/\\]+$/, "");
      const dirents = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents) {
        if (dirent.isFile() && dirent.name.endsWith(".json")) {
          memoryKeys.add(dirent.name.slice(0, -".json".length));
        }
      }
    } catch (_) {
      // directory may not exist
    }
    return [...memoryKeys];
  }

  return Object.freeze({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    dataDir: resolvedDataDir,
    inMemory,
    storageBackend: PACTIUM_STORAGE_BACKEND_JSON,
    initialize: ensureInitialized,
    putBlock,
    getBlock,
    hasBlock,
    walk,
    putProtocolObject,
    getProtocolObject,
    deleteProtocolObject,
    listProtocolObjectKeys,
    clearCache,
    withWriteLock,
    pruneBlocks,
    pruneProtocolObjects
  });
}
