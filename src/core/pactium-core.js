import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  PACTIUM_BUNDLE_ENCODING,
  PACTIUM_PROOF_BUNDLE_TYPE,
  PACTIUM_PROOF_TYPES,
  PACTIUM_PROTOCOL,
  PACTIUM_SCHEMA_VERSION,
  PACTIUM_TRUST_POLICIES
} from "../protocol/constants.js";
import { canonicalDecode, canonicalEncode, normalizeCanonicalValue } from "../canonical/value.js";
import { createAppendCondition, assertAppendCondition } from "./append-condition.js";
import { createLedgerTransparencyLog, ledgerNodeHash } from "../ledger/transparency-log.js";
import { advanceTrustedHead as advanceTrustedLedgerHead } from "../ledger/signed-head.js";
import { createVerifiableIndexEngine } from "../index-engine/snapshot-merkle-index.js";
import { createId, protocolHash } from "../protocol/hashing.js";
import {
  compactProofMaterialTables,
  createProofRef,
  finalizeEnvelope,
  materializeExtension,
  verifyProofEnvelope
} from "../proof/envelope.js";
import { createRepairPlanner } from "../repair/planner.js";
import { createStoragePort } from "../storage/storage-port.js";
import { createTrackingCursor, verifyTrackingCursor } from "./tracking-cursor.js";
import { asArray, asRecord, nowIso, safeText } from "../shared/records.js";
import { createVerificationFailure, PactiumLifecycleError } from "../verification/failure.js";
import { rebuildCoreStateFromLedger } from "./rebuild-state.js";
import {
  applyIndexDelete,
  applyIndexPut,
  checkpointEntriesFor,
  eventRefValue,
  idempotencyKeyFor,
  intentIdempotencyClaimKeyFor,
  lifecycleValueRef,
  normalizeCoreState,
  outcomeIdempotencyKeyFor,
  padOrdinal,
  receiptChangeClaimKeyFor,
  receiptReplayKeyFor,
  resetCoreRuntimeCaches,
  stateEntriesFor,
  workspaceStateFor
} from "./state-helpers.js";
import { createCoreStateStore } from "./state-store.js";

const pactiumInternals = new WeakMap();

