#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serverDataDir = path.resolve(ServerConfig.getDataDir());
const runtimeDependencyCacheRoot = path.resolve(
  String(process.env.PACT_RUNTIME_DEPENDENCY_CACHE_DIR || "").trim() ||
    path.join(serverDataDir, "runtime", "runtime-dependencies")
);

const DEFAULT_VERSION = "3.14.0";
const DEFAULT_ROOT = path.join(runtimeDependencyCacheRoot, "gerrit");
const DEFAULT_HTTP_PORT = 18080;
const DEFAULT_SSH_PORT = 29418;
const DEFAULT_CONTAINER = "pact-local-gerrit";
const DEFAULT_DOCKER_IMAGE = "gerritcodereview/gerrit";
const DEFAULT_WAIT_MS = 180000;
const EXPECTED_WAR_MD5 = {
  "3.14.0": "1c8b0c204eb4844202f3bec7418179bc"
};

function defaultWarUrls(selectedVersion) {
  return [
    `https://repo1.maven.org/maven2/com/google/gerrit/gerrit-war/${selectedVersion}/gerrit-war-${selectedVersion}.war`,
    `https://gerrit-releases.storage.googleapis.com/gerrit-${selectedVersion}.war`
  ];
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "status";
const version = String(args.version || process.env.PACT_GERRIT_VERSION || DEFAULT_VERSION);
const root = path.resolve(String(args.root || process.env.PACT_GERRIT_ROOT || DEFAULT_ROOT));
const httpPort = Number(args["http-port"] || process.env.PACT_GERRIT_HTTP_PORT || DEFAULT_HTTP_PORT);
const sshPort = Number(args["ssh-port"] || process.env.PACT_GERRIT_SSH_PORT || DEFAULT_SSH_PORT);
const containerName = String(args.container || process.env.PACT_GERRIT_CONTAINER || DEFAULT_CONTAINER);
const dockerImage = String(args.image || process.env.PACT_GERRIT_IMAGE || `${DEFAULT_DOCKER_IMAGE}:${version}`);
const warUrl = String(
  args["war-url"] ||
    process.env.PACT_GERRIT_WAR_URL ||
    defaultWarUrls(version)[0]
);
const warUrls = args["war-url"] || process.env.PACT_GERRIT_WAR_URL ? [warUrl] : defaultWarUrls(version);

function usage() {
  console.log(`Usage:
  node server/scripts/gerrit-local.mjs <command> [options]

Commands:
  doctor       Show local Java/Docker availability.
  download     Download the Gerrit WAR into the server runtime dependency cache.
  start        Start local Gerrit. Auto-selects Java WAR if Java exists, Docker otherwise.
  stop         Stop the local Gerrit process/container.
  status       Print local Gerrit status.
  smoke        Verify HTTP and SSH ports respond.

Options:
  --runner <auto|war|docker>   Start runner. Default: auto.
  --version <version>          Gerrit version. Default: ${DEFAULT_VERSION}.
  --root <path>                Local state root. Default: ${DEFAULT_ROOT}.
  --http-port <n>              Host HTTP port. Default: ${DEFAULT_HTTP_PORT}.
  --ssh-port <n>               Host SSH port. Default: ${DEFAULT_SSH_PORT}.
  --container <name>           Docker container name. Default: ${DEFAULT_CONTAINER}.
  --image <ref>                Docker image. Default: ${DEFAULT_DOCKER_IMAGE}:<version>.
  --war-url <url>              Gerrit WAR URL.
  --wait-ms <n>                Startup wait timeout. Default: ${DEFAULT_WAIT_MS}.
`);
}

function run(commandName, commandArgs = [], options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${commandName} ${commandArgs.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result;
}

function commandAvailable(name, probeArgs = ["--version"]) {
  const result = run(name, probeArgs, { allowFailure: true });
  return result.status === 0;
}

function executableName(baseName) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function executableExists(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readConfiguredJavaPath() {
  if (process.env.PACT_JAVA_BIN_PATH && process.env.PACT_JAVA_BIN_PATH.trim()) {
    return process.env.PACT_JAVA_BIN_PATH.trim();
  }
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(serverDataDir, "settings.json"), "utf8"));
    return String(settings?.javaBinPath || "").trim();
  } catch {
    return "";
  }
}

function localJavaCandidates() {
  const platformKey = `${process.platform}-${process.arch}`;
  const javaName = executableName("java");
  return [
    readConfiguredJavaPath(),
    path.join(
      repoRoot,
      "server",
      "platform",
      "modules",
      "knowledge",
      "runtime",
      "jre",
      platformKey,
      "bin",
      javaName
    ),
    path.join(
      repoRoot,
      "server",
      "platform",
      "modules",
      "knowledge",
      "runtime",
      "jre",
      platformKey,
      "Contents",
      "Home",
      "bin",
      javaName
    ),
    path.join(repoRoot, "server", "modules", "jre", platformKey, "bin", javaName),
    path.join(repoRoot, "server", "modules", "jre", platformKey, "Contents", "Home", "bin", javaName)
  ].filter(Boolean);
}

