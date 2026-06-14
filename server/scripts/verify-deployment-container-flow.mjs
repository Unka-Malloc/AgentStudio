#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadDeploymentIndex } from "./deployment-index.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const deploymentIndex = await loadDeploymentIndex({ cwd: repoRoot });
const dockerPresets = deploymentIndex.dockerPresets || {};
const mainServicePreset = dockerPresets.mainService || {};
const mainRuntimePreset = mainServicePreset.runtime || {};
const runtimeDependencyPreset = deploymentIndex.runtimeDependencies?.dockerBaked || {};
const externalServicePresets = new Map((deploymentIndex.externalServices?.services || []).map((service) => [service.id, service]));
const ragServicePreset = externalServicePresets.get("rag-service") || {};
const ragServiceId = ragServicePreset.id || "rag-service";
const ragContainerPort = Number(ragServicePreset.port || 8788);
const ragHealthPath = String(ragServicePreset.healthPath || "/health");
const ragDockerContext = path.dirname(ragServicePreset.dockerfile || "external-services/rag-service/Dockerfile");
const serverContainerPort = Number(mainRuntimePreset.port || 7228);
const containerDataPath = String(mainServicePreset?.runtime?.dataPath || "/opt/pact/data");
const dockerBakedJavaPath = runtimeDependencyPreset.javaBinPath || "/app/server/platform/modules/knowledge/runtime/jre/current/bin/java";
const dockerBakedTikaPath = runtimeDependencyPreset.tikaJarPath || "/app/server/platform/modules/knowledge/tika/tika-app-3.2.3.jar";
const runId = `${process.pid}-${Date.now()}`;
const tagSuffix = runId.replace(/[^a-zA-Z0-9_.-]/g, "-");
const buildImage = `pact-deploy-build-verify:${tagSuffix}`;
const serverImage = `pact-deploy-server-verify:${tagSuffix}`;
const ragImage = `pact-deploy-rag-verify:${tagSuffix}`;
const networkName = `pact-deploy-verify-${tagSuffix}`;
const dataVolume = `pact-deploy-data-${tagSuffix}`;
const serverContainer = `pact-deploy-server-${tagSuffix}`;
const ragContainer = `pact-deploy-rag-${tagSuffix}`;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-deploy-container-verify-"));
const keepResources = process.env.PACT_DEPLOYMENT_VERIFY_KEEP === "1";

function parseArgs(argv = []) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const keyValue = value.slice(2);
    const equalIndex = keyValue.indexOf("=");
    const key = equalIndex >= 0 ? keyValue.slice(0, equalIndex) : keyValue;
    const inlineValue = equalIndex >= 0 ? keyValue.slice(equalIndex + 1) : null;
    const next = argv[index + 1];
    if (inlineValue !== null) {
      parsed[key] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const includeKnowledgeDistillation = args["include-knowledge-distillation"] === true ||
  process.env.PACT_DEPLOYMENT_VERIFY_INCLUDE_KD === "1";
const skipRuntimeBootstrap = args["skip-runtime-bootstrap"] === true ||
  process.env.PACT_DEPLOYMENT_VERIFY_SKIP_RUNTIME_BOOTSTRAP === "1";
const commandTimeoutMs = Number(args.timeoutMs || process.env.PACT_DEPLOYMENT_VERIFY_TIMEOUT_MS || 90 * 60 * 1000);
const nodeBaseImage = String(args["node-base-image"] || process.env.PACT_DEPLOYMENT_VERIFY_NODE_BASE_IMAGE || dockerPresets.baseImages?.mainService || "node:24-bookworm-slim").trim();
const npmRegistry = String(args["npm-registry"] || process.env.PACT_DEPLOYMENT_VERIFY_NPM_REGISTRY || dockerPresets.npmRegistry || "https://registry.npmjs.org/").trim();
const dockerBuildBaseArgs = [
  "--build-arg", `NODE_BASE_IMAGE=${nodeBaseImage}`,
  "--build-arg", `NPM_REGISTRY=${npmRegistry}`
];

function tail(value = "", limit = 8000) {
  const text = String(value || "");
  return text.length <= limit ? text : text.slice(-limit);
}

function run(command, commandArgs = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs || commandTimeoutMs);
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (options.stream) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (options.stream) {
        process.stderr.write(text);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const result = { code, signal, stdout, stderr };
      if (code === 0) {
        resolve(result);
        return;
      }
      const output = tail(`${stdout}\n${stderr}`);
      reject(new Error(`${command} ${commandArgs.join(" ")} failed with code=${code} signal=${signal || ""}\n${output}`));
    });
  });
}

