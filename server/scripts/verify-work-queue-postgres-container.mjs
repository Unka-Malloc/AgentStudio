#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  createManualQueueTimeSource,
  createPostgresWorkQueueStore,
  createQueueDefinitionRegistry,
  WORK_QUEUE_STATES
} from "../platform/common/resource-management/work-queue/index.mjs";

const runId = `${process.pid}-${Date.now()}`;
const containerName = `pact-work-queue-postgres-${runId}`;
const image = process.env.PACT_WORK_QUEUE_POSTGRES_IMAGE || "postgres:16-alpine";

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(options.env || {}) }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, Number(options.timeoutMs || 120000));
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (options.stream) process.stderr.write(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed code=${code} signal=${signal || ""}\n${stdout}\n${stderr}`));
    });
  });
}

async function docker(args = [], options = {}) {
  return run("docker", args, options);
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

async function waitForPostgres(connectionString) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const store = await createPostgresWorkQueueStore({ connectionString });
      await store.close();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError || new Error("postgres did not become ready");
}

async function main() {
  await docker(["image", "inspect", image]).catch(() => docker(["pull", image], { timeoutMs: 900000, stream: true }));
  const port = await freePort();
  const connectionString = `postgresql://pact:pact@127.0.0.1:${port}/pact`;
  let started = false;
  try {
    await docker([
      "run", "-d",
      "--name", containerName,
      "-e", "POSTGRES_USER=pact",
      "-e", "POSTGRES_PASSWORD=pact",
      "-e", "POSTGRES_DB=pact",
      "-p", `${port}:5432`,
      image
    ], { timeoutMs: 120000 });
    started = true;
    await waitForPostgres(connectionString);

    const timeSource = createManualQueueTimeSource(1000);
    const store = await createPostgresWorkQueueStore({
      connectionString,
      timeSource,
      policy: {
        retryBackoff: {
          strategy: "exponential",
          initialDelayMs: 25,
          multiplier: 1,
          maxDelayMs: 25,
          jitter: "none"
        },
        fallbackRetry: {
          maxAttempts: 1,
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 1
        }
      }
    });
    const registry = createQueueDefinitionRegistry();
    const definition = registry.registerQueueDefinition({
      label: "postgres.jobs",
      ownerCapability: "work-queue-postgres-conformance"
    });
    await store.registerQueueDefinition(definition);
    const scope = { tenantId: "postgres", workspaceId: "container" };
    const resolved = registry.resolveQueueDefinitionForEnqueue({
      queueDefinitionId: definition.queueDefinitionId,
      scope,
      dedupeKey: { jobId: "pg-1" }
    });
    const enqueued = await store.enqueue({
      ...resolved,
      payloadRef: { kind: "postgres-smoke", ref: "payload:pg-1" },
      ownerRef: { capability: "work-queue-postgres-conformance" }
    });
    assert.equal(enqueued.workItem.state, WORK_QUEUE_STATES.PENDING);
    const duplicate = await store.enqueue({
      ...resolved,
      payloadRef: { kind: "postgres-smoke", ref: "payload:pg-1" },
      ownerRef: { capability: "work-queue-postgres-conformance" }
    });
    assert.equal(duplicate.deduped, true);
    const claim = await store.claim({
      queueDefinitionId: definition.queueDefinitionId,
      scope,
      workerId: "postgres-worker",
      leaseTimeoutMs: 100
    });
    assert.equal(claim.claimed.length, 1);
    const leased = claim.claimed[0];
    await assert.rejects(() => store.ack({
      workItemId: leased.workItem.workItemId,
      leaseId: "wrong-lease"
    }), /Lease fence rejected/);
    await store.progress({
      workItemId: leased.workItem.workItemId,
      leaseId: leased.lease.leaseId,
      extendMs: 100
    });
    const acked = await store.ack({
      workItemId: leased.workItem.workItemId,
      leaseId: leased.lease.leaseId
    });
    assert.equal(acked.workItem.state, WORK_QUEUE_STATES.ACKED);

    const replay = await store.rebuildProjection();
    assert.equal(replay.ok, true, JSON.stringify(replay, null, 2));
    const inspected = await store.inspect({ states: [WORK_QUEUE_STATES.ACKED] });
    assert.equal(inspected.items.length, 1);
    await store.close();
    console.log(JSON.stringify({
      ok: true,
      adapter: "postgres",
      containerName,
      acked: inspected.items.length
    }, null, 2));
  } finally {
    if (started) {
      await docker(["rm", "-f", containerName]).catch(() => null);
    }
  }
}

await main();
