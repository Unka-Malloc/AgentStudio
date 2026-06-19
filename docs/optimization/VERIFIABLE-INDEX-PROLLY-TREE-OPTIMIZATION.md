# Verifiable Index Prolly Tree Optimization

## Objective

Replace the baseline full-snapshot pairwise Merkle index with a real content-addressed Prolly tree, matching the maintained protocol profile and improving mutation, proof, and diff complexity for state, checkpoint, workspace, lifecycle, idempotency, and causality indexes.

## Baseline State

At the start of this optimization pass, the implementation was correctly deterministic but not a Prolly tree:

- `buildPairLayers` builds a binary Merkle overlay over a full leaf array (`src/index-engine/snapshot-merkle-index.js:20`).
- `chunkBoundariesForEntries` records boundary metadata (`src/index-engine/snapshot-merkle-index.js:71`) but those boundaries are not nodes and do not affect the Merkle root.
- `writeSnapshot` stores all normalized entries and leaf hashes in one protocol object (`src/index-engine/snapshot-merkle-index.js:112`).
- `put` and `deleteKey` rebuild the full snapshot (`src/index-engine/snapshot-merkle-index.js:163`, `src/index-engine/snapshot-merkle-index.js:178`).
- `diff` builds full maps and compares canonical strings (`src/index-engine/snapshot-merkle-index.js:259`).

The maintained protocol profile already said the structure was a Canonical Prolly Tree with content-defined chunking and shared-node diff (`docs/protocols/PROFILE.md:43`). The implementation has now been brought up to that contract; see [Implementation Status](IMPLEMENTATION-STATUS.md).

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
3. Re-chunk only the affected local run. Include neighboring chunks when a boundary changes.
4. Rebuild parent descriptors up to the root.
5. Reuse all untouched child nodes by CID.
6. Return the new index root object.

### `delete(root, key, options)`

1. Read the root node path for `key`.
2. Remove the entry if present.
3. Merge/rechunk neighboring chunks if the leaf falls below `minEntries`.
4. Rebuild only changed ancestors.

### Conservative First Implementation

If local rechunking is too risky for the first iteration, implement a builder that writes real Prolly nodes from a full sorted entry stream. Even that first step fixes proof format, storage shape, and diff by shared nodes for future roots. Then optimize point mutations incrementally.

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
  path: [
    {
      nodeRoot,
      level,
      keyRange,
      siblingDescriptors,
      childIndex,
      nodeHash
    }
  ]
}
```

Verification recomputes the leaf node, then each parent node from sibling descriptors until `indexRoot`.

### Non-Membership

```js
{
  proofType: "index.non-membership.prolly-path",
  domain,
  indexRoot,
  rootHash,
  key,
  containingLeaf: {
    keyRange,
    entries,
    path
  },
  leftBoundary,
  rightBoundary
}
```

The verifier checks the containing leaf range and confirms that no entry key equals the queried key. This is more compact and more direct than proving nearest left/right keys separately.

## Diff Algorithm

Implement `diff(leftRoot, rightRoot)` as shared-node traversal:

1. If both root CIDs match, return no changes.
2. If key ranges do not overlap, emit create/delete ranges.
3. If both nodes are internal, compare child descriptors by key range and root.
4. Skip matching child roots.
5. Descend only changed or overlapping ranges.
6. At leaf level, compare entries by key.

Acceptance target: diff cost should be proportional to changed chunks plus tree height, not total key count.

## Storage Changes

| Function | Change |
| --- | --- |
| `putBlock` | Store Prolly nodes as normal CAS blocks with child refs. |
| `putProtocolObject("index", ...)` | Store only root metadata and optional debug summaries, not full entries. |
| `readSnapshot` | Inspection helper built from `readIndexRoot` and `readNode`; emitted roots stay metadata-only. |
| `scan`/`prefix` | Implement cursor traversal over leaf nodes. |

## Verifier Integration

1. Export `verifyIndexProof(proof)` from the index engine module.
2. Register index proof verifiers with `verifyProofEnvelope`.
3. Make LicoLite workspace projection verification call the same verifier for order and membership proofs.
4. Reject unknown critical proof types in proof material.

This closes the current gap where embedded index proofs can be present but not actually checked by core envelope verification.

## Tests

| Test | Purpose |
| --- | --- |
| Builder determinism | Same entries in any insertion order produce same root. |
| Chunk boundary fixtures | Boundary constants produce stable node cuts. |
| Membership proofs | Valid keys verify; tampered entries, siblings, and roots fail. |
| Non-membership proofs | Missing keys inside, before, and after ranges verify; inserted key tampering fails. |
| Mutation structural sharing | Updating one key reuses unrelated subtree roots. |
| Diff scaling | Unchanged shared roots are skipped; changed keys are reported exactly. |
| Domain separation | Same key/value under different domains yields different roots. |
| Envelope verification | Corrupt workspace/state/checkpoint index proof causes `verifyProofEnvelope` failure. |

## Rollout

1. Add Prolly node writer/reader and full-builder implementation.
2. Emit Prolly index roots for new data directories.
3. Register only the current Prolly-path proof verifiers.
4. Add cursor scan/prefix.
5. Add local mutation rechunking after builder/proofs are stable.
6. Remove snapshot full-entry storage from emitted roots.

Because Pactium is latest-schema-only, the rollout can regenerate fixtures instead of migrating existing data directories.
