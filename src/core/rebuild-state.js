import { createId, protocolHash } from "../protocol/hashing.js";
import { asArray, safeText } from "../shared/records.js";
import { createVerificationFailure } from "../verification/failure.js";
import {
  createEmptyCoreState,
  eventRefValue,
  lifecycleValueRef,
  padOrdinal,
  workspaceStateFor
} from "./state-helpers.js";

// Replays ledger leaves to reconstruct derived runtime state.
// Only reconstructs information that exists in ledger facts.
// State mutation descriptors are NOT stored in ledger facts (they live in
// proof material's stateCommit), so stateRoot rebuild is marked incomplete
// unless proof material is resolvable.

/**
 * Rebuilds derived runtime state from ledger leaves.
 *
 * Returns:
 *   { state, warnings, fullyComparableRoots, partiallyComparableRoots, skippedRoots }
 *
 * Root categories:
 * - fullyComparableRoots: ledger facts are complete, strict comparison expected.
 *   Includes: openIntent, outcome, causality, workspace order/membership/checkpoint.
 * - partiallyComparableRoots: may need material not in all ledger facts.
 *   Includes: intentIdempotency (needs inputHash from intent fact),
 *   outcomeIdempotency (needs outcomeIdempotencyKey from outcome fact).
 *   Mismatches here produce *_rebuild_incomplete warnings, not hard failures.
 * - skippedRoots: cannot be reliably rebuilt from ledger facts alone.
 *   Includes: stateRoot (state mutations in proof material, not ledger facts),
 *   checkpoint stateCommitId (state commit not in ledger facts).
 *
 * Limitations:
 * - State mutation descriptors live in proof material, not in ledger facts.
 * - Envelope and bundle data are not stored in ledger facts and are not rebuilt.
 * - This is a diagnostic/repair tool, not a full hot-recovery path.
 */
