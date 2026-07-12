import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { normalizeCanonicalValue } from "../canonical/value.js";
import { protocolHash, protocolHashHex } from "../protocol/hashing.js";
import { asRecord, safeText } from "../shared/records.js";

export function createEmptyCoreState() {
  return {
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    indexRoots: {
      openIntent: "",
      outcome: "",
      intentIdempotency: "",
      outcomeIdempotency: "",
      causality: ""
    },
    workspace: Object.create(null),
    stateEntries: Object.create(null),
    checkpointEntries: Object.create(null),
    intents: Object.create(null),
    outcomes: Object.create(null),
    intentEnvelopes: Object.create(null),
    intentIdempotencyClaims: Object.create(null),
    outcomeEnvelopes: Object.create(null),
    // envelopeId -> proof-envelope block CID. Envelope bodies live in
    // content-addressed storage, never inside runtime state.
    envelopes: Object.create(null)
  };
}

function mapRecord(value = {}) {
  return Object.assign(Object.create(null), asRecord(value));
}

export function normalizeCoreState(state) {
  for (const field of [
    "workspace",
    "stateEntries",
    "checkpointEntries",
    "intents",
    "outcomes",
    "intentEnvelopes",
    "intentIdempotencyClaims",
    "outcomeEnvelopes",
    "envelopes"
  ]) {
    state[field] = mapRecord(state[field]);
  }
  for (const key of Object.keys(state.stateEntries)) state.stateEntries[key] = mapRecord(state.stateEntries[key]);
  for (const key of Object.keys(state.checkpointEntries)) state.checkpointEntries[key] = mapRecord(state.checkpointEntries[key]);
  return state;
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