export function getPactiumInternals(core) {
  const internals = pactiumInternals.get(core);
  if (!internals) {
    throw new Error("Pactium internals are available only for core instances created by createPactium().");
  }
  return internals;
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

async function currentIndexRoots(state, stateStore) {
  const retained = new Set(Object.values(asRecord(state.indexRoots)).map(String).filter(Boolean));
  const persisted = await stateStore.list(stateStore.scopes.workspace);
  const workspaces = [
    ...persisted.map((record) => record.value),
    ...Object.values(asRecord(state.workspace))
  ];
  for (const workspace of workspaces) {
    for (const field of ["orderRoot", "membershipRoot", "checkpointRoot", "stateRoot"]) {
      if (workspace?.[field]) retained.add(String(workspace[field]));
    }
  }
  return [...retained];
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
  inMemory = false,
  storageBackend = "",
  databasePath = ""
} = {}) {
  const ownsStorage = !storage;
  const resolvedStorage = storage || createStoragePort({ dataDir, userDataPath, inMemory, storageBackend, databasePath });
  const ledger = createLedgerTransparencyLog({ storage: resolvedStorage });
  const indexEngine = createVerifiableIndexEngine({ storage: resolvedStorage, domain: "pactium" });
  const repairPlanner = createRepairPlanner();
  const stateStore = createCoreStateStore({ storage: resolvedStorage });
  let state = null;
  let mutationLane = Promise.resolve();
  let closePromise = null;
  let lifecycleState = "open";
  const activeCalls = new Set();
  const useDurableWriteLock = !resolvedStorage.inMemory && typeof resolvedStorage.withWriteLock === "function";
  const mutationContext = new AsyncLocalStorage();
  const mutationContextToken = {};

  function closedCoreError() {
    const error = new Error("Pactium core is closed.");
    error.code = "PACTIUM_CLOSED";
    return error;
  }

  function reentrantCloseError() {
    const error = new Error("Pactium core cannot close from inside its own mutation transaction.");
    error.code = "PACTIUM_REENTRANT_CLOSE";
    return error;
  }

  function runOpenAsync(method, args) {
    if (lifecycleState !== "open") return Promise.reject(closedCoreError());
    let result;
    try {
      result = method(...args);
    } catch (error) {
      return Promise.reject(error);
    }
    let tracked;
    tracked = Promise.resolve(result).finally(() => {
      activeCalls.delete(tracked);
    });
    activeCalls.add(tracked);
    return tracked;
  }

  function guardAsync(method) {
    return (...args) => runOpenAsync(method, args);
  }

  function guardSync(method) {
    return (...args) => {
      if (lifecycleState !== "open") throw closedCoreError();
      return method(...args);
    };
  }

  async function reloadFromStorage() {
    if (typeof resolvedStorage.clearCache === "function") resolvedStorage.clearCache();
    if (typeof ledger.reload === "function") await ledger.reload();
    state = null;
    return ensureState();
  }

  async function prepareRead() {
    await mutationLane.catch(() => null);
    if (useDurableWriteLock) return reloadFromStorage();
    return resetCoreRuntimeCaches(await ensureState());
  }

  function enqueueMutation(task) {
    if (mutationContext.getStore() === mutationContextToken) {
      return Promise.resolve().then(task);
    }
    const run = mutationLane.catch(() => null).then(() => {
      if (!useDurableWriteLock) {
        return mutationContext.run(mutationContextToken, task);
      }
      return resolvedStorage.withWriteLock(async () => {
        return mutationContext.run(mutationContextToken, async () => {
          await reloadFromStorage();
          return task();
        });
      }).catch(async (error) => {
        state = null;
        if (typeof resolvedStorage.clearCache === "function") resolvedStorage.clearCache();
        if (typeof ledger.reload === "function") await ledger.reload().catch(() => null);
        throw error;
      });
    });
    mutationLane = run;
    return run;
  }

  function withMutationTransaction(task) {
    if (typeof task !== "function") {
      return Promise.reject(new TypeError("withMutationTransaction requires a task function."));
    }
    return enqueueMutation(task);
  }

  async function ensureState() {
    await resolvedStorage.initialize();
    if (state) return state;
    state = normalizeCoreState(await stateStore.load());
    return state;
  }

  async function saveState() {
    await stateStore.publish(state);
    resetCoreRuntimeCaches(state);
  }

  async function loadWorkspace(current, workspaceId) {
    const key = safeText(workspaceId, "default");
    if (!Object.hasOwn(current.workspace, key)) {
      const stored = await stateStore.get(stateStore.scopes.workspace, key, null);
      current.workspace[key] = stored || workspaceStateFor(current, key);
    }
    return current.workspace[key];
  }

  function stageWorkspace(current, workspaceId) {
    const key = safeText(workspaceId, "default");
    stateStore.stage(stateStore.scopes.workspace, key, current.workspace[key]);
  }

  async function readFact(locator, expectedFactType) {
    if (!locator?.factCid) return null;
    const block = await resolvedStorage.getBlock(String(locator.factCid));
    if (!block) throw new Error(`Ledger fact block missing from storage: ${locator.factCid}`);
    const fact = canonicalDecode(block.bytes);
    if (fact?.factType !== expectedFactType) {
      throw new Error(`Runtime locator expected ${expectedFactType}, received ${fact?.factType || "unknown"}.`);
    }
    return fact;
  }

  async function loadIntentRecord(current, intentId) {
    const key = String(intentId || "");
    if (!key) return null;
    if (Object.hasOwn(current.intents, key)) return current.intents[key];
    const locator = await stateStore.get(stateStore.scopes.intent, key, null);
    if (!locator) return null;
    const record = {
      intent: await readFact(locator, "operation.intent"),
      ledgerEventId: safeText(locator.ledgerEventId),
      ledgerIndex: Number(locator.ledgerIndex || 0),
      factCid: safeText(locator.factCid),
      open: locator.open === true,
      intentEnvelopeId: safeText(locator.intentEnvelopeId)
    };
    current.intents[key] = record;
    return record;
  }

  function stageIntentRecord(intentId, record) {
    stateStore.stage(stateStore.scopes.intent, String(intentId), {
      intentId: String(intentId),
      workspaceId: safeText(record.intent?.workspaceId),
      operationId: safeText(record.intent?.operationId),
      ledgerEventId: safeText(record.ledgerEventId),
      ledgerIndex: Number(record.ledgerIndex || 0),
      factCid: safeText(record.factCid),
      open: record.open === true,
      intentEnvelopeId: safeText(record.intentEnvelopeId)
    });
  }

  async function loadOutcome(current, intentId) {
    const key = String(intentId || "");
    if (!key) return null;
    if (Object.hasOwn(current.outcomes, key)) return current.outcomes[key];
    const locator = await stateStore.get(stateStore.scopes.outcome, key, null);
    if (!locator) return null;
    const outcome = await readFact(locator, "operation.outcome");
    current.outcomeLocators[key] = locator;
    current.outcomes[key] = outcome;
    return outcome;
  }

  function stageOutcome(intentId, outcome, ledgerAppend, outcomeEnvelopeId = "") {
    const locator = {
      intentId: String(intentId),
      outcomeId: safeText(outcome.outcomeId),
      workspaceId: safeText(outcome.workspaceId),
      ledgerEventId: safeText(ledgerAppend.entry.eventId),
      ledgerIndex: Number(ledgerAppend.entry.index || 0),
      factCid: safeText(ledgerAppend.entry.factCid),
      outcomeEnvelopeId: safeText(outcomeEnvelopeId)
    };
    if (state) state.outcomeLocators[String(intentId)] = locator;
    stateStore.stage(stateStore.scopes.outcome, String(intentId), {
      ...locator
    });
  }

  async function loadReceipt(current, receiptId) {
    const key = String(receiptId || "");
    if (!key) return null;
    if (Object.hasOwn(current.receipts, key)) return current.receipts[key];
    const locator = await stateStore.get(stateStore.scopes.receipt, key, null);
    if (!locator) return null;
    const receipt = await readFact(locator, "operation.receipt");
    current.receiptLocators[key] = locator;
    current.receipts[key] = receipt;
    return receipt;
  }

  function stageReceipt(receipt, ledgerAppend, envelopeId) {
    const locator = {
      receiptId: safeText(receipt.receiptId),
      workspaceId: safeText(receipt.workspaceId),
      operationId: safeText(receipt.operationId),
      ledgerEventId: safeText(ledgerAppend.entry.eventId),
      ledgerIndex: Number(ledgerAppend.entry.index || 0),
      factCid: safeText(ledgerAppend.entry.factCid),
      envelopeId: safeText(envelopeId)
    };
    state.receipts[receipt.receiptId] = receipt;
    state.receiptLocators[receipt.receiptId] = locator;
    stateStore.stage(stateStore.scopes.receipt, receipt.receiptId, locator);
  }

  async function loadChangeClaim(current, key) {
    if (!key) return null;
    if (Object.hasOwn(current.changeClaims, key)) return current.changeClaims[key];
    const claim = await stateStore.get(stateStore.scopes.changeClaim, key, null);
    if (claim) current.changeClaims[key] = claim;
    return claim;
  }

  async function loadReplay(scope, cache, key) {
    if (!key) return null;
    if (Object.hasOwn(cache, key)) return cache[key];
    const record = await stateStore.get(scope, key, null);
    if (!record?.envelopeId) return null;
    cache[key] = record.envelopeId;
    return record.envelopeId;
  }

  async function loadIntentClaim(current, key) {
    if (!key) return null;
    if (Object.hasOwn(current.intentIdempotencyClaims, key)) return current.intentIdempotencyClaims[key];
    const claim = await stateStore.get(stateStore.scopes.intentClaim, key, null);
    if (claim) current.intentIdempotencyClaims[key] = claim;
    return claim;
  }

  function stageCausalityIdentity(identity, kind) {
    const key = safeText(identity);
    if (!key) return;
    stateStore.stage(stateStore.scopes.causalityRef, key, { identity: key, kind: safeText(kind) });
  }

  async function hasCausalityRef(ref) {
    return Boolean(await stateStore.get(stateStore.scopes.causalityRef, String(ref || ""), null));
  }

  // Runtime state keeps only the envelope block CID; the envelope body lives in
  // content-addressed storage. This keeps runtime-state size independent of
  // envelope payload size and avoids rewriting every envelope on each save.
  async function registerEnvelope(current, envelope, refs) {
    const block = await resolvedStorage.putBlock(envelope, { kind: "proof-envelope", refs });
    current.envelopes[envelope.envelopeId] = block.cid;
    stateStore.stage(stateStore.scopes.envelope, envelope.envelopeId, {
      envelopeId: envelope.envelopeId,
      factId: safeText(envelope.factId),
      cid: block.cid
    });
    return block;
  }

  async function resolveEnvelopeById(current, envelopeId) {
    const key = String(envelopeId || "");
    if (!Object.hasOwn(current.envelopes, key)) {
      const locator = await stateStore.get(stateStore.scopes.envelope, key, null);
      if (locator?.cid) current.envelopes[key] = locator.cid;
    }
    const cid = current.envelopes[key];
    if (!cid) return null;
    const block = await resolvedStorage.getBlock(String(cid));
    if (!block) {
      throw new Error(`Proof Envelope block missing from storage: ${envelopeId}`);
    }
    return canonicalDecode(block.bytes);
  }

  // -- Commit markers for crash consistency --
  // Non-transactional storage keeps one marker per in-flight mutation. The
  // same key is finalized before deletion, so successful operations leave no
  // ever-growing completion history. doctor() scans only residual keys.
  const COMMIT_SCOPE = "commit";
  function usesCommitMarkers() {
    return !resolvedStorage.inMemory && !stateStore.isAtomicBackend();
  }
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
    if (!usesCommitMarkers()) return;
    await resolvedStorage.putProtocolObject(COMMIT_SCOPE, `pending-${commitId}`,
      commitMarker(commitId, operation, "pending", details));
  }

  async function finalizeCommitMarker(commitId, operation, details = {}) {
    if (!usesCommitMarkers()) return;
    await resolvedStorage.putProtocolObject(COMMIT_SCOPE, `pending-${commitId}`,
      commitMarker(commitId, operation, "complete", details));
  }

  async function cleanupPendingMarker(commitId) {
    if (!usesCommitMarkers()) return;
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
    finalizeEnvelopeExtensions = null,
    replayed = false,
    relatedEnvelopeIds = []
  }) {
    const material = compactProofMaterialTables({
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
    });
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
      factId: fact.intentId || fact.outcomeId || fact.receiptId || fact.repairId || ledgerAppend.entry.eventId,
      factRef: {
        ledgerEventId: ledgerAppend.entry.eventId,
        ledgerIndex: ledgerAppend.entry.index,
        factCid: ledgerAppend.entry.factCid,
        factHash: ledgerAppend.entry.factHash
      },
      ledgerHead: ledgerAppend.head,
      proofRefs: [materialRef],
      extensions: [...materializedExtensions],
      criticalExtensions: materializedExtensions.filter((extension) => extension.critical).map((extension) => extension.name),
      relatedEnvelopeIds,
      replayed,
      createdAt: nowIso()
    };
    const preliminaryEnvelope = finalizeEnvelope(envelopeBase);
    const finalExtensions = [...materializedExtensions];
    let hookAddedExtension = false;
    if (typeof finalizeEnvelopeExtensions === "function") {
      const finalizedExtensions = await finalizeEnvelopeExtensions(preliminaryEnvelope);
      const extensionInputs = Array.isArray(finalizedExtensions)
        ? finalizedExtensions
        : Array.isArray(finalizedExtensions?.extensions)
          ? finalizedExtensions.extensions
          : finalizedExtensions
            ? [finalizedExtensions]
            : [];
      for (const extension of extensionInputs) {
        const materialized = await materializeExtension(resolvedStorage, extension);
        if (materialized) {
          finalExtensions.push(materialized);
          hookAddedExtension = true;
        }
      }
    }
    const envelope = hookAddedExtension
      ? finalizeEnvelope({ ...envelopeBase, extensions: finalExtensions })
      : preliminaryEnvelope;
    const current = await ensureState();
    await registerEnvelope(current, envelope, [
      ...envelope.proofRefs.map((ref) => ref.cid),
      ...envelope.extensions.map((extension) => extension.valueRef)
    ]);
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
    const replayEnvelopeId = await loadReplay(stateStore.scopes.intentReplay, current.intentEnvelopes, idKey);
    if (replayEnvelopeId) {
      return { ...await resolveEnvelopeById(current, replayEnvelopeId), replayed: true };
    }
    // --- Preflight validation (no side effects) ---
    // All checks that can fail BEFORE we write any pending marker or commit
    // any mutation must happen here. Otherwise a failed check leaves an orphan
    // pending marker that doctor() will report as incomplete_commit.
    const existingClaim = await loadIntentClaim(current, idClaimKey);
    if (existingClaim && existingClaim.inputHash !== inputHash) {
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
    const workspace = await loadWorkspace(current, workspaceId);
    if (appendCondition) {
      const requiredIntentId = appendCondition.requiredOpenIntentState?.intentId || "";
      const requiredIntent = requiredIntentId ? await loadIntentRecord(current, requiredIntentId) : null;
      const openIntentState = requiredIntentId
        ? {
          intentId: requiredIntentId,
          exists: requiredIntent?.open === true
        }
        : { exists: false };
      await assertAppendCondition(appendCondition, {
        phase: "intent",
        currentHead: await ledger.head(),
        workspace,
        openIntentState,
        hasCausalityRef
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
      idempotencyReplayKey: idKey,
      idempotencyClaimKey: idClaimKey,
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
      ledgerIndex: ledgerAppend.entry.index,
      factCid: ledgerAppend.entry.factCid,
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
          multiproof: intent.causalityRefs.length > 0
            ? await indexEngine.proveMembershipMultiproof(
                current.indexRoots.causality,
                intent.causalityRefs.map((ref) => `${ref}\u0000${intent.intentId}`),
                proofOptions
              )
            : null
        }
      },
      appendCondition,
      extensions: asArray(input.extensions),
      finalizeEnvelopeExtensions: input.finalizeEnvelopeExtensions,
      replayed: false
    });
    if (idKey) current.intentEnvelopes[idKey] = envelope.envelopeId;
    if (idClaimKey) current.intentIdempotencyClaims[idClaimKey] = { inputHash, envelopeId: envelope.envelopeId };
    current.intents[intent.intentId].intentEnvelopeId = envelope.envelopeId;
    stageIntentRecord(intent.intentId, current.intents[intent.intentId]);
    if (idKey) stateStore.stage(stateStore.scopes.intentReplay, idKey, { envelopeId: envelope.envelopeId });
    if (idClaimKey) stateStore.stage(stateStore.scopes.intentClaim, idClaimKey, { inputHash, envelopeId: envelope.envelopeId });
    stageCausalityIdentity(intent.intentId, "intent-id");
    stageCausalityIdentity(ledgerAppend.entry.eventId, "ledger-event-id");
    stageWorkspace(current, workspaceId);
    await saveState();
    await finalizeCommitMarker(commitId, "begin-intent", {
      ledgerEventIds: [envelope.factRef.ledgerEventId],
      envelopeIds: [envelope.envelopeId],
      affectedWorkspaceIds: [workspaceId]
    });
      await cleanupPendingMarker(commitId);
      return envelope;
    } catch (error) {
      stateStore.discard();
    if (!ledgerCommitted) {
        // Nothing durable was written — clean up pending marker so
        // doctor() won't report a false incomplete_commit.
        await cleanupPendingMarker(commitId);
      }
      // If ledgerCommitted is true, the ledger fact exists but the
      // marker never reached its finalized phase. Keep the pending marker so
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
    const intentRecord = await loadIntentRecord(current, intentId);
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
    const replayEnvelopeId = await loadReplay(stateStore.scopes.outcomeReplay, current.outcomeEnvelopes, outcomeIdKey);
    if (replayEnvelopeId) {
      return { ...await resolveEnvelopeById(current, replayEnvelopeId), replayed: true };
    }
    const existingOutcome = await loadOutcome(current, intentId);
    if (existingOutcome) {
      throw new PactiumLifecycleError("Operation Intent already has a Terminal Outcome.", createVerificationFailure({
        layer: "operation-lifecycle",
        code: "terminal_outcome_exists",
        message: "Pactium records exactly one Terminal Outcome per Operation Intent.",
        evidenceRef: existingOutcome.outcomeId,
        repairable: false
      }));
    }
    const workspaceId = intentRecord.intent.workspaceId;
    const workspace = await loadWorkspace(current, workspaceId);
    const appendCondition = input.appendCondition
      ? createAppendCondition({ workspaceId, ...asRecord(input.appendCondition) })
      : null;
    if (appendCondition) {
      await assertAppendCondition(appendCondition, {
        phase: "outcome",
        currentHead: await ledger.head(),
        workspace,
        outcomeState: {
          intentId,
          exists: Boolean(existingOutcome),
          outcomeId: existingOutcome?.outcomeId || ""
        },
        hasCausalityRef
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
      outcomeIdempotencyKey: safeText(input.outcomeIdempotencyKey || input.idempotencyKey),
      outcomeIdempotencyReplayKey: outcomeIdKey,
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
    const workspaceStateEntries = stateEntriesFor(current, workspaceId);
    const mutations = asArray(input.stateMutations || input.state?.mutations);
    const keyedMutations = mutations.filter((mutation) => mutation?.key);
    const netKeyedMutations = netStateMutationsByKey(keyedMutations);
    await ensureWorkspaceStateRoot({ indexEngine, workspace, workspaceStateEntries });
    const stateIndexMutations = [];
    for (const mutation of netKeyedMutations) {
      const key = String(mutation.key || "");
      if (!key) continue;
      if (mutation.action === "delete") {
        delete workspaceStateEntries[key];
        stateIndexMutations.push({ action: "delete", key });
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
        stateIndexMutations.push({
          action: "put",
          key,
          valueRef: stateEntry.valueRef,
          valueHash: stateEntry.valueHash,
          metadata: stateEntry.metadata
        });
      }
    }
    if (stateIndexMutations.length > 0) {
      workspace.stateRoot = (await indexEngine.mutate(workspace.stateRoot, stateIndexMutations, { domain: "state" })).root;
    }
    const stateRoot = workspace.stateRoot;
    const fullStateMutationMode = proofOptions.stateMutationProofMode === "full";
    const provedStateMutationCount = fullStateMutationMode
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
      provedKeyCount: provedStateMutationCount,
      mutationProofMode: fullStateMutationMode ? "full" : "sampled",
      proofCompleteness: provedStateMutationCount >= netKeyedMutations.length ? "full" : "sampled",
      unprovedMutationCount: Math.max(0, netKeyedMutations.length - provedStateMutationCount),
      proofProfile: {
        profileType: "pactium.state-mutation-proof-profile",
        mode: fullStateMutationMode ? "full" : "sampled",
        sampling: fullStateMutationMode ? "all-unique-keys" : "first-32-canonical-unique-keys",
        totalUniqueKeyCount: netKeyedMutations.length,
        provedKeyCount: provedStateMutationCount,
        completeness: provedStateMutationCount >= netKeyedMutations.length ? "full" : "sampled",
        unprovedKeyCount: Math.max(0, netKeyedMutations.length - provedStateMutationCount)
      },
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
          multiproof: outcome.causalityRefs.length > 0
            ? await indexEngine.proveMembershipMultiproof(
                current.indexRoots.causality,
                outcome.causalityRefs.map((ref) => `${ref}\u0000${outcome.outcomeId}`),
                proofOptions
              )
            : null
        }
      },
      appendCondition,
      extensions: asArray(input.extensions),
      finalizeEnvelopeExtensions: input.finalizeEnvelopeExtensions,
      replayed: false,
      relatedEnvelopeIds: [intentRecord.intentEnvelopeId].filter(Boolean)
    });
    if (outcomeIdKey) current.outcomeEnvelopes[outcomeIdKey] = envelope.envelopeId;
    stageOutcome(intentId, outcome, ledgerAppend, envelope.envelopeId);
    stageIntentRecord(intentId, current.intents[intentId]);
    if (outcomeIdKey) stateStore.stage(stateStore.scopes.outcomeReplay, outcomeIdKey, { envelopeId: envelope.envelopeId });
    stageCausalityIdentity(outcome.outcomeId, "outcome-id");
    stageCausalityIdentity(ledgerAppend.entry.eventId, "ledger-event-id");
    stageWorkspace(current, workspaceId);
    await saveState();
    await finalizeCommitMarker(commitId, "append-outcome", {
      ledgerEventIds: [envelope.factRef.ledgerEventId],
      envelopeIds: [envelope.envelopeId],
      affectedWorkspaceIds: [workspaceId]
    });
    await cleanupPendingMarker(commitId);
    return envelope;
    } catch (error) {
      stateStore.discard();
      if (!ledgerCommitted) {
        // Nothing durable was written — clean up the pending marker.
        await cleanupPendingMarker(commitId);
      }
      // If ledgerCommitted is true, the pending marker stays so doctor()
      // can correctly report incomplete_commit.
      throw error;
    }
  }

  async function recordOperationReceipt(input = {}) {
    return enqueueMutation(() => recordOperationReceiptCommitted(input));
  }

  async function recordOperationReceiptCommitted(input = {}) {
    const current = await ensureState();
    const operationId = safeText(input.operationId);
    if (!operationId) throw new Error("operationId is required for Operation Receipt.");
    if (asArray(input.stateMutations || input.state?.mutations).length > 0) {
      throw new Error("Operation Receipt is terminal evidence and does not accept stateMutations.");
    }
    const workspaceId = safeText(input.workspaceId || input.scope, "default");
    const profile = safeText(input.profile || input.receiptProfile, "receipt").toLowerCase();
    if (profile !== "receipt" && profile !== "on-change") {
      throw new Error(`Unsupported Operation Receipt profile: ${profile}`);
    }
    const idempotencyKey = safeText(input.idempotencyKey);
    const replayKey = idempotencyKey
      ? receiptReplayKeyFor({ workspaceId, operationId, idempotencyKey })
      : "";
    const replayEnvelopeId = await loadReplay(
      stateStore.scopes.receiptReplay,
      current.receiptEnvelopes,
      replayKey
    );
    if (replayEnvelopeId) {
      const envelope = await resolveEnvelopeById(current, replayEnvelopeId);
      return { ...envelope, replayed: true, disposition: "replayed" };
    }

    const changeDigest = protocolHash("operation.receipt.change", input.changeDigest
      ? { suppliedDigest: safeText(input.changeDigest) }
      : input.change ?? input.input ?? input.payload ?? input.result ?? input.output ?? {});
    const changeClaimKey = profile === "on-change"
      ? receiptChangeClaimKeyFor({
          workspaceId,
          operationId,
          changeKey: safeText(input.changeKey, operationId)
        })
      : "";
    const existingChangeClaim = await loadChangeClaim(current, changeClaimKey);
    if (existingChangeClaim?.changeDigest === changeDigest) {
      return {
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        receiptType: "pactium.operation-receipt-result",
        profile,
        disposition: "unchanged",
        envelopeId: safeText(existingChangeClaim.envelopeId),
        receiptId: safeText(existingChangeClaim.receiptId),
        replayed: false
      };
    }

    const commitId = createId("mutation_commit", {
      operation: "record-operation-receipt",
      operationId,
      workspaceId,
      nonce: crypto.randomUUID()
    });
    await writePendingMarker(commitId, "record-operation-receipt", { affectedWorkspaceIds: [workspaceId] });
    let ledgerCommitted = false;
    try {
      const receipt = {
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        factType: "operation.receipt",
        receiptId: createId("operation_receipt", {
          operationId,
          workspaceId,
          profile,
          changeDigest,
          idempotencyKey,
          nonce: input.nonce || crypto.randomUUID()
        }),
        operationId,
        workspaceId,
        profile,
        status: safeText(input.status, "succeeded"),
        idempotencyKey,
        receiptReplayKey: replayKey,
        changeClaimKey,
        changeDigest,
        resultHash: protocolHash("operation.receipt.result", input.result ?? input.output ?? {}),
        subject: normalizeCanonicalValue(asRecord(input.subject)),
        hostEvidenceRefs: asArray(input.hostEvidenceRefs).map(String),
        createdAt: nowIso()
      };
      const ledgerAppend = await ledger.append(receipt);
      ledgerCommitted = true;
      current.indexRoots.receipt = await applyIndexPut(
        indexEngine,
        current.indexRoots.receipt,
        receipt.receiptId,
        eventRefValue(ledgerAppend),
        "operation-receipt"
      );
      const proofOptions = asRecord(input.proofOptions);
      const envelope = await createEnvelope({
        envelopeKind: "operation-receipt",
        fact: receipt,
        ledgerAppend,
        proofs: {
          receipt: {
            root: current.indexRoots.receipt,
            proof: await indexEngine.prove(current.indexRoots.receipt, receipt.receiptId, proofOptions)
          }
        },
        extensions: asArray(input.extensions),
        finalizeEnvelopeExtensions: input.finalizeEnvelopeExtensions,
        replayed: false
      });
      stageReceipt(receipt, ledgerAppend, envelope.envelopeId);
      if (replayKey) {
        current.receiptEnvelopes[replayKey] = envelope.envelopeId;
        stateStore.stage(stateStore.scopes.receiptReplay, replayKey, {
          envelopeId: envelope.envelopeId,
          receiptId: receipt.receiptId
        });
      }
      if (changeClaimKey) {
        const claim = {
          changeClaimKey,
          changeDigest,
          envelopeId: envelope.envelopeId,
          receiptId: receipt.receiptId
        };
        current.changeClaims[changeClaimKey] = claim;
        stateStore.stage(stateStore.scopes.changeClaim, changeClaimKey, claim);
      }
      stageCausalityIdentity(receipt.receiptId, "receipt-id");
      stageCausalityIdentity(ledgerAppend.entry.eventId, "ledger-event-id");
      await saveState();
      await finalizeCommitMarker(commitId, "record-operation-receipt", {
        ledgerEventIds: [ledgerAppend.entry.eventId],
        envelopeIds: [envelope.envelopeId],
        affectedWorkspaceIds: [workspaceId]
      });
      await cleanupPendingMarker(commitId);
      return { ...envelope, disposition: "recorded" };
    } catch (error) {
      stateStore.discard();
      if (!ledgerCommitted) await cleanupPendingMarker(commitId);
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

  function batchInputRequiresStepwiseCommit(input = {}) {
    return Boolean(
      input.appendCondition ||
      input.intentAppendCondition ||
      input.outcomeAppendCondition ||
      input.outcome?.appendCondition ||
      input.returnIntentReplay
    );
  }

  async function recordOperations(inputs = []) {
    return enqueueMutation(async () => {
      const normalizedInputs = asArray(inputs);
      if (normalizedInputs.length === 0 || normalizedInputs.some(batchInputRequiresStepwiseCommit)) {
        return recordOperationsStepwise(normalizedInputs);
      }

      const current = await ensureState();
      const staged = [];
      const facts = [];
      const seenIntentIdempotencyKeys = new Set();
      const seenIntentIdempotencyClaims = new Map();
      const seenOutcomeIdempotencyKeys = new Set();
      for (const input of normalizedInputs) {
        const operationId = safeText(input.operationId);
        if (!operationId) throw new Error("operationId is required for Operation Intent.");
        const workspaceId = safeText(input.workspaceId || input.scope, "default");
        const idempotencyKey = safeText(input.idempotencyKey);
        const idKey = idempotencyKey ? idempotencyKeyFor({ ...input, operationId, workspaceId }) : "";
        const idClaimKey = idempotencyKey ? intentIdempotencyClaimKeyFor({ operationId, workspaceId, idempotencyKey }) : "";
        const inputHash = protocolHash("operation.intent", input.input ?? input.payload ?? {});
        const existingIntentReplay = await loadReplay(stateStore.scopes.intentReplay, current.intentEnvelopes, idKey);
        if (idKey && (existingIntentReplay || seenIntentIdempotencyKeys.has(idKey))) {
          return recordOperationsStepwise(normalizedInputs);
        }
        const existingIntentClaim = await loadIntentClaim(current, idClaimKey);
        if (existingIntentClaim && existingIntentClaim.inputHash !== inputHash) {
          throw new PactiumLifecycleError("Operation Intent idempotency key was reused with different input.", createVerificationFailure({
            layer: "operation-lifecycle",
            code: "idempotency_conflict",
            message: "Intent idempotency key was reused with different input.",
            evidenceRef: idClaimKey,
            repairable: false
          }));
        }
        if (idClaimKey && seenIntentIdempotencyClaims.has(idClaimKey) && seenIntentIdempotencyClaims.get(idClaimKey) !== inputHash) {
          throw new PactiumLifecycleError("Operation Intent idempotency key was reused with different input.", createVerificationFailure({
            layer: "operation-lifecycle",
            code: "idempotency_conflict",
            message: "Intent idempotency key was reused with different input.",
            evidenceRef: idClaimKey,
            repairable: false
          }));
        }
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
          idempotencyReplayKey: idKey,
          idempotencyClaimKey: idClaimKey,
          subject: normalizeCanonicalValue(asRecord(input.subject)),
          causalityRefs: asArray(input.causalityRefs).map(String),
          appendConditionHash: "",
          createdAt: nowIso()
        };
        const outcomeInput = { ...input, intentId: intent.intentId };
        const outcomeIdKey = safeText(outcomeInput.outcomeIdempotencyKey || outcomeInput.idempotencyKey)
          ? outcomeIdempotencyKeyFor(outcomeInput)
          : "";
        const existingOutcomeReplay = await loadReplay(stateStore.scopes.outcomeReplay, current.outcomeEnvelopes, outcomeIdKey);
        if (outcomeIdKey && (existingOutcomeReplay || seenOutcomeIdempotencyKeys.has(outcomeIdKey))) {
          return recordOperationsStepwise(normalizedInputs);
        }
        const outcome = {
          protocol: PACTIUM_PROTOCOL,
          schema: PACTIUM_SCHEMA_VERSION,
          factType: "operation.outcome",
          outcomeId: createId("operation_outcome", {
            intentId: intent.intentId,
            outcomeIdempotencyKey: outcomeIdKey,
            status: input.status || "succeeded",
            result: input.result ?? input.output ?? {},
            nonce: input.outcomeNonce || input.nonce || crypto.randomUUID()
          }),
          intentId: intent.intentId,
          operationId,
          workspaceId,
          status: safeText(input.status, "succeeded"),
          resultHash: protocolHash("operation.outcome", input.result ?? input.output ?? {}),
          outcomeIdempotencyKey: safeText(input.outcomeIdempotencyKey || input.idempotencyKey),
          outcomeIdempotencyReplayKey: outcomeIdKey,
          hostEvidenceRefs: asArray(input.hostEvidenceRefs).map(String),
          causalityRefs: asArray(input.causalityRefs).map(String),
          appendConditionHash: "",
          createdAt: nowIso()
        };
        if (idKey) seenIntentIdempotencyKeys.add(idKey);
        if (idClaimKey) seenIntentIdempotencyClaims.set(idClaimKey, inputHash);
        if (outcomeIdKey) seenOutcomeIdempotencyKeys.add(outcomeIdKey);
        await loadWorkspace(current, workspaceId);
        staged.push({ input, operationId, workspaceId, idKey, idClaimKey, inputHash, outcomeIdKey, intent, outcome });
        facts.push(intent, outcome);
      }

      const commitId = createId("mutation_commit", {
        operation: "record-operations",
        count: staged.length,
        nonce: crypto.randomUUID()
      });
      await writePendingMarker(commitId, "record-operations", {
        affectedWorkspaceIds: [...new Set(staged.map((item) => item.workspaceId))]
      });
      let ledgerCommitted = false;
      try {
        const ledgerBatch = await ledger.appendBatch(facts, { signEach: true });
        ledgerCommitted = true;
        const envelopes = [];
        for (const [index, item] of staged.entries()) {
          const intentAppend = ledgerBatch.appends[index * 2];
          const outcomeAppend = ledgerBatch.appends[(index * 2) + 1];
          const proofOptions = asRecord(item.input.proofOptions);
          current.intents[item.intent.intentId] = {
            intent: item.intent,
            ledgerEventId: intentAppend.entry.eventId,
            ledgerIndex: intentAppend.entry.index,
            factCid: intentAppend.entry.factCid,
            open: true
          };
          current.indexRoots.openIntent = await applyIndexPut(
            indexEngine,
            current.indexRoots.openIntent,
            item.intent.intentId,
            eventRefValue(intentAppend),
            "open-intent"
          );
          if (item.idKey) {
            current.indexRoots.intentIdempotency = await applyIndexPut(
              indexEngine,
              current.indexRoots.intentIdempotency,
              item.idKey,
              lifecycleValueRef(item.intent.intentId, { intentId: item.intent.intentId }),
              "intent-idempotency"
            );
          }
          for (const ref of item.intent.causalityRefs) {
            current.indexRoots.causality = await applyIndexPut(
              indexEngine,
              current.indexRoots.causality,
              `${ref}\u0000${item.intent.intentId}`,
              lifecycleValueRef(item.intent.intentId, { from: ref, to: item.intent.intentId, relation: "causes" }),
              "operation-causality"
            );
          }
          const intentProjection = await updateWorkspaceProjection({
            indexEngine,
            state: current,
            workspaceId: item.workspaceId,
            ledgerAppend: intentAppend,
            proofOptions
          });
          const workspace = workspaceStateFor(current, item.workspaceId);
          const checkpoints = checkpointEntriesFor(current, item.workspaceId);
          const checkpointNodeId = createId("checkpoint_node", { intentId: item.intent.intentId, kind: "intent" });
          const checkpointNode = {
            checkpointNodeId,
            checkpointKind: "intent",
            parentId: "",
            intentId: item.intent.intentId,
            ledgerEventId: intentAppend.entry.eventId,
            workspaceId: item.workspaceId
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
          const intentEnvelope = await createEnvelope({
            envelopeKind: "operation-intent",
            fact: item.intent,
            ledgerAppend: intentAppend,
            proofs: {
              openIntent: await indexEngine.prove(current.indexRoots.openIntent, item.intent.intentId, proofOptions),
              intentIdempotency: item.idKey ? await indexEngine.prove(current.indexRoots.intentIdempotency, item.idKey, proofOptions) : null,
              workspaceProjection: intentProjection,
              checkpoint: {
                root: workspace.checkpointRoot,
                proof: await indexEngine.prove(workspace.checkpointRoot, checkpointNodeId, proofOptions)
              },
              causality: {
                root: current.indexRoots.causality,
                multiproof: item.intent.causalityRefs.length > 0
                  ? await indexEngine.proveMembershipMultiproof(
                      current.indexRoots.causality,
                      item.intent.causalityRefs.map((ref) => `${ref}\u0000${item.intent.intentId}`),
                      proofOptions
                    )
                  : null
              }
            },
            appendCondition: null,
            extensions: asArray(item.input.extensions),
            finalizeEnvelopeExtensions: item.input.finalizeEnvelopeExtensions,
            replayed: false
          });
          if (item.idKey) current.intentEnvelopes[item.idKey] = intentEnvelope.envelopeId;
          if (item.idClaimKey) current.intentIdempotencyClaims[item.idClaimKey] = { inputHash: item.inputHash, envelopeId: intentEnvelope.envelopeId };
          current.intents[item.intent.intentId].intentEnvelopeId = intentEnvelope.envelopeId;

          current.outcomes[item.intent.intentId] = item.outcome;
          current.intents[item.intent.intentId].open = false;
          current.indexRoots.openIntent = await applyIndexDelete(indexEngine, current.indexRoots.openIntent, item.intent.intentId, "open-intent");
          current.indexRoots.outcome = await applyIndexPut(
            indexEngine,
            current.indexRoots.outcome,
            item.intent.intentId,
            eventRefValue(outcomeAppend),
            "outcome"
          );
          if (item.outcomeIdKey) {
            current.indexRoots.outcomeIdempotency = await applyIndexPut(
              indexEngine,
              current.indexRoots.outcomeIdempotency,
              item.outcomeIdKey,
              lifecycleValueRef(item.outcome.outcomeId, { outcomeId: item.outcome.outcomeId }),
              "outcome-idempotency"
            );
          }
          for (const ref of item.outcome.causalityRefs) {
            current.indexRoots.causality = await applyIndexPut(
              indexEngine,
              current.indexRoots.causality,
              `${ref}\u0000${item.outcome.outcomeId}`,
              lifecycleValueRef(item.outcome.outcomeId, { from: ref, to: item.outcome.outcomeId, relation: "causes" }),
              "operation-causality"
            );
          }
          const outcomeProjection = await updateWorkspaceProjection({
            indexEngine,
            state: current,
            workspaceId: item.workspaceId,
            ledgerAppend: outcomeAppend,
            proofOptions
          });
          const workspaceStateEntries = stateEntriesFor(current, item.workspaceId);
          const mutations = asArray(item.input.stateMutations || item.input.state?.mutations);
          const netKeyedMutations = netStateMutationsByKey(mutations.filter((mutation) => mutation?.key));
          await ensureWorkspaceStateRoot({ indexEngine, workspace, workspaceStateEntries });
          const stateIndexMutations = [];
          for (const mutation of netKeyedMutations) {
            const key = String(mutation.key || "");
            if (mutation.action === "delete") {
              delete workspaceStateEntries[key];
              stateIndexMutations.push({ action: "delete", key });
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
              stateIndexMutations.push({
                action: "put",
                key,
                valueRef: stateEntry.valueRef,
                valueHash: stateEntry.valueHash,
                metadata: stateEntry.metadata
              });
            }
          }
          if (stateIndexMutations.length > 0) {
            workspace.stateRoot = (await indexEngine.mutate(workspace.stateRoot, stateIndexMutations, { domain: "state" })).root;
          }
          const stateRoot = workspace.stateRoot;
          const fullStateMutationMode = proofOptions.stateMutationProofMode === "full";
          const provedStateMutationCount = fullStateMutationMode
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
              outcomeId: item.outcome.outcomeId,
              stateRoot,
              mutations: mutationDescriptors
            }),
            outcomeId: item.outcome.outcomeId,
            intentId: item.intent.intentId,
            workspaceId: item.workspaceId,
            stateRoot,
            mutationCount: netKeyedMutations.length,
            mutations: mutationDescriptors,
            mutationKeys: netKeyedMutations.map((mutation) => String(mutation.key || "")),
            mutationActions: netKeyedMutations.map((mutation) => String(mutation.action || "put")),
            provedKeyCount: provedStateMutationCount,
            mutationProofMode: fullStateMutationMode ? "full" : "sampled",
            proofCompleteness: provedStateMutationCount >= netKeyedMutations.length ? "full" : "sampled",
            unprovedMutationCount: Math.max(0, netKeyedMutations.length - provedStateMutationCount),
            proofProfile: {
              profileType: "pactium.state-mutation-proof-profile",
              mode: fullStateMutationMode ? "full" : "sampled",
              sampling: fullStateMutationMode ? "all-unique-keys" : "first-32-canonical-unique-keys",
              totalUniqueKeyCount: netKeyedMutations.length,
              provedKeyCount: provedStateMutationCount,
              completeness: provedStateMutationCount >= netKeyedMutations.length ? "full" : "sampled",
              unprovedKeyCount: Math.max(0, netKeyedMutations.length - provedStateMutationCount)
            },
            createdAt: nowIso()
          };
          const outcomeCheckpointNodeId = createId("checkpoint_node", { outcomeId: item.outcome.outcomeId, kind: "outcome" });
          const outcomeCheckpointNode = {
            checkpointNodeId: outcomeCheckpointNodeId,
            checkpointKind: "outcome",
            parentId: checkpointNodeId,
            intentId: item.intent.intentId,
            outcomeId: item.outcome.outcomeId,
            stateCommitId: stateCommit.stateCommitId,
            workspaceId: item.workspaceId,
            ledgerEventId: outcomeAppend.entry.eventId
          };
          checkpoints[outcomeCheckpointNodeId] = outcomeCheckpointNode;
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
          const outcomeEnvelope = await createEnvelope({
            envelopeKind: "operation-outcome",
            fact: item.outcome,
            ledgerAppend: outcomeAppend,
            proofs: {
              outcome: await indexEngine.prove(current.indexRoots.outcome, item.intent.intentId, proofOptions),
              openIntentRemoved: await indexEngine.prove(current.indexRoots.openIntent, item.intent.intentId, proofOptions),
              outcomeIdempotency: item.outcomeIdKey ? await indexEngine.prove(current.indexRoots.outcomeIdempotency, item.outcomeIdKey, proofOptions) : null,
              workspaceProjection: outcomeProjection,
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
                multiproof: item.outcome.causalityRefs.length > 0
                  ? await indexEngine.proveMembershipMultiproof(
                      current.indexRoots.causality,
                      item.outcome.causalityRefs.map((ref) => `${ref}\u0000${item.outcome.outcomeId}`),
                      proofOptions
                    )
                  : null
              }
            },
            appendCondition: null,
            extensions: asArray(item.input.outcomeExtensions || item.input.extensions),
            finalizeEnvelopeExtensions: item.input.finalizeEnvelopeExtensions,
            replayed: false,
            relatedEnvelopeIds: [intentEnvelope.envelopeId]
          });
          if (item.outcomeIdKey) current.outcomeEnvelopes[item.outcomeIdKey] = outcomeEnvelope.envelopeId;
          stageOutcome(item.intent.intentId, item.outcome, outcomeAppend, outcomeEnvelope.envelopeId);
          stageIntentRecord(item.intent.intentId, current.intents[item.intent.intentId]);
          if (item.idKey) stateStore.stage(stateStore.scopes.intentReplay, item.idKey, { envelopeId: intentEnvelope.envelopeId });
          if (item.idClaimKey) stateStore.stage(stateStore.scopes.intentClaim, item.idClaimKey, {
            inputHash: item.inputHash,
            envelopeId: intentEnvelope.envelopeId
          });
          if (item.outcomeIdKey) stateStore.stage(stateStore.scopes.outcomeReplay, item.outcomeIdKey, {
            envelopeId: outcomeEnvelope.envelopeId
          });
          stageCausalityIdentity(item.intent.intentId, "intent-id");
          stageCausalityIdentity(intentAppend.entry.eventId, "ledger-event-id");
          stageCausalityIdentity(item.outcome.outcomeId, "outcome-id");
          stageCausalityIdentity(outcomeAppend.entry.eventId, "ledger-event-id");
          stageWorkspace(current, item.workspaceId);
          envelopes.push(outcomeEnvelope);
        }
        await saveState();
        await finalizeCommitMarker(commitId, "record-operations", {
          ledgerEventIds: envelopes.map((envelope) => envelope.factRef.ledgerEventId),
          envelopeIds: envelopes.map((envelope) => envelope.envelopeId),
          affectedWorkspaceIds: [...new Set(staged.map((item) => item.workspaceId))]
        });
        await cleanupPendingMarker(commitId);
        return {
          protocol: PACTIUM_PROTOCOL,
          batchType: "pactium.operation-record-batch",
          count: envelopes.length,
          envelopes
        };
      } catch (error) {
        stateStore.discard();
        if (!ledgerCommitted) await cleanupPendingMarker(commitId);
        throw error;
      }
    });
  }

  async function recordOperationsStepwise(inputs = []) {
      const envelopes = [];
      for (const input of asArray(inputs)) {
        const intentEnvelope = await beginOperationIntentCommitted(input.intentAppendCondition
          ? { ...input, appendCondition: input.intentAppendCondition }
          : input);
        if (intentEnvelope.replayed && input.returnIntentReplay) {
          envelopes.push(intentEnvelope);
          continue;
        }
        envelopes.push(await appendOperationOutcomeCommitted({
          ...input,
          intentId: intentEnvelope.factId,
          appendCondition: input.outcomeAppendCondition || input.outcome?.appendCondition || null,
          extensions: asArray(input.outcomeExtensions || input.extensions)
        }));
      }
      return {
        protocol: PACTIUM_PROTOCOL,
        batchType: "pactium.operation-record-batch",
        count: envelopes.length,
        envelopes
      };
  }

  async function lookupOpenIntent(intentId) {
    const current = await prepareRead();
    const proof = await indexEngine.prove(current.indexRoots.openIntent, String(intentId || ""));
    const intentRecord = await loadIntentRecord(current, intentId);
    return {
      protocol: PACTIUM_PROTOCOL,
      intentId,
      exists: isMembershipProof(proof),
      proof,
      intent: intentRecord?.intent || null,
      ledgerEventId: intentRecord?.ledgerEventId || "",
      ledgerIndex: Number(intentRecord?.ledgerIndex || 0),
      factCid: intentRecord?.factCid || "",
      envelopeId: intentRecord?.intentEnvelopeId || ""
    };
  }

  async function lookupOutcome(intentId) {
    const current = await prepareRead();
    const proof = await indexEngine.prove(current.indexRoots.outcome, String(intentId || ""));
    const outcome = await loadOutcome(current, intentId);
    const locator = current.outcomeLocators[String(intentId || "")] || {};
    return {
      protocol: PACTIUM_PROTOCOL,
      intentId,
      exists: isMembershipProof(proof),
      proof,
      outcome,
      ledgerEventId: locator.ledgerEventId || "",
      ledgerIndex: Number(locator.ledgerIndex || 0),
      factCid: locator.factCid || "",
      envelopeId: locator.outcomeEnvelopeId || ""
    };
  }

  async function lookupReceipt(receiptId) {
    const current = await prepareRead();
    const key = String(receiptId || "");
    const proof = await indexEngine.prove(current.indexRoots.receipt, key);
    const receipt = await loadReceipt(current, key);
    const locator = current.receiptLocators[key] || {};
    return {
      protocol: PACTIUM_PROTOCOL,
      receiptId: key,
      exists: isMembershipProof(proof),
      proof,
      receipt,
      ledgerEventId: locator.ledgerEventId || "",
      ledgerIndex: Number(locator.ledgerIndex || 0),
      factCid: locator.factCid || "",
      envelopeId: locator.envelopeId || ""
    };
  }

  async function getWorkspaceProjection(workspaceId = "default", options = {}) {
    const current = await prepareRead();
    const workspace = await loadWorkspace(current, workspaceId);
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
    const workspace = await loadWorkspace(current, workspaceId);
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
    const workspace = await loadWorkspace(current, workspaceId);
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
    const defaultTrustPolicy = resolvedStorage.inMemory
      ? PACTIUM_TRUST_POLICIES.selfCarriedManifest
      : PACTIUM_TRUST_POLICIES.trustedManifestRequired;
    return verifyProofEnvelope(envelope, {
      storage: resolvedStorage,
      supportedCriticalExtensions: options.supportedCriticalExtensions || [],
      proofVerifiers: options.proofVerifiers || {},
      requireAllProofs: options.requireAllProofs !== false,
      verifierManifest: options.verifierManifest || null,
      trustedManifest: options.trustedManifest || null,
      ledgerHeadSignatures: options.ledgerHeadSignatures || [],
      trustPolicy: options.trustPolicy || defaultTrustPolicy,
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

  // Bundle export derives portable proof material from immutable CAS blocks
  // and the envelope registry. It never mutates runtime state, so it runs as
  // a read (still serialized behind in-flight mutations by prepareRead).
  async function exportProofBundle(envelopeOrId, options = {}) {
    const current = await prepareRead();
    const envelope = typeof envelopeOrId === "string"
      ? await resolveEnvelopeById(current, envelopeOrId)
      : envelopeOrId;
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
    return {
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
    await registerEnvelope(current, finalized, [
      ...asArray(finalized.proofRefs).map((ref) => ref.cid),
      ...asArray(finalized.extensions).map((extension) => extension.valueRef)
    ]);
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
        "operation-receipt",
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
    /* node:coverage ignore next 8 */
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

    // Verify residual commit markers. A finalized marker can remain only when
    // the process stopped between its final overwrite and best-effort delete;
    // every other residual phase is an incomplete mutation.
    try {
      const commitKeys = await resolvedStorage.listProtocolObjectKeys("commit");
      const pendingCommitIds = commitKeys
        .filter((k) => k.startsWith("pending-"))
        .map((k) => k.slice("pending-".length));
      for (const cid of pendingCommitIds) {
        const marker = await resolvedStorage.getProtocolObject("commit", `pending-${cid}`, null);
        if (marker?.phase !== "complete") {
          failures.push(createVerificationFailure({
            layer: "doctor",
            code: "incomplete_commit",
            message: `Pending mutation commit ${cid} did not reach its finalized state.`,
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
    const retainedRoots = await currentIndexRoots(current, stateStore);
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
        const runtimeWorkspaces = new Map(
          (await stateStore.list(stateStore.scopes.workspace))
            .map((record) => [record.logicalKey, record.value])
        );
        for (const [workspaceId, workspace] of Object.entries(asRecord(current.workspace))) {
          runtimeWorkspaces.set(workspaceId, workspace);
        }
        const mismatches = [];
        const runtimeRootLookup = (rootName) => {
          if (rootName === "openIntent") return current.indexRoots.openIntent || "";
          if (rootName === "outcome") return current.indexRoots.outcome || "";
          if (rootName === "intentIdempotency") return current.indexRoots.intentIdempotency || "";
          if (rootName === "outcomeIdempotency") return current.indexRoots.outcomeIdempotency || "";
          if (rootName === "receipt") return current.indexRoots.receipt || "";
          if (rootName === "causality") return current.indexRoots.causality || "";
          if (rootName.startsWith("workspace:")) {
            const parts = rootName.split(":");
            const wsId = parts[1];
            const field = parts.slice(2).join(":");
            const ws = runtimeWorkspaces.get(wsId);
            if (field === "orderRoot") return ws?.orderRoot || "";
            if (field === "membershipRoot") return ws?.membershipRoot || "";
            if (field === "checkpointRoot") return ws?.checkpointRoot || "";
            /* node:coverage ignore next 2 */
            if (field === "stateRoot") return ws?.stateRoot || "";
          }
          /* node:coverage ignore next 2 */
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

  async function compactStorage(options = {}) {
    const dryRun = options?.dryRun !== false;
    const reclaimPages = Number(options?.reclaimPages || 0);
    const result = await enqueueMutation(() => compactStorageCommitted({ dryRun }));
    if (
      !resolvedStorage.inMemory &&
      !dryRun &&
      reclaimPages > 0 &&
      typeof resolvedStorage.reclaimDatabasePages === "function"
    ) {
      return {
        ...result,
        pageReclamation: await resolvedStorage.reclaimDatabasePages({ pages: reclaimPages })
      };
    }
    return result;
  }

  async function compactStorageCommitted({ dryRun = true } = {}) {
    const current = await ensureState();
    const retainedRoots = await currentIndexRoots(current, stateStore);
    const cache = typeof indexEngine.pruneCache === "function"
      ? await indexEngine.pruneCache({ roots: retainedRoots })
      : { retainedRoots, retainedNodeRoots: retainedRoots };
    if (!resolvedStorage.inMemory) {
      const sweepKinds = new Set();
      for (const root of retainedRoots) {
        const block = await resolvedStorage.getBlock(root);
        const kind = String(block?.kind || "");
        if (kind.startsWith("index-node:")) sweepKinds.add(kind);
      }
      const garbageCollection = typeof resolvedStorage.collectGarbage === "function"
        ? await resolvedStorage.collectGarbage({
            roots: retainedRoots,
            sweepKinds: [...sweepKinds],
            dryRun: dryRun !== false
          })
        : { supported: false, dryRun: dryRun !== false, deleted: 0 };
      return {
        protocol: PACTIUM_PROTOCOL,
        inMemory: false,
        retainedRoots: retainedRoots.length,
        retainedNodeRoots: asArray(cache.retainedNodeRoots).length,
        prunedNodes: Number(cache.prunedNodes || 0),
        prunedRoots: Number(cache.prunedRoots || 0),
        prunedSnapshots: Number(cache.prunedSnapshots || 0),
        garbageCollection,
        pageReclamation: { supported: false, pagesRequested: 0 }
      };
    }
    const retainedNodeRoots = new Set(asArray(cache.retainedNodeRoots || retainedRoots).map(String));
    const prunedBlocks = typeof resolvedStorage.pruneBlocks === "function"
      ? resolvedStorage.pruneBlocks((block) => {
          const kind = String(block.kind || "");
          if (kind.startsWith("index-node:")) return !retainedNodeRoots.has(block.cid);
          // Only derived index nodes are currently sweepable. Ledger facts,
          // envelopes, proof material, extension values and state values are
          // immutable evidence roots even when they are not reachable from a
          // current index root.
          return false;
        })
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
      prunedProtocolObjects: 0
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

  function close() {
    if (mutationContext.getStore() === mutationContextToken) {
      return Promise.reject(reentrantCloseError());
    }
    if (lifecycleState === "closed") return Promise.resolve();
    if (closePromise) return closePromise;
    lifecycleState = "closing";
    const admittedCalls = [...activeCalls];
    closePromise = (async () => {
      await Promise.allSettled(admittedCalls);
      await mutationLane.catch(() => null);
      state = null;
      if (ownsStorage) await resolvedStorage.close?.();
      lifecycleState = "closed";
    })().catch((error) => {
      closePromise = null;
      throw error;
    });
    return closePromise;
  }

  const core = Object.freeze({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    dataDir: resolvedStorage.dataDir,
    beginOperationIntent: guardAsync(beginOperationIntent),
    appendOperationOutcome: guardAsync(appendOperationOutcome),
    recordOperationReceipt: guardAsync(recordOperationReceipt),
    recordOperation: guardAsync(recordOperation),
    recordOperations: guardAsync(recordOperations),
    lookupOpenIntent: guardAsync(lookupOpenIntent),
    lookupOutcome: guardAsync(lookupOutcome),
    lookupReceipt: guardAsync(lookupReceipt),
    createAppendCondition: guardSync(createAppendCondition),
    getLedgerCursor: guardAsync(getLedgerCursor),
    getWorkspaceCursor: guardAsync(getWorkspaceCursor),
    verifyCursor: guardSync(verifyCursor),
    advanceTrustedHead: guardSync(advanceTrustedHead),
    planRecovery: guardSync(planRecovery),
    getWorkspaceProjection: guardAsync(getWorkspaceProjection),
    proveWorkspaceMembership: guardAsync(proveWorkspaceMembership),
    verifyEnvelope: guardAsync(verifyEnvelope),
    exportProofBundle: guardAsync(exportProofBundle),
    createExtension: guardAsync(createExtension),
    storeEnvelope: guardAsync(storeEnvelope),
    protocolCatalog: guardAsync(protocolCatalog),
    doctor: guardAsync(doctor),
    compactStorage: guardAsync(compactStorage),
    // Read-only protocol resolvers for storage, ledger, and index data.
    // These return canonical clones — safe for external consumption.
    resolveBlock: guardAsync(resolveBlock),
    hasBlock: guardAsync(hasBlock),
    readLedgerHead: guardAsync(readLedgerHead),
    readLedgerLeaf: guardAsync(readLedgerLeaf),
    readProtocolObject: guardAsync(readProtocolObject),
    listProtocolObjectKeys: guardAsync(listProtocolObjectKeys),
    withMutationTransaction: guardAsync(withMutationTransaction),
    close
  });
  pactiumInternals.set(core, Object.freeze({
    storage: resolvedStorage,
    ledger,
    indexEngine,
    stateStore
  }));
  return core;
}
