# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.2] - 2026-06-20

This patch release tightens proof verification, LicoLite production signing behavior, HTTP defaults, and release gates. It does not change the protocol version or public API shape.

### Changed

- Hardened proof-envelope semantic binding so verified ledger facts, append conditions, and state commits must agree with the proof material they reference.
- Tightened LicoLite production mode to require explicit signer configuration and to fail closed when required LicoLite policy or workspace-effect extensions are not critical.
- Defaulted the HTTP server and container examples to loopback-safe operation, with configurable JSON request body limits.
- Strengthened package-content and release-readiness checks for the published npm artifact.

### Fixed

- Prevented attacker-controlled workspace IDs from polluting object prototypes in persisted core state.
- Rejected reserved Canonical Value `$bytes` object keys until binary values have an explicit protocol representation.
- Normalized cursor positions and `~` data-directory expansion for safer local operation.

## [0.2.1] - 2026-06-20

This patch release expands the published documentation set and tightens release gates. It does not change the protocol format or public API behavior.

### Added

- Published API, FAQ, migration, examples, changelog, and logo documentation in the npm package.
- Package-content gate coverage for the expanded documentation set and runnable examples.
- Published-document link verification so npm package docs cannot point to unpublished relative files.

### Changed

- Updated README documentation indexes to keep process documents on GitHub while package-facing docs stay self-contained.
- Synchronized package metadata, version constants, and TypeScript declarations for the patch release.

## [0.2.0] - 2026-06-19

This is the first public release of Pactium as a proof-first protocol substrate. The package surface is built around verifiable operation facts, append-only recovery history, and cryptographic state verification.

### Added

#### Core Protocol

- Canonical Value encoding (restricted IPLD/DAG-CBOR-style data model) for deterministic serialization
- Protocol Hash with domain separation (`sha256` with fixed domain prefixes per object class)
- Content-addressed Identifiers (`cid:sha256:<hex>` format)
- Storage Port abstraction with local JSON backend and content-addressed block store

#### Operation Ledger

- RFC 6962-style Ledger Transparency Log with append-only guarantees
- Ledger inclusion proofs (verify a leaf exists at a given tree size)
- Ledger consistency proofs (verify a smaller ledger is a prefix of a larger one)
- Ledger Head as verifiable ledger state summary
- Single Ledger Append Lane for global ordering
- Signed Ledger Head support (Ed25519) with verifier manifests
- Last Trusted Head advancement with consistency verification

#### Operation Lifecycle

- Operation Intent and Operation Outcome as append-only facts
- Terminal Outcome semantics (one outcome per intent)
- Canceled Outcome for explicit cancellation recording
- Open Intent recovery through verifiable Open Intent Index
- Intent Idempotency Index and Outcome Idempotency Index
- Idempotency Replay detection (returns existing proof without new append)
- Causality References for linking retries, repairs, and compensations
- Operation Causality Index for verifiable relationship queries

#### Verifiable Index Engine

- Canonical Prolly Tree with Content-Defined Chunking (protocol constants)
- Membership proofs and non-membership proofs
- Efficient structural-sharing diffs between index roots
- Index Domain Adapters for domain-independent proof engine
- Shared engine reused by state, workspace, lifecycle, idempotency, and causality indexes

#### Workspace Projection

- Workspace Order Index (workspace-local order to ledger event references)
- Workspace Membership Index (ledger event ID to workspace membership material)
- Synchronous projection updates during protocol commits
- Verifiable workspace-scoped ordering and pagination
- Default-enabled for LicoLite Aspect

#### Merkle State

- State Commits bound to Operation Outcomes (not Intents)
- Content-addressed state roots through shared Verifiable Index Engine
- Key membership and non-membership proofs
- Efficient state diffs via Prolly Tree shared-node traversal

#### Checkpoint Tree

- Intent Checkpoints for lifecycle start and recoverable progress
- Outcome Checkpoints for results, effect evidence, and state transitions
- Verifiable node membership through shared Index Engine
- Checkpoint Tree Head for recovery structure summary

#### Proof System

- Pactium Proof Envelope: cross-proof receipt binding ledger, index, state, and checkpoint evidence
- Proof Material Refs: content-addressed references to stored proof material
- Proof Bundles: portable CAR-like exports for offline verification
- Proof Extensions: hash-bound host extensions (critical and non-critical)
- Default Proof Verifier Registry for extensible verification
- Standalone `verifyProofEnvelope()` and `verifyProofBundle()` functions

#### LicoLite Aspect (`pactium/licolite`)

- `createLicoLiteAspect()` with default Workspace Projection and signing
- `createLicoLiteSigner()` for Ed25519 signing authority
- LicoLite Policy Extension (critical, hash-bound)
- LicoLite Workspace Effect Extension (critical, hash-bound)
- LicoLite Verifier with structured Verification Failures
- Evidence policy modes: `production` (fail-closed) and `opportunistic`
- LicoLite-level Proof Bundle verification

#### Maintenance and Repair

- Structured Verification Failures with layer, code, severity, and evidence
- Repair Planner: deterministic repair task generation from verification failures
- Maintenance Task Engine with `doctor` health check
- Repair proposals without automatic execution (host decides)

#### CLI and HTTP

- `pactium doctor` -- data directory health check
- `pactium serve` -- local HTTP verification server
- `pactium operation record` -- record operations from JSON
- `pactium envelope verify` -- verify proof envelopes
- `pactium bundle verify` -- verify proof bundles
- `pactium licolite record` / `pactium licolite verify` -- LicoLite operations
- JSON input from `--body`, `--body-file`, or stdin

#### Quality and Release

- Coverage-enforced tests (95% lines/functions, 90% branches)
- Deterministic proof-vector fixtures (protocol-revision-locked)
- Public API regression snapshots
- Seeded property tests for encoding determinism and Prolly Tree soundness
- Public API pressure profiles (scaled for CI, full-count for release review)
- Release-readiness enforcement script
- Package contents verification (excludes process docs, tests, build outputs)
- Node.js 22 and Node.js 24 release gating

### Changed

- Package surface is proof-first: write operations return verifiable proof envelopes
- Root export limited to latest proof-first API only (no historical/experimental APIs)
- Project tooling limited to current development, operation, maintenance, and release needs
- Durable project decisions maintained as docs and ADRs (not development scratch)

### Security

- Content-addressed proof material integrity checks for envelopes and bundles
- Critical extension model: unknown critical extensions fail verification
- LicoLite Policy Extension binding prevents proof/policy mis-association
- LicoLite Workspace Effect Extension binding prevents proof/effect mis-association
- Ed25519 signing support for Ledger Heads and LicoLite envelopes
- Signed head verification with verifier manifest validation

[0.2.2]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.2.2
[0.2.1]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.2.1
[0.2.0]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.2.0
