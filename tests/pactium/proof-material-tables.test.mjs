import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVerifiableIndexEngine, verifyIndexProof } from "../../src/index-engine/snapshot-merkle-index.js";
import { protocolHash } from "../../src/protocol/hashing.js";
import { createStoragePort } from "../../src/storage/storage-port.js";
import { compactProofMaterialTables } from "../../src/proof/envelope.js";

function clone(value) {
  return structuredClone(value);
}

describe("proof material tables", () => {
  it("hoists repeated proof leaves once and rejects malformed references", async () => {
    const storage = createStoragePort({ inMemory: true });
    const engine = createVerifiableIndexEngine({ storage, domain: "proof-table" });
    const index = await engine.createIndex(Array.from({ length: 16 }, (_, index) => ({
      key: `key:${String(index).padStart(2, "0")}`,
      valueRef: `value:${index}`,
      valueHash: protocolHash("block", index)
    })));
    const first = await engine.prove(index.root, "key:01");
    const second = await engine.prove(index.root, "key:02");
    assert.equal(verifyIndexProof(first), true);

    const material = compactProofMaterialTables({
      materialType: "pactium.proof-material",
      proofs: { first, second }
    });
    assert.equal(material.proofLeafTable.length, 1);
    assert.equal(material.proofs.first.leafNode, undefined);
    assert.equal(material.proofs.second.leafNode, undefined);
    assert.equal(material.proofs.first.leafRef, material.proofs.second.leafRef);
    assert.equal(verifyIndexProof(material.proofs.first, { proofMaterial: material }), true);
    assert.equal(verifyIndexProof(material.proofs.second, { proofMaterial: material }), true);

    const outOfRange = clone(material.proofs.first);
    outOfRange.leafRef = material.proofLeafTable.length;
    assert.equal(verifyIndexProof(outOfRange, { proofMaterial: material }), false);

    const crossDomainMaterial = clone(material);
    crossDomainMaterial.proofLeafTable[0].domain = "another-domain";
    assert.equal(verifyIndexProof(material.proofs.first, { proofMaterial: crossDomainMaterial }), false);

    const ambiguous = clone(material.proofs.first);
    ambiguous.leafNode = clone(material.proofLeafTable[0].leafNode);
    assert.equal(verifyIndexProof(ambiguous, { proofMaterial: material }), false);
  });

  it("derives root metadata from CAS nodes without protocol-object aliases", async () => {
    const storage = createStoragePort({ inMemory: true });
    const writer = createVerifiableIndexEngine({ storage, domain: "root-metadata" });
    const index = await writer.createIndex([{
      key: "key",
      valueRef: "value",
      valueHash: protocolHash("block", "value")
    }]);
    assert.deepEqual(await storage.listProtocolObjectKeys("index"), []);

    const reader = createVerifiableIndexEngine({ storage, domain: "different-reader-domain" });
    const reloaded = await reader.readIndexRoot(index.root);
    assert.equal(reloaded.root, index.root);
    assert.equal(reloaded.domain, "root-metadata");
    assert.equal((await reader.get(index.root, "key")).valueRef, "value");
  });
});
