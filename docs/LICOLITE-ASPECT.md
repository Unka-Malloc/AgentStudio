# LicoLite Aspect

This document describes the current LicoLite package surface implemented by `pactium/licolite`.

Pactium is LicoLite's proof-first protocol substrate. LicoLite is the primary host, and `pactium/licolite` is a first-class aspect whose requirements may shape Pactium core capability design.

## Non-Negotiables

| Area | Required behavior |
| --- | --- |
| Package relationship | Pactium is subordinate to LicoLite and provides the protocol substrate LicoLite needs. |
| Export shape | Package root exposes latest proof-first API only; `pactium/licolite` exposes the LicoLite Aspect. |
| Workspace Projection | Enabled by default for LicoLite and first priority. |
| Ledger authority | Global Operation Ledger remains the ordering authority. |
| Projection commit | Workspace Projection updates happen synchronously with Ledger-bound protocol commits. |
| Workspace reverse lookup | Workspace Membership Index proves whether a Ledger fact belongs to a workspace. |
| Signing | Enabled by default for the LicoLite Aspect; missing signer behavior is LicoLite policy. |
| Policy evidence | LicoLite Policy Extension is critical and hash-bound. |
| Workspace effect evidence | LicoLite Workspace Effect Extension is critical and hash-bound. |
| Verifier | LicoLite Verifier is required and returns structured Verification Failures. |
| Data directories | New Pactium-format data directories only. |
| Migration | No historical LicoLite or Pactium data migration in Pactium. |
| Host boundary | LicoLite owns policy decisions, operation dispatching, side effects, UI, authorization, and durable Host Evidence storage. |

## Required Public Surfaces

| Surface | Requirement |
| --- | --- |
| Root API | Proof-first lifecycle, Ledger, index, state, checkpoint, proof, verification, maintenance, and repair APIs only. |
| `pactium/licolite` | LicoLite workspace operation recording and verification with default Workspace Projection. |
| Proof response | Synchronous Pactium Proof Envelope with content-addressed Proof Material Refs. |
| Offline proof | Proof Bundle export and verification without local Pactium storage. |
| Lifecycle | Operation Intent, Operation Outcome, Open Intent recovery, idempotency replay, and Operation Causality Index. |
| Workspace projection | Workspace Order Index plus Workspace Membership Index over the shared Verifiable Index Engine. |
| State | State Commit bound to Operation Outcome only. |
| Checkpoint | Intent Checkpoint and Outcome Checkpoint; LicoLite side-effect checkpoints default to Outcome. |
| Repair | Repair Planner produces deterministic plans; hosts execute them. |

## Explicitly Rejected Old Assumptions

- `pactium/licolite` is not an external plugin.
- LicoLite Workspace Projection is not optional or secondary.
- Pactium does not keep removed storage-shaped APIs in the package root export.
- Pactium does not read or migrate historical LicoLite protocol data in place.
- Pactium does not expose proof hashes as substitutes for membership, non-membership, consistency, or bundle verification.
- Pactium does not execute LicoLite policy, side effects, operation dispatching, UI behavior, or authorization.
- Pactium does not make Protocol Hash, Canonical Value encoding, Prolly Tree chunking, or proof formats host configurable.

## Acceptance Evidence

The LicoLite Aspect is acceptable only when the release gate passes and includes evidence for:

- root export and `pactium/licolite` export snapshots;
- LicoLite workspace operations with signing, critical extensions, Workspace Projection, State Commit, Checkpoint, Proof Envelope, and Proof Bundle;
- missing signer/evidence behavior controlled by LicoLite policy, with production-style fail-closed tests;
- structured Verification Failures for bad signature, missing proof material, unsupported critical extension, bad workspace projection proof, and Ledger consistency failure;
- public API pressure test `api:licolite-record` in the default scaled release gate, with the 5,000-operation profile available through `PACTIUM_FULL_PRESSURE=1 npm run verify:protocol:gates` for explicit full review.
