import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { saveSettings } from "../platform/common/platform-core/settings.mjs";
import { TIKA_VERSION } from "../platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const platformKey = `${process.platform}-${process.arch}`;
const userDataPath = path.resolve(ServerConfig.getDataDir());
const runtimeDependencyRoot = path.resolve(
  process.env.PACT_RUNTIME_DEPENDENCY_CACHE_DIR ||
  path.join(userDataPath, "runtime", "runtime-dependencies")
);
const moduleResourceRoot = path.join(runtimeDependencyRoot, "knowledge");
const bundledModuleResourceRoot = path.join(projectRoot, "server", "platform", "modules", "knowledge");
const jreRoot = path.join(runtimeDependencyRoot, "jre");
const bundledJreRoot = path.join(bundledModuleResourceRoot, "runtime", "jre");
const tikaRoot = path.join(runtimeDependencyRoot, "tika");
const bundledTikaRoot = path.join(bundledModuleResourceRoot, "tika");
const MIN_JAVA_MAJOR = Number(process.env.PACT_MIN_JAVA_MAJOR || 21);

const JRE_DOWNLOADS = {
  "linux-x64": {
    fileName: "OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz"
  },
  "linux-arm64": {
    fileName: "OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz"
  },
  "darwin-arm64": {
    fileName: "OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz"
  },
  "darwin-x64": {
    fileName: "OpenJDK21U-jre_x64_mac_hotspot_21.0.10_7.tar.gz",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_mac_hotspot_21.0.10_7.tar.gz"
  },
  "win32-x64": {
    fileName: "OpenJDK21U-jre_x64_windows_hotspot_21.0.10_7.zip",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_windows_hotspot_21.0.10_7.zip"
  }
};

const TIKA_DOWNLOAD = {
  fileName: process.env.PACT_TIKA_DOWNLOAD_FILE || `tika-app-${TIKA_VERSION}.jar`,
  url: process.env.PACT_TIKA_DOWNLOAD_URL || `https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar`
};

function getJreCacheDirectory() {
  if (process.env.PACT_JRE_RUNTIME_CACHE_DIR && process.env.PACT_JRE_RUNTIME_CACHE_DIR.trim()) {
    return path.resolve(process.env.PACT_JRE_RUNTIME_CACHE_DIR.trim());
  }
  return path.join(runtimeDependencyRoot, "jre", "downloads");
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(targetPath) {
  try {
    return (await fs.stat(targetPath)).size;
  } catch {
    return 0;
  }
}

function sleepMs(delayMs = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

function downloadRetryAttempts() {
  const raw = Number(process.env.PACT_RUNTIME_DOWNLOAD_RETRY_ATTEMPTS || 12);
  return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 12;
}

function downloadRetryDelayMs(attemptIndex = 0) {
  const base = Number(process.env.PACT_RUNTIME_DOWNLOAD_RETRY_DELAY_MS || 5000);
  const max = Number(process.env.PACT_RUNTIME_DOWNLOAD_RETRY_MAX_DELAY_MS || 60000);
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 5000;
  const safeMax = Number.isFinite(max) ? Math.max(safeBase, max) : 60000;
  return Math.min(safeMax, safeBase * Math.max(1, 2 ** Math.max(0, attemptIndex)));
}

function nativeCommandRetryAttempts() {
  const raw = Number(process.env.PACT_RUNTIME_NATIVE_RETRY_ATTEMPTS || 5);
  return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 5;
}

function nativeCommandTimeoutMs() {
  const raw = Number(process.env.PACT_RUNTIME_NATIVE_COMMAND_TIMEOUT_MS || 600000);
  return Number.isFinite(raw) ? Math.max(1000, Math.floor(raw)) : 600000;
}

function outputMentionsRangeUnsupported(value = "") {
  return /cannot resume|does not seem to support byte ranges|range/i.test(String(value || ""));
}

function shellQuote(value = "") {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandPath(commandName = "") {
  const command = String(commandName || "").trim();
  if (!command) return "";
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { encoding: "utf8", timeout: 3000 })
    : spawnSync("sh", ["-c", `command -v ${shellQuote(command)}`], { encoding: "utf8", timeout: 3000 });
  if (result.status !== 0) return "";
  return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function commandResult(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: {
      ...process.env,
      ...(options.env || {})
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
    timeout: options.timeoutMs || 120000
  });
}

function commandAvailable(commandName = "") {
  return Boolean(commandPath(commandName));
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

function javaVersion(javaPath = "") {
  const command = String(javaPath || "").trim();
  if (!command) return { versionText: "", major: 0 };
  const result = commandResult(command, ["-version"], { timeoutMs: 10000 });
  const versionText = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    versionText,
    major: result.status === 0 ? parseJavaMajor(versionText) : 0
  };
}

function executableName(baseName) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function wellKnownJavaCandidates() {
  const javaName = executableName("java");
  const candidates = [
    process.env.PACT_JAVA_BIN_PATH,
    path.join(jreRoot, platformKey, "bin", javaName),
    path.join(jreRoot, platformKey, "Contents", "Home", "bin", javaName),
    path.join(jreRoot, platformKey, "Home", "bin", javaName),
    path.join(jreRoot, platformKey, "jre", "bin", javaName),
    path.join(bundledJreRoot, platformKey, "bin", javaName),
    path.join(bundledJreRoot, platformKey, "Contents", "Home", "bin", javaName),
    path.join(bundledJreRoot, platformKey, "Home", "bin", javaName),
    path.join(bundledJreRoot, platformKey, "jre", "bin", javaName),
    "/opt/homebrew/opt/openjdk@21/bin/java",
    "/usr/local/opt/openjdk@21/bin/java",
    "/usr/lib/jvm/java-21-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-21-openjdk-arm64/bin/java",
    "/usr/lib/jvm/java-21-openjdk/bin/java",
    commandPath("java")
  ];
  return [...new Set(candidates.map((item) => String(item || "").trim()).filter(Boolean))];
}

async function detectUsableJava() {
  const candidates = wellKnownJavaCandidates();
  const rejected = [];
  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      if (candidate === "java") {
        continue;
      }
      rejected.push({ javaPath: candidate, reason: "missing" });
      continue;
    }
    const version = javaVersion(candidate);
    if (version.major >= MIN_JAVA_MAJOR) {
      return {
        ok: true,
        javaPath: candidate,
        versionText: version.versionText,
        major: version.major,
        rejected
      };
    }
    rejected.push({
      javaPath: candidate,
      versionText: version.versionText,
      major: version.major,
      reason: "version_too_old"
    });
  }
  return {
    ok: false,
    javaPath: "",
    versionText: "",
    major: 0,
    rejected
  };
}

