import { describe, it, expect } from "vitest";
import {
  validateStateMachineDefinition,
  assertStateMachineDefinition,
  transitionState,
  listAllowedEvents,
  isTerminalStatus,
  assertTransitionAllowed,
  ERROR_CODES,
  StateMachineError
} from "../../../server/platform/common/state-machine/state-machine-core.mjs";

const mockDefinition = {
  machineId: "test.lifecycle.v1",
  entityType: "test_entity",
  version: "1.0.0",
  initialState: "submitted",
  states: [
    { "id": "submitted" },
    { "id": "approved" },
    { "id": "archived", "terminal": true }
  ],
  events: [
    { "id": "test.submit" },
    { "id": "test.approve" },
    { "id":     "test.archive", "riskLevel": "high" }
  ],
  totalMatrix: [
    { "from": "submitted", "event": "test.submit", "result": "ignored_idempotent_event" },
    { "from": "submitted", "event": "test.approve", "result": "legal_transition", "to": "approved" },
    { "from": "submitted", "event": "test.archive", "result": "illegal_transition", "errorCode": "ARCHIVE_BEFORE_APPROVAL" },
    
    { "from": "approved", "event": "test.submit", "result": "illegal_transition", "errorCode": "ALREADY_APPROVED" },
    { "from": "approved", "event": "test.approve", "result": "ignored_idempotent_event" },
    { "from": "approved", "event": "test.archive", "result": "requires_policy", "to": "archived", "guards": ["policyAllowed"] },
    
    { "from": "archived", "event": "test.submit", "result": "illegal_transition", "errorCode": "ALREADY_ARCHIVED" },
    { "from": "archived", "event": "test.approve", "result": "illegal_transition", "errorCode": "ALREADY_ARCHIVED" },
    { "from": "archived", "event": "test.archive", "result": "ignored_idempotent_event" }
  ]
};

const multiCellDefinition = {
  machineId: "multi.cell.v1",
  entityType: "test_entity",
  version: "1.0.0",
  initialState: "start",
  states: [
    { "id": "start" },
    { "id": "end_a", "terminal": true },
    { "id": "end_b", "terminal": true },
    { "id": "end_unguarded", "terminal": true }
  ],
  events: [
    { "id": "go", "riskLevel": "high" }
  ],
  totalMatrix: [
    { "from": "start", "event": "go", "result": "illegal_transition", "errorCode": "ILLEGAL_GO" },
    { "from": "start", "event": "go", "result": "legal_transition", "to": "end_a", "guards": ["policyAllowed"] },
    { "from": "start", "event": "go", "result": "legal_transition", "to": "end_b", "guards": ["approvalApproved"] }
  ]
};

describe("State Machine Core - Definition Validation", () => {
  it("should validate a correct definition", () => {
    const result = validateStateMachineDefinition(mockDefinition);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should fail validation if machineId is missing", () => {
    const invalid = { ...mockDefinition, machineId: "" };
    const result = validateStateMachineDefinition(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ errorCode: ERROR_CODES.STATE_MACHINE_INVALID_DEFINITION, message: 'machineId is required' })
    );
  });

  it("should fail validation if initialState is not in states", () => {
    const invalid = { ...mockDefinition, initialState: "unknown_state" };
    const result = validateStateMachineDefinition(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: `initialState 'unknown_state' is not in states list` })
    );
  });

  it("should fail validation if there is a duplicate state ID", () => {
    const invalid = {
      ...mockDefinition,
      states: [{ id: "submitted" }, { id: "submitted" }, { id: "archived", "terminal": true }]
    };
    const result = validateStateMachineDefinition(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: 'Duplicate state IDs found' })
    );
  });

  it("should fail validation if definition is null", () => {
    const result = validateStateMachineDefinition(null);
    expect(result.ok).toBe(false);
  });
});

