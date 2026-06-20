# Ledger Transparency Optimization

## Objective

Document the current compact RFC6962-style Operation Ledger implementation. The optimization has been completed in `src/ledger/transparency-log.js` and `src/ledger/signed-head.js` while preserving the proof-first API and latest-schema-only boundary.

## Current State

Pactium now uses the transparency-log hash shape as the active ledger protocol:

- `ledgerLeafHash(leaf)` hashes `0x00 || canonical(leaf)` in `src/ledger/transparency-log.js`.
- `ledgerNodeHash(left,right)` hashes `0x01 || left || right` in `src/ledger/transparency-log.js`.
- Inclusion and consistency proof verification rejects malformed hash syntax, impossible sizes, wrong path direction, and unused or insufficient path elements.
- Appends persist leaves, compact-range peaks, immutable heads, and compact tree nodes separately rather than rewriting a full ledger array.
- Stored proof generation reads only required leaf/node records and emits `ledger.*.audit-path` proofs.
- Ledger Heads are signed by default with a local Ed25519 signer unless the ledger is explicitly constructed with `signer: false`.
- `verifyProofEnvelope` verifies embedded signed-head material when a verifier manifest is present in proof material or supplied by the caller.

The old full-history recomputation path and `oldLeafHashes`/`newLeafHashes` consistency transcript are not current behavior.

## Reference Signals

| Reference | Relevant code | Takeaway |
| --- | --- | --- |
| transparency-dev/merkle | `proof/verify.go:46`, `proof/verify.go:99`, `compact/range.go:65` | Inclusion and consistency proof verification should be logarithmic and should reject invalid tree-size/proof-shape combinations. |
| Trillian | `log/sequencer.go:177`, `log/sequencer.go:276`, `client/log_verifier.go:57`, `client/log_verifier.go:82` | Sequencing appends leaves into a compact range, persists new nodes, stores signed roots, and verifies roots from trusted heads. |
| Rekor | `pkg/verify/verify.go:40`, `pkg/verify/verify.go:116`, `pkg/verify/verify.go:141` | Public clients verify consistency from a previous signed tree head and verify inclusion against a signed checkpoint. |
| Hypercore | `lib/merkle-tree.js:149`, `lib/verifier.js:58` | Signed Merkle roots need a stable verifier identity/manifest, not just a hash. |

## Storage Model

The implementation stores explicit ledger protocol objects:

| Object | Key | Contents |
| --- | --- | --- |
| `ledger/head-current` | singleton | Current `Ledger Head` with `size`, `rootHash`, `root`, `headId`, `previousHeadId`, `createdAt`, verifier manifest, and signatures when signing is enabled. |
| `ledger-leaf/<index>` | by sequence number | Persisted entry, leaf, fact CID/hash, leaf hash, event id, and timestamp. |
| `ledger-node/<level>-<index>` | by compact tree coordinates | Internal node hash plus left/right refs, child hashes, level, size, and creation metadata. |
| `ledger/compact-range-current` | singleton | Minimal perfect-subtree peaks for the current ledger size. |
| `ledger-head/<headId>` | by hash-bound id | Immutable head snapshots for proof bundle export and consistency verification. |
| `ledger-signer/default` | singleton when auto signing is enabled | Local Ed25519 signer material and verifier manifest. |

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

## Current Implementation

### Hasher And Proof Verifier

`ledgerLeafHash`, `ledgerNodeHash`, and `emptyTreeHash` remain in `src/ledger/transparency-log.js` and are exported through the package root. Verification accepts only the current audit-path proof shape and validates tree sizes, hash syntax, path direction, and complete path consumption.

### Leaves, Nodes, And Compact Range

`append` writes the fact block, the authoritative `ledger-leaf/<index>` protocol object, any newly formed `ledger-node/<level>-<index>` records, `ledger/compact-range-current`, `ledger/head-current`, and immutable `ledger-head/<headId>`. Durable load reads the compact range and current head instead of reconstructing authority from a full entry list.

`entries()` and `pageEntries({ start, limit })` remain inspection/read APIs. They read authoritative leaf records by index and fail closed if a required leaf is missing.

### Logarithmic Consistency Proofs

`createConsistencyProof(oldHead, newHead)` emits `ledger.consistency.audit-path` proof material containing only the RFC6962 audit path plus old/new head refs. Stored-node proof generation fetches required leaf and internal node hashes through `rangeRoot`; proof bundles for new writes do not include unrelated historical leaf hashes.

### Signed Heads

The ledger auto-generates a local Ed25519 signer and verifier manifest by default. `signer: false` is the explicit unsigned mode. Custom signers can inject signer id, public/private key material, and a verifier manifest. `verifyLedgerHeadSignature` verifies manifest id/hash binding, signer role, unique signer quorum, canonical head payload hash, algorithm, and Ed25519 signature bytes.

## API Changes

| API | Current behavior |
| --- | --- |
| `ledger.append(fact)` | Returns inclusion and consistency audit-path proofs. |
| `ledger.head()` | Returns current head with `headId` and optional `signatureRef`. |
| `ledger.getHead(id)` | Returns current or immutable historical heads for proof bundles and trusted-head advancement. |
| `ledger.verifyConsistency` | Verifies the audit-path consistency proof. |
| `verifyProofEnvelope` | Verifies ledger proofs and optional signed head material through the proof verifier registry. |

## Verification Coverage

| Test | Purpose |
| --- | --- |
| RFC6962 tree-shape tests | Prevent hash/path regressions across power-of-two and non-power-of-two ledger sizes. |
| Inclusion and consistency negative tests | Reject malformed hashes, impossible size pairs, tampered paths, empty-head bootstrap misuse, and forked histories. |
| Bundle leakage tests | Assert consistency proofs do not include historical leaf hash transcripts. |
| Missing authoritative leaf test | Assert proof generation and paging fail closed when required persisted leaf material is absent. |
| Signed-head tests | Verify valid manifest/signature material and reject wrong signer, wrong role, duplicate signer quorum, wrong root, and wrong payload. |

## Maintained Boundary

Because Pactium currently rejects historical data directories, no in-place migration is required. Existing test fixtures can be regenerated under the latest protocol profile.
