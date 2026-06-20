# Algorithm Comparison

This comparison treats Pactium as a proof-first protocol substrate for LicoLite, not as a database, transparency service, replication feed, or event-sourcing framework. The table below describes the current implementation after the optimization pass; implementation status is tracked in [Implementation Status](IMPLEMENTATION-STATUS.md).

## Similarities And Differences

| Reference | Similarity to Pactium | Current Pactium boundary | Implemented lesson |
| --- | --- | --- | --- |
| Trillian | Both model an append-only transparency log with inclusion and consistency proofs. Pactium uses `0x00` leaf and `0x01` node domain separation. | Pactium is local package infrastructure, not a distributed log service. It persists compact ranges/nodes and signed heads, but does not run Trillian's server topology. | Compact RFC6962 proofs, stored compact ranges, and signed heads are implemented. |
| Rekor | Both produce portable proof material for append-only facts. | Pactium verifies Ledger inclusion, Ledger consistency, signed heads, and embedded proof material, but does not provide Rekor's public transparency service or signed entry timestamp ecosystem. | Verifier manifests and signed-head checks let offline recipients establish who signed a Ledger Head. |
| transparency-dev/merkle | Same RFC6962 proof model and hash prefixing. | Pactium owns its proof shape and structured failure model rather than reusing the Go library. | Ledger verification validates proof shape, index bounds, consistency semantics, and complete path consumption. |
| Dolt | Same data structure family: Prolly tree over ordered key/value entries. | Pactium uses protocol-defined key/value-derived boundaries, not Dolt's rolling splitter or storage engine. | Index roots point to content-addressed Prolly nodes, and mutation/diff use shared-node structure. |
| go-car | Both package content-addressed proof blocks for offline transport. | Pactium's bundle stream is CAR-like but not CARv1/CARv2 byte-compatible. Its CIDs and canonical codec are Pactium-specific. | Bundle export emits an indexed binary record stream with offsets, limits, duplicate control, and block integrity checks. |
| Hypercore | Both use append-only Merkle roots and proof material that can be verified remotely. | Pactium has manifest-bound Ed25519 Ledger Head signing and trusted-head advancement, but no built-in gossip, replication feed, or witness network. | Signed ledger heads and unique-signer quorum checks are implemented before any witness network is considered. |
| Axon Framework | Both care about operation lifecycle and replay-safe event history. | Axon is a broad event framework with append conditions, sourcing, streaming, tracking tokens, and conflict boundaries. Pactium intentionally does not own host dispatch or side effects. | Borrow lifecycle boundaries, append conditions, and tracking cursor concepts, not Axon's framework scope. |
| immudb | Both use cryptographic proof as a product primitive. | Pactium's current proof model combines Ledger proofs, Prolly index proofs, signed heads, and bundle verification rather than immudb's transaction proof model. Current immudb source is BUSL, so it is not a copyable code source. | Dual-proof ideas remain design inspiration only; current trusted-head advancement is implemented through Ledger consistency and signed heads. |

## Current Pactium Strengths

| Strength | Evidence | Why it should be preserved |
| --- | --- | --- |
| Clear protocol authority | `docs/architecture/ARCHITECTURE.md:21` and `docs/protocols/PROFILE.md:15` make the Operation Ledger the ordering authority. | Prevents derived workspace/state indexes from becoming hidden sources of truth. |
| Proof-first receipt shape | `src/core/pactium-core.js:162` creates envelopes and material refs during writes. | User-facing operations already return verifiable receipts, so improvements can be additive. |
| Shared index engine boundary | `docs/protocols/PROFILE.md:43` says one engine powers state, checkpoint, workspace, lifecycle, idempotency, and causality indexes. | A Prolly upgrade benefits every derived proof area at once. |
| Latest-schema-only boundary | `src/storage/local-json-storage-port.js:72` rejects historical layouts and schema mismatches. | Makes algorithm upgrades easier because no in-place historical migration is required. |
| Host boundary | `docs/architecture/ARCHITECTURE.md:27` separates Pactium protocol proofs from LicoLite policy/effects. | Avoids turning Pactium into an app framework or side-effect runtime. |

