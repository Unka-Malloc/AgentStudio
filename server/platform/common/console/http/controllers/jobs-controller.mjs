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
    async handleCreateJob({ request, requestBody, response }) {
      const payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
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

      const jobPayload = {
        ...payload,
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
    async handleListJobs({ limit, response }) {
      sendJson(response, 200, await jobWorkflow.listJobs({ limit }));
    },
    async handleGetJob({ request, requestBody, jobId, response }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
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
    async handleReparseJob({ request, requestBody, jobId, response }) {
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

      const job = await jobWorkflow.reparseJob(jobId, {
        documentParsing: payload?.documentParsing,
        settings: payload?.settings
      });
      await publishProtocolEvent(
        protocolEventBus,
        "jobs.job",
        { job, parentJobId: jobId },
        { type: "jobs.job.reparse.created" }
      );
      sendJson(response, 202, job);
    },
    async handleDeleteJob({ request, requestBody, jobId, response }) {
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
    async handleGetJobResult({ request, requestBody, jobId, response }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
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
    async handleListNormalizedDocuments({ request, requestBody, jobId, response }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
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
    async handleGetNormalizedDocument({ request, requestBody, jobId, documentId, response }) {
      const job = await jobWorkflow.getJob(jobId);

      if (job) {
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
    async handleGetRawObject({ objectId, response }) {
      const rawObjectEntry = await jobStorageProvider.readRawObjectById(objectId);

      if (!rawObjectEntry) {
        sendJson(response, 404, {
          error: "原始邮件不存在。"
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
