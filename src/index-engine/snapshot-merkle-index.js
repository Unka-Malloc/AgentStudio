import {
  PACTIUM_INDEX_ENGINE,
  PACTIUM_INDEX_SPLITTER,
  PACTIUM_PROOF_TYPES,
  PACTIUM_PROTOCOL,
  PACTIUM_PROTOCOL_PROFILE,
  PACTIUM_SCHEMA_VERSION
} from "../protocol/constants.js";
import { canonicalEncode, canonicalString, normalizeCanonicalValue } from "../canonical/value.js";
import { cidForCanonical, hashBytes, hexFromCid, protocolHashHex } from "../protocol/hashing.js";
import { createStoragePort } from "../storage/local-json-storage-port.js";
import { asArray, asRecord, safeToken } from "../shared/records.js";

const INDEX_NODE_TYPE = "pactium.index.node";
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
  const normalizedEntries = asArray(entries)
    .map(normalizeIndexEntry)
    .filter((entry) => entry.key)
    .sort((left, right) => compareIndexKeys(left.key, right.key));
  const deduped = [];
  for (const entry of normalizedEntries) {
    if (deduped.length > 0 && deduped[deduped.length - 1].key === entry.key) deduped[deduped.length - 1] = entry;
    else deduped.push(entry);
  }
  return deduped;
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

function entryBoundaryHash(domain, entry) {
  return protocolHashHex("index.boundary", {
    domain,
    key: entry.key,
    valueRef: entry.valueRef,
    valueHash: entry.valueHash
  });
}

function childBoundaryHash(domain, child) {
  return protocolHashHex("index.boundary", {
    domain,
    key: child.keyRange?.max || "",
    root: child.root,
    rootHash: child.rootHash,
    level: child.level,
    count: child.count
  });
}

function first32(hash) {
  return Number.parseInt(String(hash || "").slice(0, 8), 16) || 0;
}

function shouldCutChunk({ size, boundaryHash, splitter }) {
  if (size < splitter.minEntries) return false;
  return (first32(boundaryHash) & splitter.boundaryMask) === 0 || size >= splitter.maxEntries;
}

function chunkEntryGroups(entries, snapshotDomain) {
  const splitter = splitterConfig();
  const chunks = [];
  let active = [];
  for (const entry of entries) {
    active.push(entry);
    if (shouldCutChunk({ size: active.length, boundaryHash: entryBoundaryHash(snapshotDomain, entry), splitter })) {
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

function validateLeafNodePayload(payload) {
  if (!payload || payload.protocol !== PACTIUM_PROTOCOL || payload.nodeType !== INDEX_NODE_TYPE || payload.level !== 0) return false;
  const entries = asArray(payload.entries).map(normalizeIndexEntry);
  if (entries.length !== Number(payload.count || 0)) return false;
  if (canonicalString(entries) !== canonicalString(asArray(payload.entries))) return false;
  if (!ensureSortedEntries(entries)) return false;
  return canonicalString(rangeForEntries(entries)) === canonicalString(payload.keyRange || {});
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
  return canonicalString(rangeForChildren(children)) === canonicalString(payload.keyRange || {});
}

function verifyNodePayload(payload, expected = {}) {
  const finalized = finalizeNodePayload(payload);
  const root = cidForCanonical(finalized);
  const validShape = finalized.level === 0 ? validateLeafNodePayload(finalized) : validateInternalNodePayload(finalized);
  return validShape &&
    (!expected.root || expected.root === root) &&
    (!expected.rootHash || expected.rootHash === hexFromCid(root));
}

function findChildIndex(children, key) {
  if (children.length === 0) return -1;
  const normalizedKey = String(key || "");
  const index = children.findIndex((child) => compareIndexKeys(normalizedKey, child.keyRange?.max) <= 0);
  return index >= 0 ? index : children.length - 1;
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
    siblingDescriptors: asArray(item.siblingDescriptors).map((child) => normalizeCanonicalValue(child)),
    childIndex: Number(item.childIndex || 0),
    nodeHash: String(item.nodeHash || "")
  }));
}

