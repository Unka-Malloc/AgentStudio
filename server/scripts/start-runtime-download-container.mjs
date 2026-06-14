#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadDeploymentIndex } from "./deployment-index.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const deploymentIndex = await loadDeploymentIndex({ cwd: repoRoot });
const runtimeDownloadPreset = deploymentIndex.runtimeDependencies?.service || {};

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    targets: [],
    env: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.includes("=")
      ? token.slice(2).split(/=(.*)/s, 2)
      : [token.slice(2), null];
    const key = rawKey.trim();
    const value = inlineValue !== null
      ? inlineValue
      : argv[index + 1] && !argv[index + 1].startsWith("--")
        ? argv[++index]
        : true;
    if (key === "target" || key === "targets") {
      args.targets.push(...splitTargets(value));
    } else if (key === "env") {
      args.env.push(String(value || ""));
    } else {
      args[key] = value;
    }
  }
  return args;
}

function splitTargets(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true) return true;
  if (value === false) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function numberValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      ...(options.env || {})
    },
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024
  });
  if (options.allowFailure) return result;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return result;
}

function docker(args = [], options = {}) {
  return run("docker", args, options);
}

function parseLastJsonLine(output = "") {
  const trimmed = String(output || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall back to scanning line-oriented command output.
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning older lines.
    }
  }
  throw new Error(`No JSON payload found in output: ${String(output || "").slice(-1000)}`);
}

async function writeServiceScript(filePath, { containerDataPath }) {
  await fs.writeFile(filePath, `import http from "node:http";
import { downloadRuntimeDependency, listRuntimeDependencies, listRuntimeDependencyDownloadRuns } from "/workspace/server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

const userDataPath = process.env.PACT_SERVER_DATA_DIR || ${JSON.stringify(containerDataPath)};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && (request.url === "/healthz" || request.url === "/api/healthz")) {
      sendJson(response, 200, { ok: true, userDataPath });
      return;
    }
    if (request.method === "POST" && (request.url === "/runtime/dependencies/download" || request.url === "/api/runtime/dependencies/download")) {
      const body = await readBody(request);
      const input = body.trim() ? JSON.parse(body) : {};
      const result = await downloadRuntimeDependency({
        ...input,
        userDataPath,
        async: true,
        background: true
      });
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }
    if (request.method === "GET" && (request.url === "/runtime/dependencies" || request.url === "/api/runtime/dependencies")) {
      sendJson(response, 200, await listRuntimeDependencies({ userDataPath }));
      return;
    }
    if (request.method === "GET" && (request.url === "/runtime/dependencies/downloads" || request.url === "/api/runtime/dependencies/downloads")) {
      sendJson(response, 200, listRuntimeDependencyDownloadRuns({ userDataPath }));
      return;
    }
    sendJson(response, 404, { ok: false, error: "not_found" });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(19080, "0.0.0.0", () => {
  console.log(JSON.stringify({ ok: true, listening: 19080, userDataPath }));
});
`, "utf8");
}

function nodeFetchInNetwork({ nodeImage, networkName, url, timeoutMs = 60000 }) {
  const script = `
const response = await fetch(${JSON.stringify(url)});
const text = await response.text();
console.log(text);
if (!response.ok) process.exit(2);
`;
  const result = docker([
    "run",
    "--rm",
    "--network",
    networkName,
    nodeImage,
    "node",
    "--input-type=module",
    "-e",
    script
  ], { timeoutMs });
  return parseLastJsonLine(result.stdout);
}

function waitForHealth({ nodeImage, networkName, timeoutMs = 120000, intervalMs = 2000 }) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const health = nodeFetchInNetwork({
        nodeImage,
        networkName,
        url: "http://pact-runtime-download-service:19080/api/healthz",
        timeoutMs: Math.max(30000, intervalMs + 5000)
      });
      if (health.ok === true) return health;
    } catch (error) {
      lastError = error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
  }
  throw new Error(`runtime download service did not become healthy: ${lastError?.message || "unknown"}`);
}

