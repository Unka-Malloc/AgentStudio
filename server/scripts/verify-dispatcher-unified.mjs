import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import {
  findProxyRegisteredApiRequest,
  shouldProxyRegisteredApiRequest
} from "../platform/common/operation-dispatcher/operation-dispatcher.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createOperationAuditStore } from "../platform/common/security/operation-audit.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function* walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "build", ".git"].includes(entry.name)) {
        continue;
      }
      yield* walk(filePath);
      continue;
    }
    if (entry.isFile() && filePath.endsWith(".mjs")) {
      yield filePath;
    }
  }
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

async function assertStaticDispatcherGuard() {
  const dispatcherPath = path.join(repoRoot, "server", "platform", "common", "operation-dispatcher", "operation-dispatcher.mjs");
  const dispatcherSource = await readText(dispatcherPath);
  const clientRegistrySource = await readText(
    path.join(repoRoot, "server", "platform", "common", "storage", "client-registry-repository.mjs")
  );
  const mobileRelaySource = await readText(
    path.join(repoRoot, "server", "platform", "common", "mobile-relay", "index.mjs")
  );
  const selfPath = fileURLToPath(import.meta.url);
  const offenders = [];
  for await (const filePath of walk(path.join(repoRoot, "server"))) {
    const text = await readText(filePath);
    if (filePath !== dispatcherPath && filePath !== selfPath && text.includes("invokeRegisteredOperation")) {
      offenders.push(path.relative(repoRoot, filePath));
    }
  }
  assert.deepEqual(offenders, [], "invokeRegisteredOperation must stay private to OperationDispatcher");
  assert.equal(dispatcherSource.includes("createRiskControlOperationEnvelope"), true);
  assert.equal(dispatcherSource.includes("appendRiskControlGateRecord"), true);
  assert.equal(dispatcherSource.includes("operation_authorizer_missing"), true);
  assert.equal(dispatcherSource.includes("findProxyRegisteredApiRequest"), true);
  assert.equal(dispatcherSource.includes("item.http.method === normalizedMethod"), true);
  assert.equal(dispatcherSource.includes("operation.externalAuth === true"), true);
  assert.equal(dispatcherSource.includes("RPC 方法不存在：${payload.method"), false);

  const httpServer = await readText(path.join(repoRoot, "server", "services", "server-runtime", "http-server.mjs"));
  assert.equal(
    httpServer.includes("handledToolManagement = await toolManagementPlatform.router.handleToolManagementHttpRequest"),
    false,
    "HTTP server must not route Tool Management around OperationDispatcher"
  );
  assert.equal(httpServer.includes("registeredCoreProvider.findProxyRegisteredApiRequest"), true);
  assert.equal(httpServer.includes("securityPermissions.authorizeOperation"), true);
  assert.equal(httpServer.includes("http.proxy.denied"), true);

  const allowedPublicWrites = new Map([
    ["auth.login", { method: "POST", path: "/api/auth/login" }],
    ["discovery.check_in", { method: "POST", path: "/api/discovery/check-in" }],
    ["mobile_relay.pairing.create", { method: "POST", path: "/api/mobile-relay/pairings" }],
    ["mobile_relay.pairing.claim", { method: "POST", path: "/api/mobile-relay/pairings/claim" }]
  ]);
  const publicWriteOperations = SERVER_API_OPERATIONS.filter(
    (operation) => operation.public === true && operation.readOnly !== true
  );
  assert.deepEqual(
    publicWriteOperations.map((operation) => operation.id).sort(),
    [...allowedPublicWrites.keys()].sort(),
    "public state-changing operations must stay explicitly reviewed"
  );
  for (const operation of publicWriteOperations) {
    const expected = allowedPublicWrites.get(operation.id);
    assert.equal(operation.http?.method, expected.method, `${operation.id} public write method changed`);
    assert.equal(operation.http?.path, expected.path, `${operation.id} public write path changed`);
    assert.equal(operation.safety?.risk, "safe_write", `${operation.id} public write risk must be bounded`);
    assert.equal(operation.externalAuth, false, `${operation.id} public write must not bypass into external auth`);
    assert.deepEqual(operation.requiredScopes || [], [], `${operation.id} public write must not fake scoped auth`);
  }
  const csrfBypassOperations = SERVER_API_OPERATIONS.filter((operation) => operation.skipCsrf === true);
  assert.deepEqual(
    csrfBypassOperations.map((operation) => operation.id).sort(),
    ["auth.login"],
    "CSRF bypass must stay limited to the public login admission endpoint"
  );
  assert.match(httpServer, /httpRateLimitLoginPerIpPerMinute/, "public login must stay rate limited");
  assert.match(clientRegistrySource, /MAX_PACT_CLIENT_REGISTRATIONS/, "public client check-in must stay capacity limited");
  assert.match(clientRegistrySource, /client_registration_capacity_exceeded/, "public client check-in must fail closed on capacity");
  assert.match(mobileRelaySource, /MAX_PACT_MOBILE_RELAY_PAIRING_TTL_MS/, "public relay pairing TTL must stay capped");
  assert.match(mobileRelaySource, /MAX_PACT_MOBILE_RELAY_PAIRINGS/, "public relay pairing store must stay capacity limited");
  assert.match(mobileRelaySource, /mobile_relay_pairing_capacity_exceeded/, "public relay pairing must fail closed on capacity");
  assert.match(mobileRelaySource, /PAIRING_CODE_PATTERN/, "public relay pairing code must stay format-checked");
  assert.match(mobileRelaySource, /timingSafeStringEqual/, "public relay pairing secrets must use timing-safe comparison");

  const toolRuntime = await readText(
    path.join(repoRoot, "server", "platform", "specialized", "capabilities", "tools", "tool-management-core", "runtime.mjs")
  );
  assert.equal(toolRuntime.includes("dispatchOperation({"), true);
  assert.equal(toolRuntime.includes("invokeRegisteredOperation"), false);

  const maintenanceTools = await readText(
    path.join(repoRoot, "server", "services", "agent", "maintenance-agent", "tool-registry.mjs")
  );
  assert.equal(maintenanceTools.includes("dispatchOperation({"), true);
  assert.equal(maintenanceTools.includes(".run(input"), false);

  const forwardDiscoveryState = {
    mode: "forward",
    advertisedBaseUrl: "http://127.0.0.1:10000",
    activeServiceUrl: "http://127.0.0.1:10001",
    forwardBaseUrl: "http://127.0.0.1:10001"
  };
  const proxyDecision = findProxyRegisteredApiRequest({
    method: "GET",
    pathname: "/api/runtime/info",
    discoveryState: forwardDiscoveryState,
    operations: SERVER_API_OPERATIONS
  });
  assert.equal(proxyDecision?.operation?.id, "runtime.info");
  assert.equal(
    shouldProxyRegisteredApiRequest({
      method: "POST",
      pathname: "/api/runtime/info",
      discoveryState: forwardDiscoveryState,
      operations: SERVER_API_OPERATIONS
    }),
    false,
    "forward proxy must not match by path without HTTP method"
  );
}

