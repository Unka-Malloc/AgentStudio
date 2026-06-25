import crypto from "node:crypto";

import {
  PACTIUM_BUNDLE_ENCODING,
  PACTIUM_PROOF_BUNDLE_TYPE,
  PACTIUM_PROOF_TYPES,
  PACTIUM_PROTOCOL,
  PACTIUM_SCHEMA_VERSION
} from "../protocol/constants.js";
import { canonicalEncode, normalizeCanonicalValue } from "../canonical/value.js";
import { createAppendCondition, assertAppendCondition } from "./append-condition.js";
import { createLedgerTransparencyLog, ledgerNodeHash } from "../ledger/transparency-log.js";
import { advanceTrustedHead as advanceTrustedLedgerHead } from "../ledger/signed-head.js";
import { createVerifiableIndexEngine } from "../index-engine/snapshot-merkle-index.js";
import { createId, protocolHash, protocolHashHex } from "../protocol/hashing.js";
import { createProofRef, finalizeEnvelope, materializeExtension, verifyProofEnvelope } from "../proof/envelope.js";
import { createRepairPlanner } from "../repair/planner.js";
import { createStoragePort } from "../storage/local-json-storage-port.js";
import { createTrackingCursor, verifyTrackingCursor } from "./tracking-cursor.js";
import { asArray, asRecord, nowIso, safeText } from "../shared/records.js";
import { createVerificationFailure, PactiumLifecycleError } from "../verification/failure.js";
import { rebuildCoreStateFromLedger } from "./rebuild-state.js";

function createEmptyCoreState() {
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
    envelopes: Object.create(null),
    proofBundles: Object.create(null)
  };
}

function mapRecord(value = {}) {
  return Object.assign(Object.create(null), asRecord(value));
}

function normalizeCoreState(state) {
  for (const field of [
    "workspace",
    "stateEntries",
    "checkpointEntries",
    "intents",
    "outcomes",
    "intentEnvelopes",
    "intentIdempotencyClaims",
    "outcomeEnvelopes",
    "envelopes",
    "proofBundles"
  ]) {
    state[field] = mapRecord(state[field]);
  }
  for (const key of Object.keys(state.stateEntries)) state.stateEntries[key] = mapRecord(state.stateEntries[key]);
  for (const key of Object.keys(state.checkpointEntries)) state.checkpointEntries[key] = mapRecord(state.checkpointEntries[key]);
  return state;
}

function idempotencyKeyFor(input) {
  return [
    safeText(input.workspaceId, "default"),
    safeText(input.operationId),
    safeText(input.idempotencyKey),
    protocolHashHex("operation.intent", input.input ?? input.payload ?? {})
  ].join("\u0000");
}

function intentIdempotencyClaimKeyFor(input) {
  return [
    safeText(input.workspaceId, "default"),
    safeText(input.operationId),
    safeText(input.idempotencyKey)
  ].join("\u0000");
}

function outcomeIdempotencyKeyFor(input) {
  return [
    safeText(input.intentId),
    safeText(input.outcomeIdempotencyKey || input.idempotencyKey),
    protocolHashHex("operation.outcome", input.result ?? input.output ?? input.status ?? "succeeded")
  ].join("\u0000");
}