export async function rebuildCoreStateFromLedger({
  ledger,
  indexEngine,
  storage = null
}) {
  const state = createEmptyCoreState();
  const warnings = [];
  const rootMutations = {
    openIntent: { domain: "open-intent", mutations: [] },
    outcome: { domain: "outcome", mutations: [] },
    intentIdempotency: { domain: "intent-idempotency", mutations: [] },
    outcomeIdempotency: { domain: "outcome-idempotency", mutations: [] },
    receipt: { domain: "operation-receipt", mutations: [] },
    causality: { domain: "operation-causality", mutations: [] }
  };
  const workspaceMutations = new Map();
  let stateRebuildIncomplete = false;

  const head = await ledger.head();
  const size = Number(head.size || 0);
  const pageSize = 1000;

  function mutationForPut(key, value) {
    return {
      action: "put",
      key,
      valueRef: value.valueRef,
      valueHash: value.valueHash,
      metadata: value.metadata
    };
  }

  function queueRootPut(rootName, key, value) {
    rootMutations[rootName].mutations.push(mutationForPut(key, value));
  }

  function queueRootDelete(rootName, key) {
    rootMutations[rootName].mutations.push({ action: "delete", key });
  }

  function mutationsForWorkspace(workspaceId) {
    const key = safeText(workspaceId, "default");
    if (!workspaceMutations.has(key)) {
      workspaceMutations.set(key, {
        order: { domain: "workspace-order", mutations: [] },
        membership: { domain: "workspace-membership", mutations: [] },
        checkpoint: { domain: "checkpoint", mutations: [] }
      });
    }
    return workspaceMutations.get(key);
  }

  async function applyBatch(root, bucket) {
    if (bucket.mutations.length === 0) return root;
    return (await indexEngine.mutate(root, bucket.mutations, { domain: bucket.domain })).root;
  }

  for (let start = 0; start < size; start += pageSize) {
    const page = await ledger.pageEntries({ start, limit: pageSize });
    for (const entry of page.entries) {
      const fact = entry.fact;
      if (!fact) continue;

      const workspaceId = safeText(fact.workspaceId, "default");
      if (fact.factType === "operation.receipt") {
        queueRootPut("receipt", fact.receiptId, eventRefValue({ entry }));
        continue;
      }
      const workspace = workspaceStateFor(state, workspaceId);

      if (fact.factType === "operation.intent") {
        // Replay intent
        state.intents[fact.intentId] = {
          intent: fact,
          ledgerEventId: entry.eventId,
          open: false // will be set to true, then false when outcome seen
        };
        queueRootPut("openIntent", fact.intentId, eventRefValue({ entry }));

        const idKey = safeText(fact.idempotencyReplayKey);
        if (idKey) {
          queueRootPut("intentIdempotency", idKey, lifecycleValueRef(fact.intentId, { intentId: fact.intentId }));
        }
        const claimKey = safeText(fact.idempotencyClaimKey);
        if (claimKey) {
          state.intentIdempotencyClaims[claimKey] = {
            inputHash: fact.inputHash,
            envelopeId: ""
          };
        }

        // Causality
        for (const ref of asArray(fact.causalityRefs)) {
          queueRootPut(
            "causality",
            `${ref}\u0000${fact.intentId}`,
            lifecycleValueRef(fact.intentId, { from: ref, to: fact.intentId, relation: "causes" })
          );
        }

        // Workspace projection
        const ordinal = workspace.nextOrdinal;
        workspace.nextOrdinal += 1;
        const orderKey = padOrdinal(ordinal);
        const workspaceBuckets = mutationsForWorkspace(workspaceId);
        workspaceBuckets.order.mutations.push(mutationForPut(orderKey, eventRefValue({ entry })));
        workspaceBuckets.membership.mutations.push(mutationForPut(
          entry.eventId,
          lifecycleValueRef(orderKey, { workspaceId, ordinal })
        ));

        // Checkpoint intent node
        const cpNodeId = createId("checkpoint_node", { intentId: fact.intentId, kind: "intent" });
        const cpNode = {
          checkpointNodeId: cpNodeId,
          checkpointKind: "intent",
          parentId: "",
          intentId: fact.intentId,
          ledgerEventId: entry.eventId,
          workspaceId
        };
        if (!Object.hasOwn(state.checkpointEntries, workspaceId)) {
          state.checkpointEntries[workspaceId] = Object.create(null);
        }
        state.checkpointEntries[workspaceId][cpNodeId] = cpNode;
        workspaceBuckets.checkpoint.mutations.push(mutationForPut(cpNodeId, {
          valueRef: `ref:${cpNodeId}`,
          valueHash: protocolHash("checkpoint.node", cpNode),
          metadata: cpNode
        }));

        state.intents[fact.intentId].open = true;

      } else if (fact.factType === "operation.outcome") {
        const intentId = safeText(fact.intentId);
        const intentRecord = state.intents[intentId];
        if (!intentRecord) {
          warnings.push(createVerificationFailure({
            layer: "rebuild",
            code: "orphan_outcome",
            message: `Outcome ${fact.outcomeId} references missing intent ${intentId}.`,
            evidenceRef: fact.outcomeId,
            repairable: true
          }));
        }

        // Close intent
        state.outcomes[intentId] = fact;
        if (intentRecord) intentRecord.open = false;

        // Open-intent delete
        queueRootDelete("openIntent", intentId);

        // Outcome put
        queueRootPut("outcome", intentId, eventRefValue({ entry }));

        // Outcome idempotency
        const outcomeIdKey = safeText(fact.outcomeIdempotencyReplayKey);
        if (outcomeIdKey) {
          queueRootPut("outcomeIdempotency", outcomeIdKey, lifecycleValueRef(fact.outcomeId, { outcomeId: fact.outcomeId }));
        }

        // Causality
        for (const ref of asArray(fact.causalityRefs)) {
          queueRootPut(
            "causality",
            `${ref}\u0000${fact.outcomeId}`,
            lifecycleValueRef(fact.outcomeId, { from: ref, to: fact.outcomeId, relation: "causes" })
          );
        }

        // Workspace projection
        const ordinal = workspace.nextOrdinal;
        workspace.nextOrdinal += 1;
        const orderKey = padOrdinal(ordinal);
        const workspaceBuckets = mutationsForWorkspace(workspaceId);
        workspaceBuckets.order.mutations.push(mutationForPut(orderKey, eventRefValue({ entry })));
        workspaceBuckets.membership.mutations.push(mutationForPut(
          entry.eventId,
          lifecycleValueRef(orderKey, { workspaceId, ordinal })
        ));

        // State commit: ledger fact does NOT contain state mutations.
        // State root reconstruction requires proof material.
        stateRebuildIncomplete = true;

        // Checkpoint outcome node
        const outcomeCpNodeId = createId("checkpoint_node", { outcomeId: fact.outcomeId, kind: "outcome" });
        const outcomeCpNode = {
          checkpointNodeId: outcomeCpNodeId,
          checkpointKind: "outcome",
          parentId: intentId ? createId("checkpoint_node", { intentId, kind: "intent" }) : "",
          intentId,
          outcomeId: fact.outcomeId,
          stateCommitId: "", // state commit not in ledger fact
          workspaceId,
          ledgerEventId: entry.eventId
        };
        if (!Object.hasOwn(state.checkpointEntries, workspaceId)) {
          state.checkpointEntries[workspaceId] = Object.create(null);
        }
        state.checkpointEntries[workspaceId][outcomeCpNodeId] = outcomeCpNode;
        workspaceBuckets.checkpoint.mutations.push(mutationForPut(outcomeCpNodeId, {
          valueRef: `ref:${outcomeCpNodeId}`,
          valueHash: protocolHash("checkpoint.node", outcomeCpNode),
          metadata: outcomeCpNode
        }));
      }
    }
    if (page.entries.length === 0 || page.nextPosition <= start) break;
  }

  state.indexRoots.openIntent = await applyBatch(state.indexRoots.openIntent, rootMutations.openIntent);
  state.indexRoots.outcome = await applyBatch(state.indexRoots.outcome, rootMutations.outcome);
  state.indexRoots.intentIdempotency = await applyBatch(state.indexRoots.intentIdempotency, rootMutations.intentIdempotency);
  state.indexRoots.outcomeIdempotency = await applyBatch(state.indexRoots.outcomeIdempotency, rootMutations.outcomeIdempotency);
  state.indexRoots.receipt = await applyBatch(state.indexRoots.receipt, rootMutations.receipt);
  state.indexRoots.causality = await applyBatch(state.indexRoots.causality, rootMutations.causality);
  for (const [workspaceId, buckets] of workspaceMutations) {
    const workspace = workspaceStateFor(state, workspaceId);
    workspace.orderRoot = await applyBatch(workspace.orderRoot, buckets.order);
    workspace.membershipRoot = await applyBatch(workspace.membershipRoot, buckets.membership);
    workspace.checkpointRoot = await applyBatch(workspace.checkpointRoot, buckets.checkpoint);
  }

  // Categorize roots by rebuild confidence:
  //
  // fullyComparableRoots: ledger facts contain everything needed.
  //   Mismatch here IS a hard derived_root_mismatch.
  const fullyComparableRoots = {
    openIntent: state.indexRoots.openIntent,
    outcome: state.indexRoots.outcome,
    receipt: state.indexRoots.receipt,
    causality: state.indexRoots.causality
  };

  // partiallyComparableRoots: batch reconstruction can choose different
  // Prolly boundaries than the incremental hot path while representing the
  // same entries.
  //   Mismatch here produces a *_rebuild_incomplete warning, not a hard failure.
  const partiallyComparableRoots = {
    intentIdempotency: state.indexRoots.intentIdempotency,
    outcomeIdempotency: state.indexRoots.outcomeIdempotency
  };

  // skippedRoots: cannot be reliably rebuilt from ledger facts alone.
  const skippedRoots = {};

  for (const [wsId, ws] of Object.entries(Object(state.workspace))) {
    fullyComparableRoots[`workspace:${wsId}:orderRoot`] = ws.orderRoot;
    fullyComparableRoots[`workspace:${wsId}:membershipRoot`] = ws.membershipRoot;
    // checkpointRoot is partially comparable: Prolly tree boundary placement
    // can differ subtly between incremental (runtime) and batch (rebuild) construction.
    partiallyComparableRoots[`workspace:${wsId}:checkpointRoot`] = ws.checkpointRoot;
    // stateRoot is skipped — state mutations are not in ledger facts
    skippedRoots[`workspace:${wsId}:stateRoot`] = {
      reason: "State mutations are stored in proof material, not in ledger facts.",
      code: "state_rebuild_incomplete"
    };
  }

  // Flat map used by the doctor report summary.
  const comparableRoots = {
    ...fullyComparableRoots,
    ...partiallyComparableRoots
  };
  // Add skipped roots with empty values so callers know they exist
  for (const [key, info] of Object.entries(skippedRoots)) {
    comparableRoots[key] = "";
  }

  return {
    state,
    warnings,
    comparableRoots,
    fullyComparableRoots,
    partiallyComparableRoots,
    skippedRoots,
    stateRebuildIncomplete
  };
}
