import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import {
  detectExtensionBySignature,
  getImportDefaultRoutingTable,
  importFileDescriptorForExtension,
  importFileDescriptorForMediaType,
  importFileDescriptorForPath,
  importPlainTextFallbackExtension,
  importReadableTextDetection,
  inferZipContainerExtension,
  isImportArchiveDescriptor,
  isImportFilePathSupported,
  isImportImageDescriptor,
  isImportTextDescriptor,
  mediaTypeForImportExtension,
  mediaTypeForImportPath,
  shouldIncludeUnknownReadableText,
  sniffTextExtension
} from "./import-file-types.mjs";
import { persistRawMailObject } from "../../../../common/storage/raw-object-store.mjs";
import {
  cleanupImportArtifacts,
  collectProtectedRawObjectPaths,
  createImportEntryId,
  hydrateImportCheckpointSources,
  loadImportCheckpointEntry,
  rawObjectPathsFromSources,
  saveImportCheckpointEntry,
  validateImportCheckpointEntry
} from "../../../../common/storage/import-resume-store.mjs";
import {
  assertExistingLocalDirectoryWithinControlledRoots,
  assertExistingLocalFileWithinControlledRoots
} from "../../../../common/security/local-path-boundary.mjs";

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function createThrottledImportProgressReporter(onProgress) {
  let lastReportedAt = 0;
  let lastKey = "";

  return ({
    stage,
    current = 0,
    total = 0,
    progressStart = 26,
    progressEnd = 54,
    force = false
  } = {}) => {
    if (typeof onProgress !== "function") {
      return;
    }

    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCurrent = Math.max(0, Math.min(safeTotal || Number(current) || 0, Number(current) || 0));
    const now = Date.now();
    const progressSpan = Math.max(0, progressEnd - progressStart);
    const ratio = safeTotal > 0 ? safeCurrent / safeTotal : 0;
    const progressPercent = Math.max(
      progressStart,
      Math.min(progressEnd, Math.round(progressStart + progressSpan * ratio))
    );
    const stageText = safeTotal > 0 ? `${stage} ${safeCurrent}/${safeTotal}` : stage;
    const key = `${stageText}:${progressPercent}`;

    if (!force && safeCurrent < safeTotal && now - lastReportedAt < 1000) {
      return;
    }

    if (key === lastKey) {
      return;
    }

    lastReportedAt = now;
    lastKey = key;
    onProgress({
      progressPercent,
      stage: stageText
    });
  };
}

function resolveImageMediaType(extension, mediaTypeHint) {
  if (mediaTypeHint?.startsWith("image/")) {
    return mediaTypeHint;
  }

  const descriptor = importFileDescriptorForExtension(extension);
  return isImportImageDescriptor(descriptor) ? descriptor.mediaType || "" : "";
}

function looksLikeText(buffer) {
  if (!buffer || buffer.length === 0) {
    return true;
  }
  const detection = importReadableTextDetection();
  const sample = buffer.subarray(0, Math.min(buffer.length, detection.sampleBytes));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length < detection.maxControlRatio;
}

const ARCHIVE_MAX_ENTRIES = 500;
const ARCHIVE_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const ARCHIVE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

function archiveLimitError(message, context = {}) {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return new Error(details ? `${message} (${details})` : message);
}

function archiveEntryByteSize(file = {}) {
  const originalSize = Number(file.originalSize);
  if (Number.isFinite(originalSize) && originalSize >= 0) {
    return originalSize;
  }
  const size = Number(file.size);
  return Number.isFinite(size) && size >= 0 ? size : 0;
}

function collectZipEntryNames(buffer) {
  const names = [];
  unzipSync(new Uint8Array(buffer), {
    filter(file) {
      const entryPath = normalizeArchiveEntryPath(file.name || "");
      if (entryPath) {
        names.push(entryPath);
      }
      return false;
    }
  });
  return names;
}

function unzipArchiveEntriesWithLimits(buffer, { label = "压缩包" } = {}) {
  let fileCount = 0;
  let declaredTotalBytes = 0;
  const acceptedNames = new Set();
  const entries = unzipSync(new Uint8Array(buffer), {
    filter(file) {
      const rawName = String(file.name || "");
      const entryPath = normalizeArchiveEntryPath(rawName);
      if (!entryPath || entryPath.endsWith("/")) {
        return false;
      }
      fileCount += 1;
      if (fileCount > ARCHIVE_MAX_ENTRIES) {
        throw archiveLimitError(`${label}条目数量超出上限。`, {
          entries: fileCount,
          maxEntries: ARCHIVE_MAX_ENTRIES
        });
      }
      const byteSize = archiveEntryByteSize(file);
      if (byteSize > ARCHIVE_MAX_ENTRY_BYTES) {
        throw archiveLimitError(`${label}条目过大，已停止展开。`, {
          entry: entryPath,
          bytes: byteSize,
          maxBytes: ARCHIVE_MAX_ENTRY_BYTES
        });
      }
      declaredTotalBytes += byteSize;
      if (declaredTotalBytes > ARCHIVE_MAX_TOTAL_BYTES) {
        throw archiveLimitError(`${label}展开后体积超出上限。`, {
          bytes: declaredTotalBytes,
          maxBytes: ARCHIVE_MAX_TOTAL_BYTES
        });
      }
      acceptedNames.add(entryPath);
      return true;
    }
  });
  let actualTotalBytes = 0;
  const normalizedEntries = {};
  for (const [rawEntryPath, entryBuffer] of Object.entries(entries)) {
    const entryPath = normalizeArchiveEntryPath(rawEntryPath);
    if (!entryPath || !acceptedNames.has(entryPath)) {
      continue;
    }
    actualTotalBytes += entryBuffer.byteLength || entryBuffer.length || 0;
    if (actualTotalBytes > ARCHIVE_MAX_TOTAL_BYTES) {
      throw archiveLimitError(`${label}实际展开体积超出上限。`, {
        bytes: actualTotalBytes,
        maxBytes: ARCHIVE_MAX_TOTAL_BYTES
      });
    }
    normalizedEntries[entryPath] = entryBuffer;
  }
  return normalizedEntries;
}

function inferZipDocumentExtension(buffer, fallbackExtension = "") {
  try {
    const entries = collectZipEntryNames(buffer);
    return inferZipContainerExtension(entries.join("\n")) || fallbackExtension;
  } catch {
    const haystack = buffer.toString("latin1");
    return inferZipContainerExtension(haystack) || fallbackExtension;
  }
}

