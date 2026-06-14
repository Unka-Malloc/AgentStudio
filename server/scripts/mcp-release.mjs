#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";
import {
  MCP_CONNECTOR_PACKAGE_NAME,
  MCP_CONNECTOR_VERSION,
  MCP_CLIENT_TARGETS,
  MCP_INTERFACE_VERSION,
  MCP_PRIORITY_INSTALL_TARGETS,
  MCP_SHAREDSPACE_TOOL_NAME,
  MCP_SERVER_VERSION,
  MCP_STABLE_TOOL_NAME,
  MCP_TOOLSET_VERSION
} from "../platform/common/mcp/http-mcp-adapter.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const connectorRoot = path.join(projectRoot, "mcp-connector");
const BOOTSTRAP_CURL_FLAGS = "-fL --retry 3 --connect-timeout 20 -sS";
const PRIORITY_INSTALL_TARGET = MCP_PRIORITY_INSTALL_TARGETS.join(",");
const SHAREDSPACE_CORE_OPERATIONS = Object.freeze([
  "pact.agentWorkspace.create",
  "pact.sharedspace.localDir.connect",
  "pact.sharedspace.localDir.list",
  "pact.sharedspace.item.list",
  "pact.sharedspace.file.read",
  "pact.sharedspace.file.write",
  "pact.sharedspace.item.delete",
  "pact.sharedspace.sync.plan",
  "pact.sharedspace.sync.apply"
]);

function supportedTargetDetails() {
  return MCP_CLIENT_TARGETS.map(({ target, label, priority, installMode, locations }) => ({
    target,
    label,
    priority,
    installMode,
    locations: [...locations]
  }));
}

function sharedspaceExchangeReceiptContract() {
  return {
    schemaVersion: "v0.0.1:mcp:sharedspace-exchange-1",
    locations: [
      "structuredContent.exchange",
      "notifications/pact/operation_reply.params.exchange"
    ],
    actions: [
      "workspace-created",
      "file-written",
      "file-read",
      "items-listed",
      "item-deleted",
      "local-dir-connected",
      "local-dirs-listed",
      "sync-planned",
      "sync-applied",
      "operation"
    ],
    fields: [
      "action",
      "outlet",
      "referencePolicy",
      "workspaceRef",
      "path",
      "paths",
      "itemCount",
      "checkpointId",
      "syncReceiptId",
      "nextOperations"
    ]
  };
}

function sharedHubContract() {
  return {
    clientPolicy: "discover-shared-hub-then-opt-in",
    defaultClientMutation: "none",
    directHttp: true,
    sharedspace: {
      outlet: MCP_SHAREDSPACE_TOOL_NAME,
      referencePolicy: "use-public-workspace-ref",
      exchangeReceipt: sharedspaceExchangeReceiptContract(),
      coreOperations: [...SHAREDSPACE_CORE_OPERATIONS]
    }
  };
}

