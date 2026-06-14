import {
  DEFAULT_QUEUE_POLICY,
  resolveQueueMaxAckPending
} from "./policies.mjs";

function toText(value) {
  return String(value ?? "").trim();
}

function asInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function summarizeError(error) {
  if (!error) {
    return {};
  }
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || ""
  };
}

export function createQueuePushDispatcher({
  store,
  workerRuntime,
  queueDefinitionId = "",
  scope = {},
  workerId = "",
  maxAckPending = DEFAULT_QUEUE_POLICY.maxAckPending || 1000,
  maxInFlight = maxAckPending,
  peerSelector = null,
  logger = null
} = {}) {
  if (!store || typeof store.claim !== "function") {
    throw new Error("Queue Push Dispatcher requires a work queue store.");
  }
  if (!workerRuntime || typeof workerRuntime.runLeased !== "function") {
    throw new Error("Queue Push Dispatcher requires Queue Worker Runtime.");
  }

  const dispatcherQueueDefinitionId = toText(queueDefinitionId);
  const dispatcherWorkerId = toText(workerId || workerRuntime.workerId || "push-dispatcher");
  const inFlight = new Map();
  const creditLimitConfig = resolveQueueMaxAckPending(maxInFlight ?? maxAckPending, {
    fallback: maxAckPending || DEFAULT_QUEUE_POLICY.maxAckPending || 1000
  });
  const creditLimit = creditLimitConfig.limit;

  function status() {
    return {
      queueDefinitionId: dispatcherQueueDefinitionId,
      workerId: dispatcherWorkerId,
      inFlight: inFlight.size,
      creditLimit,
      requestedCreditLimit: creditLimitConfig.normalizedRequested,
      hardCreditLimit: creditLimitConfig.hardLimit,
      creditLimitClamped: creditLimitConfig.clamped,
      availableCredit: Math.max(0, creditLimit - inFlight.size)
    };
  }

  async function handoffToPeer(input = {}) {
    if (typeof peerSelector !== "function") {
      return null;
    }
    const peer = await peerSelector({
      ...input,
      status: status(),
      reason: "local_backpressure"
    });
    if (!peer) {
      return null;
    }
    if (typeof peer.dispatchOnce === "function") {
      return peer.dispatchOnce(input);
    }
    if (typeof peer.offer === "function") {
      return peer.offer(input);
    }
    return {
      accepted: false,
      reason: "peer_has_no_dispatch_interface"
    };
  }

  async function dispatchOnce(input = {}) {
    const currentStatus = status();
    const requestedBatch = Math.max(1, asInt(input.batchSize ?? input.batch ?? 1, 1));
    const batchSize = Math.min(requestedBatch, currentStatus.availableCredit);
    if (batchSize <= 0) {
      const peer = await handoffToPeer(input);
      return {
        dispatched: 0,
        claimed: [],
        inFlight: inFlight.size,
        backpressure: {
          localSaturated: true,
          peer
        }
      };
    }

    const claim = await store.claim({
      ...input,
      queueDefinitionId: input.queueDefinitionId || dispatcherQueueDefinitionId,
      scope: input.scope || scope,
      workerId: input.workerId || dispatcherWorkerId,
      batchSize
    });
    const started = [];
    for (const leased of claim.claimed || []) {
      const workItemId = leased.workItem.workItemId;
      const promise = Promise.resolve()
        .then(() => workerRuntime.runLeased({
          workItem: leased.workItem,
          lease: leased.lease,
          actor: input.actor
        }))
        .catch((error) => {
          logger?.error?.("queue.push.dispatch.failed", {
            workItemId,
            error: summarizeError(error)
          });
          return {
            failed: true,
            workItemId,
            error: summarizeError(error)
          };
        })
        .finally(() => {
          inFlight.delete(workItemId);
        });
      inFlight.set(workItemId, promise);
      started.push({
        workItemId,
        lease: leased.lease
      });
    }

    return {
      dispatched: started.length,
      claimed: claim.claimed || [],
      recovered: claim.recovered || [],
      matured: claim.matured || [],
      control: claim.control || null,
      started,
      inFlight: inFlight.size
    };
  }

  async function drain({ timeoutMs = 30_000 } = {}) {
    const startedAt = Date.now();
    while (inFlight.size > 0) {
      if (Date.now() - startedAt > timeoutMs) {
        return {
          drained: false,
          inFlight: inFlight.size
        };
      }
      await Promise.allSettled([...inFlight.values()]);
    }
    return {
      drained: true,
      inFlight: 0
    };
  }

  return Object.freeze({
    status,
    dispatchOnce,
    drain
  });
}