function normalizeRoutingExtension(value = "") {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function routeFileNameWithExtension(fileName = "", extension = "") {
  const normalizedExtension = normalizeRoutingExtension(extension);
  const rawFileName = String(fileName || "").trim();
  if (!rawFileName || !normalizedExtension) {
    return rawFileName;
  }
  const currentExtension = path.extname(rawFileName).toLowerCase();
  if (currentExtension === normalizedExtension) {
    return rawFileName;
  }
  if (!currentExtension) {
    return `${rawFileName}${normalizedExtension}`;
  }
  return `${rawFileName.slice(0, -currentExtension.length)}${normalizedExtension}`;
}

function descriptorKind(descriptor, mediaType = "") {
  return String(descriptor?.kind || (String(mediaType || "").startsWith("text/") ? "text" : "")).trim();
}

function descriptorSupportsMediaType(descriptor, mediaType = "") {
  const normalizedMediaType = String(mediaType || "").trim().toLowerCase();
  if (!descriptor || !normalizedMediaType) {
    return false;
  }
  return (
    String(descriptor.mediaType || "").trim().toLowerCase() === normalizedMediaType ||
    asArray(descriptor.mediaTypes).some((entry) => String(entry || "").trim().toLowerCase() === normalizedMediaType)
  );
}

function createRoutingCandidate({
  extension = "",
  descriptor = null,
  mediaType = "",
  source = "",
  confidence = 0,
  fileName = ""
}) {
  const normalizedExtension = normalizeRoutingExtension(extension || descriptor?.extension || "");
  const normalizedMediaType = String(mediaType || "").trim().toLowerCase();
  const resolvedDescriptor =
    descriptor ||
    importFileDescriptorForExtension(normalizedExtension) ||
    importFileDescriptorForMediaType(normalizedMediaType) ||
    importFileDescriptorForPath(fileName);
  const resolvedExtension = normalizedExtension || normalizeRoutingExtension(resolvedDescriptor?.extension || "");

  if (!resolvedDescriptor) {
    return null;
  }

  return {
    extension: resolvedExtension,
    descriptor: resolvedDescriptor,
    mediaType: normalizedMediaType,
    source,
    confidence,
    fileName: String(fileName || "").trim(),
    kind: descriptorKind(resolvedDescriptor, normalizedMediaType)
  };
}

function collectFileRoutingCandidates({
  buffer,
  fileName = "",
  filePath = "",
  declaredFileNames = [],
  mediaTypeHint = "",
  allowTextFallback = true
}) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (candidate) {
      candidates.push(candidate);
    }
  };
  const signatureExtension = detectExtensionBySignature(buffer);
  if (isImportArchiveDescriptor(importFileDescriptorForExtension(signatureExtension))) {
    pushCandidate(createRoutingCandidate({
      extension: inferZipDocumentExtension(buffer, signatureExtension),
      source: "zip-container",
      confidence: 100,
      fileName: fileName || filePath
    }));
  } else if (signatureExtension) {
    pushCandidate(createRoutingCandidate({
      extension: signatureExtension,
      source: "binary-signature",
      confidence: 100,
      fileName: fileName || filePath
    }));
  }

  const declaredPaths = [
    ...declaredFileNames,
    fileName,
    filePath
  ].map((entry) => String(entry || "").trim()).filter(Boolean);
  const seenDeclaredPaths = new Set();
  for (const declaredPath of declaredPaths) {
    const normalizedPath = declaredPath.toLowerCase();
    if (seenDeclaredPaths.has(normalizedPath)) {
      continue;
    }
    seenDeclaredPaths.add(normalizedPath);
    const descriptor = importFileDescriptorForPath(declaredPath);
    pushCandidate(createRoutingCandidate({
      extension: path.extname(declaredPath),
      descriptor,
      source: "declared-path",
      confidence: 80,
      fileName: declaredPath
    }));
  }

  pushCandidate(createRoutingCandidate({
    descriptor: importFileDescriptorForMediaType(mediaTypeHint),
    mediaType: mediaTypeHint,
    source: "media-type",
    confidence: 70,
    fileName: fileName || filePath
  }));

  const isReadableText = looksLikeText(buffer);
  if (isReadableText && allowTextFallback) {
    const text = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf8");
    const sniffedExtension = sniffTextExtension(text);
    pushCandidate(createRoutingCandidate({
      extension: sniffedExtension || importPlainTextFallbackExtension(),
      source: sniffedExtension ? "text-sniff" : "text-fallback",
      confidence: sniffedExtension ? 35 : 10,
      fileName: fileName || filePath
    }));
  }

  return {
    candidates,
    isReadableText
  };
}

function pickFileRoutingCandidate(candidates = []) {
  const orderedCandidates = asArray(candidates).filter(Boolean);
  return (
    orderedCandidates.find((candidate) => candidate.source === "zip-container") ||
    orderedCandidates.find((candidate) => candidate.source === "binary-signature") ||
    orderedCandidates.find((candidate) => candidate.source === "declared-path") ||
    orderedCandidates.find((candidate) => candidate.source === "media-type") ||
    orderedCandidates.find((candidate) => candidate.source === "text-sniff") ||
    orderedCandidates.find((candidate) => candidate.source === "text-fallback") ||
    orderedCandidates.sort((left, right) => right.confidence - left.confidence)[0] ||
    null
  );
}

function resolveRoutingMediaType({ selectedCandidate, descriptor, extension, mediaTypeHint }) {
  if (descriptor?.mediaType) {
    return descriptor.mediaType;
  }
  if (descriptorSupportsMediaType(descriptor, selectedCandidate?.mediaType)) {
    return selectedCandidate.mediaType;
  }
  if (descriptorSupportsMediaType(descriptor, mediaTypeHint)) {
    return String(mediaTypeHint || "").trim().toLowerCase();
  }
  return mediaTypeForImportExtension(extension) ||
    (isImportTextDescriptor(descriptor) ? mediaTypeForImportExtension(importPlainTextFallbackExtension()) : "");
}

export function createFileRoutingDecision({
  buffer = Buffer.alloc(0),
  fileName = "",
  filePath = "",
  declaredFileNames = [],
  mediaTypeHint = "",
  allowTextFallback = shouldIncludeUnknownReadableText()
} = {}) {
  const { candidates, isReadableText } = collectFileRoutingCandidates({
    buffer,
    fileName,
    filePath,
    declaredFileNames,
    mediaTypeHint,
    allowTextFallback
  });
  const selectedCandidate = pickFileRoutingCandidate(candidates);
  const descriptor =
    selectedCandidate?.descriptor ||
    importFileDescriptorForExtension(selectedCandidate?.extension) ||
    importFileDescriptorForMediaType(selectedCandidate?.mediaType) ||
    importFileDescriptorForPath(selectedCandidate?.fileName || fileName || filePath);
  const extension = normalizeRoutingExtension(
    selectedCandidate?.extension ||
      descriptor?.extension ||
      ""
  );
  const resolvedMediaType = resolveRoutingMediaType({
    selectedCandidate,
    descriptor,
    extension,
    mediaTypeHint
  });
  const kind = descriptorKind(descriptor, resolvedMediaType) ||
    (extension ? "document" : isReadableText ? "text" : "");

  return {
    extension,
    descriptor,
    kind,
    mediaTypeHint: resolvedMediaType,
    selectedSource: selectedCandidate?.source || "unsupported",
    selectedConfidence: selectedCandidate?.confidence || 0,
    isReadableText,
    routedFileName: routeFileNameWithExtension(fileName || path.basename(filePath || ""), extension),
    signals: candidates.map((candidate) => ({
      source: candidate.source,
      extension: candidate.extension,
      kind: candidate.kind,
      mediaType: candidate.mediaType,
      confidence: candidate.confidence,
      fileName: candidate.fileName
    }))
  };
}

function hasResolvedImportRoute(routeDecision = {}) {
  if (routeDecision.descriptor || routeDecision.extension) {
    return true;
  }
  return Boolean(shouldIncludeUnknownReadableText() && routeDecision.isReadableText);
}

function effectiveFileNameForRouting(name = "", filePath = "", extension = "") {
  const rawName = name || filePath;
  if (!rawName || !extension) {
    return rawName;
  }
  const descriptor = importFileDescriptorForPath(rawName);
  if (descriptor && !descriptor.extension && descriptor.fileName) {
    return rawName;
  }
  return routeFileNameWithExtension(rawName, extension);
}

function mediaTypeForExtension(extension) {
  return mediaTypeForImportExtension(extension);
}

