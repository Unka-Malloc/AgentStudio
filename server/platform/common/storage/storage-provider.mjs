import fs from "node:fs/promises";
import { createStorageBackup, listStorageBackups, restoreStorageBackup } from "./backup-restore.mjs";
import { reconcileStorage, runStorageDoctor } from "./ops-tools.mjs";
import { resolveStoredObjectPath } from "./raw-object-store.mjs";

export const STORAGE_PROTOCOL_VERSION = "v0.0.1:storage:core-1";

function unavailable(methodName) {
  const error = new Error(`storage provider method is not available: ${methodName}`);
  error.statusCode = 503;
  error.code = "STORAGE_PROVIDER_UNAVAILABLE";
  return error;
}

function requireMethod(target, methodName) {
  if (!target || typeof target[methodName] !== "function") {
    throw unavailable(methodName);
  }
  return target[methodName].bind(target);
}

function text(value = "") {
  return String(value || "").trim();
}

function normalizedClientList(value = {}) {
  return {
    summary: value.summary || {},
    items: Array.isArray(value.items) ? value.items : []
  };
}

export function createStorageProvider({
  userDataPath = "",
  metadataStore = null
} = {}) {
  const metadata = () => metadataStore;

  async function readRawObjectById(objectId) {
    const id = text(objectId);
    if (!id) {
      return null;
    }
    const rawObject = requireMethod(metadata(), "getRawMailObject")(id);
    if (!rawObject) {
      return null;
    }
    const storageRelativePath = text(rawObject.storage_rel_path || rawObject.storageRelativePath);
    const buffer = await fs.readFile(resolveStoredObjectPath(userDataPath, storageRelativePath));
    return {
      rawObject,
      buffer,
      contentType: rawObject.media_type || rawObject.mediaType || "application/octet-stream",
      fileName: rawObject.original_file_name || rawObject.originalFileName || `${id}.bin`,
      storageRelativePath
    };
  }

  function listClientRegistrations(input = {}) {
    return normalizedClientList(requireMethod(metadata(), "listClientRegistrations")(input));
  }

  return Object.freeze({
    protocolVersion: STORAGE_PROTOCOL_VERSION,
    getMetadataStore() {
      return metadata();
    },
    getStorageSummary() {
      return requireMethod(metadata(), "getStorageSummary")();
    },
    rebuildSourceVocabulary(input = {}) {
      return requireMethod(metadata(), "rebuildSourceVocabulary")(input);
    },
    getSignificantSourceTerms(input = {}) {
      return requireMethod(metadata(), "getSignificantSourceTerms")(input);
    },
    search(input = {}) {
      return requireMethod(metadata(), "search")(input);
    },
    recordClientCheckIn(input = {}) {
      return requireMethod(metadata(), "recordClientCheckIn")(input);
    },
    listClientRegistrations,
    findClientRegistration({ clientId = "", offlineAfterSeconds = 300 } = {}) {
      const selectedClientId = text(clientId);
      if (!selectedClientId) {
        return null;
      }
      return listClientRegistrations({ offlineAfterSeconds })
        .items.find((item) => item.clientId === selectedClientId) || null;
    },
    getRawObject(objectId) {
      const id = text(objectId);
      return id ? requireMethod(metadata(), "getRawMailObject")(id) : null;
    },
    readRawObjectById,
    resolveStoredObjectPath(storageRelativePath) {
      return resolveStoredObjectPath(userDataPath, storageRelativePath);
    },
    runDoctor() {
      return runStorageDoctor({ userDataPath });
    },
    reconcile(input = {}) {
      return reconcileStorage({
        userDataPath,
        apply: input.apply !== false,
        pruneOrphanObjects: input.pruneOrphanObjects === true
      });
    },
    listBackups() {
      return listStorageBackups({ userDataPath });
    },
    createBackup(input = {}) {
      return createStorageBackup({
        userDataPath,
        label: input.label || ""
      });
    },
    restoreBackupPreview(input = {}) {
      return restoreStorageBackup({
        userDataPath,
        backupId: input.backupId,
        dryRun: true,
        includePaths: input.includePaths || []
      });
    },
    restoreBackup(input = {}) {
      return restoreStorageBackup({
        userDataPath,
        backupId: input.backupId,
        dryRun: false,
        apply: input.confirm === true || input.apply === true,
        includePaths: input.includePaths || []
      });
    },
    listCapabilities() {
      return {
        protocolVersion: STORAGE_PROTOCOL_VERSION,
        capabilities: [
          {
            id: "metadata-summary",
            kind: "repository-projection",
            operations: ["getStorageSummary"]
          },
          {
            id: "raw-object",
            kind: "object-store",
            operations: ["getRawObject", "readRawObjectById", "resolveStoredObjectPath"]
          },
          {
            id: "client-registry",
            kind: "repository",
            operations: ["recordClientCheckIn", "listClientRegistrations", "findClientRegistration"]
          },
          {
            id: "maintenance",
            kind: "ops",
            operations: ["runDoctor", "reconcile", "listBackups", "createBackup", "restoreBackupPreview", "restoreBackup"]
          },
          {
            id: "corpus-index",
            kind: "repository-projection",
            operations: ["rebuildSourceVocabulary", "getSignificantSourceTerms", "search"]
          }
        ]
      };
    }
  });
}
