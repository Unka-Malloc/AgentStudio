# Pact Work Queue Design

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained design draft
- Scope: Pact Work Queue infrastructure primitive.
- Staleness check: Scanned on 2026-06-14; queue contract claims are guarded by `server:verify:work-queue` and `server:verify:job-work-queue`.
- ADR: `docs/adr/0007-pact-work-queue-primitive-contract.md`

## Summary

Pact Work Queue is a platform infrastructure queue for governed asynchronous work. It absorbs the useful work-queue semantics of NATS JetStream, but Pact owns the vocabulary, state machine, journal, replay model, worker runtime, and adapter contracts.

The queue owns scheduling state only. Business state, workflow history, payloads, checkpoints, results, and full diagnostics remain with the owning capability.

## Implementation Priority

| Priority | Module | Purpose |
| --- | --- | --- |
| P0 | `server/platform/common/resource-management/work-queue/state-machine.mjs` | Finite queue state machine, legal transitions, safe states, terminal states, fail-closed checks. |
| P0 | `server/platform/common/resource-management/work-queue/index.mjs` | Stable module export surface for queue primitives and shared contracts. |
| P0 | `server/platform/common/resource-management/work-queue/identity.mjs` | Queue-owned UUIDv7-or-better global identifiers with injectable deterministic generator for tests. |
| P0 | `server/platform/common/resource-management/work-queue/time-source.mjs` | Unified injectable queue clock; queue code must not scatter direct wall-clock calls. |
| P0 | `server/platform/common/resource-management/work-queue/store-adapter-contract.mjs` | Store adapter shape and conformance entry points. |
| P0 | `server/platform/common/resource-management/work-queue/conformance/index.mjs` | Shared conformance scaffold for state machine, adapter shape, replay, fencing, and randomized coverage. |
| P1 | `server/platform/common/resource-management/work-queue/sqlite-store.mjs` | Dedicated SQLite WAL store, journal plus projection, single-writer path, durable commit before success. |
| P1 | `server/platform/common/resource-management/work-queue/registry.mjs` | Resolves untrusted queue labels/intents to trusted queue definition ids and versions. |
| P1 | `server/platform/common/resource-management/work-queue/worker-runtime.mjs` | Lightweight adapter between leased work item envelopes and business handlers. |
| P1 | `server/platform/common/resource-management/work-queue/background-write-aspect.mjs` | Unified background persistence outlet for fallback coordinator, snapshots, compaction, and health records. |
| P1 | `server/platform/common/resource-management/work-queue/fallback-coordinator.mjs` | Independent fallback subtasks, durable coordinator state, per-work-item fencing lock, automatic safe fallback. |
| P2 | `server/platform/common/resource-management/work-queue/push-dispatcher.mjs` | Push dispatch uses durable claim first, bounded credit, and peer-first backpressure hook. |
| P2 | Tool/Console Management Surface | Governed inspect, pause, drain, requeue, DLQ retry, recovery report, and health inspection. |
| P2 | External Store/Broker Adapters | PostgreSQL, NATS JetStream, or other adapters behind Pact primitives without exposing broker-native APIs. |

## Primitive API

The stable Pact queue primitives are:

- `enqueue`
- `claim`
- `ack`
- `nack`
- `progress`
- `term`
- `recover`
- `deadLetter`
- `inspect`

Push delivery also uses the same durable `claim` and lease transition before dispatch. Management operations never directly mutate projection rows.

## Trusted Identity

Queue labels are not trusted identities. `enqueue` must resolve external labels or intents through Queue Definition Registry:

```text
business queue label/intent -> registry lookup -> queueDefinitionId + queueDefinitionVersion
```

If lookup fails, enqueue fails closed and records Operation or Authorization audit. No Queue Transition Journal entry is written because no legal queue transition exists.

`dedupeKey` is also untrusted. It must be normalized or hashed by the owning capability or idempotency contract before it is stored or journaled.

## State Machine

The scheduling states are:

| State | Meaning |
| --- | --- |
| `pending` | Eligible for future claim when policy and delivery capacity allow. |
| `delayed` | Temporarily not visible until the adopted availability time. |
| `leased` | Claimed by Queue Worker Runtime with a valid lease identity. |
| `dead_letter` | Scheduling exhausted; not a business failure. |
| `fallback_review` | Queue-internal safe state after automatic fallback itself failed after bounded retries. |
| `acked` | Terminal queue scheduling completion; not business success. |
| `terminated` | Terminal queue scheduling stop; not business success or failure. |

Core legal transitions:

| Transition | From | To |
| --- | --- | --- |
| `enqueue` | none | `pending`, `delayed` |
| `claim` | `pending` | `leased` |
| `progress` | `leased` | `leased` |
| `ack` | `leased` | `acked` |
| `nack` | `leased` | `pending`, `delayed`, `dead_letter` |
| `dead_letter` | `pending`, `delayed`, `leased`, `fallback_review` | `dead_letter` |
| `recover` | `dead_letter`, `fallback_review` | `pending`, `delayed`, `terminated` |
| `lease_expired` | `leased` | `pending`, `delayed`, `dead_letter` |
| `delay_matured` | `delayed` | `pending` |
| `term` | `leased` | `terminated` |
| `fallback_failed` | `leased` | `fallback_review` |
| `fallback_review_retry` | `fallback_review` | `pending`, `delayed`, `dead_letter`, `terminated` |

Illegal transitions fail closed. `verifyWorkQueueStateMachineProof()` builds the full state x event matrix and checks terminal closure, non-terminal exits, and legal-target consistency.

## Storage Model

The default store is SQLite WAL behind `Work Queue Store Adapter`.

Required durable structures:

- `queue_transition_journal`: append-only queue transition facts.
- `work_items`: current queue state projection.
- `queue_definitions`: trusted queue definition ids, labels, versions, lifecycle state.
- `work_queue_controls`: pause, resume, and drain controls.
- `work_queue_background_writes`: unified background write records.
- `work_queue_fallback_tasks`: fallback coordinator state and fencing locks.
- `queue_internal_health`: store, background write, recovery, fallback, snapshot, and compaction health.

Every accepted queue state transition writes journal and projection in the same durable transaction. Background records are written through Queue Background Write Aspect, not scattered component writes.

Delivery route and worker registration tables remain an extension point. The first implementation keeps push delivery lightweight through `createQueuePushDispatcher()`, bounded in-flight credit, and the same durable `claim` primitive used by pull delivery.

Single-node local delivery has a code-level hard cap of `8192` for `maxAckPending` / dispatcher in-flight credit. Runtime configuration may lower this value for smaller private-cloud profiles, but cannot raise it above the hard cap without a code change and a fresh capacity proof.

## Recovery

Failure, timeout, crash, interruption, and delivery loss first resolve automatically through queue state machine fallback. External actors cannot steer fallback while it is in progress.

Automatic recovery must:

- enforce memory and backlog guards;
- retry background writes under versioned policy;
- rebuild and verify projections;
- resume fallback coordinator tasks;
- prove the journal can append safely;
- emit a structured recovery report if recovery exhausts.

## Conformance

Every store adapter and delivery adapter must pass the same conformance suite. Required coverage:

- legal transition table;
- illegal transition fail-closed behavior;
- lease fencing;
- dedupe normalization and conflict resolution;
- journal replay;
- projection rebuild;
- crash/recovery;
- pull and push delivery;
- pause and drain;
- peer-first backpressure;
- fallback coordinator and fallback review;
- randomized smoke tests across legal and illegal operations.

Current verification entry point:

```bash
npm run server:verify:work-queue
```

This runs the proof matrix, concrete SQLite WAL store checks, lease fencing, dedupe conflicts, pause/resume, fallback review, push backpressure, replay drift checks, and deterministic randomized smoke testing.

## JobManager Migration

Existing JobManager history remains queryable as upper-layer business history. It is not forcibly migrated into the new queue journal.

Migration points:

1. Keep historical `jobs/<jobId>/meta.json`, payload, and result files readable as legacy business history.
2. Route new scheduling through Pact Work Queue.
3. Convert JobManager worker execution into Queue Worker Runtime handlers.
4. Store payloads and results in existing owning stores; queue work items keep only `payloadRef` and owner references.
5. Map JobManager retry/recovery into queue `nack`, `progress`, `term`, and DLQ/review semantics.
6. Expose queue scheduling observability separately from business job success/failure metrics.

## What To Reimplement From JetStream

Reimplement as Pact-owned semantics:

- explicit ack/nack/progress/term;
- ack wait and lease timeout;
- max delivery attempts;
- delayed redelivery and deterministic backoff;
- pull claim;
- push dispatch through durable claim;
- durable subscription/worker group configuration;
- work-queue competing-consumer behavior;
- redelivery after lease expiry;
- DLQ-like scheduling exhaustion;
- flow control and backpressure.

Do not reimplement:

- NATS protocol server;
- subject-based application API;
- stream/consumer API as Pact vocabulary;
- accounts, leaf nodes, gateways, supercluster;
- Raft or cluster replication for the first single-node deployment;
- JetStream filestore block format;
- KV/Object Store/MQTT features;
- `$JS.API.*` compatibility.
