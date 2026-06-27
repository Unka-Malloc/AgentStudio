# 0058. Adopt Verification Hot-Path Optimizations

Date: 2026-06-28

Status: Implemented

## Context

The algorithm optimization pass identified repeated work in Pactium verification hot paths. The affected request and module flows are:

- request flow: `recordOperation` and `exportProofBundle` produce Proof Envelopes and Proof Bundles; `verifyProofEnvelope`, `verifyProofBundle`, and `verifyLicoLiteBundle` verify them.
- data flow: proof refs, extension refs, signed heads, Prolly proof material, and bundle blocks move through content-addressed storage or indexed bundle resolvers.
- computation flow: core envelope validation dispatches embedded proofs through the verifier registry, then LicoLite verification adds policy, effect, and signature checks.
- state transition flow: ledger heads, index roots, workspace projection roots, state roots, checkpoint roots, lifecycle indexes, idempotency indexes, and causality indexes bind facts to append-only state.
- plugin and module dispatch flow: `pactium/licolite` builds on core proof verification instead of replacing it.

The relevant modules and functions are:

- `src/proof/envelope.js`: `verifyProofEnvelope`, `verifyEmbeddedProofs`.
- `src/aspects/licolite/aspect.js`: `verifyLicoLiteEnvelope`, `verifyLicoLiteBundle`.
- `src/ledger/signed-head.js`: `verifyLedgerHeadSignature`.
- `src/index-engine/snapshot-merkle-index.js`: `verifyMembershipMultiproof`, `verifyRangeProof`, `diffChildDescriptors`.
- `src/proof/bundle.js`: `verifyProofBundle`.
- `src/proof/bundle-format.js`: `createIndexedBundleResolver`, `bundleHashIndexForResolver`.

Before this ADR, hot paths contained avoidable repeated computation:

- duplicate core envelope verification during LicoLite bundle verification;
- repeated extension scans for critical, required, evidence, and signature extensions;
- repeated canonical decoding of the same extension material by CID;
- repeated signer and revocation scans for every ledger-head signature;
- repeated Prolly path verification and leaf scanning in membership multiproofs;
- repeated range-proof path expansion and matching-entry filtering;
- repeated diff overlap-group filtering;
- repeated bundle index projection for bundle hash calculation after resolver setup.

These costs were CPU and allocation issues, not proof semantic defects. The optimization target is lower complexity and lower hot-path allocation while preserving proof formats, failure semantics, append ordering, and storage clone boundaries.

## Decision

Adopt call-scoped lookup indexes, memoization, and resolver-owned precomputation for verifier hot paths.

| Area | Decision |
| --- | --- |
| LicoLite bundle verification | `verifyLicoLiteBundle` reuses the bundle verifier's resolver and already verified envelope result instead of repeating core envelope verification. |
| Proof bundle resolver reuse | `verifyProofBundle` accepts a caller-supplied bundle resolver so layered verifiers can share indexed bundle block lookup. |
| Proof bundle hash materialization | `createIndexedBundleResolver` precomputes the bundle-hash index view during its existing `bundle.index` walk. `verifyProofBundle` reuses it only when an internal WeakMap proves the resolver belongs to the same bundle object. |
| Proof envelope verification | Critical extension validation builds one extension-name index before checking required critical extensions. |
| Embedded proof traversal | Recursive proof traversal tracks visited object identities per call to avoid dispatching the same shared proof object repeatedly. |
| LicoLite envelope verification | Required, evidence, and signature extension checks use a per-call extension-name index and decoded-material cache keyed by CID. |
| Signed-head verification | Signer and revocation lists are indexed once per verification call, and the canonical signed payload hash is computed once. |
| Membership multiproof verification | Each Prolly leaf path is verified once, then entries are indexed by key for requested-key checks. |
| Range proof verification | Expanded paths, normalized entries, and matching entries are cached per leaf record during one verification call. |
| Index diff grouping | Overlap groups are split in one pass instead of filtering the same group twice. |

All new caches are call-scoped or resolver-scoped:

- verifier lookup maps and decoded-material maps are discarded at the verification call boundary;
- recursive traversal uses a per-call `WeakSet`;
- bundle resolver metadata, payload, and hash-index caches are scoped to one immutable resolver;
- no cache retains mutable caller input across requests;
- no module-level mutable verifier state is introduced.

The decision does not change public proof material shape, bundle format, trust-policy behavior, failure codes, append ordering, or host responsibilities.

## Complexity Impact

| Function | Before | After |
| --- | ---: | ---: |
| `verifyLedgerHeadSignature` | O(S*(N+R)) | O(N+R+S) |
| `verifyProofEnvelope` critical extension checks | O(E*C) | O(E+C) |
| `verifyEmbeddedProofs` shared object traversal | O(references to same object) verifier dispatches | O(distinct object identities) verifier dispatches |
| `verifyLicoLiteEnvelope` extension checks | O(E*checks) | O(E+checks) |
| LicoLite material decode by CID | O(uses * decode) | O(uniqueCids * decode + uses) |
| `verifyLicoLiteBundle` | bundle verification plus duplicate core envelope verification | bundle verification plus LicoLite checks |
| `verifyMembershipMultiproof` | O(keysPerLeaf*(leaf+path)) | O(leaf+path+keysPerLeaf) |
| `verifyRangeProof` | O(leaves*(leaf+2*path)) | O(leaves*(leaf+path)) |
| `diffChildDescriptors` overlap group split | O(group) with duplicate filter allocations | O(group) single split |
| `verifyProofBundle` bundle hash index projection | O(index) extra map after resolver setup | O(1) reuse after resolver precompute |

