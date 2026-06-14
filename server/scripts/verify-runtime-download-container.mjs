#!/usr/bin/env node
import assert from "node:assert/strict";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_NODE_IMAGE = "node:24-bookworm";

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    expected: []
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
    if (key === "expect-installed" || key === "target" || key === "expect") {
      parsed.expected.push(...splitList(value));
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}

function splitList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024
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

function shellQuote(value = "") {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function parseJson(output = "") {
  const text = String(output || "").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function fetchServiceJson({ networkName, nodeImage, pathname }) {
  const script = `
const response = await fetch("http://pact-runtime-download-service:19080${pathname}");
const text = await response.text();
console.log(JSON.stringify({ status: response.status, ok: response.ok, text }));
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
  ], { timeoutMs: 120000 });
  const envelope = parseJson(result.stdout);
  let payload = {};
  try {
    payload = envelope.text ? JSON.parse(envelope.text) : {};
  } catch {
    payload = { ok: false, raw: envelope.text || "" };
  }
  return {
    status: envelope.status,
    ok: envelope.ok,
    payload
  };
}

function listDependenciesFromContainer({ containerName, userDataPath }) {
  const script = `
import { listRuntimeDependencies } from "/workspace/server/platform/specialized/capabilities/runtime-dependencies/index.mjs";
const payload = await listRuntimeDependencies({ userDataPath: ${JSON.stringify(userDataPath)} });
console.log(JSON.stringify(payload));
`;
  const result = docker([
    "exec",
    containerName,
    "node",
    "--input-type=module",
    "-e",
    script
  ], { timeoutMs: 120000 });
  return parseJson(result.stdout);
}

function dependencyRuntimePath(dependency = {}) {
  return dependency.detection?.javaPath ||
    dependency.detection?.pythonPath ||
    dependency.detection?.nodePath ||
    dependency.detection?.warPath ||
    dependency.detection?.runtimePath ||
    dependency.detection?.source?.path ||
    "";
}

function dependencySummary(dependency = {}) {
  return {
    id: dependency.id,
    status: dependency.status,
    present: dependency.present === true,
    cached: dependency.cached === true,
    path: dependencyRuntimePath(dependency),
    source: dependency.detection?.source || null
  };
}

function downloadSummary(run = {}) {
  return {
    runId: run.runId,
    targetId: run.targetId,
    status: run.status,
    ok: run.ok === true,
    progressPercent: run.progressPercent,
    currentStepKey: run.currentStepKey,
    updatedAt: run.updatedAt,
    resultStatus: run.result?.status || ""
  };
}

function artifactCommand(targetId, runtimePath) {
  const quoted = shellQuote(runtimePath);
  if (targetId === "jre") return `${quoted} -version`;
  if (targetId === "python") return `${quoted} --version && ${quoted} -c 'import sys, ensurepip; print(sys.executable)'`;
  if (targetId === "node") return `${quoted} --version`;
  if (targetId === "caddy") return `${quoted} version`;
  if (targetId === "gerrit") return `test -s ${quoted} && ls -lh ${quoted} && md5sum ${quoted}`;
  return `test -e ${quoted} && ls -lh ${quoted}`;
}

function verifyArtifact({ containerName, targetId, runtimePath }) {
  if (!runtimePath) {
    return {
      targetId,
      ok: false,
      runtimePath,
      error: "missing_runtime_path"
    };
  }
  const result = docker([
    "exec",
    containerName,
    "sh",
    "-lc",
    artifactCommand(targetId, runtimePath)
  ], { allowFailure: true, timeoutMs: 120000 });
  return {
    targetId,
    ok: result.status === 0,
    runtimePath,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim()
  };
}

function printUsageAndExit(code = 0) {
  console.log(`Verify a running Pact runtime download container

Usage:
  node server/scripts/verify-runtime-download-container.mjs --name pact-runtime-download --expect-installed jre,node

Options:
  --name NAME              Docker container name.
  --network NAME           Docker network name. Default: <name>-net
  --node-image IMAGE       Node image for service queries. Default: ${DEFAULT_NODE_IMAGE}
  --user-data-path PATH    Container data path. Default: /pact-data
  --expect-installed ID    Expected installed dependency. Repeatable or comma-separated.
  --allow-history-failures Ignore old failed runs when expected dependencies are installed.
`);
  process.exit(code);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printUsageAndExit(0);
  }
  const containerName = String(args.name || process.env.PACT_RUNTIME_DOWNLOAD_CONTAINER || "").trim();
  if (!containerName) {
    throw new Error("Missing --name.");
  }
  const networkName = String(args.network || process.env.PACT_RUNTIME_DOWNLOAD_NETWORK || `${containerName}-net`).trim();
  const nodeImage = String(args["node-image"] || process.env.PACT_RUNTIME_DOWNLOAD_NODE_IMAGE || DEFAULT_NODE_IMAGE).trim();
  const userDataPath = String(args["user-data-path"] || process.env.PACT_RUNTIME_DOWNLOAD_CONTAINER_DATA_PATH || "/pact-data").trim();
  const expected = [...new Set([
    ...splitList(process.env.PACT_RUNTIME_DOWNLOAD_EXPECT_INSTALLED),
    ...args.expected
  ])];
  assert.equal(docker(["container", "inspect", containerName], { allowFailure: true }).status, 0, `Container not found: ${containerName}`);

  const downloadsResponse = fetchServiceJson({
    networkName,
    nodeImage,
    pathname: "/api/runtime/dependencies/downloads"
  });
  if (!downloadsResponse.ok) {
    throw new Error(`Download status endpoint failed: ${downloadsResponse.status}`);
  }

  const detectionResponse = fetchServiceJson({
    networkName,
    nodeImage,
    pathname: "/api/runtime/dependencies"
  });
  const detectionPayload = detectionResponse.ok
    ? detectionResponse.payload
    : listDependenciesFromContainer({ containerName, userDataPath });

  const dependencies = Array.isArray(detectionPayload.dependencies) ? detectionPayload.dependencies : [];
  const dependencyById = new Map(dependencies.map((item) => [item.id, item]));
  const dependencySummaries = expected.length > 0
    ? expected.map((targetId) => dependencySummary(dependencyById.get(targetId) || { id: targetId }))
    : dependencies.map(dependencySummary);
  const artifactChecks = expected.map((targetId) => verifyArtifact({
    containerName,
    targetId,
    runtimePath: dependencyRuntimePath(dependencyById.get(targetId) || {})
  }));
  const missingExpected = dependencySummaries.filter((item) => expected.includes(item.id) && item.present !== true);
  const failedArtifactChecks = artifactChecks.filter((item) => item.ok !== true);
  const failedRuns = (downloadsResponse.payload.downloads || [])
    .map(downloadSummary)
    .filter((item) => item.ok !== true && item.status === "failed");
  const allowHistoryFailures = ["1", "true", "yes", "on"].includes(String(args["allow-history-failures"] || "").toLowerCase());
  const ok = missingExpected.length === 0 &&
    failedArtifactChecks.length === 0 &&
    (allowHistoryFailures || failedRuns.length === 0);

  const result = {
    ok,
    containerName,
    networkName,
    downloads: (downloadsResponse.payload.downloads || []).map(downloadSummary),
    dependencies: dependencySummaries,
    artifactChecks,
    failedRuns: allowHistoryFailures ? [] : failedRuns,
    detectionEndpointAvailable: detectionResponse.ok === true
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