function buildImagePayload(buffer, mediaType) {
  return {
    imageBuffer: buffer,
    imageDataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`
  };
}

function buildOriginalPayload({
  buffer,
  extension,
  originalRelativePath = "",
  ingestOrigin = "filesystem",
  sourceContainerPath = "",
  checkpointMaterialPath = ""
}) {
  return {
    originalBuffer: buffer,
    originalExtension: extension,
    originalSha256: createHash("sha256").update(buffer).digest("hex"),
    originalByteSize: buffer.length,
    originalRelativePath,
    ingestOrigin,
    sourceContainerPath,
    checkpointMaterialPath
  };
}

function normalizeConnectorSourceMetadata(input = {}) {
  const providerId = String(input.providerId || "").trim();
  const externalId = String(input.externalId || "").trim();
  const syncBatchId = String(input.syncBatchId || "").trim();
  const contentHash = String(input.contentHash || input.sha256 || "").trim();
  const capturedAt = String(input.capturedAt || input.sourceCollectedAt || "").trim();
  const sourceMetadata =
    input.sourceMetadata && typeof input.sourceMetadata === "object" && !Array.isArray(input.sourceMetadata)
      ? input.sourceMetadata
      : {};
  return {
    providerId,
    externalId,
    syncBatchId,
    contentHash,
    capturedAt,
    sourceMetadata: {
      ...sourceMetadata,
      providerId: sourceMetadata.providerId || providerId || undefined,
      externalId: sourceMetadata.externalId || externalId || undefined,
      syncBatchId: sourceMetadata.syncBatchId || syncBatchId || undefined,
      capturedAt: sourceMetadata.capturedAt || capturedAt || undefined
    }
  };
}

function normalizeTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "";
  }

  return value.toISOString();
}

function buildSourceTimeMetadata({ stats, collectedAt }) {
  const fallback = collectedAt || new Date().toISOString();
  const createdAt =
    normalizeTimestamp(stats?.birthtime) || normalizeTimestamp(stats?.ctime) || fallback;
  const updatedAt =
    normalizeTimestamp(stats?.mtime) || normalizeTimestamp(stats?.ctime) || createdAt;

  return {
    sourceCreatedAt: createdAt,
    sourceUpdatedAt: updatedAt,
    sourceCollectedAt: fallback
  };
}

function buildRouteExtractionWarning(name, fileType, route, error) {
  const message = error instanceof Error ? error.message : "未知错误";
  const routeLabel = route?.mountName || route?.action || "解析模块";

  if (fileType === "image" && routeLabel === "ocr") {
    return `${name} OCR 未完成：${message} 已保留原始图片。`;
  }

  if (fileType === "image") {
    return `${name} 图片解析未完成：${message} 已保留原始图片。`;
  }

  return `${name} 通过 ${routeLabel} 解析未完成：${message}`;
}

function createFailureReason({
  reasonCode,
  message,
  sourceName = "",
  sourcePath = "",
  sourceKind = "",
  parserId = "",
  route = null,
  details = {}
} = {}) {
  return {
    reasonCode: String(reasonCode || "document_parse_failed").trim() || "document_parse_failed",
    message: String(message || "文档解析失败。"),
    sourceName: String(sourceName || ""),
    sourcePath: String(sourcePath || ""),
    sourceKind: String(sourceKind || ""),
    parserId: String(parserId || ""),
    route: route && typeof route === "object" && !Array.isArray(route)
      ? {
          mountName: String(route.mountName || ""),
          action: String(route.action || ""),
          matchedBy: String(route.matchedBy || "")
        }
      : null,
    details: details && typeof details === "object" && !Array.isArray(details) ? details : {}
  };
}

function createFailureError(message, reasonCode, failureReasons = []) {
  const error = new Error(String(message || "文档解析失败。"));
  error.reasonCode = String(reasonCode || "document_parse_failed");
  error.failureReasons = Array.isArray(failureReasons) ? failureReasons : [];
  return error;
}

function buildRouteExtractionFailureReason(name, fileType, route, error) {
  return createFailureReason({
    reasonCode: fileType === "image" ? "image_parse_failed" : "document_route_extraction_failed",
    message: buildRouteExtractionWarning(name, fileType, route, error),
    sourceName: name,
    sourcePath: name,
    sourceKind: fileType,
    route,
    details: {
      error: error instanceof Error ? error.message : "未知错误"
    }
  });
}

function getMountedHandler(runtime, mountName = "") {
  return runtime?.mounts?.[mountName] || null;
}

function routeTargetWithMatch(route = null, matchedBy = "") {
  const mountName = String(route?.mountName || "").trim();
  if (!mountName) {
    return null;
  }
  return {
    mountName,
    action: String(route?.action || "extractDocument").trim() || "extractDocument",
    matchedBy
  };
}

function resolveConfiguredDocumentRoute({ sourceKind = "", extension = "", mediaTypeHint = "" } = {}) {
  const routing = getImportDefaultRoutingTable();
  const normalizedExtension = normalizeRoutingExtension(extension);
  const normalizedMediaType = String(mediaTypeHint || "").toLowerCase().trim();
  const normalizedKind = String(sourceKind || "").trim();

  return (
    routeTargetWithMatch(routing.extensionRoutes?.[normalizedExtension], "extension") ||
    routeTargetWithMatch(routing.mediaTypeRoutes?.[normalizedMediaType], "mediaType") ||
    routeTargetWithMatch(routing.kindRoutes?.[normalizedKind], "kind") ||
    routeTargetWithMatch(routing.kindRoutes?.document, "default-kind") ||
    {
      mountName: "documentParser",
      action: "extractDocument",
      matchedBy: "default"
    }
  );
}

function resolveDocumentRoute({ runtime, sourceKind, extension = "", mediaTypeHint = "" }) {
  if (runtime && typeof runtime.resolveDocumentRoute === "function") {
    return runtime.resolveDocumentRoute({
      sourceKind,
      extension,
      mediaTypeHint
    });
  }

  return resolveConfiguredDocumentRoute({
    sourceKind,
    extension,
    mediaTypeHint
  });
}

function normalizeDocumentParseResult(result, parserId = "") {
  if (typeof result === "string") {
    return {
      parserId,
      text: normalizeText(result),
      metadata: {},
      embeddedDocuments: [],
      visualElements: [],
      warnings: [],
      mediaType: ""
    };
  }

  const metadata =
    result?.metadata && typeof result.metadata === "object" && !Array.isArray(result.metadata)
      ? result.metadata
      : {};
  const embeddedDocuments = Array.isArray(result?.embeddedDocuments)
    ? result.embeddedDocuments.map((entry, index) => ({
        id: String(entry?.id || `embedded-${index + 1}`),
        text: normalizeText(entry?.text || ""),
        metadata:
          entry?.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
            ? entry.metadata
            : {}
      }))
    : [];

  return {
    parserId: String(result?.parserId || parserId || ""),
    text: normalizeText(result?.text || result?.content || ""),
    metadata,
    embeddedDocuments,
    visualElements: asArray(result?.visualElements),
    warnings: asArray(result?.warnings).map((entry) => String(entry || "").trim()).filter(Boolean),
    mediaType: String(result?.mediaType || metadata["Content-Type"] || ""),
    failureReason:
      result?.failureReason && typeof result.failureReason === "object" && !Array.isArray(result.failureReason)
        ? result.failureReason
        : null
  };
}

function decodePlainTextBuffer(buffer) {
  return Buffer.isBuffer(buffer)
    ? buffer.toString("utf8").replace(/^\uFEFF/, "")
    : Buffer.from(buffer || "").toString("utf8").replace(/^\uFEFF/, "");
}

function shouldReadStructuredBufferDirectly({ descriptor = null, sourceKind = "", mediaTypeHint = "" } = {}) {
  return (
    isImportTextDescriptor(descriptor) ||
    String(sourceKind || "").trim() === "text" ||
    String(mediaTypeHint || "").trim().toLowerCase().startsWith("text/")
  );
}

function routeRequiresMountedExtraction(route = {}) {
  const mountName = String(route?.mountName || "").trim();
  return Boolean(mountName && mountName !== "documentParser");
}

function documentParserSupports({ extension, mediaTypeHint, runtime, sourceKind = "document" }) {
  const route = resolveDocumentRoute({
    runtime,
    sourceKind,
    extension,
    mediaTypeHint
  });
  const mountedHandler = getMountedHandler(runtime, route.mountName);
  if (!mountedHandler?.enabled || typeof mountedHandler.supports !== "function") {
    return (
      mountedHandler?.enabled &&
      route.matchedBy !== "default" &&
      (typeof mountedHandler.extractText === "function" ||
        typeof mountedHandler.extractDocument === "function")
    );
  }

  return mountedHandler.supports({ extension, mediaTypeHint, sourceKind });
}

function hasConfiguredRoute({
  runtime,
  extension = "",
  mediaTypeHint = "",
  sourceKind = "document",
  allowKindRoute = false
}) {
  const route = resolveDocumentRoute({
    runtime,
    sourceKind,
    extension,
    mediaTypeHint
  });

  return (
    route.matchedBy === "extension" ||
    route.matchedBy === "mediaType" ||
    (allowKindRoute && route.matchedBy === "kind")
  );
}

async function executeRouteExtraction({
  runtime,
  route,
  buffer,
  filePath,
  fileName,
  mediaTypeHint,
  settings,
  userDataPath,
  sourceKind
}) {
  const mountedHandler = getMountedHandler(runtime, route.mountName);

  if (!mountedHandler?.enabled) {
    throw new Error(`当前运行配置未挂载 ${route.mountName || "文档"} 解析组件。`);
  }

  const baseInput = {
    buffer,
    filePath,
    fileName,
    extension: path.extname(fileName || filePath).toLowerCase(),
    mediaTypeHint,
    settings,
    userDataPath,
    fileType: sourceKind,
    sourceKind
  };

  if (route.action === "extractDocument") {
    if (typeof mountedHandler.extractDocument === "function") {
      return normalizeDocumentParseResult(
        await mountedHandler.extractDocument(baseInput),
        mountedHandler.id
      );
    }

    if (typeof mountedHandler.extractText === "function") {
      return normalizeDocumentParseResult(
        await mountedHandler.extractText(baseInput),
        mountedHandler.id
      );
    }
  }

  if (route.action === "extractText") {
    if (typeof mountedHandler.extractText === "function") {
      return normalizeDocumentParseResult(
        await mountedHandler.extractText(baseInput),
        mountedHandler.id
      );
    }

    if (typeof mountedHandler.extractDocument === "function") {
      return normalizeDocumentParseResult(
        await mountedHandler.extractDocument(baseInput),
        mountedHandler.id
      );
    }
  }

  throw new Error(`挂载 ${route.mountName} 不支持 ${route.action}。`);
}

async function tryExtractWithOcr({
  buffer,
  filePath,
  name,
  fileType,
  settings,
  userDataPath,
  runtime
}) {
  const extension = path.extname(name || filePath).toLowerCase();
  const mediaTypeHint = fileType === "image" ? resolveImageMediaType(extension, "") : "";
  const route = resolveDocumentRoute({
    runtime,
    sourceKind: fileType === "image" ? "image" : fileType,
    extension,
    mediaTypeHint
  });
  const mountedHandler = getMountedHandler(runtime, route.mountName);
  if (
    (route.mountName === "ocr" && settings.ocrEnabled === false) ||
    !mountedHandler?.enabled ||
    (typeof mountedHandler.extractText !== "function" &&
      typeof mountedHandler.extractDocument !== "function")
  ) {
    return {
      text: "",
      warnings: [],
      attempted: false
    };
  }

  try {
    const result = await executeRouteExtraction({
      runtime,
      route,
      buffer,
      filePath,
      fileName: name || filePath,
      mediaTypeHint,
      settings,
      userDataPath,
      sourceKind: fileType === "image" ? "image" : fileType
    });

    return {
      text: normalizeText(result.text || ""),
      parserId: result.parserId || mountedHandler.id || "",
      metadata: result.metadata || {},
      embeddedDocuments: result.embeddedDocuments || [],
      warnings: [],
      failureReason: result.failureReason || null,
      attempted: true
    };
  } catch (error) {
    return {
      text: "",
      parserId: "",
      metadata: {},
      embeddedDocuments: [],
      warnings: [buildRouteExtractionWarning(name || filePath || "未命名文件", fileType, route, error)],
      failureReason: buildRouteExtractionFailureReason(name || filePath || "未命名文件", fileType, route, error),
      attempted: true
    };
  }
}

async function readStructuredBuffer({
  buffer,
  filePath,
  name,
  extension = "",
  mediaTypeHint,
  settings,
  userDataPath,
  runtime
}) {
  const resolvedExtension = normalizeRoutingExtension(extension || path.extname(name || filePath));
  const routedFileName = effectiveFileNameForRouting(name || filePath, filePath, resolvedExtension);
  const descriptor =
    importFileDescriptorForExtension(resolvedExtension) ||
    importFileDescriptorForPath(name || filePath) ||
    importFileDescriptorForMediaType(mediaTypeHint);
  const sourceKind = descriptor?.kind || (mediaTypeHint?.startsWith("text/") ? "text" : "document");
  const route = resolveDocumentRoute({
    runtime,
    sourceKind,
    extension: resolvedExtension,
    mediaTypeHint
  });

  if (
    !routeRequiresMountedExtraction(route) &&
    shouldReadStructuredBufferDirectly({ descriptor, sourceKind, mediaTypeHint })
  ) {
    return normalizeDocumentParseResult({
      parserId: "builtin/text-direct",
      text: decodePlainTextBuffer(buffer),
      metadata: {
        "Content-Type": mediaTypeHint || descriptor?.mediaType || mediaTypeForImportExtension(resolvedExtension)
      },
      mediaType: mediaTypeHint || descriptor?.mediaType || mediaTypeForImportExtension(resolvedExtension)
    }, "builtin/text-direct");
  }

  return executeRouteExtraction({
    runtime,
    route,
    buffer,
    filePath,
    fileName: routedFileName,
    mediaTypeHint,
    settings,
    userDataPath,
    sourceKind
  });
}

function isZipArchive(extension, mediaTypeHint) {
  const descriptor = importFileDescriptorForExtension(extension);
  if (isImportArchiveDescriptor(descriptor)) {
    return true;
  }
  return isImportArchiveDescriptor(importFileDescriptorForMediaType(mediaTypeHint));
}

function normalizeArchiveEntryPath(value) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();

  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return "";
  }

  return normalized;
}

async function parseArchiveInput({
  id,
  name,
  filePath,
  buffer,
  sourceTimes,
  settings,
  userDataPath,
  runtime,
  batchId,
  archiveBatchId = batchId,
  clientUid = "",
  sourceType = "",
  providerId = "",
  externalId = "",
  syncBatchId = "",
  contentHash = "",
  capturedAt = "",
  sourceMetadata = {},
  depth = 0
}) {
  if (depth > 1) {
    throw new Error("压缩包嵌套层级过深，已停止继续展开。");
  }

  let archiveEntries;

  try {
    archiveEntries = unzipArchiveEntriesWithLimits(buffer, {
      label: name || filePath || "压缩包"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    throw new Error(`${name || filePath || "压缩包"} 解压失败：${message}`);
  }

  const parsedEntries = [];

  for (const [rawEntryPath, entryBuffer] of Object.entries(archiveEntries)) {
    const entryPath = normalizeArchiveEntryPath(rawEntryPath);
    if (!entryPath || entryPath.endsWith("/")) {
      continue;
    }

    const entryBufferObject = Buffer.from(entryBuffer);
    const routeDecision = createFileRoutingDecision({
      buffer: entryBufferObject,
      fileName: entryPath,
      filePath: entryPath
    });
    const extension = routeDecision.extension || path.posix.extname(entryPath).toLowerCase();
    if (
      !hasResolvedImportRoute(routeDecision) &&
      !isImportFilePathSupported(entryPath) &&
      !hasConfiguredRoute({
        runtime,
        extension,
        sourceKind: "document"
      })
    ) {
      continue;
    }

    const nestedSources = await parseBufferInput({
      id: `${id}::${entryPath}`,
      name: entryPath,
      filePath: `${filePath || name}#${entryPath}`,
      buffer: entryBufferObject,
      mediaTypeHint: "",
      sourceTimes,
      settings,
      userDataPath,
      runtime,
      batchId,
      archiveBatchId,
      clientUid,
      sourceType,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata,
      originalRelativePath: entryPath,
      ingestOrigin: "archive",
      sourceContainerPath: filePath || name || "",
      depth: depth + 1
    });

    parsedEntries.push(...nestedSources);
  }

  if (parsedEntries.length === 0) {
    throw new Error(`${name || filePath || "压缩包"} 中没有可解析的文件。`);
  }

  return parsedEntries;
}

