import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { unzipSync } from "fflate";
import { hashClientString, serverToken } from "../../../security/client-strings.mjs";
import { contentDispositionHeader, sendJson } from "../http-utils.mjs";

async function publishProtocolEvent(protocolEventBus, topic, payload, options = {}) {
  if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
    return null;
  }
  return protocolEventBus.publish(topic, payload, options);
}

function hashForTrace(value, label) {
  const text = String(value || "");
  return text ? hashClientString(text, `upload.trace.${label}`) : "";
}

function summarizeUploadSessionForTrace(session) {
  if (!session) {
    return null;
  }
  return {
    sessionId: session.sessionId || "",
    checkpointId: session.checkpointId || "",
    manifestDigest: session.manifestDigest || "",
    inputDigest: session.inputDigest || "",
    status: session.status || "",
    files: (session.files || []).map((file) => ({
      index: file.index ?? file.fileIndex ?? 0,
      name: file.name || "",
      relativePath: file.relativePath || "",
      byteSize: Number(file.byteSize || 0),
      receivedBytes: Number(file.receivedBytes || 0),
      completed: Boolean(file.completed || file.complete)
    }))
  };
}

function summarizeUploadSessionPayload(payload = {}, requestBodyLength = 0) {
  const checkpoint = payload?.checkpoint || {};
  const manifest = payload?.manifest || {};
  const files = Array.isArray(payload?.files) ? payload.files : [];
  return {
    requestBodyBytes: requestBodyLength,
    keys: Object.keys(payload || {}).sort(),
    checkpoint: {
      checkpointIdPresent: typeof checkpoint.checkpointId === "string" && checkpoint.checkpointId.trim().length > 0,
      checkpointIdHash: hashForTrace(checkpoint.checkpointId, "checkpoint_id"),
      parentCheckpointIdHash: hashForTrace(checkpoint.parentCheckpointId, "parent_checkpoint_id"),
      mode: String(checkpoint.mode || ""),
      inputDigest: String(checkpoint.inputDigest || ""),
      manifestDigest: String(checkpoint.manifestDigest || "")
    },
    manifest: {
      manifestDigestPresent: typeof manifest.manifestDigest === "string" && manifest.manifestDigest.trim().length > 0,
      inputDigestPresent: typeof manifest.inputDigest === "string" && manifest.inputDigest.trim().length > 0,
      manifestDigest: String(manifest.manifestDigest || ""),
      inputDigest: String(manifest.inputDigest || ""),
      fileCount: Number(manifest.fileCount || files.length || 0),
      totalBytes: Number(manifest.totalBytes || 0),
      fileRecordCount: Array.isArray(manifest.fileRecords) ? manifest.fileRecords.length : 0
    },
    files: files.map((file, index) => ({
      index,
      nameHash: hashForTrace(file?.name, "file_name"),
      relativePathHash: hashForTrace(file?.relativePath, "file_relative_path"),
      mediaTypeHash: hashForTrace(file?.mediaType, "file_media_type"),
      sha256: String(file?.sha256 || ""),
      byteSize: Number(file?.byteSize || 0)
    })),
    redaction: {
      rawFileNames: "not_logged",
      rawRelativePaths: "not_logged",
      fileBytes: "not_logged"
    }
  };
}

function createUploadTracePublisher(protocolEventBus, requestId, base = {}) {
  return async function traceUpload(event = {}) {
    await publishProtocolEvent(
      protocolEventBus,
      "uploads.trace",
      {
        traceVersion: 1,
        requestId,
        level: event.level || "info",
        scope: event.scope || "upload-session",
        layer: event.layer || "controller",
        functionName: event.functionName || "",
        stage: event.stage || "",
        message: event.message || "",
        ...base,
        ...event,
        requestId,
        redaction: {
          rawFileNames: "not_logged",
          rawRelativePaths: "not_logged",
          fileBytes: "not_logged",
          ...(event.redaction || {})
        }
      },
      {
        type: `uploads.trace.${event.stage || "event"}`,
        retain: false
      }
    );
  };
}

function requireUploadSessionStore(provider = null) {
  const required = [
    "appendUploadSessionChunk",
    "buildCheckpointReceiptFromUploadSession",
    "createOrResumeUploadSession",
    "getUploadSession"
  ];
  const missing = required.filter((name) => typeof provider?.[name] !== "function");
  if (missing.length > 0) {
    throw new Error(`uploadSessionStore provider is not configured: ${missing.join(", ")}`);
  }
  return provider;
}

function requireStorageProvider(provider = null) {
  const required = ["readRawObjectById"];
  const missing = required.filter((name) => typeof provider?.[name] !== "function");
  if (missing.length > 0) {
    throw new Error(`storageProvider is not configured: ${missing.join(", ")}`);
  }
  return provider;
}

