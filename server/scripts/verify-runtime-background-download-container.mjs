#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.includes("=")
      ? token.slice(2).split(/=(.*)/s, 2)
      : [token.slice(2), null];
    if (inlineValue !== null) {
      args.set(key, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

const args = parseArgs();
const nodeImage = String(args.get("node-image") || process.env.PACT_RUNTIME_VERIFY_NODE_IMAGE || "node:24-bookworm");
const targetId = String(args.get("target") || process.env.PACT_RUNTIME_VERIFY_TARGET || "jre");
const dryRun = args.has("dry-run") || args.has("plan-only") || process.env.PACT_RUNTIME_VERIFY_DRY_RUN === "1";
const timeoutMs = Number(args.get("timeout-ms") || process.env.PACT_RUNTIME_VERIFY_TIMEOUT_MS || 900000);
const pollTimeoutMs = Number(args.get("poll-timeout-ms") || process.env.PACT_RUNTIME_VERIFY_POLL_TIMEOUT_MS || timeoutMs + 60000);
const keep = args.has("keep") || process.env.PACT_RUNTIME_VERIFY_KEEP === "1";

function run(command, commandArgs = [], options = {}) {
  const result = spawnSync(command, commandArgs, {
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
    throw new Error(`${command} ${commandArgs.join(" ")} failed:\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return result;
}

function docker(argsList = [], options = {}) {
  return run("docker", argsList, options);
}

function dockerAvailable() {
  const result = run("docker", ["--version"], { allowFailure: true, timeoutMs: 10000 });
  return result.status === 0;
}

async function writeServiceScript(filePath) {
  await fs.writeFile(filePath, `import http from "node:http";
import { downloadRuntimeDependency, listRuntimeDependencies, listRuntimeDependencyDownloadRuns } from "/workspace/server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

const userDataPath = process.env.PACT_SERVER_DATA_DIR || "/pact-data";

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
        async: true
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

function runNodeHttp(networkName, script, options = {}) {
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
  ], {
    allowFailure: options.allowFailure === true,
    timeoutMs: options.timeoutMs || 120000,
    maxBuffer: 16 * 1024 * 1024
  });
  return result;
}

function fetchJsonInNetwork(networkName, url, options = {}) {
  const bodyExpression = options.body === undefined
    ? "undefined"
    : JSON.stringify(JSON.stringify(options.body));
  const method = options.method || "GET";
  const script = `
const response = await fetch(${JSON.stringify(url)}, {
  method: ${JSON.stringify(method)},
  headers: { "Content-Type": "application/json" },
  body: ${bodyExpression}
});
const text = await response.text();
console.log(text);
if (!response.ok) process.exit(2);
`;
  const result = runNodeHttp(networkName, script, {
    allowFailure: options.allowFailure,
    timeoutMs: options.timeoutMs
  });
  const output = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}";
  return JSON.parse(output);
}

async function main() {
  assert.equal(dockerAvailable(), true, "Docker must be available for fresh-container deployment verification");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-background-download-"));
  const serviceScriptPath = path.join(tempRoot, "runtime-download-service.mjs");
  const dataPath = path.join(tempRoot, "data");
  const suffix = `${process.pid}-${Date.now()}`;
  const networkName = `pact-runtime-download-${suffix}`;
  const serviceName = `pact-runtime-download-service-${suffix}`;

  await fs.mkdir(dataPath, { recursive: true });
  await writeServiceScript(serviceScriptPath);

  try {
    console.log(`[runtime-background-container] using Node release image: ${nodeImage}`);
    docker(["image", "inspect", nodeImage], { allowFailure: true, timeoutMs: 20000 }).status === 0 ||
      docker(["pull", nodeImage], { timeoutMs: 900000, maxBuffer: 64 * 1024 * 1024 });

    docker(["network", "create", networkName], { timeoutMs: 30000 });
    docker([
      "run",
      "-d",
      "--name",
      serviceName,
      "--network",
      networkName,
      "--network-alias",
      "pact-runtime-download-service",
      "-v",
      `${repoRoot}:/workspace:ro`,
      "-v",
      `${serviceScriptPath}:/tmp/runtime-download-service.mjs:ro`,
      "-v",
      `${dataPath}:/pact-data`,
      "-w",
      "/workspace",
      "-e",
      "PACT_SERVER_DATA_DIR=/pact-data",
      "-e",
      "PACT_RUNTIME_DEPENDENCY_CACHE_DIR=/pact-data/runtime/runtime-dependencies",
      nodeImage,
      "node",
      "/tmp/runtime-download-service.mjs"
    ], { timeoutMs: 60000 });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 60000) {
      const health = fetchJsonInNetwork(networkName, "http://pact-runtime-download-service:19080/healthz", {
        allowFailure: true,
        timeoutMs: 30000
      });
      if (health.ok === true) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const health = fetchJsonInNetwork(networkName, "http://pact-runtime-download-service:19080/api/healthz");
    assert.equal(health.ok, true, "runtime download service container should become healthy");
    const dependencyList = fetchJsonInNetwork(networkName, "http://pact-runtime-download-service:19080/api/runtime/dependencies");
    assert.equal(Array.isArray(dependencyList.dependencies), true, "runtime dependency list endpoint should return dependencies");

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
      "--target",
      targetId,
      "--timeout-ms",
      String(timeoutMs)
    ];
    if (dryRun) {
      starterArgs.push("--dry-run");
    }
    const starterResult = docker(starterArgs, { timeoutMs: 120000, maxBuffer: 16 * 1024 * 1024 });
    const starterOutput = JSON.parse(String(starterResult.stdout || "").trim().split(/\r?\n/).filter(Boolean).join("\n"));
    assert.equal(starterOutput.ok, true, "runtime download starter should submit the task");
    const started = starterOutput.submitted?.[0] || {};
    assert.ok(started.runId, "background runtime dependency download should return runId");

    console.log(`[runtime-background-container] starter container exited after run ${started.runId}`);

    const pollStartedAt = Date.now();
    let finalRun = null;
    while (Date.now() - pollStartedAt < pollTimeoutMs) {
      const downloads = fetchJsonInNetwork(
        networkName,
        "http://pact-runtime-download-service:19080/api/runtime/dependencies/downloads",
        { timeoutMs: 60000 }
      );
      const run = (downloads.downloads || []).find((item) => item.runId === started.runId);
      if (run && run.status !== "queued" && run.status !== "running") {
        finalRun = run;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    assert.ok(finalRun, `background download ${started.runId} did not finish within ${pollTimeoutMs}ms`);
    assert.equal(finalRun.ok, true, `background download failed: ${finalRun.latestMessage || finalRun.result?.error || "unknown"}`);
    assert.equal(finalRun.progressPercent, 100, "completed background download should reach 100%");

    const persistedRunPath = path.join(dataPath, "runtime", "runtime-dependency-download-runs", `${started.runId}.json`);
    const persistedRun = JSON.parse(await fs.readFile(persistedRunPath, "utf8"));
    assert.equal(persistedRun.runId, started.runId, "background download run should be persisted in the data volume");

    console.log("[runtime-background-container] ok");
    console.log(JSON.stringify({
      ok: true,
      targetId,
      dryRun,
      runId: started.runId,
      status: finalRun.status,
      dependencyEndpointCount: dependencyList.dependencies.length,
      persistedRunPath
    }, null, 2));
  } finally {
    if (keep) {
      console.log(`[runtime-background-container] keeping temp resources: ${tempRoot}`);
    } else {
      docker(["rm", "-f", serviceName], { allowFailure: true, timeoutMs: 30000 });
      docker(["network", "rm", networkName], { allowFailure: true, timeoutMs: 30000 });
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

await main();
