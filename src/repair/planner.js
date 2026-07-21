import { PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { createId } from "../protocol/hashing.js";
import { asArray } from "../shared/records.js";

const RESUME_OPEN_INTENT_CODES = new Set([
  "intent_missing",
  "open_intent_abandoned"
]);

const PROOF_MATERIAL_CODES = new Set([
  "missing_bundle_block",
  "missing_extension_material",
  "missing_ledger_fact_material",
  "missing_ledger_proof",
  "missing_proof_material",
  "missing_proof_verifier",
  "missing_required_proof",
  "critical_extension_not_found"
]);

const HOST_EVIDENCE_CODES = new Set([
  "bad_evidence_hash",
  "bad_signature",
  "bad_signature_algorithm",
  "bad_signature_signer",
  "bad_signed_envelope_hash",
  "evidence_missing",
  "host_evidence_missing",
  "licolite_bad_signature",
  "missing_evidence_material",
  "missing_evidence_ref",
  "missing_licolite_policy",
  "missing_signature",
  "missing_signature_material",
  "missing_signature_verifier",
  "noncritical_required_extension",
  "signature_verifier_unconfigured",
  "untrusted_verification"
]);

const CONFLICT_CODES = new Set([
  "idempotency_conflict",
  "ledger_head_conflict",
  "terminal_outcome_exists"
]);

const DERIVED_INDEX_CODES = new Set([
  "bad_index",
  "bad_ledger_consistency",
  "commit_check_failed",
  "derived_index_missing",
  "derived_root_mismatch",
  "head_compact_range_mismatch",
  "incomplete_commit",
  "intent_idempotency_rebuild_incomplete",
  "ledger_consistency_check_failed",
  "ledger_leaf_check_failed",
  "ledger_replay_failed",
  "missing_index_root",
  "outcome_idempotency_rebuild_incomplete",
  "state_rebuild_incomplete"
]);

const DERIVED_INDEX_LAYERS = new Set([
  "checkpoint",
  "ledger",
  "proof-registry",
  "rebuild",
  "workspace-projection"
]);

export function createRepairPlanner() {
  function actionForFailure(failure) {
    const code = String(failure.code || "");
    const layer = String(failure.layer || "");
    if (RESUME_OPEN_INTENT_CODES.has(code)) return "resume-open-intent";
    if (PROOF_MATERIAL_CODES.has(code)) return "restore-missing-proof-material";
    if (HOST_EVIDENCE_CODES.has(code)) return "request-host-evidence";
    if (CONFLICT_CODES.has(code)) return "manual-conflict-resolution";
    if (DERIVED_INDEX_CODES.has(code) || DERIVED_INDEX_LAYERS.has(layer)) return "rebuild-derived-index";
    if (code === "unsupported_critical_extension") return "install-verifier-support";
    return "manual-investigation";
  }

  function plan(failures = []) {
    return {
      protocol: PACTIUM_PROTOCOL,
      planner: "pactium.v0.3.repair-planner",
      tasks: asArray(failures).map((failure, index) => {
        const action = actionForFailure(failure);
        return {
          taskId: createId("repair_task", { index, failure }),
          action,
          layer: failure.layer || "unknown",
          evidenceRef: failure.evidenceRef || "",
          deterministic: true,
          inventsFacts: false,
          recordsRepairFact: false
        };
      })
    };
  }

  function planRecovery({ cursor = null, failures = [], lifecycleState = {} } = {}) {
    const base = plan(failures);
    const tasks = [...base.tasks];
    if (cursor && cursor.scope) {
      tasks.push({
        taskId: createId("repair_task", { cursor, lifecycleState, kind: "cursor-recovery" }),
        action: "resume-open-intent",
        layer: "recovery",
        evidenceRef: cursor.cursorId || "",
        deterministic: true,
        inventsFacts: false,
        recordsRepairFact: false,
        cursor
      });
    }
    return {
      ...base,
      recoveryPlanType: "pactium.recovery-plan",
      cursor,
      lifecycleState,
      tasks
    };
  }

  return Object.freeze({ protocol: PACTIUM_PROTOCOL, plan, planRecovery });
}
