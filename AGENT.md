# Pactium Agent Entry

This is the single entry point for automated coding agents maintaining this repository. Read this file before changing code, tests, documentation, release scripts, or package metadata.

## Project Scope

- Pactium is the proof-first protocol substrate npm package for LicoLite.
- LicoLite is Pactium's primary host. The `pactium/licolite` aspect is a first-class package surface, not an external plugin.
- Active code lives in `src/`, CLI code lives in `bin/`, tests live in `tests/pactium/`, and maintained docs live in `docs/`.
- The current `src/` implementation is the proof-first implementation surface.
- Protocol authority lives in maintained `docs/` files and ADRs: `docs/architecture/ARCHITECTURE.md`, `docs/protocols/PROTOCOLS.md`, `docs/protocols/PROFILE.md`, and `docs/adr/`.
- `CONTEXT.md` is development scratch space only. Do not cite it from README, package docs, source docs, or release artifacts. Any durable decision from `CONTEXT.md` must be moved into maintained docs or ADRs before release.
- Process documentation must not be published to npm. Agent guides, ADRs, release rules, tooling notes, quality gates, optimization records, contributor process docs, tests, scripts, build outputs, binary caches, and compressed archives stay out of `package.json` `files`; package-facing docs may link to those records only through GitHub URLs.

## Maintenance Method

- Start by reading the maintained docs or ADRs that own the area being changed, then inspect the current implementation with local code search before editing.
- Keep code, tests, docs, package metadata, and release gates aligned in the same change when behavior or public surface changes.
- Prefer the smallest change that preserves the proof-first model and covers the touched behavior with the appropriate regression test.
- Treat maintained docs as current-state documentation. If a claim is not implemented and covered by an ADR, either implement and verify it or keep it out of maintained docs.
- Before finishing, run the narrowest relevant check first, then the release gate when the change affects docs, public APIs, tooling, protocol behavior, or package contents.

## Implementation Boundaries

- Do not add old product-system code back into active Pactium modules. Product-level features belong in the host system that embeds Pactium.
- Maintain the current proof-first implementation. Do not reintroduce removed storage-shaped APIs.
- Root exports must expose the latest proof-first API only. Do not keep weak historical APIs in the root export.
- Build from foundations upward: canonical encoding and protocol hash, storage port, Ledger Transparency Log, Verifiable Index Engine, lifecycle indexes, Workspace Projection, Merkle State, Checkpoint Tree, Proof Envelopes/Bundles, LicoLite Aspect, then maintenance and repair.
- Operation Ledger is the global ordering authority. Checkpoint Tree, Merkle State, Workspace Projection, lifecycle, idempotency, and causality indexes are verifiable structures but do not replace Ledger Authority.
- Reuse the shared Verifiable Index Engine for ordered proof indexes. Do not create separate domain-specific proof tree implementations.
- Workspace Projection is first priority for LicoLite, enabled by default in the LicoLite Aspect, and updated synchronously with Ledger commits.
- Pactium must not execute LicoLite policy decisions or side effects. It binds LicoLite policy and workspace effect evidence as critical proof extensions and verifies the binding.
- Pactium provides deterministic maintenance tasks and repair plans, but hosts schedule and execute them.
- Support the latest verifiable schema only. Do not add historical Pactium or LicoLite data migration unless the protocol decisions are explicitly revisited.
- Keep project tooling minimal and current. Do not add project-local agent skills, unrelated tool registries, historical entrypoints, or version-named tooling. The current tool surface is documented in `docs/TOOLING.md` and enforced by the release-readiness gate.
- `AGENT.md` is the only in-repository agent entry. Do not add `AGENTS.md`, root `skills/`, root `tools/`, editor-specific agent skill directories, or product runtime tool registries to Pactium.

## Implementation Notes

- Do not return proof hashes as substitutes for membership or non-membership proofs.
- Do not use mutable ledger rows for operation lifecycle. Use append-only Operation Intent and Operation Outcome facts.
- Do not inline full domain objects in Verifiable Index Engine leaves. Use content-addressed Index Value Refs.
- Do not let storage backends define hashes, roots, proof formats, or canonical encoding.
- Do not make hash algorithms, chunking, or proof formats host-configurable. They are protocol constants.
- Do not add a resident scheduler or daemon to Pactium core.
- Do not add Implementation Plan, Implementation Guide, Gap, or similar process-state documents. Their presence means work is not closed and a release must be blocked until the work is completed or removed.
- Do not add documents named after a package or protocol version. Maintained documents describe the project's current state; historical version material must be merged into current docs or ADRs and then removed.
- Do not leave design claims in documentation unless the implementation exists and the matching ADR records the current behavior.

## Verification

- For implementation work, satisfy `docs/QUALITY-GATES.md`. Unit tests alone are not enough.
- Add proof-vector tests for every new protocol primitive before wiring LicoLite-level flows.
- Run `npm run verify:hygiene` after renaming or documentation edits, but update the hygiene script first if its old assumptions conflict with current documentation.
- Run `npm run pack:dry-run` before release-oriented changes.
- After changing `package.json` version, run `npm run docs:sync-version` so current-version references in published docs match the package version.
- Run `npm run verify:release` before publishing. Release verification must pass independently on every supported Node.js LTS major in the CI matrix.
- Before release, verify that the npm tarball contains only runtime source, CLI, examples, public project docs, README files, security policy, changelog, package metadata, and license. Process docs must remain unpublished.
- Before release, verify that package scripts, `bin/`, `scripts/`, exports, and project skill/tool directories still match `docs/TOOLING.md`.
- Before release, scan documentation against implementation. If a maintained doc describes an unimplemented design, report it and block release rather than treating it as roadmap text.
