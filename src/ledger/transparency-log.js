import crypto from "node:crypto";

import { PACTIUM_PROOF_TYPES, PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { canonicalEncode } from "../canonical/value.js";
import { cidFromHex, createId, hashBytes, hexToBytes, protocolHash } from "../protocol/hashing.js";
import { createStoragePort } from "../storage/storage-port.js";
import { asArray, nowIso } from "../shared/records.js";
import { cacheGet, cacheSet } from "../shared/lru-cache.js";
import { createVerifierManifest, signLedgerHead } from "./signed-head.js";

const LEAF_HASH_PREFIX = Buffer.from([0x00]);
const NODE_HASH_PREFIX = Buffer.from([0x01]);

export function ledgerLeafHash(leaf) {
  return crypto.createHash("sha256").update(LEAF_HASH_PREFIX).update(canonicalEncode(leaf)).digest("hex");
}

export function ledgerNodeHash(leftHash, rightHash) {
  return crypto.createHash("sha256")
    .update(NODE_HASH_PREFIX)
    .update(hexToBytes(leftHash))
    .update(hexToBytes(rightHash))
    .digest("hex");
}

export function emptyTreeHash() {
  return hashBytes(Buffer.alloc(0));
}

function hashFromAuditItem(item) {
  return typeof item === "string" ? item : String(item?.hash || "");
}

function isHashHex(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function auditPathHashesAreValid(auditPath) {
  return asArray(auditPath).every((item) => isHashHex(hashFromAuditItem(item)));
}

function largestPowerOfTwoLessThan(value) {
  let power = 1;
  while (power * 2 < value) power *= 2;
  return power;
}

function rootHashFromLeafHashes(leafHashes, start = 0, end = undefined) {
  const hashes = start === 0 && end === undefined ? asArray(leafHashes) : leafHashes;
  const stop = end ?? hashes.length;
  const size = stop - start;
  if (size === 0) return emptyTreeHash();
  if (size === 1) return hashes[start];
  const split = largestPowerOfTwoLessThan(size);
  return ledgerNodeHash(
    rootHashFromLeafHashes(hashes, start, start + split),
    rootHashFromLeafHashes(hashes, start + split, stop)
  );
}

function inclusionPath(index, leafHashes, start = 0, end = undefined) {
  const hashes = start === 0 && end === undefined ? asArray(leafHashes) : leafHashes;
  const stop = end ?? hashes.length;
  const size = stop - start;
  if (size <= 1) return [];
  const split = largestPowerOfTwoLessThan(size);
  if (index < split) {
    return [
      ...inclusionPath(index, hashes, start, start + split),
      { side: "right", hash: rootHashFromLeafHashes(hashes, start + split, stop) }
    ];
  }
  return [
    { side: "left", hash: rootHashFromLeafHashes(hashes, start, start + split) },
    ...inclusionPath(index - split, hashes, start + split, stop)
  ];
}

function rootFromInclusion(index, size, leafHash, proof, offset = 0) {
  if (size === 1) return { rootHash: leafHash, offset };
  const split = largestPowerOfTwoLessThan(size);
  if (index < split) {
    const left = rootFromInclusion(index, split, leafHash, proof, offset);
    const item = proof[left.offset];
    if (item && typeof item === "object" && item.side && item.side !== "right") return { rootHash: "", offset: proof.length + 1 };
    return { rootHash: ledgerNodeHash(left.rootHash, hashFromAuditItem(item)), offset: left.offset + 1 };
  }
  const item = proof[offset];
  if (item && typeof item === "object" && item.side && item.side !== "left") return { rootHash: "", offset: proof.length + 1 };
  const right = rootFromInclusion(index - split, size - split, leafHash, proof, offset + 1);
  return { rootHash: ledgerNodeHash(hashFromAuditItem(item), right.rootHash), offset: right.offset };
}

function consistencyPath(oldSize, leafHashes, trusted = true, start = 0, end = undefined) {
  const hashes = start === 0 && end === undefined ? asArray(leafHashes) : leafHashes;
  const stop = end ?? hashes.length;
  const newSize = stop - start;
  if (oldSize === 0) return [];
  if (oldSize === newSize) return trusted ? [] : [rootHashFromLeafHashes(hashes, start, stop)];
  const split = largestPowerOfTwoLessThan(newSize);
  if (oldSize <= split) {
    return [
      ...consistencyPath(oldSize, hashes, trusted, start, start + split),
      rootHashFromLeafHashes(hashes, start + split, stop)
    ];
  }
  return [
    ...consistencyPath(oldSize - split, hashes, false, start + split, stop),
    rootHashFromLeafHashes(hashes, start, start + split)
  ];
}

function verifyConsistencyPath({ oldSize, newSize, oldRootHash, newRootHash, auditPath }) {
  const proof = asArray(auditPath).map(hashFromAuditItem);
  if (!isHashHex(oldRootHash) || !isHashHex(newRootHash) || !auditPathHashesAreValid(proof)) return false;
  if (oldSize > newSize) return false;
  if (oldSize === 0) return oldRootHash === emptyTreeHash() && proof.length === 0;
  if (oldSize === newSize) return oldRootHash === newRootHash && proof.length === 0;
  if (proof.length === 0) return false;

  let first = oldSize - 1;
  let second = newSize - 1;
  while ((first & 1) === 1) {
    first >>= 1;
    second >>= 1;
  }

  let offset = 0;
  let oldHash;
  let newHash;
  if (first === 0) {
    oldHash = oldRootHash;
    newHash = oldRootHash;
  } else {
    oldHash = proof[offset];
    newHash = proof[offset];
    offset += 1;
  }

  while (first !== 0) {
    if ((first & 1) === 1) {
      if (offset >= proof.length) return false;
      oldHash = ledgerNodeHash(proof[offset], oldHash);
      newHash = ledgerNodeHash(proof[offset], newHash);
      offset += 1;
    } else if (first < second) {
      if (offset >= proof.length) return false;
      newHash = ledgerNodeHash(newHash, proof[offset]);
      offset += 1;
    }
    first >>= 1;
    second >>= 1;
  }

  while (second !== 0) {
    if (offset >= proof.length) return false;
    newHash = ledgerNodeHash(newHash, proof[offset]);
    offset += 1;
    second >>= 1;
  }

  return offset === proof.length && oldHash === oldRootHash && newHash === newRootHash;
}

function compactRangeRoot(peaks) {
  const normalized = asArray(peaks);
  if (normalized.length === 0) return emptyTreeHash();
  let current = normalized[normalized.length - 1].hash;
  for (let index = normalized.length - 2; index >= 0; index -= 1) {
    current = ledgerNodeHash(normalized[index].hash, current);
  }
  return current;
}

function levelSize(level) {
  return 2 ** Number(level || 0);
}

function ledgerHeadFromCompactRange({ peaks = [], size = 0, previousHeadId = "", createdAt = nowIso(), ledgerId = "pactium-operation-ledger" } = {}) {
  const rootHash = compactRangeRoot(peaks);
  const headBase = {
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    ledgerId,
    size,
    rootHash,
    root: cidFromHex(rootHash),
    previousHeadId,
    createdAt
  };
  return {
    ...headBase,
    headId: createId("ledger_head", headBase)
  };
}

export function createLedgerInclusionProof({ leafHashes = [], index = 0, leaf = null, headRef = "" } = {}) {
  const hashes = asArray(leafHashes);
  if (index < 0 || index >= hashes.length) {
    throw new RangeError("Ledger inclusion proof index is out of range.");
  }
  const rootHash = rootHashFromLeafHashes(hashes);
  return {
    protocol: PACTIUM_PROTOCOL,
    proofType: PACTIUM_PROOF_TYPES.ledgerInclusion,
    index,
    size: hashes.length,
    leafHash: hashes[index],
    leaf,
    auditPath: inclusionPath(index, hashes),
    rootHash,
    headRef
  };
}

export function verifyLedgerInclusionProof({ head = {}, proof = {} } = {}) {
  if (!proof || proof.proofType !== PACTIUM_PROOF_TYPES.ledgerInclusion) return false;
  if (proof.size === 0 || proof.index < 0 || proof.index >= proof.size) return false;
  if (!isHashHex(proof.leafHash) || !isHashHex(proof.rootHash) || !auditPathHashesAreValid(proof.auditPath)) return false;
  const leafHash = proof.leaf ? ledgerLeafHash(proof.leaf) : proof.leafHash;
  if (leafHash !== proof.leafHash) return false;
  const result = rootFromInclusion(proof.index, proof.size, proof.leafHash, asArray(proof.auditPath));
  return result.offset === asArray(proof.auditPath).length &&
    result.rootHash === proof.rootHash &&
    result.rootHash === head.rootHash &&
    Number(head.size) === Number(proof.size);
}

export function createLedgerConsistencyProof({ oldHead = {}, newEntries = [], headRef = "", oldHeadRef = "" } = {}) {
  const hashes = asArray(newEntries).map((entry) => entry.leafHash);
  const oldSize = Number(oldHead.size || 0);
  if (oldSize > hashes.length) {
    throw new RangeError("Ledger consistency proof old size is greater than new size.");
  }
  const oldRootHash = oldSize === 0 ? emptyTreeHash() : rootHashFromLeafHashes(hashes, 0, oldSize);
  const newRootHash = rootHashFromLeafHashes(hashes);
  const auditPath = consistencyPath(oldSize, hashes);
  return {
    protocol: PACTIUM_PROTOCOL,
    proofType: PACTIUM_PROOF_TYPES.ledgerConsistency,
    oldSize,
    newSize: hashes.length,
    oldRootHash,
    newRootHash,
    auditPath,
    oldHeadRef,
    newHeadRef: headRef,
    proofHash: protocolHash("ledger.consistency", { oldSize, newSize: hashes.length, oldRootHash, newRootHash, auditPath })
  };
}

export function verifyLedgerConsistencyProof({ oldHead = {}, newHead = {}, proof = {} } = {}) {
  if (!proof || proof.proofType !== PACTIUM_PROOF_TYPES.ledgerConsistency) return false;
  if (Number(oldHead.size || 0) !== Number(proof.oldSize)) return false;
  if (Number(newHead.size || 0) !== Number(proof.newSize)) return false;
  if (proof.oldSize > proof.newSize) return false;
  if (!isHashHex(proof.oldRootHash) || !isHashHex(proof.newRootHash) || !auditPathHashesAreValid(proof.auditPath)) return false;
  return proof.oldRootHash === oldHead.rootHash &&
    proof.newRootHash === newHead.rootHash &&
    verifyConsistencyPath({
      oldSize: Number(proof.oldSize || 0),
      newSize: Number(proof.newSize || 0),
      oldRootHash: proof.oldRootHash,
      newRootHash: proof.newRootHash,
      auditPath: proof.auditPath
    });
}

export function createCompactRange({ size = 0, peaks = [] } = {}) {
  return {
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    rangeType: "pactium.ledger.compact-range",
    size: Number(size || 0),
    peaks: asArray(peaks)
  };
}

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function levelForSize(size) {
  return Math.log2(size);
}

const RANGE_ROOT_CACHE_LIMIT = 4096;
const EVENT_INDEX_CACHE_LIMIT = 65536;

export function createLedgerTransparencyLog({
  storage = createStoragePort({ inMemory: true }),
  ledgerId = "pactium-operation-ledger",
  signer = "auto",
  verifierManifest = null
} = {}) {
  let compactRange = createCompactRange();
  let currentHead = null;
  let signingState = null;
  let eventIndex = new Map();
  let rangeRootCache = new Map();
  let loaded = false;
  let loadPromise = null;
  let appendLane = Promise.resolve();

  async function load() {
    if (loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      compactRange = await storage.getProtocolObject("ledger", "compact-range-current", null);
      currentHead = await storage.getProtocolObject("ledger", "head-current", null);
      if (compactRange && currentHead) {
        loaded = true;
        return;
      }
      compactRange = createCompactRange();
      currentHead = ledgerHeadFromCompactRange({ peaks: [], size: 0, ledgerId });
      loaded = true;
    })();
    try {
      return await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  async function reload() {
    await appendLane.catch(() => null);
    compactRange = createCompactRange();
    currentHead = null;
    signingState = null;
    eventIndex = new Map();
    rangeRootCache = new Map();
    loaded = false;
    loadPromise = null;
    await load();
  }

  async function writeNodeRecord(node) {
    await storage.putProtocolObject("ledger-node", `${node.level}-${node.index}`, node);
  }

  async function readNodeRecord(level, index) {
    return storage.getProtocolObject("ledger-node", `${level}-${index}`, null);
  }

  async function readLeafRecord(index) {
    return storage.getProtocolObject("ledger-leaf", String(index), null);
  }

  async function requireLeafRecord(index) {
    const leaf = await readLeafRecord(index);
    if (!leaf) throw new Error(`Ledger leaf missing for ${index}`);
    return leaf;
  }

  // Leaf ranges are immutable in an append-only ledger, so every computed
  // range root can be memoized for reuse across proof generations.
  async function rangeRoot(start, size) {
    if (size === 0) return emptyTreeHash();
    const cacheKey = `${start}:${size}`;
    const cached = cacheGet(rangeRootCache, cacheKey);
    if (cached !== undefined) return cached;
    let hash;
    if (size === 1) {
      hash = (await requireLeafRecord(start)).leafHash;
    } else if (isPowerOfTwo(size)) {
      const level = levelForSize(size);
      const node = await readNodeRecord(level, Math.floor(start / size));
      if (!node) throw new Error(`Ledger node missing for level ${level} index ${Math.floor(start / size)}`);
      hash = node.hash;
    } else {
      const split = largestPowerOfTwoLessThan(size);
      hash = ledgerNodeHash(
        await rangeRoot(start, split),
        await rangeRoot(start + split, size - split)
      );
    }
    cacheSet(rangeRootCache, cacheKey, hash, RANGE_ROOT_CACHE_LIMIT);
    return hash;
  }

  async function inclusionPathFromStore(index, size, start = 0) {
    if (size <= 1) return [];
    const split = largestPowerOfTwoLessThan(size);
    if (index < split) {
      return [
        ...await inclusionPathFromStore(index, split, start),
        { side: "right", hash: await rangeRoot(start + split, size - split) }
      ];
    }
    return [
      { side: "left", hash: await rangeRoot(start, split) },
      ...await inclusionPathFromStore(index - split, size - split, start + split)
    ];
  }

  async function consistencyPathFromStore(oldSize, newSize, start = 0, trusted = true) {
    if (oldSize === 0) return [];
    if (oldSize === newSize) return trusted ? [] : [await rangeRoot(start, newSize)];
    const split = largestPowerOfTwoLessThan(newSize);
    if (oldSize <= split) {
      return [
        ...await consistencyPathFromStore(oldSize, split, start, trusted),
        await rangeRoot(start + split, newSize - split)
      ];
    }
    return [
      ...await consistencyPathFromStore(oldSize - split, newSize - split, start + split, false),
      await rangeRoot(start, split)
    ];
  }

  async function createStoredInclusionProof({ index, leaf, head }) {
    if (Number(index || 0) < 0 || Number(index || 0) >= Number(head.size || 0)) {
      throw new RangeError("Ledger inclusion proof index is out of range.");
    }
    const leafRecord = await requireLeafRecord(index);
    return {
      protocol: PACTIUM_PROTOCOL,
      proofType: PACTIUM_PROOF_TYPES.ledgerInclusion,
      index,
      size: Number(head.size || 0),
      leafHash: leafRecord.leafHash,
      leaf,
      auditPath: await inclusionPathFromStore(index, Number(head.size || 0)),
      rootHash: head.rootHash,
      headRef: head.headId || ""
    };
  }

  async function createStoredConsistencyProof({ oldHead, newHead }) {
    const oldSize = Number(oldHead.size || 0);
    const newSize = Number(newHead.size || 0);
    if (oldSize > newSize) {
      throw new RangeError("Ledger consistency proof old size is greater than new size.");
    }
    const auditPath = await consistencyPathFromStore(oldSize, newSize);
    return {
      protocol: PACTIUM_PROTOCOL,
      proofType: PACTIUM_PROOF_TYPES.ledgerConsistency,
      oldSize,
      newSize,
      oldRootHash: oldHead.rootHash,
      newRootHash: newHead.rootHash,
      auditPath,
      oldHeadRef: oldHead.headId || "",
      newHeadRef: newHead.headId || "",
      proofHash: protocolHash("ledger.consistency", {
        oldSize,
        newSize,
        oldRootHash: oldHead.rootHash,
        newRootHash: newHead.rootHash,
        auditPath
      })
    };
  }

  async function ensureSigningState() {
    if (signer === false) return null;
    if (signingState) return signingState;
    if (signer && signer !== "auto") {
      const manifest = createVerifierManifest(verifierManifest || signer.manifest || {
        signers: [{
          signerId: signer.signerId || "pactium-ledger-signer",
          algorithm: "ed25519",
          publicKey: signer.publicKey,
          roles: ["ledger-head"]
        }]
      });
      signingState = {
        signerId: signer.signerId || manifest.signers[0]?.signerId || "pactium-ledger-signer",
        privateKey: signer.privateKey,
        manifest,
        signerSource: "host-provided",
        trustLevel: "trusted"
      };
      await storage.putProtocolObject("ledger", "verifier-manifest-current", manifest);
      return signingState;
    }
    // Auto-generated signer (development/TOFU). Private key is NOT persisted
    // to protocol storage. The manifest is stored for verification continuity
    // but callers MUST provide a trusted manifest for meaningful trust.
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const signerId = createId("ledger_signer", { ledgerId, publicKey: publicKey.export({ type: "spki", format: "pem" }) });
    const manifest = createVerifierManifest({
      signers: [{
        signerId,
        algorithm: "ed25519",
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        roles: ["ledger-head"]
      }],
      quorum: 1
    });
    signingState = {
      signerId,
      algorithm: "ed25519",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      manifest,
      signerSource: "auto-generated",
      trustLevel: "tofu"
    };
    // Only store the public manifest, never the private key.
    await storage.putProtocolObject("ledger", "verifier-manifest-current", manifest);
    return signingState;
  }

  async function signHead(head) {
    const state = await ensureSigningState();
    if (!state) return head;
    const signature = signLedgerHead(head, {
      privateKey: state.privateKey,
      signerId: state.signerId,
      manifest: state.manifest
    });
    const signatureBlock = await storage.putBlock(signature, { kind: "ledger-head-signature" });
    return {
      ...head,
      signatureRef: signatureBlock.cid,
      signatureHash: signatureBlock.payloadHash,
      verifierManifest: state.manifest,
      verifierManifestRef: state.manifest.manifestId,
      signatures: [signature],
      signerSource: state.signerSource || "auto-generated",
      trustLevel: state.trustLevel || "tofu"
    };
  }

  async function mergeLeafIntoCompactRange(entry) {
    let cursor = {
      level: 0,
      index: entry.index,
      hash: entry.leafHash,
      size: 1,
      leafRef: `ledger/leaf/${entry.index}`
    };
    const peaks = [...asArray(compactRange.peaks)];
    while (peaks.length > 0 && Number(peaks[peaks.length - 1].level || 0) === Number(cursor.level || 0)) {
      const left = peaks.pop();
      const right = cursor;
      const parentLevel = Number(left.level || 0) + 1;
      const parentIndex = Math.floor(Number(left.index || 0) / 2);
      const hash = ledgerNodeHash(left.hash, right.hash);
      const node = {
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        nodeType: "pactium.ledger.node",
        level: parentLevel,
        index: parentIndex,
        hash,
        leftRef: left.nodeRef || left.leafRef || "",
        rightRef: right.nodeRef || right.leafRef || "",
        leftHash: left.hash,
        rightHash: right.hash,
        size: levelSize(parentLevel),
        createdAt: entry.timestamp || nowIso()
      };
      await writeNodeRecord(node);
      cursor = {
        level: parentLevel,
        index: parentIndex,
        hash,
        size: node.size,
        nodeRef: `ledger/node/${parentLevel}/${parentIndex}`
      };
    }
    peaks.push(cursor);
    compactRange = createCompactRange({ size: Number(compactRange.size || 0) + 1, peaks });
  }

  async function persistHead(head) {
    await storage.putProtocolObject("ledger", "head-current", head);
    await storage.putProtocolObject("ledger-head", head.headId, head);
  }

  async function appendBatch(facts = [], { timestamp = nowIso(), timestamps = [], signEach = false } = {}) {
    await load();
    const run = appendLane.then(async () => {
      const normalizedFacts = asArray(facts);
      const appends = [];
      for (const [batchIndex, fact] of normalizedFacts.entries()) {
        const finalAppend = batchIndex === normalizedFacts.length - 1;
        const entryTimestamp = asArray(timestamps)[batchIndex] || timestamp || nowIso();
        const previousHead = currentHead;
        const previousHeadRef = previousHead.headId || "";
        const index = Number(currentHead.size || 0);
        const factBlock = await storage.putBlock(fact, { kind: "ledger-fact" });
        const leaf = {
          protocol: PACTIUM_PROTOCOL,
          schema: PACTIUM_SCHEMA_VERSION,
          index,
          factType: fact.factType,
          factCid: factBlock.cid,
          factHash: factBlock.payloadHash,
          timestamp: entryTimestamp
        };
        const leafHash = ledgerLeafHash(leaf);
        const eventId = createId("ledger_event", { index, leafHash });
        const entry = {
          protocol: PACTIUM_PROTOCOL,
          schema: PACTIUM_SCHEMA_VERSION,
          eventId,
          index,
          fact,
          factCid: factBlock.cid,
          factHash: factBlock.payloadHash,
          leaf,
          leafHash,
          timestamp: entryTimestamp
        };
        await storage.putProtocolObject("ledger-leaf", String(index), entry);
        cacheSet(eventIndex, eventId, index, EVENT_INDEX_CACHE_LIMIT);
        await storage.putProtocolObject("ledger-event", eventId, {
          protocol: PACTIUM_PROTOCOL,
          schema: PACTIUM_SCHEMA_VERSION,
          eventId,
          index,
          leafHash
        });
        await mergeLeafIntoCompactRange(entry);
        currentHead = ledgerHeadFromCompactRange({
          peaks: compactRange.peaks,
          size: index + 1,
          previousHeadId: previousHeadRef,
          createdAt: entryTimestamp,
          ledgerId
        });
        if (finalAppend || signEach === true) currentHead = await signHead(currentHead);
        appends.push({
          protocol: PACTIUM_PROTOCOL,
          entry,
          head: currentHead,
          previousHead,
          inclusionProof: await createStoredInclusionProof({
            index,
            leaf,
            head: currentHead
          }),
          consistencyProof: await createStoredConsistencyProof({
            oldHead: previousHead,
            newHead: currentHead
          })
        });
      }
      await storage.putProtocolObject("ledger", "compact-range-current", compactRange);
      await persistHead(currentHead);
      return {
        protocol: PACTIUM_PROTOCOL,
        batchType: "pactium.ledger-append-batch",
        count: appends.length,
        entries: appends.map((appendResult) => appendResult.entry),
        head: currentHead,
        previousHead: appends[0]?.previousHead || currentHead,
        appends
      };
    });
    appendLane = run.catch(() => null);
    return run;
  }

  async function append(fact, options = {}) {
    const batch = await appendBatch([fact], options);
    return batch.appends[0];
  }

  return Object.freeze({
    protocol: PACTIUM_PROTOCOL,
    append,
    appendBatch,
    reload,
    async head() {
      await load();
      return currentHead;
    },
    async getHead(id = "current") {
      await load();
      if (!id || id === "current") return currentHead;
      return storage.getProtocolObject("ledger-head", id, null);
    },
    async getLeaf(index) {
      await load();
      return readLeafRecord(index);
    },
    async compactRange() {
      await load();
      return compactRange;
    },
    async entries() {
      await load();
      const output = [];
      for (let index = 0; index < Number(currentHead.size || 0); index += 1) {
        output.push({ ...await requireLeafRecord(index) });
      }
      return output;
    },
    async pageEntries({ start = 0, limit = 100 } = {}) {
      await load();
      const normalizedStart = Math.max(0, Number(start || 0));
      const pageLimit = Math.max(1, Math.min(Number(limit || 100), 10000));
      const head = currentHead;
      const entriesPage = [];
      const end = Math.min(Number(head.size || 0), normalizedStart + pageLimit);
      for (let index = normalizedStart; index < end; index += 1) {
        entriesPage.push({ ...await requireLeafRecord(index) });
      }
      return {
        protocol: PACTIUM_PROTOCOL,
        start: normalizedStart,
        limit: pageLimit,
        entries: entriesPage,
        nextPosition: entriesPage.length > 0 ? Number(entriesPage[entriesPage.length - 1].index || 0) + 1 : normalizedStart,
        head
      };
    },
    async getEntry(eventId) {
      await load();
      const normalizedEventId = String(eventId || "");
      if (!normalizedEventId) return null;
      const cachedIndex = cacheGet(eventIndex, normalizedEventId);
      if (cachedIndex !== undefined) {
        const cachedEntry = await readLeafRecord(cachedIndex);
        if (cachedEntry?.eventId === normalizedEventId) return cachedEntry;
        eventIndex.delete(normalizedEventId);
      }
      const indexed = await storage.getProtocolObject("ledger-event", normalizedEventId, null);
      const index = Number(indexed?.index);
      if (!Number.isInteger(index) || index < 0 || index >= Number(currentHead.size || 0)) return null;
      const entry = await readLeafRecord(index);
      if (entry?.eventId !== normalizedEventId) return null;
      cacheSet(eventIndex, normalizedEventId, index, EVENT_INDEX_CACHE_LIMIT);
      return entry;
    },
    async verifierManifest() {
      await load();
      const state = await ensureSigningState();
      return state?.manifest || storage.getProtocolObject("ledger", "verifier-manifest-current", null);
    },
    async createInclusionProof(index, head = null) {
      await load();
      const leafRecord = await readLeafRecord(Number(index || 0));
      if (!leafRecord) throw new RangeError("Ledger inclusion proof index is out of range.");
      return createStoredInclusionProof({
        index: Number(index || 0),
        leaf: leafRecord.leaf,
        head: head || currentHead
      });
    },
    async createConsistencyProof(oldHead, newHead = null) {
      await load();
      return createStoredConsistencyProof({
        oldHead,
        newHead: newHead || currentHead
      });
    },
    verifyInclusion: verifyLedgerInclusionProof,
    verifyConsistency: verifyLedgerConsistencyProof
  });
}
