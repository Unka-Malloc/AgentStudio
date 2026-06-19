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
    return {
      protocol: PACTIUM_PROTOCOL,
      taskId: task.taskId,
      ok: true,
      result: {
        plannedOnly: task.taskType !== "doctor",
        daemon: false
      }
    };
  }
  return Object.freeze({ protocol: PACTIUM_PROTOCOL, planTask, runTask });
}
