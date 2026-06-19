# Reference Code Evidence

This file records the external code and official documentation used for the Pactium algorithm comparison. Repositories were downloaded under `/tmp/pactium-reference-repos` and inspected directly on 2026-06-19. The Pactium anchors below are the optimization baseline captured before the implementation pass; current status is tracked in [Implementation Status](IMPLEMENTATION-STATUS.md).

## Downloaded Repositories

| Reference | Commit | License status observed | Why it matters for Pactium | Inspected anchors |
| --- | --- | --- | --- | --- |
| google/trillian | `c8c9830b66b024574cce7b32b11ac7d7271b578e` | Apache-2.0 in `LICENSE` | Production transparency log sequencing, compact ranges, signed roots, proof fetching. | `client/log_verifier.go`, `log/sequencer.go`, `server/proof_fetcher.go` |
| sigstore/rekor | `4e6fd6005a6c006c3f0bc644df9bb9b1b0bd1128` | Apache-2.0 in `LICENSE` | Public transparency API patterns, checkpoint signature verification, SET verification. | `pkg/verify/verify.go`, `pkg/api/entries.go`, `pkg/trillianclient/trillian_client.go` |
| transparency-dev/merkle | `2acfad1ae6a2355431e0056c309f5d501d389d72` | Apache-2.0 in `LICENSE` | Clean RFC6962 inclusion, consistency, and compact range algorithms. | `rfc6962/rfc6962.go`, `proof/verify.go`, `compact/range.go` |
| dolthub/dolt | `b23cc550534b29b209cfe73caab3dd60b4b0345c` | Apache-2.0 in `LICENSE` | Mature Prolly tree implementation, content-defined chunking, cursor diff. | `go/store/prolly/tree/chunker.go`, `node_splitter.go`, `node.go`, `node_store.go`, `diff.go` |
| ipld/go-car | `f2954894fd02f56f4a85a279e203a6bfce9842d1` | Apache-2.0 OR MIT in `LICENSE.md` | Portable content-addressed block bundling, offsets, indexes, limits. | Archive writer, indexed archive generator, options, and block reader files. |
| holepunchto/hypercore | `c2ee97eac2b7047e4a5ca7a12a2180e0013dfd50` | MIT in `LICENSE` | Signed append-only feeds, Merkle roots, remote proof verification, signer manifests. | `lib/merkle-tree.js`, `lib/session-state.js`, `lib/verifier.js`, `lib/fully-remote-proof.js` |
| AxonFramework/AxonFramework | `d4979e1c4f60862298232449cc2532b445eb90fa` | Apache-2.0 in `LICENSE.txt` | Operation lifecycle boundaries, append conditions, event sourcing, streaming tokens. | `eventsourcing/.../EventStore.java`, `EventStorageEngine.java`, `DefaultEventStoreTransaction.java`, `GapAwareTrackingToken.java` |
| codenotary/immudb | `acc971e6d45a7cc6baa984f3612e06104dc631d2` | Business Source License 1.1 in `LICENSE`; current source headers also show BUSL. | Useful public-source algorithm reference for dual proofs and linear plus tree verification. Do not copy code into Pactium. | `embedded/ahtree/verification.go`, `embedded/store/verification.go`, `embedded/store/immustore.go`, `pkg/verification/verification.go` |

## Official Documentation Cross-Checks

| Source | URL | Cross-check used |
| --- | --- | --- |
| Trillian transparent logging guide | https://google.github.io/trillian/docs/TransparentLogging.html | Confirms Trillian generalizes certificate transparency to arbitrary append-only data and uses inclusion proofs plus signed root promises. |
| Sigstore Rekor overview | https://docs.sigstore.dev/logging/overview/ | Confirms Rekor is an append-only tamper-resistant transparency log that exposes verifiable inclusion material. |
| Dolt Prolly tree docs | https://www.dolthub.com/docs/architecture/storage-engine/prolly-tree/ | Confirms Dolt uses content-addressed Prolly trees for ordered maps, structural sharing, and efficient diff. |
| CAR specification | https://ipld.io/specs/transport/car/ | Confirms CAR is a content-addressed archive format for DAG blocks, including offset/index capabilities. |
| Hypercore README | https://github.com/holepunchto/hypercore/blob/main/README.md | Confirms Hypercore is a secure distributed append-only log. |
| Axon Framework reference | https://docs.axoniq.io/axon-framework-reference/4.12/ | Confirms Axon is an event-driven framework around DDD, CQRS, and event sourcing. |
| immudb README | https://github.com/codenotary/immudb | Used only to understand product positioning; current repository license makes it unsuitable for code reuse. |

## Pactium Baseline Anchors

| Pactium area | Baseline implementation anchors | Evidence summary |
| --- | --- | --- |
| Architecture and intent | `docs/architecture/ARCHITECTURE.md:1`, `docs/protocols/PROFILE.md:1`, `docs/protocols/PROTOCOLS.md:1` | Pactium is proof-first, LicoLite-oriented, latest-schema-only, and host-owned for runtime policy/effects. |
| Ledger | `src/ledger/transparency-log.js:7`, `src/ledger/transparency-log.js:25`, `src/ledger/transparency-log.js:87`, `src/ledger/transparency-log.js:149` | Leaf/node prefixes match RFC6962 style, but roots and consistency proofs are rebuilt from full leaf hash arrays. |
| Index | `src/index-engine/snapshot-merkle-index.js:20`, `src/index-engine/snapshot-merkle-index.js:71`, `src/index-engine/snapshot-merkle-index.js:112`, `src/index-engine/snapshot-merkle-index.js:259` | Pairwise Merkle layers over full snapshots; chunk boundaries are metadata only; mutation and diff rebuild/scan full snapshots. |
| Core lifecycle | `src/core/pactium-core.js:224`, `src/core/pactium-core.js:327`, `src/core/pactium-core.js:494` | Intent/outcome lifecycle, idempotency replay, one terminal outcome per intent. |
| Proof envelope | `src/proof/envelope.js:91`, `src/proof/envelope.js:197`, `src/proof/envelope.js:229` | Verifies envelope identity, proof refs, extensions, ledger inclusion, and ledger consistency. It does not verify embedded index proofs. |
| Proof bundle | `src/core/pactium-core.js:563`, `src/proof/bundle.js:6` | Exports direct proof/extension refs and walked blocks as JSON; verifies required direct blocks and delegates to envelope verification. |
| Storage | `src/storage/local-json-storage-port.js:103`, `src/storage/local-json-storage-port.js:153`, `src/storage/local-json-storage-port.js:175` | JSON CAS records, DFS by `refs`, protocol objects, latest-schema-only directory boundary. |
| LicoLite | `src/aspects/licolite/aspect.js:56`, `src/aspects/licolite/aspect.js:89`, `src/aspects/licolite/aspect.js:146` | Production evidence policy, critical extensions, default signing, LicoLite-level verifier. |
| Canonical encoding | `src/canonical/value.js:4`, `src/canonical/value.js:29`, `src/canonical/value.js:33` | Deterministic normalized JSON bytes with `$bytes` base64, not a binary DAG-CBOR codec. |

## License Boundary

Only Apache-2.0, MIT, or dual Apache-2.0/MIT projects above should be considered as implementation references for code structure or tests. The immudb repository was inspected for algorithm comparison only because the checked-out source is Business Source License 1.1. Any Pactium implementation work must rederive ideas from public specifications or permissively licensed sources, not copy immudb code.
