import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createPactium, createStoragePort } from "../../src/index.js";
import { getPactiumInternals } from "../../src/core/pactium-core.js";
import { createCoreStateStore } from "../../src/core/state-store.js";

async function temporaryDataDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("normalized Pactium runtime state", () => {
  it("publishes a fixed-size manifest and domain-separated records", async () => {
    const pactium = createPactium({ inMemory: true });
    for (let index = 0; index < 12; index += 1) {
      await pactium.recordOperation({
        operationId: `normalized-${index}`,
        workspaceId: `workspace-${index % 2}`,
        idempotencyKey: `intent-${index}`,
        outcomeIdempotencyKey: `outcome-${index}`,
        input: { index },
        result: { index }
      });
    }

    const manifest = await pactium.readProtocolObject("core", "runtime-state");
    assert.deepEqual(Object.keys(manifest).sort(), [
      "gcEpoch",
      "generation",
      "indexRoots",
      "layoutVersion",
      "protocol",
      "schema",
      "stateType"
    ]);
    assert.equal(manifest.stateType, "pactium.runtime-manifest");
    assert.equal(manifest.layoutVersion, 2);
    assert.equal(Object.hasOwn(manifest, "intents"), false);
    assert.equal(Object.hasOwn(manifest, "outcomes"), false);
    assert.equal(Object.hasOwn(manifest, "envelopes"), false);

    const internals = getPactiumInternals(pactium);
    assert.equal((await internals.storage.listProtocolObjectKeys("core-intent")).length, 24);
    assert.equal((await internals.storage.listProtocolObjectKeys("core-outcome")).length, 12);
    assert.equal((await internals.storage.listProtocolObjectKeys("core-workspace")).length, 4);
  });

  it("publishes runtime state once per lifecycle phase and registers each final envelope once", async () => {
    const base = createStoragePort({ inMemory: true });
    let manifestWrites = 0;
    let envelopeBlockWrites = 0;
    const counted = {
      ...base,
      async putProtocolObject(scope, key, value) {
        if (scope === "core" && key === "runtime-state") manifestWrites += 1;
        return base.putProtocolObject(scope, key, value);
      },
      async putBlock(value, options) {
        if (options?.kind === "proof-envelope") envelopeBlockWrites += 1;
        return base.putBlock(value, options);
      }
    };
    const pactium = createPactium({ storage: counted });
    let hookCalls = 0;
    const preliminaryEnvelopeIds = [];
    const envelope = await pactium.recordOperation({
      operationId: "single-publication",
      workspaceId: "normalized",
      finalizeEnvelopeExtensions: async (preliminaryEnvelope) => {
        hookCalls += 1;
        preliminaryEnvelopeIds.push(preliminaryEnvelope.envelopeId);
        return {
          name: "test.finalized",
          value: { preliminaryEnvelopeId: preliminaryEnvelope.envelopeId }
        };
      }
    });

    assert.equal(manifestWrites, 2);
    assert.equal(envelopeBlockWrites, 2);
    assert.equal(hookCalls, 2);
    assert.equal(envelope.extensions.some((extension) => extension.name === "test.finalized"), true);
    assert.notEqual(envelope.envelopeId, preliminaryEnvelopeIds.at(-1));
  });

  it("keeps steady-state write calls within profile budgets", async () => {
    const base = createStoragePort({ inMemory: true });
    const calls = { putBlock: 0, putProtocolObject: 0 };
    const counted = {
      ...base,
      async putBlock(...args) {
        calls.putBlock += 1;
        return base.putBlock(...args);
      },
      async putProtocolObject(...args) {
        calls.putProtocolObject += 1;
        return base.putProtocolObject(...args);
      }
    };
    const pactium = createPactium({ storage: counted });
    const reset = () => {
      calls.putBlock = 0;
      calls.putProtocolObject = 0;
    };
    const snapshot = () => ({ ...calls });

    await pactium.recordOperation({
      operationId: "write-budget-warmup",
      workspaceId: "write-budget",
      idempotencyKey: "warmup",
      outcomeIdempotencyKey: "warmup-outcome"
    });

    reset();
    await pactium.recordOperation({
      operationId: "write-budget-full",
      workspaceId: "write-budget",
      idempotencyKey: "full",
      outcomeIdempotencyKey: "full-outcome"
    });
    const full = snapshot();
    assert.ok(full.putBlock > 0 && full.putBlock <= 19);
    assert.ok(full.putProtocolObject > 0 && full.putProtocolObject <= 28);

    reset();
    await pactium.recordOperationReceipt({
      operationId: "write-budget-receipt",
      workspaceId: "write-budget",
      profile: "receipt",
      idempotencyKey: "receipt"
    });
    const receipt = snapshot();
    assert.ok(receipt.putBlock > 0 && receipt.putBlock <= 6);
    assert.ok(receipt.putProtocolObject > 0 && receipt.putProtocolObject <= 11);

    reset();
    await pactium.recordOperationReceipt({
      operationId: "write-budget-on-change",
      workspaceId: "write-budget",
      profile: "on-change",
      changeKey: "console-state",
      change: { revision: 1 },
      idempotencyKey: "change-1"
    });
    const changed = snapshot();
    assert.ok(changed.putBlock > 0 && changed.putBlock <= 5);
    assert.ok(changed.putProtocolObject > 0 && changed.putProtocolObject <= 13);

    reset();
    await pactium.recordOperationReceipt({
      operationId: "write-budget-on-change",
      workspaceId: "write-budget",
      profile: "on-change",
      changeKey: "console-state",
      change: { revision: 1 },
      idempotencyKey: "change-2"
    });
    assert.deepEqual(snapshot(), { putBlock: 0, putProtocolObject: 0 });
  });

  it("restores lookup locators and idempotent replay without loading aggregate maps", async () => {
    const dataDir = await temporaryDataDir("pactium-normalized-restart-");
    const first = createPactium({ dataDir, storageBackend: "json" });
    const firstEnvelope = await first.recordOperation({
      operationId: "restart-normalized",
      workspaceId: "restart-workspace",
      idempotencyKey: "restart-intent",
      outcomeIdempotencyKey: "restart-outcome",
      input: { stable: true },
      result: { stable: true }
    });
    const firstReceipt = await first.recordOperationReceipt({
      operationId: "restart-receipt",
      workspaceId: "restart-workspace",
      profile: "receipt",
      idempotencyKey: "restart-receipt-id"
    });
    const intentId = firstEnvelope.factRef ? firstEnvelope.factId : "";
    await first.close();

    const second = createPactium({ dataDir, storageBackend: "json" });
    const outcomeLookup = await second.lookupOutcome(intentId);
    assert.equal(outcomeLookup.exists, true);
    assert.equal(outcomeLookup.outcome?.intentId, intentId);
    assert.ok(outcomeLookup.ledgerEventId);
    assert.ok(outcomeLookup.factCid);
    assert.ok(outcomeLookup.envelopeId);
    const receiptLookup = await second.lookupReceipt(firstReceipt.factId);
    assert.equal(receiptLookup.exists, true);
    assert.equal(receiptLookup.receipt?.receiptId, firstReceipt.factId);
    assert.equal(receiptLookup.envelopeId, firstReceipt.envelopeId);
    const replay = await second.recordOperation({
      operationId: "restart-normalized",
      workspaceId: "restart-workspace",
      idempotencyKey: "restart-intent",
      outcomeIdempotencyKey: "restart-outcome",
      input: { stable: true },
      result: { stable: true }
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.envelopeId, firstEnvelope.envelopeId);
    await second.close();
  });

  it("records one terminal receipt and makes on-change suppression write-free", async () => {
    const base = createStoragePort({ inMemory: true });
    let writes = 0;
    let hookCalls = 0;
    const counted = {
      ...base,
      async putProtocolObject(...args) {
        writes += 1;
        return base.putProtocolObject(...args);
      },
      async putBlock(...args) {
        writes += 1;
        return base.putBlock(...args);
      }
    };
    const pactium = createPactium({ storage: counted });
    const receiptInput = {
      operationId: "receipt-only-read",
      workspaceId: "receipt-workspace",
      profile: "on-change",
      changeKey: "console-state",
      change: { revision: 1 },
      finalizeEnvelopeExtensions: async (preliminaryEnvelope) => {
        hookCalls += 1;
        return {
          name: "test.receipt-signature",
          value: { signedEnvelopeId: preliminaryEnvelope.envelopeId }
        };
      }
    };
    const recorded = await pactium.recordOperationReceipt({ ...receiptInput, idempotencyKey: "receipt-1" });
    assert.equal(recorded.disposition, "recorded");
    assert.equal((await pactium.verifyEnvelope(recorded)).ok, true);
    assert.equal((await pactium.getLedgerCursor()).head.size, 1);
    const writesAfterRecorded = writes;

    const unchanged = await pactium.recordOperationReceipt({ ...receiptInput, idempotencyKey: "receipt-2" });
    assert.equal(unchanged.disposition, "unchanged");
    assert.equal(unchanged.envelopeId, recorded.envelopeId);
    assert.equal(writes, writesAfterRecorded);
    assert.equal(hookCalls, 1);

    const replayed = await pactium.recordOperationReceipt({ ...receiptInput, idempotencyKey: "receipt-1" });
    assert.equal(replayed.disposition, "replayed");
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.envelopeId, recorded.envelopeId);
    assert.equal(writes, writesAfterRecorded);

    const changed = await pactium.recordOperationReceipt({
      ...receiptInput,
      idempotencyKey: "receipt-3",
      change: { revision: 2 }
    });
    assert.equal(changed.disposition, "recorded");
    assert.equal((await pactium.getLedgerCursor()).head.size, 2);
    assert.equal(hookCalls, 2);
    const lookup = await pactium.lookupReceipt(recorded.factId);
    assert.equal(lookup.exists, true);
    assert.equal(lookup.envelopeId, recorded.envelopeId);

    await assert.rejects(() => pactium.recordOperationReceipt({
      ...receiptInput,
      idempotencyKey: "receipt-state-mutation",
      stateMutations: [{ key: "forbidden", value: true }]
    }), /does not accept stateMutations/);
    await assert.rejects(() => pactium.recordOperationReceipt({
      operationId: "receipt-invalid-profile",
      profile: "removed-profile"
    }), /Unsupported Operation Receipt profile/);
    await assert.rejects(
      () => pactium.withMutationTransaction(null),
      /requires a task function/
    );
  });

  it("ignores an unpublished future record slot", async () => {
    const base = createStoragePort({ inMemory: true });
    await base.initialize();
    const stateStore = createCoreStateStore({ storage: base });
    const manifest = await stateStore.load();
    stateStore.stage(stateStore.scopes.workspace, "workspace", { nextOrdinal: 1 });
    await stateStore.publish(manifest);
    const secondGeneration = stateStore.currentManifest();
    stateStore.stage(stateStore.scopes.workspace, "unrelated", { nextOrdinal: 1 });
    await stateStore.publish(secondGeneration);

    const failingStorage = {
      ...base,
      async putProtocolObject(scope, key, value) {
        if (scope === "core" && key === "runtime-state") throw new Error("publication interrupted");
        return base.putProtocolObject(scope, key, value);
      }
    };
    const interrupted = createCoreStateStore({ storage: failingStorage });
    const current = await interrupted.load();
    interrupted.stage(interrupted.scopes.workspace, "workspace", { nextOrdinal: 3 });
    await assert.rejects(() => interrupted.publish(current), /publication interrupted/);

    const recovered = createCoreStateStore({ storage: base });
    await recovered.load();
    assert.deepEqual(await recovered.get(recovered.scopes.workspace, "workspace"), { nextOrdinal: 1 });
  });

  it("fails closed on invalid normalized state and covers staged-store boundaries", async () => {
    assert.throws(() => createCoreStateStore({}), /requires storage/);

    const storage = createStoragePort({ inMemory: true });
    await storage.initialize();
    const stateStore = createCoreStateStore({ storage });
    assert.throws(() => stateStore.currentManifest(), /not loaded/);
    assert.equal(stateStore.isAtomicBackend(), false);

    const manifest = await stateStore.load();
    assert.equal(await stateStore.get("", "missing", "fallback"), "fallback");
    assert.throws(() => stateStore.stage("", "missing", true), /scope and logical key are required/);
    stateStore.stage(stateStore.scopes.workspace, "staged", { revision: 1 });
    assert.equal(stateStore.hasPending(), true);
    assert.deepEqual(await stateStore.get(stateStore.scopes.workspace, "staged"), { revision: 1 });
    assert.deepEqual(await stateStore.list(stateStore.scopes.workspace), [
      { logicalKey: "staged", value: { revision: 1 } }
    ]);
    assert.deepEqual(await stateStore.list(stateStore.scopes.intent), []);
    stateStore.discard();
    assert.equal(stateStore.hasPending(), false);

    assert.equal(createCoreStateStore({
      storage: { ...storage, atomicTransactions: true }
    }).isAtomicBackend(), true);
    assert.equal(createCoreStateStore({
      storage: { ...storage, storageBackend: "sqlite" }
    }).isAtomicBackend(), true);

    await storage.putProtocolObject("core", "runtime-state", {});
    await assert.rejects(
      () => createCoreStateStore({ storage }).load(),
      /non-current runtime-state layout/
    );
    await storage.putProtocolObject("core", "runtime-state", { ...manifest, generation: -1 });
    await assert.rejects(
      () => createCoreStateStore({ storage }).load(),
      /non-negative safe integer/
    );

    await storage.putProtocolObject("core", "runtime-state", manifest);
    const writer = createCoreStateStore({ storage });
    await writer.load();
    writer.stage(writer.scopes.workspace, "published", { revision: 2 });
    await writer.publish();
    const [physicalKey] = await storage.listProtocolObjectKeys(writer.scopes.workspace);
    const validRecord = await storage.getProtocolObject(writer.scopes.workspace, physicalKey);

    await storage.putProtocolObject(writer.scopes.workspace, physicalKey, {
      ...validRecord,
      scope: "wrong-scope"
    });
    const invalidRecord = createCoreStateStore({ storage });
    await invalidRecord.load();
    await assert.rejects(
      () => invalidRecord.get(invalidRecord.scopes.workspace, "published"),
      /runtime record validation failed/
    );

    await storage.putProtocolObject(writer.scopes.workspace, physicalKey, {
      ...validRecord,
      generation: -1
    });
    const invalidRecordGeneration = createCoreStateStore({ storage });
    await invalidRecordGeneration.load();
    await assert.rejects(
      () => invalidRecordGeneration.get(invalidRecordGeneration.scopes.workspace, "published"),
      /non-negative safe integer/
    );

    await storage.putProtocolObject(writer.scopes.workspace, physicalKey, validRecord);
    await storage.putProtocolObject(writer.scopes.workspace, "ignored-junk", {});
    const recovered = createCoreStateStore({ storage });
    await recovered.load();
    assert.deepEqual(await recovered.list(recovered.scopes.workspace), [
      { logicalKey: "published", value: { revision: 2 } }
    ]);
    await storage.close();
  });
});
