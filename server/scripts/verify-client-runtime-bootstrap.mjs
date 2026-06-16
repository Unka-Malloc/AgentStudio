#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import {
  buildClientRuntimeBootstrapPlan,
  buildClientRuntimeBootstrapPull,
  CLIENT_RUNTIME_BOOTSTRAP_PROTOCOL_VERSION,
  INLINE_TEXT_MAX_BYTES,
  SCP_SMALL_FILE_MAX_BYTES
} from "../services/client/client-runtime-core/client-runtime-bootstrap.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function moduleIds(plan) {
  return new Set(plan.modules.map((module) => module.moduleId));
}

function verifyNativeTransportPriority() {
  const plan = buildClientRuntimeBootstrapPlan({
    clientUid: "linux-agent",
    client: {
      os: "linux",
      arch: "x64",
      availableCommands: ["rsync", "ssh", "scp", "sftp"]
    },
    serverCapabilities: {
      ssh: true,
      rsync: true,
      scp: true,
      sftp: true
    },
    modules: ["mcp-local-bridge"],
    transfer: {
      directory: true,
      incremental: true,
      totalBytes: 512 * 1024 * 1024,
      fileCount: 200
    }
  });

  assert.equal(plan.protocolVersion, CLIENT_RUNTIME_BOOTSTRAP_PROTOCOL_VERSION);
  assert.equal(plan.transportPlan.selected, "rsync-over-ssh");
  assert.deepEqual(plan.transportPlan.fallbackOrder.slice(0, 2), ["rsync-over-ssh", "sftp"]);
  assert.ok(plan.transportPlan.fallbackOrder.includes("pact-http-upload-session"));
  const modules = moduleIds(plan);
  assert.ok(modules.has("runtime-framework"));
  assert.ok(modules.has("pact-client-cli"));
  assert.ok(modules.has("clientd"));
  assert.ok(modules.has("upload-queue"));
  assert.ok(modules.has("mcp-local-bridge"));
  assert.ok(modules.has("transport-rsync"));
  assert.ok(modules.has("checkpoint-http-upload"));
}

function verifyScpSmallFileFallback() {
  const plan = buildClientRuntimeBootstrapPlan({
    clientUid: "linux-small",
    client: {
      os: "linux",
      arch: "x64",
      commands: { ssh: true, scp: true, sftp: true }
    },
    serverCapabilities: {
      ssh: true,
      scp: true,
      sftp: true
    },
    modules: ["upload"],
    transfer: {
      totalBytes: SCP_SMALL_FILE_MAX_BYTES - 1,
      fileCount: 1
    }
  });

  assert.equal(plan.transportPlan.selected, "scp");
  assert.ok(plan.transportPlan.fallbackOrder.includes("pact-http-upload-session"));
  const modules = moduleIds(plan);
  assert.ok(modules.has("transport-scp"));
  assert.ok(modules.has("upload-queue"));
}

function verifyPortableFallbacks() {
  const largePlan = buildClientRuntimeBootstrapPlan({
    clientUid: "minimal-container",
    client: {
      os: "linux",
      arch: "x64",
      availableCommands: []
    },
    modules: ["upload.queue"],
    transfer: {
      totalBytes: 64 * 1024 * 1024,
      fileCount: 1
    }
  });
  assert.equal(largePlan.transportPlan.selected, "pact-http-upload-session");
  assert.equal(largePlan.transportPlan.fallbackOrder.includes("mcp-inline-content"), false);
  assert.ok(moduleIds(largePlan).has("checkpoint-http-upload"));

  const tinyPlan = buildClientRuntimeBootstrapPlan({
    clientUid: "tiny-text",
    client: {
      os: "linux",
      arch: "x64",
      availableCommands: []
    },
    modules: ["mcp-local-bridge"],
    transfer: {
      totalBytes: INLINE_TEXT_MAX_BYTES - 1,
      fileCount: 1
    }
  });
  assert.equal(tinyPlan.transportPlan.selected, "pact-http-upload-session");
  assert.ok(tinyPlan.transportPlan.fallbackOrder.includes("mcp-inline-content"));
  assert.ok(moduleIds(tinyPlan).has("transport-mcp-inline"));
}

function verifySelectivePullBundle() {
  const pull = buildClientRuntimeBootstrapPull({
    clientUid: "missing-local-runtime",
    client: {
      os: "linux",
      arch: "x64",
      availableCommands: ["rsync", "ssh"]
    },
    serverCapabilities: {
      ssh: true,
      rsync: true
    },
    modules: ["mcp-local-bridge"],
    transfer: {
      directory: true,
      incremental: true,
      totalBytes: 128 * 1024 * 1024,
      fileCount: 60
    }
  });

  assert.equal(pull.operation, "client_runtime.bootstrap.pull");
  assert.equal(pull.installation.artifactStatus, "inline-manifest");
  assert.equal(pull.installation.requiresProcessIdentityProvisioning, true);
  assert.equal(pull.installation.processIdentity.privateKeySource, "client-generated-ed25519");
  assert.equal(pull.installation.processIdentity.claimEndpoint, "/api/process-identity/bootstrap/claim");
  assert.equal(pull.pull.mode, "selective-trimmed-client-runtime");
  assert.equal(pull.pull.completeClient, false);
  assert.equal(pull.pull.includesServerRepository, false);
  assert.equal(pull.transportPlan.selected, "rsync-over-ssh");
  assert.equal(pull.artifacts.length, pull.modules.length);
  assert.match(pull.bundle.digestSha256, /^[a-f0-9]{64}$/);

  const modules = moduleIds(pull);
  assert.ok(modules.has("runtime-framework"));
  assert.ok(modules.has("pact-client-cli"));
  assert.ok(modules.has("clientd"));
  assert.ok(modules.has("upload-queue"));
  assert.ok(modules.has("mcp-local-bridge"));
  assert.equal(modules.has("connectors"), false, "pull must not include unrequested connector modules");
  for (const artifact of pull.artifacts) {
    assert.match(artifact.digestSha256, /^[a-f0-9]{64}$/);
    assert.equal(artifact.status, "inline-manifest");
    assert.equal(artifact.signature.required, true);
    assert.equal(artifact.inlineManifest.constraints.completeClient, false);
    assert.equal(artifact.inlineManifest.constraints.includesServerRepository, false);
  }
}

