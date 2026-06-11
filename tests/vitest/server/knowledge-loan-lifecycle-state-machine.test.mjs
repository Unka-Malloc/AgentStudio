import fs from "node:fs/promises";
import path from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import {
  validateStateMachineDefinition,
  transitionState
} from "../../../server/platform/common/state-machine/state-machine-core.mjs";
import {
  evaluateKnowledgeAccess,
  createDerivedKnowledgeView,
  createAuthorizationOverlay
} from "../../../server/platform/specialized/knowledge/agent-library/access-policy.mjs";

const __dirname = path.fileURLToPath(new URL(".", import.meta.url));
const defPath = path.resolve(__dirname, "../../../server/platform/common/state-machine/definitions/agentlibrary.loan.v1.json");
const allowPolicyGuardContext = { policyDecision: { allowed: true } };

describe("Knowledge Loan Lifecycle State Machine", () => {
  let definition;

  beforeAll(async () => {
    const raw = await fs.readFile(defPath, "utf8");
    definition = JSON.parse(raw);
  });

  it("should pass schema and core validation checks", () => {
    const validation = validateStateMachineDefinition(definition);
    expect(validation.ok).toBe(true);
    expect(definition.machineId).toBe("agentlibrary.loan.v1");
    expect(definition.initialState).toBe("loan_requested");
  });

  it("should transition successfully through the main legal pathway", () => {
    // 1. loan_requested -> loan_active
    let res = transitionState(definition, {
      entityId: "loan-1",
      currentStatus: "loan_requested",
      eventType: "loan.activate"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("loan_active");

    // 2. loan_active -> renewal_requested
    res = transitionState(definition, {
      entityId: "loan-1",
      currentStatus: "loan_active",
      eventType: "loan.renew_request"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("renewal_requested");

    // 3. renewal_requested -> renewed
    res = transitionState(definition, {
      entityId: "loan-1",
      currentStatus: "renewal_requested",
      eventType: "loan.renew",
      guardContext: allowPolicyGuardContext
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("renewed");

    // 4. renewed -> loan_active
    res = transitionState(definition, {
      entityId: "loan-1",
      currentStatus: "renewed",
      eventType: "loan.activate"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("loan_active");

    // 5. loan_active -> returned
    res = transitionState(definition, {
      entityId: "loan-1",
      currentStatus: "loan_active",
      eventType: "loan.return"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("returned");
  });

  it("should handle alternative branches (active -> expired)", () => {
    let res = transitionState(definition, {
      entityId: "loan-2",
      currentStatus: "loan_active",
      eventType: "loan.expire"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("expired");
  });

  it("should handle alternative branches (active -> revoked)", () => {
    let res = transitionState(definition, {
      entityId: "loan-3",
      currentStatus: "loan_active",
      eventType: "loan.revoke",
      guardContext: allowPolicyGuardContext
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("revoked");
  });

  it("should handle alternative branches (requested -> expired/revoked)", () => {
    let res = transitionState(definition, {
      entityId: "loan-4",
      currentStatus: "loan_requested",
      eventType: "loan.expire"
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("expired");

    res = transitionState(definition, {
      entityId: "loan-4",
      currentStatus: "loan_requested",
      eventType: "loan.revoke",
      guardContext: allowPolicyGuardContext
    });
    expect(res.ok).toBe(true);
    expect(res.toStatus).toBe("revoked");
  });

  it("should reject illegal transitions with structured error codes", () => {
    // Cannot renew active loan without renew_request
    let res = transitionState(definition, {
      entityId: "loan-5",
      currentStatus: "loan_active",
      eventType: "loan.renew"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("LOAN_RENEW_NOT_REQUESTED");

    // Cannot return requested loan
    res = transitionState(definition, {
      entityId: "loan-5",
      currentStatus: "loan_requested",
      eventType: "loan.return"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("LOAN_NOT_ACTIVE");

    // Cannot renew requested loan
    res = transitionState(definition, {
      entityId: "loan-5",
      currentStatus: "loan_requested",
      eventType: "loan.renew"
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("LOAN_NOT_ACTIVE");
  });

  it("should handle idempotent events correctly", () => {
    // requested + request
    let res = transitionState(definition, {
      entityId: "loan-6",
      currentStatus: "loan_requested",
      eventType: "loan.request"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("loan_requested");

    // active + activate
    res = transitionState(definition, {
      entityId: "loan-6",
      currentStatus: "loan_active",
      eventType: "loan.activate"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("loan_active");

    // renewal_requested + renew_request
    res = transitionState(definition, {
      entityId: "loan-6",
      currentStatus: "renewal_requested",
      eventType: "loan.renew_request"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("renewal_requested");

    // renewed + renew
    res = transitionState(definition, {
      entityId: "loan-6",
      currentStatus: "renewed",
      eventType: "loan.renew"
    });
    expect(res.ok).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.toStatus).toBe("renewed");
  });

  it("PO-LOAN-001: denied access must not generate loan_active", () => {
    const view = createDerivedKnowledgeView({
      upstreamRef: "knowledge-source-a",
      workspaceId: "workspace-a",
      allowedSubjects: "subject-a",
      refs: ["ref-1"]
    });
    const overlay = createAuthorizationOverlay({
      derivedViewRef: view.derivedViewRef,
      defaultAccessMode: "checkoutAllowed",
      rules: []
    });

    // Request from denied subject
    const decision = evaluateKnowledgeAccess({
      subject: { subjectId: "subject-denied" },
      workspaceId: "workspace-a",
      requestedAction: "read",
      requestedEgress: "memoryWrite"
    }, { view, authorizationOverlay: overlay });

    expect(decision.allowed).toBe(false);
    expect(decision.loanRecord).toBeNull();
  });

  it("PO-LOAN-002: revoked loan must not continue to export/share/retain", () => {
    for (const event of definition.events) {
      const res = transitionState(definition, {
        entityId: "loan-7",
        currentStatus: "revoked",
        eventType: event.id
      });
      if (event.id === "loan.revoke") {
        expect(res.ok).toBe(true);
        expect(res.idempotent).toBe(true);
      } else {
        expect(res.ok).toBe(false);
        expect(res.errorCode).toBe("LOAN_ALREADY_REVOKED");
      }
    }
  });

  it("PO-LOAN-003: expired loan must not continue egress and cannot transition back unless renewed from active", () => {
    for (const event of definition.events) {
      const res = transitionState(definition, {
        entityId: "loan-8",
        currentStatus: "expired",
        eventType: event.id
      });
      if (event.id === "loan.expire") {
        expect(res.ok).toBe(true);
        expect(res.idempotent).toBe(true);
      } else {
        expect(res.ok).toBe(false);
        expect(res.errorCode).toBe("LOAN_ALREADY_EXPIRED");
      }
    }
  });

  it("PO-LOAN-004: active loan transition record metadata can associate receiptId and auditId", () => {
    const res = transitionState(definition, {
      entityId: "loan-9",
      currentStatus: "loan_requested",
      eventType: "loan.activate",
      operationId: "op-1",
      auditId: "audit-1",
      metadata: {
        receiptId: "receipt-1",
        auditId: "audit-1"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.transitionRecord.metadata.receiptId.redacted).toBeUndefined();
    expect(res.transitionRecord.metadata.receiptId).toBe("receipt-1");
    expect(res.transitionRecord.metadata.auditId).toBe("audit-1");
  });

  it("PO-LOAN-005: checkout retain/share are only set when accessMode is checkoutAllowed", () => {
    const view = createDerivedKnowledgeView({
      upstreamRef: "knowledge-source-b",
      workspaceId: "workspace-b",
      allowedSubjects: "subject-b",
      checkoutPolicy: {
        allowRetain: true,
        allowShare: true,
        expiresInSeconds: 60
      },
      refs: ["ref-2"]
    });
    const overlay = createAuthorizationOverlay({
      derivedViewRef: view.derivedViewRef,
      defaultAccessMode: "checkoutAllowed",
      rules: []
    });

    // 1. With checkoutAllowed accessMode
    const decisionAllowed = evaluateKnowledgeAccess({
      subject: { subjectId: "subject-b" },
      workspaceId: "workspace-b",
      requestedAction: "read",
      requestedAccessMode: "checkoutAllowed",
      requestedEgress: "memoryWrite"
    }, { view, authorizationOverlay: overlay });

    expect(decisionAllowed.allowed).toBe(true);
    expect(decisionAllowed.accessMode).toBe("checkoutAllowed");
    expect(decisionAllowed.canRetain).toBe(true);
    expect(decisionAllowed.canShare).toBe(true);

    // 2. With weaker accessMode (controlledView)
    const decisionWeaker = evaluateKnowledgeAccess({
      subject: { subjectId: "subject-b" },
      workspaceId: "workspace-b",
      requestedAction: "read",
      requestedAccessMode: "controlledView",
      requestedEgress: "searchResult"
    }, { view, authorizationOverlay: overlay });

    expect(decisionWeaker.allowed).toBe(true);
    expect(decisionWeaker.accessMode).toBe("controlledView");
    expect(decisionWeaker.canRetain).toBe(false);
    expect(decisionWeaker.canShare).toBe(false);
  });
});
