import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch, readInitialOwnerCredentials } from "./test-auth-helper.mjs";
import { createRuntimeLogger } from "../platform/common/observability/runtime-logger.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

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

async function readRuntimeLogs(logDir) {
  const entries = await fs.readdir(logDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^pact-.+\.jsonl$/.test(entry.name))
    .map((entry) => path.join(logDir, entry.name))
    .sort();
  const records = [];
  let text = "";
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    text += content;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      records.push(JSON.parse(line));
    }
  }
  return { files, records, text };
}

function hasEvent(records, event) {
  return records.some((record) => record.event === event);
}

function assertHasEvents(records, events) {
  for (const event of events) {
    assert.equal(hasEvent(records, event), true, `runtime log missing event ${event}`);
  }
}

async function removeTempDir(dirPath) {
  await fs.rm(dirPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  });
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-logging-data-"));
const logDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-logging-logs-"));
const staleLogPath = path.join(logDir, "pact-stale-2000-01-01.jsonl");
await fs.writeFile(staleLogPath, JSON.stringify({ event: "old" }) + "\n", "utf8");
const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
await fs.utimes(staleLogPath, staleDate, staleDate);
const policyLogger = createRuntimeLogger({
  userDataPath,
  runtimeOptions: {
    logDir,
    logLevel: "warn",
    logMaxFileBytes: 1024 * 1024,
    logMaxTotalBytes: 2 * 1024 * 1024
  },
  component: "policy"
});
assert.equal(policyLogger.level, "warn");
assert.equal(policyLogger.maxFileBytes, 1024 * 1024);
assert.equal(policyLogger.maxTotalBytes, 2 * 1024 * 1024);
policyLogger.setLevel("debug");
assert.equal(policyLogger.level, "debug");
await policyLogger.close();

let server = null;
try {
  server = await startHttpServer({
    userDataPath,
    distPath: "",
    host: "127.0.0.1",
    port: 0,
    runtimeOptions: {
      profile: "minimal",
      cwd: repoRoot,
      logDir
    },
    discoveryOptions: {
      mode: "active"
    }
  });
  const ownerCredentials = await readInitialOwnerCredentials(server);
  const ownerPassword = ownerCredentials.password;
  assert.ok(ownerPassword);
  const auth = await installAuthenticatedFetch(server);

  const health = await requestJson(`${server.url}/api/healthz`);
  assert.equal(health.status, 200);

  const interfaces = await requestJson(`${server.url}/api/interfaces`);
  assert.equal(interfaces.status, 200);

  const rpc = await requestJson(`${server.url}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify-runtime-logging-rpc",
      method: "system.health",
      params: {}
    })
  });
  assert.equal(rpc.status, 200);
  assert.equal(rpc.payload.jsonrpc, "2.0");

  const settings = await requestJson(`${server.url}/api/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      analysisModuleId: "builtin:runtime-logging",
      customHttpAdapter: {
        alias: "runtime-logging",
        url: "http://127.0.0.1:65530/agent",
        token: "runtime-logging-secret-token-12345"
      }
    })
  });
  assert.equal(settings.status, 200);

  const maintenanceRun = await requestJson(`${server.url}/api/maintenance-agent/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      runbook: "health_smoke",
      wait: false
    })
  });
  assert.equal(maintenanceRun.status, 200);

  const grant = await requestJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      label: "verify-runtime-logging",
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
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(tool.status, 200);

  const job = await requestJson(`${server.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: "Runtime logging verification ingest smoke.",
      uploadedFiles: [],
      settings: {}
    })
  });
  assert.equal(job.status, 202);
  assert.ok(job.payload.id);

  const events = await requestJson(`${server.url}/api/events?includeSnapshot=1&limit=10`);
  assert.equal(events.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 350));
  await server.close();
  server = null;

  await assert.rejects(fs.access(staleLogPath), /ENOENT/);
  const { files, records, text } = await readRuntimeLogs(logDir);
  assert.ok(files.length >= 1, "runtime logger did not create JSONL files");
  assert.ok(records.length >= 20, `expected detailed runtime logs, got ${records.length}`);
  assertHasEvents(records, [
    "server.start.requested",
    "server.listen.ready",
    "server.started",
    "http.request.started",
    "http.request.completed",
    "operation.http.matched",
    "operation.rpc.matched",
    "operation.rpc.completed",
    "event.publish.enqueued",
    "event.publish.persisted",
    "event.subscribe.requested",
    "event.subscribe.completed",
    "state.queue.enqueued",
    "state.queue.completed",
    "maintenance.agent.plan.created",
    "maintenance.agent.queue.enqueued",
    "tool_management.http.requested",
    "tool_management.execute.started",
    "tool_management.execute.completed",
    "jobs.job.create.requested",
    "jobs.queue.enqueued",
    "server.close.completed"
  ]);

  assert.equal(text.includes(ownerPassword), false, "owner password leaked into runtime logs");
  assert.equal(
    text.includes("runtime-logging-secret-token-12345"),
    false,
    "settings token leaked into runtime logs"
  );
  assert.equal(text.includes(grant.payload.token), false, "tool grant token leaked into runtime logs");
  assert.equal(text.includes(auth.csrf), false, "CSRF token leaked into runtime logs");

  console.log(`Runtime logging verification passed. logs=${files.length} records=${records.length}`);
} finally {
  if (server) {
    await server.close();
  }
  await removeTempDir(userDataPath);
  await removeTempDir(logDir);
}