function parseArgs(argv) {
  const args = {
    "output-dir": path.join(projectRoot, "build", "release", "mcp"),
    channel: "stable",
    platforms: null,
    json: false,
    publish: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const keyValue = item.slice(2);
    const equalIndex = keyValue.indexOf("=");
    const key = equalIndex >= 0 ? keyValue.slice(0, equalIndex) : keyValue;
    const inlineValue = equalIndex >= 0 ? keyValue.slice(equalIndex + 1) : null;
    if (key === "json") {
      args.json = true;
      continue;
    }
    if (key === "publish") {
      args.publish = true;
      continue;
    }
    const next = argv[index + 1];
    const value = inlineValue !== null ? inlineValue : !next || next.startsWith("--") ? true : next;
    if (inlineValue === null && value !== true) {
      index += 1;
    }
    args[key] = value;
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function run(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd || projectRoot,
    env: {
      ...process.env,
      ...(options.env || {})
    },
    maxBuffer: 10 * 1024 * 1024
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function currentPlatformKey() {
  const platformMap = {
    darwin: "macos",
    linux: "linux",
    win32: "windows"
  };
  const archMap = {
    x64: "x64",
    arm64: "arm64"
  };
  return `${platformMap[process.platform] || process.platform}-${archMap[process.arch] || process.arch}`;
}

function unixExecutableName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function writeExecutable(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755);
  }
}

function getNodeCacheDirectory() {
  if (process.env.PACT_MCP_NODE_RUNTIME_CACHE_DIR && process.env.PACT_MCP_NODE_RUNTIME_CACHE_DIR.trim()) {
    return process.env.PACT_MCP_NODE_RUNTIME_CACHE_DIR.trim();
  }

  return path.join(ServerConfig.getDataDir(), "cache", "mcp-node-runtime");
}

async function hasUsableCachedNodeArchive(archivePath) {
  try {
    const stat = await fs.stat(archivePath);
    return stat.isFile() && stat.size > 1024;
  } catch {
    return false;
  }
}

function getNodeArchiveFilename(version, target) {
  const isMusl = target.includes("-musl");
  const targetBase = isMusl ? target.replace(/-musl$/, "") : target;
  return isMusl ? `node-${version}-${targetBase}-musl.tar.gz` : `node-${version}-${target}.tar.gz`;
}

function getNodeArchivePath(version, target) {
  const archive = getNodeArchiveFilename(version, target);
  return path.join(getNodeCacheDirectory(), archive);
}

function releaseBundlePlatform(target) {
  if (target === "linux-x64") {
    return "linux-x86_64";
  }
  if (target === "linux-x64-musl") {
    return "linux-x86_64-musl";
  }
  return target;
}

function parseNodeVersionFromEngineRange(engineRange) {
  if (!engineRange || typeof engineRange !== "string") {
    return null;
  }

  const cleaned = engineRange.trim();
  if (!cleaned) {
    return null;
  }

  const exactMatch = cleaned.match(/^(?:v)?(\d+\.\d+\.\d+)$/);
  if (exactMatch) {
    return { exact: normalizeNodeVersion(exactMatch[1]) };
  }
  return null;
}

async function resolveProjectNodeVersion() {
  try {
    const packageData = await readJson(path.join(connectorRoot, "package.json"));
    const engineRange = packageData?.engines?.node;
    const parsed = parseNodeVersionFromEngineRange(String(engineRange || "").trim());
    if (!parsed) {
      return "";
    }

    if (parsed.exact) {
      return parsed.exact;
    }

    return "";
  } catch (error) {
    console.error(`Warning: ${error?.message || String(error)}; project Node resolution skipped.`);
    return "";
  }
}

function normalizeNodeVersion(version) {
  return String(version).trim().startsWith("v") ? String(version).trim() : `v${String(version).trim()}`;
}

async function resolveBundledNodeVersion(explicitVersion = "") {
  if (typeof explicitVersion === "string" && explicitVersion.trim()) {
    return normalizeNodeVersion(explicitVersion);
  }

  const envVersion = process.env.PACT_MCP_NODE_VERSION || process.env.PACT_MCP_NODE_LTS_VERSION;
  if (envVersion && envVersion.trim()) {
    return normalizeNodeVersion(envVersion);
  }

  const projectNodeVersion = await resolveProjectNodeVersion();
  if (projectNodeVersion) {
    return projectNodeVersion;
  }

  if (process.versions.node) {
    return normalizeNodeVersion(process.versions.node);
  }

  try {
    const response = await fetch("https://nodejs.org/dist/index.json");
    if (!response.ok) {
      throw new Error(`Failed to resolve latest LTS: ${response.status} ${response.statusText}`);
    }

    const releases = await response.json();
    const latestLts = releases.find((release) => release.lts);
    if (!latestLts?.version) {
      throw new Error("No LTS release found in nodejs.org index");
    }

    return normalizeNodeVersion(latestLts.version);
  } catch (error) {
    console.error(`Warning: ${error?.message || String(error)}; falling back to current Node runtime version.`);
    return normalizeNodeVersion(process.versions.node);
  }
}

async function downloadNodeBinary(version, target, outputDir) {
  const isMusl = target.includes("-musl");
  const baseUrl = isMusl 
    ? "https://unofficial-builds.nodejs.org/download/release" 
    : "https://nodejs.org/dist";
  const filename = getNodeArchiveFilename(version, target);
  const downloadUrl = `${baseUrl}/${version}/${filename}`;
  const cacheDir = getNodeCacheDirectory();
  const archivePath = getNodeArchivePath(version, target);
  const tempArchivePath = `${archivePath}.download`;

  await fs.mkdir(cacheDir, { recursive: true });
  if (await hasUsableCachedNodeArchive(archivePath)) {
    console.error(`Using cached Node runtime: ${archivePath}`);
  } else {
    console.error(`Downloading ${downloadUrl}...`);
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download Node binary from ${downloadUrl}: ${res.statusText}`);
    }
    
    const fileStream = (await import("node:fs")).createWriteStream(tempArchivePath);
    try {
      await pipeline(res.body, fileStream);
      await fs.rename(tempArchivePath, archivePath);
    } catch (error) {
      await fs.rm(tempArchivePath, { force: true });
      throw error;
    }
  }

  if (!await hasUsableCachedNodeArchive(archivePath)) {
    throw new Error(`Failed to download or locate cached Node binary: ${archivePath}`);
  }

  const extractDir = path.join(outputDir, `extracted-${target}`);
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });
  await run("tar", ["-xzf", archivePath, "-C", extractDir, "--strip-components=1"]);
  
  return path.join(extractDir, "bin", "node");
}

async function createPortableBundle({ outputDir, packageJson, target, bundledVersion }) {
  const platform = releaseBundlePlatform(target);
  const rootName = `${packageJson.name}-${packageJson.version}-${platform}`;
  const stagingRoot = path.join(outputDir, rootName);
  const appRoot = path.join(stagingRoot, "app");
  const runtimeRoot = path.join(stagingRoot, "runtime");
  const runtimePath = path.join(runtimeRoot, "node");
  const generateZip = !platform.startsWith("linux");
  const archiveName = `${rootName}.tar.gz`;
  const archivePath = path.join(outputDir, archiveName);
  const zipArchiveName = generateZip ? `${rootName}.zip` : null;
  const zipArchivePath = zipArchiveName ? path.join(outputDir, zipArchiveName) : null;

  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.rm(archivePath, { force: true });
  if (zipArchivePath) {
    await fs.rm(zipArchivePath, { force: true });
  }
  await fs.mkdir(path.join(appRoot, "bin"), { recursive: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  const downloadedNodeBin = await downloadNodeBinary(bundledVersion, target, outputDir);
  await fs.copyFile(downloadedNodeBin, runtimePath);
  await fs.chmod(runtimePath, 0o755);
  await fs.copyFile(path.join(connectorRoot, "package.json"), path.join(appRoot, "package.json"));
  await fs.copyFile(path.join(connectorRoot, "README.md"), path.join(appRoot, "README.md"));
  await fs.copyFile(
    path.join(connectorRoot, "bin", "pact-mcp.mjs"),
    path.join(appRoot, "bin", "pact-mcp.mjs")
  );

  await writeExecutable(path.join(stagingRoot, "pact-mcp"), [
    "#!/usr/bin/env sh",
    "set -e",
    "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "exec \"$DIR/runtime/node\" \"$DIR/app/bin/pact-mcp.mjs\" \"$@\"",
    ""
  ].join("\n"));
  await writeExecutable(path.join(stagingRoot, "pact-mcp.cmd"), [
    "@echo off",
    "set DIR=%~dp0",
    "\"%DIR%runtime\\node.exe\" \"%DIR%app\\bin\\pact-mcp.mjs\" %*",
    ""
  ].join("\r\n"));
  await writeExecutable(path.join(stagingRoot, "install.command"), [
    "#!/usr/bin/env sh",
    "set -e",
    "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "\"$DIR/pact-mcp\" install",
    "printf '\\nDone. Press Enter to close.'",
    "IFS= read -r _",
    ""
  ].join("\n"));
  await writeExecutable(path.join(stagingRoot, "uninstall.command"), [
    "#!/usr/bin/env sh",
    "set -e",
    "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "\"$DIR/pact-mcp\" uninstall",
    "printf '\\nDone. Press Enter to close.'",
    "IFS= read -r _",
    ""
  ].join("\n"));
  await writeExecutable(path.join(stagingRoot, "doctor.command"), [
    "#!/usr/bin/env sh",
    "set -e",
    "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "\"$DIR/pact-mcp\" doctor",
    "printf '\\nDone. Press Enter to close.'",
    "IFS= read -r _",
    ""
  ].join("\n"));
  await fs.writeFile(path.join(stagingRoot, "README.txt"), [
    "Pact MCP Connector Portable Package",
    "",
    "This package includes its own Node.js runtime. The target machine does not need Node.js, npm, npx, or a package manager.",
    "",
    "Command-line hub registration:",
    "  ./pact-mcp register",
    "",
    "The connector scans local Pact candidates and verifies the MCP identity signature before using a URL.",
    "",
    "Discover the local shared hub:",
    "  ./pact-mcp discover-local --json",
    "",
    "Connect clients interactively:",
    "  ./pact-mcp install",
    "",
    "Connect every detected client from a script:",
    "  ./pact-mcp install --target auto --json",
    "",
    "Connect a known client from a script:",
    "  ./pact-mcp install --target <client> --json",
    "",
    "Connect the priority agent clients from a script:",
    `  ./pact-mcp install --target ${PRIORITY_INSTALL_TARGET} --json`,
    "",
    "Use --token-stdin only when installing with a pre-issued custom grant token:",
    "  printf '%s\\n' '<issued-token>' | ./pact-mcp install --target auto --token-stdin --json",
    "",
    "macOS double-click flow:",
    "  Open install.command, choose one or more clients. The connector requests a local Pact grant automatically.",
    "",
    "Uninstall:",
    "  ./pact-mcp uninstall",
    "",
    "Uninstall priority clients from a script:",
    `  ./pact-mcp uninstall --target ${PRIORITY_INSTALL_TARGET}`,
    "",
    `Platform: ${platform}`,
    `Connector: ${packageJson.name}@${packageJson.version}`,
    `Bundled Node: ${process.version}`,
    ""
  ].join("\n"));

  await run("tar", ["-czf", archivePath, "-C", outputDir, rootName]);
  const stat = await fs.stat(archivePath);
  let zipSha256 = null;
  let zipSizeBytes = null;
  if (zipArchivePath) {
    await run("zip", ["-qry", zipArchivePath, rootName], { cwd: outputDir });
    const zipStat = await fs.stat(zipArchivePath);
    zipSha256 = await sha256(zipArchivePath);
    zipSizeBytes = zipStat.size;
  }
  return {
    platform,
    archiveName,
    archivePath,
    sha256: await sha256(archivePath),
    sizeBytes: stat.size,
    zipArchiveName,
    zipArchivePath,
    zipSha256,
    zipSizeBytes,
    rootName,
    executable: unixExecutableName("pact-mcp"),
    includesNodeRuntime: true,
    bundledNodeVersion: bundledVersion
  };
}

function githubOwnerRepo(packageJson) {
  const repositoryUrl = String(packageJson.repository?.url || "");
  const match = repositoryUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match?.[1] || "Unka-Malloc/Pact";
}

async function createBootstrapInstaller({ outputDir, packageJson, tarballName, tarballSha256, portables }) {
  const scriptName = "pact-mcp-install.sh";
  const scriptPath = path.join(outputDir, scriptName);
  const uninstallScriptName = "pact-mcp-uninstall.sh";
  const uninstallScriptPath = path.join(outputDir, uninstallScriptName);
  const zhCnScriptName = "pact-mcp-install.zh-CN.sh";
  const zhCnScriptPath = path.join(outputDir, zhCnScriptName);
  const zhCnUninstallScriptName = "pact-mcp-uninstall.zh-CN.sh";
  const zhCnUninstallScriptPath = path.join(outputDir, zhCnUninstallScriptName);
  const repo = githubOwnerRepo(packageJson);
  const minimumNodeMajor = Number(String(packageJson.engines?.node || ">=20").match(/\d+/)?.[0] || 20);
  const portablePlatformList = portables.map(p => p.platform).join(', ');
  const content = [
    "#!/usr/bin/env sh",
    "set -eu",
    "",
    `REPO=${JSON.stringify(repo)}`,
    `VERSION=${JSON.stringify(packageJson.version)}`,
    `PACKAGE_NAME=${JSON.stringify(packageJson.name)}`,
    `MINIMUM_NODE_MAJOR=${JSON.stringify(minimumNodeMajor)}`,
    `SOURCE_TARBALL=${JSON.stringify(tarballName)}`,
    `SOURCE_TARBALL_SHA256=${JSON.stringify(tarballSha256)}`,
    "BASE_URL=\"${PACT_MCP_RELEASE_BASE_URL:-https://github.com/${REPO}/releases/latest/download}\"",
    "INSTALL_PARENT=\"${PACT_MCP_INSTALL_DIR:-$HOME/.pact/mcp/connector}\"",
    "",
    "# Detect language",
    "SYSTEM_LANG=\"en\"",
    "if [ -n \"${LANG:-}\" ] && echo \"$LANG\" | grep -iq \"zh\"; then",
    "  SYSTEM_LANG=\"zh\"",
    "elif command -v defaults >/dev/null 2>&1 && defaults read -g AppleLanguages 2>/dev/null | head -n 2 | grep -iq \"zh\"; then",
    "  SYSTEM_LANG=\"zh\"",
    "fi",
    "",
    "msg() {",
    "  key=\"$1\"",
    "  zh_val=\"$2\"",
    "  en_val=\"$3\"",
    "  if [ \"$SYSTEM_LANG\" = \"zh\" ]; then",
    "    echo \"$zh_val\"",
    "  else",
    "    echo \"$en_val\"",
    "  fi",
    "}",
    "",
    "require_command() {",
    "  if ! command -v \"$1\" >/dev/null 2>&1; then",
    "    echo \"$(msg \"missing_cmd\" \"缺少必需命令: $1\" \"Missing required command: $1\")\" >&2",
    "    exit 1",
    "  fi",
    "}",
    "",
    "hash_file() {",
    "  if command -v shasum >/dev/null 2>&1; then",
    "    shasum -a 256 \"$1\" | awk '{print $1}'",
    "    return",
    "  fi",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    sha256sum \"$1\" | awk '{print $1}'",
    "    return",
    "  fi",
    "  echo \"$(msg \"missing_sha\" \"缺少用于校验发布包的 shasum 或 sha256sum。\" \"Missing shasum or sha256sum for release verification.\")\" >&2",
    "  exit 1",
    "}",
    "",
    "os_name=$(uname -s | tr '[:upper:]' '[:lower:]')",
    "arch_name=$(uname -m | tr '[:upper:]' '[:lower:]')",
    "case \"$os_name\" in",
    "  darwin) os_name=\"macos\" ;;",
    "  linux) os_name=\"linux\" ;;",
    "esac",
    "case \"$arch_name\" in",
    "  x86_64|amd64) arch_name=\"x64\" ;;",
    "  arm64|aarch64) arch_name=\"arm64\" ;;",
    "esac",
    "platform=\"$os_name-$arch_name\"",
    "",
    "require_command curl",
    "require_command awk",
    "",
    "tmp_dir=$(mktemp -d)",
    "cleanup() { rm -rf \"$tmp_dir\"; }",
    "trap cleanup EXIT INT TERM",
    "",
    "node_is_usable() {",
    "  command -v node >/dev/null 2>&1 || return 1",
    "  node -e 'const minimum = Number(process.argv[1]); const major = Number(process.versions.node.split(\".\")[0]); process.exit(major >= minimum ? 0 : 1)' \"$MINIMUM_NODE_MAJOR\" >/dev/null 2>&1",
    "}",
    "",
    "install_from_source_tarball() {",
    "  require_command tar",
    "  tarball_path=\"$tmp_dir/$SOURCE_TARBALL\"",
    "  download_url=\"${BASE_URL%/}/$SOURCE_TARBALL\"",
    "  echo \"$(msg \"download_src\" \"正在下载 Pact MCP connector $VERSION 源码包...\" \"Downloading Pact MCP connector $VERSION source package...\")\"",
    "  curl -fL --retry 3 --connect-timeout 20 -o \"$tarball_path\" \"$download_url\"",
    "  actual_sha256=$(hash_file \"$tarball_path\")",
    "  if [ \"$actual_sha256\" != \"$SOURCE_TARBALL_SHA256\" ]; then",
    "    echo \"$(msg \"checksum_err\" \"校验和不匹配: $SOURCE_TARBALL\" \"Checksum mismatch for $SOURCE_TARBALL\")\" >&2",
    "    echo \"$(msg \"expected\" \"预期: $SOURCE_TARBALL_SHA256\" \"expected: $SOURCE_TARBALL_SHA256\")\" >&2",
    "    echo \"$(msg \"actual\" \"实际:   $actual_sha256\" \"actual:   $actual_sha256\")\" >&2",
    "    exit 1",
    "  fi",
    "  extract_dir=\"$tmp_dir/source\"",
    "  mkdir -p \"$extract_dir\" \"$INSTALL_PARENT\"",
    "  tar -xzf \"$tarball_path\" -C \"$extract_dir\"",
    "  target_dir=\"$INSTALL_PARENT/$PACKAGE_NAME-$VERSION-node\"",
    "  rm -rf \"$target_dir\"",
    "  mv \"$extract_dir/package\" \"$target_dir\"",
    "  chmod +x \"$target_dir/bin/pact-mcp.mjs\" 2>/dev/null || true",
    "  rm -f \"$INSTALL_PARENT/current\"",
    "  ln -s \"$target_dir\" \"$INSTALL_PARENT/current\" 2>/dev/null || true",
    "  echo \"$(msg \"installed\" \"Pact MCP connector 已安装到 $target_dir\" \"Installed Pact MCP connector at $target_dir\")\"",
    "  echo \"$(msg \"opening_sel\" \"正在打开 Pact MCP 客户端选择器...\" \"Opening Pact MCP client selector...\")\"",
    "  if [ ! -t 0 ] && [ -c /dev/tty ]; then",
    "    exec node \"$target_dir/bin/pact-mcp.mjs\" install \"$@\" < /dev/tty",
    "  else",
    "    exec node \"$target_dir/bin/pact-mcp.mjs\" install \"$@\"",
    "  fi",
    "}",
    "",
    "is_musl=0",
    "if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -q musl; then",
    "  is_musl=1",
    "elif [ -f /etc/alpine-release ]; then",
    "  is_musl=1",
    "fi",
    "if [ \"$is_musl\" = \"1\" ] && [ \"$os_name\" = \"linux\" ]; then",
    "  platform=\"${platform}-musl\"",
    "fi",
    "",
    "install_from_portable_archive() {",
    "  require_command tar",
    "  case \"$platform\" in",
    ...portables.flatMap(p => {
      const archiveName = p.zipArchiveName || p.archiveName;
      const archiveSha = p.zipArchiveName ? p.zipSha256 : p.sha256;
      const archiveType = p.zipArchiveName ? "zip" : "tar";
      return [
        `    ${p.platform})`,
        `      archive=${JSON.stringify(archiveName)}`,
        `      archive_sha256=${JSON.stringify(archiveSha)}`,
        `      archive_root=${JSON.stringify(p.rootName)}`,
        `      archive_type=${JSON.stringify(archiveType)}`,
        "      ;;"
      ];
    }),
    "    *)",
    "      echo \"$(msg \"no_portable\" \"未找到可用的 Node.js 运行时，并且此发布版本没有适用于该平台的便携包: $platform\" \"No usable Node.js runtime was found and this release has no portable archive for: $platform\")\" >&2",
    "      echo \"$(msg \"release_contains\" \"此发布版本包含 ${portablePlatformList}。请为该平台构建并上传配置的便携包。\" \"This release contains ${portablePlatformList}. Build and upload the matching portable archive for this platform.\")\" >&2",
    "      exit 1",
    "      ;;",
    "  esac",
    "  archive_path=\"$tmp_dir/$archive\"",
    "  if [ \"$archive_type\" = \"zip\" ]; then",
    "    require_command unzip",
    "  fi",
    "  download_url=\"${BASE_URL%/}/$archive\"",
    "  echo \"$(msg \"download_portable\" \"正在下载 Pact MCP connector $VERSION 适用于 $platform 的便携运行时...\" \"Downloading Pact MCP connector $VERSION portable runtime for $platform...\")\"",
    "  curl -fL --retry 3 --connect-timeout 20 -o \"$archive_path\" \"$download_url\"",
    "  actual_sha256=$(hash_file \"$archive_path\")",
    "  if [ \"$actual_sha256\" != \"$archive_sha256\" ]; then",
    "    echo \"$(msg \"checksum_archive_err\" \"校验和不匹配: $archive\" \"Checksum mismatch for $archive\")\" >&2",
    "    echo \"$(msg \"expected\" \"预期: $archive_sha256\" \"expected: $archive_sha256\")\" >&2",
    "    echo \"$(msg \"actual\" \"实际:   $actual_sha256\" \"actual:   $actual_sha256\")\" >&2",
    "    exit 1",
    "  fi",
    "  extract_dir=\"$tmp_dir/portable\"",
    "  mkdir -p \"$extract_dir\" \"$INSTALL_PARENT\"",
    "  if [ \"$archive_type\" = \"zip\" ]; then",
    "    unzip -q \"$archive_path\" -d \"$extract_dir\"",
    "  else",
    "    tar -xzf \"$archive_path\" -C \"$extract_dir\"",
    "  fi",
    "  target_dir=\"$INSTALL_PARENT/$archive_root\"",
    "  rm -rf \"$target_dir\"",
    "  mv \"$extract_dir/$archive_root\" \"$target_dir\"",
    "  rm -f \"$INSTALL_PARENT/current\"",
    "  ln -s \"$target_dir\" \"$INSTALL_PARENT/current\" 2>/dev/null || true",
    "  echo \"$(msg \"installed\" \"Pact MCP connector 已安装到 $target_dir\" \"Installed Pact MCP connector at $target_dir\")\"",
    "  echo \"$(msg \"opening_sel\" \"正在打开 Pact MCP 客户端选择器...\" \"Opening Pact MCP client selector...\")\"",
    "  if [ ! -t 0 ] && [ -c /dev/tty ]; then",
    "    exec \"$target_dir/pact-mcp\" install \"$@\" < /dev/tty",
    "  else",
    "    exec \"$target_dir/pact-mcp\" install \"$@\"",
    "  fi",
    "}",
    "",
    "if node_is_usable; then",
    "  install_from_source_tarball \"$@\"",
    "fi",
    "",
    "echo \"$(msg \"fallback_portable\" \"未找到可用的 Node.js $MINIMUM_NODE_MAJOR+ 运行时，正在回退到便携版 connector。\" \"No usable Node.js $MINIMUM_NODE_MAJOR+ runtime found; falling back to the portable connector.\")\"",
    "install_from_portable_archive \"$@\"",
    ""
  ].join("\n");
  await fs.writeFile(scriptPath, content);
  await fs.chmod(scriptPath, 0o755);
  const uninstallContent = content
    .replaceAll("Opening Pact MCP client selector...", "Opening Pact MCP client removal selector...")
    .replaceAll("正在打开 Pact MCP 客户端选择器...", "正在打开 Pact MCP 客户端移除选择器...")
    .replaceAll(" install \"$@\"", " uninstall \"$@\"");
  await fs.writeFile(uninstallScriptPath, uninstallContent);
  await fs.chmod(uninstallScriptPath, 0o755);
  const zhCnContent = content;
  await fs.writeFile(zhCnScriptPath, zhCnContent);
  await fs.chmod(zhCnScriptPath, 0o755);
  const zhCnUninstallContent = uninstallContent;
  await fs.writeFile(zhCnUninstallScriptPath, zhCnUninstallContent);
  await fs.chmod(zhCnUninstallScriptPath, 0o755);
  const zhCnSha256 = await sha256(zhCnScriptPath);
  const zhCnUninstallSha256 = await sha256(zhCnUninstallScriptPath);
  return {
    scriptName,
    scriptPath,
    sha256: await sha256(scriptPath),
    githubLatestUrl: `https://github.com/${repo}/releases/latest/download/${scriptName}`,
    oneLineCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${scriptName})"`,
    oneLineClientInstallJsonCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${scriptName})" -- --target <client> --json`,
    oneLineAutoInstallCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${scriptName})" -- --target auto --json`,
    oneLinePriorityInstallCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${scriptName})" -- --target ${PRIORITY_INSTALL_TARGET} --json`,
    uninstallScriptName,
    uninstallScriptPath,
    uninstallSha256: await sha256(uninstallScriptPath),
    githubLatestUninstallUrl: `https://github.com/${repo}/releases/latest/download/${uninstallScriptName}`,
    oneLineUninstallCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${uninstallScriptName})"`,
    localized: {
      zhCN: {
        scriptName: zhCnScriptName,
        scriptPath: zhCnScriptPath,
        sha256: zhCnSha256,
        githubLatestUrl: `https://github.com/${repo}/releases/latest/download/${zhCnScriptName}`,
        oneLineCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${zhCnScriptName})"`,
        oneLineClientInstallJsonCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${zhCnScriptName})" -- --target <client> --json`,
        oneLineAutoInstallCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${zhCnScriptName})" -- --target auto --json`,
        oneLinePriorityInstallCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${zhCnScriptName})" -- --target ${PRIORITY_INSTALL_TARGET} --json`,
        uninstallScriptName: zhCnUninstallScriptName,
        uninstallScriptPath: zhCnUninstallScriptPath,
        uninstallSha256: zhCnUninstallSha256,
        githubLatestUninstallUrl: `https://github.com/${repo}/releases/latest/download/${zhCnUninstallScriptName}`,
        oneLineUninstallCommand: `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${repo}/releases/latest/download/${zhCnUninstallScriptName})"`
      }
    }
  };
}

