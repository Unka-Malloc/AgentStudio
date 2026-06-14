import {
  assertLegalWorkQueueTransition,
  isLegalWorkQueueTransition,
  verifyWorkQueueStateMachineProof,
  verifyWorkQueueStateMachine,
  WORK_QUEUE_STATES
} from "../state-machine.mjs";
import { createFixedQueueTimeSource } from "../time-source.mjs";
import { createQueueIdentityGenerator } from "../identity.mjs";
import {
  validateQueueBackgroundWriteAspectShape,
  validateWorkQueueStoreAdapterShape
} from "../store-adapter-contract.mjs";

function makeCheck(id, fn) {
  try {
    const details = fn();
    return { id, ok: true, details: details || {} };
  } catch (error) {
    return { id, ok: false, error: error.message };
  }
}

function deterministicRandomBytes(length) {
  return Buffer.alloc(length, 0x7a);
}

export function runWorkQueueConformanceSuite({
  storeAdapter = null,
  backgroundWriteAspect = null
} = {}) {
  const checks = [];

  checks.push(makeCheck("state-machine-definition", () => {
    const result = verifyWorkQueueStateMachine();
    if (!result.ok) {
      throw new Error(result.errors.join("; "));
    }
    if (!result.proof.ok) {
      throw new Error(result.proof.errors.join("; "));
    }
    return {
      states: result.machine.states.length,
      transitions: Object.keys(result.machine.transitions).length,
      proofMatrixCells: result.proof.matrixCells
    };
  }));

  checks.push(makeCheck("state-machine-total-matrix-proof", () => {
    const proof = verifyWorkQueueStateMachineProof();
    if (!proof.ok) {
      throw new Error(proof.errors.join("; "));
    }
    return {
      version: proof.version,
      matrixCells: proof.matrixCells,
      states: proof.states,
      events: proof.events
    };
  }));

  checks.push(makeCheck("legal-transition-table", () => {
    assertLegalWorkQueueTransition({ transition: "enqueue", fromState: null, toState: WORK_QUEUE_STATES.PENDING });
    assertLegalWorkQueueTransition({ transition: "claim", fromState: WORK_QUEUE_STATES.PENDING, toState: WORK_QUEUE_STATES.LEASED });
    assertLegalWorkQueueTransition({ transition: "ack", fromState: WORK_QUEUE_STATES.LEASED, toState: WORK_QUEUE_STATES.ACKED });
    assertLegalWorkQueueTransition({ transition: "fallback_failed", fromState: WORK_QUEUE_STATES.LEASED, toState: WORK_QUEUE_STATES.FALLBACK_REVIEW });
  }));

  checks.push(makeCheck("illegal-transition-fail-closed", () => {
    if (isLegalWorkQueueTransition({ transition: "ack", fromState: WORK_QUEUE_STATES.PENDING, toState: WORK_QUEUE_STATES.ACKED })) {
      throw new Error("ack from pending must be illegal.");
    }
    try {
      assertLegalWorkQueueTransition({ transition: "claim", fromState: WORK_QUEUE_STATES.ACKED, toState: WORK_QUEUE_STATES.LEASED });
    } catch {
      return { illegalRejected: true };
    }
    throw new Error("claim from acked should fail closed.");
  }));

  checks.push(makeCheck("uuid-v7-identity-generator", () => {
    const timeSource = createFixedQueueTimeSource(1_718_400_000_000);
    const generator = createQueueIdentityGenerator({ timeSource, randomBytesFn: deterministicRandomBytes });
    const uuid = generator.uuid();
    if (uuid[14] !== "7") {
      throw new Error(`Expected UUIDv7 version nibble, got ${uuid}`);
    }
    if (!["8", "9", "a", "b"].includes(uuid[19])) {
      throw new Error(`Expected UUID RFC variant nibble, got ${uuid}`);
    }
    return { workItemId: generator.workItemId() };
  }));

  checks.push(makeCheck("store-adapter-shape", () => {
    if (!storeAdapter) {
      return { skipped: true, reason: "No concrete adapter supplied." };
    }
    const result = validateWorkQueueStoreAdapterShape(storeAdapter);
    if (!result.ok) {
      throw new Error(result.errors.join("; "));
    }
  }));

  checks.push(makeCheck("background-write-aspect-shape", () => {
    if (!backgroundWriteAspect) {
      return { skipped: true, reason: "No concrete aspect supplied." };
    }
    const result = validateQueueBackgroundWriteAspectShape(backgroundWriteAspect);
    if (!result.ok) {
      throw new Error(result.errors.join("; "));
    }
  }));

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}
