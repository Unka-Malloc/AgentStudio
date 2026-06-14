import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../config/ServerConfig.mjs";

export const BACKUP_RESTORE_PROTOCOL_VERSION = "v0.0.1:storage:backup-restore-1";

const BACKUP_ROOT_DIR = "backups";
const BACKUP_FILES_DIR = "files";
const BACKUP_MANIFEST_FILE = "backup-manifest.json";
const RESTORE_REPORT_DIR = "restore-reports";
const EXCLUDED_TOP_LEVEL_DIRS = new Set([BACKUP_ROOT_DIR, "logs", "tmp"]);

function nowIso() {
  return new Date().toISOString();
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeBackupId(value = "") {
  const text = String(value || "").trim();
  if (!/^backup_[A-Za-z0-9_.-]+$/.test(text)) {
    throw new Error("Invalid backupId.");
  }
  return text;
}

function safeRelativePath(relativePath = "") {
  const value = String(relativePath || "").replace(/\\/g, "/");
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`Unsafe backup relative path: ${relativePath}`);
  }
  return value;
}

function backupRoot(userDataPath = "") {
  return path.join(path.resolve(userDataPath || ServerConfig.getDataDir()), BACKUP_ROOT_DIR);
}

function backupPath(userDataPath = "", backupId = "") {
  return path.join(backupRoot(userDataPath), normalizeBackupId(backupId));
}

function backupFilesRoot(userDataPath = "", backupId = "") {
  return path.join(backupPath(userDataPath, backupId), BACKUP_FILES_DIR);
}

