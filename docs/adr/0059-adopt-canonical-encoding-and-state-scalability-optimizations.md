# 0059. Adopt Canonical Encoding and State Scalability Optimizations

Date: 2026-07-11

Status: Superseded by ADR-0060, ADR-0061, and ADR-0062

## Context

ADR-0058 optimized verifier hot paths with call-scoped lookup indexes and memoization. A follow-up algorithm and data-structure audit found the remaining dominant costs below the verifier layer, in the encoding substrate and in runtime state growth:

- computation flow: every hash, CID, proof node, and storage block passes through canonical value encoding. The previous encoder normalized values into intermediate object trees, stringified them with `JSON.stringify` and a replacer, and re-encoded through `TextEncoder`, allocating several intermediate representations per value.
- hashing flow: protocol hashing concatenated domain-prefix and payload buffers with `Buffer.concat` before every digest, allocating one merged buffer per hash.
- ledger flow: the transparency log kept an unbounded in-memory `entries` array that no read path used, an unbounded `eventIndex` map, and recomputed `rangeRoot` subtree hashes from storage on every consistency and inclusion proof.
- state transition flow: core runtime state stored every full Proof Envelope in `state.envelopes` and every exported Proof Bundle in `state.proofBundles`. Each `saveState()` serialized all accumulated envelopes and bundles again, so total write cost grew quadratically with operation count, and memory grew without bound.
- verification flow: the Verifiable Index Engine re-canonicalized and re-hashed node payloads that verifiers had already finalized, and `validateLeafNodePayload` compared normalized entries against themselves, weakening the anti-malleability guarantee that raw stored leaf entries must already be canonical.

The relevant modules and functions are:

- `src/canonical/value.js`: `normalizeCanonicalValue`, `canonicalString`, `canonicalEncode`.
- `src/protocol/hashing.js`: `protocolHash`, `cidForCanonical`.
- `src/ledger/transparency-log.js`: `appendEntry`, `rangeRoot`, `entryByEventId`.
- `src/index-engine/snapshot-merkle-index.js`: `validateLeafNodePayload`, `verifyNodePayload`, boundary hash computation.
- `src/core/pactium-core.js` and `src/core/state-helpers.js`: envelope registry, proof bundle export, state normalization.
- `src/proof/envelope.js`: extension signing payloads, envelope identity payloads, compact proof material descriptor tables.

These are throughput, allocation, and scalability issues. One finding is a correctness regression: the vacuous leaf-entry canonicality check. The optimization target is lower encoding cost, bounded memory, linear total write cost, and restored strict leaf validation, while preserving canonical byte output, proof formats, failure semantics, append ordering, and storage clone boundaries.

## Decision

Adopt a single-pass canonical serializer, incremental protocol hashing, bounded proof-side caches, a CID-backed envelope registry, and strict raw-entry canonicality validation.

