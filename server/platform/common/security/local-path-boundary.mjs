import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../config/ServerConfig.mjs";

function text(value = "") {
  return String(value || "").trim();
}

function uniquePaths(values = []) {
  const seen = new Set();
  const paths = [];
  for (const value of values) {
    const item = text(value);
    if (!item) continue;
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    paths.push(resolved);
  }
  return paths;
}

function configuredRoots(envName = "PACT_ALLOWED_LOCAL_SOURCE_ROOTS") {
  return uniquePaths(text(process.env[envName]).split(path.delimiter));
}

function dataRoot(userDataPath = "") {
  return path.resolve(text(userDataPath) || ServerConfig.getDataDir());
}

export function controlledLocalSourceRoots({ userDataPath = "", extraRoots = [] } = {}) {
  const root = dataRoot(userDataPath);
  return uniquePaths([
    path.join(root, "local-sources"),
    path.join(root, "agent-workspaces", "local-sources"),
    path.join(root, "agent-workspaces", "cloud-drive-local-projections"),
    path.join(root, "knowledge-sources", "local-sources"),
    ...configuredRoots(),
    ...extraRoots
  ]);
}

export function pathIsWithinRoot(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function rootPairsSync(roots = []) {
  return uniquePaths(roots).map((rootPath) => {
    let realPath = rootPath;
    try {
      realPath = fsSync.realpathSync.native(rootPath);
    } catch {
      realPath = rootPath;
    }
    return { rootPath, realPath };
  });
}

async function rootPairs(roots = []) {
  const pairs = [];
  for (const rootPath of uniquePaths(roots)) {
    let realPath = rootPath;
    try {
      realPath = await fs.realpath(rootPath);
    } catch {
      realPath = rootPath;
    }
    pairs.push({ rootPath, realPath });
  }
  return pairs;
}

function pathMatchesRootPairs(candidatePath, realCandidatePath, pairs = []) {
  return pairs.some((pair) =>
    (pathIsWithinRoot(candidatePath, pair.rootPath) || pathIsWithinRoot(candidatePath, pair.realPath)) &&
    pathIsWithinRoot(realCandidatePath, pair.realPath)
  );
}

export function assertExistingLocalDirectoryWithinControlledRootsSync(sourcePath, {
  userDataPath = "",
  allowedRoots = controlledLocalSourceRoots({ userDataPath }),
  label = "本机目录"
} = {}) {
  const rawPath = text(sourcePath);
  if (!rawPath) {
    throw new Error(`${label}路径不能为空。`);
  }
  const absolutePath = path.resolve(rawPath);
  const root = path.parse(absolutePath).root;
  if (absolutePath === root) {
    throw new Error(`不能把文件系统根目录作为${label}。`);
  }
  const stat = fsSync.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label}不能是符号链接。`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label}必须是目录。`);
  }
  const realPath = fsSync.realpathSync.native(absolutePath);
  const pairs = rootPairsSync(allowedRoots);
  if (!pathMatchesRootPairs(absolutePath, realPath, pairs)) {
    throw new Error(`${label}必须位于 Pact 受控本机来源目录内。`);
  }
  return { absolutePath, realPath, stat, allowedRoots: pairs.map((pair) => pair.rootPath) };
}

export async function assertExistingLocalDirectoryWithinControlledRoots(sourcePath, {
  userDataPath = "",
  allowedRoots = controlledLocalSourceRoots({ userDataPath }),
  label = "本机目录"
} = {}) {
  const rawPath = text(sourcePath);
  if (!rawPath) {
    throw new Error(`${label}路径不能为空。`);
  }
  const absolutePath = path.resolve(rawPath);
  const root = path.parse(absolutePath).root;
  if (absolutePath === root) {
    throw new Error(`不能把文件系统根目录作为${label}。`);
  }
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label}不能是符号链接。`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label}必须是目录。`);
  }
  const realPath = await fs.realpath(absolutePath);
  const pairs = await rootPairs(allowedRoots);
  if (!pathMatchesRootPairs(absolutePath, realPath, pairs)) {
    throw new Error(`${label}必须位于 Pact 受控本机来源目录内。`);
  }
  return { absolutePath, realPath, stat, allowedRoots: pairs.map((pair) => pair.rootPath) };
}

export async function assertExistingLocalFileWithinControlledRoots(filePath, {
  userDataPath = "",
  allowedRoots = controlledLocalSourceRoots({ userDataPath }),
  label = "本机文件"
} = {}) {
  const rawPath = text(filePath);
  if (!rawPath) {
    throw new Error(`${label}路径不能为空。`);
  }
  const absolutePath = path.resolve(rawPath);
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label}不能是符号链接。`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label}必须是普通文件。`);
  }
  const realPath = await fs.realpath(absolutePath);
  const pairs = await rootPairs(allowedRoots);
  if (!pathMatchesRootPairs(absolutePath, realPath, pairs)) {
    throw new Error(`${label}必须位于 Pact 受控本机来源目录内。`);
  }
  return { absolutePath, realPath, stat, allowedRoots: pairs.map((pair) => pair.rootPath) };
}

export async function assertWritablePathWithinRoot(rootPath, targetPath, { label = "目标路径" } = {}) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (!pathIsWithinRoot(target, root)) {
    throw new Error(`${label}不能跳出受控根目录。`);
  }
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("受控根目录必须是普通目录。");
  }
  const rootRealPath = await fs.realpath(root);
  const relative = path.relative(root, target);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`${label}不能经过符号链接目录。`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`${label}父路径必须是目录。`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  const parentPath = path.dirname(target);
  try {
    const parentRealPath = await fs.realpath(parentPath);
    if (!pathIsWithinRoot(parentRealPath, rootRealPath)) {
      throw new Error(`${label}真实父路径不能跳出受控根目录。`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label}不能写入符号链接。`);
    }
    const realPath = await fs.realpath(target);
    if (!pathIsWithinRoot(realPath, rootRealPath)) {
      throw new Error(`${label}真实路径不能跳出受控根目录。`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return { absolutePath: target, rootPath: root, rootRealPath };
}