function pathWithinRoot(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathOrResolved(candidatePath) {
  try {
    return await fs.realpath(candidatePath);
  } catch {
    return path.resolve(candidatePath);
  }
}

async function pathBoundaryReason({ rootPath, targetPath, allowMissingTarget = true } = {}) {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  if (!pathWithinRoot(normalizedTarget, normalizedRoot)) {
    return "target_outside_root";
  }
  const realRoot = await realpathOrResolved(normalizedRoot);
  const parentPath = path.dirname(normalizedTarget);
  const realParent = await realpathOrResolved(parentPath);
  if (!pathWithinRoot(realParent, realRoot)) {
    return "target_parent_outside_root";
  }
  try {
    const realTarget = await fs.realpath(normalizedTarget);
    if (!pathWithinRoot(realTarget, realRoot)) {
      return "target_symlink_outside_root";
    }
  } catch (error) {
    if (!allowMissingTarget || error?.code !== "ENOENT") {
      return "target_unresolvable";
    }
  }
  return "";
}

function classifyFile(relativePath = "") {
  const value = relativePath.replace(/\\/g, "/");
  if (value.startsWith("auth/")) return "auth";
  if (value.startsWith("jobs/")) return "jobs";
  if (value.startsWith("objects/") || value.startsWith("raw-objects/")) return "raw-object";
  if (value.startsWith("checkpoint-trees/")) return "checkpoint-tree";
  if (value.endsWith(".sqlite") || value.endsWith(".sqlite3") || value.endsWith(".db")) return "database";
  if (value.endsWith(".json")) return "json-state";
  if (value.endsWith(".yaml") || value.endsWith(".yml")) return "config";
  return "file";
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function collectFiles(rootPath, currentPath = rootPath, entries = []) {
  let dirents = [];
  try {
    dirents = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return entries;
    throw error;
  }
  for (const dirent of dirents) {
    const absolutePath = path.join(currentPath, dirent.name);
    const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
    const topLevel = relativePath.split("/")[0];
    if (dirent.isDirectory()) {
      if (EXCLUDED_TOP_LEVEL_DIRS.has(topLevel)) {
        continue;
      }
      await collectFiles(rootPath, absolutePath, entries);
      continue;
    }
    if (!dirent.isFile()) {
      continue;
    }
    const buffer = await fs.readFile(absolutePath);
    const stat = await fs.stat(absolutePath);
    entries.push({
      relativePath: safeRelativePath(relativePath),
      category: classifyFile(relativePath),
      bytes: buffer.length,
      sha256: sha256(buffer),
      mtimeMs: Math.trunc(stat.mtimeMs)
    });
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function backupIdFor(label = "") {
  const timestamp = nowIso().replace(/[:.]/g, "-");
  const digest = sha256(Buffer.from(`${timestamp}:${label}:${crypto.randomUUID()}`)).slice(0, 12);
  return `backup_${timestamp}_${digest}`;
}

function summarizeEntries(entries = []) {
  const byCategory = {};
  let bytes = 0;
  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    bytes += entry.bytes || 0;
  }
  return {
    fileCount: entries.length,
    bytes,
    byCategory
  };
}

async function copyBackupFiles({ userDataPath, backupId, entries }) {
  const rootPath = path.resolve(userDataPath || ServerConfig.getDataDir());
  const filesRoot = backupFilesRoot(userDataPath, backupId);
  for (const entry of entries) {
    const relativePath = safeRelativePath(entry.relativePath);
    const sourcePath = path.join(rootPath, relativePath);
    const targetPath = path.join(filesRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function loadBackupManifest({ userDataPath, backupId }) {
  const selectedBackupId = normalizeBackupId(backupId);
  const manifestPath = path.join(backupPath(userDataPath, selectedBackupId), BACKUP_MANIFEST_FILE);
  const manifest = await readJson(manifestPath, null);
  if (!manifest || manifest.protocolVersion !== BACKUP_RESTORE_PROTOCOL_VERSION) {
    throw new Error(`Backup manifest not found or invalid: ${selectedBackupId}`);
  }
  return manifest;
}

export async function createStorageBackup({ userDataPath, label = "" } = {}) {
  const rootPath = path.resolve(userDataPath || ServerConfig.getDataDir());
  await fs.mkdir(rootPath, { recursive: true });
  const entries = await collectFiles(rootPath);
  const backupId = backupIdFor(label);
  const selectedBackupPath = backupPath(rootPath, backupId);
  const manifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: BACKUP_RESTORE_PROTOCOL_VERSION,
    backupId,
    label: String(label || ""),
    createdAt: nowIso(),
    sourceRoot: rootPath,
    backupPath: selectedBackupPath,
    filesRoot: backupFilesRoot(rootPath, backupId),
    summary: summarizeEntries(entries),
    files: entries
  };
  await copyBackupFiles({ userDataPath: rootPath, backupId, entries });
  await writeJson(path.join(selectedBackupPath, BACKUP_MANIFEST_FILE), manifest);
  return manifest;
}

export async function listStorageBackups({ userDataPath } = {}) {
  const rootPath = backupRoot(userDataPath);
  let dirents = [];
  try {
    dirents = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: BACKUP_RESTORE_PROTOCOL_VERSION,
        backups: []
      };
    }
    throw error;
  }
  const backups = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    try {
      const manifest = await loadBackupManifest({ userDataPath, backupId: dirent.name });
      backups.push({
        backupId: manifest.backupId,
        label: manifest.label,
        createdAt: manifest.createdAt,
        backupPath: manifest.backupPath,
        summary: manifest.summary
      });
    } catch {
      continue;
    }
  }
  backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: BACKUP_RESTORE_PROTOCOL_VERSION,
    backups
  };
}

async function buildRestoreAction({ rootPath, filesRoot, entry }) {
  const relativePath = safeRelativePath(entry.relativePath);
  const backupFilePath = path.join(filesRoot, relativePath);
  const targetPath = path.join(rootPath, relativePath);
  if (!await pathExists(backupFilePath)) {
    return {
      relativePath,
      targetPath,
      action: "blocked",
      reason: "backup_file_missing",
      expectedSha256: entry.sha256,
      currentSha256: ""
    };
  }
  const backupBoundaryReason = await pathBoundaryReason({
    rootPath: filesRoot,
    targetPath: backupFilePath,
    allowMissingTarget: false
  });
  if (backupBoundaryReason) {
    return {
      relativePath,
      targetPath,
      action: "blocked",
      reason: `backup_${backupBoundaryReason}`,
      expectedSha256: entry.sha256,
      currentSha256: ""
    };
  }
  const targetBoundaryReason = await pathBoundaryReason({
    rootPath,
    targetPath,
    allowMissingTarget: true
  });
  if (targetBoundaryReason) {
    return {
      relativePath,
      targetPath,
      action: "blocked",
      reason: targetBoundaryReason,
      expectedSha256: entry.sha256,
      currentSha256: ""
    };
  }
  const exists = await pathExists(targetPath);
  if (!exists) {
    return {
      relativePath,
      targetPath,
      action: "create",
      reason: "target_missing",
      expectedSha256: entry.sha256,
      currentSha256: ""
    };
  }
  const current = await fs.readFile(targetPath);
  const currentSha256 = sha256(current);
  return {
    relativePath,
    targetPath,
    action: currentSha256 === entry.sha256 ? "noop" : "replace",
    reason: currentSha256 === entry.sha256 ? "hash_match" : "hash_mismatch",
    expectedSha256: entry.sha256,
    currentSha256
  };
}

function filterEntries(entries = [], includePaths = []) {
  const selected = Array.isArray(includePaths)
    ? includePaths.map((item) => safeRelativePath(item)).filter(Boolean)
    : [];
  if (!selected.length) return entries;
  return entries.filter((entry) =>
    selected.some((prefix) => entry.relativePath === prefix || entry.relativePath.startsWith(`${prefix}/`))
  );
}

async function applyRestoreAction({ rootPath, filesRoot, action }) {
  if (action.action === "noop") {
    return;
  }
  if (action.action === "blocked") {
    throw new Error(`Cannot restore ${action.relativePath}: ${action.reason}`);
  }
  const sourcePath = path.join(filesRoot, safeRelativePath(action.relativePath));
  const sourceBoundaryReason = await pathBoundaryReason({
    rootPath: filesRoot,
    targetPath: sourcePath,
    allowMissingTarget: false
  });
  if (sourceBoundaryReason) {
    throw new Error(`Cannot restore ${action.relativePath}: backup_${sourceBoundaryReason}`);
  }
  const targetBoundaryReason = await pathBoundaryReason({
    rootPath,
    targetPath: action.targetPath,
    allowMissingTarget: true
  });
  if (targetBoundaryReason) {
    throw new Error(`Cannot restore ${action.relativePath}: ${targetBoundaryReason}`);
  }
  await fs.mkdir(path.dirname(action.targetPath), { recursive: true });
  await fs.copyFile(sourcePath, action.targetPath);
}

export async function restoreStorageBackup({
  userDataPath,
  backupId,
  dryRun = true,
  apply = false,
  includePaths = []
} = {}) {
  const rootPath = path.resolve(userDataPath || ServerConfig.getDataDir());
  const manifest = await loadBackupManifest({ userDataPath: rootPath, backupId });
  const selectedEntries = filterEntries(manifest.files || [], includePaths);
  const filesRoot = backupFilesRoot(rootPath, manifest.backupId);
  const plannedActions = [];
  for (const entry of selectedEntries) {
    plannedActions.push(await buildRestoreAction({ rootPath, filesRoot, entry }));
  }
  const shouldApply = dryRun === false && apply === true;
  if (shouldApply) {
    for (const action of plannedActions) {
      await applyRestoreAction({ rootPath, filesRoot, action });
    }
  }
  const report = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: BACKUP_RESTORE_PROTOCOL_VERSION,
    backupId: manifest.backupId,
    generatedAt: nowIso(),
    dryRun: !shouldApply,
    applied: shouldApply,
    selectedFileCount: selectedEntries.length,
    summary: {
      create: plannedActions.filter((action) => action.action === "create").length,
      replace: plannedActions.filter((action) => action.action === "replace").length,
      noop: plannedActions.filter((action) => action.action === "noop").length,
      blocked: plannedActions.filter((action) => action.action === "blocked").length
    },
    plannedActions
  };
  if (shouldApply) {
    const reportPath = path.join(
      backupPath(rootPath, manifest.backupId),
      RESTORE_REPORT_DIR,
      `${nowIso().replace(/[:.]/g, "-")}.json`
    );
    await writeJson(reportPath, report);
    return { ...report, reportPath };
  }
  return report;
}
