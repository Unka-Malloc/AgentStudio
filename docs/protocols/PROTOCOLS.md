# Pactium Protocols

Pactium is the current proof-first protocol substrate. The glossary is maintained in [Terms](../TERM.md), and the approved protocol parameter matrix is [Protocol Profile](./PROFILE.md).

## Operation Ledger

The Operation Ledger is the global ordering authority for Pactium protocol facts. It uses a dedicated Ledger Transparency Log to produce verifiable Ledger Heads, inclusion proofs, and consistency proofs.

Operation lifecycle is append-only:

- `Operation Intent` records the intended operation.
- `Operation Outcome` records the terminal result.
- `Open Intent Index` and `Outcome Index` make lifecycle recovery and lookup verifiable.
- `Intent Idempotency Index` and `Outcome Idempotency Index` make retries recover existing facts rather than append duplicates.

## Workspace Projection

Workspace Projection is a first-priority capability for the LicoLite Aspect. It is enabled by default for LicoLite and is bound by global Ledger entries.

Workspace Projection uses two Verifiable Index Engine-backed indexes:

- `Workspace Order Index` maps workspace-local order to ledger event references.
- `Workspace Membership Index` maps ledger event identifiers to workspace-local membership material.

Workspace Projection currently includes workspace-scoped Operation Intents and Operation Outcomes. Repair Facts are reserved for a future repair executor and are not appended by the current package.

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

Proof Bundles are CAR-like content-addressed block bundles with a Pactium manifest naming the root envelope, required blocks, protocol versions, Ledger Head, and critical extensions.

Proof material compacts repeated index sibling descriptors through `proofDescriptorTable`. Persistent verification and Proof Bundle verification default to the `trusted-manifest-required` trust policy; in-memory/development verification may use the self-carried manifest profile.

## Trust Anchors

Verifier manifests are the production trust-anchor object. They support signer validity windows, signer revocation, quorum policy metadata, external witness metadata, public checkpoint metadata, and gossip policy metadata. Pactium validates structural proof correctness separately from trusted signature status so a verifier can report a structurally valid but untrusted envelope. See [Trust Anchors](./TRUST-ANCHORS.md).

## HTTP Adapter

`pactium/http` is a public JSON transport adapter for host-controlled service integration. It exposes the proof-first core calls for operation lifecycle, Proof Envelope and Proof Bundle verification, bundle export, workspace projections, cursor paging, append conditions, trusted-head advancement, repair planning, maintenance tasks, extensions, and stored envelopes. It does not add authentication, authorization, witness networking, policy decisions, or host side-effect execution.

## LicoLite Aspect

`pactium/licolite` is a first-class package surface for LicoLite. It provides LicoLite-facing protocol substrate integration, default Workspace Projection, default signing policy, critical policy and workspace-effect extensions, LicoLite-level verification, repair planning, and new-data-directory support.

LicoLite production mode requires an explicit signer or signerSecret for both recording and verification. The required policy and workspace-effect extensions must be critical and listed in `criticalExtensions`; downgrading either extension fails LicoLite verification.

LicoLite owns runtime policy decisions, operation dispatching, side effects, UI ownership, and durable Host Evidence storage. Pactium binds LicoLite evidence and verifies the binding.

## Current Non-Surfaces

The current package does not ship a separate per-workspace FIFO lane queue, a repair executor that appends Repair Facts, or pressure-profile baseline regression enforcement. These require explicit implementation before maintained docs can describe them as current behavior. Storage currently supports manifest-bound local JSON and SQLite adapters behind the same Storage Port.