function javaCommand() {
  return localJavaCandidates().find(executableExists) || "java";
}

function javaAvailable() {
  return commandAvailable(javaCommand(), ["-version"]);
}

function dockerAvailable() {
  return commandAvailable("docker", ["version"]);
}

function warPath() {
  return path.join(root, "downloads", `gerrit-${version}.war`);
}

function pidPath() {
  return path.join(root, "gerrit.pid");
}

function sitePath() {
  return path.join(root, "site");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mkdirp(directory) {
  await fsp.mkdir(directory, { recursive: true });
}

async function fileMd5(targetPath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const input = fs.createReadStream(targetPath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
    input.on("error", reject);
  });
}

async function verifyWarFile(targetPath) {
  const expectedMd5 = EXPECTED_WAR_MD5[version];
  if (!expectedMd5) {
    return;
  }
  const actualMd5 = await fileMd5(targetPath);
  if (actualMd5 !== expectedMd5) {
    throw new Error(`WAR checksum mismatch: expected ${expectedMd5}, got ${actualMd5}`);
  }
}

async function downloadToFile(url, destination) {
  await mkdirp(path.dirname(destination));
  const tempDestination = `${destination}.download`;
  await fsp.rm(tempDestination, { force: true });
  run("curl", ["-L", "--fail", "--retry", "3", "--connect-timeout", "20", "-o", tempDestination, url], {
    stdio: "inherit"
  });
  await verifyWarFile(tempDestination);
  await fsp.rename(tempDestination, destination);
}

async function ensureWar() {
  const destination = warPath();
  try {
    const stats = await fsp.stat(destination);
    if (stats.size > 0) {
      try {
        await verifyWarFile(destination);
      } catch (error) {
        console.warn(`[gerrit] Cached WAR is invalid: ${error.message}`);
        await fsp.rename(destination, `${destination}.invalid-${Date.now()}`);
        console.warn("[gerrit] Redownloading Gerrit WAR.");
      }
      if (fs.existsSync(destination)) {
        console.log(`[gerrit] Using cached WAR: ${destination}`);
        return destination;
      }
    }
  } catch {
    // Download below.
  }
  let lastError = null;
  for (const url of warUrls) {
    try {
      console.log(`[gerrit] Downloading ${url}`);
      await downloadToFile(url, destination);
      console.log(`[gerrit] Downloaded WAR: ${destination}`);
      return destination;
    } catch (error) {
      lastError = error;
      await fsp.rm(`${destination}.download`, { force: true });
      console.warn(`[gerrit] Download failed from ${url}: ${error.message}`);
    }
  }
  throw lastError || new Error("Unable to download Gerrit WAR.");
  return destination;
}

function configureSite(configPath) {
  run("git", ["config", "-f", configPath, "gerrit.canonicalWebUrl", `http://localhost:${httpPort}/`]);
  run("git", ["config", "-f", configPath, "httpd.listenUrl", `http://127.0.0.1:${httpPort}/`]);
  run("git", ["config", "-f", configPath, "sshd.listenAddress", `*: ${sshPort}`.replace(": ", ":")]);
  run("git", ["config", "-f", configPath, "auth.type", "DEVELOPMENT_BECOME_ANY_ACCOUNT"]);
}

async function ensureWarSite() {
  const destination = await ensureWar();
  const site = sitePath();
  const configPath = path.join(site, "etc", "gerrit.config");
  if (!fs.existsSync(configPath)) {
    console.log(`[gerrit] Initializing Gerrit site: ${site}`);
    run(javaCommand(), ["-jar", destination, "init", "--batch", "--dev", "--no-auto-start", "-d", site], {
      stdio: "inherit"
    });
  }
  configureSite(configPath);
  return { destination, site };
}

function readPid() {
  try {
    const value = fs.readFileSync(pidPath(), "utf8").trim();
    return value ? Number(value) : 0;
  } catch {
    return 0;
  }
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startWar() {
  if (!javaAvailable()) {
    throw new Error("Java runtime is not available. Install JRE 21+ or start with --runner docker.");
  }
  const pid = readPid();
  if (processAlive(pid)) {
    console.log(`[gerrit] WAR runner already running, pid=${pid}`);
    return;
  }
  const { destination, site } = await ensureWarSite();
  await mkdirp(path.join(root, "logs"));
  const out = fs.openSync(path.join(root, "logs", "gerrit-war.log"), "a");
  const child = spawn(javaCommand(), ["-jar", destination, "daemon", "-d", site, "--console-log"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, out]
  });
  child.unref();
  await fsp.writeFile(pidPath(), `${child.pid}\n`, "utf8");
  console.log(`[gerrit] Started WAR runner pid=${child.pid}`);
}

function dockerContainerStatus() {
  if (!dockerAvailable()) return "";
  const result = run("docker", [
    "ps",
    "-a",
    "--filter",
    `name=^/${containerName}$`,
    "--format",
    "{{.Status}}"
  ], { allowFailure: true });
  return String(result.stdout || "").trim();
}

