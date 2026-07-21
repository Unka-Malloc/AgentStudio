import { normalizeCanonicalValue } from "../canonical/value.js";
import { protocolHashHex } from "../protocol/hashing.js";
import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { asRecord, safeText } from "../shared/records.js";
import { createEmptyCoreState, normalizeCoreState } from "./state-helpers.js";

export const CORE_STATE_LAYOUT_VERSION = 2;
export const CORE_STATE_TYPE = "pactium.runtime-manifest";

export const CORE_STATE_SCOPES = Object.freeze({
  workspace: "core-workspace",
  intent: "core-intent",
  outcome: "core-outcome",
  intentClaim: "core-intent-claim",
  intentReplay: "core-intent-replay",
  outcomeReplay: "core-outcome-replay",
  receiptReplay: "core-receipt-replay",
  changeClaim: "core-change-claim",
  receipt: "core-receipt",
  envelope: "core-envelope",
  causalityRef: "core-causality-ref"
});

function recordKey(scope, logicalKey, slot) {
  const digest = protocolHashHex("core.state-record-key", {
    scope: String(scope),
    logicalKey: String(logicalKey)
  });
  return `${digest}-${slot}`;
}

function normalizeGeneration(value) {
  const generation = Number(value || 0);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("Pactium runtime-state generation must be a non-negative safe integer.");
  }
  return generation;
}

function validateManifest(value) {
  const manifest = asRecord(value);
  if (
    manifest.protocol !== PACTIUM_PROTOCOL ||
    manifest.schema !== PACTIUM_SCHEMA_VERSION ||
    manifest.stateType !== CORE_STATE_TYPE ||
    manifest.layoutVersion !== CORE_STATE_LAYOUT_VERSION
  ) {
    throw new Error("Pactium latest-schema-only boundary rejected a non-current runtime-state layout.");
  }
  return normalizeCoreState({
    ...manifest,
    generation: normalizeGeneration(manifest.generation)
  });
}

function validateRecord(record, scope, logicalKey, publishedGeneration) {
  const candidate = asRecord(record);
  if (
    candidate.protocol !== PACTIUM_PROTOCOL ||
    candidate.schema !== PACTIUM_SCHEMA_VERSION ||
    candidate.recordType !== "pactium.runtime-record" ||
    candidate.scope !== scope ||
    candidate.logicalKey !== logicalKey
  ) {
    throw new Error(`Pactium runtime record validation failed for ${scope}.`);
  }
  const generation = normalizeGeneration(candidate.generation);
  if (generation > publishedGeneration) return null;
  return {
    generation,
    value: normalizeCanonicalValue(candidate.value)
  };
}

/**
 * Normalized runtime-state store.
 *
 * The single `core/runtime-state` row is a fixed-size publication manifest.
 * Mutable entities live in domain-separated records. Records use two physical
 * slots so a non-transactional JSON write cannot replace the last published
 * value before the manifest advances to the next generation.
 */
