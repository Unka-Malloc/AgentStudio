# Pactium Algorithm Optimization Dossier

This directory records the code-level comparison between Pactium and mature reference implementations, plus the implementation status of the optimization pass. It is intentionally scoped to optimization direction, not to a rewrite proposal.

## Project Positioning

Pactium is a proof-first protocol substrate for LicoLite. The current maintained architecture makes the Operation Ledger the global ordering authority, uses shared verifiable indexes for derived views, exports Proof Envelopes and Proof Bundles as the user-facing receipt surface, and leaves side effects, policy, authorization, UI, and durable host evidence to LicoLite.

That means Pactium should not become a generic database, a full event-sourcing framework, or a distributed replication runtime. The right optimization direction is to make the existing proof substrate more compact, more independently verifiable, and more portable while preserving the host boundary.

## Documents

| Document | Purpose |
| --- | --- |
| [Reference Code Evidence](REFERENCE-CODE-EVIDENCE.md) | Downloaded repository commits, license boundaries, official docs, and inspected code paths. |
| [Algorithm Comparison](ALGORITHM-COMPARISON.md) | Historical baseline table comparing pre-optimization Pactium with Trillian, Rekor, Dolt, go-car, Hypercore, Axon, and immudb. |
| [Ledger Transparency Optimization](LEDGER-TRANSPARENCY-OPTIMIZATION.md) | A compact-range/RFC6962 plan for ledger append, inclusion, and consistency proofs. |
| [Verifiable Index Prolly Tree Optimization](VERIFIABLE-INDEX-PROLLY-TREE-OPTIMIZATION.md) | A plan to replace snapshot pairwise Merkle indexes with real content-defined Prolly nodes. |
| [Proof Bundle And Verifier Optimization](PROOF-BUNDLE-AND-VERIFIER-OPTIMIZATION.md) | A plan for registry-based proof verification, signed heads, and CAR-like bundle indexing. |
| [Operation Lifecycle And Host Boundary Optimization](OPERATION-LIFECYCLE-AND-HOST-BOUNDARY-OPTIMIZATION.md) | A plan for append conditions, tracking tokens, recovery cursors, and clearer LicoLite host contracts. |
| [Implementation Status](IMPLEMENTATION-STATUS.md) | Complete implementation status for this optimization pass. |

## Optimization Baseline And Current Status

| Area | Original baseline finding | Current status |
| --- | --- | --- |
| Ledger | Root and consistency proof work scaled with full leaf history. | Closed: compact-range persistence, stored proof-node fetching, audit-path inclusion/consistency proofs, page reads, and signed heads are implemented. |
| Verifiable index | Snapshot Merkle authority had no structural sharing and diff/mutation were O(n). | Closed: content-addressed Prolly leaf/internal nodes, path-local `put`/`delete`, bounded scan/prefix, and non-aligned shared-node diff are implemented. |
| Workspace state | State proof roots were rebuilt from `stateEntries` on every mutation. | Closed: `workspace.stateRoot` is authoritative, bootstraps once when empty, mutates incrementally, and is retained during in-memory compaction. |
| Proof verifier | Core envelope verification did not dispatch to embedded index proof verifiers. | Closed: registered proof verification covers workspace, state, checkpoint, idempotency, and lifecycle proofs. |
| Proof bundle | Bundle export was a JSON block array with no random-access index. | Closed: `exportProofBundle(envelopeOrId)` emits the indexed proof-bundle record stream. |
| Signatures/witness | No stable verifier manifest or public verification path existed in core. | Closed for local trust: ledger-head signer manifests, Ed25519 signing, verifier checks, and trusted-head advancement are implemented. Witness networks remain intentionally out of scope. |
| Lifecycle | Append conditions and tracking cursors were host-inferred. | Closed: append conditions, cursor helpers, recovery planning, and trusted-head advancement are implemented without moving host side effects into Pactium. |
| Repair/maintenance | Planner existed without an executor. | Still aligned by design: Pactium keeps deterministic repair planning and leaves host execution to LicoLite or the embedding application. |
