import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings } from "../../../common/platform-core/settings.mjs";
import { isSupportedImportFilePath } from "../preprocessing/file-processor/index.mjs";
import { serverToken } from "../../../common/security/client-strings.mjs";
import { createSourceFileRegistryStore } from "../../../common/storage/source-file-registry-store.mjs";
import {
  deleteKnowledgeSourceFileIndex,
  indexKnowledgeSourceFiles
} from "./source-file-index-service.mjs";
import {
  checkpointTreeId,
  deleteCheckpointTree,
  finishCheckpointTree,
  startCheckpointTree,
  upsertCheckpointNode
} from "../../../common/data-structure/checkpoint-tree-store.mjs";
import { atomicWriteJson } from "../../../common/platform-core/state-coordinator.mjs";

const CONFIG_DIR = "knowledge-sources";
const CONFIG_FILE = "sources.json";
const HYDRATION_CONFIG_FILE = "source-hydration.json";
const HYDRATED_DIR = "hydrated";
const DEFAULT_DEBOUNCE_MS = 1800;
const MAX_WATCHED_DIRECTORIES = 2000;
const DEFAULT_HYDRATION_TIMEOUT_MS = 60000;
const DEFAULT_HYDRATION_SAMPLE_BYTES = 65536;
const HYDRATION_FAILURE_SAMPLE_LIMIT = 20;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_HYDRATION_RULES_PATH = path.resolve(__dirname, "../../../../config/default-source-hydration.json");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__"
]);

function nowIso() {
  return new Date().toISOString();
}

function buildFileFingerprint(file = {}) {
  return `${Number(file.byteSize || 0)}:${Number(file.mtimeMs || 0)}`;
}

function sourcesPath(userDataPath) {
  return path.join(userDataPath, CONFIG_DIR, CONFIG_FILE);
}

function hydrationConfigPath(userDataPath) {
  return path.join(userDataPath, CONFIG_DIR, HYDRATION_CONFIG_FILE);
}