export function createCoreStateStore({ storage }) {
  if (!storage) throw new TypeError("createCoreStateStore requires storage.");
  const pending = new Map();
  let manifest = null;

  function compoundKey(scope, logicalKey) {
    return `${scope}\u0000${logicalKey}`;
  }

  async function load() {
    const stored = await storage.getProtocolObject("core", "runtime-state", null);
    manifest = stored ? validateManifest(stored) : createEmptyCoreState();
    pending.clear();
    return manifest;
  }

  function currentManifest() {
    if (!manifest) throw new Error("Pactium runtime-state store is not loaded.");
    return manifest;
  }

  function stage(scope, logicalKey, value) {
    const normalizedScope = safeText(scope);
    const normalizedLogicalKey = safeText(logicalKey);
    if (!normalizedScope || !normalizedLogicalKey) {
      throw new Error("Pactium runtime record scope and logical key are required.");
    }
    pending.set(compoundKey(normalizedScope, normalizedLogicalKey), {
      scope: normalizedScope,
      logicalKey: normalizedLogicalKey,
      value: normalizeCanonicalValue(value)
    });
  }

  async function readPublishedCandidates(scope, logicalKey, publishedGeneration) {
    const candidates = [];
    for (const slot of [0, 1]) {
      const raw = await storage.getProtocolObject(
        scope,
        recordKey(scope, logicalKey, slot),
        null
      );
      if (!raw) continue;
      const validated = validateRecord(raw, scope, logicalKey, publishedGeneration);
      if (validated) candidates.push({ ...validated, slot });
    }
    candidates.sort((left, right) => right.generation - left.generation || right.slot - left.slot);
    return candidates;
  }

  async function get(scope, logicalKey, fallback = null) {
    const normalizedScope = safeText(scope);
    const normalizedLogicalKey = safeText(logicalKey);
    if (!normalizedScope || !normalizedLogicalKey) return fallback;
    const staged = pending.get(compoundKey(normalizedScope, normalizedLogicalKey));
    if (staged) return normalizeCanonicalValue(staged.value);
    const publishedGeneration = currentManifest().generation;
    const candidates = await readPublishedCandidates(
      normalizedScope,
      normalizedLogicalKey,
      publishedGeneration
    );
    return candidates.length > 0 ? candidates[0].value : fallback;
  }

  async function list(scope) {
    const normalizedScope = safeText(scope);
    const publishedGeneration = currentManifest().generation;
    const byLogicalKey = new Map();
    for (const physicalKey of await storage.listProtocolObjectKeys(normalizedScope)) {
      const raw = await storage.getProtocolObject(normalizedScope, physicalKey, null);
      const candidate = asRecord(raw);
      const logicalKey = safeText(candidate.logicalKey);
      if (!logicalKey) continue;
      const validated = validateRecord(candidate, normalizedScope, logicalKey, publishedGeneration);
      if (!validated) continue;
      const previous = byLogicalKey.get(logicalKey);
      if (!previous || validated.generation > previous.generation) {
        byLogicalKey.set(logicalKey, validated);
      }
    }
    for (const staged of pending.values()) {
      if (staged.scope === normalizedScope) {
        byLogicalKey.set(staged.logicalKey, {
          generation: publishedGeneration + 1,
          value: normalizeCanonicalValue(staged.value)
        });
      }
    }
    return [...byLogicalKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([logicalKey, record]) => ({ logicalKey, value: record.value }));
  }

  async function publish(nextManifest) {
    const current = currentManifest();
    const generation = current.generation + 1;
    for (const staged of pending.values()) {
      const latestPublished = (await readPublishedCandidates(
        staged.scope,
        staged.logicalKey,
        current.generation
      ))[0];
      // Slot choice is per logical record, not global generation parity. A
      // sparsely updated record may have skipped generations; preserving its
      // latest published slot until the manifest advances keeps JSON storage
      // crash-safe in that case too.
      const slot = latestPublished ? 1 - latestPublished.slot : generation % 2;
      await storage.putProtocolObject(staged.scope, recordKey(staged.scope, staged.logicalKey, slot), {
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        recordType: "pactium.runtime-record",
        scope: staged.scope,
        logicalKey: staged.logicalKey,
        generation,
        value: staged.value
      });
    }
    const normalized = normalizeCoreState({
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      stateType: CORE_STATE_TYPE,
      layoutVersion: CORE_STATE_LAYOUT_VERSION,
      generation,
      gcEpoch: normalizeGeneration(nextManifest?.gcEpoch || current.gcEpoch || 0),
      indexRoots: { ...asRecord(nextManifest?.indexRoots) }
    });
    await storage.putProtocolObject("core", "runtime-state", normalized);
    manifest = normalized;
    pending.clear();
    if (nextManifest && typeof nextManifest === "object") {
      nextManifest.generation = generation;
      nextManifest.gcEpoch = normalized.gcEpoch;
    }
    return normalized;
  }

  function discard() {
    pending.clear();
  }

  function hasPending() {
    return pending.size > 0;
  }

  function isAtomicBackend() {
    return storage.atomicTransactions === true ||
      String(storage.storageBackend || storage.selectedStorageBackend || "") === "sqlite";
  }

  return Object.freeze({
    load,
    get,
    list,
    stage,
    publish,
    discard,
    hasPending,
    isAtomicBackend,
    currentManifest,
    scopes: CORE_STATE_SCOPES
  });
}
