# Verifiable Index Prolly Tree Optimization

## Objective

Document the current content-addressed Prolly Tree implementation used by the shared Verifiable Index Engine for state, checkpoint, workspace, lifecycle, idempotency, and causality indexes.

## Current State

The implementation in `src/index-engine/snapshot-merkle-index.js` now matches the maintained protocol profile:

- Index roots contain root metadata only: root CID, root hash, count, key range, height, domain, and splitter constants.
- Leaf and internal Prolly nodes are stored as content-addressed CAS blocks with child refs.
- Membership, compact non-membership, membership multiproof, and range proofs use compact Prolly path proof material.
- `scan` and `prefix` traverse key ranges over leaf nodes and support bounded pagination.
- `diff` skips equal subtree roots, merges non-aligned child ranges, descends changed overlap groups, and compares entries only at leaf level.
- `put`, `delete`, and `mutate` use path-copying: they descend affected search paths, rewrite changed leaves and necessary ancestors, collapse single-child roots, and reuse unchanged subtrees.
- `readSnapshot` remains an inspection helper that materializes entries from nodes; emitted roots do not store full entry arrays as authority.

The previous pairwise Merkle full-snapshot authority and metadata-only chunk boundary model are not current behavior.

## Reference Signals

| Reference | Relevant code | Takeaway |
| --- | --- | --- |
| Dolt chunker | `go/store/prolly/tree/chunker.go:39`, `chunker.go:419` | Mutations run through a chunker that builds child and parent nodes, reusing unchanged chunks. |
| Dolt splitters | `go/store/prolly/tree/node_splitter.go:151`, `node_splitter.go:207` | Real Prolly boundaries are content-defined by rolling or key-derived splitters, not metadata afterthoughts. |
| Dolt node store | `go/store/prolly/tree/node_store.go:37`, `node_store.go:170` | Nodes are content-addressed and discover child references. |
| Dolt diff | `go/store/prolly/tree/diff.go:64`, `diff.go:251` | Diff walks cursors and skips common subtrees. |

## Target Data Model

### Leaf Entry

```js
{
  key,
  valueRef,
  valueHash,
  metadata
}
```

This is the current semantic entry shape and should remain stable.

### Prolly Node

```js
{
  protocol: "pactium.v0.2",
  schema,
  nodeType: "pactium.index.node",
  domain,
  level,              // 0 for leaf chunks, >0 for internal chunks
  keyRange: { min, max },
  count,              // total leaf entry count under this node
  byteLength,         // canonical payload length before storage wrapper
  entries,            // leaf level only: sorted entries
  children,           // internal level only: [{ root, rootHash, count, keyRange }]
  splitter: {
    algorithm: "pactium-cdc-boundary",
    minEntries,
    targetEntries,
    maxEntries,
    boundaryMask
  }
}
```

The node CID/hash must be derived from this canonical node payload. `children.root` values are CAS refs and must be included in storage `refs`.

### Index Root

```js
{
  protocol: "pactium.v0.2",
  engine: "pactium.verifiable-index-engine",
  domain,
  root,
  rootHash,
  count,
  keyRange,
  height,
  splitter
}
```

The root object should no longer contain all entries.

## Chunking Algorithm

Use a deterministic key/value-derived boundary. For Pactium v0.2, keep the current profile constants but make boundaries create actual leaf nodes:

1. Normalize and sort entries by canonical index key.
2. Append entries into the active leaf chunk.
3. Compute `boundaryHash = protocolHashHex("index.boundary", { domain, key, valueRef, valueHash })`.
4. Cut a leaf chunk when:
   - `currentSize >= minEntries`, and
   - either `(first32(boundaryHash) & boundaryMask) === 0` or `currentSize >= maxEntries`.
5. Build parent chunks from child descriptors with the same boundary rule over child max keys/root hashes.
6. Continue until one root node remains.

This is simpler than Dolt's rolling hash and key splitter, but it preserves Pactium's current profile constants and creates real structural sharing. A future protocol profile can adopt a rolling-window splitter if needed.

## Mutation Algorithm

### `put(root, key, value, options)`

1. Read the root node path for `key`.
2. Replace or insert the entry in the target leaf chunk.
3. Rechunk the mutated leaf entries if the leaf splits or collapses.
4. Rebuild only ancestors on the search path whose child descriptors changed.
5. Collapse a single-child internal root.
6. Return the new index root object.

### `delete(root, key, options)`

1. Read the root node path for `key`.
2. Remove the entry if present.
3. Rechunk the mutated leaf entries if the leaf becomes empty or changes descriptor.
4. Rebuild only ancestors on the search path whose child descriptors changed.

### `mutate(root, mutations, options)`

1. Normalize mutations by key and keep the final mutation for repeated keys.
2. Materialize put values into content-addressed value blocks.
3. Group mutations by child search path at each internal node.
4. Rewrite only children reached by a mutation group.
5. Rebuild the changed ancestor descriptors and return the new root.

