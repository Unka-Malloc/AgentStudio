# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-06-19

### Added

- Added the proof-first Pactium package surface under `pactium`.
- Added the first-class `pactium/licolite` aspect.
- Added canonical value encoding, protocol hashes, storage port, ledger transparency log, verifiable index engine, operation lifecycle APIs, workspace projection, proof envelopes, proof bundles, repair planning, and maintenance task planning.
- Added CLI and HTTP facades for local Pactium operation recording and verification.
- Added release gates for coverage, proof vectors, regression snapshots, seeded property tests, public API pressure profiles, release-readiness checks, and package dry run.
- Added release-readiness enforcement for the current tool and skill surface.
- Added Node.js LTS release gating for Node.js 22 and Node.js 24.

### Changed

- Replaced earlier storage-shaped package assumptions with the current proof-first protocol model.
- Kept package root exports limited to the latest proof-first API.
- Kept project tooling limited to current package development, operation, maintenance, and release verification needs.
- Moved durable project decisions into maintained docs and ADRs instead of development scratch files.

### Security

- Added content-addressed proof material checks for proof envelopes and proof bundles.
- Added LicoLite critical policy and workspace-effect proof extensions.
- Added signing support for LicoLite proof envelopes.

[0.2.0]: https://github.com/Unka-Malloc/Pactium/releases/tag/v0.2.0
