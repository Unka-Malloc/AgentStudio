import { queueIdentityGenerator } from "./identity.mjs";
import { systemQueueTimeSource } from "./time-source.mjs";

function toText(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  return Math.max(1, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback);
}

function normalizeHandlerMap(handlers = {}) {
  if (typeof handlers === "function") {
    return new Map([["*", handlers]]);
  }
  if (handlers instanceof Map) {
    return new Map(handlers);
  }
  return new Map(Object.entries(asObject(handlers)));
}

function summarizeError(error) {
  if (!error) {
    return {};
  }
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || "",
    stack: typeof error.stack === "string" ? error.stack.split("\n").slice(0, 8).join("\n") : ""
  };
}

function normalizeOutcome(outcome) {
  if (outcome === undefined || outcome === null || outcome === true) {
    return { action: "ack" };
  }
  if (outcome === false) {
    return { action: "nack" };
  }
  if (typeof outcome === "string") {
    return { action: outcome };
  }
  if (typeof outcome === "object") {
    if (outcome.ack === true) {
      return { ...outcome, action: "ack" };
    }
    if (outcome.nack === true || outcome.retry === true) {
      return { ...outcome, action: "nack" };
    }
    if (outcome.term === true || outcome.terminate === true) {
      return { ...outcome, action: "term" };
    }
    if (outcome.deadLetter === true) {
      return { ...outcome, action: "dead_letter" };
    }
    if (outcome.progress === true) {
      return { ...outcome, action: "progress" };
    }
    return {
      ...outcome,
      action: toText(outcome.action || "ack")
    };
  }
  return { action: "ack" };
}

function handlerKey(workItem) {
  return [
    workItem.queueDefinitionId,
    `${workItem.queueDefinitionId}@${workItem.queueDefinitionVersion}`,
    workItem.payloadKind,
    "*"
  ];
}

