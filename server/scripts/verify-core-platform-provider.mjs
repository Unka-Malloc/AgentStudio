import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  CORE_PLATFORM_PROTOCOL_VERSION,
  createCorePlatformProvider
} from "../platform/common/platform-core/core-platform-provider.mjs";
import { createPlatformRegistry } from "../platform/interactive/platform-registry.mjs";
import { registerCorePlatformServices } from "../platform/common/platform-core/register.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function assertRegistryReady(operationRegistry) {
  assert.ok(operationRegistry?.summary?.total > 300);
  assert.equal(operationRegistry.summary.total, operationRegistry.lifecycle.length);
  assert.equal(operationRegistry.summary.registered, operationRegistry.summary.total);
  assert.equal(operationRegistry.summary.wired, operationRegistry.summary.total);
  assert.equal(operationRegistry.summary.implemented, operationRegistry.summary.total);
  assert.equal(operationRegistry.summary.verified, operationRegistry.summary.total);
  assert.equal(operationRegistry.summary.ready, true);
  for (const [stage, items] of Object.entries(operationRegistry.summary.missing || {})) {
    assert.deepEqual(items, [], `operation registry has missing ${stage} entries`);
  }
}

async function assertProviderRegistration() {
  const registry = createPlatformRegistry({ scope: "verify-core-platform" });
  const coreProvider = createCorePlatformProvider({
    operations: SERVER_API_OPERATIONS,
    operationConcurrencyScope: "verify-core-platform"
  });
  registerCorePlatformServices(registry, {
    coreProvider,
    operationConcurrencyScope: "verify-core-platform"
  });

  const provider = registry.requireInterface("core.provider").value;
  assert.equal(provider.protocolVersion, CORE_PLATFORM_PROTOCOL_VERSION);
  assert.equal(typeof provider.dispatchRegisteredHttpOperation, "function");
  assert.equal(typeof provider.dispatchRpcOperation, "function");
  assert.equal(typeof provider.dispatchInternalOperation, "function");
  assert.equal(typeof provider.describeOperationRegistry, "function");
  assert.equal(typeof registry.requireInterface("core.operations.registry").value, "function");
}

async function assertRuntimeInterfaces() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-core-platform-"));
  const server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: { profile: "minimal" }
  });
  try {
    const auth = await installAuthenticatedFetch(server);
    const httpInterfaces = await fetchJson(`${server.url}/api/interfaces`, {
      headers: authHeaders(auth)
    });
    assert.equal(httpInterfaces.status, 200);
    assert.equal(httpInterfaces.payload.protocolVersion, CORE_PLATFORM_PROTOCOL_VERSION);
    assertRegistryReady(httpInterfaces.payload.operationRegistry);

    const byId = new Map(httpInterfaces.payload.operationRegistry.lifecycle.map((entry) => [entry.id, entry]));
    for (const operationId of [
      "system.health",
      "system.interfaces",
      "discovery.get_config",
      "tool_management.execute",
      "workspace.file.upload",
      "knowledge.access.evaluate"
    ]) {
      const entry = byId.get(operationId);
      assert.ok(entry, `${operationId} must be present in operation registry lifecycle`);
      assert.equal(entry.state, "verified");
      assert.ok(entry.verificationCommands.includes("npm run server:verify:core-platform"));
      assert.ok(entry.verificationCommands.includes("npm run server:verify"));
    }

    const rpcInterfaces = await fetchJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST" })
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "core-platform-interfaces",
        method: "system.interfaces",
        params: {}
      })
    });
    assert.equal(rpcInterfaces.status, 200);
    assert.equal(rpcInterfaces.payload.result.protocolVersion, CORE_PLATFORM_PROTOCOL_VERSION);
    assertRegistryReady(rpcInterfaces.payload.result.operationRegistry);
  } finally {
    await server.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function assertHttpServerUsesCoreProvider() {
  const source = await fs.readFile(
    path.join(repoRoot, "server/services/server-runtime/http-server.mjs"),
    "utf8"
  );
  assert.equal(source.includes("operation-dispatcher/operation-dispatcher.mjs"), false);
  assert.equal(source.includes("operation-dispatcher/operation-registry.mjs"), false);
  for (const needle of [
    "registeredCoreProvider.dispatchRpcOperation",
    "registeredCoreProvider.findProxyRegisteredApiRequest",
    "registeredCoreProvider.dispatchRegisteredHttpOperation",
    "registeredCoreProvider.dispatchInternalOperation"
  ]) {
    assert.equal(source.includes(needle), true, `http-server must use core provider port: ${needle}`);
  }
}

await assertProviderRegistration();
await assertRuntimeInterfaces();
await assertHttpServerUsesCoreProvider();

console.log("core platform provider verification passed");