## Implementation Matrix

| Area | Original gap | Reference behavior | Current status |
| --- | --- | --- | --- |
| Ledger append | Append cost and persisted ledger objects grew with full history. | Trillian sequencer stores only affected nodes and signed roots while using compact ranges. | Closed: leaves, compact ranges, immutable heads, and compact tree nodes are persisted separately. |
| Ledger consistency | Consistency proof exposed full leaf-hash transcripts. | RFC6962 consistency proofs are logarithmic and reveal only audit hashes. | Closed: consistency proofs carry audit paths and stored-node fetching. |
| Ledger proof validation | Edge-case proof validation was under-specified. | transparency-dev/merkle rejects malformed lengths, impossible size pairs, and invalid consistency cases. | Closed: audit-path verification validates shape, bounds, path consumption, and trusted-head advancement. |
| Index mutation | Index mutation rebuilt full snapshots. | Dolt chunker mutates ordered trees while reusing unchanged chunks. | Closed: `put`/`delete` rewrite a canonical local leaf window, reuse unchanged leaves, and rebuild parent levels from leaf descriptors so incremental roots match full rebuild roots. |
| Index chunking | Chunk boundaries were metadata over a full snapshot. | Dolt splitters create actual content-addressed nodes. | Closed: index roots point to content-addressed Prolly leaf/internal nodes. |
| Index diff | Diff compared full snapshots. | Dolt diff walks cursors and skips shared equal subtrees. | Closed: diff skips equal roots, merges non-aligned child ranges, descends overlap groups, and compares entries at leaf level. |
| Workspace state root | State mutations rebuilt the full state index from materialized entries. | Prolly-style mutation should update the authoritative root incrementally. | Closed: `workspace.stateRoot` is authoritative, bootstraps once, mutates incrementally, and is retained through compaction. |
| Non-membership proof | Proofs relied on nearest-key membership material. | Prolly/B-tree style proofs include node ranges and boundary keys from the path. | Closed: membership and non-membership Prolly-path proofs include containing leaf and path descriptors. |
| Envelope verification | Embedded index proofs were not verified by core envelope verification. | Rekor and Hypercore verify remote proof material and signer roots. | Closed: proof registry verification covers embedded proof material recursively. |
| LicoLite verification | Workspace projection checks were not deeply bound to core proof verification. | References bind each claimed proof to a verifier path or signed root. | Closed: LicoLite verification depends on canonical extension decoding and core registry proof checks. |
| Bundle export | Bundles were JSON block arrays without a random-access index. | CAR-style indexed archives keep data offsets, indexes, limits, and streaming readers. | Closed: export emits the indexed proof-bundle record stream. |
| Signing | Core lacked durable verifier manifests and public-key head checks. | Rekor and Hypercore bind verification to public-key checkpoints/manifests. | Closed for local/public-key verification: verifier manifests, Ed25519 head signing, and trusted-head advancement are implemented. |
| Canonical value | Pactium's canonical sorted JSON codec was not CAR/IPLD byte-compatible. | CAR/IPLD ecosystems expect multiformat CIDs and binary block codecs. | Deliberate boundary: Pactium keeps its canonical codec; full CAR/IPLD interoperability remains a future, separate encoding decision. |
| Lifecycle cursors | Hosts inferred append conflicts and recovery cursors. | Axon exposes source/stream APIs, append conditions, and tracking tokens. | Closed within Pactium scope: append conditions, cursor helpers, and recovery planning are implemented while side effects remain outside Pactium. |

## Implemented Direction

1. Ledger compact ranges, logarithmic proofs, signed heads, and RFC6962 negative tests are implemented.
2. Verifiable indexes use content-addressed Prolly nodes, canonical local leaf-window mutation, bounded scan/prefix, and shared-node diff.
3. Envelope verification dispatches to registered proof verifiers for embedded proof material.
4. Proof bundles use indexed record streams with strict size, offset, duplicate, and block-integrity checks.
5. Signer manifests and public-key ledger-head signatures are implemented; witness networks remain out of scope.
6. Append conditions and tracking cursors are implemented while dispatch and side effects remain in LicoLite or the host.
