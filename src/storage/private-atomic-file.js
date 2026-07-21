import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set(["EACCES", "EINVAL", "ENOTSUP", "EPERM"]);

export function isUnsupportedDirectorySyncError(error, platform = process.platform) {
  return platform === "win32" && WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES.has(error?.code);
}

function invalidPrivatePathError(kind) {
  const error = new Error(`Pactium private storage ${kind} must not be a symbolic link or special file.`);
  error.code = "PACTIUM_PRIVATE_PATH_INVALID";
  return error;
}

export async function ensurePrivateDirectory(directoryPath, {
  fileSystem = fs,
  platform = process.platform
} = {}) {
  await fileSystem.mkdir(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const stat = await fileSystem.lstat(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalidPrivatePathError("directory");
  try {
    await fileSystem.chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error, platform)) throw error;
  }
}

export async function hardenPrivateRegularFile(filePath, {
  allowMissing = false,
  fileSystem = fs,
  platform = process.platform
} = {}) {
  let stat;
  try {
    stat = await fileSystem.lstat(filePath);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return false;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw invalidPrivatePathError("file");
  try {
    await fileSystem.chmod(filePath, PRIVATE_FILE_MODE);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return false;
    if (!isUnsupportedDirectorySyncError(error, platform)) throw error;
  }
  return true;
}

async function syncDirectory(directoryPath, { fileSystem, platform }) {
  let handle = null;
  try {
    handle = await fileSystem.open(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error, platform)) throw error;
  } finally {
    await handle?.close();
  }
}

export async function writePrivateFileAtomic(filePath, content, {
  fileSystem = fs,
  platform = process.platform
} = {}) {
  const directoryPath = path.dirname(filePath);
  await ensurePrivateDirectory(directoryPath, { fileSystem, platform });
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  let handle = null;
  try {
    handle = await fileSystem.open(temporaryPath, "wx", PRIVATE_FILE_MODE);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporaryPath, filePath);
    try {
      await fileSystem.chmod(filePath, PRIVATE_FILE_MODE);
    } catch (error) {
      if (!isUnsupportedDirectorySyncError(error, platform)) throw error;
    }
    await syncDirectory(directoryPath, { fileSystem, platform });
  } catch (error) {
    await handle?.close().catch(() => {});
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return filePath;
}