| Area | Decision |
| --- | --- |
| Canonical serialization | `canonicalString` serializes in one pass with direct string building instead of normalize-then-`JSON.stringify`. `canonicalEncode` returns a `Buffer` produced directly from the canonical string. Validation, NFC normalization, safe-integer checks, `-0` folding, `undefined` filtering, and sorted object keys are preserved byte-for-byte. |
| Protocol hashing | `protocolHash` and `cidForCanonical` feed the domain prefix and payload to the hash incrementally instead of allocating a concatenated buffer. Domain prefix buffers are cached per domain string. |
| Ledger entry retention | The transparency log no longer keeps an in-memory array of all appended entries. Entries live in storage; reads go through storage or bounded caches. |
| Ledger event index | `eventIndex` is a bounded LRU map. Misses fall back to the storage scan that already existed for cold lookups. |
| Ledger range roots | `rangeRoot` results are memoized in a bounded LRU cache keyed by range. `reload()` clears the cache, so storage corruption checks and external mutation still surface on fresh reads. |
| Index engine boundary hashes | Boundary hash computation uses a bounded LRU cache keyed by canonical boundary content. |
| Index engine finalized-payload verification | `verifyNodePayload` is split so proof verifiers that already hold a finalized payload call `verifyFinalizedNodePayload` and skip redundant re-canonicalization and re-hashing. |
| Leaf anti-malleability | `validateLeafNodePayload` validates raw stored entries with `rawEntryIsCanonical`, a strict shape comparison between the raw entry and its normalized form. Non-canonical raw entries are rejected instead of being normalized into acceptance. |
| Envelope registry | `state.envelopes` maps envelope id to the envelope's block CID. Envelope reads resolve the block from content-addressed storage. Replay paths resolve by CID instead of re-reading full objects from state. |
| Proof bundle export | `exportProofBundle` is a pure read. It builds the bundle from storage under `prepareRead` and does not write bundles into runtime state. `state.proofBundles` is removed. |
| Envelope payload normalization | Extension signing payloads and envelope identity payloads pass values directly to hashing, which canonicalizes internally. Compact proof material descriptor tables normalize a descriptor only when it first enters the table. |
| Shared LRU utility | `src/shared/lru-cache.js` owns the bounded LRU `cacheGet`/`cacheSet` helpers used by the ledger and index engine caches. |

Cache and state boundaries:

- all new caches are instance-scoped to one ledger or index engine and bounded by explicit limits;
- `reload()` and snapshot loading clear or bypass caches so verification against storage stays authoritative;
- the envelope registry stores only CIDs; envelope content remains content-addressed and immutable;
- `compactStorage` retains immutable evidence blocks, including `proof-envelope`, so replay and envelope resolution keep working after compaction;
- no module-level mutable state is introduced; the domain prefix cache holds only immutable derived buffers keyed by domain constants.

The decision does not change canonical byte output, protocol hash values, CIDs, public proof material shape, bundle format, failure codes, append ordering, or host responsibilities. Removing `state.proofBundles` changes only runtime state layout, which is internal to the current verifiable schema; persisted proof material remains content-addressed blocks.

## Complexity Impact

| Function | Before | After |
| --- | ---: | ---: |
| `canonicalString` / `canonicalEncode` | multi-pass: normalize tree + `JSON.stringify` replacer + `TextEncoder` re-encode | single pass string build + one `Buffer.from` |
| `protocolHash` / `cidForCanonical` | O(prefix+payload) extra `Buffer.concat` allocation per hash | incremental digest, no merged buffer |
| Ledger memory for appended entries | O(total appends) resident | O(1) resident (storage-backed) |
| `entryByEventId` | O(total appends) map growth | bounded LRU + storage fallback |
| `rangeRoot` on repeated proof queries | O(log n) storage reads per call | O(1) on cache hit, bounded cache |
| Total state write cost over N operations | O(N²) (all envelopes and bundles re-serialized per save) | O(N) (CID registry, no bundle state) |
| Runtime state memory for envelopes/bundles | O(total envelopes + total exported bundles) | O(total envelope CIDs) |
| Verifier node payload checks | re-canonicalize + re-hash finalized payloads | verify finalized payload once |

The ledger append lane, storage write lanes, durable page reads, and clone-on-read storage boundaries remain intentionally unchanged, as recorded in ADR-0058.

## Implementation Scope

Code changes:

- `src/canonical/value.js`
- `src/protocol/hashing.js`
- `src/ledger/transparency-log.js`
- `src/index-engine/snapshot-merkle-index.js`
- `src/core/pactium-core.js`
- `src/core/state-helpers.js`
- `src/proof/envelope.js`
- `src/http.js`
- `src/shared/lru-cache.js` (new)

Documentation changes:

- `README.md`, `docs/API.md`, `docs/architecture/ARCHITECTURE.md`: `exportProofBundle` documented as a pure read; commit marker coverage wording updated.
- `docs/adr/0059-adopt-canonical-encoding-and-state-scalability-optimizations.md`