export function createQueueWorkerRuntime({
  store,
  handlers = {},
  workerId = "",
  identityGenerator = queueIdentityGenerator,
  timeSource = systemQueueTimeSource,
  fallbackCoordinator = null,
  errorExplainer = null,
  enableErrorExplanation = false,
  logger = null
} = {}) {
  if (!store || typeof store.claim !== "function") {
    throw new Error("Queue Worker Runtime requires a work queue store.");
  }
  const registeredHandlers = normalizeHandlerMap(handlers);
  const runtimeWorkerId = toText(workerId || identityGenerator.workerId());

  function registerHandler(key, handler) {
    if (typeof handler !== "function") {
      throw new Error("Queue worker handler must be a function.");
    }
    registeredHandlers.set(toText(key || "*"), handler);
    return { key: toText(key || "*") };
  }

  function resolveHandler(workItem) {
    for (const key of handlerKey(workItem)) {
      const handler = registeredHandlers.get(key);
      if (handler) {
        return handler;
      }
    }
    throw new Error(`No queue worker handler registered for ${workItem.queueDefinitionId}.`);
  }

  function explainError(error, context = {}) {
    const summary = summarizeError(error);
    if (!enableErrorExplanation || typeof errorExplainer !== "function") {
      return summary;
    }
    try {
      const explanation = errorExplainer({
        error,
        summary,
        ...context
      });
      return {
        ...summary,
        explanation: asObject(explanation, { value: explanation })
      };
    } catch (explanationError) {
      return {
        ...summary,
        explanationError: summarizeError(explanationError)
      };
    }
  }

  async function applyOutcome({ workItem, lease, outcome, actor }) {
    const normalized = normalizeOutcome(outcome);
    const action = toText(normalized.action).toLowerCase();
    if (action === "ack" || action === "complete" || action === "completed") {
      return store.ack({
        workItemId: workItem.workItemId,
        leaseId: lease.leaseId,
        actor,
        reason: normalized.reason || "handler_ack"
      });
    }
    if (action === "nack" || action === "retry" || action === "defer") {
      return store.nack({
        workItemId: workItem.workItemId,
        leaseId: lease.leaseId,
        delayMs: normalized.delayMs ?? normalized.retryAfterMs,
        actor,
        reason: normalized.reason || "handler_nack",
        error: normalized.error || normalized.lastError || {}
      });
    }
    if (action === "term" || action === "terminate" || action === "terminated") {
      return store.term({
        workItemId: workItem.workItemId,
        leaseId: lease.leaseId,
        actor,
        reason: normalized.reason || "handler_term",
        reasonDetails: normalized.reasonDetails || {}
      });
    }
    if (action === "dead_letter" || action === "deadletter" || action === "dlq") {
      return store.deadLetter({
        workItemId: workItem.workItemId,
        leaseId: lease.leaseId,
        actor,
        reason: normalized.reason || "handler_dead_letter",
        error: normalized.error || normalized.lastError || {}
      });
    }
    if (action === "progress") {
      return store.progress({
        workItemId: workItem.workItemId,
        leaseId: lease.leaseId,
        extendMs: normalized.extendMs,
        actor,
        reason: normalized.reason || "handler_progress"
      });
    }
    throw new Error(`Unknown queue worker outcome action: ${normalized.action}`);
  }

  async function runLeased({ workItem, lease, handler = null, actor = {} } = {}) {
    const resolvedHandler = handler || resolveHandler(workItem);
    let settled = false;
    const runtimeActor = {
      workerId: runtimeWorkerId,
      ...actor
    };
    const context = {
      workerId: runtimeWorkerId,
      timeSource,
      workItem,
      lease,
      payloadRef: workItem.payloadRef,
      ownerRef: workItem.ownerRef,
      async progress(input = {}) {
        if (settled) {
          throw new Error("Cannot progress a settled queue work item.");
        }
        return store.progress({
          ...input,
          workItemId: workItem.workItemId,
          leaseId: lease.leaseId,
          actor: input.actor || runtimeActor
        });
      },
      async ack(input = {}) {
        if (settled) {
          throw new Error("Queue work item already settled.");
        }
        settled = true;
        return store.ack({
          ...input,
          workItemId: workItem.workItemId,
          leaseId: lease.leaseId,
          actor: input.actor || runtimeActor
        });
      },
      async nack(input = {}) {
        if (settled) {
          throw new Error("Queue work item already settled.");
        }
        settled = true;
        return store.nack({
          ...input,
          workItemId: workItem.workItemId,
          leaseId: lease.leaseId,
          actor: input.actor || runtimeActor
        });
      },
      async term(input = {}) {
        if (settled) {
          throw new Error("Queue work item already settled.");
        }
        settled = true;
        return store.term({
          ...input,
          workItemId: workItem.workItemId,
          leaseId: lease.leaseId,
          actor: input.actor || runtimeActor
        });
      },
      async deadLetter(input = {}) {
        if (settled) {
          throw new Error("Queue work item already settled.");
        }
        settled = true;
        return store.deadLetter({
          ...input,
          workItemId: workItem.workItemId,
          leaseId: lease.leaseId,
          actor: input.actor || runtimeActor
        });
      }
    };

    try {
      const outcome = await resolvedHandler({
        workItem,
        lease,
        payloadRef: workItem.payloadRef,
        ownerRef: workItem.ownerRef
      }, context);
      if (settled) {
        return { settled: true, workItemId: workItem.workItemId };
      }
      settled = true;
      const result = await applyOutcome({
        workItem,
        lease,
        outcome,
        actor: runtimeActor
      });
      return {
        settled: true,
        workItemId: workItem.workItemId,
        result
      };
    } catch (error) {
      logger?.error?.("queue.worker.handler.failed", {
        workerId: runtimeWorkerId,
        workItemId: workItem.workItemId,
        error: summarizeError(error)
      });
      if (settled) {
        throw error;
      }
      settled = true;
      const explained = explainError(error, { workItem, lease });
      if (fallbackCoordinator && typeof fallbackCoordinator.runFallback === "function") {
        const result = await fallbackCoordinator.runFallback({
          workItem,
          lease,
          workItemId: workItem.workItemId,
          leaseId: lease.leaseId,
          actor: runtimeActor,
          reason: "handler_error",
          error: explained
        });
        return {
          settled: true,
          failed: true,
          fallback: true,
          workItemId: workItem.workItemId,
          error: explained,
          result
        };
      }
      const result = await store.nack({
        workItemId: workItem.workItemId,
        leaseId: lease.leaseId,
        actor: runtimeActor,
        reason: "handler_error",
        error: explained
      });
      return {
        settled: true,
        failed: true,
        workItemId: workItem.workItemId,
        error: explained,
        result
      };
    }
  }

  async function runOnce(input = {}) {
    const claim = await store.claim({
      ...input,
      workerId: input.workerId || runtimeWorkerId,
      batchSize: asPositiveInt(input.batchSize ?? input.batch ?? 1, 1)
    });
    const results = [];
    for (const leased of claim.claimed || []) {
      results.push(await runLeased({
        workItem: leased.workItem,
        lease: leased.lease,
        actor: input.actor
      }));
    }
    return {
      workerId: claim.workerId || runtimeWorkerId,
      claimed: claim.claimed || [],
      recovered: claim.recovered || [],
      matured: claim.matured || [],
      results
    };
  }

  async function startPolling({
    intervalMs = 1000,
    signal = null,
    maxIterations = 0,
    ...claimInput
  } = {}) {
    const safeIntervalMs = Math.max(10, Number(intervalMs) || 1000);
    let iterations = 0;
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    signal?.addEventListener?.("abort", stop, { once: true });
    while (!stopped) {
      iterations += 1;
      await runOnce(claimInput);
      if (maxIterations > 0 && iterations >= maxIterations) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, safeIntervalMs));
    }
    signal?.removeEventListener?.("abort", stop);
    return { stopped: true, iterations };
  }

  return Object.freeze({
    workerId: runtimeWorkerId,
    registerHandler,
    runLeased,
    runOnce,
    startPolling
  });
}
