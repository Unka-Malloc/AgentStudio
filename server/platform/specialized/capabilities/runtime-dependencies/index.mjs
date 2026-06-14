import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSettings, saveSettings } from "../../../common/platform-core/settings.mjs";
import { cloudDriveConfigPath } from "../../agent/cloud-drive-port/index.mjs";
import { resolveGatewayRuntimePlan } from "../agent-ingress/traffic-gateway/index.mjs";
import { knowledgeBackendConfigPath } from "../../knowledge/storage/knowledge-backend-port/index.mjs";

export const RUNTIME_DEPENDENCIES_PROTOCOL_VERSION = "v0.0.1:platform:runtime-dependencies-1";
const TIKA_VERSION = "3.2.3";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../../..");
const platformKey = `${process.platform}-${process.arch}`;
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const GERRIT_VERSION = process.env.PACT_GERRIT_VERSION || "3.14.0";
const PATH_ENV_SOURCE_LABEL = "环境变量: PATH";
const KNOWLEDGE_MODULE_ROOT = path.join(repoRoot, "server", "platform", "modules", "knowledge");
const MIN_JAVA_MAJOR = Number(process.env.PACT_MIN_JAVA_MAJOR || 21);
const MIN_NODE_MAJOR = Number(process.env.PACT_MIN_NODE_MAJOR || 22);
const MIN_PYTHON_MAJOR = Number(process.env.PACT_MIN_PYTHON_MAJOR || 3);
const MIN_PYTHON_MINOR = Number(process.env.PACT_MIN_PYTHON_MINOR || 10);
const DEFAULT_NODE_RUNTIME_VERSION = process.env.PACT_NODE_RUNTIME_VERSION || "24.16.0";
const DEFAULT_NODE_RUNTIME_FALLBACK_VERSIONS = Object.freeze(["24.16.0", "22.21.1"]);
const DEFAULT_PYTHON_RUNTIME_VERSION = process.env.PACT_PYTHON_RUNTIME_VERSION || "3.12";
const KNOWLEDGE_BACKEND_TARGETS = Object.freeze([
  Object.freeze({
    targetId: "dify",
    providerId: "dify",
    label: "Dify",
    description: "Dify backend knowledge base adapter configuration and optional local image cache."
  }),
  Object.freeze({
    targetId: "rag-flow",
    providerId: "ragflow",
    label: "RAG Flow",
    description: "RAG Flow backend knowledge base adapter configuration and optional local image cache."
  })
]);
const TOP_LEVEL_TARGETS = Object.freeze([
  "dify",
  "rag-flow",
  "cloud-drives",
  "docker",
  "jre",
  "python",
  "node",
  "caddy",
  "nginx",
  "gerrit"
]);
const SOURCE_CONFIG_RELATIVE_PATH = path.join("runtime", "runtime-dependency-sources.json");
const DOWNLOAD_RUNS_RELATIVE_DIR = path.join("runtime", "runtime-dependency-download-runs");
const INSTALL_STATUS = Object.freeze({
  PRESENT: "present",
  INSTALLED: "installed",
  FAILED: "failed"
});
const DOWNLOAD_RUN_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  PRESENT: INSTALL_STATUS.PRESENT,
  INSTALLED: INSTALL_STATUS.INSTALLED,
  FAILED: INSTALL_STATUS.FAILED
});
const DOWNLOAD_STEP_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
});
const RUNTIME_DOWNLOAD_STEP_PLANS = Object.freeze({
  caddy: Object.freeze([
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  nginx: Object.freeze([
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  docker: Object.freeze([
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  python: Object.freeze([
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  jre: Object.freeze([
    ["detect", "检测"],
    ["source", "下载源"],
    ["install", "下载并安装"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  node: Object.freeze([
    ["detect", "检测"],
    ["source", "版本管理器"],
    ["install", "nvm 安装"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  gerrit: Object.freeze([
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载 WAR"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  dify: Object.freeze([
    ["detect", "检测"],
    ["docker", "Docker"],
    ["download", "镜像拉取"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  "rag-flow": Object.freeze([
    ["detect", "检测"],
    ["docker", "Docker"],
    ["download", "镜像拉取"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  "programming-runtimes": Object.freeze([
    ["jre", "Java"],
    ["python", "Python"],
    ["node", "Node.js"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  "knowledge-backends": Object.freeze([
    ["dify", "Dify"],
    ["rag-flow", "RAG Flow"],
    ["verify", "验证"],
    ["complete", "完成"]
  ]),
  all: Object.freeze([
    ["dify", "Dify"],
    ["rag-flow", "RAG Flow"],
    ["cloud-drives", "Cloud drives"],
    ["docker", "Docker"],
    ["jre", "Java"],
    ["python", "Python"],
    ["node", "Node.js"],
    ["caddy", "Caddy"],
    ["nginx", "Nginx"],
    ["gerrit", "Gerrit"],
    ["complete", "完成"]
  ])
});
const MAX_DOWNLOAD_RUNS = 30;
const MAX_DOWNLOAD_RUN_LOG_LINES = 160;
const runtimeDependencyDownloadRuns = new Map();
const PYTHON_VERSION = process.env.PACT_PYTHON_RUNTIME_VERSION || "3.13.5";
const NGINX_VERSION = process.env.PACT_NGINX_RUNTIME_VERSION || "1.27.5";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeTargetId(value = "") {
  return text(value).toLowerCase().replace(/_/g, "-");
}

function runtimeDependencyTargetValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => runtimeDependencyTargetValues(item));
  }
  return String(value ?? "")
    .split(",")
    .map((item) => normalizeTargetId(item))
    .filter(Boolean);
}

function listRuntimeDependencyTargets(input = {}) {
  const requestedTargets = [
    ...runtimeDependencyTargetValues(input.targetId),
    ...runtimeDependencyTargetValues(input.target),
    ...runtimeDependencyTargetValues(input.id),
    ...runtimeDependencyTargetValues(input.targets)
  ];
  const dedupedTargets = requestedTargets.filter((targetId, index, list) => list.indexOf(targetId) === index);
  return dedupedTargets.length ? dedupedTargets : TOP_LEVEL_TARGETS;
}

function dataRoot(input = {}) {
  const explicit = text(input.userDataPath || process.env.PACT_SERVER_DATA_DIR);
  return explicit ? path.resolve(explicit) : path.join(os.homedir(), ".pact-server-data");
}

function runtimeCacheRoot(input = {}) {
  const explicit = text(input.cacheRoot || input.runtimeCacheRoot || process.env.PACT_RUNTIME_DEPENDENCY_CACHE_DIR);
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.join(dataRoot(input), "runtime", "runtime-dependencies");
}

function gatewayRuntimeCacheRoot(input = {}) {
  const explicit = text(input.gatewayRuntimeCacheRoot || input.gatewayCacheRoot || process.env.PACT_GATEWAY_RUNTIME_CACHE_DIR);
  return explicit ? path.resolve(explicit) : path.join(runtimeCacheRoot(input), "gateway-ingress");
}

export function runtimeDependencySourceConfigPath(input = {}) {
  return path.join(dataRoot(input), SOURCE_CONFIG_RELATIVE_PATH);
}

function runtimeDependencyDownloadRunStoreRoot(input = {}) {
  return path.join(dataRoot(input), DOWNLOAD_RUNS_RELATIVE_DIR);
}

function sanitizeDownloadRunId(value = "") {
  const normalized = text(value).replace(/[^a-zA-Z0-9_.-]/g, "");
  return normalized || `runtime_${randomUUID()}`;
}

function runtimeDependencyDownloadRunPath(input = {}, runId = "") {
  return path.join(runtimeDependencyDownloadRunStoreRoot(input), `${sanitizeDownloadRunId(runId)}.json`);
}

function hasExplicitDownloadRunContext(input = {}) {
  return Boolean(text(input.userDataPath || process.env.PACT_SERVER_DATA_DIR));
}

function gatewayCaddyArch() {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "amd64";
  return process.arch;
}

function sourcePlatformKeys() {
  return [
    `${process.platform}-${process.arch}`,
    `${process.platform}-${gatewayCaddyArch()}`,
    process.platform,
    "default"
  ];
}

function defaultPythonPackageFileName() {
  if (process.platform === "darwin") return `python-${PYTHON_VERSION}-macos11.pkg`;
  if (process.platform === "win32") return `python-${PYTHON_VERSION}-amd64.exe`;
  return `python-${PYTHON_VERSION}.tgz`;
}

function defaultPythonPackageUrl() {
  if (process.platform === "darwin") {
    return `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-macos11.pkg`;
  }
  if (process.platform === "win32") {
    return `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`;
  }
  return `https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tgz`;
}

function defaultJreSourceEntry() {
  if (platformKey === "linux-x64") {
    return {
      fileName: "OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz",
      url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz"
    };
  }
  if (platformKey === "linux-arm64") {
    return {
      fileName: "OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz",
      url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz"
    };
  }
  if (platformKey === "darwin-arm64") {
    return {
      fileName: "OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz",
      url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz"
    };
  }
  if (platformKey === "darwin-x64") {
    return {
      fileName: "OpenJDK21U-jre_x64_mac_hotspot_21.0.10_7.tar.gz",
      url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_mac_hotspot_21.0.10_7.tar.gz"
    };
  }
  if (platformKey === "win32-x64") {
    return {
      fileName: "OpenJDK21U-jre_x64_windows_hotspot_21.0.10_7.zip",
      url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_windows_hotspot_21.0.10_7.zip"
    };
  }
  return {
    fileName: `jre-${platformKey}.tar.gz`,
    url: ""
  };
}

function defaultCaddyPackageUrl() {
  const osName = process.platform === "win32" ? "windows" : process.platform;
  return `https://caddyserver.com/api/download?os=${encodeURIComponent(osName)}&arch=${encodeURIComponent(gatewayCaddyArch())}`;
}

function defaultCaddyPackageFileName() {
  const extension = process.platform === "win32" ? "zip" : "tar.gz";
  return `caddy-${process.platform}-${process.arch}.${extension}`;
}

function defaultSourceConfig() {
  const dockerUrl = dockerDefaultInstallerUrl();
  const gerritVersion = process.env.PACT_GERRIT_VERSION || GERRIT_VERSION;
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: RUNTIME_DEPENDENCIES_PROTOCOL_VERSION,
    generatedAt: nowIso(),
    note: "User-triggered runtime dependency sources. Edit mirror URLs here when built-in sources are unreachable.",
    platform: {
      os: process.platform,
      arch: process.arch,
      key: platformKey
    },
    sources: {
      dify: {
        images: [],
        mirrorPrefix: ""
      },
      "rag-flow": {
        images: [],
        mirrorPrefix: ""
      },
      docker: {
        default: {
          url: dockerUrl,
          fileName: dockerUrl ? `Docker-${platformKey}.dmg` : `docker-${platformKey}`
        },
        mirrors: []
      },
      jre: {
        default: defaultJreSourceEntry(),
        mirrors: []
      },
      tika: {
        default: {
          url: `https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar`,
          fileName: `tika-app-${TIKA_VERSION}.jar`
        },
        mirrors: []
      },
      python: {
        default: {
          url: defaultPythonPackageUrl(),
          fileName: defaultPythonPackageFileName(),
          version: DEFAULT_PYTHON_RUNTIME_VERSION,
          uvInstallUrl: "https://astral.sh/uv/install.sh"
        },
        mirrors: []
      },
      node: {
        default: {
          version: DEFAULT_NODE_RUNTIME_VERSION,
          nvmInstallUrl: "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh"
        },
        mirrors: []
      },
      caddy: {
        default: {
          url: defaultCaddyPackageUrl(),
          fileName: defaultCaddyPackageFileName()
        },
        mirrors: []
      },
      nginx: {
        default: {
          url: `https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz`,
          fileName: `nginx-${NGINX_VERSION}.tar.gz`
        },
        mirrors: []
      },
      gerrit: {
        version: gerritVersion,
        default: {
          warUrl: `https://repo1.maven.org/maven2/com/google/gerrit/gerrit-war/${gerritVersion}/gerrit-war-${gerritVersion}.war`
        },
        mirrors: [
          `https://gerrit-releases.storage.googleapis.com/gerrit-${gerritVersion}.war`
        ]
      }
    }
  };
}

function mergePlainObject(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergePlainObject(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function ensureRuntimeDependencySourceConfig(context = {}) {
  const configPath = runtimeDependencySourceConfigPath(context);
  const defaults = defaultSourceConfig();
  let config = defaults;
  let shouldWrite = false;
  try {
    const existing = JSON.parse(await fs.readFile(configPath, "utf8"));
    config = mergePlainObject(defaults, existing);
    shouldWrite = JSON.stringify(config) !== JSON.stringify(existing);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      config = {
        ...defaults,
        lastReadError: error instanceof Error ? error.message : String(error)
      };
    }
    shouldWrite = true;
  }
  if (shouldWrite) {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  return { configPath, config };
}

function sourceEntry(sourceConfig = {}, targetId = "") {
  const root = sourceConfig?.sources?.[targetId];
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return {};
  }
  for (const key of sourcePlatformKeys()) {
    const candidate = root[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return { ...root.default, ...candidate };
    }
  }
  return root.default && typeof root.default === "object" ? root.default : root;
}

function sourceField(sourceConfig = {}, targetId = "", fieldName = "url") {
  return text(sourceEntry(sourceConfig, targetId)?.[fieldName]);
}

function fileNameFromUrl(url = "", fallback = "runtime-artifact") {
  const sourceUrl = text(url);
  if (!sourceUrl) return fallback;
  try {
    return path.basename(new URL(sourceUrl).pathname) || fallback;
  } catch {
    return fallback;
  }
}

function downloadSourceFailure(targetId, sourceState, reason = "builtin_source_unavailable") {
  return {
    ok: false,
    status: INSTALL_STATUS.FAILED,
    reason,
    sourceConfigPath: sourceState?.configPath || "",
    mirrorRequired: true,
    mirrorHint: "内置下载源不可达或当前平台默认源不可用，请在本地下载源配置中配置镜像源后重试。"
  };
}

function safePath(value = "") {
  const candidate = text(value);
  return candidate ? path.resolve(candidate) : "";
}

function pathExists(targetPath = "") {
  if (!targetPath) return false;
  try {
    fsSync.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function fileSize(targetPath = "") {
  if (!targetPath) return 0;
  try {
    return fsSync.statSync(targetPath).size;
  } catch {
    return 0;
  }
}

function sleepMs(delayMs = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

function downloadRetryAttempts(options = {}) {
  const raw = Number(options.downloadRetryAttempts || options.retryAttempts || process.env.PACT_RUNTIME_DOWNLOAD_RETRY_ATTEMPTS || 12);
  return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 12;
}

function downloadRetryDelayMs(attemptIndex = 0, options = {}) {
  const base = Number(options.downloadRetryDelayMs || process.env.PACT_RUNTIME_DOWNLOAD_RETRY_DELAY_MS || 5000);
  const max = Number(options.downloadRetryMaxDelayMs || process.env.PACT_RUNTIME_DOWNLOAD_RETRY_MAX_DELAY_MS || 60000);
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 5000;
  const safeMax = Number.isFinite(max) ? Math.max(safeBase, max) : 60000;
  return Math.min(safeMax, safeBase * Math.max(1, 2 ** Math.max(0, attemptIndex)));
}

function nativeCommandRetryAttempts(options = {}) {
  const raw = Number(options.nativeRetryAttempts || process.env.PACT_RUNTIME_NATIVE_RETRY_ATTEMPTS || 5);
  return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 5;
}

function nativeCommandRetryDelayMs(attemptIndex = 0, options = {}) {
  const base = Number(options.nativeRetryDelayMs || process.env.PACT_RUNTIME_NATIVE_RETRY_DELAY_MS || 5000);
  const max = Number(options.nativeRetryMaxDelayMs || process.env.PACT_RUNTIME_NATIVE_RETRY_MAX_DELAY_MS || 60000);
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 5000;
  const safeMax = Number.isFinite(max) ? Math.max(safeBase, max) : 60000;
  return Math.min(safeMax, safeBase * Math.max(1, 2 ** Math.max(0, attemptIndex)));
}

function nativeCommandFailureShouldRetry(result = {}) {
  const output = text([result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n"));
  return /Could not get lock|Unable to lock|dpkg frontend lock|dpkg lock|is another process using it|Failed to fetch|Temporary failure resolving|Could not resolve|connection timed out|network is unreachable|try again|TLS connection/i.test(output);
}

function outputMentionsRangeUnsupported(value = "") {
  return /cannot resume|does not seem to support byte ranges|range/i.test(String(value || ""));
}

function detectionSource(kind, label, sourcePath = "", detail = "") {
  return {
    kind,
    label,
    path: text(sourcePath),
    detail: text(detail)
  };
}

function missingDetectionSource(sourcePath = "", detail = "") {
  return detectionSource("missing", "未检测到", sourcePath, detail);
}

function executableExists(targetPath = "") {
  if (!targetPath) return false;
  try {
    fsSync.accessSync(targetPath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value = "") {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandPath(commandName = "") {
  const command = text(commandName);
  if (!command) return "";
  const result = process.platform === "win32"
    ? spawnSync("where", [command], {
        encoding: "utf8",
        timeout: 3000
      })
    : spawnSync("sh", ["-c", `command -v ${shellQuote(command)}`], {
        encoding: "utf8",
        timeout: 3000
      });
  if (result.status !== 0) {
    return "";
  }
  return text(result.stdout).split(/\r?\n/).map(text).find(Boolean) || "";
}

function runCommand(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    maxBuffer: options.maxBuffer || 1024 * 1024 * 12,
    timeout: options.timeoutMs || 600000
  });
}

function commandVersion(command, args = ["--version"]) {
  const executablePath = commandPath(command);
  if (!executablePath) {
    return "";
  }
  const result = runCommand(executablePath, args, { timeoutMs: 5000 });
  return text([result.stdout, result.stderr].filter(Boolean).join("\n")).split(/\r?\n/)[0] || "";
}

function executableCommandVersion(executablePath = "", args = ["--version"]) {
  const candidate = text(executablePath);
  if (!candidate || !(executableExists(candidate) || pathExists(candidate))) {
    return "";
  }
  const result = runCommand(candidate, args, { timeoutMs: 5000 });
  return text([result.stdout, result.stderr].filter(Boolean).join("\n")).split(/\r?\n/)[0] || "";
}

function parseJavaMajor(versionOutput = "") {
  const output = String(versionOutput || "");
  const quoted = output.match(/version\s+"([^"]+)"/i)?.[1] || "";
  const version = quoted || output.match(/(?:openjdk|java)\s+([0-9][^\s"]*)/i)?.[1] || "";
  const majorText = version.startsWith("1.")
    ? version.split(".")[1]
    : version.split(/[._+-]/)[0];
  const major = Number(majorText || 0);
  return Number.isFinite(major) ? major : 0;
}

function parseNodeMajor(versionOutput = "") {
  const match = String(versionOutput || "").match(/v?(\d+)(?:\.|$)/);
  const major = Number(match?.[1] || 0);
  return Number.isFinite(major) ? major : 0;
}

function parsePythonVersion(versionOutput = "") {
  const match = String(versionOutput || "").match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  return {
    major: Number(match?.[1] || 0),
    minor: Number(match?.[2] || 0),
    patch: Number(match?.[3] || 0)
  };
}

function pythonVersionMeets(versionOutput = "") {
  const version = parsePythonVersion(versionOutput);
  return version.major > MIN_PYTHON_MAJOR ||
    (version.major === MIN_PYTHON_MAJOR && version.minor >= MIN_PYTHON_MINOR);
}

function nodeVersionMeets(versionOutput = "") {
  return parseNodeMajor(versionOutput) >= MIN_NODE_MAJOR;
}

function javaVersionMeets(versionOutput = "") {
  return parseJavaMajor(versionOutput) >= MIN_JAVA_MAJOR;
}

function runtimeExecutable(root = "", executableName = "") {
  return process.platform === "win32"
    ? path.join(root, "Scripts", `${executableName}.exe`)
    : path.join(root, "bin", executableName);
}

function pythonVenvRoot(context = {}) {
  return path.join(runtimeCacheRoot(context), "python", "venv");
}

function pythonVenvExecutable(context = {}) {
  return runtimeExecutable(pythonVenvRoot(context), "python");
}

function uvInstallRoot(context = {}) {
  return path.join(runtimeCacheRoot(context), "python", "uv");
}

function uvExecutable(context = {}) {
  return process.platform === "win32"
    ? path.join(uvInstallRoot(context), "uv.exe")
    : path.join(uvInstallRoot(context), "bin", "uv");
}

function nvmDir(context = {}) {
  const configured = text(process.env.NVM_DIR || process.env.PACT_NVM_DIR);
  if (configured && pathExists(path.join(configured, "nvm.sh"))) {
    return path.resolve(configured);
  }
  return path.join(runtimeCacheRoot(context), "node", "nvm");
}

function nvmScriptPath(context = {}) {
  return path.join(nvmDir(context), "nvm.sh");
}

function nvmManagedNodePath(context = {}) {
  const version = sourceField(context.sourceConfig, "node", "version") || DEFAULT_NODE_RUNTIME_VERSION;
  return path.join(nvmDir(context), "versions", "node", `v${version}`, "bin", `node${executableSuffix}`);
}

function nodeRuntimeVersionCandidates(context = {}) {
  const configuredVersion = sourceField(context.sourceConfig, "node", "version") || DEFAULT_NODE_RUNTIME_VERSION;
  const explicitFallbacks = text(process.env.PACT_NODE_RUNTIME_FALLBACK_VERSIONS)
    .split(",")
    .map(text)
    .filter(Boolean);
  const candidates = [
    configuredVersion,
    DEFAULT_NODE_RUNTIME_VERSION,
    ...explicitFallbacks,
    ...DEFAULT_NODE_RUNTIME_FALLBACK_VERSIONS
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function parseNvmNodeVersionDir(name = "") {
  const match = /^v(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text(name));
  if (!match) return null;
  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0)
  };
}

function compareNvmNodeVersionDirsDescending(left, right) {
  const leftVersion = parseNvmNodeVersionDir(left) || {};
  const rightVersion = parseNvmNodeVersionDir(right) || {};
  return (rightVersion.major || 0) - (leftVersion.major || 0) ||
    (rightVersion.minor || 0) - (leftVersion.minor || 0) ||
    (rightVersion.patch || 0) - (leftVersion.patch || 0);
}

function nvmManagedNodePaths(context = {}) {
  const configuredVersion = sourceField(context.sourceConfig, "node", "version") || DEFAULT_NODE_RUNTIME_VERSION;
  const versionsRoot = path.join(nvmDir(context), "versions", "node");
  const candidates = [nvmManagedNodePath(context)];
  if (!pathExists(versionsRoot)) {
    return candidates;
  }
  const configuredParts = text(configuredVersion).split(".").filter(Boolean);
  const prefix = `v${configuredParts.join(".")}`;
  const versionDirs = fsSync.readdirSync(versionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      if (name === prefix) return true;
      if (configuredParts.length === 1) return name.startsWith(`${prefix}.`);
      if (configuredParts.length === 2) return name.startsWith(`${prefix}.`);
      return false;
    })
    .sort(compareNvmNodeVersionDirsDescending);
  for (const dirName of versionDirs) {
    candidates.push(path.join(versionsRoot, dirName, "bin", `node${executableSuffix}`));
  }
  return [...new Set(candidates)];
}

function privilegedCommand(command, args = []) {
  if (process.platform === "win32") {
    return { command, args };
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { command, args };
  }
  if (commandPath("sudo")) {
    return { command: "sudo", args: ["-n", command, ...args] };
  }
  return { command, args };
}

function nativePythonInstallPlans() {
  if (process.env.PACT_DISABLE_NATIVE_RUNTIME_INSTALL === "1") return [];
  if (process.platform === "darwin" && commandPath("brew")) {
    return [{ label: "Homebrew python@3.12", commands: [{ command: "brew", args: ["install", "python@3.12"] }] }];
  }
  if (process.platform === "linux") {
    const plans = [];
    if (commandPath("apt-get")) {
      plans.push({
        label: "apt python3-venv",
        commands: [
          privilegedCommand("apt-get", ["update"]),
          privilegedCommand("apt-get", ["install", "-y", "--no-install-recommends", "python3", "python3-venv", "python3-pip"])
        ]
      });
    }
    if (commandPath("dnf")) plans.push({ label: "dnf python3", commands: [privilegedCommand("dnf", ["install", "-y", "python3", "python3-pip"])] });
    if (commandPath("yum")) plans.push({ label: "yum python3", commands: [privilegedCommand("yum", ["install", "-y", "python3", "python3-pip"])] });
    if (commandPath("apk")) plans.push({ label: "apk python3", commands: [privilegedCommand("apk", ["add", "--no-cache", "python3", "py3-pip"])] });
    if (commandPath("pacman")) plans.push({ label: "pacman python", commands: [privilegedCommand("pacman", ["-Sy", "--noconfirm", "python"])] });
    if (commandPath("zypper")) plans.push({ label: "zypper python3", commands: [privilegedCommand("zypper", ["--non-interactive", "install", "python3", "python3-pip"])] });
    return plans;
  }
  if (process.platform === "win32") {
    return [
      commandPath("winget") ? { label: "winget Python 3.12", commands: [{ command: "winget", args: ["install", "--id", "Python.Python.3.12", "-e", "--accept-package-agreements", "--accept-source-agreements"] }] } : null,
      commandPath("choco") ? { label: "Chocolatey python", commands: [{ command: "choco", args: ["install", "-y", "python"] }] } : null,
      commandPath("scoop") ? { label: "Scoop python", commands: [{ command: "scoop", args: ["install", "python"] }] } : null
    ].filter(Boolean);
  }
  return [];
}

function macosVersionInfo() {
  if (process.platform !== "darwin") {
    return {
      productName: "",
      productVersion: "",
      buildVersion: "",
      label: ""
    };
  }
  const swVersPath = pathExists("/usr/bin/sw_vers") ? "/usr/bin/sw_vers" : commandPath("sw_vers");
  if (!swVersPath) {
    return {
      productName: "macOS",
      productVersion: "",
      buildVersion: "",
      label: "macOS"
    };
  }
  const result = runCommand(swVersPath, [], { timeoutMs: 3000 });
  if (result.status !== 0) {
    return {
      productName: "macOS",
      productVersion: "",
      buildVersion: "",
      label: "macOS"
    };
  }
  const fields = new Map(
    text(result.stdout)
      .split(/\r?\n/)
      .map((line) => {
        const separator = line.indexOf(":");
        return separator >= 0
          ? [text(line.slice(0, separator)), text(line.slice(separator + 1))]
          : ["", ""];
      })
      .filter(([key]) => key),
  );
  const productName = fields.get("ProductName") || "macOS";
  const productVersion = fields.get("ProductVersion") || "";
  const buildVersion = fields.get("BuildVersion") || "";
  return {
    productName,
    productVersion,
    buildVersion,
    label: [productName, productVersion].filter(Boolean).join(" ") || "macOS"
  };
}

function executableVersion(executablePath = "", args = ["--version"]) {
  const candidate = text(executablePath);
  if (!candidate || !executableExists(candidate)) return "";
  const result = runCommand(candidate, args, { timeoutMs: 5000 });
  return text([result.stdout, result.stderr].filter(Boolean).join("\n")).split(/\r?\n/)[0] || "";
}

function gatewayRuntimeVersion(adapterId = "", executablePath = "") {
  if (!executablePath) return "";
  if (adapterId === "nginx") return executableVersion(executablePath, ["-v"]);
  if (adapterId === "caddy") return executableVersion(executablePath, ["version"]);
  return executableVersion(executablePath);
}

function clipOutput(value = "", limit = 4000) {
  const content = String(value || "");
  if (content.length <= limit) {
    return content;
  }
  return `${content.slice(0, 1200)}\n...\n${content.slice(-limit + 1206)}`;
}

function commandSummary(result = {}) {
  return {
    status: result.status ?? null,
    signal: result.signal || "",
    stdout: clipOutput(result.stdout || ""),
    stderr: clipOutput(result.stderr || "")
  };
}

function plannedDownloadSteps(targetId = "") {
  const normalized = normalizeTargetId(targetId);
  const planKey = normalized === "java"
    ? "jre"
    : normalized === "language-runtimes"
      ? "programming-runtimes"
      : normalized;
  const plan = RUNTIME_DOWNLOAD_STEP_PLANS[planKey];
  const steps = plan || [
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"]
  ];
  return steps.map(([key, label], index) => ({
    key,
    label,
    index,
    status: DOWNLOAD_STEP_STATUS.PENDING,
    startedAt: "",
    updatedAt: "",
    completedAt: ""
  }));
}

function recomputeDownloadRunProgress(run) {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const completedSteps = steps.filter((step) => step.status === DOWNLOAD_STEP_STATUS.COMPLETED).length;
  let currentStepIndex = steps.findIndex((step) => step.status === DOWNLOAD_STEP_STATUS.RUNNING);
  if (currentStepIndex < 0) {
    currentStepIndex = steps.findIndex((step) => step.status === DOWNLOAD_STEP_STATUS.FAILED);
  }
  if (currentStepIndex < 0) {
    currentStepIndex = Math.min(completedSteps, Math.max(0, steps.length - 1));
  }
  run.totalSteps = steps.length;
  run.completedSteps = completedSteps;
  run.currentStepIndex = currentStepIndex;
  run.currentStepKey = steps[currentStepIndex]?.key || "";
  run.progressPercent = steps.length ? Math.round((completedSteps / steps.length) * 100) : 0;
}

function setDownloadRunStep(run, stepKey = "", status = DOWNLOAD_STEP_STATUS.RUNNING) {
  if (!run || !stepKey) return;
  const step = (run.steps || []).find((item) => item.key === stepKey);
  if (!step) return;
  const at = nowIso();
  step.status = status;
  step.updatedAt = at;
  if (status === DOWNLOAD_STEP_STATUS.RUNNING && !step.startedAt) {
    step.startedAt = at;
  }
  if (status === DOWNLOAD_STEP_STATUS.COMPLETED || status === DOWNLOAD_STEP_STATUS.FAILED) {
    step.completedAt = at;
  }
  recomputeDownloadRunProgress(run);
  scheduleDownloadRunPersist(run);
}

function finishDownloadRunSteps(run, ok) {
  if (!run?.steps?.length) return;
  if (ok) {
    for (const step of run.steps) {
      if (step.status !== DOWNLOAD_STEP_STATUS.COMPLETED) {
        setDownloadRunStep(run, step.key, DOWNLOAD_STEP_STATUS.COMPLETED);
      }
    }
    run.progressPercent = 100;
    scheduleDownloadRunPersist(run);
    return;
  }
  const failed = run.steps.find((step) => step.status === DOWNLOAD_STEP_STATUS.FAILED);
  if (!failed) {
    const active = run.steps.find((step) => step.status === DOWNLOAD_STEP_STATUS.RUNNING) ||
      run.steps.find((step) => step.status === DOWNLOAD_STEP_STATUS.PENDING);
    if (active) {
      setDownloadRunStep(run, active.key, DOWNLOAD_STEP_STATUS.FAILED);
    }
  }
}

function appendDownloadRunLog(run, level, message, data = {}) {
  if (!run) return null;
  const entry = {
    at: nowIso(),
    level,
    message: text(message),
    data
  };
  run.log.push(entry);
  while (run.log.length > MAX_DOWNLOAD_RUN_LOG_LINES) {
    run.log.shift();
  }
  run.updatedAt = entry.at;
  run.latestMessage = entry.message;
  if (data?.stepKey) {
    setDownloadRunStep(run, data.stepKey, data.stepStatus || DOWNLOAD_STEP_STATUS.RUNNING);
  }
  scheduleDownloadRunPersist(run);
  return entry;
}

function publicDownloadRun(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    targetId: run.targetId,
    status: run.status,
    ok: run.ok,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    latestMessage: run.latestMessage,
    steps: (run.steps || []).map((step) => ({ ...step })),
    completedSteps: run.completedSteps || 0,
    totalSteps: run.totalSteps || 0,
    currentStepKey: run.currentStepKey || "",
    currentStepIndex: run.currentStepIndex || 0,
    progressPercent: run.progressPercent || 0,
    log: [...run.log],
    result: run.result || null
  };
}

function serializableDownloadRun(run) {
  const publicRun = publicDownloadRun(run);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: RUNTIME_DEPENDENCIES_PROTOCOL_VERSION,
    persistedAt: nowIso(),
    userDataPath: run.userDataPath || "",
    pid: process.pid,
    ...publicRun
  };
}

function writeJsonAtomicSync(filePath = "", payload = {}) {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fsSync.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fsSync.renameSync(tempPath, filePath);
}

function persistDownloadRunSync(run) {
  if (!run?.storePath) return;
  try {
    writeJsonAtomicSync(run.storePath, serializableDownloadRun(run));
    run.persistError = "";
  } catch (error) {
    run.persistError = error instanceof Error ? error.message : String(error);
  }
}

function scheduleDownloadRunPersist(run) {
  if (!run?.storePath) return;
  if (run.persistTimer) return;
  run.persistTimer = setTimeout(() => {
    run.persistTimer = null;
    persistDownloadRunSync(run);
  }, 0);
  if (typeof run.persistTimer.unref === "function") {
    run.persistTimer.unref();
  }
}

function flushDownloadRunPersist(run) {
  if (!run?.storePath) return;
  if (run.persistTimer) {
    clearTimeout(run.persistTimer);
    run.persistTimer = null;
  }
  persistDownloadRunSync(run);
}

function normalizePersistedDownloadRun(record = {}, input = {}) {
  const targetId = normalizeTargetId(record.targetId || "");
  const runId = sanitizeDownloadRunId(record.runId || "");
  const statusValues = new Set(Object.values(DOWNLOAD_RUN_STATUS));
  const stepStatusValues = new Set(Object.values(DOWNLOAD_STEP_STATUS));
  const steps = Array.isArray(record.steps) && record.steps.length > 0
    ? record.steps.map((step, index) => ({
        key: text(step.key) || `step_${index}`,
        label: text(step.label) || text(step.key) || `Step ${index + 1}`,
        index: Number.isFinite(Number(step.index)) ? Number(step.index) : index,
        status: stepStatusValues.has(step.status) ? step.status : DOWNLOAD_STEP_STATUS.PENDING,
        startedAt: text(step.startedAt),
        updatedAt: text(step.updatedAt),
        completedAt: text(step.completedAt)
      }))
    : plannedDownloadSteps(targetId);
  const run = {
    runId,
    targetId,
    status: statusValues.has(record.status) ? record.status : DOWNLOAD_RUN_STATUS.FAILED,
    ok: record.ok !== false,
    startedAt: text(record.startedAt) || nowIso(),
    updatedAt: text(record.updatedAt) || text(record.startedAt) || nowIso(),
    completedAt: text(record.completedAt),
    latestMessage: text(record.latestMessage) || "已读取持久化下载任务。",
    steps,
    completedSteps: Number(record.completedSteps || 0),
    totalSteps: Number(record.totalSteps || steps.length),
    currentStepKey: text(record.currentStepKey),
    currentStepIndex: Number(record.currentStepIndex || 0),
    progressPercent: Number(record.progressPercent || 0),
    log: Array.isArray(record.log) ? record.log.slice(-MAX_DOWNLOAD_RUN_LOG_LINES).map((entry) => ({
      at: text(entry.at) || nowIso(),
      level: text(entry.level) || "info",
      message: text(entry.message),
      data: entry.data && typeof entry.data === "object" ? entry.data : {}
    })) : [],
    result: record.result && typeof record.result === "object" ? record.result : null,
    userDataPath: dataRoot(input),
    storePath: runtimeDependencyDownloadRunPath(input, runId)
  };
  recomputeDownloadRunProgress(run);
  return run;
}

function isActiveDownloadRunStatus(status = "") {
  return status === DOWNLOAD_RUN_STATUS.QUEUED || status === DOWNLOAD_RUN_STATUS.RUNNING;
}

function markPersistedRunInterrupted(run) {
  if (!run || !isActiveDownloadRunStatus(run.status)) return false;
  run.status = DOWNLOAD_RUN_STATUS.FAILED;
  run.ok = false;
  run.completedAt = nowIso();
  run.result = {
    ok: false,
    targetId: run.targetId,
    status: INSTALL_STATUS.FAILED,
    interrupted: true,
    error: "Server process stopped before the runtime dependency download completed.",
    generatedAt: nowIso()
  };
  finishDownloadRunSteps(run, false);
  appendDownloadRunLog(run, "error", "服务端进程在安装完成前退出，任务已标记为中断，可重新发起安装。");
  flushDownloadRunPersist(run);
  return true;
}

function loadPersistedDownloadRuns(input = {}) {
  const storeRoot = runtimeDependencyDownloadRunStoreRoot(input);
  if (!fsSync.existsSync(storeRoot)) return [];
  const runs = [];
  for (const entry of fsSync.readdirSync(storeRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(storeRoot, entry.name);
    try {
      const record = JSON.parse(fsSync.readFileSync(filePath, "utf8"));
      runs.push(normalizePersistedDownloadRun(record, input));
    } catch {
      // Ignore corrupt run records so one bad file cannot hide active downloads.
    }
  }
  return runs;
}

function liveDownloadRunsFor(input = {}) {
  if (!hasExplicitDownloadRunContext(input)) {
    return [...runtimeDependencyDownloadRuns.values()];
  }
  const expectedRoot = dataRoot(input);
  return [...runtimeDependencyDownloadRuns.values()]
    .filter((run) => path.resolve(run.userDataPath || "") === expectedRoot);
}

function listPublicDownloadRuns(input = {}) {
  const byId = new Map();
  for (const run of liveDownloadRunsFor(input)) {
    byId.set(run.runId, run);
  }
  if (hasExplicitDownloadRunContext(input)) {
    for (const run of loadPersistedDownloadRuns(input)) {
      if (byId.has(run.runId)) continue;
      if (isActiveDownloadRunStatus(run.status)) {
        markPersistedRunInterrupted(run);
      }
      byId.set(run.runId, run);
    }
  }
  const sorted = [...byId.values()]
    .sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)));
  return (hasExplicitDownloadRunContext(input) ? sorted.slice(0, MAX_DOWNLOAD_RUNS) : sorted)
    .map(publicDownloadRun);
}

function pruneDownloadRuns() {
  if (runtimeDependencyDownloadRuns.size <= MAX_DOWNLOAD_RUNS) return;
  const runs = [...runtimeDependencyDownloadRuns.values()]
    .sort((a, b) => String(a.updatedAt || a.startedAt).localeCompare(String(b.updatedAt || b.startedAt)));
  for (const run of runs) {
    if (runtimeDependencyDownloadRuns.size <= MAX_DOWNLOAD_RUNS) break;
    if (run.status !== DOWNLOAD_RUN_STATUS.RUNNING && run.status !== DOWNLOAD_RUN_STATUS.QUEUED) {
      runtimeDependencyDownloadRuns.delete(run.runId);
    }
  }
}

function emitProgress(context = {}, level, message, data = {}) {
  if (typeof context.onProgress === "function") {
    context.onProgress({ level, message, data });
  }
}

function emitStepProgress(context = {}, stepKey, stepStatus, message, level = "info", data = {}) {
  emitProgress(context, level, message, {
    ...data,
    stepKey,
    stepStatus
  });
}

function emitCommandOutput(context = {}, streamName, chunk) {
  const lines = String(chunk || "").split(/\r?\n|\r/).map(text).filter(Boolean);
  for (const line of lines.slice(-12)) {
    emitProgress(context, streamName === "stderr" ? "warning" : "info", `${streamName}: ${clipOutput(line, 600)}`, {
      stepKey: context.stepKey,
      stepStatus: context.stepKey ? DOWNLOAD_STEP_STATUS.RUNNING : undefined
    });
  }
}

function runCommandAsync(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || 600000;
  const maxBuffer = options.maxBuffer || 1024 * 1024 * 12;
  const commandLabel = [command, ...args].join(" ");
  emitProgress(options, "info", `执行命令：${commandLabel}`, {
    stepKey: options.stepKey,
    stepStatus: options.stepKey ? DOWNLOAD_STEP_STATUS.RUNNING : undefined
  });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...(options.env || {}) }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      emitProgress(options, "warning", `命令超时，正在终止：${commandLabel}`, {
        stepKey: options.stepKey,
        stepStatus: options.stepKey ? DOWNLOAD_STEP_STATUS.FAILED : undefined
      });
      child.kill("SIGTERM");
    }, timeoutMs);
    const collect = (streamName, chunk) => {
      const value = String(chunk || "");
      if (streamName === "stdout") {
        stdout = `${stdout}${value}`.slice(-maxBuffer);
      } else {
        stderr = `${stderr}${value}`.slice(-maxBuffer);
      }
      emitCommandOutput(options, streamName, value);
    };
    child.stdout?.on("data", (chunk) => collect("stdout", chunk));
    child.stderr?.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr = `${stderr}\n${error instanceof Error ? error.message : String(error)}`.slice(-maxBuffer);
      emitProgress(options, "error", `命令启动失败：${commandLabel}`, {
        stepKey: options.stepKey,
        stepStatus: options.stepKey ? DOWNLOAD_STEP_STATUS.FAILED : undefined
      });
      resolve({ status: 1, signal: "", stdout, stderr });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const status = code ?? (signal ? 1 : 0);
      emitProgress(
        options,
        status === 0 && !timedOut ? "info" : "warning",
        `命令结束：${commandLabel}，退出码 ${status}${signal ? `，信号 ${signal}` : ""}`,
        {
          stepKey: options.stepKey,
          stepStatus: status === 0 && !timedOut ? DOWNLOAD_STEP_STATUS.COMPLETED : DOWNLOAD_STEP_STATUS.FAILED
        }
      );
      resolve({ status, signal: signal || "", stdout, stderr });
    });
  });
}

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    return { __readError: error instanceof Error ? error.message : String(error) };
  }
}

function dependencyStatus({ present = false, cached = false }) {
  if (present) return INSTALL_STATUS.PRESENT;
  if (cached) return INSTALL_STATUS.INSTALLED;
  return INSTALL_STATUS.FAILED;
}

function configValue(value, fallback = "未配置") {
  if (Array.isArray(value)) {
    return value.length ? value.map(text).filter(Boolean).join(", ") : fallback;
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  const normalized = text(value);
  return normalized || fallback;
}

function configEntry(kind, key, label, value, options = {}) {
  const normalizedValue = configValue(value, options.fallback || "未配置");
  const entry = {
    kind,
    key,
    label,
    value: normalizedValue,
    configured: options.configured ?? normalizedValue !== "未配置",
    required: options.required === true,
    source: text(options.source || ""),
    description: text(options.description || "")
  };
  if (options.editable === true) {
    entry.editable = true;
  }
  if (options.inputType) {
    entry.inputType = text(options.inputType);
  }
  if (Array.isArray(options.options)) {
    entry.options = options.options
      .map((option) => ({
        label: text(option?.label ?? option?.value ?? option),
        value: text(option?.value ?? option?.label ?? option)
      }))
      .filter((option) => option.value || option.label);
  }
  return entry;
}

function configGroup(kind, title, entries = []) {
  return {
    kind,
    title,
    entries: entries.filter(Boolean)
  };
}

function runtimeConfiguration(...groups) {
  return groups.filter((group) => group?.entries?.length);
}

function envConfigEntry(name, description = "") {
  const configured = Object.prototype.hasOwnProperty.call(process.env, name);
  return configEntry("env", name, name, configured ? process.env[name] : "", {
    configured,
    description
  });
}

function platformConfigurationGroup(context = {}) {
  return configGroup("path", "平台目录", [
    configEntry("path", "PACT_SERVER_DATA_DIR", "服务数据目录", dataRoot(context), {
      source: "PACT_SERVER_DATA_DIR / 默认用户数据目录"
    }),
    configEntry("path", "PACT_RUNTIME_DEPENDENCY_CACHE_DIR", "运行时缓存目录", runtimeCacheRoot(context), {
      source: "PACT_RUNTIME_DEPENDENCY_CACHE_DIR / 服务数据目录"
    }),
    configEntry("path", "runtimeDependencySourceConfig", "运行时源配置", context.sourceConfigPath || runtimeDependencySourceConfigPath(context), {
      source: "runtime/runtime-dependency-sources.json"
    })
  ]);
}

function sourceConfigurationGroup(context = {}, targetId = "", fields = [], title = "下载源配置") {
  const root = context.sourceConfig?.sources?.[targetId] || {};
  const entry = sourceEntry(context.sourceConfig, targetId);
  const entries = fields.map((field) => configEntry(
    "source",
    `sources.${targetId}.${field.key}`,
    field.label,
    entry?.[field.key],
    {
      editable: true,
      inputType: field.inputType || (String(field.key || "").toLowerCase().includes("url") ? "url" : "text"),
      required: field.required === true,
      source: context.sourceConfigPath || runtimeDependencySourceConfigPath(context),
      description: field.description || ""
    }
  ));
  if (Array.isArray(root.mirrors)) {
    entries.push(configEntry("source", `sources.${targetId}.mirrors`, "镜像源", root.mirrors, {
      editable: true,
      inputType: "textarea",
      configured: root.mirrors.length > 0,
      source: context.sourceConfigPath || runtimeDependencySourceConfigPath(context)
    }));
  }
  if (Array.isArray(root.images)) {
    entries.push(configEntry("source", `sources.${targetId}.images`, "Docker 镜像", root.images, {
      editable: true,
      inputType: "textarea",
      configured: root.images.length > 0,
      source: context.sourceConfigPath || runtimeDependencySourceConfigPath(context)
    }));
  }
  if (Object.prototype.hasOwnProperty.call(root, "mirrorPrefix")) {
    entries.push(configEntry("source", `sources.${targetId}.mirrorPrefix`, "镜像前缀", root.mirrorPrefix, {
      editable: true,
      inputType: "text",
      configured: Boolean(text(root.mirrorPrefix)),
      source: context.sourceConfigPath || runtimeDependencySourceConfigPath(context)
    }));
  }
  if (Object.prototype.hasOwnProperty.call(root, "version")) {
    entries.push(configEntry("source", `sources.${targetId}.version`, "版本", root.version, {
      editable: true,
      inputType: "text",
      source: context.sourceConfigPath || runtimeDependencySourceConfigPath(context)
    }));
  }
  return configGroup("source", title, entries);
}

function asDependency({
  id,
  label,
  category,
  description,
  status,
  present = false,
  cached = false,
  downloadable = false,
  children = [],
  detection = {},
  actions = {},
  accepts = {},
  configuration = []
}) {
  return {
    id,
    label,
    category,
    description,
    status,
    present,
    cached,
    downloadable,
    children,
    detection,
    actions,
    accepts,
    configuration
  };
}

function knowledgeBackendTarget(targetId = "") {
  const normalized = normalizeTargetId(targetId);
  if (normalized === "ragflow" || normalized === "rag-flow" || normalized === "rag-flow-backend") {
    return KNOWLEDGE_BACKEND_TARGETS.find((target) => target.providerId === "ragflow");
  }
  if (normalized === "dify" || normalized === "dify-backend") {
    return KNOWLEDGE_BACKEND_TARGETS.find((target) => target.providerId === "dify");
  }
  return null;
}

function knowledgeBackendConfiguredImages(context = {}, targetId = "") {
  const configuredImages = context.sourceConfig?.sources?.[targetId]?.images;
  return Array.isArray(configuredImages) ? configuredImages.map(text).filter(Boolean) : [];
}

function knowledgeBackendProviderHasEndpoint(provider = {}) {
  return Boolean(text(
    provider.endpoint ||
    provider.endpointUrl ||
    provider.baseUrl ||
    provider.url
  ));
}

function knowledgeBackendProviderIsReady(provider = null) {
  if (!provider || provider.enabled === false) return false;
  const mode = text(provider.mode || "contract").toLowerCase();
  if (mode === "contract") return false;
  return Boolean(provider.credentialConfigured) && knowledgeBackendProviderHasEndpoint(provider);
}

async function detectKnowledgeBackendProvider(target, context = {}) {
  const userDataPath = text(context.userDataPath);
  const configPath = knowledgeBackendConfigPath(userDataPath);
  const config = await readJson(configPath, {});
  const provider = config && typeof config.providers === "object" && !Array.isArray(config.providers)
    ? config.providers[target.providerId]
    : null;
  const docker = detectDockerSync(context);
  const configuredImages = knowledgeBackendConfiguredImages(context, target.targetId);
  const images = docker.ready
    ? configuredImages.map((image) => ({
        image,
        present: dockerImagePresent(image)
      }))
    : configuredImages.map((image) => ({ image, present: false }));
  const imageCount = images.filter((item) => item.present).length;
  const configured = pathExists(configPath) && Boolean(provider);
  const providerReady = knowledgeBackendProviderIsReady(provider);
  const present = providerReady || (images.length > 0 && imageCount === images.length);
  const presentImages = images.filter((item) => item.present).map((item) => item.image);
  const availabilityLabel = providerReady
    ? "已配置真实后端"
    : configured
      ? "配置占位，未接入真实后端"
      : presentImages.length
        ? "Docker 镜像已存在"
        : "未安装";
  const source = providerReady
    ? detectionSource("platform-config", "平台配置", configPath, `${target.label} provider ready: ${target.providerId}`)
    : configured
      ? detectionSource("platform-config-placeholder", "平台配置占位", configPath, `${target.label} 未配置真实 endpoint 或凭据`)
    : presentImages.length
      ? detectionSource("docker-image", "Docker 镜像", "", presentImages.join(", "))
      : missingDetectionSource(configPath, `${target.label} provider 未配置`);
  return asDependency({
    id: target.targetId,
    label: target.label,
    category: "knowledge",
    description: target.description,
    status: dependencyStatus({ present }),
    present,
    downloadable: docker.ready && images.length > 0,
    detection: {
      configPath,
      provider: target.providerId,
      configured,
      providerReady,
      availabilityLabel,
      endpointConfigured: knowledgeBackendProviderHasEndpoint(provider || {}),
      credentialConfigured: Boolean(provider?.credentialConfigured),
      mode: text(provider?.mode || ""),
      dockerReady: docker.ready,
      images,
      source,
      sourcePolicy: `${target.label} config first; optional Docker images only when configured in local source config`
    },
    actions: {
      download: providerReady
        ? "already-configured"
        : images.length === 0
          ? "configure-provider-or-images"
          : docker.ready
            ? "docker-pull"
            : "install-docker-first"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      configGroup("file", "配置文件", [
        configEntry("file", "knowledgeBackendConfigPath", "知识后端配置", configPath, {
          configured: pathExists(configPath),
          description: "providers 配置从这里读取"
        }),
        configEntry("setting", "provider", "Provider", target.providerId),
        configEntry("setting", "configured", "Provider 已配置", configured),
        configEntry("setting", "credentialConfigured", "凭据已配置", Boolean(provider?.credentialConfigured)),
        configEntry("setting", "mode", "运行模式", provider?.mode || "", { configured: Boolean(text(provider?.mode || "")) }),
        configEntry("setting", "dockerReady", "Docker 可用", docker.ready)
      ]),
      sourceConfigurationGroup(context, target.targetId)
    )
  });
}

async function detectKnowledgeBackends(context = {}) {
  const dependencies = await Promise.all(
    KNOWLEDGE_BACKEND_TARGETS.map((target) => detectKnowledgeBackendProvider(target, context))
  );
  const missing = dependencies.filter((item) => !item.present);
  return asDependency({
    id: "knowledge-backends",
    label: "Knowledge backends",
    category: "knowledge",
    description: "Compatibility aggregate for Dify and RAG Flow backend knowledge adapters.",
    status: dependencyStatus({ present: missing.length === 0 }),
    present: missing.length === 0,
    downloadable: dependencies.some((item) => item.downloadable),
    children: dependencies,
    detection: {
      sourcePolicy: "compatibility aggregate; console lists Dify and RAG Flow separately"
    },
    actions: {
      download: missing.length === 0 ? "already-present" : "prepare-children"
    }
  });
}

async function detectCloudDrives(context = {}) {
  const userDataPath = text(context.userDataPath);
  const configPath = cloudDriveConfigPath(userDataPath);
  const config = await readJson(configPath, {});
  const connections = config && typeof config.connections === "object" && !Array.isArray(config.connections)
    ? Object.keys(config.connections)
    : [];
  const cloudStorageRoot = path.join(os.homedir(), "Library", "CloudStorage");
  const icloudRoot = path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
  const present = connections.length > 0 || pathExists(icloudRoot) || pathExists(cloudStorageRoot);
  const icloudAvailable = pathExists(icloudRoot);
  const cloudStorageAvailable = pathExists(cloudStorageRoot);
  const macos = macosVersionInfo();
  const icloudVersionLabel = icloudAvailable
    ? `iCloud Drive · ${macos.label || "macOS 系统服务"}`
    : "";
  const availabilityLabel = connections.length
    ? `已配置：${connections.join(", ")}`
    : icloudVersionLabel ||
      (cloudStorageAvailable ? "系统云盘目录" : "");
  const source = connections.length
    ? detectionSource("platform-config", "平台配置", configPath, `已配置：${connections.join(", ")}`)
    : icloudAvailable
      ? detectionSource("system-folder", "系统 iCloud", icloudRoot, icloudVersionLabel)
      : cloudStorageAvailable
        ? detectionSource("system-folder", "系统云盘目录", cloudStorageRoot)
        : missingDetectionSource(configPath, "未发现云盘配置或系统云盘目录");
  return asDependency({
    id: "cloud-drives",
    label: "Cloud drives",
    category: "cloud",
    description: "iCloud and OneDrive local folder projections plus contract/remote manifests for later OAuth-backed cloud drive adapters.",
    status: dependencyStatus({ present }),
    present,
    downloadable: false,
    detection: {
      configPath,
      configuredConnections: connections,
      availabilityLabel,
      version: icloudVersionLabel || availabilityLabel,
      macos,
      icloudRoot,
      icloudAvailable,
      icloudVersionLabel,
      cloudStorageRoot,
      cloudStorageAvailable,
      source,
      sourcePolicy: "local folder projection first; OAuth/secret-ref remote adapters are future or contract-mode configuration"
    },
    actions: {
      download: "local-provider-auth"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      configGroup("file", "配置文件", [
        configEntry("file", "cloudDriveConfigPath", "云盘连接配置", configPath, {
          configured: pathExists(configPath),
          description: "OAuth 或 secret-ref 连接清单"
        }),
        configEntry("setting", "configuredConnections", "已配置连接", connections, {
          configured: connections.length > 0
        })
      ]),
      configGroup("path", "系统目录", [
        configEntry("path", "icloudRoot", "iCloud 本地目录", icloudRoot, { configured: icloudAvailable }),
        configEntry("setting", "icloudVersion", "iCloud 版本来源", icloudVersionLabel, {
          configured: icloudAvailable,
          description: "iCloud Drive 是 macOS 系统服务，版本随 macOS 发布。"
        }),
        configEntry("path", "cloudStorageRoot", "CloudStorage 目录", cloudStorageRoot, { configured: cloudStorageAvailable })
      ])
    )
  });
}

function dockerDefaultInstallerUrl() {
  if (process.platform !== "darwin") {
    return "";
  }
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `https://desktop.docker.com/mac/main/${arch}/Docker.dmg`;
}

function detectDockerSync(context = {}) {
  const dockerPath = commandPath("docker");
  const appPath = process.platform === "darwin" ? "/Applications/Docker.app" : "";
  const installerFileName = sourceField(context.sourceConfig, "docker", "fileName") || `Docker-${platformKey}.dmg`;
  const installerPath = path.join(runtimeCacheRoot(context), "docker", installerFileName);
  const appPresent = appPath ? pathExists(appPath) : false;
  return {
    id: "docker",
    ready: Boolean(dockerPath),
    present: Boolean(dockerPath) || appPresent,
    cached: pathExists(installerPath),
    dockerPath,
    appPath,
    appPresent,
    installerPath,
    version: dockerPath ? commandVersion("docker", ["--version"]) : ""
  };
}

async function detectDocker(context = {}) {
  const docker = detectDockerSync(context);
  const source = docker.dockerPath
    ? detectionSource("system-path", PATH_ENV_SOURCE_LABEL, docker.dockerPath)
    : docker.appPresent
      ? detectionSource("system-app", "系统应用", docker.appPath)
      : docker.cached
        ? detectionSource("platform-cache", "平台缓存安装包", docker.installerPath)
        : missingDetectionSource(docker.installerPath, "平台缓存安装包未生成");
  return asDependency({
    id: "docker",
    label: "Docker",
    category: "container",
    description: "Docker CLI/Desktop used only when the user explicitly pulls container-backed runtimes.",
    status: dependencyStatus({ present: docker.present, cached: docker.cached }),
    present: docker.present,
    cached: docker.cached,
    downloadable: true,
    detection: {
      dockerPath: docker.dockerPath,
      appPath: docker.appPath,
      appPresent: docker.appPresent,
      installerPath: docker.installerPath,
      installerCached: docker.cached,
      version: docker.version,
      source,
      sourcePolicy: "PATH or Docker Desktop app, then cached installer, then local source config"
    },
    actions: {
      download: docker.present ? "already-present" : docker.cached ? "already-installed" : "download-installer"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      configGroup("env", "环境变量", [
        envConfigEntry("PACT_DOCKER_RUNTIME_URL", "Docker Desktop 安装包下载源覆盖")
      ]),
      sourceConfigurationGroup(context, "docker", [
        { key: "url", label: "安装包 URL", required: true },
        { key: "fileName", label: "缓存文件名" }
      ]),
      configGroup("path", "本地路径", [
        configEntry("path", "dockerPath", "Docker CLI", docker.dockerPath, { configured: Boolean(docker.dockerPath) }),
        configEntry("path", "appPath", "Docker Desktop", docker.appPath, { configured: docker.appPresent }),
        configEntry("path", "installerPath", "安装包缓存", docker.installerPath, { configured: docker.cached })
      ]),
      configGroup("argument", "命令行参数", [
        configEntry("command", "docker --version", "版本探测命令", "docker --version")
      ])
    )
  });
}

function dockerImagePresent(image) {
  if (!commandPath("docker")) {
    return false;
  }
  const result = runCommand("docker", ["image", "inspect", image], { timeoutMs: 4000, maxBuffer: 1024 * 1024 });
  return result.status === 0;
}

async function detectJre(context = {}) {
  const settings = await loadSettings(dataRoot(context), { redactSecrets: true }).catch(() => ({}));
  const javaName = `java${executableSuffix}`;
  const configuredJavaPath = safePath(settings.javaBinPath || process.env.PACT_JAVA_BIN_PATH || "");
  const managedJavaCandidates = [
    path.join(runtimeCacheRoot(context), "jre", platformKey, "bin", javaName),
    path.join(runtimeCacheRoot(context), "jre", platformKey, "Contents", "Home", "bin", javaName),
    path.join(runtimeCacheRoot(context), "jre", platformKey, "Home", "bin", javaName),
    path.join(runtimeCacheRoot(context), "jre", platformKey, "jre", "bin", javaName)
  ];
  const platformJavaCandidates = [
    path.join(KNOWLEDGE_MODULE_ROOT, "runtime", "jre", platformKey, "bin", javaName),
    path.join(KNOWLEDGE_MODULE_ROOT, "runtime", "jre", platformKey, "Contents", "Home", "bin", javaName)
  ];
  const pathJava = commandPath("java");
  const candidates = [
    configuredJavaPath,
    ...managedJavaCandidates,
    ...platformJavaCandidates,
    pathJava
  ].filter(Boolean);
  const javaPath = candidates.find((candidate) => executableExists(candidate) || candidate === "java" || pathExists(candidate)) || "";
  const javaVersion = javaPath ? commandVersion(javaPath, ["-version"]) : "";
  const javaCompatible = javaVersionMeets(javaVersion);
  const tikaJarPath = [
    safePath(settings.tikaJarPath || process.env.PACT_TIKA_JAR_PATH || ""),
    path.join(runtimeCacheRoot(context), "tika", `tika-app-${TIKA_VERSION}.jar`),
    path.join(runtimeCacheRoot(context), "tika", "tika-app.jar"),
    path.join(KNOWLEDGE_MODULE_ROOT, "tika", `tika-app-${TIKA_VERSION}.jar`),
    path.join(KNOWLEDGE_MODULE_ROOT, "tika", "tika-app.jar")
  ].find(pathExists) || "";
  const present = Boolean(javaPath && javaCompatible && tikaJarPath);
  const source = javaPath
    ? detectionSource(
        configuredJavaPath && javaPath === configuredJavaPath
          ? "configured-path"
          : managedJavaCandidates.includes(javaPath) || platformJavaCandidates.includes(javaPath)
            ? "platform-runtime"
            : "system-path",
        configuredJavaPath && javaPath === configuredJavaPath
          ? "自定义配置"
          : managedJavaCandidates.includes(javaPath) || platformJavaCandidates.includes(javaPath)
            ? "平台本地运行时"
            : PATH_ENV_SOURCE_LABEL,
        javaPath,
        tikaJarPath ? `Tika：${tikaJarPath}` : ""
      )
    : missingDetectionSource(platformJavaCandidates[0], "平台本地 JRE 未安装");
  return asDependency({
    id: "jre",
    label: "Java 环境",
    category: "language-runtime",
    description: "Java runtime for Java-backed document parsing and Gerrit WAR runner.",
    status: dependencyStatus({ present }),
    present,
    downloadable: true,
    detection: {
      javaPath,
      javaVersion,
      javaMajor: parseJavaMajor(javaVersion),
      javaCompatible,
      minimumJavaMajor: MIN_JAVA_MAJOR,
      tikaJarPath,
      tikaVersion: TIKA_VERSION,
      source,
      sourcePolicy: "settings -> managed runtime cache -> bundled runtime -> PATH -> local source config"
    },
    actions: {
      download: present ? "already-present" : javaPath && !javaCompatible ? "upgrade-java" : "install-native-or-download-jre"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      configGroup("env", "环境变量", [
        envConfigEntry("PACT_JAVA_BIN_PATH", "覆盖 Java 可执行文件路径"),
        envConfigEntry("PACT_TIKA_JAR_PATH", "覆盖 Tika app jar 路径"),
        envConfigEntry("PACT_JRE_DOWNLOAD_URL", "setup-local-runtime 脚本使用的 JRE 下载 URL"),
        envConfigEntry("PACT_JRE_DOWNLOAD_FILE", "setup-local-runtime 脚本使用的 JRE 文件名"),
        envConfigEntry("PACT_TIKA_DOWNLOAD_URL", "setup-local-runtime 脚本使用的 Tika 下载 URL"),
        envConfigEntry("PACT_TIKA_DOWNLOAD_FILE", "setup-local-runtime 脚本使用的 Tika 文件名")
      ]),
      configGroup("file", "平台设置", [
        configEntry("setting", "settings.javaBinPath", "settings.javaBinPath", settings.javaBinPath || "", {
          configured: Boolean(text(settings.javaBinPath || ""))
        }),
        configEntry("setting", "settings.tikaJarPath", "settings.tikaJarPath", settings.tikaJarPath || "", {
          configured: Boolean(text(settings.tikaJarPath || ""))
        }),
        configEntry("setting", "settings.tikaTimeoutMs", "settings.tikaTimeoutMs", settings.tikaTimeoutMs || "")
      ]),
      sourceConfigurationGroup(context, "jre", [
        { key: "url", label: "JRE 下载 URL", required: true },
        { key: "fileName", label: "JRE 文件名" }
      ], "JRE 下载源"),
      sourceConfigurationGroup(context, "tika", [
        { key: "url", label: "Tika 下载 URL", required: true },
        { key: "fileName", label: "Tika 文件名" }
      ], "Tika 下载源"),
      configGroup("path", "本地路径", [
        configEntry("path", "javaPath", "Java 可执行文件", javaPath, { configured: Boolean(javaPath) }),
        configEntry("path", "tikaJarPath", "Tika app jar", tikaJarPath, { configured: Boolean(tikaJarPath) })
      ]),
      configGroup("argument", "命令行参数", [
        configEntry("command", "setup-local-runtime", "安装命令", `${process.execPath} server/scripts/setup-local-runtime.mjs`)
      ])
    )
  });
}

async function detectPython(context = {}) {
  const settings = await loadSettings(dataRoot(context), { redactSecrets: true }).catch(() => ({}));
  const explicitPaths = [
    settings.ocrPythonPath,
    settings.pdfVisualPythonPath,
    process.env.PACT_OCR_PYTHON_PATH,
    process.env.PACT_PDF_VISUAL_PYTHON_PATH,
    process.env.PACT_PYTHON_BIN_PATH
  ].map(safePath).filter(Boolean);
  const moduleCandidates = [
    pythonVenvExecutable(context),
    path.join(KNOWLEDGE_MODULE_ROOT, "ocr", "runtime", platformKey, "bin", `python${executableSuffix}`),
    path.join(KNOWLEDGE_MODULE_ROOT, "pdf", "runtime", platformKey, "bin", `python${executableSuffix}`),
    path.join(repoRoot, ".venv-pdf", "bin", "python"),
    path.join(repoRoot, ".venv", "bin", "python")
  ];
  const pathCandidates = ["python3", "python"].map(commandPath).filter(Boolean);
  let pythonPath = "";
  let pythonVersion = "";
  let rejectedPythonPath = "";
  let rejectedPythonVersion = "";
  for (const candidate of [...explicitPaths, ...moduleCandidates, ...pathCandidates]) {
    if (!(executableExists(candidate) || pathExists(candidate))) {
      continue;
    }
    const version = executableCommandVersion(candidate, ["--version"]);
    if (pythonVersionMeets(version)) {
      pythonPath = candidate;
      pythonVersion = version;
      break;
    }
    if (!rejectedPythonPath) {
      rejectedPythonPath = candidate;
      rejectedPythonVersion = version;
    }
  }
  const artifactFileName = sourceField(context.sourceConfig, "python", "fileName") || `python-${platformKey}`;
  const artifactPath = path.join(runtimeCacheRoot(context), "python", artifactFileName);
  const pythonDownloadUrl = sourceField(context.sourceConfig, "python", "url") || text(process.env.PACT_PYTHON_RUNTIME_URL || defaultPythonPackageUrl());
  const venvPath = pythonVenvRoot(context);
  const uvPath = commandPath("uv") || uvExecutable(context);
  const source = pythonPath
    ? detectionSource(
        explicitPaths.includes(pythonPath)
          ? "configured-path"
          : moduleCandidates.includes(pythonPath)
            ? "platform-runtime"
            : "system-path",
        explicitPaths.includes(pythonPath)
          ? "自定义配置"
          : moduleCandidates.includes(pythonPath)
            ? "平台本地运行时"
            : PATH_ENV_SOURCE_LABEL,
        pythonPath
      )
    : pathExists(artifactPath)
      ? detectionSource("platform-cache", "平台缓存安装包", artifactPath)
      : rejectedPythonPath
        ? missingDetectionSource(rejectedPythonPath, `Python 版本过低：${rejectedPythonVersion || "unknown"}`)
        : missingDetectionSource(venvPath, "平台 Python venv 未生成");
  return asDependency({
    id: "python",
    label: "Python 环境",
    category: "language-runtime",
    description: "Python runtime used by optional OCR and PDF visual sidecars.",
    status: dependencyStatus({ present: Boolean(pythonPath), cached: pathExists(artifactPath) }),
    present: Boolean(pythonPath),
    cached: pathExists(artifactPath),
    downloadable: true,
    detection: {
      pythonPath,
      pythonVersion,
      minimumPythonVersion: `${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}`,
      venvPath,
      venvPythonPath: pythonVenvExecutable(context),
      uvPath: pathExists(uvPath) || executableExists(uvPath) ? uvPath : "",
      artifactPath,
      artifactCached: pathExists(artifactPath),
      source,
      sourcePolicy: "settings/env -> managed venv -> bundled venv -> PATH -> pyenv/asdf/uv/native package manager"
    },
    actions: {
      download: pythonPath ? "already-present" : "create-managed-venv"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      configGroup("env", "环境变量", [
        envConfigEntry("PACT_OCR_PYTHON_PATH", "覆盖 OCR 侧车 Python 路径"),
        envConfigEntry("PACT_PDF_VISUAL_PYTHON_PATH", "覆盖 PDF 视觉侧车 Python 路径"),
        envConfigEntry("PACT_PYTHON_BIN_PATH", "覆盖通用 Python 路径"),
        envConfigEntry("PACT_PYTHON_RUNTIME_URL", "Python 安装包下载源覆盖"),
        envConfigEntry("PACT_PYTHON_RUNTIME_VERSION", "默认 Python 版本覆盖")
      ]),
      sourceConfigurationGroup(context, "python", [
        { key: "version", label: "Python 版本" },
        { key: "url", label: "安装包 URL" },
        { key: "fileName", label: "缓存文件名" },
        { key: "uvInstallUrl", label: "uv 安装脚本 URL", inputType: "url" }
      ]),
      configGroup("path", "本地路径", [
        configEntry("path", "pythonPath", "Python 可执行文件", pythonPath, { configured: Boolean(pythonPath) }),
        configEntry("path", "venvPath", "托管 venv", venvPath, { configured: pathExists(venvPath) }),
        configEntry("path", "uvPath", "uv/版本管理器", uvPath, { configured: Boolean(pathExists(uvPath) || executableExists(uvPath)) }),
        configEntry("path", "artifactPath", "安装包缓存", artifactPath, { configured: pathExists(artifactPath) })
      ]),
      configGroup("argument", "命令行参数", [
        configEntry("command", "python -m venv", "venv 创建命令", `${pythonPath || "python3"} -m venv ${venvPath}`),
        configEntry("command", "uv/pyenv/asdf/native", "版本管理器优先级", "uv -> pyenv -> asdf -> system python -> native package manager"),
        configEntry("argument", "url", "备用下载 URL", pythonDownloadUrl)
      ])
    )
  });
}

async function detectNode(context = {}) {
  const managedNodePaths = nvmManagedNodePaths(context);
  const managedNodePath = managedNodePaths[0] || nvmManagedNodePath(context);
  const managedNodePathSet = new Set(managedNodePaths.map((candidate) => path.resolve(candidate)));
  const pathNode = commandPath("node");
  const nodeCandidates = [
    ...managedNodePaths,
    pathNode,
    process.execPath
  ].map(text).filter(Boolean);
  let nodePath = "";
  let version = "";
  let rejectedNodePath = "";
  let rejectedVersion = "";
  for (const candidate of nodeCandidates) {
    if (!(executableExists(candidate) || pathExists(candidate))) {
      continue;
    }
    const candidateVersion = executableCommandVersion(candidate, ["--version"]) || (candidate === process.execPath ? process.version : "");
    if (nodeVersionMeets(candidateVersion)) {
      nodePath = candidate;
      version = candidateVersion;
      break;
    }
    if (!rejectedNodePath) {
      rejectedNodePath = candidate;
      rejectedVersion = candidateVersion;
    }
  }
  const nvmScript = nvmScriptPath(context);
  const present = Boolean(nodePath);
  return asDependency({
    id: "node",
    label: "Node.js 环境",
    category: "language-runtime",
    description: "Current server Node.js runtime.",
    status: dependencyStatus({ present }),
    present,
    downloadable: true,
    detection: {
      nodePath,
      version,
      minimumNodeMajor: MIN_NODE_MAJOR,
      managedNodePath,
      nvmDir: nvmDir(context),
      nvmScriptPath: nvmScript,
      nvmAvailable: pathExists(nvmScript),
      source: nodePath && managedNodePathSet.has(path.resolve(nodePath))
          ? detectionSource("platform-runtime", "平台 nvm 托管运行时", nodePath)
          : nodePath && nodePath === pathNode
            ? detectionSource("system-path", PATH_ENV_SOURCE_LABEL, pathNode)
          : nodePath
            ? detectionSource("current-process", "当前服务进程", nodePath)
            : missingDetectionSource(rejectedNodePath || managedNodePath, rejectedVersion ? `Node.js 版本过低：${rejectedVersion}` : "Node.js 运行时未安装")
    },
    actions: {
      download: present ? "already-present" : "install-with-nvm"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      sourceConfigurationGroup(context, "node", [
        { key: "version", label: "Node.js 版本" },
        { key: "nvmInstallUrl", label: "nvm 安装脚本 URL", inputType: "url" }
      ]),
      configGroup("path", "本地路径", [
        configEntry("path", "nodePath", "Node.js 可执行文件", nodePath, { configured: Boolean(nodePath) }),
        configEntry("path", "process.execPath", "当前服务进程 Node", process.execPath),
        configEntry("path", "nvmDir", "nvm 目录", nvmDir(context), { configured: pathExists(nvmScript) }),
        configEntry("path", "managedNodePath", "托管 Node", managedNodePath, { configured: pathExists(managedNodePath) || executableExists(managedNodePath) })
      ]),
      configGroup("argument", "命令行参数", [
        configEntry("command", "node --version", "版本探测命令", "node --version"),
        configEntry("command", "nvm install", "安装命令", `nvm install ${sourceField(context.sourceConfig, "node", "version") || DEFAULT_NODE_RUNTIME_VERSION}`)
      ])
    )
  });
}

async function detectProgrammingRuntimes(context = {}) {
  const [jre, python, node] = await Promise.all([
    detectJre(context),
    detectPython(context),
    detectNode(context)
  ]);
  const children = [jre, python, node];
  const missing = children.filter((item) => !item.present);
  return asDependency({
    id: "programming-runtimes",
    label: "Java / Python / Node.js runtimes",
    category: "language-runtime",
    description: "Language runtimes Pact can prepare on demand for supported adapters.",
    status: dependencyStatus({ present: missing.length === 0 }),
    present: missing.length === 0,
    downloadable: true,
    children,
    detection: {
      sourcePolicy: "detect each runtime first; download only the missing runtime when explicitly requested"
    },
    actions: {
      download: missing.length === 0 ? "already-present" : "prepare-missing-children"
    }
  });
}

async function detectGateway(adapterId, context = {}) {
  const sourceConfig = context.sourceConfig || {};
  const configuredRuntimeUrl = sourceField(sourceConfig, adapterId, "url");
  const plan = resolveGatewayRuntimePlan({
    adapterId,
    runtimeUrl: configuredRuntimeUrl,
    cacheRoot: gatewayRuntimeCacheRoot(context)
  });
  const configuredPresent = plan.configuredBinary ? executableExists(plan.configuredBinary) || pathExists(plan.configuredBinary) : false;
  const cachedPresent = executableExists(plan.cachedExecutablePath) || pathExists(plan.cachedExecutablePath);
  const pathBinary = commandPath(plan.executableName);
  const present = configuredPresent || cachedPresent || Boolean(pathBinary);
  const executablePath = configuredPresent
    ? plan.configuredBinary
    : cachedPresent
      ? plan.cachedExecutablePath
      : pathBinary;
  const version = gatewayRuntimeVersion(adapterId, executablePath);
  const source = configuredPresent
    ? detectionSource("configured-path", "自定义配置", plan.configuredBinary)
    : cachedPresent
      ? detectionSource("platform-runtime", "平台本地安装", plan.cachedExecutablePath)
      : pathBinary
        ? detectionSource("system-path", PATH_ENV_SOURCE_LABEL, pathBinary)
        : missingDetectionSource(plan.cachedExecutablePath, "平台网关运行时未安装");
  return asDependency({
    id: adapterId,
    label: adapterId === "nginx" ? "Nginx" : "Caddy",
    category: "gateway",
    description: `${adapterId} gateway binary for optional ingress runtime.`,
    status: dependencyStatus({ present }),
    present,
    downloadable: true,
    detection: {
      adapterId,
      configuredBinary: plan.configuredBinary,
      configuredPresent,
      cachedExecutablePath: plan.cachedExecutablePath,
      cachedPresent,
      pathBinary,
      version,
      runtimeUrl: plan.runtimeUrl,
      sourceConfigPath: context.sourceConfigPath || "",
      source,
      sourcePolicy: "configured binary -> local cache -> PATH -> local source config"
    },
    actions: {
      download: present ? "already-present" : "download-runtime"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      configGroup("env", "环境变量", [
        envConfigEntry("PACT_GATEWAY_RUNTIME_CACHE_DIR", "覆盖网关运行时缓存目录")
      ]),
      sourceConfigurationGroup(context, adapterId, [
        { key: "url", label: "运行时 URL", required: true },
        { key: "fileName", label: "缓存文件名" }
      ]),
      configGroup("path", "本地路径", [
        configEntry("path", "configuredBinary", "自定义二进制", plan.configuredBinary, { configured: configuredPresent }),
        configEntry("path", "cachedExecutablePath", "平台本地安装", plan.cachedExecutablePath, { configured: cachedPresent }),
        configEntry("path", "pathBinary", PATH_ENV_SOURCE_LABEL, pathBinary, { configured: Boolean(pathBinary) })
      ]),
      configGroup("argument", "命令行参数", [
        configEntry("command", "gateway-ingress", "安装命令", `${process.execPath} server/scripts/gateway-ingress.mjs runtime-pull`),
        configEntry("argument", "--gateway", "--gateway", adapterId),
        configEntry("argument", "--runtime-cache-dir", "--runtime-cache-dir", gatewayRuntimeCacheRoot(context)),
        configEntry("argument", "--runtime-url", "--runtime-url", plan.runtimeUrl)
      ])
    )
  });
}

async function detectGerrit(context = {}) {
  const version = text(context.version || process.env.PACT_GERRIT_VERSION || GERRIT_VERSION);
  const customRoot = text(context.root || process.env.PACT_GERRIT_ROOT);
  const root = path.resolve(customRoot || path.join(runtimeCacheRoot(context), "gerrit"));
  const warPath = path.join(root, "downloads", `gerrit-${version}.war`);
  const present = pathExists(warPath);
  const source = present
    ? detectionSource(customRoot ? "configured-cache" : "platform-cache", customRoot ? "自定义缓存" : "平台缓存", warPath)
    : missingDetectionSource(warPath, "Gerrit WAR 未缓存");
  return asDependency({
    id: "gerrit",
    label: "Gerrit",
    category: "code-review",
    description: "Official Gerrit WAR cached for local code review workflows.",
    status: dependencyStatus({ present }),
    present,
    downloadable: true,
    detection: {
      version,
      root,
      warPath,
      source,
      sourcePolicy: "local WAR cache -> official Maven/Google Gerrit release download"
    },
    actions: {
      download: present ? "already-present" : "download-war"
    },
    configuration: runtimeConfiguration(
      platformConfigurationGroup(context),
      configGroup("env", "环境变量", [
        envConfigEntry("PACT_GERRIT_VERSION", "覆盖 Gerrit WAR 版本"),
        envConfigEntry("PACT_GERRIT_ROOT", "覆盖 Gerrit 本地根目录")
      ]),
      sourceConfigurationGroup(context, "gerrit", [
        { key: "warUrl", label: "WAR 下载 URL", required: true }
      ]),
      configGroup("path", "本地路径", [
        configEntry("path", "root", "Gerrit 根目录", root),
        configEntry("path", "warPath", "WAR 缓存", warPath, { configured: present })
      ]),
      configGroup("argument", "命令行参数", [
        configEntry("command", "gerrit-local", "下载命令", `${process.execPath} server/scripts/gerrit-local.mjs download`),
        configEntry("argument", "--version", "--version", version),
        configEntry("argument", "--root", "--root", root),
        configEntry("argument", "--war-url", "--war-url", sourceField(context.sourceConfig, "gerrit", "warUrl"))
      ])
    )
  });
}

async function detectTarget(targetId, context = {}) {
  const knowledgeTarget = knowledgeBackendTarget(targetId);
  if (knowledgeTarget) {
    return detectKnowledgeBackendProvider(knowledgeTarget, context);
  }
  switch (normalizeTargetId(targetId)) {
    case "knowledge-backends":
      return detectKnowledgeBackends(context);
    case "cloud-drives":
      return detectCloudDrives(context);
    case "docker":
      return detectDocker(context);
    case "programming-runtimes":
    case "language-runtimes":
      return detectProgrammingRuntimes(context);
    case "jre":
    case "java":
      return detectJre(context);
    case "python":
      return detectPython(context);
    case "node":
    case "nodejs":
      return detectNode(context);
    case "caddy":
      return detectGateway("caddy", context);
    case "nginx":
      return detectGateway("nginx", context);
    case "gerrit":
      return detectGerrit(context);
    default:
      throw new Error(`Unsupported runtime dependency target: ${targetId}`);
  }
}

export async function listRuntimeDependencies(context = {}) {
  const sourceState = await ensureRuntimeDependencySourceConfig(context);
  const dependencyContext = {
    ...context,
    sourceConfig: sourceState.config,
    sourceConfigPath: sourceState.configPath
  };
  const selectedTargets = listRuntimeDependencyTargets(context);
  const dependencies = await Promise.all(selectedTargets.map((targetId) => detectTarget(targetId, dependencyContext)));
  const summary = dependencies.reduce((acc, item) => {
    acc.total += 1;
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, { total: 0 });
  return {
    ok: true,
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: RUNTIME_DEPENDENCIES_PROTOCOL_VERSION,
    generatedAt: nowIso(),
    cacheRoot: runtimeCacheRoot(context),
    sourceConfigPath: sourceState.configPath,
    startupDownloads: false,
    triggerMode: "user-requested",
    targets: TOP_LEVEL_TARGETS,
    selectedTargets,
    partial: selectedTargets.length !== TOP_LEVEL_TARGETS.length ||
      selectedTargets.some((targetId, index) => targetId !== TOP_LEVEL_TARGETS[index]),
    dependencies,
    downloads: listPublicDownloadRuns(),
    summary
  };
}

function parseConfigListValue(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map(text)
    .filter(Boolean);
}

function assignRuntimeSourceConfigField(config = {}, key = "", value = "") {
  const parts = text(key).split(".").map(text).filter(Boolean);
  if (parts.length < 3 || parts[0] !== "sources") {
    throw new Error(`Unsupported runtime dependency configuration key: ${key}`);
  }
  const targetId = normalizeTargetId(parts[1]);
  const fieldName = parts.slice(2).join(".");
  const defaults = defaultSourceConfig();
  if (!Object.prototype.hasOwnProperty.call(defaults.sources, targetId)) {
    throw new Error(`Unsupported runtime dependency source target: ${targetId}`);
  }
  config.sources = config.sources && typeof config.sources === "object" && !Array.isArray(config.sources)
    ? config.sources
    : {};
  const root = config.sources[targetId] && typeof config.sources[targetId] === "object" && !Array.isArray(config.sources[targetId])
    ? config.sources[targetId]
    : {};
  config.sources[targetId] = root;
  if (fieldName === "mirrors" || fieldName === "images") {
    root[fieldName] = parseConfigListValue(value);
    return;
  }
  if (fieldName === "mirrorPrefix" || fieldName === "version") {
    root[fieldName] = text(value);
    return;
  }
  root.default = root.default && typeof root.default === "object" && !Array.isArray(root.default)
    ? root.default
    : {};
  root.default[fieldName] = text(value);
}

export async function updateRuntimeDependencyConfiguration(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  if (entries.length === 0) {
    throw new Error("Runtime dependency configuration update requires entries.");
  }
  const sourceState = await ensureRuntimeDependencySourceConfig(input);
  const nextConfig = JSON.parse(JSON.stringify(sourceState.config));
  let updated = 0;
  for (const entry of entries) {
    const key = text(entry?.key);
    if (!key) continue;
    assignRuntimeSourceConfigField(nextConfig, key, entry?.value ?? "");
    updated += 1;
  }
  nextConfig.updatedAt = nowIso();
  await fs.mkdir(path.dirname(sourceState.configPath), { recursive: true });
  await fs.writeFile(sourceState.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return {
    ok: true,
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: RUNTIME_DEPENDENCIES_PROTOCOL_VERSION,
    generatedAt: nowIso(),
    sourceConfigPath: sourceState.configPath,
    updated
  };
}

async function downloadRemoteArtifact(options = {}) {
  const { url, targetPath, dryRun = false, timeoutMs = 600000, targetId = "", sourceState = null } = options;
  const sourceUrl = text(url);
  if (!sourceUrl) {
    emitStepProgress(options, "source", DOWNLOAD_STEP_STATUS.FAILED, `${targetId || "runtime"} 缺少可用下载源。`, "error");
    return downloadSourceFailure(targetId, sourceState, "builtin_source_missing");
  }
  emitStepProgress(options, "source", DOWNLOAD_STEP_STATUS.COMPLETED, `${targetId || "runtime"} 下载源已确认。`);
  if (pathExists(targetPath)) {
    emitStepProgress(options, "download", DOWNLOAD_STEP_STATUS.COMPLETED, `缓存已存在：${targetPath}`);
    return {
      ok: true,
      status: INSTALL_STATUS.INSTALLED,
      artifactPath: targetPath,
      alreadyAvailable: true,
      reason: "artifact_already_available"
    };
  }
  if (dryRun) {
    emitStepProgress(options, "download", DOWNLOAD_STEP_STATUS.COMPLETED, `计划下载 ${targetId || "runtime"} 到 ${targetPath}`);
    return {
      ok: true,
      status: INSTALL_STATUS.INSTALLED,
      artifactPath: targetPath,
      url: sourceUrl,
      planned: true
    };
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.download`;
  const maxAttempts = downloadRetryAttempts(options);
  let result = null;
  let resumedFromBytes = fileSize(tempPath);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const partialBytes = fileSize(tempPath);
    if (attempt === 1) {
      resumedFromBytes = partialBytes;
    }
    emitStepProgress(
      options,
      "download",
      DOWNLOAD_STEP_STATUS.RUNNING,
      partialBytes > 0
        ? `自动断点续传 ${targetId || "runtime"}：${sourceUrl}（第 ${attempt}/${maxAttempts} 次，已下载 ${partialBytes} bytes）`
        : `开始下载 ${targetId || "runtime"}：${sourceUrl}（第 ${attempt}/${maxAttempts} 次）`
    );
    const curlArgs = ["-L", "--fail", "--retry", "3", "--connect-timeout", "20"];
    if (partialBytes > 0) {
      curlArgs.push("-C", "-");
    }
    curlArgs.push("-o", tempPath, sourceUrl);
    result = await runCommandAsync("curl", curlArgs, {
      ...options,
      stepKey: "download",
      timeoutMs
    });
    if (result.status === 0) {
      break;
    }
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (partialBytes > 0 && outputMentionsRangeUnsupported(output)) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      emitStepProgress(options, "download", DOWNLOAD_STEP_STATUS.RUNNING, `${targetId || "runtime"} 下载源不支持断点续传，改为重新下载。`, "warning");
      result = await runCommandAsync("curl", ["-L", "--fail", "--retry", "3", "--connect-timeout", "20", "-o", tempPath, sourceUrl], {
        ...options,
        stepKey: "download",
        timeoutMs
      });
      if (result.status === 0) {
        break;
      }
    }
    if (attempt < maxAttempts) {
      const delayMs = downloadRetryDelayMs(attempt - 1, options);
      emitStepProgress(
        options,
        "download",
        DOWNLOAD_STEP_STATUS.RUNNING,
        `${targetId || "runtime"} 下载失败，将在 ${delayMs}ms 后自动断点续传（已保留 ${fileSize(tempPath)} bytes）。`,
        "warning"
      );
      await sleepMs(delayMs);
    }
  }
  if (!result || result.status !== 0) {
    emitStepProgress(options, "download", DOWNLOAD_STEP_STATUS.FAILED, `下载失败：${targetId || "runtime"}`, "error");
    return {
      ok: false,
      status: INSTALL_STATUS.FAILED,
      reason: "download_failed",
      resumable: true,
      autoResume: true,
      attempts: maxAttempts,
      partialPath: pathExists(tempPath) ? tempPath : "",
      partialBytes: fileSize(tempPath),
      sourceConfigPath: sourceState?.configPath || "",
      mirrorRequired: true,
      mirrorHint: "内置下载源不可达，请在本地下载源配置中配置镜像源后重试。",
      command: ["curl", "-L", "--fail", "-C", "-", "-o", tempPath, sourceUrl],
      commandResult: commandSummary(result)
    };
  }
  await fs.rename(tempPath, targetPath);
  emitStepProgress(options, "download", DOWNLOAD_STEP_STATUS.COMPLETED, `下载完成：${targetPath}`);
  return {
    ok: true,
    status: INSTALL_STATUS.INSTALLED,
    artifactPath: targetPath,
    url: sourceUrl,
    autoResume: true,
    attempts: maxAttempts,
    resumedFromBytes
  };
}

async function downloadDocker(context = {}) {
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.RUNNING, "检测 Docker。");
  const detection = await detectDocker(context);
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.COMPLETED, "Docker 检测完成。");
  if (detection.present) {
    return downloadResult("docker", INSTALL_STATUS.PRESENT, { detection, reason: "present" });
  }
  const url = sourceField(context.sourceConfig, "docker", "url") || text(process.env.PACT_DOCKER_RUNTIME_URL || dockerDefaultInstallerUrl());
  const fileName = sourceField(context.sourceConfig, "docker", "fileName") || fileNameFromUrl(url, `Docker-${platformKey}.dmg`);
  const artifactPath = path.join(runtimeCacheRoot(context), "docker", fileName);
  const artifactResult = await downloadRemoteArtifact({
    url,
    targetPath: artifactPath,
    dryRun: context.dryRun === true,
    timeoutMs: Number(context.timeoutMs || 600000),
    targetId: "docker",
    sourceState: context.sourceState,
    onProgress: context.onProgress
  });
  if (artifactResult.ok !== false) {
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "Docker 安装包缓存验证完成。");
  }
  return downloadResult("docker", artifactResult.status, {
    detection,
    ...artifactResult
  });
}

async function downloadJre(context = {}) {
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.RUNNING, "检测 JRE/Tika。");
  const detection = await detectJre(context);
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.COMPLETED, "JRE/Tika 检测完成。");
  if (detection.present) {
    return downloadResult("jre", INSTALL_STATUS.PRESENT, { detection, reason: "present" });
  }
  const jreUrl = sourceField(context.sourceConfig, "jre", "url");
  const jreFileName = sourceField(context.sourceConfig, "jre", "fileName");
  const tikaUrl = sourceField(context.sourceConfig, "tika", "url");
  const tikaFileName = sourceField(context.sourceConfig, "tika", "fileName");
  if (!tikaUrl) {
    emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.FAILED, "JRE/Tika 下载源缺失。", "error");
    return downloadResult("jre", INSTALL_STATUS.FAILED, {
      detection,
      ...downloadSourceFailure("jre", context.sourceState, "builtin_tika_source_missing")
    });
  }
  emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.COMPLETED, jreUrl ? "JRE/Tika 下载源已确认。" : "Tika 下载源已确认；JRE 将优先使用平台原生安装器。");
  if (context.dryRun === true) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.COMPLETED, "计划运行本地 JRE/Tika 准备脚本。");
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "JRE/Tika 计划验证完成。");
    return downloadResult("jre", INSTALL_STATUS.INSTALLED, {
      detection,
      command: [process.execPath, "server/scripts/setup-local-runtime.mjs"],
      planned: true
    });
  }
  emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.RUNNING, "开始准备 JRE/Tika 运行时。");
  const result = await runCommandAsync(process.execPath, [path.join(repoRoot, "server", "scripts", "setup-local-runtime.mjs")], {
    env: {
      ...(context.userDataPath ? { PACT_SERVER_DATA_DIR: path.resolve(context.userDataPath) } : {}),
      PACT_RUNTIME_DEPENDENCY_CACHE_DIR: runtimeCacheRoot(context),
      ...(jreUrl ? { PACT_JRE_DOWNLOAD_URL: jreUrl } : {}),
      ...(jreFileName ? { PACT_JRE_DOWNLOAD_FILE: jreFileName } : {}),
      PACT_TIKA_DOWNLOAD_URL: tikaUrl,
      ...(tikaFileName ? { PACT_TIKA_DOWNLOAD_FILE: tikaFileName } : {})
    },
    timeoutMs: Number(context.timeoutMs || 900000),
    stepKey: "install",
    onProgress: context.onProgress
  });
  if (result.status !== 0) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.FAILED, "JRE/Tika 准备失败。", "error");
    return downloadResult("jre", INSTALL_STATUS.FAILED, {
      detection,
      sourceConfigPath: context.sourceState?.configPath || "",
      mirrorRequired: true,
      mirrorHint: "内置下载源不可达，请在本地下载源配置中配置镜像源后重试。",
      command: [process.execPath, "server/scripts/setup-local-runtime.mjs"],
      commandResult: commandSummary(result)
    });
  }
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.RUNNING, "验证 JRE/Tika 运行时。");
  const nextDetection = await detectJre(context);
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "JRE/Tika 验证完成。");
  return downloadResult("jre", INSTALL_STATUS.INSTALLED, {
    before: detection,
    detection: nextDetection,
    commandResult: commandSummary(result)
  });
}

async function runInstallPlanCommands(plan, context = {}, stepKey = "install") {
  const commands = plan.commands || [{ command: plan.command, args: plan.args || [] }];
  for (const entry of commands) {
    const attempts = nativeCommandRetryAttempts(context);
    let lastResult = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await runCommandAsync(entry.command, entry.args || [], {
        ...context,
        stepKey,
        timeoutMs: Number(context.timeoutMs || 900000)
      });
      if (result.status === 0) {
        lastResult = null;
        break;
      }
      lastResult = result;
      if (attempt >= attempts - 1 || !nativeCommandFailureShouldRetry(result)) {
        return { ok: false, plan: plan.label, commandResult: commandSummary(result) };
      }
      const delayMs = nativeCommandRetryDelayMs(attempt, context);
      emitStepProgress(context, stepKey, DOWNLOAD_STEP_STATUS.RUNNING, `${plan.label} 临时失败，${Math.round(delayMs / 1000)} 秒后重试。`, "warning");
      await sleepMs(delayMs);
    }
    if (lastResult) {
      return { ok: false, plan: plan.label, commandResult: commandSummary(lastResult) };
    }
  }
  return { ok: true, plan: plan.label };
}

function firstCompatiblePython(candidates = []) {
  for (const candidate of candidates.map(text).filter(Boolean)) {
    if (!(executableExists(candidate) || pathExists(candidate))) {
      continue;
    }
    const version = executableCommandVersion(candidate, ["--version"]);
    if (pythonVersionMeets(version)) {
      return { pythonPath: candidate, version };
    }
  }
  return { pythonPath: "", version: "" };
}

async function resolvePythonFromVersionManagers(context = {}) {
  const version = sourceField(context.sourceConfig, "python", "version") || DEFAULT_PYTHON_RUNTIME_VERSION;
  const uvPath = commandPath("uv") || (executableExists(uvExecutable(context)) ? uvExecutable(context) : "");
  if (uvPath) {
    const install = await runCommandAsync(uvPath, ["python", "install", version], {
      ...context,
      stepKey: "install",
      timeoutMs: Number(context.timeoutMs || 900000)
    });
    if (install.status === 0) {
      const found = runCommand(uvPath, ["python", "find", version], { timeoutMs: 30000 });
      const pythonPath = text(found.stdout).split(/\r?\n/).map(text).find(Boolean) || "";
      const resolved = firstCompatiblePython([pythonPath]);
      if (resolved.pythonPath) {
        return { ...resolved, manager: "uv" };
      }
    }
  }
  if (commandPath("pyenv")) {
    const install = await runCommandAsync("pyenv", ["install", "-s", version], {
      ...context,
      stepKey: "install",
      timeoutMs: Number(context.timeoutMs || 900000)
    });
    if (install.status === 0) {
      const prefix = runCommand("pyenv", ["prefix", version], { timeoutMs: 30000 });
      const pythonPath = path.join(text(prefix.stdout), "bin", "python");
      const resolved = firstCompatiblePython([pythonPath]);
      if (resolved.pythonPath) {
        return { ...resolved, manager: "pyenv" };
      }
    }
  }
  if (commandPath("asdf")) {
    const install = await runCommandAsync("asdf", ["install", "python", version], {
      ...context,
      stepKey: "install",
      timeoutMs: Number(context.timeoutMs || 900000)
    });
    if (install.status === 0 || /already installed/i.test(install.stderr || install.stdout || "")) {
      const where = runCommand("asdf", ["where", "python", version], { timeoutMs: 30000 });
      const pythonPath = path.join(text(where.stdout), "bin", "python");
      const resolved = firstCompatiblePython([pythonPath]);
      if (resolved.pythonPath) {
        return { ...resolved, manager: "asdf" };
      }
    }
  }
  return { pythonPath: "", version: "", manager: "" };
}

async function installNativePython(context = {}) {
  const failures = [];
  for (const plan of nativePythonInstallPlans()) {
    const result = await runInstallPlanCommands(plan, context, "install");
    if (result.ok) {
      const resolved = firstCompatiblePython(["python3", "python"].map(commandPath));
      if (resolved.pythonPath) {
        return { ...resolved, manager: plan.label, failures };
      }
      failures.push({ plan: plan.label, error: "installed but no compatible Python was detected" });
    } else {
      failures.push({ plan: plan.label, error: result.commandResult?.stderr || "install failed" });
    }
  }
  return { pythonPath: "", version: "", manager: "", failures };
}

function nativeNodeInstallerToolPlans() {
  if (process.env.PACT_DISABLE_NATIVE_RUNTIME_INSTALL === "1") return [];
  if (commandPath("curl") || commandPath("wget") || commandPath("git")) {
    return [];
  }
  if (process.platform === "darwin" && commandPath("brew")) {
    return [{ label: "Homebrew curl", commands: [{ command: "brew", args: ["install", "curl"] }] }];
  }
  if (process.platform === "linux") {
    const plans = [];
    if (commandPath("apt-get")) {
      plans.push({
        label: "apt curl",
        commands: [
          privilegedCommand("apt-get", ["update"]),
          privilegedCommand("apt-get", ["install", "-y", "--no-install-recommends", "ca-certificates", "curl"])
        ]
      });
    }
    if (commandPath("dnf")) plans.push({ label: "dnf curl", commands: [privilegedCommand("dnf", ["install", "-y", "ca-certificates", "curl"])] });
    if (commandPath("yum")) plans.push({ label: "yum curl", commands: [privilegedCommand("yum", ["install", "-y", "ca-certificates", "curl"])] });
    if (commandPath("apk")) plans.push({ label: "apk curl", commands: [privilegedCommand("apk", ["add", "--no-cache", "ca-certificates", "curl", "bash"])] });
    if (commandPath("pacman")) plans.push({ label: "pacman curl", commands: [privilegedCommand("pacman", ["-Sy", "--noconfirm", "ca-certificates", "curl"])] });
    if (commandPath("zypper")) plans.push({ label: "zypper curl", commands: [privilegedCommand("zypper", ["--non-interactive", "install", "ca-certificates", "curl"])] });
    return plans;
  }
  if (process.platform === "win32") {
    return [
      commandPath("winget") ? { label: "winget Git", commands: [{ command: "winget", args: ["install", "--id", "Git.Git", "-e", "--accept-package-agreements", "--accept-source-agreements"] }] } : null,
      commandPath("choco") ? { label: "Chocolatey curl", commands: [{ command: "choco", args: ["install", "-y", "curl"] }] } : null,
      commandPath("scoop") ? { label: "Scoop curl", commands: [{ command: "scoop", args: ["install", "curl"] }] } : null
    ].filter(Boolean);
  }
  return [];
}

async function ensureNodeInstallerTooling(context = {}) {
  if (commandPath("curl") || commandPath("wget") || commandPath("git")) {
    return { ok: true, installed: false };
  }
  for (const plan of nativeNodeInstallerToolPlans()) {
    emitProgress(context, "info", `安装 nvm 所需下载工具：${plan.label}`);
    const result = await runInstallPlanCommands(plan, context, "install");
    if (result.ok && (commandPath("curl") || commandPath("wget") || commandPath("git"))) {
      return { ok: true, installed: true, plan: plan.label };
    }
  }
  return {
    ok: false,
    installed: false,
    reason: "nvm_installer_tool_missing",
    detail: "nvm installer requires curl, wget, or git."
  };
}

async function ensurePythonVenv(context = {}, basePythonPath = "") {
  const venvRoot = pythonVenvRoot(context);
  const venvPython = pythonVenvExecutable(context);
  if (executableExists(venvPython) || pathExists(venvPython)) {
    const version = executableCommandVersion(venvPython, ["--version"]);
    if (pythonVersionMeets(version)) {
      return { ok: true, pythonPath: venvPython, version, venvRoot, reused: true };
    }
  }
  await fs.rm(venvRoot, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(path.dirname(venvRoot), { recursive: true });
  const result = await runCommandAsync(basePythonPath, ["-m", "venv", venvRoot], {
    ...context,
    stepKey: "install",
    timeoutMs: Number(context.timeoutMs || 900000)
  });
  if (result.status !== 0) {
    return { ok: false, commandResult: commandSummary(result), venvRoot };
  }
  const version = executableCommandVersion(venvPython, ["--version"]);
  return {
    ok: pythonVersionMeets(version),
    pythonPath: venvPython,
    version,
    venvRoot,
    commandResult: commandSummary(result)
  };
}

function pythonVenvFailureNeedsNativeInstall(venvResult = {}) {
  const commandResult = venvResult.commandResult || {};
  const output = text([commandResult.stdout, commandResult.stderr].filter(Boolean).join("\n"));
  return /ensurepip|python3-venv|No module named venv|venv module is not available/i.test(output);
}

async function downloadPython(context = {}) {
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.RUNNING, "检测 Python。");
  const detection = await detectPython(context);
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.COMPLETED, "Python 检测完成。");
  const managedVenvPresent = detection.present &&
    detection.detection?.source?.kind === "platform-runtime" &&
    path.resolve(detection.detection?.pythonPath || "") === path.resolve(pythonVenvExecutable(context));
  if (managedVenvPresent) {
    return downloadResult("python", INSTALL_STATUS.PRESENT, { detection, reason: "managed-venv-present" });
  }
  const version = sourceField(context.sourceConfig, "python", "version") || DEFAULT_PYTHON_RUNTIME_VERSION;
  emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.COMPLETED, `Python 目标版本：${version}，优先使用 uv/pyenv/asdf 和托管 venv。`);
  if (context.dryRun === true) {
    emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.COMPLETED, "计划创建 Python 托管 venv。");
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "Python venv 计划验证完成。");
    return downloadResult("python", INSTALL_STATUS.INSTALLED, {
      detection,
      planned: true,
      venvPath: pythonVenvRoot(context),
      managers: ["uv", "pyenv", "asdf", "system-python", "native-package-manager"]
    });
  }
  let basePython = await resolvePythonFromVersionManagers(context);
  if (!basePython.pythonPath) {
    basePython = firstCompatiblePython(["python3", "python"].map(commandPath));
    if (basePython.pythonPath) {
      basePython.manager = "system-python";
    }
  }
  if (!basePython.pythonPath) {
    basePython = await installNativePython(context);
  }
  if (!basePython.pythonPath) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.FAILED, "未找到可用 Python，也无法通过平台工具链安装。", "error");
    return downloadResult("python", INSTALL_STATUS.FAILED, {
      detection,
      reason: "python_runtime_or_version_manager_unavailable",
      failures: basePython.failures || []
    });
  }
  let venv = await ensurePythonVenv(context, basePython.pythonPath);
  let nativeFallback = null;
  if (!venv.ok && pythonVenvFailureNeedsNativeInstall(venv)) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.RUNNING, "系统 Python 缺少 venv 支持，尝试通过平台原生工具链补装。", "warning");
    nativeFallback = await installNativePython(context);
    if (nativeFallback.pythonPath) {
      basePython = {
        ...nativeFallback,
        fallbackFrom: basePython
      };
      venv = await ensurePythonVenv(context, basePython.pythonPath);
    }
  }
  if (!venv.ok) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.FAILED, "Python venv 创建失败。", "error");
    return downloadResult("python", INSTALL_STATUS.FAILED, {
      detection,
      reason: "python_venv_create_failed",
      basePython,
      nativeFallback,
      ...venv
    });
  }
  await saveSettings(dataRoot(context), {
    ocrPythonPath: venv.pythonPath,
    pdfVisualPythonPath: venv.pythonPath
  }, { redactSecrets: true }).catch(() => null);
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.RUNNING, "验证 Python venv。");
  const nextDetection = await detectPython(context);
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "Python venv 验证完成。");
  return downloadResult("python", INSTALL_STATUS.INSTALLED, {
    before: detection,
    detection: nextDetection,
    basePython,
    venv
  });
}

async function downloadGateway(adapterId, context = {}) {
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.RUNNING, `检测 ${adapterId} gateway runtime。`);
  const detection = await detectGateway(adapterId, context);
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.COMPLETED, `${adapterId} gateway runtime 检测完成。`);
  if (detection.present) {
    return downloadResult(adapterId, INSTALL_STATUS.PRESENT, { detection, reason: "present" });
  }
  const runtimeUrl = sourceField(context.sourceConfig, adapterId, "url");
  if (!runtimeUrl) {
    emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.FAILED, `${adapterId} 缺少可用下载源。`, "error");
    return downloadResult(adapterId, INSTALL_STATUS.FAILED, {
      detection,
      ...downloadSourceFailure(adapterId, context.sourceState, "builtin_source_missing")
    });
  }
  emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.COMPLETED, `${adapterId} 下载源已确认。`);
  if (context.dryRun === true) {
    emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.COMPLETED, `计划拉取 ${adapterId} gateway runtime。`);
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, `${adapterId} 计划验证完成。`);
    return downloadResult(adapterId, INSTALL_STATUS.INSTALLED, {
      detection,
      command: [
        "node",
        "server/scripts/gateway-ingress.mjs",
        "runtime-pull",
        "--gateway",
        adapterId,
        "--runtime-cache-dir",
        gatewayRuntimeCacheRoot(context)
      ],
      planned: true
    });
  }
  const args = [path.join(repoRoot, "server", "scripts", "gateway-ingress.mjs"), "runtime-pull", "--gateway", adapterId];
  args.push("--runtime-cache-dir", gatewayRuntimeCacheRoot(context));
  args.push("--runtime-url", runtimeUrl);
  emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.RUNNING, `开始拉取 ${adapterId} gateway runtime。`);
  const result = await runCommandAsync(process.execPath, args, {
    env: {
      PACT_GATEWAY_RUNTIME_CACHE_DIR: gatewayRuntimeCacheRoot(context)
    },
    timeoutMs: Number(context.timeoutMs || 600000),
    stepKey: "download",
    onProgress: context.onProgress
  });
  if (result.status !== 0) {
    emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.FAILED, `${adapterId} gateway runtime 拉取失败。`, "error");
    return downloadResult(adapterId, INSTALL_STATUS.FAILED, {
      detection,
      sourceConfigPath: context.sourceState?.configPath || "",
      mirrorRequired: true,
      mirrorHint: "内置下载源不可达，请在本地下载源配置中配置镜像源后重试。",
      command: [process.execPath, ...args.slice(1)],
      commandResult: commandSummary(result)
    });
  }
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.RUNNING, `验证 ${adapterId} gateway runtime。`);
  const nextDetection = await detectGateway(adapterId, context);
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, `${adapterId} gateway runtime 验证完成。`);
  return downloadResult(adapterId, INSTALL_STATUS.INSTALLED, {
    before: detection,
    detection: nextDetection,
    commandResult: commandSummary(result)
  });
}

async function downloadGerrit(context = {}) {
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.RUNNING, "检测 Gerrit WAR。");
  const detection = await detectGerrit(context);
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.COMPLETED, "Gerrit WAR 检测完成。");
  if (detection.present) {
    return downloadResult("gerrit", INSTALL_STATUS.PRESENT, { detection, reason: "present" });
  }
  const warUrl = sourceField(context.sourceConfig, "gerrit", "warUrl");
  if (!warUrl) {
    emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.FAILED, "Gerrit WAR 下载源缺失。", "error");
  } else {
    emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.COMPLETED, "Gerrit WAR 下载源已确认。");
  }
  if (context.dryRun === true) {
    emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.COMPLETED, "计划下载 Gerrit WAR。");
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "Gerrit WAR 计划验证完成。");
    return downloadResult("gerrit", INSTALL_STATUS.INSTALLED, {
      detection,
      command: [process.execPath, "server/scripts/gerrit-local.mjs", "download"],
      planned: true
    });
  }
  const args = [path.join(repoRoot, "server", "scripts", "gerrit-local.mjs"), "download"];
  if (context.version) {
    args.push("--version", text(context.version));
  }
  if (context.root) {
    args.push("--root", path.resolve(text(context.root)));
  }
  if (warUrl) {
    args.push("--war-url", warUrl);
  }
  emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.RUNNING, "开始下载 Gerrit WAR。");
  const result = await runCommandAsync(process.execPath, args, {
    env: {
      ...(context.userDataPath ? { PACT_SERVER_DATA_DIR: path.resolve(context.userDataPath) } : {}),
      PACT_RUNTIME_DEPENDENCY_CACHE_DIR: runtimeCacheRoot(context)
    },
    timeoutMs: Number(context.timeoutMs || 900000),
    stepKey: "download",
    onProgress: context.onProgress
  });
  if (result.status !== 0) {
    emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.FAILED, "Gerrit WAR 下载失败。", "error");
    return downloadResult("gerrit", INSTALL_STATUS.FAILED, {
      detection,
      sourceConfigPath: context.sourceState?.configPath || "",
      mirrorRequired: true,
      mirrorHint: "内置下载源不可达，请在本地下载源配置中配置镜像源后重试。",
      command: [process.execPath, ...args.slice(1)],
      commandResult: commandSummary(result)
    });
  }
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.RUNNING, "验证 Gerrit WAR。");
  const nextDetection = await detectGerrit(context);
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "Gerrit WAR 验证完成。");
  return downloadResult("gerrit", INSTALL_STATUS.INSTALLED, {
    before: detection,
    detection: nextDetection,
    commandResult: commandSummary(result)
  });
}

async function downloadKnowledgeBackendProvider(target, context = {}) {
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.RUNNING, `检测 ${target.label}。`);
  const detection = await detectKnowledgeBackendProvider(target, context);
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.COMPLETED, `${target.label} 检测完成。`);
  if (detection.present) {
    return downloadResult(target.targetId, INSTALL_STATUS.PRESENT, { detection, reason: "present_or_configured" });
  }
  const detectedImages = Array.isArray(detection.detection?.images) ? detection.detection.images : [];
  if (detectedImages.length === 0) {
    emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.FAILED, `${target.label} 缺少后端配置或镜像源。`, "error");
    return downloadResult(target.targetId, INSTALL_STATUS.FAILED, {
      detection,
      reason: "provider_config_or_image_source_required"
    });
  }
  const docker = detectDockerSync(context);
  if (!docker.ready) {
    emitStepProgress(context, "docker", DOWNLOAD_STEP_STATUS.FAILED, `${target.label} 需要先安装 Docker。`, "error");
    return downloadResult(target.targetId, INSTALL_STATUS.FAILED, {
      detection,
      reason: "docker_required_for_container_image_download",
      nextTarget: "docker"
    });
  }
  emitStepProgress(context, "docker", DOWNLOAD_STEP_STATUS.COMPLETED, "Docker 已可用。");
  const images = knowledgeBackendConfiguredImages(context, target.targetId);
  if (context.dryRun === true) {
    emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.COMPLETED, `计划拉取 ${target.label} Docker 镜像。`);
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, `${target.label} 计划验证完成。`);
    return downloadResult(target.targetId, INSTALL_STATUS.INSTALLED, {
      detection,
      images,
      planned: true
    });
  }
  const results = [];
  emitStepProgress(context, "download", DOWNLOAD_STEP_STATUS.RUNNING, `开始拉取 ${target.label} Docker 镜像。`);
  for (const image of images) {
    if (dockerImagePresent(image)) {
      results.push({ image, status: INSTALL_STATUS.PRESENT, reason: "present" });
      continue;
    }
    emitProgress(context, "info", `开始拉取 Docker 镜像：${image}`);
    const pull = await runCommandAsync("docker", ["pull", image], {
      timeoutMs: Number(context.timeoutMs || 900000),
      stepKey: "download",
      onProgress: context.onProgress
    });
    results.push({
      image,
      status: pull.status === 0 ? INSTALL_STATUS.INSTALLED : INSTALL_STATUS.FAILED,
      mirrorRequired: pull.status !== 0,
      mirrorHint: pull.status !== 0 ? "内置镜像源不可达，请在本地下载源配置中配置镜像源后重试。" : undefined,
      commandResult: commandSummary(pull)
    });
  }
  const failed = results.filter((item) => item.status === INSTALL_STATUS.FAILED);
  emitStepProgress(
    context,
    "download",
    failed.length ? DOWNLOAD_STEP_STATUS.FAILED : DOWNLOAD_STEP_STATUS.COMPLETED,
    failed.length ? `${target.label} Docker 镜像拉取失败。` : `${target.label} Docker 镜像拉取完成。`,
    failed.length ? "error" : "info"
  );
  if (!failed.length) {
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.RUNNING, `验证 ${target.label}。`);
  }
  const nextDetection = await detectKnowledgeBackendProvider(target, context);
  if (!failed.length) {
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, `${target.label} 验证完成。`);
  }
  return downloadResult(target.targetId, failed.length ? INSTALL_STATUS.FAILED : INSTALL_STATUS.INSTALLED, {
    before: detection,
    detection: nextDetection,
    sourceConfigPath: context.sourceState?.configPath || "",
    images: results
  });
}

async function downloadKnowledgeBackends(context = {}) {
  const results = [];
  for (const target of KNOWLEDGE_BACKEND_TARGETS) {
    emitStepProgress(context, target.targetId, DOWNLOAD_STEP_STATUS.RUNNING, `准备 ${target.label}。`);
    const targetResult = await downloadKnowledgeBackendProvider(target, context);
    emitStepProgress(
      context,
      target.targetId,
      targetResult.ok ? DOWNLOAD_STEP_STATUS.COMPLETED : DOWNLOAD_STEP_STATUS.FAILED,
      `${target.label} ${targetResult.ok ? "准备完成" : "准备失败"}。`,
      targetResult.ok ? "info" : "error"
    );
    results.push(targetResult);
  }
  const failed = results.filter((item) => item.status === INSTALL_STATUS.FAILED);
  const status = failed.length
    ? INSTALL_STATUS.FAILED
    : results.every((item) => item.status === INSTALL_STATUS.PRESENT)
      ? INSTALL_STATUS.PRESENT
      : INSTALL_STATUS.INSTALLED;
  return downloadResult("knowledge-backends", status, {
    results,
    detection: await detectKnowledgeBackends(context)
  });
}

async function downloadCloudDrives(context = {}) {
  const detection = await detectCloudDrives(context);
  return downloadResult("cloud-drives", detection.present ? INSTALL_STATUS.PRESENT : INSTALL_STATUS.FAILED, {
    detection,
    reason: detection.present ? "present_or_configured" : "cloud_drive_adapters_require_local_folder_or_oauth_authorization"
  });
}

async function downloadProgrammingRuntimes(context = {}) {
  const results = [];
  emitStepProgress(context, "jre", DOWNLOAD_STEP_STATUS.RUNNING, "准备 JRE。");
  const jreResult = await downloadJre(context);
  emitStepProgress(
    context,
    "jre",
    jreResult.ok ? DOWNLOAD_STEP_STATUS.COMPLETED : DOWNLOAD_STEP_STATUS.FAILED,
    `JRE ${jreResult.ok ? "准备完成" : "准备失败"}。`,
    jreResult.ok ? "info" : "error"
  );
  results.push(jreResult);
  emitStepProgress(context, "python", DOWNLOAD_STEP_STATUS.RUNNING, "准备 Python。");
  const pythonResult = await downloadPython(context);
  emitStepProgress(
    context,
    "python",
    pythonResult.ok ? DOWNLOAD_STEP_STATUS.COMPLETED : DOWNLOAD_STEP_STATUS.FAILED,
    `Python ${pythonResult.ok ? "准备完成" : "准备失败"}。`,
    pythonResult.ok ? "info" : "error"
  );
  results.push(pythonResult);
  emitStepProgress(context, "node", DOWNLOAD_STEP_STATUS.RUNNING, "检测 Node.js。");
  const nodeResult = await downloadNode(context);
  emitStepProgress(
    context,
    "node",
    nodeResult.ok ? DOWNLOAD_STEP_STATUS.COMPLETED : DOWNLOAD_STEP_STATUS.FAILED,
    `Node.js ${nodeResult.ok ? "检测完成" : "检测失败"}。`,
    nodeResult.ok ? "info" : "error"
  );
  results.push(nodeResult);
  const failed = results.filter((item) => item.status === INSTALL_STATUS.FAILED);
  const status = failed.length
    ? INSTALL_STATUS.FAILED
    : results.every((item) => item.status === INSTALL_STATUS.PRESENT)
      ? INSTALL_STATUS.PRESENT
      : INSTALL_STATUS.INSTALLED;
  return downloadResult("programming-runtimes", status, {
    results,
    detection: await detectProgrammingRuntimes(context)
  });
}

async function downloadNode(context = {}) {
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.RUNNING, "检测 Node.js。");
  const detection = await detectNode(context);
  emitStepProgress(context, "detect", DOWNLOAD_STEP_STATUS.COMPLETED, "Node.js 检测完成。");
  const managedNodePresent = detection.detection?.source?.kind === "platform-runtime" &&
    pathExists(detection.detection?.nvmScriptPath || "");
  if (detection.present && managedNodePresent) {
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "Node.js nvm 托管运行时符合要求。");
    return downloadResult("node", INSTALL_STATUS.PRESENT, { detection, reason: "managed-present" });
  }
  const version = sourceField(context.sourceConfig, "node", "version") || DEFAULT_NODE_RUNTIME_VERSION;
  const versionCandidates = nodeRuntimeVersionCandidates(context);
  const installUrl = sourceField(context.sourceConfig, "node", "nvmInstallUrl") ||
    "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh";
  emitStepProgress(context, "source", DOWNLOAD_STEP_STATUS.COMPLETED, `Node.js 目标版本：${version}，候选 ${versionCandidates.join(", ")}，nvm 源已确认。`);
  if (context.dryRun === true) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.COMPLETED, "计划安装/复用 nvm 并安装 Node.js。");
    emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.COMPLETED, "Node.js 计划验证完成。");
    return downloadResult("node", INSTALL_STATUS.INSTALLED, {
      detection,
      planned: true,
      nvmDir: nvmDir(context),
      command: ["bash", "-lc", `. ${shellQuote(nvmScriptPath(context))}; nvm install ${shellQuote(versionCandidates[0] || version)}`],
      versionCandidates
    });
  }
  const nvmRoot = nvmDir(context);
  const nvmScript = nvmScriptPath(context);
  if (!pathExists(nvmScript)) {
    const tooling = await ensureNodeInstallerTooling(context);
    if (!tooling.ok) {
      emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.FAILED, "nvm 安装工具准备失败。", "error");
      return downloadResult("node", INSTALL_STATUS.FAILED, {
        detection,
        reason: tooling.reason,
        detail: tooling.detail
      });
    }
    await fs.mkdir(nvmRoot, { recursive: true });
    const installerPath = path.join(runtimeCacheRoot(context), "node", "nvm-install.sh");
    const artifactResult = await downloadRemoteArtifact({
      url: installUrl,
      targetPath: installerPath,
      dryRun: false,
      timeoutMs: Number(context.timeoutMs || 600000),
      targetId: "node",
      sourceState: context.sourceState,
      onProgress: context.onProgress
    });
    if (artifactResult.ok === false) {
      emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.FAILED, "nvm 安装脚本下载失败。", "error");
      return downloadResult("node", INSTALL_STATUS.FAILED, {
        detection,
        reason: "nvm_install_script_download_failed",
        ...artifactResult
      });
    }
    const installNvm = await runCommandAsync("bash", [installerPath], {
      ...context,
      env: { NVM_DIR: nvmRoot },
      stepKey: "install",
      timeoutMs: Number(context.timeoutMs || 900000)
    });
    if (installNvm.status !== 0) {
      emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.FAILED, "nvm 安装失败。", "error");
      return downloadResult("node", INSTALL_STATUS.FAILED, {
        detection,
        reason: "nvm_install_failed",
        commandResult: commandSummary(installNvm)
      });
    }
  }
  let installNode = null;
  let installedVersion = "";
  for (const candidateVersion of versionCandidates) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.RUNNING, `尝试安装 Node.js ${candidateVersion}。`);
    installNode = await runCommandAsync("bash", ["-lc", `. ${shellQuote(nvmScript)} && nvm install ${shellQuote(candidateVersion)} && nvm alias default ${shellQuote(candidateVersion)} && nvm which ${shellQuote(candidateVersion)}`], {
      ...context,
      env: { NVM_DIR: nvmRoot },
      stepKey: "install",
      timeoutMs: Number(context.timeoutMs || 900000)
    });
    if (installNode.status === 0) {
      installedVersion = candidateVersion;
      break;
    }
    emitProgress(context, "warning", `Node.js ${candidateVersion} 安装失败，尝试下一个候选版本。`, {
      candidateVersion,
      commandResult: commandSummary(installNode),
      stepKey: "install",
      stepStatus: DOWNLOAD_STEP_STATUS.RUNNING
    });
  }
  if (!installNode || installNode.status !== 0) {
    emitStepProgress(context, "install", DOWNLOAD_STEP_STATUS.FAILED, "Node.js nvm 安装失败。", "error");
    return downloadResult("node", INSTALL_STATUS.FAILED, {
      detection,
      reason: "node_nvm_install_failed",
      versionCandidates,
      commandResult: commandSummary(installNode)
    });
  }
  emitStepProgress(context, "verify", DOWNLOAD_STEP_STATUS.RUNNING, "验证 Node.js。");
  const nextDetection = await detectNode(context);
  emitStepProgress(context, "verify", nextDetection.present ? DOWNLOAD_STEP_STATUS.COMPLETED : DOWNLOAD_STEP_STATUS.FAILED, "Node.js 验证完成。", nextDetection.present ? "info" : "error");
  return downloadResult("node", nextDetection.present ? INSTALL_STATUS.INSTALLED : INSTALL_STATUS.FAILED, {
    before: detection,
    detection: nextDetection,
    installedVersion,
    versionCandidates,
    commandResult: commandSummary(installNode)
  });
}

async function downloadAll(context = {}) {
  const results = [];
  for (const targetId of TOP_LEVEL_TARGETS) {
    emitStepProgress(context, targetId, DOWNLOAD_STEP_STATUS.RUNNING, `准备 ${targetId}。`);
    const targetResult = await executeRuntimeDependencyDownload({ ...context, targetId });
    emitStepProgress(
      context,
      targetId,
      targetResult.ok ? DOWNLOAD_STEP_STATUS.COMPLETED : DOWNLOAD_STEP_STATUS.FAILED,
      `${targetId} ${targetResult.ok ? "准备完成" : "准备失败"}。`,
      targetResult.ok ? "info" : "error"
    );
    results.push(targetResult);
  }
  const failed = results.filter((item) => item.status === INSTALL_STATUS.FAILED);
  const status = failed.length
    ? INSTALL_STATUS.FAILED
    : results.every((item) => item.status === INSTALL_STATUS.PRESENT)
      ? INSTALL_STATUS.PRESENT
      : INSTALL_STATUS.INSTALLED;
  return downloadResult("all", status, {
    results,
    detection: await listRuntimeDependencies(context)
  });
}

function downloadResult(targetId, status, payload = {}) {
  const ok = status !== INSTALL_STATUS.FAILED;
  return {
    ok,
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: RUNTIME_DEPENDENCIES_PROTOCOL_VERSION,
    targetId,
    status,
    generatedAt: nowIso(),
    startupDownloads: false,
    triggerMode: "user-requested",
    ...payload
  };
}

function createDownloadRun(targetId, input = {}) {
  const now = nowIso();
  const runId = `runtime_${randomUUID()}`;
  const run = {
    runId,
    targetId,
    status: DOWNLOAD_RUN_STATUS.QUEUED,
    ok: true,
    startedAt: now,
    updatedAt: now,
    completedAt: "",
    latestMessage: "等待开始安装。",
    steps: plannedDownloadSteps(targetId),
    completedSteps: 0,
    totalSteps: 0,
    currentStepKey: "",
    currentStepIndex: 0,
    progressPercent: 0,
    log: [],
    result: null,
    userDataPath: dataRoot(input),
    storePath: runtimeDependencyDownloadRunPath(input, runId)
  };
  recomputeDownloadRunProgress(run);
  runtimeDependencyDownloadRuns.set(run.runId, run);
  appendDownloadRunLog(run, "info", `已进入安装队列：${targetId}`);
  flushDownloadRunPersist(run);
  pruneDownloadRuns();
  return run;
}

async function runDownloadInBackground(run, input = {}) {
  run.status = DOWNLOAD_RUN_STATUS.RUNNING;
  setDownloadRunStep(run, run.steps?.[0]?.key || "detect", DOWNLOAD_STEP_STATUS.RUNNING);
  appendDownloadRunLog(run, "info", `开始安装：${run.targetId}`);
  flushDownloadRunPersist(run);
  try {
    const result = await executeRuntimeDependencyDownload({
      ...input,
      async: false,
      background: false,
      onProgress: (event = {}) => appendDownloadRunLog(
        run,
        event.level || "info",
        event.message || "安装进度更新。",
        event.data || {}
      )
    });
    run.result = result;
    run.status = result.status || (result.ok ? DOWNLOAD_RUN_STATUS.INSTALLED : DOWNLOAD_RUN_STATUS.FAILED);
    run.ok = result.ok !== false;
    finishDownloadRunSteps(run, run.ok);
    run.completedAt = nowIso();
    appendDownloadRunLog(run, run.ok ? "info" : "error", run.ok ? "安装流程结束。" : "安装流程失败。");
  } catch (error) {
    run.status = DOWNLOAD_RUN_STATUS.FAILED;
    run.ok = false;
    finishDownloadRunSteps(run, false);
    run.completedAt = nowIso();
    run.result = {
      ok: false,
      targetId: run.targetId,
      status: INSTALL_STATUS.FAILED,
      error: error instanceof Error ? error.message : String(error),
      generatedAt: nowIso()
    };
    appendDownloadRunLog(run, "error", run.result.error);
  } finally {
    run.updatedAt = nowIso();
    flushDownloadRunPersist(run);
    pruneDownloadRuns();
  }
}

export function listRuntimeDependencyDownloadRuns(input = {}) {
  return {
    ok: true,
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: RUNTIME_DEPENDENCIES_PROTOCOL_VERSION,
    generatedAt: nowIso(),
    downloads: listPublicDownloadRuns(input)
  };
}

export async function startRuntimeDependencyDownload(input = {}) {
  const targetId = normalizeTargetId(input.targetId || input.target || input.id || "");
  if (!targetId) {
    throw new Error("Unsupported runtime dependency target: (empty)");
  }
  const run = createDownloadRun(targetId, input);
  setTimeout(() => {
    void runDownloadInBackground(run, input);
  }, 0);
  return downloadResult(targetId, DOWNLOAD_RUN_STATUS.QUEUED, {
    runId: run.runId,
    run: publicDownloadRun(run),
    reason: "background_install_started"
  });
}

async function executeRuntimeDependencyDownload(input = {}) {
  const targetId = normalizeTargetId(input.targetId || input.target || input.id || "");
  const sourceState = await ensureRuntimeDependencySourceConfig(input);
  const context = {
    ...input,
    sourceState,
    sourceConfig: sourceState.config,
    sourceConfigPath: sourceState.configPath,
    dryRun: input.dryRun === true || input.planOnly === true
  };
  const knowledgeTarget = knowledgeBackendTarget(targetId);
  if (knowledgeTarget) {
    return downloadKnowledgeBackendProvider(knowledgeTarget, context);
  }
  switch (targetId) {
    case "all":
      return downloadAll(context);
    case "knowledge-backends":
      return downloadKnowledgeBackends(context);
    case "cloud-drives":
      return downloadCloudDrives(context);
    case "docker":
      return downloadDocker(context);
    case "programming-runtimes":
    case "language-runtimes":
      return downloadProgrammingRuntimes(context);
    case "jre":
    case "java":
      return downloadJre(context);
    case "python":
      return downloadPython(context);
    case "node":
    case "nodejs":
      return downloadNode(context);
    case "caddy":
      return downloadGateway("caddy", context);
    case "nginx":
      return downloadGateway("nginx", context);
    case "gerrit":
      return downloadGerrit(context);
    default:
      throw new Error(`Unsupported runtime dependency target: ${targetId || "(empty)"}`);
  }
}

export async function downloadRuntimeDependency(input = {}) {
  if (input.async === true || input.background === true) {
    return startRuntimeDependencyDownload(input);
  }
  return executeRuntimeDependencyDownload(input);
}
