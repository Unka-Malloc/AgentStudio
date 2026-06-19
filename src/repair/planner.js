import { PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { createId } from "../protocol/hashing.js";
import { asArray } from "../shared/records.js";

export function createRepairPlanner() {
  function actionForFailure(failure) {
    const code = String(failure.code || "");
    const layer = String(failure.layer || "");
    if (code.includes("open_intent") || code.includes("intent_missing")) return "resume-open-intent";
    if (code.includes("missing_proof") || code.includes("missing_bundle") || code.includes("missing_extension")) return "restore-missing-proof-material";
    if (code.includes("host_evidence") || code.includes("licolite") || code.includes("evidence")) return "request-host-evidence";
    if (code.includes("conflict") || code.includes("terminal_outcome")) return "manual-conflict-resolution";
    if (layer.includes("workspace") || code.includes("workspace") || code.includes("derived") || code.includes("consistency")) return "rebuild-derived-index";
    if (code.includes("unsupported_critical")) return "install-verifier-support";
    return "manual-investigation";
  }

  function plan(failures = []) {
    return {
      protocol: PACTIUM_PROTOCOL,
      planner: "pactium.v0.2.repair-planner",
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
