# 0057. Adopt Reference-Informed Algorithm Architecture

Date: 2026-06-28

Status: Accepted

## Context

Pactium had a separate optimization dossier under `docs/optimization` that compared the implementation with Trillian, Rekor, transparency-dev/merkle, Dolt, go-car, Hypercore, Axon Framework, and immudb. That material mixed architecture decisions, implementation status, reference evidence, and completion notes.

Maintained Pactium documentation should not keep report-style design records beside ADRs. Reference-informed architecture belongs in ADRs, while current user-facing behavior belongs in API, protocol, architecture, and LicoLite docs.

Pactium remains a proof-first protocol substrate for LicoLite. It is not a database, public transparency service, replication runtime, event-sourcing framework, or side-effect executor.

## Decision

Adopt the reference-informed algorithm architecture as accepted Pactium design:

1. The Operation Ledger uses RFC6962-style leaf and node domain separation, compact ranges, persisted leaves/nodes, audit-path inclusion proofs, audit-path consistency proofs, immutable heads, and signed Ledger Heads.
2. The shared Verifiable Index Engine uses content-addressed Canonical Prolly nodes. Index roots store metadata, while leaf and internal nodes live as CAS blocks with child refs.
3. Index mutation uses path-copying `put`, `delete`, and `mutate` operations. Scans, prefix queries, diffs, membership proofs, compact non-membership proofs, membership multiproofs, and range proofs traverse Prolly nodes instead of full-entry snapshots.
4. Proof Envelope verification dispatches embedded proof material through the default proof verifier registry, including ledger and index proof types.
5. Proof Bundles use the indexed record-stream format with offset metadata, required block closure, payload integrity checks, lazy required-block reads, and optional full archive verification.
6. Ledger Head signatures use verifier manifests, Ed25519 signer material, unique-signer quorum checks, signer validity windows, and revocation checks.
7. The operation lifecycle includes append conditions, distinct intent and outcome idempotency indexes, one terminal outcome per intent, tracking cursors, trusted-head advancement, and deterministic recovery planning.
8. LicoLite verification builds on core proof verification and continues to own host policy, authorization, durable evidence retention, side effects, and operator workflows.

## Reference Boundaries

| Reference | Adopted lesson | Boundary |
| --- | --- | --- |
| Trillian and transparency-dev/merkle | Compact transparency-log proofs and strict proof-shape validation. | Pactium does not run a distributed log service. |
| Rekor | Portable proof material, signed checkpoint thinking, and client-side verification layers. | Pactium does not provide Rekor's public service or signed entry timestamp ecosystem. |
| Dolt | Content-addressed ordered Prolly nodes, structural sharing, and changed-subtree diffing. | Pactium keeps protocol-defined canonical keys, splitter constants, and storage objects. |
| go-car | Indexed content-addressed archives with offsets, limits, and streaming-friendly verification. | Pactium bundles are CAR-like, not CARv1/CARv2 byte-compatible. |
| Hypercore | Signed append-only roots and verifier identity binding. | Pactium does not add replication, gossip, or witness networking. |
| Axon Framework | Append conditions, tracking positions, and replay-safe lifecycle boundaries. | Pactium does not become an event framework or host side-effect runtime. |
| immudb | Tamper-evident product posture and trusted-state advancement concepts. | immudb source is not a copyable implementation source for Pactium. |

## Verification

This architecture is covered by the release verification surface:

- RFC6962/RFC9162-style ledger vectors and malformed proof tests;
- Prolly node roots, canonical ordering, mutation write-bound tests, scan/prefix/diff tests, membership, compact non-membership, multiproof, and range proof tests;
- workspace state-root mutation and proof material verification tests;
- embedded proof tampering, semantic binding, missing verifier, and verifier exception tests;
- indexed proof-bundle layout, random access, required-block closure, corruption, and full-archive tests;
- append-condition, cursor paging, trusted-head advancement, signed-head, LicoLite evidence closure, idempotency, causality, and recovery planning tests.

The maintained verification command is `npm run verify:release`.

## Consequences

The standalone optimization dossier is removed. Future algorithm comparisons, reference audits, implementation status notes, or completion reports must update the relevant ADRs plus current protocol/API docs and tests instead of adding another report directory.

The accepted boundaries remain explicit: no witness network, no CAR/IPLD compatibility claim, no repair executor, no LicoLite side-effect execution, and no full event framework without new implementation, tests, and ADR updates.
