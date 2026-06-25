import fs from "node:fs/promises";
import path from "node:path";

import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import {
  createJsonStoragePort,
  defaultPactiumDataDir,
  PACTIUM_STORAGE_BACKEND_JSON,
  resolveDataDir,
  resolveWithin
} from "./local-json-storage-port.js";
import {
  createSqliteStoragePort,
  PACTIUM_STORAGE_BACKEND_SQLITE
} from "./sqlite-storage-port.js";
import { detectSqliteCapabilities, sqliteStorageAvailable } from "./sqlite-capability.js";

export const PACTIUM_STORAGE_BACKEND_AUTO = "auto";

function normalizeStorageBackend(value) {
  const backend = String(value || "").trim().toLowerCase();
  if (!backend) return PACTIUM_STORAGE_BACKEND_JSON;
  if ([PACTIUM_STORAGE_BACKEND_AUTO, PACTIUM_STORAGE_BACKEND_JSON, PACTIUM_STORAGE_BACKEND_SQLITE].includes(backend)) {
    return backend;
  }
  throw new Error(`Unsupported Pactium storage backend: ${value}`);
}

async function readManifest(dataDir) {
  try {
    return JSON.parse(await fs.readFile(resolveWithin(dataDir, "pactium-manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAutoBackend(dataDir, options = {}) {
  const manifest = await readManifest(dataDir);
  if (manifest) {
    if (manifest.protocol !== PACTIUM_PROTOCOL || manifest.schema !== PACTIUM_SCHEMA_VERSION) {
      throw new Error("Pactium latest-schema-only boundary rejected a non-current protocol data directory.");
    }
    return String(manifest.storageBackend || PACTIUM_STORAGE_BACKEND_JSON);
  }
  const sqliteDatabaseExists = await pathExists(path.join(dataDir, "pactium.sqlite"));
  const capabilities = await detectSqliteCapabilities({
    includeSystem: options.includeSystemSqliteDetection !== false,
    timeoutMs: options.sqliteDetectionTimeoutMs
  });
  if (capabilities.storageAvailable || sqliteDatabaseExists) {
    return PACTIUM_STORAGE_BACKEND_SQLITE;
  }
  return PACTIUM_STORAGE_BACKEND_JSON;
}

function createBackendStoragePort(backend, options) {
  if (backend === PACTIUM_STORAGE_BACKEND_SQLITE) return createSqliteStoragePort(options);
  if (backend === PACTIUM_STORAGE_BACKEND_JSON) return createJsonStoragePort(options);
  throw new Error(`Unsupported Pactium storage backend: ${backend}`);
}

function createAutoStoragePort(options) {
  const resolvedDataDir = resolveDataDir(options.dataDir || options.userDataPath || defaultPactiumDataDir());
  let selected = null;
  let selectionPromise = null;

  async function select() {
    if (selected) return selected;
    if (!selectionPromise) {
      selectionPromise = (async () => {
        const backend = await resolveAutoBackend(resolvedDataDir, options);
        selected = createBackendStoragePort(backend, {
          ...options,
          dataDir: resolvedDataDir
        });
        return selected;
      })();
    }
    return selectionPromise;
  }

  function selectedSync() {
    return selected;
  }

  async function withSelected(method, ...args) {
    const port = await select();
    return port[method](...args);
  }

  return Object.freeze({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    dataDir: resolvedDataDir,
    inMemory: false,
    get storageBackend() {
      return selectedSync()?.storageBackend || PACTIUM_STORAGE_BACKEND_AUTO;
    },
    get selectedStorageBackend() {
      return selectedSync()?.storageBackend || "";
    },
    async initialize() {
      await withSelected("initialize");
    },
    putBlock(value, writeOptions) {
      return withSelected("putBlock", value, writeOptions);
    },
    getBlock(cid) {
      return withSelected("getBlock", cid);
    },
    hasBlock(cid) {
      return withSelected("hasBlock", cid);
    },
    walk(rootCid) {
      return withSelected("walk", rootCid);
    },
    putProtocolObject(scope, key, value) {
      return withSelected("putProtocolObject", scope, key, value);
    },
    getProtocolObject(scope, key, fallback) {
      return withSelected("getProtocolObject", scope, key, fallback);
    },
    deleteProtocolObject(scope, key) {
      return withSelected("deleteProtocolObject", scope, key);
    },
    listProtocolObjectKeys(scope) {
      return withSelected("listProtocolObjectKeys", scope);
    },
    clearCache() {
      selectedSync()?.clearCache?.();
    },
    async withWriteLock(task, lockOptions) {
      const port = await select();
      return port.withWriteLock ? port.withWriteLock(task, lockOptions) : task();
    },
    pruneBlocks() {
      return selectedSync()?.pruneBlocks?.() || 0;
    },
    pruneProtocolObjects() {
      return selectedSync()?.pruneProtocolObjects?.() || 0;
    }
  });
}

export function createStoragePort(options = {}) {
  const backend = normalizeStorageBackend(
    options.storageBackend || options.backend || process.env.PACTIUM_STORAGE_BACKEND || PACTIUM_STORAGE_BACKEND_JSON
  );
  if (options.inMemory) return createJsonStoragePort(options);
  if (backend === PACTIUM_STORAGE_BACKEND_AUTO) return createAutoStoragePort(options);
  return createBackendStoragePort(backend, options);
}

export {
  createJsonStoragePort,
  createSqliteStoragePort,
  detectSqliteCapabilities,
  sqliteStorageAvailable
};