async function parseImageInput({
  id,
  name,
  filePath,
  buffer,
  mediaType,
  sourceTimes,
  settings,
  userDataPath,
  runtime,
  archiveBatchId = "",
  clientUid = "",
  sourceType = "",
  providerId = "",
  externalId = "",
  syncBatchId = "",
  contentHash = "",
  capturedAt = "",
  sourceMetadata = {},
  originalRelativePath = "",
  ingestOrigin = "filesystem",
  sourceContainerPath = "",
  checkpointMaterialPath = ""
}) {
  const ocrResult = await tryExtractWithOcr({
    buffer,
    filePath,
    name,
    fileType: "image",
    settings,
    userDataPath,
    runtime
  });
  let rawObject = null;
  if (archiveBatchId && ingestOrigin === "upload") {
    rawObject = await persistRawMailObject({
      userDataPath,
      batchId: archiveBatchId,
      buffer,
      originalRelativePath: originalRelativePath || name || path.basename(filePath || ""),
      originalSourcePath: filePath || "",
      sourceContainerPath,
      mediaType,
      ingestOrigin,
      clientUid,
      sourceType: sourceType || "image",
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata,
      sourceCreatedAt: sourceTimes.sourceCreatedAt,
      sourceUpdatedAt: sourceTimes.sourceUpdatedAt,
      sourceCollectedAt: sourceTimes.sourceCollectedAt
    });
  }

  return {
    id,
    name,
    path: filePath,
    kind: "image",
    ...sourceTimes,
    text: ocrResult.text,
    mediaType,
    documentParserId: ocrResult.parserId || "",
    documentMetadata: ocrResult.metadata || {},
    embeddedDocuments: ocrResult.embeddedDocuments || [],
    warnings: ocrResult.warnings,
    ocrAttempted: ocrResult.attempted,
    ...normalizeConnectorSourceMetadata({
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata
    }),
    ...buildOriginalPayload({
      buffer,
      extension: path.extname(name || filePath).toLowerCase(),
      checkpointMaterialPath
    }),
    ...buildImagePayload(buffer, mediaType),
    rawObject
  };
}

