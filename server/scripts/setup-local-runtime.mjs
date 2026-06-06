import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { saveSettings } from "../platform/common/platform-core/settings.mjs";
import { TIKA_VERSION } from "../platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const moduleResourceRoot = path.join(projectRoot, "server", "platform", "modules", "knowledge");
const jreRoot = path.join(moduleResourceRoot, "runtime", "jre");
const tikaRoot = path.join(moduleResourceRoot, "tika");
const platformKey = `${process.platform}-${process.arch}`;
const userDataPath = path.resolve(ServerConfig.getDataDir());

const JRE_DOWNLOADS = {
  "darwin-arm64": {
    fileName: "OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz"
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
  return path.join(userDataPath, "cache", "jre-runtime");
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

async function downloadFile(url, targetPath) {
  await ensureDirectory(path.dirname(targetPath));
  const tempPath = `${targetPath}.download`;

  await new Promise((resolve, reject) => {
    const curl = spawn(
      "curl",
      ["-L", "--fail", "--retry", "3", "--connect-timeout", "20", "-o", tempPath, url],
      {
        stdio: "inherit"
      }
    );

    curl.once("error", reject);
    curl.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`下载失败：${url}，退出码 ${code}`));
        return;
      }

      resolve();
    });
  });

  await fs.rename(tempPath, targetPath);
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

async function setupModuleJre() {
  const jreDownload = configuredJreDownload();
  if (!jreDownload.url) {
    throw new Error(`当前平台 ${platformKey} 的内置 JRE 源不可用，请在本地源配置中配置镜像源后重试。`);
  }

  const runtimeRoot = path.join(jreRoot, platformKey);
  const javaPath = getExpectedJavaPath(runtimeRoot);
  const archivePath = path.join(getJreCacheDirectory(), jreDownload.fileName);
  const legacyArchivePath = path.join(jreRoot, "downloads", jreDownload.fileName);
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
  await extractTarGz(archivePath, runtimeRoot);

  if (!(await fileExists(javaPath))) {
    throw new Error(`JRE 已解压，但未找到 java 可执行文件：${javaPath}`);
  }

  return {
    runtimeRoot,
    javaPath,
    archivePath,
    downloaded: true
  };
}

async function setupModuleTika() {
  const tikaJarPath = path.join(tikaRoot, TIKA_DOWNLOAD.fileName);
  if (!(await fileExists(tikaJarPath))) {
    console.log(`Downloading Tika: ${TIKA_DOWNLOAD.url}`);
    await downloadFile(TIKA_DOWNLOAD.url, tikaJarPath);
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
