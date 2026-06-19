# Pactium Quality Gates

These gates describe the current automated release gate for the proof-first implementation. A release candidate is not acceptable unless the automation below passes. Stronger gates require matching implementation and an ADR before they can be documented as release-blocking.

## Coverage Gates

| Area | Minimum |
| --- | --- |
| Public/protocol source | 95% lines, 95% functions, 90% branches |
| Public API export surface | Checked by regression snapshot |
| Verifier boundary paths | Covered by targeted success, malformed input, missing material, and replacement-material tests |

The coverage threshold is enforced over package public/protocol source by `npm run test:coverage`. CLI and HTTP facades are covered by integration tests because they exercise process and socket behavior that is more useful as black-box verification than line coverage.

Coverage must be enforced by a package script. A coverage report without threshold enforcement is not sufficient.

## Proof Vector Gates

The current deterministic proof-vector fixture covers:

- Pactium Canonical Value encoding.
- Protocol Hash domain separation.
- Ledger leaf hashes, node hashes, Ledger Heads, inclusion proofs, and consistency proofs.
- Canonical Prolly Tree roots, content-defined chunk boundaries, membership proofs, and non-membership proofs.

Proof vectors are protocol fixtures. Changing expected vectors requires an explicit protocol revision, not a routine implementation change.

## Integration Gates

End-to-end integration tests must cover:

- Fresh local data directory initialization.
- Root proof-first API imports.
- `pactium/licolite` imports.
- Intent append, Open Intent lookup, Outcome append, and Outcome lookup.
- Idempotency replay for Intent and Outcome.
- Workspace Projection default behavior for LicoLite, including order and membership proofs.
- State Commit bound to Outcome.
- Outcome Checkpoint material for operation outcomes.
- Proof Envelope verification from local Proof Material Refs.
- Proof Bundle export and verification without local storage.
- Signed LicoLite envelope verification.
- Structured Verification Failures for missing proof material, bad signature, unsupported critical extension, bad workspace projection proof, and Ledger consistency failure.
- Repair Planner output for repairable derived-index failures.

Integration tests must use the public API whenever possible. Tests that reach private helpers do not replace public API integration coverage.

## Regression Gates

Regression tests must include checked-in snapshots or fixtures for:

- Package root exports, `pactium/licolite` exports, and the package metadata export.
- Public TypeScript declaration digests.
- Protocol profile constants.
- Proof vector outputs.
- Structured Verification Failure codes.
- LicoLite default Aspect behavior.

Any snapshot change must be reviewed as an API, protocol, or host-profile change.

## Tooling And Skill Surface Gates

Pactium's release gate must keep the active tooling surface aligned with [Tooling Surface](TOOLING.md). The gate rejects unapproved package scripts, extra `bin/` or `scripts/` files, project-local agent skills, unrelated tool registries, version-organized entrypoints, and old version-named tooling labels. Root `AGENT.md` is the only in-repository agent entry.

Pactium keeps no project-local agent skills. Product runtime skills, Tool Management catalogs, and KnowledgeSkill registries belong to the host system unless Pactium adds a current implementation, ADR, and release gate for them.

## Property And Fuzz Gates

Seeded property tests are required for:

- Canonical encoding determinism across object key order and equivalent input construction.
- Prolly Tree insertion-order independence.
- Prolly Tree membership and non-membership proof soundness.

Property tests must use deterministic seeds in CI and print the failing seed.

## Public API Pressure Gates

Pressure tests must exercise exported APIs, not private helpers.

`npm run verify:release` runs scaled pressure profiles suitable for every local and CI release-gate run. The same automation supports full release-count pressure profiles through:

```bash
PACTIUM_FULL_PRESSURE=1 npm run verify:protocol:gates
```

Full release-count profiles are supported for explicit release review. Scaled profiles keep the default release gate deterministic and routinely runnable while preserving the same public API paths and benchmark output shape.

Full release-count profiles:

| Profile | Required scenario |
| --- | --- |
| `api:operation-lifecycle` | 10,000 Intent/Outcome lifecycles across at least 10 workspaces through public lifecycle APIs |
| `api:licolite-record` | 5,000 LicoLite workspace operations through `pactium/licolite` with signing, critical extensions, and Workspace Projection enabled |
| `api:index-engine` | 100,000 indexed keys, then 10,000 membership proofs, 10,000 non-membership proofs, and a root-to-root diff |
| `api:proof-bundle` | Export and verify at least 1,000 Proof Bundles without local storage |
| `api:recovery` | Create at least 1,000 Open Intents, recover them with Outcomes, and verify projection/index consistency |

Each profile must emit machine-readable benchmark output with operation count, duration, throughput, p50, p95, p99, memory high-water mark, and package version.

The current CI gate does not compare pressure output against checked-in performance baselines. Baseline regression enforcement requires a separate implementation and ADR before it becomes release-blocking.

## Release Gate Script

The implementation must provide a release gate script equivalent to:

```bash
npm run verify:release
```

That script must run, at minimum:

- lint/type checks if present;
- unit tests;
- coverage with enforced thresholds;
- proof vector tests;
- integration tests;
- regression snapshots;
- property tests;
- public API pressure tests, using scaled counts by default and full counts when `PACTIUM_FULL_PRESSURE=1`;
- published-document version checks against `package.json`;
- tool and skill surface checks against the current package tooling inventory;
- stable-only publish source checks for both manual and release-triggered npm publishing;
- package-content checks that reject process docs, agent maintenance docs, release tooling, tests, build outputs, binary caches, compressed archives, links to unpublished process docs, and relative links to missing package files;
- root `AGENT.md` single-entry checks for automated coding agents;
- release-readiness scans for process-state docs, version-named docs, development scratch authority links, design/implementation anchors, and Node.js LTS gate coverage;
- package dry run.
- publish dry run.

Release CI must run the release gate for every supported Node.js LTS major declared by `engines`. Passing unit tests alone is not a release gate.
