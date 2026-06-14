import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSOLE_ROLES } from "../platform/common/security/auth/console-auth.mjs";
import { normalizeMaintenancePlan } from "../services/agent/maintenance-agent/planner.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { evaluateOperationSafety } from "../platform/common/operation-dispatcher/operation-decorators.mjs";
import { SERVER_API_OPERATIONS, listInterfaceCatalog } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { installAuthenticatedFetch, readInitialOwnerCredentials } from "./test-auth-helper.mjs";

const pactCliPath = fileURLToPath(new URL("./pact.mjs", import.meta.url));
const consoleAuthCliPath = fileURLToPath(new URL("./console-auth.mjs", import.meta.url));

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  return {
    ok: response.ok,
    status: response.status,
    payload,
    headers: response.headers
  };
}

async function fetchJson(url, options = {}) {
  const result = await requestJson(url, options);
  if (!result.ok) {
    throw new Error(`Request failed: ${result.status} ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

function cookieHeaderFrom(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response.headers.get("set-cookie") || "")
          .split(/,(?=\s*pact_)/)
          .filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function login(baseUrl, username, password) {
  const response = await requestJson(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200);
  return {
    cookie: cookieHeaderFrom(response),
    csrf: response.payload.csrfToken
  };
}

function authOptions(auth, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      Cookie: auth.cookie,
      ...(!["GET", "HEAD", "OPTIONS"].includes(method)
        ? { "x-pact-csrf": auth.csrf }
        : {})
    }
  };
}

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pactCliPath, ...args], {
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`pact CLI timed out: ${args.join(" ")}`));
    }, 15000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr || stdout || "pact CLI failed"));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function runAuthCli(args) {
  const result = spawnSync(process.execPath, [consoleAuthCliPath, ...args], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "console-auth CLI failed");
  }
  return result.stdout;
}

async function postJson(baseUrl, pathName, payload, auth = null) {
  return requestJson(
    `${baseUrl}${pathName}`,
    authOptions(auth || { cookie: "", csrf: "" }, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {})
    })
  );
}

function assertRoleScopes() {
  for (const scope of [
    "maintenance:read",
    "maintenance:run",
    "maintenance:approve",
    "maintenance:admin"
  ]) {
    assert.ok(CONSOLE_ROLES.owner.scopes.includes(scope));
    assert.ok(CONSOLE_ROLES.admin.scopes.includes(scope));
  }
  assert.ok(CONSOLE_ROLES.operator.scopes.includes("maintenance:read"));
  assert.ok(CONSOLE_ROLES.operator.scopes.includes("maintenance:run"));
  assert.ok(CONSOLE_ROLES.operator.scopes.includes("maintenance:approve"));
  assert.equal(CONSOLE_ROLES.operator.scopes.includes("maintenance:admin"), false);
  assert.equal(CONSOLE_ROLES.viewer.scopes.includes("maintenance:read"), false);
  assert.equal(CONSOLE_ROLES.viewer.scopes.includes("maintenance:approve"), false);
}

function assertRegistryRiskIsAuthoritative() {
  const fixtureRegistry = {
    getTool(toolId) {
      if (toolId === "knowledge.reindex") {
        return { id: toolId, risk: "repair_write" };
      }
      return null;
    }
  };
  const normalized = normalizeMaintenancePlan(
    {
      intent: "downgrade-attempt",
      summary: "Planner 尝试把重建索引降级为只读。",
      risk: "read_only",
      steps: [
        {
          toolId: "knowledge.reindex",
          input: {},
          risk: "read_only",
          reason: "malicious downgrade"
        }
      ]
    },
    fixtureRegistry
  );
  assert.equal(normalized.risk, "repair_write");
  assert.equal(normalized.steps[0].risk, "repair_write");
  assert.equal(normalized.requiresApproval, true);
}

function assertOperationDecorators() {
  const catalog = listInterfaceCatalog(SERVER_API_OPERATIONS);
  assert.equal(catalog.length, SERVER_API_OPERATIONS.length);
  assert.equal(catalog.some((operation) => !operation.safety?.risk), false);
  assert.equal(
    catalog.every((operation) => operation.aspects.includes("authorization") && operation.aspects.includes("safety")),
    true
  );

  const byId = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  assert.equal(byId.get("knowledge.reindex").safety.risk, "repair_write");
  assert.equal(byId.get("knowledge.maintenance.run").safety.risk, "safe_write");
  assert.equal(typeof byId.get("knowledge.maintenance.run").safety.resolveRisk, "function");
  assert.deepEqual(byId.get("tool_management.create_grant").requiredScopes, ["runtime:admin"]);

  const approver = { user: { scopes: ["maintenance:approve"] } };
  const nonApprover = { user: { scopes: ["knowledge:maintain"] } };
  const reindex = byId.get("knowledge.reindex");
  const missingConfirm = evaluateOperationSafety({
    operation: reindex,
    requestBody: Buffer.from("{}"),
    authEnabled: true,
    authSession: approver
  });
  assert.equal(missingConfirm.ok, false);
  assert.equal(missingConfirm.status, 428);

  const missingApproval = evaluateOperationSafety({
    operation: reindex,
    requestBody: Buffer.from(JSON.stringify({ confirm: true })),
    authEnabled: true,
    authSession: nonApprover
  });
  assert.equal(missingApproval.ok, false);
  assert.equal(missingApproval.status, 403);

  const approvedRepair = evaluateOperationSafety({
    operation: reindex,
    requestBody: Buffer.from(JSON.stringify({ confirm: true })),
    authEnabled: true,
    authSession: approver
  });
  assert.equal(approvedRepair.ok, true);

  const maintenanceRun = byId.get("knowledge.maintenance.run");
  const safeTask = evaluateOperationSafety({
    operation: maintenanceRun,
    requestBody: Buffer.from(JSON.stringify({ taskType: "validate_assets" })),
    authEnabled: true,
    authSession: nonApprover
  });
  assert.equal(safeTask.ok, true);
  assert.equal(safeTask.safety.risk, "safe_write");

  const repairTask = evaluateOperationSafety({
    operation: maintenanceRun,
    requestBody: Buffer.from(JSON.stringify({ taskType: "reindex" })),
    authEnabled: true,
    authSession: approver
  });
  assert.equal(repairTask.ok, false);
  assert.equal(repairTask.status, 428);
  assert.equal(repairTask.safety.risk, "repair_write");
}

async function verifyCoreApiRpcAndCli() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-maintenance-agent-"));
  let server = await startHttpServer({
    userDataPath,
    runtimeOptions: {
      profile: "minimal"
    }
  });
  const auth = await installAuthenticatedFetch(server);

  try {
    const config = await fetchJson(`${server.url}/api/maintenance-agent/config`);
    assert.equal(config.config.schemaVersion, "v0.0.1:schema:definition-1");
    assert.equal(config.config.enabled, false);
    assert.equal(config.config.autoApproveRisk, "safe_write");
    assert.ok(config.config.runbooks.health_smoke);

    const savedConfig = await fetchJson(`${server.url}/api/maintenance-agent/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...config.config,
        enabled: true,
        scheduler: { tickSeconds: 1 },
        schedules: config.config.schedules.map((schedule) => ({
          ...schedule,
          enabled: false
        }))
      })
    });
    assert.equal(savedConfig.config.enabled, true);
    assert.equal(savedConfig.config.scheduler.tickSeconds, 1);

    const consoleState = await fetchJson(`${server.url}/api/console/state`);
    assert.ok(consoleState.maintenanceAgent);
    assert.ok(consoleState.maintenanceAgent.tools.some((tool) => tool.id === "knowledge.reindex"));

    const healthChat = await fetchJson(`${server.url}/api/maintenance-agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "检查服务端健康，路径 /Users/example/.pact/token-secret 不应进入审计明文"
      })
    });
    assert.equal(healthChat.run.status, "completed");
    assert.equal(healthChat.run.risk, "read_only");
    assert.ok(healthChat.run.steps.some((step) => step.toolId === "system.health"));

  const rpcList = await fetchJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "maintenance_agent.runs.list",
        params: { limit: 5 }
      })
    });
    assert.equal(rpcList.jsonrpc, "2.0");
    assert.ok(rpcList.result.items.length >= 1);

    const maliciousGatewayDowngrade = await fetchJson(`${server.url}/api/maintenance-agent/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...savedConfig.config,
        plannerMode: "fixed_runbook"
      })
    });
    assert.equal(maliciousGatewayDowngrade.config.plannerMode, "fixed_runbook");

    const cliRuns = await runCli(["--server-url", server.url, "maintenance-agent", "runs", "--limit", "5"]);
    assert.ok(cliRuns.items.length >= 1);
    const cliChat = await runCli([
      "--server-url",
      server.url,
      "maintenance-agent",
      "chat",
      "--message",
      "检查服务端健康"
    ]);
    assert.equal(cliChat.run.status, "completed");

    const approvalPlan = await fetchJson(`${server.url}/api/maintenance-agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "请重建知识库索引"
      })
    });
    assert.equal(approvalPlan.run.status, "awaiting_approval");
    assert.equal(approvalPlan.run.requiresApproval, true);
    assert.equal(approvalPlan.run.risk, "repair_write");
    assert.ok(approvalPlan.run.plan.steps.some((step) => step.toolId === "knowledge.reindex"));

    const badApprove = await requestJson(
      `${server.url}/api/maintenance-agent/runs/${approvalPlan.run.runId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planHash: "bad-hash" })
      }
    );
    assert.equal(badApprove.status, 409);

    const approved = await fetchJson(
      `${server.url}/api/maintenance-agent/runs/${approvalPlan.run.runId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planHash: approvalPlan.run.planHash })
      }
    );
    assert.ok(["completed", "completed_with_errors"].includes(approved.run.status));

    const cancelPlan = await fetchJson(`${server.url}/api/maintenance-agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "重新索引知识库"
      })
    });
    assert.equal(cancelPlan.run.status, "awaiting_approval");
    const cancelled = await fetchJson(
      `${server.url}/api/maintenance-agent/runs/${cancelPlan.run.runId}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "verify" })
      }
    );
    assert.equal(cancelled.run.status, "cancelled");

    const directRepairRun = await fetchJson(`${server.url}/api/maintenance-agent/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runbook: "knowledge_maintenance_review",
        options: { includeReindex: true }
      })
    });
    assert.equal(directRepairRun.status, "awaiting_approval");
    assert.equal(directRepairRun.risk, "repair_write");

    const events = await fetchJson(
      `${server.url}/api/events?topic=maintenance.agent.run.completed&includeSnapshot=1&limit=20`
    );
    assert.ok(
      [...(events.snapshots || []), ...(events.events || [])].some(
        (event) => event.topic === "maintenance.agent.run.completed"
      )
    );

    const auditText = await fs.readFile(path.join(userDataPath, "maintenance-agent-audit.jsonl"), "utf8");
    assert.equal(auditText.includes("/Users/example"), false);
    assert.equal(auditText.includes("token-secret"), false);
    assert.ok(auditText.includes("<redacted-path>"));

    const runsText = await fs.readFile(path.join(userDataPath, "maintenance-agent-runs.jsonl"), "utf8");
    assert.ok(runsText.includes("maintenance_run_"));
    assert.equal(runsText.includes("/Users/example"), false);

    const currentConfig = (await fetchJson(`${server.url}/api/maintenance-agent/config`)).config;
    await fetchJson(`${server.url}/api/maintenance-agent/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...currentConfig,
        enabled: true,
        scheduler: { tickSeconds: 1 },
        schedules: currentConfig.schedules.map((schedule, index) => ({
          ...schedule,
          enabled: index === 0,
          runbook: "failed_jobs_review",
          intervalMinutes: 1,
          nextRunAt: index === 0 ? new Date(Date.now() - 1000).toISOString() : ""
        }))
      })
    });
    let scheduledRun = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const runs = await fetchJson(`${server.url}/api/maintenance-agent/runs?limit=20`);
      scheduledRun = runs.items.find((run) => run.trigger === "schedule");
      if (scheduledRun) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(scheduledRun);
    assert.ok(["completed", "completed_with_errors", "running", "queued"].includes(scheduledRun.status));

    await server.close();
    server = null;
    server = await startHttpServer({
      userDataPath,
      runtimeOptions: {
        profile: "minimal"
      }
    });
    await installAuthenticatedFetch(server, { auth });
    const restoredRuns = await fetchJson(`${server.url}/api/maintenance-agent/runs?limit=20`);
    assert.ok(restoredRuns.items.some((run) => run.runId === scheduledRun.runId));
  } finally {
    if (server) {
      await server.close();
    }
  }
}

async function verifyAuthScopes() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-maintenance-auth-"));
  const server = await startHttpServer({
    userDataPath,
    runtimeOptions: {
      profile: "minimal"
    }
  });

  try {
    const ownerCredentials = await readInitialOwnerCredentials(server);
    const ownerPassword = ownerCredentials.password;
    assert.ok(ownerPassword);
    const owner = await login(server.url, ownerCredentials.username, ownerPassword);
    runAuthCli([
      "create-user",
      "--data-dir",
      userDataPath,
      "--username",
      "viewer1",
      "--display-name",
      "Viewer One",
      "--role",
      "viewer",
      "--password",
      "viewer-password-123"
    ]);
    const viewer = await login(server.url, "viewer1", "viewer-password-123");

    const ownerPlan = await postJson(
      server.url,
      "/api/maintenance-agent/chat",
      { message: "请重建知识库索引" },
      owner
    );
    assert.equal(ownerPlan.status, 200);
    assert.equal(ownerPlan.payload.run.status, "awaiting_approval");

    const directRepairWithoutConfirm = await postJson(
      server.url,
      "/api/knowledge/maintenance/run",
      { taskType: "reindex" },
      owner
    );
    assert.equal(directRepairWithoutConfirm.status, 428);
    assert.equal(directRepairWithoutConfirm.payload.operationId, "knowledge.maintenance.run");
    assert.equal(directRepairWithoutConfirm.payload.safety.risk, "repair_write");

    const viewerApprove = await postJson(
      server.url,
      `/api/maintenance-agent/runs/${ownerPlan.payload.run.runId}/approve`,
      { planHash: ownerPlan.payload.run.planHash },
      viewer
    );
    assert.equal(viewerApprove.status, 403);

    const ownerApprove = await postJson(
      server.url,
      `/api/maintenance-agent/runs/${ownerPlan.payload.run.runId}/approve`,
      { planHash: ownerPlan.payload.run.planHash },
      owner
    );
    assert.equal(ownerApprove.status, 200);
  } finally {
    await server.close();
  }
}

assertRoleScopes();
assertRegistryRiskIsAuthoritative();
assertOperationDecorators();
await verifyCoreApiRpcAndCli();
await verifyAuthScopes();

console.log("maintenance-agent verification passed");
