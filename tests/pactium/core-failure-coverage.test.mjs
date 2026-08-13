import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createJsonStoragePort, createPactium } from "../../src/index.js";

describe("Pactium doctor ledger fact integrity", () => {
  it("reports a missing ledger fact block", async () => {
    const storage = createJsonStoragePort({ inMemory: true });
    const writer = createPactium({ storage });
    await writer.recordOperation({
      operationId: "doctor.fact.integrity",
      workspaceId: "doctor-integrity"
    });
    await writer.close();

    const missingFactStorage = {
      ...storage,
      async getBlock(cid) {
        const block = await storage.getBlock(cid);
        return block?.kind === "ledger-fact" ? null : block;
      }
    };
    const missingFactCore = createPactium({ storage: missingFactStorage });
    const missingFactResult = await missingFactCore.doctor();
    assert.ok(missingFactResult.failures?.some((failure) =>
      failure.code === "missing_ledger_fact_block"));
    await missingFactCore.close();
    await storage.close();
  });

  it("reports a ledger fact payload hash mismatch", async () => {
    const storage = createJsonStoragePort({ inMemory: true });
    const writer = createPactium({ storage });
    await writer.recordOperation({
      operationId: "doctor.fact.hash",
      workspaceId: "doctor-integrity"
    });
    await writer.close();
    const badHashStorage = {
      ...storage,
      async getBlock(cid) {
        const block = await storage.getBlock(cid);
        return block?.kind === "ledger-fact"
          ? { ...block, payloadHash: "sha256:not-the-ledger-fact-hash" }
          : block;
      }
    };
    const badHashCore = createPactium({ storage: badHashStorage });
    const badHashResult = await badHashCore.doctor();
    assert.ok(badHashResult.failures?.some((failure) =>
      failure.code === "bad_ledger_fact_hash"));
    await badHashCore.close();
    await storage.close();
  });
});