async function startDocker() {
  if (!dockerAvailable()) {
    throw new Error("Docker is not available and Java runtime is also unavailable.");
  }
  await mkdirp(root);
  const status = dockerContainerStatus();
  if (status.startsWith("Up ")) {
    console.log(`[gerrit] Docker container already running: ${containerName}`);
    return;
  }
  if (status) {
    console.log(`[gerrit] Starting existing Docker container: ${containerName}`);
    run("docker", ["start", containerName], { stdio: "inherit" });
    return;
  }
  const dockerRoot = path.join(root, "docker");
  for (const name of ["git", "index", "cache", "db", "logs"]) {
    await mkdirp(path.join(dockerRoot, name));
  }
  console.log(`[gerrit] Pulling Docker image: ${dockerImage}`);
  run("docker", ["pull", dockerImage], { stdio: "inherit" });
  console.log(`[gerrit] Creating Docker container: ${containerName}`);
  run("docker", [
    "run",
    "--name",
    containerName,
    "--detach",
    "-p",
    `127.0.0.1:${httpPort}:8080`,
    "-p",
    `127.0.0.1:${sshPort}:29418`,
    "-e",
    `CANONICAL_WEB_URL=http://localhost:${httpPort}/`,
    "-e",
    "HTTPD_LISTEN_URL=http://*:8080/",
    "-v",
    `${path.join(dockerRoot, "git")}:/var/gerrit/git`,
    "-v",
    `${path.join(dockerRoot, "index")}:/var/gerrit/index`,
    "-v",
    `${path.join(dockerRoot, "cache")}:/var/gerrit/cache`,
    "-v",
    `${path.join(dockerRoot, "db")}:/var/gerrit/db`,
    "-v",
    `${path.join(dockerRoot, "logs")}:/var/gerrit/logs`,
    dockerImage
  ], { stdio: "inherit" });
}

function stopWar() {
  const pid = readPid();
  if (!processAlive(pid)) {
    return false;
  }
  process.kill(pid, "SIGTERM");
  console.log(`[gerrit] Stopped WAR runner pid=${pid}`);
  return true;
}

function stopDocker() {
  if (!dockerAvailable()) return false;
  const status = dockerContainerStatus();
  if (!status.startsWith("Up ")) {
    return false;
  }
  run("docker", ["stop", containerName], { stdio: "inherit" });
  return true;
}

async function waitForHttp(timeoutMs) {
  const endpoint = `http://127.0.0.1:${httpPort}/`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return response.status;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Gerrit HTTP did not become ready at ${endpoint}: ${lastError?.message || "timeout"}`);
}

async function waitForTcp(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        socket.setTimeout(1500);
        socket.on("connect", () => {
          socket.end();
          resolve();
        });
        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error("timeout"));
        });
        socket.on("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`Gerrit SSH did not become ready at ${host}:${port}: ${lastError?.message || "timeout"}`);
}

async function smoke() {
  const timeoutMs = Number(args["wait-ms"] || DEFAULT_WAIT_MS);
  const httpStatus = await waitForHttp(timeoutMs);
  await waitForTcp("127.0.0.1", sshPort, Math.min(timeoutMs, 60000));
  console.log(`[gerrit] Smoke passed: http://localhost:${httpPort}/ HTTP ${httpStatus}, ssh://localhost:${sshPort}`);
}

function printStatus() {
  const pid = readPid();
  const dockerStatus = dockerContainerStatus();
  const javaStatus = pid ? (processAlive(pid) ? `running pid=${pid}` : `stale pid=${pid}`) : "not started";
  console.log(JSON.stringify({
    version,
    root,
    war: warPath(),
    url: `http://localhost:${httpPort}/`,
    ssh: `ssh://localhost:${sshPort}`,
    java: javaStatus,
    javaBinPath: javaAvailable() ? javaCommand() : "",
    docker: dockerStatus || "not created",
    container: containerName,
    image: dockerImage
  }, null, 2));
}

async function main() {
  if (command === "help" || args.help) {
    usage();
    return;
  }
  if (command === "doctor") {
    console.log(JSON.stringify({
      java: javaAvailable(),
      javaBinPath: javaAvailable() ? javaCommand() : "",
      docker: dockerAvailable(),
      version,
      root,
      warUrl,
      warUrls,
      dockerImage
    }, null, 2));
    return;
  }
  if (command === "download") {
    await ensureWar();
    return;
  }
  if (command === "start") {
    const runner = String(args.runner || process.env.PACT_GERRIT_RUNNER || "auto");
    await ensureWar();
    if (runner === "war" || (runner === "auto" && javaAvailable())) {
      await startWar();
    } else if (runner === "docker" || runner === "auto") {
      await startDocker();
    } else {
      throw new Error(`Unknown runner: ${runner}`);
    }
    await smoke();
    return;
  }
  if (command === "stop") {
    const stopped = stopWar() || stopDocker();
    if (!stopped) {
      console.log("[gerrit] No local Gerrit runner was active.");
    }
    return;
  }
  if (command === "smoke") {
    await smoke();
    return;
  }
  if (command === "status") {
    printStatus();
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`[gerrit] ${error.message}`);
  process.exit(1);
});
