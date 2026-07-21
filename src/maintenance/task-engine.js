import { PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { normalizeCanonicalValue } from "../canonical/value.js";
import { createId } from "../protocol/hashing.js";

export function createMaintenanceTaskEngine({ pactium = null } = {}) {
  function planTask(taskType, input = {}) {
    return {
      protocol: PACTIUM_PROTOCOL,
      taskId: createId("maintenance_task", { taskType, input }),
      taskType,
      input: normalizeCanonicalValue(input),
      scheduler: "host-owned",
      deterministic: true
    };
  }
  async function runTask(task) {
    if (task.taskType === "doctor" && pactium) {
      return {
        protocol: PACTIUM_PROTOCOL,
        taskId: task.taskId,
        ok: true,
        result: await pactium.doctor()
      };
    }
    if (task.taskType === "storage-gc" && pactium) {
      const input = task.input && typeof task.input === "object" ? task.input : {};
      return {
        protocol: PACTIUM_PROTOCOL,
        taskId: task.taskId,
        ok: true,
        result: await pactium.compactStorage({
          dryRun: input.dryRun !== false,
          reclaimPages: Number.isSafeInteger(Number(input.reclaimPages))
            ? Math.max(0, Number(input.reclaimPages))
            : 0
        })
      };
    }
    return {
      protocol: PACTIUM_PROTOCOL,
      taskId: task.taskId,
      ok: true,
      result: {
        plannedOnly: !["doctor", "storage-gc"].includes(task.taskType),
        daemon: false
      }
    };
  }
  return Object.freeze({ protocol: PACTIUM_PROTOCOL, planTask, runTask });
}