function requireJobWorkflowProvider(provider = null) {
  const required = [
    "createJob",
    "getJob",
    "getJobByCheckpointId",
    "getJobResult",
    "listJobs",
    "reparseJob"
  ];
  const missing = required.filter((name) => typeof provider?.[name] !== "function");
  if (missing.length > 0) {
    throw new Error(`jobWorkflowProvider is not configured: ${missing.join(", ")}`);
  }
  return provider;
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function authSubjectFromSession(authSession = null) {
  const user = authSession?.user || {};
  const scopes = [
    ...arrayOfStrings(user.scopes),
    ...arrayOfStrings(authSession?.scopes)
  ];
  return {
    present: Boolean(authSession && (user.userId || user.subjectId || user.username || user.roleId || scopes.length > 0)),
    subjectId: String(user.userId || user.subjectId || user.username || "").trim(),
    userId: String(user.userId || "").trim(),
    username: String(user.username || "").trim(),
    roleId: String(user.roleId || user.role || "").trim(),
    tenantId: String(user.tenantId || "").trim(),
    scopes,
    allowedWorkspaceIds: arrayOfStrings(user.allowedWorkspaceIds || user.workspaceIds),
    allowedJobIds: arrayOfStrings(user.allowedJobIds || user.jobIds)
  };
}

function canAccessAllJobs(subject = {}) {
  return (
    subject.roleId === "owner" ||
    subject.roleId === "admin" ||
    subject.scopes?.includes?.("auth:admin") ||
    subject.scopes?.includes?.("jobs:admin")
  );
}

function jobOwnerIds(job = {}) {
  const owner = job.owner || {};
  return [
    job.ownerSubjectId,
    job.ownerUserId,
    job.ownerUsername,
    job.createdBySubjectId,
    job.createdByUserId,
    job.createdBy,
    owner.subjectId,
    owner.userId,
    owner.username
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function jobWorkspaceId(job = {}) {
  return String(job.workspaceId || job.workspace_id || job.workspace || job.payload?.workspaceId || "").trim();
}

function canAccessJob(job = null, authSession = null) {
  if (!job) {
    return false;
  }
  const subject = authSubjectFromSession(authSession);
  if (!subject.present) {
    return true;
  }
  if (canAccessAllJobs(subject)) {
    return true;
  }
  if (subject.allowedJobIds.includes(String(job.id || ""))) {
    return true;
  }
  const workspaceId = jobWorkspaceId(job);
  if (workspaceId && subject.allowedWorkspaceIds.includes(workspaceId)) {
    return true;
  }
  const ownerIds = jobOwnerIds(job);
  if (ownerIds.length === 0) {
    return false;
  }
  const callerIds = [subject.subjectId, subject.userId, subject.username].filter(Boolean);
  return callerIds.some((callerId) => ownerIds.includes(callerId));
}

function sendForbiddenJob(response) {
  sendJson(response, 403, {
    error: "任务不存在或不可访问。"
  });
}

function filterJobsForCaller(payload = {}, authSession = null) {
  if (Array.isArray(payload)) {
    return payload.filter((job) => canAccessJob(job, authSession));
  }
  const items = Array.isArray(payload.items)
    ? payload.items.filter((job) => canAccessJob(job, authSession))
    : [];
  return {
    ...payload,
    items,
    summary: {
      ...(payload.summary || {}),
      totalCount: items.length,
      queuedCount: items.filter((job) => job.status === "queued").length,
      runningCount: items.filter((job) => job.status === "running").length,
      completedCount: items.filter((job) => job.status === "completed").length,
      failedCount: items.filter((job) => job.status === "failed").length,
      activeJobIds: arrayOfStrings(payload.summary?.activeJobIds).filter((jobId) =>
        items.some((job) => String(job.id || "") === jobId)
      ),
      activeJobId: items.some((job) => String(job.id || "") === payload.summary?.activeJobId)
        ? payload.summary.activeJobId
        : ""
    }
  };
}

function rawObjectOwnerIds(rawObjectEntry = {}) {
  const rawObject = rawObjectEntry.rawObject || {};
  return [
    rawObject.owner_subject_id,
    rawObject.ownerSubjectId,
    rawObject.owner_user_id,
    rawObject.ownerUserId,
    rawObject.owner_username,
    rawObject.ownerUsername
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function rawObjectJobId(rawObjectEntry = {}) {
  const rawObject = rawObjectEntry.rawObject || {};
  return String(rawObject.job_id || rawObject.jobId || "").trim();
}

async function canAccessRawObjectEntry(rawObjectEntry = {}, authSession = null, jobWorkflow = null) {
  const subject = authSubjectFromSession(authSession);
  if (!subject.present) {
    return true;
  }
  if (canAccessAllJobs(subject)) {
    return true;
  }
  const rawOwnerIds = rawObjectOwnerIds(rawObjectEntry);
  const callerIds = [subject.subjectId, subject.userId, subject.username].filter(Boolean);
  const rawOwnerMatches = rawOwnerIds.length > 0
    ? callerIds.some((callerId) => rawOwnerIds.includes(callerId))
    : null;
  if (rawOwnerIds.length > 0) {
    if (!rawObjectJobId(rawObjectEntry)) {
      return rawOwnerMatches === true;
    }
  }
  const rawJobId = rawObjectJobId(rawObjectEntry);
  if (rawJobId) {
    let jobAccess = false;
    if (subject.allowedJobIds.includes(rawJobId)) {
      jobAccess = true;
    } else if (jobWorkflow && typeof jobWorkflow.getJob === "function") {
      jobAccess = canAccessJob(await jobWorkflow.getJob(rawJobId), authSession);
    }
    return rawOwnerMatches === null ? jobAccess : rawOwnerMatches === true && jobAccess === true;
  }
  return false;
}

function bufferStartsWith(buffer, bytes) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function looksLikeText(buffer) {
  if (!buffer || buffer.length === 0) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length < 0.02;
}

function inferZipExtension(buffer) {
  try {
    const names = Object.keys(unzipSync(new Uint8Array(buffer))).join("\n");
    if (names.includes("ppt/")) {
      return ".pptx";
    }
    if (names.includes("word/")) {
      return ".docx";
    }
    if (names.includes("xl/")) {
      return ".xlsx";
    }
  } catch {
    const names = buffer.toString("latin1");
    if (names.includes("ppt/")) {
      return ".pptx";
    }
    if (names.includes("word/")) {
      return ".docx";
    }
    if (names.includes("xl/")) {
      return ".xlsx";
    }
  }
  return ".zip";
}

function inferUploadedExtension(buffer) {
  if (bufferStartsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return ".pdf";
  }
  if (bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) {
    return ".png";
  }
  if (bufferStartsWith(buffer, [0xff, 0xd8, 0xff])) {
    return ".jpg";
  }
  if (bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38])) {
    return ".gif";
  }
  if (bufferStartsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    return inferZipExtension(buffer);
  }
  if (looksLikeText(buffer)) {
    const text = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf8");
    if (/^(from|subject|date|message-id|mime-version|content-type):/im.test(text)) {
      return ".eml";
    }
    if (/^\s*(<!doctype\s+html|<html|<head|<body)\b/i.test(text)) {
      return ".html";
    }
    if (/^\s*(def|class|import|from)\s+[A-Za-z_]/m.test(text)) {
      return ".py";
    }
    return ".txt";
  }
  return "";
}

function defaultArchiveBatchResolver(input = {}) {
  return {
    archiveBatchId: String(input.archiveBatchId || input.clientBatchId || input.batchId || input.checkpointId || input.manifestDigest || "").trim()
  };
}

function verifyUploadedFiles(payload = {}, { resolveArchiveBatchIdentity = defaultArchiveBatchResolver } = {}) {
  const uploadedFiles = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];
  const clientUid = String(payload?.clientUid || payload?.clientId || payload?.checkpoint?.clientUid || payload?.checkpoint?.clientId || "").trim();
  const sourceType = String(payload?.sourceType || payload?.resourceType || payload?.checkpoint?.sourceType || payload?.checkpoint?.resourceType || "upload").trim();
  const providerId = String(payload?.providerId || payload?.checkpoint?.providerId || "").trim();
  const externalId = String(payload?.externalId || payload?.checkpoint?.externalId || "").trim();
  const syncBatchId = String(payload?.syncBatchId || payload?.checkpoint?.syncBatchId || "").trim();
  const contentHash = String(payload?.contentHash || payload?.checkpoint?.contentHash || "").trim();
  const capturedAt = String(payload?.capturedAt || payload?.checkpoint?.capturedAt || "").trim();
  const verifiedFiles = uploadedFiles.map((file, index) => {
    const dataBase64 = String(file?.dataBase64 || "");
    const buffer = Buffer.from(dataBase64, "base64");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const byteSize = buffer.length;
    const claimedSha256 = String(file?.sha256 || "").trim().toLowerCase();
    const claimedByteSize = Number(file?.byteSize || 0);

    if (claimedSha256 && claimedSha256 !== sha256) {
      throw new Error(`文件哈希校验失败：文件#${index + 1}`);
    }

    if (claimedByteSize > 0 && claimedByteSize !== byteSize) {
      throw new Error(`文件大小校验失败：文件#${index + 1}`);
    }

    const sourceName = String(file?.name || "");
    const sourceRelativePath = String(file?.relativePath || sourceName || `upload-${index + 1}`);
    const originalFileName = path.posix.basename(sourceRelativePath || sourceName || `upload-${index + 1}`);
    const sourceNameHash = hashClientString(sourceName, "pact_upload.name");
    const sourceRelativePathHash = hashClientString(sourceRelativePath, "pact_upload.relative_path");
    const extension = inferUploadedExtension(buffer);
    const fileToken = serverToken(
      "upload_file",
      "pact",
      index,
      sourceRelativePathHash,
      sha256,
      byteSize
    );
    const safeTokenName = `${fileToken}${extension}`;
    return {
      name: safeTokenName,
      relativePath: safeTokenName,
      originalFileName,
      clientUid: String(file?.clientUid || file?.clientId || clientUid || "").trim(),
      sourceType: String(file?.sourceType || file?.resourceType || sourceType || "upload").trim(),
      providerId: String(file?.providerId || providerId || "").trim(),
      externalId: String(file?.externalId || externalId || "").trim(),
      syncBatchId: String(file?.syncBatchId || syncBatchId || "").trim(),
      contentHash: String(file?.contentHash || contentHash || sha256 || "").trim(),
      capturedAt: String(file?.capturedAt || capturedAt || "").trim(),
      sourceMetadata:
        file?.sourceMetadata && typeof file.sourceMetadata === "object" && !Array.isArray(file.sourceMetadata)
          ? file.sourceMetadata
          : {},
      mediaType: "application/octet-stream",
      clientMediaTypeHash: hashClientString(file?.mediaType || "", "pact_upload.media_type"),
      sourceNameHash,
      sourceRelativePathHash,
      sha256,
      byteSize,
      dataBase64
    };
  });

  const manifestHash = createHash("sha256")
    .update(
      JSON.stringify(
        verifiedFiles.map((file) => [file.relativePath, file.sha256, file.byteSize])
      )
    )
    .digest("hex");
  const clientCheckpointId =
    typeof payload?.checkpoint?.checkpointId === "string"
      ? payload.checkpoint.checkpointId.trim()
      : typeof payload?.checkpointId === "string"
        ? payload.checkpointId.trim()
        : "";
  const checkpointId = serverToken("checkpoint", clientCheckpointId || manifestHash, manifestHash);
  const archiveBatch = resolveArchiveBatchIdentity({
    archiveBatchId: payload?.archiveBatchId || payload?.checkpoint?.archiveBatchId,
    batchId: payload?.batchId || payload?.checkpoint?.batchId,
    clientBatchId: payload?.clientBatchId || payload?.checkpoint?.clientBatchId,
    checkpointId: clientCheckpointId || checkpointId,
    manifestDigest: manifestHash
  });
  const receiptFiles = verifiedFiles.map((file) => ({
    name: file.name,
    relativePath: file.relativePath,
    originalFileName: file.originalFileName,
    clientUid: file.clientUid,
    sourceType: file.sourceType,
    providerId: file.providerId,
    externalId: file.externalId,
    syncBatchId: file.syncBatchId,
    contentHash: file.contentHash,
    capturedAt: file.capturedAt,
    sourceMetadata: file.sourceMetadata || {},
    sourceNameHash: file.sourceNameHash,
    sourceRelativePathHash: file.sourceRelativePathHash,
    sha256: file.sha256,
    byteSize: file.byteSize
  }));

  return {
    receipt: {
      checkpointId,
      archiveBatchId: archiveBatch.archiveBatchId,
      clientUid,
      sourceType,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      verifiedAt: new Date().toISOString(),
      manifestSha256: manifestHash,
      fileCount: verifiedFiles.length,
      files: receiptFiles
    },
    uploadedFiles: verifiedFiles
  };
}

export function createJobsController({
  userDataPath,
  jobWorkflowProvider = null,
  storageProvider = null,
  deletionCoordinator,
  getDiscoveryState,
  proxyApiRequest,
  protocolEventBus,
  loadNormalizedDocumentStore = null,
  uploadSessionStore = null,
  resolveArchiveBatchIdentity = defaultArchiveBatchResolver
}) {
  const checkpointUploadSessionStore = requireUploadSessionStore(uploadSessionStore);
  const jobWorkflow = requireJobWorkflowProvider(jobWorkflowProvider);
  const jobStorageProvider = requireStorageProvider(storageProvider);
  const loadNormalizedDocumentStoreRuntime =
    typeof loadNormalizedDocumentStore === "function"
      ? loadNormalizedDocumentStore
      : async () => {
          const error = new Error("Normalized document store provider is not configured.");
          error.code = "ENOENT";
          throw error;
        };

  return {
    async handleCreateUploadSession({ requestBody, response }) {
      const requestId = randomUUID();
      const trace = createUploadTracePublisher(protocolEventBus, requestId, {
        http: {
          method: "POST",
          path: "/api/upload-sessions"
        }
      });
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      await trace({
        functionName: "handleCreateUploadSession",
        stage: "request_received",
        message: "收到创建或恢复上传会话请求。",
        request: summarizeUploadSessionPayload(payload, requestBody.length)
      });
      try {
        const session = await checkpointUploadSessionStore.createOrResumeUploadSession({
          userDataPath,
          checkpoint: payload?.checkpoint || {},
          manifest: payload?.manifest || {},
          files: Array.isArray(payload?.files) ? payload.files : [],
          trace
        });
        await publishProtocolEvent(
          protocolEventBus,
          "uploads.session",
          { session },
          { type: "uploads.session.upserted" }
        );
        await trace({
          functionName: "handleCreateUploadSession",
          stage: "response_sent",
          message: "上传会话请求已成功响应。",
          http: {
            method: "POST",
            path: "/api/upload-sessions",
            status: 200
          },
          session: summarizeUploadSessionForTrace(session)
        });
        sendJson(response, 200, session);
      } catch (error) {
        await trace({
          functionName: "handleCreateUploadSession",
          stage: "failed",
          level: "error",
          message: "创建或恢复上传会话失败。",
          http: {
            method: "POST",
            path: "/api/upload-sessions",
            status: 500
          },
          error: String(error?.message || error)
        });
        throw error;
      }
    },
    async handleGetUploadSession({ sessionId, response }) {
      const requestId = randomUUID();
      const trace = createUploadTracePublisher(protocolEventBus, requestId, {
        http: {
          method: "GET",
          path: `/api/upload-sessions/${sessionId}`
        },
        sessionId
      });
      await trace({
        functionName: "handleGetUploadSession",
        stage: "request_received",
        message: "收到上传会话查询请求。"
      });
      const session = await checkpointUploadSessionStore.getUploadSession(userDataPath, sessionId);
      if (!session) {
        await trace({
          functionName: "handleGetUploadSession",
          stage: "not_found",
          level: "warning",
          message: "上传会话查询未命中。",
          http: {
            method: "GET",
            path: `/api/upload-sessions/${sessionId}`,
            status: 404
          }
        });
        sendJson(response, 404, {
          error: "上传会话不存在。"
        });
        return;
      }

      await trace({
        functionName: "handleGetUploadSession",
        stage: "response_sent",
        message: "上传会话查询已成功响应。",
        http: {
          method: "GET",
          path: `/api/upload-sessions/${sessionId}`,
          status: 200
        },
        session: summarizeUploadSessionForTrace(session)
      });
      sendJson(response, 200, session);
    },
    async handleUploadChunk({ sessionId, fileIndex, offset, requestBody, response }) {
      const requestId = randomUUID();
      const trace = createUploadTracePublisher(protocolEventBus, requestId, {
        http: {
          method: "PUT",
          path: `/api/upload-sessions/${sessionId}/files/${fileIndex}`
        },
        sessionId,
        fileIndex: Number(fileIndex),
        offset: Number(offset || 0)
      });
      await trace({
        functionName: "handleUploadChunk",
        stage: "request_received",
        message: "收到上传分块请求。",
        chunkBytes: requestBody.length,
        request: {
          queryOffset: Number(offset || 0),
          fileIndex: Number(fileIndex),
          bodyBytes: requestBody.length,
          contentType: "application/octet-stream"
        }
      });
      const appendResult = await checkpointUploadSessionStore.appendUploadSessionChunk({
        userDataPath,
        sessionId,
        fileIndex,
        offset,
        buffer: requestBody,
        trace
      });

      if (!appendResult.ok) {
        const statusCode =
          appendResult.code === "not_found"
            ? 404
            : appendResult.code === "offset_mismatch" ||
                appendResult.code === "chunk_too_large" ||
                appendResult.code === "sha256_mismatch"
              ? 409
              : 400;
        await trace({
          functionName: "handleUploadChunk",
          stage: "response_failed",
          level: appendResult.code === "offset_mismatch" ? "warning" : "error",
          message: "上传分块请求返回失败响应。",
          code: appendResult.code,
          expectedOffset: appendResult.expectedOffset ?? 0,
          http: {
            method: "PUT",
            path: `/api/upload-sessions/${sessionId}/files/${fileIndex}`,
            status: statusCode
          },
          session: summarizeUploadSessionForTrace(appendResult.session)
        });
        sendJson(response, statusCode, {
          code: appendResult.code,
          error:
            appendResult.code === "offset_mismatch"
              ? "上传偏移不匹配。"
              : appendResult.code === "chunk_too_large"
                ? "上传分块超过剩余文件大小。"
                : appendResult.code === "sha256_mismatch"
                  ? "上传文件哈希校验失败，已重置该文件上传进度。"
                  : appendResult.code === "file_not_found"
                    ? "上传文件索引不存在。"
                    : "上传会话不存在。",
          expectedOffset: appendResult.expectedOffset ?? 0,
          session: appendResult.session
        });
        return;
      }

      await publishProtocolEvent(
        protocolEventBus,
        "uploads.session",
        { session: appendResult.session },
        { type: "uploads.session.chunk.accepted" }
      );
      await trace({
        functionName: "handleUploadChunk",
        stage: "response_sent",
        message: "上传分块请求已成功响应。",
        http: {
          method: "PUT",
          path: `/api/upload-sessions/${sessionId}/files/${fileIndex}`,
          status: 200
        },
        session: summarizeUploadSessionForTrace(appendResult.session)
      });
      sendJson(response, 200, appendResult.session);
    },
    async handleCreateJob({ request, requestBody, response, authSession }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      const ownerSubject = authSubjectFromSession(authSession);
      const forceNewVersion = Boolean(
        payload?.forceNewVersion ||
          payload?.reparse ||
          payload?.createNewVersion ||
          payload?.reparseFromJobId
      );
      const uploadTrace = payload?.uploadSessionId
        ? createUploadTracePublisher(protocolEventBus, randomUUID(), {
            http: {
              method: "POST",
              path: "/api/jobs"
            },
            sessionId: String(payload.uploadSessionId || "")
          })
        : null;
      if (uploadTrace) {
        await uploadTrace({
          functionName: "handleCreateJob",
          stage: "request_received",
          message: "收到基于 upload session 创建任务的请求。",
          request: {
            uploadSessionId: String(payload.uploadSessionId || ""),
            checkpointPresent: Boolean(payload?.checkpoint?.checkpointId),
            uploadedFilesCount: Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles.length : 0,
            filePathsCount: Array.isArray(payload.filePaths) ? payload.filePaths.length : 0,
            inputTextBytes: Buffer.byteLength(String(payload.inputText || ""), "utf8")
          }
        });
      }
      const discoveryState = getDiscoveryState();
      const shouldForwardJobCreate =
        discoveryState.mode === "forward" &&
        discoveryState.forwardBaseUrl &&
        discoveryState.forwardBaseUrl !== discoveryState.advertisedBaseUrl &&
        !payload?.uploadSessionId;

      if (shouldForwardJobCreate) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState
        });
        return;
      }

      let verifiedUpload;
      if (payload?.uploadSessionId) {
        if (uploadTrace) {
          await uploadTrace({
            functionName: "buildCheckpointReceiptFromUploadSession",
            stage: "start",
            message: "开始把 upload session 转换为 checkpoint receipt。"
          });
        }
        try {
          verifiedUpload = {
            receipt: await checkpointUploadSessionStore.buildCheckpointReceiptFromUploadSession(
              userDataPath,
              payload.uploadSessionId
            ),
            uploadedFiles: []
          };
        } catch (error) {
          if (uploadTrace) {
            await uploadTrace({
              functionName: "buildCheckpointReceiptFromUploadSession",
              stage: "failed",
              level: "error",
              message: "upload session 转换 checkpoint receipt 失败。",
              error: String(error?.message || error)
            });
          }
          throw error;
        }
        if (uploadTrace) {
          await uploadTrace({
            functionName: "buildCheckpointReceiptFromUploadSession",
            stage: "completed",
            message: "upload session 已转换为 checkpoint receipt。",
            checkpointId: verifiedUpload.receipt.checkpointId,
            manifestSha256: verifiedUpload.receipt.manifestSha256,
            fileCount: verifiedUpload.receipt.fileCount
          });
        }
      } else {
        verifiedUpload = verifyUploadedFiles(payload, { resolveArchiveBatchIdentity });
      }
      const checkpointReceipt = verifiedUpload.receipt;
      const existingCheckpointJob = await jobWorkflow.getJobByCheckpointId(checkpointReceipt.checkpointId);
      if (!forceNewVersion && existingCheckpointJob) {
        if (!canAccessJob(existingCheckpointJob, authSession)) {
          payload.forceNewVersion = true;
          payload.createNewVersion = true;
        } else {
          await publishProtocolEvent(
            protocolEventBus,
            "jobs.job",
            { job: existingCheckpointJob },
            { type: "jobs.job.reused" }
          );
          if (uploadTrace) {
            await uploadTrace({
              functionName: "handleCreateJob",
              stage: "job_reused",
              message: "checkpoint 已存在任务，复用原任务。",
              checkpointId: checkpointReceipt.checkpointId,
              jobId: existingCheckpointJob.id,
              status: existingCheckpointJob.status
            });
          }
          sendJson(response, 202, existingCheckpointJob);
          return;
        }
      }

      const jobPayload = {
        ...payload,
        ownerSubjectId: ownerSubject.subjectId,
        ownerUserId: ownerSubject.userId || ownerSubject.subjectId,
        ownerUsername: ownerSubject.username,
        ownerRoleId: ownerSubject.roleId,
        ownerTenantId: ownerSubject.tenantId,
        workspaceId: String(payload.workspaceId || payload.workspace || "").trim(),
        checkpoint: {
          checkpointId: checkpointReceipt.checkpointId,
          archiveBatchId: checkpointReceipt.archiveBatchId || "",
          clientUid: checkpointReceipt.clientUid || "",
          sourceType: checkpointReceipt.sourceType || "",
          providerId: checkpointReceipt.providerId || "",
          externalId: checkpointReceipt.externalId || "",
          syncBatchId: checkpointReceipt.syncBatchId || "",
          contentHash: checkpointReceipt.contentHash || "",
          capturedAt: checkpointReceipt.capturedAt || "",
          modeHash: hashClientString(payload?.checkpoint?.mode || "", "checkpoint.mode")
        },
        checkpointId: checkpointReceipt.checkpointId,
        archiveBatchId: checkpointReceipt.archiveBatchId || "",
        clientUid: checkpointReceipt.clientUid || "",
        sourceType: checkpointReceipt.sourceType || "",
        providerId: checkpointReceipt.providerId || "",
        externalId: checkpointReceipt.externalId || "",
        syncBatchId: checkpointReceipt.syncBatchId || "",
        contentHash: checkpointReceipt.contentHash || "",
        capturedAt: checkpointReceipt.capturedAt || "",
        filePaths: [],
        uploadedFiles: verifiedUpload.uploadedFiles,
        settings: payload.settings || {},
        checkpointReceipt
      };
      const job = await jobWorkflow.createJob(jobPayload);
      if (uploadTrace) {
        await uploadTrace({
          functionName: "handleCreateJob",
          stage: "job_created",
          message: "已创建上传解析任务。",
          checkpointId: checkpointReceipt.checkpointId,
          jobId: job.id,
          status: job.status
        });
      }

      sendJson(response, 202, job);
    },
    async handleListJobs({ limit, response, authSession }) {
      sendJson(response, 200, filterJobsForCaller(await jobWorkflow.listJobs({ limit }), authSession));
    },
    async handleInspectWorkQueue({ limit, response }) {
      if (typeof jobWorkflow.inspectWorkQueue !== "function") {
        sendJson(response, 200, {
          ok: true,
          enabled: false,
          reason: "work_queue_provider_unavailable"
        });
        return;
      }
      const inspected = await jobWorkflow.inspectWorkQueue({ limit: Number(limit || 100) });
      const description = typeof jobWorkflow.describe === "function" ? jobWorkflow.describe() : {};
      sendJson(response, 200, {
        ok: true,
        enabled: true,
        description,
        ...inspected
      });
    },
    async handlePauseWorkQueue({ requestBody, response }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      if (typeof jobWorkflow.pauseWorkQueue !== "function") {
        sendJson(response, 409, { ok: false, error: "work queue provider is not available." });
        return;
      }
      sendJson(response, 200, await jobWorkflow.pauseWorkQueue({
        reason: payload.reason || "operator_pause",
        actor: payload.actor || { source: "jobs-controller" }
      }));
    },
    async handleResumeWorkQueue({ requestBody, response }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      if (typeof jobWorkflow.resumeWorkQueue !== "function") {
        sendJson(response, 409, { ok: false, error: "work queue provider is not available." });
        return;
      }
      sendJson(response, 200, await jobWorkflow.resumeWorkQueue({
        reason: payload.reason || "operator_resume",
        actor: payload.actor || { source: "jobs-controller" }
      }));
    },
    async handleDrainWorkQueue({ requestBody, response }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      if (typeof jobWorkflow.drainWorkQueue !== "function") {
        sendJson(response, 409, { ok: false, error: "work queue provider is not available." });
        return;
      }
      sendJson(response, 200, await jobWorkflow.drainWorkQueue({
        reason: payload.reason || "operator_drain",
        actor: payload.actor || { source: "jobs-controller" }
      }));
    },
    async handleDispatchWorkQueue({ response }) {
      if (typeof jobWorkflow.dispatchWorkQueue !== "function") {
        sendJson(response, 409, { ok: false, error: "work queue provider is not available." });
        return;
      }
      sendJson(response, 200, await jobWorkflow.dispatchWorkQueue());
    },
    async handleRetryDeadLetterWorkQueue({ requestBody, response }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      if (typeof jobWorkflow.retryDeadLetterWorkQueue !== "function") {
        sendJson(response, 409, { ok: false, error: "work queue provider is not available." });
        return;
      }
      sendJson(response, 200, await jobWorkflow.retryDeadLetterWorkQueue({
        limit: payload.limit || 100,
        workItemId: payload.workItemId || payload.itemId || "",
        reason: payload.reason || "operator_retry_dead_letter",
        actor: payload.actor || { source: "jobs-controller" }
      }));
    },
    async handleRebuildWorkQueue({ requestBody, response }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      if (typeof jobWorkflow.rebuildWorkQueueProof !== "function") {
        sendJson(response, 409, { ok: false, error: "work queue provider is not available." });
        return;
      }
      sendJson(response, 200, await jobWorkflow.rebuildWorkQueueProof({
        reason: payload.reason || "operator_rebuild_projection",
        actor: payload.actor || { source: "jobs-controller" }
      }));
    },
    async handleGetJob({ request, requestBody, jobId, response, authSession }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
        if (!canAccessJob(job, authSession)) {
          sendForbiddenJob(response);
          return;
        }
        sendJson(response, 200, job);
        return;
      }

      const discoveryState = getDiscoveryState();
      if (
        discoveryState.mode === "forward" &&
        discoveryState.forwardBaseUrl &&
        discoveryState.forwardBaseUrl !== discoveryState.advertisedBaseUrl
      ) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState
        });
        return;
      }

      sendJson(response, 404, {
        error: "任务不存在。"
      });
    },
    async handleReparseJob({ request, requestBody, jobId, response, authSession }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
      const discoveryState = getDiscoveryState();
      if (
        discoveryState.mode === "forward" &&
        discoveryState.forwardBaseUrl &&
        discoveryState.forwardBaseUrl !== discoveryState.advertisedBaseUrl
      ) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState
        });
        return;
      }

      const sourceJob = await jobWorkflow.getJob(jobId);
      if (sourceJob && !canAccessJob(sourceJob, authSession)) {
        sendForbiddenJob(response);
        return;
      }
      const ownerSubject = authSubjectFromSession(authSession);
      const reparseOptions = {
        documentParsing: payload?.documentParsing,
        settings: payload?.settings
      };
      if (ownerSubject.present) {
        reparseOptions.ownerSubjectId = ownerSubject.subjectId;
        reparseOptions.ownerUserId = ownerSubject.userId;
        reparseOptions.ownerUsername = ownerSubject.username;
        reparseOptions.ownerRoleId = ownerSubject.roleId;
        reparseOptions.ownerTenantId = ownerSubject.tenantId;
      }
      const job = await jobWorkflow.reparseJob(jobId, reparseOptions);
      await publishProtocolEvent(
        protocolEventBus,
        "jobs.job",
        { job, parentJobId: jobId },
        { type: "jobs.job.reparse.created" }
      );
      sendJson(response, 202, job);
    },
    async handleDeleteJob({ request, requestBody, jobId, response, authSession }) {
      const job = await jobWorkflow.getJob(jobId);
      if (job && !canAccessJob(job, authSession)) {
        sendForbiddenJob(response);
        return;
      }
      const deletionResult = await deletionCoordinator.deleteBatch(jobId);

      if (deletionResult?.ok) {
        await publishProtocolEvent(
          protocolEventBus,
          "jobs.deleted",
          deletionResult,
          { type: "jobs.deleted" }
        );
        sendJson(response, 200, deletionResult);
        return;
      }

      const discoveryState = getDiscoveryState();
      if (
        discoveryState.mode === "forward" &&
        discoveryState.forwardBaseUrl &&
        discoveryState.forwardBaseUrl !== discoveryState.advertisedBaseUrl
      ) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState
        });
        return;
      }

      sendJson(response, 404, {
        error: "任务不存在。"
      });
    },
    async handleGetJobResult({ request, requestBody, jobId, response, authSession }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
        if (!canAccessJob(job, authSession)) {
          sendForbiddenJob(response);
          return;
        }
        if (job.status !== "completed") {
          sendJson(response, 409, {
            error: "任务尚未完成。"
          });
          return;
        }

        const result = await jobWorkflow.getJobResult(jobId);
        sendJson(response, 200, result);
        return;
      }

      const discoveryState = getDiscoveryState();
      if (
        discoveryState.mode === "forward" &&
        discoveryState.forwardBaseUrl &&
        discoveryState.forwardBaseUrl !== discoveryState.advertisedBaseUrl
      ) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState
        });
        return;
      }

      sendJson(response, 404, {
        error: "任务不存在。"
      });
    },
    async handleListNormalizedDocuments({ request, requestBody, jobId, response, authSession }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
        if (!canAccessJob(job, authSession)) {
          sendForbiddenJob(response);
          return;
        }
        if (job.status !== "completed") {
          sendJson(response, 409, {
            error: "任务尚未完成。"
          });
          return;
        }

        try {
          const { loadNormalizedDocumentsManifest } = await loadNormalizedDocumentStoreRuntime();
          sendJson(response, 200, await loadNormalizedDocumentsManifest(userDataPath, jobId));
        } catch (error) {
          if (error?.code === "ENOENT") {
            sendJson(response, 404, {
              error: "归一化文档清单不存在。"
            });
            return;
          }
          throw error;
        }
        return;
      }

      const discoveryState = getDiscoveryState();
      if (
        discoveryState.mode === "forward" &&
        discoveryState.forwardBaseUrl &&
        discoveryState.forwardBaseUrl !== discoveryState.advertisedBaseUrl
      ) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState
        });
        return;
      }

      sendJson(response, 404, {
        error: "任务不存在。"
      });
    },
    async handleGetNormalizedDocument({ request, requestBody, jobId, documentId, response, authSession }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
        if (!canAccessJob(job, authSession)) {
          sendForbiddenJob(response);
          return;
        }
        if (job.status !== "completed") {
          sendJson(response, 409, {
            error: "任务尚未完成。"
          });
          return;
        }

        let manifest;
        try {
          const { loadNormalizedDocumentsManifest } = await loadNormalizedDocumentStoreRuntime();
          manifest = await loadNormalizedDocumentsManifest(userDataPath, jobId);
        } catch (error) {
          if (error?.code === "ENOENT") {
            sendJson(response, 404, {
              error: "归一化文档清单不存在。"
            });
            return;
          }
          throw error;
        }

        const {
          normalizedContentType,
          resolveNormalizedDocumentEntry,
          resolveNormalizedDocumentPath
        } = await loadNormalizedDocumentStoreRuntime();
        const entry = resolveNormalizedDocumentEntry(manifest, documentId);
        if (!entry) {
          sendJson(response, 404, {
            error: "归一化文档不存在。"
          });
          return;
        }

        const filePath = resolveNormalizedDocumentPath(userDataPath, jobId, entry);
        const buffer = await fs.readFile(filePath);
        response.writeHead(200, {
          "Content-Type": normalizedContentType(filePath),
          "Content-Disposition": contentDispositionHeader(
            "attachment",
            path.basename(entry.relativePath || entry.title || "normalized-document")
          ),
          "Cache-Control": "no-store"
        });
        response.end(buffer);
        return;
      }

      const discoveryState = getDiscoveryState();
      if (
        discoveryState.mode === "forward" &&
        discoveryState.forwardBaseUrl &&
        discoveryState.forwardBaseUrl !== discoveryState.advertisedBaseUrl
      ) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState
        });
        return;
      }

      sendJson(response, 404, {
        error: "任务不存在。"
      });
    },
    async handleGetRawObject({ objectId, response, authSession }) {
      const rawObjectEntry = await jobStorageProvider.readRawObjectById(objectId);

      if (!rawObjectEntry) {
        sendJson(response, 404, {
          error: "原始邮件不存在。"
        });
        return;
      }

      if (!(await canAccessRawObjectEntry(rawObjectEntry, authSession, jobWorkflow))) {
        sendJson(response, 403, {
          error: "原始邮件不存在或不可访问。"
        });
        return;
      }

      response.writeHead(200, {
        "Content-Type": rawObjectEntry.contentType || "application/octet-stream",
        "Content-Disposition": contentDispositionHeader("attachment", rawObjectEntry.fileName),
        "Cache-Control": "no-store"
      });
      response.end(rawObjectEntry.buffer);
    }
  };
}