function hydratedRootPath(userDataPath) {
  return path.join(userDataPath, CONFIG_DIR, HYDRATED_DIR);
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value === true || value === "true" || value === "1" || value === "yes";
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function sourceStartupIndexEnabled() {
  return ["1", "true", "yes"].includes(
    String(process.env.PACT_SOURCE_INDEX_ON_STARTUP || "").trim().toLowerCase()
  );
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function normalizeSource(input = {}, previous = {}) {
  const timestamp = nowIso();
  const rawDirectoryPath = String(input.directoryPath || previous.directoryPath || "").trim();
  if (!rawDirectoryPath) {
    throw new Error("请填写服务端可访问的本地目录路径。");
  }
  const directoryPath = path.resolve(rawDirectoryPath);
  const defaultSourceId = `ks_${createHash("sha256").update(directoryPath).digest("hex")}`;
  const sourceId = String(previous.sourceId || input.sourceId || defaultSourceId).trim();
  return {
    sourceId,
    label: String(input.label || previous.label || path.basename(directoryPath) || "本地目录").trim(),
    directoryPath,
    enabled: normalizeBoolean(input.enabled, previous.enabled ?? true),
    autoSync: normalizeBoolean(input.autoSync, previous.autoSync ?? true),
    recursive: normalizeBoolean(input.recursive, previous.recursive ?? true),
    debounceMs: Math.max(300, Math.min(30000, Number(input.debounceMs || previous.debounceMs || DEFAULT_DEBOUNCE_MS))),
    hydrationEnabled: normalizeBoolean(input.hydrationEnabled, previous.hydrationEnabled ?? true),
    hydrationPolicy: String(input.hydrationPolicy || previous.hydrationPolicy || "auto").trim() || "auto",
    hydrationTimeoutMs: normalizeInteger(
      input.hydrationTimeoutMs || previous.hydrationTimeoutMs,
      DEFAULT_HYDRATION_TIMEOUT_MS,
      1000,
      600000
    ),
    hydrationCommand: String(input.hydrationCommand || previous.hydrationCommand || "").trim(),
    hydrationArgs: normalizeStringArray(input.hydrationArgs || previous.hydrationArgs),
    createdAt: previous.createdAt || timestamp,
    updatedAt: timestamp,
    status: previous.status || "idle",
    watcherStatus: previous.watcherStatus || "stopped",
    watcherCount: Number(previous.watcherCount || 0),
    lastEventAt: previous.lastEventAt || "",
    lastScanAt: previous.lastScanAt || "",
    lastSyncedAt: previous.lastSyncedAt || "",
    lastSnapshotHash: previous.lastSnapshotHash || "",
    lastHydratedSnapshotHash: previous.lastHydratedSnapshotHash || "",
    lastHydrationAt: previous.lastHydrationAt || "",
    lastHydrationStatus: previous.lastHydrationStatus || "",
    lastHydratedFileCount: Number(previous.lastHydratedFileCount || 0),
    lastHydrationFailedCount: Number(previous.lastHydrationFailedCount || 0),
	    lastHydrationSkippedCount: Number(previous.lastHydrationSkippedCount || 0),
	    lastHydrationFailureSamples: Array.isArray(previous.lastHydrationFailureSamples)
	      ? previous.lastHydrationFailureSamples.slice(0, HYDRATION_FAILURE_SAMPLE_LIMIT)
	      : [],
	    indexStatus: previous.indexStatus || "idle",
	    lastIndexAt: previous.lastIndexAt || "",
	    lastIndexReason: previous.lastIndexReason || "",
	    lastIndexSnapshotHash: previous.lastIndexSnapshotHash || "",
	    lastIndexedFileCount: Number(previous.lastIndexedFileCount || 0),
	    lastIndexSkippedCount: Number(previous.lastIndexSkippedCount || 0),
	    lastIndexFailedCount: Number(previous.lastIndexFailedCount || 0),
	    lastIndexError: previous.lastIndexError || "",
	    lastIndexCheckpointTreeId: previous.lastIndexCheckpointTreeId || "",
	    lastFileCount: Number(previous.lastFileCount || 0),
    lastTotalBytes: Number(previous.lastTotalBytes || 0),
    lastJobId: previous.lastJobId || "",
    lastJobStatus: previous.lastJobStatus || "",
	    lastJobStage: previous.lastJobStage || "",
	    lastJobProgressPercent: Number(previous.lastJobProgressPercent || 0),
	    lastSyncCheckpointTreeId: previous.lastSyncCheckpointTreeId || "",
      currentRunId: previous.currentRunId || "",
      syncRetryAttempt: Number(previous.syncRetryAttempt || 0),
      nextRetryAt: previous.nextRetryAt || "",
	    pendingReason: previous.pendingReason || "",
    error: ""
  };
}

function publicSource(source, job = null) {
  return {
    ...source,
    lastJobStatus: job?.status || source.lastJobStatus || "",
    lastJobStage: job?.stage || source.lastJobStage || "",
    lastJobProgressPercent: Number(job?.progressPercent ?? source.lastJobProgressPercent ?? 0),
    lastJobUpdatedAt: job?.updatedAt || ""
  };
}

async function readSources(userDataPath) {
  try {
    const raw = await fs.readFile(sourcesPath(userDataPath), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.sources)
      ? parsed.sources.map((item) => {
        const normalized = normalizeSource(item, item);
        normalized.updatedAt = String(item?.updatedAt || normalized.updatedAt || "");
        return normalized;
      })
      : [];
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeSources(userDataPath, sources) {
  const filePath = sourcesPath(userDataPath);
  await atomicWriteJson(filePath, {
    schemaVersion: 1,
    updatedAt: nowIso(),
    sources
  });
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function normalizeExtension(value = "") {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function compileTextSignature(entry = {}) {
  const pattern = String(entry.pattern || "").trim();
  if (!pattern) {
    return null;
  }
  try {
    return {
      id: String(entry.id || pattern).trim(),
      regex: new RegExp(pattern, String(entry.flags || "")),
      extensions: normalizeStringArray(entry.extensions).map(normalizeExtension).filter(Boolean)
    };
  } catch {
    return null;
  }
}

async function loadHydrationRules(userDataPath) {
  const defaults = await readJsonIfExists(DEFAULT_HYDRATION_RULES_PATH, {});
  const override = await readJsonIfExists(hydrationConfigPath(userDataPath), {});
  const replaceExtensions = override?.placeholderExtensionsMode === "replace";
  const replaceSignatures = override?.placeholderTextSignaturesMode === "replace";
  const merged = {
    ...(defaults || {}),
    ...(override || {}),
    placeholderExtensions: [
      ...(replaceExtensions ? [] : normalizeStringArray(defaults?.placeholderExtensions)),
      ...normalizeStringArray(override?.placeholderExtensions)
    ],
    placeholderTextSignatures: [
      ...(replaceSignatures ? [] : Array.isArray(defaults?.placeholderTextSignatures) ? defaults.placeholderTextSignatures : []),
      ...(Array.isArray(override?.placeholderTextSignatures) ? override.placeholderTextSignatures : [])
    ]
  };
  return {
    schemaVersion: Number(merged.schemaVersion || 1),
    sampleBytes: normalizeInteger(
      merged.sampleBytes,
      DEFAULT_HYDRATION_SAMPLE_BYTES,
      256,
      1024 * 1024
    ),
    timeoutMs: normalizeInteger(
      merged.timeoutMs,
      DEFAULT_HYDRATION_TIMEOUT_MS,
      1000,
      600000
    ),
    zeroByteAsPlaceholder: normalizeBoolean(merged.zeroByteAsPlaceholder, true),
    placeholderExtensions: [
      ...new Set(normalizeStringArray(merged.placeholderExtensions).map(normalizeExtension).filter(Boolean))
    ],
    placeholderTextSignatures: merged.placeholderTextSignatures
      .map(compileTextSignature)
      .filter(Boolean)
  };
}

function shouldIgnoreDirectory(directoryName) {
  return IGNORED_DIRECTORIES.has(directoryName);
}

async function scanDirectory(directoryPath, { recursive = true, includeExtensions = [] } = {}) {
  const root = path.resolve(directoryPath);
  const extraIncludeExtensions = new Set(normalizeStringArray(includeExtensions).map(normalizeExtension).filter(Boolean));
  const files = [];
  const directories = [];
  let totalBytes = 0;

  async function visit(currentPath) {
    const directoryName = path.basename(currentPath);
    if (currentPath !== root && shouldIgnoreDirectory(directoryName)) {
      return;
    }
    directories.push(currentPath);
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          await visit(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = normalizeExtension(path.extname(absolutePath));
      if (!extraIncludeExtensions.has(extension) && !(await isSupportedImportFilePath(absolutePath))) {
        continue;
      }
      const stats = await fs.stat(absolutePath);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      totalBytes += stats.size;
      files.push({
        relativePath,
        byteSize: stats.size,
        mtimeMs: Math.floor(stats.mtimeMs)
      });
    }
  }

  await visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const manifestSha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return {
    root,
    files,
    directories,
    manifestSha256,
    fileCount: files.length,
    totalBytes
  };
}

function createKnowledgeSourceFingerprintStore(userDataPath) {
  return createSourceFileRegistryStore({ userDataPath });
}

function computeScanDelta(scannedFiles = [], previousFingerprints = new Map()) {
  const currentByPath = new Map();
  const changed = [];
  const added = [];
  const unchanged = [];

  for (const file of scannedFiles) {
    const fingerprint = buildFileFingerprint(file);
    currentByPath.set(file.relativePath, { ...file, fingerprint });
    const previous = previousFingerprints.get(file.relativePath);
    if (!previous) {
      added.push({ ...file, fingerprint });
      continue;
    }
    if (String(previous.fingerprint || "") !== fingerprint) {
      changed.push({ ...file, fingerprint });
      continue;
    }
    unchanged.push({ ...file, fingerprint });
  }

  const removed = [];
  for (const previous of previousFingerprints.values()) {
    if (!currentByPath.has(previous.relativePath)) {
      removed.push(previous.relativePath);
    }
  }

  return {
    added,
    changed,
    removed,
    unchanged,
    deltaFiles: [...added, ...changed]
  };
}

async function scanWatchDirectories(directoryPath, { recursive = true, limit = MAX_WATCHED_DIRECTORIES } = {}) {
  const root = path.resolve(directoryPath);
  const directories = [];
  const safeLimit = Math.max(1, Math.min(Number(limit || MAX_WATCHED_DIRECTORIES), MAX_WATCHED_DIRECTORIES));
  let truncated = false;

  async function visit(currentPath) {
    if (directories.length >= safeLimit) {
      truncated = true;
      return;
    }
    const directoryName = path.basename(currentPath);
    if (currentPath !== root && shouldIgnoreDirectory(directoryName)) {
      return;
    }
    directories.push(currentPath);
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (directories.length >= safeLimit) {
        truncated = true;
        return;
      }
      if (entry.isDirectory() && recursive) {
        await visit(path.join(currentPath, entry.name));
      }
    }
  }

  await visit(root);
  return {
    root,
    directories,
    truncated
  };
}

function timeoutError(ms) {
  const error = new Error(`文件自动下载超时（${ms}ms）。`);
  error.code = "HYDRATION_TIMEOUT";
  return error;
}

async function withTimeout(promise, ms) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(ms)), ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function readFileSample(filePath, { sampleBytes, timeoutMs }) {
  return withTimeout((async () => {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(sampleBytes);
      const { bytesRead } = await handle.read(buffer, 0, sampleBytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  })(), timeoutMs);
}

function detectPlaceholder({ file, stats, sample, rules }) {
  const extension = normalizeExtension(path.extname(file.relativePath));
  if (rules.zeroByteAsPlaceholder && Number(stats.size || 0) === 0) {
    return {
      isPlaceholder: true,
      reason: "zero_byte"
    };
  }
  if (rules.placeholderExtensions.includes(extension)) {
    return {
      isPlaceholder: true,
      reason: `placeholder_extension:${extension}`
    };
  }
  const sampleText = sample && sample.length > 0
    ? sample.subarray(0, Math.min(sample.length, 65536)).toString("utf8")
    : "";
  if (sampleText) {
    for (const signature of rules.placeholderTextSignatures) {
      if (signature.extensions.length > 0 && !signature.extensions.includes(extension)) {
        continue;
      }
      if (signature.regex.test(sampleText)) {
        return {
          isPlaceholder: true,
          reason: `placeholder_signature:${signature.id}`
        };
      }
    }
  }
  return {
    isPlaceholder: false,
    reason: ""
  };
}

function templateArg(value, variables) {
  return String(value || "").replace(/\{\{\s*(sourcePath|relativePath|targetPath|directoryPath)\s*\}\}/g, (_, key) =>
    variables[key] || ""
  );
}

async function runHydrationCommand({ source, sourcePath, relativePath, targetPath, timeoutMs }) {
  const command = String(source.hydrationCommand || "").trim();
  if (!command) {
    throw new Error("文件疑似云端占位文件，但未配置自动下载命令。");
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const variables = {
    sourcePath,
    relativePath,
    targetPath,
    directoryPath: source.directoryPath
  };
  const args = normalizeStringArray(source.hydrationArgs).map((arg) => templateArg(arg, variables));
  try {
    await withTimeout(new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        stdio: ["ignore", "ignore", "pipe"]
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > 4096) {
          stderr = stderr.slice(-4096);
        }
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`hydrationCommand 退出码 ${code}${stderr ? `：${stderr.trim()}` : ""}`));
      });
    }), timeoutMs);
    const hydratedStats = await fs.stat(targetPath);
    if (!hydratedStats.isFile() || Number(hydratedStats.size || 0) <= 0) {
      throw new Error("自动下载命令未生成可读文件。");
    }
    return {
      absolutePath: targetPath,
      byteSize: Number(hydratedStats.size || 0),
      mtimeMs: Math.floor(hydratedStats.mtimeMs),
      hydrated: true
    };
  } catch (error) {
    await fs.rm(targetPath, { force: true }).catch(() => null);
    throw error;
  }
}

