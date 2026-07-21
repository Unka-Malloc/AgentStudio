import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPactium } from "../../src/core/pactium-core.js";

describe("operation receipt proofs", () => {
  it("records and verifies one terminal receipt, then performs write-free replay and on-change reads", async () => {
    const pactium = createPactium({ inMemory: true });
    let finalizerCalls = 0;
    const base = {
      operationId: "system.console_state",
      workspaceId: "console",
      profile: "on-change",
      changeKey: "console-state-v1",
      changeDigest: "stable-revision-1",
      status: "succeeded",
      finalizeEnvelopeExtensions: async () => {
        finalizerCalls += 1;
        return [];
      }
    };

    const recorded = await pactium.recordOperationReceipt({ ...base, idempotencyKey: "request-1" });
    assert.equal(recorded.envelopeKind, "operation-receipt");
    assert.equal(recorded.disposition, "recorded");
    assert.equal(finalizerCalls, 1);
    assert.equal((await pactium.verifyEnvelope(recorded, { trustPolicy: "structural" })).ok, true);

    const unchanged = await pactium.recordOperationReceipt({ ...base, idempotencyKey: "request-2" });
    assert.equal(unchanged.disposition, "unchanged");
    assert.equal(unchanged.envelopeId, recorded.envelopeId);
    assert.equal(finalizerCalls, 1);

    const replayed = await pactium.recordOperationReceipt({ ...base, idempotencyKey: "request-1" });
    assert.equal(replayed.disposition, "replayed");
    assert.equal(replayed.envelopeId, recorded.envelopeId);
    assert.equal(finalizerCalls, 1);

    await pactium.close();
  });
});