The ledger append lane, storage write lanes, durable page reads, and clone-on-read storage boundaries are intentionally unchanged. They are correctness and ordering boundaries rather than local algorithmic inefficiencies.

## Implementation Scope

Code changes:

- `src/aspects/licolite/aspect.js`
- `src/index-engine/snapshot-merkle-index.js`
- `src/ledger/signed-head.js`
- `src/proof/bundle-format.js`
- `src/proof/bundle.js`
- `src/proof/envelope.js`

Documentation and governance changes:

- `docs/adr/0058-adopt-verification-hot-path-optimizations.md`

Related architecture consolidation:

- `docs/adr/0057-adopt-reference-informed-algorithm-architecture.md` moves the removed optimization dossier into ADR-backed design governance.

## Risk Analysis

| Risk | Analysis | Mitigation |
| --- | --- | --- |
| Correctness | Map-backed lookup must not accept unproven extension, signer, leaf, or bundle material. | Maps are built from the same validated input arrays. Multiproof still verifies each leaf path to the declared root before key lookup. |
| Concurrency | Caches could become stale if shared across requests. | All verifier caches are function-local. Bundle resolver precomputation is tied to a resolver object and bundle identity. |
| Memory | Extra maps add short-lived allocations for small inputs. | The maps replace repeated scans on hot paths and are discarded at call end. Bundle hash index is built during resolver setup, replacing a later duplicate projection. |
| Regression | Failure ordering or duplicate diagnostics could change. | Existing failure construction remains in the same validation phases. Full unit tests cover malformed envelopes, bundles, signatures, index proofs, and LicoLite failures. |
| Resolver spoofing | A caller-supplied resolver could try to influence bundle hash verification. | `bundleHashIndexForResolver` returns precomputed index data only for resolver objects recorded by `createIndexedBundleResolver` against the same bundle identity. Otherwise `verifyProofBundle` falls back to direct `bundle.index` projection. |

## Validation

Correctness validation:

```text
npm test
```

Result on 2026-06-28:

```text
tests 141
pass 141
fail 0
duration_ms 26862.4285
```

Current quality profile sample:

| Profile | Operations | p50 | p95 | p99 | Throughput |
| --- | ---: | ---: | ---: | ---: | ---: |
| `api:index-engine` | 1000 | 0.3950 ms | 0.7053 ms | 0.7945 ms | 3902.52/s |
| `api:proof-bundle` | 30 | 10.6955 ms | 18.8376 ms | 18.8613 ms | 89.71/s |
| `api:licolite-record` | 30 | 7.6953 ms | 16.2586 ms | 16.4643 ms | 117.40/s |

Bundle hash index reuse microbenchmarks:

| Case | Index entries | Iterations | Mapped index hash | Resolver index hash | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Real exported bundle | 2 | 20000 | 506.4472 ms | 505.1629 ms | -0.25% |
| Synthetic bundle hash path | 1000 | 5000 | 3891.9298 ms | 3860.9111 ms | -0.80% |

The real exported bundle benchmark shows the expected near-neutral result for tiny indexes. The synthetic case isolates the avoided rematerialization path for large bundle indexes. These microbenchmarks support the allocation decision but do not replace the release gate.

## Rollback Strategy

Rollback does not require data migration because this ADR does not change protocol formats, storage layouts, or public proof APIs.

Each optimization unit can be reverted independently:

- remove resolver-owned bundle hash index reuse and return to direct `bundle.index.map`;
- remove caller-supplied bundle resolver reuse in layered verifiers;
- replace per-call lookup maps with array scans;
- remove decoded-material and range-path caches;
- remove the `WeakSet` guard in recursive proof traversal;
- return `verifyLicoLiteBundle` to independent core and LicoLite envelope verification;
- restore per-key multiproof path verification if a proof binding regression is found.

## Preserved Boundaries

The following costs are intentionally not optimized by this ADR:

- JSON and SQLite storage clone-on-read boundaries, which protect against caller mutation;
- the single Ledger append lane, which remains the ordering authority;
- serial durable ledger page reads, which preserve deterministic failure behavior for local JSON storage;
- full bundle layout sorting during full archive verification, which supports overlap and gap diagnostics;
- diagnostic full scans in `doctor`, which need a separate storage-level pending/complete index decision;
- `recordOperations` stepwise fallback, which preserves idempotency, state mutation, and causality semantics.

## Consequences

Future verifier optimization reports must become ADR updates or new ADRs. They must include the affected complexity class, verification evidence, cache invalidation boundary, and any preserved correctness boundary.

Any optimization that changes proof semantics, failure shape, or public bundle/envelope format requires protocol docs, API docs, tests, and fixtures to change in the same review.

## Status

Implemented. Unit tests pass, current quality profiles complete, and bundle hash index reuse has isolated microbenchmark coverage.