async function reuseHydratedFileIfPresent(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isFile() || Number(stats.size || 0) <= 0) {
      return null;
    }
    return {
      absolutePath: targetPath,
      byteSize: Number(stats.size || 0),
      mtimeMs: Math.floor(stats.mtimeMs),
      hydrated: true,
      reused: true
    };
  } catch {
    return null;
  }
}

async function prepareKnowledgeSourceFiles({
  userDataPath,
  source,
  scanned,
  rules,
  checkpoint = null,
  shouldCancel = null
}) {
  const hydrationEnabled = source.hydrationEnabled !== false;
  const timeoutMs = Math.max(1000, Number(source.hydrationTimeoutMs || rules.timeoutMs || DEFAULT_HYDRATION_TIMEOUT_MS));
  const sampleBytes = Math.max(256, Number(rules.sampleBytes || DEFAULT_HYDRATION_SAMPLE_BYTES));
  const stageRoot = path.join(hydratedRootPath(userDataPath), source.sourceId, scanned.manifestSha256);
  const fileEntries = [];
  const checkpointFiles = [];
  const failures = [];
  const skipped = [];
  let commandHydratedCount = 0;
  let reusedHydratedCount = 0;
  let manifestRequired = false;
  let processedCount = 0;

  async function reportPrepareProgress(file, status = "running") {
    if (!checkpoint?.treeId) {
      return;
    }
    processedCount += 1;
    if (
      status === "completed" ||
      processedCount === scanned.files.length ||
      processedCount % 20 === 0
    ) {
      await upsertCheckpointNode({
        userDataPath,
        treeId: checkpoint.treeId,
        nodeId: "prepare-source-files",
        parentId: "source-sync",
        label: "自动下载与解析清单准备",
        status: processedCount >= scanned.files.length ? "completed" : "running",
        totals: {
          total: scanned.files.length,
          processed: processedCount,
          hydrated: commandHydratedCount,
          reusedHydrated: reusedHydratedCount,
          failed: failures.length,
          skipped: skipped.length
        },
        cursor: {
          processed: processedCount,
          total: scanned.files.length,
          lastRelativePath: file?.relativePath || ""
        }
      });
    }
  }

  for (const file of scanned.files) {
    if (typeof shouldCancel === "function" && shouldCancel()) {
      throw new Error("SOURCE_SYNC_PREEMPTED");
    }
    const sourcePath = path.join(scanned.root, file.relativePath);
    const baseEntry = {
      relativePath: file.relativePath,
      byteSize: file.byteSize,
      mtimeMs: file.mtimeMs
    };
    if (!hydrationEnabled || source.hydrationPolicy === "disabled") {
      fileEntries.push({
        absolutePath: sourcePath,
        relativePath: file.relativePath
      });
      checkpointFiles.push(baseEntry);
      await reportPrepareProgress(file);
      continue;
    }
    try {
      const stats = await fs.stat(sourcePath);
      const cheapPlaceholder = detectPlaceholder({
        file,
        stats,
        sample: Buffer.alloc(0),
        rules
      });
      if (cheapPlaceholder.isPlaceholder) {
        const targetPath = path.join(stageRoot, "files", file.relativePath);
        const hydrated = await reuseHydratedFileIfPresent(targetPath) || await runHydrationCommand({
          source,
          sourcePath,
          relativePath: file.relativePath,
          targetPath,
          timeoutMs
        });
        fileEntries.push({
          absolutePath: hydrated.absolutePath,
          relativePath: file.relativePath,
          originalAbsolutePath: sourcePath
        });
        checkpointFiles.push({
          ...baseEntry,
          byteSize: hydrated.byteSize,
          hydrationStatus: "hydrated",
          hydrationReason: cheapPlaceholder.reason
        });
        if (hydrated.reused) {
          reusedHydratedCount += 1;
        } else {
          commandHydratedCount += 1;
        }
        manifestRequired = true;
        await reportPrepareProgress(file);
        continue;
      }
      const sample = await readFileSample(sourcePath, { sampleBytes, timeoutMs });
      const placeholder = detectPlaceholder({ file, stats, sample, rules });
      if (!placeholder.isPlaceholder) {
        fileEntries.push({
          absolutePath: sourcePath,
          relativePath: file.relativePath
        });
        checkpointFiles.push({
          ...baseEntry,
          byteSize: Number(stats.size || file.byteSize || 0),
          hydrationStatus: "readable"
        });
        await reportPrepareProgress(file);
        continue;
      }
      const targetPath = path.join(stageRoot, "files", file.relativePath);
      const hydrated = await reuseHydratedFileIfPresent(targetPath) || await runHydrationCommand({
        source,
        sourcePath,
        relativePath: file.relativePath,
        targetPath,
        timeoutMs
      });
      fileEntries.push({
        absolutePath: hydrated.absolutePath,
        relativePath: file.relativePath,
        originalAbsolutePath: sourcePath
      });
      checkpointFiles.push({
        ...baseEntry,
        byteSize: hydrated.byteSize,
        hydrationStatus: "hydrated",
        hydrationReason: placeholder.reason
      });
      if (hydrated.reused) {
        reusedHydratedCount += 1;
      } else {
        commandHydratedCount += 1;
      }
      manifestRequired = true;
      await reportPrepareProgress(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件自动下载失败。";
      failures.push({
        relativePath: file.relativePath,
        reason: message
      });
      skipped.push(baseEntry);
      manifestRequired = true;
      await reportPrepareProgress(file);
    }
  }

  const manifestSha256 = createHash("sha256").update(JSON.stringify({
    sourceId: source.sourceId,
    sourceManifestSha256: scanned.manifestSha256,
    files: checkpointFiles.map((file) => [
      file.relativePath,
      file.byteSize,
      file.mtimeMs,
      file.hydrationStatus || ""
    ]),
    skipped: skipped.map((file) => [file.relativePath, file.byteSize, file.mtimeMs])
  })).digest("hex");
  let fileManifestPath = "";
  if (manifestRequired) {
    fileManifestPath = path.join(stageRoot, "file-manifest.json");
    await fs.mkdir(path.dirname(fileManifestPath), { recursive: true });
    await fs.writeFile(
      fileManifestPath,
      JSON.stringify({
        schemaVersion: 1,
        sourceId: source.sourceId,
        sourceRoot: scanned.root,
        sourceManifestSha256: scanned.manifestSha256,
        manifestSha256,
        generatedAt: nowIso(),
        files: fileEntries,
        hydration: {
          enabled: hydrationEnabled,
          policy: source.hydrationPolicy,
          commandHydratedCount,
          reusedHydratedCount,
          failedCount: failures.length,
          skippedCount: skipped.length,
          failures: failures.slice(0, HYDRATION_FAILURE_SAMPLE_LIMIT)
        }
      }, null, 2),
      "utf8"
    );
  }
  return {
    manifestSha256,
    fileManifestPath,
    fileCount: fileEntries.length,
    totalBytes: checkpointFiles.reduce((sum, file) => sum + Number(file.byteSize || 0), 0),
    files: checkpointFiles,
    hydration: {
      enabled: hydrationEnabled,
      policy: source.hydrationPolicy,
      status: failures.length > 0
        ? "partial"
        : commandHydratedCount > 0 || reusedHydratedCount > 0
          ? "hydrated"
          : "readable",
      commandHydratedCount,
      reusedHydratedCount,
      failedCount: failures.length,
      skippedCount: skipped.length,
      failureSamples: failures.slice(0, HYDRATION_FAILURE_SAMPLE_LIMIT)
    }
  };
}

export function createKnowledgeSourceService({
  userDataPath,
  jobManager,
  protocolEventBus = null,
  watchingEnabled = process.env.PACT_SOURCE_WATCHER_EXTERNAL !== "1"
}) {
  const fingerprintStore = createKnowledgeSourceFingerprintStore(userDataPath);
  const sources = new Map();
  const watchers = new Map();
  const watcherSignatures = new Map();
  const timers = new Map();
  const activeIndexRuns = new Map();
  const activeSyncRuns = new Map();
  let ready = null;
  let persistChain = Promise.resolve();

  async function persist() {
    const snapshotSources = [...sources.values()].map((source) => ({ ...source }));
    persistChain = persistChain
      .catch(() => null)
      .then(() => writeSources(userDataPath, snapshotSources));
    return persistChain;
  }

  async function snapshot() {
    const items = await Promise.all(
      [...sources.values()].map(async (source) => {
        const job = source.lastJobId ? await jobManager.getJob(source.lastJobId) : null;
        return publicSource(source, job);
      })
    );
    return {
      schemaVersion: 1,
      updatedAt: nowIso(),
	      summary: {
	        totalCount: items.length,
	        enabledCount: items.filter((item) => item.enabled).length,
	        watchingCount: items.filter((item) => item.watcherStatus === "watching").length,
	        syncingCount: items.filter((item) => ["queued", "running"].includes(item.lastJobStatus)).length,
	        indexingCount: items.filter((item) => item.indexStatus === "indexing").length,
	        errorCount: items.filter((item) => item.error).length
	      },
      sources: items.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    };
  }

  async function publish(sourceId, type = "knowledge.sources.updated") {
    if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
      return;
    }
    await protocolEventBus.publish(
      "knowledge.sources",
      {
        state: await snapshot(),
        source: sourceId ? sources.get(sourceId) || null : null
      },
      { type }
    );
  }

  function closeWatchers(sourceId) {
    const entries = watchers.get(sourceId) || [];
    for (const watcher of entries) {
      try {
        watcher.close();
      } catch {
        // Ignore watcher close errors.
      }
    }
    watchers.delete(sourceId);
    watcherSignatures.delete(sourceId);
  }

  function sourceWatchSignature(source) {
    return JSON.stringify({
      sourceId: source?.sourceId || "",
      directoryPath: source?.directoryPath || "",
      enabled: source?.enabled !== false,
      autoSync: source?.autoSync !== false,
      recursive: source?.recursive !== false,
      debounceMs: Number(source?.debounceMs || DEFAULT_DEBOUNCE_MS)
    });
  }

	  async function startWatchingSource(sourceId) {
    const source = sources.get(sourceId);
    if (!source) {
      return;
    }
    closeWatchers(sourceId);
    if (!watchingEnabled) {
      Object.assign(source, {
        watcherStatus: "external",
        watcherCount: 0
      });
      watcherSignatures.set(sourceId, sourceWatchSignature(source));
      return;
    }
    if (!source.enabled || !source.autoSync) {
      Object.assign(source, {
        watcherStatus: "stopped",
        watcherCount: 0
      });
      watcherSignatures.set(sourceId, sourceWatchSignature(source));
      await persist();
      return;
    }

    try {
      const stats = await fs.stat(source.directoryPath);
      if (!stats.isDirectory()) {
        throw new Error("路径不是目录。");
      }
      const scanned = await scanWatchDirectories(source.directoryPath, {
        recursive: source.recursive,
        limit: MAX_WATCHED_DIRECTORIES
      });
      const directories = scanned.directories;
      const nextWatchers = [];
      for (const directory of directories) {
        const watcher = fsSync.watch(directory, { persistent: false }, (eventType, fileName) => {
          scheduleSourceSync(sourceId, fileName ? `${eventType}:${fileName}` : eventType);
        });
        watcher.on("error", (error) => {
          const current = sources.get(sourceId);
          if (!current) {
            return;
          }
          current.error = error instanceof Error ? error.message : "目录监听失败。";
          current.watcherStatus = "error";
          void persist();
          void publish(sourceId, "knowledge.sources.watch_error");
        });
        nextWatchers.push(watcher);
      }
      watchers.set(sourceId, nextWatchers);
      Object.assign(source, {
        watcherStatus: scanned.truncated ? "partial" : "watching",
        watcherCount: directories.length,
        error: directories.length ? "" : "目录下没有可监听的子目录。"
      });
      watcherSignatures.set(sourceId, sourceWatchSignature(source));
      await persist();
      await publish(sourceId, "knowledge.sources.watching");
    } catch (error) {
      Object.assign(source, {
        watcherStatus: "error",
        watcherCount: 0,
        error: error instanceof Error ? error.message : "目录监听失败。"
      });
      watcherSignatures.set(sourceId, sourceWatchSignature(source));
      await persist();
      await publish(sourceId, "knowledge.sources.watch_error");
	    }
	  }

		  async function triggerSourceIndex(sourceId, { reason = "manual", force = false } = {}) {
	    await ready;
	    const source = sources.get(sourceId);
	    if (!source) {
	      throw new Error("知识库目录不存在。");
	    }
	    if (!source.enabled) {
	      return {
	        skipped: true,
	        reason: "disabled",
	        source: publicSource(source)
	      };
	    }
	    if (activeIndexRuns.has(sourceId)) {
	      return {
	        skipped: true,
	        reason: "index_active",
	        source: publicSource(source)
	      };
	    }
		    const indexTreeId = checkpointTreeId("source-file-index", sourceId);
		    Object.assign(source, {
		      indexStatus: "indexing",
		      lastIndexReason: reason,
		      lastIndexError: "",
		      lastIndexCheckpointTreeId: indexTreeId,
		      updatedAt: nowIso()
		    });
		    await persist();
		    await publish(sourceId, "knowledge.sources.index_started");
        const run = (async () => {
		      try {
		        const result = await indexKnowledgeSourceFiles({
		          userDataPath,
	          source,
	          reason,
	          force
	        });
	        const current = sources.get(sourceId);
	        if (!current) {
	          return result;
	        }
	        Object.assign(current, {
	          indexStatus: result.error ? "failed" : "indexed",
	          lastIndexAt: result.indexedAt || nowIso(),
	          lastIndexReason: reason,
	          lastIndexSnapshotHash: result.snapshotHash || current.lastIndexSnapshotHash || "",
	          lastIndexedFileCount: Number(result.indexedCount || 0),
		          lastIndexSkippedCount: Number(result.skippedCount || 0),
		          lastIndexFailedCount: Number(result.failedCount || 0),
		          lastIndexError: result.error || "",
		          lastIndexCheckpointTreeId: result.checkpointTreeId || indexTreeId,
		          updatedAt: nowIso()
		        });
	        await persist();
	        await publish(sourceId, result.error ? "knowledge.sources.index_failed" : "knowledge.sources.index_completed");
	        return result;
	      } catch (error) {
	        const current = sources.get(sourceId);
	        const message = error instanceof Error ? error.message : "原文倒排索引失败。";
	        if (current) {
	          Object.assign(current, {
	            indexStatus: "failed",
	            lastIndexAt: nowIso(),
	            lastIndexReason: reason,
	            lastIndexError: message,
	            updatedAt: nowIso()
	          });
	          await persist();
	          await publish(sourceId, "knowledge.sources.index_failed");
	        }
	        return {
	          skipped: false,
	          reason,
	          sourceId,
	          error: message,
	          fileCount: 0,
	          indexedCount: 0,
	          skippedCount: 0,
	          failedCount: 1
	        };
	      } finally {
	        activeIndexRuns.delete(sourceId);
	      }
        })();
	    activeIndexRuns.set(sourceId, run);
	    return run;
	  }

      async function triggerSourceSync(sourceId, { reason = "manual", force = false } = {}) {
        await ready;
        let source = sources.get(sourceId);
        if (!source) {
          throw new Error("知识库目录不存在。");
        }
        if (!source.enabled) {
          throw new Error("知识库目录已停用。");
        }

        const previousRun = activeSyncRuns.get(sourceId);
        if (previousRun?.token) {
          previousRun.token.cancelled = true;
          previousRun.token.cancelReason = "superseded_by_newer_sync";
        }

        const token = {
          runId: randomUUID(),
          cancelled: false,
          cancelReason: ""
        };

        const run = (async () => {
          source = sources.get(sourceId);
          if (!source) {
            throw new Error("知识库目录不存在。");
          }
          if (!source.enabled) {
            throw new Error("知识库目录已停用。");
          }

          const assertActive = () => {
            const current = activeSyncRuns.get(sourceId);
            if (token.cancelled || !current || current.token !== token) {
              throw new Error("SOURCE_SYNC_PREEMPTED");
            }
          };

          const syncTreeId = checkpointTreeId("knowledge-source-sync", sourceId);
          await startCheckpointTree({
            userDataPath,
            treeId: syncTreeId,
            kind: "knowledge_source_sync",
            ownerId: sourceId,
            rootNodeId: "source-sync",
            rootLabel: "目录扫描与注册入库",
            metadata: {
              sourceId,
              reason,
              runId: token.runId,
              directoryPath: source.directoryPath
            },
            resumePolicy: {
              mode: "manifest-cursor",
              idempotencyKey: "sourceId+sourceManifestSha256",
              reusableState: "knowledge_source_file_fingerprints + knowledge_source_registry_files"
            },
            resetOnInputHashChange: false
          });
          Object.assign(source, {
            status: "syncing",
            lastSyncCheckpointTreeId: syncTreeId,
            pendingReason: reason,
            currentRunId: token.runId,
            updatedAt: nowIso()
          });

          try {
            assertActive();
            await upsertCheckpointNode({
              userDataPath,
              treeId: syncTreeId,
              nodeId: "scan-source-for-sync",
              parentId: "source-sync",
              label: "扫描可解析文件",
              status: "running",
              metadata: {
                recursive: source.recursive !== false
              }
            });
            const hydrationRules = source.hydrationEnabled === false
              ? null
              : await loadHydrationRules(userDataPath);
            const scanned = await scanDirectory(source.directoryPath, {
              recursive: source.recursive,
              includeExtensions: hydrationRules?.placeholderExtensions || []
            });
            assertActive();

            const previousFingerprints = fingerprintStore.listBySource(sourceId);
            const delta = computeScanDelta(scanned.files, previousFingerprints);
            const removedAbsolutePaths = delta.removed.map((relativePath) => path.join(source.directoryPath, relativePath));

            await startCheckpointTree({
              userDataPath,
              treeId: syncTreeId,
              kind: "knowledge_source_sync",
              ownerId: sourceId,
              inputHash: scanned.manifestSha256,
              rootNodeId: "source-sync",
              rootLabel: "目录同步与解析入队",
              metadata: {
                sourceId,
                reason,
                runId: token.runId,
                directoryPath: source.directoryPath,
                fileCount: scanned.fileCount,
                totalBytes: scanned.totalBytes,
                deltaAdded: delta.added.length,
                deltaChanged: delta.changed.length,
                deltaRemoved: delta.removed.length
              },
              resumePolicy: {
                mode: "manifest-cursor",
                idempotencyKey: "sourceId+sourceManifestSha256",
                reusableState: "knowledge_source_file_fingerprints + knowledge_source_registry_files"
              },
              resetOnInputHashChange: true
            });
            await upsertCheckpointNode({
              userDataPath,
              treeId: syncTreeId,
              nodeId: "scan-source-for-sync",
              parentId: "source-sync",
              label: "扫描可解析文件",
              status: "completed",
              totals: {
                fileCount: scanned.fileCount,
                totalBytes: scanned.totalBytes,
                added: delta.added.length,
                changed: delta.changed.length,
                removed: delta.removed.length
              },
              cursor: {
                sourceManifestSha256: scanned.manifestSha256
              }
            });

            Object.assign(source, {
              lastScanAt: nowIso(),
              lastFileCount: scanned.fileCount,
              lastTotalBytes: scanned.totalBytes,
              pendingReason: reason,
              updatedAt: nowIso()
            });

            if (scanned.fileCount === 0) {
              if (previousFingerprints.size > 0) {
                fingerprintStore.applyDelta({
                  sourceId,
                  scanId: token.runId,
                  files: [],
                  removedPaths: [...previousFingerprints.keys()]
                });
                fingerprintStore.syncRegistryFiles({
                  source,
                  scanId: token.runId,
                  files: [],
                  removedPaths: [...previousFingerprints.keys()]
                });
                fingerprintStore.purgePersistedSourcePaths(
                  [...previousFingerprints.keys()].map((relativePath) => path.join(source.directoryPath, relativePath))
                );
              }
              await upsertCheckpointNode({
                userDataPath,
                treeId: syncTreeId,
                nodeId: "no-parseable-files",
                parentId: "source-sync",
                label: "没有可解析文件",
                status: "skipped"
              });
              await finishCheckpointTree({
                userDataPath,
                treeId: syncTreeId,
                status: "skipped",
                message: "Source directory contains no supported files to register."
              });
              Object.assign(source, {
                status: "idle",
                error: "",
                pendingReason: "",
                lastSnapshotHash: scanned.manifestSha256,
                lastSyncedAt: nowIso(),
                lastHydratedSnapshotHash: "",
                lastHydrationStatus: "",
                lastHydratedFileCount: 0,
                lastHydrationFailedCount: 0,
                lastHydrationSkippedCount: 0,
                lastHydrationFailureSamples: [],
                lastJobId: "",
                lastJobStatus: "",
                lastJobStage: "",
                lastJobProgressPercent: 0,
                syncRetryAttempt: 0,
                nextRetryAt: ""
              });
              await persist();
              await startWatchingSource(sourceId);
              await publish(sourceId, "knowledge.sources.registry_updated");
              return {
                skipped: true,
                reason: "empty",
                source: publicSource(source)
              };
            }

            if (!force && delta.deltaFiles.length === 0 && delta.removed.length === 0) {
              const shouldIndexUnchangedSnapshot =
                !source.lastIndexAt || source.lastIndexSnapshotHash !== scanned.manifestSha256;
              await upsertCheckpointNode({
                userDataPath,
                treeId: syncTreeId,
                nodeId: "reuse-existing-sync",
                parentId: "source-sync",
                label: "复用已有目录同步结果",
                status: "completed",
                cursor: {
                  sourceManifestSha256: scanned.manifestSha256
                }
              });
              await finishCheckpointTree({
                userDataPath,
                treeId: syncTreeId,
                status: "completed",
                message: "Source registry reused unchanged snapshot.",
                metadata: {
                  sourceManifestSha256: scanned.manifestSha256
                }
              });
              Object.assign(source, {
                status: "idle",
                error: "",
                pendingReason: "",
                syncRetryAttempt: 0,
                nextRetryAt: "",
                updatedAt: nowIso()
              });
              await persist();
              await startWatchingSource(sourceId);
              await publish(sourceId, "knowledge.sources.unchanged");
              const indexResult = shouldIndexUnchangedSnapshot
                ? await triggerSourceIndex(sourceId, {
                  reason: `${reason}:sync_snapshot`,
                  force: false
                })
                : null;
              const latestSource = sources.get(sourceId) || source;
              return {
                skipped: false,
                reason: "unchanged",
                source: publicSource(latestSource),
                index: indexResult
              };
            }

            await upsertCheckpointNode({
              userDataPath,
              treeId: syncTreeId,
              nodeId: "register-source-files",
              parentId: "source-sync",
              label: "注册目录文件到数据库",
              status: "running",
              totals: {
                added: delta.added.length,
                changed: delta.changed.length,
                removed: delta.removed.length,
                total: scanned.fileCount
              }
            });
            fingerprintStore.applyDelta({
              sourceId,
              scanId: token.runId,
              files: scanned.files,
              removedPaths: delta.removed
            });
            fingerprintStore.syncRegistryFiles({
              source,
              scanId: token.runId,
              files: scanned.files,
              removedPaths: delta.removed
            });
            if (removedAbsolutePaths.length > 0) {
              fingerprintStore.purgePersistedSourcePaths(removedAbsolutePaths);
            }
            await upsertCheckpointNode({
              userDataPath,
              treeId: syncTreeId,
              nodeId: "register-source-files",
              parentId: "source-sync",
              label: "注册目录文件到数据库",
              status: "completed",
              metadata: {
                sourceId,
                registeredFileCount: scanned.fileCount
              }
            });

            const prepared = await prepareKnowledgeSourceFiles({
              userDataPath,
              source,
              scanned,
              rules: hydrationRules || await loadHydrationRules(userDataPath),
              checkpoint: {
                treeId: syncTreeId
              },
              shouldCancel: () => token.cancelled
            });
            await upsertCheckpointNode({
              userDataPath,
              treeId: syncTreeId,
              nodeId: "prepare-source-files",
              parentId: "source-sync",
              label: "自动下载与解析清单准备",
              status: "completed",
              totals: {
                sourceFileCount: scanned.fileCount,
                preparedFileCount: prepared.fileCount,
                hydrated: prepared.hydration.commandHydratedCount,
                reusedHydrated: prepared.hydration.reusedHydratedCount,
                failed: prepared.hydration.failedCount,
                skipped: prepared.hydration.skippedCount
              },
              cursor: {
                sourceManifestSha256: scanned.manifestSha256,
                hydratedManifestSha256: prepared.manifestSha256
              }
            });
            Object.assign(source, {
              lastHydrationAt: nowIso(),
              lastHydrationStatus: prepared.hydration.status,
              lastHydratedFileCount: prepared.fileCount,
              lastHydrationFailedCount: prepared.hydration.failedCount,
              lastHydrationSkippedCount: prepared.hydration.skippedCount,
              lastHydrationFailureSamples: prepared.hydration.failureSamples,
              lastHydratedSnapshotHash: prepared.manifestSha256
            });

            if (prepared.fileCount === 0) {
              await upsertCheckpointNode({
                userDataPath,
                treeId: syncTreeId,
                nodeId: "hydration-empty",
                parentId: "source-sync",
                label: "没有可入队解析的文件",
                status: "skipped",
                totals: {
                  failed: prepared.hydration.failedCount,
                  skipped: prepared.hydration.skippedCount
                }
              });
              await finishCheckpointTree({
                userDataPath,
                treeId: syncTreeId,
                status: "skipped",
                message: "Source sync produced no parseable files after hydration.",
                metadata: {
                  hydration: prepared.hydration
                }
              });
              Object.assign(source, {
                status: "idle",
                error: prepared.hydration.failedCount > 0
                  ? "可解析文件都需要先完成云端文件自动下载。"
                  : "目录中没有可解析的文件。",
                pendingReason: "",
                updatedAt: nowIso()
              });
              fingerprintStore.upsertRegistrySource(source);
              await persist();
              await startWatchingSource(sourceId);
              await publish(sourceId, "knowledge.sources.hydration_empty");
              return {
                skipped: true,
                reason: "hydration_empty",
                source: publicSource(source)
              };
            }

            const checkpointId = serverToken("checkpoint", "knowledge-source", sourceId, prepared.manifestSha256);
            const settings = await loadSettings(userDataPath);
            const job = await jobManager.createJob({
              inputText: "",
              filePaths: prepared.fileManifestPath ? [] : [source.directoryPath],
              fileManifestPath: prepared.fileManifestPath,
              uploadedFiles: [],
              settings,
              checkpoint: {
                checkpointId,
                mode: "knowledge-source"
              },
              checkpointId,
              checkpointReceipt: {
                checkpointId,
                verifiedAt: nowIso(),
                manifestSha256: prepared.manifestSha256,
                sourceManifestSha256: scanned.manifestSha256,
                fileCount: prepared.fileCount,
                sourceFileCount: scanned.fileCount,
                hydration: prepared.hydration,
                fileManifestPath: prepared.fileManifestPath,
                files: prepared.files.slice(0, 500).map((file) => ({
                  name: file.relativePath,
                  relativePath: file.relativePath,
                  sha256: "",
                  byteSize: file.byteSize,
                  hydrationStatus: file.hydrationStatus || "readable"
                }))
              },
              knowledgeSource: {
                sourceId,
                label: source.label,
                directoryPath: source.directoryPath,
                reason,
                syncCheckpointTreeId: syncTreeId,
                hydration: prepared.hydration,
                fileManifestPath: prepared.fileManifestPath
              }
            });
            await upsertCheckpointNode({
              userDataPath,
              treeId: syncTreeId,
              nodeId: "create-parse-job",
              parentId: "source-sync",
              label: "创建解析任务",
              status: "completed",
              metadata: {
                jobId: job.id,
                jobStatus: job.status,
                checkpointId,
                jobCheckpointTreeId: job.checkpointTreeId || ""
              },
              cursor: {
                sourceManifestSha256: scanned.manifestSha256,
                hydratedManifestSha256: prepared.manifestSha256
              }
            });
            await finishCheckpointTree({
              userDataPath,
              treeId: syncTreeId,
              status: "completed",
              message: "Source sync handed off to parse job.",
              metadata: {
                jobId: job.id,
                checkpointId,
                jobCheckpointTreeId: job.checkpointTreeId || "",
                sourceManifestSha256: scanned.manifestSha256,
                hydratedManifestSha256: prepared.manifestSha256
              }
            });
            Object.assign(source, {
              status: "syncing",
              error: "",
              pendingReason: "",
              lastSnapshotHash: scanned.manifestSha256,
              lastSyncedAt: nowIso(),
              lastJobId: job.id,
              lastJobStatus: job.status,
              lastJobStage: job.stage,
              lastJobProgressPercent: Number(job.progressPercent || 0),
              syncRetryAttempt: 0,
              nextRetryAt: "",
              updatedAt: nowIso()
            });
            fingerprintStore.upsertRegistrySource(source);
            await persist();
            await startWatchingSource(sourceId);
            await publish(sourceId, "knowledge.sources.sync_started");
            const indexResult = await triggerSourceIndex(sourceId, {
              reason: `${reason}:sync_job`,
              force: false
            });
            return {
              skipped: false,
              job,
              source: publicSource(source, job),
              registry: {
                fileCount: scanned.fileCount,
                addedCount: delta.added.length,
                changedCount: delta.changed.length,
                removedCount: delta.removed.length
              },
              index: indexResult
            };
          } catch (error) {
            const isPreempted = error instanceof Error && error.message === "SOURCE_SYNC_PREEMPTED";
            const message = isPreempted
              ? "目录同步已被更高优先级的新扫描替换。"
              : error instanceof Error
                ? error.message
                : "目录同步失败。";

            await upsertCheckpointNode({
              userDataPath,
              treeId: syncTreeId,
              nodeId: isPreempted ? "source-sync-preempted" : "source-sync-error",
              parentId: "source-sync",
              label: isPreempted ? "目录同步被新任务替换" : "目录同步失败",
              status: isPreempted ? "skipped" : "failed",
              error: message
            }).catch(() => null);
            await finishCheckpointTree({
              userDataPath,
              treeId: syncTreeId,
              status: isPreempted ? "skipped" : "failed",
              message,
              metadata: {
                error: message,
                preempted: isPreempted
              }
            }).catch(() => null);

            const current = sources.get(sourceId);
            if (current) {
              if (isPreempted) {
                Object.assign(current, {
                  status: "pending",
                  pendingReason: "preempted",
                  updatedAt: nowIso()
                });
                await persist();
                await publish(sourceId, "knowledge.sources.sync_preempted");
                return {
                  skipped: true,
                  reason: "preempted",
                  source: publicSource(current)
                };
              }

              const attempt = Number(current.syncRetryAttempt || 0) + 1;
              const delayMs = Math.min(300000, 1000 * (2 ** Math.min(attempt, 8)));
              Object.assign(current, {
                status: "error",
                error: message,
                syncRetryAttempt: attempt,
                nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
                updatedAt: nowIso()
              });
              await persist();
              await publish(sourceId, "knowledge.sources.sync_failed");

              if (current.autoSync) {
                const timer = timers.get(sourceId);
                if (timer) {
                  clearTimeout(timer);
                }
                timers.set(sourceId, setTimeout(() => {
                  timers.delete(sourceId);
                  void triggerSourceSync(sourceId, { reason: "retry" }).catch(() => null);
                }, delayMs));
              }
            }
            throw error;
          }
        })();

        activeSyncRuns.set(sourceId, { run, token });
        run.finally(() => {
          const current = activeSyncRuns.get(sourceId);
          if (current?.token === token) {
            activeSyncRuns.delete(sourceId);
          }
        }).catch(() => null);
        return run;
      }

  function scheduleSourceSync(sourceId, reason = "changed") {
    const source = sources.get(sourceId);
    if (!source || !source.enabled || !source.autoSync) {
      return;
    }
    Object.assign(source, {
      status: "pending",
      lastEventAt: nowIso(),
      pendingReason: reason,
      updatedAt: nowIso()
    });
    void persist();
    void publish(sourceId, "knowledge.sources.change_detected");
    const currentTimer = timers.get(sourceId);
    if (currentTimer) {
      clearTimeout(currentTimer);
    }
    timers.set(
      sourceId,
        setTimeout(() => {
          timers.delete(sourceId);
          void triggerSourceSync(sourceId, { reason: "watch" }).catch(async (error) => {
            const current = sources.get(sourceId);
          if (!current) {
            return;
          }
          Object.assign(current, {
            status: "error",
            error: error instanceof Error ? error.message : "目录同步失败。",
            updatedAt: nowIso()
          });
          await persist();
          await publish(sourceId, "knowledge.sources.sync_failed");
        });
      }, source.debounceMs)
    );
  }

  async function loadSourcesFromDisk({ reconcileWatchers = false } = {}) {
    const stored = await readSources(userDataPath);
    const nextIds = new Set(stored.map((source) => source.sourceId));
    for (const sourceId of [...sources.keys()]) {
      if (nextIds.has(sourceId)) {
        continue;
      }
      closeWatchers(sourceId);
      const timer = timers.get(sourceId);
      if (timer) {
        clearTimeout(timer);
      }
      timers.delete(sourceId);
      sources.delete(sourceId);
    }
    for (const source of stored) {
      sources.set(source.sourceId, source);
    }
    if (reconcileWatchers) {
      const changedSourceIds = [...sources.values()]
        .filter((source) => {
          const signature = sourceWatchSignature(source);
          if (watcherSignatures.get(source.sourceId) !== signature) {
            return true;
          }
          return source.enabled && source.autoSync && !watchers.has(source.sourceId);
        })
        .map((source) => source.sourceId);
      await Promise.all(changedSourceIds.map((sourceId) => startWatchingSource(sourceId)));
    }
  }

  async function refreshInMemorySources() {
    if (!watchingEnabled) {
      await loadSourcesFromDisk({ reconcileWatchers: false });
    }
  }

  ready = (async () => {
    await loadSourcesFromDisk({ reconcileWatchers: watchingEnabled });
    for (const source of sources.values()) {
      fingerprintStore.upsertRegistrySource(source);
    }
  })();

  return {
      async start() {
        await ready;
        for (const source of sources.values()) {
          fingerprintStore.upsertRegistrySource(source);
        }
        await publish("", "knowledge.sources.snapshot");
        await persist();
      },
    async listSources() {
      await ready;
      await refreshInMemorySources();
      return snapshot();
    },
    async createSource(input = {}) {
      await ready;
      await refreshInMemorySources();
      const next = normalizeSource(input);
      const existing = [...sources.values()].find(
        (source) => path.resolve(source.directoryPath) === next.directoryPath
      );
      if (existing) {
        const updated = normalizeSource({ ...input, directoryPath: existing.directoryPath }, existing);
	        sources.set(existing.sourceId, updated);
          fingerprintStore.upsertRegistrySource(updated);
	        await persist();
	        await startWatchingSource(existing.sourceId);
	        const result = input.runNow === false
	          ? { skipped: true, reason: "already_exists", source: publicSource(updated) }
	          : await triggerSourceSync(existing.sourceId, { reason: "manual" });
	        return {
	          ...result,
	          duplicateOf: existing.sourceId,
          state: await snapshot()
        };
      }
	      sources.set(next.sourceId, next);
        fingerprintStore.upsertRegistrySource(next);
	      await persist();
	      await startWatchingSource(next.sourceId);
	      const result = input.runNow === false
	        ? { skipped: true, reason: "created", source: publicSource(next) }
	        : await triggerSourceSync(next.sourceId, { reason: "manual" });
	      return {
        ...result,
        state: await snapshot()
      };
    },
    async updateSource(sourceId, patch = {}) {
      await ready;
      await refreshInMemorySources();
      const current = sources.get(sourceId);
      if (!current) {
        return null;
      }
      const previousFingerprints = fingerprintStore.listBySource(sourceId);
      const next = normalizeSource({ ...current, ...patch, sourceId }, current);
      if (current.directoryPath !== next.directoryPath) {
        fingerprintStore.recordPathAlias({
          sourceId,
          aliasDirectoryPath: current.directoryPath,
          canonicalDirectoryPath: next.directoryPath
        });
        if (previousFingerprints.size > 0) {
          fingerprintStore.purgePersistedSourcePaths(
            [...previousFingerprints.keys()].map((relativePath) => path.join(current.directoryPath, relativePath))
          );
        }
        fingerprintStore.clearSourceFiles(sourceId);
      }
	      sources.set(sourceId, next);
	      fingerprintStore.upsertRegistrySource(next);
	      await persist();
	      await startWatchingSource(sourceId);
	      await publish(sourceId, "knowledge.sources.updated");
      return {
        source: publicSource(next),
        state: await snapshot()
      };
    },
    async deleteSource(sourceId) {
      await ready;
      await refreshInMemorySources();
      const current = sources.get(sourceId);
      if (!current) {
        return null;
      }
      closeWatchers(sourceId);
      const timer = timers.get(sourceId);
      if (timer) {
        clearTimeout(timer);
      }
	      timers.delete(sourceId);
		      sources.delete(sourceId);
          fingerprintStore.removeRegistrySource(sourceId);
          fingerprintStore.clearSourceFiles(sourceId);
		      await persist();
		      await deleteKnowledgeSourceFileIndex({ userDataPath, sourceId });
		      await deleteCheckpointTree({
		        userDataPath,
		        treeId: checkpointTreeId("knowledge-source-sync", sourceId)
		      }).catch(() => null);
		      await publish(sourceId, "knowledge.sources.deleted");
      return {
        deletedSource: publicSource(current),
        state: await snapshot()
      };
    },
	    async refreshSource(sourceId, options = {}) {
	      await refreshInMemorySources();
	      const result = await triggerSourceSync(sourceId, {
	        reason: options.reason || "manual",
	        force: Boolean(options.force)
	      });
	      return {
        ...result,
        state: await snapshot()
      };
    },
    async refreshAll(options = {}) {
      await ready;
      await refreshInMemorySources();
	      const results = [];
	      for (const source of sources.values()) {
	        if (!source.enabled) {
	          continue;
	        }
	        results.push(await triggerSourceSync(source.sourceId, {
	          reason: options.reason || "manual",
	          force: Boolean(options.force)
        }));
      }
      return {
        results,
        state: await snapshot()
      };
    },
    async reconcileWatchers() {
      await ready;
      await loadSourcesFromDisk({ reconcileWatchers: watchingEnabled });
      for (const source of sources.values()) {
        fingerprintStore.upsertRegistrySource(source);
      }
      return snapshot();
    },
    async listRegisteredFiles(sourceId, options = {}) {
      await ready;
      await refreshInMemorySources();
      const source = sources.get(sourceId);
      if (!source) {
        return null;
      }
      const files = fingerprintStore.listRegisteredFiles(sourceId, options);
      return {
        source: publicSource(source),
        totalCount: fingerprintStore.countRegisteredFiles(sourceId),
        files
      };
    },
    async close() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const sourceId of watchers.keys()) {
        closeWatchers(sourceId);
      }
      fingerprintStore.close();
    }
  };
}