async function step(label, fn) {
  const startedAt = Date.now();
  console.log(`[deployment-container-flow] ${label} ...`);
  const result = await fn();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[deployment-container-flow] ${label} ok (${elapsed}s)`);
  return result;
}

async function docker(commandArgs = [], options = {}) {
  return run("docker", commandArgs, options);
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHttp(url, { timeoutMs = 120000, method = "GET", body = undefined, headers = {} } = {}) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method, body, headers });
      const text = await response.text();
      if (response.ok) {
        return { ok: true, status: response.status, body: text };
      }
      lastError = `${response.status} ${text.slice(0, 500)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function writeRuntimeBootstrapVerifier() {
  const verifierPath = path.join(tempRoot, "verify-runtime-bootstrap.mjs");
  await fs.writeFile(verifierPath, `import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { downloadRuntimeDependency, listRuntimeDependencies } from "/app/server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

const userDataPath = "/tmp/pact-runtime-bootstrap-data";
await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(userDataPath, { recursive: true });

function findDependency(dependencies, id) {
  for (const dependency of dependencies || []) {
    if (dependency.id === id) return dependency;
    const child = findDependency(dependency.children || [], id);
    if (child) return child;
  }
  return null;
}

function assertOk(result, label) {
  assert.equal(result?.ok, true, label + " failed: " + JSON.stringify(result, null, 2).slice(0, 4000));
  assert.notEqual(result?.status, "failed", label + " returned failed status");
}

const runtimeResult = await downloadRuntimeDependency({
  userDataPath,
  targetId: "programming-runtimes",
  timeoutMs: Number(process.env.PACT_DEPLOYMENT_VERIFY_RUNTIME_TIMEOUT_MS || 1800000),
  onProgress(event) {
    if (event?.message) console.log("[runtime-bootstrap] " + event.message);
  }
});
assertOk(runtimeResult, "programming-runtimes");

const gatewayResult = await downloadRuntimeDependency({
  userDataPath,
  targetId: "caddy",
  timeoutMs: Number(process.env.PACT_DEPLOYMENT_VERIFY_RUNTIME_TIMEOUT_MS || 1800000),
  onProgress(event) {
    if (event?.message) console.log("[gateway-bootstrap] " + event.message);
  }
});
assertOk(gatewayResult, "caddy");

const listed = await listRuntimeDependencies({ userDataPath });
const jre = findDependency(listed.dependencies, "jre");
const python = findDependency(listed.dependencies, "python");
const node = findDependency(listed.dependencies, "node");
const caddy = findDependency(listed.dependencies, "caddy");

assert.equal(jre?.present, true, "JRE/Tika must be present after bootstrap");
assert.equal(jre?.detection?.javaCompatible, true, "JRE must satisfy the minimum Java version");
assert.ok(jre?.detection?.tikaJarPath, "Tika jar must be detected");
assert.equal(python?.present, true, "Python must be present after bootstrap");
assert.equal(path.resolve(python.detection.pythonPath), path.resolve(python.detection.venvPythonPath), "Python must use the managed venv");
assert.equal(node?.present, true, "Node.js must be present after bootstrap");
assert.equal(node?.detection?.nvmAvailable, true, "Node.js bootstrap must install or reuse nvm");
assert.equal(node?.detection?.source?.kind, "platform-runtime", "Node.js must be detected from the nvm managed runtime");
assert.equal(caddy?.present, true, "Caddy gateway runtime must be present after bootstrap");

console.log(JSON.stringify({
  ok: true,
  jre: { javaPath: jre.detection.javaPath, javaMajor: jre.detection.javaMajor, tikaJarPath: jre.detection.tikaJarPath },
  python: { pythonPath: python.detection.pythonPath, version: python.detection.pythonVersion },
  node: { nodePath: node.detection.nodePath, version: node.detection.version, nvmDir: node.detection.nvmDir },
  caddy: { executable: caddy.detection.configuredBinary || caddy.detection.cachedExecutablePath || caddy.detection.pathBinary, version: caddy.detection.version }
}, null, 2));
`, "utf8");
  return verifierPath;
}

async function writeExternalServiceConfig() {
  const configPath = path.join(tempRoot, "rag-service.external-service.json");
  await fs.writeFile(configPath, `${JSON.stringify({
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: "pact.external-service.config",
    serviceId: ragServiceId,
    serviceName: "external.knowledge.rag",
    displayName: "RAG Service",
    mode: "connected",
    startupPolicy: "external-only",
    featureIds: ["external-service-compatibility", "knowledge-retrieval"],
    upstream: {
      type: "http",
      url: `http://rag-service:${ragContainerPort}`,
      transport: "http",
      timeoutMs: 60000
    },
    healthCheck: {
      type: "http",
      url: `http://rag-service:${ragContainerPort}${ragHealthPath}`,
      timeoutMs: 10000,
      required: true
    }
  }, null, 2)}\n`, "utf8");
  return configPath;
}

async function writeExternalServiceVerifier() {
  const verifierPath = path.join(tempRoot, "verify-external-services.mjs");
  await fs.writeFile(verifierPath, `import assert from "node:assert/strict";
