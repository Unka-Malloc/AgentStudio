# Ledger Transparency Optimization

## Objective

Upgrade Pactium's Operation Ledger from the baseline full-history recomputation model to a compact RFC6962-style transparency log while preserving the proof-first API and latest-schema-only boundary.

## Baseline State

At the start of this optimization pass, Pactium already used the correct transparency-log hash shape:

- `ledgerLeafHash(leaf)` hashes `0x00 || canonical(leaf)` in `src/ledger/transparency-log.js:7`.
- `ledgerNodeHash(left,right)` hashes `0x01 || left || right` in `src/ledger/transparency-log.js:11`.
- Inclusion proofs are generated through recursive subtree paths in `src/ledger/transparency-log.js:58`.

The algorithmic gap is consistency and append storage:

- `rootHashFromLeafHashes` recursively recomputes from arrays (`src/ledger/transparency-log.js:25`).
- `createLedgerConsistencyProof` stores `oldLeafHashes` and `newLeafHashes` (`src/ledger/transparency-log.js:87`).
- `append` writes the entire `entries` object back through `save()` (`src/ledger/transparency-log.js:149`).

## Reference Signals

| Reference | Relevant code | Takeaway |
| --- | --- | --- |
| transparency-dev/merkle | `proof/verify.go:46`, `proof/verify.go:99`, `compact/range.go:65` | Inclusion and consistency proof verification should be logarithmic and should reject invalid tree-size/proof-shape combinations. |
| Trillian | `log/sequencer.go:177`, `log/sequencer.go:276`, `client/log_verifier.go:57`, `client/log_verifier.go:82` | Sequencing appends leaves into a compact range, persists new nodes, stores signed roots, and verifies roots from trusted heads. |
| Rekor | `pkg/verify/verify.go:40`, `pkg/verify/verify.go:116`, `pkg/verify/verify.go:141` | Public clients verify consistency from a previous signed tree head and verify inclusion against a signed checkpoint. |
| Hypercore | `lib/merkle-tree.js:149`, `lib/verifier.js:58` | Signed Merkle roots need a stable verifier identity/manifest, not just a hash. |

## Target Model

Add explicit ledger storage objects:

| Object | Key | Contents |
| --- | --- | --- |
| `ledger/head/current` | singleton | `size`, `rootHash`, `root`, `headId`, `createdAt`, optional `signatureRef`, optional `witnessRefs`. |
| `ledger/leaf/<index>` | by sequence number | `leaf`, `leafHash`, `factCid`, `factHash`, `timestamp`. |
| `ledger/node/<level>/<index>` | by compact tree coordinates | `hash`, `leftRef`, `rightRef`, `size`, `level`, `createdAt`. |
| `ledger/compact-range/current` | singleton | Minimal perfect-subtree hashes for the current size. |
| `ledger/head/<headId>` | by hash-bound id | Immutable head snapshots for proof bundle export and consistency verification. |

The existing JSON storage port can store these as protocol objects first. A later storage backend can make them append-only files or database rows without changing proof semantics.

## Audit-Path Proof Format

### Inclusion Proof

```js
{
  protocol: "pactium.v0.2",
  proofType: "ledger.inclusion.audit-path",
  index,
  size,
  leafHash,
  leaf,
  auditPath: [{ side: "left" | "right", hash }],
  rootHash,
  headRef
}
```

### Consistency Proof

```js
{
  protocol: "pactium.v0.2",
  proofType: "ledger.consistency.audit-path",
  oldSize,
  newSize,
  oldRootHash,
  newRootHash,
  auditPath: [hash],
  oldHeadRef,
  newHeadRef
}
```

The consistency proof must not include all leaf hashes. It contains only the RFC6962 audit path needed to derive both roots.

## Implementation Plan

### Phase 1: Isolate The Hasher And Proof Verifier