Test changes:

- `tests/pactium/proof-first-api.test.mjs`: canonical value edge branches (byte inputs, `$bytes` reservation, unsupported types), envelope resolution missing-block failure, multiproof and internal-node anti-malleability tampering, LRU eviction behavior.

## Risk Analysis

| Risk | Analysis | Mitigation |
| --- | --- | --- |
| Canonical byte drift | A serializer rewrite could change canonical bytes and break every hash and CID. | The serializer preserves the exact prior output rules. Protocol proof vectors and golden fixtures in `verify:protocol:gates` pin canonical bytes, hashes, and CIDs. |
| Anti-malleability strictness | Stricter raw-entry validation could reject previously accepted stored nodes. | Only non-canonical raw entries are rejected, which the protocol already forbids; canonical writers are unaffected. Tamper tests cover reordered entries, widened ranges, and unsorted children. |
| Cache staleness | Range-root or event-index caches could mask storage corruption or external mutation. | Caches are bounded, instance-scoped, and cleared on `reload()`. Corruption tests reload before asserting fresh-read failures. |
| Envelope resolution failure | Storing CIDs instead of envelopes makes envelope reads depend on block presence. | `resolveEnvelopeById` fails loudly with a missing-block error. Compaction retains `proof-envelope` blocks. A regression test prunes blocks and asserts the failure shape. |
| Replay behavior | Replay previously read envelopes from state; now it resolves by CID. | Replay tests and crash-consistency tests cover intent and outcome replay after restart. |
| Bundle export semantics | Hosts may have relied on `state.proofBundles`. | The bundle export API returns the same bundle material. HTTP route classification for `/bundles/export` stays mutation-gated for host capability control, documented in `src/http.js`. |

## Validation

Correctness validation:

```text
npm test
```

Result on 2026-07-11: 143 tests, 143 pass, 0 fail; coverage 96%+ lines, 90.01% branches, meeting the 95/95/90 gate in `docs/QUALITY-GATES.md`.

Protocol gates (`npm run verify:protocol:gates`) pin canonical encoding, protocol hashes, CIDs, ledger roots, index roots, and proof vectors, proving the serializer rewrite is byte-identical.

Canonical encoding microbenchmark (10k mixed-shape values, local sample): single-pass serializer completes in roughly one third of the previous normalize-plus-stringify time, with materially fewer allocations. Microbenchmarks support the decision but do not replace the release gate.

## Rollback Strategy

Rollback does not require data migration for encoding, hashing, ledger, or index engine changes because canonical bytes, protocol formats, and storage layouts are unchanged.

Each optimization unit can be reverted independently:

- restore the normalize-then-stringify canonical pipeline;
- restore `Buffer.concat` hashing;
- restore the unbounded event index and per-call range-root recomputation;
- remove boundary hash caching and the finalized-payload verification split;
- restore full-envelope storage in `state.envelopes` and bundle storage in `state.proofBundles` (state schema change; the current verifiable schema would need its normalization updated in the same change);
- inline the LRU helpers back into their call sites.

The strict `rawEntryIsCanonical` check is a correctness restoration, not an optimization, and must not be rolled back.

## Preserved Boundaries

The following remain intentionally unchanged:

- JSON and SQLite storage clone-on-read boundaries;
- the single Ledger append lane and the mutation lane as ordering authorities;
- serial durable ledger page reads;
- WAL commit marker semantics and crash-consistency behavior;
- proof material shapes, bundle format, and trust-policy behavior.

## Consequences

Encoding-layer or state-layout optimization reports must become ADR updates or new ADRs, including affected complexity class, verification evidence, cache invalidation boundary, and preserved correctness boundaries.

Any future change that reintroduces per-operation growth into runtime state must justify why a content-addressed reference does not suffice.

## Status

Implemented. Unit tests, coverage gates, and protocol proof-vector gates pass on the optimized implementation.
