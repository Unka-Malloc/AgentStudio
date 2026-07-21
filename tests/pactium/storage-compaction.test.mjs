import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  createPactium,
  sqliteStorageAvailable
} from "../../src/index.js";

const tempDirs = [];

async function tempDataDir() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pactium-storage-compaction-"));
  tempDirs.push(dataDir);
  return dataDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dataDir) =>
    fs.rm(dataDir, { recursive: true, force: true })
  ));
});

describe("Pactium durable storage compaction", () => {
  it("sweeps only obsolete derived index nodes and preserves historical proof verification", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const pactium = createPactium({ dataDir: await tempDataDir(), storageBackend: "sqlite" });
    const envelopes = [];
    for (let revision = 0; revision < 6; revision += 1) {
      envelopes.push(await pactium.recordOperation({
        operationId: "storage.compaction.fixture",
        workspaceId: "storage-compaction",
        idempotencyKey: `storage-compaction-intent-${revision}`,
        outcomeIdempotencyKey: `storage-compaction-outcome-${revision}`,
        input: { revision },
        stateMutations: [{ key: "fixture/revision", value: { revision } }]
      }));
    }

    const preview = await pactium.compactStorage();
    assert.equal(preview.garbageCollection.dryRun, true);
    assert.ok(preview.garbageCollection.candidateCount > 0);

    const compacted = await pactium.compactStorage({ dryRun: false, reclaimPages: 64 });
    assert.ok(compacted.garbageCollection.deletedCount > 0);
    assert.equal(compacted.pageReclamation.supported, true);
    assert.equal(compacted.pageReclamation.deferred, false);

    const historicalVerification = await pactium.verifyEnvelope(envelopes[0], {
      trustedManifest: envelopes[0].ledgerHead.verifierManifest
    });
    assert.equal(historicalVerification.ok, true, JSON.stringify(historicalVerification.failures || []));
    const currentVerification = await pactium.verifyEnvelope(envelopes.at(-1), {
      trustedManifest: envelopes.at(-1).ledgerHead.verifierManifest
    });
    assert.equal(currentVerification.ok, true, JSON.stringify(currentVerification.failures || []));
    assert.equal((await pactium.exportProofBundle(envelopes[0])).envelope.envelopeId, envelopes[0].envelopeId);
    const projection = await pactium.getWorkspaceProjection("storage-compaction");
    assert.equal(projection.nextOrdinal, 12);
    await pactium.close();
  });
});
