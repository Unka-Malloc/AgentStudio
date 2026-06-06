import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createDurableWorkflowRuntime,
  DURABLE_WORKFLOW_PROTOCOL_VERSION,
  verifyWorkflowHistory,
  workflowId
} from "../../../server/platform/common/workflow/durable-workflow-store.mjs";

async function withTempUserData(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-durable-workflow-store-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function workflowFilePath(userDataPath, id) {
  return path.join(userDataPath, "workflows", `${id}.json`);
}

describe("durable workflow store extra coverage", () => {
  it("covers lifecycle, paused states, recovery, completion and history verification", async () => {
    await withTempUserData(async (userDataPath) => {
      const runtime = createDurableWorkflowRuntime({ userDataPath });
      const id = workflowId("verify", "durable-workflow-extra");

      const started = await runtime.startWorkflow({
        workflowId: id,
        workflowType: "external_kb_ingest",
        ownerKind: "external_kb_ingest",
        ownerId: "owner-a",
        idempotencyKey: "workflow-extra-v1",
        input: {
          batchId: "batch-1",
          providerId: "qdrant"
        },
        checkpointTreeId: "checkpoint_tree_extra"
      });

      expect(started).toMatchObject({
        protocolVersion: DURABLE_WORKFLOW_PROTOCOL_VERSION,
        workflowId: id,
        workflowType: "external_kb_ingest",
        ownerId: "owner-a",
        ownerKind: "external_kb_ingest",
        status: "running",
        waitingReason: "",
        historyLength: 1
      });

      const storedStarted = await readJson(workflowFilePath(userDataPath, id));
      expect(storedStarted.history).toHaveLength(1);
      expect(storedStarted.history[0]).toMatchObject({
        eventType: "workflow.started",
        sequence: 1
      });

      const reused = await runtime.startWorkflow({
        workflowId: id,
        workflowType: "external_kb_ingest",
        ownerKind: "external_kb_ingest",
        ownerId: "owner-a",
        idempotencyKey: "workflow-extra-v1",
        input: {
          batchId: "batch-1",
          providerId: "qdrant"
        }
      });
      expect(reused.workflowId).toBe(id);
      expect(reused.historyLength).toBe(1);

      await expect(
        runtime.startWorkflow({
          workflowId: id,
          workflowType: "external_kb_ingest",
          ownerKind: "external_kb_ingest",
          ownerId: "owner-a",
          idempotencyKey: "workflow-extra-v1-conflict",
          input: {
            batchId: "batch-2",
            providerId: "qdrant"
          }
        })
      ).rejects.toThrow(`Workflow idempotency conflict: ${id}`);

      const activity = await runtime.scheduleActivity(id, {
        activityId: "parse-documents",
        activityType: "document_parse",
        idempotencyKey: "parse-documents:batch-1",
        input: { batchId: "batch-1" },
        retryPolicy: { maxAttempts: 2 },
        compensation: { action: "delete_staged_outputs" }
      });

      expect(activity).toMatchObject({
        reused: false,
        activity: {
          activityId: "parse-documents",
          activityType: "document_parse",
          status: "scheduled",
          attempt: 0,
          maxAttempts: 2
        },
        workflow: {
          status: "running",
          historyLength: 2
        }
      });

      const activityReuse = await runtime.scheduleActivity(id, {
        activityType: "document_parse",
        idempotencyKey: "parse-documents:batch-1",
        input: { batchId: "batch-1" }
      });
      expect(activityReuse.reused).toBe(true);
      expect(activityReuse.activity.activityId).toBe("parse-documents");
      expect(activityReuse.workflow.historyLength).toBe(3);

      const startedActivity = await runtime.startActivity(id, "parse-documents");
      expect(startedActivity.activity).toMatchObject({
        status: "running",
        attempt: 1
      });

      const heartbeat = await runtime.heartbeatActivity(id, "parse-documents", {
        cursor: { offset: 4 },
        progressPercent: 40
      });
      expect(heartbeat.activity.heartbeat).toMatchObject({
        cursor: { offset: 4 },
        progressPercent: 40
      });

      const retrying = await runtime.failActivity(id, "parse-documents", "temporary failure");
      expect(retrying.activity).toMatchObject({
        status: "retrying",
        error: "temporary failure"
      });

      const retryRun = await runtime.startActivity(id, "parse-documents");
      expect(retryRun.activity.attempt).toBe(2);

      const failedActivity = await runtime.failActivity(id, "parse-documents", "permanent failure");
      expect(failedActivity.activity).toMatchObject({
        status: "failed",
        error: "permanent failure"
      });

      const openActivity = await runtime.scheduleActivity(id, {
        activityId: "extract-metadata",
        activityType: "metadata_extract",
        idempotencyKey: "extract-metadata:batch-1",
        input: { batchId: "batch-1" },
        retryPolicy: { maxAttempts: 2 }
      });
      expect(openActivity.activity).toMatchObject({
        activityId: "extract-metadata",
        status: "scheduled"
      });

      const openActivityStarted = await runtime.startActivity(id, "extract-metadata");
      expect(openActivityStarted.activity.status).toBe("running");

      const timer = await runtime.scheduleTimer(id, {
        timerName: "review-timeout",
        fireAt: "2000-01-01T00:00:00.000Z",
        payload: { reviewId: "review-1" }
      });
      expect(timer.timer).toMatchObject({
        timerName: "review-timeout",
        status: "scheduled",
        fireAt: "2000-01-01T00:00:00.000Z"
      });

      const humanReview = await runtime.requestHumanReview(id, {
        reviewId: "review-1",
        reviewType: "publish_gate",
        requestedBy: "workflow-verifier",
        reasons: ["needs human approval"]
      });
      expect(humanReview.workflow).toMatchObject({
        status: "paused",
        waitingReason: "human_review"
      });

      const partialWrite = await runtime.beginExternalWrite(id, {
        writeId: "external-index-upsert",
        providerId: "qdrant",
        targetRef: "collection://pact/verify",
        idempotencyKey: "external-index-upsert:batch-1",
        input: { documentIds: ["doc-1"] },
        compensation: { action: "delete_vectors_by_batch", batchId: "batch-1" }
      });
      expect(partialWrite.workflow).toMatchObject({
        status: "paused",
        waitingReason: "external_partial_write_resolution"
      });

      const recovered = await runtime.recoverWorkflow(id, {
        reason: "simulated_process_restart"
      });
      expect(recovered.historyVerification).toMatchObject({
        ok: true,
        historyLength: 14
      });
      expect(recovered.workflow.activities.find((item) => item.activityId === "parse-documents")).toMatchObject({
        status: "failed"
      });
      expect(recovered.workflow.activities.find((item) => item.activityId === "extract-metadata")).toMatchObject({
        status: "scheduled"
      });
      expect(recovered.workflow.attempt).toBe(2);

      const reviewResolved = await runtime.resolveHumanReview(id, "review-1", {
        decision: "approved",
        resolvedBy: "human-reviewer"
      });
      expect(reviewResolved.workflow).toMatchObject({
        status: "paused",
        waitingReason: "external_partial_write_resolution"
      });

      const writeCommitted = await runtime.commitExternalWrite(id, "external-index-upsert", {
        confirmation: { providerId: "qdrant", batchId: "batch-1", persisted: true },
        output: { vectorCount: 1 }
      });
      expect(writeCommitted.workflow).toMatchObject({
        status: "running",
        waitingReason: ""
      });

      const fired = await runtime.fireDueTimers({ now: "2026-01-01T00:00:00.000Z" });
      expect(fired).toMatchObject({
        count: 1,
        fired: [
          {
            workflowId: id,
            timerId: timer.timer.timerId
          }
        ]
      });

      const completed = await runtime.completeWorkflow(id, {
        indexed: true,
        batchId: "batch-1"
      });
      expect(completed).toMatchObject({
        status: "completed",
        waitingReason: "",
      });
      expect(completed.outputHash).toMatch(/^[a-f0-9]{64}$/);

      const verification = await runtime.verifyWorkflow(id);
      expect(verification.ok).toBe(true);

      const publicWorkflow = await runtime.getWorkflow(id);
      expect(publicWorkflow).toMatchObject({
        status: "completed",
        historyLength: 18,
        protocolVersion: DURABLE_WORKFLOW_PROTOCOL_VERSION
      });

      const historyWorkflow = await runtime.getWorkflowWithHistory(id);
      expect(historyWorkflow.history).toHaveLength(18);
      expect(verifyWorkflowHistory(historyWorkflow)).toMatchObject({
        ok: true,
        historyLength: 18
      });

      const tampered = JSON.parse(JSON.stringify(historyWorkflow));
      tampered.history[1].previousEventHash = "broken";
      expect(verifyWorkflowHistory(tampered)).toMatchObject({
        ok: false,
        reason: "previous_event_hash_mismatch",
        sequence: 2
      });

      const rawWorkflow = await readJson(workflowFilePath(userDataPath, id));
      rawWorkflow.history[0].eventHash = "broken";
      await fs.writeFile(workflowFilePath(userDataPath, id), `${JSON.stringify(rawWorkflow, null, 2)}\n`, "utf8");
      await expect(runtime.verifyWorkflow(id)).resolves.toMatchObject({
        ok: false,
        reason: "event_hash_mismatch",
        sequence: 1
      });
    });
  });

  it("filters, skips malformed schema files, reports missing workflows and enforces list boundaries", async () => {
    await withTempUserData(async (userDataPath) => {
      const runtime = createDurableWorkflowRuntime({ userDataPath });

      await expect(runtime.getWorkflow("missing-workflow")).resolves.toBeNull();
      await expect(runtime.getWorkflowWithHistory("missing-workflow")).resolves.toBeNull();

      const first = await runtime.startWorkflow({
        workflowId: workflowId("list", "first"),
        workflowType: "batch_job",
        ownerKind: "batch_job",
        ownerId: "owner-a",
        idempotencyKey: "list-first",
        input: { value: 1 }
      });
      const second = await runtime.startWorkflow({
        workflowId: workflowId("list", "second"),
        workflowType: "batch_job",
        ownerKind: "batch_job",
        ownerId: "owner-b",
        status: "completed",
        idempotencyKey: "list-second",
        input: { value: 2 }
      });
      await runtime.failWorkflow(second.workflowId, "boom");

      const malformedPath = workflowFilePath(userDataPath, "malformed-schema");
      await fs.mkdir(path.dirname(malformedPath), { recursive: true });
      await fs.writeFile(
        malformedPath,
        `${JSON.stringify({
          schemaVersion: 999,
          workflowId: "malformed-schema",
          workflowType: "batch_job",
          ownerId: "owner-c",
          ownerKind: "batch_job",
          status: "running"
        }, null, 2)}\n`,
        "utf8"
      );

      const rawMalformed = await runtime.getWorkflow("malformed-schema");
      expect(rawMalformed).toBeNull();

      const all = await runtime.listWorkflows({ limit: -1 });
      expect(all).toHaveLength(1);
      expect([first.workflowId, second.workflowId]).toContain(all[0].workflowId);

      const ownerFiltered = await runtime.listWorkflows({ ownerId: "owner-a", limit: 10 });
      expect(ownerFiltered.map((item) => item.workflowId)).toEqual([first.workflowId]);

      const statusFiltered = await runtime.listWorkflows({ status: "failed", limit: 10 });
      expect(statusFiltered.map((item) => item.workflowId)).toEqual([second.workflowId]);

      const bounded = await runtime.listWorkflows({ limit: 9999 });
      expect(bounded.length).toBeLessThanOrEqual(500);

      await fs.writeFile(
        workflowFilePath(userDataPath, "broken-json"),
        "{ this is not valid json",
        "utf8"
      );
      await expect(runtime.listWorkflows({ limit: 10 })).rejects.toThrow();
    });
  });
});
