export const WORK_QUEUE_STORE_ADAPTER_METHODS = Object.freeze([
  "enqueue",
  "claim",
  "ack",
  "nack",
  "progress",
  "term",
  "deadLetter",
  "recover",
  "inspect",
  "appendTransition",
  "rebuildProjection"
]);

export const WORK_QUEUE_BACKGROUND_WRITE_METHODS = Object.freeze([
  "writeFallbackCoordinatorState",
  "writeSnapshotState",
  "writeCompactionState",
  "writeInternalHealthState"
]);

export function validateWorkQueueStoreAdapterShape(adapter) {
  const missing = [];
  if (!adapter || typeof adapter !== "object") {
    return {
      ok: false,
      missing: [...WORK_QUEUE_STORE_ADAPTER_METHODS],
      errors: ["Adapter must be an object."]
    };
  }

  for (const method of WORK_QUEUE_STORE_ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      missing.push(method);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    errors: missing.map((method) => `Missing store adapter method: ${method}`)
  };
}

export function validateQueueBackgroundWriteAspectShape(aspect) {
  const missing = [];
  if (!aspect || typeof aspect !== "object") {
    return {
      ok: false,
      missing: [...WORK_QUEUE_BACKGROUND_WRITE_METHODS],
      errors: ["Background write aspect must be an object."]
    };
  }

  for (const method of WORK_QUEUE_BACKGROUND_WRITE_METHODS) {
    if (typeof aspect[method] !== "function") {
      missing.push(method);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    errors: missing.map((method) => `Missing background write aspect method: ${method}`)
  };
}

export function createNotImplementedWorkQueueStoreAdapter() {
  return Object.fromEntries(
    WORK_QUEUE_STORE_ADAPTER_METHODS.map((method) => [
      method,
      async () => {
        throw new Error(`Work Queue Store Adapter method is not implemented: ${method}`);
      }
    ])
  );
}