## Proof Format

### Membership

```js
{
  proofType: "index.membership.prolly-path",
  domain,
  indexRoot,
  rootHash,
  key,
  entry,
  leafHash,
  leafRoot,
  leafRootHash,
  leafNode: {
    keyRange,
    count,
    entries,
    splitter
  },
  descriptorTable: [
    { root, rootHash, level, count, keyRange }
  ],
  path: [
    {
      nodeRoot,
      level,
      keyRange,
      siblingDescriptorRefs,
      childIndex,
      nodeHash
    }
  ]
}
```

Verification recomputes the leaf node, expands sibling descriptors from the descriptor table, then recomputes each parent node until `indexRoot`.

### Non-Membership

```js
{
  proofType: "index.non-membership.compact-prolly-boundary",
  domain,
  indexRoot,
  rootHash,
  key,
  leafRoot,
  leafRootHash,
  leafNode: {
    keyRange,
    entries,
  },
  descriptorTable,
  path,
  leftBoundary,
  rightBoundary
}
```

The verifier checks the containing leaf range and confirms that no entry key equals the queried key. This is more compact and more direct than proving nearest left/right keys separately.

### Membership Multiproof

```js
{
  proofType: "index.membership-multiproof.prolly-paths",
  domain,
  indexRoot,
  rootHash,
  keys,
  missingKeys,
  descriptorTable,
  leaves: [
    {
      leafRoot,
      leafRootHash,
      leafNode,
      path,
      keys
    }
  ]
}
```

Verification fails if any requested key is missing or if a leaf/path cannot recompute the committed root.

### Range Proof

```js
{
  proofType: "index.range.prolly-paths",
  domain,
  indexRoot,
  rootHash,
  min,
  max,
  after,
  limit,
  truncated,
  entries,
  descriptorTable,
  leaves,
  boundaryProof
}
```

Verification recomputes every included leaf path, checks returned entries against the requested range, rejects omitted covered siblings, and uses `boundaryProof` for empty ranges.

## Diff Algorithm

`diff(leftRoot, rightRoot)` is implemented as shared-node traversal:

1. If both root CIDs match, return no changes.
2. If key ranges do not overlap, emit create/delete ranges.
3. If both nodes are internal, compare child descriptors by key range and root.
4. Skip matching child roots.
5. Descend only changed or overlapping ranges.
6. At leaf level, compare entries by key.

The intended cost is proportional to changed chunks plus tree height, not total key count. The reference tests assert non-aligned child range diffs and small mutations do not fall back to full snapshot traversal.

## Storage Changes

| Function | Change |
| --- | --- |
| `putBlock` | Store Prolly nodes as normal CAS blocks with child refs. |
| `putProtocolObject("index", ...)` | Store only root metadata and optional debug summaries, not full entries. |
| `readSnapshot` | Inspection helper built from `readIndexRoot` and `readNode`; emitted roots stay metadata-only. |
| `scan`/`prefix` | Implement cursor traversal over leaf nodes. |

## Verifier Integration

1. `verifyIndexProof(proof)` is exported from the index engine module.
2. `createDefaultProofVerifierRegistry` registers index membership, compact non-membership, membership multiproof, and range proof verifiers.
3. `verifyProofEnvelope` recursively walks `proofMaterial.proofs` and dispatches every object with a `proofType` to the registry.
4. LicoLite verification relies on core registry verification for workspace order and membership proofs before reporting success.
5. Missing verifiers fail closed when `requireAllProofs` is true or the proof material is critical.

Embedded index proofs are therefore checked by core envelope verification.

## Tests

| Test | Purpose |
| --- | --- |
| Builder determinism | Same entries in any insertion order produce same root. |
| Chunk boundary fixtures | Boundary constants produce stable node cuts. |
| Membership proofs | Valid keys verify; tampered entries, sibling refs, and roots fail. |
| Non-membership proofs | Missing keys inside, before, and after ranges verify; inserted key tampering fails. |
| Multiproofs and range proofs | Multi-key and range proof material verifies; omitted leaves, missing keys, and tampered entries fail. |
| Mutation structural sharing | Updating one key rewrites only necessary path nodes and reuses unrelated subtree roots. |
| Diff scaling | Unchanged shared roots are skipped; changed keys are reported exactly. |
| Domain separation | Same key/value under different domains yields different roots. |
| Envelope verification | Corrupt workspace/state/checkpoint index proof causes `verifyProofEnvelope` failure. |

## Current Runtime Boundary

1. New data directories emit Prolly index roots and CAS-backed nodes.
2. The current membership, compact non-membership, membership multiproof, and range proof types are registered as built-in index proof types.
3. Cursor scan/prefix use key-range traversal over leaf nodes.
4. Local mutation rechunking is implemented for `put` and `delete`.
5. Snapshot full-entry storage is not part of emitted root authority.

Because Pactium is latest-schema-only, the rollout can regenerate fixtures instead of migrating existing data directories.