function eventRefValue(ledgerAppend) {
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

function lifecycleValueRef(id, extra = {}) {
  return {
    valueRef: `ref:${id}`,
    valueHash: protocolHash("block", { id, ...extra }),
    metadata: extra
  };
}

function workspaceStateFor(state, workspaceId) {
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

function stateEntriesFor(state, workspaceId) {
  const key = safeText(workspaceId, "default");
  if (!Object.hasOwn(state.stateEntries, key)) state.stateEntries[key] = Object.create(null);
  return state.stateEntries[key];
}

function checkpointEntriesFor(state, workspaceId) {
  const key = safeText(workspaceId, "default");
  if (!Object.hasOwn(state.checkpointEntries, key)) state.checkpointEntries[key] = Object.create(null);
  return state.checkpointEntries[key];
}

function padOrdinal(value) {
  return String(value).padStart(16, "0");
}

function compareStateMutationKeys(left, right) {
  const leftKey = String(left);
  const rightKey = String(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  /* node:coverage ignore next -- netStateMutationsByKey sorts unique Map keys. */
  return 0;
}

function netStateMutationsByKey(mutations) {
  const latestByKey = new Map();
  for (const mutation of asArray(mutations)) {
    const key = String(mutation?.key || "");
    if (!key) continue;
    latestByKey.set(key, { ...asRecord(mutation), key });
  }
  return [...latestByKey.values()].sort((left, right) => compareStateMutationKeys(left.key, right.key));
}

function isMembershipProof(proof) {
  return proof?.proofType === PACTIUM_PROOF_TYPES.indexMembership;
}

function knownCausalityRefsFor(state) {
  return new Set([
    ...Object.keys(asRecord(state.intents)),
    ...Object.values(asRecord(state.intents)).map((record) => record?.ledgerEventId).filter(Boolean),
    ...Object.keys(asRecord(state.outcomes)),
    ...Object.values(asRecord(state.outcomes)).map((outcome) => outcome?.outcomeId).filter(Boolean)
  ]);
}

async function applyIndexPut(indexEngine, root, key, value, domain) {
  const result = await indexEngine.put(root, key, value, { domain });
  return result.root;
}

async function applyIndexDelete(indexEngine, root, key, domain) {
  const result = await indexEngine.delete(root, key, { domain });
  return result.root;
}

function currentIndexRoots(state) {
  const retained = new Set(Object.values(asRecord(state.indexRoots)).map(String).filter(Boolean));
  for (const workspace of Object.values(asRecord(state.workspace))) {
    for (const field of ["orderRoot", "membershipRoot", "checkpointRoot", "stateRoot"]) {
      if (workspace?.[field]) retained.add(String(workspace[field]));
    }
  }
  return [...retained];
}

function hashFromCid(cid) {
  return String(cid || "").split(":").pop() || "";
}

async function updateWorkspaceProjection({ indexEngine, state, workspaceId, ledgerAppend, proofOptions = {} }) {
  const workspace = workspaceStateFor(state, workspaceId);
  const ordinal = workspace.nextOrdinal;
  workspace.nextOrdinal += 1;
  const orderKey = padOrdinal(ordinal);
  workspace.orderRoot = await applyIndexPut(
    indexEngine,
    workspace.orderRoot,
    orderKey,
    eventRefValue(ledgerAppend),
    "workspace-order"
  );
  workspace.membershipRoot = await applyIndexPut(
    indexEngine,
    workspace.membershipRoot,
    ledgerAppend.entry.eventId,
    lifecycleValueRef(orderKey, { workspaceId, ordinal }),
    "workspace-membership"
  );
  return {
    workspaceId,
    ordinal,
    orderKey,
    orderRoot: workspace.orderRoot,
    membershipRoot: workspace.membershipRoot,
    orderProof: await indexEngine.prove(workspace.orderRoot, orderKey, proofOptions),
    membershipProof: await indexEngine.prove(workspace.membershipRoot, ledgerAppend.entry.eventId, proofOptions)
  };
}

async function ensureWorkspaceStateRoot({ indexEngine, workspace, workspaceStateEntries }) {
  if (workspace.stateRoot) return workspace.stateRoot;
  const stateIndex = await indexEngine.createIndex(Object.values(asRecord(workspaceStateEntries)), { domain: "state" });
  workspace.stateRoot = stateIndex.root;
  return workspace.stateRoot;
}

export function createPactium({
  dataDir = "",
  userDataPath = "",
  storage = null,
  inMemory = false
} = {}) {
  const resolvedStorage = storage || createStoragePort({ dataDir, userDataPath, inMemory });
  const ledger = createLedgerTransparencyLog({ storage: resolvedStorage });
  const indexEngine = createVerifiableIndexEngine({ storage: resolvedStorage, domain: "pactium" });
  const repairPlanner = createRepairPlanner();
  let state = null;
  let mutationLane = Promise.resolve();
  const useDurableWriteLock = !resolvedStorage.inMemory && typeof resolvedStorage.withWriteLock === "function";

  async function reloadFromStorage() {
    if (typeof resolvedStorage.clearCache === "function") resolvedStorage.clearCache();
    if (typeof ledger.reload === "function") await ledger.reload();
    state = null;
    return ensureState();
  }

  async function prepareRead() {
    await mutationLane.catch(() => null);
    if (useDurableWriteLock) return reloadFromStorage();
    return ensureState();
  }

  function enqueueMutation(task) {
    const run = mutationLane.catch(() => null).then(() => {
      if (!useDurableWriteLock) return task();
      return resolvedStorage.withWriteLock(async () => {
        await reloadFromStorage();
        return task();
      });
    });
    mutationLane = run;
    return run;
  }

  async function ensureState() {
    await resolvedStorage.initialize();
    if (state) return state;
    state = await resolvedStorage.getProtocolObject("core", "runtime-state", null);
    if (!state) state = createEmptyCoreState();
    state.intentIdempotencyClaims ||= {};
    return normalizeCoreState(state);
  }

  async function saveState() {
    await resolvedStorage.putProtocolObject("core", "runtime-state", state);
  }

  // -- Commit markers for crash consistency --
  // Each mutation writes a pending marker before work begins and a complete
  // marker after runtime-state is saved. doctor() scans for orphans.
  const COMMIT_SCOPE = "commit";
  function commitMarker(commitId, operation, phase, details = {}) {
    return {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      commitType: "pactium.mutation-commit",
      commitId,
      operation,
      phase,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ledgerEventIds: asArray(details.ledgerEventIds).map(String),
      envelopeIds: asArray(details.envelopeIds).map(String),
      affectedWorkspaceIds: asArray(details.affectedWorkspaceIds).map(String),
      notes: details.notes || ""
    };
  }

  async function writePendingMarker(commitId, operation, details = {}) {
    await resolvedStorage.putProtocolObject(COMMIT_SCOPE, `pending-${commitId}`,
      commitMarker(commitId, operation, "pending", details));
  }

  async function writeCompleteMarker(commitId, operation, details = {}) {
    await resolvedStorage.putProtocolObject(COMMIT_SCOPE, `complete-${commitId}`,
      commitMarker(commitId, operation, "complete", details));
  }

  async function cleanupPendingMarker(commitId) {
    try {
      await resolvedStorage.deleteProtocolObject(COMMIT_SCOPE, `pending-${commitId}`);
    } catch (_) {
      // best-effort cleanup
    }
  }

  async function createEnvelope({
    envelopeKind,
    fact,
    ledgerAppend,
    proofs = {},
    appendCondition = null,
    extensions = [],
    replayed = false,
    relatedEnvelopeIds = []
  }) {
    const material = {
      protocol: PACTIUM_PROTOCOL,
      materialType: "pactium.proof-material",
      envelopeKind,
      ledger: {
        head: ledgerAppend.head,
        previousHead: ledgerAppend.previousHead,
        inclusionProof: ledgerAppend.inclusionProof,
        consistencyProof: ledgerAppend.consistencyProof
      },
      appendCondition,
      proofs
    };
    const materialRef = await createProofRef(resolvedStorage, "ledger-and-index-proofs", material, [
      ledgerAppend.entry.factCid
    ]);
    const materializedExtensions = [];
    for (const extension of extensions) {
      const materialized = await materializeExtension(resolvedStorage, extension);
      if (materialized) materializedExtensions.push(materialized);
    }
    const envelopeBase = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      envelopeType: "pactium.proof-envelope",
      envelopeKind,
      factType: fact.factType,
      factId: fact.intentId || fact.outcomeId || fact.repairId || ledgerAppend.entry.eventId,
      factRef: {
        ledgerEventId: ledgerAppend.entry.eventId,
        ledgerIndex: ledgerAppend.entry.index,
        factCid: ledgerAppend.entry.factCid,
        factHash: ledgerAppend.entry.factHash
      },
      ledgerHead: ledgerAppend.head,
      proofRefs: [materialRef],
      extensions: materializedExtensions,
      criticalExtensions: materializedExtensions.filter((extension) => extension.critical).map((extension) => extension.name),
      relatedEnvelopeIds,
      replayed,
      createdAt: nowIso()
    };
    const envelope = finalizeEnvelope(envelopeBase);
    await resolvedStorage.putBlock(envelope, {
      kind: "proof-envelope",
      refs: [
        ...envelope.proofRefs.map((ref) => ref.cid),
        ...envelope.extensions.map((extension) => extension.valueRef)
      ]
    });
    const current = await ensureState();
    current.envelopes[envelope.envelopeId] = envelope;
    await saveState();
    return envelope;
  }

  async function beginOperationIntent(input = {}) {
    return enqueueMutation(() => beginOperationIntentCommitted(input));
  }

  async function beginOperationIntentCommitted(input = {}) {
    const current = await ensureState();
    const operationId = safeText(input.operationId);
    if (!operationId) throw new Error("operationId is required for Operation Intent.");
    const workspaceId = safeText(input.workspaceId || input.scope, "default");
    const idempotencyKey = safeText(input.idempotencyKey);
    const idKey = idempotencyKey ? idempotencyKeyFor({ ...input, operationId, workspaceId }) : "";
    const idClaimKey = idempotencyKey ? intentIdempotencyClaimKeyFor({ operationId, workspaceId, idempotencyKey }) : "";
    const inputHash = protocolHash("operation.intent", input.input ?? input.payload ?? {});
    if (idKey && current.intentEnvelopes[idKey]) {
      const envelope = { ...current.envelopes[current.intentEnvelopes[idKey]], replayed: true };
      return envelope;
    }
    // --- Preflight validation (no side effects) ---
    // All checks that can fail BEFORE we write any pending marker or commit
    // any mutation must happen here. Otherwise a failed check leaves an orphan
    // pending marker that doctor() will report as incomplete_commit.
    if (idClaimKey && current.intentIdempotencyClaims[idClaimKey] && current.intentIdempotencyClaims[idClaimKey].inputHash !== inputHash) {
      throw new PactiumLifecycleError("Operation Intent idempotency key was reused with different input.", createVerificationFailure({
        layer: "operation-lifecycle",
        code: "idempotency_conflict",
        message: "Intent idempotency key was reused with different input.",
        evidenceRef: idClaimKey,
        repairable: false
      }));
    }
    const appendCondition = input.appendCondition
      ? createAppendCondition({ workspaceId, ...asRecord(input.appendCondition) })
      : null;
    if (appendCondition) {
      const requiredIntentId = appendCondition.requiredOpenIntentState?.intentId || "";
      const openIntentState = requiredIntentId
        ? {
          intentId: requiredIntentId,
          exists: current.intents[requiredIntentId]?.open === true
        }
        : { exists: false };
      await assertAppendCondition(appendCondition, {
        phase: "intent",
        currentHead: await ledger.head(),
        workspace: workspaceStateFor(current, workspaceId),
        openIntentState,
        knownCausalityRefs: knownCausalityRefsFor(current)
      });
    }
    // --- All preflight checks passed; now commit the mutation ---
    // Commit marker: write pending before mutation work begins.
    const commitId = createId("mutation_commit", { operation: "begin-intent", operationId, workspaceId, nonce: crypto.randomUUID() });
    await writePendingMarker(commitId, "begin-intent", { affectedWorkspaceIds: [workspaceId] });
    const proofOptions = asRecord(input.proofOptions);
    let ledgerCommitted = false;
    try {
      const intent = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      factType: "operation.intent",
      intentId: createId("operation_intent", {
        operationId,
        workspaceId,
        idempotencyKey,
        input: input.input ?? input.payload ?? {},
        nonce: input.nonce || crypto.randomUUID()
      }),
      operationId,
      workspaceId,
      idempotencyKey,
      inputHash,
      subject: normalizeCanonicalValue(asRecord(input.subject)),
      causalityRefs: asArray(input.causalityRefs).map(String),
      appendConditionHash: appendCondition?.conditionHash || "",
      createdAt: nowIso()
    };
    const ledgerAppend = await ledger.append(intent);
    ledgerCommitted = true; // ledger fact is durable — keep pending marker on later failure
    current.intents[intent.intentId] = {
      intent,
      ledgerEventId: ledgerAppend.entry.eventId,
      open: true
    };
    current.indexRoots.openIntent = await applyIndexPut(
      indexEngine,
      current.indexRoots.openIntent,
      intent.intentId,
      eventRefValue(ledgerAppend),
      "open-intent"
    );
    if (idKey) {
      current.indexRoots.intentIdempotency = await applyIndexPut(
        indexEngine,
        current.indexRoots.intentIdempotency,
        idKey,
        lifecycleValueRef(intent.intentId, { intentId: intent.intentId }),
        "intent-idempotency"
      );
    }
    for (const ref of intent.causalityRefs) {
      current.indexRoots.causality = await applyIndexPut(
        indexEngine,
        current.indexRoots.causality,
        `${ref}\u0000${intent.intentId}`,
        lifecycleValueRef(intent.intentId, { from: ref, to: intent.intentId, relation: "causes" }),
        "operation-causality"
      );
    }
    const projection = await updateWorkspaceProjection({ indexEngine, state: current, workspaceId, ledgerAppend, proofOptions });
    const workspace = workspaceStateFor(current, workspaceId);
    const checkpoints = checkpointEntriesFor(current, workspaceId);
    const checkpointNodeId = createId("checkpoint_node", { intentId: intent.intentId, kind: "intent" });
    const checkpointNode = {
      checkpointNodeId,
      checkpointKind: "intent",
      parentId: "",
      intentId: intent.intentId,
      ledgerEventId: ledgerAppend.entry.eventId,
      workspaceId
    };
    checkpoints[checkpointNodeId] = checkpointNode;
    workspace.checkpointRoot = await applyIndexPut(
      indexEngine,
      workspace.checkpointRoot,
      checkpointNodeId,
      {
        valueRef: `ref:${checkpointNodeId}`,
        valueHash: protocolHash("checkpoint.node", checkpointNode),
        metadata: checkpointNode
      },
      "checkpoint"
    );
    const envelope = await createEnvelope({
      envelopeKind: "operation-intent",
      fact: intent,
      ledgerAppend,
      proofs: {
        openIntent: await indexEngine.prove(current.indexRoots.openIntent, intent.intentId, proofOptions),
        intentIdempotency: idKey ? await indexEngine.prove(current.indexRoots.intentIdempotency, idKey, proofOptions) : null,
        workspaceProjection: projection,
        checkpoint: {
          root: workspace.checkpointRoot,
          proof: await indexEngine.prove(workspace.checkpointRoot, checkpointNodeId, proofOptions)
        },
        causality: {
          root: current.indexRoots.causality,
          proofs: await Promise.all(intent.causalityRefs.map((ref) =>
            indexEngine.prove(current.indexRoots.causality, `${ref}\u0000${intent.intentId}`, proofOptions)
          ))
        }
      },
      appendCondition,
      extensions: asArray(input.extensions),
      replayed: false
    });
    if (idKey) current.intentEnvelopes[idKey] = envelope.envelopeId;
    if (idClaimKey) current.intentIdempotencyClaims[idClaimKey] = { inputHash, envelopeId: envelope.envelopeId };
    current.intents[intent.intentId].intentEnvelopeId = envelope.envelopeId;
    await saveState();
    await writeCompleteMarker(commitId, "begin-intent", {
      ledgerEventIds: [envelope.factRef.ledgerEventId],
      envelopeIds: [envelope.envelopeId],
      affectedWorkspaceIds: [workspaceId]
    });
      await cleanupPendingMarker(commitId);
      return envelope;
    } catch (error) {
    if (!ledgerCommitted) {
        // Nothing durable was written — clean up pending marker so
        // doctor() won't report a false incomplete_commit.
        await cleanupPendingMarker(commitId);
      }
      // If ledgerCommitted is true, the ledger fact exists but the
      // complete marker was never written. Keep the pending marker so
      // doctor() correctly reports incomplete_commit.
      throw error;
    }
  }

  async function appendOperationOutcome(input = {}) {
    return enqueueMutation(() => appendOperationOutcomeCommitted(input));
  }

  async function appendOperationOutcomeCommitted(input = {}) {
    const commitId = createId("mutation_commit", { operation: "append-outcome", nonce: crypto.randomUUID() });
    const current = await ensureState();
    const intentId = safeText(input.intentId);
    if (!intentId) throw new Error("intentId is required for Operation Outcome.");
    const intentRecord = current.intents[intentId];
    if (!intentRecord) {
      throw new PactiumLifecycleError("Operation Intent does not exist.", createVerificationFailure({
        layer: "operation-lifecycle",
        code: "intent_missing",
        message: "Operation Outcome cannot be appended without a recorded Operation Intent.",
        repairable: false
      }));
    }
    const outcomeIdKey = safeText(input.outcomeIdempotencyKey || input.idempotencyKey)
      ? outcomeIdempotencyKeyFor(input)
      : "";
    if (outcomeIdKey && current.outcomeEnvelopes[outcomeIdKey]) {
      return { ...current.envelopes[current.outcomeEnvelopes[outcomeIdKey]], replayed: true };
    }
    if (current.outcomes[intentId]) {
      throw new PactiumLifecycleError("Operation Intent already has a Terminal Outcome.", createVerificationFailure({
        layer: "operation-lifecycle",
        code: "terminal_outcome_exists",
        message: "Pactium records exactly one Terminal Outcome per Operation Intent.",
        evidenceRef: current.outcomes[intentId].outcomeId,
        repairable: false
      }));
    }
    const workspaceId = intentRecord.intent.workspaceId;
    const appendCondition = input.appendCondition
      ? createAppendCondition({ workspaceId, ...asRecord(input.appendCondition) })
      : null;
    if (appendCondition) {
      await assertAppendCondition(appendCondition, {
        phase: "outcome",
        currentHead: await ledger.head(),
        workspace: workspaceStateFor(current, workspaceId),
        outcomeState: {
          intentId,
          exists: Boolean(current.outcomes[intentId]),
          outcomeId: current.outcomes[intentId]?.outcomeId || ""
        },
        knownCausalityRefs: knownCausalityRefsFor(current)
      });
    }
    // --- All preflight checks passed; now commit the mutation ---
    await writePendingMarker(commitId, "append-outcome", { affectedWorkspaceIds: [workspaceId] });
    const proofOptions = asRecord(input.proofOptions);
    let ledgerCommitted = false;
    try {
    const outcome = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      factType: "operation.outcome",
      outcomeId: createId("operation_outcome", {
        intentId,
        outcomeIdempotencyKey: outcomeIdKey,
        status: input.status || "succeeded",
        result: input.result ?? input.output ?? {},
        nonce: input.nonce || crypto.randomUUID()
      }),
      intentId,
      operationId: intentRecord.intent.operationId,
      workspaceId,
      status: safeText(input.status, "succeeded"),
      resultHash: protocolHash("operation.outcome", input.result ?? input.output ?? {}),
      hostEvidenceRefs: asArray(input.hostEvidenceRefs).map(String),
      causalityRefs: asArray(input.causalityRefs).map(String),
      appendConditionHash: appendCondition?.conditionHash || "",
      createdAt: nowIso()
    };
    const ledgerAppend = await ledger.append(outcome);
    ledgerCommitted = true; // ledger fact is durable — keep pending marker on later failure
    current.outcomes[intentId] = outcome;
    current.intents[intentId].open = false;
    current.indexRoots.openIntent = await applyIndexDelete(indexEngine, current.indexRoots.openIntent, intentId, "open-intent");
    current.indexRoots.outcome = await applyIndexPut(
      indexEngine,
      current.indexRoots.outcome,
      intentId,
      eventRefValue(ledgerAppend),
      "outcome"
    );
    if (outcomeIdKey) {
      current.indexRoots.outcomeIdempotency = await applyIndexPut(
        indexEngine,
        current.indexRoots.outcomeIdempotency,
        outcomeIdKey,
        lifecycleValueRef(outcome.outcomeId, { outcomeId: outcome.outcomeId }),
        "outcome-idempotency"
      );
    }
    for (const ref of outcome.causalityRefs) {
      current.indexRoots.causality = await applyIndexPut(
        indexEngine,
        current.indexRoots.causality,
        `${ref}\u0000${outcome.outcomeId}`,
        lifecycleValueRef(outcome.outcomeId, { from: ref, to: outcome.outcomeId, relation: "causes" }),
        "operation-causality"
      );
    }
    const projection = await updateWorkspaceProjection({ indexEngine, state: current, workspaceId, ledgerAppend, proofOptions });
    const workspace = workspaceStateFor(current, workspaceId);
    const workspaceStateEntries = stateEntriesFor(current, workspaceId);
    const mutations = asArray(input.stateMutations || input.state?.mutations);
    const keyedMutations = mutations.filter((mutation) => mutation?.key);
    const netKeyedMutations = netStateMutationsByKey(keyedMutations);
    await ensureWorkspaceStateRoot({ indexEngine, workspace, workspaceStateEntries });
    for (const mutation of mutations) {
      const key = String(mutation.key || "");
      if (!key) continue;
      if (mutation.action === "delete") {
        delete workspaceStateEntries[key];
        workspace.stateRoot = await applyIndexDelete(indexEngine, workspace.stateRoot, key, "state");
      } else {
        const valueBlock = mutation.valueRef
          ? { cid: mutation.valueRef, payloadHash: mutation.valueHash || "" }
          : await resolvedStorage.putBlock(mutation.value ?? mutation, { kind: "state-value" });
        const stateEntry = {
          key,
          valueRef: valueBlock.cid,
          valueHash: valueBlock.payloadHash || "",
          metadata: normalizeCanonicalValue(asRecord(mutation.metadata))
        };
        workspaceStateEntries[key] = stateEntry;
        workspace.stateRoot = await applyIndexPut(indexEngine, workspace.stateRoot, key, stateEntry, "state");
      }
    }
    const stateRoot = workspace.stateRoot;
    const fullStateMutationProofs =
      input.fullStateMutationProofs === true ||
      proofOptions.fullStateMutationProofs === true ||
      proofOptions.stateMutationProofMode === "full";
    const provedStateMutationCount = fullStateMutationProofs
      ? netKeyedMutations.length
      : Math.min(netKeyedMutations.length, 32);
    const mutationDescriptors = netKeyedMutations.map((mutation) => {
      const key = String(mutation.key || "");
      const action = String(mutation.action || "put");
      const entry = workspaceStateEntries[key] || {};
      return {
        key,
        action,
        valueRef: action === "delete" ? "" : String(entry.valueRef || ""),
        valueHash: action === "delete" ? "" : String(entry.valueHash || ""),
        metadata: normalizeCanonicalValue(asRecord(mutation.metadata))
      };
    });
    const stateCommit = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      factType: "state.commit",
      stateCommitId: createId("state_commit", {
        outcomeId: outcome.outcomeId,
        stateRoot,
        mutations: mutationDescriptors
      }),
      outcomeId: outcome.outcomeId,
      intentId,
      workspaceId,
      stateRoot,
      mutationCount: netKeyedMutations.length,
      mutations: mutationDescriptors,
      mutationKeys: netKeyedMutations.map((mutation) => String(mutation.key || "")),
      mutationActions: netKeyedMutations.map((mutation) => String(mutation.action || "put")),
      // By default, touchedKeyProofs samples the first 32 unique touched keys to
      // keep write receipts bounded. Repeated keys in one commit collapse to the
      // last mutation's final effect because proofs bind to the final stateRoot.
      // Hosts that need strict per-key verification can request full mode.
      sampledKeyCount: provedStateMutationCount,
      touchedKeyCount: provedStateMutationCount, // kept for backward compat
      provedKeyCount: provedStateMutationCount,
      mutationProofMode: fullStateMutationProofs ? "full" : "sampled",
      proofCompleteness: provedStateMutationCount >= netKeyedMutations.length ? "full" : "sampled",
      unprovedMutationCount: Math.max(0, netKeyedMutations.length - provedStateMutationCount),
      createdAt: nowIso()
    };
    const checkpointEntries = checkpointEntriesFor(current, workspaceId);
    const outcomeCheckpointNodeId = createId("checkpoint_node", { outcomeId: outcome.outcomeId, kind: "outcome" });
    const outcomeCheckpointNode = {
      checkpointNodeId: outcomeCheckpointNodeId,
      checkpointKind: "outcome",
      parentId: createId("checkpoint_node", { intentId, kind: "intent" }),
      intentId,
      outcomeId: outcome.outcomeId,
      stateCommitId: stateCommit.stateCommitId,
      workspaceId,
      ledgerEventId: ledgerAppend.entry.eventId
    };
    checkpointEntries[outcomeCheckpointNodeId] = outcomeCheckpointNode;
    workspace.checkpointRoot = await applyIndexPut(
      indexEngine,
      workspace.checkpointRoot,
      outcomeCheckpointNodeId,
      {
        valueRef: `ref:${outcomeCheckpointNodeId}`,
        valueHash: protocolHash("checkpoint.node", outcomeCheckpointNode),
        metadata: outcomeCheckpointNode
      },
      "checkpoint"
    );
    const touchedKeyProofs = [];
    for (const mutation of netKeyedMutations.slice(0, provedStateMutationCount)) {
      touchedKeyProofs.push(await indexEngine.prove(stateRoot, String(mutation.key), proofOptions));
    }
    const envelope = await createEnvelope({
      envelopeKind: "operation-outcome",
      fact: outcome,
      ledgerAppend,
      proofs: {
        outcome: await indexEngine.prove(current.indexRoots.outcome, intentId, proofOptions),
        openIntentRemoved: await indexEngine.prove(current.indexRoots.openIntent, intentId, proofOptions),
        outcomeIdempotency: outcomeIdKey ? await indexEngine.prove(current.indexRoots.outcomeIdempotency, outcomeIdKey, proofOptions) : null,
        workspaceProjection: projection,
        stateCommit,
        state: {
          root: stateRoot,
          touchedKeyProofs
        },
        checkpoint: {
          root: workspace.checkpointRoot,
          proof: await indexEngine.prove(workspace.checkpointRoot, outcomeCheckpointNodeId, proofOptions)
        },
        causality: {
          root: current.indexRoots.causality,
          proofs: await Promise.all(outcome.causalityRefs.map((ref) =>
            indexEngine.prove(current.indexRoots.causality, `${ref}\u0000${outcome.outcomeId}`, proofOptions)
          ))
        }
      },
      appendCondition,
      extensions: asArray(input.extensions),
      replayed: false,
      relatedEnvelopeIds: [intentRecord.intentEnvelopeId].filter(Boolean)
    });
    if (outcomeIdKey) current.outcomeEnvelopes[outcomeIdKey] = envelope.envelopeId;
    await saveState();
    await writeCompleteMarker(commitId, "append-outcome", {
      ledgerEventIds: [envelope.factRef.ledgerEventId],
      envelopeIds: [envelope.envelopeId],
      affectedWorkspaceIds: [workspaceId]
    });
    await cleanupPendingMarker(commitId);
    return envelope;
    } catch (error) {
      if (!ledgerCommitted) {
        // Nothing durable was written — clean up the pending marker.
        await cleanupPendingMarker(commitId);
      }
      // If ledgerCommitted is true, the pending marker stays so doctor()
      // can correctly report incomplete_commit.
      throw error;
    }
  }

  async function recordOperation(input = {}) {
    const intentEnvelope = await beginOperationIntent(input.intentAppendCondition
      ? { ...input, appendCondition: input.intentAppendCondition }
      : input);
    if (intentEnvelope.replayed && input.returnIntentReplay) return intentEnvelope;
    const intentId = intentEnvelope.factId;
    return appendOperationOutcome({
      ...input,
      intentId,
      appendCondition: input.outcomeAppendCondition || input.outcome?.appendCondition || null,
      extensions: asArray(input.outcomeExtensions || input.extensions)
    });
  }

  async function lookupOpenIntent(intentId) {
    const current = await prepareRead();
    const proof = await indexEngine.prove(current.indexRoots.openIntent, String(intentId || ""));
    return {
      protocol: PACTIUM_PROTOCOL,
      intentId,
      exists: isMembershipProof(proof),
      proof,
      intent: current.intents[intentId]?.intent || null
    };
  }

  async function lookupOutcome(intentId) {
    const current = await prepareRead();
    const proof = await indexEngine.prove(current.indexRoots.outcome, String(intentId || ""));
    return {
      protocol: PACTIUM_PROTOCOL,
      intentId,
      exists: isMembershipProof(proof),
      proof,
      outcome: current.outcomes[intentId] || null
    };
  }

  async function getWorkspaceProjection(workspaceId = "default", options = {}) {
    const current = await prepareRead();
    const workspace = workspaceStateFor(current, workspaceId);
    const defaultLimit = Math.max(1, Math.min(Number(options.limit || 100), 10000));
    const orderLimit = options.orderLimit !== undefined ? Number(options.orderLimit) : defaultLimit;
    const membershipLimit = options.membershipLimit !== undefined ? Number(options.membershipLimit) : defaultLimit;
    return {
      protocol: PACTIUM_PROTOCOL,
      workspaceId: safeText(workspaceId, "default"),
      nextOrdinal: workspace.nextOrdinal,
      orderRoot: workspace.orderRoot,
      membershipRoot: workspace.membershipRoot,
      order: workspace.orderRoot ? await indexEngine.scan(workspace.orderRoot, { limit: orderLimit, after: String(options.after || "") }) : [],
      membership: workspace.membershipRoot ? await indexEngine.scan(workspace.membershipRoot, { limit: membershipLimit, after: String(options.after || "") }) : []
    };
  }

  async function proveWorkspaceMembership({ workspaceId = "default", ledgerEventId = "", proofOptions = {} } = {}) {
    const current = await prepareRead();
    const workspace = workspaceStateFor(current, workspaceId);
    const proof = await indexEngine.prove(workspace.membershipRoot, ledgerEventId, asRecord(proofOptions));
    return {
      protocol: PACTIUM_PROTOCOL,
      workspaceId: safeText(workspaceId, "default"),
      ledgerEventId,
      member: isMembershipProof(proof),
      proof
    };
  }

  async function getLedgerCursor({ fromCursor = null, position = 0, limit = 100 } = {}) {
    await prepareRead();
    const requestedStart = Number(fromCursor?.position ?? position ?? 0);
    const start = Number.isInteger(requestedStart) && requestedStart >= 0 ? requestedStart : 0;
    const pageLimit = Math.max(1, Math.min(Number(limit || 100), 10000));
    const page = await ledger.pageEntries({ start, limit: pageLimit });
    const currentHead = page.head;
    const entries = page.entries;
    const nextPosition = page.nextPosition;
    const cursor = createTrackingCursor({
      scope: "ledger",
      position: nextPosition,
      gaps: [],
      headRef: currentHead.headId || currentHead.root || currentHead.rootHash
    });
    return {
      protocol: PACTIUM_PROTOCOL,
      pageType: "pactium.ledger-cursor-page",
      entries,
      cursor,
      nextCursor: cursor,
      head: currentHead
    };
  }

  async function getWorkspaceCursor({ workspaceId = "default", fromCursor = null, position = 0, limit = 100, proofOptions = {} } = {}) {
    const current = await prepareRead();
    const workspace = workspaceStateFor(current, workspaceId);
    const currentHead = await ledger.head();
    const requestedStart = Number(fromCursor?.position ?? position ?? 0);
    const start = Number.isInteger(requestedStart) && requestedStart >= 0 ? requestedStart : 0;
    const pageLimit = Math.max(1, Math.min(Number(limit || 100), 10000));
    const entries = workspace.orderRoot
      ? await indexEngine.scan(workspace.orderRoot, { min: padOrdinal(start), limit: pageLimit })
      : [];
    const nextPosition = entries.length > 0
      ? Number.parseInt(entries[entries.length - 1].key, 10) + 1
      : start;
    const cursor = createTrackingCursor({
      scope: "workspace",
      workspaceId,
      position: nextPosition,
      gaps: [],
      headRef: currentHead.headId || currentHead.root || currentHead.rootHash,
      orderRoot: workspace.orderRoot
    });
    const opts = asRecord(proofOptions);
    return {
      protocol: PACTIUM_PROTOCOL,
      pageType: "pactium.workspace-cursor-page",
      workspaceId: safeText(workspaceId, "default"),
      entries,
      cursor,
      nextCursor: cursor,
      head: currentHead,
      orderRoot: workspace.orderRoot,
      orderProofs: await Promise.all(entries.map((entry) => indexEngine.prove(workspace.orderRoot, entry.key, opts)))
    };
  }

  function verifyCursor(cursor, context = {}) {
    return verifyTrackingCursor(cursor, context);
  }

  function advanceTrustedHead(input = {}) {
    return advanceTrustedLedgerHead(input);
  }

  function planRecovery(input = {}) {
    return repairPlanner.planRecovery(input);
  }

  async function verifyEnvelope(envelope, options = {}) {
    return verifyProofEnvelope(envelope, {
      storage: resolvedStorage,
      supportedCriticalExtensions: options.supportedCriticalExtensions || [],
      proofVerifiers: options.proofVerifiers || {},
      requireAllProofs: options.requireAllProofs !== false,
      verifierManifest: options.verifierManifest || null,
      trustedManifest: options.trustedManifest || null,
      ledgerHeadSignatures: options.ledgerHeadSignatures || [],
      trustPolicy: options.trustPolicy || "self-carried-manifest",
      requireFullStateMutationProofs: options.requireFullStateMutationProofs || false,
      maxProofLeafEntries: Number(options.maxProofLeafEntries || 0),
      maxProofBytes: Number(options.maxProofBytes || 0),
      failOnProofSizeWarning: options.failOnProofSizeWarning === true
    });
  }

  function encodeVarint(value) {
    const bytes = [];
    let current = Number(value || 0);
    do {
      let byte = current & 0x7f;
      current = Math.floor(current / 128);
      if (current > 0) byte |= 0x80;
      bytes.push(byte);
    } while (current > 0);
    return Buffer.from(bytes);
  }

  function indexedBundleRecords(blocks) {
    let offset = 0;
    const index = [];
    const records = [];
    for (const block of blocks) {
      const header = {
        protocol: block.protocol,
        cid: block.cid,
        codec: block.codec,
        kind: block.kind,
        refs: block.refs,
        byteLength: block.byteLength,
        payloadHash: block.payloadHash
      };
      const headerBytes = Buffer.from(canonicalEncode(header));
      const payloadBytes = Buffer.from(String(block.payloadBase64 || ""), "base64");
      const recordLength = headerBytes.length + payloadBytes.length;
      const lengthBytes = encodeVarint(recordLength);
      records.push(lengthBytes, headerBytes, payloadBytes);
      index.push({
        cid: block.cid,
        offset,
        recordLength,
        headerLength: headerBytes.length,
        byteLength: block.byteLength,
        payloadHash: block.payloadHash,
        codec: block.codec,
        kind: block.kind,
        refs: block.refs
      });
      offset += lengthBytes.length + recordLength;
    }
    return { index, binaryBase64: Buffer.concat(records).toString("base64"), byteLength: offset };
  }

  async function exportProofBundle(envelopeOrId, options = {}) {
    return enqueueMutation(() => exportProofBundleCommitted(envelopeOrId, options));
  }

  async function exportProofBundleCommitted(envelopeOrId, options = {}) {
    const current = await ensureState();
    const envelope = typeof envelopeOrId === "string" ? current.envelopes[envelopeOrId] : envelopeOrId;
    if (!envelope) throw new Error("Proof Envelope not found.");
    const refs = [
      ...asArray(envelope.proofRefs).map((ref) => ref.cid),
      ...asArray(envelope.extensions).map((extension) => extension.valueRef)
    ];
    const blocks = [];
    const seen = new Set();
    for (const ref of refs) {
      const walked = await resolvedStorage.walk(ref);
      for (const block of walked.blocks) {
        if (!seen.has(block.cid)) {
          seen.add(block.cid);
          blocks.push({
            protocol: block.protocol,
            cid: block.cid,
            codec: block.codec,
            kind: block.kind,
            refs: block.refs,
            byteLength: block.byteLength,
            payloadHash: block.payloadHash,
            payloadBase64: block.payloadBase64
          });
        }
      }
    }
    if (options.format && options.format !== "indexed") {
      throw new Error(`Unsupported proof bundle format: ${options.format}`);
    }
    const manifest = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      bundleType: PACTIUM_PROOF_BUNDLE_TYPE,
      envelopeId: envelope.envelopeId,
      ledgerHead: envelope.ledgerHead,
      blockCount: blocks.length,
      requiredBlocks: blocks.map((block) => block.cid),
      criticalExtensions: envelope.criticalExtensions,
      createdAt: nowIso()
    };
    const indexed = indexedBundleRecords(blocks);
    const bundle = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      bundleType: PACTIUM_PROOF_BUNDLE_TYPE,
      manifest,
      envelope,
      index: indexed.index,
      blocksEncoding: PACTIUM_BUNDLE_ENCODING,
      binaryBase64: indexed.binaryBase64,
      byteLength: indexed.byteLength,
      bundleHash: protocolHash("proof.bundle", {
        manifest,
        envelope,
        index: indexed.index.map((item) => ({
          cid: item.cid,
          offset: item.offset,
          recordLength: item.recordLength,
          headerLength: item.headerLength,
          byteLength: item.byteLength,
          payloadHash: item.payloadHash
        }))
      })
    };
    current.proofBundles[envelope.envelopeId] = bundle;
    await saveState();
    return bundle;
  }

  async function createExtension(extension) {
    return enqueueMutation(() => materializeExtension(resolvedStorage, extension));
  }

  async function storeEnvelope(envelope) {
    return enqueueMutation(() => storeEnvelopeCommitted(envelope));
  }

  async function storeEnvelopeCommitted(envelope) {
    const current = await ensureState();
    const finalized = finalizeEnvelope(envelope);
    await resolvedStorage.putBlock(finalized, {
      kind: "proof-envelope",
      refs: [
        ...asArray(finalized.proofRefs).map((ref) => ref.cid),
        ...asArray(finalized.extensions).map((extension) => extension.valueRef)
      ]
    });
    current.envelopes[finalized.envelopeId] = finalized;
    await saveState();
    return finalized;
  }

  async function protocolCatalog() {
    return {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      name: "Pactium",
      packageName: "pactium",
      rootExport: "latest-proof-first-only",
      capabilities: [
        "canonical-value",
        "protocol-hash",
        "storage-port",
        "ledger-transparency-log",
        "verifiable-index-engine",
        "operation-lifecycle",
        "append-condition",
        "tracking-cursor",
        "trusted-head-advancement",
        "workspace-projection",
        "merkle-state",
        "checkpoint-tree",
        "proof-envelope",
        "proof-bundle",
        "maintenance-task-engine",
        "repair-planner"
      ]
    };
  }

  async function doctor(options = {}) {
    await prepareRead();
    const failures = [];
    let rebuildResult = null;

    // Verify manifest
    try {
      const manifest = await resolvedStorage.getProtocolObject("core", "runtime-state", null);
    } catch (err) {
      failures.push(createVerificationFailure({
        layer: "doctor",
        code: "manifest_check_failed",
        message: err instanceof Error ? err.message : "Cannot read storage manifest.",
        repairable: false
      }));
    }

    // Verify ledger head rootHash matches compact range
    try {
      const head = await ledger.head();
      const compact = await ledger.compactRange();
      if (head && compact) {
        const peaks = asArray(compact.peaks);
        if (peaks.length > 0) {
          // Reconstruct root from peaks
          let reconstructed = peaks[peaks.length - 1].hash;
          for (let i = peaks.length - 2; i >= 0; i -= 1) {
            reconstructed = ledgerNodeHash(peaks[i].hash, reconstructed);
          }
          if (reconstructed !== head.rootHash) {
            failures.push(createVerificationFailure({
              layer: "doctor",
              code: "head_compact_range_mismatch",
              message: "Ledger head rootHash does not match the compact range peaks.",
              evidenceRef: head.headId || "",
              repairable: true
            }));
          }
        }
      }
    /* node:coverage ignore next -- ledger caches internally after init, untestable */
    } catch (err) {
      failures.push(createVerificationFailure({
        layer: "doctor",
        code: "ledger_consistency_check_failed",
        message: err instanceof Error ? err.message : "Ledger consistency check failed.",
        repairable: true
      }));
    }

    // Verify ledger leaf hash chain
    try {
      const head = await ledger.head();
      const pageSize = 1000;
      let verifiedLeaves = 0;
      for (let start = 0; start < Number(head.size || 0); start += pageSize) {
        const page = await ledger.pageEntries({ start, limit: pageSize });
        for (const entry of page.entries) {
          // Verify leaf integrity: check factCid maps to a valid CAS block
          if (entry.factCid) {
            const block = await resolvedStorage.getBlock(entry.factCid);
            if (!block) {
              failures.push(createVerificationFailure({
                layer: "doctor",
                code: "missing_ledger_fact_block",
                message: `CAS block missing for ledger leaf ${entry.index}.`,
                evidenceRef: entry.factCid,
                repairable: true
              }));
            } else if (block.payloadHash !== entry.factHash) {
              failures.push(createVerificationFailure({
                layer: "doctor",
                code: "bad_ledger_fact_hash",
                message: `CAS block hash mismatch for ledger leaf ${entry.index}.`,
                evidenceRef: entry.factCid,
                repairable: true
              }));
            }
          }
          verifiedLeaves += 1;
        }
        if (page.entries.length === 0 || page.nextPosition <= start) break;
      }
    } catch (err) {
      failures.push(createVerificationFailure({
        layer: "doctor",
        code: "ledger_leaf_check_failed",
        message: err instanceof Error ? err.message : "Ledger leaf integrity check failed.",
        repairable: true
      }));
    }

    // Verify commit markers: check for incomplete (pending without matching complete)
    try {
      const pendingKeys = await resolvedStorage.listProtocolObjectKeys("commit");
      const pendingCommitIds = pendingKeys
        .filter((k) => k.startsWith("pending-"))
        .map((k) => k.slice("pending-".length));
      const completeKeys = new Set(
        pendingKeys
          .filter((k) => k.startsWith("complete-"))
          .map((k) => k.slice("complete-".length))
      );
      for (const cid of pendingCommitIds) {
        if (!completeKeys.has(cid)) {
          failures.push(createVerificationFailure({
            layer: "doctor",
            code: "incomplete_commit",
            message: `Pending mutation commit ${cid} has no matching complete marker.`,
            evidenceRef: cid,
            repairable: true
          }));
        }
      }
    } catch (err) {
      failures.push(createVerificationFailure({
        layer: "doctor",
        code: "commit_check_failed",
        message: err instanceof Error ? err.message : "Commit marker scan failed.",
        repairable: true
      }));
    }

    // Verify index roots referenced in runtime state exist
    const current = await ensureState();
    const retainedRoots = currentIndexRoots(current);
    for (const root of retainedRoots) {
      try {
        if (root) await indexEngine.readIndexRoot(root);
      } catch (err) {
        failures.push(createVerificationFailure({
          layer: "doctor",
          code: "missing_index_root",
          message: `Index root ${root} referenced in state but missing from storage.`,
          evidenceRef: root,
          repairable: true
        }));
      }
    }

    // -- Rebuild mode: replay ledger leaves and compare derived roots --
    if (options.rebuild) {
      try {
        const rebuild = await rebuildCoreStateFromLedger({
          ledger,
          indexEngine,
          storage: resolvedStorage
        });
        const current = await ensureState();
        const mismatches = [];
        const runtimeRootLookup = (rootName) => {
          if (rootName === "openIntent") return current.indexRoots.openIntent || "";
          if (rootName === "outcome") return current.indexRoots.outcome || "";
          if (rootName === "intentIdempotency") return current.indexRoots.intentIdempotency || "";
          if (rootName === "outcomeIdempotency") return current.indexRoots.outcomeIdempotency || "";
          if (rootName === "causality") return current.indexRoots.causality || "";
          if (rootName.startsWith("workspace:")) {
            const parts = rootName.split(":");
            const wsId = parts[1];
            const field = parts.slice(2).join(":");
            const ws = current.workspace?.[wsId];
            if (field === "orderRoot") return ws?.orderRoot || "";
            if (field === "membershipRoot") return ws?.membershipRoot || "";
            if (field === "checkpointRoot") return ws?.checkpointRoot || "";
            /* node:coverage ignore next -- stateRoot always skipped, unreachable */
            if (field === "stateRoot") return ws?.stateRoot || "";
          }
          /* node:coverage ignore next -- defensive fallback for unrecognized fields */
          return "";
        };

        // Compare fully comparable roots — mismatch here is a hard error
        for (const [rootName, rebuiltRoot] of Object.entries(rebuild.fullyComparableRoots)) {
          if (!rebuiltRoot) continue;
          const runtimeRoot = runtimeRootLookup(rootName);
          if (runtimeRoot && rebuiltRoot !== runtimeRoot) {
            mismatches.push({ root: rootName, rebuilt: rebuiltRoot, runtime: runtimeRoot, category: "fullyComparable" });
            failures.push(createVerificationFailure({
              layer: "doctor",
              code: "derived_root_mismatch",
              message: `Rebuilt ${rootName} (${rebuiltRoot}) does not match runtime state (${runtimeRoot}).`,
              evidenceRef: rootName,
              repairable: true
            }));
          }
        }

        // Compare partially comparable roots — mismatch is a warning, not hard failure
        for (const [rootName, rebuiltRoot] of Object.entries(rebuild.partiallyComparableRoots)) {
          if (!rebuiltRoot) continue;
          const runtimeRoot = runtimeRootLookup(rootName);
          if (runtimeRoot && rebuiltRoot !== runtimeRoot) {
            mismatches.push({ root: rootName, rebuilt: rebuiltRoot, runtime: runtimeRoot, category: "partiallyComparable" });
            failures.push(createVerificationFailure({
              layer: "doctor",
              code: `${rootName}_rebuild_incomplete`,
              message: `Rebuilt ${rootName} does not match runtime state — material may be missing from ledger facts.`,
              evidenceRef: rootName,
              repairable: true,
              severity: "warning"
            }));
          }
        }

        // Report skipped roots as informational warnings
        for (const [rootName, info] of Object.entries(rebuild.skippedRoots)) {
          failures.push(createVerificationFailure({
            layer: "doctor",
            code: info.code || "rebuild_skipped",
            message: info.reason || `Root ${rootName} cannot be reliably rebuilt from ledger facts.`,
            evidenceRef: rootName,
            repairable: true,
            severity: "warning"
          }));
        }

        rebuildResult = {
          attempted: true,
          comparableRootsCount: Object.keys(rebuild.comparableRoots).length,
          fullyComparableCount: Object.keys(rebuild.fullyComparableRoots).length,
          partiallyComparableCount: Object.keys(rebuild.partiallyComparableRoots).length,
          skippedCount: Object.keys(rebuild.skippedRoots).length,
          mismatches,
          stateRebuildIncomplete: rebuild.stateRebuildIncomplete,
          warnings: rebuild.warnings
        };

        if (rebuild.stateRebuildIncomplete) {
          failures.push(createVerificationFailure({
            layer: "doctor",
            code: "state_rebuild_incomplete",
            message: "State root rebuild is incomplete because state mutations are not stored in ledger facts.",
            repairable: true,
            severity: "warning"
          }));
        }
      } catch (err) {
        failures.push(createVerificationFailure({
          layer: "doctor",
          code: "ledger_replay_failed",
          message: err instanceof Error ? err.message : "Ledger replay rebuild failed.",
          repairable: true
        }));
      }
    }

    const result = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      ok: failures.filter((f) => f.severity !== "warning").length === 0,
      dataDir: resolvedStorage.dataDir,
      latestSchemaOnly: true,
      historicalMigration: false,
      ledgerSize: Number((await ledger.head()).size || 0),
      catalog: await protocolCatalog(),
      ...(failures.length > 0 ? { failures } : {}),
      ...(rebuildResult ? { rebuild: rebuildResult } : {})
    };
    return result;
  }

  async function compactInMemoryCaches() {
    const current = await ensureState();
    if (!resolvedStorage.inMemory) {
      return {
        protocol: PACTIUM_PROTOCOL,
        inMemory: false,
        retainedRoots: 0,
        retainedNodeRoots: 0,
        prunedBlocks: 0,
        prunedProtocolObjects: 0
      };
    }
    const retainedRoots = currentIndexRoots(current);
    const cache = typeof indexEngine.pruneCache === "function"
      ? await indexEngine.pruneCache({ roots: retainedRoots })
      : { retainedRoots, retainedNodeRoots: retainedRoots };
    const retainedNodeRoots = new Set(asArray(cache.retainedNodeRoots || retainedRoots).map(String));
    const retainedRootHashes = new Set([
      ...asArray(cache.retainedRoots || retainedRoots),
      ...retainedNodeRoots
    ].map(hashFromCid).filter(Boolean));
    const prunedBlocks = typeof resolvedStorage.pruneBlocks === "function"
      ? resolvedStorage.pruneBlocks((block) => {
          const kind = String(block.kind || "");
          if (kind.startsWith("index-node:")) return !retainedNodeRoots.has(block.cid);
          return kind !== "state-value";
        })
      : 0;
    const prunedProtocolObjects = typeof resolvedStorage.pruneProtocolObjects === "function"
      ? resolvedStorage.pruneProtocolObjects((object) =>
          object.scope === "index" && !retainedRootHashes.has(String(object.key || "").split("-").pop())
        )
      : 0;
    return {
      protocol: PACTIUM_PROTOCOL,
      inMemory: true,
      retainedRoots: retainedRoots.length,
      retainedNodeRoots: retainedNodeRoots.size,
      prunedNodes: Number(cache.prunedNodes || 0),
      prunedRoots: Number(cache.prunedRoots || 0),
      prunedSnapshots: Number(cache.prunedSnapshots || 0),
      prunedBlocks,
      prunedProtocolObjects
    };
  }

  // -- Read-only resolvers --
  // These return canonical clones so callers cannot mutate cached state.
  async function resolveBlock(cid) {
    const block = await resolvedStorage.getBlock(String(cid || ""));
    if (!block) return null;
    // Defensive clone: bytes and refs must be independent of storage cache.
    return {
      ...block,
      bytes: block.bytes ? Buffer.from(block.bytes) : undefined,
      refs: [...asArray(block.refs)]
    };
  }

  async function hasBlock(cid) {
    return resolvedStorage.hasBlock(String(cid || ""));
  }

  async function readLedgerHead(id) {
    const head = await ledger.getHead(id || "");
    if (!head) return null;
    // Clone to prevent caller mutation of internal ledger state.
    return normalizeCanonicalValue(head);
  }

  async function readLedgerLeaf(index) {
    const leaf = await ledger.getLeaf(Number(index));
    if (!leaf) return null;
    // Clone to prevent caller mutation. getLeaf returns a protocol object
    // which is already cloned by storage, but add a defensive clone.
    return normalizeCanonicalValue(leaf);
  }

  async function readProtocolObject(scope, key, fallback) {
    return resolvedStorage.getProtocolObject(String(scope || ""), String(key || ""), fallback);
  }

  async function listProtocolObjectKeys(scope) {
    if (typeof resolvedStorage.listProtocolObjectKeys === "function") {
      return resolvedStorage.listProtocolObjectKeys(String(scope || ""));
    }
    return [];
  }

  return Object.freeze({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    dataDir: resolvedStorage.dataDir,
    beginOperationIntent,
    appendOperationOutcome,
    recordOperation,
    lookupOpenIntent,
    lookupOutcome,
    createAppendCondition,
    getLedgerCursor,
    getWorkspaceCursor,
    verifyCursor,
    advanceTrustedHead,
    planRecovery,
    getWorkspaceProjection,
    proveWorkspaceMembership,
    verifyEnvelope,
    exportProofBundle,
    createExtension,
    storeEnvelope,
    protocolCatalog,
    doctor,
    // Read-only protocol resolvers for storage, ledger, and index data.
    // These return canonical clones — safe for external consumption.
    resolveBlock,
    hasBlock,
    readLedgerHead,
    readLedgerLeaf,
    readProtocolObject,
    listProtocolObjectKeys,
    // Internal components for integration use. Prefer the public read-only
    // resolvers above unless you need direct storage/ledger/index access for
    // advanced maintenance, repair execution, or custom verification flows.
    advanced: Object.freeze({
      storage: resolvedStorage,
      ledger,
      indexEngine,
      _compactInMemoryCaches: compactInMemoryCaches
    })
  });
}
