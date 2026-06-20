import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";

import {
  PACTIUM_PROOF_BUNDLE_TYPE,
  PACTIUM_PROOF_TYPES,
  PACTIUM_PROTOCOL,
  PACTIUM_PROTOCOL_PROFILE,
  canonicalDecode,
  canonicalEncode,
  canonicalString,
  advanceTo,
  createAppendCondition,
  cidForBytes,
  cidForCanonical,
  createLedgerConsistencyProof,
  createLedgerInclusionProof,
  createLedgerTransparencyLog,
  createMaintenanceTaskEngine,
  createPactium,
  createRepairPlanner,
  createDefaultProofVerifierRegistry,
  createStoragePort,
  createTrackingCursor,
  createVerifierManifest,
  createVerifiableIndexEngine,
  createVerificationFailure,
  covers,
  defaultPactiumDataDir,
  emptyTreeHash,
  envelopeSigningHash,
  ledgerLeafHash,
  ledgerNodeHash,
  ledgerHeadSigningPayload,
  protocolHash,
  protocolHashHex,
  resolveDataDir,
  resolveWithin,
  runPactiumQualityGateProfile,
  samePositionAs,
  signLedgerHead,
  verifyLedgerHeadSignature,
  verifyLedgerConsistencyProof,
  verifyLedgerInclusionProof,
  verifyIndexProof,
  verifyProofBundle,
  verifyProofEnvelope,
  verifyTrackingCursor
} from "../../src/index.js";
import {
  LICOLITE_SIGNATURE_EXTENSION,
  LICOLITE_POLICY_EXTENSION,
  LICOLITE_WORKSPACE_EFFECT_EXTENSION,
  createLicoLiteAspect,
  createLicoLiteSigner,
  licoLitePolicyExtensionValue,
  licoLiteWorkspaceEffectExtensionValue,
  recordLicoLiteWorkspaceOperation,
  verifyLicoLiteBundle,
  verifyLicoLiteEnvelope
} from "../../src/aspects/licolite/index.js";
import { materializeEvidenceExtension } from "../../src/aspects/licolite/evidence.js";
import { assertAppendCondition } from "../../src/core/append-condition.js";
import { createPactiumHttpServer, startPactiumHttpServer } from "../../src/http.js";
import { cidFromHex, hexFromCid, hexToBytes } from "../../src/protocol/hashing.js";
import { createIndexedBundleResolver, decodeVarint, indexedBlocksFromBundle } from "../../src/proof/bundle-format.js";

const execFileAsync = promisify(execFile);
const tempDirs = [];

