import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { evaluateOperationSafety } from "../platform/common/operation-dispatcher/operation-decorators.mjs";
import { SERVER_API_OPERATIONS, listInterfaceCatalog } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

async function main() {
  const catalog = listInterfaceCatalog(SERVER_API_OPERATIONS);
  assert.equal(catalog.length, SERVER_API_OPERATIONS.length);
  for (const operation of SERVER_API_OPERATIONS) {
    assert.equal(typeof operation.safety?.risk, "string", operation.id);
    assert.equal(typeof operation.readOnly, "boolean", operation.id);
    assert.equal(typeof operation.destructive, "boolean", operation.id);
    assert.equal(typeof operation.concurrencySafe, "boolean", operation.id);
    assert.ok(Array.isArray(operation.requiredScopes), operation.id);
    assert.ok(operation.audit && typeof operation.audit === "object", operation.id);
    assert.ok(operation.inputSchema && typeof operation.inputSchema === "object", operation.id);
    assert.equal(typeof operation.public, "boolean", operation.id);
    assert.equal(typeof operation.externalAuth, "boolean", operation.id);
    if (operation.requiredScopes.length === 0) {
      assert.equal(
        operation.public === true || operation.externalAuth === true,
        true,
        `${operation.id} must be explicitly public or externally authenticated`
      );
    }
    if (!operation.readOnly) {
      assert.notEqual(operation.audit.enabled, false, operation.id);
    }
    if (operation.destructive) {
      assert.equal(operation.safety.blocked, true, operation.id);
    }
  }

  const byId = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  const repair = byId.get("expert_vocabulary.set");
  const deniedRepair = evaluateOperationSafety({
    operation: repair,
    requestBody: Buffer.from("{}"),
    authEnabled: true,
    authSession: { user: { scopes: ["runtime:admin", "maintenance:approve"] } }
  });
  assert.equal(deniedRepair.ok, false);
  assert.equal(deniedRepair.status, 428);
  const upload = byId.get("agent_workspaces.file.upload");
  assert.ok(upload, "agent_workspaces.file.upload must be registered");
  assert.equal(upload.requiredScopes.includes("storage:write"), true);
  assert.equal(upload.readOnly, false);
  assert.equal(upload.safety.risk, "safe_write");
  assert.equal(upload.safety.requiresConfirmation, false);
  assert.equal(upload.public, false);

  const disabledDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-auth-disabled-"));
  await assert.rejects(
    () => startHttpServer({
      userDataPath: disabledDir,
      runtimeOptions: { profile: "minimal", consoleAuth: "disabled" }
    }),
    /PACT_CONSOLE_AUTH=disabled/
  );

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-operation-policy-"));
  const server = await startHttpServer({
    userDataPath,
    runtimeOptions: { profile: "minimal" }
  });
  try {
    const noAuthEvents = await requestJson(`${server.url}/api/events?includeSnapshot=1`);
    assert.equal(noAuthEvents.status, 401);

    const noAuthRpcInterfaces = await requestJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "interfaces",
        method: "system.interfaces",
        params: {}
      })
    });
    assert.equal(noAuthRpcInterfaces.status, 200);
    assert.equal(noAuthRpcInterfaces.payload.error.code, 401);

    const noAuthWrite = await requestJson(`${server.url}/api/maintenance-agent/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(noAuthWrite.status, 401);

    const auth = await installAuthenticatedFetch(server, { safetyConfirm: false });

    const missingConfirm = await requestJson(`${server.url}/api/maintenance-agent/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST", safetyConfirm: false })
      },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(missingConfirm.status, 428);
    assert.equal(missingConfirm.payload.operationId, "maintenance_agent.config.set");

    const confirmed = await requestJson(`${server.url}/api/maintenance-agent/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST", safetyConfirm: true })
      },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(confirmed.status, 200);

    const rpc = await requestJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST", safetyConfirm: true })
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "interfaces",
        method: "system.interfaces",
        params: {}
      })
    });
    assert.equal(rpc.status, 200);
    const registeredOperationIds = new Set(SERVER_API_OPERATIONS.map((operation) => operation.id));
    assert.ok(rpc.payload.result.interfaces.length > 0);
    assert.ok(rpc.payload.result.interfaces.length <= SERVER_API_OPERATIONS.length);
    assert.ok(rpc.payload.result.interfaces.every((item) => registeredOperationIds.has(item.id)));
    assert.ok(rpc.payload.result.interfaces.every((item) => item.audit && item.inputSchema));

    const audit = await requestJson(`${server.url}/api/auth/audit?limit=200`, {
      headers: authHeaders(auth)
    });
    assert.equal(audit.status, 200);
    assert.ok(
      audit.payload.items.some((item) => item.operationId === "maintenance_agent.config.set" && item.status === "ok")
    );
    assert.ok(
      audit.payload.items.some((item) => item.operationId === "maintenance_agent.config.set" && item.status === "denied")
    );
  } finally {
    await server.close();
  }
}

await main();
console.log("operation-policy verification passed");
