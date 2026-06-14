import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../security/client-strings.mjs";

const CHECKPOINT_SCHEMA_VERSION = "v0.0.1:storage:import-resume-checkpoint-schema-1";
const TMP_ROOT_NAMES = ["tika", "ocr"];

function nowIso() {
  return new Date().toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toPosixRelative(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

function checkpointRoot(userDataPath, batchId) {
  if (!batchId) {
    throw new Error("导入断点缺少 batchId。");
  }
  return resolveWithin(userDataPath, "jobs", batchId, "import-checkpoint");
}

function entriesRoot(userDataPath, batchId) {
  return resolveWithin(checkpointRoot(userDataPath, batchId), "entries");
}

function entryPath(userDataPath, batchId, entryId) {
  if (!/^[a-f0-9]{40}$/.test(String(entryId || ""))) {
    throw new Error("导入断点 entryId 无效。");
  }
  return resolveWithin(entriesRoot(userDataPath, batchId), `${entryId}.json`);
}

async function listFilesRecursively(rootPath) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(nextPath)));
    } else if (entry.isFile()) {
      files.push(nextPath);
    }
  }
  return files;
}

async function removeEmptyDirectories(rootPath) {
  let entries = [];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return true;
  }

  let empty = true;
  for (const entry of entries) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      const childEmpty = await removeEmptyDirectories(nextPath);
      if (childEmpty) {
        await fs.rm(nextPath, { recursive: true, force: true });
      } else {
        empty = false;
      }
      continue;
    }
    empty = false;
  }
  return empty;
}

async function writeJsonAtomic(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, targetPath);
}

async function readJson(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function createImportEntryId(input) {
  return sha256Hex(stableJson(input)).slice(0, 40);
}

export async function hashFileSha256(filePath) {
  const handle = await fs.open(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export function getImportCheckpointDirectory(userDataPath, batchId) {
  return checkpointRoot(userDataPath, batchId);
}

export async function loadImportCheckpointEntry({ userDataPath, batchId, entryId }) {
  const entry = await readJson(entryPath(userDataPath, batchId, entryId));
  if (!entry || entry.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    return null;
  }
  return entry;
}

export async function saveImportCheckpointEntry({
  userDataPath,
  batchId,
  entryId,
  inputKind,
  signature,
  sources,
  warnings = [],
  failureReasons = []
}) {
  const now = nowIso();
  const entry = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    entryId,
    batchId,
    inputKind,
    status: "completed",
    signature,
    sources: serializeSourcesForImportCheckpoint(sources),
    warnings: Array.isArray(warnings) ? warnings.map((item) => String(item || "")) : [],
    failureReasons: Array.isArray(failureReasons) ? failureReasons : [],
    updatedAt: now
  };
  const existing = await loadImportCheckpointEntry({ userDataPath, batchId, entryId });
  entry.createdAt = existing?.createdAt || now;
  await writeJsonAtomic(entryPath(userDataPath, batchId, entryId), entry);
  await writeJsonAtomic(resolveWithin(checkpointRoot(userDataPath, batchId), "manifest.json"), {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    batchId,
    updatedAt: now
  });
  return entry;
}

export async function listImportCheckpointEntries({ userDataPath, batchId }) {
  let names = [];
  try {
    names = await fs.readdir(entriesRoot(userDataPath, batchId));
  } catch {
    return [];
  }

  const entries = [];
  for (const name of names) {
    if (!/^[a-f0-9]{40}\.json$/.test(name)) {
      continue;
    }
    const entry = await readJson(resolveWithin(entriesRoot(userDataPath, batchId), name));
    if (entry?.schemaVersion === CHECKPOINT_SCHEMA_VERSION) {
      entries.push(entry);
    }
  }
  return entries;
}

export async function removeImportCheckpoint({ userDataPath, batchId }) {
  if (!batchId) {
    return;
  }
  await fs.rm(checkpointRoot(userDataPath, batchId), {
    recursive: true,
    force: true
  });
}

function serializeSourcesForImportCheckpoint(sources) {
  return (Array.isArray(sources) ? sources : []).map((source) => {
    const {
      originalBuffer,
      imageBuffer,
      imageDataUrl,
      ...serializable
    } = source || {};
    return {
      ...serializable,
      checkpointMaterialPath: source?.checkpointMaterialPath || ""
    };
  });
}

async function readMaterialBuffer({ userDataPath, source }) {
  const candidates = [];
  if (source?.checkpointMaterialPath && path.isAbsolute(source.checkpointMaterialPath)) {
    candidates.push(source.checkpointMaterialPath);
  }
  if (source?.rawObject?.storageRelativePath) {
    candidates.push(resolveWithin(userDataPath, source.rawObject.storageRelativePath));
  }
  if (source?.path && path.isAbsolute(source.path) && !String(source.path).includes("#")) {
    candidates.push(source.path);
  }

  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate);
      if (source.originalSha256) {
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        if (sha256 !== source.originalSha256) {
          continue;
        }
      }
      return buffer;
    } catch {
      // Try the next material source.
    }
  }
  return null;
}

