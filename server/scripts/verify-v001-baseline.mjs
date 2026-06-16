#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createV001BaselineProvider } from "../platform/common/v001/baseline-provider.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { useIsolatedCapabilityKernelForVerifier } from "./capability-kernel-test-env.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function mcpRequest(method, params = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

async function listFiles(rootPath) {
  const files = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  await visit(rootPath);
  return files;
}

async function assertDataDirDoesNotContain(rootPath, forbiddenText) {
  const files = await listFiles(rootPath);
  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8").catch(() => "");
    assert.equal(content.includes(forbiddenText), false, `${filePath} must not contain the raw secret value`);
  }
}

const expectedMcpOutlets = [
  "pact.discovery",
  "pact.agentLibrary",
  "pact.sharedspace",
  "pact.codespace",
  "pact.skillHub",
  "pact.agentRelay",
  "pact.serviceHub"
];
const expectedPorts = [
  "ConfigRegistryPort",
  "MetadataStorePort",
  "CachePort",
  "QueuePort",
  "ArtifactStorePort",
  "SecretStorePort"
];

const operation = SERVER_API_OPERATIONS.find((item) => item.id === "v001.baseline.status");
assert.ok(operation, "v001.baseline.status must be registered");
assert.equal(operation.target?.method, "handleV001BaselineStatus");
assert.equal(operation.http?.method, "GET");
assert.equal(operation.http?.path, "/api/v001/baseline/status");
assert.deepEqual(operation.requiredScopes, ["console:read"]);
assert.equal(operation.readOnly, true);

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-v001-baseline-"));
const restoreCapabilityKernelEnv = useIsolatedCapabilityKernelForVerifier();
let server = null;

try {
  const provider = createV001BaselineProvider({ userDataPath });

  await provider.configRegistry.upsert("modules", {
    id: "mock-sharedspace",
    enabled: true,
    module: "sharedspace",
    verificationMode: "verified"
  });
  await provider.configRegistry.upsert("externalTargets", {
    id: "mock-drive-contract",
    enabled: false,
    provider: "cloud-drive",
    verificationMode: "contractVerified"
  });
  const enabled = await provider.configRegistry.listEnabled();
  assert.equal(enabled.modules.some((item) => item.id === "mock-sharedspace"), true);
  assert.equal(enabled.externalTargets.some((item) => item.id === "mock-drive-contract"), false);

  const metadata = await provider.metadataStore.put({
    id: "workspace:verify",
    kind: "workspace",
    dataClass: "pending_classification"
  });
  assert.equal((await provider.metadataStore.get(metadata.id)).dataClass, "pending_classification");

  await provider.cache.set({
    scope: "verify",
    key: "capabilities",
    value: { outlets: expectedMcpOutlets },
    ttlMs: 60_000
  });
  const cached = await provider.cache.get({ scope: "verify", key: "capabilities" });
  assert.equal(cached.hit, true);
  assert.equal(cached.status, "cached");

  const queued = await provider.queue.enqueue({
    queueName: "verify",
    idempotencyKey: "v001-baseline",
    payload: { operation: "v001.baseline.status" }
  });
  const claimed = await provider.queue.claim({ queueName: "verify", workerId: "verify-worker" });
  assert.equal(claimed.taskId, queued.taskId);
  await provider.queue.heartbeat({ taskId: claimed.taskId, workerId: "verify-worker" });
  const completed = await provider.queue.complete({ taskId: claimed.taskId, result: { ok: true } });
  assert.equal(completed.status, "completed");

  const artifact = await provider.artifactStore.putArtifact({
    text: "v0.0.1 baseline artifact\n",
    contentType: "text/plain",
    metadata: { operation: "v001.baseline.status" }
  });
  assert.equal(artifact.status, "archived");
  const artifactBytes = await provider.artifactStore.getArtifact(artifact.artifactRef);
  assert.equal(artifactBytes.bytes.toString("utf8"), "v0.0.1 baseline artifact\n");

  const rawSecret = "v001-secret-value";
  const secretRef = await provider.secretStore.createSecretRef({
    namespace: "verify",
    name: "external-provider-token",
    provider: "contract-mode",
    secretValue: rawSecret
  });
  assert.equal(secretRef.verificationMode, "contractVerified");
  const secretHandle = await provider.secretStore.resolveSecretRef(secretRef.secretRef);
  assert.equal(secretHandle.canRevealValue, false);
  await assertDataDirDoesNotContain(userDataPath, rawSecret);

  const status = await provider.status();
  assert.equal(status.status, "ready");
  assert.deepEqual(status.mcpOutlets, expectedMcpOutlets);
  for (const port of expectedPorts) {
    assert.ok(status.ports.some((item) => item.port === port), `${port} should be reported`);
  }
  assert.ok(status.storageStates.includes("contractVerified"));

  server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: { profile: "minimal" }
  });
  const auth = await installAuthenticatedFetch(server);

  const apiStatus = await fetchJson(`${server.url}/api/v001/baseline/status`, {
    headers: authHeaders(auth)
  });
  assert.equal(apiStatus.status, 200);
  assert.equal(apiStatus.payload.protocolVersion, "v0.0.1:platform:baseline-1");
  assert.deepEqual(apiStatus.payload.mcpOutlets, expectedMcpOutlets);

  const consoleState = await fetchJson(`${server.url}/api/console/state`, {
    headers: authHeaders(auth)
  });
  assert.equal(consoleState.status, 200);
  assert.equal(consoleState.payload.v001Baseline?.status, "ready");

  const grant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      label: "verify-v001-baseline",
      scopes: ["console:read"]
    })
  });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));
  assert.ok(grant.payload.token);

  const tools = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pact-Api-Key": grant.payload.token
    },
    body: JSON.stringify(mcpRequest("tools/list", {}, "tools"))
  });
  assert.equal(tools.status, 200);
  assert.deepEqual(tools.payload.result.tools.map((tool) => tool.name).sort(), [...expectedMcpOutlets].sort());

  const capabilities = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pact-Api-Key": grant.payload.token
    },
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation: "pact.capabilities.list",
        input: {}
      }
    }, "capabilities"))
  });
  assert.equal(capabilities.status, 200);
  assert.equal(
    capabilities.payload.result.structuredContent.operations.some((tool) => tool.name === "pact.v001.baseline.status"),
    true
  );

  const mcpStatus = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pact-Api-Key": grant.payload.token
    },
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation: "pact.v001.baseline.status",
        input: {}
      }
    }, "baseline"))
  });
  assert.equal(mcpStatus.status, 200);
  assert.equal(mcpStatus.payload.error, undefined, JSON.stringify(mcpStatus.payload.error || {}, null, 2));
  assert.equal(mcpStatus.payload.result.structuredContent.operation, "pact.v001.baseline.status");
  assert.equal(mcpStatus.payload.result.structuredContent.payload.status, "ready");

  console.log("v0.0.1 baseline verification passed");
} finally {
  if (server?.close) {
    await server.close();
  }
  await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
  restoreCapabilityKernelEnv();
}
