import {
  PACTIUM_INDEX_ENGINE,
  PACTIUM_INDEX_SPLITTER,
  PACTIUM_PROOF_TYPES,
  PACTIUM_PROTOCOL,
  PACTIUM_PROTOCOL_PROFILE,
  PACTIUM_SCHEMA_VERSION
} from "../protocol/constants.js";
import { canonicalEncode, canonicalString, normalizeCanonicalValue } from "../canonical/value.js";
import { cidForCanonical, hexFromCid, protocolHashHex } from "../protocol/hashing.js";
import { createStoragePort } from "../storage/storage-port.js";
import { asArray, asRecord, safeToken } from "../shared/records.js";
import { cacheGet, cacheSet } from "../shared/lru-cache.js";

const INDEX_NODE_TYPE = "pactium.index.node";
const CACHE_LIMITS = Object.freeze({
  roots: 100,
  nodes: 10000,
  snapshots: 100
});
const BOUNDARY_HASH_CACHE_LIMIT = 16384;
// Boundary hashes are pure functions of protocol constants and entry/child
// identity, so one shared cache is correct across all engine instances.
const boundaryHashCache = new Map();

function compareIndexKeys(left, right) {
  return String(left || "") < String(right || "")
    ? -1
    : String(left || "") > String(right || "")
      ? 1
      : 0;
}

function splitterConfig() {
  return {
    algorithm: PACTIUM_INDEX_SPLITTER,
    minEntries: PACTIUM_PROTOCOL_PROFILE.indexEngine.chunking.minEntries,
    targetEntries: PACTIUM_PROTOCOL_PROFILE.indexEngine.chunking.targetEntries,
    maxEntries: PACTIUM_PROTOCOL_PROFILE.indexEngine.chunking.maxEntries,
    boundaryMask: PACTIUM_PROTOCOL_PROFILE.indexEngine.chunking.boundaryMask
  };
}

function indexLeafHash(entry) {
  return protocolHashHex("index.leaf", {
    key: entry.key,
    valueRef: entry.valueRef,
    valueHash: entry.valueHash || "",
    metadata: asRecord(entry.metadata)
  });
}

function normalizeIndexEntry(entry) {
  return {
    key: String(entry.key || ""),
    valueRef: String(entry.valueRef || ""),
    valueHash: String(entry.valueHash || ""),
    metadata: normalizeCanonicalValue(asRecord(entry.metadata))
  };
}

function normalizeEntries(entries) {
  const byKey = new Map();
  for (const rawEntry of asArray(entries)) {
    const entry = normalizeIndexEntry(rawEntry);
    if (entry.key) byKey.set(entry.key, entry);
  }
  return [...byKey.values()].sort((left, right) => compareIndexKeys(left.key, right.key));
}

function rangeForEntries(entries) {
  return {
    min: entries[0]?.key || "",
    max: entries[entries.length - 1]?.key || ""
  };
}

function rangeForChildren(children) {
  return {
    min: children[0]?.keyRange?.min || "",
    max: children[children.length - 1]?.keyRange?.max || ""
  };
}

function keyRangesEqual(left, right) {
  return String(left?.min || "") === String(right?.min || "") &&
    String(left?.max || "") === String(right?.max || "");
}

function descriptorFromNodePayload(payload, root = cidForCanonical(payload)) {
  return {
    root,
    rootHash: hexFromCid(root),
    level: Number(payload.level || 0),
    count: Number(payload.count || 0),
    keyRange: payload.keyRange || { min: "", max: "" }
  };
}

function finalizeNodePayload(payload) {
  const base = normalizeCanonicalValue({
    ...payload,
    byteLength: undefined
  });
  return {
    ...base,
    byteLength: canonicalEncode(base).length
  };
}

function descriptorMatches(left, right) {
  return left?.root === right?.root &&
    left?.rootHash === right?.rootHash &&
    Number(left?.level || 0) === Number(right?.level || 0) &&
    Number(left?.count || 0) === Number(right?.count || 0) &&
    left?.keyRange?.min === right?.keyRange?.min &&
    left?.keyRange?.max === right?.keyRange?.max;
}

function indexEntriesEqual(left, right) {
  if (!left || !right) return left === right;
  return left.key === right.key &&
    left.valueRef === right.valueRef &&
    left.valueHash === right.valueHash &&
    canonicalString(asRecord(left.metadata)) === canonicalString(asRecord(right.metadata));
}

function entryListsEqual(leftEntries, rightEntries) {
  if (leftEntries.length !== rightEntries.length) return false;
  for (let index = 0; index < leftEntries.length; index += 1) {
    if (!indexEntriesEqual(leftEntries[index], rightEntries[index])) return false;
  }
  return true;
}

function first32(hash) {
  return Number.parseInt(String(hash || "").slice(0, 8), 16) || 0;
}

// Chunk-boundary decisions consume only the first 32 bits of the boundary
// hash, and each hash is a pure function of protocol constants plus entry or
// child identity. Path-copy mutations rehash the same unchanged entries on
// every leaf rewrite, so the memoized 32-bit signal removes almost all
// boundary hashing from steady-state writes.
function boundarySignalFor(cacheKey, buildPayload) {
  const cached = cacheGet(boundaryHashCache, cacheKey);
  if (cached !== undefined) return cached;
  const signal = first32(protocolHashHex("index.boundary", buildPayload()));
  cacheSet(boundaryHashCache, cacheKey, signal, BOUNDARY_HASH_CACHE_LIMIT);
  return signal;
}

function entryBoundarySignal(domain, entry) {
  return boundarySignalFor(
    `e\u0000${domain}\u0000${entry.key}\u0000${entry.valueRef}\u0000${entry.valueHash}`,
    () => ({
      domain,
      key: entry.key,
      valueRef: entry.valueRef,
      valueHash: entry.valueHash
    })
  );
}

function childBoundarySignal(domain, child) {
  return boundarySignalFor(
    `c\u0000${domain}\u0000${child.keyRange?.max || ""}\u0000${child.root}\u0000${child.level}\u0000${child.count}`,
    () => ({
      domain,
      key: child.keyRange?.max || "",
      root: child.root,
      rootHash: child.rootHash,
      level: child.level,
      count: child.count
    })
  );
}

function shouldCutChunk({ size, boundarySignal, splitter }) {
  if (size < splitter.minEntries) return false;
  return (boundarySignal & splitter.boundaryMask) === 0 || size >= splitter.maxEntries;
}

function chunkEntryGroups(entries, snapshotDomain) {
  const splitter = splitterConfig();
  const chunks = [];
  let active = [];
  for (const entry of entries) {
    active.push(entry);
    if (shouldCutChunk({ size: active.length, boundarySignal: entryBoundarySignal(snapshotDomain, entry), splitter })) {
      chunks.push({ entries: active, closed: true });
      active = [];
    }
  }
  if (active.length > 0 || chunks.length === 0) chunks.push({ entries: active, closed: false });
  return chunks;
}

function ensureSortedEntries(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareIndexKeys(entries[index - 1].key, entries[index].key) >= 0) return false;
  }
  return true;
}

// Anti-malleability check: a stored leaf entry must already be in canonical
// index-entry shape. Generic canonical encoding preserves extra fields and
// non-string scalars inside the node CID, so without this comparison two
// different node payloads could describe the same logical entry set.
function rawEntryIsCanonical(raw, normalized) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  if (Object.keys(raw).length !== 4) return false;
  return raw.key === normalized.key &&
    raw.valueRef === normalized.valueRef &&
    raw.valueHash === normalized.valueHash &&
    canonicalString(raw.metadata) === canonicalString(normalized.metadata);
}

function validateLeafNodePayload(payload) {
  if (!payload || payload.protocol !== PACTIUM_PROTOCOL || payload.nodeType !== INDEX_NODE_TYPE || payload.level !== 0) return false;
  const rawEntries = asArray(payload.entries);
  const entries = rawEntries.map(normalizeIndexEntry);
  if (entries.length !== Number(payload.count || 0)) return false;
  for (let index = 0; index < rawEntries.length; index += 1) {
    if (!rawEntryIsCanonical(rawEntries[index], entries[index])) return false;
  }
  if (!ensureSortedEntries(entries)) return false;
  return keyRangesEqual(rangeForEntries(entries), payload.keyRange || {});
}

