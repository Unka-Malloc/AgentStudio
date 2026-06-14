import crypto, { randomUUID } from "node:crypto";
import PQueue from "p-queue";
import {
  computeNextRunAt,
  getMaintenanceAgentConfigPath,
  loadMaintenanceAgentConfig,
  saveMaintenanceAgentConfig
} from "./config.mjs";
import {
  createMaintenanceAgentAuditStore,
  redactForMaintenanceAudit
} from "./audit-store.mjs";
import { createMaintenancePlanner } from "./planner.mjs";
import { ensurePlanAllowed, evaluateMaintenancePlanPolicy, planHashableShape } from "./policy.mjs";
import { createMaintenanceToolRegistry } from "./tool-registry.mjs";
import {
  getRuntimeLogger,
  serverToken,
  summarizeError,
  summarizeForLog,
  unifiedRegistrationForTask
} from "../../../platform/interactive/product-api.mjs";

const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
  "rejected"
]);

const EVENT_TYPES = {
  planCreated: "maintenance.agent.plan.created",
  approvalRequired: "maintenance.agent.approval.required",
  runStarted: "maintenance.agent.run.started",
  toolStarted: "maintenance.agent.tool.started",
  toolCompleted: "maintenance.agent.tool.completed",
  toolFailed: "maintenance.agent.tool.failed",
  runCompleted: "maintenance.agent.run.completed"
};

function nowIso() {
  return new Date().toISOString();
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function hashPlan(plan) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(planHashableShape(plan)))
    .digest("hex");
}

function publicActor(authSession) {
  const user = authSession?.user;
  if (!user) {
    return {
      userId: "",
      username: "system",
      roleId: "system"
    };
  }
  return {
    userId: user.userId || "",
    username: user.username || "",
    roleId: user.roleId || ""
  };
}

function createRun({ plan, policy, trigger = "manual", actor = null, input = {} }) {
  const createdAt = nowIso();
  const runId = `maintenance_run_${randomUUID()}`;
  const planHashValue = hashPlan(plan);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    runId,
    status: policy.requiresApproval ? "awaiting_approval" : "queued",
    trigger,
    source: plan.source || "runbook",
    intent: plan.intent,
    summary: plan.summary,
    risk: policy.risk,
    requiresApproval: policy.requiresApproval,
    approvalReason: policy.reason || plan.approvalReason || "",
    planHash: planHashValue,
    plan,
    steps: plan.steps.map((step, index) => ({
      stepId: `${runId}_step_${index + 1}`,
      index,
      toolId: step.toolId,
      input: redactForMaintenanceAudit(step.input || {}),
      risk: step.risk,
      reason: step.reason,
      status: "pending",
      startedAt: "",
      completedAt: "",
      durationMs: 0,
      output: null,
      error: ""
    })),
    actor,
    input: redactForMaintenanceAudit(input),
    createdAt,
    updatedAt: createdAt,
    startedAt: "",
    completedAt: "",
    approvedAt: "",
    approvedBy: null,
    cancelRequested: false,
    error: "",
    auditIds: []
  };
}

function maintenanceRunQueueId(run) {
  return run?.runId ? serverToken("queue_item", "maintenance_agent_run", run.runId) : "";
}

function maintenanceRunRegistration(run) {
  return unifiedRegistrationForTask(run, {
    taskType: "maintenance_agent_run",
    taskId: run.runId,
    queueId: maintenanceRunQueueId(run),
    source: "maintenance-agent",
    feature: "智能巡检"
  });
}

function cloneRun(run) {
  if (!run) {
    return null;
  }
  const cloned = JSON.parse(JSON.stringify(run));
  cloned.unifiedRegistration = maintenanceRunRegistration(cloned);
  return cloned;
}

function summarizeRun(run) {
  return {
    runId: run.runId,
    status: run.status,
    trigger: run.trigger,
    source: run.source,
    intent: run.intent,
    summary: run.summary,
    risk: run.risk,
    requiresApproval: run.requiresApproval,
    approvalReason: run.approvalReason,
    planHash: run.planHash,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    approvedAt: run.approvedAt,
    actor: run.actor,
    approvedBy: run.approvedBy,
    stepSummary: {
      total: run.steps.length,
      pending: run.steps.filter((step) => step.status === "pending").length,
      running: run.steps.filter((step) => step.status === "running").length,
      completed: run.steps.filter((step) => step.status === "completed").length,
      failed: run.steps.filter((step) => step.status === "failed").length,
      cancelled: run.steps.filter((step) => step.status === "cancelled").length
    },
    error: run.error || "",
    unifiedRegistration: maintenanceRunRegistration(run)
  };
}

function normalizeConfigNextRunAt(config) {
  const now = new Date();
  return {
    ...config,
    schedules: (config.schedules || []).map((schedule) => ({
      ...schedule,
      nextRunAt:
        schedule.enabled && !schedule.nextRunAt
          ? computeNextRunAt(schedule, now)
          : schedule.nextRunAt || ""
    }))
  };
}