export async function hydrateImportCheckpointSources({ userDataPath, sources }) {
  const hydrated = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const next = { ...source };
    const buffer = await readMaterialBuffer({ userDataPath, source: next });
    if (buffer) {
      next.originalBuffer = buffer;
      if (next.kind === "image") {
        next.imageBuffer = buffer;
        if (!next.imageDataUrl) {
          next.imageDataUrl = `data:${next.mediaType || "application/octet-stream"};base64,${buffer.toString("base64")}`;
        }
      }
    }
    hydrated.push(next);
  }
  return hydrated;
}

async function validateRawObject({ userDataPath, rawObject }) {
  if (!rawObject?.storageRelativePath) {
    return true;
  }
  const objectPath = resolveWithin(userDataPath, rawObject.storageRelativePath);
  let stats;
  try {
    stats = await fs.stat(objectPath);
  } catch {
    return false;
  }
  if (Number(rawObject.byteSize || 0) > 0 && stats.size !== Number(rawObject.byteSize || 0)) {
    return false;
  }
  if (rawObject.sha256) {
    return (await hashFileSha256(objectPath)) === rawObject.sha256;
  }
  return true;
}

export async function validateImportCheckpointEntry({
  userDataPath,
  entry,
  expectedSignature
}) {
  if (!entry || entry.status !== "completed") {
    return false;
  }
  if (stableJson(entry.signature || {}) !== stableJson(expectedSignature || {})) {
    return false;
  }

  for (const source of entry.sources || []) {
    if (!(await validateRawObject({ userDataPath, rawObject: source.rawObject }))) {
      return false;
    }
    if (source.kind === "image") {
      const material = await readMaterialBuffer({ userDataPath, source });
      if (!material) {
        return false;
      }
    }
  }
  return true;
}

export function rawObjectPathsFromSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .map((source) => normalizeRelativePath(source?.rawObject?.storageRelativePath || ""))
    .filter(Boolean);
}

export async function collectProtectedRawObjectPaths({
  userDataPath,
  batchId,
  expectedEntries = []
}) {
  const protectedPaths = new Set();
  for (const expected of expectedEntries) {
    const entry = await loadImportCheckpointEntry({
      userDataPath,
      batchId,
      entryId: expected.entryId
    });
    if (
      await validateImportCheckpointEntry({
        userDataPath,
        entry,
        expectedSignature: expected.signature
      })
    ) {
      for (const rawPath of rawObjectPathsFromSources(entry.sources)) {
        protectedPaths.add(rawPath);
      }
    }
  }
  return protectedPaths;
}

async function cleanupTempRoots({ userDataPath, minimumAgeMs = 0 }) {
  const deleted = [];
  const now = Date.now();
  for (const rootName of TMP_ROOT_NAMES) {
    const rootPath = resolveWithin(userDataPath, "tmp", rootName);
    for (const filePath of await listFilesRecursively(rootPath)) {
      try {
        const stats = await fs.stat(filePath);
        if (minimumAgeMs > 0 && now - stats.mtimeMs < minimumAgeMs) {
          continue;
        }
        await fs.rm(filePath, { force: true });
        deleted.push(toPosixRelative(userDataPath, filePath));
      } catch {
        // Best-effort cleanup.
      }
    }
    await removeEmptyDirectories(rootPath);
  }
  return deleted;
}

async function cleanupUnprotectedRawObjects({
  userDataPath,
  batchId,
  protectedRawObjectPaths = new Set()
}) {
  const objectRoot = resolveWithin(userDataPath, "objects");
  const safeBatchSuffix = String(batchId || "batch")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\s+/g, "_")
    .slice(0, 96) || "batch";
  const belongsToBatch = (relativePath) => {
    const normalized = normalizeRelativePath(relativePath);
    const fileName = path.posix.basename(normalized);
    const extension = path.posix.extname(fileName);
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;
    return stem.endsWith(`__${safeBatchSuffix}`) || stem.includes(`__${safeBatchSuffix}__`);
  };
  const deleted = [];
  for (const filePath of await listFilesRecursively(objectRoot)) {
    const relativePath = normalizeRelativePath(toPosixRelative(userDataPath, filePath));
    if (!belongsToBatch(relativePath)) {
      continue;
    }
    if (protectedRawObjectPaths.has(relativePath)) {
      continue;
    }
    try {
      await fs.rm(filePath, { force: true });
      deleted.push(relativePath);
    } catch {
      // Best-effort cleanup.
    }
  }
  await removeEmptyDirectories(objectRoot);
  return deleted;
}

export async function cleanupImportArtifacts({
  userDataPath,
  batchId,
  rawObjectBatchId = batchId,
  protectedRawObjectPaths = new Set(),
  cleanupTemp = true,
  tempMinimumAgeMs = 0
}) {
  const protectedSet =
    protectedRawObjectPaths instanceof Set
      ? protectedRawObjectPaths
      : new Set((protectedRawObjectPaths || []).map(normalizeRelativePath));
  const [deletedTempFiles, deletedRawObjectFiles] = await Promise.all([
    cleanupTemp ? cleanupTempRoots({ userDataPath, minimumAgeMs: tempMinimumAgeMs }) : [],
    rawObjectBatchId
      ? cleanupUnprotectedRawObjects({
          userDataPath,
          batchId: rawObjectBatchId,
          protectedRawObjectPaths: protectedSet
        })
      : []
  ]);
  return {
    deletedTempFiles,
    deletedRawObjectFiles
  };
}
