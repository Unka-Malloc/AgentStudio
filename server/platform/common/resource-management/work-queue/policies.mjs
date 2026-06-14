export const WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT = 8192;

export const DEFAULT_QUEUE_POLICY = Object.freeze({
  policyVersion: "v0.0.1:workflow:work-queue-default-1",
  leaseTimeoutMs: 30_000,
  maxAckPending: 1000,
  maxAttempts: 16,
  retryBackoff: Object.freeze({
    strategy: "exponential",
    initialDelayMs: 1_000,
    multiplier: 2,
    maxDelayMs: 300_000,
    jitter: "none"
  }),
  fallbackRetry: Object.freeze({
    maxAttempts: 3,
    initialDelayMs: 250,
    multiplier: 2,
    maxDelayMs: 5_000
  }),
  backgroundWriteRetry: Object.freeze({
    maxAttempts: 5,
    initialDelayMs: 100,
    multiplier: 2,
    maxDelayMs: 10_000
  }),
  memoryGuard: Object.freeze({
    maxInMemoryFallbackTasks: 1024,
    maxPendingBackgroundWrites: 4096
  })
});

function asInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function resolveQueueMaxAckPending(value, { fallback = DEFAULT_QUEUE_POLICY.maxAckPending } = {}) {
  const fallbackLimit = Math.max(1, asInt(fallback, DEFAULT_QUEUE_POLICY.maxAckPending));
  const requested = asInt(value ?? fallbackLimit, fallbackLimit);
  const normalizedRequested = Math.max(1, requested);
  const limit = Math.min(normalizedRequested, WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT);
  return Object.freeze({
    requested,
    normalizedRequested,
    limit,
    hardLimit: WORK_QUEUE_LOCAL_MAX_ACK_PENDING_HARD_LIMIT,
    clamped: normalizedRequested !== limit
  });
}

export function normalizeQueueMaxAckPending(value, fallback = DEFAULT_QUEUE_POLICY.maxAckPending) {
  return resolveQueueMaxAckPending(value, { fallback }).limit;
}

export function computeDeterministicBackoff({
  attempt,
  initialDelayMs = DEFAULT_QUEUE_POLICY.retryBackoff.initialDelayMs,
  multiplier = DEFAULT_QUEUE_POLICY.retryBackoff.multiplier,
  maxDelayMs = DEFAULT_QUEUE_POLICY.retryBackoff.maxDelayMs
} = {}) {
  const safeAttempt = Math.max(1, Math.trunc(Number(attempt || 1)));
  const delay = Number(initialDelayMs) * Math.pow(Number(multiplier), safeAttempt - 1);
  return Math.min(Math.trunc(delay), Math.trunc(Number(maxDelayMs)));
}
