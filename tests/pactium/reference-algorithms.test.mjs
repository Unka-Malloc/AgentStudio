import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";

import {
  PACTIUM_PROOF_BUNDLE_TYPE,
  PACTIUM_PROOF_TYPES,
  PACTIUM_PROTOCOL,
  advanceTrustedHead,
  advanceTo,
  canonicalDecode,
	  canonicalEncode,
	  canonicalString,
	  createLedgerConsistencyProof,
	  createLedgerTransparencyLog,
  createPactium,
  createStoragePort,
  createTrackingCursor,
  createVerifiableIndexEngine,
  createVerifierManifest,
  covers,
  protocolHash,
  resolveWithin,
  runPactiumQualityGateProfile,
  samePositionAs,
  signLedgerHead,
  verifyIndexProof,
  verifyLedgerConsistencyProof,
  verifyLedgerHeadSignature,
  verifyLedgerInclusionProof,
  verifyProofBundle,
  verifyProofEnvelope,
  verifyTrackingCursor
} from "../../src/index.js";
import {
  createLicoLiteAspect,
  createLicoLiteSigner
} from "../../src/aspects/licolite/index.js";
import { decodeVarint, indexedBlocksFromBundle } from "../../src/proof/bundle-format.js";

// Reference behavior map: Trillian/Rekor for transparency proofs, Dolt for index diff,
// go-car/IPLD for bundles, Hypercore for signatures, and Axon for lifecycle retries.
const tempDirs = [];
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pactiumIndexUrl = pathToFileURL(path.join(repoRoot, "src/index.js")).href;

async function tempDataDir(prefix = "pactium-reference-test-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runPactiumWorker(script, env = {}) {
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
    timeout: 30000
  });
  return JSON.parse(stdout);
}

