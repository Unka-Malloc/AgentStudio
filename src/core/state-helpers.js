import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { protocolHash, protocolHashHex } from "../protocol/hashing.js";
import { asRecord, safeText } from "../shared/records.js";

const INDEX_ROOT_FIELDS = Object.freeze([
  "openIntent",
  "outcome",
  "intentIdempotency",
  "outcomeIdempotency",
  "receipt",
  "causality"
]);

const RUNTIME_CACHE_FIELDS = Object.freeze([
  "workspace",
  "stateEntries",
  "checkpointEntries",
  "intents",
  "outcomes",
  "outcomeLocators",
  "receipts",
  "receiptLocators",
  "intentEnvelopes",
  "intentIdempotencyClaims",
  "outcomeEnvelopes",
  "receiptEnvelopes",
  "changeClaims",
  "envelopes"
]);

function attachRuntimeCaches(state) {
  for (const field of RUNTIME_CACHE_FIELDS) {
    if (Object.hasOwn(state, field)) continue;
    Object.defineProperty(state, field, {
      configurable: false,
      enumerable: false,
      writable: true,
      value: Object.create(null)
    });
  }
  return state;
}

export function resetCoreRuntimeCaches(state) {
  for (const field of RUNTIME_CACHE_FIELDS) state[field] = Object.create(null);
  return state;
}

export function createEmptyCoreState() {
  return attachRuntimeCaches({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    stateType: "pactium.runtime-manifest",
    layoutVersion: 2,
    generation: 0,
    gcEpoch: 0,
    indexRoots: {
      openIntent: "",
      outcome: "",
      intentIdempotency: "",
      outcomeIdempotency: "",
      receipt: "",
      causality: ""
    }
  });
}

export function normalizeCoreState(state) {
  const input = asRecord(state);
  const roots = asRecord(input.indexRoots);
  const normalizedRoots = {};
  for (const field of INDEX_ROOT_FIELDS) normalizedRoots[field] = safeText(roots[field]);
  return attachRuntimeCaches({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    stateType: "pactium.runtime-manifest",
    layoutVersion: 2,
    generation: Number(input.generation || 0),
    gcEpoch: Number(input.gcEpoch || 0),
    indexRoots: normalizedRoots
  });
}

export function idempotencyKeyFor(input) {
  return [
    safeText(input.workspaceId, "default"),
    safeText(input.operationId),
    safeText(input.idempotencyKey),
    protocolHashHex("operation.intent", input.input ?? input.payload ?? {})
  ].join("\u0000");
}

export function intentIdempotencyClaimKeyFor(input) {
  return [
    safeText(input.workspaceId, "default"),
    safeText(input.operationId),
    safeText(input.idempotencyKey)
  ].join("\u0000");
}

export function outcomeIdempotencyKeyFor(input) {
  return [
    safeText(input.intentId),
    safeText(input.outcomeIdempotencyKey || input.idempotencyKey),
    protocolHashHex("operation.outcome", input.result ?? input.output ?? input.status ?? "succeeded")
  ].join("\u0000");
}

export function receiptReplayKeyFor(input) {
  return [
    safeText(input.workspaceId, "default"),
    safeText(input.operationId),
    safeText(input.idempotencyKey)
  ].join("\u0000");
}

export function receiptChangeClaimKeyFor(input) {
  return [
    safeText(input.workspaceId, "default"),
    safeText(input.operationId),
    safeText(input.changeKey || input.operationId)
  ].join("\u0000");
}

export function eventRefValue(ledgerAppend) {
  return {
    valueRef: ledgerAppend.entry.factCid,
    valueHash: ledgerAppend.entry.factHash,
    metadata: {
      ledgerEventId: ledgerAppend.entry.eventId,
      ledgerIndex: ledgerAppend.entry.index,
      factType: ledgerAppend.entry.fact.factType
    }
  };
}

export function lifecycleValueRef(id, extra = {}) {
  return {
    valueRef: `ref:${id}`,
    valueHash: protocolHash("block", { id, ...extra }),
    metadata: extra
  };
}

export function workspaceStateFor(state, workspaceId) {
  const key = safeText(workspaceId, "default");
  if (!Object.hasOwn(state.workspace, key)) state.workspace[key] = {
    nextOrdinal: 0,
    orderRoot: "",
    membershipRoot: "",
    checkpointRoot: "",
    stateRoot: ""
  };
  return state.workspace[key];
}

export function stateEntriesFor(state, workspaceId) {
  const key = safeText(workspaceId, "default");
  if (!Object.hasOwn(state.stateEntries, key)) state.stateEntries[key] = Object.create(null);
  return state.stateEntries[key];
}

export function checkpointEntriesFor(state, workspaceId) {
  const key = safeText(workspaceId, "default");
  if (!Object.hasOwn(state.checkpointEntries, key)) state.checkpointEntries[key] = Object.create(null);
  return state.checkpointEntries[key];
}

export function padOrdinal(value) {
  return String(value).padStart(16, "0");
}

export async function applyIndexPut(indexEngine, root, key, value, domain) {
  const result = await indexEngine.put(root, key, value, { domain });
  return result.root;
}

export async function applyIndexDelete(indexEngine, root, key, domain) {
  const result = await indexEngine.delete(root, key, { domain });
  return result.root;
}