function verifyOperationRegistry() {
  const operations = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  const planOperation = operations.get("client_runtime.bootstrap.plan");
  assert.ok(planOperation, "client_runtime.bootstrap.plan operation must be registered");
  assert.equal(planOperation.http.path, "/api/client-runtime/bootstrap/plan");
  assert.equal(planOperation.http.method, "POST");
  assert.equal(planOperation.readOnly, true);
  assert.ok(planOperation.requiredScopes.includes("knowledge:read"));

  const pullOperation = operations.get("client_runtime.bootstrap.pull");
  assert.ok(pullOperation, "client_runtime.bootstrap.pull operation must be registered");
  assert.equal(pullOperation.http.path, "/api/client-runtime/bootstrap/pull");
  assert.equal(pullOperation.http.method, "POST");
  assert.equal(pullOperation.readOnly, true);
  assert.ok(pullOperation.requiredScopes.includes("knowledge:read"));

  const claimOperation = operations.get("process_identity.bootstrap_claim");
  assert.ok(claimOperation, "process_identity.bootstrap_claim operation must be registered");
  assert.equal(claimOperation.http.path, "/api/process-identity/bootstrap/claim");
  assert.equal(claimOperation.public, true);

  const rotateOperation = operations.get("process_identity.package.rotate");
  assert.ok(rotateOperation, "process_identity.package.rotate operation must be registered");
  assert.equal(rotateOperation.processIdentity?.required, true);
  assert.equal(rotateOperation.processIdentity?.authorizes, true);

  const revokeOperation = operations.get("process_identity.package.revoke");
  assert.ok(revokeOperation, "process_identity.package.revoke operation must be registered");
  assert.equal(revokeOperation.processIdentity?.required, true);
  assert.equal(revokeOperation.processIdentity?.authorizes, true);
}

function verifyToolCatalogExposure() {
  const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
  const planTool = catalog.tools.find((item) => item.id === "pact.clientRuntime.bootstrapPlan");
  assert.ok(planTool, "pact.clientRuntime.bootstrapPlan tool must be exposed");
  assert.ok(planTool.requiredScopes.includes("knowledge:read"));
  assert.ok(planTool.toolsets.includes("pact.agentLibrary.read"));

  const pullTool = catalog.tools.find((item) => item.id === "pact.clientRuntime.bootstrapPull");
  assert.ok(pullTool, "pact.clientRuntime.bootstrapPull tool must be exposed");
  assert.ok(pullTool.requiredScopes.includes("knowledge:read"));
  assert.ok(pullTool.toolsets.includes("pact.agentLibrary.read"));
}

async function verifyHttpEndpoint() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-client-runtime-bootstrap-"));
  const server = await startHttpServer({
    userDataPath,
    runtimeOptions: { profile: "minimal" }
  });
  await installAuthenticatedFetch(server);
  try {
    const response = await fetchJson(`${server.url}/api/client-runtime/bootstrap/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientUid: "http-linux-agent",
        client: {
          os: "linux",
          arch: "x64",
          availableCommands: ["rsync", "ssh"]
        },
        serverCapabilities: {
          ssh: true,
          rsync: true
        },
        modules: ["mcp-local-bridge"],
        transfer: {
          directory: true,
          incremental: true,
          totalBytes: 32 * 1024 * 1024,
          fileCount: 12
        }
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.transportPlan.selected, "rsync-over-ssh");
    assert.ok(response.payload.modules.some((module) => module.moduleId === "mcp-local-bridge"));

    const pullResponse = await fetchJson(`${server.url}/api/client-runtime/bootstrap/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientUid: "http-missing-local-runtime",
        client: {
          os: "linux",
          arch: "x64",
          availableCommands: []
        },
        modules: ["mcp-local-bridge"],
        transfer: {
          totalBytes: 2 * 1024 * 1024,
          fileCount: 1
        }
      })
    });
    assert.equal(pullResponse.status, 200);
    assert.equal(pullResponse.payload.operation, "client_runtime.bootstrap.pull");
    assert.equal(pullResponse.payload.pull.completeClient, false);
    assert.ok(pullResponse.payload.artifacts.some((artifact) => artifact.moduleId === "mcp-local-bridge"));
  } finally {
    await server.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

verifyNativeTransportPriority();
verifyScpSmallFileFallback();
verifyPortableFallbacks();
verifySelectivePullBundle();
verifyOperationRegistry();
verifyToolCatalogExposure();
await verifyHttpEndpoint();

console.log("[client-runtime-bootstrap] ok");