function localizeBootstrapShell(content, replacements) {
  let result = content;
  for (const [source, localized] of replacements) {
    result = result.replaceAll(source, localized);
  }
  return result;
}

function releaseManifest({ channel, packageJson, tarballName, tarballPath, checksum, sizeBytes, portables, bootstrap }) {
  const portable = portables[0];
  const hasFallbackZip = Boolean(portable.zipArchiveName);
  const fallbackDownload = hasFallbackZip ? portable.zipArchiveName : portable.archiveName;
  const fallbackSizeBytes = hasFallbackZip ? portable.zipSizeBytes : portable.sizeBytes;
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    packageType: "v0.0.1:mcp:connector-release-1",
    generatedAt: new Date().toISOString(),
    channel,
    interfaceVersion: MCP_INTERFACE_VERSION,
    toolsetVersion: MCP_TOOLSET_VERSION,
    serverVersion: MCP_SERVER_VERSION,
    stableToolName: MCP_STABLE_TOOL_NAME,
    sharedHub: sharedHubContract(),
    connector: {
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      minimumNodeVersion: packageJson.engines?.node || ">=20",
      tarball: tarballName,
      sha256: checksum,
      sizeBytes
    },
    portable: {
      strategy: "embedded-node-runtime",
      requiresInstalledNode: false,
      preferredArchive: hasFallbackZip ? "zip" : "tar.gz",
      currentPlatform: portable.platform,
      tarball: portable.archiveName,
      sha256: portable.sha256,
      sizeBytes: portable.sizeBytes,
      zipArchive: portable.zipArchiveName,
      zipSha256: portable.zipSha256,
      zipSizeBytes: portable.zipSizeBytes,
      executable: portable.executable,
      includesNodeRuntime: portable.includesNodeRuntime,
      bundledNodeVersion: portable.bundledNodeVersion,
      zipInstallEntry: "install.command",
      zipUninstallEntry: "uninstall.command",
      installArchive: portable.archiveName,
      installArchiveSha256: portable.sha256,
      installArchiveSizeBytes: portable.sizeBytes,
      installArchiveType: portable.zipArchiveName ? "zip" : "tar",
      installCommand: `./${portable.executable} register`,
      clientInstallCommand: `./${portable.executable} install --target <client>`,
      clientInstallJsonCommand: `./${portable.executable} install --target <client> --json`,
      autoInstallCommand: `./${portable.executable} install --target auto --json`,
      priorityInstallCommand: `./${portable.executable} install --target ${PRIORITY_INSTALL_TARGET} --json`,
      priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
      supportedTargetDetails: supportedTargetDetails(),
      interactiveUninstallCommand: `./${portable.executable} uninstall`,
      clientUninstallCommand: `./${portable.executable} uninstall --target <client>`,
      doubleClickEntry: process.platform === "win32" ? "" : "install.command"
    },
    install: {
      githubOneLineCommand: bootstrap.oneLineCommand,
      githubOneLineCommandZhCN: bootstrap.localized.zhCN.oneLineCommand,
      githubOneLineClientInstallJsonCommand: bootstrap.oneLineClientInstallJsonCommand,
      githubOneLineClientInstallJsonCommandZhCN: bootstrap.localized.zhCN.oneLineClientInstallJsonCommand,
      githubOneLineAutoInstallCommand: bootstrap.oneLineAutoInstallCommand,
      githubOneLineAutoInstallCommandZhCN: bootstrap.localized.zhCN.oneLineAutoInstallCommand,
      githubOneLinePriorityInstallCommand: bootstrap.oneLinePriorityInstallCommand,
      githubOneLinePriorityInstallCommandZhCN: bootstrap.localized.zhCN.oneLinePriorityInstallCommand,
      githubOneLineUninstallCommand: bootstrap.oneLineUninstallCommand,
      githubOneLineUninstallCommandZhCN: bootstrap.localized.zhCN.oneLineUninstallCommand,
      oneCommandInstall: bootstrap.oneLineCommand,
      oneCommandInstallZhCN: bootstrap.localized.zhCN.oneLineCommand,
      oneCommandClientInstallJson: bootstrap.oneLineClientInstallJsonCommand,
      oneCommandClientInstallJsonZhCN: bootstrap.localized.zhCN.oneLineClientInstallJsonCommand,
      oneCommandAutoInstall: bootstrap.oneLineAutoInstallCommand,
      oneCommandAutoInstallZhCN: bootstrap.localized.zhCN.oneLineAutoInstallCommand,
      oneCommandPriorityInstall: bootstrap.oneLinePriorityInstallCommand,
      oneCommandPriorityInstallZhCN: bootstrap.localized.zhCN.oneLinePriorityInstallCommand,
      oneCommandUninstall: bootstrap.oneLineUninstallCommand,
      oneCommandUninstallZhCN: bootstrap.localized.zhCN.oneLineUninstallCommand,
      registryCommand: `npx ${packageJson.name}@latest register`,
      tarballCommand: `npm exec --package ./build/release/mcp/${tarballName} -- pact-mcp register`,
      portableCommand: `./${portable.executable} register`,
      interactiveInstallCommand: `npx ${packageJson.name}@latest install`,
      autoInstallCommand: `npx ${packageJson.name}@latest install --target auto --json`,
      priorityInstallCommand: `npx ${packageJson.name}@latest install --target ${PRIORITY_INSTALL_TARGET} --json`,
      priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
      clientInstallCommand: `npx ${packageJson.name}@latest install --target <client>`,
      clientInstallJsonCommand: `npx ${packageJson.name}@latest install --target <client> --json`,
      interactiveUninstallCommand: `npx ${packageJson.name}@latest uninstall`,
      uninstallCommand: `npx ${packageJson.name}@latest uninstall --target <client>`,
      doctorCommand: `npx ${packageJson.name}@latest doctor`,
      discoverCommand: `npx ${packageJson.name}@latest discover-local --json`,
      scanCommand: `npx ${packageJson.name}@latest scan --json`,
      supportedTargets: MCP_CLIENT_TARGETS.map((target) => target.target),
      supportedTargetDetails: supportedTargetDetails()
    },
    upgrade: {
      listChanged: true,
      notification: "notifications/tools/list_changed",
      reinstallCommand: bootstrap.oneLineCommand,
      reinstallCommandZhCN: bootstrap.localized.zhCN.oneLineCommand,
      clientReinstallJsonCommand: bootstrap.oneLineClientInstallJsonCommand,
      clientReinstallJsonCommandZhCN: bootstrap.localized.zhCN.oneLineClientInstallJsonCommand,
      agentReinstallCommand: bootstrap.oneLineAutoInstallCommand,
      agentReinstallCommandZhCN: bootstrap.localized.zhCN.oneLineAutoInstallCommand,
      priorityAgentReinstallCommand: bootstrap.oneLinePriorityInstallCommand,
      priorityAgentReinstallCommandZhCN: bootstrap.localized.zhCN.oneLinePriorityInstallCommand,
      oneCommandReinstall: bootstrap.oneLineCommand,
      oneCommandReinstallZhCN: bootstrap.localized.zhCN.oneLineCommand,
      oneCommandClientReinstallJson: bootstrap.oneLineClientInstallJsonCommand,
      oneCommandClientReinstallJsonZhCN: bootstrap.localized.zhCN.oneLineClientInstallJsonCommand,
      oneCommandAgentReinstall: bootstrap.oneLineAutoInstallCommand,
      oneCommandAgentReinstallZhCN: bootstrap.localized.zhCN.oneLineAutoInstallCommand,
      oneCommandPriorityAgentReinstall: bootstrap.oneLinePriorityInstallCommand,
      oneCommandPriorityAgentReinstallZhCN: bootstrap.localized.zhCN.oneLinePriorityInstallCommand,
      priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS]
    },
    bootstrap: {
      scriptName: bootstrap.scriptName,
      sha256: bootstrap.sha256,
      githubLatestUrl: bootstrap.githubLatestUrl,
      command: bootstrap.oneLineCommand,
      uninstallScriptName: bootstrap.uninstallScriptName,
      uninstallSha256: bootstrap.uninstallSha256,
      uninstallGithubLatestUrl: bootstrap.githubLatestUninstallUrl,
      uninstallCommand: bootstrap.oneLineUninstallCommand,
      localized: {
        zhCN: {
          scriptName: bootstrap.localized.zhCN.scriptName,
          sha256: bootstrap.localized.zhCN.sha256,
          githubLatestUrl: bootstrap.localized.zhCN.githubLatestUrl,
          command: bootstrap.localized.zhCN.oneLineCommand,
          uninstallScriptName: bootstrap.localized.zhCN.uninstallScriptName,
          uninstallSha256: bootstrap.localized.zhCN.uninstallSha256,
          uninstallGithubLatestUrl: bootstrap.localized.zhCN.githubLatestUninstallUrl,
          uninstallCommand: bootstrap.localized.zhCN.oneLineUninstallCommand
        }
      },
      strategy: "installed-node-source-tarball-with-portable-runtime-fallback",
      preferredDownload: tarballName,
      fallbackDownload,
      sourceSizeBytes: sizeBytes,
      fallbackSizeBytes,
      installsTo: "~/.pact/mcp/connector",
      startsInteractiveInstaller: true,
      startsInteractiveUninstaller: true,
      supportsMultiSelect: true
    },
    publish: {
      npmCommand: `npm publish ${path.relative(projectRoot, tarballPath)} --access public --tag ${channel}`,
      releaseFiles: [
        tarballName,
        ...portables.map(p => p.archiveName),
        ...portables.map((p) => p.zipArchiveName).filter(Boolean),
        bootstrap.scriptName,
        bootstrap.uninstallScriptName,
        bootstrap.localized.zhCN.scriptName,
        bootstrap.localized.zhCN.uninstallScriptName,
        "pact-mcp-release.json",
        "latest.json"
      ]
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(String(args["output-dir"]));
  const channel = String(args.channel || "stable");
  const packageJson = await readJson(path.join(connectorRoot, "package.json"));
  assert.equal(packageJson.name, MCP_CONNECTOR_PACKAGE_NAME);
  assert.equal(packageJson.version, MCP_CONNECTOR_VERSION);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  const pack = await run("npm", ["pack", "--json", "--pack-destination", outputDir], {
    cwd: connectorRoot
  });
  const packResult = JSON.parse(pack.stdout || "[]")[0];
  if (!packResult?.filename) {
    throw new Error("npm pack did not return a tarball filename.");
  }
  const tarballPath = path.join(outputDir, packResult.filename);
  const stat = await fs.stat(tarballPath);
  const checksum = await sha256(tarballPath);
  const portables = [];
  const defaultTargets = ['darwin-arm64', 'linux-x64', 'linux-arm64', 'linux-x64-musl'];
  const targets = args.platforms ? String(args.platforms).split(',') : defaultTargets;
  const bundledVersion = await resolveBundledNodeVersion(args["node-version"] || args["lts-version"]);
  for (const target of targets) {
    portables.push(await createPortableBundle({
      outputDir,
      packageJson,
      target,
      bundledVersion
    }));
  }
  const bootstrap = await createBootstrapInstaller({
    outputDir,
    packageJson,
    tarballName: packResult.filename,
    tarballSha256: checksum,
    portables
  });
  const manifest = releaseManifest({
    channel,
    packageJson,
    tarballName: packResult.filename,
    tarballPath,
    checksum,
    sizeBytes: stat.size,
    portables,
    bootstrap
  });
  const manifestPath = path.join(outputDir, "pact-mcp-release.json");
  const latestPath = path.join(outputDir, "latest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(latestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const publishResult = args.publish
    ? await run("npm", ["publish", tarballPath, "--access", "public", "--tag", channel])
    : null;
  const result = {
    ok: true,
    outputDir,
    manifestPath,
    latestPath,
    bootstrapInstallerPath: bootstrap.scriptPath,
    tarballPath,
    portableTarballs: portables.map(p => p.archivePath),
    portableZips: portables.map(p => p.zipArchivePath).filter(Boolean),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    sha256: checksum,
    portableSha256: portables.map(p => p.sha256),
    portableZipSha256: portables.map((p) => p.zipSha256).filter(Boolean),
    bootstrapInstallerSha256: bootstrap.sha256,
    bootstrapUninstallerPath: bootstrap.uninstallScriptPath,
    bootstrapUninstallerSha256: bootstrap.uninstallSha256,
    bootstrapInstallerZhCNPath: bootstrap.localized.zhCN.scriptPath,
    bootstrapInstallerZhCNSha256: bootstrap.localized.zhCN.sha256,
    bootstrapUninstallerZhCNPath: bootstrap.localized.zhCN.uninstallScriptPath,
    bootstrapUninstallerZhCNSha256: bootstrap.localized.zhCN.uninstallSha256,
    githubOneLineCommand: bootstrap.oneLineCommand,
    githubOneLineClientInstallJsonCommand: bootstrap.oneLineClientInstallJsonCommand,
    githubOneLineUninstallCommand: bootstrap.oneLineUninstallCommand,
    githubOneLineAutoInstallCommand: bootstrap.oneLineAutoInstallCommand,
    githubOneLinePriorityInstallCommand: bootstrap.oneLinePriorityInstallCommand,
    githubOneLineCommandZhCN: bootstrap.localized.zhCN.oneLineCommand,
    githubOneLineClientInstallJsonCommandZhCN: bootstrap.localized.zhCN.oneLineClientInstallJsonCommand,
    githubOneLineAutoInstallCommandZhCN: bootstrap.localized.zhCN.oneLineAutoInstallCommand,
    githubOneLinePriorityInstallCommandZhCN: bootstrap.localized.zhCN.oneLinePriorityInstallCommand,
    githubOneLineUninstallCommandZhCN: bootstrap.localized.zhCN.oneLineUninstallCommand,
    oneCommandInstall: bootstrap.oneLineCommand,
    oneCommandInstallZhCN: bootstrap.localized.zhCN.oneLineCommand,
    oneCommandClientInstallJson: bootstrap.oneLineClientInstallJsonCommand,
    oneCommandClientInstallJsonZhCN: bootstrap.localized.zhCN.oneLineClientInstallJsonCommand,
    oneCommandAutoInstall: bootstrap.oneLineAutoInstallCommand,
    oneCommandAutoInstallZhCN: bootstrap.localized.zhCN.oneLineAutoInstallCommand,
    oneCommandPriorityInstall: bootstrap.oneLinePriorityInstallCommand,
    oneCommandPriorityInstallZhCN: bootstrap.localized.zhCN.oneLinePriorityInstallCommand,
    oneCommandUninstall: bootstrap.oneLineUninstallCommand,
    oneCommandUninstallZhCN: bootstrap.localized.zhCN.oneLineUninstallCommand,
    publishCommand: manifest.publish.npmCommand,
    installCommand: manifest.install.registryCommand,
    published: Boolean(publishResult),
    publishOutput: publishResult?.stdout?.trim() || ""
  };
  console.log(args.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