1. Move `ledgerLeafHash`, `ledgerNodeHash`, and `emptyTreeHash` into a small `src/ledger/rfc6962-hasher.js`.
2. Add proof-shape validation based on the transparency-dev/merkle behavior:
   - reject `index >= size`;
   - reject `size === 0` for inclusion;
   - reject `oldSize > newSize`;
   - reject empty-tree consistency proofs except the explicit `oldSize === 0` trust-bootstrap case;
   - reject unused or insufficient path elements.
3. Reject proof shapes outside the audit-path model so tests cover the current verifier contract.

Acceptance: existing ledger tests pass, plus new negative tests for malformed proof size, proof length, and mismatched roots.

### Phase 2: Persist Leaves And Nodes Separately

1. Replace the singleton `operation-ledger` array write with per-leaf writes.
2. Store `ledger/head/current` separately from leaf records.
3. Retain `entries()` as an inspection API by reading leaves by index, not by returning an in-memory authority.
4. Add `getLeaf(index)` and `getHead(headIdOrCurrent)`.

Acceptance: appending N entries writes O(log N) node records plus one leaf and one head, not a full ledger rewrite.

### Phase 3: Add Compact Range Append

1. Implement `createCompactRange({ size, hashes })` with the same abstraction as transparency-dev/merkle `compact.Range`.
2. On append, merge the new leaf hash into the compact range and emit newly formed internal nodes through a visitor callback.
3. Persist only newly formed nodes and the updated compact range.
4. Compute the new root from compact range peaks.

Acceptance: append complexity is O(log N) storage writes and O(log N) memory for the compact range.

### Phase 4: Generate Logarithmic Consistency Proofs

1. Add stored-node consistency proof generation for `{ oldHead, newHead }`.
2. Fetch only the required audit nodes from stored `ledger/node/<level>/<index>` records.
3. Verify by deriving roots from the audit path.
4. Export both old and new head refs in proof material.

Acceptance: proof byte size grows O(log N), and proof bundles for new writes do not include unrelated leaf hashes.

### Phase 5: Signed Heads

1. Define `ledger.head.signing` payload:
   - protocol;
   - schema;
   - ledgerId;
   - size;
   - rootHash;
   - root;
   - previousHeadId;
   - createdAt.
2. Add an optional core signer interface using public-key algorithms first. Keep LicoLite HMAC as a host/development policy, not as the recommended portable signature.
3. Bind `signatureRef` into `ledger/head/<headId>`.
4. Add `verifyLedgerHeadSignature(head, verifierManifest)` and call it from bundle verification when a manifest is supplied.

Acceptance: an offline verifier can validate "this root was signed by this trusted verifier identity" without LicoLite runtime state.

## API Changes

| API | Change |
| --- | --- |
| `ledger.append(fact)` | Returns inclusion and consistency audit-path proofs. |
| `ledger.head()` | Returns current head with `headId` and optional `signatureRef`. |
| `ledger.getHead(id)` | New API for proof bundles and trusted-head advancement. |
| `ledger.verifyConsistency` | Verifies the audit-path consistency proof. |
| `verifyProofEnvelope` | Verifies ledger proofs and optional signed head material through the proof verifier registry. |

## Tests

| Test | Purpose |
| --- | --- |
| RFC6962 fixed vectors | Prevent hash/path regressions. |
| Random append/inclusion property tests | For each append, verify every sampled leaf against the current head. |
| Random consistency property tests | Verify sampled old/new size pairs with audit-path proof and reject tampered paths. |
| Bundle leakage test | Assert a new consistency proof does not include all historical leaf hashes. |
| Storage write-count test | Assert append writes O(log N) ledger nodes after warm-up. |
| Signed-head test | Verify valid signature, reject wrong key, wrong size, wrong root, and wrong previous head. |

## Rollout

1. Implement stored audit-path proof generation.
2. Make verification accept only the current audit-path shape.
3. Emit current proof material under the latest schema.
4. Keep dependent tests and docs aligned to the current proof names.

Because Pactium currently rejects historical data directories, no in-place migration is required. Existing test fixtures can be regenerated under the latest protocol profile.
