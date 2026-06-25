import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPactium } from "../../src/index.js";
import { createStoragePort } from "../../src/storage/local-json-storage-port.js";
import { createLedgerTransparencyLog } from "../../src/ledger/transparency-log.js";
import { rebuildCoreStateFromLedger } from "../../src/core/rebuild-state.js";

describe("Pactium rebuild-state coverage — legacy data and edge case paths", () => {
  it("rebuild fires intent_idempotency_rebuild_incomplete for old-style intent without inputHash", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = pactium.advanced.ledger;

    await ledger.append({
      factType: "operation.intent",
      intentId: "old-intent-no-hash",
      workspaceId: "default",
      operationId: "old-op-1",
      idempotencyKey: "old-key-1",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    assert.ok(Array.isArray(result.warnings), "warnings should be an array");
    const codes = result.warnings.map((w) => w.code);
    assert.ok(codes.includes("intent_idempotency_rebuild_incomplete"),
      `expected intent_idempotency_rebuild_incomplete, got ${codes.join(", ")}`);
    // Intent-only: no outcome means no state mutations processed
    // The idempotency root is excluded from partiallyComparableRoots
    // because intentIdempotencyRebuildIncomplete was set.
  });

  it("rebuild fires outcome_idempotency_rebuild_incomplete for old-style outcome without resultHash", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = pactium.advanced.ledger;

    await ledger.append({
      factType: "operation.intent",
      intentId: "old-intent-for-outcome",
      workspaceId: "default",
      operationId: "old-op-outcome",
      idempotencyKey: "old-outcome-key",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    await ledger.append({
      factType: "operation.outcome",
      outcomeId: "old-outcome-no-hash",
      intentId: "old-intent-for-outcome",
      workspaceId: "default",
      operationId: "old-op-outcome",
      status: "succeeded",
      outcomeIdempotencyKey: "old-outcome-specific-key",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    const codes = result.warnings.map((w) => w.code);
    assert.ok(codes.includes("outcome_idempotency_rebuild_incomplete"),
      `expected outcome_idempotency_rebuild_incomplete, got ${codes.join(", ")}`);
    // When rebuild is incomplete, the root is excluded from partiallyComparableRoots
    assert.equal(result.stateRebuildIncomplete, true,
      "state rebuild should be marked incomplete");
  });

  it("rebuild processes causality refs on intent and outcome facts", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = pactium.advanced.ledger;

    await ledger.append({
      factType: "operation.intent",
      intentId: "intent-with-causality",
      workspaceId: "default",
      operationId: "causal-op",
      idempotencyKey: "causal-key",
      inputHash: "sha256:abcd1234",
      causalityRefs: ["ref:cause-1", "ref:cause-2"],
      createdAt: new Date().toISOString()
    });

    await ledger.append({
      factType: "operation.outcome",
      outcomeId: "outcome-with-causality",
      intentId: "intent-with-causality",
      workspaceId: "default",
      operationId: "causal-op",
      status: "succeeded",
      resultHash: "sha256:efgh5678",
      outcomeIdempotencyKey: "causal-outcome-key",
      causalityRefs: ["ref:cause-3"],
      createdAt: new Date().toISOString()
    });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    const fcrKeys = Object.keys(result.fullyComparableRoots);
    assert.ok(fcrKeys.some(r => r.includes("causality")),
      `causality root should be in fullyComparableRoots, got ${fcrKeys.join(", ")}`);
  });

  it("rebuild processes outcome with outcomeIdempotencyKey and full material", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = pactium.advanced.ledger;

    await ledger.append({
      factType: "operation.intent",
      intentId: "intent-full-material",
      workspaceId: "default",
      operationId: "full-material-op",
      idempotencyKey: "full-key",
      inputHash: "sha256:intent123",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    await ledger.append({
      factType: "operation.outcome",
      outcomeId: "outcome-full-material",
      intentId: "intent-full-material",
      workspaceId: "default",
      operationId: "full-material-op",
      status: "succeeded",
      resultHash: "sha256:outcome456",
      outcomeIdempotencyKey: "full-outcome-key",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    const allKeys = [...Object.keys(result.fullyComparableRoots), ...Object.keys(result.partiallyComparableRoots)];
    assert.ok(allKeys.some(r => r.includes("outcomeIdempotency")),
      `outcome idempotency should appear in comparable roots, got ${allKeys.join(", ")}`);
  });

  it("rebuild processes multi-workspace checkpoint initialization", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = pactium.advanced.ledger;

    for (const wsId of ["ws-alpha", "ws-beta"]) {
      const intentId = `intent-${wsId}`;
      await ledger.append({
        factType: "operation.intent",
        intentId, workspaceId: wsId, operationId: `op-${wsId}`,
        idempotencyKey: `key-${wsId}`, inputHash: `sha256:${wsId}`,
        causalityRefs: [], createdAt: new Date().toISOString()
      });
      await ledger.append({
        factType: "operation.outcome",
        outcomeId: `outcome-${wsId}`, intentId, workspaceId: wsId,
        operationId: `op-${wsId}`, status: "succeeded",
        resultHash: `sha256:out-${wsId}`, outcomeIdempotencyKey: `out-key-${wsId}`,
        causalityRefs: [], createdAt: new Date().toISOString()
      });
    }

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    assert.ok(result.state, "rebuild should produce state");
    assert.ok(Object.keys(result.fullyComparableRoots).length > 0, "should have comparable roots");
  });

  it("rebuild handles empty ledger (no entries)", async () => {
    const storage = createStoragePort({ inMemory: true });
    const ledger = createLedgerTransparencyLog({ storage, signer: false });
    const pactium = createPactium({ inMemory: true });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    assert.ok(result.state, "rebuild should produce state even for empty ledger");
    assert.equal(result.warnings.length, 0, "empty ledger should have no warnings");
  });

  it("rebuild identifies skippedRoots for stateRoot", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = pactium.advanced.ledger;

    await ledger.append({
      factType: "operation.intent",
      intentId: "intent-skip-test",
      workspaceId: "default",
      operationId: "skip-test-op",
      idempotencyKey: "skip-key",
      inputHash: "sha256:skip",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    await ledger.append({
      factType: "operation.outcome",
      outcomeId: "outcome-skip-test",
      intentId: "intent-skip-test",
      workspaceId: "default",
      operationId: "skip-test-op",
      status: "succeeded",
      resultHash: "sha256:skip-out",
      outcomeIdempotencyKey: "skip-out-key",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    const srKeys = Object.keys(result.skippedRoots);
    assert.ok(srKeys.some(r => r.includes("stateRoot")),
      `stateRoot should be in skippedRoots, got ${srKeys.join(", ")}`);
  });

  it("doctor rebuild detects orphan outcome (outcome referencing missing intent)", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = pactium.advanced.ledger;

    await ledger.append({
      factType: "operation.outcome",
      outcomeId: "orphan-outcome",
      intentId: "missing-intent-id",
      workspaceId: "default",
      operationId: "orphan-op",
      status: "succeeded",
      resultHash: "sha256:orphan",
      outcomeIdempotencyKey: "orphan-key",
      causalityRefs: [],
      createdAt: new Date().toISOString()
    });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: pactium.advanced.indexEngine, storage: null
    });

    const codes = result.warnings.map((w) => w.code);
    assert.ok(codes.includes("orphan_outcome"),
      `expected orphan_outcome warning, got ${codes.join(", ")}`);
  });
});