async function downloadFile(url, targetPath) {
  await ensureDirectory(path.dirname(targetPath));
  const tempPath = `${targetPath}.download`;
  const maxAttempts = downloadRetryAttempts();
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const partialBytes = await fileSize(tempPath);
    console.log(
      partialBytes > 0
        ? `Auto-resuming download (${attempt}/${maxAttempts}, ${partialBytes} bytes): ${url}`
        : `Downloading (${attempt}/${maxAttempts}): ${url}`
    );
    try {
      if (commandAvailable("curl")) {
        const curlArgs = ["-L", "--fail", "--retry", "3", "--connect-timeout", "20"];
        if (partialBytes > 0) {
          curlArgs.push("-C", "-");
        }
        curlArgs.push("-o", tempPath, url);
        try {
          await runCurlDownload(url, curlArgs);
        } catch (error) {
          if (partialBytes <= 0 || !outputMentionsRangeUnsupported(error?.output || error?.message || "")) {
            throw error;
          }
          await fs.rm(tempPath, { force: true }).catch(() => {});
          await runCurlDownload(url, ["-L", "--fail", "--retry", "3", "--connect-timeout", "20", "-o", tempPath, url]);
        }
      } else if (commandAvailable("wget")) {
        await new Promise((resolve, reject) => {
          const args = partialBytes > 0 ? ["-c", "-O", tempPath, url] : ["-O", tempPath, url];
          const wget = spawn("wget", args, { stdio: "inherit" });
          wget.once("error", reject);
          wget.once("exit", (code) => {
            if (code !== 0) {
              reject(new Error(`下载失败：${url}，退出码 ${code}`));
              return;
            }
            resolve();
          });
        });
      } else if (typeof fetch === "function") {
        let response = await fetch(url, {
          redirect: "follow",
          headers: partialBytes > 0 ? { Range: `bytes=${partialBytes}-` } : {}
        });
        if (partialBytes > 0 && response.status === 416) {
          await fs.rm(tempPath, { force: true }).catch(() => {});
          response = await fetch(url, { redirect: "follow" });
        }
        if (!response.ok) {
          throw new Error(`下载失败：${url}，HTTP ${response.status}`);
        }
        const append = partialBytes > 0 && response.status === 206;
        if (partialBytes > 0 && response.status !== 206) {
          await fs.rm(tempPath, { force: true }).catch(() => {});
        }
        await pipeline(
          Readable.fromWeb(response.body),
          createWriteStream(tempPath, { flags: append ? "a" : "w" })
        );
      } else {
        throw new Error("未找到 curl/wget，当前 Node 运行时也不支持 fetch，无法下载运行时组件。");
      }
      await fs.rename(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delayMs = downloadRetryDelayMs(attempt - 1);
      console.warn(`Download failed; auto-resuming in ${delayMs}ms with ${await fileSize(tempPath)} bytes preserved: ${error instanceof Error ? error.message : error}`);
      await sleepMs(delayMs);
    }
  }
  throw lastError || new Error(`下载失败：${url}`);
}

