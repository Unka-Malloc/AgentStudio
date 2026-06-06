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
    { "id": "test.archive", "riskLevel": "high" }
  ],
  totalMatrix: [
    { "from": "submitted", "event": "test.submit", "result": "ignored_idempotent_event" },
    { "from": "submitted", "event": "test.approve", "result": "legal_transition", "to": "approved" },
    { "from": "submitted", "event": "test.archive", "result": "illegal_transition", "errorCode": "ARCHIVE_BEFORE_APPROVAL" },
    
    { "from": "approved", "event": "test.submit", "result": "illegal_transition", "errorCode": "ALREADY_APPROVED" },
    { "from": "approved", "event": "test.approve", "result": "ignored_idempotent_event" },
    { "from": "approved", "event": "test.archive", "result": "requires_policy", "to": "archived" },
    
    { "from": "archived", "event": "test.submit", "result": "illegal_transition", "errorCode": "ALREADY_ARCHIVED" },
    { "from": "archived", "event": "test.approve", "result": "illegal_transition", "errorCode": "ALREADY_ARCHIVED" },
    { "from": "archived", "event": "test.archive", "result": "ignored_idempotent_event" }
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