import { describeExternalServices, inspectExternalServiceHealth } from "/app/server/platform/common/composition-management/external-service-registry.mjs";

const description = await describeExternalServices({ userDataPath: "${containerDataPath}", cwd: "/app" });
const service = description.services.find((entry) => entry.serviceId === ${JSON.stringify(ragServiceId)});
assert.ok(service, ${JSON.stringify(`${ragServiceId} must be discovered from deployment config`)});
assert.equal(service.healthCheck?.url, ${JSON.stringify(`http://rag-service:${ragContainerPort}${ragHealthPath}`)}, "deployment config should override repository defaults");
assert.ok(description.maintenancePresets.some((preset) => preset.serviceId === ${JSON.stringify(ragServiceId)}), ${JSON.stringify(`${ragServiceId} must expose a maintenance preset`)});

const health = await inspectExternalServiceHealth({ userDataPath: "${containerDataPath}", cwd: "/app", serviceId: ${JSON.stringify(ragServiceId)} });
assert.equal(health.ok, true, ${JSON.stringify(`${ragServiceId} health inspection must pass`)});
assert.equal(health.checkedCount, 1, "health inspection should target one service");
assert.equal(health.results[0]?.ok, true, ${JSON.stringify(`${ragServiceId} health endpoint must be reachable from the Pact container`)});
console.log(JSON.stringify({ ok: true, serviceId: service.serviceId, health }, null, 2));
`, "utf8");
  return verifierPath;
}

async function cleanup() {
  if (keepResources) {
    console.log(`[deployment-container-flow] keeping resources because PACT_DEPLOYMENT_VERIFY_KEEP=1 (${tempRoot})`);
    return;
  }
  await docker(["rm", "-f", serverContainer, ragContainer]).catch(() => null);
  await docker(["network", "rm", networkName]).catch(() => null);
  await docker(["volume", "rm", dataVolume]).catch(() => null);
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
}

process.once("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

let completed = false;
try {
  await step("Docker engine", async () => {
    const version = await docker(["version", "--format", "{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}"], { timeoutMs: 60000 });
    console.log(version.stdout.trim());
    console.log(`node base image: ${nodeBaseImage}`);
    console.log(`npm registry: ${npmRegistry}`);
  });

  const runtimeVerifierPath = await writeRuntimeBootstrapVerifier();
  const externalServiceConfigPath = await writeExternalServiceConfig();
  const externalServiceVerifierPath = await writeExternalServiceVerifier();
  const pactPort = await freePort();
  const ragPort = await freePort();

  await step("Build Pact source stage image", () => docker(["build", "--progress=plain", ...dockerBuildBaseArgs, "--target", "build", "-t", buildImage, "."], { timeoutMs: commandTimeoutMs, stream: true }));

  if (!skipRuntimeBootstrap) {
    await step("Runtime bootstrap inside fresh container", () => docker([
      "run", "--rm",
      "--name", `pact-runtime-bootstrap-${tagSuffix}`,
      "-v", `${runtimeVerifierPath}:/tmp/verify-runtime-bootstrap.mjs:ro`,
      buildImage,
      "node", "/tmp/verify-runtime-bootstrap.mjs"
    ], { timeoutMs: commandTimeoutMs, stream: true }));
  } else {
    console.log("[deployment-container-flow] Runtime bootstrap inside fresh container skipped by --skip-runtime-bootstrap");
  }

  await step("Build Pact runtime image", () => docker(["build", "--progress=plain", ...dockerBuildBaseArgs, "-t", serverImage, "."], { timeoutMs: commandTimeoutMs, stream: true }));

  await step("Build RAG service image", () => docker(["build", "--progress=plain", ...dockerBuildBaseArgs, "-t", ragImage, ragDockerContext], { timeoutMs: commandTimeoutMs, stream: true }));

  await step("Create deployment network and data volume", async () => {
    await docker(["network", "create", networkName], { timeoutMs: 60000 });
    await docker(["volume", "create", dataVolume], { timeoutMs: 60000 });
    await docker([
      "run", "--rm",
      "-v", `${dataVolume}:${containerDataPath}`,
      "-v", `${externalServiceConfigPath}:/tmp/rag-service.external-service.json:ro`,
      nodeBaseImage,
      "sh", "-lc",
      `mkdir -p ${containerDataPath}/external-services/configs && cp /tmp/rag-service.external-service.json ${containerDataPath}/external-services/configs/rag-service.external-service.json && chown -R 10001:10001 ${containerDataPath}`
    ], { timeoutMs: 120000, stream: true });
  });

  await step("Start RAG service container", async () => {
    await docker([
      "run", "-d",
      "--name", ragContainer,
      "--network", networkName,
      "--network-alias", "rag-service",
      "-p", `${ragPort}:${ragContainerPort}`,
      ragImage
    ], { timeoutMs: 120000 });
    await waitForHttp(`http://127.0.0.1:${ragPort}${ragHealthPath}`, { timeoutMs: 120000 });
  });

  await step("Start Pact server container", async () => {
    await docker([
      "run", "-d",
      "--name", serverContainer,
      "--network", networkName,
      "-p", `${pactPort}:${serverContainerPort}`,
      "-v", `${dataVolume}:${containerDataPath}`,
      serverImage
    ], { timeoutMs: 120000 });
    await waitForHttp(`http://127.0.0.1:${pactPort}/api/healthz`, { timeoutMs: 180000 });
  });

  await step("Verify Pact internal runtime config", async () => {
    const result = await docker([
      "exec", serverContainer,
      "node", "--input-type=module", "-e",
      `import fs from 'node:fs'; const config=JSON.parse(fs.readFileSync('/app/server/config/runtime/default-settings.json','utf8')); if(config.javaBinPath !== ${JSON.stringify(dockerBakedJavaPath)}) throw new Error('bad java path: '+config.javaBinPath); if(config.tikaJarPath !== ${JSON.stringify(dockerBakedTikaPath)}) throw new Error('bad tika path: '+config.tikaJarPath); if(process.env.PACT_JAVA_BIN_PATH) throw new Error('PACT_JAVA_BIN_PATH should not be set'); console.log(JSON.stringify(config));`
    ], { timeoutMs: 120000 });
    console.log(result.stdout.trim());
    await docker(["exec", serverContainer, dockerBakedJavaPath, "-version"], { timeoutMs: 120000 });
  });

  await step("Verify Work Queue SQLite WAL inside runtime container", async () => {
    await docker([
      "exec", serverContainer,
      "node", "server/scripts/verify-work-queue-conformance.mjs"
    ], { timeoutMs: 120000, stream: true });
    const result = await docker([
      "exec", serverContainer,
      "node", "--input-type=module", "-e",
      `
        import fs from 'node:fs';
        import {
          createManualQueueTimeSource,
          createQueueDefinitionRegistry,
          createSqliteWorkQueueStore,
          getWorkQueueDatabasePath,
          WORK_QUEUE_STATES
        } from '/app/server/platform/common/resource-management/work-queue/index.mjs';
        const userDataPath = '${containerDataPath}/work-queue-container-smoke';
        fs.rmSync(userDataPath, { recursive: true, force: true });
        fs.mkdirSync(userDataPath, { recursive: true });
        const timeSource = createManualQueueTimeSource(1000);
        const registry = createQueueDefinitionRegistry();
        const definition = registry.registerQueueDefinition({ label: 'container.jobs', ownerCapability: 'deployment-container-flow' });
        const resolved = registry.resolveQueueDefinitionForEnqueue({
          queueDefinitionId: definition.queueDefinitionId,
          scope: { tenantId: 'container', workspaceId: 'runtime' },
          dedupeKey: { jobId: 'container-smoke' }
        });
        const store = createSqliteWorkQueueStore({ userDataPath, timeSource });
        const enqueued = store.enqueue({
          ...resolved,
          payloadRef: { kind: 'container-smoke', ref: 'payload:container-smoke' },
          ownerRef: { capability: 'deployment-container-flow' }
        });
        if (enqueued.workItem.state !== WORK_QUEUE_STATES.PENDING) throw new Error('enqueue did not create pending work item');
        const claim = store.claim({ queueDefinitionId: definition.queueDefinitionId, scope: resolved.scope, workerId: 'container-worker' });
        if (claim.claimed.length !== 1) throw new Error('claim did not lease one work item');
        const leased = claim.claimed[0];
        store.ack({ workItemId: leased.workItem.workItemId, leaseId: leased.lease.leaseId });
        const replay = store.rebuildProjection();
        if (!replay.ok) throw new Error('work queue replay drift: ' + JSON.stringify(replay));
        const acked = store.inspect({ states: [WORK_QUEUE_STATES.ACKED] }).items.length;
        store.close();
        const databasePath = getWorkQueueDatabasePath(userDataPath);
        if (!fs.existsSync(databasePath)) throw new Error('work queue database was not created at ' + databasePath);
        console.log(JSON.stringify({ ok: true, acked, databasePath }));
      `
    ], { timeoutMs: 120000 });
    console.log(result.stdout.trim());
  });

  await step("Verify generic external service discovery and health", async () => {
    await docker([
      "exec", serverContainer,
      "node", "--input-type=module", "-e",
      `const r=await fetch(${JSON.stringify(`http://rag-service:${ragContainerPort}${ragHealthPath}`)}); if(!r.ok) throw new Error('rag health failed '+r.status); console.log(await r.text());`
    ], { timeoutMs: 120000 });
    await docker(["cp", externalServiceVerifierPath, `${serverContainer}:/tmp/verify-external-services.mjs`], { timeoutMs: 60000 });
    const result = await docker([
      "exec", serverContainer,
      "node", "/tmp/verify-external-services.mjs"
    ], { timeoutMs: 120000 });
    console.log(result.stdout.trim());
  });

  if (includeKnowledgeDistillation) {
    await step("External knowledge distillation container verifier", () => run(process.execPath, [
      "server/scripts/verify-external-knowledge-distillation-container.mjs"
    ], { timeoutMs: commandTimeoutMs }));
  }

  completed = true;
  console.log(JSON.stringify({
    ok: true,
    runId,
    images: { buildImage, serverImage, ragImage },
    containers: { serverContainer, ragContainer },
    networkName,
    dataVolume,
    includeKnowledgeDistillation
  }, null, 2));
} finally {
  if (!completed) {
    await docker(["logs", "--tail", "120", serverContainer]).then((result) => {
      if (result.stdout || result.stderr) console.error(`[deployment-container-flow] Pact logs:\n${result.stdout}${result.stderr}`);
    }).catch(() => null);
    await docker(["logs", "--tail", "120", ragContainer]).then((result) => {
      if (result.stdout || result.stderr) console.error(`[deployment-container-flow] RAG logs:\n${result.stdout}${result.stderr}`);
    }).catch(() => null);
  }
  await cleanup();
}
