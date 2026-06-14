import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  checkpointTreeId as buildCheckpointTreeId,
  deleteCheckpointTree,
  finishCheckpointTree,
  startCheckpointTree,
  upsertCheckpointNode
} from "../../platform/common/data-structure/checkpoint-tree-store.mjs";
import { resolveArchiveBatchIdentity } from "../../services/client/work-queue-core/archive-batch-id.mjs";
import {
  assertServerToken,
  hashClientString,
  resolveWithin,
  serverToken
} from "../../platform/common/security/client-strings.mjs";

const SESSION_SCHEMA_VERSION = "v0.0.1:storage:checkpoint-upload-session-schema-1";

function nowIso() {
  return new Date().toISOString();
}

async function emitTrace(trace, event = {}) {
  if (typeof trace !== "function") {
    return;
  }
  await trace({
    layer: "store",
    ...event
  });
}

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

function validateRelativePath(value) {
  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    throw new Error("上传文件缺少相对路径。");
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("上传路径不安全，已拒绝。");
  }

  return normalized;
}

function normalizeSha256(value, fieldName) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} 必须是 sha256 hex。`);
  }
  return normalized;
}

function normalizeOptionalSha256(value, fieldName) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return normalizeSha256(normalized, fieldName);
}

function normalizeByteSize(value) {
  const byteSize = Number(value || 0);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error("上传文件大小无效。");
  }
  return byteSize;
}

function normalizeFileIndex(value) {
  const fileIndex = Number(value);
  if (!Number.isSafeInteger(fileIndex) || fileIndex < 0) {
    throw new Error("上传文件索引无效。");
  }
  return fileIndex;
}

function originalFileNameForUpload(file, index) {
  return path.posix.basename(
    normalizeRelativePath(file?.relativePath || file?.name || `upload-${index + 1}`)
  );
}

async function hashFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function withSessionRoot(userDataPath, ...parts) {
  return resolveWithin(path.join(userDataPath, "upload-sessions"), ...parts);
}

function getSessionMetaPath(userDataPath, sessionId) {
  assertServerToken(sessionId, "upload_session");
  return withSessionRoot(userDataPath, sessionId, "meta.json");
}

function getSessionFilePath(userDataPath, sessionId, fileIndex) {
  assertServerToken(sessionId, "upload_session");
  return withSessionRoot(userDataPath, sessionId, "files", `${normalizeFileIndex(fileIndex)}.part`);
}

async function saveSessionMeta(userDataPath, meta) {
  const metaPath = getSessionMetaPath(userDataPath, meta.sessionId);
  await fsp.mkdir(path.dirname(metaPath), { recursive: true });
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

async function loadSessionMeta(userDataPath, sessionId) {
  assertServerToken(sessionId, "upload_session");
  const metaPath = getSessionMetaPath(userDataPath, sessionId);
  try {
    const raw = await fsp.readFile(metaPath, "utf8");
    const meta = JSON.parse(raw);
    return reconcileSessionMeta(userDataPath, meta);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function reconcileSessionMeta(userDataPath, meta) {
  let changed = false;

  for (const file of meta.files || []) {
    const filePath = getSessionFilePath(userDataPath, meta.sessionId, file.index);
    let actualSize = 0;

    try {
      const stats = await fsp.stat(filePath);
      actualSize = Math.max(0, Number(stats.size || 0));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    if (actualSize > Number(file.byteSize || 0)) {
      await fsp.truncate(filePath, Number(file.byteSize || 0));
      actualSize = Number(file.byteSize || 0);
      changed = true;
    }

    if (Number(file.receivedBytes || 0) !== actualSize) {
      file.receivedBytes = actualSize;
      changed = true;
    }

    if (actualSize === Number(file.byteSize || 0) && actualSize > 0) {
      const sha256 = await hashFileSha256(filePath);
      if (sha256 === file.sha256) {
        if (!file.completedAt) {
          file.completedAt = nowIso();
          changed = true;
        }
        if (file.verifiedSha256 !== sha256) {
          file.verifiedSha256 = sha256;
          changed = true;
        }
      } else {
        await fsp.truncate(filePath, 0);
        file.receivedBytes = 0;
        file.completedAt = "";
        file.verifiedSha256 = "";
        changed = true;
      }
    } else if (file.completedAt || file.verifiedSha256) {
      file.completedAt = "";
      file.verifiedSha256 = "";
      changed = true;
    }
  }

  const nextStatus =
    meta.files.length === 0 ||
    meta.files.every(
      (file) =>
        Number(file.receivedBytes || 0) === Number(file.byteSize || 0) &&
        (Number(file.byteSize || 0) === 0 || Boolean(file.completedAt))
    )
      ? "complete"
      : "uploading";
  if (meta.status !== nextStatus) {
    meta.status = nextStatus;
    changed = true;
  }

  if (changed) {
    meta.updatedAt = nowIso();
    await saveSessionMeta(userDataPath, meta);
  }

  return meta;
}

function buildPublicSession(meta) {
  const archiveBatch = resolveArchiveBatchIdentity({
    archiveBatchId: meta.archiveBatchId,
    checkpointId: meta.checkpointId,
    manifestDigest: meta.manifestDigest,
    inputDigest: meta.inputDigest
  });
  return {
    sessionId: meta.sessionId,
    checkpointId: meta.checkpointId,
    archiveBatchId: archiveBatch.archiveBatchId,
    clientUid: meta.clientUid || "",
    sourceType: meta.sourceType || "",
    checkpointTreeId: meta.checkpointTreeId || buildCheckpointTreeId("upload-session", meta.sessionId),
    manifestDigest: meta.manifestDigest,
    inputDigest: meta.inputDigest,
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    files: (meta.files || []).map((file) => ({
      index: file.index,
      name: file.name,
      relativePath: file.relativePath,
      originalFileName: file.originalFileName || "",
      clientUid: file.clientUid || meta.clientUid || "",
      sourceType: file.sourceType || meta.sourceType || "",
      providerId: file.providerId || meta.providerId || "",
      externalId: file.externalId || meta.externalId || "",
      syncBatchId: file.syncBatchId || meta.syncBatchId || "",
      contentHash: file.contentHash || meta.contentHash || "",
      capturedAt: file.capturedAt || meta.capturedAt || "",
      mediaType: file.mediaType,
      sha256: file.sha256,
      byteSize: file.byteSize,
      receivedBytes: file.receivedBytes || 0,
      completed: Boolean(file.completedAt),
      completedAt: file.completedAt || ""
    }))
  };
}

export async function createOrResumeUploadSession({
  userDataPath,
  checkpoint,
  manifest,
  files = [],
  trace
}) {
  await emitTrace(trace, {
    functionName: "createOrResumeUploadSession",
    stage: "start",
    message: "开始创建或恢复上传会话。",
    checkpointPresent: Boolean(checkpoint?.checkpointId),
    manifestPresent: Boolean(manifest?.manifestDigest),
    inputDigestPresent: Boolean(manifest?.inputDigest),
    fileCount: files.length
  });
  const clientCheckpointId =
    typeof checkpoint?.checkpointId === "string" ? checkpoint.checkpointId.trim() : "";
  if (!clientCheckpointId) {
    await emitTrace(trace, {
      functionName: "createOrResumeUploadSession",
      stage: "validation_failed",
      level: "error",
      message: "上传会话缺少客户端 checkpointId。",
      checkpointPresent: false
    });
    throw new Error("upload session 缺少 checkpointId。");
  }

  const manifestDigest = normalizeSha256(manifest?.manifestDigest, "manifestDigest");
  const inputDigest = normalizeOptionalSha256(manifest?.inputDigest, "inputDigest");
  const checkpointId = serverToken(
    "checkpoint",
    clientCheckpointId,
    manifestDigest,
    inputDigest
  );
  const archiveBatch = resolveArchiveBatchIdentity({
    archiveBatchId: checkpoint?.archiveBatchId,
    batchId: checkpoint?.batchId,
    clientBatchId: checkpoint?.clientBatchId,
    checkpointId: clientCheckpointId,
    manifestDigest,
    inputDigest
  });
  const sessionId = serverToken("upload_session", checkpointId, manifestDigest, inputDigest);
  const clientUid = String(checkpoint?.clientUid || checkpoint?.clientId || manifest?.clientUid || manifest?.clientId || "").trim();
  const sourceType = String(checkpoint?.sourceType || checkpoint?.resourceType || manifest?.sourceType || manifest?.resourceType || "upload").trim();
  const providerId = String(checkpoint?.providerId || manifest?.providerId || "").trim();
  const externalId = String(checkpoint?.externalId || manifest?.externalId || "").trim();
  const syncBatchId = String(checkpoint?.syncBatchId || manifest?.syncBatchId || "").trim();
  const contentHash = String(checkpoint?.contentHash || manifest?.contentHash || "").trim();
  const capturedAt = String(checkpoint?.capturedAt || manifest?.capturedAt || "").trim();
  const checkpointTreeId = buildCheckpointTreeId("upload-session", sessionId);
  await startCheckpointTree({
    userDataPath,
    treeId: checkpointTreeId,
    kind: "upload_session",
    ownerId: sessionId,
    inputHash: manifestDigest,
    rootNodeId: "upload-session",
    rootLabel: "上传会话",
    metadata: {
      sessionId,
      checkpointId,
      archiveBatchId: archiveBatch.archiveBatchId,
      clientUid,
      sourceType,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      manifestDigest,
      inputDigest,
      fileCount: files.length
    },
    resumePolicy: {
      mode: "chunk-offset",
      idempotencyKey: "sessionId+fileIndex+offset+sha256",
      reusableState: "upload-sessions/<sessionId>/files + meta.json"
    },
    resetOnInputHashChange: false
  });
  await emitTrace(trace, {
    functionName: "createOrResumeUploadSession",
    stage: "ids_derived",
    message: "已派生服务端 checkpoint/session token。",
    checkpointId,
    sessionId,
    manifestDigest,
    inputDigest,
    sourceCheckpointHash: hashClientString(clientCheckpointId, "checkpoint.source")
  });

  const existing = await loadSessionMeta(userDataPath, sessionId);
  if (existing) {
    if (existing.manifestDigest !== manifestDigest || existing.inputDigest !== inputDigest) {
      await emitTrace(trace, {
        functionName: "createOrResumeUploadSession",
        stage: "resume_rejected",
        level: "error",
        message: "同一 checkpoint 的上传会话摘要不一致。",
        sessionId,
        checkpointId,
        manifestDigest,
        inputDigest,
        existingManifestDigest: existing.manifestDigest,
        existingInputDigest: existing.inputDigest
      });
      throw new Error("同一 checkpoint 的上传会话摘要不一致，拒绝覆盖。");
    }
    const existingArchiveBatchId = existing.archiveBatchId
      ? resolveArchiveBatchIdentity({
          archiveBatchId: existing.archiveBatchId,
          checkpointId: existing.checkpointId,
          manifestDigest: existing.manifestDigest,
          inputDigest: existing.inputDigest
        }).archiveBatchId
      : "";
    if (existingArchiveBatchId && existingArchiveBatchId !== archiveBatch.archiveBatchId) {
      await emitTrace(trace, {
        functionName: "createOrResumeUploadSession",
        stage: "resume_rejected",
        level: "error",
        message: "同一 checkpoint 的归档批次不一致。",
        sessionId,
        checkpointId,
        archiveBatchId: archiveBatch.archiveBatchId,
        existingArchiveBatchId
      });
      throw new Error("同一 checkpoint 的归档批次不一致，拒绝覆盖。");
    }

    await emitTrace(trace, {
      functionName: "createOrResumeUploadSession",
      stage: "resumed",
      message: "命中已有上传会话，返回服务端权威状态。",
      sessionId,
      checkpointId,
      status: existing.status,
      files: (existing.files || []).map((file) => ({
        index: file.index,
        byteSize: file.byteSize,
        receivedBytes: file.receivedBytes || 0,
        completed: Boolean(file.completedAt)
      }))
    });
    await upsertCheckpointNode({
      userDataPath,
      treeId: existing.checkpointTreeId || checkpointTreeId,
      nodeId: "receive-upload-files",
      parentId: "upload-session",
      label: "接收上传分块",
      status: existing.status === "complete" ? "completed" : "running",
      totals: {
        fileCount: existing.files?.length || 0,
        totalBytes: (existing.files || []).reduce((sum, file) => sum + Number(file.byteSize || 0), 0),
        receivedBytes: (existing.files || []).reduce((sum, file) => sum + Number(file.receivedBytes || 0), 0),
        completedFiles: (existing.files || []).filter((file) => file.completedAt).length
      },
      cursor: {
        status: existing.status || "",
        completedFiles: (existing.files || []).filter((file) => file.completedAt).length
      }
    }).catch(() => null);
    if (existing.status === "complete") {
      await finishCheckpointTree({
        userDataPath,
        treeId: existing.checkpointTreeId || checkpointTreeId,
        status: "completed",
        message: "Upload session already complete."
      }).catch(() => null);
    }
    return buildPublicSession(existing);
  }

  const now = nowIso();
  const meta = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    checkpointId,
    checkpointTreeId,
    archiveBatchId: archiveBatch.archiveBatchId,
    clientArchiveBatchHash: archiveBatch.clientArchiveBatchHash,
    archiveBatchSource: archiveBatch.archiveBatchSource,
    clientUid,
    sourceType,
    providerId,
    externalId,
    syncBatchId,
    contentHash,
    capturedAt,
    sourceCheckpointHash: hashClientString(clientCheckpointId, "checkpoint.source"),
    parentCheckpointHash: hashClientString(checkpoint?.parentCheckpointId || "", "checkpoint.parent"),
    checkpointModeHash: hashClientString(checkpoint?.mode || "", "checkpoint.mode"),
    manifestDigest,
    inputDigest,
    status: files.length === 0 ? "complete" : "uploading",
    createdAt: now,
    updatedAt: now,
    files: files.map((file, index) => {
      const sourceRelativePath = validateRelativePath(
        file.relativePath || file.name || `upload-${index + 1}`
      );
      const originalFileName = originalFileNameForUpload(file, index);
      const sha256 = normalizeSha256(file.sha256, `files[${index}].sha256`);
      const byteSize = normalizeByteSize(file.byteSize);
      const sourceRelativePathHash = hashClientString(sourceRelativePath, "upload.relative_path");
      const sourceNameHash = hashClientString(
        file.name || path.posix.basename(sourceRelativePath),
        "upload.name"
      );
      const fileToken = serverToken(
        "upload_file",
        sessionId,
        index,
        sourceRelativePathHash,
        sha256,
        byteSize
      );
      return {
        index,
        name: fileToken,
        relativePath: fileToken,
        originalFileName,
        clientUid: String(file.clientUid || file.clientId || clientUid || "").trim(),
        sourceType: String(file.sourceType || file.resourceType || sourceType || "upload").trim(),
        providerId: String(file.providerId || providerId || "").trim(),
        externalId: String(file.externalId || externalId || "").trim(),
        syncBatchId: String(file.syncBatchId || syncBatchId || "").trim(),
        contentHash: String(file.contentHash || contentHash || sha256 || "").trim(),
        capturedAt: String(file.capturedAt || capturedAt || "").trim(),
        sourceMetadata:
          file.sourceMetadata && typeof file.sourceMetadata === "object" && !Array.isArray(file.sourceMetadata)
            ? file.sourceMetadata
            : {},
        sourceNameHash,
        sourceRelativePathHash,
        clientMediaTypeHash: hashClientString(file.mediaType || "", "upload.media_type"),
        mediaType: "application/octet-stream",
        sha256,
        byteSize,
        receivedBytes: 0,
        completedAt: "",
        verifiedSha256: ""
      };
    })
  };

  await saveSessionMeta(userDataPath, meta);
  await upsertCheckpointNode({
    userDataPath,
    treeId: checkpointTreeId,
    nodeId: "receive-upload-files",
    parentId: "upload-session",
    label: "接收上传分块",
    status: files.length === 0 ? "skipped" : "running",
    totals: {
      fileCount: meta.files.length,
      totalBytes: meta.files.reduce((sum, file) => sum + Number(file.byteSize || 0), 0),
      receivedBytes: 0,
      completedFiles: 0
    },
    cursor: {
      status: meta.status
    }
  }).catch(() => null);
  if (meta.status === "complete") {
    await finishCheckpointTree({
      userDataPath,
      treeId: checkpointTreeId,
      status: "completed",
      message: "Upload session has no files."
    }).catch(() => null);
  }
  await emitTrace(trace, {
    functionName: "createOrResumeUploadSession",
    stage: "created",
    message: "已创建上传会话元数据。",
    sessionId,
    checkpointId,
    status: meta.status,
    fileCount: meta.files.length,
    files: meta.files.map((file) => ({
      index: file.index,
      name: file.name,
      relativePath: file.relativePath,
      sourceNameHash: file.sourceNameHash,
      sourceRelativePathHash: file.sourceRelativePathHash,
      byteSize: file.byteSize,
      receivedBytes: file.receivedBytes,
      completed: Boolean(file.completedAt)
    }))
  });
  return buildPublicSession(meta);
}

export async function getUploadSession(userDataPath, sessionId) {
  let meta;
  try {
    meta = await loadSessionMeta(userDataPath, sessionId);
  } catch (error) {
    if (/token 格式无效/.test(String(error?.message || ""))) {
      return null;
    }
    throw error;
  }
  return meta ? buildPublicSession(meta) : null;
}

export async function appendUploadSessionChunk({
  userDataPath,
  sessionId,
  fileIndex,
  offset,
  buffer,
  trace
}) {
  const safeFileIndex = normalizeFileIndex(fileIndex);
  await emitTrace(trace, {
    functionName: "appendUploadSessionChunk",
    stage: "start",
    message: "开始接收上传分块。",
    sessionId,
    fileIndex: safeFileIndex,
    offset: Number(offset || 0),
    chunkBytes: buffer.length
  });
  let meta;
  try {
    meta = await loadSessionMeta(userDataPath, sessionId);
  } catch (error) {
    if (/token 格式无效/.test(String(error?.message || ""))) {
      await emitTrace(trace, {
        functionName: "appendUploadSessionChunk",
        stage: "session_token_invalid",
        level: "error",
        message: "上传会话 token 格式无效。",
        sessionId,
        fileIndex: safeFileIndex
      });
      return {
        ok: false,
        code: "not_found",
        session: null
      };
    }
    throw error;
  }
  if (!meta) {
    await emitTrace(trace, {
      functionName: "appendUploadSessionChunk",
      stage: "session_not_found",
      level: "error",
      message: "上传会话不存在。",
      sessionId,
      fileIndex: safeFileIndex
    });
    return {
      ok: false,
      code: "not_found",
      session: null
    };
  }

  const file = meta.files.find((item) => item.index === safeFileIndex);
  if (!file) {
    await emitTrace(trace, {
      functionName: "appendUploadSessionChunk",
      stage: "file_not_found",
      level: "error",
      message: "上传文件索引不存在。",
      sessionId,
      fileIndex: safeFileIndex
    });
    return {
      ok: false,
      code: "file_not_found",
      session: buildPublicSession(meta)
    };
  }

  if (Number(offset) !== Number(file.receivedBytes || 0)) {
    await emitTrace(trace, {
      functionName: "appendUploadSessionChunk",
      stage: "offset_mismatch",
      level: "warning",
      message: "客户端上传 offset 与服务端 receivedBytes 不一致。",
      sessionId,
      fileIndex: safeFileIndex,
      offset: Number(offset),
      expectedOffset: Number(file.receivedBytes || 0),
      receivedBytes: Number(file.receivedBytes || 0)
    });
    return {
      ok: false,
      code: "offset_mismatch",
      expectedOffset: Number(file.receivedBytes || 0),
      session: buildPublicSession(meta)
    };
  }

  const remainingBytes = Number(file.byteSize || 0) - Number(file.receivedBytes || 0);
  if (buffer.length > remainingBytes) {
    await emitTrace(trace, {
      functionName: "appendUploadSessionChunk",
      stage: "chunk_too_large",
      level: "error",
      message: "上传分块超过该文件剩余字节数。",
      sessionId,
      fileIndex: safeFileIndex,
      chunkBytes: buffer.length,
      remainingBytes
    });
    return {
      ok: false,
      code: "chunk_too_large",
      expectedOffset: Number(file.receivedBytes || 0),
      session: buildPublicSession(meta)
    };
  }

  const filePath = getSessionFilePath(userDataPath, sessionId, safeFileIndex);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.appendFile(filePath, buffer);
  file.receivedBytes = Number(file.receivedBytes || 0) + buffer.length;
  file.completedAt = "";
  file.verifiedSha256 = "";

  if (Number(file.receivedBytes || 0) === Number(file.byteSize || 0)) {
    const sha256 = await hashFileSha256(filePath);
    if (sha256 !== file.sha256) {
      await fsp.truncate(filePath, 0);
      file.receivedBytes = 0;
      meta.updatedAt = nowIso();
      await saveSessionMeta(userDataPath, meta);
      await upsertCheckpointNode({
        userDataPath,
        treeId: meta.checkpointTreeId || buildCheckpointTreeId("upload-session", meta.sessionId),
        nodeId: "receive-upload-files",
        parentId: "upload-session",
        label: "上传分块校验失败，等待重传",
        status: "running",
        error: "sha256_mismatch",
        cursor: {
          fileIndex: safeFileIndex,
          expectedOffset: 0
        }
      }).catch(() => null);
      await emitTrace(trace, {
        functionName: "appendUploadSessionChunk",
        stage: "sha256_mismatch",
        level: "error",
        message: "文件完成后 sha256 校验失败，已重置该文件上传进度。",
        sessionId,
        fileIndex: safeFileIndex,
        expectedSha256: file.sha256,
        actualSha256: sha256
      });
      return {
        ok: false,
        code: "sha256_mismatch",
        expectedOffset: 0,
        session: buildPublicSession(await reconcileSessionMeta(userDataPath, meta))
      };
    }

    file.verifiedSha256 = sha256;
    file.completedAt = nowIso();
  }

  meta.updatedAt = nowIso();
  await saveSessionMeta(userDataPath, meta);
  const reconciled = await reconcileSessionMeta(userDataPath, meta);
  const treeId = reconciled.checkpointTreeId || buildCheckpointTreeId("upload-session", reconciled.sessionId);
  await upsertCheckpointNode({
    userDataPath,
    treeId,
    nodeId: "receive-upload-files",
    parentId: "upload-session",
    label: "接收上传分块",
    status: reconciled.status === "complete" ? "completed" : "running",
    totals: {
      fileCount: reconciled.files?.length || 0,
      totalBytes: (reconciled.files || []).reduce((sum, item) => sum + Number(item.byteSize || 0), 0),
      receivedBytes: (reconciled.files || []).reduce((sum, item) => sum + Number(item.receivedBytes || 0), 0),
      completedFiles: (reconciled.files || []).filter((item) => item.completedAt).length
    },
    cursor: {
      fileIndex: safeFileIndex,
      receivedBytes: file.receivedBytes,
      byteSize: file.byteSize,
      completed: Boolean(file.completedAt),
      status: reconciled.status
    }
  }).catch(() => null);
  if (reconciled.status === "complete") {
    await finishCheckpointTree({
      userDataPath,
      treeId,
      status: "completed",
      message: "Upload session completed.",
      metadata: {
        fileCount: reconciled.files?.length || 0
      }
    }).catch(() => null);
  }
  await emitTrace(trace, {
    functionName: "appendUploadSessionChunk",
    stage: "accepted",
    message: "上传分块已写入并保存会话元数据。",
    sessionId,
    fileIndex: safeFileIndex,
    offset: Number(offset),
    chunkBytes: buffer.length,
    receivedBytes: file.receivedBytes,
    byteSize: file.byteSize,
    completed: Boolean(file.completedAt),
    status: reconciled.status
  });
  return {
    ok: true,
    code: "ok",
    session: buildPublicSession(reconciled)
  };
}

export async function resolveUploadSessionFiles(userDataPath, sessionId) {
  const meta = await loadSessionMeta(userDataPath, sessionId);
  if (!meta) {
    throw new Error(`上传会话不存在：${sessionId}`);
  }

  if (meta.status !== "complete") {
    throw new Error(`上传会话尚未完成：${sessionId}`);
  }

  return meta.files.map((file) => ({
    name: file.name,
    relativePath: file.relativePath,
    sourceNameHash: file.sourceNameHash || "",
    sourceRelativePathHash: file.sourceRelativePathHash || "",
    originalFileName: file.originalFileName || "",
    clientUid: file.clientUid || meta.clientUid || "",
    sourceType: file.sourceType || meta.sourceType || "",
    providerId: file.providerId || meta.providerId || "",
    externalId: file.externalId || meta.externalId || "",
    syncBatchId: file.syncBatchId || meta.syncBatchId || "",
    contentHash: file.contentHash || meta.contentHash || file.sha256 || "",
    capturedAt: file.capturedAt || meta.capturedAt || "",
    sourceMetadata: file.sourceMetadata || {},
    archiveBatchId: meta.archiveBatchId || "",
    mediaType: file.mediaType,
    sha256: file.sha256,
    byteSize: file.byteSize,
    stagedPath: getSessionFilePath(userDataPath, sessionId, file.index)
  }));
}

export async function buildCheckpointReceiptFromUploadSession(userDataPath, sessionId) {
  const meta = await loadSessionMeta(userDataPath, sessionId);
  if (!meta) {
    throw new Error(`上传会话不存在：${sessionId}`);
  }

  if (meta.status !== "complete") {
    throw new Error(`上传会话尚未完成：${sessionId}`);
  }

  const archiveBatch = resolveArchiveBatchIdentity({
    archiveBatchId: meta.archiveBatchId,
    checkpointId: meta.checkpointId,
    manifestDigest: meta.manifestDigest,
    inputDigest: meta.inputDigest
  });
  return {
    checkpointId: meta.checkpointId,
    archiveBatchId: archiveBatch.archiveBatchId,
    clientUid: meta.clientUid || "",
    sourceType: meta.sourceType || "",
    providerId: meta.providerId || "",
    externalId: meta.externalId || "",
    syncBatchId: meta.syncBatchId || "",
    contentHash: meta.contentHash || "",
    capturedAt: meta.capturedAt || "",
    verifiedAt: nowIso(),
    manifestSha256: meta.manifestDigest,
    fileCount: meta.files.length,
    files: meta.files.map((file) => ({
      name: file.name,
      relativePath: file.relativePath,
      originalFileName: file.originalFileName || "",
      clientUid: file.clientUid || meta.clientUid || "",
      sourceType: file.sourceType || meta.sourceType || "",
      providerId: file.providerId || meta.providerId || "",
      externalId: file.externalId || meta.externalId || "",
      syncBatchId: file.syncBatchId || meta.syncBatchId || "",
      contentHash: file.contentHash || meta.contentHash || file.sha256 || "",
      capturedAt: file.capturedAt || meta.capturedAt || "",
      sourceMetadata: file.sourceMetadata || {},
      sourceNameHash: file.sourceNameHash || "",
      sourceRelativePathHash: file.sourceRelativePathHash || "",
      sha256: file.sha256,
      byteSize: file.byteSize
    }))
  };
}

export async function deleteUploadSession(userDataPath, sessionId) {
  if (!sessionId) {
    return;
  }

  assertServerToken(sessionId, "upload_session");
  await deleteCheckpointTree({
    userDataPath,
    treeId: buildCheckpointTreeId("upload-session", sessionId)
  }).catch(() => null);
  await fsp.rm(withSessionRoot(userDataPath, sessionId), {
    recursive: true,
    force: true
  });
}
