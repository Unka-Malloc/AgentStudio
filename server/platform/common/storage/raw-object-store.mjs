import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { hashClientString, resolveWithin } from "../security/client-strings.mjs";

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

function validateRelativePath(value) {
  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    throw new Error("原始邮件缺少可持久化的文件名。");
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("原始邮件路径不安全，已拒绝写入。");
  }

  return normalized;
}

export function getRawMailObjectRoot(userDataPath) {
  return path.join(userDataPath, "objects");
}

export function resolveStoredObjectPath(userDataPath, storageRelativePath) {
  return resolveWithin(userDataPath, storageRelativePath);
}

function normalizeArchiveSegment(value, fallback) {
  return String(value || fallback || "")
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || fallback;
}

function safeArchiveFileName(value) {
  const baseName = path.posix.basename(normalizeRelativePath(value));
  const cleaned = String(baseName || "source")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "source";
}

function safeArchiveBatchSuffix(value) {
  return String(value || "batch")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "_")
    .slice(0, 96) || "batch";
}

function archiveFileName({ originalRelativePath, batchId }) {
  const safeName = safeArchiveFileName(originalRelativePath);
  const extension = path.posix.extname(safeName);
  const base = extension ? safeName.slice(0, -extension.length) : safeName;
  return `${base}__${safeArchiveBatchSuffix(batchId)}${extension}`;
}

async function fileSha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function resolveArchiveTargetPath({ userDataPath, clientUid, sourceType, fileName, sha256 }) {
  const archiveDirectory = resolveWithin(
    userDataPath,
    "objects",
    normalizeArchiveSegment(clientUid, "unknown-client"),
    normalizeArchiveSegment(sourceType, "unknown-source")
  );
  let candidateName = fileName;
  let candidatePath = resolveWithin(archiveDirectory, candidateName);
  try {
    if ((await fileSha256(candidatePath)) === sha256) {
      return { archiveDirectory, archiveFileName: candidateName, targetPath: candidatePath };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return { archiveDirectory, archiveFileName: candidateName, targetPath: candidatePath };
  }

  const extension = path.posix.extname(fileName);
  const base = extension ? fileName.slice(0, -extension.length) : fileName;
  candidateName = `${base}__${sha256.slice(0, 12)}${extension}`;
  candidatePath = resolveWithin(archiveDirectory, candidateName);
  return { archiveDirectory, archiveFileName: candidateName, targetPath: candidatePath };
}

export async function persistRawMailObject({
	  userDataPath,
	  batchId,
	  jobId = "",
	  ownerSubjectId = "",
	  ownerUserId = "",
	  ownerUsername = "",
	  buffer,
  originalRelativePath,
  originalSourcePath = "",
  sourceContainerPath = "",
  mediaType = "message/rfc822",
  ingestOrigin = "filesystem",
  clientUid = "",
  sourceType = "",
  providerId = "",
  externalId = "",
  syncBatchId = "",
  contentHash = "",
  capturedAt = "",
  sourceMetadata = {},
  sourceCreatedAt = "",
  sourceUpdatedAt = "",
  sourceCollectedAt = ""
}) {
  const safeRelativePath = validateRelativePath(originalRelativePath);
  const objectId = randomUUID();
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const byteSize = buffer.length;
  const normalizedClientUid = normalizeArchiveSegment(clientUid, "unknown-client");
  const normalizedSourceType = normalizeArchiveSegment(sourceType || ingestOrigin, "unknown-source");
  const requestedArchiveFileName = archiveFileName({
    originalRelativePath: safeRelativePath,
    batchId
  });
  const {
    archiveDirectory,
    archiveFileName: resolvedArchiveFileName,
    targetPath
  } = await resolveArchiveTargetPath({
    userDataPath,
    clientUid: normalizedClientUid,
    sourceType: normalizedSourceType,
    fileName: requestedArchiveFileName,
    sha256
  });

  await fs.mkdir(archiveDirectory, { recursive: true });
  await fs.writeFile(targetPath, buffer);

  const createdAt = new Date().toISOString();
  const storageRelativePath = path
    .relative(userDataPath, targetPath)
    .split(path.sep)
    .join("/");
  const originalFileName = safeArchiveFileName(safeRelativePath);

  return {
	    objectId,
	    jobId: String(jobId || ""),
	    ownerSubjectId: String(ownerSubjectId || ownerUserId || ownerUsername || ""),
	    ownerUserId: String(ownerUserId || ownerSubjectId || ""),
	    ownerUsername: String(ownerUsername || ""),
	    ingestOrigin,
    clientUid: normalizedClientUid,
    sourceType: normalizedSourceType,
    archiveFileName: resolvedArchiveFileName,
    originalFileName,
    originalRelativePath: safeRelativePath,
    originalSourcePath: hashClientString(originalSourcePath || "", "raw_mail.source_path"),
    sourceContainerPath: hashClientString(sourceContainerPath || "", "raw_mail.container_path"),
    providerId: String(providerId || ""),
    externalId: String(externalId || ""),
    syncBatchId: String(syncBatchId || ""),
    contentHash: String(contentHash || sha256),
    capturedAt: String(capturedAt || sourceCollectedAt || ""),
    sourceMetadata:
      sourceMetadata && typeof sourceMetadata === "object" && !Array.isArray(sourceMetadata)
        ? sourceMetadata
        : {},
    storageRelativePath,
    mediaType: String(mediaType || "message/rfc822"),
    sha256,
    byteSize,
    sourceCreatedAt: String(sourceCreatedAt || ""),
    sourceUpdatedAt: String(sourceUpdatedAt || ""),
    sourceCollectedAt: String(sourceCollectedAt || ""),
    createdAt
  };
}
