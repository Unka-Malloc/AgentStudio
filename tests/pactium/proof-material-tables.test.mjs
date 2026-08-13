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

    const wrongScope = clone(material.proofs.first);
    wrongScope.leafTableScope = "wrong-table";
    assert.equal(verifyIndexProof(wrongScope, { proofMaterial: material }), false);
    const negativeRef = clone(material.proofs.first);
    negativeRef.leafRef = -1;
    assert.equal(verifyIndexProof(negativeRef, { proofMaterial: material }), false);
    const missingLeaf = clone(material);
    missingLeaf.proofLeafTable[0].leafNode = null;
    assert.equal(verifyIndexProof(material.proofs.first, { proofMaterial: missingLeaf }), false);
    const missingDomain = clone(material);
    missingDomain.proofLeafTable[0].domain = "";
    assert.equal(verifyIndexProof(material.proofs.first, { proofMaterial: missingDomain }), false);
    const wrongRoot = clone(material);
    wrongRoot.proofLeafTable[0].leafRoot = `cid:sha256:${"0".repeat(64)}`;
    assert.equal(verifyIndexProof(material.proofs.first, { proofMaterial: wrongRoot }), false);
    const wrongRootHash = clone(material);
    wrongRootHash.proofLeafTable[0].leafRootHash = "0".repeat(64);
    assert.equal(verifyIndexProof(material.proofs.first, { proofMaterial: wrongRootHash }), false);
  });

  it("rejects every independent inline proof and compact path shape violation", async () => {
    const storage = createStoragePort({ inMemory: true });
    const engine = createVerifiableIndexEngine({ storage, domain: "invalid-proof-shapes" });
    const index = await engine.createIndex(Array.from({ length: 400 }, (_, index) => ({
      key: `key:${String(index).padStart(4, "0")}`,
      valueRef: `value:${index}`,
      valueHash: protocolHash("block", index)
    })));
    const membership = await engine.prove(index.root, "key:0200");
    const nonMembership = await engine.prove(index.root, "key:0200.5");
    assert.ok(membership.path.length > 0);

    const invalid = [];
    invalid.push({ ...membership, proofType: "wrong" });
    invalid.push({ ...membership, leafNode: null });
    invalid.push({ ...membership, leafRoot: `cid:sha256:${"1".repeat(64)}` });
    invalid.push({ ...membership, leafRootHash: "1".repeat(64) });
    invalid.push({ ...membership, indexRoot: `cid:sha256:${"2".repeat(64)}` });
    invalid.push({ ...membership, rootHash: "2".repeat(64) });
    invalid.push({ ...membership, entry: { ...membership.entry, key: "absent" } });
    invalid.push({ ...membership, leafHash: "wrong" });

    const negativeChild = clone(membership);
    negativeChild.path[0].childIndex = -1;
    invalid.push(negativeChild);
    const highChild = clone(membership);
    highChild.path[0].childIndex = highChild.path[0].siblingDescriptorRefs.length;
    invalid.push(highChild);
    const badRef = clone(membership);
    badRef.path[0].siblingDescriptorRefs[0] = -1;
    invalid.push(badRef);
    const badSelection = clone(membership);
    badSelection.path[0].childIndex = badSelection.path[0].childIndex === 0 ? 1 : 0;
    invalid.push(badSelection);
    const badDescriptor = clone(membership);
    const selectedRef = badDescriptor.path[0].siblingDescriptorRefs[badDescriptor.path[0].childIndex];
    badDescriptor.descriptorTable[selectedRef].count += 1;
    invalid.push(badDescriptor);
    const badParentHash = clone(membership);
    badParentHash.path[0].nodeHash = "3".repeat(64);
    invalid.push(badParentHash);
    const badParentRoot = clone(membership);
    badParentRoot.path[0].nodeRoot = `cid:sha256:${"3".repeat(64)}`;
    invalid.push(badParentRoot);

    for (const proof of invalid) assert.equal(verifyIndexProof(proof), false);
    assert.equal(verifyIndexProof({ ...nonMembership, proofType: "wrong" }), false);
    assert.equal(verifyIndexProof({ ...nonMembership, leafNode: null }), false);
    assert.equal(verifyIndexProof({ ...nonMembership, leafRoot: `cid:sha256:${"4".repeat(64)}` }), false);
    assert.equal(verifyIndexProof({ ...nonMembership, leafRootHash: "4".repeat(64) }), false);
    assert.equal(verifyIndexProof({ ...nonMembership, indexRoot: `cid:sha256:${"5".repeat(64)}` }), false);
    assert.equal(verifyIndexProof({ ...nonMembership, key: "key:0200" }), false);
    assert.equal(verifyIndexProof({ ...nonMembership, leftBoundary: "wrong" }), false);
    assert.equal(verifyIndexProof({ ...nonMembership, rightBoundary: "wrong" }), false);
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
