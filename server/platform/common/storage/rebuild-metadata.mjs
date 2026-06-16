import fs from "node:fs/promises";
import path from "node:path";
import { createMetadataStore } from "./metadata-store.mjs";
import { getMetadataDatabasePath } from "./schema-manager.mjs";

function getJobsRootPath(userDataPath) {
  return path.join(userDataPath, "jobs");
}

function safeArchiveSegment(value, fallback) {
  return String(value || fallback || "")
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || fallback;
}

function safeArchiveFileName(value) {
  const fileName = path.posix.basename(String(value || "").replace(/\\/g, "/"));
  return fileName
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/^\.+/, "")
    .trim() || "source";
}

function sourceStorageRelativePath(source, batchId, rawObjectId, originalRelativePath) {
  const existingPath = String(source.storageRelativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (existingPath) {
    return existingPath;
  }
  if (source.archiveFileName) {
    return path
      .join(
        "objects",
        safeArchiveSegment(source.clientUid, "unknown-client"),
        safeArchiveSegment(source.sourceType, "unknown-source"),
        safeArchiveFileName(source.archiveFileName)
      )
      .split(path.sep)
      .join("/");
  }
  return path
    .join("objects", "mail", batchId, rawObjectId, originalRelativePath)
    .split(path.sep)
    .join("/");
}

function toPersistedSource(source = {}, batchId) {
  const rawObjectId = String(source.rawObjectId || "").trim();
  const originalRelativePath = String(source.originalRelativePath || source.originalFileName || "");
  return {
    id: source.id,
    name: source.name,
    path: source.path || source.originalRelativePath || "",
    kind: source.kind || "email",
    sourceCreatedAt: source.sourceCreatedAt || "",
    sourceUpdatedAt: source.sourceUpdatedAt || "",
    sourceCollectedAt: source.sourceCollectedAt || "",
    text: source.text || "",
    mediaType: source.mediaType || "message/rfc822",
    imageDataUrl: source.imageDataUrl || "",
    documentParserId: source.documentParserId || "",
    documentMetadata: source.documentMetadata || {},
    embeddedDocuments: source.embeddedDocuments || [],
    rawObject: rawObjectId
      ? {
          objectId: rawObjectId,
          ingestOrigin: "filesystem",
          clientUid: source.clientUid || "",
          sourceType: source.sourceType || "",
          providerId: source.providerId || "",
          externalId: source.externalId || "",
          syncBatchId: source.syncBatchId || "",
          contentHash: source.contentHash || source.rawObjectSha256 || "",
          capturedAt: source.capturedAt || "",
          sourceMetadata: source.sourceMetadata || {},
          archiveFileName: source.archiveFileName || "",
          originalFileName: source.originalFileName || path.posix.basename(originalRelativePath),
          originalRelativePath,
          originalSourcePath: source.path || "",
          sourceContainerPath: "",
          storageRelativePath: sourceStorageRelativePath(
            source,
            batchId,
            rawObjectId,
            originalRelativePath
          ),
          mediaType: source.mediaType || "message/rfc822",
          sha256: source.rawObjectSha256 || "",
          byteSize: Number(source.rawObjectByteSize || 0),
          sourceCreatedAt: source.sourceCreatedAt || "",
          sourceUpdatedAt: source.sourceUpdatedAt || "",
          sourceCollectedAt: source.sourceCollectedAt || "",
          createdAt: source.sourceCollectedAt || source.sourceUpdatedAt || source.sourceCreatedAt || "",
          jobId: source.jobId || "",
          ownerSubjectId: source.ownerSubjectId || "",
          ownerUserId: source.ownerUserId || "",
          ownerUsername: source.ownerUsername || ""
        }
      : null
  };
}

function ownerFromBatch(batch = {}) {
  const meta = batch.meta || {};
  const payload = batch.payload || {};
  const ownerSubjectId = String(
    meta.ownerSubjectId ||
      payload.ownerSubjectId ||
      meta.ownerUserId ||
      payload.ownerUserId ||
      meta.ownerUsername ||
      payload.ownerUsername ||
      ""
  ).trim();
  const ownerUserId = String(meta.ownerUserId || payload.ownerUserId || ownerSubjectId).trim();
  const ownerUsername = String(meta.ownerUsername || payload.ownerUsername || "").trim();
  return {
    ownerSubjectId,
    ownerUserId,
    ownerUsername
  };
}

export async function rebuildMetadataStore({
  userDataPath,
  domainServices = {},
  loadRules = async () => ({})
}) {
  await fs.rm(path.dirname(getMetadataDatabasePath(userDataPath)), {
    recursive: true,
    force: true
  });
  const metadataStore = createMetadataStore({ userDataPath, domainServices });
  const rules = await loadRules(userDataPath);
  const jobsRootPath = getJobsRootPath(userDataPath);
  await fs.mkdir(jobsRootPath, { recursive: true });
  const entries = await fs.readdir(jobsRootPath, {
    withFileTypes: true
  });
  const batches = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const jobDirectory = path.join(jobsRootPath, entry.name);
    const metaPath = path.join(jobDirectory, "meta.json");
    const resultPath = path.join(jobDirectory, "result.json");
    const payloadPath = path.join(jobDirectory, "payload.json");

    let meta = null;
    let result = null;
    let payload = {};

    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    } catch {
      continue;
    }

    try {
      result = JSON.parse(await fs.readFile(resultPath, "utf8"));
    } catch {
      result = null;
    }

    try {
      payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
    } catch {
      payload = {};
    }

    batches.push({
      jobId: meta.id || entry.name,
      meta,
      result,
      payload
    });
  }

  batches.sort((left, right) =>
    String(left.meta.createdAt || "").localeCompare(String(right.meta.createdAt || ""))
  );

  const summary = {
    rebuiltBatchCount: 0,
    rebuiltCompletedCount: 0,
    rebuiltFailedCount: 0,
    skippedCount: 0
  };

  try {
    for (const batch of batches) {
      const batchId = batch.result?.batchId || batch.meta.archiveBatchId || batch.jobId;
      const jobId = batch.jobId;
      metadataStore.beginBatch({
        batchId,
        jobId,
        generatedAt:
          batch.result?.generatedAt || batch.meta.generatedAt || batch.meta.createdAt || new Date().toISOString(),
        settings: batch.payload?.settings || {}
      });

      if (batch.meta.status === "completed" && batch.result) {
        const owner = ownerFromBatch(batch);
        const sources = (batch.result.sourceFiles || []).map((source) =>
          toPersistedSource({
            ...source,
            jobId,
            ...owner
          }, batchId)
        );
        const warnings = batch.result.warnings || [];
        metadataStore.persistSources({
          batchId,
          sources,
          warnings,
          rules,
          jobId,
          ...owner
        });
        if (batch.result.preprocess) {
          metadataStore.persistPreprocessResult({
            batchId,
            preprocessResult: batch.result.preprocess
          });
        }
        metadataStore.persistAnalysis({
          batchId,
          result: batch.result,
          warnings,
          rules
        });
        summary.rebuiltCompletedCount += 1;
        summary.rebuiltBatchCount += 1;
        continue;
      }

      if (batch.meta.status === "failed") {
        metadataStore.markBatchFailed(batchId, batch.meta.error || "执行失败");
        summary.rebuiltFailedCount += 1;
        summary.rebuiltBatchCount += 1;
        continue;
      }

      metadataStore.updateBatchStatus(batchId, batch.meta.status || "queued", batch.meta.error || "");
      summary.rebuiltBatchCount += 1;
    }
  } finally {
    metadataStore.close();
  }

  return summary;
}