function runCurlDownload(url, args) {
  return new Promise((resolve, reject) => {
    let output = "";
    const curl = spawn("curl", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    curl.once("error", reject);
    curl.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString("utf8");
    });
    curl.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += chunk.toString("utf8");
    });
    curl.once("exit", (code) => {
      if (code !== 0) {
        const error = new Error(`下载失败：${url}，退出码 ${code}`);
        error.output = output;
        reject(error);
        return;
      }
      resolve({ output });
    });
  });
}

async function copyFileIfPresent(sourcePath, targetPath) {
  if (!(await fileExists(sourcePath))) {
    return false;
  }
  await ensureDirectory(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

async function listDirectoryEntries(targetPath) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  return entries.filter((entry) => !entry.name.startsWith("."));
}

async function flattenSingleTopLevelDirectory(targetPath) {
  const entries = await listDirectoryEntries(targetPath);
  if (entries.length !== 1 || !entries[0].isDirectory()) {
    return;
  }

  const nestedRoot = path.join(targetPath, entries[0].name);
  const nestedEntries = await fs.readdir(nestedRoot, { withFileTypes: true });
  for (const entry of nestedEntries) {
    await fs.rename(path.join(nestedRoot, entry.name), path.join(targetPath, entry.name));
  }
  await fs.rm(nestedRoot, { recursive: true, force: true });
}

async function extractTarGz(archivePath, targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await ensureDirectory(targetPath);

  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  await new Promise((resolve, reject) => {
    const child = spawn(tar, ["-xzf", archivePath, "-C", targetPath], {
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`tar 解压失败，退出码 ${code}`));
        return;
      }
      resolve();
    });
  });

  await flattenSingleTopLevelDirectory(targetPath);
}

async function extractZip(archivePath, targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await ensureDirectory(targetPath);
  const unzipCommand = process.platform === "win32" ? "tar.exe" : "unzip";
  const args = process.platform === "win32"
    ? ["-xf", archivePath, "-C", targetPath]
    : ["-q", archivePath, "-d", targetPath];
  await new Promise((resolve, reject) => {
    const child = spawn(unzipCommand, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`zip 解压失败，退出码 ${code}`));
        return;
      }
      resolve();
    });
  });
  await flattenSingleTopLevelDirectory(targetPath);
}

function getExpectedJavaPath(runtimeRoot) {
  const executable = process.platform === "win32" ? "java.exe" : "java";
  return process.platform === "darwin"
    ? path.join(runtimeRoot, "Contents", "Home", "bin", executable)
    : path.join(runtimeRoot, "bin", executable);
}

function configuredJreDownload() {
  const fallback = JRE_DOWNLOADS[platformKey] || {};
  const url = String(process.env.PACT_JRE_DOWNLOAD_URL || fallback.url || "").trim();
  return {
    fileName: String(process.env.PACT_JRE_DOWNLOAD_FILE || fallback.fileName || `jre-${platformKey}.tar.gz`).trim(),
    url
  };
}

function privilegedCommand(command, args = []) {
  if (process.platform === "win32") {
    return { command, args };
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { command, args };
  }
  if (commandAvailable("sudo")) {
    return { command: "sudo", args: ["-n", command, ...args] };
  }
  return { command, args };
}

