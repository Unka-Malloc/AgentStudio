import { AsyncLocalStorage } from "node:async_hooks";
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
  if (!backend) return PACTIUM_STORAGE_BACKEND_AUTO;
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
  let closePromise = null;
  let lifecycleState = "open";
  const activeOperations = new Set();
  const operationContext = new AsyncLocalStorage();
  const operationToken = {};

  function closedStorageError() {
    const error = new Error("Pactium auto storage is closed.");
    error.code = "PACTIUM_STORAGE_CLOSED";
    return error;
  }

  function reentrantCloseError() {
    const error = new Error("Pactium auto storage cannot close from inside its own active operation.");
    error.code = "PACTIUM_REENTRANT_CLOSE";
    return error;
  }

  async function select() {
    if (lifecycleState !== "open") throw closedStorageError();
    if (selected) return selected;
    if (!selectionPromise) {
      selectionPromise = (async () => {
        const backend = await resolveAutoBackend(resolvedDataDir, options);
        if (lifecycleState !== "open") throw closedStorageError();
        selected = createBackendStoragePort(backend, {
          ...options,
          dataDir: resolvedDataDir
        });
        return selected;
      })();
    }
    const port = await selectionPromise;
    if (lifecycleState !== "open") throw closedStorageError();
    return port;
  }

  function selectedSync() {
    return selected;
  }

  async function withSelected(method, ...args) {
    const port = await select();
    return port[method](...args);
  }

  function runOperation(task) {
    if (lifecycleState !== "open") return Promise.reject(closedStorageError());
    let result;
    try {
      result = operationContext.run(operationToken, task);
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

  function close() {
    if (operationContext.getStore() === operationToken) {
      return Promise.reject(reentrantCloseError());
    }
    if (lifecycleState === "closed") return Promise.resolve();
    if (closePromise) return closePromise;
    lifecycleState = "closing";
    const admittedOperations = [...activeOperations];
    closePromise = (async () => {
      await Promise.allSettled(admittedOperations);
      if (selectionPromise) await selectionPromise.catch(() => null);
      await selected?.close?.();
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
    inMemory: false,
    get storageBackend() {
      return selectedSync()?.storageBackend || PACTIUM_STORAGE_BACKEND_AUTO;
    },
    get selectedStorageBackend() {
      return selectedSync()?.storageBackend || "";
    },
    get storageFormat() {
      return selectedSync()?.storageFormat || "";
    },
    get atomicTransactions() {
      return Boolean(selectedSync()?.atomicTransactions);
    },
    initialize() { return runOperation(() => withSelected("initialize")); },
    putBlock(value, writeOptions) {
      return runOperation(() => withSelected("putBlock", value, writeOptions));
    },
    getBlock(cid) {
      return runOperation(() => withSelected("getBlock", cid));
    },
    hasBlock(cid) {
      return runOperation(() => withSelected("hasBlock", cid));
    },
    walk(rootCid) {
      return runOperation(() => withSelected("walk", rootCid));
    },
    putProtocolObject(scope, key, value) {
      return runOperation(() => withSelected("putProtocolObject", scope, key, value));
    },
    getProtocolObject(scope, key, fallback) {
      return runOperation(() => withSelected("getProtocolObject", scope, key, fallback));
    },
    deleteProtocolObject(scope, key) {
      return runOperation(() => withSelected("deleteProtocolObject", scope, key));
    },
    listProtocolObjectKeys(scope) {
      return runOperation(() => withSelected("listProtocolObjectKeys", scope));
    },
    scanBlocks(options) {
      return runOperation(() => withSelected("scanBlocks", options));
    },
    collectGarbage(options) {
      return runOperation(() => withSelected("collectGarbage", options));
    },
    reclaimDatabasePages(options) {
      return runOperation(() => withSelected("reclaimDatabasePages", options));
    },
    clearCache() {
      selectedSync()?.clearCache?.();
    },
    async withWriteLock(task, lockOptions) {
      return runOperation(async () => {
        const port = await select();
        return port.withWriteLock ? port.withWriteLock(task, lockOptions) : task();
      });
    },
    close,
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
    options.storageBackend || process.env.PACTIUM_STORAGE_BACKEND || PACTIUM_STORAGE_BACKEND_AUTO
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
