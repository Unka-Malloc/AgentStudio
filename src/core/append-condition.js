import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { normalizeCanonicalValue } from "../canonical/value.js";
import { createId, protocolHash } from "../protocol/hashing.js";
import { asArray, asRecord, nowIso, safeText } from "../shared/records.js";
import { createVerificationFailure, PactiumLifecycleError } from "../verification/failure.js";

export function createAppendCondition(input = {}) {
  const payload = {
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    conditionType: "pactium.append-condition",
    workspaceId: safeText(input.workspaceId, "default"),
    requiredLedgerHead: safeText(input.requiredLedgerHead || input.ledgerHead),
    requiredWorkspaceOrderRoot: safeText(input.requiredWorkspaceOrderRoot || input.workspaceOrderRoot),
    requiredWorkspaceMembershipRoot: safeText(input.requiredWorkspaceMembershipRoot || input.workspaceMembershipRoot),
    requiredOpenIntentState: normalizeCanonicalValue(asRecord(input.requiredOpenIntentState)),
    requiredOutcomeState: normalizeCanonicalValue(asRecord(input.requiredOutcomeState)),
    expectedCausalityRefs: asArray(input.expectedCausalityRefs).map(String),
    allowMissingCausalityRefs: input.allowMissingCausalityRefs === true,
    createdAt: input.createdAt || nowIso()
  };
  return {
    ...payload,
    conditionId: createId("append_condition", payload),
    conditionHash: protocolHash("append.condition", payload)
  };
}

function requiredStateMatches(required, actual) {
  const state = asRecord(required);
  if (Object.keys(state).length === 0) return true;
  if (typeof state.exists === "boolean" && actual.exists !== state.exists) return false;
  if (state.intentId && actual.intentId !== state.intentId) return false;
  if (state.outcomeId && actual.outcomeId !== state.outcomeId) return false;
  return true;
}

function fail(code, message, details = {}) {
  throw new PactiumLifecycleError(message, createVerificationFailure({
    layer: "append-condition",
    code,
    message,
    repairable: false,
    details
  }));
}

export async function assertAppendCondition(condition, {
  phase = "intent",
  currentHead = {},
  workspace = {},
  openIntentState = null,
  outcomeState = null,
  knownCausalityRefs = new Set()
} = {}) {
  if (!condition) return true;
  if (condition.requiredLedgerHead &&
    condition.requiredLedgerHead !== currentHead.headId &&
    condition.requiredLedgerHead !== currentHead.root &&
    condition.requiredLedgerHead !== currentHead.rootHash) {
    fail("ledger_head_conflict", "Append condition required a different Ledger head.", {
      requiredLedgerHead: condition.requiredLedgerHead,
      currentHeadId: currentHead.headId || "",
      currentRoot: currentHead.root || "",
      currentRootHash: currentHead.rootHash || ""
    });
  }
  if (condition.requiredWorkspaceOrderRoot && condition.requiredWorkspaceOrderRoot !== workspace.orderRoot) {
    fail("workspace_order_root_conflict", "Append condition required a different workspace order root.", {
      requiredWorkspaceOrderRoot: condition.requiredWorkspaceOrderRoot,
      currentWorkspaceOrderRoot: workspace.orderRoot || ""
    });
  }
  if (condition.requiredWorkspaceMembershipRoot && condition.requiredWorkspaceMembershipRoot !== workspace.membershipRoot) {
    fail("workspace_membership_root_conflict", "Append condition required a different workspace membership root.", {
      requiredWorkspaceMembershipRoot: condition.requiredWorkspaceMembershipRoot,
      currentWorkspaceMembershipRoot: workspace.membershipRoot || ""
    });
  }
  if (phase === "intent" && openIntentState && !requiredStateMatches(condition.requiredOpenIntentState, openIntentState)) {
    fail("open_intent_state_conflict", "Append condition required a different open-intent state.", {
      requiredOpenIntentState: condition.requiredOpenIntentState,
      actual: openIntentState
    });
  }
  if (phase === "outcome" && outcomeState && !requiredStateMatches(condition.requiredOutcomeState, outcomeState)) {
    fail("outcome_state_conflict", "Append condition required a different outcome state.", {
      requiredOutcomeState: condition.requiredOutcomeState,
      actual: outcomeState
    });
  }
  if (!condition.allowMissingCausalityRefs) {
    for (const ref of asArray(condition.expectedCausalityRefs)) {
      if (!knownCausalityRefs.has(ref)) {
        fail("unknown_causality_ref", "Append condition referenced unknown causality material.", {
          causalityRef: ref
        });
      }
    }
  }
  return true;
}