function nativeJreInstallPlans() {
  if (process.env.PACT_DISABLE_NATIVE_RUNTIME_INSTALL === "1") {
    return [];
  }
  if (process.platform === "darwin") {
    return [
      commandAvailable("brew")
        ? { label: "Homebrew openjdk@21", command: "brew", args: ["install", "openjdk@21"] }
        : null
    ].filter(Boolean);
  }
  if (process.platform === "linux") {
    const plans = [];
    if (commandAvailable("apt-get")) {
      const update = privilegedCommand("apt-get", ["update"]);
      const install = privilegedCommand("apt-get", ["install", "-y", "--no-install-recommends", "openjdk-21-jre-headless"]);
      plans.push({ label: "apt openjdk-21-jre-headless", commands: [update, install] });
    }
    if (commandAvailable("dnf")) {
      plans.push({ label: "dnf java-21-openjdk-headless", commands: [privilegedCommand("dnf", ["install", "-y", "java-21-openjdk-headless"])] });
    }
    if (commandAvailable("yum")) {
      plans.push({ label: "yum java-21-openjdk-headless", commands: [privilegedCommand("yum", ["install", "-y", "java-21-openjdk-headless"])] });
    }
    if (commandAvailable("apk")) {
      plans.push({ label: "apk openjdk21-jre-headless", commands: [privilegedCommand("apk", ["add", "--no-cache", "openjdk21-jre-headless"])] });
    }
    if (commandAvailable("pacman")) {
      plans.push({ label: "pacman jre-openjdk-headless", commands: [privilegedCommand("pacman", ["-Sy", "--noconfirm", "jre-openjdk-headless"])] });
    }
    if (commandAvailable("zypper")) {
      plans.push({ label: "zypper java-21-openjdk-headless", commands: [privilegedCommand("zypper", ["--non-interactive", "install", "java-21-openjdk-headless"])] });
    }
    return plans;
  }
  if (process.platform === "win32") {
    return [
      commandAvailable("winget")
        ? { label: "winget Temurin 21 JRE", command: "winget", args: ["install", "--id", "EclipseAdoptium.Temurin.21.JRE", "-e", "--accept-package-agreements", "--accept-source-agreements"] }
        : null,
      commandAvailable("choco")
        ? { label: "Chocolatey Temurin 21 JRE", command: "choco", args: ["install", "-y", "temurin21jre"] }
        : null,
      commandAvailable("scoop")
        ? { label: "Scoop Temurin 21 JRE", command: "scoop", args: ["install", "temurin21-jre"] }
        : null
    ].filter(Boolean);
  }
  return [];
}

async function runNativeInstallPlan(plan) {
  const commands = plan.commands || [{ command: plan.command, args: plan.args || [] }];
  console.log(`Installing JRE with native toolchain: ${plan.label}`);
  for (const entry of commands) {
    await runNativeInstallCommandWithRetry(entry.command, entry.args || []);
  }
}

async function runNativeInstallCommandWithRetry(command, args = []) {
  const attempts = nativeCommandRetryAttempts();
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runNativeInstallCommand(command, args);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const delayMs = downloadRetryDelayMs(attempt - 1);
      console.warn(`Native install command failed; retrying in ${delayMs}ms (${attempt}/${attempts}): ${command} ${args.join(" ")}`);
      await sleepMs(delayMs);
    }
  }
  throw lastError || new Error(`${command} ${args.join(" ")} failed`);
}

function runNativeInstallCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000).unref?.();
    }, nativeCommandTimeoutMs());
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}${signal ? ` signal ${signal}` : ""}`));
        return;
      }
      resolve();
    });
  });
}

async function tryNativeJreInstall() {
  const plans = nativeJreInstallPlans();
  const failures = [];
  for (const plan of plans) {
    try {
      await runNativeInstallPlan(plan);
      const detected = await detectUsableJava();
      if (detected.ok) {
        return { installed: true, detected, plan };
      }
      failures.push({ plan: plan.label, error: "installed but no compatible java detected" });
    } catch (error) {
      failures.push({ plan: plan.label, error: error instanceof Error ? error.message : String(error) });
      console.warn(`Native JRE install failed (${plan.label}): ${failures.at(-1).error}`);
    }
  }
  return { installed: false, detected: await detectUsableJava(), failures };
}

async function setupModuleJre() {
  const detectedBefore = await detectUsableJava();
  if (detectedBefore.ok) {
    console.log(`Using existing Java ${detectedBefore.major}: ${detectedBefore.javaPath}`);
    return {
      runtimeRoot: path.dirname(path.dirname(detectedBefore.javaPath)),
      javaPath: detectedBefore.javaPath,
      archivePath: "",
      downloaded: false,
      installedBy: "existing-runtime",
      versionText: detectedBefore.versionText
    };
  }

  const nativeInstall = await tryNativeJreInstall();
  if (nativeInstall.detected?.ok) {
    console.log(`Using native Java ${nativeInstall.detected.major}: ${nativeInstall.detected.javaPath}`);
    return {
      runtimeRoot: path.dirname(path.dirname(nativeInstall.detected.javaPath)),
      javaPath: nativeInstall.detected.javaPath,
      archivePath: "",
      downloaded: false,
      installedBy: nativeInstall.plan?.label || "native-toolchain",
      versionText: nativeInstall.detected.versionText
    };
  }

  const jreDownload = configuredJreDownload();
  if (!jreDownload.url) {
    throw new Error(`当前平台 ${platformKey} 没有检测到 Java ${MIN_JAVA_MAJOR}+，原生安装器不可用或执行失败，且内置 JRE 下载源不可用。请配置本地源后重试。`);
  }

  const runtimeRoot = path.join(jreRoot, platformKey);
  const javaPath = getExpectedJavaPath(runtimeRoot);
  const archivePath = path.join(getJreCacheDirectory(), jreDownload.fileName);
  const legacyArchivePath = path.join(bundledJreRoot, "downloads", jreDownload.fileName);
  if (!(await fileExists(archivePath))) {
    if (await copyFileIfPresent(legacyArchivePath, archivePath)) {
      console.log(`Using cached legacy JRE archive: ${legacyArchivePath}`);
    } else {
      console.log(`Downloading JRE: ${jreDownload.url}`);
      await downloadFile(jreDownload.url, archivePath);
    }
  }

  if (await fileExists(javaPath)) {
    return {
      runtimeRoot,
      javaPath,
      archivePath,
      downloaded: false
    };
  }

  console.log(`Extracting JRE to ${runtimeRoot}`);
  if (archivePath.endsWith(".zip")) {
    await extractZip(archivePath, runtimeRoot);
  } else {
    await extractTarGz(archivePath, runtimeRoot);
  }

  if (!(await fileExists(javaPath))) {
    throw new Error(`JRE 已解压，但未找到 java 可执行文件：${javaPath}`);
  }

  const detectedAfter = javaVersion(javaPath);
  if (detectedAfter.major < MIN_JAVA_MAJOR) {
    throw new Error(`JRE 版本不符合要求：需要 Java ${MIN_JAVA_MAJOR}+，实际为 ${detectedAfter.versionText || "unknown"}`);
  }

  return {
    runtimeRoot,
    javaPath,
    archivePath,
    downloaded: true,
    installedBy: "archive-download",
    versionText: detectedAfter.versionText
  };
}

async function setupModuleTika() {
  const tikaJarPath = path.join(tikaRoot, TIKA_DOWNLOAD.fileName);
  if (!(await fileExists(tikaJarPath))) {
    const bundledTikaPath = path.join(bundledTikaRoot, TIKA_DOWNLOAD.fileName);
    const bundledGenericTikaPath = path.join(bundledTikaRoot, "tika-app.jar");
    if (await copyFileIfPresent(bundledTikaPath, tikaJarPath)) {
      console.log(`Using bundled Tika archive: ${bundledTikaPath}`);
    } else if (await copyFileIfPresent(bundledGenericTikaPath, tikaJarPath)) {
      console.log(`Using bundled Tika archive: ${bundledGenericTikaPath}`);
    } else {
      console.log(`Downloading Tika: ${TIKA_DOWNLOAD.url}`);
      await downloadFile(TIKA_DOWNLOAD.url, tikaJarPath);
    }
  }

  return {
    tikaJarPath,
    downloaded: true
  };
}

async function main() {
  const [jre, tika] = await Promise.all([setupModuleJre(), setupModuleTika()]);

  const saved = await saveSettings(userDataPath, {
    javaBinPath: jre.javaPath,
    tikaJarPath: tika.tikaJarPath
  }, {
    redactSecrets: true
  });

  console.log(
    JSON.stringify(
      {
        platform: platformKey,
        moduleResourceRoot,
        jreCacheRoot: getJreCacheDirectory(),
        jreArchivePath: jre.archivePath,
        javaBinPath: saved.javaBinPath,
        tikaJarPath: saved.tikaJarPath
      },
      null,
      2
    )
  );
}

await main();
