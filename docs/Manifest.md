# Pactium Documentation Manifest

## Active Scope

The active design target is Pactium: a proof-first protocol substrate npm package for LicoLite.

Active protocol scope:

- Canonical Value encoding and Protocol Hash.
- Storage Port with local backend.
- Operation Ledger Transparency Log.
- Shared Verifiable Index Engine.
- Operation Intent, Operation Outcome, Open Intent recovery, idempotency, and causality indexes.
- Workspace Projection enabled by default and first priority for LicoLite.
- Merkle State bound to Operation Outcomes.
- Checkpoint Tree for recovery and progress.
- Pactium Proof Envelopes, Proof Material Refs, and Proof Bundles.
- `pactium/licolite` first-class aspect with signing, critical policy/effect extensions, verification, and repair planning.
- Deterministic Maintenance Task Engine and Repair Planner.

## Active Paths

- `AGENT.md`
- `README.md`
- `docs/protocols/PROTOCOLS.md`
- `docs/protocols/PROFILE.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/QUALITY-GATES.md`
- `docs/RELEASE.md`
- `docs/TOOLING.md`
- `docs/TERM.md`
- `docs/LICOLITE-ASPECT.md`
- `docs/adr/0052-pactium-verifiable-protocol-model.md`
- `docs/adr/0053-adopt-protocol-profile.md`
- `docs/adr/0054-adopt-quality-gates.md`
- `docs/adr/0055-align-current-docs-with-implementation.md`

## Implementation Code

The current `src/` tree is the proof-first implementation. It exposes the latest package root API and the first-class `pactium/licolite` aspect.

## Prohibited Drift

Project documentation must not reintroduce:

- historical data migration as a current requirement;
- removed storage-shaped APIs in the package root export;
- host-configurable hash, chunking, proof format, or canonical encoding;
- LicoLite Workspace Projection as optional, secondary, or lower priority;
- Pactium-owned LicoLite policy execution, side effects, UI, or operation dispatching.

Project documentation must also avoid release-blocking process drift:

- no Implementation Plan, Implementation Guide, Gap, or similar process-state files;
- no maintained documents named after package or protocol versions;
- no published documentation links or authority references to development scratch files;
- no design claims without corresponding implementation and ADR coverage.
- no current-state claims for SQLite storage, separate per-workspace lane queues, repair fact execution, or benchmark baseline enforcement unless implementation and tests exist.
- no agent entry other than root `AGENT.md`, project-local agent skills, unrelated tool registries, or version-organized tooling outside the current [Tooling Surface](TOOLING.md).
