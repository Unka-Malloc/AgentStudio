import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PACTIUM_PROOF_TYPES,
  createAppendOnlyEventLog,
  createLedgerTransparencyLog,
  createStoragePort,
  verifyLedgerConsistencyProof,
  verifyLedgerInclusionProof
} from "../../src/index.js";

const PARTITION = "failure-ledger";
const SEGMENT_KEY = `event-log-segment:${PARTITION}:0`;

function clone(value) {
  return structuredClone(value);
}

async function segmentedLog() {
  const storage = createStoragePort({ inMemory: true });
  const log = createAppendOnlyEventLog({
    storage,
    segmentSize: 8,
    createEventId: ({ offset }) => `failure-event-${offset}`
  });
  await log.appendEvents(Array.from({ length: 3 }, (_, index) => ({
    partitionId: PARTITION,
    operationId: `operation-${index}`,
    payload: { index }
  })));
  const segment = await storage.getProtocolObject(log.protocolObjectScope, SEGMENT_KEY, []);
  return { storage, log, segment };
}

describe("transparency log rejection coverage", () => {
  it("detects duplicate and jumped sequence records", async () => {
    const { storage, log, segment } = await segmentedLog();

    const duplicate = clone(segment);
    duplicate[1].offset = duplicate[0].offset;
    await storage.putProtocolObject(log.protocolObjectScope, SEGMENT_KEY, duplicate);
    assert.deepEqual(await log.verifyPartition(PARTITION), {
      ok: false,
      partitionId: PARTITION,
      eventCount: 3,
      failedOffset: 1
    });

    const jumped = clone(segment);
    jumped[1].offset += 1;
    await storage.putProtocolObject(log.protocolObjectScope, SEGMENT_KEY, jumped);
    assert.equal((await log.verifyPartition(PARTITION)).failedOffset, 1);
    await storage.close();
  });

  it("detects predecessor, record-hash, truncation, and malformed-segment breaks", async () => {
    const { storage, log, segment } = await segmentedLog();

    const wrongPredecessor = clone(segment);
    wrongPredecessor[1].prevEventHash = "0".repeat(64);
    await storage.putProtocolObject(log.protocolObjectScope, SEGMENT_KEY, wrongPredecessor);
    assert.equal((await log.verifyPartition(PARTITION)).failedOffset, 1);

    const wrongRecordHash = clone(segment);
    wrongRecordHash[1].eventHash = "f".repeat(64);
    await storage.putProtocolObject(log.protocolObjectScope, SEGMENT_KEY, wrongRecordHash);
    assert.equal((await log.verifyPartition(PARTITION)).failedOffset, 1);

    await storage.putProtocolObject(log.protocolObjectScope, SEGMENT_KEY, segment.slice(0, 2));
    assert.equal((await log.verifyPartition(PARTITION)).ok, false);

    await storage.putProtocolObject(log.protocolObjectScope, SEGMENT_KEY, { malformed: true });
    assert.equal((await log.verifyPartition(PARTITION)).ok, false);
    await storage.close();
  });

  it("rejects truncated, misdirected, and record-tampered ledger proofs", async () => {
    const storage = createStoragePort({ inMemory: true });
    const ledger = createLedgerTransparencyLog({ storage, signer: false });
    const appends = [];
    for (let index = 0; index < 5; index += 1) {
      appends.push(await ledger.append({
        factType: "failure.coverage",
        sequence: index
      }, { timestamp: `2026-01-01T00:00:0${index}.000Z` }));
    }
    const head = await ledger.head();
    const inclusion = await ledger.createInclusionProof(4, head);
    assert.equal(verifyLedgerInclusionProof({ head, proof: inclusion }), true);

    assert.equal(verifyLedgerInclusionProof({
      head,
      proof: { ...inclusion, auditPath: inclusion.auditPath.slice(1) }
    }), false);
    assert.equal(verifyLedgerInclusionProof({
      head,
      proof: {
        ...inclusion,
        auditPath: inclusion.auditPath.map((item, index) =>
          index === 0 ? { ...item, side: item.side === "left" ? "right" : "left" } : item
        )
      }
    }), false);
    assert.equal(verifyLedgerInclusionProof({
      head,
      proof: { ...inclusion, leaf: { ...inclusion.leaf, index: 99 } }
    }), false);

    const consistency = await ledger.createConsistencyProof(appends[1].head, head);
    assert.equal(verifyLedgerConsistencyProof({
      oldHead: appends[1].head,
      newHead: head,
      proof: consistency
    }), true);
    assert.equal(verifyLedgerConsistencyProof({
      oldHead: appends[1].head,
      newHead: head,
      proof: { ...consistency, auditPath: consistency.auditPath.slice(0, -1) }
    }), false);
    assert.equal(verifyLedgerConsistencyProof({
      oldHead: appends[1].head,
      newHead: head,
      proof: { ...consistency, proofType: PACTIUM_PROOF_TYPES.ledgerInclusion }
    }), false);
    await storage.close();
  });

  it("recovers the append lane after a rejected write and rejects use after close", async () => {
    const storage = createStoragePort({ inMemory: true });
    let rejectNextFact = true;
    const faultStorage = {
      ...storage,
      async putBlock(value, options) {
        if (rejectNextFact && options?.kind === "ledger-fact") {
          rejectNextFact = false;
          throw new Error("injected ledger fact rejection");
        }
        return storage.putBlock(value, options);
      }
    };
    const ledger = createLedgerTransparencyLog({ storage: faultStorage, signer: false });
    await assert.rejects(
      ledger.append({ factType: "failure.coverage", attempt: 1 }),
      /injected ledger fact rejection/
    );
    const retried = await ledger.append({ factType: "failure.coverage", attempt: 2 });
    assert.equal(retried.entry.index, 0);
    assert.equal((await ledger.entries()).length, 1);

    await storage.close();
    await assert.rejects(
      ledger.append({ factType: "failure.coverage", attempt: 3 }),
      (error) => error?.code === "PACTIUM_STORAGE_CLOSED"
    );
    await assert.rejects(
      ledger.reload(),
      (error) => error?.code === "PACTIUM_STORAGE_CLOSED"
    );
  });
});