async function parseStructuredInput({
  id,
  name,
  filePath,
  buffer,
  extension,
  mediaTypeHint,
  sourceTimes,
  settings,
  userDataPath,
  runtime,
  batchId,
  archiveBatchId = batchId,
  clientUid = "",
  sourceType = "",
  providerId = "",
  externalId = "",
  syncBatchId = "",
  contentHash = "",
  capturedAt = "",
  sourceMetadata = {},
  originalRelativePath = "",
  ingestOrigin = "filesystem",
  sourceContainerPath = "",
  checkpointMaterialPath = ""
}) {
  const resolvedExtension = normalizeRoutingExtension(extension || path.extname(name || filePath));
  const descriptor =
    (resolvedExtension ? importFileDescriptorForExtension(resolvedExtension) : null) ||
    importFileDescriptorForPath(name || filePath) ||
    importFileDescriptorForMediaType(mediaTypeHint);
  const descriptorKind = descriptor?.kind || (mediaTypeHint?.startsWith("text/") ? "text" : "document");
  const isEmailDocument = descriptorKind === "email";
  const isTextDocument = descriptorKind === "text";
  const kind = isEmailDocument
    ? "email"
    : isTextDocument
      ? "text"
      : descriptorKind;
  const warnings = [];
  let ocrAttempted = false;
  let document = await readStructuredBuffer({
    buffer,
    filePath,
    name,
    extension: resolvedExtension,
    mediaTypeHint,
    settings,
    userDataPath,
    runtime
  });
  warnings.push(...asArray(document.warnings).map((entry) => String(entry || "").trim()).filter(Boolean));
  let text = document.text;

  if (!text && kind === "pdf") {
    const ocrResult = await tryExtractWithOcr({
      buffer,
      filePath,
      name,
      fileType: "pdf",
      settings,
      userDataPath,
      runtime
    });

    text = ocrResult.text;
    warnings.push(...ocrResult.warnings);
    ocrAttempted = ocrResult.attempted;
    document = {
      ...document,
      text
    };
  }

  let rawObject = null;
  if (archiveBatchId && (isEmailDocument || ingestOrigin === "upload")) {
    rawObject = await persistRawMailObject({
      userDataPath,
      batchId: archiveBatchId,
      buffer,
      originalRelativePath: originalRelativePath || name || path.basename(filePath || ""),
      originalSourcePath: filePath || "",
      sourceContainerPath,
      mediaType:
        mediaTypeHint ||
        descriptor?.mediaType ||
        mediaTypeForImportExtension(resolvedExtension),
      ingestOrigin,
      clientUid,
      sourceType: sourceType || kind || ingestOrigin,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata,
      sourceCreatedAt: sourceTimes.sourceCreatedAt,
      sourceUpdatedAt: sourceTimes.sourceUpdatedAt,
      sourceCollectedAt: sourceTimes.sourceCollectedAt
    });
  }

  return {
    id,
    name,
    path: filePath,
    kind,
    ...sourceTimes,
    text,
    mediaType: document.mediaType || mediaTypeHint || "",
    documentParserId: document.parserId || "",
    documentMetadata: document.metadata || {},
    embeddedDocuments: document.embeddedDocuments || [],
    visualElements: document.visualElements || [],
    warnings,
    failureReason: document.failureReason || null,
    ocrAttempted,
    ...normalizeConnectorSourceMetadata({
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata
    }),
    ...buildOriginalPayload({
      buffer,
      extension: resolvedExtension,
      originalRelativePath,
      ingestOrigin,
      sourceContainerPath,
      checkpointMaterialPath
    }),
    rawObject
  };
}

async function parseBufferInput({
  id,
  name,
  filePath = "",
  buffer,
  mediaTypeHint = "",
  sourceTimes,
  settings,
  userDataPath,
  runtime,
  batchId = "",
  archiveBatchId = batchId,
  clientUid = "",
  sourceType = "",
  providerId = "",
  externalId = "",
  syncBatchId = "",
  contentHash = "",
  capturedAt = "",
  sourceMetadata = {},
  originalRelativePath = "",
  ingestOrigin = "filesystem",
  sourceContainerPath = "",
  checkpointMaterialPath = "",
  depth = 0
}) {
  const sourcePath = name || filePath;
  const routeDecision = createFileRoutingDecision({
    buffer,
    fileName: name,
    filePath,
    mediaTypeHint
  });
  const descriptor = routeDecision.descriptor;
  const extension = routeDecision.extension || path.extname(sourcePath).toLowerCase();
  const effectiveMediaTypeHint = routeDecision.mediaTypeHint || mediaTypeHint;
  const routedName = effectiveFileNameForRouting(name, filePath, extension);
  const mediaType = resolveImageMediaType(extension, effectiveMediaTypeHint);

  if (isZipArchive(extension, effectiveMediaTypeHint)) {
    return parseArchiveInput({
      id,
      name: routedName || name,
      filePath,
      buffer,
      sourceTimes,
      settings,
      userDataPath,
      runtime,
      batchId,
      archiveBatchId,
      clientUid,
      sourceType,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata,
      depth
    });
  }

  if (mediaType) {
    return [await parseImageInput({
      id,
      name: routedName || name,
      filePath,
      buffer,
      mediaType,
      sourceTimes,
      settings,
      userDataPath,
      runtime,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata,
      archiveBatchId,
      clientUid,
      sourceType,
      originalRelativePath,
      ingestOrigin,
      sourceContainerPath,
      checkpointMaterialPath
    })];
  }

  if (
    isImportTextDescriptor(descriptor) ||
    effectiveMediaTypeHint?.startsWith("text/") ||
    (shouldIncludeUnknownReadableText() && routeDecision.isReadableText)
  ) {
    return [await parseStructuredInput({
      id,
      name: routedName || name,
      filePath,
      buffer,
      extension,
      mediaTypeHint:
        effectiveMediaTypeHint ||
        descriptor?.mediaType ||
        mediaTypeForImportPath(sourcePath) ||
        mediaTypeForImportExtension(importPlainTextFallbackExtension()),
      sourceTimes,
      settings,
      userDataPath,
      runtime,
      batchId,
      archiveBatchId,
      clientUid,
      sourceType,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata,
      originalRelativePath,
      ingestOrigin,
      sourceContainerPath,
      checkpointMaterialPath
    })];
  }

  if (
    hasResolvedImportRoute(routeDecision) ||
    hasConfiguredRoute({ runtime, extension, mediaTypeHint: effectiveMediaTypeHint, sourceKind: "document" }) ||
    documentParserSupports({ extension, mediaTypeHint: effectiveMediaTypeHint, runtime })
  ) {
    return [await parseStructuredInput({
      id,
      name: routedName || name,
      filePath,
      buffer,
      extension,
      mediaTypeHint: effectiveMediaTypeHint,
      sourceTimes,
      settings,
      userDataPath,
      runtime,
      batchId,
      archiveBatchId,
      clientUid,
      sourceType,
      providerId,
      externalId,
      syncBatchId,
      contentHash,
      capturedAt,
      sourceMetadata,
      originalRelativePath,
      ingestOrigin,
      sourceContainerPath,
      checkpointMaterialPath
    })];
  }

  throw new Error("暂不支持这种文件类型，或当前文件未交由 Java 文档解析链处理。");
}

