import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTikaImportExtensions,
  isTikaImportExtension,
  isTikaImportMediaType
} from "../../../../../specialized/knowledge/preprocessing/file-processor/import-file-types.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../../../../..");

export const TIKA_VERSION = "3.2.3";
export const TIKA_IMPORT_EXTENSIONS = getTikaImportExtensions();
const TIKA_JAR_FILE_NAMES = [`tika-app-${TIKA_VERSION}.jar`, "tika-app.jar"];
const DEFAULT_TIKA_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_TIKA_TIMEOUT_MS = 1000;
const MAX_TIKA_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const TIKA_FORCE_KILL_GRACE_MS = 5000;

function createTikaError(message, code = "TIKA_FAILED") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getJavaExecutableName() {
  return process.platform === "win32" ? "java.exe" : "java";
}

function getPlatformRuntimeFolderName() {
  return `${process.platform}-${process.arch}`;
}

function getKnowledgeModuleResourceRoots() {
  const processCwdModules = process.cwd()
    ? path.join(process.cwd(), "server", "platform", "modules", "knowledge")
    : "";
  const roots = [
    path.join(projectRoot, "server", "platform", "modules", "knowledge"),
    processCwdModules
  ];

  if (process.resourcesPath) {
    roots.unshift(path.join(process.resourcesPath, "server", "platform", "modules", "knowledge"));
  }

  return Array.from(new Set(roots.filter(Boolean)));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function resolveTikaJarPath(settings = {}) {
  const explicitPath = settings.tikaJarPath?.trim() || process.env.PACT_TIKA_JAR_PATH || "";
  const moduleCandidates = getKnowledgeModuleResourceRoots().flatMap((modulesRoot) =>
    TIKA_JAR_FILE_NAMES.map((fileName) => path.join(modulesRoot, "tika", fileName))
  );
  const resolvedPath = await resolveFirstExistingPath([explicitPath, ...moduleCandidates]);

  if (resolvedPath) {
    return resolvedPath;
  }

  throw createTikaError(
    `未找到 Tika 应用包。请在设置中填写 Tika JAR 路径，或把 ${TIKA_JAR_FILE_NAMES[0]} 放到 server/platform/modules/knowledge/tika/ 下。`,
    "TIKA_UNAVAILABLE"
  );
}

async function resolveJavaCommand(settings = {}) {
  const explicitPath = settings.javaBinPath?.trim() || process.env.PACT_JAVA_BIN_PATH || "";
  const moduleCandidates = getKnowledgeModuleResourceRoots().flatMap((modulesRoot) => {
    const basePath = path.join(modulesRoot, "runtime", "jre", getPlatformRuntimeFolderName());
    return [
      path.join(basePath, "bin", getJavaExecutableName()),
      path.join(basePath, "Contents", "Home", "bin", getJavaExecutableName()),
      path.join(basePath, "Home", "bin", getJavaExecutableName()),
      path.join(basePath, "jre", "bin", getJavaExecutableName())
    ];
  });
  const resolvedPath = await resolveFirstExistingPath([explicitPath, ...moduleCandidates]);

  return resolvedPath || "java";
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function clampTikaTimeoutMs(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.max(MIN_TIKA_TIMEOUT_MS, Math.min(numeric, MAX_TIKA_TIMEOUT_MS));
}

function resolveTikaTimeoutMs(settings = {}) {
  return clampTikaTimeoutMs(settings.tikaTimeoutMs) ||
    clampTikaTimeoutMs(process.env.PACT_TIKA_TIMEOUT_MS) ||
    DEFAULT_TIKA_TIMEOUT_MS;
}

function formatTimeoutDuration(timeoutMs) {
  const seconds = Math.max(1, Math.ceil(Number(timeoutMs || 0) / 1000));
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} 分钟`;
}

async function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let exitCode = 1;
    let settled = false;
    let timedOut = false;
    let timeoutHandle = null;
    let killHandle = null;

    const clearTimers = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (killHandle) {
        clearTimeout(killHandle);
        killHandle = null;
      }
    };

    const settle = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      callback();
    };

    const timeoutMs = clampTikaTimeoutMs(options.timeoutMs);
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        const error = createTikaError(
          options.timeoutMessage || `Tika 解析超时（${formatTimeoutDuration(timeoutMs)}）。`,
          options.timeoutCode || "TIKA_TIMEOUT"
        );
        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore process kill failures; the promise is already failing with a timeout.
        }
        killHandle = setTimeout(() => {
          try {
            if (child.exitCode === null) {
              child.kill("SIGKILL");
            }
          } catch {
            // Ignore best-effort hard kill failures.
          }
        }, TIKA_FORCE_KILL_GRACE_MS);
        reject(error);
      }, timeoutMs);
    }

    child.once("error", (error) => settle(() => reject(error)));
    child.once("close", (code) => {
      exitCode = typeof code === "number" ? code : 1;
      if (timedOut && killHandle) {
        clearTimeout(killHandle);
        killHandle = null;
      }
    });

    Promise.all([collectStream(child.stdout), collectStream(child.stderr)])
      .then(([stdout, stderr]) => {
        if (timedOut) {
          return;
        }
        if (child.exitCode === null) {
          child.once("close", () => {
            settle(() => resolve({
              code: exitCode,
              stdout,
              stderr
            }));
          });
          return;
        }

        settle(() => resolve({
          code: typeof child.exitCode === "number" ? child.exitCode : exitCode,
          stdout,
          stderr
        }));
      })
      .catch((error) => settle(() => reject(error)));
  });
}

async function ensureTempExtractionFile({ buffer, fileName, userDataPath }) {
  const extension = path.extname(fileName || "").toLowerCase() || ".bin";
  const tempDirectory = path.join(userDataPath, "tmp", "tika");
  const tempPath = path.join(tempDirectory, `${randomUUID()}${extension}`);

  await fs.mkdir(tempDirectory, { recursive: true });
  await fs.writeFile(tempPath, buffer);
  return tempPath;
}

async function safeUnlink(targetPath) {
  if (!targetPath) {
    return;
  }

  try {
    await fs.unlink(targetPath);
  } catch {
    // Ignore temp cleanup failures.
  }
}

export function isTikaBackedDocument({ extension = "", mediaTypeHint = "" }) {
  return (
    isTikaImportExtension(extension) ||
    isTikaImportMediaType(mediaTypeHint)
  );
}

function normalizeTikaText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeMetadataRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => typeof key === "string" && key.trim())
  );
}

function metadataTextCandidates(metadata = {}) {
  const candidates = [];

  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "x-tika:content" ||
      normalizedKey === "content" ||
      normalizedKey.endsWith(":content")
    ) {
      if (Array.isArray(value)) {
        candidates.push(...value.map((item) => normalizeTikaText(item)));
      } else {
        candidates.push(normalizeTikaText(value));
      }
    }
  }

  return candidates.filter(Boolean);
}

function parseRmetaOutput(stdout) {
  let parsed;

  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw createTikaError(
      `Tika 结构化输出不是有效 JSON：${error instanceof Error ? error.message : "未知错误"}`,
      "TIKA_FAILED"
    );
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const normalizedEntries = entries
    .map((entry) => normalizeMetadataRecord(entry))
    .filter((entry) => Object.keys(entry).length > 0);
  const root = normalizedEntries[0] || {};
  const embeddedDocuments = normalizedEntries.slice(1).map((entry, index) => ({
    id: `embedded-${index + 1}`,
    metadata: entry,
    text: metadataTextCandidates(entry)[0] || ""
  }));
  const text =
    metadataTextCandidates(root)[0] ||
    embeddedDocuments.find((entry) => entry.text)?.text ||
    "";

  return {
    parserId: "builtin/tika",
    metadata: root,
    text,
    embeddedDocuments
  };
}

async function runTikaCommand({
  buffer,
  filePath = "",
  fileName = "",
  settings = {},
  userDataPath,
  mode = "text"
}) {
  const tikaJarPath = await resolveTikaJarPath(settings);
  const javaCommand = await resolveJavaCommand(settings);
  let targetPath = filePath;
  let cleanupPath = "";

  if (!targetPath || !path.isAbsolute(targetPath)) {
    cleanupPath = await ensureTempExtractionFile({
      buffer,
      fileName,
      userDataPath
    });
    targetPath = cleanupPath;
  }

  try {
    const args =
      mode === "rmeta"
        ? ["-jar", tikaJarPath, "-J", targetPath]
        : ["-jar", tikaJarPath, "--text", "--encoding=UTF-8", targetPath];
    const timeoutMs = resolveTikaTimeoutMs(settings);
    const result = await spawnCommand(javaCommand, args, {
      timeoutMs,
      timeoutCode: "TIKA_TIMEOUT",
      timeoutMessage: `Tika 解析超时（${formatTimeoutDuration(timeoutMs)}）。可通过 PACT_TIKA_TIMEOUT_MS 或设置 tikaTimeoutMs 提高上限。`
    });

    if (result.code !== 0) {
      const details = (result.stderr || result.stdout || "").trim();
      if (/Unable to locate a Java Runtime|No Java runtime present/i.test(details)) {
        throw createTikaError(
          "当前机器没有可用的 Java 运行时。请配置 Java 17，或在打包时附带 JRE 17。",
          "TIKA_UNAVAILABLE"
        );
      }

      const message =
        details ||
        "Tika 提取失败。请检查文件是否损坏，或确认 JRE 17 / tika-app.jar 是否可用。";
      throw createTikaError(message, "TIKA_FAILED");
    }

    return normalizeTikaText(result.stdout);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createTikaError(
        "未找到可用的 Java 运行时。请在设置中填写 Java 路径，或把 JRE 17 放到 server/platform/modules/knowledge/runtime/jre/<platform-arch>/ 下。",
        "TIKA_UNAVAILABLE"
      );
    }

    if (
      error instanceof Error &&
      /Unable to locate a Java Runtime|No Java runtime present/i.test(error.message)
    ) {
      throw createTikaError(
        "当前机器没有可用的 Java 运行时。请配置 Java 17，或在打包时附带 JRE 17。",
        "TIKA_UNAVAILABLE"
      );
    }

    throw error;
  } finally {
    await safeUnlink(cleanupPath);
  }
}

export async function extractDocumentWithTika(input) {
  const structuredOutput = await runTikaCommand({
    ...input,
    mode: "rmeta"
  });
  return parseRmetaOutput(structuredOutput);
}

export async function extractTextWithTika(input) {
  const document = await extractDocumentWithTika(input);
  return document.text;
}
