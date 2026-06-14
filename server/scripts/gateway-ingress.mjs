#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DIRECT_BASE_URL,
  DEFAULT_GATEWAY_ADAPTER,
  DEFAULT_GATEWAY_BASE_URL,
  getDefaultGatewayRuntimeCacheRoot,
  listGatewayAdapters,
  normalizeGatewayIngressProfile,
  renderGatewayConfig,
  resolveGatewayRuntimePlan,
  validateGatewayIngressPlan
} from "../platform/specialized/capabilities/agent-ingress/traffic-gateway/index.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function parseArgs(argv = []) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const keyValue = item.slice(2);
    const equalIndex = keyValue.indexOf("=");
    const key = equalIndex >= 0 ? keyValue.slice(0, equalIndex) : keyValue;
    const inlineValue = equalIndex >= 0 ? keyValue.slice(equalIndex + 1) : null;
    const next = argv[index + 1];
    if (inlineValue !== null) {
      args[key] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function printUsageAndExit(code = 0) {
  console.log(`Pact Agent Traffic Gateway

Usage:
  node server/scripts/gateway-ingress.mjs list
  node server/scripts/gateway-ingress.mjs plan [--gateway caddy|nginx]
  node server/scripts/gateway-ingress.mjs render --gateway caddy|nginx
  node server/scripts/gateway-ingress.mjs write --gateway caddy|nginx|all [--output DIR]
  node server/scripts/gateway-ingress.mjs switch --gateway caddy|nginx|direct
  node server/scripts/gateway-ingress.mjs runtime-plan --gateway caddy|nginx
  node server/scripts/gateway-ingress.mjs runtime-pull --gateway caddy|nginx [--runtime-url URL|--runtime-binary PATH]
  node server/scripts/gateway-ingress.mjs verify --gateway caddy|nginx

Options:
  --gateway             Gateway adapter. Default: ${DEFAULT_GATEWAY_ADAPTER}
  --direct-base-url     Direct Pact endpoint kept as required fallback. Default: ${DEFAULT_DIRECT_BASE_URL}
  --public-base-url     Gateway public endpoint. Default: ${DEFAULT_GATEWAY_BASE_URL}
  --upstream            Upstream Pact endpoints, comma-separated. Default: direct-base-url
  --listen-host         Gateway listen host. Default: public-base-url host
  --listen-port         Gateway listen port. Default: public-base-url port
  --server-name         Nginx server_name / Caddy host label. Default: public-base-url host
  --max-body-size       Upload/request limit passed to gateway config. Default: 512m
  --stream-timeout      SSE/MCP/upload read timeout. Default: 3600s
  --runtime-cache-dir   Local runtime cache root. Default: ${getDefaultGatewayRuntimeCacheRoot()}
  --runtime-binary      Existing gateway binary to copy into the local cache
  --runtime-url         Runtime artifact URL to pull into the local cache
  --output              Output directory. Default: runtime-cache-dir/configs
  --json                Print JSON for list/plan/verify
  --help                Show this message
`);
  process.exit(code);
}

function profileInputFromArgs(args = {}, gatewayOverride = "") {
  return {
    adapterId: gatewayOverride || args.gateway,
    directBaseUrl: args["direct-base-url"],
    publicBaseUrl: args["public-base-url"],
    upstream: args.upstream,
    maxBodySize: args["max-body-size"],
    streamTimeout: args["stream-timeout"],
    listen: {
      host: args["listen-host"],
      port: args["listen-port"],
      serverName: args["server-name"]
    }
  };
}

function defaultOutputRoot(args = {}) {
  return path.resolve(String(args.output || path.join(defaultRuntimeCacheRoot(args), "configs")));
}

function defaultRuntimeCacheRoot(args = {}) {
  return path.resolve(String(args["runtime-cache-dir"] || getDefaultGatewayRuntimeCacheRoot()));
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function writeGatewayArtifacts(args = {}, adapterId) {
  const rendered = renderGatewayConfig(profileInputFromArgs(args, adapterId));
  const root = path.join(defaultOutputRoot(args), rendered.adapterId);
  await fs.mkdir(root, { recursive: true });
  const configPath = path.join(root, rendered.fileName);
  const profilePath = path.join(root, "gateway-profile.json");
  const routeManifestPath = path.join(root, "route-manifest.json");
  await fs.writeFile(configPath, rendered.config, "utf8");
  await fs.writeFile(profilePath, `${JSON.stringify(rendered.profile, null, 2)}\n`, "utf8");
  await fs.writeFile(routeManifestPath, `${JSON.stringify(rendered.routeManifest, null, 2)}\n`, "utf8");
  return {
    adapterId: rendered.adapterId,
    configPath,
    profilePath,
    routeManifestPath
  };
}

async function writeActiveGatewayPointer(args = {}, adapterId) {
  const root = defaultOutputRoot(args);
  await fs.mkdir(root, { recursive: true });
  const profile = normalizeGatewayIngressProfile(profileInputFromArgs(args, adapterId));
  const activePath = path.join(root, "active-gateway.json");
  await fs.writeFile(
    activePath,
    `${JSON.stringify(
      {
        schemaVersion: "v0.0.1:schema:definition-1",
        activeAdapterId: profile.gatewayMode.adapterId,
        publicBaseUrl: profile.gatewayMode.publicBaseUrl,
        directBaseUrl: profile.directMode.baseUrl,
        configDir: path.join(root, profile.gatewayMode.adapterId),
        directModeRequired: true,
        gatewayCanBeRemoved: true
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return activePath;
}

async function writeDirectGatewayPointer(args = {}) {
  const root = defaultOutputRoot(args);
  await fs.mkdir(root, { recursive: true });
  const profile = normalizeGatewayIngressProfile(profileInputFromArgs(args, DEFAULT_GATEWAY_ADAPTER));
  const activePath = path.join(root, "active-gateway.json");
  await fs.writeFile(
    activePath,
    `${JSON.stringify(
      {
        schemaVersion: "v0.0.1:schema:definition-1",
        activeAdapterId: "direct",
        publicBaseUrl: profile.directMode.baseUrl,
        directBaseUrl: profile.directMode.baseUrl,
        configDir: null,
        directModeRequired: true,
        gatewayCanBeRemoved: true
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return activePath;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command) {
  const which = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(which, args, { encoding: "utf8", shell: process.platform !== "win32" });
  return result.status === 0 ? String(result.stdout || "").trim().split(/\r?\n/)[0] : "";
}

function privilegedCommand(command, args = []) {
  if (process.platform === "win32") {
    return { command, args };
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { command, args };
  }
  if (commandExists("sudo")) {
    return { command: "sudo", args: ["-n", command, ...args] };
  }
  return { command, args };
}

function nativeGatewayInstallPlans(adapterId) {
  if (process.env.PACT_DISABLE_NATIVE_RUNTIME_INSTALL === "1") {
    return [];
  }
  const packageName = adapterId === "nginx" ? "nginx" : "caddy";
  if (process.platform === "darwin") {
    return commandExists("brew")
      ? [{ label: `Homebrew ${packageName}`, command: "brew", args: ["install", packageName] }]
      : [];
  }
  if (process.platform === "linux") {
    const plans = [];
    if (commandExists("apt-get")) {
      plans.push({
        label: `apt ${packageName}`,
        commands: [
          privilegedCommand("apt-get", ["update"]),
          privilegedCommand("apt-get", ["install", "-y", "--no-install-recommends", packageName])
        ]
      });
    }
    if (commandExists("dnf")) {
      plans.push({ label: `dnf ${packageName}`, commands: [privilegedCommand("dnf", ["install", "-y", packageName])] });
    }
    if (commandExists("yum")) {
      plans.push({ label: `yum ${packageName}`, commands: [privilegedCommand("yum", ["install", "-y", packageName])] });
    }
    if (commandExists("apk")) {
      plans.push({ label: `apk ${packageName}`, commands: [privilegedCommand("apk", ["add", "--no-cache", packageName])] });
    }
    if (commandExists("pacman")) {
      plans.push({ label: `pacman ${packageName}`, commands: [privilegedCommand("pacman", ["-Sy", "--noconfirm", packageName])] });
    }
    if (commandExists("zypper")) {
      plans.push({ label: `zypper ${packageName}`, commands: [privilegedCommand("zypper", ["--non-interactive", "install", packageName])] });
    }
    return plans;
  }
  if (process.platform === "win32") {
    return [
      commandExists("winget")
        ? { label: `winget ${packageName}`, command: "winget", args: ["install", "--id", adapterId === "nginx" ? "Nginx.Nginx" : "CaddyServer.Caddy", "-e", "--accept-package-agreements", "--accept-source-agreements"] }
        : null,
      commandExists("choco")
        ? { label: `Chocolatey ${packageName}`, command: "choco", args: ["install", "-y", packageName] }
        : null,
      commandExists("scoop")
        ? { label: `Scoop ${packageName}`, command: "scoop", args: ["install", packageName] }
        : null
    ].filter(Boolean);
  }
  return [];
}

async function runInstallCommand(command, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function tryNativeGatewayInstall(adapterId) {
  const plans = nativeGatewayInstallPlans(adapterId);
  const failures = [];
  for (const plan of plans) {
    try {
      const commands = plan.commands || [{ command: plan.command, args: plan.args || [] }];
      for (const entry of commands) {
        await runInstallCommand(entry.command, entry.args || []);
      }
      const executable = commandExists(adapterId === "nginx" ? "nginx" : "caddy");
      if (executable) {
        return { ok: true, sourceType: "native-package-manager", executable, plan };
      }
      failures.push({ plan: plan.label, error: "installed but executable was not detected on PATH" });
    } catch (error) {
      failures.push({ plan: plan.label, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: false, failures };
}

async function downloadFile(url, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.download`;
  const maxAttempts = downloadRetryAttempts();
  let result = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const partialBytes = await fileSize(tempPath);
    console.log(
      partialBytes > 0
        ? `Auto-resuming gateway runtime download (${attempt}/${maxAttempts}, ${partialBytes} bytes): ${url}`
        : `Downloading gateway runtime (${attempt}/${maxAttempts}): ${url}`
    );
    const args = ["-L", "--fail", "--retry", "3", "--connect-timeout", "20"];
    if (partialBytes > 0) {
      args.push("-C", "-");
    }
    args.push("-o", tempPath, url);
    result = await runDownloadCommand("curl", args);
    if (result.status === 0) {
      break;
    }
    if (partialBytes > 0 && outputMentionsRangeUnsupported(result.output)) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      result = await runDownloadCommand("curl", ["-L", "--fail", "--retry", "3", "--connect-timeout", "20", "-o", tempPath, url]);
      if (result.status === 0) {
        break;
      }
    }
    if (attempt < maxAttempts) {
      const delayMs = downloadRetryDelayMs(attempt - 1);
      console.warn(`Gateway runtime download failed; auto-resuming in ${delayMs}ms with ${await fileSize(tempPath)} bytes preserved.`);
      await sleepMs(delayMs);
    }
  }
  if (!result || result.status !== 0) {
    throw new Error(`Gateway runtime download failed after ${maxAttempts} attempts: ${url}`);
  }
  await fs.rename(tempPath, targetPath);
}

async function runDownloadCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      resolve({ status: code ?? 0, output });
    });
  });
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

function outputMentionsRangeUnsupported(value = "") {
  return /cannot resume|does not seem to support byte ranges|range/i.test(String(value || ""));
}

async function executableExists(targetPath) {
  try {
    await fs.access(targetPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function looksLikeArchive(filePath = "") {
  return /\.(zip|tar|tgz|tar\.gz|tar\.xz|txz)$/i.test(filePath);
}

async function findExecutable(root, executableName) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findExecutable(candidate, executableName);
      if (nested) return nested;
      continue;
    }
    if (entry.name === executableName && await executableExists(candidate)) {
      return candidate;
    }
  }
  return "";
}

async function extractRuntimeArtifact(artifactPath, targetRoot) {
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  if (/\.zip$/i.test(artifactPath)) {
    await runInstallCommand(process.platform === "win32" ? "tar.exe" : "unzip", process.platform === "win32"
      ? ["-xf", artifactPath, "-C", targetRoot]
      : ["-q", artifactPath, "-d", targetRoot]);
    return;
  }
  if (/\.(tar\.gz|tgz)$/i.test(artifactPath)) {
    await runInstallCommand(process.platform === "win32" ? "tar.exe" : "tar", ["-xzf", artifactPath, "-C", targetRoot]);
    return;
  }
  if (/\.(tar\.xz|txz)$/i.test(artifactPath)) {
    await runInstallCommand(process.platform === "win32" ? "tar.exe" : "tar", ["-xJf", artifactPath, "-C", targetRoot]);
  }
}

async function installGatewayRuntime(args = {}) {
  const plan = resolveGatewayRuntimePlan({
    adapterId: args.gateway,
    cacheRoot: defaultRuntimeCacheRoot(args),
    runtimeBinary: args["runtime-binary"],
    runtimeUrl: args["runtime-url"],
    platform: args.platform
  });
  await fs.mkdir(plan.binDir, { recursive: true });

  let source = "";
  let sourceType = "";
  if (plan.configuredBinary) {
    source = plan.configuredBinary;
    sourceType = "configured-binary";
  } else if (await fileExists(plan.cachedExecutablePath)) {
    return {
      ...plan,
      sourceType: "local-cache",
      executablePath: plan.cachedExecutablePath,
      installed: false
    };
  } else {
    const systemBinary = commandExists(plan.executableName);
    if (systemBinary) {
      source = systemBinary;
      sourceType = "path";
    }
  }

  if (source) {
    await fs.copyFile(source, plan.cachedExecutablePath);
    await fs.chmod(plan.cachedExecutablePath, 0o755).catch(() => {});
    return {
      ...plan,
      sourceType,
      executablePath: plan.cachedExecutablePath,
      installed: true
    };
  }

  const nativeInstall = await tryNativeGatewayInstall(plan.adapterId);
  if (nativeInstall.ok) {
    await fs.copyFile(nativeInstall.executable, plan.cachedExecutablePath);
    await fs.chmod(plan.cachedExecutablePath, 0o755).catch(() => {});
    return {
      ...plan,
      sourceType: nativeInstall.sourceType,
      nativePlan: nativeInstall.plan?.label || "",
      executablePath: plan.cachedExecutablePath,
      installed: true
    };
  }

  if (plan.runtimeUrl) {
    const archivePath = path.join(plan.runtimeRoot, "downloads", path.basename(new URL(plan.runtimeUrl).pathname) || `${plan.adapterId}-runtime`);
    await downloadFile(plan.runtimeUrl, archivePath);
    await fs.chmod(archivePath, 0o755).catch(() => {});
    if (!looksLikeArchive(archivePath)) {
      await fs.copyFile(archivePath, plan.cachedExecutablePath);
      await fs.chmod(plan.cachedExecutablePath, 0o755).catch(() => {});
      return {
        ...plan,
        sourceType: "runtime-url-executable",
        artifactPath: archivePath,
        executablePath: plan.cachedExecutablePath,
        installed: true
      };
    }
    const extractedRoot = path.join(plan.runtimeRoot, "extracted");
    await extractRuntimeArtifact(archivePath, extractedRoot);
    const extractedExecutable = await findExecutable(extractedRoot, plan.executableName);
    if (extractedExecutable) {
      await fs.copyFile(extractedExecutable, plan.cachedExecutablePath);
      await fs.chmod(plan.cachedExecutablePath, 0o755).catch(() => {});
      return {
        ...plan,
        sourceType: "runtime-url-archive",
        artifactPath: archivePath,
        executablePath: plan.cachedExecutablePath,
        installed: true
      };
    }
    return {
      ...plan,
      sourceType: "runtime-url",
      artifactPath: archivePath,
      executablePath: "",
      installed: true,
      nativeInstallFailures: nativeInstall.failures || [],
      note: "Runtime artifact was cached but no executable was found. Use a platform package manager or pass --runtime-binary for executable installation."
    };
  }

  return {
    ...plan,
    sourceType: "missing",
    executablePath: "",
    installed: false,
    nativeInstallFailures: nativeInstall.failures || [],
    note: "No configured binary, cached runtime, PATH binary, or runtime URL was available."
  };
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "plan";

if (args.help || command === "help") {
  printUsageAndExit(0);
}

if (command === "list") {
  const adapters = listGatewayAdapters();
  if (args.json) {
    printJson({ adapters });
  } else {
    for (const adapter of adapters) {
      console.log(`${adapter.adapterId}\t${adapter.fileName}`);
    }
  }
  process.exit(0);
}

if (command === "plan") {
  const profile = normalizeGatewayIngressProfile(profileInputFromArgs(args));
  printJson(profile);
  process.exit(0);
}

if (command === "runtime-plan") {
  const plan = resolveGatewayRuntimePlan({
    adapterId: args.gateway,
    cacheRoot: defaultRuntimeCacheRoot(args),
    runtimeBinary: args["runtime-binary"],
    runtimeUrl: args["runtime-url"],
    platform: args.platform
  });
  printJson({
    ...plan,
    cached: await fileExists(plan.cachedExecutablePath),
    pathBinary: commandExists(plan.executableName)
  });
  process.exit(0);
}

if (command === "runtime-pull") {
  const result = await installGatewayRuntime(args);
  printJson(result);
  process.exit(result.sourceType === "missing" ? 1 : 0);
}

if (command === "render") {
  const rendered = renderGatewayConfig(profileInputFromArgs(args));
  if (args.json) {
    printJson(rendered);
  } else {
    process.stdout.write(rendered.config);
  }
  process.exit(0);
}

if (command === "verify") {
  const report = validateGatewayIngressPlan(profileInputFromArgs(args));
  if (args.json) {
    printJson(report);
  } else if (report.ok) {
    console.log(`[gateway-ingress] ${report.adapterId} ok (${report.routeCount} routes)`);
  } else {
    console.error(report.failures.join("\n"));
  }
  process.exit(report.ok ? 0 : 1);
}

if (command === "write" || command === "switch") {
  const requestedGateway = String(args.gateway || DEFAULT_GATEWAY_ADAPTER).trim().toLowerCase();
  if (command === "switch" && requestedGateway === "direct") {
    const activePath = await writeDirectGatewayPointer(args);
    const report = {
      outputRoot: defaultOutputRoot(args),
      activePath,
      written: []
    };
    if (args.json) {
      printJson(report);
    } else {
      console.log(`Switched active gateway pointer to direct mode: ${activePath}`);
    }
    process.exit(0);
  }
  const adapters =
    requestedGateway === "all"
      ? listGatewayAdapters().map((adapter) => adapter.adapterId)
      : [requestedGateway];
  const written = [];
  for (const adapterId of adapters) {
    written.push(await writeGatewayArtifacts(args, adapterId));
  }
  const activeAdapterId = requestedGateway === "all" ? DEFAULT_GATEWAY_ADAPTER : requestedGateway;
  const activePath = await writeActiveGatewayPointer(args, activeAdapterId);
  const report = {
    outputRoot: defaultOutputRoot(args),
    activePath,
    written
  };
  if (args.json) {
    printJson(report);
  } else {
    console.log(`Wrote gateway ingress artifacts under ${report.outputRoot}`);
    console.log(`Active gateway pointer: ${activePath}`);
    for (const item of written) {
      console.log(`${item.adapterId}: ${path.relative(repoRoot, item.configPath)}`);
    }
  }
  process.exit(0);
}

console.error(`Unknown gateway-ingress command: ${command}`);
printUsageAndExit(1);