async function main() {
  await assertStaticDispatcherGuard();
  for (const operation of SERVER_API_OPERATIONS) {
    assert.ok(operation.log?.redaction, `${operation.id} must declare log redaction policy`);
    if (operation.externalAuth === true) {
      assert.ok(operation.externalAuthVerifier?.method, `${operation.id} must declare externalAuthVerifier.method`);
    }
  }

  const migrationDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-operation-audit-migration-"));
  const securityDir = path.join(migrationDir, "security");
  await fs.mkdir(securityDir, { recursive: true });
  const legacyDb = new Database(path.join(securityDir, "operation-audit.sqlite"));
  legacyDb.exec(`
    CREATE TABLE operation_audit_log (
      audit_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      transport TEXT NOT NULL,
      actor_json TEXT NOT NULL DEFAULT '{}',
      risk TEXT NOT NULL DEFAULT '',
      read_only INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      input_hash TEXT NOT NULL DEFAULT '',
      redacted_input_json TEXT NOT NULL DEFAULT '{}',
      redacted_output_summary_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  legacyDb.close();
  const migratedStore = createOperationAuditStore({ userDataPath: migrationDir });
  migratedStore.append({
    operationId: "verify.migration",
    transport: "test",
    traceId: "trace_verify",
    requestId: "request_verify",
    status: "ok"
  });
  assert.equal(migratedStore.list({ operationId: "verify.migration" })[0].traceId, "trace_verify");
  migratedStore.close();
  await fs.rm(migrationDir, { recursive: true, force: true });

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-dispatcher-unified-"));
  const originalCapabilityKernelEnv = {
    PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER,
    PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER: process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER,
    PACT_OPAQUE_CAPABILITY_KEY_PROVIDER: process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER,
    PACT_CAPABILITY_BINDING_GUARD_PROVIDER: process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER
  };
  process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
  process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER = "local-file";
  const server = await startHttpServer({
    userDataPath,
    runtimeOptions: { profile: "minimal" }
  });
  try {
    const auth = await installAuthenticatedFetch(server);
    const health = await requestJson(`${server.url}/api/healthz`);
    assert.equal(health.status, 200);
    assert.ok(health.headers.get("x-pact-trace-id"));

    const rpcHealth = await requestJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dispatcher-rpc-health",
        method: "system.health",
        params: {}
      })
    });
    assert.equal(rpcHealth.status, 200);
    assert.equal(rpcHealth.payload.jsonrpc, "2.0");

    const unknownRpc = await requestJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dispatcher-rpc-unknown",
        method: "unknown /home/private/report.txt --token rpc_private_token",
        params: {}
      })
    });
    assert.equal(unknownRpc.status, 404);
    assert.equal(JSON.stringify(unknownRpc.payload).includes("rpc_private_token"), false);

    const grant = await requestJson(`${server.url}/api/tool-management/v1/grants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST", safetyConfirm: true })
      },
      body: JSON.stringify({
        label: "dispatcher-unified",
        scopes: ["knowledge:read"]
      })
    });
    assert.equal(grant.status, 201);
    assert.ok(grant.payload.token);

    const tool = await requestJson(`${server.url}/api/tool-management/v1/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${grant.payload.token}`
      },
      body: JSON.stringify({
        toolId: "pact.agentLibrary.health",
        input: {}
      })
    });
    assert.equal(tool.status, 200);
    assert.equal(tool.payload.schemaVersion, "v0.0.1:schema:definition-1");

    const audit = await requestJson(`${server.url}/api/auth/audit?limit=300`, {
      headers: authHeaders(auth)
    });
    assert.equal(audit.status, 200);
    const entries = audit.payload.items || [];
    for (const operationId of ["system.health", "tool_management.create_grant", "tool_management.execute"]) {
      assert.ok(
        entries.some((entry) => entry.operationId === operationId && entry.traceId),
        `central audit missing traced ${operationId}`
      );
      const tracedEntry = entries.find((entry) => entry.operationId === operationId && entry.traceId);
      assert.ok(
        tracedEntry?.riskControl?.anchorDigest?.startsWith("sha256:v0.0.1:strategy:risk-control-operation-anchor-1:"),
        `central audit missing Risk Control anchor for ${operationId}`
      );
      assert.ok(
        tracedEntry?.riskControl?.lastRecordDigest?.startsWith("sha256:v0.0.1:strategy:risk-control-gate-record-1:"),
        `central audit missing Risk Control hash-chain tail for ${operationId}`
      );
      assert.ok(
        Number(tracedEntry?.riskControl?.gateCount || 0) >= 5,
        `central audit missing Risk Control lifecycle gates for ${operationId}`
      );
      const lastGate = tracedEntry?.riskControl?.envelope?.gateRecords?.at(-1);
      assert.equal(lastGate?.gate, "audit-recover", `central audit should end ${operationId} with audit-recover`);
    }
  } finally {
    await server.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalCapabilityKernelEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

await main();
console.log("dispatcher-unified verification passed");