async function parseFilePath(fileEntry, options = {}) {
  const stats = fileEntry.stats || await fs.stat(fileEntry.absolutePath);
  const buffer = await fs.readFile(fileEntry.absolutePath);
  const name = path.basename(fileEntry.absolutePath);

  return parseBufferInput({
    id: fileEntry.absolutePath,
    name,
    filePath: fileEntry.absolutePath,
    buffer,
    originalRelativePath: fileEntry.relativePath || name,
    ingestOrigin: "filesystem",
    checkpointMaterialPath: fileEntry.absolutePath,
    sourceTimes: buildSourceTimeMetadata({
      stats,
      collectedAt: options.collectedAt
    }),
    ...options
  });
}

async function parseUploadedFile(uploadedFile, index, options) {
  const buffer = uploadedFile.stagedPath
    ? await fs.readFile(uploadedFile.stagedPath)
    : Buffer.from(uploadedFile.dataBase64 || "", "base64");
  const originalFileName = path.basename(
    String(
      uploadedFile.originalFileName ||
        uploadedFile.clientFileName ||
        uploadedFile.sourceFileName ||
        uploadedFile.relativePath ||
        uploadedFile.name ||
        `upload-${index + 1}`
    )
  );
  const serverTokenName = path.basename(
    String(uploadedFile.relativePath || uploadedFile.name || originalFileName)
  );
  const uploadedMediaType = String(
    uploadedFile.mediaType ||
      uploadedFile.mimeType ||
      uploadedFile.contentType ||
      uploadedFile.type ||
      ""
  ).trim();
  const routeDecision = createFileRoutingDecision({
    buffer,
    fileName: originalFileName,
    filePath: serverTokenName,
    declaredFileNames: [originalFileName, serverTokenName],
    mediaTypeHint: uploadedMediaType
  });
  const extension = routeDecision.extension;
  const name = routeDecision.routedFileName || originalFileName;
  return parseBufferInput({
    id: serverTokenName || `upload-${index + 1}`,
    name,
    filePath: name,
    buffer,
    mediaTypeHint: routeDecision.mediaTypeHint || mediaTypeForExtension(extension),
    originalRelativePath: originalFileName || name,
    ingestOrigin: "upload",
    ...options,
    clientUid: uploadedFile.clientUid || uploadedFile.clientId || options.clientUid || "",
    sourceType: uploadedFile.sourceType || uploadedFile.resourceType || options.sourceType || "upload",
    checkpointMaterialPath: uploadedFile.stagedPath || "",
    sourceTimes: buildSourceTimeMetadata({
      collectedAt: options.collectedAt
    }),
    providerId: uploadedFile.providerId || options.providerId || "",
    externalId: uploadedFile.externalId || options.externalId || "",
    syncBatchId: uploadedFile.syncBatchId || options.syncBatchId || "",
    contentHash: uploadedFile.contentHash || options.contentHash || uploadedFile.sha256 || "",
    capturedAt: uploadedFile.capturedAt || options.capturedAt || "",
    sourceMetadata:
      uploadedFile.sourceMetadata && typeof uploadedFile.sourceMetadata === "object" && !Array.isArray(uploadedFile.sourceMetadata)
        ? uploadedFile.sourceMetadata
        : options.sourceMetadata || {}
  });
}

export function isSupportedImportPath(filePath) {
  return isImportFilePathSupported(filePath);
}

