# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-08-01

Pactium 0.6.0 establishes a host-neutral proof substrate boundary and treats Meshrix as an independent downstream framework.

### Changed

- Defined one canonical repository boundary across product, context, API, security, architecture, protocol, and package documentation.
- Operation inputs and results now remain digest-only unless callers explicitly persist state values or Proof Extension copies.

### Removed

- Removed the retired framework-specific aspect, exports, HTTP routes, CLI commands, configuration, protocol fields, examples, tests, and signing helpers without compatibility aliases.

## [Unreleased]

### Changed

- Defined Pactium as a host-neutral proof substrate and Meshrix as an independent downstream framework.
- Clarified that operation facts retain input and result digests by default, while State Values and Proof Extension values are explicit content-persistence surfaces.

### Breaking Changes

- Removed the retired framework-specific package entry point, source aspect, HTTP routes, CLI commands, environment configuration, protocol profile fields, fixtures, examples, tests, and documentation without compatibility aliases or legacy-state discovery.

## [0.5.0] - 2026-07-21

This release moves the current protocol and data format to `pactium.v0.3` and removes the previous persisted layout without a compatibility reader.

### Added

- Added single-fact `receipt` and atomic `on-change` operation profiles with write-free replay/unchanged paths.
- Added SQLite block scanning, fail-closed derived-index garbage collection, post-commit incremental page reclamation, and a `storage-gc` maintenance task.
- Added global proof leaf tables and exact-key causality membership multiproofs.

### Changed

- Replaced aggregate runtime state with a fixed-size manifest and domain-separated generation records, with one publication per lifecycle phase.
- Made JSON record slots preserve each entity's latest published value across sparse generations and removed permanent successful commit-marker history.
- Replaced SQLite text payloads with canonical BLOBs, adaptive Brotli q4, normalized block references, content-hash no-op UPSERT, and byte-bounded caches.
- Made index CAS roots authoritative and removed protocol-object root aliases.
- Finalized and signed envelopes once before registration.

### Breaking Changes

- Current data directories must use the v0.3 schema and `pactium.sqlite.v2.br1`; non-current directories are rejected and are not migrated in place.
- Proof material, hash domains, and HTTP protocol identifiers now use v0.3.

## [0.4.1] - 2026-07-11

This patch release prepares Pactium 0.4.1. It does not change the protocol version or persisted protocol format.

### Added

- Added idempotent `close()` lifecycle contracts for Pactium cores and storage ports, including atomic admission shutdown, admitted-work and SQLite write-lane draining, descriptor release, and explicit closed-state errors.
- Hardened SQLite data directories, database files, and current journal sidecars to private modes and rejected symbolic-link or special-file database artifacts.
- Added reentrant compound core mutation transactions so host projections and nested Pactium evidence writes share one serialized SQLite commit boundary.

### Changed

- Synchronized package metadata, public version constants, published documentation, and protocol regression fixtures for the release.
- Made JSON state publication power-loss durable with private temporary files, file synchronization before rename, and parent-directory synchronization after rename.
- Made JSON initialization failures sticky for the instance, added a real JSON closed lifecycle, and retried SQLite writer admission through the configured busy deadline.

### Fixed

- Rejected core and storage close calls made from inside their own admitted
  mutation or write callback, preventing lifecycle self-wait deadlocks.

## [0.4.0] - 2026-06-26

This minor release hardens Pactium's proof and storage foundations while expanding recovery, storage, and verification capabilities. It keeps the protocol profile current with the new proof-size, crash-consistency, and storage surfaces.

### Added

- Added SQLite-backed storage capability and storage port modularization for host-controlled persistence.
- Added WAL commit markers, ledger replay rebuild support, lock heartbeat and fencing tokens, and richer doctor recovery coverage.

### Changed

- Hardened proof trust boundaries, proof bundle verification, canonical encoding validation, and HTTP route authorization behavior.
- Reduced proof material size through path-copying index structures and compact proofs, with configurable proof size guard options.

### Fixed

- Aligned TypeScript declarations, protocol fixtures, package contents checks, and documentation with the current implementation.

## [0.3.1] - 2026-06-20

This patch release corrects package-version support documentation after Pactium 0.3.0 while keeping the protocol/data format at pactium.v0.2.

### Changed

- Added a release-readiness check that fails when supported package lines in published docs lag behind package.json.

### Fixed

- Updated published security and migration documentation to list the current 0.3.x package line separately from the v0.2 protocol/data format.

## [0.3.0] - 2026-06-20

This minor release publishes the HTTP adapter as a public API surface for host-controlled service integration. It keeps the protocol version unchanged while expanding the package API available to hosts.

### Added

- Published the pactium/http package entry point with TypeScript declarations for HTTP server creation and startup.

### Changed

- Expanded the HTTP adapter route surface for operation lifecycle, proof bundle export and verification, workspace projections, cursors, repair planning, maintenance tasks, and extensions.

## [0.2.2] - 2026-06-20

This patch release tightens proof verification, HTTP defaults, and release gates. It does not change the protocol version.

### Changed

- Hardened proof-envelope semantic binding so verified ledger facts, append conditions, and state commits must agree with the proof material they reference.
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

- Pactium-specific canonical JSON encoding for deterministic serialization
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
- Ed25519 signing support for Ledger Heads
- Signed head verification with verifier manifest validation

[0.6.0]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.6.0
[0.5.0]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.5.0
[0.4.1]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.4.1
[0.4.0]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.4.0
[0.3.1]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.3.1
[0.3.0]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.3.0
[0.2.2]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.2.2
[0.2.1]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.2.1
[0.2.0]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.2.0