function validateInternalNodePayload(payload) {
  if (!payload || payload.protocol !== PACTIUM_PROTOCOL || payload.nodeType !== INDEX_NODE_TYPE || Number(payload.level || 0) <= 0) return false;
  const children = asArray(payload.children);
  if (children.length === 0 || asArray(payload.entries).length > 0) return false;
  const count = children.reduce((total, child) => total + Number(child.count || 0), 0);
  if (count !== Number(payload.count || 0)) return false;
  for (let index = 1; index < children.length; index += 1) {
    if (compareIndexKeys(children[index - 1].keyRange?.max, children[index].keyRange?.min) >= 0) return false;
  }
  return keyRangesEqual(rangeForChildren(children), payload.keyRange || {});
}

// Fast path for payloads this module already finalized: skips re-finalization
// and reuses a precomputed root CID instead of re-encoding the payload.
function verifyFinalizedNodePayload(finalized, expected = {}, root = cidForCanonical(finalized)) {
  const validShape = finalized.level === 0 ? validateLeafNodePayload(finalized) : validateInternalNodePayload(finalized);
  return validShape &&
    (!expected.root || expected.root === root) &&
    (!expected.rootHash || expected.rootHash === hexFromCid(root));
}

function verifyNodePayload(payload, expected = {}) {
  return verifyFinalizedNodePayload(finalizeNodePayload(payload), expected);
}

