import { describe, expect, it, vi } from "vitest";
import {
  ORIGINAL_TYPES,
  UnifiedRegistration,
  composeUnifiedSystemStatus,
  normalizeUnifiedRegistration,
  routeUnifiedRegistration,
  unifiedRegistrationForAlert,
  unifiedRegistrationForMonitor,
  unifiedRegistrationForProcess,
  unifiedRegistrationForQueue,
  unifiedRegistrationForTask
} from "../../../server/platform/common/devops/unified-registration-core/unified-registration.mjs";

describe("unified registration final extra coverage", () => {
  it("normalizes concrete registrations and composes status buckets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    try {
      const process = unifiedRegistrationForProcess({
        role: "worker",
        label: "Worker",
        status: "running",
        processType: "service",
        features: ["jobs", ""],
        services: ["queue"],
        monitors: ["heartbeat"],
        alerts: ["alert-1"],
        pid: 123,
        stale: false,
        desired: true
      });
      const queue = unifiedRegistrationForQueue({
        queueId: "queue-1",
        lifecycleStatus: "interrupted",
        sources: ["upload", "jobs"],
        ownerId: "owner-1",
        checkpointId: "checkpoint-1"
      });
      const task = unifiedRegistrationForTask({
        id: "task-1",
        status: "awaiting_approval",
        progressPercent: 50,
        stage: "review"
      }, {
        queueId: "queue-1",
        feature: "knowledge",
        taskType: "maintenance"
      });
      const monitor = unifiedRegistrationForMonitor({
        monitorId: "monitor-1",
        status: "degraded",
        features: ["runtime"],
        summary: { ok: false }
      });
      const alert = unifiedRegistrationForAlert({
        alertId: "alert-1",
        title: "Alert",
        severity: "critical",
        active: true,
        ackRequired: false,
        ruleId: "rule-1"
      });

      expect(process).toMatchObject({
        registrationId: "process:worker",
        route: { section: "processes" },
        tone: "running",
        relations: {
          features: ["jobs"],
          services: ["queue"],
          monitors: ["heartbeat"],
          alerts: ["alert-1"]
        }
      });
      expect(queue.tone).toBe("danger");
      expect(task.tone).toBe("queued");
      expect(monitor.tone).toBe("warning");
      expect(alert.tone).toBe("danger");

      const status = composeUnifiedSystemStatus([process, queue, task, monitor, alert, null], {
        updatedAt: "2026-06-06T01:00:00.000Z",
        source: "unit"
      });
      expect(status.summary).toEqual({
        totalCount: 5,
        processCount: 1,
        queueCount: 1,
        taskCount: 1,
        monitorCount: 1,
        alertCount: 1
      });
      expect(status.processes[0].originalId).toBe("worker");
      expect(status.alerts[0].originalRef).toEqual({ alertId: "alert-1", ruleId: "rule-1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates base class, invalid records, and route fallbacks", () => {
    const base = new UnifiedRegistration();
    expect(() => base.getOriginalType()).toThrow("UnifiedRegistration.getOriginalType must be implemented.");
    expect(() => base.getOriginalId()).toThrow("UnifiedRegistration.getOriginalId must be implemented.");
    expect(base.getStatus()).toBe("unknown");
    expect(base.getSource()).toBe("");
    expect(base.getRelations()).toEqual({});
    expect(base.getAttributes()).toEqual({});
    expect(base.getOriginalRef()).toEqual({});

    expect(routeUnifiedRegistration({ originalType: ORIGINAL_TYPES.PROCESS })).toMatchObject({
      originalType: ORIGINAL_TYPES.PROCESS,
      section: "processes"
    });
    expect(() => routeUnifiedRegistration({ originalType: "missing" }))
      .toThrow("Unsupported unified registration type: missing");
    expect(() => normalizeUnifiedRegistration({ originalId: "x" }))
      .toThrow("Invalid unified registration record.");

    const normalized = normalizeUnifiedRegistration({
      schemaVersion: 1,
      registrationId: "process:manual",
      originalType: ORIGINAL_TYPES.PROCESS,
      originalId: "manual"
    });
    expect(normalized.route.section).toBe("processes");
  });
});
