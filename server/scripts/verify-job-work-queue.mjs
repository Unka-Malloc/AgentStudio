#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT } from "../platform/common/resource-management/work-queue/index.mjs";
import { createQueuedJobWorkflowProvider } from "../platform/specialized/console/queued-job-workflow-provider.mjs";
import { createJobManager } from "../services/client/work-queue-core/jobs/job-manager.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

async function waitForCompletedJob(provider, jobId, { timeoutMs = 90_000 } = {}) {
  const startedAt = Date.now();
  let lastJob = null;
  while (Date.now() - startedAt < timeoutMs) {
    await provider.dispatchWorkQueue();
    await provider.dispatcher.drain({ timeoutMs: 30_000 });
    lastJob = await provider.getJob(jobId);
    if (lastJob?.status === "completed") {
      return lastJob;
    }
    if (lastJob?.status === "failed") {
      throw new Error(`business job failed: ${lastJob.error || lastJob.stage || jobId}`);
    }
    await sleep(50);
  }
  throw new Error(`timed out waiting for queued business job ${jobId}; last=${JSON.stringify(lastJob)}`);
}

async function main() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-job-work-queue-"));
  const jobManager = createJobManager({
    userDataPath,
    processingEnabled: true,
    externalScheduler: true,
    runtimeOptions: {
      testHooks: {
        jobDelayMs: 1
      }
    }
  });
  const provider = await createQueuedJobWorkflowProvider({
    userDataPath,
    jobManager,
    autoStart: false,
    maxInFlight: WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT * 4,
    dispatchBatchSize: 1
  });

  try {
    const description = provider.describe();
    assert.equal(description.queue.effectiveMaxAckPending, WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT);
    assert.equal(description.queue.maxAckPendingClamped, true);
    assert.equal(provider.dispatcher.status().creditLimit, WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT);

    const inputText = [
      "# Platform Queue Verification",
      "",
      "Alice confirmed the private-cloud queue migration on 2026-06-13.",
      "Bob must review the durable state replay before production rollout."
    ].join("\n");
    const checkpointId = `verify_job_work_queue_${Date.now()}`;
    const job = await provider.createJob({
      inputText,
      uploadedFiles: [],
      filePaths: [],
      settings: {
        cloudParsingEnabled: false
      },
      checkpointReceipt: {
        checkpointId,
        manifestSha256: sha256(inputText),
        archiveBatchId: `verify_archive_${checkpointId}`,
        clientUid: "verify-job-work-queue",
        sourceType: "verification"
      }
    });

    assert.ok(job?.id, "job id should be generated");
    const queued = provider.inspectWorkQueue({ limit: 10 });
    assert.equal(
      queued.stateCounts.reduce((total, item) => total + Number(item.count || 0), 0) >= 1,
      true
    );

    const completedJob = await waitForCompletedJob(provider, job.id);
    const result = await provider.getJobResult(job.id);
    assert.ok(result?.jobId === job.id, "result should belong to the queued job");

    const inspected = provider.inspectWorkQueue({ limit: 10 });
    assert.equal(inspected.stateCounts.some((item) => item.state === "acked" && item.count >= 1), true);
    const replay = provider.queueStore.rebuildProjection();
    assert.equal(replay.ok, true, `work queue replay should be stable: ${JSON.stringify(replay)}`);

    console.log(JSON.stringify({
      ok: true,
      protocolVersion: provider.protocolVersion,
      jobId: job.id,
      jobStatus: completedJob.status,
      storeKind: provider.queueStore.kind,
      stateCounts: inspected.stateCounts
    }, null, 2));
  } finally {
    await provider.close();
    await jobManager.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

await main();
