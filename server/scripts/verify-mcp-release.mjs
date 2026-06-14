import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const pkgStr = await fs.readFile(path.join(projectRoot, "mcp-connector", "package.json"), "utf8");
const expectedVersion = JSON.parse(pkgStr).version;
const EXPECTED_SUPPORTED_TARGETS = Object.freeze([
  "openclaw",
  "claude-code",
  "codex",
  "antigravity",
  "opencode",
  "copilot",
  "kilo-code",
  "cursor",
  "hermes"
]);

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

async function removeTempDirWithRetry(dir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
      return;
    } catch (error) {
      if (attempt === 4 || !["ENOTEMPTY", "EBUSY", "EPERM"].includes(error?.code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function writeUnavailableToolBinaries(rootDir) {
  const binDir = path.join(rootDir, "unavailable-tools");
  const names = ["orb", "docker", "podman", "wsl"];
  await fs.mkdir(binDir, { recursive: true });
  const content = process.platform === "win32"
    ? "@echo off\r\nexit /b 127\r\n"
    : "#!/bin/sh\nexit 127\n";
  const tools = {};
  for (const name of names) {
    const filePath = path.join(binDir, process.platform === "win32" ? `${name}.cmd` : name);
    await fs.writeFile(filePath, content, "utf8");
    if (process.platform !== "win32") {
      await fs.chmod(filePath, 0o755);
    }
    tools[name] = filePath;
  }
  return Object.freeze(tools);
}

function assertResilientOneLineCommand(command) {
  assert.match(command, /\/bin\/sh -c/);
  assert.match(command, /curl -fL --retry 3 --connect-timeout 20 -sS/);
}

async function assertPublishedInstallDocsUseResilientCurl() {
  const connectorReadmePath = path.join(projectRoot, "mcp-connector", "README.md");
  const publishedInstallDocPaths = [
    path.join(projectRoot, "docs", "MCP_INSTALL.md"),
    path.join(projectRoot, "docs", "MCP_INSTALL.zh-CN.md"),
    path.join(projectRoot, "docs", "PROTOCOLS.md"),
    connectorReadmePath
  ];
  for (const filePath of publishedInstallDocPaths) {
    const text = await fs.readFile(filePath, "utf8");
    assert.doesNotMatch(text, /curl -fsSL/);
    assert.match(text, /curl -fL --retry 3 --connect-timeout 20 -sS/);
    assert.doesNotMatch(text, /install --target codex(?:\s|$)/);
    assert.doesNotMatch(text, /uninstall --target codex(?:\s|$)/);
  }
  const connectorReadme = await fs.readFile(connectorReadmePath, "utf8");
  assert.match(connectorReadme, /install --target auto --json/);
  assert.match(connectorReadme, /install --target <client> --json/);
  assert.match(connectorReadme, /--target claude-code,codex,openclaw --json/);
  assert.doesNotMatch(connectorReadme, /install --target codex(?:\s|$)/);
}

function resolveVerifyTargetPlatform() {
  if (process.platform === "darwin") {
    return "darwin-arm64";
  }
  if (process.platform === "win32") {
    return "windows-x64";
  }
  if (process.platform === "linux") {
    return "linux-x64";
  }
  throw new Error(`Unsupported platform for verify: ${process.platform}`);
}

function archiveInspectOrder(platform) {
  const normalized = String(platform || "");
  if (normalized.startsWith("linux")) {
    return ["tar.gz"];
  }
  if (normalized.startsWith("darwin")) {
    return ["tar.gz", "zip"];
  }
  return ["tar.gz", "zip"];
}

function resolvePortableArchivePaths(result, manifest) {
  const tarballPath = Array.isArray(result.portableTarballs)
    ? result.portableTarballs.find((entry) => path.basename(entry) === path.basename(manifest.portable.tarball))
    : null;
  const zipPath = Array.isArray(result.portableZips)
    ? result.portableZips.find((entry) => path.basename(entry) === path.basename(manifest.portable.zipArchive || ""))
    : null;

  const archives = [];
  if (tarballPath) {
    archives.push({
      type: "tar.gz",
      path: tarballPath,
      archive: manifest.portable.tarball,
      sha: manifest.portable.sha256,
      sizeBytes: manifest.portable.sizeBytes
    });
  }
  if (zipPath) {
    archives.push({
      type: "zip",
      path: zipPath,
      archive: manifest.portable.zipArchive,
      sha: manifest.portable.zipSha256,
      sizeBytes: manifest.portable.zipSizeBytes
    });
  }
  return archives;
}

function stripPortableArchiveSuffix(name) {
  return name
    .replace(/\.tar\.gz$/, "")
    .replace(/\.zip$/, "");
}

async function checkPortableArchiveContents(archivePath, type, portableName, extractDirBase) {
  const extractDir = path.join(tempDir, `${extractDirBase}-${type}`);
  await fs.mkdir(extractDir, { recursive: true });

  if (type === "zip") {
    await run("unzip", ["-q", archivePath, "-d", extractDir]);
  } else {
    await run("tar", ["-xzf", archivePath, "-C", extractDir]);
  }

  const rootName = stripPortableArchiveSuffix(portableName);
  const rootDir = path.join(extractDir, rootName);
  const portableExecutable = path.join(rootDir, "pact-mcp");
  const version = await run(portableExecutable, ["version", "--json"]);
  const payload = JSON.parse(version.stdout);
  assert.equal(payload.packageName, "pact-mcp-connector");
  assert.equal(payload.packageVersion, expectedVersion);
  assert.equal(await fs.access(path.join(rootDir, "install.command")).then(() => true), true);
  assert.equal(await fs.access(path.join(rootDir, "uninstall.command")).then(() => true), true);
  const readmeText = await fs.readFile(path.join(rootDir, "README.txt"), "utf8");
  assert.match(readmeText, /install --target auto --json/);
  assert.match(readmeText, /install --target <client> --json/);
  assert.match(readmeText, /install --target claude-code,codex,openclaw --json/);
  assert.doesNotMatch(readmeText, /install --target codex(?:\s|$)/);
  const portableReset = await run(portableExecutable, ["server-config", "--reset", "--json"], {
    env: {
      HOME: path.join(tempDir, `${extractDirBase}-home`)
    }
  });
  const resetPayload = JSON.parse(portableReset.stdout);
  assert.equal(resetPayload.ok, true);
  assert.equal(resetPayload.reset, true);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-mcp-release-"));
try {
  const unavailableTools = await writeUnavailableToolBinaries(tempDir);
  const verifyTargetPlatform = resolveVerifyTargetPlatform();
  const release = await run("node", [
    "server/scripts/mcp-release.mjs",
    "--output-dir",
    tempDir,
    "--platforms",
    verifyTargetPlatform,
    "--json"
  ]);
  const result = JSON.parse(release.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.packageName, "pact-mcp-connector");
  assert.equal(result.packageVersion, expectedVersion);

  const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
  const manifestText = JSON.stringify(manifest);
  assert.equal(manifest.packageType, "v0.0.1:mcp:connector-release-1");
  assert.equal(manifest.stableToolName, "pact.discovery");
  assert.doesNotMatch(manifestText, new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(Object.hasOwn(manifest.connector, "tarballPath"), false);
  assert.equal(Object.hasOwn(manifest.portable, "tarballPath"), false);
  assert.equal(Object.hasOwn(manifest.portable, "zipPath"), false);
  assert.equal(Object.hasOwn(manifest.bootstrap, "scriptPath"), false);
  assert.equal(manifest.sharedHub.clientPolicy, "discover-shared-hub-then-opt-in");
  assert.equal(manifest.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(manifest.sharedHub.sharedspace.referencePolicy, "use-public-workspace-ref");
  assert.equal(manifest.sharedHub.sharedspace.exchangeReceipt.schemaVersion, "v0.0.1:mcp:sharedspace-exchange-1");
  assert.ok(manifest.sharedHub.sharedspace.exchangeReceipt.locations.includes("structuredContent.exchange"));
  assert.ok(manifest.sharedHub.sharedspace.exchangeReceipt.fields.includes("outlet"));
  assert.ok(manifest.sharedHub.sharedspace.exchangeReceipt.fields.includes("referencePolicy"));
  assert.equal(manifest.sharedHub.sharedspace.exchangeReceipt.fields.includes("transferReceiptId"), false);
  assert.equal(manifest.sharedHub.sharedspace.exchangeReceipt.actions.includes("drive-file-uploaded"), false);
  assert.ok(manifest.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.file.write"));
  assert.equal(manifest.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.drive.file.upload"), false);
  assert.equal(manifest.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.drive.sync.apply"), false);
  const portablePlatform = manifest.portable.currentPlatform || verifyTargetPlatform;
  const archiveOrder = archiveInspectOrder(portablePlatform);
  const portableArchives = resolvePortableArchivePaths(result, manifest);
  const portableArchivesForPlatform = archiveOrder
    .map((type) => portableArchives.find((entry) => entry.type === type))
    .filter(Boolean);
  assert.ok(portableArchivesForPlatform.length > 0);
  assert.equal(manifest.connector.sha256, await sha256(result.tarballPath));
  assert.equal(manifest.portable.requiresInstalledNode, false);
  assert.equal(manifest.portable.includesNodeRuntime ?? true, true);
  if (portablePlatform.startsWith("linux")) {
    assert.equal(manifest.portable.preferredArchive, "tar.gz");
  } else {
    assert.ok(["tar.gz", "zip"].includes(manifest.portable.preferredArchive));
  }
  const tarArchive = portableArchives.find((entry) => entry.type === "tar.gz");
  const zipArchive = portableArchives.find((entry) => entry.type === "zip");
  if (tarArchive) {
    assert.equal(manifest.portable.sha256, await sha256(tarArchive.path));
  }
  if (zipArchive) {
    const zipSha = await sha256(zipArchive.path);
    assert.equal(manifest.portable.zipSha256, zipSha);
    const zipResultIndex = result.portableZips.findIndex((entry) => entry === zipArchive.path);
    if (zipResultIndex >= 0) {
      assert.equal(result.portableZipSha256[zipResultIndex], zipSha);
    }
  }
  assert.ok(manifest.install.registryCommand.includes("npx pact-mcp-connector@latest register"));
  assert.ok(manifest.install.githubOneLineCommand.includes("pact-mcp-install.sh"));
  assert.ok(manifest.install.githubOneLineCommandZhCN.includes("pact-mcp-install.zh-CN.sh"));
  assert.ok(manifest.install.githubOneLineClientInstallJsonCommand.includes("pact-mcp-install.sh"));
  assert.ok(manifest.install.githubOneLineClientInstallJsonCommand.includes("--target <client>"));
  assert.ok(manifest.install.githubOneLineClientInstallJsonCommand.includes("--json"));
  assert.ok(manifest.install.githubOneLineAutoInstallCommand.includes("pact-mcp-install.sh"));
  assert.ok(manifest.install.githubOneLineAutoInstallCommand.includes("--target auto"));
  assert.ok(manifest.install.githubOneLineAutoInstallCommand.includes("--json"));
  assert.ok(manifest.install.githubOneLinePriorityInstallCommand.includes("pact-mcp-install.sh"));
  assert.ok(manifest.install.githubOneLinePriorityInstallCommand.includes("--target claude-code,codex,openclaw"));
  assert.ok(manifest.install.githubOneLinePriorityInstallCommand.includes("--json"));
  assert.ok(manifest.install.githubOneLineClientInstallJsonCommandZhCN.includes("pact-mcp-install.zh-CN.sh"));
  assert.ok(manifest.install.githubOneLineClientInstallJsonCommandZhCN.includes("--target <client>"));
  assert.ok(manifest.install.githubOneLineClientInstallJsonCommandZhCN.includes("--json"));
  assert.ok(manifest.install.githubOneLineAutoInstallCommandZhCN.includes("pact-mcp-install.zh-CN.sh"));
  assert.ok(manifest.install.githubOneLineAutoInstallCommandZhCN.includes("--target auto"));
  assert.ok(manifest.install.githubOneLineAutoInstallCommandZhCN.includes("--json"));
  assert.ok(manifest.install.githubOneLinePriorityInstallCommandZhCN.includes("pact-mcp-install.zh-CN.sh"));
  assert.ok(manifest.install.githubOneLinePriorityInstallCommandZhCN.includes("--target claude-code,codex,openclaw"));
  assert.ok(manifest.install.githubOneLinePriorityInstallCommandZhCN.includes("--json"));
  assert.ok(manifest.install.githubOneLineUninstallCommand.includes("pact-mcp-uninstall.sh"));
  assert.ok(manifest.install.githubOneLineUninstallCommandZhCN.includes("pact-mcp-uninstall.zh-CN.sh"));
  assert.equal(manifest.install.oneCommandInstall, manifest.install.githubOneLineCommand);
  assert.equal(manifest.install.oneCommandInstallZhCN, manifest.install.githubOneLineCommandZhCN);
  assert.equal(manifest.install.oneCommandClientInstallJson, manifest.install.githubOneLineClientInstallJsonCommand);
  assert.equal(manifest.install.oneCommandClientInstallJsonZhCN, manifest.install.githubOneLineClientInstallJsonCommandZhCN);
  assert.equal(manifest.install.oneCommandAutoInstall, manifest.install.githubOneLineAutoInstallCommand);
  assert.equal(manifest.install.oneCommandAutoInstallZhCN, manifest.install.githubOneLineAutoInstallCommandZhCN);
  assert.equal(manifest.install.oneCommandPriorityInstall, manifest.install.githubOneLinePriorityInstallCommand);
  assert.equal(manifest.install.oneCommandPriorityInstallZhCN, manifest.install.githubOneLinePriorityInstallCommandZhCN);
  assert.equal(manifest.install.oneCommandUninstall, manifest.install.githubOneLineUninstallCommand);
  assert.equal(manifest.install.oneCommandUninstallZhCN, manifest.install.githubOneLineUninstallCommandZhCN);
  for (const command of [
    manifest.install.githubOneLineCommand,
    manifest.install.githubOneLineCommandZhCN,
    manifest.install.githubOneLineClientInstallJsonCommand,
    manifest.install.githubOneLineClientInstallJsonCommandZhCN,
    manifest.install.githubOneLineAutoInstallCommand,
    manifest.install.githubOneLineAutoInstallCommandZhCN,
    manifest.install.githubOneLinePriorityInstallCommand,
    manifest.install.githubOneLinePriorityInstallCommandZhCN,
    manifest.install.githubOneLineUninstallCommand,
    manifest.install.githubOneLineUninstallCommandZhCN
  ]) {
    assertResilientOneLineCommand(command);
  }
  assert.ok(manifest.install.portableCommand.includes("pact-mcp register"));
  assert.ok(manifest.install.interactiveInstallCommand.includes("pact-mcp-connector@latest install"));
  assert.ok(manifest.install.autoInstallCommand.includes("pact-mcp-connector@latest install --target auto"));
  assert.ok(manifest.install.autoInstallCommand.includes("--json"));
  assert.ok(manifest.install.priorityInstallCommand.includes("pact-mcp-connector@latest install --target claude-code,codex,openclaw"));
  assert.ok(manifest.install.priorityInstallCommand.includes("--json"));
  assert.deepEqual(manifest.install.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.ok(manifest.install.interactiveUninstallCommand.includes("pact-mcp-connector@latest uninstall"));
  assert.ok(manifest.install.clientInstallCommand.includes("--target <client>"));
  assert.ok(manifest.install.clientInstallJsonCommand.includes("--target <client>"));
  assert.ok(manifest.install.clientInstallJsonCommand.includes("--json"));
  assert.ok(manifest.portable.autoInstallCommand.includes("./pact-mcp install --target auto"));
  assert.ok(manifest.portable.autoInstallCommand.includes("--json"));
  assert.ok(manifest.portable.priorityInstallCommand.includes("./pact-mcp install --target claude-code,codex,openclaw"));
  assert.ok(manifest.portable.priorityInstallCommand.includes("--json"));
  assert.ok(manifest.portable.clientInstallJsonCommand.includes("./pact-mcp install --target <client>"));
  assert.ok(manifest.portable.clientInstallJsonCommand.includes("--json"));
  assert.deepEqual(manifest.portable.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.equal(Object.hasOwn(manifest.install, "bulkInstallCommand"), false);
  assert.ok(manifest.install.uninstallCommand.includes("npx pact-mcp-connector@latest uninstall"));
  assert.ok(manifest.install.discoverCommand.includes("pact-mcp-connector@latest discover-local"));
  assert.ok(manifest.install.discoverCommand.includes("--json"));
  assert.ok(manifest.install.scanCommand.includes("pact-mcp-connector@latest scan"));
  assert.deepEqual(manifest.install.supportedTargets, EXPECTED_SUPPORTED_TARGETS);
  const installTargetDetails = new Map(manifest.install.supportedTargetDetails.map((target) => [target.target, target]));
  assert.deepEqual([...installTargetDetails.keys()], EXPECTED_SUPPORTED_TARGETS);
  assert.equal(installTargetDetails.get("claude-code").label, "Claude Code");
  assert.equal(installTargetDetails.get("codex").installMode, "codex-release-plugin-and-mcp-cli");
  assert.equal(installTargetDetails.get("codex").priority, true);
  assert.equal(installTargetDetails.get("opencode").priority, true);
  assert.equal(installTargetDetails.get("cursor").installMode, "cursor-release-mcp-config");
  assert.deepEqual(installTargetDetails.get("hermes").locations, ["orbstack", "remote-linux"]);
  assert.deepEqual(manifest.portable.supportedTargetDetails, manifest.install.supportedTargetDetails);
  assert.equal(manifest.upgrade.listChanged, true);
  assert.equal(manifest.upgrade.notification, "notifications/tools/list_changed");
  assert.equal(manifest.upgrade.reinstallCommand, manifest.install.githubOneLineCommand);
  assert.equal(manifest.upgrade.reinstallCommandZhCN, manifest.install.githubOneLineCommandZhCN);
  assert.equal(manifest.upgrade.clientReinstallJsonCommand, manifest.install.githubOneLineClientInstallJsonCommand);
  assert.equal(manifest.upgrade.clientReinstallJsonCommandZhCN, manifest.install.githubOneLineClientInstallJsonCommandZhCN);
  assert.equal(manifest.upgrade.agentReinstallCommand, manifest.install.githubOneLineAutoInstallCommand);
  assert.equal(manifest.upgrade.agentReinstallCommandZhCN, manifest.install.githubOneLineAutoInstallCommandZhCN);
  assert.equal(manifest.upgrade.priorityAgentReinstallCommand, manifest.install.githubOneLinePriorityInstallCommand);
  assert.equal(manifest.upgrade.priorityAgentReinstallCommandZhCN, manifest.install.githubOneLinePriorityInstallCommandZhCN);
  assert.equal(manifest.upgrade.oneCommandReinstall, manifest.upgrade.reinstallCommand);
  assert.equal(manifest.upgrade.oneCommandReinstallZhCN, manifest.upgrade.reinstallCommandZhCN);
  assert.equal(manifest.upgrade.oneCommandClientReinstallJson, manifest.upgrade.clientReinstallJsonCommand);
  assert.equal(manifest.upgrade.oneCommandClientReinstallJsonZhCN, manifest.upgrade.clientReinstallJsonCommandZhCN);
  assert.equal(manifest.upgrade.oneCommandAgentReinstall, manifest.upgrade.agentReinstallCommand);
  assert.equal(manifest.upgrade.oneCommandAgentReinstallZhCN, manifest.upgrade.agentReinstallCommandZhCN);
  assert.equal(manifest.upgrade.oneCommandPriorityAgentReinstall, manifest.upgrade.priorityAgentReinstallCommand);
  assert.equal(manifest.upgrade.oneCommandPriorityAgentReinstallZhCN, manifest.upgrade.priorityAgentReinstallCommandZhCN);
  assert.deepEqual(manifest.upgrade.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.ok(manifest.upgrade.clientReinstallJsonCommand.includes("--target <client>"));
  assert.ok(manifest.upgrade.clientReinstallJsonCommand.includes("--json"));
  assert.equal(manifest.bootstrap.scriptName, "pact-mcp-install.sh");
  assert.equal(manifest.bootstrap.uninstallScriptName, "pact-mcp-uninstall.sh");
  assert.equal(manifest.bootstrap.localized.zhCN.scriptName, "pact-mcp-install.zh-CN.sh");
  assert.equal(manifest.bootstrap.localized.zhCN.uninstallScriptName, "pact-mcp-uninstall.zh-CN.sh");
  assert.equal(manifest.bootstrap.startsInteractiveInstaller, true);
  assert.equal(manifest.bootstrap.startsInteractiveUninstaller, true);
  assert.equal(manifest.bootstrap.supportsMultiSelect, true);
  assert.equal(manifest.bootstrap.strategy, "installed-node-source-tarball-with-portable-runtime-fallback");
  assert.equal(manifest.bootstrap.preferredDownload, path.basename(result.tarballPath));
  assert.ok(portableArchivesForPlatform.find((entry) => entry.type === manifest.portable.preferredArchive) || portableArchivesForPlatform[0]);
  const fallbackArchive = portableArchivesForPlatform.find((entry) => entry.type === manifest.portable.preferredArchive) || portableArchivesForPlatform[0];
  assert.equal(manifest.bootstrap.fallbackDownload, path.basename(fallbackArchive.path));
  assert.equal(manifest.bootstrap.sourceSizeBytes, manifest.connector.sizeBytes);
  assert.equal(manifest.bootstrap.fallbackSizeBytes, fallbackArchive.sizeBytes);
  assert.equal(manifest.bootstrap.sha256, await sha256(result.bootstrapInstallerPath));
  assert.equal(manifest.bootstrap.uninstallSha256, await sha256(result.bootstrapUninstallerPath));
  assert.equal(manifest.bootstrap.localized.zhCN.sha256, await sha256(result.bootstrapInstallerZhCNPath));
  assert.equal(manifest.bootstrap.localized.zhCN.uninstallSha256, await sha256(result.bootstrapUninstallerZhCNPath));
  assert.ok(manifest.publish.npmCommand.includes("npm publish"));
  assert.ok(manifest.publish.releaseFiles.includes("pact-mcp-install.sh"));
  assert.ok(manifest.publish.releaseFiles.includes("pact-mcp-uninstall.sh"));
  assert.ok(manifest.publish.releaseFiles.includes("pact-mcp-install.zh-CN.sh"));
  assert.ok(manifest.publish.releaseFiles.includes("pact-mcp-uninstall.zh-CN.sh"));
  assert.equal(result.bootstrapInstallerSha256, await sha256(result.bootstrapInstallerPath));
  assert.equal(result.bootstrapUninstallerSha256, await sha256(result.bootstrapUninstallerPath));
  assert.equal(result.bootstrapInstallerZhCNSha256, await sha256(result.bootstrapInstallerZhCNPath));
  assert.equal(result.bootstrapUninstallerZhCNSha256, await sha256(result.bootstrapUninstallerZhCNPath));
  assert.ok(result.githubOneLineCommand.includes("pact-mcp-install.sh"));
  assert.ok(result.githubOneLineClientInstallJsonCommand.includes("--target <client>"));
  assert.ok(result.githubOneLineClientInstallJsonCommand.includes("--json"));
  assert.ok(result.githubOneLineAutoInstallCommand.includes("--target auto"));
  assert.ok(result.githubOneLineAutoInstallCommand.includes("--json"));
  assert.ok(result.githubOneLinePriorityInstallCommand.includes("--target claude-code,codex,openclaw"));
  assert.ok(result.githubOneLinePriorityInstallCommand.includes("--json"));
  assert.ok(result.githubOneLineUninstallCommand.includes("pact-mcp-uninstall.sh"));
  assert.ok(result.githubOneLineCommandZhCN.includes("pact-mcp-install.zh-CN.sh"));
  assert.ok(result.githubOneLineClientInstallJsonCommandZhCN.includes("--target <client>"));
  assert.ok(result.githubOneLineClientInstallJsonCommandZhCN.includes("--json"));
  assert.ok(result.githubOneLineAutoInstallCommandZhCN.includes("--target auto"));
  assert.ok(result.githubOneLineAutoInstallCommandZhCN.includes("--json"));
  assert.ok(result.githubOneLinePriorityInstallCommandZhCN.includes("--target claude-code,codex,openclaw"));
  assert.ok(result.githubOneLinePriorityInstallCommandZhCN.includes("--json"));
  assert.ok(result.githubOneLineUninstallCommandZhCN.includes("pact-mcp-uninstall.zh-CN.sh"));
  assert.equal(result.oneCommandInstall, result.githubOneLineCommand);
  assert.equal(result.oneCommandInstallZhCN, result.githubOneLineCommandZhCN);
  assert.equal(result.oneCommandClientInstallJson, result.githubOneLineClientInstallJsonCommand);
  assert.equal(result.oneCommandClientInstallJsonZhCN, result.githubOneLineClientInstallJsonCommandZhCN);
  assert.equal(result.oneCommandAutoInstall, result.githubOneLineAutoInstallCommand);
  assert.equal(result.oneCommandAutoInstallZhCN, result.githubOneLineAutoInstallCommandZhCN);
  assert.equal(result.oneCommandPriorityInstall, result.githubOneLinePriorityInstallCommand);
  assert.equal(result.oneCommandPriorityInstallZhCN, result.githubOneLinePriorityInstallCommandZhCN);
  assert.equal(result.oneCommandUninstall, result.githubOneLineUninstallCommand);
  assert.equal(result.oneCommandUninstallZhCN, result.githubOneLineUninstallCommandZhCN);
  for (const command of [
    result.githubOneLineCommand,
    result.githubOneLineCommandZhCN,
    result.githubOneLineClientInstallJsonCommand,
    result.githubOneLineClientInstallJsonCommandZhCN,
    result.githubOneLineAutoInstallCommand,
    result.githubOneLineAutoInstallCommandZhCN,
    result.githubOneLinePriorityInstallCommand,
    result.githubOneLinePriorityInstallCommandZhCN,
    result.githubOneLineUninstallCommand,
    result.githubOneLineUninstallCommandZhCN
  ]) {
    assertResilientOneLineCommand(command);
  }
  await assertPublishedInstallDocsUseResilientCurl();
  await run("sh", ["-n", result.bootstrapInstallerPath]);
  await run("sh", ["-n", result.bootstrapUninstallerPath]);
  await run("sh", ["-n", result.bootstrapInstallerZhCNPath]);
  await run("sh", ["-n", result.bootstrapUninstallerZhCNPath]);
  const bootstrapScript = await fs.readFile(result.bootstrapInstallerPath, "utf8");
  const bootstrapUninstallScript = await fs.readFile(result.bootstrapUninstallerPath, "utf8");
  const bootstrapScriptZhCN = await fs.readFile(result.bootstrapInstallerZhCNPath, "utf8");
  const bootstrapUninstallScriptZhCN = await fs.readFile(result.bootstrapUninstallerZhCNPath, "utf8");
  assert.match(bootstrapScript, /curl -fL --retry 3/);
  assert.match(bootstrapScript, /node_is_usable/);
  assert.match(bootstrapScript, /install_from_source_tarball/);
  assert.match(bootstrapScript, /install_from_portable_archive/);
  assert.match(bootstrapScript, /SOURCE_TARBALL=/);
  assert.match(bootstrapScript, /archive_sha256=/);
  assert.doesNotMatch(bootstrapScript, /(?:https?:\/\/)?(?:127\.0\.0\.1|localhost):\d{1,5}\b/);
  assert.doesNotMatch(bootstrapScript, /register --url/);
  assert.doesNotMatch(bootstrapScript, /install --url/);
  assert.doesNotMatch(bootstrapScript, /register >\/dev\/null/);
  assert.match(bootstrapScript, /pact-mcp" install/);
  assert.match(bootstrapScript, /node "\$target_dir\/bin\/pact-mcp\.mjs" install/);
  assert.doesNotMatch(bootstrapUninstallScript, /(?:https?:\/\/)?(?:127\.0\.0\.1|localhost):\d{1,5}\b/);
  assert.match(bootstrapUninstallScript, /pact-mcp" uninstall/);
  assert.match(bootstrapUninstallScript, /node "\$target_dir\/bin\/pact-mcp\.mjs" uninstall/);
  assert.match(bootstrapUninstallScript, /client removal selector/);
  assert.match(bootstrapScriptZhCN, /正在下载 Pact MCP connector/);
  assert.match(bootstrapScriptZhCN, /正在打开 Pact MCP 客户端选择器/);
  assert.match(bootstrapScriptZhCN, /pact-mcp" install/);
  assert.match(bootstrapUninstallScriptZhCN, /正在打开 Pact MCP 客户端移除选择器/);
  assert.match(bootstrapUninstallScriptZhCN, /pact-mcp" uninstall/);

  const list = await run("tar", ["-tzf", result.tarballPath]);
  assert.match(list.stdout, /package\/bin\/pact-mcp\.mjs/);
  assert.match(list.stdout, /package\/package\.json/);
  assert.doesNotMatch(list.stdout, /package\/server\//);

  for (const portableArchive of portableArchivesForPlatform) {
    if (portableArchive.type === "zip") {
      const zipList = await run("unzip", ["-l", portableArchive.path]);
      assert.match(zipList.stdout, /pact-mcp$/m);
      assert.match(zipList.stdout, /runtime\/node/m);
      assert.match(zipList.stdout, /app\/bin\/pact-mcp\.mjs/m);
      assert.match(zipList.stdout, /install\.command/m);
      assert.match(zipList.stdout, /uninstall\.command/m);
      assert.doesNotMatch(zipList.stdout, /server\//);
      continue;
    }
    const portableList = await run("tar", ["-tzf", portableArchive.path]);
    assert.match(portableList.stdout, /pact-mcp$/m);
    assert.match(portableList.stdout, /runtime\/node/m);
    assert.match(portableList.stdout, /app\/bin\/pact-mcp\.mjs/m);
    assert.match(portableList.stdout, /install\.command/m);
    assert.match(portableList.stdout, /uninstall\.command/m);
    assert.doesNotMatch(portableList.stdout, /server\//);
  }

  const extractDir = path.join(tempDir, "extract");
  await fs.mkdir(extractDir, { recursive: true });
  await run("tar", ["-xzf", result.tarballPath, "-C", extractDir]);
  const version = await run("node", [path.join(extractDir, "package", "bin", "pact-mcp.mjs"), "version", "--json"]);
  const versionPayload = JSON.parse(version.stdout);
  assert.equal(versionPayload.packageName, "pact-mcp-connector");
  assert.equal(versionPayload.packageVersion, expectedVersion);
  assert.equal(versionPayload.stableToolName, "pact.discovery");
  const help = await run("node", [path.join(extractDir, "package", "bin", "pact-mcp.mjs"), "help"]);
  assert.match(help.stdout, /pact-mcp register/);
  assert.match(help.stdout, /pact-mcp install/);
  assert.match(help.stdout, /pact-mcp uninstall/);
  assert.match(help.stdout, /multi-select menu/);
  assert.match(help.stdout, /multi-select removal menu/);
  assert.match(help.stdout, /pact-mcp scan --json/);
  assert.match(help.stdout, /pact-mcp discover-local/);
  assert.match(help.stdout, /pact-mcp server-config --set/);
  assert.match(help.stdout, /--no-auto-token/);
  assert.match(help.stdout, /--docker-bin/);
  assert.match(help.stdout, /--podman-bin/);
  assert.match(help.stdout, /--wsl-bin/);
  assert.match(help.stdout, /--claude-bin/);
  assert.doesNotMatch(help.stdout, /\/home\/kate/);
  assert.doesNotMatch(help.stdout, /\/home\/serena/);
  const scan = await run("node", [
    path.join(extractDir, "package", "bin", "pact-mcp.mjs"),
    "scan",
    "--no-scan",
    "--url",
    "http://127.0.0.1:9",
    "--orb-bin",
    unavailableTools.orb,
    "--json"
  ], {
    env: {
      HOME: path.join(tempDir, "scan-home")
    }
  });
  const scanPayload = JSON.parse(scan.stdout);
  assert.equal(scanPayload.ok, true);
  assert.equal(scanPayload.candidates.some((candidate) => candidate.target === "codex"), true);
  assert.equal(scanPayload.candidates.some((candidate) => candidate.target === "claude-code"), true);
  assert.equal(scanPayload.serverDiscovery.ok, false);

  const uninstallHome = path.join(tempDir, "uninstall-home");
  const kiloConfigPath = path.join(uninstallHome, ".config", "kilo", "kilo.json");
  await fs.mkdir(path.dirname(kiloConfigPath), { recursive: true });
  await fs.writeFile(kiloConfigPath, JSON.stringify({
    mcp: {
      pact: { type: "remote", url: "http://example.invalid/mcp" },
      other: { type: "remote", url: "http://other.invalid/mcp" }
    }
  }, null, 2));
  const fixtureKilo = path.join(tempDir, "fixture-kilo");
  await fs.writeFile(fixtureKilo, [
    "#!/bin/sh",
    "if [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"list\" ]; then",
    "  printf 'other\\n'",
    "  exit 0",
    "fi",
    "exit 0",
    ""
  ].join("\n"), { mode: 0o755 });
  const uninstall = await run("node", [
    path.join(extractDir, "package", "bin", "pact-mcp.mjs"),
    "uninstall",
    "--target",
    "kilo-code",
    "--kilo-config",
    kiloConfigPath,
    "--kilo-bin",
    fixtureKilo,
    "--json"
  ], {
    env: {
      HOME: uninstallHome
    }
  });
  const uninstallPayload = JSON.parse(uninstall.stdout);
  assert.equal(uninstallPayload.ok, true);
  assert.equal(uninstallPayload.uninstalled["kilo-code"].status, "not-installed");
  const kiloConfig = JSON.parse(await fs.readFile(kiloConfigPath, "utf8"));
  assert.equal(Object.hasOwn(kiloConfig.mcp, "pact"), false);
  assert.equal(Object.hasOwn(kiloConfig.mcp, "other"), true);

  const layeredHome = path.join(tempDir, "layered-home");
  const fixtureNvmBin = path.join(layeredHome, ".nvm", "versions", "node", "v99.0.0", "bin");
  await fs.mkdir(fixtureNvmBin, { recursive: true });
  const fixtureClaude = path.join(fixtureNvmBin, "claude");
  await fs.writeFile(fixtureClaude, [
    "#!/bin/sh",
    "if [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"--help\" ]; then",
    "  printf 'Usage: claude mcp add add-json get list remove\\n'",
    "  exit 0",
    "fi",
    "exit 1",
    ""
  ].join("\n"), { mode: 0o755 });
  const fixtureVoltaBin = path.join(layeredHome, ".volta", "bin");
  const fixtureVoltaCopilot = path.join(fixtureVoltaBin, process.platform === "win32" ? "copilot.cmd" : "copilot");
  await fs.mkdir(fixtureVoltaBin, { recursive: true });
  if (process.platform === "win32") {
    await fs.writeFile(fixtureVoltaCopilot, [
      "@echo off",
      "echo Usage: copilot mcp add list remove",
      "exit /b 0",
      ""
    ].join("\r\n"));
  } else {
    await fs.writeFile(fixtureVoltaCopilot, [
      "#!/bin/sh",
      "if [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"--help\" ]; then",
      "  printf 'Usage: copilot mcp add list remove\\n'",
      "  exit 0",
      "fi",
      "exit 1",
      ""
    ].join("\n"), { mode: 0o755 });
  }
  const fixtureWorkspace = path.join(layeredHome, "workspace");
  const fixtureWorkspaceBin = path.join(fixtureWorkspace, "node_modules", ".bin");
  const fixtureLocalCodex = path.join(fixtureWorkspaceBin, process.platform === "win32" ? "codex.cmd" : "codex");
  await fs.mkdir(fixtureWorkspaceBin, { recursive: true });
  await fs.writeFile(path.join(fixtureWorkspace, "package.json"), JSON.stringify({ private: true }, null, 2));
  if (process.platform === "win32") {
    await fs.writeFile(fixtureLocalCodex, [
      "@echo off",
      "echo Usage: codex mcp add list remove",
      "exit /b 0",
      ""
    ].join("\r\n"));
  } else {
    await fs.writeFile(fixtureLocalCodex, [
      "#!/bin/sh",
      "if [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"--help\" ]; then",
      "  printf 'Usage: codex mcp add list remove\\n'",
      "  exit 0",
      "fi",
      "exit 1",
      ""
    ].join("\n"), { mode: 0o755 });
  }
  const packageManagerProbeBin = path.join(layeredHome, "package-manager-probe-bin");
  const packageManagerEnvProbe = path.join(layeredHome, "package-manager-env-probe.txt");
  if (process.platform !== "win32") {
    await fs.mkdir(packageManagerProbeBin, { recursive: true });
    await fs.writeFile(path.join(packageManagerProbeBin, "brew"), [
      "#!/bin/sh",
      "printf '%s|%s|%s|%s\\n' \"${HOMEBREW_NO_AUTO_UPDATE:-}\" \"${HOMEBREW_NO_ANALYTICS:-}\" \"${HOMEBREW_NO_ENV_HINTS:-}\" \"$*\" >> \"$PACT_MCP_BREW_ENV_PROBE\"",
      "if [ \"$1\" = \"--prefix\" ] && [ -z \"${2:-}\" ]; then",
      "  printf '%s\\n' \"$HOME/fixture-homebrew\"",
      "  exit 0",
      "fi",
      "exit 1",
      ""
    ].join("\n"), { mode: 0o755 });
  }
  const layeredScan = await run(process.execPath, [
    path.join(extractDir, "package", "bin", "pact-mcp.mjs"),
    "scan",
    "--url",
    "http://127.0.0.1:9",
    "--orb-bin",
    unavailableTools.orb,
    "--docker-bin",
    unavailableTools.docker,
    "--podman-bin",
    unavailableTools.podman,
    "--wsl-bin",
    unavailableTools.wsl,
    "--json"
  ], {
    env: {
      HOME: layeredHome,
      NVM_DIR: path.join(layeredHome, ".nvm"),
      VOLTA_HOME: path.join(layeredHome, ".volta"),
      PACT_MCP_BREW_ENV_PROBE: packageManagerEnvProbe,
      PATH: [fixtureWorkspaceBin, packageManagerProbeBin, "/usr/bin", "/bin"].filter(Boolean).join(path.delimiter)
    }
  });
  const layeredScanPayload = JSON.parse(layeredScan.stdout);
  assert.ok(["darwin", "linux", "win32"].includes(layeredScanPayload.hostOs));
  const layeredClaudeBins = layeredScanPayload.candidates
    .filter((candidate) => candidate.target === "claude-code")
    .map((candidate) => candidate.optionOverrides?.["claude-bin"] || "");
  const layeredCodexBins = layeredScanPayload.candidates
    .filter((candidate) => candidate.target === "codex")
    .map((candidate) => candidate.optionOverrides?.["codex-bin"] || "");
  const layeredCopilotBins = layeredScanPayload.candidates
    .filter((candidate) => candidate.target === "copilot")
    .map((candidate) => candidate.optionOverrides?.["copilot-bin"] || "");
  assert.equal(layeredClaudeBins.includes(fixtureClaude), true);
  assert.equal(layeredCodexBins.includes(fixtureLocalCodex), false);
  assert.equal(layeredCopilotBins.includes(fixtureVoltaCopilot), true);
  if (process.platform !== "win32") {
    const packageManagerEnvProbeText = await fs.readFile(packageManagerEnvProbe, "utf8");
    assert.match(
      packageManagerEnvProbeText,
      /1\|1\|1\|--prefix/,
      "local package manager scan must disable Homebrew auto-update, analytics, and env hints"
    );
    assert.doesNotMatch(
      packageManagerEnvProbeText,
      /1\|1\|1\|--prefix[ \t]+\S/,
      "local package manager scan must not run package-specific Homebrew prefix lookups"
    );
  }

  const fixtureOrb = path.join(tempDir, "fixture-orb");
  await fs.writeFile(fixtureOrb, [
    "#!/bin/sh",
    "if [ \"$1\" = \"list\" ]; then",
    "  printf 'NAME STATE\\n'",
    "  printf 'kate running\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"-m\" ]; then",
    "  vm=\"$2\"",
    "  user=\"$4\"",
    "  shift 4",
    "  if [ \"$1\" = \"bash\" ] && [ \"$2\" = \"-lc\" ]; then",
    "    if ! printf '%s' \"$3\" | grep -q \"HOMEBREW_NO_AUTO_UPDATE\"; then",
    "      exit 1",
    "    fi",
    "    if [ \"$vm\" = \"kate\" ] && [ \"$user\" = \"kate\" ] && printf '%s' \"$3\" | grep -q \"command_name='openclaw'\"; then",
    "      printf '/usr/bin/openclaw\\n'",
    "      exit 0",
    "    fi",
    "    if [ \"$vm\" = \"kate\" ] && [ \"$user\" = \"kate\" ] && printf '%s' \"$3\" | grep -q \"command_name='ironclaw'\"; then",
    "      printf '/usr/local/bin/ironclaw\\n'",
    "      exit 0",
    "    fi",
    "    if [ \"$vm\" = \"kate\" ] && [ \"$user\" = \"kate\" ] && printf '%s' \"$3\" | grep -q \"command_name='copilot'\"; then",
    "      printf '/usr/bin/copilot\\n'",
    "      exit 0",
    "    fi",
    "    exit 1",
    "  fi",
    "  if [ \"$vm\" = \"kate\" ] && [ \"$user\" = \"kate\" ] && [ \"$1\" = \"/usr/bin/openclaw\" ] && [ \"$2\" = \"mcp\" ]; then",
    "    printf 'openclaw mcp help\\n'",
    "    exit 0",
    "  fi",
    "  if [ \"$vm\" = \"kate\" ] && [ \"$user\" = \"kate\" ] && [ \"$1\" = \"/usr/local/bin/ironclaw\" ] && [ \"$2\" = \"mcp\" ]; then",
    "    printf 'ironclaw mcp help\\n'",
    "    exit 0",
    "  fi",
    "  if [ \"$vm\" = \"kate\" ] && [ \"$user\" = \"kate\" ] && [ \"$1\" = \"/usr/bin/copilot\" ] && [ \"$2\" = \"mcp\" ]; then",
    "    printf 'copilot mcp help\\n'",
    "    exit 0",
    "  fi",
    "fi",
    "exit 1",
    ""
  ].join("\n"), { mode: 0o755 });
  const clawScan = await run("node", [
    path.join(extractDir, "package", "bin", "pact-mcp.mjs"),
    "scan",
    "--url",
    "http://127.0.0.1:9",
    "--orb-bin",
    fixtureOrb,
    "--docker-bin",
    unavailableTools.docker,
    "--podman-bin",
    unavailableTools.podman,
    "--wsl-bin",
    unavailableTools.wsl,
    "--json"
  ], {
    env: {
      HOME: path.join(tempDir, "scan-home")
    }
  });
  const clawScanPayload = JSON.parse(clawScan.stdout);
  const openClawCandidates = clawScanPayload.candidates.filter((candidate) => candidate.target === "openclaw");
  assert.equal(openClawCandidates.length, 2);
  const openClawBins = openClawCandidates.map((candidate) => candidate.optionOverrides["openclaw-bin"]).sort();
  assert.deepEqual(openClawBins, ["/usr/bin/openclaw", "/usr/local/bin/ironclaw"]);
  for (const candidate of openClawCandidates) {
    assert.equal(candidate.status, "detected");
    assert.equal(candidate.label, "OpenClaw (kate)");
    assert.match(candidate.detail, /\/(usr\/bin\/openclaw|usr\/local\/bin\/ironclaw)/);
    assert.equal(candidate.optionOverrides["execution-location"], "orb");
    assert.equal(candidate.optionOverrides["orb-vm"], "kate");
    assert.equal(candidate.optionOverrides["orb-user"], "kate");
    assert.equal(candidate.optionOverrides["openclaw-vm"], "kate");
    assert.equal(candidate.optionOverrides["openclaw-user"], "kate");
  }
  const vmCopilot = clawScanPayload.candidates.find((candidate) =>
    candidate.target === "copilot" && candidate.optionOverrides?.["execution-location"] === "orb"
  );
  assert.equal(vmCopilot?.optionOverrides?.["copilot-bin"], "/usr/bin/copilot");
  assert.equal(vmCopilot?.optionOverrides?.["orb-vm"], "kate");
  assert.equal(vmCopilot?.optionOverrides?.["orb-user"], "kate");

  const fixtureDocker = path.join(tempDir, "fixture-docker");
  await fs.writeFile(fixtureDocker, [
    "#!/bin/sh",
    "if [ \"$1\" = \"ps\" ]; then",
    "  printf 'box123\\tagentbox\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"exec\" ]; then",
    "  if [ \"$2\" = \"box123\" ] && [ \"$3\" = \"sh\" ] && [ \"$4\" = \"-lc\" ]; then",
    "    if ! printf '%s' \"$5\" | grep -q \"HOMEBREW_NO_AUTO_UPDATE\"; then",
    "      exit 1",
    "    fi",
    "    if printf '%s' \"$5\" | grep -q \"command_name='copilot'\"; then",
    "      printf '/usr/local/bin/copilot\\n'",
    "      exit 0",
    "    fi",
    "    exit 0",
    "  fi",
    "  if [ \"$2\" = \"box123\" ] && [ \"$3\" = \"/usr/local/bin/copilot\" ] && [ \"$4\" = \"mcp\" ]; then",
    "    printf 'Usage: copilot mcp add list remove\\n'",
    "    exit 0",
    "  fi",
    "fi",
    "exit 1",
    ""
  ].join("\n"), { mode: 0o755 });
  const dockerScan = await run(process.execPath, [
    path.join(extractDir, "package", "bin", "pact-mcp.mjs"),
    "scan",
    "--url",
    "http://127.0.0.1:9",
    "--orb-bin",
    unavailableTools.orb,
    "--docker-bin",
    fixtureDocker,
    "--podman-bin",
    unavailableTools.podman,
    "--wsl-bin",
    unavailableTools.wsl,
    "--json"
  ], {
    env: {
      HOME: path.join(tempDir, "docker-scan-home")
    }
  });
  const dockerScanPayload = JSON.parse(dockerScan.stdout);
  const dockerCopilot = dockerScanPayload.candidates.find((candidate) =>
    candidate.target === "copilot" && candidate.optionOverrides?.["execution-location"] === "docker"
  );
  assert.equal(dockerCopilot?.optionOverrides?.["copilot-bin"], "/usr/local/bin/copilot");
  assert.equal(dockerCopilot?.optionOverrides?.["remote-id"], "box123");
  assert.equal(dockerCopilot?.optionOverrides?.["remote-name"], "agentbox");
  assert.equal(dockerCopilot?.optionOverrides?.["remote-bin"], fixtureDocker);

  for (const portableArchive of portableArchivesForPlatform) {
    await checkPortableArchiveContents(
      portableArchive.path,
      portableArchive.type,
      portableArchive.archive,
      portableArchive.type
    );
  }

  console.log("mcp-release verification passed");
} finally {
  await removeTempDirWithRetry(tempDir);
}
