# 0056. Adopt Reference-Informed Proof Coverage Governance

Date: 2026-06-25

Status: Accepted

## Context

Pactium is the proof-first protocol substrate for LicoLite. The active product direction on `nightly` and `stable` is a small zero-dependency ESM package for verifiable operation facts, append-only recovery history, Prolly-backed indexes, proof envelopes, proof bundles, and the first-class `pactium/licolite` aspect.

Branch review found two historical product lines:

- `main` and the local `codex/*` branches retain older broad platform work: Rust client CLI, Flutter GUI, server runtime, web console, MCP connector, knowledge tooling, and large operational docs.
- `stable` and `nightly` are the maintained package line. `nightly` advances `stable` with proof hardening, crash/rebuild diagnostics, proof-size guards, HTTP read-only defaults, release gates, and broader regression coverage.

Maintained Pactium work must stay on the package line unless an ADR explicitly reopens the product scope.

## Reference Practices Adopted

| Reference | Adopted practice | Pactium boundary |
| --- | --- | --- |
| transparency-dev/merkle and Trillian | RFC6962-style leaf/node domain separation, strict inclusion and consistency proof shape validation, compact ranges, signed roots | Pactium remains a local package substrate, not a distributed log service. |
| Tessera | Tile-based transparency logs reduce operating cost for large deployed logs | Future reference only; no tile protocol is adopted in this ADR. |
| Sigstore Rekor | Portable proof material, signed checkpoint thinking, explicit trust policy | Pactium does not provide a public transparency service or SET ecosystem. |
| Dolt | Content-addressed Prolly nodes and structural sharing | Pactium keeps its protocol-defined splitter and canonical value model. Dolt-style cursor/path-copying and maximal skip-common-subtree diff remain deferred optimization work. |
| IPLD CAR / go-car | Content-addressed archive transport, indexed block access, size limits | Pactium proof bundles stay CAR-like, not CARv1/CARv2 byte-compatible. |
| Hypercore | Signed append-only roots and remote proof verification shaped by signer identity | Pactium implements signer manifests and signed heads without adding replication or gossip. |
| EventStore / Axon Framework | Append conditions, tracking positions, event lifecycle boundaries | Pactium records protocol facts and cursors; hosts own dispatch and side effects. |
| immudb | Client-side trusted-state advancement and tamper-evident product posture | Current source license is not suitable for code reuse; use only as conceptual comparison. |

## Existing Risks And Responses

| Risk | Current impact | Response |
| --- | --- | --- |
| State mutation proof coverage was sampled by default but docs implied bundle export could make verification full. | A verifier using `requireFullStateMutationProofs` could fail large operations even after bundle export. | Add explicit full state mutation proof generation through `proofOptions.stateMutationProofMode: "full"` or `fullStateMutationProofs: true`, and align API/FAQ/profile docs. |
| Proof material can grow when all mutated keys are proven. | Full mode may increase envelope and bundle size for large operations. | Keep sampled mode as default and reuse existing `maxProofLeafEntries`, `maxProofBytes`, and `failOnProofSizeWarning` guards. |
| Duplicate state mutations for one key can make per-mutation final-root proofs ambiguous. | A raw mutation trace can contain `put`/`delete` or repeated `put` entries for the same key, while proofs bind to the final state root. | State Commits prove unique touched keys and record each key's final net effect; repeated keys collapse to the last mutation for that key. |
| Commit marker coverage is lifecycle-only. | `storeEnvelope`, `createExtension`, and `exportProofBundle` may write blocks or runtime cache outside pending/complete lifecycle markers. | Keep the Unit-of-Work boundary explicit: commit markers cover lifecycle commits; materialization/cache writes remain recoverable but outside that boundary. |
| Local JSON write locks are best-effort filesystem coordination. | High-contention production deployments can still outgrow local lock semantics. | Preserve storage-port boundary; production hosts should use stronger backends or external lock managers without changing proof semantics. |
| HTTP adapter can be exposed without host controls. | Public deployment without auth/TLS could expose mutation or proof material endpoints. | Keep read-only default and `authorize(ctx)` hook; docs continue to classify it as host-controlled internal adapter. |
| Core protocol docs can drift from implementation. | Maintained docs may overstate implemented behavior. | Public behavior changes must update code, tests, TypeScript declarations, API/protocol docs, ADRs, affected package metadata, and release/readiness gates in the same change. |
| Tile/witness networks are useful but can expand product scope. | Premature adoption would add distributed-system obligations. | Treat Tessera/witnessing as future ADR material only. |

## Algorithm And Data Structure Direction

1. State mutation proof coverage now has two modes:
   - `sampled`: default bounded receipt mode; prove the first 32 unique touched keys in canonical key order.
   - `full`: strict audit mode; prove every unique touched key and mark `proofCompleteness: "full"`.
   - repeated keys in one State Commit collapse to the last mutation's final effect because these proofs bind to the final state root, not each intermediate mutation step.
2. The shared Verifiable Index Engine remains the only ordered proof index implementation.
3. Ledger compact ranges and signed heads remain the active transparency-log model.
4. Future large-log work should evaluate tile-backed proof distribution before changing the ledger protocol.
5. Future large-state work should evaluate compressed batch/range mutation proofs before making full per-key proofs the default.

## Design Pattern Evaluation

| Pattern | Apply? | Evaluation |
| --- | --- | --- |
| Strategy / Registry | Yes | The proof verifier registry reduces coupling between envelope verification and proof algorithms. It improves maintainability and vulnerability prevention by failing closed on unsupported critical proof types. |
| Port / Adapter | Yes | The storage port keeps proof semantics independent of the local JSON backend. It improves maintainability and allows stronger production storage without protocol churn. |
| Unit of Work | Yes, bounded | Pending/complete commit markers model lifecycle commits and improve crash diagnostics. They are not a full ACID transaction manager. |
| Command | Yes | Repair planner tasks encode deterministic host-owned actions without executing side effects in Pactium. |
| Policy Object | Yes | Append conditions and proof coverage modes make concurrency and audit expectations explicit data, not hidden control flow. |
| Observer / Witness | Deferred | Witnessing can improve split-view detection, but it adds distributed governance and should wait for a separate Tessera-informed ADR. |
| Singleton / Global State | Avoid | Protocol constants are fixed by profile, but mutable runtime state must stay instance-scoped to preserve concurrency safety and test isolation. |

## Decision

Adopt explicit proof coverage governance:

- Sampled state mutation proofs remain the default.
- Hosts can request full per-key proof generation for unique touched keys at write time.
- Verifiers can require full proof material independently.
- Documentation must describe generation and verification as separate decisions.
- Future reference-project lessons must enter Pactium through ADRs and release-gated tests, not through unstated implementation drift.

## Consequences

This keeps the default write path small while providing a strict audit path for hosts that need full mutation proof coverage. It also removes a documentation drift point and creates a clear place to evaluate future Tessera-style tile logs or compressed state proof schemes without expanding the package scope prematurely.
