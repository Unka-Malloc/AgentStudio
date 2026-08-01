# Pactium Terms

This published glossary projects the canonical vocabulary in [CONTEXT.md](../CONTEXT.md). Product boundaries belong to [PRODUCT.md](../PRODUCT.md).

**Pactium**
A host-neutral proof-first protocol substrate. It owns verifiable facts and proof mechanics, not host business semantics.

**Host**
A caller that owns identity, authorization, policy, content, effects, operational controls, and application behavior.

**Meshrix**
An independent downstream framework that consumes Pactium's public API. It is not a Pactium aspect or mode.

**Canonical Value**
Pactium-specific canonical JSON bytes with sorted keys, NFC-normalized strings, safe integers, and the `$bytes` representation. It is not RFC 8785 JCS, DAG-CBOR, or an IPLD wire-format claim.

**Protocol Hash**
A domain-separated SHA-256 commitment over Canonical Value bytes.

**Operation Ledger**
The append-only global ordering authority for Pactium protocol facts.

**Operation Intent**
An immutable fact declaring an operation before its terminal result. Its `inputHash` commits to caller input without retaining that input by default.

**Operation Outcome**
The immutable terminal fact for one Intent. Its `resultHash` commits to caller output without retaining that output by default.

**Operation Receipt**
A single terminal fact used by `receipt` and `on-change` profiles when an open Intent is unnecessary.

**Idempotency Replay**
The return of an existing fact and proof without appending a duplicate Ledger fact.

**Workspace Projection**
A verifiable workspace-scoped order and membership projection derived from the global Ledger. It is not tenant, authorization, or storage isolation.

**Verifiable Index Engine**
The shared Canonical Prolly Tree implementation used by state, workspace, checkpoint, lifecycle, idempotency, and causality indexes.

**State Value**
A caller-supplied state mutation value deliberately persisted as content-addressed verifiable state.

**State Commit**
An Outcome-bound commitment to a workspace state root and the final net effect of touched keys.

**Checkpoint**
A verifiable recovery or progress structure. Intent Checkpoints describe start/progress; Outcome Checkpoints describe declared terminal results or state transitions.

**Proof Envelope**
A receipt binding one fact to Ledger, index, state, checkpoint, and extension references.

**Proof Material Ref**
A content-addressed reference from an envelope to proof bytes required for verification.

**Proof Extension**
A host-named hash-bound value attached without changing the core fact schema. Unsupported critical extensions fail verification.

**Explicit Proof Copy**
Host Content deliberately supplied as a Proof Extension value. Pactium never derives it implicitly from operation input or result.

**Proof Bundle**
A portable Pactium indexed record stream containing an envelope and its reachable required blocks. It is CAR-like but not CARv1 or CARv2 compatible, and it is not a storage snapshot.

**Trust Policy**
The verification rule selecting structural, self-carried-manifest, or trusted-manifest-required treatment. Pactium provides no universal trust root.

**Last Trusted Head**
A previously accepted Ledger Head used to verify that a later history is a consistent continuation.

**Verification Failure**
A structured failure naming its layer, code, severity, evidence reference, and repairability.

**Repair Planner**
A deterministic mapper from failures to proposed tasks. It does not execute a repair or append a Repair Fact.

**Maintenance Task Engine**
A host-invoked engine that executes `doctor` and `storage-gc` tasks when provided a Pactium runtime. It has no resident scheduler.

**Storage Port**
The persistence abstraction behind in-memory, local JSON, and SQLite implementations. Storage never defines protocol hashes or proof semantics.

**Current-schema boundary**
Pactium opens only the current verifiable schema and manifest-bound backend. It does not discover or migrate retired product state.
