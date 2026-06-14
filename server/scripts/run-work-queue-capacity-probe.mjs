#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createQueueDefinitionRegistry,
  createQueuePushDispatcher,
  createQueueWorkerRuntime,
  createSqliteWorkQueueStore,
  resolveQueueMaxAckPending,
  WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT,
  WORK_QUEUE_STATES
} from "../platform/common/resource-management/work-queue/index.mjs";

function parseList(value = "", fallback = []) {
  const parsed = String(value || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item));
  return parsed.length ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external
  };
}

async function runCandidate({ candidate, rootDir, handlerDelayMs }) {
  const limit = resolveQueueMaxAckPending(candidate);
  if (limit.limit < candidate) {
    throw new Error(
      `capacity candidate ${candidate} exceeds hard local maxAckPending ${WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT}`
    );
  }
  const userDataPath = path.join(rootDir, `c-${candidate}`);
  await fs.rm(userDataPath, { recursive: true, force: true });
  await fs.mkdir(userDataPath, { recursive: true });
  const store = createSqliteWorkQueueStore({ userDataPath });
  const registry = createQueueDefinitionRegistry();
  const definition = registry.registerQueueDefinition({
    label: `capacity.jobs.${candidate}`,
    ownerCapability: "work-queue-capacity-probe"
  });
  store.registerQueueDefinition(definition);
  const scope = { tenantId: "capacity", workspaceId: `c-${candidate}` };
  const total = Math.max(candidate * Number(process.env.PACT_WORK_QUEUE_PROBE_TOTAL_MULTIPLIER || 4), candidate);
  const startedAt = Date.now();
  for (let index = 0; index < total; index += 1) {
    const resolved = registry.resolveQueueDefinitionForEnqueue({
      queueDefinitionId: definition.queueDefinitionId,
      scope,
      dedupeKey: { candidate, index }
    });
    store.enqueue({
      ...resolved,
      payloadRef: { kind: "capacity-probe", index },
      ownerRef: { capability: "work-queue-capacity-probe" }
    });
  }

  let completed = 0;
  let failed = 0;
  let peakRssBytes = memorySnapshot().rssBytes;
  const runtime = createQueueWorkerRuntime({
    store,
    workerId: `capacity-worker-${candidate}`,
    handlers: {
      [definition.queueDefinitionId]: async () => {
        if (handlerDelayMs > 0) await sleep(handlerDelayMs);
        completed += 1;
        return { action: "ack" };
      }
    }
  });
  const dispatcher = createQueuePushDispatcher({
    store,
    workerRuntime: runtime,
    queueDefinitionId: definition.queueDefinitionId,
    scope,
    maxInFlight: candidate,
    workerId: `capacity-dispatcher-${candidate}`
  });
  const effectiveConcurrency = dispatcher.status().creditLimit;

  const timeoutMs = Number(process.env.PACT_WORK_QUEUE_PROBE_TIMEOUT_MS || 120000);
  while (completed + failed < total) {
    const status = dispatcher.status();
    if (status.availableCredit > 0) {
      await dispatcher.dispatchOnce({ batchSize: status.availableCredit });
    }
    peakRssBytes = Math.max(peakRssBytes, memorySnapshot().rssBytes);
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`capacity candidate ${candidate} timed out with completed=${completed}/${total}`);
    }
    await sleep(1);
  }
  await dispatcher.drain({ timeoutMs: 30000 });
  const replay = store.rebuildProjection();
  if (!replay.ok) {
    throw new Error(`capacity candidate ${candidate} replay drift: ${JSON.stringify(replay)}`);
  }
  const inspected = store.inspect({ states: [WORK_QUEUE_STATES.ACKED], limit: 1000 });
  const acked = inspected.stateCounts.find((item) => item.state === WORK_QUEUE_STATES.ACKED)?.count ??
    inspected.items.length;
  const elapsedMs = Date.now() - startedAt;
  const result = {
    candidate,
    ok: true,
    total,
    effectiveConcurrency,
    hardMaxAckPending: WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT,
    acked,
    elapsedMs,
    throughputPerSecond: Math.round((total / Math.max(1, elapsedMs)) * 1000),
    peakRssBytes,
    finalMemory: memorySnapshot()
  };
  store.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
  return result;
}

async function main() {
  const candidates = parseList(
    process.env.PACT_WORK_QUEUE_PROBE_CANDIDATES,
    [16, 32, 64, 128, 256, 512, 1024]
  );
  const handlerDelayMs = Number(process.env.PACT_WORK_QUEUE_PROBE_HANDLER_DELAY_MS || 10);
  const rootDir = process.env.PACT_WORK_QUEUE_PROBE_DATA_DIR ||
    await fs.mkdtemp(path.join(os.tmpdir(), "pact-work-queue-capacity-"));
  const results = [];
  let maxPassedConcurrency = 0;
  for (const candidate of candidates) {
    try {
      const result = await runCandidate({ candidate, rootDir, handlerDelayMs });
      results.push(result);
      maxPassedConcurrency = candidate;
      console.log(JSON.stringify({ event: "candidate", ...result }));
    } catch (error) {
      const failed = {
        candidate,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        finalMemory: memorySnapshot()
      };
      results.push(failed);
      console.log(JSON.stringify({ event: "candidate", ...failed }));
      break;
    }
  }
  console.log(JSON.stringify({
    ok: results.every((item) => item.ok !== false),
    maxPassedConcurrency,
    candidates,
    results,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      totalmemBytes: os.totalmem()
    }
  }, null, 2));
}

await main();