function nodePayloadFromProofLeaf(proof) {
  const leafNode = asRecord(proof.leafNode || proof.containingLeaf?.leafNode);
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

function verifyPathToRoot({ proof, leafDescriptor, selectionKey = null }) {
  let current = leafDescriptor;
  const path = proofEntryPath(proof.path || proof.containingLeaf?.path);
  for (const pathItem of path) {
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
    if (!verifyNodePayload(parentPayload, { rootHash: pathItem.nodeHash })) return null;
    current = descriptorFromNodePayload(parentPayload);
    if (current.root !== pathItem.nodeRoot) return null;
  }
  return current;
}

export function verifyIndexProof(proof) {
  if (!proof || typeof proof !== "object") return false;
  if (![PACTIUM_PROOF_TYPES.indexMembership, PACTIUM_PROOF_TYPES.indexNonMembership].includes(proof.proofType)) {
    return false;
  }
  const leafPayload = nodePayloadFromProofLeaf(proof);
  const leafRoot = cidForCanonical(leafPayload);
  const leafRootHash = hexFromCid(leafRoot);
  if (!verifyNodePayload(leafPayload, { root: proof.leafRoot || proof.containingLeaf?.leafRoot || leafRoot })) return false;
  if ((proof.leafRoot && proof.leafRoot !== leafRoot) || (proof.leafRootHash && proof.leafRootHash !== leafRootHash)) return false;
  const leafDescriptor = descriptorFromNodePayload(leafPayload, leafRoot);
  const normalizedKey = String(proof.key || "");
  const rootDescriptor = verifyPathToRoot({ proof, leafDescriptor, selectionKey: normalizedKey });
  if (!rootDescriptor) return false;
  if (rootDescriptor.root !== proof.indexRoot || rootDescriptor.rootHash !== proof.rootHash) return false;
  const entries = asArray(leafPayload.entries).map(normalizeIndexEntry);
  if (proof.proofType === PACTIUM_PROOF_TYPES.indexMembership) {
    const entry = normalizeIndexEntry(proof.entry || {});
    const found = entries.find((candidate) => candidate.key === normalizedKey);
    return Boolean(found) &&
      canonicalString(found) === canonicalString(entry) &&
      indexLeafHash(entry) === proof.leafHash;
  }
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

export function createVerifiableIndexEngine({ storage = createStoragePort({ inMemory: true }), domain = "generic" } = {}) {
  const roots = new Map();
  const nodes = new Map();
  const snapshots = new Map();

  async function putNode(payload) {
    const finalized = finalizeNodePayload(payload);
    const refs = asArray(finalized.children).map((child) => child.root).filter(Boolean);
    const block = await storage.putBlock(finalized, { kind: `index-node:${finalized.domain}`, refs });
    const descriptor = descriptorFromNodePayload(finalized, block.cid);
    nodes.set(block.cid, finalized);
    return { payload: finalized, descriptor };
  }

  async function readNode(root) {
    if (!root) return null;
    if (nodes.has(root)) return nodes.get(root);
    const block = await storage.getBlock(root);
    if (!block) throw new Error(`Index node missing for ${root}`);
    const payload = normalizeCanonicalValue(JSON.parse(Buffer.from(block.payloadBase64, "base64").toString("utf8")));
    if (!verifyNodePayload(payload, { root })) throw new Error(`Index node integrity failure for ${root}`);
    nodes.set(root, payload);
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
      if (shouldCutChunk({ size: active.length, boundaryHash: childBoundaryHash(snapshotDomain, child), splitter })) {
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
    roots.set(rootDescriptor.root, indexRoot);
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
    roots.set(rootDescriptor.root, indexRoot);
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
    if (roots.has(root)) return roots.get(root);
    const object = await storage.getProtocolObject("index", `${safeToken(domain)}-${hexFromCid(root)}`, null);
    if (!object) throw new Error(`Index snapshot missing for ${root}`);
    roots.set(root, object);
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

  async function collectLeafDescriptorsFromDescriptor(descriptor, output = []) {
    if (!descriptor?.root) return output;
    const payload = await readNode(descriptor.root);
    if (Number(payload.level || 0) === 0) {
      output.push(descriptor);
      return output;
    }
    for (const child of asArray(payload.children)) {
      await collectLeafDescriptorsFromDescriptor(child, output);
    }
    return output;
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
    if (snapshots.has(root)) return snapshots.get(root);
    const indexRoot = await readIndexRoot(root);
    const entries = await collectEntries(root);
    const leafHashes = entries.map(indexLeafHash);
    const snapshot = {
      ...indexRoot,
      entries,
      leafHashes,
      chunkBoundaries: await chunkBoundaries(root)
    };
    snapshots.set(root, snapshot);
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

  async function rechunkToSingleRoot(descriptors, snapshotDomain) {
    let current = descriptors;
    while (current.length > 1) {
      current = await writeParentLevel(current, snapshotDomain, Number(current[0]?.level || 0) + 1);
    }
    return current[0];
  }

  async function writeCanonicalRootFromLeafDescriptors(leafDescriptors, snapshotDomain) {
    return writeIndexRootFromDescriptor(await rechunkToSingleRoot(leafDescriptors, snapshotDomain), snapshotDomain);
  }

  async function mutateLocal(root, key, mutation, options = {}) {
    const indexRoot = await readIndexRoot(root);
    const snapshotDomain = options.domain || indexRoot.domain || domain;
    const normalizedKey = String(key || "");
    if (!normalizedKey) return indexRoot;
    const found = await findLeaf(root, normalizedKey);
    const leafDescriptors = await collectLeafDescriptorsFromDescriptor({
      root: indexRoot.root,
      rootHash: indexRoot.rootHash,
      level: indexRoot.height,
      count: indexRoot.count,
      keyRange: indexRoot.keyRange
    });
    const foundLeafIndex = Math.max(0, leafDescriptors.findIndex((descriptor) => descriptor.root === found.leafDescriptor.root));
    let replaceStart = Math.max(0, foundLeafIndex - 1);
    let replaceEnd = Math.min(leafDescriptors.length - 1, foundLeafIndex + 1);
    let replacementLeafDescriptors = [];
    while (true) {
      const localEntries = [];
      for (const descriptor of leafDescriptors.slice(replaceStart, replaceEnd + 1)) {
        localEntries.push(...await collectEntriesFromDescriptor(descriptor));
      }
      const mutatedEntries = mutation(normalizeEntries(localEntries)).sort((left, right) => compareIndexKeys(left.key, right.key));
      const chunks = chunkEntryGroups(mutatedEntries, snapshotDomain);
      const tailIsClosed = chunks[chunks.length - 1]?.closed === true;
      if (tailIsClosed || replaceEnd >= leafDescriptors.length - 1) {
        replacementLeafDescriptors = await writeLeafNodes(mutatedEntries, snapshotDomain);
        break;
      }
      replaceEnd += 1;
    }
    return writeCanonicalRootFromLeafDescriptors([
      ...leafDescriptors.slice(0, replaceStart),
      ...replacementLeafDescriptors,
      ...leafDescriptors.slice(replaceEnd + 1)
    ], snapshotDomain);
  }

  async function put(root, key, value, options = {}) {
    const indexRoot = await readIndexRoot(root);
    const normalizedKey = String(key || "");
    // No-op fast path: if the key already exists with the same valueRef,
    // valueHash, and metadata, skip the mutation entirely and return the
    // same root. Metadata is compared via canonicalString to cover
    // structurally equal objects.
    // When valueRef/valueHash are not provided (plain value), compute the
    // canonical hash directly to allow no-op detection without putBlock.
    if (normalizedKey) {
      const existing = await get(root, normalizedKey);
      if (existing) {
        const valueRef = String(value?.valueRef || "");
        const valueHash = value?.valueRef
          ? String(value.valueHash || "")
          : `sha256:${hashBytes(Buffer.from(canonicalEncode(value)))}`;
        const existingMetadata = canonicalString(normalizeCanonicalValue(asRecord(existing?.metadata)));
        const newMetadata = canonicalString(normalizeCanonicalValue(asRecord(value?.metadata)));
        if (existing.valueRef === valueRef && existing.valueHash === valueHash && existingMetadata === newMetadata) {
          return indexRoot;
        }
      }
    }
    const valueBlock = value?.valueRef
      ? { cid: value.valueRef, payloadHash: value.valueHash || "" }
      : await storage.putBlock(value, { kind: `index-value:${options.domain || indexRoot.domain || domain}` });
    return mutateLocal(root, key, (entries) => [
      ...entries.filter((entry) => entry.key !== String(key || "")),
      {
        key: String(key || ""),
        valueRef: valueBlock.cid,
        valueHash: valueBlock.payloadHash || "",
        metadata: asRecord(value?.metadata)
      }
    ], options);
  }

  async function deleteKey(root, key, options = {}) {
    const normalizedKey = String(key || "");
    // No-op fast path: if the key does not exist, skip mutation entirely.
    if (normalizedKey) {
      const existing = await get(root, normalizedKey);
      if (!existing) {
        const indexRoot = await readIndexRoot(root);
        return indexRoot;
      }
    }
    return mutateLocal(root, key, (entries) => entries.filter((entry) => entry.key !== String(key || "")), options);
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

  async function prove(root, key) {
    const normalizedKey = String(key || "");
    const { indexRoot, leafDescriptor, leafNode, path } = await findLeaf(root, normalizedKey);
    const entries = asArray(leafNode.entries).map(normalizeIndexEntry);
    const entry = entries.find((candidate) => candidate.key === normalizedKey);
    const leafNodeProof = {
      keyRange: leafNode.keyRange,
      count: leafNode.count,
      entries,
      splitter: leafNode.splitter
    };
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
        path
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
      containingLeaf: {
        keyRange: leafNode.keyRange,
        entries: sortedEntries,
        leafRoot: leafDescriptor.root,
        leafRootHash: leafDescriptor.rootHash,
        leafNode: leafNodeProof,
        path
      },
      leftBoundary: left?.key || "",
      rightBoundary: right?.key || ""
    };
  }

  function verifyProof(proof) {
    return verifyIndexProof(proof);
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
        return canonicalString(before) === canonicalString(after)
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
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < leftChildren.length || rightIndex < rightChildren.length) {
      const leftChild = leftChildren[leftIndex] || null;
      const rightChild = rightChildren[rightIndex] || null;
      if (!leftChild) {
        changes.push(...await descriptorActionChanges(rightChild, "create"));
        rightIndex += 1;
        continue;
      }
      if (!rightChild) {
        changes.push(...await descriptorActionChanges(leftChild, "delete"));
        leftIndex += 1;
        continue;
      }
      if (leftChild.root === rightChild.root) {
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }
      if (descriptorMaxBefore(leftChild, rightChild)) {
        changes.push(...await descriptorActionChanges(leftChild, "delete"));
        leftIndex += 1;
        continue;
      }
      if (descriptorMaxBefore(rightChild, leftChild)) {
        changes.push(...await descriptorActionChanges(rightChild, "create"));
        rightIndex += 1;
        continue;
      }

      let groupMax = maxKey(leftChild.keyRange?.max, rightChild.keyRange?.max);
      const leftGroup = [];
      const rightGroup = [];
      let expanded = true;
      while (expanded) {
        expanded = false;
        while (leftIndex < leftChildren.length && compareKeys(leftChildren[leftIndex].keyRange?.min, groupMax) <= 0) {
          const child = leftChildren[leftIndex];
          leftGroup.push(child);
          groupMax = maxKey(groupMax, child.keyRange?.max);
          leftIndex += 1;
          expanded = true;
        }
        while (rightIndex < rightChildren.length && compareKeys(rightChildren[rightIndex].keyRange?.min, groupMax) <= 0) {
          const child = rightChildren[rightIndex];
          rightGroup.push(child);
          groupMax = maxKey(groupMax, child.keyRange?.max);
          rightIndex += 1;
          expanded = true;
        }
      }

      if (leftGroup.length === 1 && rightGroup.length === 1 && sameDescriptorRange(leftGroup[0], rightGroup[0])) {
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
    get,
    prove,
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
