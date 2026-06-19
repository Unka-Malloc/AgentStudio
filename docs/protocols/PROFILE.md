# Pactium Protocol Profile

The Protocol Profile is the implementation baseline for the proof-first rewrite. These values are protocol commitments, not host tuning options.

## Global

| Area | Parameter | Value |
| --- | --- | --- |
| Protocol | `PACTIUM_PROTOCOL` | `pactium.v0.2` |
| Hash | `Protocol Hash` | `sha256` |
| Hash domains | `domainSeparator` | Fixed per object class |
| Encoding | `Canonical Value` | Restricted IPLD/DAG-CBOR-style model |
| CID | `cid` | `cid:sha256:<hex>` |
| Time | `timestamp` | RFC3339 metadata, never ordering authority |
| Ordering | `authority` | Operation Ledger leaf order |

## Ledger

| Parameter | Value |
| --- | --- |
| Model | RFC6962/Trillian-style transparency log |
| `leafHash` | `H(0x00 || canonical(leaf))` |
| `nodeHash` | `H(0x01 || leftHash || rightHash)` |
| `emptyTreeHash` | `H("")` |
| Append order | Single Ledger Append Lane |
| Batch append | Allowed only when ordered |
| Proofs | Inclusion and consistency proofs |
| Signing | Optional in core, default for LicoLite Aspect |
| Split-view defense | Consistency proof support; hosts retain last trusted heads; witness is extension point |

## Operation Lifecycle

| Parameter | Value |
| --- | --- |
| Facts | Operation Intent plus Operation Outcome |
| Open state | Open Intent is first-class and recoverable |
| Terminality | One Terminal Outcome per Intent |
| Cancellation | Canceled Outcome |
| Recovery links | Causality References plus Operation Causality Index |
| Idempotency | Intent Idempotency Index and Outcome Idempotency Index |
| Replay | Returns existing proof/ref with `replayed`, appends no Ledger fact |

## Verifiable Index Engine

| Parameter | Value |
| --- | --- |
| Structure | Canonical Prolly Tree |
| Reuse | One engine for state, checkpoint, workspace projection, lifecycle, idempotency, and causality indexes |
| Domain handling | Index Domain Adapters |
| Key | Canonical Index Key |
| Value | Content-addressed Index Value Ref |
| Chunking | Content-Defined Chunking with protocol constants |
| Proofs | Membership and non-membership |
| Diff | Shared-node hash traversal |
| Storage | CAS-backed nodes through Storage Port |

## Workspace Projection

| Parameter | Value |
| --- | --- |
| LicoLite default | Enabled and first priority |
| Structure | Dual index |
| Order index | `workspaceOrdinal -> ledgerEventRef` |
| Membership index | `ledgerEventId -> workspaceOrdinalRef` |
| Ordinal assignment | Same protocol commit as Ledger append |
| Concurrency | Single Ledger Append Lane plus synchronous projection updates; no separate per-workspace queue in current package |
| Contents | Operation Intents and Operation Outcomes; Repair Facts are reserved for a future repair executor |
| Ledger binding | Every projection update bound by global Ledger facts |

## Checkpoint

| Parameter | Value |
| --- | --- |
| Role | Recovery/progress structure |
| Node proof | Shared Verifiable Index Engine |
| Intent Checkpoint | Lifecycle start or recoverable progress |
| Outcome Checkpoint | Default for LicoLite effects, results, and state transitions |
| Restore | Append marker/fact, no destructive rewrite |
| Tree head | Checkpoint root plus node index root |

## State

| Parameter | Value |
| --- | --- |
| State index | Shared Verifiable Index Engine |
| Commit binding | Operation Outcome only |
| Key proof | Membership and non-membership |
| State root | Prolly root CID/hash |
| Diff | Prolly shared-node diff |

## Proofs

| Parameter | Value |
| --- | --- |
| Main receipt | Pactium Proof Envelope |
| Write response | Synchronous envelope with content-addressed Proof Material Refs |
| Offline export | Proof Bundle |
| Bundle format | CAR-like block bundle plus Pactium manifest |
| Extensions | Hash-bound Proof Extensions |
| Critical extension | Unsupported critical extension fails verification |

## LicoLite Aspect

| Parameter | Value |
| --- | --- |
| Export path | `pactium/licolite` |
| Workspace projection | Enabled by default, first priority |
| Signing | Enabled by default; missing signer behavior is LicoLite policy |
| Policy evidence | Critical LicoLite Policy Extension |
| Workspace effect evidence | Critical LicoLite Workspace Effect Extension |
| Verifier | Required LicoLite Verifier |
| Failures | Structured Verification Failures |
| Repair | Repair Planner only, no automatic repair |
| Data support | Latest schema only |

## Maintenance And Repair

| Parameter | Value |
| --- | --- |
| Scheduler | No resident daemon |
| Task model | Deterministic Maintenance Task Engine |
| Repair execution | Host executes plans |
| Derived index repair | Repair Planner returns deterministic tasks; current package does not execute repair tasks or append Repair Facts |
| Original fact/content repair | Not invented; recovered only from authority, backup, or host evidence |
