import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPactium } from "../../src/index.js";
import { getPactiumInternals } from "../../src/core/pactium-core.js";
import { createJsonStoragePort as createStoragePort } from "../../src/storage/local-json-storage-port.js";
import { createLedgerTransparencyLog } from "../../src/ledger/transparency-log.js";
import { rebuildCoreStateFromLedger } from "../../src/core/rebuild-state.js";

describe("Pactium rebuild-state coverage — minimal fact and edge case paths", () => {
  it("does not synthesize removed intent idempotency material", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = getPactiumInternals(pactium).ledger;

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
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    assert.deepEqual(result.warnings, []);
    assert.equal(result.state.indexRoots.intentIdempotency, "",
      "current-schema rebuild requires the fact's explicit idempotencyReplayKey");
  });

  it("does not synthesize removed outcome idempotency material", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = getPactiumInternals(pactium).ledger;

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
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    assert.equal(result.state.indexRoots.outcomeIdempotency, "",
      "current-schema rebuild requires the fact's explicit outcomeIdempotencyReplayKey");
    assert.equal(result.stateRebuildIncomplete, true,
      "state rebuild should be marked incomplete");
  });

  it("rebuild processes causality refs on intent and outcome facts", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = getPactiumInternals(pactium).ledger;

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
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    const fcrKeys = Object.keys(result.fullyComparableRoots);
    assert.ok(fcrKeys.some(r => r.includes("causality")),
      `causality root should be in fullyComparableRoots, got ${fcrKeys.join(", ")}`);
  });

  it("rebuild processes outcome with outcomeIdempotencyKey and full material", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = getPactiumInternals(pactium).ledger;

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
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    const allKeys = [...Object.keys(result.fullyComparableRoots), ...Object.keys(result.partiallyComparableRoots)];
    assert.ok(allKeys.some(r => r.includes("outcomeIdempotency")),
      `outcome idempotency should appear in comparable roots, got ${allKeys.join(", ")}`);
  });

  it("rebuild processes multi-workspace checkpoint initialization", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = getPactiumInternals(pactium).ledger;

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
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    assert.ok(result.state, "rebuild should produce state");
    assert.ok(Object.keys(result.fullyComparableRoots).length > 0, "should have comparable roots");
  });

  it("rebuild handles empty ledger (no entries)", async () => {
    const storage = createStoragePort({ inMemory: true });
    const ledger = createLedgerTransparencyLog({ storage, signer: false });
    const pactium = createPactium({ inMemory: true });

    const result = await rebuildCoreStateFromLedger({
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    assert.ok(result.state, "rebuild should produce state even for empty ledger");
    assert.equal(result.warnings.length, 0, "empty ledger should have no warnings");
  });

  it("rebuild stops on empty or stalled ledger pages without inventing state", async () => {
    const pactium = createPactium({ inMemory: true });
    const emptyPageLedger = {
      async head() {
        return { size: 2 };
      },
      async pageEntries() {
        return { entries: [], nextPosition: 0 };
      }
    };
    const emptyPageResult = await rebuildCoreStateFromLedger({
      ledger: emptyPageLedger,
      indexEngine: getPactiumInternals(pactium).indexEngine,
      storage: null
    });
    assert.deepEqual(Object.keys(emptyPageResult.fullyComparableRoots), ["openIntent", "outcome", "receipt", "causality"]);
    assert.equal(emptyPageResult.warnings.length, 0);

    let pageCalls = 0;
    const nullFactLedger = {
      async head() {
        return { size: 2 };
      },
      async pageEntries() {
        pageCalls += 1;
        return {
          entries: [{ fact: null }],
          nextPosition: 0
        };
      }
    };
    const nullFactResult = await rebuildCoreStateFromLedger({
      ledger: nullFactLedger,
      indexEngine: getPactiumInternals(pactium).indexEngine,
      storage: null
    });
    assert.equal(pageCalls, 1);
    assert.equal(nullFactResult.warnings.length, 0);
  });

  it("rebuild identifies skippedRoots for stateRoot", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = getPactiumInternals(pactium).ledger;

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
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    const srKeys = Object.keys(result.skippedRoots);
    assert.ok(srKeys.some(r => r.includes("stateRoot")),
      `stateRoot should be in skippedRoots, got ${srKeys.join(", ")}`);
  });

  it("doctor rebuild detects orphan outcome (outcome referencing missing intent)", async () => {
    const pactium = createPactium({ inMemory: true });
    const ledger = getPactiumInternals(pactium).ledger;

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
      ledger, indexEngine: getPactiumInternals(pactium).indexEngine, storage: null
    });

    const codes = result.warnings.map((w) => w.code);
    assert.ok(codes.includes("orphan_outcome"),
      `expected orphan_outcome warning, got ${codes.join(", ")}`);
  });
});