describe("State Machine Core - Assert Definition", () => {
  it("should not throw on valid definition", () => {
    expect(() => assertStateMachineDefinition(mockDefinition)).not.toThrow();
  });

  it("should throw on invalid definition", () => {
    const invalid = { ...mockDefinition, machineId: "" };
    expect(() => assertStateMachineDefinition(invalid)).toThrow(StateMachineError);
  });
});

describe("State Machine Core - Transition State Logic", () => {
  it("should perform legal transitions successfully", () => {
    const res = transitionState(mockDefinition, {
      entityId: "123",
      currentStatus: "submitted",
      eventType: "test.approve"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("approved");
    expect(res.entityType).toBe("test_entity");
    expect(res.transitionRecord.fromStatus).toBe("submitted");
    expect(res.transitionRecord.toStatus).toBe("approved");
    expect(res.requiredEffects.policy).toBe(false);
  });

  it("should report illegal transitions and suggest allowed events", () => {
    const res = transitionState(mockDefinition, {
      entityId: "123",
      currentStatus: "submitted",
      eventType: "test.archive"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("ARCHIVE_BEFORE_APPROVAL");
    expect(res.allowedEvents).toContain("test.approve");
  });

  it("should return ignored idempotent event status on repeat actions", () => {
    const res = transitionState(mockDefinition, {
      entityId: "123",
      currentStatus: "submitted",
      eventType: "test.submit"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("submitted");
  });

  it("should block non-idempotent transitions from terminal states", () => {
    const res = transitionState(mockDefinition, {
      entityId: "123",
      currentStatus: "archived",
      eventType: "test.approve"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("ALREADY_ARCHIVED");
  });

  it("should allow idempotent events in terminal states", () => {
    const res = transitionState(mockDefinition, {
      entityId: "123",
      currentStatus: "archived",
      eventType: "test.archive"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
  });
});

describe("State Machine Core - Metadata Redaction", () => {
  it("should automatically redact metadata during transitions", () => {
    const res = transitionState(mockDefinition, {
      entityId: "123",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        password: "my-password",
        label: "test-run"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.password).toEqual({ redacted: true, reason: "sensitive_key" });
    expect(res.transitionRecord.metadata.label).toBe("test-run");
  });

  it("should redact token-like fields in metadata during transitions", () => {
    const res = transitionState(mockDefinition, {
      entityId: "456",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        apiKey: "secret-12345",
        safeField: "safe-data"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.apiKey).toEqual({ redacted: true, reason: "sensitive_key" });
    expect(res.transitionRecord.metadata.safeField).toBe("safe-data");
  });

  it("should redact absolute paths in metadata", () => {
    const res = transitionState(mockDefinition, {
      entityId: "789",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        dataPath: "/Users/test/project",
        other: "regular"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.dataPath).toEqual({ redacted: true, reason: "absolute_path" });
    expect(res.transitionRecord.metadata.other).toBe("regular");
  });
});

describe("State Machine Core - Exception Throwing Wrapper", () => {
  it("should not throw on valid transitions", () => {
    const res = assertTransitionAllowed(mockDefinition, {
      entityId: "123",
      currentStatus: "submitted",
      eventType: "test.approve"
    });
    expect(res.ok).toBe(true);
  });

  it("should throw on invalid transitions with structured details", () => {
    try {
      assertTransitionAllowed(mockDefinition, {
        entityId: "123",
        currentStatus: "submitted",
        eventType: "test.archive"
      });
      expect.fail("Should have thrown error");
    } catch (error) {
      expect(error).toBeInstanceOf(StateMachineError);
      expect(error.code).toBe("ARCHIVE_BEFORE_APPROVAL");
      expect(error.errorCode).toBe("ARCHIVE_BEFORE_APPROVAL");
    }
  });
});

describe("State Machine Core - ERROR_CODES", () => {
  it("should export ERROR_CODES from core module", () => {
    expect(ERROR_CODES).toBeDefined();
    expect(ERROR_CODES.STATE_MACHINE_INVALID_DEFINITION).toBe("STATE_MACHINE_INVALID_DEFINITION");
    expect(ERROR_CODES.STATE_MACHINE_UNKNOWN_STATUS).toBe("STATE_MACHINE_UNKNOWN_STATUS");
    expect(ERROR_CODES.STATE_MACHINE_TERMINAL_STATUS).toBe("STATE_MACHINE_TERMINAL_STATUS");
    expect(ERROR_CODES.STATE_MACHINE_TRANSITION_NOT_ALLOWED).toBe("STATE_MACHINE_TRANSITION_NOT_ALLOWED");
  });
});

describe("State Machine Core - Utility Functions", () => {
  it("isTerminalStatus should correctly identify terminal states", () => {
    expect(isTerminalStatus(mockDefinition, "archived")).toBe(true);
    expect(isTerminalStatus(mockDefinition, "submitted")).toBe(false);
  });

  it("listAllowedEvents should return valid event names for a state", () => {
    const events = listAllowedEvents(mockDefinition, "submitted");
    expect(events).toContain("test.submit");
    expect(events).toContain("test.approve");
    expect(events).not.toContain("test.archive");
  });
});

describe("State Machine Core - Guard Execution", () => {
  it("should reject transition when policyAllowed guard fails", () => {
    const res = transitionState(mockDefinition, {
      entityId: "g1",
      currentStatus: "approved",
      eventType: "test.archive",
      guardContext: { policyDecision: { allowed: false } }
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("STATE_MACHINE_GUARD_BLOCKED");
    expect(res.blockedBy).toBe("guard");
  });

  it("should allow transition when policyAllowed guard passes", () => {
    const res = transitionState(mockDefinition, {
      entityId: "g2",
      currentStatus: "approved",
      eventType: "test.archive",
      guardContext: { policyDecision: { allowed: true } }
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("archived");
    expect(res.transitionRecord.guardResults).toBeDefined();
  });

  it("should reject transition for unknown guard", () => {
    const defWithUnknownGuard = {
      ...mockDefinition,
      totalMatrix: mockDefinition.totalMatrix.map(cell =>
        cell.from === "approved" && cell.event === "test.archive"
          ? { ...cell, guards: ["nonexistent_guard"] }
          : cell
      )
    };
    const res = transitionState(defWithUnknownGuard, {
      entityId: "g3",
      currentStatus: "approved",
      eventType: "test.archive"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("STATE_MACHINE_GUARD_UNKNOWN");
    expect(res.blockedBy).toBe("guard");
  });

  it("should reject transition when guard context is missing", () => {
    const defWithApprovalGuard = {
      ...mockDefinition,
      totalMatrix: mockDefinition.totalMatrix.map(cell =>
        cell.from === "approved" && cell.event === "test.archive"
          ? { ...cell, guards: ["approvalApproved"] }
          : cell
      )
    };
    const res = transitionState(defWithApprovalGuard, {
      entityId: "g4",
      currentStatus: "approved",
      eventType: "test.archive",
      guardContext: {}
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("STATE_MACHINE_GUARD_CONTEXT_MISSING");
  });

  it("should reject transition when approvalApproved guard fails (status not approved)", () => {
    const defWithApprovalGuard = {
      ...mockDefinition,
      totalMatrix: mockDefinition.totalMatrix.map(cell =>
        cell.from === "approved" && cell.event === "test.archive"
          ? { ...cell, guards: ["approvalApproved"] }
          : cell
      )
    };
    const res = transitionState(defWithApprovalGuard, {
      entityId: "g5",
      currentStatus: "approved",
      eventType: "test.archive",
      guardContext: { approvalRecord: { status: "pending" } }
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("STATE_MACHINE_GUARD_BLOCKED");
  });
});

describe("State Machine Core - Multi-cell Disambiguation", () => {
  it("should select single passing cell from multiple guarded cells", () => {
    const res = transitionState(multiCellDefinition, {
      entityId: "m1",
      currentStatus: "start",
      eventType: "go",
      guardContext: { policyDecision: { allowed: true }, approvalRecord: { status: "pending" } }
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("end_a");
  });

  it("should select single passing cell from multiple guarded cells (second)", () => {
    const res = transitionState(multiCellDefinition, {
      entityId: "m2",
      currentStatus: "start",
      eventType: "go",
      guardContext: { policyDecision: { allowed: false }, approvalRecord: { status: "approved" } }
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("end_b");
  });

  it("should reject when no guard passes for any cell", () => {
    const res = transitionState(multiCellDefinition, {
      entityId: "m3",
      currentStatus: "start",
      eventType: "go",
      guardContext: { policyDecision: { allowed: false }, approvalRecord: { status: "pending" } }
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("STATE_MACHINE_GUARD_BLOCKED");
  });

  it("should return ambiguous when multiple guards pass", () => {
    const res = transitionState(multiCellDefinition, {
      entityId: "m4",
      currentStatus: "start",
      eventType: "go",
      guardContext: { policyDecision: { allowed: true }, approvalRecord: { status: "approved" } }
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("STATE_MACHINE_AMBIGUOUS_TRANSITION");
  });
});

describe("State Machine Core - requires_policy Evidence Check", () => {
  it("should reject requires_policy without allow evidence", () => {
    const def = {
      machineId: "policy.evidence.v1",
      entityType: "test",
      version: "1.0.0",
      initialState: "start",
      states: [{ id: "start" }, { id: "end" }],
      events: [{ id: "go" }],
      totalMatrix: [
        { from: "start", event: "go", result: "requires_policy", to: "end" }
      ]
    };
    const res = transitionState(def, {
      entityId: "p1",
      currentStatus: "start",
      eventType: "go",
      guardContext: {}
    });
    expect(res.ok).toBe(false);
    expect(res.blockedBy).toBe("policy");
  });

  it("should allow requires_policy with allow evidence", () => {
    const def = {
      machineId: "policy.evidence.v2",
      entityType: "test",
      version: "1.0.0",
      initialState: "start",
      states: [{ id: "start" }, { id: "end" }],
      events: [{ id: "go" }],
      totalMatrix: [
        { from: "start", event: "go", result: "requires_policy", to: "end" }
      ]
    };
    const res = transitionState(def, {
      entityId: "p2",
      currentStatus: "start",
      eventType: "go",
      guardContext: { policyDecision: { allowed: true } }
    });
    expect(res.ok).toBe(true);
    expect(res.requiredEffects.policy).toBe(true);
  });
});

describe("State Machine Core - requires_approval Evidence Check", () => {
  it("should reject requires_approval without approved evidence", () => {
    const def = {
      machineId: "approval.evidence.v1",
      entityType: "test",
      version: "1.0.0",
      initialState: "start",
      states: [{ id: "start" }, { id: "end" }],
      events: [{ id: "go" }],
      totalMatrix: [
        { from: "start", event: "go", result: "requires_approval", to: "end" }
      ]
    };
    const res = transitionState(def, {
      entityId: "a1",
      currentStatus: "start",
      eventType: "go",
      guardContext: {}
    });
    expect(res.ok).toBe(false);
    expect(res.blockedBy).toBe("approval");
  });

  it("should allow requires_approval with approved evidence", () => {
    const def = {
      machineId: "approval.evidence.v2",
      entityType: "test",
      version: "1.0.0",
      initialState: "start",
      states: [{ id: "start" }, { id: "end" }],
      events: [{ id: "go" }],
      totalMatrix: [
        { from: "start", event: "go", result: "requires_approval", to: "end" }
      ]
    };
    const res = transitionState(def, {
      entityId: "a2",
      currentStatus: "start",
      eventType: "go",
      guardContext: { approvalRecord: { status: "approved" } }
    });
    expect(res.ok).toBe(true);
    expect(res.requiredEffects.approval).toBe(true);
  });
});

describe("State Machine Core - requires_external_receipt", () => {
  it("should return externalReceipt required effect and allow transition", () => {
    const def = {
      machineId: "receipt.v1",
      entityType: "test",
      version: "1.0.0",
      initialState: "start",
      states: [{ id: "start" }, { id: "end" }],
      events: [{ id: "go" }],
      totalMatrix: [
        { from: "start", event: "go", result: "requires_external_receipt", to: "end", sideEffects: ["receipt_required"] }
      ]
    };
    const res = transitionState(def, {
      entityId: "r1",
      currentStatus: "start",
      eventType: "go"
    });
    expect(res.ok).toBe(true);
    expect(res.requiredEffects.externalReceipt).toBe(true);
    expect(res.toStatus).toBe("end");
  });
});

describe("State Machine Core - deferred_async_transition", () => {
  it("should return async required effect and support resumePointer", () => {
    const def = {
      machineId: "async.v1",
      entityType: "test",
      version: "1.0.0",
      initialState: "start",
      states: [{ id: "start" }, { id: "end" }],
      events: [{ id: "go" }],
      totalMatrix: [
        { from: "start", event: "go", result: "deferred_async_transition", to: "end", sideEffects: ["async_resume"] }
      ]
    };
    const res = transitionState(def, {
      entityId: "d1",
      currentStatus: "start",
      eventType: "go",
      operationId: "op-123",
      traceId: "trace-456",
      resumePointer: "resume/checkpoint/xyz"
    });
    expect(res.ok).toBe(true);
    expect(res.requiredEffects.async).toBe(true);
    expect(res.asyncTransition.required).toBe(true);
    expect(res.asyncTransition.operationId).toBe("op-123");
    expect(res.asyncTransition.traceId).toBe("trace-456");
    expect(res.asyncTransition.resumePointer).toBe("resume/checkpoint/xyz");
  });
});

describe("State Machine Core - Deep Metadata Redaction", () => {
  it("should redact nested object secrets", () => {
    const res = transitionState(mockDefinition, {
      entityId: "r1",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        config: { credentials: { apiKey: "nested-secret" } },
        label: "safe"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.config.credentials.apiKey).toEqual({ redacted: true, reason: "sensitive_key" });
    expect(res.transitionRecord.metadata.label).toBe("safe");
  });

  it("should redact secrets in nested arrays", () => {
    const res = transitionState(mockDefinition, {
      entityId: "r2",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        headers: [
          { name: "Content-Type", value: "application/json" },
          { name: "Authorization", value: "Bearer token123" }
        ]
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.headers[0].value).toBe("application/json");
    expect(res.transitionRecord.metadata.headers[1].name).toEqual({ redacted: true, reason: "sensitive_key" });
  });

  it("should redact Bearer token strings", () => {
    const res = transitionState(mockDefinition, {
      entityId: "r3",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        authHeader: "Bearer eyJhbGciOiJIUzI1NiJ9.xxx"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.authHeader).toEqual({ redacted: true, reason: "sensitive_key" });
  });

  it("should redact URL query tokens", () => {
    const res = transitionState(mockDefinition, {
      entityId: "r4",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        callbackUrl: "https://example.com/callback?token=secret123&mode=test"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.callbackUrl).toEqual({ redacted: true, reason: "sensitive_key" });
  });

  it("should redact Linux absolute paths", () => {
    const res = transitionState(mockDefinition, {
      entityId: "r5",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        path: "/home/user/data/config.json"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.path).toEqual({ redacted: true, reason: "absolute_path" });
  });

  it("should redact Windows absolute paths", () => {
    const res = transitionState(mockDefinition, {
      entityId: "r6",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        path: "C:\\Users\\test\\data\\config.json"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.path).toEqual({ redacted: true, reason: "absolute_path" });
  });

  it("should not redact safe text", () => {
    const res = transitionState(mockDefinition, {
      entityId: "r7",
      currentStatus: "submitted",
      eventType: "test.approve",
      metadata: {
        label: "production-deployment",
        count: 42,
        tags: ["approved", "verified"]
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.label).toBe("production-deployment");
    expect(res.transitionRecord.metadata.count).toBe(42);
    expect(res.transitionRecord.metadata.tags).toEqual(["approved", "verified"]);
  });
});