export async function isSupportedImportFilePath(filePath) {
  if (isSupportedImportPath(filePath)) {
    return true;
  }
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const detection = importReadableTextDetection();
      const sampleBytes = Math.max(detection.sampleBytes, 64 * 1024);
      const buffer = Buffer.alloc(sampleBytes);
      const { bytesRead } = await handle.read(buffer, 0, sampleBytes, 0);
      const routeDecision = createFileRoutingDecision({
        buffer: buffer.subarray(0, bytesRead),
        fileName: path.basename(filePath),
        filePath
      });
      return hasResolvedImportRoute(routeDecision);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function buildEmptyContentWarning(parsed) {
  if (parsed.kind === "email") {
    return `${parsed.name} 没有提取到邮件正文，可能是加密邮件、损坏邮件，或当前环境缺少 Tika。`;
  }

  if (parsed.kind === "docx") {
    return `${parsed.name} 没有提取到正文，可能是图片版 Word，或正文位于文本框、批注、页眉页脚、嵌入对象中。`;
  }

  if (parsed.kind === "document") {
    return `${parsed.name} 没有提取到正文，Tika 未返回有效文本。可能是扫描件、纯图片文档，或该格式需要补充依赖。`;
  }

  if (parsed.kind === "pdf") {
    if (parsed.ocrAttempted) {
      return `${parsed.name} 已尝试 PaddleOCR，但仍未提取到正文。可能是无文字扫描件，或识别质量不足。`;
    }

    return `${parsed.name} 没有提取到正文，可能是扫描版 PDF 或图片型 PDF。可配置 PaddleOCR 作为兜底。`;
  }

  return `${parsed.name} 没有提取到可用内容，已跳过。`;
}

function buildEmptyContentFailureReason(parsed) {
  const kind = String(parsed?.kind || "document").trim();
  const looksLikePdf =
    kind === "pdf" ||
    String(parsed?.mediaType || "").toLowerCase() === "application/pdf" ||
    String(parsed?.name || parsed?.path || "").toLowerCase().endsWith(".pdf");
  const reasonCodeByKind = {
    email: "email_body_not_extracted",
    docx: "docx_no_text_extracted",
    document: "document_no_text_extracted",
    pdf: parsed?.ocrAttempted ? "pdf_ocr_no_text_extracted" : "pdf_no_text_extracted"
  };
  return createFailureReason({
    reasonCode: looksLikePdf
      ? (parsed?.ocrAttempted ? "pdf_ocr_no_text_extracted" : "pdf_no_text_extracted")
      : (reasonCodeByKind[kind] || "no_usable_content_extracted"),
    message: buildEmptyContentWarning(parsed),
    sourceName: parsed?.name || "",
    sourcePath: parsed?.path || "",
    sourceKind: kind,
    parserId: parsed?.documentParserId || parsed?.parserId || "",
    details: {
      ocrAttempted: parsed?.ocrAttempted === true,
      mediaType: parsed?.mediaType || ""
    }
  });
}

async function collectSupportedFilesFromDirectory(
  directoryPath,
  collector,
  visitedDirectories,
  rootDirectoryPath = directoryPath,
  runtime = null
) {
  const resolvedPath = path.resolve(directoryPath);

  if (visitedDirectories.has(resolvedPath)) {
    return;
  }

  visitedDirectories.add(resolvedPath);

  const directoryEntries = await fs.readdir(resolvedPath, {
    withFileTypes: true
  });

  for (const directoryEntry of directoryEntries) {
    const entryPath = path.join(resolvedPath, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      await collectSupportedFilesFromDirectory(
        entryPath,
        collector,
        visitedDirectories,
        rootDirectoryPath,
        runtime
      );
      continue;
    }

    if (!directoryEntry.isFile()) {
      continue;
    }

    if (
      await isSupportedImportFilePath(entryPath) ||
      hasConfiguredRoute({
        runtime,
        extension: path.extname(entryPath).toLowerCase(),
        sourceKind: "document"
      })
    ) {
      collector.push({
        absolutePath: entryPath,
        relativePath: path.relative(rootDirectoryPath, entryPath).split(path.sep).join("/")
      });
    }
  }
}

async function expandInputFilePaths(filePaths, runtime = null, { userDataPath = "" } = {}) {
  const expandedFileEntries = [];
  const warnings = [];
  const visitedDirectories = new Set();

  for (const inputPath of filePaths) {
    try {
      const stats = await fs.lstat(inputPath);

      if (stats.isDirectory()) {
        const directory = await assertExistingLocalDirectoryWithinControlledRoots(inputPath, {
          userDataPath,
          label: "文档解析输入目录"
        });
        const filesBefore = expandedFileEntries.length;
        await collectSupportedFilesFromDirectory(
          directory.realPath,
          expandedFileEntries,
          visitedDirectories,
          directory.realPath,
          runtime
        );

        if (expandedFileEntries.length === filesBefore) {
          warnings.push(`${path.basename(directory.realPath)} 中没有可解析的文件，已跳过。`);
        }

        continue;
      }

      const file = await assertExistingLocalFileWithinControlledRoots(inputPath, {
        userDataPath,
        label: "文档解析输入文件"
      });
      expandedFileEntries.push({
        absolutePath: file.realPath,
        relativePath: path.basename(file.realPath)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      warnings.push(`${path.basename(inputPath)} 读取失败：${message}`);
    }
  }

  return {
    fileEntries: expandedFileEntries,
    warnings
  };
}

function resolveKnowledgeSourceManifestPath(userDataPath, fileManifestPath = "") {
  const rawPath = String(fileManifestPath || "").trim();
  if (!rawPath) {
    return "";
  }
  const resolved = path.resolve(rawPath);
  const allowedRoot = path.resolve(userDataPath, "knowledge-sources", "hydrated");
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error("知识源文件清单路径不在允许的自动下载缓存目录中。");
  }
  return resolved;
}

async function loadInputFileManifest({ userDataPath, fileManifestPath }) {
  const resolved = resolveKnowledgeSourceManifestPath(userDataPath, fileManifestPath);
  if (!resolved) {
    return null;
  }
  const raw = await fs.readFile(resolved, "utf8");
  const parsed = JSON.parse(raw);
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const fileEntries = [];
  const warnings = [];
  const failureReasons = [];
  for (const file of files) {
    const rawAbsolutePath = String(file.absolutePath || "").trim();
    if (!rawAbsolutePath) {
      const message = "知识源文件清单包含空路径，已跳过。";
      warnings.push(message);
      failureReasons.push(createFailureReason({ reasonCode: "manifest_empty_path", message, sourceKind: "manifest" }));
      continue;
    }
    const absolutePath = path.resolve(rawAbsolutePath);
    const relativePath = String(file.relativePath || path.basename(absolutePath)).replace(/\\/g, "/");
    if (!relativePath || relativePath.includes("../") || path.isAbsolute(relativePath)) {
      const message = "知识源文件清单包含不安全路径，已跳过。";
      warnings.push(message);
      failureReasons.push(createFailureReason({
        reasonCode: "manifest_unsafe_path",
        message,
        sourcePath: absolutePath,
        sourceKind: "manifest"
      }));
      continue;
    }
    fileEntries.push({
      absolutePath,
      relativePath,
      originalAbsolutePath: file.originalAbsolutePath || ""
    });
  }
  return {
    fileEntries,
    warnings,
    failureReasons,
    manifest: parsed
  };
}

function normalizeSignatureTime(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

async function createFilesystemImportWorkItem(fileEntry) {
  const stats = await fs.stat(fileEntry.absolutePath);
  const absolutePath = path.resolve(fileEntry.absolutePath);
  const signature = {
    kind: "filesystem",
    absolutePath,
    relativePath: fileEntry.relativePath || path.basename(absolutePath),
    byteSize: Number(stats.size || 0),
    mtimeMs: normalizeSignatureTime(stats.mtimeMs),
    ctimeMs: normalizeSignatureTime(stats.ctimeMs)
  };
  return {
    entryId: createImportEntryId({
      kind: "filesystem",
      absolutePath,
      relativePath: signature.relativePath
    }),
    inputKind: "filesystem",
    signature,
    fileEntry: {
      ...fileEntry,
      absolutePath,
      stats
    }
  };
}

function createUploadedImportWorkItem(uploadedFile, index) {
  const name = String(uploadedFile?.relativePath || uploadedFile?.name || `upload-${index + 1}`);
  const signature = {
    kind: "upload",
    index,
    name,
    byteSize: Number(uploadedFile?.byteSize || 0),
    sha256: String(uploadedFile?.sha256 || "").toLowerCase(),
    stagedPath: uploadedFile?.stagedPath ? path.resolve(uploadedFile.stagedPath) : ""
  };
  return {
    entryId: createImportEntryId({
      kind: "upload",
      index,
      name,
      byteSize: signature.byteSize,
      sha256: signature.sha256
    }),
    inputKind: "upload",
    signature,
    uploadedFile
  };
}

async function restoreSourcesFromImportCheckpoint({
  userDataPath,
  batchId,
  workItem
}) {
  if (!batchId) {
    return null;
  }
  const entry = await loadImportCheckpointEntry({
    userDataPath,
    batchId,
    entryId: workItem.entryId
  });
  const usable = await validateImportCheckpointEntry({
    userDataPath,
    entry,
    expectedSignature: workItem.signature
  });
  if (!usable) {
    return null;
  }
  return {
    sources: await hydrateImportCheckpointSources({
      userDataPath,
      sources: entry.sources || []
    }),
    warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
    failureReasons: Array.isArray(entry.failureReasons) ? entry.failureReasons : []
  };
}

function appendUsableParsedEntries({ parsedEntries, sources, warnings, failureReasons }) {
  const acceptedSources = [];
  const entryWarnings = [];
  const entryFailureReasons = [];

  for (const parsed of parsedEntries || []) {
    entryWarnings.push(...(parsed.warnings || []));
    if (parsed.failureReason && typeof parsed.failureReason === "object") {
      entryFailureReasons.push(parsed.failureReason);
    }

    if (parsed.kind === "image" || parsed.text) {
      acceptedSources.push(parsed);
    } else {
      const failureReason = buildEmptyContentFailureReason(parsed);
      entryFailureReasons.push(failureReason);
      entryWarnings.push(failureReason.message);
    }
  }

  warnings.push(...entryWarnings);
  failureReasons.push(...entryFailureReasons);
  sources.push(...acceptedSources);
  return {
    acceptedSources,
    entryWarnings,
    entryFailureReasons
  };
}

async function appendCheckpointedInputSources({
  userDataPath,
  batchId,
  archiveBatchId = batchId,
  workItem,
  sources,
  warnings,
  failureReasons,
  runtime,
  generatedAt,
  parse
}) {
  async function publishIncrementalSearchIndex(parsedSources) {
    const knowledgeBase = runtime?.mounts?.knowledgeBase;
    if (!archiveBatchId || !knowledgeBase || typeof knowledgeBase.ingestSources !== "function") {
      return;
    }
    try {
      await knowledgeBase.ingestSources({
        batchId: archiveBatchId,
        sources: parsedSources,
        generatedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      warnings.push(`${workItem.inputKind || "input"} 增量检索索引写入失败：${message}`);
    }
  }

  const restored = await restoreSourcesFromImportCheckpoint({
    userDataPath,
    batchId,
    workItem
  });
  if (restored) {
    warnings.push(...restored.warnings);
    failureReasons.push(...(restored.failureReasons || []));
    sources.push(...restored.sources);
    await publishIncrementalSearchIndex(restored.sources);
    return rawObjectPathsFromSources(restored.sources);
  }

  const parsedEntries = await parse();
  const { acceptedSources, entryWarnings, entryFailureReasons } = appendUsableParsedEntries({
    parsedEntries,
    sources,
    warnings,
    failureReasons
  });

  if (batchId && acceptedSources.length > 0) {
    await saveImportCheckpointEntry({
      userDataPath,
      batchId,
      entryId: workItem.entryId,
      inputKind: workItem.inputKind,
      signature: workItem.signature,
      sources: acceptedSources,
      warnings: entryWarnings,
      failureReasons: entryFailureReasons
    });
    await publishIncrementalSearchIndex(acceptedSources);
  }

  return rawObjectPathsFromSources(acceptedSources);
}

export async function readInputSources({
  inputText,
  filePaths = [],
  fileManifestPath = "",
  uploadedFiles = [],
  settings,
  userDataPath,
  generatedAt,
  batchId = "",
  archiveBatchId = batchId,
  clientUid = "",
  sourceType = "",
  providerId = "",
  externalId = "",
  syncBatchId = "",
  contentHash = "",
  capturedAt = "",
  runtime = null,
  reportProgress = null
}) {
  const sources = [];
  const warnings = [];
  const failureReasons = [];
  const reportImportProgress = createThrottledImportProgressReporter(reportProgress);
  reportImportProgress({
    stage: "展开输入目录",
    progressStart: 26,
    progressEnd: 28,
    force: true
  });
  const manifestInput = await loadInputFileManifest({ userDataPath, fileManifestPath });
  const expanded = manifestInput || await expandInputFilePaths(filePaths, runtime, { userDataPath });
  warnings.push(...expanded.warnings);
  failureReasons.push(...(expanded.failureReasons || []));
  const fileWorkItems = [];
  const uploadWorkItems = uploadedFiles.map((uploadedFile, index) =>
    createUploadedImportWorkItem(uploadedFile, index)
  );

  for (const [index, fileEntry] of expanded.fileEntries.entries()) {
    try {
      fileWorkItems.push(await createFilesystemImportWorkItem(fileEntry));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      warnings.push(`${path.basename(fileEntry.absolutePath)} 读取失败：${message}`);
    }
    reportImportProgress({
      stage: "建立文件索引",
      current: index + 1,
      total: expanded.fileEntries.length,
      progressStart: 28,
      progressEnd: 32
    });
  }

  const protectedRawObjectPaths = batchId
    ? await collectProtectedRawObjectPaths({
        userDataPath,
        batchId,
        expectedEntries: [...fileWorkItems, ...uploadWorkItems].map((workItem) => ({
          entryId: workItem.entryId,
          signature: workItem.signature
        }))
      })
    : new Set();
  if (batchId) {
    await cleanupImportArtifacts({
      userDataPath,
      batchId,
      rawObjectBatchId: archiveBatchId,
      protectedRawObjectPaths,
      cleanupTemp: true
    });
  }

  const totalWorkItems = fileWorkItems.length + uploadWorkItems.length;
  reportImportProgress({
    stage: "读取输入文件",
    current: 0,
    total: totalWorkItems,
    progressStart: 32,
    progressEnd: 54,
    force: true
  });

  if (inputText && inputText.trim()) {
    sources.push({
      id: "pasted-text",
      name: "粘贴文本",
      path: "",
      kind: "text",
      ...buildSourceTimeMetadata({
        collectedAt: generatedAt
      }),
      text: normalizeText(inputText)
    });
  }

  let processedWorkItems = 0;
  for (const workItem of fileWorkItems) {
    try {
      const rawObjectPaths = await appendCheckpointedInputSources({
        userDataPath,
        batchId,
        archiveBatchId,
        workItem,
        sources,
        warnings,
        failureReasons,
        runtime,
        generatedAt,
        parse: () =>
          parseFilePath(workItem.fileEntry, {
            collectedAt: generatedAt,
            settings,
            userDataPath,
            batchId,
            archiveBatchId,
            clientUid,
            sourceType: sourceType || "filesystem",
            providerId,
            externalId,
            syncBatchId,
            contentHash,
            capturedAt,
            runtime
          })
      });
      for (const rawObjectPath of rawObjectPaths) {
        protectedRawObjectPaths.add(rawObjectPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      const fullMessage = `${path.basename(workItem.fileEntry.absolutePath)} 读取失败：${message}`;
      warnings.push(fullMessage);
      failureReasons.push(...(Array.isArray(error?.failureReasons)
        ? error.failureReasons
        : [createFailureReason({
            reasonCode: error?.reasonCode || "filesystem_input_parse_failed",
            message: fullMessage,
            sourceName: path.basename(workItem.fileEntry.absolutePath),
            sourcePath: workItem.fileEntry.absolutePath,
            sourceKind: "filesystem",
            details: { error: message }
          })]));
    }
    processedWorkItems += 1;
    reportImportProgress({
      stage: "读取输入文件",
      current: processedWorkItems,
      total: totalWorkItems,
      progressStart: 32,
      progressEnd: 54
    });
  }

  for (const workItem of uploadWorkItems) {
    try {
      const rawObjectPaths = await appendCheckpointedInputSources({
        userDataPath,
        batchId,
        archiveBatchId,
        workItem,
        sources,
        warnings,
        failureReasons,
        runtime,
        generatedAt,
        parse: () =>
          parseUploadedFile(workItem.uploadedFile, workItem.signature.index, {
            collectedAt: generatedAt,
            settings,
            userDataPath,
            batchId,
            archiveBatchId,
            clientUid,
            sourceType,
            providerId,
            externalId,
            syncBatchId,
            contentHash,
            capturedAt,
            runtime
          })
      });
      for (const rawObjectPath of rawObjectPaths) {
        protectedRawObjectPaths.add(rawObjectPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      const fallbackName = `upload-${workItem.signature.index + 1}`;
      const fullMessage = `${workItem.uploadedFile.name || fallbackName} 读取失败：${message}`;
      warnings.push(fullMessage);
      failureReasons.push(...(Array.isArray(error?.failureReasons)
        ? error.failureReasons
        : [createFailureReason({
            reasonCode: error?.reasonCode || "upload_input_parse_failed",
            message: fullMessage,
            sourceName: workItem.uploadedFile.name || fallbackName,
            sourcePath: workItem.uploadedFile.relativePath || "",
            sourceKind: "upload",
            details: { error: message }
          })]));
    }
    processedWorkItems += 1;
    reportImportProgress({
      stage: "读取输入文件",
      current: processedWorkItems,
      total: totalWorkItems,
      progressStart: 32,
      progressEnd: 54
    });
  }

  if (batchId) {
    await cleanupImportArtifacts({
      userDataPath,
      batchId,
      rawObjectBatchId: archiveBatchId,
      protectedRawObjectPaths,
      cleanupTemp: false
    });
  }

  if (sources.length === 0) {
    if (warnings.length > 0) {
      throw createFailureError(
        `没有可处理的内容。${warnings.join("；")}`,
        "document_parse_no_usable_content",
        failureReasons
      );
    }

    throw createFailureError(
      "没有可处理的内容。请粘贴文本或选择可解析的文件。",
      "document_parse_input_missing",
      failureReasons
    );
  }

  const usableText = sources.some((source) => source.text);
  const usableImage = sources.some((source) => source.kind === "image");

  if (!usableText && !usableImage) {
    throw createFailureError(
      "输入中没有可供智能体处理的文本或图片。",
      "document_parse_no_text_or_image",
      failureReasons
    );
  }

  return {
    sources,
    warnings,
    failureReasons
  };
}