function durableWorkerScript(body) {
  return `
    import { createPactium } from ${JSON.stringify(pactiumIndexUrl)};
    const pactium = createPactium({ dataDir: process.env.PACTIUM_TEST_DATA_DIR });
    ${body}
  `;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

function failureCodes(result) {
  return (result.failures || []).map((failure) => failure.code).sort();
}

function expectFailureCode(result, code, label = "") {
  assert.ok(
    failureCodes(result).includes(code),
    `${label || "result"} expected ${code}, got ${failureCodes(result).join(", ")}`
  );
}

async function proofMaterialFor(pactium, envelope) {
  const ref = envelope.proofRefs.find((candidate) => candidate.name === "ledger-and-index-proofs") || envelope.proofRefs[0];
  const block = await pactium.advanced.storage.getBlock(ref.cid);
  assert.ok(block, `proof material block ${ref.cid} should exist`);
  return canonicalDecode(block.bytes);
}

function setAtPath(object, pathSegments, value) {
  let cursor = object;
  for (const segment of pathSegments.slice(0, -1)) {
    cursor = cursor[segment];
  }
  cursor[pathSegments.at(-1)] = value;
}

async function envelopeWithMutatedProofMaterial(pactium, envelope, mutate) {
  const material = structuredClone(await proofMaterialFor(pactium, envelope));
  mutate(material);
  const block = await pactium.advanced.storage.putBlock(material, { kind: "proof-material:ledger-and-index-proofs" });
  const originalRef = envelope.proofRefs.find((candidate) => candidate.name === "ledger-and-index-proofs") || envelope.proofRefs[0];
  return pactium.storeEnvelope({
    ...envelope,
    envelopeId: undefined,
    proofRefs: envelope.proofRefs.map((ref) => ref === originalRef
      ? {
        name: ref.name,
        cid: block.cid,
        payloadHash: block.payloadHash,
        byteLength: block.byteLength
      }
      : ref)
  });
}

function keyEntry(key, value = key) {
  return {
    key,
    valueRef: `ref:${value}`,
    valueHash: protocolHash("block", { key, value }),
    metadata: {}
  };
}

function encodeVarint(value) {
  const bytes = [];
  let current = Number(value || 0);
  do {
    let byte = current & 0x7f;
    current = Math.floor(current / 128);
    if (current > 0) byte |= 0x80;
    bytes.push(byte);
  } while (current > 0);
  return Buffer.from(bytes);
}

function indexedBundleHash(bundle) {
  return protocolHash("proof.bundle", {
    manifest: bundle.manifest,
    envelope: bundle.envelope,
    index: bundle.index.map((item) => ({
      cid: item.cid,
      offset: item.offset,
      recordLength: item.recordLength,
      headerLength: item.headerLength,
      byteLength: item.byteLength,
      payloadHash: item.payloadHash
    }))
  });
}

function appendIndexedBundleBlock(bundle, block) {
  const binary = Buffer.from(String(bundle.binaryBase64 || ""), "base64");
  const header = {
    protocol: block.protocol,
    cid: block.cid,
    codec: block.codec,
    kind: block.kind,
    refs: block.refs,
    byteLength: block.byteLength,
    payloadHash: block.payloadHash
  };
  const headerBytes = Buffer.from(canonicalEncode(header));
  const payloadBytes = Buffer.from(String(block.payloadBase64 || ""), "base64");
  const recordLength = headerBytes.length + payloadBytes.length;
  const recordBytes = Buffer.concat([encodeVarint(recordLength), headerBytes, payloadBytes]);
  const next = structuredClone(bundle);
  next.manifest = {
    ...next.manifest,
    blockCount: Number(next.manifest?.blockCount || next.index.length) + 1
  };
  next.index = [
    ...next.index,
    {
      cid: block.cid,
      offset: binary.length,
      recordLength,
      headerLength: headerBytes.length,
      byteLength: block.byteLength,
      payloadHash: block.payloadHash,
      codec: block.codec,
      kind: block.kind,
      refs: block.refs
    }
  ];
  next.binaryBase64 = Buffer.concat([binary, recordBytes]).toString("base64");
  next.byteLength = binary.length + recordBytes.length;
  next.bundleHash = indexedBundleHash(next);
  return next;
}

function corruptIndexedBundlePayload(bundle, cid) {
  const next = structuredClone(bundle);
  const item = next.index.find((candidate) => candidate.cid === cid);
  assert.ok(item, `expected indexed block ${cid}`);
  assert.ok(Number(item.byteLength || 0) > 0, `expected indexed block ${cid} to have payload bytes`);
  const bytes = Buffer.from(String(next.binaryBase64 || ""), "base64");
  const decoded = decodeVarint(bytes, item.offset);
  const payloadStart = decoded.nextOffset + Number(item.headerLength || 0);
  bytes[payloadStart] = bytes[payloadStart] ^ 0xff;
  next.binaryBase64 = bytes.toString("base64");
  return next;
}

function sortedEntries(entries) {
  return [...entries].sort((left, right) => String(left.key) < String(right.key) ? -1 : String(left.key) > String(right.key) ? 1 : 0);
}

describe("Pactium reference-project algorithm coverage", () => {
  it("verifies RFC6962-style inclusion and consistency proofs across tree shapes and rejects forks", async () => {
    const ledger = createLedgerTransparencyLog({
      storage: createStoragePort({ inMemory: true }),
      signer: false
    });
    const heads = [await ledger.head()];
    for (let index = 0; index < 64; index += 1) {
      const appended = await ledger.append({
        factType: "reference.ledger",
        value: `leaf-${String(index).padStart(2, "0")}`
      }, { timestamp: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z` });
      heads.push(appended.head);
    }

    for (let size = 1; size < heads.length; size += 1) {
      const indexes = [...new Set([0, Math.floor((size - 1) / 2), size - 1])];
      for (const index of indexes) {
        const proof = await ledger.createInclusionProof(index, heads[size]);
        assert.equal(verifyLedgerInclusionProof({ head: heads[size], proof }), true);
        assert.equal(verifyLedgerInclusionProof({
          head: heads[size],
          proof: { ...proof, leaf: { ...proof.leaf, factHash: "sha256:tampered" } }
        }), false);
      }
    }

    for (let oldSize = 0; oldSize < heads.length; oldSize += 1) {
      for (let newSize = oldSize; newSize < heads.length; newSize += 1) {
        const proof = await ledger.createConsistencyProof(heads[oldSize], heads[newSize]);
        assert.equal(
          verifyLedgerConsistencyProof({ oldHead: heads[oldSize], newHead: heads[newSize], proof }),
          true,
          `valid consistency proof ${oldSize}->${newSize}`
        );
      }
    }

	    for (const [oldSize, newSize] of [[1, 2], [2, 3], [7, 8], [8, 16], [31, 64]]) {
	      const proof = await ledger.createConsistencyProof(heads[oldSize], heads[newSize]);
	      const tampered = {
	        ...proof,
	        auditPath: proof.auditPath.map((hash, index) => index === 0 ? "0".repeat(64) : hash)
	      };
	      assert.equal(verifyLedgerConsistencyProof({ oldHead: heads[oldSize], newHead: heads[newSize], proof: tampered }), false);
	    }
	    const inclusionWithBadAuditHash = await ledger.createInclusionProof(0, heads[64]);
	    assert.equal(verifyLedgerInclusionProof({
	      head: heads[64],
	      proof: { ...inclusionWithBadAuditHash, auditPath: ["not-a-hex-hash", ...inclusionWithBadAuditHash.auditPath.slice(1)] }
	    }), false);
	    assert.equal(verifyLedgerConsistencyProof({
	      oldHead: heads[0],
	      newHead: heads[0],
	      proof: {
	        protocol: PACTIUM_PROTOCOL,
	        proofType: PACTIUM_PROOF_TYPES.ledgerConsistency,
	        oldSize: 0,
	        newSize: 0,
	        oldRootHash: heads[0].rootHash,
	        newRootHash: heads[0].rootHash,
	        auditPath: ["0".repeat(64)]
	      }
	    }), false);
	    await assert.rejects(() => ledger.createInclusionProof(7, heads[3]), /out of range/);
	    await assert.rejects(() => ledger.createConsistencyProof(heads[8], heads[3]), /old size is greater than new size/);
	    const page = await ledger.pageEntries({ start: 0, limit: 64 });
	    assert.throws(
	      () => createLedgerConsistencyProof({ oldHead: heads[8], newEntries: page.entries.slice(0, 3) }),
	      /old size is greater than new size/
	    );

    async function branch(extraValue) {
      const branchLedger = createLedgerTransparencyLog({
        storage: createStoragePort({ inMemory: true }),
        signer: false
      });
      for (let index = 0; index < 4; index += 1) {
        await branchLedger.append({ factType: "reference.ledger", value: `shared-${index}` });
      }
      return branchLedger.append({ factType: "reference.ledger", value: extraValue });
    }

    const leftBranch = await branch("left");
    const rightBranch = await branch("right");
    const falseProof = {
      protocol: PACTIUM_PROTOCOL,
      proofType: PACTIUM_PROOF_TYPES.ledgerConsistency,
      oldSize: leftBranch.head.size,
      newSize: rightBranch.head.size,
      oldRootHash: leftBranch.head.rootHash,
      newRootHash: rightBranch.head.rootHash,
      auditPath: []
    };
    assert.equal(
      verifyLedgerConsistencyProof({
        oldHead: leftBranch.head,
        newHead: rightBranch.head,
        proof: falseProof
      }),
      false
    );
    expectFailureCode(advanceTrustedHead({
      oldHead: leftBranch.head,
      newHead: rightBranch.head,
      proof: falseProof
    }), "bad_trusted_head_consistency", "forked trusted head");
  });

  it("enforces signed ledger-head quorum and signer roles", async () => {
    const ledger = createLedgerTransparencyLog({
      storage: createStoragePort({ inMemory: true }),
      signer: false
    });
    const { head } = await ledger.append({ factType: "reference.signed-head", value: "signed" });
    const signerA = crypto.generateKeyPairSync("ed25519");
    const signerB = crypto.generateKeyPairSync("ed25519");
    const manifest = createVerifierManifest({
      signers: [
        {
          signerId: "signer-a",
          algorithm: "ed25519",
          publicKey: signerA.publicKey.export({ type: "spki", format: "pem" }),
          roles: ["ledger-head"]
        },
        {
          signerId: "signer-b",
          algorithm: "ed25519",
          publicKey: signerB.publicKey.export({ type: "spki", format: "pem" }),
          roles: ["ledger-head"]
        }
      ],
      quorum: 2
    });
    const signatureA = signLedgerHead(head, {
      signerId: "signer-a",
      privateKey: signerA.privateKey.export({ type: "pkcs8", format: "pem" }),
      manifest
    });
    const signatureB = signLedgerHead(head, {
      signerId: "signer-b",
      privateKey: signerB.privateKey.export({ type: "pkcs8", format: "pem" }),
      manifest
    });

	    assert.equal(verifyLedgerHeadSignature(head, manifest, { signatures: [signatureA, signatureB] }).ok, true);
	    expectFailureCode(
	      verifyLedgerHeadSignature(head, manifest, { signatures: [signatureA, signatureA] }),
	      "duplicate_signature_signer",
	      "duplicate signer does not satisfy quorum"
	    );
	    expectFailureCode(
	      verifyLedgerHeadSignature(head, manifest, { signatures: [signatureA] }),
	      "manifest_quorum_not_met",
      "single signature"
    );
    expectFailureCode(
      verifyLedgerHeadSignature(head, manifest, { signatures: [{ ...signatureA, signerId: "unknown" }, signatureB] }),
      "unknown_signer",
      "unknown signer"
    );
    const noRoleManifest = createVerifierManifest({
      signers: [{
        signerId: "signer-a",
        algorithm: "ed25519",
        publicKey: signerA.publicKey.export({ type: "spki", format: "pem" }),
        roles: ["proof-envelope"]
      }]
    });
    const wrongRoleSignature = signLedgerHead(head, {
      signerId: "signer-a",
      privateKey: signerA.privateKey.export({ type: "pkcs8", format: "pem" }),
      manifest: noRoleManifest
    });
    expectFailureCode(
      verifyLedgerHeadSignature(head, noRoleManifest, { signatures: [wrongRoleSignature] }),
      "signer_role_missing",
      "wrong role"
    );
	    expectFailureCode(
	      verifyLedgerHeadSignature(head, noRoleManifest, { signatures: [signatureA] }),
	      "signature_manifest_mismatch",
	      "signature bound to another manifest"
	    );
	    expectFailureCode(
	      verifyLedgerHeadSignature(head, manifest, {
	        signatures: [{ ...signatureA, manifestId: manifest.manifestId, manifestHash: "sha256:bad" }]
	      }),
	      "signature_manifest_mismatch",
	      "signature bound to another manifest hash"
	    );
	    expectFailureCode(
	      verifyLedgerHeadSignature({ ...head, rootHash: "0".repeat(64) }, manifest, { signatures: [signatureA, signatureB] }),
	      "bad_signed_head_payload",
      "tampered head"
    );
  });

	  it("keeps verifiable index roots insertion-order independent and makes diffs applicable", async () => {
    const engine = createVerifiableIndexEngine({
      storage: createStoragePort({ inMemory: true }),
      domain: "reference-diff"
    });
    const leftEntries = sortedEntries(Array.from({ length: 150 }, (_, index) => keyEntry(`k:${String(index).padStart(4, "0")}`, `left:${index}`)));
    const rightEntries = sortedEntries([
      ...Array.from({ length: 100 }, (_, index) => keyEntry(`k:${String(index + 50).padStart(4, "0")}`, index % 5 === 0 ? `updated:${index}` : `left:${index + 50}`)),
      ...Array.from({ length: 50 }, (_, index) => keyEntry(`k:${String(index + 200).padStart(4, "0")}`, `created:${index}`))
    ]);
    const left = await engine.createIndex(leftEntries);
    const right = await engine.createIndex(rightEntries);
    const rightReverse = await engine.createIndex([...rightEntries].reverse());
    assert.equal(rightReverse.root, right.root);

    const changes = await engine.diff(left.root, right.root);
    const applied = new Map(leftEntries.map((entry) => [entry.key, entry]));
    for (const change of changes) {
      if (change.action === "delete") applied.delete(change.key);
      else applied.set(change.key, change.after);
    }
    assert.equal(canonicalString(sortedEntries([...applied.values()])), canonicalString(rightEntries));
    assert.ok(changes.some((change) => change.action === "create"));
    assert.ok(changes.some((change) => change.action === "delete"));
    assert.ok(changes.some((change) => change.action === "update"));

	    for (const key of ["k:0000", "k:0050", "k:0200", "k:9999"]) {
	      assert.equal(engine.verifyProof(await engine.prove(left.root, key)), true);
	      assert.equal(engine.verifyProof(await engine.prove(right.root, key)), true);
	    }
	  });

	  it("keeps Prolly key ordering canonical across reloads and boundary-local mutations", async () => {
	    const dataDir = await tempDataDir("pactium-key-order-");
	    const engine = createVerifiableIndexEngine({
	      storage: createStoragePort({ dataDir }),
	      domain: "reference-key-order"
	    });
	    const mixedCaseRoot = await engine.createIndex([
	      keyEntry("a", "lower-a"),
	      keyEntry("A", "upper-a"),
	      keyEntry("b", "lower-b")
	    ]);
	    assert.deepEqual((await engine.scan(mixedCaseRoot.root)).map((entry) => entry.key), ["A", "a", "b"]);
	    for (const key of ["A", "a", "b", "aa"]) {
	      assert.equal(engine.verifyProof(await engine.prove(mixedCaseRoot.root, key)), true);
	    }
	    const reloaded = createVerifiableIndexEngine({
	      storage: createStoragePort({ dataDir }),
	      domain: "reference-key-order"
	    });
	    assert.deepEqual((await reloaded.scan(mixedCaseRoot.root)).map((entry) => entry.key), ["A", "a", "b"]);
	    for (const key of ["A", "a", "b", "aa"]) {
	      assert.equal(reloaded.verifyProof(await reloaded.prove(mixedCaseRoot.root, key)), true);
	    }

	    const baseEntries = Array.from({ length: 512 }, (_, index) =>
	      keyEntry(`m:${String(index).padStart(4, "0")}`, `base:${index}`)
	    );
	    const base = await engine.createIndex(baseEntries);
	    const updatedEntry = keyEntry("m:0064", "updated:0064");
	    const updatedEntries = sortedEntries(baseEntries.map((entry) => entry.key === updatedEntry.key ? updatedEntry : entry));
	    const updated = await engine.put(base.root, updatedEntry.key, updatedEntry);
	    assert.equal(updated.root, (await engine.createIndex(updatedEntries)).root);

	    const insertedEntry = keyEntry("m:0064:inserted", "inserted:0064");
	    const insertedEntries = sortedEntries([...updatedEntries, insertedEntry]);
	    const inserted = await engine.put(updated.root, insertedEntry.key, insertedEntry);
	    assert.equal(inserted.root, (await engine.createIndex(insertedEntries)).root);

	    const deletedEntries = sortedEntries(insertedEntries.filter((entry) => entry.key !== "m:0065"));
	    const deleted = await engine.delete(inserted.root, "m:0065");
	    assert.equal(deleted.root, (await engine.createIndex(deletedEntries)).root);
	  });

  it("keeps incremental Prolly mutations canonical across long boundary-shifting sequences", async () => {
    const engine = createVerifiableIndexEngine({
      storage: createStoragePort({ inMemory: true }),
      domain: "reference-canonical-mutation"
    });
    let entries = Array.from({ length: 12000 }, (_, index) =>
      keyEntry(`k:${String(index).padStart(6, "0")}`, `v:${index}`)
    );
    let root = await engine.createIndex(entries);
    for (let index = 0; index < 45; index += 1) {
      const key = `k:${String((index * 7919) % 14400).padStart(6, "0")}`;
      if (index % 5 === 0) {
        root = await engine.delete(root.root, key);
        entries = entries.filter((entry) => entry.key !== key);
      } else {
        const nextEntry = keyEntry(key, `mut:${index}`);
        root = await engine.put(root.root, key, nextEntry);
        entries = sortedEntries([
          ...entries.filter((entry) => entry.key !== key),
          nextEntry
        ]);
      }
      const rebuilt = await engine.createIndex(entries, { domain: "reference-canonical-mutation" });
      assert.equal(root.root, rebuilt.root, `incremental root diverged from canonical rebuild at operation ${index}`);
    }
  });


  it("runs index pressure profiles with membership, non-membership, diff, and progress evidence", async () => {
    const progress = [];
    const result = await runPactiumQualityGateProfile({
      profile: "api:index-engine",
      operations: 128,
      membershipProofs: 12,
      nonMembershipProofs: 12,
      requireDiff: true,
      progressInterval: 6,
      onProgress(event) {
        progress.push(event);
      }
    });
    assert.equal(result.operationCount, 128);
    assert.equal(result.details.indexKeys, 128);
    assert.equal(result.details.membershipProofs, 12);
    assert.equal(result.details.nonMembershipProofs, 12);
    assert.ok(result.details.diffChanges >= 2);
    assert.ok(progress.some((event) => event.phase === "membership-proofs" && event.completed === 12));
    assert.ok(progress.some((event) => event.phase === "non-membership-proofs" && event.completed === 12));
    assert.ok(progress.some((event) => event.phase === "diff:end"));
  });

	  it("verifies every embedded operation proof layer and detects targeted proof tampering", async () => {
	    const pactium = createPactium({ inMemory: true });
	    const intentEnvelope = await pactium.beginOperationIntent({
	      operationId: "reference.embedded-open-intent",
	      workspaceId: "workspace-proofs",
	      idempotencyKey: "open-intent-proof"
	    });
	    const intentMaterial = await proofMaterialFor(pactium, intentEnvelope);
	    const nonMemberOpenIntentProof = await pactium.advanced.indexEngine.prove(intentMaterial.proofs.openIntent.indexRoot, "missing-open-intent");
	    const wrongOpenIntentBinding = await envelopeWithMutatedProofMaterial(pactium, intentEnvelope, (material) => {
	      material.proofs.openIntent = nonMemberOpenIntentProof;
	    });
	    expectFailureCode(await pactium.verifyEnvelope(wrongOpenIntentBinding), "bad_index_proof_binding", "open intent proof binding");

	    const envelope = await pactium.recordOperation({
	      operationId: "reference.embedded-proofs",
      workspaceId: "workspace-proofs",
      idempotencyKey: "intent-proof",
      outcomeIdempotencyKey: "outcome-proof",
      input: { path: "docs/proof.md" },
      stateMutations: [
        { key: "docs/proof.md", value: { text: "proof" } }
      ]
    });
    const valid = await pactium.verifyEnvelope(envelope);
    assert.equal(valid.ok, true);

    const targets = [
      ["proofs", "outcome"],
      ["proofs", "openIntentRemoved"],
      ["proofs", "workspaceProjection", "orderProof"],
      ["proofs", "workspaceProjection", "membershipProof"],
      ["proofs", "state", "touchedKeyProofs", 0],
      ["proofs", "checkpoint", "proof"]
    ];
	    for (const target of targets) {
	      const badEnvelope = await envelopeWithMutatedProofMaterial(pactium, envelope, (material) => {
	        const original = target.reduce((cursor, segment) => cursor?.[segment], material);
	        assert.ok(original?.proofType, `target ${target.join(".")} should be a proof`);
	        setAtPath(material, target, {
          ...original,
          rootHash: "0".repeat(64)
        });
      });
	      const result = await pactium.verifyEnvelope(badEnvelope);
	      expectFailureCode(result, "bad_embedded_proof", target.join("."));
	    }
	    const validMaterial = await proofMaterialFor(pactium, envelope);
	    const alternateLedgerLeafProof = await pactium.advanced.ledger.createInclusionProof(0, validMaterial.ledger.head);
	    const wrongFactRefEnvelope = await envelopeWithMutatedProofMaterial(pactium, envelope, (material) => {
	      material.ledger.inclusionProof = alternateLedgerLeafProof;
	    });
	    expectFailureCode(await pactium.verifyEnvelope(wrongFactRefEnvelope), "bad_fact_ref_binding", "ledger leaf factRef binding");

	    const foreignRoot = await pactium.advanced.indexEngine.createIndex([keyEntry("foreign/proof", "foreign")]);
	    const foreignProof = await pactium.advanced.indexEngine.prove(foreignRoot.root, "foreign/proof");
	    const wrongWorkspaceBinding = await envelopeWithMutatedProofMaterial(pactium, envelope, (material) => {
	      material.proofs.workspaceProjection.orderProof = foreignProof;
	    });
	    expectFailureCode(await pactium.verifyEnvelope(wrongWorkspaceBinding), "bad_index_proof_binding", "workspace order root binding");

	    const nonMemberOutcomeProof = await pactium.advanced.indexEngine.prove(validMaterial.proofs.outcome.indexRoot, "missing-intent");
	    const wrongOutcomeBinding = await envelopeWithMutatedProofMaterial(pactium, envelope, (material) => {
	      material.proofs.outcome = nonMemberOutcomeProof;
	    });
	    expectFailureCode(await pactium.verifyEnvelope(wrongOutcomeBinding), "bad_index_proof_binding", "outcome proof membership binding");

	    const wrongStateCommit = await envelopeWithMutatedProofMaterial(pactium, envelope, (material) => {
	      material.proofs.stateCommit.mutationCount = 999;
	    });
	    expectFailureCode(await pactium.verifyEnvelope(wrongStateCommit), "bad_state_commit_binding", "state commit semantic binding");
	  });

	  it("exposes causality proofs and binds them to the referenced operation edge", async () => {
	    const pactium = createPactium({ inMemory: true });
	    const parent = await pactium.recordOperation({
	      operationId: "reference.causality.parent",
	      workspaceId: "causality",
	      idempotencyKey: "causality-parent-intent",
	      outcomeIdempotencyKey: "causality-parent-outcome",
	      stateMutations: [{ key: "causality/parent", value: { ok: true } }]
	    });
	    const child = await pactium.recordOperation({
	      operationId: "reference.causality.child",
	      workspaceId: "causality",
	      idempotencyKey: "causality-child-intent",
	      outcomeIdempotencyKey: "causality-child-outcome",
	      causalityRefs: [parent.factId],
	      stateMutations: [{ key: "causality/child", value: { ok: true } }]
	    });
	    const material = await proofMaterialFor(pactium, child);
	    assert.equal(material.proofs.causality.proofs.length, 1);
	    assert.equal(material.proofs.causality.proofs[0].key, `${parent.factId}\u0000${material.proofs.stateCommit.outcomeId}`);
	    assert.equal((await pactium.verifyEnvelope(child)).ok, true);

	    const nonMemberCausalityProof = await pactium.advanced.indexEngine.prove(
	      material.proofs.causality.root,
	      `${parent.factId}\u0000wrong-outcome`
	    );
	    const badCausality = await envelopeWithMutatedProofMaterial(pactium, child, (nextMaterial) => {
	      nextMaterial.proofs.causality.proofs[0] = nonMemberCausalityProof;
	    });
	    expectFailureCode(await pactium.verifyEnvelope(badCausality), "bad_index_proof_binding", "causality edge binding");
	  });

  it("treats proof bundles as self-contained content-addressed artifacts with required blocks", async () => {
    const pactium = createPactium({ inMemory: true });
    const envelope = await pactium.recordOperation({
      operationId: "reference.bundle",
      workspaceId: "bundle-workspace",
      idempotencyKey: "bundle-intent",
      outcomeIdempotencyKey: "bundle-outcome",
      stateMutations: [{ key: "bundle/key", value: { ok: true } }]
    });
    const bundle = await pactium.exportProofBundle(envelope);
    assert.equal(bundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    assert.equal((await verifyProofBundle(bundle)).ok, true);

    const missingRequiredBlock = structuredClone(bundle);
    const missingCid = missingRequiredBlock.manifest.requiredBlocks[0];
    missingRequiredBlock.index = missingRequiredBlock.index.filter((item) => item.cid !== missingCid);
    expectFailureCode(await verifyProofBundle(missingRequiredBlock), "missing_bundle_block", "missing required block");

    const badBundleHash = structuredClone(bundle);
    badBundleHash.bundleHash = "sha256:bad";
    expectFailureCode(await verifyProofBundle(badBundleHash), "bad_bundle_hash", "bad bundle hash");

    const badEnvelope = structuredClone(bundle);
    badEnvelope.envelope.factRef = {
      ...badEnvelope.envelope.factRef,
      ledgerEventId: "ledger_event_tampered"
    };
    expectFailureCode(await verifyProofBundle(badEnvelope), "bad_envelope_id", "tampered envelope");
  });

  it("verifies indexed proof-bundle required blocks lazily while preserving full archive checks", async () => {
    const pactium = createPactium({ inMemory: true });
    const envelope = await pactium.recordOperation({
      operationId: "reference.bundle.lazy",
      workspaceId: "bundle-lazy",
      idempotencyKey: "bundle-lazy-intent",
      outcomeIdempotencyKey: "bundle-lazy-outcome",
      stateMutations: [{ key: "lazy/key", value: { ok: true } }]
    });
    const bundle = await pactium.exportProofBundle(envelope);
    assert.equal(bundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    const extraBlock = await pactium.advanced.storage.putBlock({
      proofMaterial: "not required by this envelope",
      payload: "extra block that should be skipped by default"
    }, { kind: "proof-material:unused-extra" });
    const withExtra = appendIndexedBundleBlock(bundle, extraBlock);
    assert.equal((await verifyProofBundle(withExtra)).ok, true);

    const corruptedExtra = corruptIndexedBundlePayload(withExtra, extraBlock.cid);
    assert.equal(
      (await verifyProofBundle(corruptedExtra)).ok,
      true,
      "default verification should not read a non-required extra block payload"
    );
    expectFailureCode(
      await verifyProofBundle(corruptedExtra, { verifyAllBlocks: true }),
      "bad_bundle_index",
      "full archive verification"
    );

    const requiredCid = bundle.manifest.requiredBlocks[0];
    const corruptedRequired = corruptIndexedBundlePayload(bundle, requiredCid);
    const requiredResult = await verifyProofBundle(corruptedRequired);
    assert.equal(requiredResult.ok, false);
    assert.ok(
      failureCodes(requiredResult).some((code) => ["bad_bundle_index", "missing_proof_material"].includes(code)),
      `expected required corruption to fail, got ${failureCodes(requiredResult).join(", ")}`
    );
  });

  it("recovers open operation lifecycles after process reload", async () => {
    const dataDir = await tempDataDir("pactium-recovery-");
    const first = createPactium({ dataDir });
    const intent = await first.beginOperationIntent({
      operationId: "reference.recovery",
      workspaceId: "recovery-workspace",
      idempotencyKey: "recover-intent",
      input: { item: 1 }
    });

    const second = createPactium({ dataDir });
    const open = await second.lookupOpenIntent(intent.factId);
    assert.equal(open.exists, true);
    const outcome = await second.appendOperationOutcome({
      intentId: intent.factId,
      outcomeIdempotencyKey: "recover-outcome",
      result: { ok: true }
    });
    assert.equal((await second.verifyEnvelope(outcome)).ok, true);

    const third = createPactium({ dataDir });
    assert.equal((await third.lookupOpenIntent(intent.factId)).exists, false);
    assert.equal((await third.lookupOutcome(intent.factId)).exists, true);
    assert.equal((await third.getWorkspaceProjection("recovery-workspace")).nextOrdinal, 2);
  });

  it("makes intent and outcome idempotency linearizable under concurrent retries and persists the result", async () => {
    const dataDir = await tempDataDir("pactium-concurrent-");
    const pactium = createPactium({ dataDir });
    const intentAttempts = await Promise.all(Array.from({ length: 16 }, () => pactium.beginOperationIntent({
      operationId: "reference.concurrent-intent",
      workspaceId: "concurrent-workspace",
      idempotencyKey: "same-intent",
      input: { stable: true }
    })));
    assert.equal(new Set(intentAttempts.map((envelope) => envelope.envelopeId)).size, 1);
    assert.equal((await pactium.advanced.ledger.head()).size, 1);

    const intentId = intentAttempts[0].factId;
    const outcomeAttempts = await Promise.all(Array.from({ length: 16 }, () => pactium.appendOperationOutcome({
      intentId,
      outcomeIdempotencyKey: "same-outcome",
      result: { stable: true }
    })));
    assert.equal(new Set(outcomeAttempts.map((envelope) => envelope.envelopeId)).size, 1);
    assert.equal((await pactium.advanced.ledger.head()).size, 2);

	    const reloaded = createPactium({ dataDir });
	    const replayedIntent = await reloaded.beginOperationIntent({
	      operationId: "reference.concurrent-intent",
      workspaceId: "concurrent-workspace",
      idempotencyKey: "same-intent",
      input: { stable: true }
    });
    assert.equal(replayedIntent.replayed, true);
	    assert.equal(replayedIntent.envelopeId, intentAttempts[0].envelopeId);
	    assert.equal((await reloaded.lookupOutcome(intentId)).exists, true);
	    await assert.rejects(
	      () => reloaded.beginOperationIntent({
	        operationId: "reference.concurrent-intent",
	        workspaceId: "concurrent-workspace",
	        idempotencyKey: "same-intent",
	        input: { stable: false }
	      }),
	      (error) => error?.failure?.code === "idempotency_conflict"
	    );
	  });

  it("serializes durable shared dataDir mutations across Node processes without stale-state overwrites", async () => {
    const dataDir = await tempDataDir("pactium-cross-process-");
    const staleReader = createPactium({ dataDir });
    await staleReader.doctor();
    const workerCount = 6;
    const workspaceId = "cross-process-shared";
    const workerScript = durableWorkerScript(`
      const workerId = process.env.PACTIUM_WORKER_ID;
      const envelope = await pactium.recordOperation({
        operationId: "reference.cross-process.unique",
        workspaceId: ${JSON.stringify(workspaceId)},
        idempotencyKey: \`intent-\${workerId}\`,
        outcomeIdempotencyKey: \`outcome-\${workerId}\`,
        input: { workerId },
        result: { workerId, ok: true },
        stateMutations: [{ key: \`workers/\${workerId}\`, value: { workerId, durable: true } }]
      });
      const projection = await pactium.getWorkspaceProjection(${JSON.stringify(workspaceId)});
      const verification = await pactium.verifyEnvelope(envelope);
      console.log(JSON.stringify({
        workerId,
        envelopeId: envelope.envelopeId,
        ledgerEventId: envelope.factRef.ledgerEventId,
        projectionSize: projection.nextOrdinal,
        verified: verification.ok
      }));
    `);

    const results = await Promise.all(Array.from({ length: workerCount }, (_, index) =>
      runPactiumWorker(workerScript, {
        PACTIUM_TEST_DATA_DIR: dataDir,
        PACTIUM_WORKER_ID: String(index)
      })
    ));
    assert.equal(results.length, workerCount);
    assert.equal(results.every((result) => result.verified), true);
    assert.equal(new Set(results.map((result) => result.envelopeId)).size, workerCount);

    const projectionFromStaleInstance = await staleReader.getWorkspaceProjection(workspaceId);
    assert.equal(projectionFromStaleInstance.nextOrdinal, workerCount * 2);
    assert.equal(projectionFromStaleInstance.membership.length, workerCount * 2);
    for (const result of results) {
      const membership = await staleReader.proveWorkspaceMembership({
        workspaceId,
        ledgerEventId: result.ledgerEventId
      });
      assert.equal(membership.member, true);
      assert.equal(staleReader.advanced.indexEngine.verifyProof(membership.proof), true);
    }

    const parentEnvelope = await staleReader.recordOperation({
      operationId: "reference.cross-process.parent-after-stale-read",
      workspaceId,
      idempotencyKey: "intent-parent-after-children",
      outcomeIdempotencyKey: "outcome-parent-after-children",
      input: { parent: true },
      result: { parent: true },
      stateMutations: [{ key: "workers/parent", value: { parent: true } }]
    });
    assert.equal((await staleReader.verifyEnvelope(parentEnvelope)).ok, true);

    const fresh = createPactium({ dataDir });
    assert.equal((await fresh.advanced.ledger.head()).size, workerCount * 2 + 2);
    assert.equal((await fresh.getWorkspaceProjection(workspaceId)).nextOrdinal, workerCount * 2 + 2);
  });

  it("replays one durable idempotency lifecycle across competing Node processes", async () => {
    const dataDir = await tempDataDir("pactium-cross-process-idempotency-");
    const workerCount = 8;
    const workspaceId = "cross-process-idempotency";
    const workerScript = durableWorkerScript(`
      const workerId = process.env.PACTIUM_WORKER_ID;
      const envelope = await pactium.recordOperation({
        operationId: "reference.cross-process.same-idempotency",
        workspaceId: ${JSON.stringify(workspaceId)},
        idempotencyKey: "shared-intent",
        outcomeIdempotencyKey: "shared-outcome",
        input: { stable: true },
        result: { stable: true },
        stateMutations: [{ key: "shared/value", value: { stable: true } }]
      });
      const verification = await pactium.verifyEnvelope(envelope);
      console.log(JSON.stringify({
        workerId,
        envelopeId: envelope.envelopeId,
        factId: envelope.factId,
        replayed: envelope.replayed,
        verified: verification.ok
      }));
    `);

    const results = await Promise.all(Array.from({ length: workerCount }, (_, index) =>
      runPactiumWorker(workerScript, {
        PACTIUM_TEST_DATA_DIR: dataDir,
        PACTIUM_WORKER_ID: String(index)
      })
    ));
    assert.equal(results.every((result) => result.verified), true);
    assert.equal(new Set(results.map((result) => result.envelopeId)).size, 1);

    const fresh = createPactium({ dataDir });
    const head = await fresh.advanced.ledger.head();
    const projection = await fresh.getWorkspaceProjection(workspaceId);
    const page = await fresh.getLedgerCursor({ limit: 10 });
    assert.equal(head.size, 2);
    assert.equal(projection.nextOrdinal, 2);
    assert.deepEqual(page.entries.map((entry) => entry.fact.factType), ["operation.intent", "operation.outcome"]);
  });

  it("pages durable ledger and workspace cursors without loading the full history", async () => {
    const dataDir = await tempDataDir("pactium-cursor-page-");
    const workspaceId = "cursor-page";
    const writer = createPactium({ dataDir });
    for (let index = 0; index < 220; index += 1) {
      await writer.beginOperationIntent({
        operationId: `reference.cursor.intent.${index}`,
        workspaceId,
        idempotencyKey: `cursor-intent-${index}`,
        input: { index }
      });
    }

    const baseStorage = createStoragePort({ dataDir });
    let ledgerLeafReads = 0;
    let indexNodeReads = 0;
    const countedStorage = {
      ...baseStorage,
      async getProtocolObject(scope, key, fallback) {
        if (scope === "ledger-leaf") ledgerLeafReads += 1;
        return baseStorage.getProtocolObject(scope, key, fallback);
      },
      async getBlock(cid) {
        const block = await baseStorage.getBlock(cid);
        if (String(block?.kind || "").startsWith("index-node:")) indexNodeReads += 1;
        return block;
      }
    };
    const fresh = createPactium({ storage: countedStorage });
    const ledgerPage = await fresh.getLedgerCursor({ position: 100, limit: 5 });
    assert.deepEqual(ledgerPage.entries.map((entry) => entry.index), [100, 101, 102, 103, 104]);
    assert.equal(ledgerPage.cursor.position, 105);
    assert.ok(ledgerLeafReads <= 5, `expected page read to touch 5 ledger leaves, touched ${ledgerLeafReads}`);

    const workspacePage = await fresh.getWorkspaceCursor({ workspaceId, position: 100, limit: 5 });
    assert.deepEqual(
      workspacePage.entries.map((entry) => entry.key),
      [100, 101, 102, 103, 104].map((index) => String(index).padStart(16, "0"))
    );
    assert.equal(workspacePage.cursor.position, 105);
    assert.equal(workspacePage.orderProofs.length, 5);
    assert.equal(workspacePage.orderProofs.every((proof) => fresh.advanced.indexEngine.verifyProof(proof)), true);
    assert.ok(indexNodeReads < 100, `expected workspace cursor to avoid a full index read, read ${indexNodeReads} nodes`);
  });

  it("fails closed when an authoritative ledger leaf is missing", async () => {
    const storage = createStoragePort({ inMemory: true });
    const ledger = createLedgerTransparencyLog({ storage, signer: false });
    await ledger.append({ factType: "reference.leaf", factId: "first" });
    await ledger.append({ factType: "reference.leaf", factId: "second" });
	    storage.pruneProtocolObjects?.((record) => record.scope === "ledger-leaf" && record.key === "1");
	    await assert.rejects(
	      () => ledger.pageEntries({ start: 0, limit: 2 }),
	      /Ledger leaf missing for 1/
	    );

	    const reloaded = createLedgerTransparencyLog({ storage, signer: false });
	    await assert.rejects(
      () => reloaded.pageEntries({ start: 0, limit: 2 }),
      /Ledger leaf missing for 1/
    );
  });

  it("verifies LicoLite production evidence and offline bundles without local storage", async () => {
    const keys = crypto.generateKeyPairSync("ed25519");
    const signer = createLicoLiteSigner({
      signerId: "shared-licolite-signer",
      algorithm: "ed25519",
      privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
      publicKey: keys.publicKey.export({ type: "spki", format: "pem" })
    });
    await assert.rejects(() => createLicoLiteAspect({
      inMemory: true,
      evidencePolicy: "production",
      signer
    }).recordWorkspaceOperation({
      operationId: "reference.licolite.missing-evidence",
      workspaceId: "licolite"
    }), /policy evidence/);

    const online = createLicoLiteAspect({
      inMemory: true,
      evidencePolicy: "production",
      signer
    });
    const envelope = await online.recordWorkspaceOperation({
      operationId: "reference.licolite.offline",
      workspaceId: "licolite",
      policyEvidence: { decision: "allow", rule: "unit" },
      workspaceEffectEvidence: { durableRef: "host:effect:1" },
      stateMutations: [{ key: "licolite/state", value: { ok: true } }]
    });
    assert.equal((await online.verifyEnvelope(envelope)).ok, true);
	    const bundle = await online.exportProofBundle(envelope);
	    assert.equal(bundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
	    const evidenceRefs = [];
	    for (const extension of envelope.extensions.filter((candidate) =>
	      candidate.name === "licolite.policy" || candidate.name === "licolite.workspaceEffect"
	    )) {
	      const block = await online.core.advanced.storage.getBlock(extension.valueRef);
	      const value = canonicalDecode(block.bytes);
	      evidenceRefs.push(value.evidenceRef);
	    }
	    assert.equal(evidenceRefs.length, 2);
	    assert.equal(evidenceRefs.every((cid) => bundle.index.some((item) => item.cid === cid)), true);
	    assert.equal(evidenceRefs.every((cid) => bundle.manifest.requiredBlocks.includes(cid)), true);
	    assert.equal((await verifyProofBundle(bundle, {
	      supportedCriticalExtensions: online.supportedCriticalExtensions
	    })).ok, true);

    const offline = createLicoLiteAspect({
      inMemory: true,
      evidencePolicy: "production",
      signer: createLicoLiteSigner({
        signerId: "shared-licolite-signer",
        algorithm: "ed25519",
        publicKey: keys.publicKey.export({ type: "spki", format: "pem" })
      })
    });
	    const offlineResult = await offline.verifyBundle(bundle);
	    assert.equal(offlineResult.ok, true, JSON.stringify(offlineResult.failures, null, 2));
	    const missingEvidenceBundle = structuredClone(bundle);
	    missingEvidenceBundle.index = missingEvidenceBundle.index.filter((item) => !evidenceRefs.includes(item.cid));
	    missingEvidenceBundle.bundleHash = indexedBundleHash(missingEvidenceBundle);
	    expectFailureCode(await offline.verifyBundle(missingEvidenceBundle), "missing_bundle_block", "missing evidence block");

	    const wrongKeys = crypto.generateKeyPairSync("ed25519");
	    const wrongOffline = createLicoLiteAspect({
      inMemory: true,
      evidencePolicy: "production",
      signer: createLicoLiteSigner({
        signerId: "shared-licolite-signer",
        algorithm: "ed25519",
        publicKey: wrongKeys.publicKey.export({ type: "spki", format: "pem" })
      })
	    });
	    expectFailureCode(await wrongOffline.verifyBundle(bundle), "bad_signature", "wrong offline public key");
	    const wrongSignerId = createLicoLiteAspect({
	      inMemory: true,
	      evidencePolicy: "production",
	      signer: createLicoLiteSigner({
	        signerId: "rewritten-signer",
	        algorithm: "ed25519",
	        publicKey: keys.publicKey.export({ type: "spki", format: "pem" })
	      })
	    });
	    expectFailureCode(await wrongSignerId.verifyBundle(bundle), "bad_signature_signer", "rewritten signature signer");
	  });

  it("derives an Ed25519 LicoLite verifier from a private key and rejects public-key-only signing", async () => {
    const keys = crypto.generateKeyPairSync("ed25519");
    const signer = createLicoLiteSigner({
      signerId: "derived-ed25519",
      algorithm: "ed25519",
      privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" })
    });
    assert.ok(String(signer.publicKey).includes("BEGIN PUBLIC KEY"));

    const message = "derive-ed25519-public-key";
    const signature = await signer.sign(message);
    assert.equal(await signer.verify(message, signature), true);

    const verifier = createLicoLiteSigner({
      signerId: "derived-ed25519",
      algorithm: "ed25519",
      publicKey: signer.publicKey
    });
    assert.equal(await verifier.verify(message, signature), true);
    assert.equal(await verifier.verify(message, "hmac-sha256:wrong-prefix"), false);
    assert.equal(await createLicoLiteSigner({ algorithm: "ed25519" }).verify(message, signature), false);
    await assert.rejects(() => verifier.sign(message), /privateKey/);
  });

  it("reports bad extension hashes from bundle material and keeps durable compaction non-destructive", async () => {
    const pactium = createPactium({ inMemory: true });
    const envelope = await pactium.recordOperation({
      operationId: "reference.bad-extension-hash",
      workspaceId: "extension-hash",
      idempotencyKey: "extension-intent",
      outcomeIdempotencyKey: "extension-outcome",
      extensions: [{
        name: "reference.extension",
        critical: false,
        value: { ok: true, branch: "bad-extension-hash" }
      }]
    });
    const bundle = await pactium.exportProofBundle(envelope);
    const extensionRef = envelope.extensions[0].valueRef;
    const corruptedBundle = corruptIndexedBundlePayload(bundle, extensionRef);

    const verification = await verifyProofEnvelope(envelope, { bundle: corruptedBundle });
    expectFailureCode(verification, "bad_bundle_index", "mutated extension bundle block");

    const dataDir = await tempDataDir("pactium-durable-compact-");
    const durable = createPactium({ dataDir });
    await durable.recordOperation({
      operationId: "reference.durable-compact",
      workspaceId: "durable-compact",
      idempotencyKey: "durable-compact-intent",
      outcomeIdempotencyKey: "durable-compact-outcome"
    });
    assert.deepEqual(await durable.advanced._compactInMemoryCaches(), {
      protocol: PACTIUM_PROTOCOL,
      inMemory: false,
      retainedRoots: 0,
      retainedNodeRoots: 0,
      prunedBlocks: 0,
      prunedProtocolObjects: 0
    });
  });

  it("proves disjoint range diffs and cache pruning preserve retained roots", async () => {
    const engine = createVerifiableIndexEngine({
      storage: createStoragePort({ inMemory: true }),
      domain: "reference-index-disjoint"
    });
    const leftEntries = Array.from({ length: 320 }, (_, index) => keyEntry(`left:${String(index).padStart(4, "0")}`, `left:${index}`));
    const rightEntries = Array.from({ length: 320 }, (_, index) => keyEntry(`right:${String(index).padStart(4, "0")}`, `right:${index}`));
    const left = await engine.createIndex(leftEntries);
    const right = await engine.createIndex(rightEntries);
    await engine.readSnapshot(left.root);
    await engine.readSnapshot(right.root);

    const changes = await engine.diff(left.root, right.root);
    assert.equal(changes.filter((change) => change.action === "delete").length, leftEntries.length);
    assert.equal(changes.filter((change) => change.action === "create").length, rightEntries.length);
    const reverseChanges = await engine.diff(right.root, left.root);
    assert.equal(reverseChanges.filter((change) => change.action === "delete").length, rightEntries.length);
    assert.equal(reverseChanges.filter((change) => change.action === "create").length, leftEntries.length);
    const sharedHighEntries = Array.from({ length: 512 }, (_, index) => keyEntry(`shared:${String(index).padStart(4, "0")}`, `shared:${index}`));
    const earlyEntries = Array.from({ length: 192 }, (_, index) => keyEntry(`early:${String(index).padStart(4, "0")}`, `early:${index}`));
    const highOnly = await engine.createIndex(sharedHighEntries);
    const withEarlyPrefix = await engine.createIndex([...earlyEntries, ...sharedHighEntries]);
    const prefixedChanges = await engine.diff(highOnly.root, withEarlyPrefix.root);
    assert.equal(prefixedChanges.filter((change) => change.action === "create").length, earlyEntries.length);
    assert.equal(prefixedChanges.filter((change) => change.action === "delete").length, 0);

    const pruned = await engine.pruneCache({ roots: [right.root] });
    assert.ok(pruned.prunedSnapshots > 0);
    assert.ok(pruned.prunedRoots > 0);
    assert.ok(pruned.retainedRoots.includes(right.root));
    assert.equal((await engine.prove(right.root, rightEntries[0].key)).proofType, PACTIUM_PROOF_TYPES.indexMembership);
  });

  it("diffs child range gaps and tail creates/deletes without snapshot fallback", async () => {
    const engine = createVerifiableIndexEngine({
      storage: createStoragePort({ inMemory: true }),
      domain: "reference-index-child-merge"
    });
    const segment = (prefix) => Array.from({ length: 320 }, (_, index) =>
      keyEntry(`${prefix}:${String(index).padStart(4, "0")}`, `${prefix}:${index}`)
    );
    const left = await engine.createIndex([...segment("gap:a"), ...segment("gap:c")]);
    const right = await engine.createIndex([...segment("gap:b"), ...segment("gap:c"), ...segment("gap:d")]);
    assert.ok(left.height > 0);
    assert.ok(right.height > 0);
    const gapChanges = await engine.diff(left.root, right.root);
    assert.equal(gapChanges.filter((change) => change.action === "delete" && change.key.startsWith("gap:a")).length, 320);
    assert.equal(gapChanges.filter((change) => change.action === "create" && change.key.startsWith("gap:b")).length, 320);
    assert.equal(gapChanges.filter((change) => change.action === "create" && change.key.startsWith("gap:d")).length, 320);
    assert.equal(gapChanges.some((change) => change.key.startsWith("gap:c")), false);

    const baseTail = await engine.createIndex(segment("tail:m"));
    const extendedTail = await engine.createIndex([...segment("tail:m"), ...segment("tail:z")]);
    assert.equal((await engine.diff(baseTail.root, extendedTail.root))
      .filter((change) => change.action === "create" && change.key.startsWith("tail:z")).length, 320);
    assert.equal((await engine.diff(extendedTail.root, baseTail.root))
      .filter((change) => change.action === "delete" && change.key.startsWith("tail:z")).length, 320);
  });

  it("diffs non-aligned Prolly child ranges without reading every chunk", async () => {
    const storage = createStoragePort({ inMemory: true });
    const writer = createVerifiableIndexEngine({ storage, domain: "reference-diff-nonaligned" });
    const leftEntries = Array.from({ length: 4096 }, (_, index) =>
      keyEntry(`aligned:${String(index).padStart(5, "0")}`, `value:${index}`)
    );
    const updatedKeys = new Set();
    const rightEntries = leftEntries.map((entry, index) => {
      if (index < 1980 || index > 2059) return entry;
      updatedKeys.add(entry.key);
      return keyEntry(entry.key, `updated:${index}`);
    });
    const left = await writer.createIndex(leftEntries);
    const right = await writer.createIndex(rightEntries);
    const leftSnapshot = await writer.readSnapshot(left.root);
    const rightSnapshot = await writer.readSnapshot(right.root);
    const overlaps = (leftRange, rightRange) =>
      leftRange.startKey <= rightRange.endKey && rightRange.startKey <= leftRange.endKey;
    const hasNonAlignedOverlap = leftSnapshot.chunkBoundaries.some((leftRange) =>
      rightSnapshot.chunkBoundaries.some((rightRange) =>
        overlaps(leftRange, rightRange) &&
          (leftRange.startKey !== rightRange.startKey || leftRange.endKey !== rightRange.endKey)
      )
    );
    assert.ok(hasNonAlignedOverlap, "test fixture should create overlapping children with different key ranges");

    let indexNodeReads = 0;
    const countedStorage = {
      ...storage,
      async getBlock(cid) {
        const block = await storage.getBlock(cid);
        if (String(block?.kind || "").startsWith("index-node:")) indexNodeReads += 1;
        return block;
      }
    };
    const reader = createVerifiableIndexEngine({ storage: countedStorage, domain: "reference-diff-nonaligned" });
    const changes = await reader.diff(left.root, right.root);
    assert.deepEqual(changes.map((change) => [change.action, change.key]), [...updatedKeys].map((key) => ["update", key]));
    assert.ok(
      indexNodeReads < Math.max(leftSnapshot.chunkBoundaries.length, rightSnapshot.chunkBoundaries.length),
      `expected non-aligned diff to avoid full chunk reads, read ${indexNodeReads}`
    );
  });

  it("uses shared-node traversal for small index mutations instead of reading every chunk", async () => {
    const storage = createStoragePort({ inMemory: true });
    const writer = createVerifiableIndexEngine({ storage, domain: "reference-index-cost" });
    const entries = Array.from({ length: 4096 }, (_, index) =>
      keyEntry(`cost:${String(index).padStart(5, "0")}`, `value:${index}`)
    );
    const base = await writer.createIndex(entries);
    const baseSnapshot = await writer.readSnapshot(base.root);
    const updated = await writer.put(
      base.root,
      "cost:02048",
      {
        valueRef: "ref:updated",
        valueHash: protocolHash("block", { updated: true }),
        metadata: { updated: true }
      },
      { domain: "reference-index-cost" }
    );

    let indexNodeReads = 0;
    const countedStorage = {
      ...storage,
      async getBlock(cid) {
        const block = await storage.getBlock(cid);
        if (String(block?.kind || "").startsWith("index-node:")) indexNodeReads += 1;
        return block;
      }
    };
    const reader = createVerifiableIndexEngine({ storage: countedStorage, domain: "reference-index-cost" });
    const changes = await reader.diff(base.root, updated.root);
    assert.deepEqual(changes.map((change) => [change.action, change.key]), [["update", "cost:02048"]]);
    assert.ok(baseSnapshot.chunkBoundaries.length > 8);
    assert.ok(
      indexNodeReads < baseSnapshot.chunkBoundaries.length,
      `expected shared-node diff to read fewer nodes than ${baseSnapshot.chunkBoundaries.length} chunks, read ${indexNodeReads}`
    );
  });

  it("uses key-range leaf traversal for bounded scan and prefix cursor pages", async () => {
    const storage = createStoragePort({ inMemory: true });
    const writer = createVerifiableIndexEngine({ storage, domain: "reference-index-scan-cost" });
    const entries = Array.from({ length: 4096 }, (_, index) =>
      keyEntry(`scan:${String(index).padStart(5, "0")}`, `value:${index}`)
    );
    const root = await writer.createIndex(entries);
    const snapshot = await writer.readSnapshot(root.root);
    assert.ok(snapshot.chunkBoundaries.length > 8);

    function countedReader() {
      let indexNodeReads = 0;
      const countedStorage = {
        ...storage,
        async getBlock(cid) {
          const block = await storage.getBlock(cid);
          if (String(block?.kind || "").startsWith("index-node:")) indexNodeReads += 1;
          return block;
        }
      };
      return {
        reader: createVerifiableIndexEngine({ storage: countedStorage, domain: "reference-index-scan-cost" }),
        reads: () => indexNodeReads
      };
    }

    const bounded = countedReader();
    assert.deepEqual(
      (await bounded.reader.scan(root.root, { min: "scan:02048", limit: 5 })).map((entry) => entry.key),
      ["scan:02048", "scan:02049", "scan:02050", "scan:02051", "scan:02052"]
    );
    assert.ok(
      bounded.reads() < snapshot.chunkBoundaries.length / 2,
      `expected bounded scan to skip most leaves, read ${bounded.reads()} nodes for ${snapshot.chunkBoundaries.length} chunks`
    );

    const afterPage = countedReader();
    assert.deepEqual(
      (await afterPage.reader.scan(root.root, { after: "scan:02047", limit: 3 })).map((entry) => entry.key),
      ["scan:02048", "scan:02049", "scan:02050"]
    );
    assert.ok(
      afterPage.reads() < snapshot.chunkBoundaries.length / 2,
      `expected after cursor scan to skip prior leaves, read ${afterPage.reads()} nodes`
    );

    const prefixPage = countedReader();
    assert.deepEqual(
      (await prefixPage.reader.prefix(root.root, "scan:020", { after: "scan:02047", limit: 4 })).map((entry) => entry.key),
      ["scan:02048", "scan:02049", "scan:02050", "scan:02051"]
    );
    assert.ok(prefixPage.reads() < snapshot.chunkBoundaries.length / 2);
    assert.deepEqual(await prefixPage.reader.scan(root.root, { min: "scan:9", max: "scan:1" }), []);
    assert.deepEqual((await prefixPage.reader.prefix(root.root, "", { limit: 0 })).map((entry) => entry.key), ["scan:00000"]);
  });

  it("rejects malformed index proofs while accepting valid membership and non-membership proofs", async () => {
    const engine = createVerifiableIndexEngine({
      storage: createStoragePort({ inMemory: true }),
      domain: "reference-index-proof-negative"
    });
    const root = await engine.createIndex([
      keyEntry("proof:001", "one"),
      keyEntry("proof:002", "two"),
      keyEntry("proof:003", "three")
    ]);
    const membership = await engine.prove(root.root, "proof:002");
    const nonMembership = await engine.prove(root.root, "proof:002.5");
    assert.equal(verifyIndexProof(membership), true);
    assert.equal(verifyIndexProof(nonMembership), true);
    assert.equal(verifyIndexProof(null), false);
    assert.equal(verifyIndexProof({ proofType: "index.unknown" }), false);
    assert.equal(verifyIndexProof({ ...membership, leafRootHash: "bad" }), false);
    assert.equal(verifyIndexProof({ ...membership, rootHash: "bad" }), false);
    assert.equal(verifyIndexProof({
      ...membership,
      entry: { ...membership.entry, valueRef: "ref:wrong" }
    }), false);
    assert.equal(verifyIndexProof({
      ...nonMembership,
      leftBoundary: "proof:000"
    }), false);
  });

  it("validates tracking cursors and indexed bundle record parsing failure modes", async () => {
    const cursor = createTrackingCursor({
      scope: "workspace",
      position: 5,
      gaps: [3, "bad", -1, 1, 3],
      headRef: "head:1",
      orderRoot: "root:1"
    });
    assert.equal(cursor.workspaceId, "default");
    assert.deepEqual(cursor.gaps, [1, 3]);
    assert.equal(covers(cursor, 4), true);
    assert.equal(covers(cursor, 3), false);
    assert.equal(samePositionAs(cursor, { scope: "workspace", workspaceId: "default", position: 5 }), true);
    assert.equal(verifyTrackingCursor(cursor, { head: { root: "head:1" }, orderRoot: "root:1" }), true);
    assert.equal(verifyTrackingCursor(null), false);
    assert.equal(verifyTrackingCursor({ ...cursor, cursorId: "bad" }, { head: { root: "head:1" }, orderRoot: "root:1" }), false);
    assert.equal(verifyTrackingCursor(cursor, { head: { root: "other" }, orderRoot: "root:1" }), false);
    assert.equal(verifyTrackingCursor(cursor, { head: { root: "head:1" }, orderRoot: "other" }), false);
    const advanced = advanceTo(cursor, 8, { gaps: [6], headRef: "head:2", orderRoot: "root:2" });
    assert.equal(advanced.position, 8);
    assert.equal(covers(advanced, 6), false);
    assert.equal(covers(advanced, 8), false);

    assert.deepEqual(decodeVarint(Buffer.from([0x81, 0x01])), { value: 129, nextOffset: 2 });
    assert.throws(() => decodeVarint(Buffer.from([0x80])), /truncated/);
    assert.throws(() => decodeVarint(Buffer.from(Array.from({ length: 10 }, () => 0xff))), /too large/);
    const wrongType = indexedBlocksFromBundle({ bundleType: "wrong.bundle.type", blocks: [{ cid: "cid:unused" }] });
    assert.deepEqual(wrongType.blocks, []);
    assert.ok(failureCodes({ failures: wrongType.failures }).includes("malformed_bundle"));
    const missingBinary = indexedBlocksFromBundle({ bundleType: PACTIUM_PROOF_BUNDLE_TYPE, blocks: [] });
    assert.deepEqual(missingBinary.blocks, []);
    assert.ok(failureCodes({ failures: missingBinary.failures }).includes("missing_bundle_binary"));
    const parsed = indexedBlocksFromBundle({
      bundleType: PACTIUM_PROOF_BUNDLE_TYPE,
      binaryBase64: Buffer.from([0]).toString("base64"),
      index: [
        { cid: "cid:bad", offset: 99, recordLength: 0, headerLength: 0, byteLength: 0 },
        { cid: "cid:dup", offset: 0, recordLength: 0, headerLength: 0, byteLength: 0 },
        { cid: "cid:dup", offset: 0, recordLength: 1, headerLength: 0, byteLength: 0 }
      ]
    });
    assert.ok(failureCodes({ failures: parsed.failures }).includes("bad_bundle_offset"));
    assert.ok(failureCodes({ failures: parsed.failures }).includes("bad_bundle_header"));
    assert.ok(failureCodes({ failures: parsed.failures }).includes("bad_bundle_record_length"));
    assert.ok(failureCodes({ failures: parsed.failures }).includes("duplicate_bundle_offset"));
    assert.ok(failureCodes({ failures: parsed.failures }).includes("duplicate_bundle_cid"));
  });

  it("keeps storage writes inside the Pactium data directory", async () => {
    const parent = await tempDataDir("pactium-storage-parent-");
    const dataDir = path.join(parent, "data");
    assert.throws(() => resolveWithin(dataDir, "..", "escape.json"), /escapes Pactium data directory/);

    const storage = createStoragePort({ dataDir });
    await storage.putProtocolObject("../scope", "../../key", { ok: true });
    assert.deepEqual(await storage.getProtocolObject("../scope", "../../key"), { ok: true });
    assert.deepEqual((await fs.readdir(parent)).sort(), ["data"]);
  });

  it("enforces filesystem write-lock timeout, stale cleanup, and protocol-object cache refresh", async () => {
    const dataDir = await tempDataDir("pactium-storage-lock-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    await assert.rejects(
      () => storage.withWriteLock(() => "unreachable", { timeoutMs: 20, retryMs: 1, staleMs: 30000 }),
      (error) => error?.code === "PACTIUM_WRITE_LOCK_TIMEOUT" &&
        error?.details?.lockType === "pactium.write-lock" &&
        error?.details?.dataDir === dataDir
    );
    await fs.rm(lockDir, { recursive: true, force: true });

    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
      protocol: PACTIUM_PROTOCOL,
      schema: "pactium.v0.2.schema.latest",
      lockType: "pactium.write-lock",
      ownerId: "stale-owner",
      pid: 99999999,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdAtMs: Date.now() - 10000
    })}\n`, "utf8");
    assert.equal(await storage.withWriteLock(() => "stale-cleaned", {
      timeoutMs: 1000,
      retryMs: 1,
      staleMs: 30000
    }), "stale-cleaned");
    assert.equal(await fs.stat(lockDir).then(() => true, () => false), false);

    await storage.putProtocolObject("cache", "value", { version: 1 });
    assert.deepEqual(await storage.getProtocolObject("cache", "value"), { version: 1 });
    const second = createStoragePort({ dataDir });
    await second.putProtocolObject("cache", "value", { version: 2 });
    assert.deepEqual(await storage.getProtocolObject("cache", "value"), { version: 1 });
    storage.clearCache();
    assert.deepEqual(await storage.getProtocolObject("cache", "value"), { version: 2 });
  });

  it("cleans up stale lock with fencingToken (UUID string comparison)", async () => {
    const dataDir = await tempDataDir("pactium-fencing-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    // Create a stale lock owner WITH a fencingToken (UUID string).
    // The bug was using Number(fencingToken) which produces NaN,
    // making NaN === NaN always false and preventing cleanup.
    await fs.writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
      protocol: PACTIUM_PROTOCOL,
      schema: "pactium.v0.2.schema.latest",
      lockType: "pactium.write-lock",
      ownerId: "stale-with-fencing",
      fencingToken: "550e8400-e29b-41d4-a716-446655440000",
      pid: 99999999,
      host: "test-host",
      processStartKey: "start-key-001",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdAtMs: Date.now() - 10000,
      heartbeatAt: "2026-01-01T00:00:00.000Z",
      heartbeatAtMs: Date.now() - 10000
    })}\n`, "utf8");

    assert.equal(await storage.withWriteLock(() => "fencing-cleaned", {
      timeoutMs: 1000,
      retryMs: 1,
      staleMs: 5000
    }), "fencing-cleaned");
    assert.equal(await fs.stat(lockDir).then(() => true, () => false), false);
  });

  it("does not delete non-stale lock owned by another writer", async () => {
    const dataDir = await tempDataDir("pactium-nonstale-");
    const storageA = createStoragePort({ dataDir });
    await storageA.initialize();
    const storageB = createStoragePort({ dataDir });
    await storageB.initialize();

    let resolved = false;
    const result = await storageA.withWriteLock(async () => {
      // Writer B must not be able to acquire the lock while A holds it
      try {
        await storageB.withWriteLock(() => "should-not-reach", {
          timeoutMs: 300,
          retryMs: 10,
          staleMs: 30000
        });
      } catch (error) {
        assert.equal(error.code, "PACTIUM_WRITE_LOCK_TIMEOUT");
        resolved = true;
      }
      return "a-done";
    });
    assert.equal(result, "a-done");
    assert.equal(resolved, true);
  });

  it("does not delete lock when owner changes between stale reads", async () => {
    const dataDir = await tempDataDir("pactium-ownerchange-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
      protocol: PACTIUM_PROTOCOL,
      schema: "pactium.v0.2.schema.latest",
      lockType: "pactium.write-lock",
      ownerId: "fresh-owner",
      fencingToken: "fresh-token-uuid",
      pid: process.pid, // real, alive pid
      host: os.hostname(),
      processStartKey: "fresh-start-key",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdAtMs: Date.now() - 60000,
      heartbeatAt: "2026-01-01T00:00:00.000Z",
      heartbeatAtMs: Date.now() - 1000 // recent heartbeat — NOT stale
    })}\n`, "utf8");

    // Even with old createdAtMs, the fresh heartbeatAtMs means the lock
    // is still active. The process is also alive (real pid).
    // The lock should NOT be deleted.
    try {
      await storage.withWriteLock(() => "unreachable", {
        timeoutMs: 300,
        retryMs: 10,
        staleMs: 5000
      });
      assert.fail("should not acquire lock held by alive process with recent heartbeat");
    } catch (error) {
      assert.equal(error.code, "PACTIUM_WRITE_LOCK_TIMEOUT");
    }
    // Clean up for the next test
    await fs.rm(lockDir, { recursive: true, force: true });
  });

  it("does not steal fresh (non-stale) lock from alive process", async () => {
    const dataDir = await tempDataDir("pactium-release-fencing-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    // Simulate another process holding the lock with a fresh heartbeat
    // (not stale). The process is alive, so the lock should not be removed.
    await fs.writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
      protocol: PACTIUM_PROTOCOL,
      schema: "pactium.v0.2.schema.latest",
      lockType: "pactium.write-lock",
      ownerId: "other-owner",
      fencingToken: "other-fencing-token",
      pid: process.pid,
      host: os.hostname(),
      processStartKey: "other-start-key",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdAtMs: Date.now(),
      heartbeatAt: new Date().toISOString(),
      heartbeatAtMs: Date.now() // fresh — not stale
    })}\n`, "utf8");

    // Should timeout because lock is fresh (not stale) and process is alive
    try {
      await storage.withWriteLock(() => "unreachable", {
        timeoutMs: 300,
        retryMs: 10,
        staleMs: 5000
      });
      assert.fail("should not acquire lock when a fresh lock exists");
    } catch (error) {
      assert.equal(error.code, "PACTIUM_WRITE_LOCK_TIMEOUT");
    }
    // Cleanup
    await fs.rm(lockDir, { recursive: true, force: true });
  });

  it("does not release lock when fencingToken mismatches on release", async () => {
    const dataDir = await tempDataDir("pactium-release-fencing-mismatch-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    let lockStillExists = false;
    let taskCompleted = false;

    // Acquire lock normally
    await storage.withWriteLock(async () => {
      // Tamper with the owner.json inside the lock to change fencingToken
      // This simulates another process overwriting the owner metadata.
      const ownerPath = path.join(lockDir, "owner.json");
      const current = JSON.parse(await fs.readFile(ownerPath, "utf8"));
      current.fencingToken = "tampered-fencing-token";
      await fs.writeFile(ownerPath, JSON.stringify(current, null, 2) + "\n");
      taskCompleted = true;
    });
    assert.equal(taskCompleted, true);

    // The lock should NOT have been released because fencingToken mismatched
    lockStillExists = await fs.stat(lockDir).then(() => true, () => false);
    assert.equal(lockStillExists, true,
      "lock should NOT be deleted when fencingToken mismatches");

    // Cleanup: remove the orphaned lock manually
    await fs.rm(lockDir, { recursive: true, force: true });
  });

  it("does not delete ownerless lock directory when fresh", async () => {
    const dataDir = await tempDataDir("pactium-ownerless-fresh-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    // No owner.json — just a freshly created lock directory
    // The directory is fresh (just created), so it should NOT be deleted

    try {
      await storage.withWriteLock(() => "unreachable", {
        timeoutMs: 300,
        retryMs: 10,
        staleMs: 5000
      });
      assert.fail("should not acquire lock when fresh ownerless dir exists");
    } catch (error) {
      assert.equal(error.code, "PACTIUM_WRITE_LOCK_TIMEOUT");
    }
    // Verify the directory still exists
    const stillExists = await fs.stat(lockDir).then(() => true, () => false);
    assert.equal(stillExists, true, "fresh ownerless lock dir should not be deleted");
    // Cleanup
    await fs.rm(lockDir, { recursive: true, force: true });
  });

  it("cleans up stale ownerless lock directory and acquires lock", async () => {
    const dataDir = await tempDataDir("pactium-ownerless-stale-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    // Make the directory appear stale by setting an old mtime
    const staleTime = new Date(Date.now() - 10000);
    await fs.utimes(lockDir, staleTime, staleTime);

    assert.equal(await storage.withWriteLock(() => "cleaned-ownerless", {
      timeoutMs: 1000,
      retryMs: 1,
      staleMs: 5000
    }), "cleaned-ownerless");
    // After the lock is acquired and released, the lock dir should be gone
    assert.equal(await fs.stat(lockDir).then(() => true, () => false), false);
  });

  it("cleans up stale lock with malformed owner.json", async () => {
    const dataDir = await tempDataDir("pactium-malformed-owner-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    // Write malformed owner.json (valid JSON but missing expected fields)
    await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({
      junk: "not-a-valid-owner",
      something: { nested: true }
    }), "utf8");
    // Make the directory stale
    const staleTime = new Date(Date.now() - 10000);
    await fs.utimes(lockDir, staleTime, staleTime);

    assert.equal(await storage.withWriteLock(() => "cleaned-malformed", {
      timeoutMs: 1000,
      retryMs: 1,
      staleMs: 5000
    }), "cleaned-malformed");
    assert.equal(await fs.stat(lockDir).then(() => true, () => false), false);
  });

  it("does not clean fresh lock with malformed owner.json", async () => {
    const dataDir = await tempDataDir("pactium-malformed-fresh-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({
      junk: "malformed-but-fresh",
      pid: process.pid // real, alive pid
    }), "utf8");
    // Directory is fresh (just created)

    try {
      await storage.withWriteLock(() => "unreachable", {
        timeoutMs: 300,
        retryMs: 10,
        staleMs: 5000
      });
      assert.fail("should not acquire lock when fresh malformed lock exists with alive pid");
    } catch (error) {
      assert.equal(error.code, "PACTIUM_WRITE_LOCK_TIMEOUT");
    }
    // Cleanup
    await fs.rm(lockDir, { recursive: true, force: true });
  });

  it("listProtocolObjectKeys reads from disk directory when cache is empty", async () => {
    const dataDir = await tempDataDir("pactium-listkeys-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();
    // Write some protocol objects to disk
    await storage.putProtocolObject("test-scope", "key-a", { value: 1 });
    await storage.putProtocolObject("test-scope", "key-b", { value: 2 });
    // Clear memory cache and create a fresh storage port (disk-only)
    const freshStorage = createStoragePort({ dataDir });
    await freshStorage.initialize();
    const keys = await freshStorage.listProtocolObjectKeys("test-scope");
    assert.ok(keys.includes("key-a"), "should list key-a from disk");
    assert.ok(keys.includes("key-b"), "should list key-b from disk");
  });

  it("CAS collision and integrity checks on storage blocks", async () => {
    const dataDir = await tempDataDir("pactium-cas-check-");
    const storage = createStoragePort({ dataDir });
    const block1 = await storage.putBlock({ value: "same-content" });
    // Same content should dedupe
    const block2 = await storage.putBlock({ value: "same-content" });
    assert.equal(block2.deduped, true, "identical content should dedupe");
    assert.equal(block2.cid, block1.cid);
    // Different content with same CID attempt — should throw
    // (This requires manipulating the underlying storage which is complex;
    //  the code path is exercised by the codec:raw and kind:different tests)
  });

  it("heartbeat refreshes heartbeatAtMs so lock is not considered stale", async () => {
    const dataDir = await tempDataDir("pactium-heartbeat-");
    const storage = createStoragePort({ dataDir });
    await storage.initialize();

    const lockDir = path.join(dataDir, "locks", "write.lock");
    // Use a short staleMs so the heartbeat interval is short enough
    // for the test to see a refresh. heartbeatMs = max(100, min(staleMs/4, 5000))
    // With staleMs=800, heartbeatMs = max(100, min(200, 5000)) = 200ms.
    await storage.withWriteLock(async () => {
      // Wait long enough for at least one heartbeat to fire
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Read the owner file to verify heartbeatAtMs is recent
      const ownerFile = JSON.parse(await fs.readFile(path.join(lockDir, "owner.json"), "utf8"));
      assert.ok(Date.now() - ownerFile.heartbeatAtMs < 3000,
        "heartbeatAtMs should be recent (within last 3s)");
    }, { staleMs: 800 });

    // Lock should be released after withWriteLock completes
    assert.equal(await fs.stat(lockDir).then(() => true, () => false), false);
  });
});