function printUsageAndExit(code = 0) {
  console.log(`Start a detached Pact runtime dependency download container

Usage:
  node server/scripts/start-runtime-download-container.mjs --target jre
  node server/scripts/start-runtime-download-container.mjs --target jre --target node --name pact-runtime-download

Options:
  --target ID           Runtime dependency target. Repeatable, comma-separated values are accepted.
  --config PATH         Runtime download config passed to start-runtime-downloads.mjs.
  --name NAME           Docker container name. Default: pact-runtime-download-<timestamp>
  --network NAME        Docker network name. Default: <name>-net
  --data-dir PATH       Host data directory to mount into the container data path.
  --container-data-path PATH
                        Container data directory. Default comes from server/config/deployment/index.json.
  --node-image IMAGE    Node release image. Default: node:24-bookworm
  --dry-run             Submit plan-only downloads.
  --timeout-ms N        Per-download timeout passed to the server.
  --env KEY=VALUE       Extra environment variable for the runtime service container. Repeatable.
`);
  process.exit(code);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printUsageAndExit(0);
  }
  assert.equal(run("docker", ["--version"], { allowFailure: true }).status, 0, "Docker must be available.");

  const targets = [
    ...splitTargets(process.env.PACT_RUNTIME_DOWNLOAD_TARGETS),
    ...args.targets
  ];
  const configPath = String(args.config || process.env.PACT_RUNTIME_DOWNLOAD_CONFIG || "").trim();
  if (targets.length === 0 && !configPath) {
    throw new Error("No runtime dependency target/config was provided.");
  }

  const nodeImage = String(args["node-image"] || process.env.PACT_RUNTIME_DOWNLOAD_NODE_IMAGE || runtimeDownloadPreset.nodeImage || "node:24-bookworm").trim();
  const containerName = String(args.name || process.env.PACT_RUNTIME_DOWNLOAD_CONTAINER || `pact-runtime-download-${Date.now()}`).trim();
  const networkName = String(args.network || process.env.PACT_RUNTIME_DOWNLOAD_NETWORK || `${containerName}-net`).trim();
  const hostRoot = path.resolve(String(args["work-dir"] || process.env.PACT_RUNTIME_DOWNLOAD_WORK_DIR || await fs.mkdtemp(path.join(os.tmpdir(), `${containerName}-`))));
  const dataDir = path.resolve(String(args["data-dir"] || process.env.PACT_RUNTIME_DOWNLOAD_DATA_DIR || path.join(hostRoot, "data")));
  const containerDataPath = String(args["container-data-path"] || process.env.PACT_RUNTIME_DOWNLOAD_CONTAINER_DATA_PATH || runtimeDownloadPreset.containerDataPath || "/pact-data").trim();
  const serviceScriptPath = path.join(hostRoot, "runtime-download-service.mjs");
  const extraEnv = [
    ...String(process.env.PACT_RUNTIME_DOWNLOAD_CONTAINER_ENV || "").split(",").map((item) => item.trim()).filter(Boolean),
    ...args.env
  ];

  await fs.mkdir(dataDir, { recursive: true });
  await writeServiceScript(serviceScriptPath, { containerDataPath });

  docker(["image", "inspect", nodeImage], { allowFailure: true }).status === 0 ||
    docker(["pull", nodeImage], { timeoutMs: 900000, maxBuffer: 64 * 1024 * 1024 });
  docker(["network", "inspect", networkName], { allowFailure: true }).status === 0 ||
    docker(["network", "create", networkName], { timeoutMs: 30000 });

  if (docker(["container", "inspect", containerName], { allowFailure: true }).status === 0) {
    throw new Error(`Container already exists: ${containerName}`);
  }

  docker([
    "run",
    "-d",
    "--name",
    containerName,
    "--network",
    networkName,
    "--network-alias",
    "pact-runtime-download-service",
    "-v",
    `${repoRoot}:/workspace:ro`,
    "-v",
    `${serviceScriptPath}:/tmp/runtime-download-service.mjs:ro`,
    "-v",
    `${dataDir}:${containerDataPath}`,
    "-w",
    "/workspace",
    "-e",
    `PACT_SERVER_DATA_DIR=${containerDataPath}`,
    "-e",
    `PACT_RUNTIME_DEPENDENCY_CACHE_DIR=${containerDataPath}/runtime/runtime-dependencies`,
    ...extraEnv.flatMap((entry) => ["-e", entry]),
    nodeImage,
    "node",
    "/tmp/runtime-download-service.mjs"
  ], { timeoutMs: 60000 });

  waitForHealth({ nodeImage, networkName });

  const starterArgs = [
    "run",
    "--rm",
    "--network",
    networkName,
    "-v",
    `${repoRoot}:/workspace:ro`,
    "-w",
    "/workspace",
    nodeImage,
    "node",
    "server/scripts/start-runtime-downloads.mjs",
    "--server-url",
    "http://pact-runtime-download-service:19080",
    "--wait-server",
    "--timeout-ms",
    String(numberValue(args["timeout-ms"], numberValue(process.env.PACT_RUNTIME_DOWNLOAD_TIMEOUT_MS, 900000)))
  ];
  for (const target of targets) {
    starterArgs.push("--target", target);
  }
  if (configPath) {
    starterArgs.push("--config", configPath);
  }
  if (boolFlag(args["dry-run"], boolFlag(process.env.PACT_RUNTIME_DOWNLOAD_DRY_RUN, false))) {
    starterArgs.push("--dry-run");
  }
  const starterResult = docker(starterArgs, { timeoutMs: 120000, maxBuffer: 16 * 1024 * 1024 });
  const starterPayload = parseLastJsonLine(starterResult.stdout);

  console.log(JSON.stringify({
    ok: starterPayload.ok === true,
    containerName,
    networkName,
    dataDir,
    containerDataPath,
    submitted: starterPayload.submitted || [],
    query: {
      status: `docker run --rm --network ${networkName} ${nodeImage} node --input-type=module -e "const r=await fetch('http://pact-runtime-download-service:19080/api/runtime/dependencies/downloads'); console.log(await r.text())"`,
      logs: `docker logs ${containerName}`,
      shell: `docker exec -it ${containerName} sh`,
      stop: `docker rm -f ${containerName} && docker network rm ${networkName}`
    }
  }, null, 2));
}

await main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exit(1);
});
