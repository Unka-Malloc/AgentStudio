import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMaintenanceTaskEngine } from "../../src/index.js";

describe("Pactium maintenance task engine", () => {
  it("normalizes doctor and storage-GC execution options", async () => {
    const compactionCalls = [];
    const engine = createMaintenanceTaskEngine({
      pactium: {
        async doctor() {
          return { healthy: true };
        },
        async compactStorage(options) {
          compactionCalls.push(options);
          return options;
        }
      }
    });

    const defaultPlan = engine.planTask("doctor");
    assert.deepEqual(defaultPlan.input, {});
    assert.deepEqual((await engine.runTask(defaultPlan)).result, { healthy: true });

    const explicitGc = engine.planTask("storage-gc", { dryRun: false, reclaimPages: -4 });
    assert.deepEqual((await engine.runTask(explicitGc)).result, {
      dryRun: false,
      reclaimPages: 0
    });
    assert.deepEqual((await engine.runTask({
      taskType: "storage-gc",
      taskId: "gc-invalid-input",
      input: null
    })).result, {
      dryRun: true,
      reclaimPages: 0
    });
    assert.equal(compactionCalls.length, 2);

    const planner = createMaintenanceTaskEngine();
    assert.equal((await planner.runTask({ taskType: "doctor", taskId: "doctor-plan" })).result.plannedOnly, false);
    assert.equal((await planner.runTask({ taskType: "storage-gc", taskId: "gc-plan" })).result.plannedOnly, false);
    assert.equal((await planner.runTask({ taskType: "unknown", taskId: "unknown-plan" })).result.plannedOnly, true);
  });
});