export function createMaintenanceAgentService({
  userDataPath,
  runtime,
  jobManager,
  metadataStore,
  protocolEventBus = null,
  getDiscoveryState = () => ({}),
  getListenUrl = () => "",
  contextRuntime = null,
  getControllers = () => null,
  operationAuditStore = null,
  operationConcurrencyScope = "maintenance-agent",
  toolManagementStore: incomingToolManagementStore = null,
  queueMonitor = null,
  schedulerEnabled = process.env.PACT_MAINTENANCE_WORKER_EXTERNAL !== "1",
  logger = getRuntimeLogger()
}) {
  const auditStore = createMaintenanceAgentAuditStore({ userDataPath });
  const toolManagementStore = incomingToolManagementStore || {
    appendExecution: () => null,
    appendMetric: () => null,
    close: () => {}
  };
  const toolRegistry = createMaintenanceToolRegistry({
    userDataPath,
    runtime,
    jobManager,
    metadataStore,
    getDiscoveryState,
    getListenUrl,
    getControllers,
    operationAuditStore,
    operationConcurrencyScope,
    logger
  });
  const planner = createMaintenancePlanner({ userDataPath, toolRegistry, contextRuntime });
  const runs = new Map();
  const maintenanceQueue = new PQueue({ concurrency: 1 });
  const queuedRunIds = [];
  const queuedRunIdSet = new Set();
  const completionWaiters = new Map();
  let config = null;
  let schedulerTimer = null;
  let activeRunId = "";
  let started = false;
  let closed = false;

  function logMaintenance(level, event, details = {}) {
    if (!logger || typeof logger[level] !== "function") {
      return;
    }
    logger[level](event, {
      schedulerEnabled,
      activeRunId,
      queuedRunCount: queuedRunIds.length,
      started,
      closed,
      ...details
    });
  }

  logMaintenance("info", "maintenance.agent.service.created", {
    userDataPath
  });

  function queueIdForRun(run) {
    return maintenanceRunQueueId(run);
  }

  function queueMonitorInputForRun(run, input = {}) {
    const queueId = queueIdForRun(run);
    return {
      queueId,
      kind: "maintenance_agent_run",
      ownerId: run.runId,
      label: run.summary || run.intent || `智能巡检任务 ${run.runId}`,
      source: input.source || "function-self-check",
      phase: input.phase || run.status || "queued",
      status: input.status || run.status || "queued",
      metadata: {
        trigger: run.trigger || "",
        source: run.source || "",
        intent: run.intent || "",
        risk: run.risk || "",
        summary: run.summary || "",
        ...input.metadata
      }
    };
  }

  function registerMaintenanceQueueStarted(run, input = {}) {
    if (!run?.runId) {
      return Promise.resolve(null);
    }
    if (typeof queueMonitor?.registerStarted !== "function") {
      return Promise.resolve(null);
    }
    return queueMonitor.registerStarted(queueMonitorInputForRun(run, input)).catch((error) => {
      logMaintenance("warn", "maintenance.agent.queue_monitor.start.failed", {
        runId: run.runId,
        queueId: queueIdForRun(run),
        error: summarizeError(error)
      });
      return null;
    });
  }

  function registerMaintenanceQueueHeartbeat(run, input = {}) {
    if (!run?.runId) {
      return Promise.resolve(null);
    }
    if (typeof queueMonitor?.registerHeartbeat !== "function") {
      return Promise.resolve(null);
    }
    return queueMonitor.registerHeartbeat(queueMonitorInputForRun(run, input)).catch((error) => {
      logMaintenance("warn", "maintenance.agent.queue_monitor.heartbeat.failed", {
        runId: run.runId,
        queueId: queueIdForRun(run),
        error: summarizeError(error)
      });
      return null;
    });
  }

  function registerMaintenanceQueueClosed(run, input = {}) {
    if (!run?.runId) {
      return Promise.resolve(null);
    }
    if (typeof queueMonitor?.registerClosed !== "function") {
      return Promise.resolve(null);
    }
    return queueMonitor.registerClosed(
      queueMonitorInputForRun(run, {
        ...input,
        phase: "closed",
        status: input.status || run.status || "closed"
      })
    ).catch((error) => {
      logMaintenance("warn", "maintenance.agent.queue_monitor.close.failed", {
        runId: run.runId,
        queueId: queueIdForRun(run),
        error: summarizeError(error)
      });
      return null;
    });
  }

  async function publish(topic, payload, type = topic) {
    if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
      return null;
    }
    return protocolEventBus.publish(topic, payload, { type });
  }

  async function audit(entry) {
    logMaintenance("debug", "maintenance.agent.audit.append.requested", {
      action: entry?.action || "",
      runId: entry?.runId || "",
      stepId: entry?.stepId || "",
      status: entry?.status || "",
      risk: entry?.risk || ""
    });
    const result = await auditStore.appendAudit(entry);
    const run = entry?.runId ? runs.get(entry.runId) : null;
    if (run) {
      run.auditIds.push(result.auditId);
    }
    logMaintenance("debug", "maintenance.agent.audit.appended", {
      auditId: result.auditId,
      action: entry?.action || "",
      runId: entry?.runId || ""
    });
    return result;
  }

  async function saveRun(run) {
    run.updatedAt = nowIso();
    runs.set(run.runId, run);
    await auditStore.appendRunSnapshot(run);
    logMaintenance("debug", "maintenance.agent.run.snapshot_saved", {
      runId: run.runId,
      status: run.status,
      risk: run.risk,
      stepSummary: summarizeRun(run).stepSummary
    });
    return run;
  }

  async function ensureStarted() {
    if (!started) {
      await start();
    }
  }

  async function refreshRunsFromStore() {
    const restoredRuns = await auditStore.listLatestRuns({ limit: 500 });
    for (const run of restoredRuns) {
      const current = runs.get(run.runId);
      if (
        current &&
        (current.status === "running" || queuedRunIdSet.has(current.runId)) &&
        !TERMINAL_STATUSES.has(current.status)
      ) {
        continue;
      }
      runs.set(run.runId, run);
    }
  }

  function setWaiter(runId) {
    if (!completionWaiters.has(runId)) {
      let resolve;
      let reject;
      const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
      });
      completionWaiters.set(runId, { promise, resolve, reject });
    }
    return completionWaiters.get(runId);
  }

  function finishWaiter(runId, value) {
    const waiter = completionWaiters.get(runId);
    if (!waiter) {
      return;
    }
    completionWaiters.delete(runId);
    waiter.resolve(value);
  }

  async function executeStep(run, step, rawStep) {
    const toolExecutionId = `tool_exec_${randomUUID()}`;
    const traceId = `trace_${run.runId}_${step.stepId}`;
    logMaintenance("info", "maintenance.agent.tool.started", {
      runId: run.runId,
      stepId: step.stepId,
      toolId: rawStep.toolId,
      risk: step.risk,
      input: summarizeForLog(rawStep.input || {})
    });
    step.status = "running";
    step.startedAt = nowIso();
    await saveRun(run);
    await publish(EVENT_TYPES.toolStarted, {
      run: summarizeRun(run),
      step: {
        stepId: step.stepId,
        toolId: step.toolId,
        risk: step.risk,
        reason: step.reason
      }
    });
    await audit({
      action: "tool.started",
      runId: run.runId,
      stepId: step.stepId,
      status: "started",
      risk: step.risk,
      actor: run.actor,
      details: {
        toolId: step.toolId,
        input: rawStep.input || {}
      }
    });

    const startedAtMs = Date.now();
    try {
      const output = await toolRegistry.runTool(rawStep.toolId, rawStep.input || {}, {
        traceId,
        run,
        step,
        approved: run.requiresApproval === false || Boolean(run.approvedAt)
      });
      step.status = "completed";
      step.completedAt = nowIso();
      step.durationMs = Date.now() - startedAtMs;
      step.output = redactForMaintenanceAudit(output);
      await saveRun(run);
      await publish(EVENT_TYPES.toolCompleted, {
        run: summarizeRun(run),
        step: {
          stepId: step.stepId,
          toolId: step.toolId,
          status: step.status,
          risk: step.risk,
          durationMs: step.durationMs,
          output: step.output
        }
      });
      await audit({
        action: "tool.completed",
        runId: run.runId,
        stepId: step.stepId,
        status: "completed",
        risk: step.risk,
        actor: run.actor,
        details: {
          toolId: step.toolId,
          durationMs: step.durationMs,
          output: step.output
        }
      });
      toolManagementStore.appendExecution({
        toolExecutionId,
        traceId,
        toolId: `maintenance-agent.${rawStep.toolId}`,
        toolVersion: "v0.0.1:platform:maintenance-agent-1",
        toolsetIds: ["pact.runtime.maintain"],
        subjectType: "agent-profile",
        subjectId: "maintenance-agent",
        grantId: "",
        agentId: "maintenance-agent",
        profileId: "maintenance-agent",
        operationId: rawStep.toolId,
        risk: step.risk,
        decision: "allow",
        input: rawStep.input || {},
        result: output,
        status: "ok",
        durationMs: step.durationMs,
        startedAt: step.startedAt,
        finishedAt: step.completedAt
      });
      toolManagementStore.appendMetric({
        traceId,
        toolId: `maintenance-agent.${rawStep.toolId}`,
        profileId: "maintenance-agent",
        status: "ok",
        risk: step.risk,
        durationMs: step.durationMs
      });
      logMaintenance("info", "maintenance.agent.tool.completed", {
        runId: run.runId,
        stepId: step.stepId,
        toolId: rawStep.toolId,
        risk: step.risk,
        durationMs: step.durationMs,
        output: summarizeForLog(output)
      });
      return { ok: true };
    } catch (error) {
      step.status = "failed";
      step.completedAt = nowIso();
      step.durationMs = Date.now() - startedAtMs;
      step.error = error instanceof Error ? error.message : "维护工具执行失败。";
      await saveRun(run);
      await publish(EVENT_TYPES.toolFailed, {
        run: summarizeRun(run),
        step: {
          stepId: step.stepId,
          toolId: step.toolId,
          status: step.status,
          risk: step.risk,
          durationMs: step.durationMs,
          error: step.error
        }
      });
      await audit({
        action: "tool.failed",
        runId: run.runId,
        stepId: step.stepId,
        status: "failed",
        risk: step.risk,
        actor: run.actor,
        details: {
          toolId: step.toolId,
          durationMs: step.durationMs,
          error: step.error
        }
      });
      toolManagementStore.appendExecution({
        toolExecutionId,
        traceId,
        toolId: `maintenance-agent.${rawStep.toolId}`,
        toolVersion: "v0.0.1:platform:maintenance-agent-1",
        toolsetIds: ["pact.runtime.maintain"],
        subjectType: "agent-profile",
        subjectId: "maintenance-agent",
        grantId: "",
        agentId: "maintenance-agent",
        profileId: "maintenance-agent",
        operationId: rawStep.toolId,
        risk: step.risk,
        decision: "allow",
        input: rawStep.input || {},
        result: {},
        status: "failed",
        errorCode: "maintenance_agent_tool_failed",
        reasonCode: "maintenance_agent_tool_failed",
        durationMs: step.durationMs,
        startedAt: step.startedAt,
        finishedAt: step.completedAt
      });
      toolManagementStore.appendMetric({
        traceId,
        toolId: `maintenance-agent.${rawStep.toolId}`,
        profileId: "maintenance-agent",
        status: "failed",
        risk: step.risk,
        reasonCode: "maintenance_agent_tool_failed",
        durationMs: step.durationMs
      });
      logMaintenance("error", "maintenance.agent.tool.failed", {
        runId: run.runId,
        stepId: step.stepId,
        toolId: rawStep.toolId,
        risk: step.risk,
        durationMs: step.durationMs,
        error: summarizeError(error)
      });
      return { ok: false, error: step.error };
    }
  }

  async function executeRun(run) {
    logMaintenance("info", "maintenance.agent.run.started", {
      runId: run.runId,
      trigger: run.trigger,
      source: run.source,
      intent: run.intent,
      risk: run.risk,
      stepCount: run.plan?.steps?.length || 0
    });
    activeRunId = run.runId;
    run.status = "running";
    run.startedAt = run.startedAt || nowIso();
    await saveRun(run);
    await registerMaintenanceQueueHeartbeat(run, {
      phase: "running",
      status: "running",
      metadata: { stage: "maintenance_run_started" }
    });
    await publish(EVENT_TYPES.runStarted, { run: summarizeRun(run) });
    await audit({
      action: "run.started",
      runId: run.runId,
      status: "started",
      risk: run.risk,
      actor: run.actor,
      details: {
        intent: run.intent,
        planHash: run.planHash
      }
    });

    let hasFailedReadOnlyStep = false;
    try {
      for (const [index, rawStep] of run.plan.steps.entries()) {
        const step = run.steps[index];
        if (run.cancelRequested) {
          logMaintenance("warn", "maintenance.agent.step.cancelled", {
            runId: run.runId,
            stepId: step.stepId,
            toolId: rawStep.toolId
          });
          step.status = "cancelled";
          step.completedAt = nowIso();
          continue;
        }
        const result = await executeStep(run, step, rawStep);
        await registerMaintenanceQueueHeartbeat(run, {
          phase: run.status,
          status: run.status,
          metadata: {
            stage: step.status,
            stepId: step.stepId,
            toolId: rawStep.toolId
          }
        });
        if (!result.ok) {
          if (rawStep.risk === "read_only" && run.risk === "read_only") {
            hasFailedReadOnlyStep = true;
            continue;
          }
          run.status = "failed";
          run.error = result.error;
          break;
        }
      }

      if (run.cancelRequested) {
        run.status = "cancelled";
        run.error = "管理员已取消维护运行。";
      } else if (run.status === "running") {
        run.status = hasFailedReadOnlyStep ? "completed_with_errors" : "completed";
      }
      run.completedAt = nowIso();
      await saveRun(run);
      await publish(EVENT_TYPES.runCompleted, { run: cloneRun(run) });
      await audit({
        action: "run.completed",
        runId: run.runId,
        status: run.status,
        risk: run.risk,
        actor: run.actor,
        details: {
          intent: run.intent,
          error: run.error || ""
        }
      });
      finishWaiter(run.runId, cloneRun(run));
      logMaintenance(run.status === "failed" ? "error" : "info", "maintenance.agent.run.completed", {
        runId: run.runId,
        status: run.status,
        risk: run.risk,
        error: run.error || ""
      });
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : "维护运行失败。";
      run.completedAt = nowIso();
      await saveRun(run);
      await publish(EVENT_TYPES.runCompleted, { run: cloneRun(run) });
      await audit({
        action: "run.failed",
        runId: run.runId,
        status: "failed",
        risk: run.risk,
        actor: run.actor,
        details: {
          error: run.error
        }
      });
      finishWaiter(run.runId, cloneRun(run));
      logMaintenance("error", "maintenance.agent.run.failed", {
        runId: run.runId,
        risk: run.risk,
        error: summarizeError(error)
      });
    } finally {
      if (TERMINAL_STATUSES.has(run.status)) {
        await registerMaintenanceQueueClosed(run, {
          status: run.status,
          metadata: { stage: "maintenance_run_closed" }
        });
      }
      activeRunId = "";
      logMaintenance("debug", "maintenance.agent.run.released", {
        runId: run.runId
      });
    }
  }

  function removeQueuedRunId(runId) {
    if (!queuedRunIdSet.has(runId)) {
      logMaintenance("debug", "maintenance.agent.queue.remove.skipped", {
        runId,
        reason: "not_queued"
      });
      return false;
    }
    queuedRunIdSet.delete(runId);
    const index = queuedRunIds.indexOf(runId);
    if (index >= 0) {
      queuedRunIds.splice(index, 1);
    }
    logMaintenance("info", "maintenance.agent.queue.removed", {
      runId,
      removedIndex: index
    });
    return true;
  }

  async function executeQueuedRun(runId) {
    logMaintenance("info", "maintenance.agent.queue.dispatch.started", {
      runId
    });
    removeQueuedRunId(runId);
    if (closed) {
      logMaintenance("warn", "maintenance.agent.queue.dispatch.skipped", {
        runId,
        reason: "closed"
      });
      finishWaiter(runId, cloneRun(runs.get(runId)));
      return null;
    }
    const run = runs.get(runId);
    if (!run || TERMINAL_STATUSES.has(run.status) || run.status === "awaiting_approval") {
      logMaintenance("warn", "maintenance.agent.queue.dispatch.skipped", {
        runId,
        reason: !run ? "run_missing" : `status_${run.status}`
      });
      if (run && TERMINAL_STATUSES.has(run.status)) {
        await registerMaintenanceQueueClosed(run, {
          status: run.status,
          metadata: { stage: "maintenance_queue_dispatch_terminal" }
        });
      }
      finishWaiter(runId, cloneRun(run));
      return cloneRun(run);
    }
    await executeRun(run);
    return cloneRun(runs.get(runId));
  }

  function enqueueQueueTask(run) {
    if (!run?.runId || queuedRunIdSet.has(run.runId) || run.status === "running") {
      logMaintenance("info", "maintenance.agent.queue.enqueue.skipped", {
        runId: run?.runId || "",
        reason: !run?.runId
          ? "missing_run_id"
          : queuedRunIdSet.has(run.runId)
            ? "already_queued"
            : "already_running"
      });
      return false;
    }
    queuedRunIds.push(run.runId);
    queuedRunIdSet.add(run.runId);
    logMaintenance("info", "maintenance.agent.queue.enqueued", {
      runId: run.runId,
      status: run.status,
      risk: run.risk
    });
    void registerMaintenanceQueueStarted(run, {
      phase: "queued",
      status: "queued",
      metadata: { stage: "maintenance_queue_enqueued" }
    });
    void maintenanceQueue.add(() => executeQueuedRun(run.runId), { id: run.runId }).catch(async (error) => {
      removeQueuedRunId(run.runId);
      logMaintenance("error", "maintenance.agent.queue.task_failed", {
        runId: run.runId,
        error: summarizeError(error)
      });
      const current = runs.get(run.runId);
      if (current && !TERMINAL_STATUSES.has(current.status)) {
        current.status = "failed";
        current.error = error instanceof Error ? error.message : "维护队列执行失败。";
        current.completedAt = nowIso();
        await saveRun(current);
        await registerMaintenanceQueueClosed(current, {
          status: "failed",
          metadata: { stage: "maintenance_queue_task_failed" }
        });
        await publish(EVENT_TYPES.runCompleted, { run: cloneRun(current) });
        finishWaiter(current.runId, cloneRun(current));
      }
    });
    return true;
  }

  async function enqueueRun(run, { wait = true } = {}) {
    logMaintenance("info", "maintenance.agent.run.enqueue.requested", {
      runId: run.runId,
      wait,
      status: run.status,
      risk: run.risk
    });
    const waiter = setWaiter(run.runId);
    if (!queuedRunIdSet.has(run.runId) && run.status !== "running") {
      run.status = "queued";
      await saveRun(run);
      enqueueQueueTask(run);
    }
    if (wait) {
      await waiter.promise.catch(() => null);
      return cloneRun(runs.get(run.runId));
    }
    return cloneRun(run);
  }

  async function createRunFromPlan({ plan, trigger = "manual", authSession = null, input = {} }) {
    await ensureStarted();
    logMaintenance("info", "maintenance.agent.plan.received", {
      trigger,
      intent: plan?.intent || "",
      source: plan?.source || "",
      stepCount: plan?.steps?.length || 0,
      input: summarizeForLog(input)
    });
    const policy = ensurePlanAllowed({ plan, config });
    const run = createRun({
      plan,
      policy,
      trigger,
      actor: publicActor(authSession),
      input
    });
    await saveRun(run);
    await publish(EVENT_TYPES.planCreated, {
      run: summarizeRun(run),
      plan: run.plan
    });
    logMaintenance("info", "maintenance.agent.plan.created", {
      runId: run.runId,
      trigger,
      intent: run.intent,
      source: run.source,
      risk: run.risk,
      requiresApproval: run.requiresApproval,
      planHash: run.planHash
    });
    await audit({
      action: "plan.created",
      runId: run.runId,
      status: run.status,
      risk: run.risk,
      actor: run.actor,
      details: {
        plan: run.plan,
        policy
      }
    });
    if (run.status === "awaiting_approval") {
      await publish(EVENT_TYPES.approvalRequired, {
        run: summarizeRun(run),
        planHash: run.planHash,
        approvalReason: run.approvalReason
      });
      await audit({
        action: "approval.required",
        runId: run.runId,
        status: "awaiting_approval",
        risk: run.risk,
        actor: run.actor,
        details: {
          planHash: run.planHash,
          approvalReason: run.approvalReason
        }
      });
      logMaintenance("warn", "maintenance.agent.approval.required", {
        runId: run.runId,
        risk: run.risk,
        planHash: run.planHash,
        approvalReason: run.approvalReason
      });
    }
    return run;
  }

  async function start() {
    if (started) {
      logMaintenance("debug", "maintenance.agent.start.skipped", {
        reason: "already_started"
      });
      return;
    }
    logMaintenance("info", "maintenance.agent.start.requested", {});
    config = normalizeConfigNextRunAt(await loadMaintenanceAgentConfig(userDataPath));
    const restoredRuns = await auditStore.listLatestRuns({ limit: 500 });
    for (const run of restoredRuns) {
      runs.set(run.runId, run);
    }
    started = true;
    for (const run of restoredRuns) {
      if (run.status === "queued" || run.status === "running") {
        run.status = "queued";
        run.error = "";
        await saveRun(run);
        enqueueQueueTask(run);
      }
    }
    if (config.enabled) {
      await saveMaintenanceAgentConfig(userDataPath, config);
    }
    if (schedulerEnabled) {
      startScheduler();
    }
    logMaintenance("info", "maintenance.agent.started", {
      enabled: config.enabled,
      restoredRunCount: restoredRuns.length,
      scheduleCount: config.schedules?.length || 0
    });
  }

  function startScheduler() {
    if (!schedulerEnabled) {
      logMaintenance("info", "maintenance.agent.scheduler.skipped", {
        reason: "disabled_by_process_mode"
      });
      return;
    }
    if (schedulerTimer || closed) {
      logMaintenance("debug", "maintenance.agent.scheduler.skipped", {
        reason: schedulerTimer ? "already_running" : "closed"
      });
      return;
    }
    const tickMs = Math.max(1, Number(config?.scheduler?.tickSeconds || 30)) * 1000;
    schedulerTimer = setInterval(() => {
      void tickScheduler().catch((error) => {
        logMaintenance("error", "maintenance.agent.scheduler.tick.failed", {
          error: summarizeError(error)
        });
      });
    }, tickMs);
    schedulerTimer.unref?.();
    logMaintenance("info", "maintenance.agent.scheduler.started", {
      tickMs
    });
  }

  async function tickScheduler() {
    logMaintenance("debug", "maintenance.agent.scheduler.tick.started", {});
    await ensureStarted();
    if (!config.enabled || closed) {
      logMaintenance("debug", "maintenance.agent.scheduler.tick.skipped", {
        reason: closed ? "closed" : "config_disabled"
      });
      return;
    }
    const now = new Date();
    let changed = false;
    for (const schedule of config.schedules || []) {
      if (!schedule.enabled) {
        continue;
      }
      if (!schedule.nextRunAt) {
        schedule.nextRunAt = computeNextRunAt(schedule, now);
        changed = true;
        continue;
      }
      if (Date.parse(schedule.nextRunAt) > now.getTime()) {
        continue;
      }
      schedule.nextRunAt = computeNextRunAt(schedule, now);
      changed = true;
      const plan = await planner.plan(
        {
          runbook: schedule.runbook,
          intent: schedule.runbook,
          sessionId: `maintenance-schedule-${schedule.id || schedule.runbook}`,
          contextCompaction: { persist: true }
        },
        config
      );
      const run = await createRunFromPlan({
        plan,
        trigger: "schedule",
        input: {
          scheduleId: schedule.id,
          runbook: schedule.runbook
        }
      });
      if (!run.requiresApproval) {
        await enqueueRun(run, { wait: false });
      }
      logMaintenance("info", "maintenance.agent.scheduler.run_created", {
        scheduleId: schedule.id,
        runbook: schedule.runbook,
        runId: run.runId,
        requiresApproval: run.requiresApproval,
        nextRunAt: schedule.nextRunAt
      });
    }
    if (changed) {
      config = await saveMaintenanceAgentConfig(userDataPath, config);
      await publish("maintenance.agent.config", { config }, "maintenance.agent.config.updated");
      logMaintenance("info", "maintenance.agent.scheduler.config_saved", {
        scheduleCount: config.schedules?.length || 0
      });
    }
    logMaintenance("debug", "maintenance.agent.scheduler.tick.completed", {
      changed
    });
  }

  async function getConfig() {
    logMaintenance("info", "maintenance.agent.config.get.requested", {});
    await ensureStarted();
    return {
      path: getMaintenanceAgentConfigPath(userDataPath),
      config
    };
  }

  async function setConfig(input = {}, { authSession = null } = {}) {
    logMaintenance("info", "maintenance.agent.config.set.requested", {
      input: summarizeForLog(input),
      actor: publicActor(authSession)
    });
    await ensureStarted();
    config = normalizeConfigNextRunAt(await saveMaintenanceAgentConfig(userDataPath, input));
    await saveMaintenanceAgentConfig(userDataPath, config);
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (schedulerEnabled) {
      startScheduler();
    }
    await publish("maintenance.agent.config", { config }, "maintenance.agent.config.updated");
    await audit({
      action: "config.updated",
      status: "ok",
      risk: "safe_write",
      actor: publicActor(authSession),
      details: {
        enabled: config.enabled,
        plannerMode: config.plannerMode,
        autoApproveRisk: config.autoApproveRisk,
        schedules: config.schedules
      }
    });
    logMaintenance("info", "maintenance.agent.config.updated", {
      enabled: config.enabled,
      plannerMode: config.plannerMode,
      autoApproveRisk: config.autoApproveRisk,
      scheduleCount: config.schedules?.length || 0
    });
    return {
      config
    };
  }

  async function chat(input = {}, { authSession = null } = {}) {
    logMaintenance("info", "maintenance.agent.chat.requested", {
      input: summarizeForLog(input),
      actor: publicActor(authSession)
    });
    await ensureStarted();
    const plan = await planner.plan(
      {
        message: input.message || input.question || input.intent || "",
        intent: input.intent || "",
        sessionId: input.sessionId || "",
        userId: authSession?.user?.userId || "",
        modelAlias: input.modelAlias || input.alias || "",
        alias: input.modelAlias || input.alias || "",
        agentName: input.agentName || "",
        messages: input.messages || input.transcript || undefined,
        transcript: input.transcript || undefined,
        history: input.history || "",
        recentTurns: input.recentTurns || [],
        contextCompaction: input.contextCompaction,
        contextProfileId: input.contextProfileId || input.compactionProfileId || ""
      },
      config
    );
    const policy = evaluateMaintenancePlanPolicy({ plan, config });
    if (!policy.ok) {
      throw new Error(policy.reason);
    }
    const run = await createRunFromPlan({
      plan,
      trigger: "chat",
      authSession,
      input
    });
    if (run.requiresApproval) {
      logMaintenance("info", "maintenance.agent.chat.awaiting_approval", {
        runId: run.runId,
        risk: run.risk
      });
      return {
        plan: run.plan,
        run: cloneRun(run)
      };
    }
    const completed = await enqueueRun(run, { wait: input.wait !== false });
    return {
      plan: run.plan,
      run: completed
    };
  }

  async function startRun(input = {}, { authSession = null } = {}) {
    logMaintenance("info", "maintenance.agent.run.start_requested", {
      input: summarizeForLog(input),
      actor: publicActor(authSession)
    });
    await ensureStarted();
    const plan = await planner.plan(
      {
        runbook: input.runbook || input.intent || "health_smoke",
        options: input.options || {},
        sessionId: input.sessionId || "",
        messages: input.messages || input.transcript || undefined,
        transcript: input.transcript || undefined,
        history: input.history || "",
        recentTurns: input.recentTurns || [],
        contextCompaction: input.contextCompaction,
        contextProfileId: input.contextProfileId || input.compactionProfileId || ""
      },
      config
    );
    const run = await createRunFromPlan({
      plan,
      trigger: input.trigger || "manual",
      authSession,
      input
    });
    if (run.requiresApproval) {
      logMaintenance("info", "maintenance.agent.run.awaiting_approval", {
        runId: run.runId,
        risk: run.risk
      });
      return cloneRun(run);
    }
    return enqueueRun(run, { wait: input.wait !== false });
  }

  async function listRuns({ limit = 50 } = {}) {
    logMaintenance("debug", "maintenance.agent.runs.list.requested", {
      limit
    });
    await ensureStarted();
    await refreshRunsFromStore();
    return {
      items: [...runs.values()]
        .sort((left, right) =>
          String(right.updatedAt || right.createdAt || "").localeCompare(
            String(left.updatedAt || left.createdAt || "")
          )
        )
        .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)))
        .map((run) => cloneRun(run)),
      activeRunId,
      queuedRunIds: [...queuedRunIds]
    };
  }

  async function getRun(runId) {
    logMaintenance("debug", "maintenance.agent.run.get.requested", {
      runId
    });
    await ensureStarted();
    await refreshRunsFromStore();
    return cloneRun(runs.get(String(runId || "")) || null);
  }

  async function approveRun(runId, input = {}, { authSession = null } = {}) {
    logMaintenance("warn", "maintenance.agent.approve.requested", {
      runId,
      input: summarizeForLog(input),
      actor: publicActor(authSession)
    });
    await ensureStarted();
    const run = runs.get(String(runId || ""));
    if (!run) {
      return null;
    }
    if (run.status !== "awaiting_approval") {
      throw new Error("只有 awaiting_approval 状态的维护运行可以审批。");
    }
    const incomingHash = String(input.planHash || input.plan_hash || "").trim();
    if (!incomingHash || incomingHash !== run.planHash) {
      throw new Error("审批 planHash 不匹配，计划变更后必须重新审批。");
    }
    run.requiresApproval = false;
    run.status = "queued";
    run.approvedAt = nowIso();
    run.approvedBy = publicActor(authSession);
    await saveRun(run);
    await audit({
      action: "approval.approved",
      runId: run.runId,
      status: "approved",
      risk: run.risk,
      actor: run.approvedBy,
      details: {
        planHash: run.planHash
      }
    });
    logMaintenance("info", "maintenance.agent.approved", {
      runId: run.runId,
      planHash: run.planHash,
      approvedBy: run.approvedBy
    });
    return enqueueRun(run, { wait: input.wait !== false });
  }

  async function cancelRun(runId, input = {}, { authSession = null } = {}) {
    logMaintenance("warn", "maintenance.agent.cancel.requested", {
      runId,
      input: summarizeForLog(input),
      actor: publicActor(authSession)
    });
    await ensureStarted();
    const run = runs.get(String(runId || ""));
    if (!run) {
      return null;
    }
    if (TERMINAL_STATUSES.has(run.status)) {
      return cloneRun(run);
    }
    run.cancelRequested = true;
    if (run.status !== "running") {
      run.status = "cancelled";
      run.completedAt = nowIso();
      removeQueuedRunId(run.runId);
      finishWaiter(run.runId, cloneRun(run));
    }
    await saveRun(run);
    await audit({
      action: "run.cancelled",
      runId: run.runId,
      status: run.status,
      risk: run.risk,
      actor: publicActor(authSession),
      details: {
        reason: input.reason || ""
      }
    });
    await publish(EVENT_TYPES.runCompleted, { run: cloneRun(run) });
    logMaintenance("warn", "maintenance.agent.cancelled", {
      runId: run.runId,
      status: run.status
    });
    return cloneRun(run);
  }

  async function getConsoleSummary() {
    logMaintenance("debug", "maintenance.agent.console_summary.requested", {});
    await ensureStarted();
    await refreshRunsFromStore();
    const runList = await listRuns({ limit: 8 });
    const pendingApprovalCount = runList.items.filter((run) => run.status === "awaiting_approval").length;
    const nextRunAt = (config.schedules || [])
      .filter((schedule) => schedule.enabled && schedule.nextRunAt)
      .map((schedule) => schedule.nextRunAt)
      .sort()[0] || "";
    return {
      config,
      tools: toolRegistry.listTools(),
      latestRun: runList.items[0] || null,
      runs: runList.items,
      activeRunId,
      queuedRunIds: [...queuedRunIds],
      pendingApprovalCount,
      nextRunAt,
      auditPath: auditStore.auditPath,
      runsPath: auditStore.runsPath
    };
  }

  async function close() {
    logMaintenance("info", "maintenance.agent.close.started", {});
    closed = true;
    maintenanceQueue.pause();
    maintenanceQueue.clear();
    queuedRunIds.length = 0;
    queuedRunIdSet.clear();
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    toolManagementStore.close();
    logMaintenance("info", "maintenance.agent.close.completed", {});
  }

  return {
    start,
    close,
    getConfig,
    setConfig,
    chat,
    startRun,
    listRuns,
    getRun,
    approveRun,
    cancelRun,
    getConsoleSummary,
    tickScheduler,
    toolRegistry
  };
}