function findChildIndex(children, key) {
  if (children.length === 0) return -1;
  const normalizedKey = String(key || "");
  let low = 0;
  let high = children.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareIndexKeys(normalizedKey, children[middle].keyRange?.max) > 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rangesIntersect(range, min, max) {
  const rangeMin = String(range?.min || "");
  const rangeMax = String(range?.max || "");
  return (!max || compareIndexKeys(rangeMin, max) <= 0) && (!min || compareIndexKeys(rangeMax, min) >= 0);
}

function clampLimit(limit, fallback = 5000) {
  const value = limit === undefined || limit === null || limit === "" ? fallback : Number(limit);
  return Math.max(1, Math.min(Number.isFinite(value) ? value : fallback, 100000));
}

function proofEntryPath(path) {
  return asArray(path).map((item) => ({
    nodeRoot: String(item.nodeRoot || ""),
    level: Number(item.level || 0),
    keyRange: normalizeCanonicalValue(item.keyRange || { min: "", max: "" }),
    siblingDescriptorRefs: asArray(item.siblingDescriptorRefs).map((ref) => Number(ref)),
    childIndex: Number(item.childIndex || 0),
    nodeHash: String(item.nodeHash || "")
  }));
}

function compactProofPath(path) {
  const descriptorTable = [];
  const descriptorIndexes = new Map();
  function refFor(descriptor) {
    // canonicalString normalizes while serializing, so the descriptor is only
    // deep-normalized when it first enters the table.
    const key = canonicalString(descriptor);
    if (!descriptorIndexes.has(key)) {
      descriptorIndexes.set(key, descriptorTable.length);
      descriptorTable.push(normalizeCanonicalValue(descriptor));
    }
    return descriptorIndexes.get(key);
  }
  return {
    descriptorTable,
    path: asArray(path).map((item) => ({
      nodeRoot: String(item.nodeRoot || ""),
      level: Number(item.level || 0),
      keyRange: normalizeCanonicalValue(item.keyRange || { min: "", max: "" }),
      siblingDescriptorRefs: asArray(item.siblingDescriptors).map(refFor),
      childIndex: Number(item.childIndex || 0),
      nodeHash: String(item.nodeHash || "")
    }))
  };
}

function descriptorTableForProof(proof, context = {}) {
  const local = asArray(proof?.descriptorTable);
  if (local.length > 0) return local.map((descriptor) => normalizeCanonicalValue(descriptor));
  return asArray(context?.proofMaterial?.proofDescriptorTable).map((descriptor) => normalizeCanonicalValue(descriptor));
}

function expandProofPath(proof, context = {}, descriptorTable = descriptorTableForProof(proof, context)) {
  return proofEntryPath(proof.path).map((item) => {
    const siblingDescriptors = [];
    for (const ref of item.siblingDescriptorRefs) {
      if (!Number.isInteger(ref) || ref < 0 || ref >= descriptorTable.length) {
        return { ...item, siblingDescriptors: null };
      }
      siblingDescriptors.push(descriptorTable[ref]);
    }
    return { ...item, siblingDescriptors };
  });
}

function nodePayloadFromProofLeaf(proof) {
  const leafNode = asRecord(proof.leafNode);
  return finalizeNodePayload({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    nodeType: INDEX_NODE_TYPE,
    domain: proof.domain,
    level: 0,
    keyRange: leafNode.keyRange || rangeForEntries(asArray(leafNode.entries).map(normalizeIndexEntry)),
    count: Number(leafNode.count ?? asArray(leafNode.entries).length),
    entries: asArray(leafNode.entries).map(normalizeIndexEntry),
    children: [],
    splitter: leafNode.splitter || splitterConfig()
  });
}

function verifyPathToRoot({ proof, leafDescriptor, selectionKey = null, context = {}, expandedPath = null }) {
  let current = leafDescriptor;
  const path = expandedPath || expandProofPath(proof, context);
  for (const pathItem of path) {
    if (!pathItem.siblingDescriptors) return null;
    const children = pathItem.siblingDescriptors.map((child) => ({ ...child }));
    if (pathItem.childIndex < 0 || pathItem.childIndex >= children.length) return null;
    if (selectionKey !== null && pathItem.childIndex !== findChildIndex(children, selectionKey)) return null;
    if (!descriptorMatches(children[pathItem.childIndex], current)) return null;
    const parentPayload = finalizeNodePayload({
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      nodeType: INDEX_NODE_TYPE,
      domain: proof.domain,
      level: pathItem.level,
      keyRange: pathItem.keyRange,
      count: children.reduce((total, child) => total + Number(child.count || 0), 0),
      entries: [],
      children,
      splitter: splitterConfig()
    });
    const parentRoot = cidForCanonical(parentPayload);
    if (!verifyFinalizedNodePayload(parentPayload, { rootHash: pathItem.nodeHash }, parentRoot)) return null;
    current = descriptorFromNodePayload(parentPayload, parentRoot);
    if (current.root !== pathItem.nodeRoot) return null;
  }
  return current;
}

function verifyMembershipProof(proof, context = {}) {
  if (!proof || typeof proof !== "object") return false;
  if (proof.proofType !== PACTIUM_PROOF_TYPES.indexMembership) return false;
  const leafPayload = nodePayloadFromProofLeaf(proof);
  const leafRoot = cidForCanonical(leafPayload);
  const leafRootHash = hexFromCid(leafRoot);
  if (!verifyFinalizedNodePayload(leafPayload, { root: proof.leafRoot || leafRoot }, leafRoot)) return false;
  if ((proof.leafRoot && proof.leafRoot !== leafRoot) || (proof.leafRootHash && proof.leafRootHash !== leafRootHash)) return false;
  const leafDescriptor = descriptorFromNodePayload(leafPayload, leafRoot);
  const normalizedKey = String(proof.key || "");
  const rootDescriptor = verifyPathToRoot({ proof, leafDescriptor, selectionKey: normalizedKey, context });
  if (!rootDescriptor) return false;
  if (rootDescriptor.root !== proof.indexRoot || rootDescriptor.rootHash !== proof.rootHash) return false;
  // Leaf shape validation guarantees payload entries are canonical entries.
  const entries = asArray(leafPayload.entries);
  const entry = normalizeIndexEntry(proof.entry || {});
  const found = entries.find((candidate) => candidate.key === normalizedKey);
  return Boolean(found) &&
    indexEntriesEqual(found, entry) &&
    indexLeafHash(entry) === proof.leafHash;
}

function verifyCompactNonMembershipProof(proof, context = {}) {
  if (!proof || typeof proof !== "object") return false;
  if (proof.proofType !== PACTIUM_PROOF_TYPES.indexNonMembership) return false;
  const leafPayload = nodePayloadFromProofLeaf(proof);
  const leafRoot = cidForCanonical(leafPayload);
  const leafRootHash = hexFromCid(leafRoot);
  if (!verifyFinalizedNodePayload(leafPayload, { root: proof.leafRoot || leafRoot }, leafRoot)) return false;
  if ((proof.leafRoot && proof.leafRoot !== leafRoot) || (proof.leafRootHash && proof.leafRootHash !== leafRootHash)) return false;
  const leafDescriptor = descriptorFromNodePayload(leafPayload, leafRoot);
  const normalizedKey = String(proof.key || "");
  const rootDescriptor = verifyPathToRoot({ proof, leafDescriptor, selectionKey: normalizedKey, context });
  if (!rootDescriptor) return false;
  if (rootDescriptor.root !== proof.indexRoot || rootDescriptor.rootHash !== proof.rootHash) return false;
  // Leaf shape validation guarantees payload entries are canonical entries.
  const entries = asArray(leafPayload.entries);
  const containsKey = entries.some((entry) => entry.key === normalizedKey);
  const insertionPoint = entries.findIndex((entry) => compareIndexKeys(entry.key, normalizedKey) > 0);
  const left = insertionPoint < 0
    ? entries[entries.length - 1] || null
    : insertionPoint === 0
      ? null
      : entries[insertionPoint - 1];
  const right = insertionPoint < 0 ? null : entries[insertionPoint];
  return !containsKey &&
    String(proof.leftBoundary || "") === (left?.key || "") &&
    String(proof.rightBoundary || "") === (right?.key || "");
}

function verifyMembershipMultiproof(proof, context = {}) {
  if (!proof || proof.proofType !== PACTIUM_PROOF_TYPES.indexMembershipMultiproof) return false;
  if (!Array.isArray(proof.keys) || proof.keys.length === 0) return false;
  if (asArray(proof.missingKeys).length > 0) return false;
  const seenKeys = new Set();
  // The descriptor table is shared by every leaf path, so normalize it once
  // instead of once per leaf.
  const descriptorTable = descriptorTableForProof(proof, context);
  for (const leafProof of asArray(proof.leaves)) {
    const leafKeys = asArray(leafProof.keys).map(String);
    if (leafKeys.length === 0) return false;
    const localProof = {
      protocol: proof.protocol,
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
      domain: proof.domain,
      indexRoot: proof.indexRoot,
      rootHash: proof.rootHash,
      leafRoot: leafProof.leafRoot,
      leafRootHash: leafProof.leafRootHash,
      leafNode: leafProof.leafNode,
      path: leafProof.path,
      descriptorTable: proof.descriptorTable,
      descriptorTableScope: proof.descriptorTableScope
    };
    const leafPayload = nodePayloadFromProofLeaf(localProof);
    const leafRoot = cidForCanonical(leafPayload);
    const leafRootHash = hexFromCid(leafRoot);
    if (!verifyFinalizedNodePayload(leafPayload, { root: leafProof.leafRoot || leafRoot }, leafRoot)) return false;
    if ((leafProof.leafRoot && leafProof.leafRoot !== leafRoot) ||
        (leafProof.leafRootHash && leafProof.leafRootHash !== leafRootHash)) {
      return false;
    }
    const leafDescriptor = descriptorFromNodePayload(leafPayload, leafRoot);
    const rootDescriptor = verifyPathToRoot({
      proof: localProof,
      leafDescriptor,
      selectionKey: leafKeys[0],
      context,
      expandedPath: expandProofPath(localProof, context, descriptorTable)
    });
    if (!rootDescriptor || rootDescriptor.root !== proof.indexRoot || rootDescriptor.rootHash !== proof.rootHash) {
      return false;
    }
    // Leaf shape validation guarantees payload entries are canonical entries.
    const entriesByKey = new Map(asArray(leafPayload.entries).map((entry) => [entry.key, entry]));
    for (const key of leafKeys) {
      if (!entriesByKey.has(key)) return false;
      seenKeys.add(key);
    }
  }
  const expectedKeys = asArray(proof.keys).map(String);
  return expectedKeys.every((key) => seenKeys.has(key)) && seenKeys.size === new Set(expectedKeys).size;
}

function effectiveRangeMinimum(proof) {
  const min = String(proof.min || "");
  const after = String(proof.after || "");
  return after && compareIndexKeys(after, min) > 0 ? after : min;
}

function proofRangeContains(range, proof) {
  return rangesIntersect(range, effectiveRangeMinimum(proof), String(proof.max || "\uffff"));
}

function verifyRangeProof(proof, context = {}) {
  if (!proof || proof.proofType !== PACTIUM_PROOF_TYPES.indexRange) return false;
  const min = String(proof.min || "");
  const max = String(proof.max || "\uffff");
  const after = String(proof.after || "");
  if (compareIndexKeys(min, max) > 0) return false;
  const coveredRoots = new Set();
  const leafRecords = [];
  const requestedLimit = clampLimit(proof.limit, 100000);
  // The descriptor table is shared by every leaf path, so normalize it once
  // instead of once per leaf.
  const descriptorTable = descriptorTableForProof(proof, context);
  for (const leafProof of asArray(proof.leaves)) {
    const localProof = {
      protocol: proof.protocol,
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
      domain: proof.domain,
      indexRoot: proof.indexRoot,
      rootHash: proof.rootHash,
      leafRoot: leafProof.leafRoot,
      leafRootHash: leafProof.leafRootHash,
      leafNode: leafProof.leafNode,
      path: leafProof.path,
      descriptorTable: proof.descriptorTable,
      descriptorTableScope: proof.descriptorTableScope,
      key: "",
      entry: {},
      leafHash: ""
    };
    const leafPayload = nodePayloadFromProofLeaf(localProof);
    const leafRoot = cidForCanonical(leafPayload);
    if (leafProof.leafRoot !== leafRoot || leafProof.leafRootHash !== hexFromCid(leafRoot)) return false;
    const descriptor = descriptorFromNodePayload(leafPayload, leafRoot);
    const entries = asArray(leafPayload.entries).map(normalizeIndexEntry);
    const matchingEntries = [];
    let selectionKey = "";
    for (const entry of entries) {
      const matches = (!after || compareIndexKeys(entry.key, after) > 0) &&
        compareIndexKeys(entry.key, min) >= 0 &&
        compareIndexKeys(entry.key, max) <= 0;
      if (!matches) continue;
      if (!selectionKey) selectionKey = entry.key;
      matchingEntries.push(entry);
    }
    selectionKey ||= descriptor.keyRange?.min || "";
    const expandedPath = expandProofPath(localProof, context, descriptorTable);
    const rootDescriptor = verifyPathToRoot({
      proof: localProof,
      leafDescriptor: descriptor,
      selectionKey,
      context,
      expandedPath
    });
    if (!rootDescriptor || rootDescriptor.root !== proof.indexRoot || rootDescriptor.rootHash !== proof.rootHash) return false;
    coveredRoots.add(leafRoot);
    for (const pathItem of expandedPath) coveredRoots.add(pathItem.nodeRoot);
    leafRecords.push({
      proof: leafProof,
      descriptor,
      entries,
      matchingEntries,
      expandedPath
    });
  }
  const expectedEntries = asArray(proof.entries).map(normalizeIndexEntry);
  if (expectedEntries.length > requestedLimit) return false;
  const sortedLeafRecords = [...leafRecords].sort((left, right) => compareIndexKeys(left.descriptor.keyRange?.min, right.descriptor.keyRange?.min));
  for (let index = 1; index < sortedLeafRecords.length; index += 1) {
    if (compareIndexKeys(sortedLeafRecords[index - 1].descriptor.keyRange?.max, sortedLeafRecords[index].descriptor.keyRange?.min) >= 0) {
      return false;
    }
  }
  const matchingEntries = sortedLeafRecords.flatMap((record) => record.matchingEntries);
  if (!entryListsEqual(matchingEntries.slice(0, expectedEntries.length), expectedEntries)) return false;
  if (expectedEntries.length === 0) {
    if (matchingEntries.length > 0) return false;
    if (proof.truncated === true) return false;
    return proof.boundaryProof ? verifyCompactNonMembershipProof(proof.boundaryProof, context) : asArray(proof.leaves).length === 0;
  }
  const lastReturnedKey = expectedEntries[expectedEntries.length - 1]?.key || "";
  const hasLocalExtra = matchingEntries.length > expectedEntries.length;
  if (proof.truncated === true) {
    if (expectedEntries.length !== requestedLimit || !hasLocalExtra) return false;
  } else if (hasLocalExtra) {
    return false;
  }
  for (const record of sortedLeafRecords) {
    for (const pathItem of record.expandedPath) {
      if (!pathItem.siblingDescriptors) return false;
      for (const descriptor of pathItem.siblingDescriptors) {
        if (!proofRangeContains(descriptor.keyRange, proof)) continue;
        if (coveredRoots.has(descriptor.root)) continue;
        if (proof.truncated === true && lastReturnedKey && compareIndexKeys(descriptor.keyRange?.min, lastReturnedKey) > 0) continue;
        return false;
      }
    }
  }
  return true;
}

export function verifyIndexProof(proof, context = {}) {
  if (!proof || typeof proof !== "object") return false;
  if (proof.proofType === PACTIUM_PROOF_TYPES.indexMembership) return verifyMembershipProof(proof, context);
  if (proof.proofType === PACTIUM_PROOF_TYPES.indexNonMembership) return verifyCompactNonMembershipProof(proof, context);
  if (proof.proofType === PACTIUM_PROOF_TYPES.indexMembershipMultiproof) return verifyMembershipMultiproof(proof, context);
  if (proof.proofType === PACTIUM_PROOF_TYPES.indexRange) return verifyRangeProof(proof, context);
  return false;
}

export function createVerifiableIndexEngine({ storage = createStoragePort({ inMemory: true }), domain = "generic" } = {}) {
  const roots = new Map();
  const nodes = new Map();
  const snapshots = new Map();

  async function putNode(payload) {
    const finalized = finalizeNodePayload(payload);
    const refs = asArray(finalized.children).map((child) => child.root).filter(Boolean);
    const block = await storage.putBlock(finalized, { kind: `index-node:${finalized.domain}`, refs });
    const descriptor = descriptorFromNodePayload(finalized, block.cid);
    cacheSet(nodes, block.cid, finalized, CACHE_LIMITS.nodes);
    return { payload: finalized, descriptor };
  }

  async function readNode(root) {
    if (!root) return null;
    const cached = cacheGet(nodes, root);
    if (cached) return cached;
    const block = await storage.getBlock(root);
    if (!block) throw new Error(`Index node missing for ${root}`);
    const payload = normalizeCanonicalValue(JSON.parse(Buffer.from(block.payloadBase64, "base64").toString("utf8")));
    if (!verifyNodePayload(payload, { root })) throw new Error(`Index node integrity failure for ${root}`);
    cacheSet(nodes, root, payload, CACHE_LIMITS.nodes);
    return payload;
  }

  async function writeLeafNodes(entries, snapshotDomain) {
    const splitter = splitterConfig();
    const descriptors = [];
    for (const chunk of chunkEntryGroups(entries, snapshotDomain)) {
      const { descriptor } = await putNode({
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        nodeType: INDEX_NODE_TYPE,
        domain: snapshotDomain,
        level: 0,
        keyRange: rangeForEntries(chunk.entries),
        count: chunk.entries.length,
        entries: chunk.entries,
        children: [],
        splitter
      });
      descriptors.push(descriptor);
    }
    return descriptors;
  }

  async function writeParentLevel(children, snapshotDomain, level) {
    const splitter = splitterConfig();
    const chunks = [];
    let active = [];
    for (const child of children) {
      active.push(child);
      if (shouldCutChunk({ size: active.length, boundarySignal: childBoundarySignal(snapshotDomain, child), splitter })) {
        chunks.push(active);
        active = [];
      }
    }
    if (active.length > 0) chunks.push(active);
    const descriptors = [];
    for (const chunk of chunks) {
      const { descriptor } = await putNode({
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        nodeType: INDEX_NODE_TYPE,
        domain: snapshotDomain,
        level,
        keyRange: rangeForChildren(chunk),
        count: chunk.reduce((total, child) => total + Number(child.count || 0), 0),
        entries: [],
        children: chunk,
        splitter
      });
      descriptors.push(descriptor);
    }
    return descriptors;
  }

  async function writeIndexRoot(entries, snapshotDomain = domain) {
    const normalizedEntries = normalizeEntries(entries);
    let descriptors = await writeLeafNodes(normalizedEntries, snapshotDomain);
    let height = 0;
    while (descriptors.length > 1) {
      height += 1;
      descriptors = await writeParentLevel(descriptors, snapshotDomain, height);
    }
    const rootDescriptor = descriptors[0];
    const indexRoot = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      engine: PACTIUM_INDEX_ENGINE,
      domain: snapshotDomain,
      root: rootDescriptor.root,
      rootHash: rootDescriptor.rootHash,
      count: rootDescriptor.count,
      keyRange: rootDescriptor.keyRange,
      height: rootDescriptor.level,
      splitter: splitterConfig()
    };
    cacheSet(roots, rootDescriptor.root, indexRoot, CACHE_LIMITS.roots);
    await storage.putProtocolObject("index", `${safeToken(snapshotDomain)}-${rootDescriptor.rootHash}`, indexRoot);
    if (snapshotDomain !== domain) {
      await storage.putProtocolObject("index", `${safeToken(domain)}-${rootDescriptor.rootHash}`, indexRoot);
    }
    snapshots.delete(rootDescriptor.root);
    return indexRoot;
  }

  async function writeIndexRootFromDescriptor(rootDescriptor, snapshotDomain = domain) {
    const indexRoot = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      engine: PACTIUM_INDEX_ENGINE,
      domain: snapshotDomain,
      root: rootDescriptor.root,
      rootHash: rootDescriptor.rootHash,
      count: rootDescriptor.count,
      keyRange: rootDescriptor.keyRange,
      height: rootDescriptor.level,
      splitter: splitterConfig()
    };
    cacheSet(roots, rootDescriptor.root, indexRoot, CACHE_LIMITS.roots);
    await storage.putProtocolObject("index", `${safeToken(snapshotDomain)}-${rootDescriptor.rootHash}`, indexRoot);
    if (snapshotDomain !== domain) {
      await storage.putProtocolObject("index", `${safeToken(domain)}-${rootDescriptor.rootHash}`, indexRoot);
    }
    snapshots.delete(rootDescriptor.root);
    return indexRoot;
  }

  async function readIndexRoot(root) {
    if (!root) {
      const empty = await writeIndexRoot([], domain);
      return empty;
    }
    const cached = cacheGet(roots, root);
    if (cached) return cached;
    const object = await storage.getProtocolObject("index", `${safeToken(domain)}-${hexFromCid(root)}`, null);
    if (!object) throw new Error(`Index snapshot missing for ${root}`);
    cacheSet(roots, root, object, CACHE_LIMITS.roots);
    return object;
  }

  async function collectEntriesFromDescriptor(descriptor) {
    if (!descriptor?.root) return [];
    const payload = await readNode(descriptor.root);
    if (Number(payload.level || 0) === 0) return asArray(payload.entries).map(normalizeIndexEntry);
    const nested = [];
    for (const child of asArray(payload.children)) {
      nested.push(...await collectEntriesFromDescriptor(child));
    }
    return nested;
  }

  async function collectEntries(root) {
    const indexRoot = await readIndexRoot(root);
    return collectEntriesFromDescriptor({
      root: indexRoot.root,
      rootHash: indexRoot.rootHash,
      level: indexRoot.height,
      count: indexRoot.count,
      keyRange: indexRoot.keyRange
    });
  }

  async function rangeEntriesFromDescriptor(descriptor, {
    min = "",
    max = "\uffff",
    after = "",
    limit = 5000,
    predicate = () => true
  } = {}, output = []) {
    if (!descriptor?.root || output.length >= limit) return output;
    if (!rangesIntersect(descriptor.keyRange, min, max)) return output;
    if (after && compareIndexKeys(descriptor.keyRange?.max, after) <= 0) return output;
    const payload = await readNode(descriptor.root);
    if (Number(payload.level || 0) === 0) {
      for (const entry of asArray(payload.entries).map(normalizeIndexEntry)) {
        if (output.length >= limit) break;
        if (after && compareIndexKeys(entry.key, after) <= 0) continue;
        if (compareIndexKeys(entry.key, min) < 0 || compareIndexKeys(entry.key, max) > 0) continue;
        if (predicate(entry)) output.push(entry);
      }
      return output;
    }
    for (const child of asArray(payload.children)) {
      if (output.length >= limit) break;
      await rangeEntriesFromDescriptor(child, { min, max, after, limit, predicate }, output);
    }
    return output;
  }

  async function rangeEntries(root, options = {}) {
    const indexRoot = await readIndexRoot(root);
    return rangeEntriesFromDescriptor({
      root: indexRoot.root,
      rootHash: indexRoot.rootHash,
      level: indexRoot.height,
      count: indexRoot.count,
      keyRange: indexRoot.keyRange
    }, options);
  }

  async function readSnapshot(root) {
    if (!root) {
      const empty = await writeIndexRoot([], domain);
      root = empty.root;
    }
    const cached = cacheGet(snapshots, root);
    if (cached) return cached;
    const indexRoot = await readIndexRoot(root);
    const entries = await collectEntries(root);
    const leafHashes = entries.map(indexLeafHash);
    const snapshot = {
      ...indexRoot,
      entries,
      leafHashes,
      chunkBoundaries: await chunkBoundaries(root)
    };
    cacheSet(snapshots, root, snapshot, CACHE_LIMITS.snapshots);
    return snapshot;
  }

  async function chunkBoundaries(root) {
    const indexRoot = await readIndexRoot(root);
    const output = [];
    async function visit(descriptor) {
      const payload = await readNode(descriptor.root);
      if (Number(payload.level || 0) === 0) {
        output.push({
          startKey: payload.keyRange?.min || "",
          endKey: payload.keyRange?.max || "",
          count: Number(payload.count || 0),
          root: descriptor.root,
          rootHash: descriptor.rootHash
        });
        return;
      }
      for (const child of asArray(payload.children)) await visit(child);
    }
    if (indexRoot.root) await visit({
      root: indexRoot.root,
      rootHash: indexRoot.rootHash,
      level: indexRoot.height,
      count: indexRoot.count,
      keyRange: indexRoot.keyRange
    });
    return output;
  }

  async function createIndex(entries = [], options = {}) {
    return writeIndexRoot(entries, options.domain || domain);
  }

  async function writeDescriptorsToSingleRoot(descriptors, snapshotDomain) {
    let current = descriptors;
    while (current.length > 1) {
      current = await writeParentLevel(current, snapshotDomain, Number(current[0]?.level || 0) + 1);
    }
    return current[0];
  }

  async function writeRootFromMutationDescriptors(descriptors, snapshotDomain) {
    const normalizedDescriptors = asArray(descriptors).filter((descriptor) => descriptor?.root);
    if (normalizedDescriptors.length === 0) return writeIndexRoot([], snapshotDomain);
    let rootDescriptor = await writeDescriptorsToSingleRoot(normalizedDescriptors, snapshotDomain);
    while (Number(rootDescriptor.level || 0) > 0) {
      const payload = await readNode(rootDescriptor.root);
      const children = asArray(payload.children);
      if (children.length !== 1) break;
      rootDescriptor = children[0];
    }
    return writeIndexRootFromDescriptor(rootDescriptor, snapshotDomain);
  }

  function entryFromMutationValue(mutation, valueBlock) {
    return {
      key: String(mutation.key || ""),
      valueRef: String(valueBlock.cid || ""),
      valueHash: String(valueBlock.payloadHash || ""),
      metadata: asRecord(mutation.metadata)
    };
  }

  async function materializeMutation(mutation, snapshotDomain) {
    const normalized = asRecord(mutation);
    const key = String(normalized.key || "");
    if (!key) return null;
    const action = String(normalized.action || "put");
    if (action === "delete") return { key, action };
    const value = Object.hasOwn(normalized, "value") ? normalized.value : normalized;
    const valueBlock = normalized.valueRef
      ? { cid: String(normalized.valueRef), payloadHash: String(normalized.valueHash || "") }
      : await storage.putBlock(value, { kind: `index-value:${snapshotDomain}` });
    return {
      key,
      action: "put",
      entry: entryFromMutationValue(normalized, valueBlock)
    };
  }

  function normalizeMutations(mutations) {
    const latest = new Map();
    for (const mutation of asArray(mutations)) {
      if (!mutation?.key) continue;
      latest.set(String(mutation.key), mutation);
    }
    return [...latest.values()].sort((left, right) => compareIndexKeys(left.key, right.key));
  }

  function applyMutationsToEntries(entries, materializedMutations) {
    const byKey = new Map(normalizeEntries(entries).map((entry) => [entry.key, entry]));
    for (const mutation of materializedMutations) {
      if (mutation.action === "delete") byKey.delete(mutation.key);
      else byKey.set(mutation.key, normalizeIndexEntry(mutation.entry));
    }
    return normalizeEntries([...byKey.values()]);
  }

  async function writeLeafDescriptorsForMutatedEntries({ originalDescriptor, entries, snapshotDomain }) {
    if (entries.length === 0) return [];
    const replacementDescriptors = await writeLeafNodes(entries, snapshotDomain);
    /* node:coverage ignore next 3 */
    if (replacementDescriptors.length === 1 && descriptorMatches(replacementDescriptors[0], originalDescriptor)) {
      return [originalDescriptor];
    }
    return replacementDescriptors;
  }

  function descriptorListMatches(left, right) {
    const leftList = asArray(left);
    const rightList = asArray(right);
    return leftList.length === rightList.length &&
      leftList.every((descriptor, index) => descriptorMatches(descriptor, rightList[index]));
  }

  async function writeInternalDescriptorsForChildren({ originalDescriptor, children, snapshotDomain }) {
    if (children.length === 0) return [];
    if (descriptorListMatches(children, asArray((await readNode(originalDescriptor.root)).children))) return [originalDescriptor];
    const descriptors = await writeParentLevel(children, snapshotDomain, Number(originalDescriptor.level || 0));
    if (descriptors.length === 1 && descriptorMatches(descriptors[0], originalDescriptor)) return [originalDescriptor];
    return descriptors;
  }

  async function applyMutationsToDescriptor(descriptor, materializedMutations, snapshotDomain) {
    if (!descriptor?.root || materializedMutations.length === 0) return descriptor?.root ? [descriptor] : [];
    const payload = await readNode(descriptor.root);
    if (Number(payload.level || 0) === 0) {
      const originalEntries = asArray(payload.entries).map(normalizeIndexEntry);
      const mutatedEntries = applyMutationsToEntries(originalEntries, materializedMutations);
      if (entryListsEqual(originalEntries, mutatedEntries)) return [descriptor];
      return writeLeafDescriptorsForMutatedEntries({
        originalDescriptor: descriptor,
        entries: mutatedEntries,
        snapshotDomain
      });
    }

    const children = asArray(payload.children);
    const mutationGroups = new Map();
    for (const mutation of materializedMutations) {
      const childIndex = findChildIndex(children, mutation.key);
      if (childIndex < 0) continue;
      if (!mutationGroups.has(childIndex)) mutationGroups.set(childIndex, []);
      mutationGroups.get(childIndex).push(mutation);
    }
    if (mutationGroups.size === 0) return [descriptor];
    const rewrittenChildren = [];
    for (const [childIndex, child] of children.entries()) {
      const childMutations = mutationGroups.get(childIndex) || [];
      if (childMutations.length === 0) {
        rewrittenChildren.push(child);
        continue;
      }
      rewrittenChildren.push(...await applyMutationsToDescriptor(child, childMutations, snapshotDomain));
    }
    if (descriptorListMatches(rewrittenChildren, children)) return [descriptor];
    return writeInternalDescriptorsForChildren({
      originalDescriptor: descriptor,
      children: rewrittenChildren,
      snapshotDomain
    });
  }

  async function mutatePathCopy(root, mutations, options = {}) {
    const indexRoot = await readIndexRoot(root);
    const snapshotDomain = options.domain || indexRoot.domain || domain;
    async function unchangedRoot() {
      if (Number(indexRoot.count || 0) === 0 && indexRoot.domain !== snapshotDomain) {
        return writeIndexRoot([], snapshotDomain);
      }
      return indexRoot;
    }
    const normalizedMutations = normalizeMutations(mutations);
    if (normalizedMutations.length === 0) return unchangedRoot();
    const materializedMutations = [];
    for (const mutation of normalizedMutations) {
      const materialized = await materializeMutation(mutation, snapshotDomain);
      if (materialized) materializedMutations.push(materialized);
    }
    if (materializedMutations.length === 0) return unchangedRoot();
    const rootDescriptor = {
      root: indexRoot.root,
      rootHash: indexRoot.rootHash,
      level: indexRoot.height,
      count: indexRoot.count,
      keyRange: indexRoot.keyRange
    };
    const descriptors = await applyMutationsToDescriptor(rootDescriptor, materializedMutations, snapshotDomain);
    if (descriptors.length === 1 && descriptorMatches(descriptors[0], rootDescriptor)) return unchangedRoot();
    return writeRootFromMutationDescriptors(descriptors, snapshotDomain);
  }

  async function put(root, key, value, options = {}) {
    return mutatePathCopy(root, [{
      action: "put",
      key: String(key || ""),
      value: value?.valueRef ? undefined : value,
      valueRef: value?.valueRef,
      valueHash: value?.valueHash,
      metadata: asRecord(value?.metadata)
    }], options);
  }

  async function deleteKey(root, key, options = {}) {
    return mutatePathCopy(root, [{ action: "delete", key: String(key || "") }], options);
  }

  async function mutate(root, mutations = [], options = {}) {
    return mutatePathCopy(root, mutations, options);
  }

  async function findLeaf(root, key) {
    const indexRoot = await readIndexRoot(root);
    let descriptor = {
      root: indexRoot.root,
      rootHash: indexRoot.rootHash,
      level: indexRoot.height,
      count: indexRoot.count,
      keyRange: indexRoot.keyRange
    };
    const path = [];
    while (descriptor.level > 0) {
      const payload = await readNode(descriptor.root);
      const children = asArray(payload.children);
      const childIndex = findChildIndex(children, key);
      path.push({
        nodeRoot: descriptor.root,
        level: descriptor.level,
        keyRange: descriptor.keyRange,
        siblingDescriptors: children,
        childIndex,
        nodeHash: descriptor.rootHash
      });
      descriptor = children[childIndex];
    }
    const leafNode = await readNode(descriptor.root);
    return { indexRoot, leafDescriptor: descriptor, leafNode, path: path.reverse() };
  }

  async function get(root, key) {
    const { leafNode } = await findLeaf(root, key);
    return asArray(leafNode.entries).find((entry) => entry.key === String(key || "")) || null;
  }

  async function prove(root, key, options = {}) {
    const normalizedKey = String(key || "");
    const { indexRoot, leafDescriptor, leafNode, path } = await findLeaf(root, normalizedKey);
    const compact = compactProofPath(path);
    const entries = asArray(leafNode.entries).map(normalizeIndexEntry);
    const entry = entries.find((candidate) => candidate.key === normalizedKey);
    const maxProofLeafEntries = Number(options.maxProofLeafEntries || 0);
    const maxProofBytes = Number(options.maxProofBytes || 0);
    const fullLeafNodeProof = {
      keyRange: leafNode.keyRange,
      count: leafNode.count,
      entries,
      splitter: leafNode.splitter
    };
    const proofBytes = canonicalEncode(fullLeafNodeProof).length;
    let leafNodeProof = fullLeafNodeProof;
    let proofSizeWarning = null;
    if ((maxProofLeafEntries > 0 && entries.length > maxProofLeafEntries) ||
        (maxProofBytes > 0 && proofBytes > maxProofBytes)) {
      proofSizeWarning = {
        leafEntries: entries.length,
        proofBytes,
        maxProofLeafEntries: maxProofLeafEntries || undefined,
        maxProofBytes: maxProofBytes || undefined,
        message: "Proof leaf contains more entries than the configured limit. Proof size may be large."
      };
    }
    if (entry) {
      return {
        protocol: PACTIUM_PROTOCOL,
        proofType: PACTIUM_PROOF_TYPES.indexMembership,
        domain: indexRoot.domain,
        indexRoot: indexRoot.root,
        rootHash: indexRoot.rootHash,
        key: normalizedKey,
        entry,
        leafHash: indexLeafHash(entry),
        leafRoot: leafDescriptor.root,
        leafRootHash: leafDescriptor.rootHash,
        leafNode: leafNodeProof,
        descriptorTable: compact.descriptorTable,
        path: compact.path,
        ...(proofSizeWarning ? { proofSizeWarning } : {})
      };
    }
    const sortedEntries = entries.sort((left, right) => compareIndexKeys(left.key, right.key));
    const insertionPoint = sortedEntries.findIndex((candidate) => compareIndexKeys(candidate.key, normalizedKey) > 0);
    const left = insertionPoint < 0
      ? sortedEntries[sortedEntries.length - 1] || null
      : insertionPoint === 0
        ? null
        : sortedEntries[insertionPoint - 1];
    const right = insertionPoint < 0 ? null : sortedEntries[insertionPoint];
    return {
      protocol: PACTIUM_PROTOCOL,
      proofType: PACTIUM_PROOF_TYPES.indexNonMembership,
      domain: indexRoot.domain,
      indexRoot: indexRoot.root,
      rootHash: indexRoot.rootHash,
      key: normalizedKey,
      leafRoot: leafDescriptor.root,
      leafRootHash: leafDescriptor.rootHash,
      leafNode: leafNodeProof,
      descriptorTable: compact.descriptorTable,
      path: compact.path,
      leftBoundary: left?.key || "",
      rightBoundary: right?.key || "",
      ...(proofSizeWarning ? { proofSizeWarning } : {})
    };
  }

  async function proveMembershipMultiproof(root, keys = [], options = {}) {
    const normalizedKeys = [...new Set(asArray(keys).map(String).filter(Boolean))].sort(compareIndexKeys);
    const table = [];
    const tableMap = new Map();
    function globalRef(descriptor) {
      const key = canonicalString(descriptor);
      if (!tableMap.has(key)) {
        tableMap.set(key, table.length);
        table.push(normalizeCanonicalValue(descriptor));
      }
      return tableMap.get(key);
    }
    function remapPath(compact) {
      const localTable = asArray(compact.descriptorTable);
      return asArray(compact.path).map((item) => ({
        ...item,
        siblingDescriptorRefs: asArray(item.siblingDescriptorRefs).map((ref) => globalRef(localTable[Number(ref)]))
      }));
    }
    const leaves = [];
    const missingKeys = [];
    const indexRoot = await readIndexRoot(root);
    let cursor = 0;
    while (cursor < normalizedKeys.length) {
      const { leafDescriptor, leafNode, path } = await findLeaf(root, normalizedKeys[cursor]);
      const entries = asArray(leafNode.entries).map(normalizeIndexEntry);
      const entryKeys = new Set(entries.map((entry) => entry.key));
      const leafKeys = [];
      const leafMax = String(leafDescriptor.keyRange?.max || "");
      const rootMax = String(indexRoot.keyRange?.max || "");
      while (cursor < normalizedKeys.length) {
        const key = normalizedKeys[cursor];
        const mapsToCurrentLeaf = !leafMax || compareIndexKeys(key, leafMax) <= 0 || leafMax === rootMax;
        if (!mapsToCurrentLeaf) break;
        if (entryKeys.has(key)) leafKeys.push(key);
        else missingKeys.push(key);
        cursor += 1;
      }
      if (leafKeys.length > 0) {
        const compact = compactProofPath(path);
        leaves.push({
          leafRoot: leafDescriptor.root,
          leafRootHash: leafDescriptor.rootHash,
          leafNode: {
            keyRange: leafNode.keyRange,
            count: leafNode.count,
            entries,
            splitter: leafNode.splitter
          },
          path: remapPath(compact),
          keys: leafKeys
        });
      }
      if (cursor < normalizedKeys.length && leafMax === rootMax) break;
    }
    return {
      protocol: PACTIUM_PROTOCOL,
      proofType: PACTIUM_PROOF_TYPES.indexMembershipMultiproof,
      domain: indexRoot.domain,
      indexRoot: indexRoot.root,
      rootHash: indexRoot.rootHash,
      keys: normalizedKeys,
      missingKeys,
      descriptorTable: table,
      leaves
    };
  }

  async function collectRangeLeafProofs(root, options = {}) {
    const indexRoot = await readIndexRoot(root);
    const min = String(options.min || "");
    const max = String(options.max || "\uffff");
    const after = String(options.after || "");
    const limit = clampLimit(options.limit, 100000);
    const scanLimit = limit + 1;
    const leaves = [];
    const scannedEntries = [];
    const rootDescriptor = {
      root: indexRoot.root,
      rootHash: indexRoot.rootHash,
      level: indexRoot.height,
      count: indexRoot.count,
      keyRange: indexRoot.keyRange
    };
    async function visit(descriptor, pathFromRoot = []) {
      if (!descriptor?.root || scannedEntries.length >= scanLimit) return;
      if (!rangesIntersect(descriptor.keyRange, min, max)) return;
      if (after && compareIndexKeys(descriptor.keyRange?.max, after) <= 0) return;
      const payload = await readNode(descriptor.root);
      if (Number(payload.level || 0) === 0) {
        const leafEntries = asArray(payload.entries).map(normalizeIndexEntry);
        const filtered = leafEntries.filter((entry) =>
          (!after || compareIndexKeys(entry.key, after) > 0) &&
          compareIndexKeys(entry.key, min) >= 0 &&
          compareIndexKeys(entry.key, max) <= 0
        );
        if (filtered.length === 0) return;
        leaves.push({
          leafRoot: descriptor.root,
          leafRootHash: descriptor.rootHash,
          leafNode: {
            keyRange: payload.keyRange,
            count: payload.count,
            entries: leafEntries,
            splitter: payload.splitter
          },
          rawPath: [...pathFromRoot].reverse()
        });
        for (const entry of filtered) {
          if (scannedEntries.length >= scanLimit) break;
          scannedEntries.push(entry);
        }
        return;
      }
      const children = asArray(payload.children);
      for (const [childIndex, child] of children.entries()) {
        if (scannedEntries.length >= scanLimit) break;
        await visit(child, [
          ...pathFromRoot,
          {
            nodeRoot: descriptor.root,
            level: descriptor.level,
            keyRange: descriptor.keyRange,
            siblingDescriptors: children,
            childIndex,
            nodeHash: descriptor.rootHash
          }
        ]);
      }
    }
    await visit(rootDescriptor);
    return {
      indexRoot,
      leaves,
      entries: scannedEntries.slice(0, limit),
      limit,
      truncated: scannedEntries.length > limit
    };
  }

  async function proveRange(root, options = {}) {
    const range = await collectRangeLeafProofs(root, options);
    const table = [];
    const tableMap = new Map();
    function refFor(descriptor) {
      const key = canonicalString(descriptor);
      if (!tableMap.has(key)) {
        tableMap.set(key, table.length);
        table.push(normalizeCanonicalValue(descriptor));
      }
      return tableMap.get(key);
    }
    const leaves = range.leaves.map((leaf) => ({
      leafRoot: leaf.leafRoot,
      leafRootHash: leaf.leafRootHash,
      leafNode: leaf.leafNode,
      path: asArray(leaf.rawPath).map((item) => ({
        nodeRoot: String(item.nodeRoot || ""),
        level: Number(item.level || 0),
        keyRange: normalizeCanonicalValue(item.keyRange || { min: "", max: "" }),
        siblingDescriptorRefs: asArray(item.siblingDescriptors).map(refFor),
        childIndex: Number(item.childIndex || 0),
        nodeHash: String(item.nodeHash || "")
      }))
    }));
    const min = String(options.min || "");
    const after = String(options.after || "");
    const boundaryKey = after && compareIndexKeys(after, min) > 0 ? after : min;
    return {
      protocol: PACTIUM_PROTOCOL,
      proofType: PACTIUM_PROOF_TYPES.indexRange,
      domain: range.indexRoot.domain,
      indexRoot: range.indexRoot.root,
      rootHash: range.indexRoot.rootHash,
      min,
      max: String(options.max || "\uffff"),
      after,
      limit: range.limit,
      truncated: range.truncated,
      entries: range.entries,
      descriptorTable: table,
      leaves,
      boundaryProof: range.entries.length === 0 ? await prove(root, boundaryKey, options) : null
    };
  }

  function verifyProof(proof, context = {}) {
    return verifyIndexProof(proof, context);
  }

  async function scan(root, { min = "", max = "\uffff", limit = 5000, after = "" } = {}) {
    if (compareIndexKeys(min, max) > 0) return [];
    return rangeEntries(root, {
      min: String(min || ""),
      max: String(max || "\uffff"),
      after: String(after || ""),
      limit: clampLimit(limit)
    });
  }

  async function prefix(root, keyPrefix = "", options = {}) {
    const normalizedPrefix = String(keyPrefix || "");
    return rangeEntries(root, {
      min: normalizedPrefix,
      max: normalizedPrefix ? `${normalizedPrefix}\uffff` : "\uffff",
      after: String(options.after || ""),
      limit: clampLimit(options.limit),
      predicate: (entry) => !normalizedPrefix || entry.key === normalizedPrefix || entry.key.startsWith(normalizedPrefix)
    });
  }

  async function diffEntries(leftEntries, rightEntries) {
    const leftMap = new Map(leftEntries.map((entry) => [entry.key, entry]));
    const rightMap = new Map(rightEntries.map((entry) => [entry.key, entry]));
    return [...new Set([...leftMap.keys(), ...rightMap.keys()])]
      .sort(compareIndexKeys)
      .map((key) => {
        const before = leftMap.get(key) || null;
        const after = rightMap.get(key) || null;
        return indexEntriesEqual(before, after)
          ? null
          : { key, action: before && after ? "update" : before ? "delete" : "create", before, after };
      })
      .filter(Boolean);
  }

  async function collectDescriptorEntries(descriptor) {
    return descriptor ? collectEntriesFromDescriptor(descriptor) : [];
  }

  function compareKeys(left, right) {
    return compareIndexKeys(left, right);
  }

  function descriptorMaxBefore(leftDescriptor, rightDescriptor) {
    return compareKeys(leftDescriptor?.keyRange?.max, rightDescriptor?.keyRange?.min) < 0;
  }

  function sameDescriptorRange(leftDescriptor, rightDescriptor) {
    return String(leftDescriptor?.keyRange?.min || "") === String(rightDescriptor?.keyRange?.min || "") &&
      String(leftDescriptor?.keyRange?.max || "") === String(rightDescriptor?.keyRange?.max || "");
  }

  function maxKey(left, right) {
    return compareKeys(left, right) >= 0 ? String(left || "") : String(right || "");
  }

  async function descriptorActionChanges(descriptor, action) {
    const entries = await collectDescriptorEntries(descriptor);
    return entries.map((entry) => action === "create"
      ? { key: entry.key, action, before: null, after: entry }
      : { key: entry.key, action, before: entry, after: null });
  }

  async function collectGroupedEntries(descriptors) {
    const entries = [];
    for (const descriptor of descriptors) entries.push(...await collectDescriptorEntries(descriptor));
    return normalizeEntries(entries);
  }

  async function expandDescriptorGroup(descriptors) {
    const expanded = [];
    let allLeaves = true;
    for (const descriptor of descriptors) {
      const node = await readNode(descriptor.root);
      if (Number(node.level || 0) === 0) {
        expanded.push(descriptor);
      } else {
        allLeaves = false;
        expanded.push(...asArray(node.children));
      }
    }
    return { descriptors: expanded, allLeaves };
  }

  async function diffDescriptorGroups(leftGroup, rightGroup) {
    const [leftExpanded, rightExpanded] = await Promise.all([
      expandDescriptorGroup(leftGroup),
      expandDescriptorGroup(rightGroup)
    ]);
    if (leftExpanded.allLeaves && rightExpanded.allLeaves) {
      return diffEntries(
        await collectGroupedEntries(leftExpanded.descriptors),
        await collectGroupedEntries(rightExpanded.descriptors)
      );
    }
    return diffChildDescriptors(leftExpanded.descriptors, rightExpanded.descriptors);
  }

  async function diffChildDescriptors(leftChildren, rightChildren) {
    const changes = [];
    const groups = [];
    const items = [
      ...asArray(leftChildren).map((descriptor) => ({ side: "left", descriptor })),
      ...asArray(rightChildren).map((descriptor) => ({ side: "right", descriptor }))
    ].sort((left, right) => {
      const minCompare = compareKeys(left.descriptor.keyRange?.min, right.descriptor.keyRange?.min);
      if (minCompare !== 0) return minCompare;
      const maxCompare = compareKeys(left.descriptor.keyRange?.max, right.descriptor.keyRange?.max);
      if (maxCompare !== 0) return maxCompare;
      return left.side.localeCompare(right.side);
    });
    for (const item of items) {
      const rangeMin = String(item.descriptor.keyRange?.min || "");
      const rangeMax = String(item.descriptor.keyRange?.max || "");
      const active = groups[groups.length - 1];
      if (!active || compareKeys(rangeMin, active.max) > 0) {
        groups.push({ max: rangeMax, items: [item] });
        continue;
      }
      active.items.push(item);
      active.max = maxKey(active.max, rangeMax);
    }
    for (const group of groups) {
      const leftGroup = [];
      const rightGroup = [];
      for (const item of group.items) {
        if (item.side === "left") leftGroup.push(item.descriptor);
        else rightGroup.push(item.descriptor);
      }
      if (leftGroup.length === 0) {
        for (const descriptor of rightGroup) changes.push(...await descriptorActionChanges(descriptor, "create"));
      } else if (rightGroup.length === 0) {
        for (const descriptor of leftGroup) changes.push(...await descriptorActionChanges(descriptor, "delete"));
      } else if (leftGroup.length === 1 && rightGroup.length === 1 && leftGroup[0].root === rightGroup[0].root) {
        continue;
      } else if (leftGroup.length === 1 && rightGroup.length === 1 && sameDescriptorRange(leftGroup[0], rightGroup[0])) {
        changes.push(...await diffDescriptors(leftGroup[0], rightGroup[0]));
      } else {
        changes.push(...await diffDescriptorGroups(leftGroup, rightGroup));
      }
    }
    return changes;
  }

  async function diffDescriptors(leftDescriptor, rightDescriptor) {
    if (!leftDescriptor && !rightDescriptor) return [];
    if (leftDescriptor?.root && rightDescriptor?.root && leftDescriptor.root === rightDescriptor.root) return [];
    if (!leftDescriptor) return descriptorActionChanges(rightDescriptor, "create");
    if (!rightDescriptor) return descriptorActionChanges(leftDescriptor, "delete");
    if (descriptorMaxBefore(leftDescriptor, rightDescriptor)) {
      return [
        ...await descriptorActionChanges(leftDescriptor, "delete"),
        ...await descriptorActionChanges(rightDescriptor, "create")
      ].sort((left, right) => compareIndexKeys(left.key, right.key));
    }
    if (descriptorMaxBefore(rightDescriptor, leftDescriptor)) {
      return [
        ...await descriptorActionChanges(leftDescriptor, "delete"),
        ...await descriptorActionChanges(rightDescriptor, "create")
      ].sort((left, right) => compareIndexKeys(left.key, right.key));
    }
    const [leftNode, rightNode] = await Promise.all([readNode(leftDescriptor.root), readNode(rightDescriptor.root)]);
    if (Number(leftNode.level || 0) === 0 && Number(rightNode.level || 0) === 0) {
      return diffEntries(await collectDescriptorEntries(leftDescriptor), await collectDescriptorEntries(rightDescriptor));
    }
    const changes = await diffDescriptorGroups([leftDescriptor], [rightDescriptor]);
    return changes.sort((left, right) => compareIndexKeys(left.key, right.key));
  }

  async function diff(leftRoot, rightRoot) {
    const [left, right] = await Promise.all([readIndexRoot(leftRoot), readIndexRoot(rightRoot)]);
    return diffDescriptors(
      {
        root: left.root,
        rootHash: left.rootHash,
        level: left.height,
        count: left.count,
        keyRange: left.keyRange
      },
      {
        root: right.root,
        rootHash: right.rootHash,
        level: right.height,
        count: right.count,
        keyRange: right.keyRange
      }
    );
  }

  async function retainedNodeRootsFor(retainedRoots = []) {
    const retained = new Set();
    async function visit(descriptor) {
      if (!descriptor?.root || retained.has(descriptor.root)) return;
      retained.add(descriptor.root);
      const payload = await readNode(descriptor.root);
      for (const child of asArray(payload.children)) await visit(child);
    }
    for (const root of asArray(retainedRoots).map(String).filter(Boolean)) {
      const indexRoot = await readIndexRoot(root);
      await visit({
        root: indexRoot.root,
        rootHash: indexRoot.rootHash,
        level: indexRoot.height,
        count: indexRoot.count,
        keyRange: indexRoot.keyRange
      });
    }
    return retained;
  }

  async function pruneCache({ roots: retainedRoots = [] } = {}) {
    const retainedRootSet = new Set(asArray(retainedRoots).map(String).filter(Boolean));
    const retainedNodeRoots = await retainedNodeRootsFor([...retainedRootSet]);
    let prunedNodes = 0;
    let prunedRoots = 0;
    let prunedSnapshots = 0;
    for (const root of nodes.keys()) {
      if (!retainedNodeRoots.has(root)) {
        nodes.delete(root);
        prunedNodes += 1;
      }
    }
    for (const root of roots.keys()) {
      if (!retainedRootSet.has(root)) {
        roots.delete(root);
        prunedRoots += 1;
      }
    }
    for (const root of snapshots.keys()) {
      if (!retainedRootSet.has(root)) {
        snapshots.delete(root);
        prunedSnapshots += 1;
      }
    }
    return {
      retainedRoots: [...retainedRootSet],
      retainedNodeRoots: [...retainedNodeRoots],
      prunedNodes,
      prunedRoots,
      prunedSnapshots
    };
  }

  return Object.freeze({
    protocol: PACTIUM_PROTOCOL,
    engine: PACTIUM_INDEX_ENGINE,
    domain,
    createIndex,
    put,
    delete: deleteKey,
    mutate,
    get,
    prove,
    proveMembershipMultiproof,
    proveRange,
    verifyProof,
    verifyIndexProof,
    scan,
    prefix,
    diff,
    pruneCache,
    readSnapshot,
    readIndexRoot,
    readNode
  });
}
