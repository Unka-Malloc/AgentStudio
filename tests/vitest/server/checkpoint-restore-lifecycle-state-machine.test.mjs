import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import {
  validateStateMachineDefinition,
  transitionState
} from "../../../server/platform/common/state-machine/state-machine-core.mjs";
import {
  verifyMachineDefinition
} from "../../../server/platform/common/state-machine/state-machine-verifier.mjs";
import {
  checkpointTreeId,
  startCheckpointTree,
  upsertCheckpointNode,
  loadCheckpointTree,
  restoreCheckpointTree
} from "../../../server/platform/common/data-structure/checkpoint-tree-store.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const defPath = path.resolve(__dirname, "../../../server/platform/common/state-machine/definitions/checkpoint.restore.v1.json");
const allowPolicyGuardContext = { policyDecision: { allowed: true } };
const restoreApplyGuardContext = {
  treeState: { status: "active" },
  nodeState: { status: "active" },
  previewState: { generated: true },
  policyDecision: { allowed: true },
  existingState: {}
};
const approvedRestoreApplyGuardContext = {
  ...restoreApplyGuardContext,
  approvalRecord: { status: "approved" }
};

async function withTempUserData(testCase) {
  const userDataPath = await fs.mkdtemp(path.resolve(os.tmpdir(), "pact-checkpoint-restore-lifecycle-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

describe("Checkpoint Restore Lifecycle State Machine", () => {
  let definition;

  beforeAll(async () => {
    const raw = await fs.readFile(defPath, "utf8");
    definition = JSON.parse(raw);
  });

  it("should pass schema, core, and verifier validation checks (C1, C2, C3)", () => {
    // C1 & C2 validation
    const validation = validateStateMachineDefinition(definition);
    expect(validation.ok).toBe(true);

    // C3 Verifier validation
    const verifierReport = verifyMachineDefinition(definition, {
      relativePath: "checkpoint.restore.v1.json",
      throwOnError: true
    });
    expect(verifierReport.ok).toBe(true);
    expect(verifierReport.stateCount).toBe(9);
    expect(verifierReport.eventCount).toBe(9);
    expect(verifierReport.matrixCellCount).toBe(81);
    expect(definition.machineId).toBe("checkpoint.restore.v1");
    expect(definition.initialState).toBe("restore_requested");
  });

  it("should transition successfully through the happy pathway with approval", () => {
    // 1. restore_requested -> restore_preview_generated
    let res = transitionState(definition, {
      entityId: "restore-1",
      currentStatus: "restore_requested",
      eventType: "restore.generate_preview"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("restore_preview_generated");

    // 2. restore_preview_generated -> approval_pending
    res = transitionState(definition, {
      entityId: "restore-1",
      currentStatus: "restore_preview_generated",
      eventType: "restore.approval_request"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("approval_pending");

    // 3. approval_pending -> approved
    res = transitionState(definition, {
      entityId: "restore-1",
      currentStatus: "approval_pending",
      eventType: "restore.approve",
      guardContext: allowPolicyGuardContext
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("approved");

    // 4. approved -> restore_marker_recording
    res = transitionState(definition, {
      entityId: "restore-1",
      currentStatus: "approved",
      eventType: "restore.record_marker",
      guardContext: approvedRestoreApplyGuardContext
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("restore_marker_recording");

    // 5. restore_marker_recording -> completed
    res = transitionState(definition, {
      entityId: "restore-1",
      currentStatus: "restore_marker_recording",
      eventType: "restore.complete"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("completed");
  });

  it("should transition successfully through the pathway without approval", () => {
    // 1. restore_requested -> restore_preview_generated
    let res = transitionState(definition, {
      entityId: "restore-2",
      currentStatus: "restore_requested",
      eventType: "restore.generate_preview"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("restore_preview_generated");

    // 2. restore_preview_generated -> restore_marker_recording (bypasses approval)
    res = transitionState(definition, {
      entityId: "restore-2",
      currentStatus: "restore_preview_generated",
      eventType: "restore.record_marker",
      guardContext: restoreApplyGuardContext
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("restore_marker_recording");

    // 3. restore_marker_recording -> completed
    res = transitionState(definition, {
      entityId: "restore-2",
      currentStatus: "restore_marker_recording",
      eventType: "restore.complete"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("completed");
  });

  it("should handle failure transitions from non-terminal states", () => {
    const nonTerminalStates = [
      "restore_requested",
      "restore_preview_generated",
      "approval_pending",
      "approved",
      "restore_marker_recording"
    ];

    for (const state of nonTerminalStates) {
      const res = transitionState(definition, {
        entityId: "restore-fail-test",
        currentStatus: state,
        eventType: "restore.fail"
      });
      expect(res.ok).toBe(true);
      expect(res.toStatus).toBe("failed");
    }
  });

  it("should handle idempotent transitions correctly", () => {
    const idempotentScenarios = [
      { status: "restore_requested", event: "restore.request" },
      { status: "restore_preview_generated", event: "restore.generate_preview" },
      { status: "approval_pending", event: "restore.approval_request" },
      { status: "approved", event: "restore.approve" },
      { status: "rejected", event: "restore.reject" },
      { status: "expired", event: "restore.expire" },
      { status: "restore_marker_recording", event: "restore.record_marker" },
      { status: "completed", event: "restore.complete" },
      { status: "failed", event: "restore.fail" }
    ];

    for (const sc of idempotentScenarios) {
      const res = transitionState(definition, {
        entityId: "restore-idempotence",
        currentStatus: sc.status,
        eventType: sc.event
      });
      expect(res.ok).toBe(true);
      expect(res.idempotent).toBe(true);
      expect(res.toStatus).toBe(sc.status);
    }
  });

  it("should reject illegal transitions with stable error codes", () => {
    // 1. Cannot complete if marker not recorded
    let res = transitionState(definition, {
      entityId: "restore-err",
      currentStatus: "restore_requested",
      eventType: "restore.complete"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("RESTORE_NOT_RECORDED");

    // 2. Cannot record marker if approval is pending but approve not called
    res = transitionState(definition, {
      entityId: "restore-err",
      currentStatus: "approval_pending",
      eventType: "restore.record_marker"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("RESTORE_NOT_APPROVED");

    // 3. Cannot transition out of terminal state completed
    res = transitionState(definition, {
      entityId: "restore-err",
      currentStatus: "completed",
      eventType: "restore.generate_preview"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("RESTORE_TERMINAL_COMPLETED");
  });

  it("PO-RESTORE-001: restore must preview before apply", () => {
    // Apply (transition to restore_marker_recording) is only possible from restore_preview_generated or approved.
    // It cannot be done directly from restore_requested.
    const directRes = transitionState(definition, {
      entityId: "restore-po-001",
      currentStatus: "restore_requested",
      eventType: "restore.record_marker"
    });
    expect(directRes.ok).toBe(false);
    expect(directRes.errorCode).toBe("RESTORE_PREVIEW_NOT_GENERATED");

    // The mapping requires that restore_preview_generated must be visited before reaching restore_marker_recording
    expect(definition.proofMappings[0].obligationId).toBe("PO-RESTORE-001");
    expect(definition.proofMappings[0].params.requiredBefore).toBe("restore_preview_generated");
  });

  it("PO-RESTORE-002: high-risk restore must go through approval if required", () => {
    // In our definition layer, we map PO-RESTORE-002 to ensure approvalApproved guard is validated.
    // If approval is pending, calling record_marker directly is blocked.
    const directRecordingRes = transitionState(definition, {
      entityId: "restore-po-002",
      currentStatus: "approval_pending",
      eventType: "restore.record_marker"
    });
    expect(directRecordingRes.ok).toBe(false);
    expect(directRecordingRes.errorCode).toBe("RESTORE_NOT_APPROVED");

    // Once approved, record_marker contains the approvalApproved guard
    const matrixApprovedCell = definition.totalMatrix.find(
      c => c.from === "approved" && c.event === "restore.record_marker"
    );
    expect(matrixApprovedCell.guards).toContain("approvalApproved");
  });

  it("PO-RESTORE-003: restore must be append-only and not delete or rewrite historical checkpoint nodes", async () => {
    await withTempUserData(async (userDataPath) => {
      const treeId = checkpointTreeId("workflow", "restore_proof");

      // 1. Setup existing checkpoint tree with historical nodes
      await startCheckpointTree({
        userDataPath,
        treeId,
        kind: "workflow",
        ownerId: "owner-proof",
        inputHash: "hash-proof",
        rootNodeId: "task_root",
        rootLabel: "Task Root"
      });

      const node1 = await upsertCheckpointNode({
        userDataPath,
        treeId,
        nodeId: "task_step_1",
        parentId: "task_root",
        label: "Task Step 1",
        status: "completed",
        cursor: { offset: 100 },
        metadata: { info: "old_meta_1" }
      });

      const node2 = await upsertCheckpointNode({
        userDataPath,
        treeId,
        nodeId: "task_step_2",
        parentId: "task_root",
        label: "Task Step 2",
        status: "running",
        cursor: { offset: 200 },
        metadata: { info: "old_meta_2" }
      });

      // Load raw content before restore
      const treeBefore = await loadCheckpointTree({ userDataPath, treeId });
      const originalNode1 = JSON.stringify(treeBefore.nodes.task_step_1);
      const originalNode2 = JSON.stringify(treeBefore.nodes.task_step_2);
      const nodeCountBefore = Object.keys(treeBefore.nodes).length;

      // 2. Perform restoreCheckpointTree (append-only restore event in store)
      const restoreResult = await restoreCheckpointTree({
        userDataPath,
        treeId,
        nodeId: "task_step_1",
        actor: "proof_agent",
        reason: "revert step 2",
        mode: "restore-marker"
      });

      // 3. Load tree after restore and assert invariants
      const treeAfter = await loadCheckpointTree({ userDataPath, treeId });
      const nodeCountAfter = Object.keys(treeAfter.nodes).length;

      // Assert that a marker node was appended
      expect(nodeCountAfter).toBe(nodeCountBefore + 1);
      expect(treeAfter.nodes[restoreResult.markerNodeId]).toBeDefined();
      expect(treeAfter.nodes[restoreResult.markerNodeId].parentId).toBe("task_step_1");
      expect(treeAfter.nodes[restoreResult.markerNodeId].status).toBe("completed");

      // Assert that original historical nodes are COMPLETELY UNCHANGED
      expect(JSON.stringify(treeAfter.nodes.task_step_1)).toBe(originalNode1);
      expect(JSON.stringify(treeAfter.nodes.task_step_2)).toBe(originalNode2);

      // Assert that no keys were deleted
      for (const k of Object.keys(treeBefore.nodes)) {
        expect(treeAfter.nodes[k]).toBeDefined();
      }
    });
  });

  it("PO-RESTORE-004 & PO-RESTORE-005: completed state constraints and terminal blocks", () => {
    // PO-RESTORE-004: Completed state maps to completed target with required marker association
    const completeMapping = definition.proofMappings.find(m => m.obligationId === "PO-RESTORE-004");
    expect(completeMapping).toBeDefined();
    expect(completeMapping.params.requiredArtifact).toBe("restore_marker");

    // PO-RESTORE-005: Rejected or Expired cannot apply record_marker (illegal transitions)
    const rejectRes = transitionState(definition, {
      entityId: "restore-po-005",
      currentStatus: "rejected",
      eventType: "restore.record_marker"
    });
    expect(rejectRes.ok).toBe(false);
    expect(rejectRes.errorCode).toBe("RESTORE_TERMINAL_REJECTED");

    const expireRes = transitionState(definition, {
      entityId: "restore-po-005",
      currentStatus: "expired",
      eventType: "restore.record_marker"
    });
    expect(expireRes.ok).toBe(false);
    expect(expireRes.errorCode).toBe("RESTORE_TERMINAL_EXPIRED");
  });

  it("runtime narrow path: should run restoreCheckpointTree successfully and enforce state machine checks", async () => {
    await withTempUserData(async (userDataPath) => {
      const treeId = checkpointTreeId("workflow", "sm_narrow_run");

      // 1. Setup checkpoint tree
      await startCheckpointTree({
        userDataPath,
        treeId,
        kind: "workflow",
        ownerId: "owner-1",
        inputHash: "hash-1",
        rootNodeId: "task_root",
        rootLabel: "Task Root"
      });

      await upsertCheckpointNode({
        userDataPath,
        treeId,
        nodeId: "step_1",
        parentId: "task_root",
        label: "Step 1",
        status: "completed"
      });

      // 2. Perform restoreCheckpointTree (which internally triggers the state machine validators)
      const restoreResult = await restoreCheckpointTree({
        userDataPath,
        treeId,
        nodeId: "step_1",
        actor: "narrow_agent",
        reason: "sm verify",
        mode: "restore-marker"
      });

      expect(restoreResult.applied).toBe(true);
      expect(restoreResult.markerNodeId).toBeDefined();

      // Load tree and verify history node step_1 still exists (append-only)
      const treeAfter = await loadCheckpointTree({ userDataPath, treeId });
      expect(treeAfter.nodes.step_1).toBeDefined();
      expect(treeAfter.nodes.step_1.status).toBe("completed");
      expect(treeAfter.nodes[restoreResult.markerNodeId]).toBeDefined();
      expect(treeAfter.nodes[restoreResult.markerNodeId].parentId).toBe("step_1");
    });
  });

  it("design gap & state machine constraints: verify that restore cannot directly complete from requested or preview without recording", () => {
    // Attempting restore.complete directly from restore_requested: fails with RESTORE_NOT_RECORDED
    const resRequestedComplete = transitionState(definition, {
      entityId: "gap-test-1",
      currentStatus: "restore_requested",
      eventType: "restore.complete"
    });
    expect(resRequestedComplete.ok).toBe(false);
    expect(resRequestedComplete.errorCode).toBe("RESTORE_NOT_RECORDED");

    // Attempting restore.complete from restore_preview_generated: fails with RESTORE_NOT_RECORDED
    const resPreviewComplete = transitionState(definition, {
      entityId: "gap-test-2",
      currentStatus: "restore_preview_generated",
      eventType: "restore.complete"
    });
    expect(resPreviewComplete.ok).toBe(false);
    expect(resPreviewComplete.errorCode).toBe("RESTORE_NOT_RECORDED");

    // Attempting restore.record_marker from restore_requested without preview: fails with RESTORE_PREVIEW_NOT_GENERATED
    const resRequestedRecord = transitionState(definition, {
      entityId: "gap-test-3",
      currentStatus: "restore_requested",
      eventType: "restore.record_marker"
    });
    expect(resRequestedRecord.ok).toBe(false);
    expect(resRequestedRecord.errorCode).toBe("RESTORE_PREVIEW_NOT_GENERATED");
  });
});
