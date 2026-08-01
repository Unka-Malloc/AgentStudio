# Pactium Protocols

Pactium is the current proof-first protocol substrate. The glossary is maintained in [Terms](../TERM.md), and the approved protocol parameter matrix is [Protocol Profile](./PROFILE.md).

The protocol is host-neutral. Meshrix is an independent downstream framework using the public package contract; host governance and product semantics do not enter Pactium protocol namespaces.

## Operation Ledger

The Operation Ledger is the global ordering authority for Pactium protocol facts. It uses a dedicated Ledger Transparency Log to produce verifiable Ledger Heads, inclusion proofs, and consistency proofs.

Operation lifecycle is append-only:

- `Operation Intent` records the intended operation.
- `Operation Outcome` records the terminal result.
- `Operation Receipt` records a terminal `receipt` or `on-change` profile without an open intent.
- `Open Intent Index` and `Outcome Index` make lifecycle recovery and lookup verifiable.
- `Intent Idempotency Index` and `Outcome Idempotency Index` make retries recover existing facts rather than append duplicates.
- `Receipt Index`, replay locators, and change claims make repeated or unchanged receipts write-free.

## Workspace Projection

Workspace Projection is updated synchronously for workspace-scoped lifecycle facts and is bound by global Ledger entries.

Workspace Projection uses two Verifiable Index Engine-backed indexes:

- `Workspace Order Index` maps workspace-local order to ledger event references.
- `Workspace Membership Index` maps ledger event identifiers to workspace-local membership material.

Workspace Projection currently includes workspace-scoped Operation Intents and Operation Outcomes. The current package does not append Repair Facts. Projection membership is logical proof data, not authentication, tenant isolation, or access control.

## Verifiable Index Engine

Pactium uses one shared Canonical Prolly Tree based Verifiable Index Engine for ordered-key indexes that need stable roots, structural sharing, path-copying mutations, membership proofs, compact non-membership proofs, membership multiproofs, range proofs, and efficient diffs.

Domain adapters convert domain material into canonical `Index Key` and `Index Value Ref` values. The engine is reused for Merkle State, Checkpoint Node, Workspace Projection, lifecycle, idempotency, and causality indexes.

## Merkle State

Merkle State uses the shared Verifiable Index Engine for state roots, key membership proofs, key non-membership proofs, and diffs. State Commits bind to Operation Outcomes, not Operation Intents.

## Checkpoint Tree

Checkpoint Tree owns recovery and progress structure. It is verifiable, but it does not replace Ledger Authority.

Checkpoint Tree distinguishes:

- `Intent Checkpoint` for lifecycle start or recoverable progress.
- `Outcome Checkpoint` for declared results, effect evidence, or state transition material.

Checkpoint node membership and diffs use shared Verifiable Index Engine-backed indexes.

## Proof Envelopes And Bundles

`recordOperation`, `recordOperations`, and lower-level lifecycle APIs return Pactium Proof Envelopes with content-addressed Proof Material Refs. Full portable proof material is exported through Proof Bundles.

Operation Intent and Outcome facts retain `inputHash` and `resultHash`, not the original caller values. Inline state mutation values are explicitly persisted as content-addressed State Values. Proof Extension values are another explicit persistence surface; reachable extension blocks are included in exported bundles. Pactium never creates those content copies implicitly.

Proof Bundles are CAR-like content-addressed block bundles with a Pactium manifest naming the root envelope, required blocks, protocol versions, Ledger Head, and critical extensions.

Proof material compacts repeated index sibling descriptors through `proofDescriptorTable`, repeated leaf bodies through the self-contained `proofLeafTable`, and causality edges through one membership multiproof. Persistent verification and Proof Bundle verification default to the `trusted-manifest-required` trust policy; in-memory/development verification may use the self-carried manifest profile.

## Runtime State And Storage

The mutable runtime state is a fixed-size generation manifest plus domain-separated locator and claim records. SQLite publishes a phase in one transaction; JSON uses two generation slots and ignores unpublished future records.

The current SQLite format stores canonical bytes as BLOBs, applies adaptive Brotli after CID computation, normalizes block references, and avoids updates when a protocol object's content hash is unchanged. `compactStorage()` uses a fail-closed root snapshot and only permits unreachable derived `index-node:*` blocks to be swept. Proof material, envelopes, ledger facts, extensions, and state values remain immutable evidence.

## Trust Anchors

Verifier manifests are the production trust-anchor object. They support signer validity windows, signer revocation, quorum policy metadata, external witness metadata, public checkpoint metadata, and gossip policy metadata. Pactium validates structural proof correctness separately from trusted signature status so a verifier can report a structurally valid but untrusted envelope. See [Trust Anchors](./TRUST-ANCHORS.md).

## HTTP Adapter

`pactium/http` is a public JSON transport adapter for host-controlled service integration. It exposes the proof-first core calls for operation lifecycle, Proof Envelope and Proof Bundle verification, bundle export, workspace projections, cursor paging, append conditions, trusted-head advancement, repair planning, maintenance tasks, extensions, and stored envelopes. It does not add authentication, authorization, witness networking, policy decisions, or host side-effect execution.

## Current Non-Surfaces

The current package does not ship a separate per-workspace FIFO lane queue, a repair executor that appends Repair Facts, or pressure-profile baseline regression enforcement. Storage supports manifest-bound local JSON and SQLite adapters behind the same Storage Port.
