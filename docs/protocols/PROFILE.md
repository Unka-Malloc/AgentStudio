# Pactium Protocol Profile

The Protocol Profile is the implementation baseline for the proof-first rewrite. These values are protocol commitments, not host tuning options.

## Global

| Area | Parameter | Value |
| --- | --- | --- |
| Protocol | `PACTIUM_PROTOCOL` | `pactium.v0.3` |
| Hash | `Protocol Hash` | `sha256` |
| Hash domains | `domainSeparator` | Fixed per object class |
| Encoding | `Canonical Value` | Pactium-specific canonical JSON bytes with sorted keys, NFC strings, safe integers, and `$bytes`; see [Canonical Encoding](./CANONICAL-ENCODING.md) |
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
| Batch append | `appendBatch` preserves caller order, emits per-append inclusion/consistency proofs, and signs only the final batch head when signing is enabled |
| Proofs | Inclusion and consistency proofs |
| Signing | Optional in core, default for LicoLite Aspect |
| Split-view defense | Consistency proof support; hosts retain last trusted heads; witness is extension point |

## Operation Lifecycle

| Parameter | Value |
| --- | --- |
| Facts | Operation Intent plus Operation Outcome, or one terminal Operation Receipt |
| Open state | Open Intent is first-class and recoverable |
| Terminality | One Terminal Outcome per Intent |
| Cancellation | Canceled Outcome |
| Recovery links | Causality References plus Operation Causality Index |
| Idempotency | Intent Idempotency Index and Outcome Idempotency Index |
| Replay | Returns existing proof/ref with `replayed`, appends no Ledger fact |
| Receipt profiles | `receipt` is a single idempotent terminal fact; `on-change` is a single terminal fact only when its digest changes |

## Verifiable Index Engine

| Parameter | Value |
| --- | --- |
| Structure | Canonical Prolly Tree |
| Reuse | One engine for state, checkpoint, workspace projection, lifecycle, idempotency, and causality indexes |
| Domain handling | Index Domain Adapters |
| Key | Canonical Index Key |
| Value | Content-addressed Index Value Ref |
| Chunking | Content-Defined Chunking with protocol constants |
| Proofs | Membership, compact non-membership, membership multiproof, and range proof |
| Mutation | Path-copying `put`, `delete`, and `mutate`; unchanged subtrees are reused |
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
| Key proof | Membership/non-membership with explicit `proofProfile`; default sampled mode proves the first 32 unique touched keys, optional full mode proves every unique touched key |
| State root | Prolly root CID/hash |
| Diff | Prolly shared-node diff |

> **Note:** State mutation proofs (`touchedKeyProofs` plus `stateCommit.proofProfile`) provide individual membership/non-membership proofs for the first 32 unique touched keys by default. Repeated keys inside one State Commit collapse to the last mutation's final effect because proofs bind to the final state root. Set `proofOptions.stateMutationProofMode: "full"` on write APIs to emit proofs for every unique touched key; `requireFullStateMutationProofs: true` then verifies that strict coverage in envelopes and Proof Bundles.

## Proofs

| Parameter | Value |
| --- | --- |
| Main receipt | Pactium Proof Envelope |
| Write response | Synchronous envelope with content-addressed Proof Material Refs |
| Offline export | Proof Bundle |
| Bundle format | CAR-like block bundle plus Pactium manifest |
| Extensions | Hash-bound Proof Extensions |
| Critical extension | Unsupported critical extension fails verification |
| Descriptor compaction | Proof envelopes hoist repeated index sibling descriptors into `proofMaterial.proofDescriptorTable` |
| Leaf compaction | Repeated proof leaves are hoisted into the self-contained `proofMaterial.proofLeafTable` |
| Causality | One exact-key membership multiproof per envelope |
| Trust policy | In-memory verification defaults to `self-carried-manifest`; persistent envelopes and bundles default to `trusted-manifest-required` |

## Storage Backend Profile

| Parameter | Value |
| --- | --- |
| Persistent default | `createStoragePort()` uses `storageBackend: "auto"` |
| SQLite | Production local-durability candidate when `node:sqlite` or optional npm `better-sqlite3` is available |
| SQLite format | Canonical BLOB payloads, normalized reference rows, adaptive Brotli q4, content-hash no-op UPSERT |
| JSON | Local development, low-concurrency use, debugging, and explicit `storageBackend: "json"` profiles |
| Manifest binding | Existing data directories reopen only with their recorded backend |
| Runtime state | Fixed-size manifest plus domain-separated generation records |
| Garbage collection | SQLite-only, dry-run by default, fail-closed mark/sweep of unreachable derived index nodes |
| Distributed deployments | Require an external consistency layer; Storage Port does not provide consensus |

## HTTP Adapter

| Parameter | Value |
| --- | --- |
| Export path | `pactium/http` |
| Role | Host-controlled JSON transport for the proof-first public API |
| Scope | Operation lifecycle, proof envelope and bundle verification, proof bundle export, workspace projection, cursor paging, append conditions, trusted-head advancement, repair planning, maintenance tasks, extension materialization, and envelope storage |
| Security boundary | Authentication, authorization, transport security, and host policy remain host-owned |

## LicoLite Aspect

| Parameter | Value |
| --- | --- |
| Export path | `pactium/licolite` |
| Workspace projection | Enabled by default, first priority |
| Signing | Enabled by default; production recording and verification require an explicit signer or signerSecret |
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
| Storage task | `storage-gc` previews or executes conservative index-node collection; page reclamation is opt-in |
| Repair execution | Host executes plans |
| Derived index repair | Repair Planner returns deterministic tasks; current package does not execute repair tasks or append Repair Facts |
| Original fact/content repair | Not invented; recovered only from authority, backup, or host evidence |