async function tempDataDir(prefix = "pactium-test-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function requestJson({ port, method = "GET", requestPath = "/", body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: requestPath,
      headers: payload
        ? {
            "content-type": "application/json",
            "content-length": payload.length
          }
        : {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
        });
      });
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe("Pactium proof-first root API", () => {
  it("canonicalizes values deterministically and separates protocol hash domains", () => {
    const left = { b: true, a: [1, null, "x"], bytes: Buffer.from("abc") };
    const right = { bytes: new Uint8Array(Buffer.from("abc")), a: [1, null, "x"], b: true };
    assert.equal(canonicalString(left), canonicalString(right));
    assert.deepEqual(canonicalDecode(canonicalEncode(left)), canonicalDecode(canonicalEncode(right)));
    assert.notEqual(canonicalString({ a: 1 }), canonicalString({ a: 2 }));
    assert.match(cidForCanonical(left), /^cid:sha256:[a-f0-9]{64}$/);
    assert.match(cidForBytes(), /^cid:sha256:[a-f0-9]{64}$/);
    assert.equal(hexToBytes().length, 0);
    assert.equal(cidFromHex("abc"), "cid:sha256:abc");
    assert.equal(hexFromCid("cid:sha256:abc"), "abc");
    assert.equal(hexFromCid("abc"), "");
    assert.notEqual(protocolHash("operation.intent", { same: true }), protocolHash("operation.outcome", { same: true }));
    assert.match(protocolHashHex("", { generic: true }), /^[a-f0-9]{64}$/);
    assert.match(protocolHashHex("proof.envelope", left), /^[a-f0-9]{64}$/);
    assert.match(protocolHashHex("raw-buffer", Buffer.from("raw")), /^[a-f0-9]{64}$/);
    assert.deepEqual(canonicalDecode(Buffer.from(canonicalString({ from: "string" }))), { from: "string" });
    assert.throws(() => canonicalString({ $bytes: "YQ==" }), /reserves \$bytes/);
    assert.throws(() => canonicalEncode(Number.NaN), /finite numbers/);
  });

  it("persists latest-schema-only storage blocks and rejects historical directories", async () => {
    const dataDir = await tempDataDir();
    const storage = createStoragePort({ dataDir });
    const block = await storage.putBlock({ value: "alpha" });
    assert.match(block.cid, /^cid:sha256:/);
    assert.equal(await storage.hasBlock(block.cid), true);
    const reloaded = createStoragePort({ dataDir });
    const fetched = await reloaded.getBlock(block.cid);
    assert.equal(fetched.payloadHash, block.payloadHash);
    const walk = await reloaded.walk(block.cid);
    assert.equal(walk.blockCount, 1);
    await reloaded.putProtocolObject("test", "object", { ok: true });
    assert.deepEqual(await reloaded.getProtocolObject("test", "object"), { ok: true });
    await reloaded.putProtocolObject("..", "pactium-manifest", { escaped: true });
    assert.deepEqual(await reloaded.getProtocolObject("default", "pactium-manifest"), { escaped: true });
    const manifest = JSON.parse(await fs.readFile(path.join(dataDir, "pactium-manifest.json"), "utf8"));
    assert.equal(manifest.latestSchemaOnly, true);
    assert.equal(resolveDataDir("~/pactium-unit").startsWith(os.homedir()), true);

    const historicalDir = await tempDataDir("pactium-historical-");
    await fs.mkdir(path.join(historicalDir, "operation-ledger"), { recursive: true });
    const historicalStorage = createStoragePort({ dataDir: historicalDir });
    await assert.rejects(() => historicalStorage.initialize(), /no data migration/);
  });

  it("creates and verifies ledger transparency log inclusion and consistency proofs", async () => {
    const baseStorage = createStoragePort({ inMemory: true });
    let ledgerNodeReads = 0;
    const ledgerStorage = {
      ...baseStorage,
      async getProtocolObject(scope, key, fallback) {
        if (scope === "ledger-node") ledgerNodeReads += 1;
        return baseStorage.getProtocolObject(scope, key, fallback);
      }
    };
    const ledger = createLedgerTransparencyLog({ storage: ledgerStorage });
    const emptyHead = await ledger.head();
    assert.equal(emptyHead.rootHash, emptyTreeHash());
    const first = await ledger.append({ factType: "operation.intent", value: "a" });
    const second = await ledger.append({ factType: "operation.outcome", value: "b" });
    assert.equal(first.entry.index, 0);
    assert.equal(second.entry.index, 1);
    assert.equal(verifyLedgerInclusionProof({ head: second.head, proof: second.inclusionProof }), true);
    assert.equal(second.inclusionProof.proofType, PACTIUM_PROOF_TYPES.ledgerInclusion);
    assert.equal(second.consistencyProof.proofType, PACTIUM_PROOF_TYPES.ledgerConsistency);
    assert.equal(Object.hasOwn(second.consistencyProof, "oldLeafHashes"), false);
    assert.equal(Object.hasOwn(second.consistencyProof, "newLeafHashes"), false);
    assert.equal(verifyLedgerConsistencyProof({
      oldHead: first.head,
      newHead: second.head,
      proof: second.consistencyProof
    }), true);
    assert.equal((await ledger.getLeaf(1)).eventId, second.entry.eventId);
    assert.equal((await ledger.getHead(second.head.headId)).headId, second.head.headId);
    assert.equal((await ledger.compactRange()).size, 2);
    assert.notEqual(ledgerLeafHash({ a: 1 }), ledgerNodeHash(ledgerLeafHash({ a: 1 }), ledgerLeafHash({ b: 2 })));
    const manualInclusion = createLedgerInclusionProof({
      leafHashes: [first.entry.leafHash, second.entry.leafHash],
      index: 0,
      leaf: first.entry.leaf
    });
    assert.equal(verifyLedgerInclusionProof({ head: second.head, proof: manualInclusion }), true);
    assert.equal(verifyLedgerInclusionProof({
      head: second.head,
      proof: {
        ...manualInclusion,
        auditPath: manualInclusion.auditPath.map((item) => ({ ...item, side: item.side === "left" ? "right" : "left" }))
      }
    }), false);
    const manualConsistency = createLedgerConsistencyProof({
      oldHead: first.head,
      newEntries: await ledger.entries()
    });
    assert.equal(verifyLedgerConsistencyProof({ oldHead: first.head, newHead: second.head, proof: manualConsistency }), true);
    const registry = createDefaultProofVerifierRegistry();
    assert.equal(registry.get(PACTIUM_PROOF_TYPES.ledgerInclusion)(manualInclusion, { head: second.head }), true);
    assert.equal(registry.get(PACTIUM_PROOF_TYPES.ledgerConsistency)(manualConsistency, {
      oldHead: first.head,
      newHead: second.head
    }), true);
    assert.equal(registry.get(PACTIUM_PROOF_TYPES.ledgerInclusion)(manualInclusion), false);
    assert.equal(registry.get(PACTIUM_PROOF_TYPES.ledgerConsistency)(manualConsistency), false);
    assert.equal(createDefaultProofVerifierRegistry({
      "custom.always": () => true
    }).get("custom.always")({ proofType: "custom.always" }), true);
    assert.equal(await ledger.getHead("missing-head"), null);
    for (let index = 0; index < 6; index += 1) {
      const appended = await ledger.append({ factType: "operation.intent", value: `stored-node-${index}` });
      if (index === 0) assert.equal(appended.previousHead.headId, second.head.headId);
    }
    assert.ok(ledgerNodeReads > 0);
    const storedInclusion = await ledger.createInclusionProof(0);
    assert.equal(verifyLedgerInclusionProof({ head: await ledger.head(), proof: storedInclusion }), true);
    await assert.rejects(() => ledger.createInclusionProof(999), /out of range/);
    const storedConsistency = await ledger.createConsistencyProof(second.head);
    assert.equal(verifyLedgerConsistencyProof({
      oldHead: second.head,
      newHead: await ledger.head(),
      proof: storedConsistency
    }), true);
    const nonPowerLedger = createLedgerTransparencyLog({ storage: createStoragePort({ inMemory: true }) });
    const nonPowerHeads = [];
    for (let index = 0; index < 5; index += 1) {
      nonPowerHeads.push((await nonPowerLedger.append({ factType: "operation.intent", value: `non-power-${index}` })).head);
    }
    const nonPowerProof = await nonPowerLedger.createConsistencyProof(nonPowerHeads[2], nonPowerHeads[4]);
    assert.equal(verifyLedgerConsistencyProof({
      oldHead: nonPowerHeads[2],
      newHead: nonPowerHeads[4],
      proof: nonPowerProof
    }), true);
    for (let index = 5; index < 7; index += 1) {
      nonPowerHeads.push((await nonPowerLedger.append({ factType: "operation.intent", value: `non-power-${index}` })).head);
    }
    const nonPowerInclusion = await nonPowerLedger.createInclusionProof(0, nonPowerHeads[6]);
    assert.equal(verifyLedgerInclusionProof({ head: nonPowerHeads[6], proof: nonPowerInclusion }), true);
    const failStorageBase = createStoragePort({ inMemory: true });
    let failLeafTwo = false;
    let failLedgerNodes = false;
    const failStorage = {
      ...failStorageBase,
      async getProtocolObject(scope, key, fallback) {
        if (failLeafTwo && scope === "ledger-leaf" && key === "2") return null;
        if (failLedgerNodes && scope === "ledger-node") return null;
        return failStorageBase.getProtocolObject(scope, key, fallback);
      }
    };
    const failLedger = createLedgerTransparencyLog({ storage: failStorage });
    const failHeads = [];
    for (let index = 0; index < 3; index += 1) {
      failHeads.push((await failLedger.append({ factType: "operation.intent", value: `fail-store-${index}` })).head);
    }
    failLeafTwo = true;
    await assert.rejects(() => failLedger.createInclusionProof(0), /Ledger leaf missing/);
    failLeafTwo = false;
    failHeads.push((await failLedger.append({ factType: "operation.intent", value: "fail-store-3" })).head);
    failLedgerNodes = true;
    await assert.rejects(() => failLedger.createConsistencyProof(failHeads[1], failHeads[3]), /Ledger node missing/);
    const moreEntries = await ledger.entries();
    const consistencyFromThree = createLedgerConsistencyProof({
      oldHead: { protocol: PACTIUM_PROTOCOL, size: 3, rootHash: createLedgerConsistencyProof({
        oldHead: { protocol: PACTIUM_PROTOCOL, size: 0, rootHash: emptyTreeHash() },
        newEntries: moreEntries.slice(0, 3)
      }).newRootHash },
      newEntries: moreEntries.slice(0, 5)
    });
    assert.equal(consistencyFromThree.proofType, PACTIUM_PROOF_TYPES.ledgerConsistency);
    const customKeys = crypto.generateKeyPairSync("ed25519");
    const customManifest = createVerifierManifest({
      signers: [{
        signerId: "custom-ledger-signer",
        algorithm: "ed25519",
        publicKey: customKeys.publicKey.export({ type: "spki", format: "pem" }),
        roles: ["ledger-head"]
      }]
    });
    const customLedger = createLedgerTransparencyLog({
      storage: createStoragePort({ inMemory: true }),
      signer: {
        signerId: "custom-ledger-signer",
        privateKey: customKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
        publicKey: customKeys.publicKey.export({ type: "spki", format: "pem" }),
        manifest: customManifest
      }
    });
    const customAppend = await customLedger.append({ factType: "operation.intent", custom: true });
    assert.equal((await customLedger.verifierManifest()).manifestId, customManifest.manifestId);
    assert.equal(verifyLedgerHeadSignature(customAppend.head, customManifest).ok, true);
    const unsignedLedger = createLedgerTransparencyLog({ storage: createStoragePort({ inMemory: true }), signer: false });
    const unsignedAppend = await unsignedLedger.append({ factType: "operation.intent", unsigned: true });
    assert.equal(Boolean(unsignedAppend.head.signatureRef), false);
    assert.equal(await unsignedLedger.verifierManifest(), null);
    const persistedSignerStorage = createStoragePort({ dataDir: await tempDataDir("pactium-ledger-signer-") });
    const persistedSignerLedger = createLedgerTransparencyLog({ storage: persistedSignerStorage });
    const persistedFirst = await persistedSignerLedger.append({ factType: "operation.intent", persisted: 1 });
    const reloadedSignerLedger = createLedgerTransparencyLog({ storage: createStoragePort({ dataDir: persistedSignerStorage.dataDir }) });
    const persistedSecond = await reloadedSignerLedger.append({ factType: "operation.intent", persisted: 2 });
    assert.equal(persistedSecond.head.verifierManifest.manifestId, persistedFirst.head.verifierManifest.manifestId);
  });

  it("uses one verifiable index engine for membership, non-membership, diff, prefix, scan, put, and delete", async () => {
    const engine = createVerifiableIndexEngine({ storage: createStoragePort({ inMemory: true }), domain: "unit" });
    const shuffled = [
      { key: "c", valueRef: "ref:c", valueHash: protocolHash("block", "c") },
      { key: "a", valueRef: "ref:a", valueHash: protocolHash("block", "a") },
      { key: "b", valueRef: "ref:b", valueHash: protocolHash("block", "b") }
    ];
    const first = await engine.createIndex(shuffled);
    const second = await engine.createIndex([...shuffled].reverse());
    assert.equal(first.root, second.root);
    const proof = await engine.prove(first.root, "b");
    assert.equal(engine.verifyProof(proof), true);
    assert.equal(proof.proofType, PACTIUM_PROOF_TYPES.indexMembership);
    const missing = await engine.prove(first.root, "bb");
    assert.equal(missing.proofType, PACTIUM_PROOF_TYPES.indexNonMembership);
    assert.equal(engine.verifyProof(missing), true);
    assert.equal(verifyIndexProof({ ...proof, rootHash: "0".repeat(64) }), false);
    assert.equal(verifyIndexProof(null), false);
    assert.equal(verifyIndexProof({ proofType: "index.unknown" }), false);
    assert.equal(verifyIndexProof({ ...proof, leafRoot: `cid:sha256:${"f".repeat(64)}` }), false);
    assert.equal(verifyIndexProof({ ...proof, leafRootHash: "f".repeat(64) }), false);
    assert.equal(verifyIndexProof({
      ...proof,
      entry: {
        ...proof.entry,
        valueHash: protocolHash("block", "tampered")
      }
    }), false);
    assert.equal(verifyIndexProof({
      ...proof,
      leafNode: {
        ...proof.leafNode,
        count: 999
      }
    }), false);
    assert.equal(verifyIndexProof({ ...missing, leftBoundary: "zz" }), false);
    assert.equal(verifyIndexProof({ ...missing, rightBoundary: "aa" }), false);
    assert.equal(verifyIndexProof({ ...missing, key: "b" }), false);
    const rootObject = await engine.readIndexRoot(first.root);
    assert.equal(rootObject.root, first.root);
    assert.equal(Object.hasOwn(rootObject, "entries"), false);
    assert.equal((await engine.readNode(first.root)).nodeType, "pactium.index.node");
    const afterPut = await engine.put(first.root, "d", { value: 4 });
    const afterDelete = await engine.delete(afterPut.root, "a");
    assert.equal((await engine.put(first.root, "", { ignored: true })).root, first.root);
    assert.equal((await engine.delete(first.root, "")).root, first.root);
    assert.equal((await engine.get(afterPut.root, "d")).key, "d");
    assert.equal(await engine.get(afterDelete.root, "a"), null);
    assert.deepEqual((await engine.prefix(afterPut.root, "b")).map((entry) => entry.key), ["b"]);
    assert.equal((await engine.scan(afterPut.root)).length, 4);
    assert.equal((await engine.scan(afterPut.root, { min: "z", max: "a", limit: 0 })).length, 0);
    assert.equal((await engine.prefix(afterPut.root, "b", { limit: 0 })).length, 1);
    assert.deepEqual((await engine.diff(first.root, afterDelete.root)).map((entry) => entry.action).sort(), ["create", "delete"]);
    const afterUpdate = await engine.put(first.root, "b", {
      valueRef: "ref:b2",
      valueHash: protocolHash("block", "b2")
    });
    assert.deepEqual((await engine.diff(first.root, afterUpdate.root)).map((entry) => entry.action), ["update"]);
    assert.equal(engine.verifyProof(await engine.prove(first.root, "0")), true);
    assert.equal(engine.verifyProof(await engine.prove(first.root, "z")), true);
    assert.equal((await engine.readIndexRoot("")).count, 0);
    assert.deepEqual((await engine.prefix(first.root)).map((entry) => entry.key), ["a", "b", "c"]);
    const valueRefPut = await engine.put(first.root, "e", {
      valueRef: "ref:e",
      valueHash: protocolHash("block", "e"),
      metadata: { direct: true }
    });
    assert.equal((await engine.get(valueRefPut.root, "e")).valueRef, "ref:e");
    const persistentStorage = createStoragePort({ dataDir: await tempDataDir("pactium-index-reload-") });
    const persistentEngine = createVerifiableIndexEngine({ storage: persistentStorage, domain: "persist" });
    const persisted = await persistentEngine.createIndex([{ key: "k", valueRef: "ref:k", valueHash: protocolHash("block", "k") }]);
    const reloadedEngine = createVerifiableIndexEngine({ storage: createStoragePort({ dataDir: persistentStorage.dataDir }), domain: "persist" });
    assert.equal((await reloadedEngine.get(persisted.root, "k")).key, "k");

    const manyEntries = Array.from({ length: 320 }, (_, index) => ({
      key: `many:${String(index).padStart(4, "0")}`,
      valueRef: `ref:many:${index}`,
      valueHash: protocolHash("block", index)
    }));
    const many = await engine.createIndex(manyEntries, { domain: "many" });
    assert.ok(many.height > 0);
    const manyProof = await engine.prove(many.root, "many:0200");
    assert.equal(engine.verifyProof(manyProof), true);
    const manySnapshot = await engine.readSnapshot(many.root);
    assert.ok(manySnapshot.chunkBoundaries.length > 1);
    const firstLeafMissing = await engine.prove(many.root, `${manySnapshot.chunkBoundaries[0].startKey}.5`);
    const crossLeafFalseProof = structuredClone(firstLeafMissing);
    crossLeafFalseProof.key = manySnapshot.chunkBoundaries[1].startKey;
    crossLeafFalseProof.leftBoundary = firstLeafMissing.containingLeaf.entries.at(-1)?.key || "";
    crossLeafFalseProof.rightBoundary = "";
    assert.equal(Boolean(await engine.get(many.root, crossLeafFalseProof.key)), true);
    assert.equal(engine.verifyProof(crossLeafFalseProof), false);
    const badChildIndexProof = structuredClone(manyProof);
    badChildIndexProof.path[0].childIndex = -1;
    assert.equal(engine.verifyProof(badChildIndexProof), false);
    const badHighChildIndexProof = structuredClone(manyProof);
    badHighChildIndexProof.path[0].childIndex = badHighChildIndexProof.path[0].siblingDescriptors.length;
    assert.equal(engine.verifyProof(badHighChildIndexProof), false);
    const badSiblingDescriptorProof = structuredClone(manyProof);
    badSiblingDescriptorProof.path[0].siblingDescriptors[badSiblingDescriptorProof.path[0].childIndex].root = `cid:sha256:${"e".repeat(64)}`;
    assert.equal(engine.verifyProof(badSiblingDescriptorProof), false);
    const badParentHashProof = structuredClone(manyProof);
    badParentHashProof.path[0].nodeHash = "0".repeat(64);
    assert.equal(engine.verifyProof(badParentHashProof), false);
    const badParentRootProof = structuredClone(manyProof);
    badParentRootProof.path[0].nodeRoot = `cid:sha256:${"d".repeat(64)}`;
    assert.equal(engine.verifyProof(badParentRootProof), false);
    const manyAfterPut = await engine.put(many.root, "many:0400", {
      valueRef: "ref:many:400",
      valueHash: protocolHash("block", 400)
    }, { domain: "many" });
    const manyAfterDelete = await engine.delete(many.root, "many:0000", { domain: "many" });
    assert.equal((await engine.diff(many.root, many.root)).length, 0);
    assert.ok((await engine.diff(many.root, manyAfterPut.root)).some((change) => change.action === "create"));
    assert.ok((await engine.diff(many.root, manyAfterDelete.root)).some((change) => change.action === "delete"));
    const beforeRange = await engine.createIndex(Array.from({ length: 320 }, (_, index) => ({
      key: `aaa:${String(index).padStart(4, "0")}`,
      valueRef: `ref:before:${index}`,
      valueHash: protocolHash("block", `before:${index}`)
    })), { domain: "range" });
    const afterRange = await engine.createIndex(Array.from({ length: 640 }, (_, index) => ({
      key: `zzz:${String(index).padStart(4, "0")}`,
      valueRef: `ref:after:${index}`,
      valueHash: protocolHash("block", `after:${index}`)
    })), { domain: "range" });
    assert.ok((await engine.diff(beforeRange.root, afterRange.root)).some((change) => change.action === "delete"));
    assert.ok((await engine.diff(afterRange.root, beforeRange.root)).some((change) => change.action === "create"));
    const parentCut = await engine.createIndex(Array.from({ length: 9000 }, (_, index) => ({
      key: `parent:${String(index).padStart(5, "0")}`,
      valueRef: `ref:parent:${index}`,
      valueHash: protocolHash("block", `parent:${index}`)
    })), { domain: "parent-cut" });
    assert.ok(parentCut.height > 1);
    assert.ok((await engine.readSnapshot(parentCut.root)).chunkBoundaries.length > 1);
    assert.ok((await engine.readSnapshot(parentCut.root)).chunkBoundaries.length > 1);
    assert.equal((await engine.readSnapshot("")).count, 0);
    const splitDomain = "split-domain-704";
    const splitLeaf = await engine.createIndex(Array.from({ length: 127 }, (_, index) => ({
      key: `split:${String(index).padStart(3, "0")}`,
      valueRef: `ref:split:${index}`,
      valueHash: protocolHash("block", `split:${index}`)
    })), { domain: splitDomain });
    assert.equal(splitLeaf.height, 0);
    const splitAfterPut = await engine.put(splitLeaf.root, "split:999", {
      valueRef: "ref:split:999",
      valueHash: protocolHash("block", "split:999")
    }, { domain: splitDomain });
    assert.ok(splitAfterPut.height > 0);
    const countedBaseStorage = createStoragePort({ inMemory: true });
    let indexNodeWrites = 0;
    const countedStorage = {
      ...countedBaseStorage,
      async putBlock(value, options = {}) {
        if (String(options.kind || "").startsWith("index-node:")) indexNodeWrites += 1;
        return countedBaseStorage.putBlock(value, options);
      }
    };
    const countedEngine = createVerifiableIndexEngine({ storage: countedStorage, domain: "counted" });
    const countedIndex = await countedEngine.createIndex(Array.from({ length: 4096 }, (_, index) => ({
      key: `counted:${String(index).padStart(5, "0")}`,
      valueRef: `ref:counted:${index}`,
      valueHash: protocolHash("block", `counted:${index}`)
    })));
    const buildWrites = indexNodeWrites;
    await countedEngine.put(countedIndex.root, "counted:02048", {
      valueRef: "ref:counted:updated",
      valueHash: protocolHash("block", "counted:updated")
    });
    const mutationWrites = indexNodeWrites - buildWrites;
    assert.ok(mutationWrites > 0 && mutationWrites < Math.ceil(buildWrites / 4));
  });

  it("records append-only operation lifecycle with idempotency, workspace projection, state, checkpoint, and bundles", async () => {
    const pactium = createPactium({ dataDir: await tempDataDir() });
    const intent = await pactium.beginOperationIntent({
      operationId: "workspace.write",
      workspaceId: "workspace-a",
      idempotencyKey: "same-intent",
      input: { path: "docs/a.md" }
    });
    assert.equal(intent.protocol, PACTIUM_PROTOCOL);
    assert.equal(intent.envelopeKind, "operation-intent");
    const intentReplay = await pactium.beginOperationIntent({
      operationId: "workspace.write",
      workspaceId: "workspace-a",
      idempotencyKey: "same-intent",
      input: { path: "docs/a.md" }
    });
    assert.equal(intentReplay.envelopeId, intent.envelopeId);
    assert.equal(intentReplay.replayed, true);
    const open = await pactium.lookupOpenIntent(intent.factId);
    assert.equal(open.exists, true);

    const outcome = await pactium.appendOperationOutcome({
      intentId: intent.factId,
      outcomeIdempotencyKey: "same-outcome",
      status: "succeeded",
      result: { ok: true },
      stateMutations: [{ key: "docs/a.md", value: { text: "hello" } }],
      hostEvidenceRefs: ["host:evidence:a"]
    });
    assert.equal(outcome.envelopeKind, "operation-outcome");
    const closed = await pactium.lookupOpenIntent(intent.factId);
    assert.equal(closed.exists, false);
    const foundOutcome = await pactium.lookupOutcome(intent.factId);
    assert.equal(foundOutcome.exists, true);
    await assert.rejects(() => pactium.appendOperationOutcome({ intentId: intent.factId }), /Terminal Outcome/);

    const projection = await pactium.getWorkspaceProjection("workspace-a");
    assert.equal(projection.nextOrdinal, 2);
    const emptyProjection = await pactium.getWorkspaceProjection("empty-workspace");
    assert.deepEqual(emptyProjection.order, []);
    assert.deepEqual(emptyProjection.membership, []);
    const membership = await pactium.proveWorkspaceMembership({
      workspaceId: "workspace-a",
      ledgerEventId: outcome.factRef.ledgerEventId
    });
    assert.equal(membership.member, true);
    assert.equal((await pactium.proveWorkspaceMembership({
      workspaceId: "workspace-a",
      ledgerEventId: "missing-event"
    })).member, false);
    const refIntent = await pactium.beginOperationIntent({
      operationId: "workspace.value-ref",
      workspaceId: "workspace-a"
    });
    const refOutcome = await pactium.appendOperationOutcome({
      intentId: refIntent.factId,
      stateMutations: [
        { key: "", value: { skipped: true } },
        {
          key: "docs/ref.md",
          valueRef: "ref:external-state",
          valueHash: protocolHash("block", "external-state"),
          metadata: { external: true }
        }
      ]
    });
    assert.equal(refOutcome.envelopeKind, "operation-outcome");

    const verified = await pactium.verifyEnvelope(outcome);
    assert.equal(verified.ok, true);
    assert.ok(verified.checked.includes("proofs.workspaceProjection.orderProof"));
    assert.ok(verified.checked.includes("ledger-head-signature"));
    const validProofBlock = await pactium.storage.getBlock(outcome.proofRefs[0].cid);
    const validProofValue = JSON.parse(Buffer.from(validProofBlock.payloadBase64, "base64").toString("utf8"));
    const badIndexProofBlock = await pactium.storage.putBlock({
      ...validProofValue,
      proofs: {
        ...validProofValue.proofs,
        workspaceProjection: {
          ...validProofValue.proofs.workspaceProjection,
          orderProof: {
            ...validProofValue.proofs.workspaceProjection.orderProof,
            rootHash: "0".repeat(64)
          }
        }
      }
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const badIndexEnvelope = {
      ...outcome,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: badIndexProofBlock.cid,
        payloadHash: badIndexProofBlock.payloadHash,
        byteLength: badIndexProofBlock.byteLength
      }]
    };
    assert.ok((await pactium.verifyEnvelope(badIndexEnvelope)).failures.some((failure) => failure.code === "bad_embedded_proof"));
    const noLedgerBlock = await pactium.storage.putBlock({
      protocol: PACTIUM_PROTOCOL,
      materialType: "pactium.proof-material",
      proofs: {}
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const noLedgerEnvelope = {
      ...outcome,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: noLedgerBlock.cid,
        payloadHash: noLedgerBlock.payloadHash,
        byteLength: noLedgerBlock.byteLength
      }]
    };
    assert.ok((await pactium.verifyEnvelope(noLedgerEnvelope)).failures.some((failure) => failure.code === "missing_ledger_proof"));
    const unknownProofBlock = await pactium.storage.putBlock({
      ...validProofValue,
      proofs: {
        ...validProofValue.proofs,
        unknown: { proofType: "custom.unknown", critical: true }
      }
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const unknownProofEnvelope = {
      ...outcome,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: unknownProofBlock.cid,
        payloadHash: unknownProofBlock.payloadHash,
        byteLength: unknownProofBlock.byteLength
      }]
    };
    assert.ok((await pactium.verifyEnvelope(unknownProofEnvelope)).failures.some((failure) => failure.code === "missing_proof_verifier"));
    const nonCriticalUnknown = await pactium.verifyEnvelope(unknownProofEnvelope, { requireAllProofs: false });
    assert.equal(nonCriticalUnknown.failures.some((failure) => failure.code === "missing_proof_verifier"), true);
    const nonCriticalProofBlock = await pactium.storage.putBlock({
      ...validProofValue,
      proofs: {
        ...validProofValue.proofs,
        unknown: { proofType: "custom.unknown", critical: false }
      }
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const nonCriticalProofEnvelope = {
      ...outcome,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: nonCriticalProofBlock.cid,
        payloadHash: nonCriticalProofBlock.payloadHash,
        byteLength: nonCriticalProofBlock.byteLength
      }]
    };
    assert.equal((await pactium.verifyEnvelope(nonCriticalProofEnvelope, { requireAllProofs: false }))
      .failures.some((failure) => failure.code === "missing_proof_verifier"), false);
    const throwingProofBlock = await pactium.storage.putBlock({
      ...validProofValue,
      proofs: {
        ...validProofValue.proofs,
        throwing: { proofType: "custom.throw" }
      }
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const throwingProofEnvelope = {
      ...outcome,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: throwingProofBlock.cid,
        payloadHash: throwingProofBlock.payloadHash,
        byteLength: throwingProofBlock.byteLength
      }]
    };
    assert.ok((await pactium.verifyEnvelope(throwingProofEnvelope, {
      proofVerifiers: {
        "custom.throw": () => {
          throw new Error("boom");
        }
      }
    })).failures.some((failure) => failure.code === "proof_verifier_threw"));
    const objectProofBlock = await pactium.storage.putBlock({
      ...validProofValue,
      proofs: {
        ...validProofValue.proofs,
        customObject: {
          proofType: "custom.object.ok",
          leftProof: { proofType: "custom.left.required", critical: true },
          rightProof: { proofType: "custom.right.required", critical: true }
        }
      }
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const objectProofEnvelope = await pactium.storeEnvelope({
      ...outcome,
      envelopeId: undefined,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: objectProofBlock.cid,
        payloadHash: objectProofBlock.payloadHash,
        byteLength: objectProofBlock.byteLength
      }]
    });
    const objectProofResult = await pactium.verifyEnvelope(objectProofEnvelope, {
      proofVerifiers: {
        "custom.object.ok": () => ({ ok: true })
      }
    });
    assert.equal(objectProofResult.ok, false);
    assert.ok(objectProofResult.checked.includes("proofs.customObject"));
    assert.ok(objectProofResult.failures.some((failure) => failure.code === "missing_proof_verifier"));
    const bundle = await pactium.exportProofBundle(outcome);
    assert.equal(bundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    const bundleVerified = await verifyProofBundle(bundle);
    assert.equal(bundleVerified.ok, true);
    const explicitIndexedBundle = await pactium.exportProofBundle(outcome, { format: "indexed" });
    assert.equal(explicitIndexedBundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    await assert.rejects(() => pactium.exportProofBundle("missing-envelope"), /not found/);
    await assert.rejects(() => pactium.exportProofBundle(outcome, { format: "bad-format" }), /Unsupported proof bundle format/);
    const pageFromCursor = await pactium.getLedgerCursor({ fromCursor: { position: 100 }, limit: 0 });
    assert.equal(pageFromCursor.entries.length, 0);
    assert.equal(pageFromCursor.cursor.position, 100);
    const emptyWorkspaceCursor = await pactium.getWorkspaceCursor({ workspaceId: "empty-workspace", fromCursor: { position: 4 }, limit: 0 });
    assert.equal(emptyWorkspaceCursor.entries.length, 0);
    assert.equal(emptyWorkspaceCursor.cursor.position, 4);
    const indexedBundle = bundle;
    assert.equal(indexedBundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    assert.match(indexedBundle.binaryBase64, /^[A-Za-z0-9+/=]+$/);
    assert.equal(Object.hasOwn(indexedBundle, "blocks"), false);
    assert.equal((await verifyProofBundle(indexedBundle)).ok, true);
    const duplicateBundle = structuredClone(indexedBundle);
    duplicateBundle.index.push({ ...duplicateBundle.index[0] });
    assert.ok((await verifyProofBundle(duplicateBundle)).failures.some((failure) => failure.code === "duplicate_bundle_cid"));
    const duplicateOffsetBundle = structuredClone(indexedBundle);
    duplicateOffsetBundle.index.push({
      ...duplicateOffsetBundle.index[0],
      cid: `cid:sha256:${"a".repeat(64)}`
    });
    assert.ok((await verifyProofBundle(duplicateOffsetBundle)).failures.some((failure) => failure.code === "duplicate_bundle_offset"));
    const badOffsetBundle = structuredClone(indexedBundle);
    badOffsetBundle.index[0].offset = 999999;
    assert.ok((await verifyProofBundle(badOffsetBundle)).failures.some((failure) => failure.code === "bad_bundle_offset"));
    const negativeOffsetBundle = structuredClone(indexedBundle);
    negativeOffsetBundle.index[0].offset = -1;
    assert.ok((await verifyProofBundle(negativeOffsetBundle)).failures.some((failure) => failure.code === "bad_bundle_offset"));
    assert.ok((await verifyProofBundle(indexedBundle, {
      maxHeaderSize: 1,
      maxBlockSize: 1
    })).failures.some((failure) => failure.code === "oversized_bundle_header" || failure.code === "oversized_bundle_block"));
    const badIndexBundle = structuredClone(indexedBundle);
    badIndexBundle.index[0].payloadHash = "sha256:bad";
    assert.ok((await verifyProofBundle(badIndexBundle)).failures.some((failure) => failure.code === "bad_bundle_index"));
    const badCidIndexBundle = structuredClone(indexedBundle);
    badCidIndexBundle.index[0].cid = cidForBytes(Buffer.from("different-payload"));
    assert.ok((await verifyProofBundle(badCidIndexBundle)).failures.some((failure) => failure.code === "bad_bundle_index"));
    const badHeaderLengthBundle = structuredClone(indexedBundle);
    const badHeaderLengthBytes = Buffer.from(badHeaderLengthBundle.binaryBase64, "base64");
    let replacementHeader = null;
    let replacementHeaderStart = 0;
    for (const item of badHeaderLengthBundle.index) {
      const record = decodeVarint(badHeaderLengthBytes, item.offset);
      const start = record.nextOffset;
      const end = start + item.headerLength;
      const header = canonicalDecode(badHeaderLengthBytes.subarray(start, end));
      header.byteLength += 1;
      const candidate = Buffer.from(canonicalEncode(header));
      if (candidate.length === item.headerLength) {
        replacementHeader = candidate;
        replacementHeaderStart = start;
        break;
      }
    }
    assert.ok(replacementHeader);
    replacementHeader.copy(badHeaderLengthBytes, replacementHeaderStart);
    badHeaderLengthBundle.binaryBase64 = badHeaderLengthBytes.toString("base64");
    assert.ok((await verifyProofBundle(badHeaderLengthBundle)).failures.some((failure) => failure.code === "bad_bundle_index"));
    const badVarintBundle = structuredClone(indexedBundle);
    badVarintBundle.binaryBase64 = Buffer.from([0x80]).toString("base64");
    assert.ok((await verifyProofBundle(badVarintBundle)).failures.some((failure) => failure.code === "bad_bundle_varint"));
    const badLengthBundle = structuredClone(indexedBundle);
    badLengthBundle.index[0].recordLength += 1;
    assert.ok((await verifyProofBundle(badLengthBundle)).failures.some((failure) => failure.code === "bad_bundle_record_length"));
    const badHeaderPayloadLengthBundle = structuredClone(indexedBundle);
    badHeaderPayloadLengthBundle.index[0].headerLength += 1;
    assert.ok((await verifyProofBundle(badHeaderPayloadLengthBundle)).failures.some((failure) => failure.code === "bad_bundle_record_length"));
    const truncatedBundle = structuredClone(indexedBundle);
    const truncatedBytes = Buffer.from(truncatedBundle.binaryBase64, "base64");
    truncatedBundle.binaryBase64 = truncatedBytes.subarray(0, truncatedBytes.length - 1).toString("base64");
    assert.ok((await verifyProofBundle(truncatedBundle)).failures.some((failure) => failure.code === "bad_bundle_offset"));
    const badHeaderBundle = structuredClone(indexedBundle);
    const headerBytes = Buffer.from(badHeaderBundle.binaryBase64, "base64");
    const decodedRecord = decodeVarint(headerBytes, badHeaderBundle.index[0].offset);
    headerBytes[decodedRecord.nextOffset] = "x".charCodeAt(0);
    badHeaderBundle.binaryBase64 = headerBytes.toString("base64");
    assert.ok((await verifyProofBundle(badHeaderBundle)).failures.some((failure) => failure.code === "bad_bundle_header"));
    assert.throws(() => decodeVarint(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80])), /too large|truncated/);
    const wrongBundleType = indexedBlocksFromBundle({
      bundleType: "wrong.bundle.type",
      blocks: [{ cid: "cid:sha256:plain" }]
    });
    assert.equal(wrongBundleType.blocks.length, 0);
    assert.ok(wrongBundleType.failures.some((failure) => failure.code === "malformed_bundle"));
    const wrongResolver = createIndexedBundleResolver({ bundleType: "wrong.bundle.type" });
    assert.equal(wrongResolver.has("cid:sha256:plain"), false);
    assert.equal(wrongResolver.get("cid:sha256:plain"), null);
    const missingBinary = indexedBlocksFromBundle({ ...indexedBundle, binaryBase64: "" });
    assert.equal(missingBinary.blocks.length, 0);
    assert.ok(missingBinary.failures.some((failure) => failure.code === "missing_bundle_binary"));
    const replaced = structuredClone(indexedBundle);
    const record = decodeVarint(Buffer.from(replaced.binaryBase64, "base64"), replaced.index[0].offset);
    const replacedBytes = Buffer.from(replaced.binaryBase64, "base64");
    replacedBytes[record.nextOffset + replaced.index[0].headerLength] ^= 1;
    replaced.binaryBase64 = replacedBytes.toString("base64");
    const replacedResult = await verifyProofBundle(replaced);
    assert.equal(replacedResult.ok, false);
    assert.ok(replacedResult.failures.some((failure) => failure.code === "bad_bundle_index" || failure.code.includes("material") || failure.code.includes("integrity")));

    await assert.rejects(() => pactium.beginOperationIntent({}), /operationId/);
    await assert.rejects(() => pactium.appendOperationOutcome({}), /intentId/);
    const storedEnvelope = await pactium.storeEnvelope({
      ...outcome,
      envelopeId: undefined,
      replayed: false,
      relatedEnvelopeIds: []
    });
    assert.equal(storedEnvelope.envelopeType, "pactium.proof-envelope");
  });

  it("updates workspace state roots incrementally and retains state Prolly nodes", async () => {
    const baseStorage = createStoragePort({ inMemory: true });
    let indexNodeWrites = 0;
    const countedStorage = {
      ...baseStorage,
      async putBlock(value, options = {}) {
        if (String(options.kind || "").startsWith("index-node:")) indexNodeWrites += 1;
        return baseStorage.putBlock(value, options);
      }
    };
    const pactium = createPactium({ storage: countedStorage });
    const seedEnvelope = await pactium.recordOperation({
      operationId: "state.incremental.seed",
      workspaceId: "state-incremental",
      stateMutations: Array.from({ length: 512 }, (_, index) => ({
        key: `state:${String(index).padStart(4, "0")}`,
        value: { index }
      }))
    });
    const seedMaterial = canonicalDecode((await pactium.storage.getBlock(seedEnvelope.proofRefs[0].cid)).bytes);
    const seedRoot = seedMaterial.proofs.state.root;
    assert.equal(seedMaterial.proofs.stateCommit.mutationCount, 512);
    assert.equal(seedMaterial.proofs.stateCommit.touchedKeyCount, 32);
    assert.equal(seedMaterial.proofs.state.touchedKeyProofs.length, 32);
    assert.equal(verifyIndexProof(seedMaterial.proofs.state.touchedKeyProofs.at(-1)), true);
    assert.equal((await pactium.verifyEnvelope(seedEnvelope)).ok, true);
    const seedWrites = indexNodeWrites;

    const updateEnvelope = await pactium.recordOperation({
      operationId: "state.incremental.update",
      workspaceId: "state-incremental",
      stateMutations: [{
        key: "state:0256",
        value: { updated: true },
        metadata: { version: 2 }
      }]
    });
    const updateWrites = indexNodeWrites - seedWrites;
    const updateMaterial = canonicalDecode((await pactium.storage.getBlock(updateEnvelope.proofRefs[0].cid)).bytes);
    const updateProof = updateMaterial.proofs.state.touchedKeyProofs[0];
    assert.notEqual(updateMaterial.proofs.state.root, seedRoot);
    assert.equal(updateProof.proofType, PACTIUM_PROOF_TYPES.indexMembership);
    assert.equal(verifyIndexProof(updateProof), true);
    assert.ok(updateWrites > 0 && updateWrites < Math.ceil(seedWrites / 4));

    const deleteEnvelope = await pactium.recordOperation({
      operationId: "state.incremental.delete",
      workspaceId: "state-incremental",
      stateMutations: [{ key: "state:0001", action: "delete" }]
    });
    const deleteMaterial = canonicalDecode((await pactium.storage.getBlock(deleteEnvelope.proofRefs[0].cid)).bytes);
    const deleteProof = deleteMaterial.proofs.state.touchedKeyProofs[0];
    assert.equal(deleteProof.proofType, PACTIUM_PROOF_TYPES.indexNonMembership);
    assert.equal(verifyIndexProof(deleteProof), true);

    await pactium._compactInMemoryCaches();
    const freshEngine = createVerifiableIndexEngine({ storage: pactium.storage, domain: "pactium" });
    assert.equal((await freshEngine.readIndexRoot(deleteMaterial.proofs.state.root)).root, deleteMaterial.proofs.state.root);
    assert.equal(verifyIndexProof(await freshEngine.prove(deleteMaterial.proofs.state.root, "state:0256")), true);
  });

  it("keeps attacker-chosen workspace ids out of object prototypes", async () => {
    const pactium = createPactium({ inMemory: true });
    await pactium.recordOperation({
      operationId: "workspace.prototype.pollution",
      workspaceId: "__proto__",
      stateMutations: [{ key: "polluted", value: { ok: true } }]
    });
    assert.equal(Object.prototype.nextOrdinal, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    const projection = await pactium.getWorkspaceProjection("__proto__");
    assert.equal(projection.workspaceId, "__proto__");
    assert.equal(projection.nextOrdinal, 2);
  });

  it("supports append conditions, tracking cursors, recovery plans, and trusted head advancement", async () => {
    const pactium = createPactium({ inMemory: true });
    const emptyHead = await pactium.ledger.head();
    const appendCondition = createAppendCondition({
      workspaceId: "conditioned",
      requiredLedgerHead: emptyHead.headId,
      requiredWorkspaceOrderRoot: "",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    assert.equal(appendCondition.conditionType, "pactium.append-condition");
    assert.equal(appendCondition.createdAt, "2026-01-01T00:00:00.000Z");
    const intent = await pactium.beginOperationIntent({
      operationId: "condition.intent",
      workspaceId: "conditioned",
      appendCondition
    });
    await assert.rejects(() => pactium.beginOperationIntent({
      operationId: "condition.stale",
      workspaceId: "conditioned",
      appendCondition: { requiredLedgerHead: emptyHead.headId }
    }), /Ledger head/);
    await assert.rejects(() => pactium.beginOperationIntent({
      operationId: "condition.workspace-order",
      workspaceId: "conditioned",
      appendCondition: { requiredWorkspaceOrderRoot: "cid:sha256:bad" }
    }), /workspace order root/);
    await assert.rejects(() => pactium.beginOperationIntent({
      operationId: "condition.workspace-membership",
      workspaceId: "conditioned",
      appendCondition: { requiredWorkspaceMembershipRoot: "cid:sha256:bad" }
    }), /workspace membership root/);
    await assert.rejects(() => pactium.beginOperationIntent({
      operationId: "condition.open-state",
      workspaceId: "conditioned",
      appendCondition: { requiredOpenIntentState: { exists: true, intentId: "missing" } }
    }), /open-intent state/);
    await assert.rejects(() => pactium.beginOperationIntent({
      operationId: "condition.causality",
      workspaceId: "conditioned",
      appendCondition: { expectedCausalityRefs: ["missing-cause"] }
    }), /causality/);
    const allowedMissing = await pactium.beginOperationIntent({
      operationId: "condition.causality.allowed",
      workspaceId: "conditioned",
      appendCondition: { expectedCausalityRefs: ["missing-cause"], allowMissingCausalityRefs: true }
    });
    assert.equal(allowedMissing.envelopeKind, "operation-intent");
    await assert.rejects(() => pactium.appendOperationOutcome({
      intentId: intent.factId,
      appendCondition: { requiredOutcomeState: { exists: true } }
    }), /outcome state/);
    const outcome = await pactium.appendOperationOutcome({
      intentId: intent.factId,
      appendCondition: { requiredOutcomeState: { exists: false } }
    });
    assert.equal(outcome.envelopeKind, "operation-outcome");
    const recordPactium = createPactium({ inMemory: true });
    const recordHead = await recordPactium.ledger.head();
    const recordedOutcome = await recordPactium.recordOperation({
      operationId: "condition.record-operation",
      workspaceId: "conditioned-record",
      appendCondition: { requiredLedgerHead: recordHead.headId }
    });
    assert.equal(recordedOutcome.envelopeKind, "operation-outcome");
    const ledgerPage = await pactium.getLedgerCursor({ limit: 1 });
    assert.equal(ledgerPage.entries.length, 1);
    assert.equal(pactium.verifyCursor(ledgerPage.cursor, { head: ledgerPage.head }), true);
    const workspacePage = await pactium.getWorkspaceCursor({ workspaceId: "conditioned", limit: 1 });
    assert.equal(workspacePage.entries.length, 1);
    assert.equal(pactium.verifyCursor(workspacePage.cursor, {
      head: workspacePage.head,
      orderRoot: workspacePage.orderRoot
    }), true);
    const manualCursor = createTrackingCursor({
      scope: "ledger",
      position: 1,
      headRef: ledgerPage.head.headId
    });
    assert.equal(pactium.verifyCursor(manualCursor, { head: ledgerPage.head }), true);
    assert.equal(createTrackingCursor().scope, "ledger");
    assert.equal(createTrackingCursor({ scope: "workspace" }).workspaceId, "default");
    const advancedCursor = advanceTo(manualCursor, 3, { gaps: [1], headRef: ledgerPage.head.headId });
    assert.equal(covers(advancedCursor, 1), false);
    assert.equal(covers(advancedCursor, 3), false);
    assert.equal(advanceTo(advancedCursor, 2).position, 3);
    assert.equal(covers({ position: 0, gaps: [] }, 1), false);
    assert.equal(samePositionAs(advancedCursor, createTrackingCursor({
      scope: "ledger",
      position: 3,
      headRef: ledgerPage.head.headId
    })), true);
    assert.equal(samePositionAs(advancedCursor, manualCursor), false);
    assert.equal(pactium.verifyCursor({ ...manualCursor, protocol: "wrong" }, { head: ledgerPage.head }), false);
    assert.equal(pactium.verifyCursor(manualCursor, { head: { headId: "other" } }), false);
    assert.equal(verifyTrackingCursor({
      ...workspacePage.cursor,
      orderRoot: "wrong"
    }, { head: workspacePage.head, orderRoot: workspacePage.orderRoot }), false);
    assert.equal(verifyTrackingCursor({
      ...manualCursor,
      cursorId: "tracking_cursor_bad"
    }, { head: ledgerPage.head }), false);
    assert.equal(verifyTrackingCursor({
      ...manualCursor,
      position: 0.5
    }, { head: ledgerPage.head }), false);
    assert.equal((await pactium.getLedgerCursor({
      fromCursor: { ...manualCursor, position: 0.5 },
      limit: 1
    })).entries[0].index, 0);
    assert.equal(verifyTrackingCursor(null), false);
    assert.equal(verifyTrackingCursor(createTrackingCursor({
      scope: "ledger",
      position: 1,
      headRef: ledgerPage.head.root
    }), { head: ledgerPage.head }), true);
    assert.equal(verifyTrackingCursor(createTrackingCursor({
      scope: "ledger",
      position: 1,
      headRef: ledgerPage.head.rootHash
    }), { head: ledgerPage.head }), true);
    assert.equal(verifyTrackingCursor(createTrackingCursor({
      scope: "ledger",
      position: 1,
      orderRoot: "ignored-for-ledger"
    }), { orderRoot: "different" }), true);
    assert.equal(samePositionAs(null, manualCursor), false);
    assert.equal(advanceTo(null, 2, { gaps: [0], orderRoot: "root" }).scope, "ledger");
    assert.equal(await assertAppendCondition(null), true);
    assert.equal(await assertAppendCondition(createAppendCondition({
      ledgerHead: ledgerPage.head.root,
      workspaceOrderRoot: workspacePage.orderRoot,
      workspaceMembershipRoot: workspacePage.orderRoot,
      requiredOpenIntentState: { exists: false },
      allowMissingCausalityRefs: true
    }), {
      phase: "intent",
      currentHead: ledgerPage.head,
      workspace: {
        orderRoot: workspacePage.orderRoot,
        membershipRoot: workspacePage.orderRoot
      },
      openIntentState: { exists: false }
    }), true);
    assert.equal(await assertAppendCondition(createAppendCondition({
      requiredLedgerHead: ledgerPage.head.headId,
      requiredWorkspaceOrderRoot: workspacePage.orderRoot,
      requiredWorkspaceMembershipRoot: workspacePage.orderRoot,
      requiredOpenIntentState: {},
      requiredOutcomeState: {}
    }), {
      phase: "intent",
      currentHead: ledgerPage.head,
      workspace: {
        orderRoot: workspacePage.orderRoot,
        membershipRoot: workspacePage.orderRoot
      }
    }), true);
    assert.equal(await assertAppendCondition(createAppendCondition({
      ledgerHead: ledgerPage.head.rootHash,
      requiredOutcomeState: { exists: true, outcomeId: outcome.factId },
      expectedCausalityRefs: [intent.factId]
    }), {
      phase: "outcome",
      currentHead: ledgerPage.head,
      workspace: {
        orderRoot: workspacePage.orderRoot,
        membershipRoot: workspacePage.orderRoot
      },
      outcomeState: {
        exists: true,
        intentId: intent.factId,
        outcomeId: outcome.factId
      },
      knownCausalityRefs: new Set([intent.factId])
    }), true);
    await assert.rejects(() => assertAppendCondition(createAppendCondition({
      requiredOpenIntentState: { exists: true }
    }), {
      phase: "intent",
      openIntentState: { exists: false }
    }), /open-intent state/);
    await assert.rejects(() => assertAppendCondition(createAppendCondition({
      requiredOutcomeState: { exists: true, outcomeId: "other" }
    }), {
      phase: "outcome",
      outcomeState: { exists: true, outcomeId: outcome.factId }
    }), /outcome state/);
    await assert.rejects(() => assertAppendCondition(createAppendCondition({
      requiredLedgerHead: "missing-head"
    }), {
      currentHead: {}
    }), /Ledger head/);
    await assert.rejects(() => assertAppendCondition(createAppendCondition({
      requiredWorkspaceOrderRoot: "missing-order-root"
    }), {
      workspace: {}
    }), /workspace order root/);
    await assert.rejects(() => assertAppendCondition(createAppendCondition({
      requiredWorkspaceMembershipRoot: "missing-membership-root"
    }), {
      workspace: {}
    }), /workspace membership root/);
    assert.equal(await assertAppendCondition(createAppendCondition({
      requiredOpenIntentState: { exists: true }
    }), {
      phase: "intent",
      openIntentState: { exists: true }
    }), true);
    assert.equal(await assertAppendCondition(createAppendCondition({
      requiredOpenIntentState: { exists: true }
    }), {
      phase: "outcome",
      openIntentState: { exists: false }
    }), true);
    assert.equal(await assertAppendCondition(createAppendCondition({
      requiredOutcomeState: { exists: true }
    }), {
      phase: "intent",
      outcomeState: { exists: false }
    }), true);
    const recovery = pactium.planRecovery({
      cursor: ledgerPage.cursor,
      failures: [{ layer: "proof-material", code: "missing_proof_material" }]
    });
    assert.ok(recovery.tasks.some((task) => task.action === "restore-missing-proof-material"));

    const proofBlock = await pactium.storage.getBlock(outcome.proofRefs[0].cid);
    const proofValue = JSON.parse(Buffer.from(proofBlock.payloadBase64, "base64").toString("utf8"));
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const manifest = createVerifierManifest({
      signers: [{
        signerId: "unit-ledger-signer",
        algorithm: "ed25519",
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        roles: ["ledger-head"]
      }],
      quorum: 1
    });
    assert.equal(ledgerHeadSigningPayload().ledgerId, "pactium-operation-ledger");
    const emptyManifest = createVerifierManifest({
      signers: [{ signerId: "", publicKey: "" }],
      quorum: 0
    });
    assert.equal(emptyManifest.signers.length, 0);
    assert.equal(emptyManifest.quorum, 1);
    const signature = signLedgerHead(proofValue.ledger.head, {
      privateKey,
      signerId: "unit-ledger-signer",
      manifest
    });
    const signatureWithoutManifest = signLedgerHead(proofValue.ledger.head, {
      privateKey,
      signerId: "unit-ledger-signer"
    });
    assert.equal(signatureWithoutManifest.manifestId, "");
    assert.equal(verifyLedgerHeadSignature(proofValue.ledger.head, manifest, { signatures: [signature] }).ok, true);
    assert.equal(verifyLedgerHeadSignature(proofValue.ledger.head, {
      signers: [{
        signerId: "unit-ledger-signer",
        algorithm: "ed25519",
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        roles: ["ledger-head"]
      }]
    }, { signatures: [signatureWithoutManifest] }).ok, true);
    assert.equal(verifyLedgerHeadSignature({
      ...proofValue.ledger.head,
      signatures: undefined,
      signature
    }, manifest).ok, true);
    assert.equal(verifyLedgerHeadSignature({
      ...proofValue.ledger.head,
      signatures: [signature]
    }, manifest).ok, true);
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, manifest, {
      signatures: [{ ...signature, signerId: "unknown" }]
    }).failures.some((failure) => failure.code === "unknown_signer"));
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, manifest, {
      signatures: [{ ...signature, algorithm: "rsa" }]
    }).failures.some((failure) => failure.code === "unsupported_signature_algorithm"));
    const noRoleManifest = createVerifierManifest({
      signers: [{
        signerId: "unit-ledger-signer",
        algorithm: "ed25519",
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        roles: ["proof-envelope"]
      }]
    });
    const wrongRoleSignature = signLedgerHead(proofValue.ledger.head, {
      privateKey,
      signerId: "unit-ledger-signer",
      manifest: noRoleManifest
    });
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, noRoleManifest, {
      signatures: [wrongRoleSignature]
    }).failures.some((failure) => failure.code === "signer_role_missing"));
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, noRoleManifest, {
      signatures: [signature]
    }).failures.some((failure) => failure.code === "signature_manifest_mismatch"));
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, manifest, {
      signatures: [{ ...signature, signedPayloadHash: "sha256:bad" }]
    }).failures.some((failure) => failure.code === "bad_signed_head_payload"));
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, manifest, {
      signatures: [{ ...signature, signature: Buffer.from("bad").toString("base64") }]
    }).failures.some((failure) => failure.code === "bad_head_signature"));
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, manifest, {
      signatures: []
    }).failures.some((failure) => failure.code === "manifest_quorum_not_met"));
    assert.ok(verifyLedgerHeadSignature(proofValue.ledger.head, {
      signers: manifest.signers,
      quorum: 2
    }, {
      signatures: [signatureWithoutManifest]
    }).failures.some((failure) => failure.code === "manifest_quorum_not_met"));
    const signedEnvelopeVerification = await pactium.verifyEnvelope(outcome, {
      verifierManifest: manifest,
      ledgerHeadSignatures: [signature]
    });
    assert.equal(signedEnvelopeVerification.ok, true);
    assert.ok(signedEnvelopeVerification.checked.includes("ledger-head-signature"));
    assert.equal(pactium.advanceTrustedHead({
      oldHead: proofValue.ledger.previousHead,
      newHead: proofValue.ledger.head,
      proof: proofValue.ledger.consistencyProof,
      manifest,
      signatures: [signature]
    }).ok, true);
    assert.equal(pactium.advanceTrustedHead({
      oldHead: proofValue.ledger.previousHead,
      newHead: proofValue.ledger.head,
      proof: proofValue.ledger.consistencyProof
    }).ok, true);
    assert.equal(pactium.advanceTrustedHead({
      oldHead: { ...proofValue.ledger.previousHead, rootHash: "0".repeat(64) },
      newHead: proofValue.ledger.head,
      proof: proofValue.ledger.consistencyProof,
      manifest,
      signatures: [signature]
    }).ok, false);
  });

  it("returns structured failures and deterministic repair plans", async () => {
    const pactium = createPactium({ inMemory: true });
    const envelope = await pactium.recordOperation({
      operationId: "failure.demo",
      workspaceId: "workspace-failure",
      extensions: [{
        name: "host.critical",
        critical: true,
        value: { required: true }
      }]
    });
    const unsupported = await verifyProofEnvelope(envelope, { storage: pactium.storage });
    assert.equal(unsupported.ok, false);
    assert.ok(unsupported.failures.some((failure) => failure.code === "unsupported_critical_extension"));
    const bundle = await pactium.exportProofBundle(envelope);
    bundle.index = [];
    bundle.binaryBase64 = Buffer.alloc(0).toString("base64");
    bundle.byteLength = 0;
    const missing = await verifyProofBundle(bundle);
    assert.equal(missing.ok, false);
    const failure = createVerificationFailure({
      layer: "workspace-projection",
      code: "derived_index_missing",
      repairable: true
    });
    const plan = createRepairPlanner().plan([...missing.failures, failure]);
    assert.ok(plan.tasks.length >= 1);
    assert.ok(plan.tasks.some((task) => task.action === "rebuild-derived-index"));
    const actionPlan = createRepairPlanner().plan([
      { layer: "operation-lifecycle", code: "intent_missing" },
      { layer: "operation-lifecycle", code: "open_intent_abandoned" },
      { layer: "proof-material", code: "missing_bundle_block" },
      { layer: "proof-extension", code: "missing_extension_material" },
      { layer: "host", code: "host_evidence_missing" },
      { layer: "licolite", code: "licolite_bad_signature" },
      { layer: "policy", code: "evidence_missing" },
      { layer: "append-condition", code: "ledger_head_conflict" },
      { layer: "operation-lifecycle", code: "terminal_outcome_exists" },
      { layer: "workspace-projection", code: "bad_index" },
      { layer: "proof-registry", code: "derived_index_missing" },
      { layer: "ledger", code: "bad_ledger_consistency" },
      { layer: "proof-extension", code: "unsupported_critical_extension" },
      { layer: "manual", code: "unclassified" },
      {}
    ]);
    assert.deepEqual(actionPlan.tasks.map((task) => task.action), [
      "resume-open-intent",
      "resume-open-intent",
      "restore-missing-proof-material",
      "restore-missing-proof-material",
      "request-host-evidence",
      "request-host-evidence",
      "request-host-evidence",
      "manual-conflict-resolution",
      "manual-conflict-resolution",
      "rebuild-derived-index",
      "rebuild-derived-index",
      "rebuild-derived-index",
      "install-verifier-support",
      "manual-investigation",
      "manual-investigation"
    ]);
    assert.equal(actionPlan.tasks.at(-1).layer, "unknown");
    assert.equal(createRepairPlanner().planRecovery().tasks.length, 0);
    const maintenance = createMaintenanceTaskEngine({ pactium });
    const task = maintenance.planTask("doctor", {});
    assert.equal((await maintenance.runTask(task)).ok, true);
  });

  it("provides first-class LicoLite aspect with signing and required critical extensions", async () => {
    const pactium = createPactium({ dataDir: await tempDataDir() });
    const signer = createLicoLiteSigner({ secret: "unit-secret" });
    assert.equal(await signer.verify("message", await signer.sign("message")), true);
    const licolite = createLicoLiteAspect({ pactium, signer, evidencePolicy: "production" });
    await assert.rejects(() => licolite.recordWorkspaceOperation({
      operationId: "missing.evidence",
      workspaceId: "lico"
    }), /policy evidence/);
    const envelope = await licolite.recordWorkspaceOperation({
      operationId: "workspace.effect",
      workspaceId: "lico",
      idempotencyKey: "intent-1",
      outcomeIdempotencyKey: "outcome-1",
      input: { file: "a" },
      policyEvidence: { decision: "allow", policyVersion: "unit" },
      workspaceEffectEvidence: { effect: "file.write", durableRef: "host:asset:a" },
      stateMutations: [{ key: "files/a", value: { ok: true } }]
    });
    assert.ok(envelope.criticalExtensions.includes(LICOLITE_POLICY_EXTENSION));
    assert.ok(envelope.criticalExtensions.includes(LICOLITE_WORKSPACE_EFFECT_EXTENSION));
    const verified = await licolite.verifyEnvelope(envelope);
    assert.equal(verified.ok, true);
    const stripped = { ...envelope, extensions: envelope.extensions.filter((extension) => extension.name !== LICOLITE_POLICY_EXTENSION) };
    const strippedVerified = await licolite.verifyEnvelope(stripped);
    assert.equal(strippedVerified.ok, false);
    assert.ok(strippedVerified.failures.some((failure) => failure.code.includes("licolite_policy")));
    assert.equal(licoLitePolicyExtensionValue({ evidence: { a: 1 } }).evidenceType, LICOLITE_POLICY_EXTENSION);
    assert.equal(licoLiteWorkspaceEffectExtensionValue({ evidence: { a: 1 } }).evidenceType, LICOLITE_WORKSPACE_EFFECT_EXTENSION);
    assert.deepEqual(licoLitePolicyExtensionValue().decision, {});
    assert.deepEqual(licoLiteWorkspaceEffectExtensionValue().effect, {});
    const materializedEvidence = await materializeEvidenceExtension(pactium, {
      name: "licolite.unitEvidence"
    });
    assert.equal(materializedEvidence.critical, true);
    assert.equal(materializedEvidence.name, "licolite.unitEvidence");
    const bundle = await licolite.exportProofBundle(envelope);
    assert.equal(bundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    assert.equal((await licolite.verifyBundle(bundle)).ok, true);
    assert.equal((await licolite.getWorkspaceProjection("lico")).nextOrdinal, 2);
  });

  it("resolves proof-first root and pactium/licolite exports from an external project", async () => {
    const projectDir = await tempDataDir("pactium-external-");
    const nodeModulesDir = path.join(projectDir, "node_modules");
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.symlink(path.resolve("."), path.join(nodeModulesDir, "pactium"), "dir");
    const scriptPath = path.join(projectDir, "consumer.mjs");
    await fs.writeFile(scriptPath, `
import { createPactium, startPactiumHttpServer as startRootHttpServer } from "pactium";
import { PACTIUM_HTTP_PROTOCOL, createPactiumHttpServer } from "pactium/http";
import { createLicoLiteAspect } from "pactium/licolite";

let oldExportMissing = false;
try {
  await import("pactium/ledger");
} catch {
  oldExportMissing = true;
}

const pactium = createPactium({ inMemory: true });
const licolite = createLicoLiteAspect({ pactium, evidencePolicy: "opportunistic" });
const envelope = await licolite.recordWorkspaceOperation({ operationId: "external", workspaceId: "x" });
const httpServer = createPactiumHttpServer({ pactium });
console.log(JSON.stringify({
  oldExportMissing,
  protocol: envelope.protocol,
  ok: (await licolite.verifyEnvelope(envelope)).ok,
  httpProtocol: PACTIUM_HTTP_PROTOCOL,
  httpServerType: typeof httpServer.close,
  rootHttpType: typeof startRootHttpServer
}));
`, "utf8");
    const run = await execFileAsync(process.execPath, [scriptPath], { cwd: projectDir });
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.oldExportMissing, true);
    assert.equal(parsed.protocol, PACTIUM_PROTOCOL);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.httpProtocol, "pactium.v0.2.http");
    assert.equal(parsed.httpServerType, "function");
    assert.equal(parsed.rootHttpType, "function");
  });

  it("serves HTTP endpoints and CLI proof-first commands", async () => {
    const pactium = createPactium({ dataDir: await tempDataDir() });
    const server = createPactiumHttpServer({ pactium });
    const address = await listen(server);
    try {
      const health = await requestJson({ port: address.port, requestPath: "/health" });
      assert.equal(health.statusCode, 200);
      assert.equal(health.body.coreProtocol, PACTIUM_PROTOCOL);
      const doctor = await requestJson({ port: address.port, requestPath: "/doctor" });
      assert.equal(doctor.body.ok, true);
      const recorded = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/operations",
        body: { operationId: "http.record", workspaceId: "http" }
      });
      assert.equal(recorded.statusCode, 200);
      assert.equal(recorded.body.envelopeKind, "operation-outcome");
      const verified = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/verify/envelope",
        body: recorded.body
      });
      assert.equal(verified.body.ok, true);
      const exported = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/bundles/export",
        body: { envelopeId: recorded.body.envelopeId }
      });
      assert.equal(exported.body.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
      const verifiedBundle = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/verify/bundle",
        body: { bundle: exported.body, options: { verifyAllBlocks: true } }
      });
      assert.equal(verifiedBundle.body.ok, true);
    } finally {
      await close(server);
    }

    const dataDir = await tempDataDir("pactium-cli-");
    const cliPath = path.resolve("bin/pactium.mjs");
    const doctor = await execFileAsync(process.execPath, [cliPath, "doctor", "--data-dir", dataDir]);
    assert.equal(JSON.parse(doctor.stdout).protocol, PACTIUM_PROTOCOL);
    const record = await execFileAsync(process.execPath, [
      cliPath,
      "operation",
      "record",
      "--data-dir",
      dataDir,
      "--body",
      JSON.stringify({ operationId: "cli.record", workspaceId: "cli" })
    ]);
    assert.equal(JSON.parse(record.stdout).envelopeKind, "operation-outcome");
  });

  it("runs deterministic quality gate pressure profiles through public APIs", async () => {
    assert.equal(PACTIUM_PROTOCOL_PROFILE.protocol, PACTIUM_PROTOCOL);
    const indexProfile = await runPactiumQualityGateProfile({
      profile: "api:index-engine",
      operations: 256
    });
    assert.equal(indexProfile.operationCount, 256);
    assert.ok(indexProfile.throughputPerSecond > 0);
    const cappedIndexProfile = await runPactiumQualityGateProfile({
      profile: "api:index-engine",
      operations: 1001
    });
    assert.equal(cappedIndexProfile.operationCount, 1001);
    const defaultProfile = await runPactiumQualityGateProfile({ operations: 3 });
    assert.equal(defaultProfile.profile, "api:index-engine");
    assert.equal(defaultProfile.operationCount, 3);
    const zeroProfile = await runPactiumQualityGateProfile({ operations: 0 });
    assert.equal(zeroProfile.operationCount, 0);
    assert.equal(zeroProfile.throughputPerSecond, 0);
    const lifecycleProfile = await runPactiumQualityGateProfile({
      profile: "api:operation-lifecycle",
      operations: 20
    });
    assert.equal(lifecycleProfile.operationCount, 20);
    assert.ok(lifecycleProfile.memoryHighWaterMark > 0);
    for (const profile of ["api:licolite-record", "api:proof-bundle", "api:recovery"]) {
      const result = await runPactiumQualityGateProfile({ profile, operations: 2 });
      assert.equal(result.operationCount, 2);
      assert.ok(result.throughputPerSecond > 0);
    }
    for (const profile of ["api:proof-bundle", "api:recovery", "api:licolite-record"]) {
      const result = await runPactiumQualityGateProfile({
        profile,
        operations: 1,
        pactium: createPactium({ inMemory: true })
      });
      assert.equal(result.operationCount, 1);
    }
    await assert.rejects(() => runPactiumQualityGateProfile({
      profile: "api:proof-bundle",
      operations: 1,
      pactium: {
        async recordOperation() {
          return { envelopeId: "bad" };
        },
        async exportProofBundle() {
          return { protocol: PACTIUM_PROTOCOL, bundleType: PACTIUM_PROOF_BUNDLE_TYPE, manifest: {}, envelope: null };
        }
      }
    }), /Proof Bundle verification failed/);
    await assert.rejects(() => runPactiumQualityGateProfile({
      profile: "api:recovery",
      operations: 1,
      pactium: {
        async beginOperationIntent() {
          return { factId: "missing-outcome" };
        },
        async appendOperationOutcome() {},
        async lookupOutcome() {
          return { exists: false };
        }
      }
    }), /recovery outcome lookup failed/);
    const customProfile = await runPactiumQualityGateProfile({
      profile: "api:custom",
      operations: 1,
      pactium: createPactium({ inMemory: true })
    });
    assert.equal(customProfile.operationCount, 1);
  });

  it("covers fail-closed protocol boundary and verifier error paths", async () => {
    assert.match(defaultPactiumDataDir(), /\.pactium$/);
    assert.throws(() => resolveWithin("/tmp/pactium-root", "../escape"), /escapes/);
    assert.throws(() => canonicalEncode(Symbol("bad")), /Unsupported/);

    const storageDir = await tempDataDir("pactium-boundary-");
    const storage = createStoragePort({ dataDir: storageDir });
    await storage.initialize();
    await fs.writeFile(path.join(storageDir, "pactium-manifest.json"), JSON.stringify({
      protocol: "other",
      schema: "other"
    }));
    await assert.rejects(() => createStoragePort({ dataDir: storageDir }).initialize(), /latest-schema-only/);
    const corruptDir = await tempDataDir("pactium-corrupt-");
    await fs.writeFile(path.join(corruptDir, "pactium-manifest.json"), "{not-json");
    await assert.rejects(() => createStoragePort({ dataDir: corruptDir }).initialize(), /Expected property name/);

    const rawStorage = createStoragePort({ dataDir: await tempDataDir("pactium-raw-") });
    const rawBlock = await rawStorage.putBlock(Buffer.from("raw"), { codec: "raw", refs: ["cid:sha256:missing"] });
    assert.equal((await rawStorage.putBlock(Buffer.from("raw"), { codec: "raw" })).deduped, true);
    assert.deepEqual((await rawStorage.walk(rawBlock.cid)).missing, ["cid:sha256:missing"]);
    const rawPath = path.join(rawStorage.dataDir, "cas", rawBlock.cid.slice("cid:sha256:".length, "cid:sha256:".length + 2), `${rawBlock.cid.slice("cid:sha256:".length)}.json`);
    const rawRecord = JSON.parse(await fs.readFile(rawPath, "utf8"));
    rawRecord.payloadBase64 = Buffer.from("corrupt").toString("base64");
    await fs.writeFile(rawPath, JSON.stringify(rawRecord));
    await assert.rejects(() => createStoragePort({ dataDir: rawStorage.dataDir }).getBlock(rawBlock.cid), /integrity failure/);

    const objectDir = await tempDataDir("pactium-object-");
    const objectStorage = createStoragePort({ dataDir: objectDir });
    await objectStorage.putProtocolObject("scope", "key", { ok: true });
    const objectPath = path.join(objectDir, "protocol", "scope", "key.json");
    const objectRecord = JSON.parse(await fs.readFile(objectPath, "utf8"));
    objectRecord.protocol = "wrong";
    await fs.writeFile(objectPath, JSON.stringify(objectRecord));
    await assert.rejects(() => createStoragePort({ dataDir: objectDir }).getProtocolObject("scope", "key"), /latest-schema-only/);

    assert.throws(() => createLedgerInclusionProof({ leafHashes: [], index: 0 }), /out of range/);
    assert.equal(verifyLedgerInclusionProof({ head: {}, proof: { proofType: "wrong" } }), false);
    assert.equal(verifyLedgerInclusionProof({ head: { size: 0 }, proof: { proofType: PACTIUM_PROOF_TYPES.ledgerInclusion, size: 0, index: 0 } }), false);
    assert.equal(verifyLedgerInclusionProof({ head: { size: 1, rootHash: "0" }, proof: { proofType: PACTIUM_PROOF_TYPES.ledgerInclusion, size: 1, index: 0, leafHash: "1", leaf: { a: 1 }, auditPath: [], rootHash: "0" } }), false);
    assert.equal(verifyLedgerConsistencyProof({ oldHead: {}, newHead: {}, proof: { proofType: "wrong" } }), false);
    assert.equal(verifyLedgerConsistencyProof({ oldHead: { size: 2 }, newHead: { size: 1 }, proof: { proofType: PACTIUM_PROOF_TYPES.ledgerConsistency, oldSize: 2, newSize: 1 } }), false);
    assert.equal(verifyLedgerConsistencyProof({
      oldHead: { size: 1, rootHash: "a" },
      newHead: { size: 2, rootHash: "b" },
      proof: { proofType: PACTIUM_PROOF_TYPES.ledgerConsistency, oldSize: 1, newSize: 2, oldLeafHashes: [], newLeafHashes: ["a", "b"] }
    }), false);

    const ledger = createLedgerTransparencyLog({ storage: createStoragePort({ inMemory: true }) });
    const append = await ledger.append({ factType: "operation.intent", key: "x" });
    assert.equal((await ledger.getEntry(append.entry.eventId)).eventId, append.entry.eventId);
    assert.equal(await ledger.getEntry("missing"), null);

    const engine = createVerifiableIndexEngine({ storage: createStoragePort({ inMemory: true }), domain: "errors" });
    await assert.rejects(() => engine.readSnapshot("cid:sha256:0000"), /missing/);
    assert.equal(engine.verifyProof({ proofType: "unknown" }), false);

    const pactium = createPactium({ inMemory: true });
    await assert.rejects(() => pactium.appendOperationOutcome({ intentId: "missing" }), /does not exist/);
    const intent = await pactium.beginOperationIntent({
      operationId: "causality",
      workspaceId: "w",
      causalityRefs: ["repair:previous"]
    });
    const outcome = await pactium.appendOperationOutcome({
      intentId: intent.factId,
      outcomeIdempotencyKey: "same",
      causalityRefs: ["retry:previous"],
      stateMutations: [
        { key: "keep", value: { ok: true } },
        { key: "keep", action: "delete" }
      ]
    });
    const replay = await pactium.appendOperationOutcome({ intentId: intent.factId, outcomeIdempotencyKey: "same" });
    assert.equal(replay.envelopeId, outcome.envelopeId);
    assert.equal(replay.replayed, true);

    const intentOnly = await pactium.recordOperation({
      operationId: "intent.replay",
      workspaceId: "w",
      idempotencyKey: "intent-only",
      returnIntentReplay: true
    });
    assert.equal(intentOnly.envelopeKind, "operation-outcome");

    assert.equal((await verifyProofEnvelope(null)).failures[0].code, "malformed_envelope");
    assert.equal((await verifyProofBundle(null)).failures[0].code, "malformed_bundle");
    const badEnvelope = { ...outcome, envelopeId: "proof_envelope_bad" };
    assert.ok((await pactium.verifyEnvelope(badEnvelope)).failures.some((failure) => failure.code === "bad_envelope_id"));
    const missingProof = { ...outcome, proofRefs: [{ cid: "cid:sha256:0".padEnd(75, "0"), payloadHash: "sha256:missing", byteLength: 1 }] };
    assert.ok((await pactium.verifyEnvelope(missingProof)).failures.some((failure) => failure.code === "missing_proof_material"));
    const badProofHash = { ...outcome, proofRefs: outcome.proofRefs.map((ref) => ({ ...ref, payloadHash: "sha256:bad" })) };
    assert.ok((await pactium.verifyEnvelope(badProofHash)).failures.some((failure) => failure.code === "replaced_proof_material"));
    const throwingBundleResolverResult = await verifyProofEnvelope(outcome, {
      bundleResolver: {
        has() {
          return true;
        },
        get() {
          throw new Error("resolver read failed");
        }
      }
    });
    assert.ok(throwingBundleResolverResult.failures.some((failure) => failure.code === "replaced_proof_material"));
    const directExtension = await pactium.createExtension({
      name: "direct",
      critical: false,
      valueRef: outcome.proofRefs[0].cid,
      valueHash: outcome.proofRefs[0].payloadHash
    });
    assert.equal(directExtension.valueRef, outcome.proofRefs[0].cid);
    const missingExtension = {
      ...outcome,
      extensions: [{ name: "x", critical: false, valueRef: "cid:sha256:1".padEnd(75, "1"), valueHash: "sha256:missing" }]
    };
    assert.ok((await pactium.verifyEnvelope(missingExtension)).failures.some((failure) => failure.code === "missing_extension_material"));
    const badExtensionHash = {
      ...outcome,
      extensions: [{
        ...directExtension,
        valueHash: "sha256:bad"
      }]
    };
    assert.ok((await pactium.verifyEnvelope(badExtensionHash)).failures.some((failure) => failure.code === "bad_extension_hash"));

    const validProofBlock = await pactium.storage.getBlock(outcome.proofRefs[0].cid);
    const validProofValue = JSON.parse(Buffer.from(validProofBlock.payloadBase64, "base64").toString("utf8"));
    const badInclusionBlock = await pactium.storage.putBlock({
      ...validProofValue,
      ledger: {
        ...validProofValue.ledger,
        inclusionProof: {
          ...validProofValue.ledger.inclusionProof,
          rootHash: "0".repeat(64)
        }
      }
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const badInclusionEnvelope = {
      ...outcome,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: badInclusionBlock.cid,
        payloadHash: badInclusionBlock.payloadHash,
        byteLength: badInclusionBlock.byteLength
      }]
    };
    assert.ok((await pactium.verifyEnvelope(badInclusionEnvelope)).failures.some((failure) => failure.code === "bad_ledger_inclusion"));

    const badConsistencyBlock = await pactium.storage.putBlock({
      ...validProofValue,
      ledger: {
        ...validProofValue.ledger,
        consistencyProof: {
          ...validProofValue.ledger.consistencyProof,
          newRootHash: "1".repeat(64)
        }
      }
    }, { kind: "proof-material:ledger-and-index-proofs" });
    const badConsistencyEnvelope = {
      ...outcome,
      proofRefs: [{
        name: "ledger-and-index-proofs",
        cid: badConsistencyBlock.cid,
        payloadHash: badConsistencyBlock.payloadHash,
        byteLength: badConsistencyBlock.byteLength
      }]
    };
    assert.ok((await pactium.verifyEnvelope(badConsistencyEnvelope)).failures.some((failure) => failure.code === "bad_ledger_consistency"));
    const defaultBundleById = await pactium.exportProofBundle(outcome.envelopeId);
    assert.equal(defaultBundleById.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    assert.equal(defaultBundleById.envelope.envelopeId, outcome.envelopeId);
    const replayPactium = createPactium({ inMemory: true });
    await replayPactium.recordOperation({
      operationId: "intent.replay.actual",
      workspaceId: "w",
      idempotencyKey: "same-replay",
      input: { a: 1 }
    });
    const intentReplay = await replayPactium.recordOperation({
      operationId: "intent.replay.actual",
      workspaceId: "w",
      idempotencyKey: "same-replay",
      input: { a: 1 },
      returnIntentReplay: true
    });
    assert.equal(intentReplay.envelopeKind, "operation-intent");
    assert.equal(intentReplay.replayed, true);

    const planner = createRepairPlanner();
    assert.equal(planner.plan([{ layer: "x", code: "manual" }]).tasks[0].action, "manual-investigation");
    const maintenance = createMaintenanceTaskEngine();
    assert.equal((await maintenance.runTask(maintenance.planTask("seal", {}))).result.plannedOnly, true);
  });

  it("rejects proof semantic rebinding attacks", async () => {
    const pactium = createPactium({ inMemory: true });
    const proofMaterialFor = async (envelope) =>
      canonicalDecode((await pactium.storage.getBlock(envelope.proofRefs[0].cid)).bytes);
    const envelopeWithProofBlock = (envelope, block) => ({
      ...envelope,
      proofRefs: [{
        ...envelope.proofRefs[0],
        cid: block.cid,
        payloadHash: block.payloadHash,
        byteLength: block.byteLength
      }]
    });

    const first = await pactium.recordOperation({
      operationId: "semantic.state.first",
      workspaceId: "semantic-bind",
      stateMutations: [{ key: "setting", value: { version: 1 } }]
    });
    const second = await pactium.recordOperation({
      operationId: "semantic.state.second",
      workspaceId: "semantic-bind",
      stateMutations: [{ key: "setting", value: { version: 2 } }]
    });
    const firstMaterial = await proofMaterialFor(first);
    const secondMaterial = await proofMaterialFor(second);
    const reboundStateMaterial = structuredClone(firstMaterial);
    reboundStateMaterial.proofs.state = structuredClone(secondMaterial.proofs.state);
    reboundStateMaterial.proofs.stateCommit = {
      ...reboundStateMaterial.proofs.stateCommit,
      stateRoot: secondMaterial.proofs.stateCommit.stateRoot,
      mutations: structuredClone(secondMaterial.proofs.stateCommit.mutations),
      mutationKeys: [...secondMaterial.proofs.stateCommit.mutationKeys],
      mutationActions: [...secondMaterial.proofs.stateCommit.mutationActions],
      mutationCount: secondMaterial.proofs.stateCommit.mutationCount,
      touchedKeyCount: secondMaterial.proofs.stateCommit.touchedKeyCount
    };
    const reboundStateBlock = await pactium.storage.putBlock(reboundStateMaterial, {
      kind: "proof-material:ledger-and-index-proofs",
      refs: [firstMaterial.ledger.inclusionProof.leaf.factCid]
    });
    const reboundState = await pactium.verifyEnvelope(envelopeWithProofBlock(first, reboundStateBlock));
    assert.ok(reboundState.failures.some((failure) => failure.code === "bad_state_commit_binding"));

    const head = await pactium.ledger.head();
    const appendCondition = createAppendCondition({
      workspaceId: "semantic-append",
      requiredLedgerHead: head.headId
    });
    const conditioned = await pactium.beginOperationIntent({
      operationId: "semantic.append.condition",
      workspaceId: "semantic-append",
      appendCondition
    });
    const conditionedMaterial = await proofMaterialFor(conditioned);
    const reboundConditionMaterial = structuredClone(conditionedMaterial);
    reboundConditionMaterial.appendCondition = createAppendCondition({
      workspaceId: "semantic-append",
      requiredLedgerHead: "ledger_head_attacker"
    });
    const reboundConditionBlock = await pactium.storage.putBlock(reboundConditionMaterial, {
      kind: "proof-material:ledger-and-index-proofs",
      refs: [conditionedMaterial.ledger.inclusionProof.leaf.factCid]
    });
    const reboundCondition = await pactium.verifyEnvelope(envelopeWithProofBlock(conditioned, reboundConditionBlock));
    assert.ok(reboundCondition.failures.some((failure) => failure.code === "bad_append_condition_binding"));
  });

  it("covers LicoLite verifier failure modes and convenience exports", async () => {
    const pactium = createPactium({ inMemory: true });
    const licolite = createLicoLiteAspect({
      pactium,
      signer: createLicoLiteSigner({ secret: "good" }),
      evidencePolicy: "opportunistic"
    });
    const emptySigner = createLicoLiteSigner({ signerId: "", secret: "" });
    assert.equal(await emptySigner.verify("", await emptySigner.sign("")), true);
    const noSignerAspect = createLicoLiteAspect({
      pactium: createPactium({ inMemory: true }),
      signer: false,
      evidencePolicy: "opportunistic"
    });
    const unsigned = await noSignerAspect.recordWorkspaceOperation({
      operationId: "unsigned",
      workspaceId: "unsigned"
    });
    assert.ok((await noSignerAspect.verifyEnvelope(unsigned)).failures.some((failure) => failure.code === "missing_signature"));
    const fakeSignature = await noSignerAspect.core.createExtension({
      name: LICOLITE_SIGNATURE_EXTENSION,
      critical: false,
      value: {
        protocol: "pactium.v0.2.licolite-aspect",
        signerId: "fake",
        algorithm: "hmac-sha256",
        signedEnvelopeHash: envelopeSigningHash(unsigned),
        signature: "fake"
      }
    });
    const fakeSigned = await noSignerAspect.core.storeEnvelope({
      ...unsigned,
      extensions: [...unsigned.extensions, fakeSignature]
    });
    assert.ok((await noSignerAspect.verifyEnvelope(fakeSigned)).failures.some((failure) => failure.code === "signature_verifier_unconfigured"));
    const customSigner = {
      async sign(message) {
        return `plain:${message}`;
      },
      async verify(message, signature) {
        return signature === `plain:${message}`;
      }
    };
    const customSignerAspect = createLicoLiteAspect({
      pactium: createPactium({ inMemory: true }),
      signer: customSigner,
      evidencePolicy: "opportunistic"
    });
    const customEnvelope = await customSignerAspect.recordWorkspaceOperation({
      operationId: "custom.signer",
      scope: "scope-only"
    });
    assert.equal((await customSignerAspect.verifyEnvelope(customEnvelope)).ok, true);
    const ownedAspect = createLicoLiteAspect({
      inMemory: true,
      evidencePolicy: "opportunistic",
      signerSecret: "owned"
    });
    assert.equal((await ownedAspect.recordWorkspaceOperation({ operationId: "owned.core" })).protocol, PACTIUM_PROTOCOL);
    const strict = createLicoLiteAspect({ pactium, evidencePolicy: "production" });
    await assert.rejects(() => strict.recordWorkspaceOperation({
      operationId: "missing.effect",
      workspaceId: "lico-fail",
      policyEvidence: { allow: true }
    }), /workspace effect evidence/);
    const envelope = await licolite.recordWorkspaceOperation({
      operationId: "licolite.failure.modes",
      workspaceId: "lico-fail",
      policyEvidence: { allow: true },
      workspaceEffectEvidence: { ref: "effect" }
    });
    const productionNoVerifier = createLicoLiteAspect({ pactium, evidencePolicy: "production" });
    assert.ok((await productionNoVerifier.verifyEnvelope(envelope)).failures.some((failure) => failure.code === "missing_signature_verifier"));
    const noSignature = { ...envelope, extensions: envelope.extensions.filter((extension) => extension.name !== "licolite.signature") };
    assert.ok((await licolite.verifyEnvelope(noSignature)).failures.some((failure) => failure.code === "missing_signature"));
    const downgradedRequiredExtension = {
      ...envelope,
      criticalExtensions: [],
      extensions: envelope.extensions.map((extension) =>
        extension.name === LICOLITE_POLICY_EXTENSION || extension.name === LICOLITE_WORKSPACE_EFFECT_EXTENSION
          ? { ...extension, critical: false }
          : extension)
    };
    assert.ok((await licolite.verifyEnvelope(downgradedRequiredExtension)).failures.some((failure) => failure.code === "noncritical_required_extension"));
    const missingSignatureMaterial = {
      ...envelope,
      extensions: envelope.extensions.map((extension) => extension.name === "licolite.signature"
        ? { ...extension, valueRef: "cid:sha256:2".padEnd(75, "2") }
        : extension)
    };
    assert.ok((await licolite.verifyEnvelope(missingSignatureMaterial)).failures.some((failure) => failure.code === "missing_signature_material"));
    const tampered = { ...envelope, relatedEnvelopeIds: ["tampered"] };
    assert.ok((await licolite.verifyEnvelope(tampered)).failures.some((failure) => failure.code === "bad_signed_envelope_hash"));
    const missingEvidenceRef = {
      ...envelope,
      extensions: envelope.extensions.map((extension) => extension.name === LICOLITE_POLICY_EXTENSION
        ? { ...extension, valueRef: "cid:sha256:3".padEnd(75, "3"), metadata: {} }
        : extension)
    };
    assert.ok((await licolite.verifyEnvelope(missingEvidenceRef)).failures.some((failure) => failure.code === "missing_evidence_ref"));
    const policyExtension = envelope.extensions.find((extension) => extension.name === LICOLITE_POLICY_EXTENSION);
    const policyBlock = await pactium.storage.getBlock(policyExtension.valueRef);
    const badPolicyBlock = await pactium.storage.putBlock({
      ...canonicalDecode(policyBlock.bytes),
      evidenceHash: `sha256:${"0".repeat(64)}`
    }, { kind: "proof-extension:licolite.policy" });
    const badEvidenceHash = {
      ...envelope,
      extensions: envelope.extensions.map((extension) => extension.name === LICOLITE_POLICY_EXTENSION
        ? { ...extension, valueRef: badPolicyBlock.cid, valueHash: badPolicyBlock.payloadHash }
        : extension)
    };
    assert.ok((await licolite.verifyEnvelope(badEvidenceHash)).failures.some((failure) => failure.code === "bad_evidence_hash"));
    const algorithmKeys = crypto.generateKeyPairSync("ed25519");
    const wrongAlgorithm = createLicoLiteAspect({
      pactium,
      signer: createLicoLiteSigner({
        signerId: "licolite-local",
        algorithm: "ed25519",
        publicKey: algorithmKeys.publicKey.export({ type: "spki", format: "pem" })
      }),
      evidencePolicy: "opportunistic"
    });
    assert.ok((await wrongAlgorithm.verifyEnvelope(envelope)).failures.some((failure) => failure.code === "bad_signature_algorithm"));
    const wrongSigner = createLicoLiteAspect({
      pactium,
      signer: createLicoLiteSigner({ secret: "wrong" }),
      evidencePolicy: "opportunistic"
    });
    assert.ok((await wrongSigner.verifyEnvelope(envelope)).failures.some((failure) => failure.code === "bad_signature"));
    assert.ok(licolite.planRepair([{ layer: "licolite", code: "derived_index_missing" }]).tasks.length > 0);

    const standalone = createPactium({ inMemory: true });
    const standaloneEnvelope = await recordLicoLiteWorkspaceOperation({
      operationId: "standalone",
      workspaceId: "standalone",
      policyEvidence: { ok: true },
      workspaceEffectEvidence: { ok: true }
    }, { pactium: standalone, evidencePolicy: "production", signerSecret: "standalone" });
    assert.equal((await verifyLicoLiteEnvelope(standaloneEnvelope, {
      pactium: standalone,
      evidencePolicy: "production",
      signerSecret: "standalone"
    })).ok, true);
    const standaloneBundle = await standalone.exportProofBundle(standaloneEnvelope);
    assert.equal(standaloneBundle.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
    assert.equal((await verifyLicoLiteBundle(standaloneBundle, {
      pactium: standalone,
      evidencePolicy: "production",
      signerSecret: "standalone"
    })).ok, true);
  });

  it("covers remaining HTTP and CLI public surfaces", async () => {
    const started = await startPactiumHttpServer({ dataDir: await tempDataDir("pactium-start-server-"), port: 0 });
    try {
      const health = await requestJson({ port: started.server.address().port, requestPath: "/health" });
      assert.equal(health.body.ok, true);
      assert.equal(Object.hasOwn(health.body, "dataDir"), false);
      assert.equal(started.host, "127.0.0.1");
      assert.equal(started.maxBodyBytes, 1024 * 1024);
    } finally {
      await close(started.server);
    }

    const limitedServer = createPactiumHttpServer({
      pactium: createPactium({ inMemory: true }),
      maxBodyBytes: 32
    });
    const limitedAddress = await listen(limitedServer);
    try {
      const tooLarge = await requestJson({
        port: limitedAddress.port,
        method: "POST",
        requestPath: "/operations",
        body: { operationId: "x".repeat(128) }
      });
      assert.equal(tooLarge.statusCode, 413);
      assert.equal(tooLarge.body.code, "request_body_too_large");
    } finally {
      await close(limitedServer);
    }

    const pactium = createPactium({ inMemory: true });
    const server = createPactiumHttpServer({ pactium });
    const address = await listen(server);
    try {
      const protocols = await requestJson({ port: address.port, requestPath: "/protocols" });
      assert.equal(protocols.body.rootExport, "latest-proof-first-only");
      const intent = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/intents",
        body: { operationId: "http.intent", workspaceId: "http-2" }
      });
      const outcome = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/outcomes",
        body: { intentId: intent.body.factId }
      });
      assert.equal(outcome.body.envelopeKind, "operation-outcome");
      assert.equal((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/intents/lookup",
        body: { intentId: intent.body.factId }
      })).body.exists, false);
      assert.equal((await requestJson({ port: address.port, requestPath: `/outcomes/${encodeURIComponent(intent.body.factId)}` })).body.exists, true);
      const exported = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/bundles/export",
        body: { envelope: outcome.body }
      });
      assert.equal(exported.body.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
      assert.equal((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/verify/bundle",
        body: exported.body
      })).body.ok, true);
      const projection = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/workspaces/projection",
        body: { workspaceId: "http-2" }
      });
      assert.equal(projection.body.nextOrdinal, 2);
      assert.equal((await requestJson({
        port: address.port,
        requestPath: `/workspaces/${encodeURIComponent("http-2")}/projection`
      })).body.nextOrdinal, 2);
      assert.equal((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/workspaces/membership",
        body: {
          workspaceId: "http-2",
          ledgerEventId: outcome.body.factRef.ledgerEventId
        }
      })).body.member, true);
      const ledgerCursor = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/cursors/ledger",
        body: { position: 0, limit: 2 }
      });
      assert.equal(ledgerCursor.body.entries.length, 2);
      const workspaceCursor = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/cursors/workspace",
        body: { workspaceId: "http-2", limit: 2 }
      });
      assert.equal(workspaceCursor.body.entries.length, 2);
      assert.equal((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/cursors/verify",
        body: { cursor: ledgerCursor.body.cursor, context: { head: ledgerCursor.body.head } }
      })).body.ok, true);
      assert.match((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/append-conditions",
        body: { expectedLedgerSize: 2 }
      })).body.conditionHash, /^sha256:/);
      const repairPlan = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/repair/plan",
        body: {
          cursor: ledgerCursor.body.cursor,
          failures: [{ layer: "proof-bundle", code: "missing_bundle_block" }]
        }
      });
      assert.equal(repairPlan.body.recoveryPlanType, "pactium.recovery-plan");
      assert.ok(repairPlan.body.tasks.length >= 2);
      const maintenanceTask = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/maintenance/tasks/plan",
        body: { taskType: "doctor" }
      });
      assert.equal(maintenanceTask.body.taskType, "doctor");
      assert.equal((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/maintenance/tasks/run",
        body: maintenanceTask.body
      })).body.ok, true);
      const extension = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/extensions",
        body: { name: "unit.http", value: { ok: true } }
      });
      assert.equal(extension.body.name, "unit.http");
      assert.equal((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/envelopes",
        body: outcome.body
      })).body.envelopeType, "pactium.proof-envelope");
      const lico = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/licolite/operations",
        body: { operationId: "http.lico", workspaceId: "http-lico" }
      });
      assert.equal(lico.body.envelopeKind, "operation-outcome");
      const licoVerify = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/licolite/verify/envelope",
        body: lico.body
      });
      assert.equal(licoVerify.body.ok, true);
      const licoBundle = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/licolite/bundles/export",
        body: { envelopeId: lico.body.envelopeId }
      });
      assert.equal(licoBundle.body.bundleType, PACTIUM_PROOF_BUNDLE_TYPE);
      assert.equal((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/licolite/verify/bundle",
        body: { bundle: licoBundle.body }
      })).body.ok, true);
      assert.ok((await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/licolite/repair/plan",
        body: { failures: [{ layer: "licolite", code: "missing_licolite_policy" }] }
      })).body.tasks.length >= 1);
      assert.equal((await requestJson({ port: address.port, requestPath: "/missing" })).statusCode, 404);
      const error = await requestJson({
        port: address.port,
        method: "POST",
        requestPath: "/outcomes",
        body: { intentId: "missing" }
      });
      assert.equal(error.statusCode, 500);
    } finally {
      await close(server);
    }

    const cliPath = path.resolve("bin/pactium.mjs");
    const cliDir = await tempDataDir("pactium-cli-branches-");
    const help = await execFileAsync(process.execPath, [cliPath, "--help"]);
    assert.match(help.stdout, /Pactium/);
    const bodyFile = path.join(cliDir, "body.json");
    await fs.writeFile(bodyFile, JSON.stringify({ operationId: "cli.intent", workspaceId: "cli-branches" }));
    const intent = JSON.parse((await execFileAsync(process.execPath, [
      cliPath,
      "intent",
      "begin",
      "--data-dir",
      cliDir,
      "--body-file",
      bodyFile
    ])).stdout);
    const outcome = JSON.parse((await execFileAsync(process.execPath, [
      cliPath,
      "outcome",
      "append",
      "--data-dir",
      cliDir,
      "--body",
      JSON.stringify({ intentId: intent.factId })
    ])).stdout);
    assert.equal(outcome.envelopeKind, "operation-outcome");
    const verifyFile = path.join(cliDir, "envelope.json");
    await fs.writeFile(verifyFile, JSON.stringify(outcome));
    assert.equal(JSON.parse((await execFileAsync(process.execPath, [
      cliPath,
      "envelope",
      "verify",
      "--data-dir",
      cliDir,
      "--body-file",
      verifyFile
    ])).stdout).ok, true);
    const lico = JSON.parse((await execFileAsync(process.execPath, [
      cliPath,
      "licolite",
      "record",
      "--data-dir",
      cliDir,
      "--body",
      JSON.stringify({ operationId: "cli.lico", workspaceId: "cli-lico" })
    ])).stdout);
    assert.equal(JSON.parse((await execFileAsync(process.execPath, [
      cliPath,
      "licolite",
      "verify",
      "--data-dir",
      cliDir,
      "--body",
      JSON.stringify(lico)
    ])).stdout).ok, true);
    const invalid = await execFileAsync(process.execPath, [cliPath, "unknown"], { reject: false }).catch((error) => error);
    assert.equal(invalid.code, 1);
  });
});
